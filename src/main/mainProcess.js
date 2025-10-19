const { BrowserWindow, globalShortcut, ipcMain, desktopCapturer, Menu, screen, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const ClipboardManager = require('./clipboardManager');
const TrayManager = require('./trayManager');
const PasteHandler = require('./pasteHandler');
const ScreenshotManager = require('./screenshotManager');
const Config = require('./config');

// 安全的console包装器，防止EPIPE错误
const safeConsole = {
  log: (...args) => {
    try {
      if (process.stdout.writable) {
        console.log(...args);
      }
    } catch (error) {
      // 静默忽略EPIPE错误
    }
  },
  error: (...args) => {
    try {
      if (process.stderr.writable) {
        console.error(...args);
      }
    } catch (error) {
      // 静默忽略EPIPE错误
    }
  },
  warn: (...args) => {
    try {
      if (process.stderr.writable) {
        console.warn(...args);
      }
    } catch (error) {
      // 静默忽略EPIPE错误
    }
  }
};

class MainProcess {
  constructor() {
    this.mainWindow = null;
    this.tooltipWindow = null;
    this.tooltipPayload = null;
    this.tooltipSize = null;
    this.tooltipWindow = null;
    // 支持通过环境变量 CLIPBOARD_GOD_MAX_HISTORY 来覆盖默认的最大历史数
    // 优先从配置文件读取，如果没有则使用环境变量，最后使用默认值 500
    const maxHistoryConfig = Config.get('maxHistoryItems');
    const maxHistoryEnv = process.env.CLIPBOARD_GOD_MAX_HISTORY ? parseInt(process.env.CLIPBOARD_GOD_MAX_HISTORY, 10) : undefined;
    const maxHistory = maxHistoryConfig || maxHistoryEnv || 500;
    this.clipboardManager = new ClipboardManager({ maxHistory });
    this.trayManager = new TrayManager();
    this.screenshotManager = null;
    this.clipboardCheckInterval = null;
    // 用于防止重复粘贴：记录最近一次粘贴的 id 和时间，以及粘贴锁
    this._lastPaste = { id: null, time: 0 };
    this._pasteLock = false;
    this._registeredShortcut = null;
    // 当正在执行粘贴操作时，短暂抑制任何会显示主窗口的自动行为
    this._isPasting = false;
    // config file watcher state
    this._configWatcher = null;
    this._configWatchTimer = null;
    this._lastConfigSnapshot = null;
  }

  // Create the tooltip BrowserWindow (lazy)
  createTooltipWindow() {
    if (this.tooltipWindow && !this.tooltipWindow.isDestroyed()) return;

    try {
      this.tooltipWindow = new BrowserWindow({
        width: 420,
        height: 200,
        show: false,
        frame: false,
        resizable: false,
        // Do not force alwaysOnTop so z-order follows parent/main window
        alwaysOnTop: false,
        focusable: false,
        skipTaskbar: true,
        transparent: true,
        parent: this.mainWindow || undefined,
        modal: false,
        webPreferences: {
          contextIsolation: true,
        }
      });

      // Ensure tooltip hides when main window hides and follows show/hide
      if (this.mainWindow) {
        this.mainWindow.on('hide', () => {
          try { if (this.tooltipWindow && !this.tooltipWindow.isDestroyed()) this.tooltipWindow.hide(); } catch (_) { }
        });
        this.mainWindow.on('show', () => {
          // tooltip remains hidden until explicitly requested by renderer
        });
        // reposition tooltip when main window moves or resizes
        this.mainWindow.on('move', () => {
          try { this.repositionTooltip(); } catch (_) { }
        });
        this.mainWindow.on('resize', () => {
          try { this.repositionTooltip(); } catch (_) { }
        });
        // Hide tooltip when the main window loses focus (user switched to another app)
        this.mainWindow.on('blur', () => {
          try { if (this.tooltipWindow && !this.tooltipWindow.isDestroyed()) this.tooltipWindow.hide(); } catch (_) { }
        });
        // When main window regains focus, restore tooltip if there is a payload
        this.mainWindow.on('focus', () => {
          try {
            if (this.tooltipPayload && this.tooltipWindow && !this.tooltipWindow.isDestroyed()) {
              this.repositionTooltip();
              try { this.tooltipWindow.showInactive(); } catch (err) { this.tooltipWindow.show(); }
            }
          } catch (_) { }
        });
      }

      // Clean up when tooltip closed
      this.tooltipWindow.on('closed', () => {
        this.tooltipWindow = null;
      });
    } catch (err) {
      safeConsole.error('创建 tooltip 窗口失败:', err);
      this.tooltipWindow = null;
    }
  }

  // Reposition tooltip using last payload/size relative to mainWindow
  repositionTooltip() {
    try {
      if (!this.tooltipWindow || this.tooltipWindow.isDestroyed() || !this.tooltipPayload || !this.tooltipSize) return;
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

      const mainBounds = this.mainWindow.getBounds();
      const { anchorRect } = this.tooltipPayload;
      const size = this.tooltipSize;
      const offsetX = 8;

      // Tooltip width can be up to twice the main window width; clamp to a sane maximum
      const tooltipWidth = Math.max(100, Math.min(mainBounds.width * 2, 1600));
      // Tooltip height follows main window height but clamped to a reasonable max
      const tooltipHeight = Math.max(30, Math.min(mainBounds.height, 2000));

      // Determine available space on left and right of the main window within the display work area
      const display = screen.getDisplayMatching(mainBounds);
      const workArea = display ? display.workArea : { x: 0, y: 0, width: 10000, height: 10000 };

      const spaceRight = workArea.x + workArea.width - (mainBounds.x + mainBounds.width);
      const spaceLeft = mainBounds.x - workArea.x;

      // If there's enough room on the right, prefer right; otherwise flip to left
      const placeRight = spaceRight >= tooltipWidth || spaceRight >= spaceLeft;

      const desiredX = placeRight ? (mainBounds.x + mainBounds.width + offsetX) : (mainBounds.x - tooltipWidth - offsetX);
      // Align tooltip top with main window top per user request
      let desiredY = mainBounds.y;

      // Ensure tooltip fits vertically within the workArea
      if (desiredY + tooltipHeight > workArea.y + workArea.height) {
        desiredY = Math.max(workArea.y, workArea.y + workArea.height - tooltipHeight - 10);
      }
      if (desiredY < workArea.y) desiredY = workArea.y + 10;

      // Clamp horizontally to workArea
      let finalX = desiredX;
      if (finalX + tooltipWidth > workArea.x + workArea.width) {
        finalX = workArea.x + workArea.width - tooltipWidth - 10;
      }
      if (finalX < workArea.x) finalX = workArea.x + 10;

      try {
        this.tooltipWindow.setBounds({ x: Math.round(finalX), y: Math.round(desiredY), width: Math.round(tooltipWidth), height: Math.round(tooltipHeight) });
      } catch (err) { }
    } catch (err) {
      // ignore reposition errors
    }
  }

  // 创建主窗口
  createWindow() {
    // 创建浏览器窗口
    this.mainWindow = new BrowserWindow({
      width: 400,
      height: 600,
      show: false, // 默认隐藏
      webPreferences: {
        contextIsolation: true,
        preload: path.join(__dirname, '../preload/index.js')
      }
    });

    // 当用户点击关闭按钮时，隐藏窗口而不是退出应用
    this.mainWindow.on('close', (event) => {
      // 阻止默认的关闭行为
      if (!this.trayManager.ClickQuit) {
        event.preventDefault();
        this.mainWindow.hide();
        safeConsole.log('主窗口已隐藏 (close 事件)');
      } else {
        safeConsole.log('主窗口关闭，应用退出');
      }
    });

    // 当窗口关闭时，取消引用窗口对象（仅在真正退出应用时发生）
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    // 当主窗口失去焦点时（例如用户点击了其他应用），隐藏主窗口以及 tooltip
    this.mainWindow.on('blur', () => {
      try {
        // 如果正在执行粘贴操作，不要隐藏（以避免干扰粘贴流程）
        if (this._isPasting) return;

        // 如果用户已通过托盘请求退出（ClickQuit），不要干预
        if (this.trayManager && this.trayManager.ClickQuit) return;

        try {
          if (this.mainWindow && this.mainWindow.isVisible()) this.mainWindow.hide();
        } catch (_) { }
        try {
          // Notify renderer to reset item selection (set selectIndex -> 0) so next show starts fresh
          try {
            if (this.mainWindow && this.mainWindow.webContents) {
              this.mainWindow.webContents.send('reset-selection');
            }
          } catch (_) { }

          if (this.tooltipWindow && !this.tooltipWindow.isDestroyed()) this.tooltipWindow.hide();
        } catch (_) { }
      } catch (err) {
        // ignore
      }
    });
  }

  // 注册全局快捷键
  registerGlobalShortcuts() {
    // 先注销已注册的快捷键
    if (this._registeredShortcut) {
      globalShortcut.unregister(this._registeredShortcut);
    }

    // 从配置中获取快捷键设置
    // 默认使用 CommandOrControl+Alt+V (Ctrl+Alt+V on Windows/Linux, Cmd+Alt+V on macOS)
    // 这是一个跨平台的剪贴板相关快捷方式，用户可以通过设置界面自定义
    const shortcut = Config.get('globalShortcut') || 'CommandOrControl+Alt+V';
    this._registeredShortcut = shortcut;

    const ret = globalShortcut.register(shortcut, () => {
      // 如果在粘贴的短时间窗口内，抑制快捷键导致的显示/隐藏切换，避免在隐藏后被立即弹出
      if (this._isPasting) {
        safeConsole.log('抑制全局快捷键触发（正在执行粘贴）');
        return;
      }

      safeConsole.log(`全局快捷键 ${shortcut} 被触发`);
      if (this.mainWindow) {
        if (this.mainWindow.isVisible()) {
          this.mainWindow.hide();
        } else {
          this.mainWindow.show();
          // Notify renderer that the global shortcut opened the window so the UI
          // can reset state (clear search and hide search input) and not inherit previous data.
          try {
            if (this.mainWindow.webContents) {
              this.mainWindow.webContents.send('global-shortcut');
            }
          } catch (err) {
            safeConsole.warn('Failed to notify renderer about global shortcut:', err);
          }
        }
      }
    });

    if (!ret) {
      safeConsole.log('全局快捷键注册失败');
    }

    // 检查快捷键是否注册成功
    safeConsole.log('全局快捷键是否注册:', globalShortcut.isRegistered(shortcut));
  }

  // 注册截图快捷键
  registerScreenshotShortcut() {
    // 先注销已注册的截图快捷键
    if (this._registeredScreenshotShortcut) {
      globalShortcut.unregister(this._registeredScreenshotShortcut);
    }

    // 从配置中获取截图快捷键设置
    const shortcut = Config.get('screenshotShortcut') || 'CommandOrControl+Shift+S';
    this._registeredScreenshotShortcut = shortcut;

    const ret = globalShortcut.register(shortcut, () => {
      safeConsole.log(`截图快捷键 ${shortcut} 被触发`);
      if (this.screenshotManager) {
        this.screenshotManager.startScreenshot();
      } else if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('take-screenshot');
      }
    });

    if (!ret) {
      safeConsole.log('截图快捷键注册失败');
    }

    // 检查快捷键是否注册成功
    safeConsole.log('截图快捷键是否注册:', globalShortcut.isRegistered(shortcut));
  }

  // 启动剪贴板监控
  startClipboardMonitoring() {
    // 启动定时器，每秒检查一次剪贴板
    this.clipboardManager.startMonitoring();

    // 添加监听器以通知渲染进程
    this.clipboardManager.addListener((history) => {
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('update-history', history);
      }
    });
  }

  // 设置IPC通信处理
  setupIpcHandlers() {
    // 获取历史记录
    ipcMain.on('get-history', (event) => {
      safeConsole.log('收到获取历史记录请求');
      event.reply('history-data', this.clipboardManager.getHistory());
    });

    // 隐藏窗口
    ipcMain.on('hide-window', () => {
      safeConsole.log('收到隐藏窗口请求');
      if (this.mainWindow) {
        this.mainWindow.hide();
      }
    });

    // settings: get and set
    ipcMain.handle('get-settings', async () => {
      const config = Config.getAll();
      safeConsole.log('获取设置:', config);
      return config;
    });

    ipcMain.handle('set-settings', async (event, values) => {
      safeConsole.log('保存设置:', values);
      try { safeConsole.log('配置文件路径 (Config.configPath):', Config.configPath); } catch (e) { }

      // 获取保存前的旧配置以便比较哪些设置发生了变化
      const oldConfig = Config.getAll();

      // 使用异步 API 持久化配置
      const result = await Config.setMany(values); // { success, config }
      if (!result || result.success !== true) {
        safeConsole.error('Config.setMany 失败，路径:', Config.configPath, '返回:', result);
      }
      const newConfig = result.config || Config.getAll();

      // 计算变更的键
      const changedKeys = Object.keys(values).filter(k => oldConfig[k] !== newConfig[k]);

      // 根据变更执行必要的操作
      try {
        if (changedKeys.includes('globalShortcut')) {
          // 直接调用实例方法，确保 this 上下文正确
          this.registerGlobalShortcuts();
        }
        if (changedKeys.includes('screenshotShortcut')) {
          this.registerScreenshotShortcut();
          // 重新构建菜单以更新快捷键显示
          this.buildAppMenu();
        }
        if (changedKeys.includes('llmShortcut') || changedKeys.includes('llms') || changedKeys.includes('llm')) {
          try { this.registerLlmShortcut(); } catch (err) { safeConsole.warn('registerLlmShortcut failed:', err); }
        }
        if (changedKeys.includes('maxHistoryItems')) {
          // 更新剪贴板管理器的最大历史记录数
          const newMaxHistory = newConfig.maxHistoryItems;
          if (typeof newMaxHistory === 'number' && newMaxHistory > 0) {
            this.clipboardManager.setMaxHistory(newMaxHistory);
            safeConsole.log('更新最大历史记录数为:', newMaxHistory);
          }
        }
      } catch (err) {
        safeConsole.warn('重新注册快捷键时出错:', err);
      }

      // 将变更集与新配置一并发送到渲染进程，若保存失败则包含 error
      try {
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('settings-updated', {
            success: !!result.success,
            changedKeys,
            config: newConfig,
            error: result.error || null
          });
        }
      } catch (err) {
        safeConsole.warn('Failed to send settings-updated to renderer:', err);
      }

      safeConsole.log('设置保存结果:', result.success, '变更键:', changedKeys, '新配置:', newConfig);
      return result; // { success, config }
    });

    // Register LLM shortcut API (exposed to settings changes)
    // This registers a global shortcut that will read current clipboard and invoke LLM stream
    this.registerLlmShortcut = () => {
      // unregister any previously registered per-entry shortcuts
      try {
        if (this._registeredLlmShortcuts && Array.isArray(this._registeredLlmShortcuts)) {
          for (const s of this._registeredLlmShortcuts) {
            try { globalShortcut.unregister(s); } catch (_) { }
          }
        }
      } catch (err) { }
      this._registeredLlmShortcuts = [];

      const llms = Config.get('llms') || {};
      for (const [name, entry] of Object.entries(llms)) {
        try {
          const shortcut = entry && entry.llmShortcut;
          if (!shortcut || String(shortcut).trim() === '') continue;
          const registered = globalShortcut.register(shortcut, async () => {
            safeConsole.log(`LLM 条目 ${name} 快捷键 ${shortcut} 被触发`);
            try {
              // use entry settings to trigger LLM with clipboard
              await this._triggerLlmFromClipboardForEntry(name, entry);
            } catch (err) {
              safeConsole.error('Trigger LLM for entry failed:', err);
            }
          });
          if (registered) this._registeredLlmShortcuts.push(shortcut);
          safeConsole.log(`注册 LLM 条目快捷键 ${name}:`, shortcut, 'ok=', registered);
        } catch (err) {
          safeConsole.warn('注册 LLM 条目快捷键失败:', name, err);
        }
      }
    };

    // Trigger LLM request using current clipboard content
    this._triggerLlmFromClipboard = async () => {
      try {
        // detect text or image on clipboard
        const formats = clipboard.availableFormats();
        let input = '';
        let inputType = 'text';
        if (formats.includes('text/plain')) {
          input = clipboard.readText();
          inputType = 'text';
        } else if (formats.includes('image/png') || formats.includes('image/jpeg')) {
          const img = clipboard.readImage();
          if (!img.isEmpty()) {
            input = img.toDataURL();
            inputType = 'image';
          }
        }

        // call llm using saved config and stream back to renderer
        // fallback: if there's a default single llm configured, use it (back-compat)
        const cfg = Config.getAll();
        const llms = cfg.llms || {};
        const names = Object.keys(llms || {});
        if (names.length === 0) {
          // try legacy llm
          const llmCfg = cfg.llm || {};
          const apitype = llmCfg.apitype || 'ollama';
          const baseurl = llmCfg.baseurl;
          const model = llmCfg.model;
          const apikey = llmCfg.apikey;
          const params = llmCfg;
          const fakeEvent = { sender: this.mainWindow && this.mainWindow.webContents };
          if (apitype === 'ollama') {
            await this._callOllamaStream(fakeEvent, { baseurl, model, apikey, params, input });
          } else {
            await this._callOpenApiStream(fakeEvent, { baseurl, model, apikey, params, input });
          }
          return;
        }
        // Multiple entries exist: by default trigger the first one
        const firstName = names[0];
        const entry = llms[firstName];
        await this._triggerLlmFromClipboardForEntry(firstName, entry, input);
      } catch (err) {
        safeConsole.error('LLM trigger error:', err);
        try { if (this.mainWindow && this.mainWindow.webContents) this.mainWindow.webContents.send('llm-complete', { success: false, error: err.message }); } catch (_) { }
      }
    };

    // Trigger for a named entry using its entry config
    this._triggerLlmFromClipboardForEntry = async (name, entry, explicitInput) => {
      try {
        let input = explicitInput;
        if (typeof input === 'undefined') {
          const formats = clipboard.availableFormats();
          if (formats.includes('text/plain')) {
            input = clipboard.readText();
          } else if (formats.includes('image/png') || formats.includes('image/jpeg')) {
            const img = clipboard.readImage();
            if (!img.isEmpty()) input = img.toDataURL();
          }
        }

        if (!entry) throw new Error('LLM 条目不存在');
        const apitype = entry.apitype || 'ollama';
        const baseurl = entry.baseurl;
        const model = entry.model;
        const apikey = entry.apikey;
        const params = entry;

        const fakeEvent = { sender: this.mainWindow && this.mainWindow.webContents };
        if (apitype === 'ollama') {
          await this._callOllamaStream(fakeEvent, { baseurl, model, apikey, params, input });
        } else {
          await this._callOpenApiStream(fakeEvent, { baseurl, model, apikey, params, input });
        }
      } catch (err) {
        safeConsole.error('Trigger LLM entry failed:', name, err);
        try { if (this.mainWindow && this.mainWindow.webContents) this.mainWindow.webContents.send('llm-complete', { success: false, error: err.message }); } catch (_) { }
      }
    };

    // LLM request handler - supports streaming tokens back to renderer
    ipcMain.handle('llm-request', async (event, payload) => {
      try {
        const cfg = Config.getAll();
        const llmCfg = cfg.llm || {};
        const apitype = (payload && payload.apitype) || llmCfg.apitype || 'ollama';
        const baseurl = (payload && payload.baseurl) || llmCfg.baseurl || '';
        const model = (payload && payload.model) || llmCfg.model || '';
        const apikey = (payload && payload.apikey) || llmCfg.apikey || '';
        const params = Object.assign({}, llmCfg, payload.params || {});

        // choose implementation
        if (apitype === 'ollama') {
          await this._callOllamaStream(event, { baseurl, model, apikey, params, input: payload.input });
        } else {
          await this._callOpenApiStream(event, { baseurl, model, apikey, params, input: payload.input });
        }

        return { success: true };
      } catch (err) {
        safeConsole.error('llm-request failed:', err);
        try { event.sender.send('llm-complete', { success: false, error: err.message }); } catch (_) { }
        return { success: false, error: err.message };
      }
    });

    // 粘贴项目
    ipcMain.on('paste-item', (event, item) => {
      const now = Date.now();
      safeConsole.log('粘贴项目:', item);

      // 简单去重：如果同一个 item 在短时间内重复触发，则忽略
      if (item && item.id && this._lastPaste.id === item.id && (now - this._lastPaste.time) < 1000) {
        safeConsole.log('忽略重复粘贴请求:', item.id);
        return;
      }

      // 如果已有粘贴在进行中，则忽略新的快速触发，避免并发写剪贴板/执行粘贴
      if (this._pasteLock) {
        safeConsole.log('已有粘贴进行中，忽略新的粘贴请求');
        return;
      }

      // 标记为正在粘贴并记录id/time
      this._pasteLock = true;
      if (item && item.id) this._lastPaste = { id: item.id, time: now };

      try {
        // 在执行粘贴前先隐藏主窗口，这样粘贴会发送到打开窗口之前的应用/编辑器
        if (this.mainWindow && this.mainWindow.isVisible()) {
          this.mainWindow.hide();
          safeConsole.log('主窗口已隐藏 (准备粘贴)');
        }

        // 抑制短时间内任何会显示主窗口的自动行为（比如全局快捷键或托盘单击触发的切换），
        // 避免隐藏后立刻被重新弹出。将抑制状态也写到窗口对象上，供托盘逻辑检查。
        this._isPasting = true;
        setTimeout(() => {
          this._isPasting = false;
        }, 200);

        // 等待一小段时间以确保焦点切换回前一个应用
        setTimeout(() => {
          // 写入剪贴板并执行粘贴
          PasteHandler.writeAndPaste(item)
            .then(() => {
              safeConsole.log('粘贴操作完成');
              this._pasteLock = false;
              this._isPasting = false;
            })
            .catch((error) => {
              safeConsole.error('粘贴操作失败:', error);
              this._pasteLock = false;
              this._isPasting = false;
              // 发送错误信息到渲染进程
              if (this.mainWindow && this.mainWindow.webContents) {
                this.mainWindow.webContents.send('error', error.message);
              }
            });
        }, 50);
      } catch (error) {
        safeConsole.error('粘贴项目时出错:', error);
        this._pasteLock = false;
        // 发送错误信息到渲染进程
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('error', error.message);
        }
      }
    });

    // Tooltip control from renderer: show/hide/update
    ipcMain.on('show-tooltip', (_event, payload) => {
      try {
        // Respect global enableTooltips config: do not show if disabled
        const cfg = Config.getAll();
        if (cfg && cfg.enableTooltips === false) return;
        // Do not show tooltip if there's no main window or it's not visible
        if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.mainWindow.isVisible() || this._isPasting) {
          // skip showing tooltip when main window is hidden, destroyed, or during paste
          return;
        }

        this.createTooltipWindow();
        if (!this.tooltipWindow) return;

        const { content = '', anchorRect = {}, html: isHtml = false } = payload || {};
        this.tooltipPayload = { content, anchorRect };

        // If the renderer requested HTML payload, trust it but still restrict via CSP
        let pageHtml;
        if (isHtml) {
          // Inline any file:// URLs into data: URLs so the tooltip (loaded via data: URL)
          // can render them without cross-origin/file protocol restrictions.
          try {
            // find file://... occurrences in the content and replace with data URLs
            const fileUrlRegex = /src=\"file:\/\/([^\"']+)\"/g;
            let replaced = String(content);
            let match;
            while ((match = fileUrlRegex.exec(content)) !== null) {
              try {
                const filePath = '/' + match[1].replace(/^\/+/, ''); // normalize leading slash
                if (fs.existsSync(filePath)) {
                  const buf = fs.readFileSync(filePath);
                  const ext = path.extname(filePath).toLowerCase();
                  let mime = 'image/png';
                  if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
                  else if (ext === '.gif') mime = 'image/gif';
                  else if (ext === '.webp') mime = 'image/webp';
                  else if (ext === '.svg') mime = 'image/svg+xml';
                  const b64 = buf.toString('base64');
                  const dataUrl = `data:${mime};base64,${b64}`;
                  replaced = replaced.replace(match[0], `src=\"${dataUrl}\"`);
                }
              } catch (err) {
                // ignore replacement errors and keep original src
              }
            }

            // Build tooltip HTML without requiring node inside the page. Inject main window
            // dimensions as CSS variables so content can cap its size relative to the
            // main window (max-width = 2 * mainWidth, max-height = mainHeight).
            const mainBounds = this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow.getBounds() : { width: 400, height: 600 };
            const mainWidth = Math.max(100, Math.round(mainBounds.width));
            const mainHeight = Math.max(100, Math.round(mainBounds.height));
            pageHtml = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline';"><style>:root{--main-width:${mainWidth}px;--main-height:${mainHeight}px;}html,body{margin:0;background:transparent;} .box{background:rgba(0,0,0,0.85);color:#fff;padding:12px;border-radius:6px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial;max-width:calc(var(--main-width) * 2);max-height:var(--main-height);overflow:auto;line-height:1.4;white-space:normal;word-break:break-word;box-sizing:border-box;}</style></head><body><div class="box" id="box">${replaced}</div></body></html>`;
          } catch (err) {
            // fallback to raw content if replacement fails
            const mainBounds = this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow.getBounds() : { width: 400, height: 600 };
            const mainWidth = Math.max(100, Math.round(mainBounds.width));
            const mainHeight = Math.max(100, Math.round(mainBounds.height));
            pageHtml = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline';"><style>:root{--main-width:${mainWidth}px;--main-height:${mainHeight}px;}html,body{margin:0;background:transparent;} .box{background:rgba(0,0,0,0.85);color:#fff;padding:12px;border-radius:6px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial;max-width:calc(var(--main-width) * 2);max-height:var(--main-height);overflow:auto;line-height:1.4;white-space:normal;word-break:break-word;box-sizing:border-box;}</style></head><body><div class="box" id="box">${String(content)}</div></body></html>`;
          }
        } else {
          // sanitized text-only payload
          const safeContent = String(content)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
          const mainBounds = this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow.getBounds() : { width: 400, height: 600 };
          const mainWidth = Math.max(100, Math.round(mainBounds.width));
          const mainHeight = Math.max(100, Math.round(mainBounds.height));
          pageHtml = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>:root{--main-width:${mainWidth}px;--main-height:${mainHeight}px;}html,body{margin:0;background:transparent;} .box{background:rgba(0,0,0,0.85);color:#fff;padding:12px;border-radius:6px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial;max-width:calc(var(--main-width) * 2);max-height:var(--main-height);overflow:auto;line-height:1.4;white-space:pre-wrap;word-break:break-word;box-sizing:border-box;}</style></head><body><div class="box" id="box">${safeContent}</div></body></html>`;
        }

        // Use loadURL with data URL
        this.tooltipWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pageHtml));

        // When the tooltip's webContents finish loading, attempt to measure content but
        // ultimately size the tooltip to match the main window dimensions.
        this.tooltipWindow.webContents.once('did-finish-load', () => {
          try {
            // Ask for size by executing JavaScript to compute content size (kept for compatibility)
            this.tooltipWindow.webContents.executeJavaScript(`(function(){const el=document.getElementById('box'); if(!el) return {w:300,h:50}; const r=el.getBoundingClientRect(); ({w:Math.ceil(r.width), h:Math.ceil(r.height)});})()`)
              .then((size) => {
                // store measured content size but override tooltip size with main window size
                this.tooltipSize = { w: size.w + 8, h: size.h + 8 };
                // Reposition will use mainWindow size to set the tooltip bounds
                this.repositionTooltip();
                try { this.tooltipWindow.showInactive(); } catch (err) { this.tooltipWindow.show(); }
              })
              .catch((err) => {
                // fallback: still set tooltipSize but reposition uses main window
                this.tooltipSize = { w: 420, h: 120 };
                this.repositionTooltip();
                try { this.tooltipWindow.showInactive(); } catch (err) { this.tooltipWindow.show(); }
              });
          } catch (err) {
            try { this.tooltipWindow.showInactive(); } catch (err) { this.tooltipWindow.show(); }
          }
        });
      } catch (err) {
        safeConsole.error('show-tooltip 处理失败:', err);
      }
    });

    ipcMain.on('hide-tooltip', () => {
      try {
        if (this.tooltipWindow && !this.tooltipWindow.isDestroyed()) this.tooltipWindow.hide();
      } catch (err) { }
    });

    // 截图相关功能
    ipcMain.handle('start-screenshot', async () => {
      try {
        if (!this.screenshotManager) {
          this.screenshotManager = new ScreenshotManager(this.mainWindow, this.clipboardManager);
        }
        this.screenshotManager.startScreenshot();
        return { success: true };
      } catch (error) {
        safeConsole.error('启动截图失败:', error);
        return { success: false, error: error.message };
      }
    });
  }

  // 初始化应用
  initialize() {
    // 在初始化时强制从磁盘读取最新配置，保证使用磁盘上的设置
    try {
      Config.getAll(true);
    } catch (err) {
      safeConsole.warn('在初始化时重新加载配置失败:', err);
    }

    // 保存当前快照以便后续检测外部变更
    try {
      this._lastConfigSnapshot = Config.getAll();
    } catch (err) {
      this._lastConfigSnapshot = null;
    }

    this.createWindow();
    this.trayManager.createTray(this.mainWindow, this);
    // Setup IPC handlers early so helper methods like registerLlmShortcut are defined
    this.setupIpcHandlers();
    this.registerGlobalShortcuts();
    this.registerScreenshotShortcut();
    // register optional LLM shortcut from config (defined inside setupIpcHandlers)
    try { this.registerLlmShortcut(); } catch (err) { safeConsole.warn('registerLlmShortcut during init failed:', err); }
    this.startClipboardMonitoring();
    // 构建应用顶部菜单（将截图/设置从主窗口移到菜单）
    this.buildAppMenu();
  }

  // Helper: simple fetch using node's https/http (avoid new deps). Returns response stream
  async _simpleFetch(url, options = {}) {
    // prefer undici if available for nicer streaming, otherwise use native http/https
    let undici;
    try { undici = require('undici'); } catch (_) { undici = null; }
    if (undici && undici.fetch) {
      return undici.fetch(url, options);
    }

    // fallback to node's http/https
    const { URL } = require('url');
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? require('https') : require('http');

    return new Promise((resolve, reject) => {
      const req = lib.request(url, {
        method: options.method || 'GET',
        headers: options.headers || {}
      }, (res) => {
        resolve(res);
      });
      req.on('error', reject);
      if (options.body) {
        if (typeof options.body === 'string' || Buffer.isBuffer(options.body)) req.write(options.body);
        else req.write(JSON.stringify(options.body));
      }
      req.end();
    });
  }

  // Parse streaming response (SSE-like or newline-delimited) and emit 'llm-stream' events
  async _streamResponseToRenderer(event, res) {
    try {
      const sender = event && event.sender;
      if (!res || !res.body) return;

      // If using undici Response, res.body is a ReadableStream (whatwg). Convert if needed.
      if (res.body.getReader) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        let buffer = '';
        while (!done) {
          const r = await reader.read();
          done = r.done;
          if (r.value) {
            buffer += decoder.decode(r.value, { stream: true });
            // split by newline
            let idx;
            while ((idx = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, idx).trim();
              buffer = buffer.slice(idx + 1);
              if (!line) continue;
              try {
                // if SSE: lines like 'data: {...}'
                if (line.startsWith('data:')) {
                  const json = line.replace(/^data:\s*/, '');
                  sender.send('llm-stream', json);
                } else {
                  sender.send('llm-stream', line);
                }
              } catch (err) { }
            }
          }
        }
        if (buffer && buffer.trim()) {
          try { sender.send('llm-stream', buffer.trim()); } catch (_) { }
        }
        try { sender.send('llm-complete', { success: true }); } catch (_) { }
        return;
      }

      // Node.js stream
      const stream = res;
      stream.setEncoding && stream.setEncoding('utf8');
      let acc = '';
      stream.on('data', (chunk) => {
        try {
          const s = String(chunk);
          acc += s;
          // try to split into lines
          const parts = acc.split(/\r?\n/);
          acc = parts.pop();
          for (const p of parts) {
            const line = p.trim();
            if (!line) continue;
            // SSE style
            if (line.startsWith('data:')) {
              const json = line.replace(/^data:\s*/, '');
              try { event.sender.send('llm-stream', json); } catch (_) { }
            } else {
              try { event.sender.send('llm-stream', line); } catch (_) { }
            }
          }
        } catch (err) { }
      });
      stream.on('end', () => {
        try { event.sender.send('llm-complete', { success: true }); } catch (_) { }
      });
      stream.on('error', (err) => {
        try { event.sender.send('llm-complete', { success: false, error: err && err.message }); } catch (_) { }
      });
    } catch (err) {
      try { event.sender.send('llm-complete', { success: false, error: err && err.message }); } catch (_) { }
    }
  }

  // Call Ollama server (assumes /chat/completions streaming or /api ...). Basic implementation supporting streaming text
  async _callOllamaStream(event, { baseurl, model, apikey, params, input }) {
    if (!baseurl) baseurl = 'http://localhost:11434';
    // Ollama's streaming chat endpoint: POST /api/generate or /chat/completions depending on version
    const url = `${baseurl.replace(/\/$/, '')}/api/generate`;
    const body = {
      model: model,
      prompt: params.prompt || input || '',
      // map parameters
      temperature: params.temperature,
      top_p: params.top_p,
      top_k: params.top_k,
      max_tokens: params.max_tokens
    };
    const headers = { 'Content-Type': 'application/json' };
    if (apikey) headers['Authorization'] = `Bearer ${apikey}`;

    const res = await this._simpleFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    await this._streamResponseToRenderer(event, res);
  }

  // Call OpenAPI-compatible streaming (e.g., OpenAI chat completions) using streaming=true
  async _callOpenApiStream(event, { baseurl, model, apikey, params, input }) {
    if (!baseurl) throw new Error('OpenAPI baseurl not configured');
    const url = `${baseurl.replace(/\/$/, '')}/v1/chat/completions`;
    const payload = {
      model: model,
      messages: [{ role: 'user', content: params.prompt || input || '' }],
      temperature: params.temperature,
      top_p: params.top_p,
      stream: true,
      max_tokens: params.max_tokens
    };
    const headers = { 'Content-Type': 'application/json' };
    if (apikey) headers['Authorization'] = `Bearer ${apikey}`;

    const res = await this._simpleFetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    await this._streamResponseToRenderer(event, res);
  }



  // 构建应用菜单并挂载行为
  buildAppMenu() {
    try {
      // 从配置中获取实际的截图快捷键
      const screenshotShortcut = Config.get('screenshotShortcut') || 'CommandOrControl+Shift+S';

      const template = [
        {
          label: '功能',
          submenu: [
            {
              label: '截图',
              accelerator: screenshotShortcut, // 使用配置中的实际快捷键
              click: () => {
                safeConsole.log('菜单: 截图 被点击');
                // 如果主进程已有 screenshotManager，直接触发；否则让渲染进程处理
                if (this.screenshotManager) {
                  this.screenshotManager.startScreenshot();
                } else if (this.mainWindow && this.mainWindow.webContents) {
                  this.mainWindow.webContents.send('take-screenshot');
                }
              }
            },
            {
              label: '设置',
              accelerator: 'CmdOrCtrl+,',
              click: () => {
                safeConsole.log('菜单: 设置 被点击');
                if (this.mainWindow && this.mainWindow.webContents) {
                  this.mainWindow.webContents.send('open-settings');
                }
              }
            },
            {
              label: 'Toggle Developer Tools',
              accelerator: 'CmdOrCtrl+Shift+I',
              click: () => {
                safeConsole.log('菜单: Toggle Developer Tools 被点击');
                if (this.mainWindow) {
                  this.mainWindow.webContents.toggleDevTools();
                }
              }
            }
          ]
        },
      ];

      const menu = Menu.buildFromTemplate(template);
      Menu.setApplicationMenu(menu);
      safeConsole.log('应用菜单已构建');
    } catch (error) {
      safeConsole.error('构建应用菜单失败:', error);
    }
  }

  // 清理资源
  cleanup() {
    // 清理资源
    if (this._registeredShortcut) {
      globalShortcut.unregister(this._registeredShortcut);
    }
    if (this._registeredScreenshotShortcut) {
      globalShortcut.unregister(this._registeredScreenshotShortcut);
    }
    globalShortcut.unregisterAll();
    this.clipboardManager.stopMonitoring();
    this.trayManager.destroyTray();

    // 关闭配置文件监控
    if (this._configWatcher) {
      try { this._configWatcher.close(); } catch (_) { }
      this._configWatcher = null;
    }
    if (this._configWatchTimer) {
      try { clearTimeout(this._configWatchTimer); } catch (_) { }
      this._configWatchTimer = null;
    }

    // 在退出应用时关闭主窗口
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // 移除close事件监听器，避免隐藏行为干扰退出
      this.mainWindow.removeAllListeners('close');
      this.mainWindow.close();
    }
  }
}

module.exports = MainProcess;


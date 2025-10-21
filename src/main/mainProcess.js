const { BrowserWindow, globalShortcut, ipcMain, desktopCapturer, Menu, screen, clipboard, Notification } = require('electron');
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
    // map of shortcut -> llmName for registered LLM shortcuts
    this._registeredLlmShortcuts = {};
    // Map of webContents.id -> chatConfig for ai windows (used by IPC invoke)
    this._aiWindowConfigs = new Map();
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

    // Also register per-LLM shortcuts defined in config.llms
    try {
      this.registerLlmShortcuts();
    } catch (err) {
      safeConsole.warn('注册 LLM 快捷键失败:', err);
    }
  }

  // Register shortcuts for configured LLM entries (each entry may specify llmShortcut)
  registerLlmShortcuts() {
    // Unregister previously registered LLM shortcuts
    for (const sc of Object.keys(this._registeredLlmShortcuts || {})) {
      try { globalShortcut.unregister(sc); } catch (_) { }
    }
    this._registeredLlmShortcuts = {};

    const cfg = Config.getAll();
    const llms = (cfg && cfg.llms) || {};
    for (const [name, entry] of Object.entries(llms)) {
      if (!entry || !entry.llmShortcut) continue;
      const shortcut = String(entry.llmShortcut).trim();
      if (!shortcut) continue;

      try {
        const ok = globalShortcut.register(shortcut, async () => {
          safeConsole.log(`LLM 快捷键 ${shortcut} (name=${name}) 被触发`);
          const trigger = (entry.triggerType || 'text').toString().toLowerCase();
          // get selected text from clipboard PRIMARY selection if available
          let selectedText = '';
          try {
            // Try electron clipboard selection (Linux PRIMARY)
            selectedText = clipboard.readText('selection') || '';
          } catch (e) {
            selectedText = '';
          }

          // fallback to clipboard default if nothing in selection
          if (!selectedText) {
            try { selectedText = clipboard.readText() || ''; } catch (e) { selectedText = ''; }
          }

          // Decide behavior based on trigger type
          let prompt = (entry.prompt || '') + '';
          let initialImages = undefined;

          if (trigger === 'image') {
            // Ensure screenshotManager exists
            if (!this.screenshotManager) this.screenshotManager = new ScreenshotManager(this.mainWindow, this.clipboardManager);
            safeConsole.log(`LLM flow (name=${name}): trigger=image; prompt(before)="${String(prompt).slice(0, 120)}"; selectedTextLength=${String(selectedText || '').length}`);
            try {
              const img = await this.screenshotManager.captureImage();
              safeConsole.log(`LLM flow (name=${name}): captureImage resolved: base64Full length=${img && img.base64Full ? img.base64Full.length : 0}`);
              // initialImages is an array of { base64Full, base64Raw }
              initialImages = [img];
              // Substitute known placeholders with the selected text
              if (prompt && typeof prompt === 'string') {
                // support both English/short placeholder {{text}} and the previous Chinese variant
                prompt = prompt.replace(/{{\s*text\s*}}/gi, selectedText || '');
                prompt = prompt.replace(/{{\s*鼠标正在选择的文本\s*}}/g, selectedText || '');
              }
              safeConsole.log(`LLM flow (name=${name}): prompt(after)="${String(prompt).slice(0, 120)}"; initialImagesCount=${initialImages.length}`);
            } catch (err) {
              safeConsole.error('捕获截图失败:', err);
              // fallback to text flow
              if (!prompt || !prompt.trim()) prompt = `Summarize ${selectedText || ''}`.trim();
            }
          } else {
            safeConsole.log(`LLM flow (name=${name}): trigger=text; prompt(before)="${String(prompt).slice(0, 120)}"; selectedTextLength=${String(selectedText || '').length}`);
            // text flow: substitute selected text into prompt
            if (prompt && typeof prompt === 'string') {
              prompt = prompt.replace(/{{\s*text\s*}}/gi, selectedText || '');
              prompt = prompt.replace(/{{\s*鼠标正在选择的文本\s*}}/g, selectedText || '');
            }
            if (!prompt || !prompt.trim()) {
              prompt = `Summarize ${selectedText || ''}`.trim();
            }
            safeConsole.log(`LLM flow (name=${name}): prompt(after)="${String(prompt).slice(0, 120)}"`);
          }

          // Open chat window with entry config, including prompt and initialImages if any
          try {
            const cfg = Object.assign({}, entry, { prompt });
            if (initialImages) cfg.initialImages = initialImages;

            safeConsole.log(`LLM flow (name=${name}): opening chat window with cfg: llmKey=${name}, apiType=${cfg.apitype || cfg.apitype}, promptLen=${String(cfg.prompt || '').length}, initialImages=${cfg.initialImages ? cfg.initialImages.length : 0}`);
            this.openLlmChatWindow(name, cfg);
          } catch (err) {
            safeConsole.error('打开 LLM 窗口失败:', err);
          }
        });

        if (ok) {
          this._registeredLlmShortcuts[shortcut] = name;
        } else {
          safeConsole.warn('无法注册 LLM 快捷键:', shortcut);
        }
      } catch (err) {
        safeConsole.warn('注册 LLM 快捷键时出现异常:', err);
      }
    }
  }

  // Open a dedicated chat window for a named LLM entry, injecting config
  openLlmChatWindow(llmName, llmEntry) {
    try {
      // Create a small BrowserWindow for chat UI
      const initialTitle = `Chat Window (${llmName})`;
      const chatWin = new BrowserWindow({
        width: 640,
        height: 600,
        show: true,
        title: initialTitle,
        webPreferences: {
          contextIsolation: true,
          preload: path.join(__dirname, '../preload/ai-preload.js')
        }
      });

      // Remove default application menu for this window so users cannot toggle alwaysOnTop from a menu
      try { chatWin.setMenu(null); } catch (e) { /* ignore */ }

      // Open devtools by default for debugging convenience
      try { chatWin.webContents.openDevTools({ mode: 'detach' }); } catch (e) { /* ignore */ }

      // Set native window title to include the LLM key (e.g., "Chat Window (测试)")
      try { chatWin.setTitle(`Chat Window (${llmName})`); } catch (e) { /* ignore */ }

      // Build chatConfig object expected by chatPage.html
      // Do not rely on an injected title; instead provide llmKey so the page
      // can render a fixed "Chat Window" label and append the llm key in ()
      const chatConfig = {
        llmKey: llmName,
        api: {
          type: llmEntry.apitype || 'ollama',
          model: llmEntry.model || '',
          baseUrl: llmEntry.baseurl || llmEntry.baseUrl || '',
          apiKey: llmEntry.apikey || llmEntry.apiKey || ''
        },
        initialPrompt: llmEntry.prompt || '',
        llmParams: {
          temperature: typeof llmEntry.temperature !== 'undefined' ? llmEntry.temperature : 0.7,
          top_p: typeof llmEntry.top_p !== 'undefined' ? llmEntry.top_p : 0.95,
          top_k: typeof llmEntry.top_k !== 'undefined' ? llmEntry.top_k : 0.9,
          context_window: typeof llmEntry.context_window !== 'undefined' ? llmEntry.context_window : 32768,
          max_tokens: typeof llmEntry.max_tokens !== 'undefined' ? llmEntry.max_tokens : 32768,
          presence_penalty: typeof llmEntry.presence_penalty !== 'undefined' ? llmEntry.presence_penalty : 1.0
        }
      };

      // Allow caller to override prompt by passing a prompt in llmEntry object
      if (llmEntry && llmEntry.prompt) chatConfig.initialPrompt = llmEntry.prompt;
      // If caller provided initialImages (e.g., from screenshot capture), forward them
      if (llmEntry && Array.isArray(llmEntry.initialImages) && llmEntry.initialImages.length > 0) {
        try { chatConfig.initialImages = llmEntry.initialImages.slice(); } catch (e) { /* ignore */ }
      }

      // Load chat page and then send the chatConfig via a secure IPC channel
      const fileUrl = `file://${path.join(__dirname, 'ai', 'chatPage.html')}`;
      chatWin.loadURL(fileUrl);

      // Store config keyed by webContents id so the renderer can request it via invoke
      try {
        const wcId = chatWin.webContents.id;
        this._aiWindowConfigs.set(String(wcId), chatConfig);
      } catch (e) { /* ignore */ }

      // After the page finishes loading, re-apply the title to guard against page overrides
      chatWin.webContents.once('did-finish-load', () => {
        try {
          const fullTitle = `Chat Window (${llmName})`;
          try { chatWin.setTitle(fullTitle); } catch (e) { /* ignore */ }
          try { chatWin.webContents.executeJavaScript(`document.title = ${JSON.stringify(fullTitle)}`); } catch (e) { /* ignore */ }
          // Also proactively push the injected chat config to the renderer via an IPC message
          // This avoids race conditions where the renderer might call ai-get-config too early
          // or the preload/invoke path fails for timing reasons. The chat page listens for
          // 'injected-config' and will merge/apply it when received.
          try {
            chatWin.webContents.send('injected-config', chatConfig);
          } catch (e) {
            safeConsole.warn('Failed to send injected-config to chat window:', e);
          }
        } catch (err) {
          // ignore any errors when setting titles
        }
      });

      // Clean up stored config when window closes
      try {
        const storedWcId = String(chatWin.webContents.id);
        chatWin.on('closed', () => {
          try { this._aiWindowConfigs.delete(storedWcId); } catch (e) { /* ignore */ }
        });
      } catch (e) {
        chatWin.on('closed', () => { /* no-op */ });
      }

      return chatWin;
    } catch (err) {
      safeConsole.error('openLlmChatWindow 错误:', err);
      throw err;
    }
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

    // Provide ai window config via invoke: renderer calls ipcRenderer.invoke('ai-get-config')
    ipcMain.handle('ai-get-config', async (event) => {
      try {
        const wcId = String(event.sender.id);
        const cfg = this._aiWindowConfigs.get(wcId) || null;
        // Optionally remove after first read to avoid stale memory
        // this._aiWindowConfigs.delete(wcId);
        return cfg;
      } catch (e) {
        safeConsole.warn('ai-get-config 处理失败:', e);
        return null;
      }
    });

    // NOTE: system notifications removed; chat window will use internal UI notifications only

    ipcMain.handle('set-settings', async (event, values) => {
      safeConsole.log('保存设置 (原始):', values);
      try { safeConsole.log('配置文件路径 (Config.configPath):', Config.configPath); } catch (e) { }

      // 规范化传入的配置：确保每个 llms 条目包含 triggerType（默认 'text'），
      // 避免渲染器未包含该字段导致主进程/磁盘上缺失。
      const toSave = { ...values };
      try {
        if (toSave.llms && typeof toSave.llms === 'object') {
          const normalized = {};
          for (const [name, entry] of Object.entries(toSave.llms)) {
            if (!entry || typeof entry !== 'object') {
              normalized[name] = entry;
              continue;
            }
            const copy = { ...entry };
            // 如果没有显式设置 triggerType，则默认使用 'text'
            if (!('triggerType' in copy) || copy.triggerType === null || typeof copy.triggerType === 'undefined' || String(copy.triggerType).trim() === '') {
              copy.triggerType = 'text';
            }
            normalized[name] = copy;
          }
          toSave.llms = normalized;
        }
      } catch (err) {
        safeConsole.warn('规范化 llms 条目时出错，继续使用原始值:', err);
      }

      // 获取保存前的旧配置以便比较哪些设置发生了变化
      const oldConfig = Config.getAll();

      // 使用异步 API 持久化配置（使用规范化后的 toSave）
      const result = await Config.setMany(toSave); // { success, config }
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
        if (changedKeys.includes('llms') || changedKeys.includes('_selectedLlm')) {
          try { this.registerLlmShortcuts(); } catch (e) { safeConsole.warn('更新 LLM 快捷键失败:', e); }
        }
        if (changedKeys.includes('screenshotShortcut')) {
          this.registerScreenshotShortcut();
          // 重新构建菜单以更新快捷键显示
          this.buildAppMenu();
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
    this.setupIpcHandlers();
    this.registerGlobalShortcuts();
    this.registerScreenshotShortcut();
    this.startClipboardMonitoring();
    // 构建应用顶部菜单（将截图/设置从主窗口移到菜单）
    this.buildAppMenu();
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


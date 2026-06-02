const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, Menu, screen, clipboard, Notification, dialog } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');
const ClipboardManager = require('./clipboardManager');
const TrayManager = require('./trayManager');
const PasteHandler = require('./pasteHandler');
const ScreenshotManager = require('./screenshotManager');
const Config = require('./config');
const ocrService = require('./ocrService');
const resourceManager = require('./core/resourceManager');
const { extractQRCodes } = require('./qrcodeService');
const {
  getDefaultVisionActions,
  normalizeVisionActions
} = require('../shared/visionActions.cjs');

// 安全的console包装器，防止EPIPE错误
// Use DEBUG flag to control verbose logging. Default false in production.
const DEBUG = false;
const safeConsole = {
  log: (...args) => {
    if (!DEBUG) return; // silence non-essential logs by default
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
  },
  debug: (...args) => {
    if (!DEBUG) return; // silence debug logs by default
    try {
      if (process.stdout.writable) {
        console.log('[DEBUG]', ...args);
      }
    } catch (error) {
      // 静默忽略EPIPE错误
    }
  }
};

const OCR_LANGUAGE_SHORT_LABELS = {
  chi_sim: '简体中文',
  chi_tra: '繁体中文',
  eng: 'English',
  jpn: '日本語',
  kor: '한국어',
  deu: 'Deutsch',
  fra: 'Français',
  spa: 'Español',
  por: 'Português',
  ita: 'Italiano',
  rus: 'Русский',
  ara: 'العربية',
  vie: 'Tiếng Việt',
  tha: 'ไทย',
  nld: 'Nederlands',
  pol: 'Polski'
};

const DEFAULT_VISION_LLM_CONFIG = {
  apitype: 'ollama',
  model: 'qwen3.6-vl:4b',
  baseurl: 'http://localhost:11434',
  apikey: '',
  temperature: 1,
  top_p: 0.95,
  top_k: 20,
  context_window: 131072,
  max_tokens: 32768,
  presence_penalty: 1.0
};

const AI_WINDOW_PAGES = new Set(['chatPage.html', 'visionPage.html']);

class MainProcess {
  constructor() {
    this.mainWindow = null;
    this.tooltipWindow = null;
    this.tooltipPayload = null;
    this.tooltipSize = null;
    this.ocrWindow = null;
    this.ocrSettingsWindow = null;
    this._ocrWindowState = null;
    this._ocrImageTokens = new Map();
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

    // X11连接状态监控
    this._x11ConnectionCount = 0;
    this._x11ConnectionMonitoring = false;
    this._lastActiveWindowId = '';
  }

  captureActiveWindowId(reason = '') {
    if (process.platform !== 'linux') return;
    exec('xdotool getactivewindow', (error, stdout) => {
      if (error || !stdout) return;
      const windowId = String(stdout).trim();
      if (windowId) {
        this._lastActiveWindowId = windowId;
        safeConsole.log('记录活动窗口:', windowId, reason ? `(${reason})` : '');
      }
    });
  }

  // Validate shortcut string to ensure it contains at least one modifier key
  validateShortcut(shortcut) {
    if (!shortcut || typeof shortcut !== 'string') {
      return false;
    }

    const modifiers = ['Ctrl', 'Alt', 'Shift', 'Meta', 'CommandOrControl', 'CmdOrCtrl'];
    const upperShortcut = shortcut.toUpperCase();

    // Check if the shortcut contains at least one modifier
    return modifiers.some(modifier => upperShortcut.includes(modifier.toUpperCase()));
  }

  createTooltipWindow() {
    if (this.tooltipWindow && !this.tooltipWindow.isDestroyed()) return;

    try {
      this.tooltipWindow = new BrowserWindow({
        width: 720,
        height: 360,
        show: false,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        focusable: false,
        skipTaskbar: true,
        transparent: true,
        hasShadow: true,
        parent: this.mainWindow || undefined,
        modal: false,
        webPreferences: {
          contextIsolation: true,
        }
      });

      try {
        this.tooltipWindow.setIgnoreMouseEvents(true, { forward: true });
      } catch (_) {
        try { this.tooltipWindow.setIgnoreMouseEvents(true); } catch (_) { }
      }

      if (resourceManager) {
        resourceManager.registerX11Resource('tooltipWindow', this.tooltipWindow);
      }

      this.tooltipWindow.on('closed', () => {
        this.tooltipWindow = null;
        if (resourceManager) {
          try { resourceManager.unregisterResource('tooltipWindow'); } catch (_) { }
        }
      });
    } catch (err) {
      safeConsole.error('创建 tooltip 窗口失败:', err);
      this.tooltipWindow = null;
    }
  }

  hideTooltipWindow(resetPayload = true) {
    try {
      if (resetPayload) this.tooltipPayload = null;
      this.tooltipSize = null;
      this._tooltipSeq = (this._tooltipSeq || 0) + 1;
      if (this.tooltipWindow && !this.tooltipWindow.isDestroyed()) {
        this.tooltipWindow.hide();
      }
    } catch (err) {
      safeConsole.warn('隐藏 tooltip 窗口失败:', err);
    }
  }

  getOcrSettingsAnchorWindow() {
    if (this.ocrWindow && !this.ocrWindow.isDestroyed() && this.ocrWindow.isVisible()) {
      return this.ocrWindow;
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible()) {
      return this.mainWindow;
    }
    if (this.ocrWindow && !this.ocrWindow.isDestroyed()) {
      return this.ocrWindow;
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this.mainWindow;
    }
    return null;
  }

  hideOcrSettingsWindow() {
    try {
      if (this.ocrSettingsWindow && !this.ocrSettingsWindow.isDestroyed()) {
        this.ocrSettingsWindow.hide();
      }
    } catch (err) {
      safeConsole.warn('隐藏 OCR 设置面板失败:', err);
    }
  }

  repositionOcrSettingsWindow() {
    try {
      if (!this.ocrSettingsWindow || this.ocrSettingsWindow.isDestroyed()) return false;

      const anchorWindow = this.getOcrSettingsAnchorWindow();
      if (!anchorWindow || anchorWindow.isDestroyed()) return false;

      const anchorBounds = anchorWindow.getBounds();
      const display = screen.getDisplayMatching(anchorBounds);
      const workArea = display ? display.workArea : screen.getPrimaryDisplay().workArea;
      const gap = 12;
      const padding = 12;
      const panelWidth = Math.max(440, Math.min(560, workArea.width - padding * 2));
      const panelHeight = Math.max(560, Math.min(780, workArea.height - padding * 2));
      const rightSpace = Math.max(0, workArea.x + workArea.width - (anchorBounds.x + anchorBounds.width) - gap - padding);
      const leftSpace = Math.max(0, anchorBounds.x - workArea.x - gap - padding);
      const useRight = rightSpace >= panelWidth || rightSpace >= leftSpace;

      let x = useRight
        ? anchorBounds.x + anchorBounds.width + gap
        : anchorBounds.x - panelWidth - gap;
      let y = anchorBounds.y;

      const minX = workArea.x + padding;
      const maxX = workArea.x + workArea.width - panelWidth - padding;
      const minY = workArea.y + padding;
      const maxY = workArea.y + workArea.height - panelHeight - padding;

      x = Math.max(minX, Math.min(x, maxX));
      y = Math.max(minY, Math.min(y, maxY));

      this.ocrSettingsWindow.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: panelWidth,
        height: panelHeight
      });
      return true;
    } catch (err) {
      safeConsole.warn('重定位 OCR 设置面板失败:', err);
      return false;
    }
  }

  repositionTooltip() {
    try {
      if (!this.tooltipWindow || this.tooltipWindow.isDestroyed() || !this.tooltipPayload) return false;
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return false;

      const mainBounds = this.mainWindow.getBounds();
      const display = screen.getDisplayMatching(mainBounds);
      const workArea = display ? display.workArea : screen.getPrimaryDisplay().workArea;
      const windowGap = 12;
      const workAreaPadding = 12;
      const preferredSide = this.tooltipPayload.preferredSide === 'left' ? 'left' : 'right';
      const minWidth = Math.max(320, Number(this.tooltipPayload.minWidth) || 320);
      const minHeight = Math.max(90, Number(this.tooltipPayload.minHeight) || 120);
      const preferredWidth = Math.max(minWidth, Number(this.tooltipPayload.preferredWidth) || 720);
      const preferredHeight = Math.max(minHeight, Number(this.tooltipPayload.preferredHeight) || 360);
      const contentLength = Math.max(0, Number(this.tooltipPayload.contentLength) || 0);
      const isHtml = !!this.tooltipPayload.isHtml;
      const imageMetrics = this.tooltipPayload.imageMetrics || null;
      const measuredContentHeight = (!isHtml && this.tooltipPayload.measuredContentHeight) ? Number(this.tooltipPayload.measuredContentHeight) : 0;
      const measuredContentWidth = (!isHtml && this.tooltipPayload.measuredContentWidth) ? Number(this.tooltipPayload.measuredContentWidth) : 0;
      const rightSpace = Math.max(0, workArea.x + workArea.width - (mainBounds.x + mainBounds.width) - windowGap - workAreaPadding);
      const leftSpace = Math.max(0, mainBounds.x - workArea.x - windowGap - workAreaPadding);
      const wantsFullWidth = isHtml || (measuredContentWidth === 0 && contentLength > 600);
      const wantsFullHeight = isHtml || (measuredContentHeight === 0 && contentLength > 900);
      let side = preferredSide;

      const preferredSpace = side === 'right' ? rightSpace : leftSpace;
      const alternateSpace = side === 'right' ? leftSpace : rightSpace;
      if (preferredSpace < minWidth && alternateSpace > preferredSpace) {
        side = side === 'right' ? 'left' : 'right';
      } else if (alternateSpace > preferredSpace + 120) {
        side = side === 'right' ? 'left' : 'right';
      }

      const chosenSpace = side === 'right' ? rightSpace : leftSpace;
      const maxAllowedWidth = Math.max(minWidth, workArea.width - workAreaPadding * 2);
      let tooltipWidth = wantsFullWidth
        ? chosenSpace
        : Math.min(chosenSpace, preferredWidth);
      if (contentLength > 1600 && chosenSpace > preferredWidth) {
        tooltipWidth = chosenSpace;
      }
      if (isHtml && imageMetrics && Number(imageMetrics.naturalWidth) > 0) {
        const desiredImageWidth = Number(imageMetrics.naturalWidth) + 44;
        tooltipWidth = Math.min(chosenSpace, Math.max(minWidth, desiredImageWidth));
      }
      // Shrink width if content naturally fits in less space
      if (!isHtml && measuredContentWidth > 0 && measuredContentWidth < tooltipWidth) {
        tooltipWidth = Math.max(minWidth, measuredContentWidth);
      }
      tooltipWidth = Math.max(minWidth, Math.min(tooltipWidth, maxAllowedWidth));

      let tooltipX = side === 'right'
        ? mainBounds.x + mainBounds.width + windowGap
        : mainBounds.x - tooltipWidth - windowGap;

      const minX = workArea.x + workAreaPadding;
      const maxX = workArea.x + workArea.width - tooltipWidth - workAreaPadding;
      tooltipX = Math.max(minX, Math.min(tooltipX, maxX));

      let tooltipY = Math.max(workArea.y + workAreaPadding, mainBounds.y);
      let availableHeight = workArea.y + workArea.height - tooltipY - workAreaPadding;
      if (availableHeight < minHeight) {
        tooltipY = Math.max(workArea.y + workAreaPadding, workArea.y + workArea.height - minHeight - workAreaPadding);
        availableHeight = workArea.y + workArea.height - tooltipY - workAreaPadding;
      }

      let tooltipHeight;
      if (!isHtml && measuredContentHeight > 0) {
        // Use actual measured content height — no heuristics
        tooltipHeight = Math.min(availableHeight, Math.max(minHeight, measuredContentHeight));
      } else if (wantsFullHeight) {
        tooltipHeight = availableHeight;
      } else {
        tooltipHeight = Math.min(availableHeight, Math.max(minHeight, preferredHeight));
        if (contentLength < 160) {
          tooltipHeight = Math.min(tooltipHeight, Math.max(minHeight, Math.round(mainBounds.height * 0.45)));
        }
      }
      if (isHtml && imageMetrics && Number(imageMetrics.naturalHeight) > 0) {
        const naturalWidth = Math.max(1, Number(imageMetrics.naturalWidth));
        const naturalHeight = Math.max(1, Number(imageMetrics.naturalHeight));
        const captionHeight = Math.max(0, Number(imageMetrics.captionHeight) || 0);
        const innerWidth = Math.max(1, tooltipWidth - 36);
        const widthScale = Math.min(1, innerWidth / naturalWidth);
        const desiredImageHeight = Math.round(naturalHeight * widthScale);
        tooltipHeight = Math.min(
          availableHeight,
          Math.max(minHeight, desiredImageHeight + captionHeight + 44)
        );
      }
      tooltipHeight = Math.max(minHeight, Math.min(tooltipHeight, availableHeight));

      this.tooltipSize = { w: tooltipWidth, h: tooltipHeight };

      this.tooltipWindow.setBounds({
        x: Math.round(tooltipX),
        y: Math.round(tooltipY),
        width: tooltipWidth,
        height: tooltipHeight
      });
      return true;
    } catch (err) {
      safeConsole.warn('重定位 tooltip 失败:', err);
      return false;
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

    try { this.mainWindow.setMenu(null); } catch (_) { }

    // 注册X11相关资源到资源管理器
    if (resourceManager) {
      resourceManager.registerX11Resource('mainWindow', this.mainWindow);
    }

    this.mainWindow.on('hide', () => {
      try {
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('hide-context-menu');
        }
      } catch (_) { }
      this.hideTooltipWindow();
    });

    this.mainWindow.on('move', () => {
      try { this.repositionTooltip(); } catch (_) { }
    });

    this.mainWindow.on('resize', () => {
      try { this.repositionTooltip(); } catch (_) { }
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
      if (resourceManager) {
        try { resourceManager.unregisterResource('mainWindow'); } catch (_) { }
      }
      try {
        if (this.tooltipWindow && !this.tooltipWindow.isDestroyed()) this.tooltipWindow.destroy();
      } catch (_) { }
      try {
        if (this.ocrWindow && !this.ocrWindow.isDestroyed()) this.ocrWindow.destroy();
      } catch (_) { }
      try {
        if (this.ocrSettingsWindow && !this.ocrSettingsWindow.isDestroyed()) this.ocrSettingsWindow.destroy();
      } catch (_) { }
      this.tooltipWindow = null;
      this.tooltipPayload = null;
      this.tooltipSize = null;
      this.ocrWindow = null;
      this.ocrSettingsWindow = null;
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
          this.hideTooltipWindow();
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
          try {
            if (this.mainWindow.webContents) {
              this.mainWindow.webContents.send('global-shortcut', { action: 'activate-selection' });
            }
          } catch (err) {
            safeConsole.warn('Failed to request paste for current selection:', err);
          }
        } else {
          this.captureActiveWindowId('global-shortcut');
          this.mainWindow.show();
          // Notify renderer that the global shortcut opened the window so the UI
          // can reset state (clear search and hide search input) and not inherit previous data.
          try {
            if (this.mainWindow.webContents) {
              this.mainWindow.webContents.send('global-shortcut', { action: 'open-panel' });
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

      // Validate shortcut to prevent bare key registration
      if (!this.validateShortcut(shortcut)) {
        safeConsole.warn(`跳过无效的 LLM 快捷键 "${shortcut}" (${name}): 必须包含修饰键 (Ctrl, Alt, Shift, Meta)`);

        // Notify renderer about the invalid shortcut
        try {
          if (this.mainWindow && this.mainWindow.webContents) {
            this.mainWindow.webContents.send('invalid-shortcut', {
              llmName: name,
              shortcut: shortcut,
              message: '快捷键必须包含 Ctrl、Alt、Shift 或 Meta 修饰键'
            });
          }
        } catch (err) {
          safeConsole.warn('发送无效快捷键通知失败:', err);
        }

        continue;
      }

      try {
        const ok = globalShortcut.register(shortcut, async () => {
          safeConsole.log(`[LLM Shortcut] ${name} triggered (${shortcut})`);
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
            this.getOrCreateScreenshotManager();
            safeConsole.log(`[LLM Shortcut] ${name} trigger=image; selectedTextLength=${String(selectedText || '').length}`);
            try {
              const img = await this.screenshotManager.captureImage();
              safeConsole.log(`[LLM Shortcut] ${name} captureImage resolved`);
              // initialImages is an array of { base64Full, base64Raw }
              initialImages = [img];
              // Substitute known placeholders with the selected text
              if (prompt && typeof prompt === 'string') {
                // support both English/short placeholder {{text}} and the previous Chinese variant
                prompt = prompt.replace(/{{\s*text\s*}}/gi, selectedText || '');
                prompt = prompt.replace(/{{\s*鼠标正在选择的文本\s*}}/g, selectedText || '');
              }
              safeConsole.log(`[LLM Shortcut] ${name} prompt prepared; initialImages=${initialImages ? initialImages.length : 0}`);
            } catch (err) {
              safeConsole.error('捕获截图失败:', err);
              // fallback to text flow
              if (!prompt || !prompt.trim()) prompt = `Summarize ${selectedText || ''}`.trim();
            }
          } else {
            safeConsole.log(`[LLM Shortcut] ${name} trigger=text; selectedTextLength=${String(selectedText || '').length}`);
            // text flow: substitute selected text into prompt
            if (prompt && typeof prompt === 'string') {
              prompt = prompt.replace(/{{\s*text\s*}}/gi, selectedText || '');
              prompt = prompt.replace(/{{\s*鼠标正在选择的文本\s*}}/g, selectedText || '');
            }
            if (!prompt || !prompt.trim()) {
              prompt = `Summarize ${selectedText || ''}`.trim();
            }
            safeConsole.log(`[LLM Shortcut] ${name} prompt prepared`);
          }

          // Open chat window with entry config, including prompt and initialImages if any
          try {
            const cfg = Object.assign({}, entry, { prompt });
            if (initialImages) cfg.initialImages = initialImages;

            safeConsole.log(`[LLM Shortcut] ${name} opening chat window (initialImages=${cfg.initialImages ? cfg.initialImages.length : 0})`);
            this.openLlmChatWindow(name, cfg);
          } catch (err) {
            safeConsole.error('打开 LLM 窗口失败:', err);
          }
        });

        if (ok) {
          this._registeredLlmShortcuts[shortcut] = name;
          safeConsole.log(`成功注册 LLM 快捷键: ${shortcut} -> ${name}`);
        } else {
          safeConsole.warn('无法注册 LLM 快捷键:', shortcut);
        }
      } catch (err) {
        safeConsole.warn('注册 LLM 快捷键时出现异常:', err);
      }
    }
  }

  // Open a dedicated chat window for a named LLM entry, injecting config
  openLlmChatWindow(llmName, llmEntry = {}) {
    try {
      const rawPageName = typeof llmEntry.page === 'string' ? String(llmEntry.page).trim() : '';
      const pageName = AI_WINDOW_PAGES.has(rawPageName) ? rawPageName : 'chatPage.html';
      const isVisionPage = pageName === 'visionPage.html';
      const windowOptions = llmEntry.windowOptions && typeof llmEntry.windowOptions === 'object'
        ? llmEntry.windowOptions
        : {};
      const readWindowSize = (key, fallback) => {
        const value = Number(windowOptions[key]);
        return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
      };
      const initialTitle = typeof llmEntry.windowTitle === 'string' && String(llmEntry.windowTitle).trim()
        ? String(llmEntry.windowTitle).trim()
        : (isVisionPage ? `Vision Window (${llmName})` : `Chat Window (${llmName})`);

      const browserWindowOptions = {
        width: readWindowSize('width', isVisionPage ? 1240 : 640),
        height: readWindowSize('height', isVisionPage ? 820 : 600),
        minWidth: readWindowSize('minWidth', isVisionPage ? 960 : 480),
        minHeight: readWindowSize('minHeight', isVisionPage ? 680 : 420),
        show: true,
        title: initialTitle,
        webPreferences: {
          contextIsolation: true,
          preload: path.join(__dirname, '../preload/ai-preload.js')
        }
      };

      if (typeof windowOptions.backgroundColor === 'string' && String(windowOptions.backgroundColor).trim()) {
        browserWindowOptions.backgroundColor = String(windowOptions.backgroundColor).trim();
      } else if (isVisionPage) {
        browserWindowOptions.backgroundColor = '#0f1722';
      }

      const chatWin = new BrowserWindow(browserWindowOptions);

      // 注册X11相关资源到资源管理器
      if (resourceManager) {
        resourceManager.registerX11Resource(`chatWindow-${llmName}`, chatWin);
      }

      // Remove default application menu for this window so users cannot toggle alwaysOnTop from a menu
      try { chatWin.setMenu(null); } catch (e) { /* ignore */ }

      // Do not open devtools by default

      // Set native window title after window creation in case the page overrides it later.
      try { chatWin.setTitle(initialTitle); } catch (e) { /* ignore */ }

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
      if (llmEntry && typeof llmEntry.actionId === 'string' && String(llmEntry.actionId).trim()) {
        chatConfig.actionId = String(llmEntry.actionId).trim();
      }
      if (llmEntry && llmEntry.ui && typeof llmEntry.ui === 'object') {
        chatConfig.ui = Object.assign({}, llmEntry.ui);
      }
      if (typeof llmEntry.windowTitle === 'string' && String(llmEntry.windowTitle).trim()) {
        chatConfig.windowTitle = String(llmEntry.windowTitle).trim();
      }

      // Load chat page and then send the chatConfig via a secure IPC channel
      const fileUrl = `file://${path.join(__dirname, 'ai', pageName)}`;
      chatWin.loadURL(fileUrl);

      // Store config keyed by webContents id so that renderer can request it via invoke
      try {
        const wcId = chatWin.webContents.id;
        this._aiWindowConfigs.set(String(wcId), chatConfig);
      } catch (e) { /* ignore */ }

      // After the page finishes loading, re-apply the title to guard against page overrides
      chatWin.webContents.once('did-finish-load', () => {
        try {
          const fullTitle = initialTitle;
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
        // ignore when webContents is unavailable
      }

      return chatWin;
    } catch (err) {
      safeConsole.error('openLlmChatWindow 错误:', err);
      throw err;
    }
  }

  getVisionAssistantConfig() {
    const config = Config.getAll() || {};
    const rawVisionConfig = config.visionLlm && typeof config.visionLlm === 'object'
      ? config.visionLlm
      : {};
    const legacyModel = typeof config.vlVisionModel === 'string' && String(config.vlVisionModel).trim()
      ? String(config.vlVisionModel).trim()
      : '';
    const legacyBaseUrl = typeof config.vlVisionBaseUrl === 'string' && String(config.vlVisionBaseUrl).trim()
      ? String(config.vlVisionBaseUrl).trim()
      : '';
    const model = typeof rawVisionConfig.model === 'string' && String(rawVisionConfig.model).trim()
      ? String(rawVisionConfig.model).trim()
      : (legacyModel || DEFAULT_VISION_LLM_CONFIG.model);
    const baseurl = typeof rawVisionConfig.baseurl === 'string' && String(rawVisionConfig.baseurl).trim()
      ? String(rawVisionConfig.baseurl).trim()
      : (typeof rawVisionConfig.baseUrl === 'string' && String(rawVisionConfig.baseUrl).trim()
        ? String(rawVisionConfig.baseUrl).trim()
        : (legacyBaseUrl || DEFAULT_VISION_LLM_CONFIG.baseurl));
    const apitype = String(rawVisionConfig.apitype || DEFAULT_VISION_LLM_CONFIG.apitype).trim().toLowerCase() === 'openapi'
      ? 'openapi'
      : 'ollama';

    const readNumber = (value, fallback) => {
      const next = Number(value);
      return Number.isFinite(next) ? next : fallback;
    };

    return {
      apitype,
      model,
      baseurl,
      apikey: typeof rawVisionConfig.apikey === 'string'
        ? rawVisionConfig.apikey
        : (typeof rawVisionConfig.apiKey === 'string' ? rawVisionConfig.apiKey : DEFAULT_VISION_LLM_CONFIG.apikey),
      temperature: readNumber(rawVisionConfig.temperature, DEFAULT_VISION_LLM_CONFIG.temperature),
      top_p: readNumber(rawVisionConfig.top_p, DEFAULT_VISION_LLM_CONFIG.top_p),
      top_k: readNumber(rawVisionConfig.top_k, DEFAULT_VISION_LLM_CONFIG.top_k),
      context_window: readNumber(rawVisionConfig.context_window, DEFAULT_VISION_LLM_CONFIG.context_window),
      max_tokens: readNumber(rawVisionConfig.max_tokens, DEFAULT_VISION_LLM_CONFIG.max_tokens),
      presence_penalty: readNumber(rawVisionConfig.presence_penalty, DEFAULT_VISION_LLM_CONFIG.presence_penalty)
    };
  }

  getVisionActions() {
    const config = Config.getAll() || {};
    const rawActions = Array.isArray(config.visionActions) && config.visionActions.length
      ? config.visionActions
      : getDefaultVisionActions();
    return normalizeVisionActions(rawActions);
  }

  getVisionActionById(actionId = '') {
    const normalizedId = String(actionId || '').trim().toLowerCase();
    const actions = this.getVisionActions();
    return actions.find((item) => item.id === normalizedId) || actions[0] || getDefaultVisionActions()[0];
  }

  getVisionLanguageHint() {
    const languages = this.getOcrLanguages();
    if (!Array.isArray(languages) || languages.length === 0) {
      return '';
    }

    return languages
      .slice(0, 4)
      .map((lang) => OCR_LANGUAGE_SHORT_LABELS[lang] || lang)
      .join(' / ');
  }

  guessImageMimeTypeFromPath(filePath = '') {
    const ext = path.extname(String(filePath || '')).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.bmp') return 'image/bmp';
    return 'image/png';
  }

  createVisionImagePayload(buffer, mimeType = 'image/png') {
    if (!buffer || buffer.length === 0) {
      throw new Error('vision-image-empty');
    }

    const base64Raw = Buffer.from(buffer).toString('base64');
    const normalizedMime = String(mimeType || 'image/png');
    return {
      base64Raw,
      base64Full: `data:${normalizedMime};base64,${base64Raw}`,
      mimeType: normalizedMime
    };
  }

  resolveVisionImagePayload(payload = {}) {
    const rawBuffer = payload && payload.imageBuffer ? payload.imageBuffer : null;
    if (rawBuffer) {
      return this.createVisionImagePayload(Buffer.from(rawBuffer), payload.mimeType || 'image/png');
    }

    const rawToken = payload && payload.imageToken ? String(payload.imageToken) : '';
    if (rawToken) {
      const tokenPayload = this.getOcrImageTokenData(rawToken);
      if (!tokenPayload || !tokenPayload.data) {
        throw new Error('vision-image-token-missing');
      }
      return this.createVisionImagePayload(Buffer.from(tokenPayload.data), tokenPayload.mimeType || 'image/png');
    }

    const rawImagePath = payload && payload.imagePath ? String(payload.imagePath) : '';
    if (rawImagePath.startsWith('data:image/')) {
      const match = rawImagePath.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match || !match[1] || !match[2]) {
        throw new Error('vision-image-invalid-data-url');
      }
      return {
        base64Raw: match[2],
        base64Full: rawImagePath,
        mimeType: match[1]
      };
    }

    if (rawImagePath) {
      const buffer = fs.readFileSync(rawImagePath);
      return this.createVisionImagePayload(buffer, this.guessImageMimeTypeFromPath(rawImagePath));
    }

    throw new Error('vision-image-missing');
  }

  openVisionChatWindow(payload = {}) {
    const requestedActionId = String(payload && payload.actionId ? payload.actionId : 'vl-describe').trim().toLowerCase();
    const action = this.getVisionActionById(requestedActionId);
    const imagePayload = this.resolveVisionImagePayload(payload);
    const assistantConfig = this.getVisionAssistantConfig();
    const customPrompt = typeof payload.prompt === 'string' ? String(payload.prompt).trim() : '';
    const prompt = customPrompt
      || String(action.prompt || '').replace(/\{\{languageHint\}\}/g, this.getVisionLanguageHint());

    return this.openLlmChatWindow(action.label, {
      page: 'visionPage.html',
      windowTitle: `Clipboard God - ${action.label}`,
      windowOptions: {
        width: 1240,
        height: 820,
        minWidth: 960,
        minHeight: 680,
        backgroundColor: '#0f1722'
      },
      actionId: action.id,
      ui: {
        mode: 'vision-result',
        allowFollowUp: true,
        actionLabel: action.label
      },
      apitype: assistantConfig.apitype,
      model: assistantConfig.model,
      baseurl: assistantConfig.baseurl,
      apikey: assistantConfig.apikey,
      prompt,
      initialImages: [imagePayload],
      temperature: assistantConfig.temperature,
      top_p: assistantConfig.top_p,
      top_k: assistantConfig.top_k,
      context_window: assistantConfig.context_window,
      max_tokens: assistantConfig.max_tokens,
      presence_penalty: assistantConfig.presence_penalty
    });
  }

  openOcrWindow(payload = {}) {
    try {
      const rawImagePath = payload && payload.imagePath ? String(payload.imagePath) : '';
      const rawImageBuffer = payload && payload.imageBuffer ? payload.imageBuffer : null;
      const imageBuffer = rawImageBuffer ? Buffer.from(rawImageBuffer) : null;
      const languages = Array.isArray(payload.languages) ? payload.languages : [];
      let imagePath = rawImagePath;
      let imageToken = '';

      if (imageBuffer && imageBuffer.length > 0) {
        imageToken = this.createOcrImageToken(imageBuffer, 'image/png');
        imagePath = '';
      } else if (rawImagePath.startsWith('data:image/')) {
        const dataUrlMatch = rawImagePath.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (!dataUrlMatch || !dataUrlMatch[1] || !dataUrlMatch[2]) {
          throw new Error('ocr-image-invalid-data-url');
        }
        imageToken = this.createOcrImageToken(Buffer.from(dataUrlMatch[2], 'base64'), dataUrlMatch[1]);
        imagePath = '';
      }

      if (!imagePath && !imageToken) throw new Error('ocr-image-missing');

      this.setOcrWindowState({
        imagePath,
        imageToken,
        languages
      });

      const existingWindow = this.ocrWindow && !this.ocrWindow.isDestroyed() ? this.ocrWindow : null;
      const ocrWin = existingWindow || new BrowserWindow({
        width: 1100,
        height: 720,
        show: true,
        title: 'OCR Window',
        webPreferences: {
          contextIsolation: true,
          preload: path.join(__dirname, '../preload/index.js')
        }
      });

      if (!existingWindow) {
        this.ocrWindow = ocrWin;
        if (resourceManager) {
          resourceManager.registerX11Resource('ocrWindow', ocrWin);
        }
        try { ocrWin.setMenu(null); } catch (_) { }

        // Allow opening devtools for OCR window even when the app menu toggles only the main window.
        // This is especially useful in production builds where the default menu is removed.
        try {
          ocrWin.webContents.on('before-input-event', (event, input) => {
            try {
              const key = String(input?.key || '').toLowerCase();
              const ctrlOrCmd = !!(input?.control || input?.meta);
              const shift = !!input?.shift;
              const isToggle = (ctrlOrCmd && shift && key === 'i') || key === 'f12';
              if (!isToggle) return;
              event.preventDefault();
              if (ocrWin && !ocrWin.isDestroyed()) {
                try {
                  if (ocrWin.webContents.isDevToolsOpened && ocrWin.webContents.isDevToolsOpened()) {
                    ocrWin.webContents.closeDevTools();
                  } else {
                    ocrWin.webContents.openDevTools({ mode: 'detach' });
                  }
                } catch (e) {
                  try { ocrWin.webContents.toggleDevTools(); } catch (_) { }
                }
              }
            } catch (e) {
              // ignore
            }
          });
        } catch (_) { }

        ocrWin.on('closed', () => {
          this.releaseAllOcrImageTokens();
          this._ocrWindowState = null;
          this.ocrWindow = null;
          if (resourceManager) {
            try { resourceManager.unregisterResource('ocrWindow'); } catch (_) { }
          }
        });

        ocrWin.webContents.on('did-finish-load', () => {
          try {
            if (ocrWin && !ocrWin.isDestroyed()) {
              ocrWin.webContents.send('ocr-window-payload', this.getOcrWindowState());
            }
          } catch (_) { }
        });
      }

      const debugParam = (process.env.OCR_DEBUG === '1' || process.env.OCR_DEBUG === 'true') ? '1' : '';
      if (!existingWindow) {
        if (process.env.VITE_DEV_SERVER_URL) {
          const baseUrl = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '');
          const url = `${baseUrl}/?window=ocr${debugParam ? `&debug=${debugParam}` : ''}`;
          ocrWin.loadURL(url);
        } else {
          const filePath = path.join(__dirname, '../../dist/index.html');
          ocrWin.loadFile(filePath, {
            query: {
              window: 'ocr',
              ...(debugParam ? { debug: debugParam } : {})
            }
          });
        }
      } else {
        ocrWin.webContents.send('ocr-window-payload', this.getOcrWindowState());
      }

      try { ocrWin.show(); } catch (_) { }
      try { ocrWin.focus(); } catch (_) { }

      return ocrWin;
    } catch (err) {
      safeConsole.error('openOcrWindow error:', err);
      throw err;
    }
  }

  openSettingsWindow(options = {}) {
    try {
      const requestedTab = ['general', 'appearance', 'shortcuts', 'ocr', 'llm'].includes(String(options.tab || '').trim())
        ? String(options.tab || '').trim()
        : 'general';
      const routeWindow = options.legacyRoute ? 'ocr-settings' : 'settings';
      const existingWindow = this.ocrSettingsWindow && !this.ocrSettingsWindow.isDestroyed()
        ? this.ocrSettingsWindow
        : null;
      const settingsWin = existingWindow || new BrowserWindow({
        width: 1080,
        height: 920,
        minWidth: 860,
        minHeight: 700,
        show: false,
        fullscreenable: false,
        hasShadow: true,
        backgroundColor: '#f5f7fb',
        title: 'Settings',
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          preload: path.join(__dirname, '../preload/index.js')
        }
      });

      if (!existingWindow) {
        this.ocrSettingsWindow = settingsWin;
        if (resourceManager) {
          resourceManager.registerX11Resource('ocrSettingsWindow', settingsWin);
        }
        try { settingsWin.setMenu(null); } catch (_) { }
        try { settingsWin.setMenuBarVisibility(false); } catch (_) { }

        try {
          settingsWin.webContents.on('before-input-event', (event, input) => {
            try {
              const key = String(input?.key || '').toLowerCase();
              const ctrlOrCmd = !!(input?.control || input?.meta);
              const shift = !!input?.shift;
              const isToggle = (ctrlOrCmd && shift && key === 'i') || key === 'f12';
              if (!isToggle) return;
              event.preventDefault();
              if (settingsWin && !settingsWin.isDestroyed()) {
                try {
                  if (settingsWin.webContents.isDevToolsOpened && settingsWin.webContents.isDevToolsOpened()) {
                    settingsWin.webContents.closeDevTools();
                  } else {
                    settingsWin.webContents.openDevTools({ mode: 'detach' });
                  }
                } catch (e) {
                  try { settingsWin.webContents.toggleDevTools(); } catch (_) { }
                }
              }
            } catch (_) { }
          });
        } catch (_) { }

        settingsWin.on('closed', () => {
          this.ocrSettingsWindow = null;
          if (resourceManager) {
            try { resourceManager.unregisterResource('ocrSettingsWindow'); } catch (_) { }
          }
        });

        settingsWin.once('ready-to-show', () => {
          try {
            if (settingsWin.isDestroyed()) return;
            if (settingsWin.isMinimized && settingsWin.isMinimized()) {
              settingsWin.restore();
            }
            settingsWin.show();
            settingsWin.focus();
            settingsWin.webContents.send('settings-window-open-tab', { tab: requestedTab });
          } catch (_) { }
        });

        const debugParam = (process.env.OCR_DEBUG === '1' || process.env.OCR_DEBUG === 'true') ? '1' : '';
        if (process.env.VITE_DEV_SERVER_URL) {
          const baseUrl = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '');
          const url = `${baseUrl}/?window=${routeWindow}&tab=${encodeURIComponent(requestedTab)}${debugParam ? `&debug=${debugParam}` : ''}`;
          settingsWin.loadURL(url);
        } else {
          const filePath = path.join(__dirname, '../../dist/index.html');
          settingsWin.loadFile(filePath, {
            query: {
              window: routeWindow,
              tab: requestedTab,
              ...(debugParam ? { debug: debugParam } : {})
            }
          });
        }
      }

      try {
        if (settingsWin.isMinimized && settingsWin.isMinimized()) {
          settingsWin.restore();
        }
      } catch (_) { }
      try { settingsWin.show(); } catch (_) { }
      try { settingsWin.focus(); } catch (_) { }
      try { settingsWin.webContents.send('settings-window-open-tab', { tab: requestedTab }); } catch (_) { }
      return settingsWin;
    } catch (err) {
      safeConsole.error('openSettingsWindow error:', err);
      throw err;
    }
  }

  openOcrSettingsWindow() {
    return this.openSettingsWindow({ tab: 'ocr', legacyRoute: true });
  }

  getOcrLanguages() {
    const languages = Config.get('ocrLanguages');
    if (Array.isArray(languages) && languages.length > 0) {
      return languages;
    }
    return ['chi_sim', 'eng'];
  }

  createOcrImageToken(buffer, mimeType = 'image/png') {
    if (!buffer || buffer.length === 0) {
      throw new Error('ocr-image-empty');
    }

    const token = `ocr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this._ocrImageTokens.set(token, {
      buffer: Buffer.from(buffer),
      mimeType: String(mimeType || 'image/png'),
      createdAt: Date.now()
    });
    return token;
  }

  getOcrWindowState() {
    if (!this._ocrWindowState) {
      return {
        imagePath: '',
        imageToken: '',
        languages: []
      };
    }

    return {
      imagePath: String(this._ocrWindowState.imagePath || ''),
      imageToken: String(this._ocrWindowState.imageToken || ''),
      languages: Array.isArray(this._ocrWindowState.languages) ? [...this._ocrWindowState.languages] : []
    };
  }

  setOcrWindowState(nextState = {}) {
    const prevToken = this._ocrWindowState && this._ocrWindowState.imageToken ? String(this._ocrWindowState.imageToken) : '';
    const nextToken = nextState && nextState.imageToken ? String(nextState.imageToken) : '';

    this._ocrWindowState = {
      imagePath: String(nextState.imagePath || ''),
      imageToken: nextToken,
      languages: Array.isArray(nextState.languages) ? nextState.languages.map((lang) => String(lang || '').trim()).filter(Boolean) : []
    };

    if (prevToken && prevToken !== nextToken) {
      this.releaseOcrImageToken(prevToken);
    }
  }

  broadcastSettingsUpdated(payload) {
    const targets = [this.mainWindow, this.ocrWindow, this.ocrSettingsWindow];
    const sentIds = new Set();

    for (const win of targets) {
      try {
        if (!win || win.isDestroyed() || !win.webContents) continue;
        const webContentsId = Number(win.webContents.id || 0);
        if (webContentsId > 0 && sentIds.has(webContentsId)) continue;
        if (webContentsId > 0) sentIds.add(webContentsId);
        win.webContents.send('settings-updated', payload);
      } catch (err) {
        safeConsole.warn('Failed to send settings-updated to renderer:', err);
      }
    }
  }

  getOcrImageTokenData(token) {
    const entry = this._ocrImageTokens.get(String(token || ''));
    if (!entry) {
      return null;
    }
    return {
      data: new Uint8Array(entry.buffer),
      mimeType: entry.mimeType
    };
  }

  releaseOcrImageToken(token) {
    if (!token) {
      return false;
    }
    return this._ocrImageTokens.delete(String(token));
  }

  releaseAllOcrImageTokens() {
    if (!this._ocrImageTokens || this._ocrImageTokens.size === 0) {
      return;
    }
    this._ocrImageTokens.clear();
  }

  getOrCreateScreenshotManager() {
    if (!this.screenshotManager) {
      this.screenshotManager = new ScreenshotManager(this.mainWindow, this.clipboardManager, {
        getOcrLanguages: () => this.getOcrLanguages(),
        getVisionActions: () => this.getVisionActions(),
        openOcrWindow: async (buffer) => {
          return this.openOcrWindow({
            imageBuffer: buffer,
            languages: this.getOcrLanguages()
          });
        },
        openVisionChat: async (payload) => {
          return this.openVisionChatWindow(payload || {});
        }
      });
    }

    return this.screenshotManager;
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
      try {
        this.getOrCreateScreenshotManager().startScreenshot();
      } catch (error) {
        safeConsole.error('截图快捷键启动截图失败:', error);
      }
    });

    if (!ret) {
      safeConsole.log('截图快捷键注册失败');
    }

    // 检查快捷键是否注册成功
    safeConsole.log('截图快捷键是否注册:', globalShortcut.isRegistered(shortcut));
  }

  // Apply login/autostart preferences per platform
  configureAutoLaunch(enable) {
    try {
      const shouldEnable = !!enable;
      const platform = process.platform;

      const escapeDesktopArg = (value) => {
        const str = String(value);
        if (!/[\s"'\\$`]/.test(str)) {
          return str;
        }
        let escaped = '';
        for (const ch of str) {
          if (ch === '"' || ch === '\\' || ch === '$' || ch === '`') {
            escaped += `\\${ch}`;
          } else {
            escaped += ch;
          }
        }
        return `"${escaped}"`;
      };

      const buildAutostartExec = () => {
        const formatDesktopCommand = (commandPath, argsList) => {
          const parts = [escapeDesktopArg(commandPath), ...argsList.map((arg) => escapeDesktopArg(arg))];
          return parts.join(' ');
        };

        if (process.env.APPIMAGE) {
          const appImagePath = process.env.APPIMAGE;
          return {
            command: formatDesktopCommand(appImagePath, []),
            path: appImagePath,
            args: []
          };
        }

        const exePath = app.getPath('exe');
        if (!exePath) {
          return null;
        }

        if (platform === 'linux' && app.isPackaged) {
          try {
            const systemBinary = '/usr/bin/clipboard-god';
            if (fs.existsSync(systemBinary)) {
              return {
                command: formatDesktopCommand('clipboard-god', []),
                path: systemBinary,
                args: []
              };
            }
          } catch (err) {
            safeConsole.warn('检测系统 clipboard-god 可执行文件失败:', err);
          }
        }

        if (app.isPackaged) {
          return {
            command: formatDesktopCommand(exePath, []),
            path: exePath,
            args: []
          };
        }

        const argv = process.argv.slice(1);
        const rawArgs = argv.length > 0 ? argv : [app.getAppPath()];
        return {
          command: formatDesktopCommand(exePath, rawArgs),
          path: exePath,
          args: rawArgs
        };
      };

      const execDetails = buildAutostartExec();
      if (!execDetails) {
        safeConsole.warn('自动启动：无法解析执行路径');
        return;
      }

      if (platform === 'win32' || platform === 'darwin') {
        try {
          app.setLoginItemSettings({
            openAtLogin: shouldEnable,
            openAsHidden: platform === 'darwin',
            path: execDetails.path,
            args: execDetails.args || []
          });
          safeConsole.log('自动启动（login items）已设置:', shouldEnable);
        } catch (err) {
          safeConsole.warn('设置 login item 自动启动失败:', err);
        }
        return;
      }

      if (platform === 'linux') {
        const homeDir = app.getPath('home');
        if (!homeDir) {
          safeConsole.warn('自动启动：无法获取 home 目录');
          return;
        }

        const autostartDir = path.join(homeDir, '.config', 'autostart');
        const desktopFile = path.join(autostartDir, 'clipboard-god.desktop');

        if (!shouldEnable) {
          try {
            if (fs.existsSync(desktopFile)) {
              fs.unlinkSync(desktopFile);
              safeConsole.log('已移除自动启动 desktop 条目');
            }
          } catch (err) {
            safeConsole.warn('移除自动启动条目失败:', err);
          }
          return;
        }

        try {
          fs.mkdirSync(autostartDir, { recursive: true });
        } catch (err) {
          safeConsole.warn('创建 autostart 目录失败:', err);
          return;
        }

        const name = app.getName() || 'Clipboard God';
        const comment = 'Clipboard history manager';
        const desktopEntry = [
          '[Desktop Entry]',
          'Type=Application',
          `Name=${name}`,
          `Comment=${comment}`,
          `Exec=${execDetails.command}`,
          'Icon=clipboard-god',
          'Terminal=false',
          'X-GNOME-Autostart-enabled=true',
          'StartupNotify=false'
        ].join('\n');

        try {
          try {
            if (fs.existsSync(desktopFile)) {
              const current = fs.readFileSync(desktopFile, 'utf8');
              if (/node_modules\/electron/.test(current)) {
                fs.unlinkSync(desktopFile);
              }
            }
          } catch (cleanupErr) {
            safeConsole.warn('清理旧自动启动条目失败:', cleanupErr);
          }

          fs.writeFileSync(desktopFile, `${desktopEntry}\n`, { mode: 0o755 });
          safeConsole.log('自动启动 desktop 文件已写入:', desktopFile);
        } catch (err) {
          safeConsole.warn('写入自动启动 desktop 文件失败:', err);
        }
        return;
      }

      safeConsole.log('未处理的平台自动启动请求:', platform);
    } catch (err) {
      safeConsole.warn('配置自动启动时出现异常:', err);
    }
  }

  // 启动剪贴板监控
  startClipboardMonitoring() {
    // 启动定时器，每秒检查一次剪贴板
    this.clipboardManager.startMonitoring();

    // 添加监听器以通知渲染进程
    if (this._clipboardListener) {
      try { this.clipboardManager.removeListener(this._clipboardListener); } catch (_) { }
    }
    this._clipboardListener = (history) => {
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('update-history', history);
      }
    };
    this.clipboardManager.addListener(this._clipboardListener);
  }

  // X11连接状态监控
  startX11Monitoring() {
    if (this._x11ConnectionMonitoring) return;

    this._x11ConnectionMonitoring = true;
    safeConsole.log('开始X11连接状态监控');

    try {
      const activeWindows = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
      this._x11ConnectionCount = activeWindows.length;
    } catch (e) {
      this._x11ConnectionCount = this._x11ConnectionCount || 0;
    }

    // 监控主窗口的X11连接状态
    if (this.mainWindow) {
      this.mainWindow.on('closed', () => {
        this._x11ConnectionCount = Math.max(0, this._x11ConnectionCount - 1);
        safeConsole.debug(`X11连接减少，当前数量: ${this._x11ConnectionCount}`);
      });
    }

    // 定期检查X11连接状态
    if (this._x11MonitorTimer) {
      try { clearInterval(this._x11MonitorTimer); } catch (_) { }
    }
    this._x11MonitorTimer = setInterval(() => {
      if (!this._x11ConnectionMonitoring) return;

      const activeWindows = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
      const currentCount = activeWindows.length;

      if (currentCount !== this._x11ConnectionCount) {
        safeConsole.debug(`X11连接状态变化: ${this._x11ConnectionCount} -> ${currentCount}`);
        this._x11ConnectionCount = currentCount;
      }

      // 如果有未监控的窗口，注册它们
      for (const win of activeWindows) {
        if (win !== this.mainWindow && win !== this.tooltipWindow &&
          !Array.from(this._aiWindowConfigs.keys()).includes(String(win.webContents.id))) {
          // 这可能是一个新的聊天窗口
          safeConsole.debug('发现新的X11连接窗口');
        }
      }
    }, 5000); // 每5秒检查一次
  }

  // 获取X11连接状态
  getX11Status() {
    return {
      totalConnections: this._x11ConnectionCount,
      mainWindowAlive: this.mainWindow && !this.mainWindow.isDestroyed(),
      tooltipWindowAlive: this.tooltipWindow && !this.tooltipWindow.isDestroyed(),
      chatWindowsCount: this._aiWindowConfigs.size,
      isMonitoring: this._x11ConnectionMonitoring,
      resourceManagerStatus: resourceManager ? resourceManager.getResourceStatus() : null
    };
  }

  // 设置IPC通信处理
  setupIpcHandlers() {

    // 获取历史记录
    ipcMain.on('get-history', (event) => {
      safeConsole.log('收到获取历史记录请求');
      event.reply('history-data', this.clipboardManager.getHistory());
    });

    // --- i18n locale handlers ---
    // Return persisted locale or system default
    ipcMain.handle('get-locale', async () => {
      try {
        const persisted = Config.get('locale');
        if (persisted) return persisted;
        // fallback to system locale or 'en'
        try { return (app && typeof app.getLocale === 'function') ? app.getLocale() : 'en'; } catch (e) { return 'en'; }
      } catch (e) {
        return 'en';
      }
    });

    // Persist locale and notify all windows
    ipcMain.handle('set-locale', async (_event, locale) => {
      try {
        await Config.set('locale', locale);
        // broadcast to all renderer windows
        try {
          const wins = BrowserWindow.getAllWindows();
          for (const w of wins) {
            try { w.webContents.send('locale-changed', locale); } catch (e) { /* ignore per-window send errors */ }
          }
        } catch (e) { }
        // Rebuild the app menu so menu labels reflect the new locale immediately
        try {
          this.buildAppMenu();
        } catch (e) {
          safeConsole.warn('重建应用菜单时出错:', e);
        }

        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    // Serve translations from the bundled locales folder
    ipcMain.handle('get-translations', async (_event, locale) => {
      try {
        // In development, locales are in the project root
        // In production (packaged), they should be in the app's resources
        let localesDir;
        if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
          // Use absolute path to project root
          const projectRoot = path.resolve(__dirname, '..', '..');
          localesDir = path.join(projectRoot, 'locales');
        } else {
          // In packaged app, locales should be in resources path
          localesDir = path.join(process.resourcesPath, 'locales');
          // If not found, try app path
          if (!fs.existsSync(localesDir)) {
            localesDir = path.join(app.getAppPath(), 'locales');
          }
          // If still not found, try the directory where the executable is located
          if (!fs.existsSync(localesDir)) {
            localesDir = path.join(path.dirname(app.getPath('exe')), 'locales');
          }
        }

        const tryList = [];
        if (locale) tryList.push(locale);
        // push language part (e.g., 'zh' from 'zh-CN')
        if (locale && locale.indexOf('-') !== -1) tryList.push(locale.split('-')[0]);
        tryList.push('en');

        for (const l of tryList) {
          try {
            const candidate = path.join(localesDir, `${l}.json`);
            if (fs.existsSync(candidate)) {
              const txt = fs.readFileSync(candidate, 'utf8');
              try { return JSON.parse(txt); } catch (e) { continue; }
            }
          } catch (e) { continue; }
        }
        return null;
      } catch (e) {
        return null;
      }
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
      safeConsole.debug('获取设置:', config);
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

    // X11状态查询
    ipcMain.handle('get-x11-status', async () => {
      try {
        return this.getX11Status();
      } catch (e) {
        safeConsole.warn('获取X11状态失败:', e);
        return { error: e.message };
      }
    });

    // NOTE: system notifications removed; chat window will use internal UI notifications only

    ipcMain.handle('set-settings', async (event, values) => {
      safeConsole.debug('保存设置 (原始):', values);
      try { safeConsole.debug('配置文件路径 (Config.configPath):', Config.configPath); } catch (e) { }

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
        if (changedKeys.includes('launchOnStartup')) {
          this.configureAutoLaunch(newConfig.launchOnStartup);
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
      this.broadcastSettingsUpdated({
        success: !!result.success,
        changedKeys,
        config: newConfig,
        error: result.error || null
      });

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
        const pasteFailsafeMs = 2000;
        const pasteFailsafeTimer = setTimeout(() => {
          if (this._isPasting) {
            safeConsole.warn('粘贴兜底超时，强制恢复状态');
            this._isPasting = false;
            this._pasteLock = false;
          }
        }, pasteFailsafeMs);

        // 等待一小段时间以确保焦点切换回前一个应用
        setTimeout(() => {
          // 写入剪贴板并执行粘贴
          const targetWindowId = this._lastActiveWindowId || '';
          PasteHandler.writeAndPaste(item, {
            targetWindowId,
            clipboardManager: this.clipboardManager
          })
            .then(() => {
              safeConsole.log('粘贴操作完成');
              this._pasteLock = false;
              this._isPasting = false;
              clearTimeout(pasteFailsafeTimer);
            })
            .catch((error) => {
              safeConsole.error('粘贴操作失败:', error);
              this._pasteLock = false;
              this._isPasting = false;
              clearTimeout(pasteFailsafeTimer);
              // 发送错误信息到渲染进程
              if (this.mainWindow && this.mainWindow.webContents) {
                this.mainWindow.webContents.send('error', error.message);
              }
            });
        }, 50);
      } catch (error) {
        safeConsole.error('粘贴项目时出错:', error);
        this._pasteLock = false;
        this._isPasting = false;
        // 发送错误信息到渲染进程
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('error', error.message);
        }
      }
    });

    // 编辑历史项（修改文本内容）
    ipcMain.handle('edit-item', async (_event, { dbId, newContent }) => {
      try {
        if (!dbId) return { success: false, error: 'no-id' };
        const ok = this.clipboardManager.updateTextItem(dbId, newContent);
        return { success: !!ok };
      } catch (e) {
        safeConsole.error('edit-item 处理失败:', e);
        return { success: false, error: e.message };
      }
    });

    // 钉住/取消钉住历史项
    ipcMain.handle('pin-item', async (_event, { dbId, pinned }) => {
      try {
        if (!dbId) return { success: false, error: 'no-id' };
        const ok = this.clipboardManager.setPinned(dbId, !!pinned);
        return { success: !!ok };
      } catch (e) {
        safeConsole.error('pin-item 处理失败:', e);
        return { success: false, error: e.message };
      }
    });

    ipcMain.on('show-tooltip', (_event, payload) => {
      try {
        const config = Config.getAll();
        if (config && config.enableTooltips === false) return;
        if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.mainWindow.isVisible() || this._isPasting) return;

        this.createTooltipWindow();
        if (!this.tooltipWindow) return;

        this._tooltipSeq = (this._tooltipSeq || 0) + 1;
        const currentSeq = this._tooltipSeq;
        const {
          content = '',
          anchorRect = {},
          html: isHtml = false,
          preferredWidth,
          preferredHeight,
          minWidth,
          minHeight,
          preferredSide
        } = payload || {};
        const display = screen.getDisplayMatching(this.mainWindow.getBounds());
        const workArea = display ? display.workArea : screen.getPrimaryDisplay().workArea;
        const resolvedMinWidth = Math.max(320, Math.min(Number(minWidth) || 320, workArea.width - 40));
        const resolvedPreferredWidth = Math.max(resolvedMinWidth, Math.min(Number(preferredWidth) || 720, workArea.width - 32));
        const resolvedMinHeight = Math.max(80, Math.min(Number(minHeight) || 120, workArea.height - 40));
        const resolvedPreferredHeight = Math.max(resolvedMinHeight, Math.min(Number(preferredHeight) || 720, workArea.height - 24));
        const contentLength = String(content || '').length;
        const textFontSize = contentLength > 12000 ? 13 : contentLength > 7000 ? 13.5 : contentLength > 3200 ? 14 : 15;
        const textColumnCount = contentLength > 12000 ? 3 : contentLength > 3600 ? 2 : 1;
        const textColumnCss = textColumnCount > 1
          ? `column-count:${textColumnCount};column-gap:34px;column-rule:1px solid rgba(255,255,255,0.18);column-fill:auto;`
          : '';

        this.tooltipPayload = {
          anchorRect,
          preferredSide: preferredSide === 'left' ? 'left' : 'right',
          preferredWidth: resolvedPreferredWidth,
          preferredHeight: resolvedPreferredHeight,
          minWidth: resolvedMinWidth,
          minHeight: resolvedMinHeight,
          isHtml,
          contentLength,
          imageMetrics: null
        };

        let pageContent = String(content || '');
        if (isHtml) {
          try {
            const fileUrlRegex = /src="file:\/\/([^"']+)"/g;
            pageContent = pageContent.replace(fileUrlRegex, (match, relativePath) => {
              try {
                const filePath = '/' + String(relativePath || '').replace(/^\/+/, '');
                if (!fs.existsSync(filePath)) return match;
                const buffer = fs.readFileSync(filePath);
                const extension = path.extname(filePath).toLowerCase();
                let mimeType = 'image/png';
                if (extension === '.jpg' || extension === '.jpeg') mimeType = 'image/jpeg';
                else if (extension === '.gif') mimeType = 'image/gif';
                else if (extension === '.webp') mimeType = 'image/webp';
                else if (extension === '.svg') mimeType = 'image/svg+xml';
                return `src="data:${mimeType};base64,${buffer.toString('base64')}"`;
              } catch (_) {
                return match;
              }
            });
          } catch (_) { }
        } else {
          pageContent = pageContent
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        }

        const pageHtml = isHtml
          ? `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden;pointer-events:none;}body{display:block;}#box{width:100%;height:100%;box-sizing:border-box;padding:16px 18px;border-radius:12px;background:rgba(14,14,14,0.94);color:#fff;box-shadow:0 18px 42px rgba(0,0,0,0.36);font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial;line-height:1.45;overflow:hidden;pointer-events:none;}#media-layout{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:12px;overflow:hidden;}#media-wrap{flex:1 1 auto;min-height:0;width:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;}#media-wrap img{display:block;width:auto !important;height:auto !important;max-width:100% !important;max-height:100% !important;object-fit:contain;border-radius:10px;}#media-caption{flex:none;width:100%;font-size:12px;color:#ddd;text-align:left;}</style></head><body><div id="box">${pageContent}</div></body></html>`
          : `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden;pointer-events:none;}body{display:block;}#box{width:100%;height:100%;box-sizing:border-box;padding:16px 18px;border-radius:12px;background:rgba(14,14,14,0.94);color:#fff;box-shadow:0 18px 42px rgba(0,0,0,0.36);font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial;overflow:hidden;pointer-events:none;}#content{width:100%;height:100%;overflow:hidden;white-space:pre-wrap;word-break:break-word;line-height:1.58;font-size:${textFontSize}px;${textColumnCss}}</style></head><body><div id="box"><div id="content">${pageContent}</div></div></body></html>`;

        this.tooltipWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pageHtml));
        this.tooltipWindow.webContents.once('did-finish-load', () => {
          if (currentSeq !== this._tooltipSeq) return;
          if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.mainWindow.isVisible() || this._isPasting) return;

          if (!isHtml) {
            if (!this.repositionTooltip()) return;
            // Measure actual rendered content dimensions, then resize window to fit content
            this.tooltipWindow.webContents.executeJavaScript(
              '(function(){var el=document.getElementById("content");if(!el)return null;var origWS=el.style.whiteSpace,origOV=el.style.overflow;el.style.whiteSpace="pre";el.style.overflow="scroll";var nw=Math.ceil(el.scrollWidth);el.style.whiteSpace=origWS;el.style.overflow=origOV;var h=Math.ceil(el.scrollHeight);return{naturalW:nw,h:h};})()', true
            ).then((metrics) => {
              if (currentSeq !== this._tooltipSeq) return;
              if (metrics && this.tooltipPayload) {
                if (metrics.h > 0) this.tooltipPayload.measuredContentHeight = metrics.h + 32;
                if (metrics.naturalW > 0) this.tooltipPayload.measuredContentWidth = metrics.naturalW + 36;
                this.repositionTooltip();
              }
              try { this.tooltipWindow.showInactive(); } catch (_) { this.tooltipWindow.show(); }
            }).catch(() => {
              try { this.tooltipWindow.showInactive(); } catch (_) { this.tooltipWindow.show(); }
            });
            return;
          }

          this.tooltipWindow.webContents.executeJavaScript(`(async function(){const img=document.querySelector('#media-wrap img');const caption=document.getElementById('media-caption');if(!img){return null;}if(!img.complete){try{await img.decode();}catch(_){}}return {naturalWidth: Number(img.naturalWidth)||0,naturalHeight: Number(img.naturalHeight)||0,captionHeight: caption ? Math.ceil(caption.getBoundingClientRect().height) : 0};})()`, true)
            .then((imageMetrics) => {
              if (currentSeq !== this._tooltipSeq) return;
              if (imageMetrics) {
                this.tooltipPayload.imageMetrics = imageMetrics;
              }
              if (!this.repositionTooltip()) return;
              try { this.tooltipWindow.showInactive(); } catch (_) { this.tooltipWindow.show(); }
            })
            .catch(() => {
              if (currentSeq !== this._tooltipSeq) return;
              if (!this.repositionTooltip()) return;
              try { this.tooltipWindow.showInactive(); } catch (_) { this.tooltipWindow.show(); }
            });
        });
      } catch (err) {
        safeConsole.error('show-tooltip 处理失败:', err);
      }
    });

    ipcMain.on('hide-tooltip', () => {
      this.hideTooltipWindow();
    });

    // 截图相关功能
    ipcMain.handle('start-screenshot', async () => {
      try {
        this.getOrCreateScreenshotManager();
        this.screenshotManager.startScreenshot();
        return { success: true };
      } catch (error) {
        safeConsole.error('启动截图失败:', error);
        return { success: false, error: error.message };
      }
    });

    // Download image to user's Downloads directory
    ipcMain.handle('download-image', async (_event, imagePath) => {
      try {
        if (!imagePath) return { success: false, error: 'no-path' };
        const src = String(imagePath).replace(/^file:\/\//, '');
        if (!fs.existsSync(src)) {
          return { success: false, error: 'not-found' };
        }

        let defaultDir = '';
        try { defaultDir = app.getPath('downloads'); } catch (err) { defaultDir = ''; }
        if (!defaultDir) {
          try { defaultDir = app.getPath('home'); } catch (err) { defaultDir = ''; }
        }

        const baseName = path.basename(src);
        const defaultPath = defaultDir ? path.join(defaultDir, baseName) : baseName;

        const { canceled, filePath } = await dialog.showSaveDialog({
          title: 'Save Image',
          defaultPath,
          buttonLabel: 'Save',
          filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        if (canceled || !filePath) {
          return { success: false, canceled: true };
        }

        await fs.promises.copyFile(src, filePath);
        return { success: true, path: filePath };
      } catch (err) {
        safeConsole.error('download-image error:', err);
        return { success: false, error: err.message };
      }
    });

    // Open image (use default external opener)
    ipcMain.handle('open-image', async (_event, imagePath) => {
      try {
        if (!imagePath) return { success: false, error: 'no-path' };
        const src = String(imagePath).replace(/^file:\/\//, '');
        // openExternal can handle file:// on many platforms; fallback to shell.openPath
        try {
          const { shell } = require('electron');
          // Prefer shell.openPath for full platform support
          const res = await shell.openPath(src);
          if (res) {
            // non-empty string indicates error on some platforms
            return { success: false, error: res };
          }
          return { success: true };
        } catch (e) {
          // fallback
          return { success: false, error: e.message };
        }
      } catch (err) {
        safeConsole.error('open-image error:', err);
        return { success: false, error: err.message };
      }
    });

    // show a native notification
    ipcMain.handle('show-notification', async (_event, payload) => {
      try {
        const { title = '', body = '' } = payload || {};
        try {
          const notif = new Notification({ title: String(title), body: String(body) });
          notif.show();
          return { success: true };
        } catch (e) {
          safeConsole.warn('Notification failed:', e);
          return { success: false, error: e.message };
        }
      } catch (err) {
        safeConsole.error('show-notification error:', err);
        return { success: false, error: err.message };
      }
    });

    // Extract QR codes from an image path (on-demand)
    ipcMain.handle('extract-qr-codes', async (_event, imagePath) => {
      try {
        if (!imagePath) return { success: false, qrcodes: [], error: 'no-path' };
        const qrcodes = await extractQRCodes(imagePath);
        return { success: true, qrcodes: Array.isArray(qrcodes) ? qrcodes : [] };
      } catch (err) {
        safeConsole.error('extract-qr-codes error:', err);
        return { success: false, qrcodes: [], error: err.message };
      }
    });

    // Copy QR content to clipboard
    ipcMain.handle('copy-qr-content', async (_event, content) => {
      try {
        clipboard.writeText(String(content || ''));
        return { success: true };
      } catch (err) {
        safeConsole.error('copy-qr-content error:', err);
        return { success: false, error: err.message };
      }
    });

    // Copy OCR content to clipboard
    ipcMain.handle('copy-ocr-content', async (_event, content) => {
      try {
        clipboard.writeText(String(content || ''));
        return { success: true };
      } catch (err) {
        safeConsole.error('copy-ocr-content error:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('recognize-ocr-text', async (_event, payload) => {
      try {
        return await ocrService.recognizeText(payload || {});
      } catch (err) {
        safeConsole.error('recognize-ocr-text error:', err);
        return {
          success: false,
          text: '',
          error: err && err.message ? err.message : 'ocr-main-process-failed'
        };
      }
    });

    ipcMain.handle('detect-ocr-runtime', async (_event, options) => {
      try {
        return await ocrService.detectRuntimeEnvironment(options || {});
      } catch (err) {
        safeConsole.error('detect-ocr-runtime error:', err);
        return {
          success: false,
          error: err && err.message ? err.message : 'ocr-runtime-detect-failed'
        };
      }
    });

    ipcMain.handle('redetect-ocr-runtime', async (_event, options) => {
      try {
        const result = await ocrService.redetectRuntimeEnvironment(options || {});
        if (result && result.config && Array.isArray(result.changedKeys) && result.changedKeys.length) {
          this.broadcastSettingsUpdated({
            success: !!result.success,
            changedKeys: result.changedKeys,
            config: result.config,
            error: result.error || null
          });
        }
        return result;
      } catch (err) {
        safeConsole.error('redetect-ocr-runtime error:', err);
        return {
          success: false,
          error: err && err.message ? err.message : 'ocr-runtime-redetect-failed'
        };
      }
    });

    const resolveResourcePath = (input) => {
      if (!input) return '';
      const value = String(input);
      try {
        if (/^file:\/\//i.test(value)) {
          return fileURLToPath(value);
        }
      } catch (_) {
        // fallthrough
      }
      if (path.isAbsolute(value)) return value;
      // Treat as app-relative (e.g. dist/assets/...)
      return path.join(app.getAppPath(), value);
    };

    const isPathInside = (child, parent) => {
      try {
        const parentResolved = path.resolve(parent);
        const childResolved = path.resolve(child);
        if (childResolved === parentResolved) return true;
        return childResolved.startsWith(parentResolved + path.sep);
      } catch (_) {
        return false;
      }
    };

    const isSafeAppResource = (absPath) => {
      if (!absPath) return false;
      const appPath = app.getAppPath();
      const resourcesPath = process.resourcesPath;
      return isPathInside(absPath, appPath) || (resourcesPath ? isPathInside(absPath, resourcesPath) : false);
    };

    ipcMain.handle('read-app-resource-binary', async (_event, input) => {
      try {
        const absPath = resolveResourcePath(input);
        if (!absPath) return { success: false, error: 'invalid-path' };
        if (!isSafeAppResource(absPath)) {
          return { success: false, error: 'path-not-allowed' };
        }
        const buf = await fs.promises.readFile(absPath);
        return { success: true, data: new Uint8Array(buf) };
      } catch (err) {
        safeConsole.error('read-app-resource-binary error:', err);
        return { success: false, error: err && err.message ? err.message : 'read-failed' };
      }
    });

    ipcMain.handle('read-app-resource-text', async (_event, input) => {
      try {
        const absPath = resolveResourcePath(input);
        if (!absPath) return { success: false, error: 'invalid-path' };
        if (!isSafeAppResource(absPath)) {
          return { success: false, error: 'path-not-allowed' };
        }
        const text = await fs.promises.readFile(absPath, 'utf-8');
        return { success: true, text: String(text || '') };
      } catch (err) {
        safeConsole.error('read-app-resource-text error:', err);
        return { success: false, error: err && err.message ? err.message : 'read-failed' };
      }
    });

    ipcMain.handle('open-ocr-window', async (_event, payload) => {
      try {
        this.openOcrWindow(payload || {});
        return { success: true };
      } catch (err) {
        safeConsole.error('open-ocr-window error:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('open-vision-chat', async (_event, payload) => {
      try {
        this.openVisionChatWindow(payload || {});
        return { success: true };
      } catch (err) {
        safeConsole.error('open-vision-chat error:', err);
        return { success: false, error: err && err.message ? err.message : 'open-vision-chat-failed' };
      }
    });

    ipcMain.handle('open-settings-window', async (_event, payload) => {
      try {
        this.openSettingsWindow(payload || {});
        return { success: true };
      } catch (err) {
        safeConsole.error('open-settings-window error:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('open-ocr-settings-window', async () => {
      try {
        this.openOcrSettingsWindow();
        return { success: true };
      } catch (err) {
        safeConsole.error('open-ocr-settings-window error:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('get-ocr-window-state', async () => {
      return this.getOcrWindowState();
    });

    ipcMain.handle('get-ocr-image-data', async (_event, token) => {
      try {
        const payload = this.getOcrImageTokenData(token);
        if (!payload) {
          return { success: false, error: 'ocr-image-token-missing' };
        }
        return {
          success: true,
          data: payload.data,
          mimeType: payload.mimeType
        };
      } catch (err) {
        safeConsole.error('get-ocr-image-data error:', err);
        return { success: false, error: err && err.message ? err.message : 'ocr-image-read-failed' };
      }
    });

    ipcMain.handle('release-ocr-image-token', async (_event, token) => {
      return { success: this.releaseOcrImageToken(token) };
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
    this.startX11Monitoring(); // 启动X11连接监控
    // 构建应用顶部菜单（将截图/设置从主窗口移到菜单）
    this.buildAppMenu();
    try {
      this.configureAutoLaunch(Config.get('launchOnStartup'));
    } catch (err) {
      safeConsole.warn('初始化自动启动配置失败:', err);
    }
  }

  // 构建应用菜单并挂载行为
  buildAppMenu() {
    try {
      if (process.platform !== 'darwin') {
        try { Menu.setApplicationMenu(null); } catch (_) { }
        try {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.setMenu(null);
          }
        } catch (_) { }
        safeConsole.log('非 macOS 平台已禁用窗口菜单栏');
        return;
      }

      // 从配置中获取实际的截图快捷键
      const screenshotShortcut = Config.get('screenshotShortcut') || 'CommandOrControl+Shift+S';

      // attempt to load translations for the configured locale so menu labels are localized
      let menuLabels = {};
      try {
        const locale = Config.get('locale') || (app && typeof app.getLocale === 'function' ? app.getLocale() : 'en');
        let localesDir;
        if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
          const projectRoot = path.resolve(__dirname, '..', '..');
          localesDir = path.join(projectRoot, 'locales');
        } else {
          localesDir = path.join(app.getAppPath(), 'locales');
          if (!fs.existsSync(localesDir)) localesDir = path.join(process.resourcesPath, 'locales');
        }

        const tryList = [];
        if (locale) tryList.push(locale);
        if (locale && locale.indexOf('-') !== -1) tryList.push(locale.split('-')[0]);
        tryList.push('en');

        for (const l of tryList) {
          const candidate = path.join(localesDir, `${l}.json`);
          if (fs.existsSync(candidate)) {
            try {
              const txt = fs.readFileSync(candidate, 'utf8');
              const json = JSON.parse(txt);
              menuLabels = json.menu || {};
              break;
            } catch (e) { continue; }
          }
        }
      } catch (e) {
        // ignore, fall back to defaults below
      }

      const template = [
        {
          label: menuLabels.features || 'Features',
          submenu: [
            {
              label: menuLabels.screenshot || 'Screenshot',
              accelerator: screenshotShortcut, // 使用配置中的实际快捷键
              click: () => {
                safeConsole.log('菜单: 截图 被点击');
                try {
                  this.getOrCreateScreenshotManager().startScreenshot();
                } catch (error) {
                  safeConsole.error('菜单启动截图失败:', error);
                }
              }
            },
            {
              label: menuLabels.settings || 'Settings',
              accelerator: 'CmdOrCtrl+,',
              click: () => {
                safeConsole.log('菜单: 设置 被点击');
                this.openSettingsWindow();
              }
            },
            {
              label: menuLabels.toggleDevTools || 'Toggle Developer Tools',
              accelerator: 'CmdOrCtrl+Shift+I',
              click: () => {
                safeConsole.log('菜单: Toggle Developer Tools 被点击');
                try {
                  const focused = BrowserWindow.getFocusedWindow && BrowserWindow.getFocusedWindow();
                  const target = focused || this.mainWindow;
                  if (target && !target.isDestroyed()) {
                    try {
                      if (target.webContents.isDevToolsOpened && target.webContents.isDevToolsOpened()) {
                        target.webContents.closeDevTools();
                      } else {
                        target.webContents.openDevTools({ mode: 'detach' });
                      }
                    } catch (e) {
                      target.webContents.toggleDevTools();
                    }
                  }
                } catch (e) {
                  if (this.mainWindow) {
                    try { this.mainWindow.toggleDevTools(); } catch (_) { }
                  }
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

  // 改进的清理资源方法 - 集成资源管理器
  async cleanup() {
    safeConsole.log('开始执行改进的资源清理...');

    try {
      // 第一步：注册资源到资源管理器（如果还没有注册）
      if (resourceManager) {
        // 确保所有窗口都已注册
        if (this.mainWindow && !resourceManager.resources.has('mainWindow')) {
          resourceManager.registerX11Resource('mainWindow', this.mainWindow);
        }
        if (this.tooltipWindow && !resourceManager.resources.has('tooltipWindow')) {
          resourceManager.registerX11Resource('tooltipWindow', this.tooltipWindow);
        }

        // 注册其他资源
        resourceManager.registerResource('clipboardManager', this.clipboardManager,
          () => this.clipboardManager.stopMonitoring(), 4);
        resourceManager.registerResource('trayManager', this.trayManager,
          () => this.trayManager.destroyTray(), 5);
      }

      // 第二步：优先清理X11相关资源
      if (resourceManager && resourceManager.hasX11Resources()) {
        safeConsole.log('优先清理X11资源...');
        resourceManager.forceCleanupX11();
      }

      // 第三步：清理快捷键（同步操作，快速执行）
      try {
        if (this._registeredShortcut) {
          globalShortcut.unregister(this._registeredShortcut);
        }
        if (this._registeredScreenshotShortcut) {
          globalShortcut.unregister(this._registeredScreenshotShortcut);
        }
        globalShortcut.unregisterAll();
        safeConsole.log('快捷键已清理');
      } catch (error) {
        safeConsole.warn('清理快捷键时出错:', error);
      }

      // 第四步：停止剪贴板监控
      try {
        if (this._clipboardListener) {
          try { this.clipboardManager.removeListener(this._clipboardListener); } catch (_) { }
          this._clipboardListener = null;
        }
        this.clipboardManager.stopMonitoring();
        safeConsole.log('剪贴板监控已停止');
      } catch (error) {
        safeConsole.warn('停止剪贴板监控时出错:', error);
      }

      // 第五步：关闭配置文件监控
      if (this._configWatcher) {
        try { this._configWatcher.close(); } catch (_) { }
        this._configWatcher = null;
      }
      if (this._configWatchTimer) {
        try { clearTimeout(this._configWatchTimer); } catch (_) { }
        this._configWatchTimer = null;
      }

      // 停止X11连接监控定时器
      if (this._x11MonitorTimer) {
        try { clearInterval(this._x11MonitorTimer); } catch (_) { }
        this._x11MonitorTimer = null;
      }

      this.releaseAllOcrImageTokens();

      // 第六步：使用资源管理器清理剩余资源
      if (resourceManager) {
        try {
          await resourceManager.cleanupAllResources({
            force: false,
            timeout: 2000
          });
          safeConsole.log('资源管理器清理完成');
        } catch (error) {
          safeConsole.warn('资源管理器清理时出错:', error);
        }
      }

      // 清理 IPC 管理器（如果使用）
      if (this.ipcManager && typeof this.ipcManager.cleanup === 'function') {
        try { this.ipcManager.cleanup(this.clipboardManager); } catch (_) { }
      }

      // 第七步：最后关闭主窗口（确保X11连接正确释放）
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        try {
          // 移除close事件监听器，避免隐藏行为干扰退出
          this.mainWindow.removeAllListeners('close');
          this.mainWindow.close();
          safeConsole.log('主窗口已关闭');
        } catch (error) {
          safeConsole.warn('关闭主窗口时出错:', error);
        }
      }

      // 第八步：停止X11监控
      this._x11ConnectionMonitoring = false;

      safeConsole.log('资源清理完成');

    } catch (error) {
      safeConsole.error('清理资源时发生错误:', error);
      throw error;
    }
  }
}

module.exports = MainProcess;

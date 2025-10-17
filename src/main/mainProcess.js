const { BrowserWindow, globalShortcut, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
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
    // 支持通过环境变量 CLIPBOARD_GOD_MAX_HISTORY 来覆盖默认的最大历史数
    const maxHistoryEnv = process.env.CLIPBOARD_GOD_MAX_HISTORY ? parseInt(process.env.CLIPBOARD_GOD_MAX_HISTORY, 10) : undefined;
    this.clipboardManager = new ClipboardManager({ maxHistory: maxHistoryEnv });
    this.trayManager = new TrayManager();
    this.screenshotManager = null;
    this.clipboardCheckInterval = null;
    // 用于防止重复粘贴：记录最近一次粘贴的 id 和时间，以及粘贴锁
    this._lastPaste = { id: null, time: 0 };
    this._pasteLock = false;
    this._registeredShortcut = null;
    // 当正在执行粘贴操作时，短暂抑制任何会显示主窗口的自动行为
    this._suppressShow = false;
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

    // 加载 UI 界面
    this.mainWindow.loadFile('index.html');

    // 当用户点击关闭按钮时，隐藏窗口而不是退出应用
    this.mainWindow.on('close', (event) => {
      // 阻止默认的关闭行为
      event.preventDefault();
      // 隐藏窗口
      this.mainWindow.hide();
      safeConsole.log('主窗口已隐藏');
    });

    // 当窗口关闭时，取消引用窗口对象（仅在真正退出应用时发生）
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
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
      if (this._suppressShow) {
        safeConsole.log('抑制全局快捷键触发（正在执行粘贴）');
        return;
      }

      safeConsole.log(`全局快捷键 ${shortcut} 被触发`);
      if (this.mainWindow) {
        this.mainWindow.isVisible() ? this.mainWindow.hide() : this.mainWindow.show();
      }
    });

    if (!ret) {
      safeConsole.log('全局快捷键注册失败');
    }

    // 检查快捷键是否注册成功
    safeConsole.log('全局快捷键是否注册:', globalShortcut.isRegistered(shortcut));
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
      const result = Config.setMany(values);

      // 如果快捷键设置发生变化，重新注册快捷键
      if (values.globalShortcut && values.globalShortcut !== Config.get('globalShortcut')) {
        this.registerGlobalShortcuts();
      }

      safeConsole.log('设置保存结果:', result);
      return result;
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
        this._suppressShow = true;
        if (this.mainWindow) this.mainWindow.__suppressShow = true;
        setTimeout(() => {
          this._suppressShow = false;
          if (this.mainWindow) this.mainWindow.__suppressShow = false;
        }, 500);

        // 等待一小段时间以确保焦点切换回前一个应用
        setTimeout(() => {
          // 写入剪贴板并执行粘贴
          PasteHandler.writeAndPaste(item)
            .then(() => {
              safeConsole.log('粘贴操作完成');
              this._pasteLock = false;
            })
            .catch((error) => {
              safeConsole.error('粘贴操作失败:', error);
              this._pasteLock = false;
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
    this.createWindow();
    this.trayManager.createTray(this.mainWindow);
    this.registerGlobalShortcuts();
    this.startClipboardMonitoring();
    this.setupIpcHandlers();
  }

  // 清理资源
  cleanup() {
    // 清理资源
    if (this._registeredShortcut) {
      globalShortcut.unregister(this._registeredShortcut);
    }
    globalShortcut.unregisterAll();
    this.clipboardManager.stopMonitoring();
    this.trayManager.destroyTray();

    // 在退出应用时关闭主窗口
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // 移除close事件监听器，避免隐藏行为干扰退出
      this.mainWindow.removeAllListeners('close');
      this.mainWindow.close();
    }
  }
}

module.exports = MainProcess;
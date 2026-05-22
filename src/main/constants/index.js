/**
 * 应用常量定义
 * 包含所有应用级别的常量和配置
 */

const path = require('path');
const electron = require('electron');

const APP_NAME = 'Clipboard God';
const DEFAULT_WINDOW_SIZE = { width: 400, height: 600 };
const DEFAULT_TOOLTIP_SIZE = { width: 420, height: 200 };

// 默认快捷键配置
const DEFAULT_SHORTCUTS = {
    showWindow: 'CommandOrControl+Alt+V',
    screenshot: 'CommandOrControl+Shift+S',
    openSettings: 'CmdOrCtrl+,'
};

// IPC通道定义
const IPC_CHANNELS = {
    // 剪贴板相关
    GET_HISTORY: 'get-history',
    HISTORY_DATA: 'history-data',
    UPDATE_HISTORY: 'update-history',

    // 设置相关
    GET_SETTINGS: 'get-settings',
    SET_SETTINGS: 'set-settings',
    SETTINGS_UPDATED: 'settings-updated',

    // 粘贴相关
    PASTE_ITEM: 'paste-item',
    HIDE_WINDOW: 'hide-window',
    RESET_SELECTION: 'reset-selection',

    // 截图相关
    START_SCREENSHOT: 'start-screenshot',

    // 编辑和固定
    EDIT_ITEM: 'edit-item',
    PIN_ITEM: 'pin-item',

    // Tooltip相关
    SHOW_TOOLTIP: 'show-tooltip',
    HIDE_TOOLTIP: 'hide-tooltip',
    HIDE_CONTEXT_MENU: 'hide-context-menu',

    // 文件操作
    DOWNLOAD_IMAGE: 'download-image',
    OPEN_IMAGE: 'open-image',

    // 通知
    SHOW_NOTIFICATION: 'show-notification',

    // AI相关
    AI_GET_CONFIG: 'ai-get-config',
    AI_INJECTED_CONFIG: 'injected-config',

    // 全局快捷键
    GLOBAL_SHORTCUT: 'global-shortcut',

    // 国际化
    GET_LOCALE: 'get-locale',
    SET_LOCALE: 'set-locale',
    LOCALE_CHANGED: 'locale-changed',
    GET_TRANSLATIONS: 'get-translations',

    // 错误处理
    ERROR: 'error',
    CLIPBOARD_READ_ERROR: 'clipboard-read-error',
    SETTINGS_SAVE_ERROR: 'settings-save-error'
};

// 配置文件路径
const CONFIG_PATHS = {
    config: path.join(electron.app.getPath('userData'), 'config.json'),
    db: path.join(electron.app.getPath('userData'), 'clipboard.db'),
    logs: path.join(electron.app.getPath('userData'), 'logs')
};

// 应用状态
const APP_STATES = {
    INITIALIZING: 'initializing',
    RUNNING: 'running',
    PASTING: 'pasting',
    CLEANING: 'cleaning',
    EXITING: 'exiting'
};

// 默认配置
const DEFAULT_CONFIG = {
    maxHistoryItems: 500,
    globalShortcut: DEFAULT_SHORTCUTS.showWindow,
    screenshotShortcut: DEFAULT_SHORTCUTS.screenshot,
    launchOnStartup: false,
    enableTooltips: true,
    locale: 'en',
    llms: {},
    theme: 'light',
    previewLength: 120
};

module.exports = {
    APP_NAME,
    DEFAULT_WINDOW_SIZE,
    DEFAULT_TOOLTIP_SIZE,
    DEFAULT_SHORTCUTS,
    IPC_CHANNELS,
    CONFIG_PATHS,
    APP_STATES,
    DEFAULT_CONFIG
};

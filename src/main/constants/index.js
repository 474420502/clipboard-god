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
    CONFIG_PATHS,
    APP_STATES,
    DEFAULT_CONFIG
};

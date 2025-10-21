const { contextBridge, ipcRenderer } = require('electron');

// 在 window 对象上暴露一个安全的 API 给 React 代码
contextBridge.exposeInMainWorld('electronAPI', {
  // 渲染器 -> 主进程 (调用)
  getHistory: () => ipcRenderer.send('get-history'),
  pasteItem: (item) => ipcRenderer.send('paste-item', item),
  startScreenshot: () => ipcRenderer.invoke('start-screenshot'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
  hideWindow: () => ipcRenderer.send('hide-window'),

  // --- 主进程 -> 渲染器 (监听) ---
  onUpdateHistory: (callback) => ipcRenderer.on('update-history', (_event, value) => callback(value)),
  onError: (callback) => ipcRenderer.on('error', (_event, value) => callback(value)),
  onHistoryData: (callback) => ipcRenderer.on('history-data', (_event, value) => callback(value)),
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', callback),
  onTakeScreenshot: (callback) => ipcRenderer.on('take-screenshot', callback),
  onGlobalShortcut: (callback) => ipcRenderer.on('global-shortcut', callback),
  onSettingsUpdated: (callback) => ipcRenderer.on('settings-updated', (_event, value) => callback(value)),
  // Tooltip controls
  showTooltip: (payload) => ipcRenderer.send('show-tooltip', payload),
  hideTooltip: () => ipcRenderer.send('hide-tooltip'),

  // 清理所有监听器
  cleanupListeners: () => {
    ipcRenderer.removeAllListeners('update-history');
    ipcRenderer.removeAllListeners('error');
    ipcRenderer.removeAllListeners('history-data');
    ipcRenderer.removeAllListeners('open-settings');
    ipcRenderer.removeAllListeners('take-screenshot');
    ipcRenderer.removeAllListeners('global-shortcut');
    ipcRenderer.removeAllListeners('settings-updated');
  }
});

// 简单的 locale API，供纯静态页面（如 chatPage.html）或渲染器使用
contextBridge.exposeInMainWorld('localeAPI', {
  getLocale: () => ipcRenderer.invoke('get-locale'),
  setLocale: (locale) => ipcRenderer.invoke('set-locale', locale),
  // 返回整个 translations 对象（主进程负责读取本地 files）
  getTranslations: (locale) => ipcRenderer.invoke('get-translations', locale),
  onLocaleChanged: (cb) => ipcRenderer.on('locale-changed', (_event, locale) => cb(locale))
});
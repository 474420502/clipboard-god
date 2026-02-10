const { contextBridge, ipcRenderer } = require('electron');

// 在 window 对象上暴露一个安全的 API 给 React 代码
contextBridge.exposeInMainWorld('electronAPI', {
  // 渲染器 -> 主进程 (调用)
  getHistory: () => ipcRenderer.send('get-history'),
  pasteItem: (item) => ipcRenderer.send('paste-item', item),
  editItem: (dbId, newContent) => ipcRenderer.invoke('edit-item', { dbId, newContent }),
  pinItem: (dbId, pinned) => ipcRenderer.invoke('pin-item', { dbId, pinned }),
  startScreenshot: () => ipcRenderer.invoke('start-screenshot'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
  hideWindow: () => ipcRenderer.send('hide-window'),

  // --- 主进程 -> 渲染器 (监听) ---
  onUpdateHistory: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('update-history', listener);
    return () => ipcRenderer.removeListener('update-history', listener);
  },
  onError: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('error', listener);
    return () => ipcRenderer.removeListener('error', listener);
  },
  onHistoryData: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('history-data', listener);
    return () => ipcRenderer.removeListener('history-data', listener);
  },
  onOpenSettings: (callback) => {
    const listener = (...args) => callback(...args);
    ipcRenderer.on('open-settings', listener);
    return () => ipcRenderer.removeListener('open-settings', listener);
  },
  onTakeScreenshot: (callback) => {
    const listener = (...args) => callback(...args);
    ipcRenderer.on('take-screenshot', listener);
    return () => ipcRenderer.removeListener('take-screenshot', listener);
  },
  onGlobalShortcut: (callback) => {
    const listener = (...args) => callback(...args);
    ipcRenderer.on('global-shortcut', listener);
    return () => ipcRenderer.removeListener('global-shortcut', listener);
  },
  onResetSelection: (callback) => {
    const listener = (_event) => callback();
    ipcRenderer.on('reset-selection', listener);
    return () => ipcRenderer.removeListener('reset-selection', listener);
  },
  onSettingsUpdated: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('settings-updated', listener);
    return () => ipcRenderer.removeListener('settings-updated', listener);
  },
  onHideContextMenu: (callback) => {
    const listener = (_event) => callback();
    ipcRenderer.on('hide-context-menu', listener);
    return () => ipcRenderer.removeListener('hide-context-menu', listener);
  },
  // Tooltip controls
  showTooltip: (payload) => ipcRenderer.send('show-tooltip', payload),
  hideTooltip: () => ipcRenderer.send('hide-tooltip'),
  // Image utilities
  downloadImage: (imagePath) => ipcRenderer.invoke('download-image', imagePath),
  openImage: (imagePath) => ipcRenderer.invoke('open-image', imagePath),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  // QR code utilities
  extractQRCodes: (imagePath) => ipcRenderer.invoke('extract-qr-codes', imagePath),
  copyQRCodeContent: (content) => ipcRenderer.invoke('copy-qr-content', content),
  // OCR utilities
  extractOCRText: (imagePath, languages, preprocess) => ipcRenderer.invoke('extract-ocr-text', { imagePath, languages, preprocess }),
  copyOCRContent: (content) => ipcRenderer.invoke('copy-ocr-content', content),

  // cleanupListeners removed; use per-listener unsubscribe functions instead
});

// 简单的 locale API，供纯静态页面（如 chatPage.html）或渲染器使用
contextBridge.exposeInMainWorld('localeAPI', {
  getLocale: () => ipcRenderer.invoke('get-locale'),
  setLocale: (locale) => ipcRenderer.invoke('set-locale', locale),
  // 返回整个 translations 对象（主进程负责读取本地 files）
  getTranslations: (locale) => ipcRenderer.invoke('get-translations', locale),
  onLocaleChanged: (cb) => ipcRenderer.on('locale-changed', (_event, locale) => cb(locale))
});
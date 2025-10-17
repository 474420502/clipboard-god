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

  // 主进程 -> 渲染器 (监听)
  onUpdateHistory: (callback) => {
    if (typeof callback === 'function') {
      ipcRenderer.on('update-history', (_event, value) => callback(value));
    }
  },
  onError: (callback) => {
    if (typeof callback === 'function') {
      ipcRenderer.on('error', (_event, value) => callback(value));
    }
  },
  
  // 暴露 ipcRenderer 以支持更多事件监听
  ipcRenderer: {
    on: (channel, func) => ipcRenderer.on(channel, func),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
  },
  
  // 清理监听器（好习惯）
  cleanupListeners: () => {
    ipcRenderer.removeAllListeners('update-history');
    ipcRenderer.removeAllListeners('error');
    ipcRenderer.removeAllListeners('history-data');
  }
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aiAPI', {
    // Stream events coming from main process (ai-window specific)
    onStream: (cb) => {
        try {
            ipcRenderer.on('ai-stream', (_event, chunk) => cb(chunk));
        } catch (e) { /* ignore */ }
    },
    onComplete: (cb) => {
        try {
            ipcRenderer.on('ai-stream-complete', (_event, info) => cb(info));
        } catch (e) { /* ignore */ }
    },
    // Request initial injected config from main process via invoke
    getConfig: async () => {
        try {
            return await ipcRenderer.invoke('ai-get-config');
        } catch (e) { return null; }
    },
    // Send an LLM request (renderer -> main). Returns a promise.
    sendInput: (payload) => {
        try {
            return ipcRenderer.invoke('llm-request', payload);
        } catch (e) { return Promise.reject(e); }
    }
});

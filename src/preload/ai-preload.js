
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aiAPI', {
    // Stream events coming from main process (ai-window specific)
    onStream: (cb) => {
        try {
            const listener = (_event, chunk) => cb(chunk);
            ipcRenderer.on('ai-stream', listener);
            return () => ipcRenderer.removeListener('ai-stream', listener);
        } catch (e) { /* ignore */ }
    },
    onComplete: (cb) => {
        try {
            const listener = (_event, info) => cb(info);
            ipcRenderer.on('ai-stream-complete', listener);
            return () => ipcRenderer.removeListener('ai-stream-complete', listener);
        } catch (e) { /* ignore */ }
    },
    // Request initial injected config from main process via invoke
    getConfig: async () => {
        try {
            return await ipcRenderer.invoke('ai-get-config');
        } catch (e) { return null; }
    },
    // Listen for proactive injected config pushed from main (avoid race conditions)
    onInjectedConfig: (cb) => {
        try {
            const listener = (_event, cfg) => cb(cfg);
            ipcRenderer.on('injected-config', listener);
            return () => ipcRenderer.removeListener('injected-config', listener);
        } catch (e) { /* ignore */ }
    },
    // Send an LLM request (renderer -> main). Returns a promise.
    sendInput: (payload) => {
        try {
            return ipcRenderer.invoke('llm-request', payload);
        } catch (e) { return Promise.reject(e); }
    }
});

// Expose the same locale API to AI chat windows so static pages can load translations
try {
    contextBridge.exposeInMainWorld('localeAPI', {
        getLocale: async () => {
            try { return await ipcRenderer.invoke('get-locale'); } catch (e) { return null; }
        },
        setLocale: async (locale) => {
            try { return await ipcRenderer.invoke('set-locale', locale); } catch (e) { return { success: false, error: e && e.message }; }
        },
        getTranslations: async (locale) => {
            try { return await ipcRenderer.invoke('get-translations', locale); } catch (e) { return null; }
        },
        onLocaleChanged: (cb) => {
            try {
                const listener = (_event, locale) => cb(locale);
                ipcRenderer.on('locale-changed', listener);
                return () => ipcRenderer.removeListener('locale-changed', listener);
            } catch (e) { /* ignore */ }
        }
    });
} catch (e) {
    // ignore failures exposing localeAPI
}


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
    // Listen for proactive injected config pushed from main (avoid race conditions)
    onInjectedConfig: (cb) => {
        try {
            ipcRenderer.on('injected-config', (_event, cfg) => cb(cfg));
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
            try { ipcRenderer.on('locale-changed', (_event, locale) => cb(locale)); } catch (e) { /* ignore */ }
        }
    });
} catch (e) {
    // ignore failures exposing localeAPI
}

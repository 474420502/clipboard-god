const { hasMeaningfulText, toTrimmedString } = require('./utils');
const aiModule = require('./index');
const ollama = require('./ollama');
const openapi = require('./openapi');

class AiService {
    constructor({
        mainProcess,
        safeConsole,
        Config,
        clipboard,
        BrowserWindow,
        globalShortcut,
        Notification,
        ipcMain,
    }) {
        this.main = mainProcess;
        this.safeConsole = safeConsole;
        this.Config = Config;
        this.clipboard = clipboard;
        this.BrowserWindow = BrowserWindow;
        this.globalShortcut = globalShortcut;
        this.Notification = Notification;
        this.ipcMain = ipcMain;

        this._registeredShortcuts = [];
    }

    /** Attach IPC handlers for AI / LLM interactions. */
    registerIpcHandlers() {
        if (!this.ipcMain) return;
        try { this.ipcMain.removeHandler('llm-request'); } catch (_) { }
        this.ipcMain.handle('llm-request', (event, payload) => this.handleLlmRequest(event, payload));

        try { this.ipcMain.removeHandler('ai-send'); } catch (_) { }
        this.ipcMain.handle('ai-send', (event, text) => this.handleAiSend(event, text));
    }

    /** Re-register all configured LLM shortcuts. */
    registerShortcuts() {
        try {
            for (const shortcut of this._registeredShortcuts) {
                try { this.globalShortcut.unregister(shortcut); } catch (_) { }
            }
        } catch (err) {
            this.safeConsole.warn('Unregistering previous LLM shortcuts failed:', err);
        }
        this._registeredShortcuts = [];

        const llms = this.Config.get('llms') || {};
        for (const [name, entry] of Object.entries(llms)) {
            try {
                const shortcut = entry && entry.llmShortcut;
                if (!hasMeaningfulText(shortcut)) continue;
                const ok = this.globalShortcut.register(shortcut, async () => {
                    this.safeConsole.log(`LLM 条目 ${entry && entry.inputType} ${name} 快捷键 ${shortcut} 被触发`);
                    try {
                        await this.triggerFromClipboardForEntry(name, entry);
                    } catch (err) {
                        this.safeConsole.error('Trigger LLM for entry failed:', err);
                    }
                });
                if (ok) this._registeredShortcuts.push(shortcut);
                this.safeConsole.log(`注册 LLM 条目快捷键 ${name}:`, shortcut, 'ok=', ok);
            } catch (err) {
                this.safeConsole.warn('注册 LLM 条目快捷键失败:', name, err);
            }
        }
    }

    /** Trigger LLM using current clipboard/selection context. */
    async triggerFromClipboard() {
        try {
            const { clipboardInput, inputType } = await this._resolveClipboardInput();
            const cfg = this.Config.getAll();
            const llms = cfg.llms || {};
            const names = Object.keys(llms || {});
            if (names.length === 0) {
                const llmCfg = cfg.llm || {};
                const apitype = llmCfg.apitype || 'ollama';
                const baseurl = llmCfg.baseurl;
                const model = llmCfg.model;
                const apikey = llmCfg.apikey;
                const params = llmCfg;
                const fakeEvent = { sender: this.main.mainWindow && this.main.mainWindow.webContents };
                if (apitype === 'ollama') {
                    await this.callOllamaStream(fakeEvent, { baseurl, model, apikey, params, input: clipboardInput, inputType });
                } else {
                    await this.callOpenApiStream(fakeEvent, { baseurl, model, apikey, params, input: clipboardInput, inputType });
                }
                return;
            }
            const firstName = names[0];
            const entry = llms[firstName];
            await this.triggerFromClipboardForEntry(firstName, entry, clipboardInput);
        } catch (err) {
            this.safeConsole.error('LLM trigger error:', err);
            try {
                if (this.main.mainWindow && this.main.mainWindow.webContents) {
                    this.main.mainWindow.webContents.send('llm-complete', { success: false, error: err.message });
                }
            } catch (_) { }
        }
    }

    /** Trigger a specific LLM entry. */
    async triggerFromClipboardForEntry(name, entry, explicitInput) {
        try {
            let input = explicitInput;
            if (!hasMeaningfulText(input)) {
                input = await this._resolvePreferredInput(entry);
            }

            if (!entry) throw new Error('LLM 条目不存在');
            const apitype = entry.apitype || 'ollama';
            const baseurl = entry.baseurl;
            const model = entry.model;
            const apikey = entry.apikey;
            const params = { ...(entry || {}) };

            try {
                if (typeof params.prompt === 'string' && hasMeaningfulText(input) && params.prompt.includes('{{text}}')) {
                    params.prompt = params.prompt.split('{{text}}').join(String(input));
                }
                if (typeof params.template === 'string' && hasMeaningfulText(input) && params.template.includes('{{text}}')) {
                    params.template = params.template.split('{{text}}').join(String(input));
                }
            } catch (_) { }

            const fakeEvent = { sender: this.main.mainWindow && this.main.mainWindow.webContents };
            if (apitype === 'ollama') {
                await this.callOllamaStream(fakeEvent, { baseurl, model, apikey, params, input });
            } else {
                await this.callOpenApiStream(fakeEvent, { baseurl, model, apikey, params, input });
            }
        } catch (err) {
            this.safeConsole.error('Trigger LLM entry failed:', name, err);
            try {
                if (this.main.mainWindow && this.main.mainWindow.webContents) {
                    this.main.mainWindow.webContents.send('llm-complete', { success: false, error: err.message });
                }
            } catch (_) { }
        }
    }

    /** Handle renderer llm-request IPC. */
    async handleLlmRequest(event, payload) {
        try {
            const cfg = this.Config.getAll();
            const llmCfg = cfg.llm || {};
            const apitype = (payload && payload.apitype) || llmCfg.apitype || 'ollama';
            const baseurl = (payload && payload.baseurl) || llmCfg.baseurl || '';
            const model = (payload && payload.model) || llmCfg.model || '';
            const apikey = (payload && payload.apikey) || llmCfg.apikey || '';
            const params = Object.assign({}, llmCfg, payload.params || {});

            if (apitype === 'ollama') {
                await this.callOllamaStream(event, { baseurl, model, apikey, params, input: payload.input });
            } else {
                await this.callOpenApiStream(event, { baseurl, model, apikey, params, input: payload.input });
            }
            return { success: true };
        } catch (err) {
            this.safeConsole.error('llm-request failed:', err);
            try { event.sender.send('llm-complete', { success: false, error: err.message }); } catch (_) { }
            return { success: false, error: err.message };
        }
    }

    /** Handle AI window send events. */
    async handleAiSend(event, text) {
        try {
            this.safeConsole.log('ai-send invoked with text:', typeof text === 'string' ? text : JSON.stringify(text));
            const aiContext = await this._readAiContext();
            const selectionInfo = await this._resolveSelection();

            // Build messages for chat-style APIs. If the AI window has context, treat it as its own
            // user message and then append the user's send-button text as a separate user message.
            // If no aiContext, prefer selection text as the single user message (legacy behavior).
            const hasAiContext = hasMeaningfulText(aiContext);
            const sendText = typeof text === 'string' ? text : String(text || '');
            const selectionFallback = hasMeaningfulText(selectionInfo.text) ? selectionInfo.text : null;

            this.safeConsole.log('ai-send resolved sources; aiContext=', hasAiContext, 'selection=', !!selectionFallback, 'sendText=', sendText);

            // Ensure AI window shows the user's send text for UI continuity (same as before)
            await this._ensureAiWindowPrimed(hasAiContext ? sendText : (selectionFallback || sendText), sendText, hasAiContext);

            const cfg = this.Config.getAll();
            const llms = cfg.llms || {};
            const names = Object.keys(llms || {});

            if (names.length === 0) {
                const llmCfg = cfg.llm || {};
                const apitype = llmCfg.apitype || 'ollama';
                const baseurl = llmCfg.baseurl;
                const model = llmCfg.model;
                const apikey = llmCfg.apikey;
                const params = llmCfg;
                const fakeEvent = { sender: this.main.mainWindow && this.main.mainWindow.webContents };
                if (apitype === 'ollama') {
                    const entryName = '_legacy';
                    const conversation = this._ensureConversation(entryName);
                    // build messages array from existing conversation
                    const messages = [].concat(conversation || []);
                    if (hasAiContext) {
                        messages.push({ role: 'user', content: String(aiContext) });
                        // persist aiContext into conversation history as separate message
                        conversation.push({ role: 'user', content: String(aiContext) });
                    }
                    if (hasAiContext) {
                        messages.push({ role: 'user', content: String(sendText) });
                        conversation.push({ role: 'user', content: String(sendText) });
                    } else {
                        const payload = selectionFallback || sendText;
                        messages.push({ role: 'user', content: String(payload) });
                        conversation.push({ role: 'user', content: String(payload) });
                    }
                    await this.callOllamaChatStream(fakeEvent, { baseurl, model, apikey, messages, params: Object.assign({}, params, { _entryName: entryName }) });
                } else {
                    // For non-chat OpenAPI endpoints, fall back to combining context and send text into one input
                    const combined = hasAiContext ? `\n${aiContext}\n---\n\n${sendText}\n---` : (selectionFallback || sendText);
                    await this.callOpenApiStream(fakeEvent, { baseurl, model, apikey, params, input: combined });
                }
                return { success: true };
            }

            const firstName = names[0];
            const entry = llms[firstName];
            this.safeConsole.log('ai-send using entry:', firstName, 'entry config:', entry && { apitype: entry.apitype, model: entry.model });

            try {
                const conversation = this._ensureConversation(firstName);
                if (entry && hasMeaningfulText(entry.system)) {
                    const hasSystem = conversation.some(m => m.role === 'system');
                    if (!hasSystem) conversation.unshift({ role: 'system', content: String(entry.system) });
                }

                // Build messages array and persist user messages into conversation history
                const messages = [].concat(conversation || []);
                if (hasAiContext) {
                    messages.push({ role: 'user', content: String(aiContext) });
                    conversation.push({ role: 'user', content: String(aiContext) });
                    messages.push({ role: 'user', content: String(sendText) });
                    conversation.push({ role: 'user', content: String(sendText) });
                } else {
                    const payload = selectionFallback || sendText;
                    messages.push({ role: 'user', content: String(payload) });
                    conversation.push({ role: 'user', content: String(payload) });
                }

                if (entry && (entry.apitype === 'ollama' || (!entry.apitype && entry.model))) {
                    const fakeEvent = { sender: this.main.mainWindow && this.main.mainWindow.webContents };
                    await this.callOllamaChatStream(fakeEvent, { baseurl: entry.baseurl, model: entry.model, apikey: entry.apikey, messages, params: Object.assign({}, entry, { _entryName: firstName }) });
                } else {
                    // Non-chat endpoints: combine aiContext and sendText into a single input as fallback
                    const combined = hasAiContext ? `\n${aiContext}\n---\n\n${sendText}\n---` : (selectionFallback || sendText);
                    await this.triggerFromClipboardForEntry(firstName, entry, combined);
                }
            } catch (err) {
                this.safeConsole.error('ai-send conversation handling failed:', err);
                await this.triggerFromClipboardForEntry(firstName, entry, effectiveInput);
            }

            return { success: true };
        } catch (err) {
            this.safeConsole.error('ai-send handler failed:', err);
            return { success: false, error: err && err.message };
        }
    }

    /** Receive streaming tokens from aiModule. */
    onStreamToken(token) {
        try {
            if (!token) return;
            let parsed = null;
            try { parsed = JSON.parse(String(token)); } catch (_) { parsed = null; }
            if (parsed && typeof parsed === 'object') {
                if (parsed.response) {
                    this.main._aiStreamingBuffer = (this.main._aiStreamingBuffer || '') + String(parsed.response);
                }
                if (parsed.done) {
                    try {
                        const name = this.main._aiStreamingActiveName;
                        if (name) {
                            const conversation = this._ensureConversation(name);
                            conversation.push({ role: 'assistant', content: String(this.main._aiStreamingBuffer || '') });
                        }
                    } catch (_) { }
                    this.main._aiStreamingBuffer = '';
                    this.main._aiStreamingActiveName = null;
                }
            } else {
                this.main._aiStreamingBuffer = (this.main._aiStreamingBuffer || '') + String(token);
            }
        } catch (e) {
            this.safeConsole.warn('Error in onStreamToken:', e && e.message);
        }
    }

    /** Delegate to shared renderer streaming helper. */
    async streamResponseToRenderer(event, res) {
        return aiModule.streamResponseToRenderer(event, res, this.main);
    }

    async callOllamaStream(event, { baseurl, model, apikey, params, input }) {
        try {
            const prompt = (params && (params.prompt || params.template)) || input || '';
            this.safeConsole.log('Calling Ollama stream with', { baseurl, model, prompt, input, params });
            try {
                // Ensure ai window exists but do not overwrite existing content.
                const hadWindow = !!(this.main.aiWindow && !this.main.aiWindow.isDestroyed());
                aiModule.createAiWindow(this.main);
                if (hadWindow) {
                    try { this.main.aiWindow.webContents.send('ai-stream', JSON.stringify({ response: '' })); } catch (_) { }
                } else {
                    // If we just created the window, load a minimal loading page so the renderer is ready.
                    try { aiModule.showLoading(this.main, ''); } catch (_) { }
                }
            } catch (_) { }
            await ollama.ollamaGenerateCompletion(event, { baseurl, apikey, model, prompt, stream: true, ...params }, this._simpleFetch.bind(this), this.streamResponseToRenderer.bind(this));
        } catch (err) {
            this.safeConsole.error('调用 Ollama 失败:', err);
            this._emitFailure(event, 'Ollama 请求失败', err);
        }
    }

    async callOllamaChatStream(event, { baseurl, model, apikey, messages, params }) {
        try {
            this.safeConsole.log('Calling Ollama chat stream with', { baseurl, model, messagesSummary: (messages || []).map(m => ({ role: m.role, len: (m.content || '').length })) });
            try { aiModule.showLoading(this.main, '正在生成...'); } catch (_) { }
            try {
                const hadWindow = !!(this.main.aiWindow && !this.main.aiWindow.isDestroyed());
                aiModule.createAiWindow(this.main);
                if (hadWindow) {
                    try { this.main.aiWindow.webContents.send('ai-stream', JSON.stringify({ response: '' })); } catch (_) { }
                } else {
                    try { aiModule.showLoading(this.main, '正在生成...'); } catch (_) { }
                }
            } catch (_) { }
            try {
                const active = (params && params._entryName) ? String(params._entryName) : null;
                this.main._aiStreamingActiveName = active;
                this.main._aiStreamingBuffer = '';
            } catch (_) {
                this.main._aiStreamingActiveName = null;
                this.main._aiStreamingBuffer = '';
            }
            await ollama.ollamaChatCompletion(event, { baseurl, apikey, model, messages, stream: true, ...params }, this._simpleFetch.bind(this), this.streamResponseToRenderer.bind(this));
            try {
                if (this.main._aiStreamingActiveName && hasMeaningfulText(this.main._aiStreamingBuffer)) {
                    const conversation = this._ensureConversation(this.main._aiStreamingActiveName);
                    conversation.push({ role: 'assistant', content: String(this.main._aiStreamingBuffer) });
                }
            } catch (_) { }
            this.main._aiStreamingActiveName = null;
            this.main._aiStreamingBuffer = '';
        } catch (err) {
            this.safeConsole.error('调用 Ollama chat 失败:', err);
            this._emitFailure(event, 'Ollama Chat 请求失败', err);
        }
    }

    async callOpenApiStream(event, { baseurl, model, apikey, params, input }) {
        try {
            const prompt = (params && params.prompt) || input || '';
            this.safeConsole.log('Calling OpenAPI stream with', { baseurl, model, prompt, input, params });
            try {
                const hadWindow = !!(this.main.aiWindow && !this.main.aiWindow.isDestroyed());
                aiModule.createAiWindow(this.main);
                if (hadWindow) {
                    try { this.main.aiWindow.webContents.send('ai-stream', JSON.stringify({ response: '' })); } catch (_) { }
                } else {
                    try { aiModule.showLoading(this.main, '正在生成...'); } catch (_) { }
                }
            } catch (_) { }
            await openapi.openapiChatCompletion(event, { baseurl, apikey, model, prompt, stream: true, ...params }, this._simpleFetch.bind(this), this.streamResponseToRenderer.bind(this));
        } catch (err) {
            this.safeConsole.error('调用 OpenAPI helper 失败:', err);
            this._emitFailure(event, 'OpenAPI 请求失败', err);
        }
    }

    async _simpleFetch(url, options = {}) {
        let undici;
        try { undici = require('undici'); } catch (_) { undici = null; }
        if (undici && undici.fetch) {
            return undici.fetch(url, options);
        }
        const { URL } = require('url');
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? require('https') : require('http');
        return new Promise((resolve, reject) => {
            const req = lib.request(url, {
                method: options.method || 'GET',
                headers: options.headers || {},
            }, (res) => resolve(res));
            req.on('error', reject);
            if (options.body) {
                if (typeof options.body === 'string' || Buffer.isBuffer(options.body)) req.write(options.body);
                else req.write(JSON.stringify(options.body));
            }
            req.end();
        });
    }

    _emitFailure(event, title, err) {
        try { if (event && event.sender) event.sender.send('llm-complete', { success: false, error: err && err.message }); } catch (_) { }
        try {
            const body = err && err.message ? String(err.message) : '未知错误';
            if (this.Notification && typeof this.Notification === 'function') {
                new this.Notification({ title, body }).show();
            } else if (this.main.mainWindow && this.main.mainWindow.webContents) {
                this.main.mainWindow.webContents.send('error', body);
            }
        } catch (_) { }
    }

    async _resolveClipboardInput() {
        const formats = this.clipboard.availableFormats();
        let input = '';
        let inputType = 'text';
        if (formats.includes('text/plain')) {
            input = this.clipboard.readText();
            inputType = 'text';
        } else if (formats.includes('image/png') || formats.includes('image/jpeg')) {
            const img = this.clipboard.readImage();
            if (!img.isEmpty()) {
                input = img.toDataURL();
                inputType = 'image';
            }
        }
        return { clipboardInput: input, inputType };
    }

    async _resolvePreferredInput(entry) {
        let input;
        try {
            const sel = this.clipboard.readText('selection') || '';
            if (hasMeaningfulText(sel)) {
                input = sel;
                this.safeConsole.log('_triggerLlmFromClipboardForEntry: using primary selection as input');
            }
        } catch (_) { }

        if (!hasMeaningfulText(input)) {
            try {
                const focused = this.BrowserWindow.getFocusedWindow ? this.BrowserWindow.getFocusedWindow() : null;
                if (focused && focused !== this.main.aiWindow && focused !== this.main.mainWindow && focused.webContents && typeof focused.webContents.executeJavaScript === 'function') {
                    const winSel = await focused.webContents.executeJavaScript('window.getSelection ? window.getSelection().toString() : ""', true);
                    if (hasMeaningfulText(winSel)) {
                        input = winSel;
                        this.safeConsole.log('_triggerLlmFromClipboardForEntry: using focused window selection as input');
                    }
                }
            } catch (_) { }
        }

        if (!hasMeaningfulText(input)) {
            const formats = this.clipboard.availableFormats();
            const desired = (entry && entry.inputType) ? String(entry.inputType) : 'text';
            if (desired === 'text') {
                if (formats.includes('text/plain')) {
                    input = this.clipboard.readText();
                } else if (formats.includes('image/png') || formats.includes('image/jpeg')) {
                    const img = this.clipboard.readImage();
                    if (!img.isEmpty()) input = img.toDataURL();
                }
            } else if (desired === 'image') {
                if (formats.includes('image/png') || formats.includes('image/jpeg')) {
                    const img = this.clipboard.readImage();
                    if (!img.isEmpty()) input = img.toDataURL();
                } else if (formats.includes('text/plain')) {
                    input = this.clipboard.readText();
                }
            } else {
                if (formats.includes('text/plain')) {
                    input = this.clipboard.readText();
                } else if (formats.includes('image/png') || formats.includes('image/jpeg')) {
                    const img = this.clipboard.readImage();
                    if (!img.isEmpty()) input = img.toDataURL();
                }
            }
            this.safeConsole.log('_triggerLlmFromClipboardForEntry: using clipboard fallback as input');
        }

        return input;
    }

    async _resolveSelection() {
        let text = '';
        let source = null;
        try {
            const sel = this.clipboard.readText('selection') || '';
            if (hasMeaningfulText(sel)) {
                text = sel;
                source = 'primary-selection';
            }
        } catch (_) { }

        if (!hasMeaningfulText(text)) {
            try {
                const focused = this.BrowserWindow.getFocusedWindow ? this.BrowserWindow.getFocusedWindow() : null;
                if (focused && focused !== this.main.aiWindow && focused !== this.main.mainWindow && focused.webContents && typeof focused.webContents.executeJavaScript === 'function') {
                    const winSel = await focused.webContents.executeJavaScript('window.getSelection ? window.getSelection().toString() : ""', true);
                    if (hasMeaningfulText(winSel)) {
                        text = winSel;
                        source = 'focused-window-selection';
                    }
                } else if (focused === this.main.aiWindow || focused === this.main.mainWindow) {
                    this.safeConsole.log('ai-send: focused window is app window; skipping focused-window selection read');
                }
            } catch (_) { }
        }

        if (!hasMeaningfulText(text)) {
            try {
                const clip = this.clipboard.readText() || '';
                if (hasMeaningfulText(clip)) {
                    text = clip;
                    source = 'clipboard';
                }
            } catch (_) { }
        }

        return { text, source };
    }

    async _readAiContext() {
        if (!this.main.aiWindow || this.main.aiWindow.isDestroyed() || !this.main.aiWindow.webContents) return '';
        try {
            const ctx = await this.main.aiWindow.webContents.executeJavaScript('document.getElementById("ai-box") ? document.getElementById("ai-box").innerText : ""', true);
            return toTrimmedString(ctx);
        } catch (_) {
            return '';
        }
    }

    async _ensureAiWindowPrimed(initialContent, userText, hasExistingContext) {
        if (!this.main.aiWindow || this.main.aiWindow.isDestroyed()) {
            aiModule.showLoading(this.main, initialContent);
            return;
        }
        try {
            this.main.aiWindow.webContents.send('ai-append-user-message', userText);
        } catch (err) {
            this.safeConsole.warn('Failed to append user message to AI window:', err);
            if (!hasExistingContext) {
                aiModule.showLoading(this.main, initialContent);
            }
        }
    }

    _ensureConversation(name) {
        this.main._aiConversations = this.main._aiConversations || {};
        this.main._aiConversations[name] = this.main._aiConversations[name] || [];
        return this.main._aiConversations[name];
    }
}

module.exports = {
    AiService,
};

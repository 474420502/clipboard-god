const { contextBridge, ipcRenderer } = require('electron');

// helpers
function appendToBox(text) {
    try {
        const box = typeof document !== 'undefined' ? document.getElementById('ai-box') : null;
        if (box) {
            box.innerText = (box.innerText || '') + String(text || '');
            box.scrollTop = box.scrollHeight;
        }
    } catch (e) { }
}

function setMeta(html) {
    try {
        const el = typeof document !== 'undefined' ? document.getElementById('ai-meta') : null;
        if (el) el.innerHTML = html || '';
    } catch (e) { }
}

// Status helpers: show streaming status and tokens/sec
let tokenTimestamps = [];
function updateStatusStreaming(newTokensCount) {
    try {
        const el = typeof document !== 'undefined' ? document.getElementById('ai-status') : null;
        if (!el) return;
        const now = Date.now();
        for (let i = 0; i < newTokensCount; i++) tokenTimestamps.push(now);
        // Keep timestamps within last 10s window
        const windowMs = 10000;
        tokenTimestamps = tokenTimestamps.filter(ts => (now - ts) <= windowMs);
        // tokens per second averaged over last 3s to be smoother
        const shortWindow = 3000;
        const shortCount = tokenTimestamps.filter(ts => (now - ts) <= shortWindow).length;
        const tps = Math.round((shortCount / (shortWindow / 1000)) * 10) / 10; // one decimal
        el.innerText = `生成中... ${tps} token/s`;
    } catch (e) { }
}

function setStatusDone() {
    try {
        const el = typeof document !== 'undefined' ? document.getElementById('ai-status') : null;
        if (!el) return;
        el.innerText = '完成';
        tokenTimestamps = [];
    } catch (e) { }
}

// Automatically append tokens to #ai-box when messages arrive.
ipcRenderer.on('ai-stream', (ev, token) => {
    // token might be a raw string or a JSON-encoded chunk
    if (!token) return;
    // try parse JSON
    let parsed = null;
    try { parsed = JSON.parse(token); } catch (_) { }
    if (parsed && typeof parsed === 'object') {
        // incremental response
        if (parsed.response) {
            appendToBox(parsed.response);
            // approximate token count using words/whitespace heuristic (simple)
            const approxTokens = Math.max(1, Math.round(String(parsed.response).split(/\s+/).length / 0.75));
            updateStatusStreaming(approxTokens);
        }
        // if done, send meta and mark status done
        if (parsed.done) {
            // compile useful metadata fields
            const model = parsed.model || '';
            const created = parsed.created_at || '';
            const total = parsed.total_duration ? (parsed.total_duration + ' ns') : '';
            const load = parsed.load_duration ? (parsed.load_duration + ' ns') : '';
            const evalCount = parsed.prompt_eval_count || parsed.eval_count || '';
            const evalDur = parsed.eval_duration ? (parsed.eval_duration + ' ns') : '';
            const metaHtml = `<div><strong>Model:</strong> ${model} &nbsp; <strong>Created:</strong> ${created}</div>` +
                `<div><strong>Total:</strong> ${total} &nbsp; <strong>Load:</strong> ${load} &nbsp; <strong>Eval count:</strong> ${evalCount} &nbsp; <strong>Eval duration:</strong> ${evalDur}</div>`;
            setMeta(metaHtml);
            // mark completion in status bar
            setStatusDone();
            // notify main world
            ipcRenderer.emit('ai-done');
        }
    } else {
        // not JSON, append raw and update status
        appendToBox(token);
        const approxTokens = Math.max(1, Math.round(String(token).split(/\s+/).length / 0.75));
        updateStatusStreaming(approxTokens);
    }
});

ipcRenderer.on('ai-stream-complete', (_event, info) => {
    try {
        setStatusDone();
    } catch (_) { }
    try { setMeta((info && info.info) ? JSON.stringify(info.info) : ''); } catch (e) { }
});

// Handle appending user messages from main process
ipcRenderer.on('ai-append-user-message', (_event, text) => {
    try {
        const b = document.getElementById('ai-box');
        if (b) {
            const block = `\n---\n${String(text || '')}\n---\n`;
            b.innerText = (b.innerText || '') + block;
            b.scrollTop = b.scrollHeight;
        }
    } catch (e) { }
});

// Keep a minimal compatibility API for page scripts
contextBridge.exposeInMainWorld('ai', {
    send: async (text) => ipcRenderer.invoke('ai-send', text),
    onToken: (cb) => ipcRenderer.on('ai-stream', (ev, token) => cb(token)),
    onComplete: (cb) => ipcRenderer.on('ai-stream-complete', (ev, info) => cb(info))
});

// wire send button when DOM ready
window.addEventListener('DOMContentLoaded', () => {
    try {
        const btn = document.getElementById('ai-send');
        const ta = document.getElementById('ai-input');
        if (btn && ta) {
            btn.addEventListener('click', async () => {
                const v = ta.value || '';
                if (!v) return;
                // append user message to ai-box with separators to reflect conversation continuation
                try {
                    const b = document.getElementById('ai-box');
                    if (b) {
                        const block = `\n---\n${v}\n---\n`;
                        b.innerText = (b.innerText || '') + block;
                        b.scrollTop = b.scrollHeight;
                    }
                } catch (e) { }
                ta.value = '';
                try { await ipcRenderer.invoke('ai-send', v); } catch (e) { console.error('ai-send invoke error', e); }
            });
        }
    } catch (e) { }
});

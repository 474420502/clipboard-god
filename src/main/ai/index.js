const { BrowserWindow } = require('electron');
const path = require('path');

// Minimal AI window + streaming helper.
// Ensures mainProcess._onAiStreamToken(token) is called for each parsed token.

let aiWindow = null;

function createAiWindow(mainProcess) {
    if (aiWindow && !aiWindow.isDestroyed()) return aiWindow;
    try {
        let desiredHeight = 360;
        try {
            if (mainProcess && mainProcess.mainWindow && !mainProcess.mainWindow.isDestroyed()) {
                const b = mainProcess.mainWindow.getBounds();
                if (b && typeof b.height === 'number') desiredHeight = Math.max(200, Math.round(b.height));
            }
        } catch (_) { }

        aiWindow = new BrowserWindow({
            width: 560,
            height: desiredHeight,
            show: false,
            frame: true,
            resizable: true,
            webPreferences: {
                preload: path.join(__dirname, '..', '..', 'preload', 'ai-preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
            },
        });

        aiWindow.on('closed', () => {
            aiWindow = null;
            if (mainProcess) mainProcess.aiWindow = null;
        });
        if (mainProcess) mainProcess.aiWindow = aiWindow;

        // sync height
        try {
            if (mainProcess && mainProcess.mainWindow && !mainProcess.mainWindow.isDestroyed()) {
                const syncHandler = () => {
                    try {
                        const b = mainProcess.mainWindow.getBounds();
                        if (b && typeof b.height === 'number' && aiWindow && !aiWindow.isDestroyed()) aiWindow.setBounds({ width: aiWindow.getBounds().width, height: Math.max(200, Math.round(b.height)) });
                    } catch (_) { }
                };
                mainProcess.mainWindow.on('resize', syncHandler);
                aiWindow.on('closed', () => { try { mainProcess.mainWindow && mainProcess.mainWindow.removeListener('resize', syncHandler); } catch (_) { } });
            }
        } catch (_) { }
    } catch (err) {
        try { console.error('createAiWindow failed:', err); } catch (_) { }
        aiWindow = null;
        if (mainProcess) mainProcess.aiWindow = null;
    }
    return aiWindow;
}

function showLoading(mainProcess, content = '正在生成...1') {
    createAiWindow(mainProcess);
    if (!aiWindow || aiWindow.isDestroyed()) return;
    const pageHtml = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>html,body{height:100%;margin:0;background:#111;color:#fff;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial;} body{display:flex;flex-direction:column;height:100%;} .box{padding:12px;white-space:pre-wrap;word-break:break-word;flex:1;overflow:auto;} .meta{padding:8px 12px;color:#ccc;font-size:12px;border-top:1px solid rgba(255,255,255,0.04);} .status{padding:6px 12px;color:#bcd;font-size:13px;border-top:1px solid rgba(255,255,255,0.03);background:linear-gradient(90deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));} .input{display:flex;padding:8px;border-top:1px solid rgba(255,255,255,0.04);align-items:center;} textarea{flex:1;min-height:48px;max-height:160px;padding:8px;border-radius:4px;border:1px solid rgba(255,255,255,0.06);background:#0f0f0f;color:#fff;resize:vertical;} button{margin-left:8px;padding:8px 12px;border-radius:4px;border:0;background:#1f7cff;color:#fff;}</style></head><body><div class="box" id="ai-box">${content}</div><div class="meta" id="ai-meta"></div><div class="status" id="ai-status">就绪</div><div class="input"><textarea id="ai-input" placeholder="Type a follow-up or new prompt..."></textarea><button id="ai-send">Send</button></div></body></html>`;
    try { aiWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pageHtml)); } catch (_) { }
    try { aiWindow.show(); } catch (_) { }
}

function chooseSender(mainProcess, event) {
    if (aiWindow && !aiWindow.isDestroyed()) return aiWindow.webContents;
    if (mainProcess && mainProcess.tooltipWindow && !mainProcess.tooltipWindow.isDestroyed()) return mainProcess.tooltipWindow.webContents;
    return event && event.sender;
}

function notifyMainOfToken(token, mainProcess) {
    try { if (mainProcess && typeof mainProcess._onAiStreamToken === 'function') mainProcess._onAiStreamToken(token); } catch (_) { }
}

async function streamResponseToRenderer(event, res, mainProcess) {
    const sender = chooseSender(mainProcess, event);
    if (!res) return;

    // Fetch-style readable stream
    if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (value) buffer += decoder.decode(value, { stream: true });
            while (true) {
                const idx = buffer.indexOf('\n');
                if (idx === -1) break;
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (!line) continue;
                const payload = line.startsWith('data:') ? line.replace(/^data:\s*/, '') : line;
                notifyMainOfToken(payload, mainProcess);
                try {
                    if (aiWindow && !aiWindow.isDestroyed() && sender === aiWindow.webContents) aiWindow.webContents.send && aiWindow.webContents.send('ai-stream', payload);
                    else if (mainProcess && mainProcess.tooltipWindow && !mainProcess.tooltipWindow.isDestroyed() && sender === mainProcess.tooltipWindow.webContents) mainProcess.tooltipWindow.webContents.executeJavaScript(`(function(){const b=document.getElementById('box'); if(b){ b.innerText = (b.innerText||'') + '\n' + ${JSON.stringify(payload)}; } })()`).catch(() => { });
                    else sender && sender.send && sender.send('llm-stream', payload);
                } catch (_) { }
            }
            if (done) break;
        }
        if (buffer && buffer.trim()) {
            const tail = buffer.trim();
            notifyMainOfToken(tail, mainProcess);
            try { sender && sender.send && sender.send('llm-stream', tail); } catch (_) { }
        }
        try { sender && sender.send && sender.send('llm-complete', { success: true }); } catch (_) { }
        return;
    }

    // Node.js stream
    const stream = res;
    try { stream.setEncoding && stream.setEncoding('utf8'); } catch (_) { }
    let acc = '';
    stream.on('data', (chunk) => {
        try {
            acc += String(chunk || '');
            const parts = acc.split(/\r?\n/);
            acc = parts.pop();
            for (const p of parts) {
                const line = p.trim();
                if (!line) continue;
                const payload = line.startsWith('data:') ? line.replace(/^data:\s*/, '') : line;
                notifyMainOfToken(payload, mainProcess);
                try {
                    if (aiWindow && !aiWindow.isDestroyed() && sender === aiWindow.webContents) aiWindow.webContents.send && aiWindow.webContents.send('ai-stream', payload);
                    else if (mainProcess && mainProcess.tooltipWindow && !mainProcess.tooltipWindow.isDestroyed() && sender === mainProcess.tooltipWindow.webContents) mainProcess.tooltipWindow.webContents.executeJavaScript(`(function(){const b=document.getElementById('box'); if(b){ b.innerText = (b.innerText||'') + '\n' + ${JSON.stringify(payload)}; } })()`).catch(() => { });
                    else sender && sender.send && sender.send('llm-stream', payload);
                } catch (_) { }
            }
        } catch (_) { }
    });

    stream.on('end', () => {
        try {
            if (acc && acc.trim()) {
                const tail = acc.trim();
                notifyMainOfToken(tail, mainProcess);
                try { sender && sender.send && sender.send('llm-stream', tail); } catch (_) { }
            }
            try { sender && sender.send && sender.send('llm-complete', { success: true }); } catch (_) { }
        } catch (_) { }
    });

    stream.on('error', (err) => {
        try { sender && sender.send && sender.send('llm-complete', { success: false, error: err && err.message }); } catch (_) { }
    });
}

module.exports = {
    createAiWindow,
    showLoading,
    streamResponseToRenderer,
    _internal_getAiWindow: () => aiWindow,
};

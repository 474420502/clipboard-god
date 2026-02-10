let initPromise = null;
let ocrModule = null;

try {
    if (typeof globalThis !== 'undefined') {
        if (!globalThis.Module) globalThis.Module = {};
        if (!globalThis.module) globalThis.module = { exports: {} };
        if (!globalThis.exports) globalThis.exports = globalThis.module.exports;
    }
} catch (_) { }

const ensureInit = async () => {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        await import('@paddlejs/paddlejs-backend-webgl');
        const mod = await import('@paddlejs-models/ocr');
        ocrModule = mod && mod.default ? mod.default : mod;
        if (!ocrModule || typeof ocrModule.init !== 'function') {
            throw new Error('paddle-ocr-init-failed');
        }
        await ocrModule.init();
        return true;
    })().catch((err) => {
        try { console.error('Paddle OCR init failed:', err); } catch (_) { }
        initPromise = null;
        throw err;
    });
    return initPromise;
};

const normalizeImageSrc = (input) => {
    if (!input || typeof input !== 'string') return '';
    if (input.startsWith('data:image/')) return input;
    if (input.startsWith('file://')) return input;
    return `file://${encodeURI(input)}`;
};

const loadImage = (input) => new Promise((resolve, reject) => {
    const src = normalizeImageSrc(input);
    if (!src) {
        reject(new Error('invalid-image'));
        return;
    }

    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image-load-failed'));
    img.src = src;
});

const recognizeWithPaddle = async (imageInput, options = {}) => {
    try {
        await ensureInit();
        const img = await loadImage(imageInput);
        const canvas = options.canvas || document.createElement('canvas');
        const res = await ocrModule.recognize(img, {
            canvas,
            style: options.style
        });

        const textArr = Array.isArray(res?.text)
            ? res.text
            : (res?.text ? [String(res.text)] : []);

        return {
            text: textArr.join('\n'),
            points: res?.points || []
        };
    } catch (err) {
        try { console.error('Paddle OCR recognize failed:', err); } catch (_) { }
        return {
            text: '',
            points: [],
            error: err && err.message ? err.message : 'paddle-ocr-failed'
        };
    }
};

export { recognizeWithPaddle };

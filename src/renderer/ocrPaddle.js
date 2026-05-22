import { recognizeWithPaddleV5 } from '../pp-ocr-v5';

let initPromise = null;
let ocrModule = null;
// let ocrEngine = 'paddlejs';
let ocrEngine = 'v5';

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
    if (input.startsWith('blob:')) return input;
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

const resolveEngine = (options = {}) => {
    if (options.engine) return options.engine;
    if (typeof ocrEngine === 'string' && ocrEngine) return ocrEngine;
    if (typeof globalThis !== 'undefined' && typeof globalThis.__OCR_ENGINE__ === 'string') {
        return globalThis.__OCR_ENGINE__;
    }
    return 'paddlejs';
};

const recognizeWithPaddle = async (imageInput, options = {}) => {
    try {
        const engine = resolveEngine(options);
        if (engine === 'v5' || engine === 'paddle-v5' || engine === 'paddleocr-v5') {
            const { engine: _engine, ...rest } = options || {};
            if (rest.upscaleOnLowConfidence === undefined) {
                rest.upscaleOnLowConfidence = { enabled: true };
            }
            try {
                if (typeof globalThis !== 'undefined' && globalThis.__OCR_DEBUG__ === true) {
                    const cur = rest.upscaleOnLowConfidence && typeof rest.upscaleOnLowConfidence === 'object'
                        ? rest.upscaleOnLowConfidence
                        : { enabled: true };
                    rest.upscaleOnLowConfidence = {
                        attempts: 3,
                        debug: true,
                        ...cur,
                        enabled: cur.enabled !== false
                    };
                }
            } catch (_) { }
            return await recognizeWithPaddleV5(imageInput, rest);
        }

        await ensureInit();
        const img = await loadImage(imageInput);

        // 直接使用原图，让 paddlejs 内部处理预处理
        const canvas = options.canvas || document.createElement('canvas');

        const res = await ocrModule.recognize(img, {
            canvas,
            style: options.style
        });

        const textArr = Array.isArray(res?.text)
            ? res.text.map((item) => String(item))
            : (res?.text ? [String(res.text)] : []);

        const pointsArr = Array.isArray(res?.points) ? res.points : [];
        const blocks = textArr.map((text, index) => ({
            id: String(index),
            text,
            points: Array.isArray(pointsArr[index]) ? pointsArr[index] : []
        }));

        return {
            text: textArr.join('\n'),
            points: pointsArr,
            blocks
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

const setOcrEngine = (engine) => {
    ocrEngine = engine || 'paddlejs';
};

export { recognizeWithPaddle, setOcrEngine };
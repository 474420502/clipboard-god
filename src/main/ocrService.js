const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, nativeImage } = require('electron');
const { createWorker, PSM, OEM } = require('tesseract.js');
const fetch = require('node-fetch');

let workerPromise = null;
let workerInstance = null;
let currentWorkerLangs = '';

const DEFAULT_OCR_LANGUAGES = ['chi_sim', 'eng', 'jpn', 'deu', 'fra', 'spa', 'rus'];
const TESSDATA_BASE_URL = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main';

const resolveUserDataPath = () => {
    try {
        if (app && typeof app.getPath === 'function') {
            const userData = app.getPath('userData');
            if (userData) return userData;
        }
    } catch (err) {
        // ignore
    }

    const base = process.env.APPDATA ||
        (process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support')
            : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')));
    return path.join(base, 'clipboard-god');
};

const resolveTessdataDir = () => path.join(resolveUserDataPath(), 'tessdata');

const ensureTessdataDir = async () => {
    const dir = resolveTessdataDir();
    await fs.promises.mkdir(dir, { recursive: true });
    process.env.TESSDATA_PREFIX = dir;
    return dir;
};

const getTraineddataPath = (dir, lang) => path.join(dir, `${lang}.traineddata`);

const resolveBundledTessdataDirs = () => {
    const dirs = new Set();
    try {
        if (app && typeof app.getAppPath === 'function') {
            const appPath = app.getAppPath();
            if (appPath) dirs.add(path.join(appPath, 'tessdata'));
        }
    } catch (err) {
        // ignore
    }

    if (process.resourcesPath) {
        dirs.add(path.join(process.resourcesPath, 'tessdata'));
    }

    const cwd = process.cwd();
    if (cwd) dirs.add(path.join(cwd, 'tessdata'));

    return Array.from(dirs).filter((dir) => {
        try {
            return fs.existsSync(dir);
        } catch (err) {
            return false;
        }
    });
};

const findBundledTraineddata = (lang) => {
    const candidates = resolveBundledTessdataDirs();
    for (const dir of candidates) {
        const candidate = getTraineddataPath(dir, lang);
        if (fs.existsSync(candidate)) return candidate;
    }
    return '';
};

const downloadTraineddata = async (dir, lang) => {
    const url = `${TESSDATA_BASE_URL}/${encodeURIComponent(lang)}.traineddata`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`failed to download ${lang}: ${res.status} ${res.statusText}`);
    }
    const buffer = await res.buffer();
    const target = getTraineddataPath(dir, lang);
    const temp = `${target}.tmp`;
    await fs.promises.writeFile(temp, buffer);
    await fs.promises.rename(temp, target);
};

const ensureLanguageData = async (languages) => {
    const dir = await ensureTessdataDir();
    const keepSet = new Set(languages.map((lang) => String(lang || '').trim()).filter(Boolean));
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (!entry.name.endsWith('.traineddata')) continue;
            const lang = entry.name.replace(/\.traineddata$/i, '');
            if (!keepSet.has(lang)) {
                try {
                    await fs.promises.unlink(path.join(dir, entry.name));
                } catch (err) {
                    // ignore
                }
            }
        }
    } catch (err) {
        // ignore cleanup errors
    }
    const missing = [];
    const copied = [];
    for (const lang of languages) {
        const target = getTraineddataPath(dir, lang);
        if (fs.existsSync(target)) continue;
        const bundled = findBundledTraineddata(lang);
        if (bundled) {
            await fs.promises.copyFile(bundled, target);
            copied.push(lang);
            continue;
        }
        missing.push(lang);
    }

    if (!missing.length) {
        return { dir, missing: [], downloaded: [], failed: [], copied };
    }

    const downloaded = [];
    const failed = [];
    for (const lang of missing) {
        try {
            await downloadTraineddata(dir, lang);
            downloaded.push(lang);
        } catch (err) {
            failed.push(lang);
        }
    }

    return { dir, missing, downloaded, failed, copied };
};

const buildWorkerOptions = (tessdataDir) => ({
    logger: () => { },
    errorHandler: () => { },
    langPath: tessdataDir,
    cachePath: tessdataDir,
    cacheMethod: 'readOnly',
    gzip: false
});

const buildOcrParams = (preprocess) => {
    const params = {
        tessedit_pageseg_mode: PSM.AUTO
    };

    if (preprocess && preprocess.dpi300) {
        params.user_defined_dpi = '300';
    }
    if (preprocess && preprocess.preserveSpaces) {
        params.preserve_interword_spaces = '1';
    }

    return params;
};

const applyOcrParameters = async (worker, preprocess) => {
    if (!worker || typeof worker.setParameters !== 'function') return;
    const params = buildOcrParams(preprocess);
    await worker.setParameters(params);
};

const normalizeLanguages = (languages) => {
    if (!languages) return DEFAULT_OCR_LANGUAGES;
    const list = Array.isArray(languages)
        ? languages
        : (typeof languages === 'string' ? languages.split('+') : []);
    const cleaned = list.map((lang) => String(lang || '').trim()).filter(Boolean);
    return cleaned.length ? cleaned : DEFAULT_OCR_LANGUAGES;
};

const ensureWorker = async (languagesInput) => {
    if (workerInstance) return workerInstance;
    if (workerPromise) return workerPromise;

    const languages = normalizeLanguages(languagesInput);
    const languagesArg = Array.isArray(languages)
        ? languages.join('+')
        : (typeof languages === 'string' ? languages : 'eng');

    // tesseract.js v5 使用简化 API
    workerPromise = (async () => {
        const prep = await ensureLanguageData(languages);
        if (prep.failed.length) {
            const error = new Error('ocr language download failed');
            error.code = 'ocr-lang-download-failed';
            error.details = {
                langs: prep.failed,
                path: prep.dir,
                url: TESSDATA_BASE_URL
            };
            throw error;
        }

        const workerOptions = buildWorkerOptions(prep.dir);
        const worker = await createWorker(languagesArg, OEM.DEFAULT, workerOptions);
        await applyOcrParameters(worker, null);
        workerInstance = worker;
        currentWorkerLangs = languagesArg;
        return workerInstance;
    })().catch((err) => {
        workerPromise = null;
        workerInstance = null;
        throw err;
    });

    return workerPromise;
};

const loadImageBuffer = async (input) => {
    if (!input) return null;
    if (Buffer.isBuffer(input)) return input;
    if (typeof input !== 'string') return null;

    if (input.startsWith('data:image/')) {
        const parts = input.split(',');
        if (parts.length < 2) return null;
        return Buffer.from(parts[1], 'base64');
    }

    const imagePath = input.replace(/^file:\/\//, '');
    try {
        const stat = await fs.promises.stat(imagePath);
        if (!stat.isFile()) return null;
    } catch (err) {
        return null;
    }
    return fs.promises.readFile(imagePath);
};

const toPngBuffer = (buffer) => {
    const image = nativeImage.createFromBuffer(buffer);
    if (!image || image.isEmpty()) return null;
    return image.toPNG();
};

// Apply image preprocessing for better OCR accuracy
const preprocessImage = (buffer, preprocess = {}) => {
    if (!preprocess || (!preprocess.binarize && !preprocess.contrast && !preprocess.denoise)) {
        return buffer;
    }

    try {
        // Create a simple pixel manipulation using nativeImage
        const image = nativeImage.createFromBuffer(buffer);
        if (!image || image.isEmpty()) return buffer;

        const size = image.getSize();
        const width = size.width;
        const height = size.height;

        // For now, return original buffer as nativeImage doesn't support direct pixel manipulation
        // In a full implementation, you could use a library like sharp or canvas
        // This is a placeholder for where preprocessing would be applied
        return buffer;
    } catch (err) {
        console.warn('Image preprocessing failed:', err);
        return buffer;
    }
};

const recognizeText = async (imageInput, languagesInput, preprocess = null) => {
    const buffer = await loadImageBuffer(imageInput);
    if (!buffer) return { success: false, text: '', error: 'invalid-image' };

    // Apply preprocessing if enabled
    const processedBuffer = preprocessImage(buffer, preprocess);

    const pngBuffer = toPngBuffer(processedBuffer);
    if (!pngBuffer) return { success: false, text: '', error: 'invalid-image' };

    try {
        const languages = normalizeLanguages(languagesInput);
        const languagesArg = Array.isArray(languages)
            ? languages.join('+')
            : (typeof languages === 'string' ? languages : 'eng');
        const worker = await ensureWorker(languages);
        if (!worker || typeof worker.recognize !== 'function') {
            return { success: false, text: '', error: 'ocr-unavailable' };
        }

        if (currentWorkerLangs && currentWorkerLangs !== languagesArg && typeof worker.reinitialize === 'function') {
            const prep = await ensureLanguageData(languages);
            if (prep.failed.length) {
                const error = new Error('ocr language download failed');
                error.code = 'ocr-lang-download-failed';
                error.details = {
                    langs: prep.failed,
                    path: prep.dir,
                    url: TESSDATA_BASE_URL
                };
                throw error;
            }
            await worker.reinitialize(languagesArg, OEM.DEFAULT);
            await applyOcrParameters(worker, preprocess);
            currentWorkerLangs = languagesArg;
        }

        await applyOcrParameters(worker, preprocess);

        const { data } = await worker.recognize(pngBuffer);
        const text = data && data.text ? String(data.text).trim() : '';

        // Calculate confidence from OCR result
        let confidence = null;
        if (data && data.confidence) {
            confidence = data.confidence;
        } else if (data && data.confidence === 0 && data.words && Array.isArray(data.words)) {
            // Calculate average confidence from words
            const confidences = data.words
                .map(w => w && w.confidence)
                .filter(c => typeof c === 'number');
            if (confidences.length > 0) {
                confidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
            }
        }

        return { success: true, text, confidence };
    } catch (err) {
        if (err && err.code === 'ocr-lang-download-failed') {
            return { success: false, text: '', error: err.code, details: err.details || {} };
        }
        return { success: false, text: '', error: err.message || 'ocr-failed' };
    }
};

module.exports = {
    recognizeText
};
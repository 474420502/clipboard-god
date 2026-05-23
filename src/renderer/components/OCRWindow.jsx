import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { recognizeWithPaddle } from '../ocrPaddle';

const getSearchParam = (key) => {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const value = params.get(key);
        return value ? decodeURIComponent(value) : '';
    } catch (_) {
        return '';
    }
};

const getBoolParam = (key) => {
    const raw = String(getSearchParam(key) || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};

const normalizePoint = (point) => {
    if (Array.isArray(point)) {
        return { x: Number(point[0] || 0), y: Number(point[1] || 0) };
    }
    if (point && typeof point === 'object') {
        return { x: Number(point.x || 0), y: Number(point.y || 0) };
    }
    return { x: 0, y: 0 };
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const DEFAULT_LANGS = ['chi_sim', 'eng'];
const DEFAULT_OCR_TEXT_LAYOUT = {
    lineMergeThresholdRatio: 0.5,
    lineMergeThresholdPx: 0,
    spaceGapRatio: 0.2,
    spaceGapMinPx: 2,
    insertSpaceByGap: true,
    splitByGap: true
};

const isPaddleVlCliSource = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'paddleocr-vl-cli' || normalized === 'paddleocr-vl';
};

const normalizeLanguages = (languages) => {
    const next = Array.isArray(languages)
        ? languages.map((lang) => String(lang || '').trim()).filter(Boolean)
        : [];
    return next.length ? next : [...DEFAULT_LANGS];
};

const normalizeOcrPayload = (payload = {}) => ({
    imagePath: typeof payload.imagePath === 'string' ? payload.imagePath : '',
    imageToken: typeof payload.imageToken === 'string' ? payload.imageToken : '',
    languages: normalizeLanguages(payload.languages)
});

const createInitialOcrPayload = () => {
    const imagePath = getSearchParam('imagePath');
    const initialLangs = getSearchParam('langs');
    const parsedLangs = initialLangs
        ? initialLangs.split(',').map((lang) => String(lang || '').trim()).filter(Boolean)
        : [];
    return normalizeOcrPayload({ imagePath, languages: parsedLangs });
};

const buildImageSrcFromPath = (imagePath) => {
    if (!imagePath) return '';
    if (imagePath.startsWith('data:image/')) return imagePath;
    if (imagePath.startsWith('file://')) return imagePath;
    return `file://${encodeURI(imagePath)}`;
};

const serializeOcrSettings = (settings) => JSON.stringify(settings || {});

function OCRWindow() {
    const { t } = useTranslation();
    const initialPayload = useMemo(() => createInitialOcrPayload(), []);

    const [loading, setLoading] = useState(true);
    const [loadingPayload, setLoadingPayload] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [error, setError] = useState('');
    const [blocks, setBlocks] = useState([]);
    const [fullText, setFullText] = useState('');
    const [confidence, setConfidence] = useState(null);
    const [upscaled, setUpscaled] = useState(false);
    const [upscaleScale, setUpscaleScale] = useState(1);
    const [activeBlockId, setActiveBlockId] = useState(null);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectionRect, setSelectionRect] = useState(null);
    const [selecting, setSelecting] = useState(false);
    const [runtimeNotice, setRuntimeNotice] = useState('');
    const [ocrPayload, setOcrPayload] = useState(initialPayload);
    const [resolvedImageSrc, setResolvedImageSrc] = useState(() => buildImageSrcFromPath(initialPayload.imagePath));
    const [selectedLanguages, setSelectedLanguages] = useState(initialPayload.languages);
    const [draftLanguages, setDraftLanguages] = useState(initialPayload.languages);
    const [activeMenu, setActiveMenu] = useState(null); // 'menu' | null
    const [activeMenuSection, setActiveMenuSection] = useState('langs'); // 'langs' | 'layout' | 'settings'
    const [toast, setToast] = useState('');
    const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
    const [scale, setScale] = useState(1);
    const [settingsReady, setSettingsReady] = useState(false);
    const [ocrTextLayout, setOcrTextLayout] = useState({ ...DEFAULT_OCR_TEXT_LAYOUT });
    const [draftOcrTextLayout, setDraftOcrTextLayout] = useState({ ...DEFAULT_OCR_TEXT_LAYOUT });
    const [ocrModelSource, setOcrModelSource] = useState('builtin');
    const [draftOcrModelSource, setDraftOcrModelSource] = useState('builtin');
    const [ocrModelLanguage, setOcrModelLanguage] = useState('chinese');
    const [draftOcrModelLanguage, setDraftOcrModelLanguage] = useState('chinese');
    const [ocrPreprocessModels, setOcrPreprocessModels] = useState({
        docOrientation: true,
        docUnwarp: false,
        textlineOrientation: true
    });
    const [draftOcrPreprocessModels, setDraftOcrPreprocessModels] = useState({
        docOrientation: true,
        docUnwarp: false,
        textlineOrientation: true
    });

    const imgRef = useRef(null);
    const canvasRef = useRef(null);
    const stageRef = useRef(null);
    const didAutoFitRef = useRef(false);
    const menuRootRef = useRef(null);
    const settingsReadyRef = useRef(false);
    const payloadRequestRef = useRef(0);
    const objectUrlRef = useRef('');

    const showToast = useCallback((message) => {
        setToast(message);
        window.clearTimeout(showToast._timer);
        showToast._timer = window.setTimeout(() => setToast(''), 1200);
    }, []);

    const formatOcrError = useCallback((errorCode, errorDetails = '') => {
        const detailText = errorDetails ? `\n${errorDetails}` : '';

        switch (errorCode) {
            case 'ocr-main-process-unavailable':
                return `${t('history.ocrErrorMainProcessUnavailable') || 'Main-process OCR bridge is unavailable.'}${detailText}`;
            case 'paddleocr-vl-cli-not-found':
                return `${t('history.ocrErrorPaddleVlCliNotFound') || 'PaddleOCR CLI was not found. Install paddleocr[doc-parser] or configure the OCR CLI command in Settings.'}${detailText}`;
            case 'paddleocr-vl-cli-missing-paddlepaddle':
                return `${t('history.ocrErrorPaddleVlCliMissingPaddle') || 'The selected PaddleOCR-VL environment is missing PaddlePaddle. Install paddlepaddle in that environment or let the app auto-detect a complete local venv.'}${detailText}`;
            case 'paddleocr-vl-cli-timeout':
                return `${t('history.ocrErrorPaddleVlCliTimeout') || 'PaddleOCR-VL CLI timed out. The first run may need model downloads.'}${detailText}`;
            case 'paddleocr-vl-cli-no-output':
                return `${t('history.ocrErrorPaddleVlCliNoOutput') || 'PaddleOCR-VL did not produce any Markdown or JSON output.'}${detailText}`;
            case 'paddleocr-vl-cli-failed':
                return `${t('history.ocrErrorPaddleVlCliFailed') || 'PaddleOCR-VL CLI failed. Check the command path and extra args.'}${detailText}`;
            default:
                return errorCode || (t('history.ocrFailed') || 'OCR failed');
        }
    }, [t]);

    const getConfidenceLevel = useCallback((value) => {
        if (value === null || typeof value !== 'number' || Number.isNaN(value)) return null;
        if (value >= 90) return { level: t('history.ocrConfidenceHigh') || 'High' };
        if (value >= 70) return { level: t('history.ocrConfidenceMedium') || 'Medium' };
        return { level: t('history.ocrConfidenceLow') || 'Low' };
    }, [t]);

    const resetDisplayState = useCallback(() => {
        setLoading(true);
        setLoadingMessage('');
        setError('');
        setBlocks([]);
        setFullText('');
        setConfidence(null);
        setUpscaled(false);
        setUpscaleScale(1);
        setActiveBlockId(null);
        setSelectionMode(false);
        setSelectionRect(null);
        setSelecting(false);
        setRuntimeNotice('');
        setImageSize({ width: 1, height: 1 });
        didAutoFitRef.current = false;
    }, []);

    const applyRuntimeNotice = useCallback((res, source) => {
        if (!isPaddleVlCliSource(source)) {
            setRuntimeNotice('');
            return;
        }

        const resolvedCommand = String(res?.resolvedCommand || '').trim();
        if (res?.autoConfigured && resolvedCommand) {
            setRuntimeNotice(
                t('history.ocrRuntimeNoticeAutoConfigured', { command: resolvedCommand }) ||
                `Auto-switched to local PaddleOCR-VL environment: ${resolvedCommand}`
            );
            return;
        }

        if (resolvedCommand) {
            setRuntimeNotice(
                t('history.ocrRuntimeNoticeUsingCli', { command: resolvedCommand }) ||
                `Using local PaddleOCR-VL command: ${resolvedCommand}`
            );
            return;
        }

        setRuntimeNotice(
            t('history.ocrRuntimeNoticePaddleVl') ||
            'PaddleOCR-VL may auto-download models to ~/.paddlex/official_models on first run, which can take several minutes.'
        );
    }, [t]);

    const runOcr = useCallback(async (input) => {
        try {
            setLoading(true);
            if (isPaddleVlCliSource(ocrModelSource)) {
                setLoadingMessage(
                    t('history.ocrDetectingPaddleVl') ||
                    'Running PaddleOCR-VL. The first run may auto-download models and take longer...'
                );
                setRuntimeNotice(
                    t('history.ocrRuntimeNoticePaddleVl') ||
                    'PaddleOCR-VL may auto-download models to ~/.paddlex/official_models on first run, which can take several minutes.'
                );
            } else {
                setLoadingMessage(t('history.ocrDetecting') || 'Recognizing text...');
                setRuntimeNotice('');
            }
            setError('');
            const res = await recognizeWithPaddle(input, {
                languages: selectedLanguages,
                ...ocrTextLayout,
                modelSource: ocrModelSource,
                modelLanguage: ocrModelLanguage,
                preprocessModels: ocrPreprocessModels
            });
            try {
                if (typeof globalThis !== 'undefined' && globalThis.__OCR_DEBUG__ === true) {
                    console.log('[OCRWindow] recognize result:', res);
                    if (res && res.upscaleDebug) {
                        console.log('[OCRWindow] upscaleDebug:', res.upscaleDebug);
                    }
                }
            } catch (_) { }
            if (res && res.error) {
                setError(formatOcrError(res.error, res.errorDetails));
                setBlocks([]);
                setFullText('');
                setConfidence(null);
                setUpscaled(false);
                setUpscaleScale(1);
                setLoading(false);
                return;
            }
            applyRuntimeNotice(res, ocrModelSource);
            setBlocks(Array.isArray(res?.blocks) ? res.blocks : []);
            setFullText(res?.text || '');
            setConfidence(typeof res?.confidence === 'number' ? res.confidence : null);
            setUpscaled(!!res?.upscaled);
            setUpscaleScale(typeof res?.upscaleScale === 'number' ? res.upscaleScale : 1);
            if (!res?.text || !String(res.text).trim()) {
                showToast(t('history.ocrNotFound') || 'No text found');
            }
            setLoading(false);
        } catch (err) {
            setError(formatOcrError(err && err.message ? err.message : 'ocr-failed'));
            setBlocks([]);
            setFullText('');
            setConfidence(null);
            setUpscaled(false);
            setUpscaleScale(1);
            setLoading(false);
        }
    }, [selectedLanguages, ocrTextLayout, ocrModelSource, ocrModelLanguage, ocrPreprocessModels, applyRuntimeNotice, formatOcrError, t, showToast]);

    const applyIncomingPayload = useCallback((payload) => {
        const next = normalizeOcrPayload(payload);
        if (!next.imagePath && !next.imageToken) {
            return;
        }
        resetDisplayState();
        setOcrPayload(next);
        if (!settingsReadyRef.current && next.languages.length) {
            setSelectedLanguages(next.languages);
            setDraftLanguages(next.languages);
        }
    }, [resetDisplayState]);

    const appliedSettingsKey = useMemo(() => serializeOcrSettings({
        selectedLanguages,
        ocrTextLayout,
        ocrModelSource,
        ocrModelLanguage,
        ocrPreprocessModels
    }), [selectedLanguages, ocrTextLayout, ocrModelSource, ocrModelLanguage, ocrPreprocessModels]);

    const draftSettingsKey = useMemo(() => serializeOcrSettings({
        draftLanguages,
        draftOcrTextLayout,
        draftOcrModelSource,
        draftOcrModelLanguage,
        draftOcrPreprocessModels
    }), [draftLanguages, draftOcrTextLayout, draftOcrModelSource, draftOcrModelLanguage, draftOcrPreprocessModels]);

    const hasPendingSettings = appliedSettingsKey !== draftSettingsKey;

    const syncOcrSettingsFromConfig = useCallback((cfg = {}) => {
        const nextLanguages = normalizeLanguages(cfg.ocrLanguages || initialPayload.languages);
        const nextTextLayout = cfg.ocrTextLayout && typeof cfg.ocrTextLayout === 'object'
            ? { ...DEFAULT_OCR_TEXT_LAYOUT, ...cfg.ocrTextLayout }
            : { ...DEFAULT_OCR_TEXT_LAYOUT };
        const nextModelSource = cfg.ocrModelSource || 'builtin';
        const nextModelLanguage = cfg.ocrModelLanguage || 'chinese';
        const nextPreprocessModels = cfg.ocrPreprocessModels && typeof cfg.ocrPreprocessModels === 'object'
            ? {
                docOrientation: true,
                docUnwarp: false,
                textlineOrientation: true,
                ...cfg.ocrPreprocessModels
            }
            : {
                docOrientation: true,
                docUnwarp: false,
                textlineOrientation: true
            };

        setSelectedLanguages(nextLanguages);
        setDraftLanguages(nextLanguages);
        setOcrTextLayout(nextTextLayout);
        setDraftOcrTextLayout(nextTextLayout);
        setOcrModelSource(nextModelSource);
        setDraftOcrModelSource(nextModelSource);
        setOcrModelLanguage(nextModelLanguage);
        setDraftOcrModelLanguage(nextModelLanguage);
        setOcrPreprocessModels(nextPreprocessModels);
        setDraftOcrPreprocessModels(nextPreprocessModels);
    }, [initialPayload.languages]);

    useEffect(() => {
        try {
            const enabled = getBoolParam('debug') || getBoolParam('ocrDebug');
            if (enabled && typeof globalThis !== 'undefined') {
                globalThis.__OCR_DEBUG__ = true;
            }
        } catch (_) { }
    }, []);

    useEffect(() => {
        let cancelled = false;
        if (!window.electronAPI || typeof window.electronAPI.getSettings !== 'function') {
            setSettingsReady(true);
            return () => { cancelled = true; };
        }

        window.electronAPI.getSettings()
            .then((cfg) => {
                if (cancelled || !cfg || typeof cfg !== 'object') return;
                syncOcrSettingsFromConfig(cfg);
            })
            .catch(() => { })
            .finally(() => {
                if (!cancelled) {
                    setSettingsReady(true);
                }
            });
        return () => { cancelled = true; };
    }, [syncOcrSettingsFromConfig]);

    useEffect(() => {
        if (!window.electronAPI || typeof window.electronAPI.onSettingsUpdated !== 'function') {
            return undefined;
        }

        const unsubscribe = window.electronAPI.onSettingsUpdated((payload) => {
            const cfg = payload && typeof payload === 'object' ? (payload.config || payload) : null;
            if (!cfg || typeof cfg !== 'object') return;
            syncOcrSettingsFromConfig(cfg);
        });

        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [syncOcrSettingsFromConfig]);

    useEffect(() => {
        settingsReadyRef.current = settingsReady;
    }, [settingsReady]);

    useEffect(() => {
        let cancelled = false;
        if (window.electronAPI && typeof window.electronAPI.getOcrWindowState === 'function') {
            window.electronAPI.getOcrWindowState()
                .then((payload) => {
                    if (!cancelled) {
                        applyIncomingPayload(payload);
                    }
                })
                .catch(() => { });
        }

        if (!window.electronAPI || typeof window.electronAPI.onOcrWindowPayload !== 'function') {
            return () => { cancelled = true; };
        }

        const unsubscribe = window.electronAPI.onOcrWindowPayload((payload) => {
            if (!cancelled) {
                applyIncomingPayload(payload);
            }
        });

        return () => {
            cancelled = true;
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [applyIncomingPayload]);

    useEffect(() => {
        const onMouseDown = (e) => {
            try {
                if (!activeMenu) return;
                const root = menuRootRef.current;
                if (!root) return;
                if (root.contains(e.target)) return;
                setActiveMenu(null);
            } catch (_) { }
        };
        window.addEventListener('mousedown', onMouseDown);
        return () => window.removeEventListener('mousedown', onMouseDown);
    }, [activeMenu]);

    useEffect(() => {
        let cancelled = false;
        const requestId = payloadRequestRef.current + 1;
        payloadRequestRef.current = requestId;

        const resolveImageSource = async () => {
            if (!ocrPayload.imagePath && !ocrPayload.imageToken) {
                setResolvedImageSrc('');
                setError(t('history.ocrInvalidImage') || 'Image not available');
                setLoading(false);
                return;
            }

            setLoading(true);
            setLoadingMessage(t('history.ocrLoadingImage') || 'Loading image...');
            setLoadingPayload(true);
            try {
                let nextSrc = '';
                if (ocrPayload.imageToken) {
                    if (!window.electronAPI || typeof window.electronAPI.getOcrImageData !== 'function') {
                        throw new Error('ocr-image-token-unavailable');
                    }
                    const res = await window.electronAPI.getOcrImageData(ocrPayload.imageToken);
                    if (!res || !res.success || !res.data) {
                        throw new Error((res && res.error) || 'ocr-image-read-failed');
                    }
                    const bytes = res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data);
                    const blob = new Blob([bytes], { type: res.mimeType || 'image/png' });
                    nextSrc = URL.createObjectURL(blob);
                    if (window.electronAPI && typeof window.electronAPI.releaseOcrImageToken === 'function') {
                        Promise.resolve(window.electronAPI.releaseOcrImageToken(ocrPayload.imageToken)).catch(() => { });
                    }
                } else {
                    nextSrc = buildImageSrcFromPath(ocrPayload.imagePath);
                }

                if (cancelled || requestId !== payloadRequestRef.current) {
                    if (nextSrc.startsWith('blob:')) {
                        URL.revokeObjectURL(nextSrc);
                    }
                    return;
                }

                if (objectUrlRef.current) {
                    URL.revokeObjectURL(objectUrlRef.current);
                    objectUrlRef.current = '';
                }
                if (nextSrc.startsWith('blob:')) {
                    objectUrlRef.current = nextSrc;
                }
                setResolvedImageSrc(nextSrc);
                setError('');
            } catch (_) {
                if (!cancelled && requestId === payloadRequestRef.current) {
                    if (objectUrlRef.current) {
                        URL.revokeObjectURL(objectUrlRef.current);
                        objectUrlRef.current = '';
                    }
                    setResolvedImageSrc('');
                    setError(t('history.ocrInvalidImage') || 'Image not available');
                    setLoading(false);
                }
            } finally {
                if (!cancelled && requestId === payloadRequestRef.current) {
                    setLoadingPayload(false);
                }
            }
        };

        resolveImageSource();
        return () => {
            cancelled = true;
        };
    }, [ocrPayload.imagePath, ocrPayload.imageToken, t]);

    useEffect(() => {
        if (!settingsReady || loadingPayload) return;
        if (!resolvedImageSrc) {
            if (!ocrPayload.imagePath && !ocrPayload.imageToken) {
                setError(t('history.ocrInvalidImage') || 'Image not available');
                setLoading(false);
            }
            return;
        }
        runOcr(resolvedImageSrc);
    }, [ocrPayload.imagePath, ocrPayload.imageToken, resolvedImageSrc, loadingPayload, settingsReady, runOcr, t]);

    useEffect(() => {
        return () => {
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
                objectUrlRef.current = '';
            }
        };
    }, []);

    const imageReady = !!resolvedImageSrc && !error;

    const handleCopyAll = useCallback(async () => {
        try {
            if (!window.electronAPI || typeof window.electronAPI.copyOCRContent !== 'function') return;
            if (!fullText || !fullText.trim()) return;
            await window.electronAPI.copyOCRContent(fullText);
            showToast(t('history.ocrCopied') || 'OCR text copied');
        } catch (err) {
            showToast(t('history.ocrFailed') || 'OCR failed');
        }
    }, [fullText, showToast, t]);

    const buildVisionPayload = useCallback(async () => {
        if (ocrPayload.imagePath) {
            return { imagePath: ocrPayload.imagePath };
        }

        if (resolvedImageSrc) {
            if (resolvedImageSrc.startsWith('data:image/')) {
                return { imagePath: resolvedImageSrc };
            }

            const response = await fetch(resolvedImageSrc);
            const arrayBuffer = await response.arrayBuffer();
            return {
                imageBuffer: new Uint8Array(arrayBuffer),
                mimeType: response.headers.get('content-type') || 'image/png'
            };
        }

        if (ocrPayload.imageToken) {
            return { imageToken: ocrPayload.imageToken };
        }

        throw new Error('vision-image-missing');
    }, [ocrPayload.imagePath, ocrPayload.imageToken, resolvedImageSrc]);

    const handleVisionAction = useCallback(async (actionId) => {
        try {
            if (!window.electronAPI || typeof window.electronAPI.openVisionChat !== 'function') {
                throw new Error('vision-chat-bridge-unavailable');
            }

            const payload = await buildVisionPayload();
            const res = await window.electronAPI.openVisionChat({
                actionId,
                ...payload
            });

            if (!res || res.success === false) {
                throw new Error((res && res.error) || 'open-vision-chat-failed');
            }

            showToast(t('history.vlOpened') || 'VL assistant opened');
        } catch (err) {
            const reason = err && err.message ? String(err.message) : 'open-vision-chat-failed';
            showToast(`${t('history.vlOpenFailed') || 'Failed to open VL assistant'}: ${reason}`);
        }
    }, [buildVisionPayload, showToast, t]);

    const handleCopyBlock = useCallback(async (block) => {
        try {
            if (!block || !block.text) return;
            if (!window.electronAPI || typeof window.electronAPI.copyOCRContent !== 'function') return;
            await window.electronAPI.copyOCRContent(String(block.text));
            showToast(t('history.ocrCopied') || 'OCR text copied');
        } catch (err) {
            showToast(t('history.ocrFailed') || 'OCR failed');
        }
    }, [showToast, t]);

    const handleImageLoad = () => {
        const img = imgRef.current;
        if (img) {
            setImageSize({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
        }
        setSelectionRect(null);
    };

    const isBusy = loading || loadingPayload;

    const getFitScale = useCallback(() => {
        const stage = stageRef.current;
        if (!stage) return 1;
        const padding = 32;
        const availableWidth = Math.max(1, stage.clientWidth - padding);
        const availableHeight = Math.max(1, stage.clientHeight - padding);
        const fitScale = Math.min(
            availableWidth / imageSize.width,
            availableHeight / imageSize.height
        );
        return clamp(fitScale, 0.2, 2);
    }, [imageSize.width, imageSize.height]);

    useEffect(() => {
        if (didAutoFitRef.current || imageSize.width <= 1 || imageSize.height <= 1) return;
        didAutoFitRef.current = true;
        window.requestAnimationFrame(() => setScale(getFitScale()));
    }, [getFitScale, imageSize.width, imageSize.height]);

    // Keyboard shortcuts (must be defined after getFitScale to avoid TDZ in dependency evaluation)
    useEffect(() => {
        const onKeyDown = (event) => {
            try {
                if (!event) return;
                const active = document.activeElement;
                const isEditable = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable);
                const key = String(event.key || '');
                const lower = key.toLowerCase();
                const ctrlOrCmd = !!(event.ctrlKey || event.metaKey);

                // ESC: cancel selection first, otherwise close window
                if (key === 'Escape') {
                    if (activeMenu) {
                        setActiveMenu(null);
                        event.preventDefault();
                        return;
                    }
                    if (selectionMode || selecting) {
                        setSelectionMode(false);
                        setSelecting(false);
                        setSelectionRect(null);
                        event.preventDefault();
                        return;
                    }
                    try { window.close(); } catch (_) { }
                    return;
                }

                if (isEditable) return;

                // Cmd/Ctrl+C: copy all
                if (ctrlOrCmd && lower === 'c') {
                    if (fullText && fullText.trim()) {
                        handleCopyAll();
                        event.preventDefault();
                    }
                    return;
                }

                // Cmd/Ctrl+R: retry
                if (ctrlOrCmd && lower === 'r') {
                    if (!loading && imageReady) {
                        runOcr(resolvedImageSrc);
                        event.preventDefault();
                    }
                    return;
                }

                // Zoom shortcuts
                if (ctrlOrCmd && (lower === '=' || lower === '+')) {
                    setScale((prev) => clamp(prev + 0.1, 0.2, 3));
                    event.preventDefault();
                    return;
                }
                if (ctrlOrCmd && lower === '-') {
                    setScale((prev) => clamp(prev - 0.1, 0.2, 3));
                    event.preventDefault();
                    return;
                }
                if (ctrlOrCmd && lower === '0') {
                    setScale(1);
                    event.preventDefault();
                    return;
                }

                // Fit: F
                if (!ctrlOrCmd && lower === 'f') {
                    if (imageReady) {
                        setScale(getFitScale());
                        event.preventDefault();
                    }
                    return;
                }
            } catch (_) { }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [activeMenu, selectionMode, selecting, fullText, loading, imageReady, runOcr, resolvedImageSrc, getFitScale, handleCopyAll]);

    const getImageCoords = (event) => {
        const img = imgRef.current;
        if (!img) return { x: 0, y: 0, scaleX: 1, scaleY: 1 };
        const rect = img.getBoundingClientRect();
        const scaleX = (img.naturalWidth || rect.width) / rect.width;
        const scaleY = (img.naturalHeight || rect.height) / rect.height;
        const x = clamp((event.clientX - rect.left) * scaleX, 0, img.naturalWidth || rect.width);
        const y = clamp((event.clientY - rect.top) * scaleY, 0, img.naturalHeight || rect.height);
        return { x, y, scaleX, scaleY };
    };

    const handleMouseDown = (event) => {
        if (!selectionMode) return;
        event.preventDefault();
        const { x, y } = getImageCoords(event);
        setSelecting(true);
        setSelectionRect({ x, y, width: 0, height: 0 });
    };

    const handleMouseMove = (event) => {
        if (!selectionMode || !selecting || !selectionRect) return;
        event.preventDefault();
        const { x, y } = getImageCoords(event);
        setSelectionRect((prev) => {
            if (!prev) return prev;
            return {
                x: Math.min(prev.x, x),
                y: Math.min(prev.y, y),
                width: Math.abs(x - prev.x),
                height: Math.abs(y - prev.y)
            };
        });
    };

    const handleMouseUp = async () => {
        if (!selectionMode || !selecting || !selectionRect) return;
        setSelecting(false);
        setSelectionMode(false);

        if (selectionRect.width < 6 || selectionRect.height < 6) {
            setSelectionRect(null);
            return;
        }

        const img = imgRef.current;
        if (!img) return;
        const canvas = canvasRef.current || document.createElement('canvas');
        canvasRef.current = canvas;

        const sx = clamp(selectionRect.x, 0, img.naturalWidth);
        const sy = clamp(selectionRect.y, 0, img.naturalHeight);
        const sw = clamp(selectionRect.width, 1, img.naturalWidth - sx);
        const sh = clamp(selectionRect.height, 1, img.naturalHeight - sy);

        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, sw, sh);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

        try {
            setLoading(true);
            if (isPaddleVlCliSource(ocrModelSource)) {
                setLoadingMessage(
                    t('history.ocrDetectingPaddleVl') ||
                    'Running PaddleOCR-VL. The first run may auto-download models and take longer...'
                );
                setRuntimeNotice(
                    t('history.ocrRuntimeNoticePaddleVl') ||
                    'PaddleOCR-VL may auto-download models to ~/.paddlex/official_models on first run, which can take several minutes.'
                );
            } else {
                setLoadingMessage(t('history.ocrDetecting') || 'Recognizing text...');
                setRuntimeNotice('');
            }
            setError('');
            const dataUrl = canvas.toDataURL('image/png');
            const res = await recognizeWithPaddle(dataUrl, {
                languages: selectedLanguages,
                ...ocrTextLayout,
                modelSource: ocrModelSource,
                modelLanguage: ocrModelLanguage,
                preprocessModels: ocrPreprocessModels
            });
            if (res && res.error) {
                setError(formatOcrError(res.error, res.errorDetails));
                setConfidence(null);
                setUpscaled(false);
                setUpscaleScale(1);
                return;
            }
            applyRuntimeNotice(res, ocrModelSource);
            const nextBlocks = (res?.blocks || []).map((block) => {
                const points = Array.isArray(block.points) ? block.points : [];
                const offsetPoints = points.map((pt) => {
                    const p = normalizePoint(pt);
                    return { x: p.x + sx, y: p.y + sy };
                });
                return {
                    ...block,
                    points: offsetPoints
                };
            });
            setBlocks(nextBlocks);
            setFullText(res?.text || '');
            setConfidence(typeof res?.confidence === 'number' ? res.confidence : null);
            setUpscaled(!!res?.upscaled);
            setUpscaleScale(typeof res?.upscaleScale === 'number' ? res.upscaleScale : 1);
            setSelectionRect(null);
        } catch (err) {
            setError(formatOcrError(err && err.message ? err.message : 'ocr-failed'));
            setConfidence(null);
            setUpscaled(false);
            setUpscaleScale(1);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleLanguage = (code) => {
        const next = draftLanguages.includes(code)
            ? draftLanguages.filter((item) => item !== code)
            : [...draftLanguages, code];
        const cleaned = next.length ? next : [...DEFAULT_LANGS];
        setDraftLanguages(cleaned);
    };

    const updateOcrPreprocessModels = (field, value) => {
        const next = {
            docOrientation: true,
            docUnwarp: false,
            textlineOrientation: true,
            ...(draftOcrPreprocessModels || {}),
            [field]: value
        };
        setDraftOcrPreprocessModels(next);
    };

    const updateOcrModelSource = (value) => {
        const next = value || 'builtin';
        setDraftOcrModelSource(next);
    };

    const updateOcrModelLanguage = (value) => {
        const next = value || 'chinese';
        setDraftOcrModelLanguage(next);
    };

    const updateOcrLayout = (field, value) => {
        const next = {
            ...DEFAULT_OCR_TEXT_LAYOUT,
            ...(draftOcrTextLayout || {}),
            [field]: value
        };
        setDraftOcrTextLayout(next);
    };

    const applyDraftSettings = useCallback(async () => {
        const nextLanguages = normalizeLanguages(draftLanguages);
        const nextTextLayout = { ...DEFAULT_OCR_TEXT_LAYOUT, ...(draftOcrTextLayout || {}) };
        const nextModelSource = draftOcrModelSource || 'builtin';
        const nextModelLanguage = draftOcrModelLanguage || 'chinese';
        const nextPreprocessModels = {
            docOrientation: true,
            docUnwarp: false,
            textlineOrientation: true,
            ...(draftOcrPreprocessModels || {})
        };

        setSelectedLanguages(nextLanguages);
        setOcrTextLayout(nextTextLayout);
        setOcrModelSource(nextModelSource);
        setOcrModelLanguage(nextModelLanguage);
        setOcrPreprocessModels(nextPreprocessModels);

        try {
            if (window.electronAPI && typeof window.electronAPI.setSettings === 'function') {
                await window.electronAPI.setSettings({
                    ocrLanguages: nextLanguages,
                    ocrTextLayout: nextTextLayout,
                    ocrModelSource: nextModelSource,
                    ocrModelLanguage: nextModelLanguage,
                    ocrPreprocessModels: nextPreprocessModels
                });
            }
        } catch (_) { }

        showToast(t('history.ocrSettingsApplied') || 'OCR settings applied');
    }, [draftLanguages, draftOcrModelLanguage, draftOcrModelSource, draftOcrPreprocessModels, draftOcrTextLayout, showToast, t]);

    const resetDraftSettings = useCallback(() => {
        setDraftLanguages(selectedLanguages);
        setDraftOcrTextLayout({ ...ocrTextLayout });
        setDraftOcrModelSource(ocrModelSource);
        setDraftOcrModelLanguage(ocrModelLanguage);
        setDraftOcrPreprocessModels({ ...ocrPreprocessModels });
        showToast(t('history.ocrSettingsReset') || 'OCR settings reset');
    }, [ocrModelLanguage, ocrModelSource, ocrPreprocessModels, ocrTextLayout, selectedLanguages, showToast, t]);

    const openOcrSettingsTool = useCallback(async () => {
        try {
            if (!window.electronAPI || typeof window.electronAPI.openOcrSettingsWindow !== 'function') {
                throw new Error('ocr-settings-window-unavailable');
            }
            const res = await window.electronAPI.openOcrSettingsWindow();
            if (!res || res.success !== true) {
                throw new Error((res && res.error) || 'open-ocr-settings-window-failed');
            }
            setActiveMenu(null);
        } catch (_) {
            showToast(t('history.ocrFailed') || 'OCR failed');
        }
    }, [showToast, t]);

    const langOptions = [
        { code: 'chi_sim', label: t('history.ocrLangChiSim') || 'Chinese (Simplified)' },
        { code: 'chi_tra', label: t('history.ocrLangChiTra') || 'Chinese (Traditional)' },
        { code: 'eng', label: t('history.ocrLangEng') || 'English' },
        { code: 'jpn', label: t('history.ocrLangJpn') || 'Japanese' },
        { code: 'kor', label: t('history.ocrLangKor') || 'Korean' },
        { code: 'deu', label: t('history.ocrLangDeu') || 'German' },
        { code: 'fra', label: t('history.ocrLangFra') || 'French' },
        { code: 'spa', label: t('history.ocrLangSpa') || 'Spanish' },
        { code: 'por', label: t('history.ocrLangPor') || 'Portuguese' },
        { code: 'ita', label: t('history.ocrLangIta') || 'Italian' },
        { code: 'rus', label: t('history.ocrLangRus') || 'Russian' },
        { code: 'ara', label: t('history.ocrLangAra') || 'Arabic' },
        { code: 'vie', label: t('history.ocrLangVie') || 'Vietnamese' },
        { code: 'tha', label: t('history.ocrLangTha') || 'Thai' },
        { code: 'nld', label: t('history.ocrLangNld') || 'Dutch' },
        { code: 'pol', label: t('history.ocrLangPol') || 'Polish' }
    ];

    const ocrModelLanguageOptions = [
        { value: 'chinese', label: 'Chinese (Simplified/Traditional)' },
        { value: 'english', label: 'English' },
        { value: 'arabic', label: 'Arabic' },
        { value: 'eslav', label: 'Slavic (East)' },
        { value: 'greek', label: 'Greek' },
        { value: 'hindi', label: 'Hindi' },
        { value: 'korean', label: 'Korean' },
        { value: 'latin', label: 'Latin' },
        { value: 'tamil', label: 'Tamil' },
        { value: 'telugu', label: 'Telugu' },
        { value: 'thai', label: 'Thai' }
    ];

    useEffect(() => {
        if (document && typeof document.title === 'string') {
            document.title = t('history.ocrTitle') || 'OCR Result';
        }
    }, [t]);

    const confidenceInfo = useMemo(() => getConfidenceLevel(confidence), [confidence, getConfidenceLevel]);

    const toggleMenu = () => {
        setActiveMenu((prev) => (prev ? null : 'menu'));
        if (!activeMenuSection) setActiveMenuSection('langs');
    };

    return (
        <div className="ocr-window">
            <div className="ocr-window-header">
                <div className="ocr-window-left" ref={menuRootRef}>
                    <div className="ocr-window-title">
                        <span>{t('history.ocrTitle') || 'OCR Result'}</span>
                    </div>

                    <button
                        type="button"
                        className={`btn ocr-menu-btn ${activeMenu ? 'active' : ''}`}
                        onClick={toggleMenu}
                        disabled={isBusy}
                        aria-expanded={!!activeMenu}
                    >
                        <span>{t('history.ocrMenu') || (t('history.ocrSettingsTitle') || 'OCR Menu')}</span>
                        <span className="ocr-menu-caret" aria-hidden="true">▾</span>
                    </button>

                    {activeMenu && (
                        <div className="ocr-menu-popover ocr-menu-popover--left" onMouseDown={(e) => e.stopPropagation()}>
                            <div className="ocr-menu-nav" role="tablist" aria-label={t('history.ocrMenu') || 'OCR menu'}>
                                <button
                                    type="button"
                                    role="tab"
                                    className={`ocr-menu-nav-btn ${activeMenuSection === 'langs' ? 'active' : ''}`}
                                    aria-selected={activeMenuSection === 'langs'}
                                    onClick={() => setActiveMenuSection('langs')}
                                >
                                    {t('history.ocrLangTitle') || 'Languages'} ({draftLanguages.length})
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    className={`ocr-menu-nav-btn ${activeMenuSection === 'layout' ? 'active' : ''}`}
                                    aria-selected={activeMenuSection === 'layout'}
                                    onClick={() => setActiveMenuSection('layout')}
                                >
                                    {t('history.ocrLayoutTitle') || 'Text layout'}
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    className={`ocr-menu-nav-btn ${activeMenuSection === 'settings' ? 'active' : ''}`}
                                    aria-selected={activeMenuSection === 'settings'}
                                    onClick={() => setActiveMenuSection('settings')}
                                >
                                    {t('history.ocrSettingsTitle') || 'OCR Settings'}
                                </button>
                            </div>

                            {activeMenuSection === 'langs' && (
                                <div className="ocr-menu-section ocr-menu-section-lang">
                                    <div className="ocr-menu-section-header">
                                        <span className="ocr-menu-section-icon">🌐</span>
                                        <span className="ocr-menu-section-title">{t('history.ocrLangTitle') || 'OCR Languages'}</span>
                                    </div>
                                    <div className="ocr-menu-section-content">
                                        <div className="ocr-lang-grid">
                                            {langOptions.map((lang) => (
                                                <label key={lang.code} className="ocr-lang-item">
                                                    <input
                                                        type="checkbox"
                                                        checked={draftLanguages.includes(lang.code)}
                                                        onChange={() => handleToggleLanguage(lang.code)}
                                                    />
                                                    <span className="ocr-lang-label">{lang.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="ocr-menu-section-footer">
                                        <span className="ocr-lang-count">{t('history.ocrLangHint') || `Selected: ${draftLanguages.length} language(s)`}</span>
                                    </div>
                                </div>
                            )}

                            {activeMenuSection === 'layout' && (
                                <div className="ocr-menu-section ocr-menu-section-layout">
                                    <div className="ocr-menu-section-header">
                                        <span className="ocr-menu-section-icon">📝</span>
                                        <span className="ocr-menu-section-title">{t('history.ocrLayoutTitle') || 'Text Layout Settings'}</span>
                                    </div>
                                    <div className="ocr-menu-section-content">
                                        <div className="ocr-layout-group">
                                            <div className="ocr-layout-group-title">{t('history.ocrLayoutOptions') || 'Text Processing Options'}</div>
                                            <label className="ocr-layout-option">
                                                <input
                                                    type="checkbox"
                                                    checked={draftOcrTextLayout.insertSpaceByGap !== false}
                                                    onChange={(e) => updateOcrLayout('insertSpaceByGap', e.target.checked)}
                                                />
                                                <span>{t('history.ocrLayoutInsertSpace') || 'Insert space by gap'}</span>
                                            </label>
                                            <label className="ocr-layout-option">
                                                <input
                                                    type="checkbox"
                                                    checked={draftOcrTextLayout.splitByGap !== false}
                                                    onChange={(e) => updateOcrLayout('splitByGap', e.target.checked)}
                                                />
                                                <span>{t('history.ocrLayoutSplitByGap') || 'Split by blank gap'}</span>
                                            </label>
                                        </div>

                                        <div className="ocr-layout-group">
                                            <div className="ocr-layout-group-title">{t('history.ocrLayoutMerge') || 'Line Merge Thresholds'}</div>
                                            <div className="ocr-layout-control">
                                                <span>{t('history.ocrLayoutLineMergeRatio') || 'Line merge ratio'}</span>
                                                <input
                                                    type="range"
                                                    min="0.2"
                                                    max="1.2"
                                                    step="0.05"
                                                    value={draftOcrTextLayout.lineMergeThresholdRatio}
                                                    onChange={(e) => updateOcrLayout('lineMergeThresholdRatio', parseFloat(e.target.value))}
                                                />
                                                <strong>{draftOcrTextLayout.lineMergeThresholdRatio.toFixed(2)}</strong>
                                            </div>

                                            <div className="ocr-layout-control">
                                                <span>{t('history.ocrLayoutLineMergePx') || 'Line merge px'}</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="40"
                                                    step="1"
                                                    value={draftOcrTextLayout.lineMergeThresholdPx}
                                                    onChange={(e) => updateOcrLayout('lineMergeThresholdPx', parseInt(e.target.value, 10) || 0)}
                                                />
                                                <strong>{draftOcrTextLayout.lineMergeThresholdPx}px</strong>
                                            </div>
                                        </div>

                                        <div className="ocr-layout-group">
                                            <div className="ocr-layout-group-title">{t('history.ocrLayoutSpace') || 'Space Gap Settings'}</div>
                                            <div className="ocr-layout-control">
                                                <span>{t('history.ocrLayoutSpaceGapRatio') || 'Space gap ratio'}</span>
                                                <input
                                                    type="range"
                                                    min="0.2"
                                                    max="0.8"
                                                    step="0.05"
                                                    value={draftOcrTextLayout.spaceGapRatio}
                                                    onChange={(e) => updateOcrLayout('spaceGapRatio', parseFloat(e.target.value))}
                                                />
                                                <strong>{draftOcrTextLayout.spaceGapRatio.toFixed(2)}</strong>
                                            </div>

                                            <div className="ocr-layout-control">
                                                <span>{t('history.ocrLayoutSpaceGapPx') || 'Space gap px'}</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="30"
                                                    step="1"
                                                    value={draftOcrTextLayout.spaceGapMinPx}
                                                    onChange={(e) => updateOcrLayout('spaceGapMinPx', parseInt(e.target.value, 10) || 0)}
                                                />
                                                <strong>{draftOcrTextLayout.spaceGapMinPx}px</strong>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeMenuSection === 'settings' && (
                                <div className="ocr-menu-section ocr-menu-section-settings">
                                    <div className="ocr-menu-section-header">
                                        <span className="ocr-menu-section-icon">⚙️</span>
                                        <span className="ocr-menu-section-title">{t('history.ocrSettingsTitle') || 'OCR Model Settings'}</span>
                                    </div>
                                    <div className="ocr-menu-section-content">
                                        <div className="ocr-settings-group">
                                            <div className="ocr-settings-group-title">{t('settings.ocr.modelSection') || 'Model Configuration'}</div>
                                            <div className="ocr-setting-row">
                                                <label className="ocr-setting-label">{t('settings.ocr.modelSource') || 'Model source'}</label>
                                                <select
                                                    className="ocr-setting-select"
                                                    value={draftOcrModelSource || 'builtin'}
                                                    onChange={(e) => updateOcrModelSource(e.target.value)}
                                                >
                                                    <option value="builtin">{t('settings.ocr.modelSourceBuiltin') || 'Built-in (PP-OCRv5 mobile)'}</option>
                                                    <option value="paddleocr-vl-cli">{t('settings.ocr.modelSourcePaddleVlCli') || 'PaddleOCR-VL (local CLI)'}</option>
                                                </select>
                                                <div className="ocr-setting-help">{t('settings.ocr.modelSourceHelp') || ''}</div>
                                            </div>

                                            <div className="ocr-setting-row">
                                                <label className="ocr-setting-label">{t('settings.ocr.modelLanguage') || 'Recognition language'}</label>
                                                <select
                                                    className="ocr-setting-select"
                                                    value={draftOcrModelLanguage || 'chinese'}
                                                    onChange={(e) => updateOcrModelLanguage(e.target.value)}
                                                >
                                                    {ocrModelLanguageOptions.map((opt) => (
                                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                    ))}
                                                </select>
                                                <div className="ocr-setting-help">{t('settings.ocr.modelLanguageHelp') || ''}</div>
                                            </div>
                                        </div>

                                        <div className="ocr-settings-group">
                                            <div className="ocr-settings-group-title">{t('settings.ocr.preprocessSection') || 'Image Preprocessing'}</div>
                                            <div className="ocr-setting-row">
                                                <label className="ocr-setting-label ocr-setting-checkbox">
                                                    <input
                                                        type="checkbox"
                                                        checked={draftOcrPreprocessModels?.docOrientation !== false}
                                                        onChange={(e) => updateOcrPreprocessModels('docOrientation', e.target.checked)}
                                                    />
                                                    <span>{t('settings.ocr.docOrientation') || 'Doc orientation'}</span>
                                                </label>
                                                <div className="ocr-setting-help">{t('settings.ocr.docOrientationHelp') || ''}</div>
                                            </div>

                                            <div className="ocr-setting-row">
                                                <label className="ocr-setting-label ocr-setting-checkbox">
                                                    <input
                                                        type="checkbox"
                                                        checked={!!draftOcrPreprocessModels?.docUnwarp}
                                                        onChange={(e) => updateOcrPreprocessModels('docUnwarp', e.target.checked)}
                                                    />
                                                    <span>{t('settings.ocr.docUnwarp') || 'Doc unwarp'}</span>
                                                </label>
                                                <div className="ocr-setting-help">{t('settings.ocr.docUnwarpHelp') || ''}</div>
                                            </div>

                                            <div className="ocr-setting-row">
                                                <label className="ocr-setting-label ocr-setting-checkbox">
                                                    <input
                                                        type="checkbox"
                                                        checked={draftOcrPreprocessModels?.textlineOrientation !== false}
                                                        onChange={(e) => updateOcrPreprocessModels('textlineOrientation', e.target.checked)}
                                                    />
                                                    <span>{t('settings.ocr.textlineOrientation') || 'Textline orientation'}</span>
                                                </label>
                                                <div className="ocr-setting-help">{t('settings.ocr.textlineOrientationHelp') || ''}</div>
                                            </div>
                                        </div>

                                        <div className="ocr-settings-group">
                                            <div className="ocr-settings-group-title">{t('settings.ocr.toolWindowTitle') || 'OCR Advanced Settings'}</div>
                                            <div className="ocr-setting-row">
                                                <button type="button" className="btn ocr-inline-tool-btn" onClick={openOcrSettingsTool}>
                                                    {t('settings.ocr.openToolWindow') || 'Open advanced OCR tool window'}
                                                </button>
                                                <div className="ocr-setting-help">{t('settings.ocr.openToolWindowHelp') || 'Use a detached window to tune PaddleOCR-VL runtime, worker-pool, and text-layout parameters.'}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="ocr-menu-action-bar">
                                <span className="ocr-settings-hint">
                                    {hasPendingSettings
                                        ? (t('history.ocrSettingsPendingHint') || 'You have unapplied OCR setting changes.')
                                        : (t('history.ocrSettingsAppliedHint') || 'Applied settings will be reused for the next OCR run.')}
                                </span>
                                <div className="ocr-menu-action-buttons">
                                    <button type="button" className="btn" onClick={resetDraftSettings} disabled={!hasPendingSettings || isBusy}>
                                        {t('history.reset') || 'Reset'}
                                    </button>
                                    <button type="button" className="btn" onClick={applyDraftSettings} disabled={!hasPendingSettings || isBusy}>
                                        {t('history.apply') || 'Apply'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                </div>

                <div className="ocr-window-actions">
                    <button type="button" className="btn ocr-toolbar-btn" onClick={() => setScale((prev) => clamp(prev - 0.1, 0.2, 3))} disabled={!imageReady}>
                        <span className="ocr-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" role="img">
                                <path d="M6 12h12" />
                            </svg>
                        </span>
                        <span>{t('history.zoomOut') || 'Zoom out'}</span>
                    </button>
                    <button type="button" className="btn ocr-toolbar-btn" onClick={() => setScale((prev) => clamp(prev + 0.1, 0.2, 3))} disabled={!imageReady}>
                        <span className="ocr-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" role="img">
                                <path d="M12 6v12M6 12h12" />
                            </svg>
                        </span>
                        <span>{t('history.zoomIn') || 'Zoom in'}</span>
                    </button>
                    <button type="button" className="btn ocr-toolbar-btn" onClick={() => setScale(getFitScale())} disabled={!imageReady}>
                        <span className="ocr-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" role="img">
                                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                            </svg>
                        </span>
                        <span>{t('history.zoomFit') || 'Fit'}</span>
                    </button>
                    <button type="button" className="btn ocr-toolbar-btn" onClick={() => setScale(1)} disabled={!imageReady}>
                        <span className="ocr-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" role="img">
                                <path d="M6 7h4v10H6zM14 7l4 10" />
                                <circle cx="18" cy="7" r="2" />
                            </svg>
                        </span>
                        <span>{t('history.zoomReset') || 'Reset'}</span>
                    </button>
                    <button type="button" className="btn ocr-toolbar-btn" onClick={() => runOcr(resolvedImageSrc)} disabled={isBusy}>
                        <span className="ocr-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" role="img">
                                <path d="M4 4v6h6" />
                                <path d="M20 20a8 8 0 0 1-14-6" />
                                <path d="M20 20v-6h-6" />
                                <path d="M4 4a8 8 0 0 1 14 6" />
                            </svg>
                        </span>
                        <span>{t('history.ocrRetry') || 'Retry'}</span>
                    </button>
                    <button type="button" className="btn ocr-toolbar-btn" onClick={() => handleVisionAction('vl-describe')} disabled={isBusy || !imageReady}>
                        <span className="ocr-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" role="img">
                                <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                        </span>
                        <span>{t('history.vlDescribe') || 'Parse image'}</span>
                    </button>
                    <button type="button" className="btn ocr-toolbar-btn" onClick={() => handleVisionAction('vl-ocr')} disabled={isBusy || !imageReady}>
                        <span className="ocr-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" role="img">
                                <path d="M6 5h12v14H6z" />
                                <path d="M9 9h6" />
                                <path d="M9 13h6" />
                                <path d="M9 17h4" />
                            </svg>
                        </span>
                        <span>{t('history.vlOcr') || 'Image to text'}</span>
                    </button>
                    <button type="button" className="btn ocr-toolbar-btn" onClick={() => handleVisionAction('vl-summary')} disabled={isBusy || !imageReady}>
                        <span className="ocr-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" role="img">
                                <path d="M5 7h14" />
                                <path d="M5 12h14" />
                                <path d="M5 17h8" />
                            </svg>
                        </span>
                        <span>{t('history.vlSummary') || 'Summarize image'}</span>
                    </button>
                    <button type="button" className="btn ocr-toolbar-btn" onClick={() => handleVisionAction('vl-analyze')} disabled={isBusy || !imageReady}>
                        <span className="ocr-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" role="img">
                                <path d="M6 18V10" />
                                <path d="M12 18V6" />
                                <path d="M18 18v-4" />
                            </svg>
                        </span>
                        <span>{t('history.vlAnalyze') || 'Analyze'}</span>
                    </button>
                    <button type="button" className="btn ocr-toolbar-btn" onClick={handleCopyAll} disabled={isBusy || !fullText.trim()}>
                        <span className="ocr-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" role="img">
                                <path d="M8 8h10v12H8z" />
                                <path d="M6 4h10v2H6z" />
                                <path d="M4 6h10v2H4z" />
                            </svg>
                        </span>
                        <span>{t('history.ocrCopy') || 'Copy'}</span>
                    </button>
                    <button type="button" className="btn ocr-toolbar-btn" onClick={() => setSelectionMode((prev) => !prev)} disabled={isBusy || !imageReady}>
                        <span className="ocr-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" role="img">
                                <rect x="5" y="5" width="14" height="14" rx="2" ry="2" />
                            </svg>
                        </span>
                        <span>{selectionMode ? (t('history.cancel') || 'Cancel') : (t('history.ocrSelect') || 'Select')}</span>
                    </button>
                    <button type="button" className="btn ocr-toolbar-btn" onClick={() => window.close()}>
                        <span className="ocr-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" role="img">
                                <path d="M6 6l12 12M18 6l-12 12" />
                            </svg>
                        </span>
                        <span>{t('settings.close') || 'Close'}</span>
                    </button>
                </div>
            </div>

            <div className="ocr-window-body">
                <div className="ocr-image-panel">
                    {!imageReady && (
                        <div className="ocr-image-empty">{error || (t('history.ocrInvalidImage') || 'Image not available')}</div>
                    )}
                    {imageReady && (
                        <div
                            className={`ocr-image-stage ${selectionMode ? 'selecting' : ''}`}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            ref={stageRef}
                        >
                            {selectionMode && (
                                <div className="ocr-image-hint">
                                    {t('history.ocrSelectHint') || 'Drag to select an area. Press Esc to cancel.'}
                                </div>
                            )}
                            <div
                                className="ocr-image-wrapper"
                                style={{
                                    width: imageSize.width,
                                    height: imageSize.height,
                                    transform: `scale(${scale})`
                                }}
                            >
                                <img
                                    ref={imgRef}
                                    src={resolvedImageSrc}
                                    alt="ocr-source"
                                    onLoad={handleImageLoad}
                                    draggable={false}
                                />
                                <svg
                                    className="ocr-overlay"
                                    width={imageSize.width}
                                    height={imageSize.height}
                                    viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                                >
                                    {blocks.map((block) => {
                                        const points = Array.isArray(block.points) ? block.points : [];
                                        const normalized = points.map(normalizePoint);
                                        const polygon = normalized.map((p) => `${p.x},${p.y}`).join(' ');
                                        return (
                                            <polygon
                                                key={block.id}
                                                points={polygon}
                                                className={block.id === activeBlockId ? 'active' : ''}
                                                onMouseEnter={() => setActiveBlockId(block.id)}
                                                onMouseLeave={() => setActiveBlockId(null)}
                                                onClick={() => handleCopyBlock(block)}
                                            />
                                        );
                                    })}
                                </svg>
                                {selectionRect && (
                                    <div
                                        className="ocr-selection-rect"
                                        style={{
                                            left: `${selectionRect.x}px`,
                                            top: `${selectionRect.y}px`,
                                            width: `${selectionRect.width}px`,
                                            height: `${selectionRect.height}px`
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="ocr-text-panel">
                    {runtimeNotice && !error && (
                        <div className="ocr-runtime-notice">{runtimeNotice}</div>
                    )}

                    {confidence !== null && !loading && !error && (
                        <div className="ocr-confidence-section">
                            <span className="ocr-confidence-title">{t('history.ocrConfidenceTitle') || 'Recognition Confidence'}:</span>
                            <span className="ocr-confidence-value">{confidence.toFixed(1)}%</span>
                            <span className="ocr-confidence-level">({confidenceInfo?.level || ''}{upscaled ? `, ${t('history.ocrUpscaled') || 'upscaled'}×${upscaleScale.toFixed(2)}` : ''})</span>
                        </div>
                    )}

                    {isBusy && <div className="ocr-loading">{loadingMessage || (loadingPayload ? (t('history.ocrLoadingImage') || 'Loading image...') : (t('history.ocrDetecting') || 'Detecting...'))}</div>}
                    {!isBusy && error && <div className="ocr-error">{error}</div>}
                    {!isBusy && !error && !fullText.trim() && (
                        <div className="ocr-empty">{t('history.ocrNotFound') || 'No text found'}</div>
                    )}
                    {!isBusy && !error && !!fullText.trim() && (
                        <textarea className="ocr-textarea" readOnly value={fullText} />
                    )}

                    {!isBusy && !error && imageReady && (
                        <div className="ocr-hint-row">
                            {t('history.ocrClickBoxHint') || 'Tip: click a green box (or a block on the right) to copy that text.'}
                        </div>
                    )}

                    {!!blocks.length && (
                        <div className="ocr-block-list">
                            {blocks.map((block, index) => (
                                <button
                                    key={block.id}
                                    type="button"
                                    className={`ocr-block-item ${block.id === activeBlockId ? 'active' : ''}`}
                                    onMouseEnter={() => setActiveBlockId(block.id)}
                                    onMouseLeave={() => setActiveBlockId(null)}
                                    onClick={() => handleCopyBlock(block)}
                                >
                                    <span className="ocr-block-index">{index + 1}.</span>
                                    <span className="ocr-block-text">{block.text}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {toast && <div className="ocr-toast">{toast}</div>}
        </div>
    );
}

export default OCRWindow;

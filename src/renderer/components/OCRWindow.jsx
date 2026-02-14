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

function OCRWindow() {
    const { t } = useTranslation();
    const defaultOcrTextLayout = {
        lineMergeThresholdRatio: 0.5,
        lineMergeThresholdPx: 0,
        spaceGapRatio: 0.2,
        spaceGapMinPx: 2,
        insertSpaceByGap: true,
        splitByGap: true
    };
    const imagePath = getSearchParam('imagePath');
    const initialLangs = getSearchParam('langs');
    const parsedLangs = initialLangs
        ? initialLangs.split(',').map((lang) => String(lang || '').trim()).filter(Boolean)
        : ['chi_sim', 'eng'];

    const [loading, setLoading] = useState(true);
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
    const [selectedLanguages, setSelectedLanguages] = useState(parsedLangs);
    const [activeMenu, setActiveMenu] = useState(null); // 'menu' | null
    const [activeMenuSection, setActiveMenuSection] = useState('langs'); // 'langs' | 'layout' | 'settings'
    const [toast, setToast] = useState('');
    const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
    const [scale, setScale] = useState(1);
    const [ocrTextLayout, setOcrTextLayout] = useState({ ...defaultOcrTextLayout });
    const [ocrModelSource, setOcrModelSource] = useState('builtin');
    const [ocrModelLanguage, setOcrModelLanguage] = useState('chinese');
    const [ocrPreprocessModels, setOcrPreprocessModels] = useState({
        docOrientation: true,
        docUnwarp: false,
        textlineOrientation: true
    });

    const imgRef = useRef(null);
    const canvasRef = useRef(null);
    const stageRef = useRef(null);
    const didAutoFitRef = useRef(false);
    const menuRootRef = useRef(null);

    const imageSrc = useMemo(() => {
        if (!imagePath) return '';
        if (imagePath.startsWith('data:image/')) return imagePath;
        if (imagePath.startsWith('file://')) return imagePath;
        return `file://${encodeURI(imagePath)}`;
    }, [imagePath]);

    const showToast = useCallback((message) => {
        setToast(message);
        window.clearTimeout(showToast._timer);
        showToast._timer = window.setTimeout(() => setToast(''), 1200);
    }, []);

    const getConfidenceLevel = useCallback((value) => {
        if (value === null || typeof value !== 'number' || Number.isNaN(value)) return null;
        if (value >= 90) return { level: t('history.ocrConfidenceHigh') || 'High' };
        if (value >= 70) return { level: t('history.ocrConfidenceMedium') || 'Medium' };
        return { level: t('history.ocrConfidenceLow') || 'Low' };
    }, [t]);

    const runOcr = useCallback(async (input) => {
        try {
            setLoading(true);
            setLoadingMessage(t('history.ocrDetecting') || 'Recognizing text...');
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
                setError(res.error || (t('history.ocrFailed') || 'OCR failed'));
                setBlocks([]);
                setFullText('');
                setConfidence(null);
                setUpscaled(false);
                setUpscaleScale(1);
                setLoading(false);
                return;
            }
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
            setError(t('history.ocrFailed') || 'OCR failed');
            setBlocks([]);
            setFullText('');
            setConfidence(null);
            setUpscaled(false);
            setUpscaleScale(1);
            setLoading(false);
        }
    }, [selectedLanguages, ocrTextLayout, ocrModelSource, ocrModelLanguage, ocrPreprocessModels, t, showToast]);

    useEffect(() => {
        try {
            const enabled = getBoolParam('debug') || getBoolParam('ocrDebug');
            if (enabled && typeof globalThis !== 'undefined') {
                globalThis.__OCR_DEBUG__ = true;
            }
        } catch (_) { }
    }, []);

    useEffect(() => {
        if (!window.electronAPI || typeof window.electronAPI.getSettings !== 'function') return;
        window.electronAPI.getSettings()
            .then((cfg) => {
                if (!cfg || typeof cfg !== 'object') return;
                if (cfg.ocrTextLayout && typeof cfg.ocrTextLayout === 'object') {
                    setOcrTextLayout({ ...defaultOcrTextLayout, ...cfg.ocrTextLayout });
                }
                if (typeof cfg.ocrModelSource !== 'undefined') {
                    setOcrModelSource(cfg.ocrModelSource || 'builtin');
                }
                if (typeof cfg.ocrModelLanguage !== 'undefined') {
                    setOcrModelLanguage(cfg.ocrModelLanguage || 'chinese');
                }
                if (cfg.ocrPreprocessModels && typeof cfg.ocrPreprocessModels === 'object') {
                    setOcrPreprocessModels({
                        docOrientation: true,
                        docUnwarp: false,
                        textlineOrientation: true,
                        ...cfg.ocrPreprocessModels
                    });
                }
            })
            .catch(() => { });
    }, []);

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
        if (!imagePath) {
            setError(t('history.ocrInvalidImage') || 'Image not available');
            setLoading(false);
            return;
        }
        runOcr(imageSrc);
    }, [imagePath, imageSrc, runOcr, t]);

    const imageReady = !!imageSrc && !error;

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
                        runOcr(imageSrc);
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
    }, [activeMenu, selectionMode, selecting, fullText, loading, imageReady, runOcr, imageSrc, getFitScale, handleCopyAll]);

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
            setLoadingMessage(t('history.ocrDetecting') || 'Recognizing text...');
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
                setError(res.error || (t('history.ocrFailed') || 'OCR failed'));
                setConfidence(null);
                setUpscaled(false);
                setUpscaleScale(1);
                return;
            }
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
            setError(t('history.ocrFailed') || 'OCR failed');
            setConfidence(null);
            setUpscaled(false);
            setUpscaleScale(1);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleLanguage = (code) => {
        const next = selectedLanguages.includes(code)
            ? selectedLanguages.filter((item) => item !== code)
            : [...selectedLanguages, code];
        const cleaned = next.length ? next : ['chi_sim', 'eng'];
        setSelectedLanguages(cleaned);
        try {
            if (window.electronAPI && typeof window.electronAPI.setSettings === 'function') {
                window.electronAPI.setSettings({ ocrLanguages: cleaned });
            }
        } catch (_) { }
    };

    const updateOcrPreprocessModels = (field, value) => {
        const next = {
            docOrientation: true,
            docUnwarp: false,
            textlineOrientation: true,
            ...(ocrPreprocessModels || {}),
            [field]: value
        };
        setOcrPreprocessModels(next);
        try {
            if (window.electronAPI && typeof window.electronAPI.setSettings === 'function') {
                window.electronAPI.setSettings({ ocrPreprocessModels: next });
            }
        } catch (_) { }
    };

    const updateOcrModelSource = (value) => {
        const next = value || 'builtin';
        setOcrModelSource(next);
        try {
            if (window.electronAPI && typeof window.electronAPI.setSettings === 'function') {
                window.electronAPI.setSettings({ ocrModelSource: next });
            }
        } catch (_) { }
    };

    const updateOcrModelLanguage = (value) => {
        const next = value || 'chinese';
        setOcrModelLanguage(next);
        try {
            if (window.electronAPI && typeof window.electronAPI.setSettings === 'function') {
                window.electronAPI.setSettings({ ocrModelLanguage: next });
            }
        } catch (_) { }
    };

    const updateOcrLayout = (field, value) => {
        const next = {
            ...defaultOcrTextLayout,
            ...(ocrTextLayout || {}),
            [field]: value
        };
        setOcrTextLayout(next);
        try {
            if (window.electronAPI && typeof window.electronAPI.setSettings === 'function') {
                window.electronAPI.setSettings({ ocrTextLayout: next });
            }
        } catch (_) { }
    };

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
                        disabled={loading}
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
                                    {t('history.ocrLangTitle') || 'Languages'} ({selectedLanguages.length})
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
                                                        checked={selectedLanguages.includes(lang.code)}
                                                        onChange={() => handleToggleLanguage(lang.code)}
                                                    />
                                                    <span className="ocr-lang-label">{lang.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="ocr-menu-section-footer">
                                        <span className="ocr-lang-count">{t('history.ocrLangHint') || `Selected: ${selectedLanguages.length} language(s)`}</span>
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
                                                    checked={ocrTextLayout.insertSpaceByGap !== false}
                                                    onChange={(e) => updateOcrLayout('insertSpaceByGap', e.target.checked)}
                                                />
                                                <span>{t('history.ocrLayoutInsertSpace') || 'Insert space by gap'}</span>
                                            </label>
                                            <label className="ocr-layout-option">
                                                <input
                                                    type="checkbox"
                                                    checked={ocrTextLayout.splitByGap !== false}
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
                                                    value={ocrTextLayout.lineMergeThresholdRatio}
                                                    onChange={(e) => updateOcrLayout('lineMergeThresholdRatio', parseFloat(e.target.value))}
                                                />
                                                <strong>{ocrTextLayout.lineMergeThresholdRatio.toFixed(2)}</strong>
                                            </div>

                                            <div className="ocr-layout-control">
                                                <span>{t('history.ocrLayoutLineMergePx') || 'Line merge px'}</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="40"
                                                    step="1"
                                                    value={ocrTextLayout.lineMergeThresholdPx}
                                                    onChange={(e) => updateOcrLayout('lineMergeThresholdPx', parseInt(e.target.value, 10) || 0)}
                                                />
                                                <strong>{ocrTextLayout.lineMergeThresholdPx}px</strong>
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
                                                    value={ocrTextLayout.spaceGapRatio}
                                                    onChange={(e) => updateOcrLayout('spaceGapRatio', parseFloat(e.target.value))}
                                                />
                                                <strong>{ocrTextLayout.spaceGapRatio.toFixed(2)}</strong>
                                            </div>

                                            <div className="ocr-layout-control">
                                                <span>{t('history.ocrLayoutSpaceGapPx') || 'Space gap px'}</span>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="30"
                                                    step="1"
                                                    value={ocrTextLayout.spaceGapMinPx}
                                                    onChange={(e) => updateOcrLayout('spaceGapMinPx', parseInt(e.target.value, 10) || 0)}
                                                />
                                                <strong>{ocrTextLayout.spaceGapMinPx}px</strong>
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
                                                    value={ocrModelSource || 'builtin'}
                                                    onChange={(e) => updateOcrModelSource(e.target.value)}
                                                >
                                                    <option value="builtin">Built-in (PP-OCRv5 mobile)</option>
                                                </select>
                                                <div className="ocr-setting-help">{t('settings.ocr.modelSourceHelp') || ''}</div>
                                            </div>

                                            <div className="ocr-setting-row">
                                                <label className="ocr-setting-label">{t('settings.ocr.modelLanguage') || 'Recognition language'}</label>
                                                <select
                                                    className="ocr-setting-select"
                                                    value={ocrModelLanguage || 'chinese'}
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
                                                        checked={ocrPreprocessModels?.docOrientation !== false}
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
                                                        checked={!!ocrPreprocessModels?.docUnwarp}
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
                                                        checked={ocrPreprocessModels?.textlineOrientation !== false}
                                                        onChange={(e) => updateOcrPreprocessModels('textlineOrientation', e.target.checked)}
                                                    />
                                                    <span>{t('settings.ocr.textlineOrientation') || 'Textline orientation'}</span>
                                                </label>
                                                <div className="ocr-setting-help">{t('settings.ocr.textlineOrientationHelp') || ''}</div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="ocr-menu-section-footer">
                                        <span className="ocr-settings-hint">{t('history.ocrSettingsApplyHint') || 'Settings take effect on the next OCR run. Use "Retry" to apply.'}</span>
                                    </div>
                                </div>
                            )}
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
                    <button type="button" className="btn ocr-toolbar-btn" onClick={() => runOcr(imageSrc)} disabled={loading}>
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
                    <button type="button" className="btn ocr-toolbar-btn" onClick={handleCopyAll} disabled={loading || !fullText.trim()}>
                        <span className="ocr-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" role="img">
                                <path d="M8 8h10v12H8z" />
                                <path d="M6 4h10v2H6z" />
                                <path d="M4 6h10v2H4z" />
                            </svg>
                        </span>
                        <span>{t('history.ocrCopy') || 'Copy'}</span>
                    </button>
                    <button type="button" className="btn ocr-toolbar-btn" onClick={() => setSelectionMode((prev) => !prev)} disabled={loading || !imageReady}>
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
                                    src={imageSrc}
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
                    {confidence !== null && !loading && !error && (
                        <div className="ocr-confidence-section">
                            <span className="ocr-confidence-title">{t('history.ocrConfidenceTitle') || 'Recognition Confidence'}:</span>
                            <span className="ocr-confidence-value">{confidence.toFixed(1)}%</span>
                            <span className="ocr-confidence-level">({confidenceInfo?.level || ''}{upscaled ? `, ${t('history.ocrUpscaled') || 'upscaled'}×${upscaleScale.toFixed(2)}` : ''})</span>
                        </div>
                    )}

                    {loading && <div className="ocr-loading">{loadingMessage || (t('history.ocrDetecting') || 'Detecting...')}</div>}
                    {!loading && error && <div className="ocr-error">{error}</div>}
                    {!loading && !error && !fullText.trim() && (
                        <div className="ocr-empty">{t('history.ocrNotFound') || 'No text found'}</div>
                    )}
                    {!loading && !error && !!fullText.trim() && (
                        <textarea className="ocr-textarea" readOnly value={fullText} />
                    )}

                    {!loading && !error && imageReady && (
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

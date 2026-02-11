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
    const imagePath = getSearchParam('imagePath');
    const initialLangs = getSearchParam('langs');
    const parsedLangs = initialLangs
        ? initialLangs.split(',').map((lang) => String(lang || '').trim()).filter(Boolean)
        : ['chi_sim', 'eng'];

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [blocks, setBlocks] = useState([]);
    const [fullText, setFullText] = useState('');
    const [activeBlockId, setActiveBlockId] = useState(null);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectionRect, setSelectionRect] = useState(null);
    const [selecting, setSelecting] = useState(false);
    const [selectedLanguages, setSelectedLanguages] = useState(parsedLangs);
    const [langExpanded, setLangExpanded] = useState(false);
    const [toast, setToast] = useState('');
    const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
    const [scale, setScale] = useState(1);

    const imgRef = useRef(null);
    const canvasRef = useRef(null);
    const stageRef = useRef(null);
    const didAutoFitRef = useRef(false);

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

    const runOcr = useCallback(async (input) => {
        try {
            setLoading(true);
            setError('');
            const res = await recognizeWithPaddle(input, { languages: selectedLanguages });
            if (res && res.error) {
                setError(res.error || (t('history.ocrFailed') || 'OCR failed'));
                setBlocks([]);
                setFullText('');
                setLoading(false);
                return;
            }
            setBlocks(Array.isArray(res?.blocks) ? res.blocks : []);
            setFullText(res?.text || '');
            if (!res?.text || !String(res.text).trim()) {
                showToast(t('history.ocrNotFound') || 'No text found');
            }
            setLoading(false);
        } catch (err) {
            setError(t('history.ocrFailed') || 'OCR failed');
            setBlocks([]);
            setFullText('');
            setLoading(false);
        }
    }, [selectedLanguages, t, showToast]);

    useEffect(() => {
        if (!imagePath) {
            setError(t('history.ocrInvalidImage') || 'Image not available');
            setLoading(false);
            return;
        }
        runOcr(imageSrc);
    }, [imagePath, imageSrc, runOcr, t]);

    const handleCopyAll = async () => {
        try {
            if (!window.electronAPI || typeof window.electronAPI.copyOCRContent !== 'function') return;
            if (!fullText || !fullText.trim()) return;
            await window.electronAPI.copyOCRContent(fullText);
            showToast(t('history.ocrCopied') || 'OCR text copied');
        } catch (err) {
            showToast(t('history.ocrFailed') || 'OCR failed');
        }
    };

    const handleCopyBlock = async (block) => {
        try {
            if (!block || !block.text) return;
            if (!window.electronAPI || typeof window.electronAPI.copyOCRContent !== 'function') return;
            await window.electronAPI.copyOCRContent(String(block.text));
            showToast(t('history.ocrCopied') || 'OCR text copied');
        } catch (err) {
            showToast(t('history.ocrFailed') || 'OCR failed');
        }
    };

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
            setError('');
            const dataUrl = canvas.toDataURL('image/png');
            const res = await recognizeWithPaddle(dataUrl, { languages: selectedLanguages });
            if (res && res.error) {
                setError(res.error || (t('history.ocrFailed') || 'OCR failed'));
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
            setSelectionRect(null);
        } catch (err) {
            setError(t('history.ocrFailed') || 'OCR failed');
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

    const langOptions = [
        { code: 'chi_sim', label: t('history.ocrLangChiSim') || 'Chinese (Simplified)' },
        { code: 'eng', label: t('history.ocrLangEng') || 'English' }
    ];

    useEffect(() => {
        if (document && typeof document.title === 'string') {
            document.title = t('history.ocrTitle') || 'OCR Result';
        }
    }, [t]);

    const imageReady = !!imageSrc && !error;

    return (
        <div className="ocr-window">
            <div className="ocr-window-header">
                <div className="ocr-window-title">
                    <span>{t('history.ocrTitle') || 'OCR Result'}</span>
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
                    <div className="ocr-panel-section">
                        <button
                            type="button"
                            className="ocr-lang-toggle"
                            onClick={() => setLangExpanded((prev) => !prev)}
                        >
                            <span>{t('history.ocrLangTitle') || 'Languages'} ({selectedLanguages.length})</span>
                            <span className="ocr-lang-toggle-icon">{langExpanded ? '▲' : '▼'}</span>
                        </button>
                        {langExpanded && (
                            <div className="ocr-lang-panel">
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
                                <div className="ocr-lang-hint">{t('history.ocrLangHint') || ''}</div>
                            </div>
                        )}
                    </div>

                    {loading && <div className="ocr-loading">{t('history.ocrDetecting') || 'Detecting...'}</div>}
                    {!loading && error && <div className="ocr-error">{error}</div>}
                    {!loading && !error && !fullText.trim() && (
                        <div className="ocr-empty">{t('history.ocrNotFound') || 'No text found'}</div>
                    )}
                    {!loading && !error && !!fullText.trim() && (
                        <textarea className="ocr-textarea" readOnly value={fullText} />
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

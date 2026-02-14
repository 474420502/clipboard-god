import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

function OCRResultDialog({
    open,
    text = '',
    loading = false,
    error = '',
    confidence = null,
    onClose,
    onCopy,
    onRetry,
    languages = [],
    selectedLanguages = [],
    onChangeLanguages,
    langSelectorExpanded = false,
    onToggleLangSelectorExpanded
}) {
    const { t } = useTranslation();
    const [showLangSelector, setShowLangSelector] = useState(!!langSelectorExpanded);

    React.useEffect(() => {
        setShowLangSelector(!!langSelectorExpanded);
    }, [langSelectorExpanded]);

    React.useEffect(() => {
        if (!open) return;

        const onKeyDown = (e) => {
            try {
                if (!e) return;
                const key = String(e.key || '');
                const lower = key.toLowerCase();
                const ctrlOrCmd = !!(e.ctrlKey || e.metaKey);
                const active = document.activeElement;
                const isEditable = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable);

                if (key === 'Escape') {
                    if (typeof onClose === 'function') onClose();
                    e.preventDefault();
                    return;
                }

                if (ctrlOrCmd && lower === 'r') {
                    if (typeof onRetry === 'function') onRetry();
                    e.preventDefault();
                    return;
                }

                // Copy shortcut only when not focusing an editable control
                if (ctrlOrCmd && lower === 'c' && !isEditable) {
                    if (typeof onCopy === 'function') onCopy();
                    e.preventDefault();
                }
            } catch (_) { }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose, onRetry, onCopy]);


    if (!open) return null;

    const handleOverlayMouseDown = (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('modal-overlay')) {
            onClose();
        }
    };

    const hasText = !!(text && text.trim());

    const handleLanguageToggle = (code) => {
        if (typeof onChangeLanguages === 'function') {
            const newSelected = selectedLanguages.includes(code)
                ? selectedLanguages.filter(l => l !== code)
                : [...selectedLanguages, code];
            onChangeLanguages(newSelected);
        }
    };

    // Get confidence level label
    const getConfidenceLevel = () => {
        if (confidence === null) return null;
        if (confidence >= 90) return { level: t('history.ocrConfidenceHigh'), color: '#4caf50' };
        if (confidence >= 70) return { level: t('history.ocrConfidenceMedium'), color: '#ff9800' };
        return { level: t('history.ocrConfidenceLow'), color: '#f44336' };
    };

    const confidenceInfo = getConfidenceLevel();

    return (
        <div className="modal-overlay" onMouseDown={handleOverlayMouseDown}>
            <div className="ocr-modal" onMouseDown={(e) => e.stopPropagation()}>
                <div className="ocr-modal-header">
                    <h3>{t('history.ocrTitle')}</h3>
                    <button type="button" className="btn-close" onClick={onClose} aria-label={t('settings.close')}>
                        ×
                    </button>
                </div>
                <div className="ocr-modal-body">
                    {/* Language selector section with clear isolation */}
                    <div className="ocr-settings-panel">
                        <div className="ocr-settings-panel-header">
                            <span className="ocr-settings-panel-icon">🌐</span>
                            <span className="ocr-settings-panel-title">{t('history.ocrLangTitle') || 'OCR Languages'}</span>
                            <span className="ocr-settings-panel-badge">{selectedLanguages.length}</span>
                        </div>
                        <div className="ocr-settings-panel-content">
                            <button
                                type="button"
                                className="ocr-lang-toggle"
                                onClick={() => {
                                    const next = !showLangSelector;
                                    setShowLangSelector(next);
                                    if (typeof onToggleLangSelectorExpanded === 'function') {
                                        onToggleLangSelectorExpanded(next);
                                    }
                                }}
                            >
                                <span>{showLangSelector ? t('history.ocrLangHide') || 'Hide languages' : t('history.ocrLangShow') || 'Select languages'}</span>
                                <span className="ocr-lang-toggle-icon">{showLangSelector ? '▲' : '▼'}</span>
                            </button>
                            {showLangSelector && (
                                <div className="ocr-lang-panel">
                                    <div className="ocr-lang-grid">
                                        {(languages || []).map((lang) => (
                                            <label key={lang.code} className="ocr-lang-item">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedLanguages.includes(lang.code)}
                                                    onChange={() => handleLanguageToggle(lang.code)}
                                                />
                                                <span className="ocr-lang-label">{lang.label || lang.code}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="ocr-settings-panel-footer">
                            <span className="ocr-lang-hint">{t('history.ocrLangHint')}</span>
                        </div>
                    </div>

                    {/* Confidence display */}
                    {confidence !== null && (
                        <div className="ocr-confidence-section">
                            <span className="ocr-confidence-title">{t('history.ocrConfidenceTitle')}:</span>
                            <span
                                className="ocr-confidence-value"
                                style={{ color: confidenceInfo?.color || '#666' }}
                            >
                                {confidence.toFixed(1)}%
                            </span>
                            <span
                                className="ocr-confidence-level"
                                style={{ color: confidenceInfo?.color || '#666' }}
                            >
                                ({confidenceInfo?.level || ''})
                            </span>
                        </div>
                    )}

                    {loading && (
                        <div className="ocr-loading">{t('history.ocrDetecting')}</div>
                    )}
                    {!loading && error && (
                        <div className="ocr-error">{error}</div>
                    )}
                    {!loading && !error && !hasText && (
                        <div className="ocr-empty">{t('history.ocrNotFound')}</div>
                    )}
                    {!loading && hasText && (
                        <textarea className="ocr-textarea" readOnly value={text} />
                    )}
                </div>
                <div className="ocr-modal-actions">
                    <button type="button" className="btn" onClick={onClose}>{t('history.cancel')}</button>
                    <button type="button" className="btn" onClick={onRetry} disabled={loading}>{t('history.ocrRetry')}</button>
                    <button type="button" className="btn btn-primary" onClick={onCopy} disabled={!hasText || loading}>{t('history.ocrCopy')}</button>
                </div>
            </div>
        </div>
    );
}

export default OCRResultDialog;
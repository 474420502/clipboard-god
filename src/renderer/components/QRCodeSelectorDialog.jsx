import React from 'react';
import { useTranslation } from 'react-i18next';

function QRCodeSelectorDialog({
    open,
    qrcodes = [],
    selectedId,
    onSelect,
    onClose,
    onCopySelected,
    onCopyAll,
    loading = false
}) {
    const { t } = useTranslation();

    if (!open) return null;

    const handleOverlayMouseDown = (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('modal-overlay')) {
            onClose();
        }
    };

    const hasCodes = Array.isArray(qrcodes) && qrcodes.length > 0;

    return (
        <div className="modal-overlay" onMouseDown={handleOverlayMouseDown}>
            <div className="qr-modal" onMouseDown={(e) => e.stopPropagation()}>
                <div className="qr-modal-header">
                    <h3>{t('history.qrcodeTitle')}</h3>
                    <button type="button" className="btn-close" onClick={onClose} aria-label={t('settings.close')}>
                        ×
                    </button>
                </div>
                <div className="qr-modal-body">
                    {loading && (
                        <div className="qr-loading">{t('history.qrDetecting')}</div>
                    )}
                    {!loading && !hasCodes && (
                        <div className="qr-empty">{t('history.qrNotFound')}</div>
                    )}
                    {!loading && hasCodes && (
                        <ul className="qr-list">
                            {qrcodes.map((qr, idx) => {
                                const id = qr.id || String(idx);
                                const checked = String(selectedId) === String(id);
                                return (
                                    <li key={id} className={`qr-item ${checked ? 'selected' : ''}`} onClick={() => onSelect(id)}>
                                        <label className="qr-item-label">
                                            <input
                                                type="radio"
                                                name="qr-selection"
                                                checked={checked}
                                                onChange={() => onSelect(id)}
                                            />
                                            <span className="qr-index">{idx + 1}.</span>
                                            <span className="qr-content">{qr.content}</span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
                <div className="qr-modal-actions">
                    <button type="button" className="btn" onClick={onClose}>{t('history.cancel')}</button>
                    <button type="button" className="btn" onClick={onCopyAll} disabled={!hasCodes || loading}>{t('history.qrCopyAll')}</button>
                    <button type="button" className="btn btn-primary" onClick={onCopySelected} disabled={!hasCodes || !selectedId || loading}>{t('history.qrCopySelected')}</button>
                </div>
            </div>
        </div>
    );
}

export default QRCodeSelectorDialog;

import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

function EditModal({ open, initialContent = '', onSave, onClose, maxHeight = 400 }) {
    const { t } = useTranslation();
    const [value, setValue] = useState(initialContent || '');
    const textareaRef = useRef(null);
    const overlayRef = useRef(null);
    const previouslyFocusedRef = useRef(null);

    useEffect(() => {
        setValue(initialContent || '');
    }, [initialContent]);

    useEffect(() => {
        if (open) {
            // remember previous focused element so we can restore focus when closing
            previouslyFocusedRef.current = document.activeElement;

            // lock background scrolling
            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';

            // small timeout to ensure elements are mounted
            const id = setTimeout(() => {
                if (textareaRef.current) {
                    textareaRef.current.focus({ preventScroll: true });
                    adjustTextareaHeight();
                }
            }, 0);

            // global key handlers for save and escape
            const onKey = (e) => {
                // Ctrl/Cmd+S
                if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                    e.preventDefault();
                    safeSave();
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    safeClose();
                }
            };
            document.addEventListener('keydown', onKey);

            return () => {
                clearTimeout(id);
                document.removeEventListener('keydown', onKey);
                document.body.style.overflow = originalOverflow;
            };
        } else {
            // when modal is closed, restore focus
            if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
                previouslyFocusedRef.current.focus();
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleTextareaChange = (e) => {
        setValue(e.target.value);
        adjustTextareaHeight();
    };

    const adjustTextareaHeight = () => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
        }
    };

    const safeSave = async () => {
        try {
            if (typeof onSave === 'function') {
                await onSave(value);
            }
        } catch (err) {
            console.error('EditModal save error', err);
        }
    };

    const safeClose = () => {
        if (typeof onClose === 'function') {
            onClose();
        }
    };

    // click outside to close
    const onOverlayClick = (e) => {
        if (e.target === overlayRef.current) {
            safeClose();
        }
    };

    if (!open) return null;

    return (
        <div
            className="modal-overlay"
            ref={overlayRef}
            onClick={onOverlayClick}
            role="dialog"
            aria-modal="true"
            aria-label={t('history.edit') || 'Edit'}
        >
            <div className="edit-modal" tabIndex={-1}>
                <div className="edit-modal-header">
                    <h3 style={{ margin: 0 }}>{t('history.edit') || 'Edit'}</h3>
                    <button
                        className="btn-close"
                        onClick={() => safeClose()}
                        aria-label={t('settings.close') || 'Close'}
                    >&times;</button>
                </div>
                <div className="edit-modal-body">
                    <label htmlFor="edit-modal-textarea" style={{ display: 'none' }}>
                        {t('history.editContent') || 'Edit content'}
                    </label>
                    <textarea
                        id="edit-modal-textarea"
                        ref={textareaRef}
                        value={value}
                        onChange={handleTextareaChange}
                        style={{
                            width: '100%',
                            minHeight: '100%',
                            maxHeight: '100%',
                            overflow: 'auto',
                            resize: 'vertical',
                            boxSizing: 'border-box'
                        }}
                    />
                </div>
                <div className="edit-modal-actions">
                    <button className="btn" onClick={() => safeClose()}>{t('settings.cancel') || 'Cancel'}</button>
                    <button className="btn btn-primary" onClick={safeSave}>{t('settings.save') || 'Save'}</button>
                </div>
            </div>
        </div>
    );
}

export default EditModal;

EditModal.propTypes = {
    open: PropTypes.bool.isRequired,
    initialContent: PropTypes.string,
    onSave: PropTypes.func,
    onClose: PropTypes.func,
    maxHeight: PropTypes.number,
};
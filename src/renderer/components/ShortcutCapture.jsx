import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import './ShortcutCapture.css';

function ShortcutCapture({ value, onChange, placeholder }) {
    const [isCapturing, setIsCapturing] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const [currentKeys, setCurrentKeys] = useState([]);
    const [pressedKeys, setPressedKeys] = useState(new Set());

    const keyNames = {
        'Control': 'Ctrl',
        'Meta': 'Cmd',
        'Alt': 'Alt',
        'Shift': 'Shift',
        ' ': 'Space',
        'ArrowUp': '↑',
        'ArrowDown': '↓',
        'ArrowLeft': '←',
        'ArrowRight': '→',
        'Enter': 'Enter',
        'Escape': 'Esc',
        'Backspace': '⌫',
        'Delete': 'Del',
        'Tab': 'Tab'
    };

    const getKeyDisplayName = (key) => {
        return keyNames[key] || key.toUpperCase();
    };

    const formatShortcut = (keys) => {
        const modifiers = [];
        const regularKeys = [];

        keys.forEach(key => {
            if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
                modifiers.push(key);
            } else {
                regularKeys.push(key);
            }
        });

        // 排序修饰键
        const modifierOrder = ['Control', 'Alt', 'Shift', 'Meta'];
        modifiers.sort((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b));

        const allKeys = [...modifiers, ...regularKeys];
        return allKeys.map(getKeyDisplayName).join('+');
    };

    const handleKeyDown = useCallback((e) => {
        if (!isCapturing) return;

        // 在捕获模式下，阻止所有键盘事件，防止与其他功能冲突
        e.preventDefault();
        e.stopPropagation();

        const key = e.key;

        // ESC 退出
        if (key === 'Escape') {
            setIsCapturing(false);
            setCurrentKeys([]);
            setPressedKeys(new Set());
            return;
        }

        // Enter 确认当前快捷键
        if (key === 'Enter' && currentKeys.length > 0) {
            const shortcut = formatShortcut(currentKeys);
            onChange(shortcut);
            setIsCapturing(false);
            setCurrentKeys([]);
            setPressedKeys(new Set());
            return;
        }

        // 添加按键到按下集合（避免重复）
        setPressedKeys(prev => new Set([...prev, key]));

        // 更新当前键列表
        setCurrentKeys(prev => {
            if (!prev.includes(key)) {
                return [...prev, key];
            }
            return prev;
        });
    }, [isCapturing, currentKeys, onChange]);

    const handleKeyUp = useCallback((e) => {
        if (!isCapturing) return;

        const key = e.key;

        // 从按下集合中移除键
        setPressedKeys(prev => {
            const newPressed = new Set(prev);
            newPressed.delete(key);

            // 如果所有键都松开了，自动确认快捷键
            if (newPressed.size === 0 && currentKeys.length > 0) {
                const shortcut = formatShortcut(currentKeys);
                // 延迟1秒再确认，给用户更多时间调整快捷键组合
                setTimeout(() => {
                    if (!isCapturing) return; // 防止重复触发
                    onChange(shortcut);
                    setIsCapturing(false);
                    setCurrentKeys([]);
                    setPressedKeys(new Set());
                }, 1000);
            }

            return newPressed;
        });
    }, [isCapturing, currentKeys, onChange]);

    const startCapture = () => {
        setIsCapturing(true);
        setCurrentKeys([]);
        setPressedKeys(new Set());
    };

    const confirmShortcut = () => {
        if (currentKeys.length > 0) {
            const shortcut = formatShortcut(currentKeys);
            onChange(shortcut);
        }
        setIsCapturing(false);
        setCurrentKeys([]);
        setPressedKeys(new Set());
    };

    const cancelCapture = () => {
        setIsCapturing(false);
        setCurrentKeys([]);
        setPressedKeys(new Set());
    };

    const startEditing = () => {
        setIsEditing(true);
        setEditValue(value || '');
    };

    const confirmEdit = () => {
        if (editValue.trim()) {
            onChange(editValue.trim());
        }
        setIsEditing(false);
        setEditValue('');
    };

    const cancelEdit = () => {
        setIsEditing(false);
        setEditValue('');
    };

    // 添加/移除全局键盘事件监听器
    useEffect(() => {
        if (isCapturing) {
            document.addEventListener('keydown', handleKeyDown, true);
            document.addEventListener('keyup', handleKeyUp, true);

            return () => {
                document.removeEventListener('keydown', handleKeyDown, true);
                document.removeEventListener('keyup', handleKeyUp, true);
            };
        }
    }, [isCapturing, handleKeyDown, handleKeyUp]);

    // 清理状态
    useEffect(() => {
        return () => {
            setIsCapturing(false);
            setCurrentKeys([]);
            setPressedKeys(new Set());
        };
    }, []);

    const { t } = useTranslation();

    return (
        <div className="shortcut-capture">
            <div className="shortcut-input-group">
                <input
                    type="text"
                    value={value || ''}
                    placeholder={placeholder}
                    readOnly
                    className="shortcut-display"
                />
                <div className="button-group">
                    <button
                        type="button"
                        onClick={startCapture}
                        className="capture-button"
                        disabled={isCapturing || isEditing}
                        title={t('shortcutCapture.captureTitle')}
                    >
                        {isCapturing ? t('shortcutCapture.capturing') : t('shortcutCapture.capture')}
                    </button>
                    <button
                        type="button"
                        onClick={startEditing}
                        className="edit-button"
                        disabled={isCapturing || isEditing}
                        title={t('shortcutCapture.editTitle')}
                    >
                        {t('shortcutCapture.edit')}
                    </button>
                </div>
            </div>

            {isCapturing && (
                <div className="capture-overlay">
                    <div className="capture-modal">
                        <div className="capture-header">
                            <h4>{t('shortcutCapture.recordingTitle')}</h4>
                            <p>{t('shortcutCapture.recordingHelp')}</p>
                        </div>

                        <div className="capture-display">
                            <div className="current-shortcut">
                                {currentKeys.length > 0 ? (
                                    <span className="shortcut-text">
                                        {formatShortcut(currentKeys)}
                                    </span>
                                ) : (
                                    <span className="placeholder">{t('shortcutCapture.waiting')}</span>
                                )}
                            </div>
                        </div>
                        <div className="capture-instructions">
                            <p><strong>{t('shortcutCapture.instructionsTitle')}</strong></p>
                            <ul>
                                <li>{t('shortcutCapture.instructions.step1')}</li>
                                <li>{t('shortcutCapture.instructions.step2')}</li>
                                <li>{t('shortcutCapture.instructions.step3')}</li>
                            </ul>
                        </div>

                        <div className="capture-actions">
                            <button
                                type="button"
                                onClick={cancelCapture}
                                className="cancel-button"
                            >
                                {t('shortcutCapture.cancelWithKey', { key: 'Esc' })}
                            </button>
                            <button
                                type="button"
                                onClick={confirmShortcut}
                                className="confirm-button"
                                disabled={currentKeys.length === 0}
                            >
                                {t('shortcutCapture.confirmWithKey', { key: 'Enter' })}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isEditing && (
                <div className="capture-overlay">
                    <div className="capture-modal">
                        <div className="capture-header">
                            <h4>{t('shortcutCapture.editingTitle')}</h4>
                            <p>{t('shortcutCapture.editingHelp')}</p>
                        </div>

                        <div className="edit-display">
                            <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        confirmEdit();
                                    } else if (e.key === 'Escape') {
                                        cancelEdit();
                                    }
                                }}
                                placeholder={t('shortcutCapture.editPlaceholder')}
                                className="edit-input"
                                autoFocus
                            />
                            <div className="edit-examples">
                                <p><strong>{t('shortcutCapture.examplesTitle')}</strong></p>
                                <ul>
                                    <li><code>Ctrl+A</code> - {t('shortcutCapture.examples.basic')}</li>
                                    <li><code>Ctrl+Shift+A</code> - {t('shortcutCapture.examples.modifiers')}</li>
                                    <li><code>Alt+F4</code> - {t('shortcutCapture.examples.functionKey')}</li>
                                    <li><code>F1</code> - {t('shortcutCapture.examples.singleKey')}</li>
                                </ul>
                            </div>
                        </div>

                        <div className="capture-actions">
                            <button
                                type="button"
                                onClick={cancelEdit}
                                className="cancel-button"
                            >
                                {t('shortcutCapture.cancelWithKey', { key: 'Esc' })}
                            </button>
                            <button
                                type="button"
                                onClick={confirmEdit}
                                className="confirm-button"
                                disabled={!editValue.trim()}
                            >
                                {t('shortcutCapture.confirmWithKey', { key: 'Enter' })}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ShortcutCapture;
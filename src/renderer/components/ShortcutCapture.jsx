import React, { useState, useEffect, useCallback } from 'react';
import './ShortcutCapture.css';

function ShortcutCapture({ value, onChange, placeholder = "点击设置快捷键" }) {
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
                        title="录制快捷键"
                    >
                        {isCapturing ? '录制中...' : '录制'}
                    </button>
                    <button
                        type="button"
                        onClick={startEditing}
                        className="edit-button"
                        disabled={isCapturing || isEditing}
                        title="手动输入快捷键"
                    >
                        编辑
                    </button>
                </div>
            </div>

            {isCapturing && (
                <div className="capture-overlay">
                    <div className="capture-modal">
                        <div className="capture-header">
                            <h4>录制快捷键</h4>
                            <p>按下你想要的快捷键组合</p>
                        </div>

                        <div className="capture-display">
                            <div className="current-shortcut">
                                {currentKeys.length > 0 ? (
                                    <span className="shortcut-text">
                                        {formatShortcut(currentKeys)}
                                    </span>
                                ) : (
                                    <span className="placeholder">等待按键...</span>
                                )}
                            </div>
                        </div>

                        <div className="capture-instructions">
                            <p><strong>操作说明：</strong></p>
                            <ul>
                                <li>按下你想要的快捷键组合</li>
                                <li>松开所有键后等待1秒自动确认，或按 <kbd>Enter</kbd> 立即确认</li>
                                <li>按 <kbd>Esc</kbd> 取消</li>
                            </ul>
                        </div>

                        <div className="capture-actions">
                            <button
                                type="button"
                                onClick={cancelCapture}
                                className="cancel-button"
                            >
                                取消 (Esc)
                            </button>
                            <button
                                type="button"
                                onClick={confirmShortcut}
                                className="confirm-button"
                                disabled={currentKeys.length === 0}
                            >
                                确认 (Enter)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isEditing && (
                <div className="capture-overlay">
                    <div className="capture-modal">
                        <div className="capture-header">
                            <h4>编辑快捷键</h4>
                            <p>直接输入快捷键组合，例如：Ctrl+Shift+A</p>
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
                                placeholder="例如：Ctrl+Shift+A"
                                className="edit-input"
                                autoFocus
                            />
                            <div className="edit-examples">
                                <p><strong>常用格式：</strong></p>
                                <ul>
                                    <li><code>Ctrl+A</code> - 基础组合</li>
                                    <li><code>Ctrl+Shift+A</code> - 多修饰键</li>
                                    <li><code>Alt+F4</code> - 功能键</li>
                                    <li><code>F1</code> - 单独功能键</li>
                                </ul>
                            </div>
                        </div>

                        <div className="capture-actions">
                            <button
                                type="button"
                                onClick={cancelEdit}
                                className="cancel-button"
                            >
                                取消 (Esc)
                            </button>
                            <button
                                type="button"
                                onClick={confirmEdit}
                                className="confirm-button"
                                disabled={!editValue.trim()}
                            >
                                确认 (Enter)
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ShortcutCapture;
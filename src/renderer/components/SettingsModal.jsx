import React, { useState, useEffect } from 'react';

function SettingsModal({ isOpen, onClose, onSave, initialSettings }) {
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState(initialSettings || {
    previewLength: 120,
    maxHistoryItems: 500,
    useNumberShortcuts: true,
    globalShortcut: 'CommandOrControl+Alt+V',
    screenshotShortcut: 'CommandOrControl+Shift+S',
    theme: 'light'
  });

  const tabs = [
    { id: 'general', label: '通用', icon: '⚙️' },
    { id: 'appearance', label: '外观', icon: '🎨' },
    { id: 'shortcuts', label: '快捷键', icon: '⌨️' }
  ];

  // 当 modal 打开或 initialSettings 变化时，从 props 同步内部 state
  useEffect(() => {
    if (!isOpen) return;
    if (initialSettings && typeof initialSettings === 'object') {
      const mapped = {
        previewLength: initialSettings.previewLength,
        maxHistoryItems: initialSettings.maxHistoryItems,
        useNumberShortcuts: typeof initialSettings.useNumberShortcuts !== 'undefined' ? initialSettings.useNumberShortcuts : true,
        globalShortcut: initialSettings.globalShortcut,
        screenshotShortcut: initialSettings.screenshotShortcut,
        theme: initialSettings.theme
      };
      setSettings(prev => ({ ...prev, ...mapped }));
    }
  }, [isOpen, initialSettings]);

  const handleChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = () => {
    try {
      if (window.electronAPI && typeof window.electronAPI.setSettings === 'function') {
        // 将 renderer 的字段映射回主进程期望的字段名
        const payload = {
          ...settings
        };

        window.electronAPI.setSettings(payload)
          .then((res) => {
            if (res && res.success && res.config) {
              if (typeof onSave === 'function') {
                // main returns config with main naming; map to renderer shape
                const mapped = {
                  previewLength: res.config.previewLength,
                  useNumberShortcuts: typeof res.config.useNumberShortcuts !== 'undefined' ? res.config.useNumberShortcuts : res.config.useNumberShortcuts,
                  globalShortcut: res.config.globalShortcut,
                  screenshotShortcut: res.config.screenshotShortcut,
                  theme: res.config.theme
                };
                onSave(mapped);
              }
            } else {
              // fallback: pass the local settings object
              if (typeof onSave === 'function') {
                onSave(settings);
              }
            }
            onClose();
          })
          .catch((error) => {
            console.error('Failed to save settings:', error);
          });
      }
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  // ESC键关闭模态框
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-sidebar"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settingsTitle"
        onClick={(e) => e.stopPropagation()} // 防止点击模态框内部时关闭
      >
        <header className="settings-header">
          <h3 id="settingsTitle">设置</h3>
          <button
            id="closeSettingsBtn"
            className="settings-close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <div className="settings-body">
          <nav className="settings-nav">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="nav-icon">{tab.icon}</span>
                <span className="nav-label">{tab.label}</span>
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {activeTab === 'general' && (
              <div className="settings-section">
                <h4>通用设置</h4>
                <div className="setting-row">
                  <label htmlFor="previewLengthInput">预览长度 (字符)</label>
                  <input
                    id="previewLengthInput"
                    type="number"
                    min="20"
                    max="500"
                    value={settings.previewLength}
                    onChange={(e) => handleChange('previewLength', parseInt(e.target.value) || 120)}
                  />
                  <div className="small">设置列表预览中显示的字符数。较长的预览占用更多空间。</div>
                </div>
                <div className="setting-row">
                  <label htmlFor="maxHistoryItemsInput">历史记录数量上限</label>
                  <input
                    id="maxHistoryItemsInput"
                    type="number"
                    min="10"
                    max="100000"
                    value={settings.maxHistoryItems}
                    onChange={(e) => handleChange('maxHistoryItems', parseInt(e.target.value) || 500)}
                  />
                  <div className="small">设置保存的历史记录最大条数。超过此数量时会自动删除最旧的记录。</div>
                </div>
                <div className="setting-row">
                  <label>
                    <input
                      id="numberShortcutsToggle"
                      type="checkbox"
                      checked={settings.useNumberShortcuts}
                      onChange={(e) => handleChange('useNumberShortcuts', e.target.checked)}
                    />
                    启用数字快捷键 (1-9) 触发粘贴
                  </label>
                  <div className="small">关闭后按数字 1-9 不会触发快速粘贴，且列表中不会显示数字提示。</div>
                </div>
              </div>
            )}
            {activeTab === 'appearance' && (
              <div className="settings-section">
                <h4>外观设置</h4>
                <div className="setting-row">
                  <label htmlFor="themeSelect">主题</label>
                  <select
                    id="themeSelect"
                    value={settings.theme}
                    onChange={(e) => handleChange('theme', e.target.value)}
                  >
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                  <div className="small">选择应用程序的主题风格。</div>
                </div>
              </div>
            )}
            {activeTab === 'shortcuts' && (
              <div className="settings-section">
                <h4>快捷键设置</h4>
                <div className="setting-row">
                  <label htmlFor="globalShortcutInput">全局快捷键</label>
                  <input
                    id="globalShortcutInput"
                    type="text"
                    value={settings.globalShortcut}
                    onChange={(e) => handleChange('globalShortcut', e.target.value)}
                  />
                  <div className="small">显示/隐藏剪贴板窗口的快捷键。使用 Ctrl+Alt+V (Windows/Linux) 或 Cmd+Alt+V (macOS)。常见替代：Ctrl+Shift+V, F12</div>
                </div>
                <div className="setting-row">
                  <label htmlFor="screenshotShortcutInput">截图快捷键</label>
                  <input
                    id="screenshotShortcutInput"
                    type="text"
                    value={settings.screenshotShortcut}
                    onChange={(e) => handleChange('screenshotShortcut', e.target.value)}
                  />
                  <div className="small">触发截图功能的快捷键。使用 Ctrl+Shift+S (Windows/Linux) 或 Cmd+Shift+S (macOS)。</div>
                </div>
              </div>
            )}
          </div>
        </div>
        <footer className="settings-footer">
          <button id="saveSettingsBtn" className="btn-primary" onClick={handleSave}>保存</button>
          <button id="cancelSettingsBtn" onClick={handleCancel}>取消</button>
        </footer>
      </div>
    </div>
  );
}

export default SettingsModal;
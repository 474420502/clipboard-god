import React, { useState, useEffect } from 'react';

function SettingsModal({ isOpen, onClose, onSave }) {
  const [settings, setSettings] = useState({
    previewLength: 120,
    customTooltip: false,
    globalShortcut: 'CommandOrControl+Alt+V'
  });

  // 从主进程获取设置
  useEffect(() => {
    if (isOpen && window.electronAPI) {
      window.electronAPI.getSettings()
        .then((savedSettings) => {
          if (savedSettings) {
            setSettings({
              previewLength: savedSettings.previewLength || 120,
              customTooltip: savedSettings.customTooltip || false,
              globalShortcut: savedSettings.globalShortcut || 'CommandOrControl+Alt+V'
            });
          }
        })
        .catch((error) => {
          console.error('Failed to load settings:', error);
        });
    }
  }, [isOpen]);

  const handleChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = () => {
    try {
      if (window.electronAPI && typeof window.electronAPI.setSettings === 'function') {
        window.electronAPI.setSettings(settings)
          .then(() => {
            if (typeof onSave === 'function') {
              onSave(settings);
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
      <aside
        className="settings-sidebar"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settingsTitle"
        onClick={(e) => e.stopPropagation()} // 防止点击模态框内部时关闭
      >
        <header className="settings-header">
          <h3 id="settingsTitle">Settings</h3>
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
          <div className="setting-row">
            <label htmlFor="previewLengthInput">Preview length (characters)</label>
            <input
              id="previewLengthInput"
              type="number"
              min="20"
              max="500"
              value={settings.previewLength}
              onChange={(e) => handleChange('previewLength', parseInt(e.target.value) || 120)}
            />
            <div className="small">Set how many characters to show in the list preview. Longer previews take more space.</div>
          </div>

          <div className="setting-row">
            <label>
              <input
                id="customTooltipToggle"
                type="checkbox"
                checked={settings.customTooltip}
                onChange={(e) => handleChange('customTooltip', e.target.checked)}
              />
              Use custom tooltip (hover to view & copy)
            </label>
            <div className="small">When enabled, hovering a text item shows a nicer tooltip with copy button.</div>
          </div>

          <div className="setting-row">
            <label htmlFor="globalShortcutInput">Global shortcut</label>
            <input
              id="globalShortcutInput"
              type="text"
              value={settings.globalShortcut}
              onChange={(e) => handleChange('globalShortcut', e.target.value)}
            />
            <div className="small">Shortcut to show/hide the clipboard window. Use Ctrl+Alt+V (Windows/Linux) or Cmd+Alt+V (macOS). Common alternatives: Ctrl+Shift+V, F12</div>
          </div>
        </div>
        <footer className="settings-footer">
          <button id="saveSettingsBtn" className="btn-primary" onClick={handleSave}>Save</button>
          <button id="cancelSettingsBtn" onClick={handleCancel}>Cancel</button>
        </footer>
      </aside>
    </div>
  );
}

export default SettingsModal;
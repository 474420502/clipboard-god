import React, { useState, useEffect } from 'react';
import ShortcutCapture from './ShortcutCapture';

function SettingsModal({ isOpen, onClose, onSave, initialSettings }) {
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState(initialSettings || {
    previewLength: 120,
    maxHistoryItems: 500,
    useNumberShortcuts: true,
    globalShortcut: 'CommandOrControl+Alt+V',
    screenshotShortcut: 'CommandOrControl+Shift+S',
    theme: 'light',
    enableTooltips: true
  });

  const tabs = [
    { id: 'general', label: '通用', icon: '⚙️' },
    { id: 'appearance', label: '外观', icon: '🎨' },
    { id: 'shortcuts', label: '快捷键', icon: '⌨️' },
    { id: 'llm', label: '大模型', icon: '🤖' }
  ];

  // 当 modal 打开或 initialSettings 变化时，从 props 同步内部 state
  useEffect(() => {
    if (!isOpen) return;
    if (initialSettings && typeof initialSettings === 'object') {
      const mapped = {
        previewLength: initialSettings.previewLength,
        maxHistoryItems: initialSettings.maxHistoryItems,
        useNumberShortcuts: typeof initialSettings.useNumberShortcuts !== 'undefined' ? initialSettings.useNumberShortcuts : true,
        enableTooltips: typeof initialSettings.enableTooltips !== 'undefined' ? initialSettings.enableTooltips : true,
        globalShortcut: initialSettings.globalShortcut,
        screenshotShortcut: initialSettings.screenshotShortcut,
        theme: initialSettings.theme
      };
      // include llms map if present
      if (initialSettings.llms && typeof initialSettings.llms === 'object') {
        mapped.llms = { ...initialSettings.llms };
        // if no selected item, pick the first one by default
        const names = Object.keys(initialSettings.llms);
        if (names.length > 0) {
          mapped._selectedLlm = names[0];
        }
      }
      setSettings(prev => ({ ...prev, ...mapped }));
    }
  }, [isOpen, initialSettings]);

  const handleChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
    // If user is toggling off tooltips, immediately hide any visible tooltip
    try {
      if (field === 'enableTooltips' && value === false && window.electronAPI && typeof window.electronAPI.hideTooltip === 'function') {
        window.electronAPI.hideTooltip();
      }
    } catch (err) { }
  };

  const handleSave = () => {
    try {
      if (window.electronAPI && typeof window.electronAPI.setSettings === 'function') {
        // 将 renderer 的字段映射回主进程期望的字段名
        const payload = {
          ...settings
        };

        // Validate: ensure no duplicate llm shortcuts among llms entries
        try {
          if (payload.llms && typeof payload.llms === 'object') {
            const shortcutMap = {};
            for (const [name, entry] of Object.entries(payload.llms)) {
              if (!entry) continue;
              const sc = entry.llmShortcut ? String(entry.llmShortcut).trim() : '';
              if (!sc) continue;
              const key = sc.toLowerCase();
              if (!shortcutMap[key]) shortcutMap[key] = [];
              shortcutMap[key].push(name);
            }
            const conflicts = Object.entries(shortcutMap).filter(([, names]) => names.length > 1);
            if (conflicts.length > 0) {
              const msgs = conflicts.map(([sc, names]) => `快捷键 "${sc}" 被以下条目重复使用：${names.join('，')}`).join('\n');
              alert('检测到快捷键冲突，已取消保存：\n' + msgs);
              return; // abort save
            }
          }
        } catch (err) {
          // If validation fails unexpectedly, fall back to attempting save; but log
          console.warn('LLM shortcut validation failed:', err);
        }

        window.electronAPI.setSettings(payload)
          .then((res) => {
            // prefer the main process returned config when possible, but ensure llms is passed through
            let mappedResult = null;
            if (res && res.success && res.config) {
              mappedResult = {
                previewLength: res.config.previewLength,
                maxHistoryItems: res.config.maxHistoryItems,
                useNumberShortcuts: typeof res.config.useNumberShortcuts !== 'undefined' ? res.config.useNumberShortcuts : res.config.useNumberShortcuts,
                enableTooltips: typeof res.config.enableTooltips !== 'undefined' ? res.config.enableTooltips : true,
                globalShortcut: res.config.globalShortcut,
                screenshotShortcut: res.config.screenshotShortcut,
                theme: res.config.theme,
                llms: res.config.llms || settings.llms || {}
              };
            }

            if (!mappedResult) {
              // fallback to local settings snapshot
              mappedResult = {
                previewLength: settings.previewLength,
                maxHistoryItems: settings.maxHistoryItems,
                useNumberShortcuts: settings.useNumberShortcuts,
                enableTooltips: settings.enableTooltips,
                globalShortcut: settings.globalShortcut,
                screenshotShortcut: settings.screenshotShortcut,
                theme: settings.theme,
                llms: settings.llms || {}
              };
            }

            if (typeof onSave === 'function') {
              onSave(mappedResult);
            }

            // also ensure tooltip is hidden if saved config disables it
            try {
              if (mappedResult && mappedResult.enableTooltips === false && window.electronAPI && typeof window.electronAPI.hideTooltip === 'function') {
                window.electronAPI.hideTooltip();
              }
            } catch (err) { }

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
    <div className="settings-overlay" onClick={onClose} style={{ height: '100%' }}>
      <div
        className="settings-sidebar"
        style={{ height: '100%' }}
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
                <div className="setting-row">
                  <label>
                    <input
                      id="enableTooltipsToggle"
                      type="checkbox"
                      checked={settings.enableTooltips}
                      onChange={(e) => handleChange('enableTooltips', e.target.checked)}
                    />
                    启用工具提示
                  </label>
                  <div className="small">关闭后应用将不再显示条目预览的工具提示（包括主进程的外部 tooltip 窗口）。</div>
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
                    <option value="light">经典浅色</option>
                    <option value="dark">经典深色</option>
                    <option value="blue">蓝色主题</option>
                    <option value="purple">紫色主题</option>
                    <option value="green">绿色主题</option>
                    <option value="orange">橙色主题</option>
                    <option value="pink">粉色主题</option>
                    <option value="gray">灰色主题</option>
                    <option value="eye-protection">护眼模式</option>
                    <option value="high-contrast">高对比度</option>
                  </select>
                  <div className="small">选择应用程序的主题风格。</div>
                </div>
              </div>
            )}
            {activeTab === 'shortcuts' && (
              <div className="settings-section">
                <h4>快捷键设置</h4>
                <div className="setting-row">
                  <label>全局快捷键</label>
                  <ShortcutCapture
                    value={settings.globalShortcut}
                    onChange={(value) => handleChange('globalShortcut', value)}
                    placeholder="点击设置全局快捷键"
                  />
                  <div className="small">显示/隐藏剪贴板窗口的快捷键。使用 Ctrl+Alt+V (Windows/Linux) 或 Cmd+Alt+V (macOS)。常见替代：Ctrl+Shift+V, F12</div>
                </div>
                <div className="setting-row">
                  <label>截图快捷键</label>
                  <ShortcutCapture
                    value={settings.screenshotShortcut}
                    onChange={(value) => handleChange('screenshotShortcut', value)}
                    placeholder="点击设置截图快捷键"
                  />
                  <div className="small">触发截图功能的快捷键。使用 Ctrl+Shift+S (Windows/Linux) 或 Cmd+Shift+S (macOS)。</div>
                </div>
              </div>
            )}
            {activeTab === 'llm' && (
              <div className="settings-section">
                <h4>大模型设置（多条目）</h4>
                <div className="small">可创建多个命名的 LLM 条目，每个条目可配置 model/prompt/baseurl/apikey/params 及快捷键。</div>

                {/* list of named entries: select or type name to add */}
                <div className="setting-row">
                  <label>条目名称（选择或输入）</label>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input
                      list="llm-names"
                      placeholder="选择已有或输入新名称，例如：备注1"
                      value={settings._selectedLlm || ''}
                      onChange={(e) => handleChange('_selectedLlm', e.target.value)}
                    />
                    <datalist id="llm-names">
                      {settings.llms && Object.keys(settings.llms).map(name => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                    <button type="button" onClick={() => {
                      const name = (settings._selectedLlm || '').trim();
                      if (!name) return;
                      if (settings.llms && settings.llms[name]) {
                        // already exists -> just select it
                        handleChange('_selectedLlm', name);
                        return;
                      }
                      const next = { ...(settings.llms || {}) };
                      next[name] = {
                        model: '',
                        prompt: '',
                        baseurl: '',
                        apikey: '',
                        temperature: 0.7,
                        top_p: 0.95,
                        top_k: 0.9,
                        context_window: 32768,
                        max_tokens: 32768,
                        min_p: 0.05,
                        presence_penalty: 1.1,
                        llmShortcut: ''
                      };
                      handleChange('llms', next);
                      handleChange('_selectedLlm', name);
                    }}>+</button>
                  </div>
                </div>

                {/* If an entry is selected, show its fields */}
                {settings._selectedLlm && settings.llms && settings.llms[settings._selectedLlm] && (
                  (() => {
                    const name = settings._selectedLlm;
                    const entry = settings.llms[name];
                    return (
                      <div key={name} style={{ borderTop: '1px solid #eee', marginTop: '12px', paddingTop: '12px' }}>
                        <h5>{name}</h5>
                        <div className="setting-row">
                          <label>API 类型</label>
                          <select
                            value={entry.apitype || 'ollama'}
                            onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), apitype: e.target.value } })}
                          >
                            <option value="ollama">Ollama</option>
                            <option value="openapi">OpenAPI</option>
                          </select>
                        </div>
                        <div className="setting-row">
                          <label>Model</label>
                          <input type="text" value={entry.model || ''} onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), model: e.target.value } })} />
                        </div>
                        <div className="setting-row">
                          <label>Base URL</label>
                          <input type="text" placeholder="http://localhost:11434" value={entry.baseurl || ''} onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), baseurl: e.target.value } })} />
                        </div>
                        <div className="setting-row">
                          <label>API Key</label>
                          <input type="password" value={entry.apikey || ''} onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), apikey: e.target.value } })} />
                        </div>
                        <div className="setting-row">
                          <label>Prompt</label>
                          <textarea rows={3} value={entry.prompt || ''} onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), prompt: e.target.value } })} />
                        </div>
                        <div className="setting-row">
                          <label>LLM 快捷键</label>
                          <ShortcutCapture value={entry.llmShortcut || ''} onChange={(v) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), llmShortcut: v } })} placeholder="可选快捷键" />
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button type="button" onClick={() => {
                            // delete
                            if (!confirm(`删除条目 "${name}" ?`)) return;
                            const next = { ...(settings.llms || {}) };
                            delete next[name];
                            handleChange('llms', next);
                            handleChange('_selectedLlm', '');
                          }}>删除</button>
                          <div className="small">保存时会把所有条目写回配置文件；同名条目不允许存在。</div>
                        </div>
                      </div>
                    );
                  })()
                )}
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


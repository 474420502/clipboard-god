import React, { useState, useEffect } from 'react';
import i18next from '../i18n';
import { useTranslation } from 'react-i18next';
import ShortcutCapture from './ShortcutCapture';

function SettingsModal({ isOpen, onClose, onSave, initialSettings }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState(initialSettings || {
    previewLength: 120,
    maxHistoryItems: 500,
    useNumberShortcuts: true,
    globalShortcut: 'CommandOrControl+Alt+V',
    screenshotShortcut: 'CommandOrControl+Shift+S',
    theme: 'light',
    enableTooltips: true,
    locale: 'zh-CN' // 默认语言
  });

  const tabs = [
    { id: 'general', label: t('settings.tabs.general'), icon: '⚙️' },
    { id: 'appearance', label: t('settings.tabs.appearance'), icon: '🎨' },
    { id: 'shortcuts', label: t('settings.tabs.shortcuts'), icon: '⌨️' },
    { id: 'llm', label: t('settings.tabs.llm'), icon: '🤖' }
  ];

  // 控制每个条目的参数面板是否展开（默认折叠 -> false）
  const [paramsExpanded, setParamsExpanded] = useState({});



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

            // If locale was changed, persist via localeAPI and update i18next
            try {
              const newLocale = settings.locale;
              if (newLocale && window.localeAPI && typeof window.localeAPI.setLocale === 'function') {
                window.localeAPI.setLocale(newLocale).then(() => {
                  try { i18next.changeLanguage(newLocale); } catch (e) { }
                }).catch(() => { try { i18next.changeLanguage(newLocale); } catch (e) { } });
              } else if (newLocale) {
                try { i18next.changeLanguage(newLocale); } catch (e) { }
              }
            } catch (e) { }

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

  // 当传入的 initialSettings 在主进程加载后更新时，
  // 在打开设置模态框时把初始值同步到内部 state，避免仍然显示最初的默认值。
  useEffect(() => {
    if (!isOpen) return; // 仅在打开模态框时同步
    try {
      const src = initialSettings || {};
      setSettings(prev => ({
        previewLength: typeof src.previewLength !== 'undefined' ? src.previewLength : 120,
        maxHistoryItems: typeof src.maxHistoryItems !== 'undefined' ? src.maxHistoryItems : 500,
        useNumberShortcuts: typeof src.useNumberShortcuts !== 'undefined' ? src.useNumberShortcuts : true,
        globalShortcut: typeof src.globalShortcut !== 'undefined' ? src.globalShortcut : 'CommandOrControl+Alt+V',
        screenshotShortcut: typeof src.screenshotShortcut !== 'undefined' ? src.screenshotShortcut : 'CommandOrControl+Shift+S',
        theme: typeof src.theme !== 'undefined' ? src.theme : 'light',
        enableTooltips: typeof src.enableTooltips !== 'undefined' ? src.enableTooltips : true,
        locale: typeof src.locale !== 'undefined' ? src.locale : 'zh-CN',
        llms: src.llms || {},
        _selectedLlm: src._selectedLlm || ''
      }));
    } catch (err) {
      console.warn('Failed to sync initialSettings into SettingsModal:', err);
    }
  }, [initialSettings, isOpen]);

  // Previously we auto-created an LLM entry when the user typed/selected a name.
  // That caused entries to appear without the user clicking [+]. Disable auto-create
  // and only create a new entry when the user explicitly clicks the + button below.
  // Keep the selected name value but do not mutate `settings.llms` here.
  useEffect(() => {
    // If the selected name no longer exists in llms, keep the selection but do not
    // create or mutate the llms map here. The + button will create entries.
    // This effect intentionally does nothing to avoid implicit creation.
    return () => { };
  }, [settings._selectedLlm]);

  if (!isOpen) return null;
  return (
    <div className="settings-overlay" onClick={onClose} style={{ height: '100%' }}>
      <div
        className="settings-sidebar"
        style={{ height: '100%' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settingsTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-header">
          <h3 id="settingsTitle">{t('settings.title')}</h3>
          <button
            id="closeSettingsBtn"
            className="settings-close"
            aria-label={t('settings.close')}
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
                <h4>{t('settings.general.title')}</h4>

                <div className="setting-row">
                  <label htmlFor="localeSelect">{t('settings.general.locale.label')}</label>
                  <select id="localeSelect" value={settings.locale || 'zh-CN'} onChange={(e) => handleChange('locale', e.target.value)}>
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                  </select>
                  <div className="small">{t('settings.general.locale.help')}</div>
                </div>

                <div className="setting-row">
                  <label htmlFor="previewLengthInput">{t('settings.general.previewLength.label')}</label>
                  <input
                    id="previewLengthInput"
                    type="number"
                    min="20"
                    max="500"
                    value={settings.previewLength}
                    onChange={(e) => handleChange('previewLength', parseInt(e.target.value) || 120)}
                  />
                  <div className="small">{t('settings.general.previewLength.help')}</div>
                </div>

                <div className="setting-row">
                  <label htmlFor="maxHistoryItemsInput">{t('settings.general.maxHistory.label')}</label>
                  <input
                    id="maxHistoryItemsInput"
                    type="number"
                    min="10"
                    max="100000"
                    value={settings.maxHistoryItems}
                    onChange={(e) => handleChange('maxHistoryItems', parseInt(e.target.value) || 500)}
                  />
                  <div className="small">{t('settings.general.maxHistory.help')}</div>
                </div>

                <div className="setting-row">
                  <label>
                    <input
                      id="numberShortcutsToggle"
                      type="checkbox"
                      checked={settings.useNumberShortcuts}
                      onChange={(e) => handleChange('useNumberShortcuts', e.target.checked)}
                    />
                    {t('settings.general.useNumberShortcuts.label')}
                  </label>
                  <div className="small">{t('settings.general.useNumberShortcuts.help')}</div>
                </div>

                <div className="setting-row">
                  <label>
                    <input
                      id="enableTooltipsToggle"
                      type="checkbox"
                      checked={settings.enableTooltips}
                      onChange={(e) => handleChange('enableTooltips', e.target.checked)}
                    />
                    {t('settings.general.enableTooltips.label')}
                  </label>
                  <div className="small">{t('settings.general.enableTooltips.help')}</div>
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="settings-section">
                <h4>{t('settings.appearance.title')}</h4>
                <div className="setting-row">
                  <label htmlFor="themeSelect">{t('settings.appearance.theme.label')}</label>
                  <select
                    id="themeSelect"
                    value={settings.theme}
                    onChange={(e) => handleChange('theme', e.target.value)}
                  >
                    <option value="light">{t('settings.appearance.theme.options.light')}</option>
                    <option value="dark">{t('settings.appearance.theme.options.dark')}</option>
                    <option value="blue">{t('settings.appearance.theme.options.blue')}</option>
                    <option value="purple">{t('settings.appearance.theme.options.purple')}</option>
                    <option value="green">{t('settings.appearance.theme.options.green')}</option>
                    <option value="orange">{t('settings.appearance.theme.options.orange')}</option>
                    <option value="pink">{t('settings.appearance.theme.options.pink')}</option>
                    <option value="gray">{t('settings.appearance.theme.options.gray')}</option>
                    <option value="eye-protection">{t('settings.appearance.theme.options.eye-protection')}</option>
                    <option value="high-contrast">{t('settings.appearance.theme.options.high-contrast')}</option>
                  </select>
                  <div className="small">{t('settings.appearance.theme.help')}</div>
                </div>
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <div className="settings-section">
                <h4>{t('settings.shortcuts.title')}</h4>
                <div className="setting-row">
                  <label>{t('settings.shortcuts.globalShortcut.label')}</label>
                  <ShortcutCapture
                    value={settings.globalShortcut}
                    onChange={(value) => handleChange('globalShortcut', value)}
                    placeholder={t('settings.shortcuts.globalShortcut.placeholder')}
                  />
                  <div className="small">{t('settings.shortcuts.globalShortcut.help')}</div>
                </div>
                <div className="setting-row">
                  <label>{t('settings.shortcuts.screenshotShortcut.label')}</label>
                  <ShortcutCapture
                    value={settings.screenshotShortcut}
                    onChange={(value) => handleChange('screenshotShortcut', value)}
                    placeholder={t('settings.shortcuts.screenshotShortcut.placeholder')}
                  />
                  <div className="small">{t('settings.shortcuts.screenshotShortcut.help')}</div>
                </div>
              </div>
            )}

            {activeTab === 'llm' && (
              <div className="settings-section">
                <h4>{t('settings.llm.title')}</h4>
                <div className="small">{t('settings.llm.description')}</div>

                {/* list of named entries: select or type name to add */}
                <div className="setting-row">
                  <label>{t('settings.llm.entryName.label')}</label>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flex: '1 1 auto', minWidth: 0 }}>
                      <input
                        list="llm-names"
                        placeholder={t('settings.llm.entryName.placeholder')}
                        value={settings._selectedLlm || ''}
                        onChange={(e) => handleChange('_selectedLlm', e.target.value)}
                        style={{ flex: '1 1 auto', minWidth: 0 }}
                      />
                      <datalist id="llm-names">
                        {settings.llms && Object.keys(settings.llms).map(name => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                      <button
                        type="button"
                        title={t('settings.llm.addButton')}
                        style={{ flex: '0 0 auto', padding: '6px 10px' }}
                        onClick={() => {
                          const name = (settings._selectedLlm || '').trim();
                          if (!name) return;
                          if (settings.llms && settings.llms[name]) {
                            handleChange('_selectedLlm', name);
                            return;
                          }
                          const next = { ...(settings.llms || {}) };
                          next[name] = {
                            apitype: 'ollama',
                            model: '',
                            prompt: 'Summarize {{text}}',
                            triggerType: 'text',
                            baseurl: 'http://localhost:11434',
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
                        }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {settings._selectedLlm && settings.llms && settings.llms[settings._selectedLlm] && (
                  (() => {
                    const name = settings._selectedLlm;
                    const entry = settings.llms[name];
                    return (
                      <div key={name} style={{ borderTop: '1px solid #eee', marginTop: '12px', paddingTop: '12px' }}>
                        <h5>{name}</h5>
                        <div className="setting-row">
                          <label>{t('settings.llm.apiTypeLabel')}</label>
                          <select
                            value={entry.apitype || 'ollama'}
                            onChange={(e) => {
                              const v = e.target.value;
                              const nextEntry = { ...(entry || {}), apitype: v };
                              if (v === 'ollama' && (!nextEntry.baseurl || String(nextEntry.baseurl).trim() === '')) {
                                nextEntry.baseurl = 'http://localhost:11434';
                              }
                              handleChange('llms', { ...(settings.llms || {}), [name]: nextEntry });
                            }}
                          >
                            <option value="ollama">{t('settings.llm.apiTypeOptions.ollama')}</option>
                            <option value="openapi">{t('settings.llm.apiTypeOptions.openapi')}</option>
                          </select>
                        </div>
                        <div className="setting-row">
                          <label>{t('settings.llm.triggerTypeLabel')}</label>
                          <select
                            value={entry.triggerType || 'text'}
                            onChange={(e) => {
                              const val = e.target.value;
                              const nextEntry = { ...(entry || {}), triggerType: val };
                              if (val === 'text' && (!nextEntry.prompt || String(nextEntry.prompt).trim() === '')) {
                                nextEntry.prompt = 'Summarize {{text}}';
                              }
                              if (val === 'image' && nextEntry.prompt === 'Summarize {{text}}') {
                                nextEntry.prompt = '';
                              }
                              handleChange('llms', { ...(settings.llms || {}), [name]: nextEntry });
                            }}
                          >
                            <option value="text">{t('settings.llm.triggerTypeOptions.text')}</option>
                            <option value="image">{t('settings.llm.triggerTypeOptions.image')}</option>
                          </select>
                          <div className="small">{t('settings.llm.triggerHelp')}</div>
                        </div>
                        <div className="setting-row">
                          <label>{t('settings.llm.modelLabel')}</label>
                          <input type="text" value={entry.model || ''} onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), model: e.target.value } })} />
                        </div>
                        <div className="setting-row">
                          <label>{t('settings.llm.baseUrlLabel')}</label>
                          <input type="text" placeholder="http://localhost:11434" value={entry.baseurl || ''} onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), baseurl: e.target.value } })} />
                        </div>
                        <div className="setting-row">
                          <label>{t('settings.llm.apiKeyLabel')}</label>
                          <input type="password" value={entry.apikey || ''} onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), apikey: e.target.value } })} />
                        </div>
                        <div className="setting-row" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label>{t('settings.llm.promptLabel')}</label>
                          <textarea
                            rows={3}
                            value={entry.prompt || ''}
                            placeholder={(!entry.prompt || String(entry.prompt).trim() === '') && (entry.triggerType || 'text') === 'text' ? 'Summarize {{text}}' : ''}
                            onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), prompt: e.target.value } })}
                            style={{ width: '100%', minHeight: '80px', resize: 'vertical' }}
                          />
                        </div>

                        <div className="setting-row">
                          <label>{t('settings.llm.entryShortcutLabel')}</label>
                          <ShortcutCapture
                            value={entry.llmShortcut || ''}
                            onChange={(value) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), llmShortcut: value } })}
                            placeholder={t('settings.llm.shortcutPlaceholder')}
                          />
                          <div className="small">{t('settings.llm.shortcutHelp')}</div>
                        </div>

                        <div className="params-group" style={{ borderTop: '1px solid #f0f0f0', paddingTop: '12px', marginTop: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h6 style={{ margin: 0 }}>{t('settings.llm.paramsTitle')}</h6>
                            <button
                              type="button"
                              className="params-toggle"
                              onClick={() => setParamsExpanded(prev => ({ ...(prev || {}), [name]: !prev[name] }))}
                              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--settings-text)' }}
                            >
                              {(paramsExpanded && paramsExpanded[name]) ? t('settings.llm.collapse') : t('settings.llm.expand')}
                            </button>
                          </div>
                          {(paramsExpanded && paramsExpanded[name]) ? (
                            <div className="params-content" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                              <div className="setting-row">
                                <label>{t('settings.llm.temperature')}</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="2"
                                  value={typeof entry.temperature !== 'undefined' ? entry.temperature : 0.7}
                                  onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), temperature: parseFloat(e.target.value) || 0 } })}
                                />
                              </div>

                              <div className="setting-row">
                                <label>{t('settings.llm.topP')}</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="1"
                                  value={typeof entry.top_p !== 'undefined' ? entry.top_p : 0.95}
                                  onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), top_p: parseFloat(e.target.value) || 0 } })}
                                />
                              </div>

                              <div className="setting-row">
                                <label>{t('settings.llm.topK')}</label>
                                <input
                                  type="number"
                                  step="1"
                                  min="0"
                                  value={typeof entry.top_k !== 'undefined' ? entry.top_k : 0.9}
                                  onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), top_k: parseFloat(e.target.value) || 0 } })}
                                />
                              </div>

                              <div className="setting-row">
                                <label>{t('settings.llm.contextWindow')}</label>
                                <input
                                  type="number"
                                  step="1"
                                  min="0"
                                  value={typeof entry.context_window !== 'undefined' ? entry.context_window : 32768}
                                  onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), context_window: parseInt(e.target.value) || 0 } })}
                                />
                              </div>

                              <div className="setting-row">
                                <label>{t('settings.llm.maxTokens')}</label>
                                <input
                                  type="number"
                                  step="1"
                                  min="0"
                                  value={typeof entry.max_tokens !== 'undefined' ? entry.max_tokens : 32768}
                                  onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), max_tokens: parseInt(e.target.value) || 0 } })}
                                />
                              </div>

                              <div className="setting-row">
                                <label>{t('settings.llm.minP')}</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="1"
                                  value={typeof entry.min_p !== 'undefined' ? entry.min_p : 0.05}
                                  onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), min_p: parseFloat(e.target.value) || 0 } })}
                                />
                              </div>

                              <div className="setting-row">
                                <label>{t('settings.llm.presencePenalty')}</label>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="-2"
                                  max="2"
                                  value={typeof entry.presence_penalty !== 'undefined' ? entry.presence_penalty : 1.1}
                                  onChange={(e) => handleChange('llms', { ...(settings.llms || {}), [name]: { ...(entry || {}), presence_penalty: parseFloat(e.target.value) || 0 } })}
                                />
                              </div>
                            </div>
                          ) : (
                            <div style={{ marginTop: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}>{t('settings.llm.paramsCollapsed')}</div>
                          )}
                        </div>

                        <div className="setting-row">
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button type="button" onClick={() => {
                              if (!confirm(t('settings.llm.deleteConfirm', { name }))) return;
                              const next = { ...(settings.llms || {}) };
                              delete next[name];
                              handleChange('llms', next);
                              handleChange('_selectedLlm', '');
                            }}>{t('settings.llm.delete')}</button>
                            <div className="small">{t('settings.llm.saveNote')}</div>
                          </div>
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
          <button id="saveSettingsBtn" className="btn-primary" onClick={handleSave}>{t('settings.save')}</button>
          <button id="cancelSettingsBtn" onClick={handleCancel}>{t('settings.cancel')}</button>
        </footer>
      </div>
    </div>
  );
}

export default SettingsModal;


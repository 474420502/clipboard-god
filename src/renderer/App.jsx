// NOTE: This file's IPC and keyboard wiring was simplified to trust the
// `preload`-exposed `electronAPI`. Defensive fallbacks that attempted to
// require('electron') from the renderer were removed to reduce redundancy
// and surface potential security/clarity issues.
//
// The legacy DOM-based manager at `src/renderer/rendererManager.js` still
// exists and contains duplicated logic (IPC listeners, tooltip helpers and
// keyboard handling). Review that file and remove or migrate it when the
// React components are the single source of truth for UI rendering.
//
// Changes in this file:
// - use `electronAPI.getHistory()` on mount and subscribe to `onUpdateHistory`/`onError`.
// - use the preload's ipcRenderer wrapper only for the legacy 'history-data' channel.
// - avoid overwriting settings keys with undefined when mapping payloads.
import React, { useState, useEffect, useCallback } from 'react';
import HistoryList from './components/HistoryList';
import SearchBar from './components/SearchBar';
import SettingsModal from './components/SettingsModal';
import useNumberShortcuts from './hooks/useNumberShortcuts';

function App() {
  const [history, setHistory] = useState([]);
  const [filteredHistory, setFilteredHistory] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchOptions, setSearchOptions] = useState({
    type: 'all',
    sortBy: 'time'
  });
  const [searchVisible, setSearchVisible] = useState(false); // hidden by default
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({
    previewLength: 120,
    customTooltip: false,
    useNumberShortcuts: true,
    globalShortcut: 'CommandOrControl+Alt+V',
    screenshotShortcut: 'CommandOrControl+Shift+S',
    theme: 'light'
  });

  // 在 App 挂载时，从主进程加载设置并作为单一来源
  useEffect(() => {
    if (!window.electronAPI || typeof window.electronAPI.getSettings !== 'function') return;

    // Load settings from main process. Map keys only when present to avoid overwriting with undefined.
    window.electronAPI.getSettings()
      .then((cfg) => {
        if (cfg && typeof cfg === 'object') {
          const mapped = {};
          if (typeof cfg.previewLength !== 'undefined') mapped.previewLength = cfg.previewLength;
          if (typeof cfg.customTooltip !== 'undefined') mapped.customTooltip = cfg.customTooltip;
          if (typeof cfg.useNumberShortcuts !== 'undefined') mapped.useNumberShortcuts = cfg.useNumberShortcuts;
          if (typeof cfg.globalShortcut !== 'undefined') mapped.globalShortcut = cfg.globalShortcut;
          if (typeof cfg.screenshotShortcut !== 'undefined') mapped.screenshotShortcut = cfg.screenshotShortcut;
          if (typeof cfg.theme !== 'undefined') mapped.theme = cfg.theme;

          setSettings(prev => ({ ...prev, ...mapped }));
        }
      })
      .catch((err) => {
        console.error('Failed to load settings from main process:', err);
      });
  }, []);

  // 设置 IPC 监听器（简化：使用 preload 暴露的 API，移除 require('electron') 的冗余 fallback）
  useEffect(() => {
    if (!window.electronAPI) {
      console.error('electronAPI not available');
      return;
    }

    // 初始加载数据（通过 preload -> 主进程触发 history-data 或 update-history）
    try {
      window.electronAPI.getHistory();
    } catch (error) {
      console.error('Failed to get history:', error);
    }

    const handleHistoryData = (_history) => {
      // history-data carries the initial full history
      setHistory(_history);
    };

    const handleUpdate = (updatedHistory) => {
      setHistory(updatedHistory);
    };

    const handleError = (error) => {
      console.error('Received error from main process:', error);
    };

    // subscribe to updates / errors via preload wrappers
    window.electronAPI.onUpdateHistory(handleUpdate);
    window.electronAPI.onError(handleError);

    // preload exposes a thin ipcRenderer wrapper — use it for the legacy 'history-data' channel
    if (window.electronAPI.ipcRenderer && typeof window.electronAPI.ipcRenderer.on === 'function') {
      window.electronAPI.ipcRenderer.on('history-data', (_event, data) => handleHistoryData(data));
    }

    return () => {
      try {
        // cleanup listeners registered via preload
        if (window.electronAPI && typeof window.electronAPI.cleanupListeners === 'function') {
          window.electronAPI.cleanupListeners();
        }
        if (window.electronAPI && window.electronAPI.ipcRenderer && typeof window.electronAPI.ipcRenderer.removeAllListeners === 'function') {
          window.electronAPI.ipcRenderer.removeAllListeners('history-data');
        }
      } catch (error) {
        console.error('Failed to cleanup listeners:', error);
      }
    };
  }, []);

  // 监听从菜单触发的动作（主进程发送）
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.ipcRenderer) return;

    const openSettingsHandler = () => setIsSettingsOpen(true);
    const takeScreenshotHandler = () => {
      try {
        window.electronAPI.startScreenshot();
      } catch (err) {
        console.error('菜单触发截图失败:', err);
      }
    };

    window.electronAPI.ipcRenderer.on('open-settings', openSettingsHandler);
    window.electronAPI.ipcRenderer.on('take-screenshot', takeScreenshotHandler);

    return () => {
      try {
        window.electronAPI.ipcRenderer.removeAllListeners('open-settings');
        window.electronAPI.ipcRenderer.removeAllListeners('take-screenshot');
        window.electronAPI.ipcRenderer.removeAllListeners('settings-updated');
      } catch (err) {
        console.warn('清理菜单 ipc 监听器失败:', err);
      }
    };
  }, []);

  // 监听主进程广播的设置变更（比如快捷键开关）并应用
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.ipcRenderer) return;

    const settingsUpdatedHandler = (_event, updated) => {
      try {
        if (!updated || typeof updated !== 'object') return;
        // normalize payload
        const mapped = {};
        if (typeof updated.previewLength !== 'undefined') mapped.previewLength = updated.previewLength;
        if (typeof updated.customTooltip !== 'undefined') mapped.customTooltip = updated.customTooltip;
        if (typeof updated.useNumberShortcuts !== 'undefined') mapped.useNumberShortcuts = updated.useNumberShortcuts;
        if (typeof updated.globalShortcut !== 'undefined') mapped.globalShortcut = updated.globalShortcut;
        if (typeof updated.screenshotShortcut !== 'undefined') mapped.screenshotShortcut = updated.screenshotShortcut;
        if (typeof updated.theme !== 'undefined') mapped.theme = updated.theme;

        setSettings(prev => ({ ...prev, ...mapped }));
      } catch (err) {
        console.error('Failed to apply settings-updated:', err);
      }
    };

    window.electronAPI.ipcRenderer.on('settings-updated', settingsUpdatedHandler);
    return () => {
      try {
        window.electronAPI.ipcRenderer.removeAllListeners('settings-updated');
      } catch (err) {
        // ignored
      }
    };
  }, []);

  // 当全局快捷键触发并打开窗口时，主进程会发送 'global-shortcut'.
  // 每次收到该事件时我们应该清空搜索栏并隐藏它，确保不继承上次的数据。
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.ipcRenderer) return;

    const handler = () => {
      setSearchVisible(false);
      setSearchTerm('');
      // also blur active element to ensure focus state is clean
      try {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
          active.blur();
        }
      } catch (err) {
        // ignore
      }
    };

    window.electronAPI.ipcRenderer.on('global-shortcut', handler);
    return () => {
      try {
        window.electronAPI.ipcRenderer.removeAllListeners('global-shortcut');
      } catch (err) {
        // ignore
      }
    };
  }, []);

  // 高级搜索和过滤逻辑
  const applyFilters = useCallback(() => {
    let result = [...history];

    // 按类型过滤
    if (searchOptions.type !== 'all') {
      result = result.filter(item => item.type === searchOptions.type);
    }

    // 按搜索词过滤
    if (searchTerm) {
      result = result.filter(item => {
        if (item.type === 'text') {
          return item.content.toLowerCase().includes(searchTerm.toLowerCase());
        }
        return false; // 图像暂时不支持内容搜索
      });
    }

    // 排序
    if (searchOptions.sortBy === 'length' && searchTerm) {
      result.sort((a, b) => {
        if (a.type === 'text' && b.type === 'text') {
          const aMatch = a.content.toLowerCase().includes(searchTerm.toLowerCase());
          const bMatch = b.content.toLowerCase().includes(searchTerm.toLowerCase());

          if (aMatch && bMatch) {
            // 都匹配时按匹配内容长度排序
            return a.content.length - b.content.length;
          } else if (aMatch) {
            return -1;
          } else if (bMatch) {
            return 1;
          }
        }
        return 0;
      });
    }

    setFilteredHistory(result);
  }, [history, searchTerm, searchOptions]);

  // 当历史记录、搜索词或搜索选项改变时重新应用过滤器
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  // useNumberShortcuts hook handles number-key paste behavior
  useNumberShortcuts(filteredHistory, settings.useNumberShortcuts, (item) => {
    try {
      if (window.electronAPI && typeof window.electronAPI.pasteItem === 'function') {
        window.electronAPI.pasteItem(item);
      }
    } catch (err) {
      console.error('Failed to paste item via shortcut:', err);
    }
  });

  // Global typing / search show handler
  useEffect(() => {
    const handler = (event) => {
      // ignore when focus is on editable elements
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }

      // ignore modifier combos
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // ESC: hide search first, otherwise hide window
      if (event.key === 'Escape') {
        if (searchVisible) {
          setSearchVisible(false);
          setSearchTerm('');
          event.preventDefault();
        } else {
          try {
            window.electronAPI.hideWindow();
          } catch (err) { }
        }
        return;
      }

      // Printable single-character keys
      if (event.key && event.key.length === 1) {
        // If it's a digit 1-9 and number shortcuts are enabled, treat as quick-paste and do not open search
        if (event.key >= '1' && event.key <= '9') {
          if (settings.useNumberShortcuts) {
            const index = parseInt(event.key, 10) - 1;
            if (filteredHistory[index]) {
              try {
                window.electronAPI.pasteItem(filteredHistory[index]);
              } catch (error) {
                console.error('Failed to paste item:', error);
              }
              event.preventDefault();
            }
            return;
          }
          // if number shortcuts are disabled, fallthrough and open search with the digit
        }

        // Otherwise show the search and append the typed character
        setSearchVisible(true);
        setSearchTerm((prev) => (prev || '') + event.key);

        // focus the input after DOM updates
        setTimeout(() => {
          const el = document.getElementById('searchInput');
          if (el) {
            try {
              el.focus();
              const val = el.value || '';
              el.setSelectionRange(val.length, val.length);
            } catch (err) { }
          }
        }, 0);

        event.preventDefault();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [filteredHistory, searchVisible]);

  const handleScreenshot = () => {
    try {
      window.electronAPI.startScreenshot();
    } catch (error) {
      console.error('Failed to start screenshot:', error);
    }
  };

  const handleOpenSettings = () => {
    setIsSettingsOpen(true);
  };

  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
  };

  const handleSaveSettings = (newSettings) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const handleAdvancedSearch = (options) => {
    setSearchOptions(options);
  };

  return (
    <div className="app-container">
      <SearchBar
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        visible={searchVisible}
        onAdvancedSearch={handleAdvancedSearch}
      />
      <HistoryList
        history={filteredHistory}
        previewLength={settings.previewLength}
        customTooltip={settings.customTooltip}
        showShortcuts={!!settings.useNumberShortcuts}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={handleCloseSettings}
        onSave={handleSaveSettings}
        initialSettings={{
          previewLength: settings.previewLength,
          customTooltip: settings.customTooltip,
          useNumberShortcuts: settings.useNumberShortcuts,
          globalShortcut: settings.globalShortcut,
          screenshotShortcut: settings.screenshotShortcut,
          theme: settings.theme
        }}
      />
    </div>
  );
}

export default App;
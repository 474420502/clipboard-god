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
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const [keyboardNavigationMode, setKeyboardNavigationMode] = useState(true); // keyboard navigation mode - always enabled
  const [selectedIndex, setSelectedIndex] = useState(0); // selected item index for keyboard navigation - start with first item
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [suppressMouseHover, setSuppressMouseHover] = useState(false);
  const [settings, setSettings] = useState({
    previewLength: 120,
    maxHistoryItems: 500,
    useNumberShortcuts: true,
    globalShortcut: 'CommandOrControl+Alt+V',
    screenshotShortcut: 'CommandOrControl+Shift+S',
    theme: 'light',
    enableTooltips: true
  });

  // 在 App 挂载时，从主进程加载设置并作为单一来源
  useEffect(() => {
    if (!window.electronAPI || typeof window.electronAPI.getSettings !== 'function') return;

    // Load settings from main process. Map keys only when present to avoid overwriting with undefined.
    window.electronAPI.getSettings()
      .then((cfg) => {
        if (cfg && typeof cfg === 'object') {
          try { console.log('App: loaded settings from main:', cfg); } catch (e) { }
          const mapped = {};
          if (typeof cfg.previewLength !== 'undefined') mapped.previewLength = cfg.previewLength;
          if (typeof cfg.maxHistoryItems !== 'undefined') mapped.maxHistoryItems = cfg.maxHistoryItems;
          if (typeof cfg.useNumberShortcuts !== 'undefined') mapped.useNumberShortcuts = cfg.useNumberShortcuts;
          if (typeof cfg.enableTooltips !== 'undefined') mapped.enableTooltips = cfg.enableTooltips;
          if (typeof cfg.globalShortcut !== 'undefined') mapped.globalShortcut = cfg.globalShortcut;
          if (typeof cfg.screenshotShortcut !== 'undefined') mapped.screenshotShortcut = cfg.screenshotShortcut;
          if (typeof cfg.theme !== 'undefined') mapped.theme = cfg.theme;
          // include llms map when present so renderer can show entries in settings
          if (typeof cfg.llms !== 'undefined') mapped.llms = cfg.llms;

          setSettings(prev => ({ ...prev, ...mapped }));
        }
      })
      .catch((err) => {
        console.error('Failed to load settings from main process:', err);
      });
  }, []);

  // 应用主题到DOM
  useEffect(() => {
    const applyTheme = (theme) => {
      // 移除所有主题类
      document.body.classList.remove(
        'light-theme', 'dark-theme', 'blue-theme', 'purple-theme',
        'green-theme', 'orange-theme', 'pink-theme', 'gray-theme',
        'eye-protection-theme', 'high-contrast-theme'
      );

      // 添加当前主题类
      const themeClass = theme === 'light' ? 'light-theme' :
        theme === 'dark' ? 'dark-theme' :
          theme === 'blue' ? 'blue-theme' :
            theme === 'purple' ? 'purple-theme' :
              theme === 'green' ? 'green-theme' :
                theme === 'orange' ? 'orange-theme' :
                  theme === 'pink' ? 'pink-theme' :
                    theme === 'gray' ? 'gray-theme' :
                      theme === 'eye-protection' ? 'eye-protection-theme' :
                        theme === 'high-contrast' ? 'high-contrast-theme' :
                          'light-theme'; // 默认浅色主题

      document.body.classList.add(themeClass);
    };

    // 初始应用主题
    applyTheme(settings.theme);

    // 监听主题变化
    const currentTheme = settings.theme;
    applyTheme(currentTheme);
  }, [settings.theme]);

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

    // Maintain a set of the front-N ids/hashes to detect when a truly new item arrives.
    const FRONT_N = 20;
    const prevFrontSetRef = { current: new Set() };

    const takeFrontIdsOrHashes = (arr) => {
      const s = new Set();
      if (!arr || !arr.length) return s;
      for (let i = 0; i < Math.min(FRONT_N, arr.length); i++) {
        const it = arr[i];
        if (!it) continue;
        if (typeof it.id !== 'undefined' && it.id !== null) s.add(String(it.id));
        else if (typeof it.hash !== 'undefined' && it.hash !== null) s.add(`hash:${String(it.hash)}`);
        else if (it.timestamp) s.add(`ts:${String(it.timestamp)}`); // last-resort
      }
      return s;
    };

    const handleHistoryData = (_history) => {
      setHistory(_history);
      setSelectedIndex(0);
      prevFrontSetRef.current = takeFrontIdsOrHashes(_history);
    };

    const handleUpdate = (updatedHistory) => {
      setHistory(updatedHistory);

      try {
        const newFrontSet = takeFrontIdsOrHashes(updatedHistory);

        // If none of the current front ids/hashes exist in the previous front set,
        // we likely have a genuinely new item(s) inserted at the front -> reset selection.
        let hasOverlap = false;
        for (const v of newFrontSet) {
          if (prevFrontSetRef.current.has(v)) { hasOverlap = true; break; }
        }

        if (!hasOverlap && newFrontSet.size > 0) {
          // new items have arrived at the front
          setSelectedIndex(0);
        } else {
          // preserve current selection but clamp to bounds
          setSelectedIndex((prev) => {
            if (!updatedHistory || updatedHistory.length === 0) return 0;
            return Math.max(0, Math.min(prev, updatedHistory.length - 1));
          });
        }

        // update prev set for next comparison
        prevFrontSetRef.current = newFrontSet;
      } catch (err) {
        setSelectedIndex((prev) => (updatedHistory && updatedHistory.length > 0 ? Math.min(prev, updatedHistory.length - 1) : 0));
      }
    };

    const handleError = (error) => {
      console.error('Received error from main process:', error);
    };

    // subscribe to updates / errors via preload wrappers
    window.electronAPI.onUpdateHistory(handleUpdate);
    window.electronAPI.onError(handleError);
    window.electronAPI.onHistoryData(handleHistoryData);

    return () => {
      try {
        // cleanup listeners registered via preload
        if (window.electronAPI && typeof window.electronAPI.cleanupListeners === 'function') {
          window.electronAPI.cleanupListeners();
        }
      } catch (error) {
        console.error('Failed to cleanup listeners:', error);
      }
    };
  }, []);

  // 监听从菜单触发的动作（主进程发送）
  useEffect(() => {
    if (!window.electronAPI) return;

    const openSettingsHandler = () => setIsSettingsOpen(true);
    const takeScreenshotHandler = () => {
      try {
        window.electronAPI.startScreenshot();
      } catch (err) {
        console.error('菜单触发截图失败:', err);
      }
    };

    window.electronAPI.onOpenSettings(openSettingsHandler);
    window.electronAPI.onTakeScreenshot(takeScreenshotHandler);

    return () => {
      try {
        window.electronAPI.cleanupListeners();
      } catch (err) {
        console.warn('清理菜单 ipc 监听器失败:', err);
      }
    };
  }, []);

  // 监听主进程广播的设置变更（比如快捷键开关）并应用
  useEffect(() => {
    if (!window.electronAPI) return;

    const settingsUpdatedHandler = (payload) => {
      try {
        if (!payload || typeof payload !== 'object') return;

        // Extract config from payload
        const updated = payload.config || payload;

        // normalize payload
        const mapped = {};
        if (typeof updated.previewLength !== 'undefined') mapped.previewLength = updated.previewLength;
        if (typeof updated.maxHistoryItems !== 'undefined') mapped.maxHistoryItems = updated.maxHistoryItems;
        if (typeof updated.useNumberShortcuts !== 'undefined') {
          mapped.useNumberShortcuts = updated.useNumberShortcuts;
        }
        if (typeof updated.enableTooltips !== 'undefined') mapped.enableTooltips = updated.enableTooltips;
        if (typeof updated.globalShortcut !== 'undefined') mapped.globalShortcut = updated.globalShortcut;
        if (typeof updated.screenshotShortcut !== 'undefined') mapped.screenshotShortcut = updated.screenshotShortcut;
        if (typeof updated.theme !== 'undefined') mapped.theme = updated.theme;
        // pass through llms when main process provides it
        if (typeof updated.llms !== 'undefined') mapped.llms = updated.llms;

        setSettings(prev => ({ ...prev, ...mapped }));
      } catch (err) {
        console.error('Failed to apply settings-updated:', err);
      }
    }; window.electronAPI.onSettingsUpdated(settingsUpdatedHandler);
    return () => {
      try {
        window.electronAPI.cleanupListeners();
      } catch (err) {
        // ignored
      }
    };
  }, []);

  // 当全局快捷键触发并打开窗口时，主进程会发送 'global-shortcut'.
  // 每次收到该事件时我们应该清空搜索栏并隐藏它，确保不继承上次的数据。
  useEffect(() => {
    if (!window.electronAPI) return;

    const handler = () => {
      setSearchVisible(false);
      setSearchTerm('');
      setSelectedIndex(0); // Reset selection to first item when window is reopened
      setKeyboardNavigationMode(false); // Disable keyboard navigation mode initially
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

    window.electronAPI.onGlobalShortcut(handler);
    return () => {
      try {
        window.electronAPI.cleanupListeners();
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
      // Disable keyboard interaction when settings modal is open
      if (isSettingsOpen) {
        return;
      }

      // Check if focus is on search input - allow arrow keys for navigation even when search has focus
      const active = document.activeElement;
      const isSearchInputFocused = active && active.id === 'searchInput';

      // ignore when focus is on other editable elements (but allow search input)
      if (active && (active.tagName === 'TEXTAREA' || active.isContentEditable) && !isSearchInputFocused) {
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

      // Handle keyboard navigation (always enabled)
      if (event.key === 'ArrowUp') {
        handleNavigateItems('up');
        event.preventDefault();
        return;
      } else if (event.key === 'ArrowDown') {
        handleNavigateItems('down');
        event.preventDefault();
        return;
      } else if (event.key === 'Enter') {
        handleKeyboardSelect(selectedIndex);
        event.preventDefault();
        return;
      }

      // Printable single-character keys
      if (event.key && event.key.length === 1) {
        // Number keys are handled by useNumberShortcuts hook
        // Just show the search and append the typed character
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
  }, [filteredHistory, searchVisible, keyboardNavigationMode, selectedIndex, isSettingsOpen]);

  // Clear suppressMouseHover when the user moves the mouse
  useEffect(() => {
    const onPointerMove = () => {
      if (suppressMouseHover) setSuppressMouseHover(false);
    };
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('pointermove', onPointerMove);
    return () => {
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [suppressMouseHover]);

  // expose suppress flag for simple global check (HistoryItem reads this)
  useEffect(() => {
    try {
      window.__suppressMouseHover = suppressMouseHover;
    } catch (err) { }
    return () => {
      try { window.__suppressMouseHover = false; } catch (err) { }
    };
  }, [suppressMouseHover]);

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

  const handleKeyboardSelect = (index) => {
    if (index >= 0 && index < filteredHistory.length) {
      const selectedItem = filteredHistory[index];
      try {
        if (window.electronAPI && typeof window.electronAPI.pasteItem === 'function') {
          window.electronAPI.pasteItem(selectedItem);
        }
      } catch (err) {
        console.error('Failed to paste selected item:', err);
      }
      // Keep keyboard navigation enabled; after paste we can reset selection to first item
      setSelectedIndex(0);
    }
  };

  const handleNavigateItems = (direction) => {
    setKeyboardNavigationMode(true); // Enable keyboard navigation mode when navigating
    // temporarily suppress mouse hover-driven selection
    setSuppressMouseHover(true);
    let newIndex = selectedIndex;
    if (direction === 'up') {
      newIndex = selectedIndex > 0 ? selectedIndex - 1 : 0;
    } else if (direction === 'down') {
      newIndex = selectedIndex < filteredHistory.length - 1 ? selectedIndex + 1 : filteredHistory.length - 1;
    }
    setSelectedIndex(newIndex);
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
        showShortcuts={!!settings.useNumberShortcuts}
        enableTooltips={!!settings.enableTooltips}
        selectedIndex={selectedIndex}
        keyboardNavigationMode={keyboardNavigationMode}
        setSelectedIndex={setSelectedIndex}
        setKeyboardNavigationMode={setKeyboardNavigationMode}
        suppressMouseHover={suppressMouseHover}
        setSuppressMouseHover={setSuppressMouseHover}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={handleCloseSettings}
        onSave={handleSaveSettings}
        initialSettings={{
          previewLength: settings.previewLength,
          maxHistoryItems: settings.maxHistoryItems,
          useNumberShortcuts: settings.useNumberShortcuts,
          enableTooltips: settings.enableTooltips,
          globalShortcut: settings.globalShortcut,
          screenshotShortcut: settings.screenshotShortcut,
          theme: settings.theme,
          llms: settings.llms || {}
        }}
      />
    </div>
  );
}

export default App;


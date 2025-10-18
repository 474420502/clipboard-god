import React, { useState, useEffect, useCallback } from 'react';
import HistoryList from './components/HistoryList';
import SearchBar from './components/SearchBar';
import SettingsModal from './components/SettingsModal';

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
    window.electronAPI.getSettings()
      .then((cfg) => {
        if (cfg && typeof cfg === 'object') {
          // 主进程使用 useCustomTooltip 命名，renderer 使用 customTooltip，为兼容性做映射
          const mapped = {
            previewLength: cfg.previewLength,
            customTooltip: typeof cfg.useCustomTooltip !== 'undefined' ? cfg.useCustomTooltip : cfg.customTooltip,
            useNumberShortcuts: typeof cfg.useNumberShortcuts !== 'undefined' ? cfg.useNumberShortcuts : cfg.useNumberShortcuts,
            globalShortcut: cfg.globalShortcut,
            screenshotShortcut: cfg.screenshotShortcut,
            theme: cfg.theme
          };
          setSettings(prev => ({ ...prev, ...mapped }));
        }
      })
      .catch((err) => {
        console.error('Failed to load settings from main process:', err);
      });
  }, []);

  // 设置 IPC 监听器
  useEffect(() => {
    // 确保 electronAPI 存在
    if (!window.electronAPI) {
      console.error('electronAPI not available');
      return;
    }

    // ESC键监听器 - 隐藏窗口
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' || event.keyCode === 27) {
        console.log('ESC键被按下，隐藏窗口');
        try {
          window.electronAPI.hideWindow();
        } catch (error) {
          console.error('Failed to hide window:', error);
        }
      }
    };

    // 添加键盘事件监听器
    document.addEventListener('keydown', handleKeyDown);

    // 初始加载数据
    try {
      window.electronAPI.getHistory();
    } catch (error) {
      console.error('Failed to get history:', error);
    }

    // 处理初始历史数据加载
    const handleHistoryData = (initialHistory) => {
      console.log('Received initial history data:', initialHistory);
      setHistory(initialHistory);
    };

    const handleUpdate = (updatedHistory) => {
      console.log('Received history update:', updatedHistory);
      setHistory(updatedHistory);
    };

    const handleError = (error) => {
      console.error('Received error from main process:', error);
    };

    // 监听初始历史数据
    const historyDataHandler = (_event, initialHistory) => {
      handleHistoryData(initialHistory);
    };

    // 监听实时更新
    window.electronAPI.onUpdateHistory(handleUpdate);
    window.electronAPI.onError(handleError);

    // 监听初始历史数据事件
    if (window.electronAPI && window.electronAPI.ipcRenderer) {
      window.electronAPI.ipcRenderer.on('history-data', historyDataHandler);
    } else {
      // 备用方法：直接通过 ipcRenderer
      try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('history-data', historyDataHandler);
      } catch (err) {
        console.warn('Cannot access ipcRenderer directly:', err);
      }
    }

    // 组件卸载时清理监听器
    return () => {
      // 移除键盘事件监听器
      document.removeEventListener('keydown', handleKeyDown);

      try {
        window.electronAPI.cleanupListeners();
        // 清理初始历史数据监听器
        if (window.electronAPI && window.electronAPI.ipcRenderer) {
          window.electronAPI.ipcRenderer.removeAllListeners('history-data');
        } else {
          try {
            const { ipcRenderer } = require('electron');
            ipcRenderer.removeAllListeners('history-data');
          } catch (err) {
            console.warn('Cannot remove ipcRenderer listeners directly:', err);
          }
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
        // normalize payload: main process uses useCustomTooltip, renderer uses customTooltip
        const mapped = {};
        if (typeof updated.previewLength !== 'undefined') mapped.previewLength = updated.previewLength;
        if (typeof updated.useCustomTooltip !== 'undefined') mapped.customTooltip = updated.useCustomTooltip;
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

  // 处理键盘快捷键 (1-9)
  const handleKeyDown = useCallback((event) => {
    // 忽略当输入框或其他可编辑元素有焦点时的按键
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return;
    }

    if (settings.useNumberShortcuts && event.key >= '1' && event.key <= '9') {
      const index = parseInt(event.key, 10) - 1;
      if (filteredHistory[index]) {
        try {
          window.electronAPI.pasteItem(filteredHistory[index]);
        } catch (error) {
          console.error('Failed to paste item:', error);
        }
      }
    }
  }, [filteredHistory]);

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
          useCustomTooltip: settings.customTooltip || settings.useCustomTooltip,
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
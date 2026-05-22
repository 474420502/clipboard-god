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
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import HistoryList from './components/HistoryList';
import SearchBar from './components/SearchBar';
import useNumberShortcuts from './hooks/useNumberShortcuts';
import EditModal from './components/EditModal';
import QRCodeSelectorDialog from './components/QRCodeSelectorDialog';

const DEFAULT_SEARCH_OPTIONS = {
  type: 'all',
  sortBy: 'time',
  pinnedOnly: false
};

function createDefaultSearchOptions() {
  return { ...DEFAULT_SEARCH_OPTIONS };
}

function normalizeSearchOptions(nextOptions = {}) {
  const normalized = {
    type: nextOptions.type === 'image' ? 'image' : nextOptions.type === 'text' ? 'text' : 'all',
    sortBy: nextOptions.sortBy === 'length' ? 'length' : 'time',
    pinnedOnly: !!nextOptions.pinnedOnly
  };

  if (normalized.pinnedOnly) {
    normalized.type = 'all';
  }

  if (normalized.type === 'image') {
    normalized.pinnedOnly = false;
  }

  return normalized;
}

const DEFAULT_OCR_VL_CPU_THREADS = Math.max(
  1,
  Math.min(8, typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4)
);
const DEFAULT_OCR_VL_MAX_CONCURRENT_JOBS = Math.max(
  1,
  Math.min(2, Math.floor(DEFAULT_OCR_VL_CPU_THREADS / 4) || 1)
);

function App() {
  const { t } = useTranslation();
  const [history, setHistory] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [searchOptions, setSearchOptions] = useState(() => createDefaultSearchOptions());
  const [statusToast, setStatusToast] = useState({ visible: false, text: '' });
  const toastTimerRef = useRef(null);
  const [searchVisible, setSearchVisible] = useState(false); // hidden by default
  const [selectedIndex, setSelectedIndex] = useState(0); // selected item index for keyboard navigation - start with first item
  const [suppressMouseHover, setSuppressMouseHover] = useState(false);
  const [editModalState, setEditModalState] = useState({ open: false, item: null });
  const [qrDialogState, setQrDialogState] = useState({ open: false, qrcodes: [], selectedId: null, loading: false });
  const [ocrLanguages, setOcrLanguages] = useState(['chi_sim', 'eng']);
  const [settings, setSettings] = useState({
    previewLength: 120,
    maxHistoryItems: 500,
    useNumberShortcuts: true,
    globalShortcut: 'CommandOrControl+Alt+V',
    screenshotShortcut: 'CommandOrControl+Shift+S',
    theme: 'light',
    enableTooltips: true,
    launchOnStartup: false,
    locale: 'zh-CN',
    ocrLanguages: ['chi_sim', 'eng'],
    ocrLangSelectorExpanded: false,
    ocrTextLayout: {
      lineMergeThresholdRatio: 0.5,
      lineMergeThresholdPx: 0,
      spaceGapRatio: 0.2,
      spaceGapMinPx: 2,
      insertSpaceByGap: true,
      splitByGap: true
    },
    ocrModelSource: 'builtin',
    ocrModelLanguage: 'chinese',
    ocrVlCliCommand: 'paddleocr',
    ocrVlDevice: '',
    ocrVlCpuThreads: DEFAULT_OCR_VL_CPU_THREADS,
    ocrVlMaxConcurrentJobs: DEFAULT_OCR_VL_MAX_CONCURRENT_JOBS,
    ocrVlEnableMkldnn: true,
    ocrVlCliArgs: '',
    ocrPreprocessModels: {
      docOrientation: true,
      docUnwarp: false,
      textlineOrientation: true
    }
  });

  // Refs for global key handler to avoid re-registering listeners
  const searchVisibleRef = useRef(searchVisible);
  const selectedIndexRef = useRef(selectedIndex);
  const filteredHistoryRef = useRef([]);
  const useNumberShortcutsRef = useRef(!!settings.useNumberShortcuts);
  const editModalOpenRef = useRef(!!editModalState.open);
  const searchOptionsRef = useRef(searchOptions);

  const setMouseHoverSuppressed = (value) => {
    try {
      window.__suppressMouseHover = value;
    } catch (err) {
      // ignore
    }
    setSuppressMouseHover(value);
  };

  const clearSearchUiState = ({ resetFilters = false } = {}) => {
    setSearchVisible(false);
    setSearchTerm('');
    if (resetFilters) {
      setSearchOptions(createDefaultSearchOptions());
    }
  };

  const blurActiveEditableElement = () => {
    try {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        active.blur();
      }
    } catch (err) {
      // ignore
    }
  };

  const resetPanelUiState = ({ suppressMouseHover = false, resetSearch = false, blurActiveElement = false } = {}) => {
    setMouseHoverSuppressed(suppressMouseHover);
    if (resetSearch) {
      clearSearchUiState({ resetFilters: true });
    }
    setSelectedIndex(0);
    if (blurActiveElement) {
      blurActiveEditableElement();
    }
  };

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
          if (typeof cfg.launchOnStartup !== 'undefined') mapped.launchOnStartup = cfg.launchOnStartup;
          if (typeof cfg.locale !== 'undefined') mapped.locale = cfg.locale;
          if (typeof cfg.ocrLanguages !== 'undefined') mapped.ocrLanguages = cfg.ocrLanguages;
          if (typeof cfg.ocrLangSelectorExpanded !== 'undefined') mapped.ocrLangSelectorExpanded = cfg.ocrLangSelectorExpanded;
          if (typeof cfg.ocrTextLayout !== 'undefined') mapped.ocrTextLayout = cfg.ocrTextLayout;
          if (typeof cfg.ocrModelSource !== 'undefined') mapped.ocrModelSource = cfg.ocrModelSource;
          if (typeof cfg.ocrModelLanguage !== 'undefined') mapped.ocrModelLanguage = cfg.ocrModelLanguage;
          if (typeof cfg.ocrVlCliCommand !== 'undefined') mapped.ocrVlCliCommand = cfg.ocrVlCliCommand;
          if (typeof cfg.ocrVlDevice !== 'undefined') mapped.ocrVlDevice = cfg.ocrVlDevice;
          if (typeof cfg.ocrVlCpuThreads !== 'undefined') mapped.ocrVlCpuThreads = cfg.ocrVlCpuThreads;
          if (typeof cfg.ocrVlMaxConcurrentJobs !== 'undefined') mapped.ocrVlMaxConcurrentJobs = cfg.ocrVlMaxConcurrentJobs;
          if (typeof cfg.ocrVlEnableMkldnn !== 'undefined') mapped.ocrVlEnableMkldnn = cfg.ocrVlEnableMkldnn;
          if (typeof cfg.ocrVlCliArgs !== 'undefined') mapped.ocrVlCliArgs = cfg.ocrVlCliArgs;
          if (typeof cfg.ocrPreprocessModels !== 'undefined') mapped.ocrPreprocessModels = cfg.ocrPreprocessModels;
          // include llms map when present so renderer can show entries in settings
          if (typeof cfg.llms !== 'undefined') mapped.llms = cfg.llms;

          setSettings(prev => ({ ...prev, ...mapped }));
          if (typeof mapped.ocrLanguages !== 'undefined') {
            setOcrLanguages(Array.isArray(mapped.ocrLanguages) ? mapped.ocrLanguages : ['chi_sim', 'eng']);
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load settings from main process:', err);
      });
  }, []);

  useEffect(() => {
    const timerId = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 140);
    return () => clearTimeout(timerId);
  }, [searchTerm]);

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
      const prefix = t('error.prefix') || 'Error: ';
      const message = (typeof error === 'string' && error.trim())
        ? error
        : (error && error.message ? error.message : 'Unknown error');
      showStatusToast(`${prefix}${message}`);
    };

    // subscribe to updates / errors via preload wrappers
    const offUpdateHistory = window.electronAPI.onUpdateHistory(handleUpdate);
    const offError = window.electronAPI.onError(handleError);
    const offHistoryData = window.electronAPI.onHistoryData(handleHistoryData);

    return () => {
      try { if (typeof offUpdateHistory === 'function') offUpdateHistory(); } catch (e) { }
      try { if (typeof offError === 'function') offError(); } catch (e) { }
      try { if (typeof offHistoryData === 'function') offHistoryData(); } catch (e) { }
    };
  }, []);

  // 监听从菜单触发的动作（主进程发送）
  useEffect(() => {
    if (!window.electronAPI) return;
    // hide context menu when main process requests it (e.g., window hidden/closed)
    const hideContextMenuHandler = () => {
      try {
        const menu = document.getElementById('global-history-context-menu');
        if (menu) {
          try {
            if (typeof menu.__hide === 'function') menu.__hide();
            else {
              menu.style.display = 'none';
              menu.innerHTML = '';
            }
          } catch (err) {
            try { menu.style.display = 'none'; menu.innerHTML = ''; } catch (e) { }
          }
        }
      } catch (err) { }
    };
    const offHideContextMenu = (window.electronAPI && typeof window.electronAPI.onHideContextMenu === 'function')
      ? window.electronAPI.onHideContextMenu(hideContextMenuHandler)
      : null;

    // Optimistic update for pin toggle (dispatched by HistoryItem)
    const onLocalPinToggled = (e) => {
      try {
        const detail = e && e.detail;
        if (!detail) return;
        const { dbId, pinned } = detail;
        setHistory((prev) => {
          if (!prev || !prev.length) return prev;
          return prev.map(it => {
            const idMatch = (it._dbId && String(it._dbId) === String(dbId)) || (it.id && String(it.id) === String(dbId));
            if (idMatch) {
              // return a shallow-updated item with pinned toggled
              return { ...it, pinned: !!pinned };
            }
            return it;
          });
        });
      } catch (err) { }
    };
    window.addEventListener('local-pin-toggled', onLocalPinToggled);

    // listen for requests to open edit modal (dispatched by HistoryItem)
    const onOpenEditModal = (e) => {
      try {
        const it = e && e.detail && e.detail.item;
        if (it) setEditModalState({ open: true, item: it });
      } catch (err) { }
    };
    window.addEventListener('open-edit-modal', onOpenEditModal);

    return () => {
      window.removeEventListener('open-edit-modal', onOpenEditModal);
      window.removeEventListener('local-pin-toggled', onLocalPinToggled);
      try { if (typeof offHideContextMenu === 'function') offHideContextMenu(); } catch (e) { }
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
        if (typeof updated.locale !== 'undefined') mapped.locale = updated.locale;
        if (typeof updated.ocrLanguages !== 'undefined') mapped.ocrLanguages = updated.ocrLanguages;
        if (typeof updated.ocrLangSelectorExpanded !== 'undefined') mapped.ocrLangSelectorExpanded = updated.ocrLangSelectorExpanded;
        if (typeof updated.ocrSettingsExpanded !== 'undefined') mapped.ocrSettingsExpanded = updated.ocrSettingsExpanded;
        if (typeof updated.ocrTextLayout !== 'undefined') mapped.ocrTextLayout = updated.ocrTextLayout;
        if (typeof updated.ocrModelSource !== 'undefined') mapped.ocrModelSource = updated.ocrModelSource;
        if (typeof updated.ocrModelLanguage !== 'undefined') mapped.ocrModelLanguage = updated.ocrModelLanguage;
        if (typeof updated.ocrVlCliCommand !== 'undefined') mapped.ocrVlCliCommand = updated.ocrVlCliCommand;
        if (typeof updated.ocrVlDevice !== 'undefined') mapped.ocrVlDevice = updated.ocrVlDevice;
        if (typeof updated.ocrVlCpuThreads !== 'undefined') mapped.ocrVlCpuThreads = updated.ocrVlCpuThreads;
        if (typeof updated.ocrVlMaxConcurrentJobs !== 'undefined') mapped.ocrVlMaxConcurrentJobs = updated.ocrVlMaxConcurrentJobs;
        if (typeof updated.ocrVlEnableMkldnn !== 'undefined') mapped.ocrVlEnableMkldnn = updated.ocrVlEnableMkldnn;
        if (typeof updated.ocrVlCliArgs !== 'undefined') mapped.ocrVlCliArgs = updated.ocrVlCliArgs;
        if (typeof updated.ocrPreprocessModels !== 'undefined') mapped.ocrPreprocessModels = updated.ocrPreprocessModels;
        // pass through llms when main process provides it
        if (typeof updated.llms !== 'undefined') mapped.llms = updated.llms;

        setSettings(prev => ({ ...prev, ...mapped }));
        if (typeof mapped.ocrLanguages !== 'undefined') {
          setOcrLanguages(Array.isArray(mapped.ocrLanguages) ? mapped.ocrLanguages : ['chi_sim', 'eng']);
        }
      } catch (err) {
        console.error('Failed to apply settings-updated:', err);
      }
    };
    const offSettingsUpdated = window.electronAPI.onSettingsUpdated(settingsUpdatedHandler);
    return () => {
      try { if (typeof offSettingsUpdated === 'function') offSettingsUpdated(); } catch (e) { }
    };
  }, []);

  // 当全局快捷键触发并打开窗口时，主进程会发送 'global-shortcut'.
  // 每次收到该事件时我们应该清空搜索栏并隐藏它，确保不继承上次的数据。
  useEffect(() => {
    if (!window.electronAPI) return;

    const handler = () => {
      resetPanelUiState({
        suppressMouseHover: true,
        resetSearch: true,
        blurActiveElement: true
      });
    };

    const offGlobalShortcut = window.electronAPI.onGlobalShortcut(handler);
    return () => {
      try { if (typeof offGlobalShortcut === 'function') offGlobalShortcut(); } catch (e) { }
    };
  }, []);

  // 主进程在窗口失焦/隐藏时会发送 reset-selection
  useEffect(() => {
    if (!window.electronAPI || typeof window.electronAPI.onResetSelection !== 'function') return;

    const handler = () => {
      resetPanelUiState();
    };

    const offResetSelection = window.electronAPI.onResetSelection(handler);
    return () => {
      try { if (typeof offResetSelection === 'function') offResetSelection(); } catch (e) { }
    };
  }, []);

  // 高级搜索和过滤逻辑（派生状态，避免重复 setState）
  const filteredHistory = useMemo(() => {
    let result = [...history];

    // 按类型过滤
    if (searchOptions.type !== 'all') {
      result = result.filter(item => item.type === searchOptions.type);
    }

    // 按 pinned 过滤（仅显示 pinned）
    if (searchOptions.pinnedOnly) {
      result = result.filter(item => !!item.pinned);
    }

    // 按搜索词过滤
    if (debouncedSearchTerm) {
      const termLower = debouncedSearchTerm.toLowerCase();
      result = result.filter(item => {
        if (item.type === 'text') {
          return item.content.toLowerCase().includes(termLower);
        }
        return false; // 图像暂时不支持内容搜索
      });
    }

    // 排序
    if (searchOptions.sortBy === 'length' && debouncedSearchTerm) {
      result.sort((a, b) => {
        if (a.type === 'text' && b.type === 'text') {
          const needle = debouncedSearchTerm.toLowerCase();
          const aMatch = a.content.toLowerCase().includes(needle);
          const bMatch = b.content.toLowerCase().includes(needle);

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

    return result;
  }, [history, debouncedSearchTerm, searchOptions]);

  // 当搜索条件变化时，重置选择索引为第一个项目
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchTerm, searchOptions.type, searchOptions.sortBy, searchOptions.pinnedOnly]);

  // 当过滤结果长度变化时，夹紧选择索引，避免越界
  useEffect(() => {
    setSelectedIndex((prev) => {
      if (!filteredHistory || filteredHistory.length === 0) return 0;
      const maxIndex = filteredHistory.length - 1;
      return Math.max(0, Math.min(prev, maxIndex));
    });
  }, [filteredHistory.length]);

  useEffect(() => { searchVisibleRef.current = searchVisible; }, [searchVisible]);
  useEffect(() => { selectedIndexRef.current = selectedIndex; }, [selectedIndex]);
  useEffect(() => { filteredHistoryRef.current = filteredHistory; }, [filteredHistory]);
  useEffect(() => { useNumberShortcutsRef.current = !!settings.useNumberShortcuts; }, [settings.useNumberShortcuts]);
  useEffect(() => { editModalOpenRef.current = !!editModalState.open; }, [editModalState.open]);
  useEffect(() => { searchOptionsRef.current = searchOptions; }, [searchOptions]);
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  const showStatusToast = (text) => {
    setStatusToast({ visible: true, text });
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    toastTimerRef.current = setTimeout(() => {
      setStatusToast((prev) => ({ ...prev, visible: false }));
    }, 1200);
  };

  const closeQrDialog = () => {
    setQrDialogState((prev) => ({ ...prev, open: false, loading: false }));
  };

  const handleCopySelectedQr = async () => {
    try {
      if (!window.electronAPI || typeof window.electronAPI.copyQRCodeContent !== 'function') return;
      const selected = (qrDialogState.qrcodes || []).find(q => String(q.id) === String(qrDialogState.selectedId)) || (qrDialogState.qrcodes || [])[0];
      if (!selected) return;
      await window.electronAPI.copyQRCodeContent(String(selected.content || ''));
      showStatusToast(t('history.qrCopied') || 'QR code copied');
    } catch (err) {
      showStatusToast(t('history.qrFailed') || 'QR code recognition failed');
    }
  };

  const handleCopyAllQr = async () => {
    try {
      if (!window.electronAPI || typeof window.electronAPI.copyQRCodeContent !== 'function') return;
      const all = (qrDialogState.qrcodes || []).map(q => q && q.content).filter(Boolean);
      if (!all.length) return;
      await window.electronAPI.copyQRCodeContent(all.join('\n'));
      showStatusToast(t('history.qrCopiedAll') || 'All QR codes copied');
    } catch (err) {
      showStatusToast(t('history.qrFailed') || 'QR code recognition failed');
    }
  };

  const openOcrWindow = async (imagePath) => {
    try {
      if (!window.electronAPI || typeof window.electronAPI.openOcrWindow !== 'function') {
        showStatusToast(t('history.ocrFailed') || 'OCR failed');
        return;
      }
      const res = await window.electronAPI.openOcrWindow({
        imagePath,
        languages: ocrLanguages
      });
      if (res && res.success === false) {
        const reason = res.error ? String(res.error) : 'open-ocr-window-failed';
        showStatusToast(`${t('history.ocrFailed') || 'OCR failed'}: ${reason}`);
      }
    } catch (err) {
      const reason = err && err.message ? String(err.message) : 'open-ocr-window-failed';
      showStatusToast(`${t('history.ocrFailed') || 'OCR failed'}: ${reason}`);
    }
  };

  useEffect(() => {
    const onOpenQrDialog = async (e) => {
      try {
        const imagePath = e && e.detail && e.detail.imagePath;
        if (!imagePath) {
          showStatusToast(t('history.qrInvalidImage') || 'Image not available');
          return;
        }

        setQrDialogState({ open: true, qrcodes: [], selectedId: null, loading: true });

        if (!window.electronAPI || typeof window.electronAPI.extractQRCodes !== 'function') {
          showStatusToast(t('history.qrFailed') || 'QR code recognition failed');
          setQrDialogState({ open: true, qrcodes: [], selectedId: null, loading: false });
          return;
        }

        const res = await window.electronAPI.extractQRCodes(imagePath);
        if (!res || !res.success) {
          showStatusToast(t('history.qrFailed') || 'QR code recognition failed');
          setQrDialogState({ open: true, qrcodes: [], selectedId: null, loading: false });
          return;
        }

        const qrcodes = Array.isArray(res.qrcodes) ? res.qrcodes : [];
        if (!qrcodes.length) {
          showStatusToast(t('history.qrNotFound') || 'No QR code found');
          setQrDialogState({ open: true, qrcodes: [], selectedId: null, loading: false });
          return;
        }

        setQrDialogState({
          open: true,
          qrcodes,
          selectedId: qrcodes[0] && qrcodes[0].id,
          loading: false
        });
      } catch (err) {
        showStatusToast(t('history.qrFailed') || 'QR code recognition failed');
        setQrDialogState({ open: true, qrcodes: [], selectedId: null, loading: false });
      }
    };

    window.addEventListener('open-qr-dialog', onOpenQrDialog);
    return () => window.removeEventListener('open-qr-dialog', onOpenQrDialog);
  }, [t]);

  useEffect(() => {
    const onOpenOcrDialog = (e) => {
      try {
        const imagePath = e && e.detail && e.detail.imagePath;
        if (!imagePath) {
          showStatusToast(t('history.ocrInvalidImage') || 'Image not available');
          return;
        }
        openOcrWindow(imagePath);
      } catch (err) {
        showStatusToast(t('history.ocrFailed') || 'OCR failed');
      }
    };

    window.addEventListener('open-ocr-dialog', onOpenOcrDialog);
    return () => window.removeEventListener('open-ocr-dialog', onOpenOcrDialog);
  }, [t]);

  const handlePinnedOnlyChange = (value) => {
    let willEnablePinned = false;
    let imageOnlyWasOn = false;
    setSearchOptions((prev) => {
      imageOnlyWasOn = prev.type === 'image';
      willEnablePinned = !!value;
      return normalizeSearchOptions({
        ...prev,
        pinnedOnly: willEnablePinned,
        type: willEnablePinned ? 'all' : prev.type
      });
    });

    if (willEnablePinned && imageOnlyWasOn) {
      showStatusToast(t('toast.imageOnlyOff') || 'Only images: off');
      return;
    }

    showStatusToast(willEnablePinned
      ? (t('toast.pinnedOnlyOn') || 'Only pinned: on')
      : (t('toast.pinnedOnlyOff') || 'Only pinned: off')
    );
  };

  const handleImageOnlyToggle = () => {
    let willEnable = false;
    setSearchOptions((prev) => {
      const nextType = prev.type === 'image' ? 'all' : 'image';
      willEnable = nextType === 'image';
      const nextPinnedOnly = nextType === 'image' ? false : prev.pinnedOnly;
      return normalizeSearchOptions({
        ...prev,
        type: nextType,
        pinnedOnly: nextPinnedOnly
      });
    });

    showStatusToast(willEnable
      ? (t('toast.imageOnlyOn') || 'Only images: on')
      : (t('toast.imageOnlyOff') || 'Only images: off')
    );
  };

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
      const editOpen = editModalOpenRef.current;
      const searchVisibleNow = searchVisibleRef.current;
      const isPageUp = event.key === 'PageUp' || event.code === 'PageUp' || event.key === 'Prior' || event.keyCode === 33;
      const isPageDown = event.key === 'PageDown' || event.code === 'PageDown' || event.key === 'Next' || event.keyCode === 34;

      if (editOpen) {
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
        if (searchVisibleNow) {
          clearSearchUiState();
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
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // Allow cursor movement when search input is focused
        if (isSearchInputFocused) {
          return;
        }
        if (event.key === 'ArrowRight') {
          const current = searchOptionsRef.current || { pinnedOnly: false };
          handlePinnedOnlyChange(!current.pinnedOnly);
        } else {
          handleImageOnlyToggle();
        }
        event.preventDefault();
        return;
      } else if (isPageUp) {
        handlePageNavigate('up');
        event.preventDefault();
        return;
      } else if (isPageDown) {
        handlePageNavigate('down');
        event.preventDefault();
        return;
      } else if (event.key === 'Enter') {
        handleKeyboardSelect(selectedIndexRef.current);
        event.preventDefault();
        return;
      }

      // Printable single-character keys
      if (event.key && event.key.length === 1) {
        if (event.defaultPrevented) return;
        // Number keys are handled by useNumberShortcuts hook
        if (useNumberShortcutsRef.current && /^[1-9]$/.test(event.key)) {
          return;
        }
        // 如果搜索框已经聚焦，跳过全局处理，让组件自己处理
        if (isSearchInputFocused) {
          return; // 让 SearchBar 的 onChange 处理字符输入
        }

        // Number keys are handled by useNumberShortcuts hook
        // Just show the search and append the typed character
        setSearchVisible(true);
        setSearchTerm((prev) => (prev || '') + event.key);

        // focus the input after DOM updates, but don't reset cursor position
        setTimeout(() => {
          const el = document.getElementById('searchInput');
          if (el) {
            try {
              el.focus();
              // 将光标移动到末尾，这是新字符应该插入的位置
              const len = el.value ? el.value.length : 0;
              el.setSelectionRange(len, len);
            } catch (err) { }
          }
        }, 0);

        event.preventDefault();
      }
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  // Clear suppressMouseHover when the user moves the mouse
  useEffect(() => {
    const onPointerMove = () => {
      if (suppressMouseHover) setMouseHoverSuppressed(false);
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

  const handleAdvancedSearch = (options) => {
    setSearchOptions((prev) => normalizeSearchOptions({
      ...prev,
      ...options
    }));
  };

  const handleEditSave = async (newContent) => {
    try {
      const item = editModalState.item;
      if (!item) return;
      const dbId = item._dbId || item.id;
      if (window.electronAPI && typeof window.electronAPI.editItem === 'function') {
        const res = await window.electronAPI.editItem(dbId, newContent);
        if (!res || !res.success) console.error('Edit failed', res && res.error);
        // rely on main process broadcasting updated history; optionally we could update local state here
      }
    } catch (err) {
      console.error('handleEditSave error', err);
    } finally {
      setEditModalState({ open: false, item: null });
    }
  };

  const handleKeyboardSelect = (index) => {
    const list = filteredHistoryRef.current || [];
    if (index >= 0 && index < list.length) {
      const selectedItem = list[index];
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

  const handlePageNavigate = (direction) => {
    setSuppressMouseHover(true);
    const list = filteredHistoryRef.current || [];
    if (list.length === 0) {
      setSelectedIndex(0);
      return;
    }

    const pageSize = 10;
    const maxIndex = list.length - 1;
    const current = Math.max(0, Math.min(selectedIndexRef.current, maxIndex));
    let newIndex = current;

    if (direction === 'up') {
      newIndex = Math.max(0, current - pageSize);
    } else if (direction === 'down') {
      newIndex = Math.min(maxIndex, current + pageSize);
    }

    setSelectedIndex(newIndex);
  };

  const handleNavigateItems = (direction) => {
    // temporarily suppress mouse hover-driven selection
    setSuppressMouseHover(true);
    const list = filteredHistoryRef.current || [];
    if (list.length === 0) {
      setSelectedIndex(0);
      return;
    }

    const maxIndex = list.length - 1;
    const current = Math.max(0, Math.min(selectedIndexRef.current, maxIndex));
    let newIndex = current;

    if (direction === 'up') {
      newIndex = Math.max(0, current - 1);
    } else if (direction === 'down') {
      newIndex = Math.min(maxIndex, current + 1);
    }

    setSelectedIndex(newIndex);
  };

  return (
    <div className="app-container">
      <SearchBar
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        visible={searchVisible}
        searchType={searchOptions.type}
        sortBy={searchOptions.sortBy}
        onAdvancedSearch={handleAdvancedSearch}
        onOpenSettings={() => {
          try {
            if (window.electronAPI && typeof window.electronAPI.openSettingsWindow === 'function') {
              window.electronAPI.openSettingsWindow();
            }
          } catch (err) {
            console.warn('Failed to open detached settings window:', err);
          }
        }}
        pinnedOnly={searchOptions.pinnedOnly}
        onPinnedOnlyChange={handlePinnedOnlyChange}
      />
      {statusToast.visible && (
        <div className="status-toast" role="status" aria-live="polite">
          {statusToast.text}
        </div>
      )}
      <HistoryList
        history={filteredHistory}
        previewLength={settings.previewLength}
        showShortcuts={!!settings.useNumberShortcuts}
        enableTooltips={!!settings.enableTooltips}
        selectedIndex={selectedIndex}
        setSelectedIndex={setSelectedIndex}
      />
      <EditModal
        open={editModalState.open}
        initialContent={editModalState.item?.content || ''}
        onClose={() => setEditModalState({ open: false, item: null })}
        onSave={handleEditSave}
      />
      <QRCodeSelectorDialog
        open={qrDialogState.open}
        qrcodes={qrDialogState.qrcodes}
        selectedId={qrDialogState.selectedId}
        onSelect={(id) => setQrDialogState((prev) => ({ ...prev, selectedId: id }))}
        onClose={closeQrDialog}
        onCopySelected={handleCopySelectedQr}
        onCopyAll={handleCopyAllQr}
        loading={qrDialogState.loading}
      />
    </div>
  );
}

export default App;

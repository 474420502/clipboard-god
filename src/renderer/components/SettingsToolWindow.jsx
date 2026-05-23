import React, { useCallback, useEffect, useMemo, useState } from 'react';
import i18next from '../i18n';
import { useTranslation } from 'react-i18next';
import ShortcutCapture from './ShortcutCapture';

const DEFAULT_OCR_TEXT_LAYOUT = {
    lineMergeThresholdRatio: 0.5,
    lineMergeThresholdPx: 0,
    spaceGapRatio: 0.2,
    spaceGapMinPx: 2,
    insertSpaceByGap: true,
    splitByGap: true
};

const DEFAULT_OCR_PREPROCESS_MODELS = {
    docOrientation: true,
    docUnwarp: false,
    textlineOrientation: true
};

const DEFAULT_OCR_LANGUAGES = ['chi_sim', 'eng'];

const DEFAULT_OCR_VL_CPU_THREADS = Math.max(
    1,
    Math.min(8, typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4)
);

const DEFAULT_OCR_VL_MAX_CONCURRENT_JOBS = Math.max(
    1,
    Math.min(2, Math.floor(DEFAULT_OCR_VL_CPU_THREADS / 4) || 1)
);

const DEFAULT_SETTINGS = {
    previewLength: 120,
    maxHistoryItems: 500,
    useNumberShortcuts: true,
    globalShortcut: 'CommandOrControl+Alt+V',
    screenshotShortcut: 'CommandOrControl+Shift+S',
    theme: 'light',
    enableTooltips: true,
    launchOnStartup: false,
    locale: 'zh-CN'
};

const TAB_IDS = ['general', 'appearance', 'shortcuts', 'ocr', 'llm'];

const OCR_LANGUAGE_OPTIONS = [
    { code: 'chi_sim', labelKey: 'history.ocrLangChiSim', fallback: 'Chinese (Simplified)' },
    { code: 'chi_tra', labelKey: 'history.ocrLangChiTra', fallback: 'Chinese (Traditional)' },
    { code: 'eng', labelKey: 'history.ocrLangEng', fallback: 'English' },
    { code: 'jpn', labelKey: 'history.ocrLangJpn', fallback: 'Japanese' },
    { code: 'kor', labelKey: 'history.ocrLangKor', fallback: 'Korean' },
    { code: 'deu', labelKey: 'history.ocrLangDeu', fallback: 'German' },
    { code: 'fra', labelKey: 'history.ocrLangFra', fallback: 'French' },
    { code: 'spa', labelKey: 'history.ocrLangSpa', fallback: 'Spanish' },
    { code: 'por', labelKey: 'history.ocrLangPor', fallback: 'Portuguese' },
    { code: 'ita', labelKey: 'history.ocrLangIta', fallback: 'Italian' },
    { code: 'rus', labelKey: 'history.ocrLangRus', fallback: 'Russian' },
    { code: 'ara', labelKey: 'history.ocrLangAra', fallback: 'Arabic' },
    { code: 'vie', labelKey: 'history.ocrLangVie', fallback: 'Vietnamese' },
    { code: 'tha', labelKey: 'history.ocrLangTha', fallback: 'Thai' },
    { code: 'nld', labelKey: 'history.ocrLangNld', fallback: 'Dutch' },
    { code: 'pol', labelKey: 'history.ocrLangPol', fallback: 'Polish' }
];

const OCR_MODEL_LANGUAGE_OPTIONS = [
    { value: 'chinese', label: 'Chinese (Simplified/Traditional)' },
    { value: 'english', label: 'English' },
    { value: 'arabic', label: 'Arabic' },
    { value: 'eslav', label: 'Slavic (East)' },
    { value: 'greek', label: 'Greek' },
    { value: 'hindi', label: 'Hindi' },
    { value: 'korean', label: 'Korean' },
    { value: 'latin', label: 'Latin' },
    { value: 'tamil', label: 'Tamil' },
    { value: 'telugu', label: 'Telugu' },
    { value: 'thai', label: 'Thai' }
];

const THEME_OPTIONS = [
    { value: 'light', key: 'settings.appearance.theme.options.light', fallback: 'Light' },
    { value: 'dark', key: 'settings.appearance.theme.options.dark', fallback: 'Dark' },
    { value: 'blue', key: 'settings.appearance.theme.options.blue', fallback: 'Blue' },
    { value: 'purple', key: 'settings.appearance.theme.options.purple', fallback: 'Purple' },
    { value: 'green', key: 'settings.appearance.theme.options.green', fallback: 'Green' },
    { value: 'orange', key: 'settings.appearance.theme.options.orange', fallback: 'Orange' },
    { value: 'pink', key: 'settings.appearance.theme.options.pink', fallback: 'Pink' },
    { value: 'gray', key: 'settings.appearance.theme.options.gray', fallback: 'Gray' },
    { value: 'eye-protection', key: 'settings.appearance.theme.options.eye-protection', fallback: 'Eye Protection' },
    { value: 'high-contrast', key: 'settings.appearance.theme.options.high-contrast', fallback: 'High Contrast' }
];

const TAB_DESCRIPTIONS = {
    general: '语言、历史容量、开机行为和基础交互偏好。',
    appearance: '主题与整体视觉呈现，决定这个应用的气质。',
    shortcuts: '全局唤起、截图触发以及高频操作的键盘入口。',
    ocr: 'OCR 模型、CLI 环境、语言、预处理与运行时策略。',
    llm: 'LLM 预设、提示词与高级采样参数的集中配置。'
};

const TAB_KICKERS = {
    general: 'FOUNDATION',
    appearance: 'VISUAL',
    shortcuts: 'KEYFLOW',
    ocr: 'VISION',
    llm: 'MODELS'
};

const cloneLlmEntries = (llms = {}) => {
    if (!llms || typeof llms !== 'object') return {};
    return Object.fromEntries(
        Object.entries(llms)
            .filter(([name, entry]) => String(name || '').trim() && entry && typeof entry === 'object')
            .map(([name, entry]) => [String(name), { ...entry }])
    );
};

const normalizeLanguages = (languages) => {
    const next = Array.isArray(languages)
        ? languages.map((lang) => String(lang || '').trim()).filter(Boolean)
        : [];
    return next.length ? next : [...DEFAULT_OCR_LANGUAGES];
};

const getLanguageLabel = (code, translate) => {
    const option = OCR_LANGUAGE_OPTIONS.find((item) => item.code === code);
    return option ? translate(option.labelKey, option.fallback) : String(code || '').trim();
};

const summarizeLanguageLabels = (labels, limit = 2) => {
    const list = Array.isArray(labels) ? labels.filter(Boolean) : [];
    if (!list.length) return '';
    if (list.length <= limit) return list.join(', ');
    return `${list.slice(0, limit).join(', ')} +${list.length - limit}`;
};

const getCompactCommandLabel = (command) => {
    const trimmed = String(command || '').trim();
    if (!trimmed) return 'paddleocr';

    if (/\s+-m\s+paddleocr\b/.test(trimmed)) {
        const pythonCommand = trimmed.split(/\s+-m\s+paddleocr\b/)[0].trim();
        const pythonName = pythonCommand.split(/[\\/]/).pop() || pythonCommand;
        return `${pythonName} -m paddleocr`;
    }

    const commandToken = trimmed.split(/\s+/)[0];
    return commandToken.split(/[\\/]/).pop() || commandToken;
};

const pickSelectedLlm = (llms, preferred = '') => {
    const entries = llms && typeof llms === 'object' ? llms : {};
    const names = Object.keys(entries);
    const candidate = String(preferred || '').trim();
    if (candidate && entries[candidate]) return candidate;
    return names[0] || '';
};

const normalizeSettings = (cfg = {}, preferredSelectedLlm = '') => {
    const llms = cloneLlmEntries(cfg.llms);
    return {
        previewLength: typeof cfg.previewLength !== 'undefined' ? Number(cfg.previewLength) || DEFAULT_SETTINGS.previewLength : DEFAULT_SETTINGS.previewLength,
        maxHistoryItems: typeof cfg.maxHistoryItems !== 'undefined' ? Number(cfg.maxHistoryItems) || DEFAULT_SETTINGS.maxHistoryItems : DEFAULT_SETTINGS.maxHistoryItems,
        useNumberShortcuts: typeof cfg.useNumberShortcuts !== 'undefined' ? !!cfg.useNumberShortcuts : DEFAULT_SETTINGS.useNumberShortcuts,
        globalShortcut: typeof cfg.globalShortcut === 'string' ? cfg.globalShortcut : DEFAULT_SETTINGS.globalShortcut,
        screenshotShortcut: typeof cfg.screenshotShortcut === 'string' ? cfg.screenshotShortcut : DEFAULT_SETTINGS.screenshotShortcut,
        theme: typeof cfg.theme === 'string' ? cfg.theme : DEFAULT_SETTINGS.theme,
        enableTooltips: typeof cfg.enableTooltips !== 'undefined' ? !!cfg.enableTooltips : DEFAULT_SETTINGS.enableTooltips,
        launchOnStartup: typeof cfg.launchOnStartup !== 'undefined' ? !!cfg.launchOnStartup : DEFAULT_SETTINGS.launchOnStartup,
        locale: typeof cfg.locale === 'string' ? cfg.locale : DEFAULT_SETTINGS.locale,
        llms,
        _selectedLlm: pickSelectedLlm(llms, cfg._selectedLlm || preferredSelectedLlm),
        ocrLanguages: normalizeLanguages(cfg.ocrLanguages),
        ocrTextLayout: cfg.ocrTextLayout && typeof cfg.ocrTextLayout === 'object'
            ? { ...DEFAULT_OCR_TEXT_LAYOUT, ...cfg.ocrTextLayout }
            : { ...DEFAULT_OCR_TEXT_LAYOUT },
        ocrModelSource: cfg.ocrModelSource || 'builtin',
        ocrModelLanguage: cfg.ocrModelLanguage || 'chinese',
        ocrVlCliCommand: cfg.ocrVlCliCommand || 'paddleocr',
        ocrVlDevice: typeof cfg.ocrVlDevice === 'string' ? cfg.ocrVlDevice : '',
        ocrVlCpuThreads: Number.isFinite(Number(cfg.ocrVlCpuThreads))
            ? Math.max(0, Number(cfg.ocrVlCpuThreads))
            : DEFAULT_OCR_VL_CPU_THREADS,
        ocrVlMaxConcurrentJobs: Number(cfg.ocrVlMaxConcurrentJobs) > 0
            ? Number(cfg.ocrVlMaxConcurrentJobs)
            : DEFAULT_OCR_VL_MAX_CONCURRENT_JOBS,
        ocrVlEnableMkldnn: typeof cfg.ocrVlEnableMkldnn === 'boolean' ? cfg.ocrVlEnableMkldnn : true,
        ocrVlCliArgs: typeof cfg.ocrVlCliArgs === 'string' ? cfg.ocrVlCliArgs : '',
        ocrPreprocessModels: cfg.ocrPreprocessModels && typeof cfg.ocrPreprocessModels === 'object'
            ? { ...DEFAULT_OCR_PREPROCESS_MODELS, ...cfg.ocrPreprocessModels }
            : { ...DEFAULT_OCR_PREPROCESS_MODELS }
    };
};

const buildPersistedSettings = (settings = {}) => ({
    previewLength: Number(settings.previewLength) || DEFAULT_SETTINGS.previewLength,
    maxHistoryItems: Number(settings.maxHistoryItems) || DEFAULT_SETTINGS.maxHistoryItems,
    useNumberShortcuts: !!settings.useNumberShortcuts,
    globalShortcut: typeof settings.globalShortcut === 'string' ? settings.globalShortcut : DEFAULT_SETTINGS.globalShortcut,
    screenshotShortcut: typeof settings.screenshotShortcut === 'string' ? settings.screenshotShortcut : DEFAULT_SETTINGS.screenshotShortcut,
    theme: typeof settings.theme === 'string' ? settings.theme : DEFAULT_SETTINGS.theme,
    enableTooltips: !!settings.enableTooltips,
    launchOnStartup: !!settings.launchOnStartup,
    locale: typeof settings.locale === 'string' ? settings.locale : DEFAULT_SETTINGS.locale,
    llms: cloneLlmEntries(settings.llms),
    ocrLanguages: normalizeLanguages(settings.ocrLanguages),
    ocrTextLayout: { ...DEFAULT_OCR_TEXT_LAYOUT, ...(settings.ocrTextLayout || {}) },
    ocrModelSource: settings.ocrModelSource || 'builtin',
    ocrModelLanguage: settings.ocrModelLanguage || 'chinese',
    ocrVlCliCommand: settings.ocrVlCliCommand || 'paddleocr',
    ocrVlDevice: typeof settings.ocrVlDevice === 'string' ? settings.ocrVlDevice : '',
    ocrVlCpuThreads: Number.isFinite(Number(settings.ocrVlCpuThreads)) ? Math.max(0, Number(settings.ocrVlCpuThreads)) : DEFAULT_OCR_VL_CPU_THREADS,
    ocrVlMaxConcurrentJobs: Number(settings.ocrVlMaxConcurrentJobs) > 0 ? Number(settings.ocrVlMaxConcurrentJobs) : DEFAULT_OCR_VL_MAX_CONCURRENT_JOBS,
    ocrVlEnableMkldnn: settings.ocrVlEnableMkldnn !== false,
    ocrVlCliArgs: typeof settings.ocrVlCliArgs === 'string' ? settings.ocrVlCliArgs : '',
    ocrPreprocessModels: { ...DEFAULT_OCR_PREPROCESS_MODELS, ...(settings.ocrPreprocessModels || {}) }
});

const serializeSettings = (settings = {}) => JSON.stringify(buildPersistedSettings(settings));

const getInitialTab = (fallbackTab = 'general') => {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const requestedTab = String(params.get('tab') || '').trim().toLowerCase();
        const windowType = String(params.get('window') || '').trim().toLowerCase();

        if (TAB_IDS.includes(requestedTab)) return requestedTab;
        if (windowType === 'ocr-settings') return 'ocr';
    } catch (_) {
        // ignore URL parsing failures
    }

    return TAB_IDS.includes(fallbackTab) ? fallbackTab : 'general';
};

function SettingsToolWindow({ defaultTab = 'general' }) {
    const { t: rawT } = useTranslation();
    const t = useCallback((key, fallback = '', options) => {
        const translated = rawT(key, options);
        return translated === key ? fallback : translated;
    }, [rawT]);

    const tabs = useMemo(() => ([
        {
            id: 'general',
            label: t('settings.tabs.general', '常规'),
            badge: '01',
            kicker: TAB_KICKERS.general,
            description: t('settings.general.summary', TAB_DESCRIPTIONS.general)
        },
        {
            id: 'appearance',
            label: t('settings.tabs.appearance', '外观'),
            badge: '02',
            kicker: TAB_KICKERS.appearance,
            description: t('settings.appearance.summary', TAB_DESCRIPTIONS.appearance)
        },
        {
            id: 'shortcuts',
            label: t('settings.tabs.shortcuts', '快捷键'),
            badge: '03',
            kicker: TAB_KICKERS.shortcuts,
            description: t('settings.shortcuts.summary', TAB_DESCRIPTIONS.shortcuts)
        },
        {
            id: 'ocr',
            label: t('settings.tabs.ocr', 'OCR'),
            badge: '04',
            kicker: TAB_KICKERS.ocr,
            description: t('settings.ocr.summary', TAB_DESCRIPTIONS.ocr)
        },
        {
            id: 'llm',
            label: t('settings.tabs.llm', 'LLM'),
            badge: '05',
            kicker: TAB_KICKERS.llm,
            description: t('settings.llm.summary', TAB_DESCRIPTIONS.llm)
        }
    ]), [t]);

    const [activeTab, setActiveTab] = useState(() => getInitialTab(defaultTab));
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState('');
    const [paramsExpanded, setParamsExpanded] = useState({});
    const [settings, setSettings] = useState(() => normalizeSettings({}));
    const [savedSettingsKey, setSavedSettingsKey] = useState(() => serializeSettings({}));
    const [runtimeTarget, setRuntimeTarget] = useState('auto');
    const [runtimeLoading, setRuntimeLoading] = useState(false);
    const [runtimeApplying, setRuntimeApplying] = useState(false);
    const [runtimeInfo, setRuntimeInfo] = useState(null);

    const dirty = useMemo(() => serializeSettings(settings) !== savedSettingsKey, [savedSettingsKey, settings]);

    const applyIncomingSettings = useCallback((cfg = {}) => {
        setSettings((prev) => {
            const next = normalizeSettings(cfg, prev?._selectedLlm || '');
            setSavedSettingsKey(serializeSettings(next));
            return next;
        });
    }, []);

    const formatRuntimeSummary = useCallback((nextRuntimeInfo) => {
        if (!nextRuntimeInfo || typeof nextRuntimeInfo !== 'object') {
            return t('settings.ocr.runtimeSummaryEmpty', 'No OCR runtime detection has been run yet.');
        }

        const lines = [];
        const host = nextRuntimeInfo.host || {};
        const configured = nextRuntimeInfo.configuredCandidate || null;
        const recommended = nextRuntimeInfo.recommendedCandidate || null;
        const unknownText = t('settings.ocr.runtimeSummaryUnknown', 'unknown');

        if (host.gpuName || host.gpuArch) {
            const gpuName = host.gpuName || unknownText;
            const gpuArch = host.gpuArch ? ` (${host.gpuArch})` : '';
            lines.push(t('settings.ocr.runtimeSummaryHostGpu', `Host GPU: ${gpuName}${gpuArch}`, { name: gpuName, arch: gpuArch }));
        }
        if (host.rocmVersion) {
            lines.push(t('settings.ocr.runtimeSummaryRocmVersion', `ROCm version: ${host.rocmVersion}`, { version: host.rocmVersion }));
        }
        if (configured) {
            const currentCommand = configured.persistedCommand || configured.displayCommand;
            if (currentCommand) {
                lines.push(t('settings.ocr.runtimeSummaryCurrentCommand', `Current command: ${currentCommand}`, { command: currentCommand }));
            }

            const pythonSuffix = configured.pythonVersion
                ? t('settings.ocr.runtimeSummaryPythonSuffix', `, Python ${configured.pythonVersion}`, { version: configured.pythonVersion })
                : '';
            const paddleSuffix = configured.paddleVersion
                ? t('settings.ocr.runtimeSummaryPaddleSuffix', `, Paddle ${configured.paddleVersion}`, { version: configured.paddleVersion })
                : '';

            lines.push(t('settings.ocr.runtimeSummaryCurrentRuntime', `Current runtime: ${configured.status || unknownText}${pythonSuffix}${paddleSuffix}`, {
                status: configured.status || unknownText,
                python: pythonSuffix,
                paddle: paddleSuffix
            }));

            if (configured.gpuProbeError) {
                lines.push(t('settings.ocr.runtimeSummaryCurrentGpuProbe', `Current GPU probe: ${configured.gpuProbeError}`, { message: configured.gpuProbeError }));
            }
        } else if (nextRuntimeInfo.configuredCommand) {
            lines.push(t('settings.ocr.runtimeSummaryCurrentCommand', `Current command: ${nextRuntimeInfo.configuredCommand}`, { command: nextRuntimeInfo.configuredCommand }));
        }

        if (recommended) {
            const recommendedCommand = recommended.persistedCommand || recommended.displayCommand;
            if (recommendedCommand) {
                lines.push(t('settings.ocr.runtimeSummaryRecommendedCommand', `Recommended command: ${recommendedCommand}`, { command: recommendedCommand }));
            }

            const deviceSuffix = nextRuntimeInfo.recommendedDevice
                ? t('settings.ocr.runtimeSummaryDeviceSuffix', `, device ${nextRuntimeInfo.recommendedDevice}`, { device: nextRuntimeInfo.recommendedDevice })
                : '';
            lines.push(t('settings.ocr.runtimeSummaryRecommendedRuntime', `Recommended runtime: ${recommended.status || unknownText}${deviceSuffix}`, {
                status: recommended.status || unknownText,
                device: deviceSuffix
            }));
        }

        if (nextRuntimeInfo.needsInstall) {
            const installTarget = nextRuntimeInfo.installSuggestion && nextRuntimeInfo.installSuggestion.target
                ? nextRuntimeInfo.installSuggestion.target
                : t('settings.ocr.runtimeSummaryManualSetup', 'manual setup required');
            lines.push(t('settings.ocr.runtimeSummaryInstallRecommended', `Install recommended: ${installTarget}`, { target: installTarget }));
        }

        return lines.filter(Boolean).join('\n');
    }, [t]);

    const updateField = useCallback((field, value) => {
        setSettings((prev) => ({ ...prev, [field]: value }));
    }, []);

    const updateTextLayout = useCallback((field, value) => {
        setSettings((prev) => ({
            ...prev,
            ocrTextLayout: {
                ...DEFAULT_OCR_TEXT_LAYOUT,
                ...(prev.ocrTextLayout || {}),
                [field]: value
            }
        }));
    }, []);

    const updatePreprocess = useCallback((field, value) => {
        setSettings((prev) => ({
            ...prev,
            ocrPreprocessModels: {
                ...DEFAULT_OCR_PREPROCESS_MODELS,
                ...(prev.ocrPreprocessModels || {}),
                [field]: value
            }
        }));
    }, []);

    const updateLlmEntry = useCallback((name, patch) => {
        setSettings((prev) => ({
            ...prev,
            llms: {
                ...(prev.llms || {}),
                [name]: {
                    ...((prev.llms || {})[name] || {}),
                    ...patch
                }
            }
        }));
    }, []);

    const handleToggleLanguage = useCallback((code) => {
        setSettings((prev) => {
            const current = Array.isArray(prev.ocrLanguages) ? prev.ocrLanguages : [];
            const next = current.includes(code)
                ? current.filter((item) => item !== code)
                : [...current, code];
            return {
                ...prev,
                ocrLanguages: next.length ? next : [...DEFAULT_OCR_LANGUAGES]
            };
        });
    }, []);

    const loadSettings = useCallback(async () => {
        if (!window.electronAPI || typeof window.electronAPI.getSettings !== 'function') {
            setLoading(false);
            return;
        }

        const cfg = await window.electronAPI.getSettings();
        applyIncomingSettings(cfg || {});
        setLoading(false);
    }, [applyIncomingSettings]);

    const loadRuntimeInfo = useCallback(async ({ persist = false } = {}) => {
        const api = window.electronAPI || {};
        const detectFn = persist ? api.redetectOcrRuntime : api.detectOcrRuntime;
        if (typeof detectFn !== 'function') {
            return;
        }

        if (persist) {
            setRuntimeApplying(true);
        } else {
            setRuntimeLoading(true);
        }

        try {
            const res = await detectFn({ target: runtimeTarget });
            if (!res || res.success === false) {
                throw new Error((res && res.error) || 'Failed to detect OCR runtime');
            }

            const nextRuntimeInfo = res.detection || res;
            setRuntimeInfo(nextRuntimeInfo || null);

            if (persist && res.config && typeof res.config === 'object') {
                applyIncomingSettings(res.config);
                if (Array.isArray(res.changedKeys) && res.changedKeys.length) {
                    setStatus(t('settings.ocr.runtimeRedetectApplied', 'OCR runtime re-detected and the command path was updated.'));
                } else {
                    setStatus(t('settings.ocr.runtimeRedetectNoChange', 'OCR runtime re-detected. The current command already matches the best detected environment.'));
                }
            }
        } catch (err) {
            setStatus(err && err.message ? err.message : 'Failed to detect OCR runtime');
        } finally {
            if (persist) {
                setRuntimeApplying(false);
            } else {
                setRuntimeLoading(false);
            }
        }
    }, [applyIncomingSettings, runtimeTarget, t]);

    const handleSave = useCallback(async () => {
        try {
            if (!window.electronAPI || typeof window.electronAPI.setSettings !== 'function') {
                throw new Error('settings-bridge-unavailable');
            }

            const payload = buildPersistedSettings(settings);
            const shortcutMap = {};
            if (payload.llms && typeof payload.llms === 'object') {
                for (const [name, entry] of Object.entries(payload.llms)) {
                    if (!entry) continue;
                    const shortcut = entry.llmShortcut ? String(entry.llmShortcut).trim() : '';
                    if (!shortcut) continue;
                    const key = shortcut.toLowerCase();
                    if (!shortcutMap[key]) shortcutMap[key] = [];
                    shortcutMap[key].push(name);
                }
            }

            const conflicts = Object.entries(shortcutMap).filter(([, names]) => names.length > 1);
            if (conflicts.length > 0) {
                const message = conflicts.map(([shortcut, names]) => `Shortcut "${shortcut}" is used by multiple entries: ${names.join(', ')}`).join('\n');
                window.alert(`Shortcut conflicts detected. Save was cancelled.\n${message}`);
                return;
            }

            setSaving(true);
            setStatus('');
            const res = await window.electronAPI.setSettings(payload);
            if (!res || res.success !== true) {
                throw new Error((res && res.error) || 'Failed to save settings');
            }

            const normalized = normalizeSettings(res.config || payload, settings._selectedLlm || '');
            setSettings(normalized);
            setSavedSettingsKey(serializeSettings(normalized));
            setStatus(t('settings.ocr.toolWindowSaved', 'Settings saved and applied to global config.'));

            const newLocale = payload.locale;
            if (newLocale && window.localeAPI && typeof window.localeAPI.setLocale === 'function') {
                try {
                    await window.localeAPI.setLocale(newLocale);
                } catch (_) {
                    // ignore locale bridge failures and still update local i18n state
                }
            }
            if (newLocale) {
                try {
                    await i18next.changeLanguage(newLocale);
                } catch (_) {
                    // ignore renderer i18n refresh failures
                }
            }
        } catch (err) {
            setStatus(err && err.message ? err.message : 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    }, [settings, t]);

    useEffect(() => {
        loadSettings().catch((err) => {
            setStatus(err && err.message ? err.message : 'Failed to load settings');
            setLoading(false);
        });
    }, [loadSettings]);

    useEffect(() => {
        loadRuntimeInfo().catch((err) => {
            setStatus(err && err.message ? err.message : 'Failed to detect OCR runtime');
        });
    }, [loadRuntimeInfo]);

    useEffect(() => {
        if (!window.electronAPI || typeof window.electronAPI.onSettingsUpdated !== 'function') {
            return undefined;
        }

        const unsubscribe = window.electronAPI.onSettingsUpdated((payload) => {
            const cfg = payload && typeof payload === 'object' ? (payload.config || payload) : null;
            if (!cfg || typeof cfg !== 'object') return;
            applyIncomingSettings(cfg);
            setStatus(t('settings.ocr.toolWindowSaved', 'Settings saved and applied to global config.'));
        });

        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [applyIncomingSettings, t]);

    useEffect(() => {
        if (!window.electronAPI || typeof window.electronAPI.onSettingsWindowTab !== 'function') {
            return undefined;
        }

        const unsubscribe = window.electronAPI.onSettingsWindowTab((payload) => {
            const requestedTab = String(payload?.tab || payload || '').trim().toLowerCase();
            if (TAB_IDS.includes(requestedTab)) {
                setActiveTab(requestedTab);
            }
        });

        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, []);

    useEffect(() => {
        const handleClose = () => {
            if (dirty) {
                const confirmed = window.confirm(t('settings.ocr.closeDiscardConfirm', 'There are unapplied changes in this window. Close and discard them?'));
                if (!confirmed) return;
            }

            try { window.close(); } catch (_) { }
        };

        const handleKeyDown = (event) => {
            if (!event) return;
            const key = String(event.key || '').toLowerCase();
            const ctrlOrCmd = !!(event.ctrlKey || event.metaKey);

            if (event.key === 'Escape') {
                handleClose();
                return;
            }

            if (ctrlOrCmd && key === 's') {
                event.preventDefault();
                if (!saving) {
                    handleSave();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [dirty, handleSave, saving, t]);

    useEffect(() => {
        try {
            document.title = t('settings.title', 'Settings');
        } catch (_) {
            // ignore title failures
        }
    }, [t]);

    const currentLlmName = settings._selectedLlm || '';
    const currentLlmEntry = currentLlmName && settings.llms ? settings.llms[currentLlmName] : null;
    const activeTabMeta = tabs.find((tab) => tab.id === activeTab) || tabs[0];
    const themeLabel = (THEME_OPTIONS.find((option) => option.value === settings.theme) || THEME_OPTIONS[0]);
    const selectedLanguagesCount = Array.isArray(settings.ocrLanguages) ? settings.ocrLanguages.length : 0;
    const selectedLanguageLabels = (Array.isArray(settings.ocrLanguages) ? settings.ocrLanguages : []).map((code) => getLanguageLabel(code, t));
    const selectedLanguageSummary = summarizeLanguageLabels(selectedLanguageLabels);
    const llmEntries = Object.keys(settings.llms || {});
    const localeLabel = settings.locale === 'en' ? 'English' : '简体中文';
    const isExternalOcrModel = settings.ocrModelSource === 'paddleocr-vl-cli';
    const runtimeCommandDisplay = getCompactCommandLabel(settings.ocrVlCliCommand || 'paddleocr');
    const currentModelSourceLabel = settings.ocrModelSource === 'paddleocr-vl-cli'
        ? t('settings.ocr.modelSourcePaddleVlCli', 'PaddleOCR-VL (local CLI)')
        : t('settings.ocr.modelSourceBuiltin', 'Built-in (PP-OCRv5 mobile)');
    const currentModelLanguageLabel = (OCR_MODEL_LANGUAGE_OPTIONS.find((lang) => lang.value === (settings.ocrModelLanguage || 'chinese')) || OCR_MODEL_LANGUAGE_OPTIONS[0]).label;
    const statusTitle = dirty
        ? t('settings.ocr.toolWindowPendingTitle', 'Current window has unapplied changes')
        : t('settings.ocr.toolWindowAppliedTitle', 'Current config has been applied globally');
    const statusText = status || (dirty
        ? t('settings.ocr.toolWindowDirty', 'These edits stay local to this window until you save and apply them.')
        : t('settings.ocr.toolWindowHint', 'You are looking at the version that is already active in the global config.'));
    const overviewCards = (() => {
        if (activeTab === 'general') {
            return [
                { label: 'Locale', value: localeLabel, detail: '界面语言' },
                { label: 'History', value: String(settings.maxHistoryItems || DEFAULT_SETTINGS.maxHistoryItems), detail: '最大历史条目' },
                { label: 'Startup', value: settings.launchOnStartup ? 'ON' : 'OFF', detail: '开机启动' }
            ];
        }
        if (activeTab === 'appearance') {
            return [
                { label: 'Theme', value: t(themeLabel.key, themeLabel.fallback), detail: '当前主题' },
                { label: 'Tooltips', value: settings.enableTooltips ? 'ON' : 'OFF', detail: '悬停提示' },
                { label: 'Locale', value: localeLabel, detail: '当前语言' }
            ];
        }
        if (activeTab === 'shortcuts') {
            return [
                { label: 'Panel', value: settings.globalShortcut || 'Unset', detail: '主面板快捷键' },
                { label: 'Capture', value: settings.screenshotShortcut || 'Unset', detail: '截图快捷键' },
                { label: 'Numbers', value: settings.useNumberShortcuts ? 'ON' : 'OFF', detail: '数字快捷键' }
            ];
        }
        if (activeTab === 'ocr') {
            return [
                { label: 'Engine', value: currentModelSourceLabel, detail: isExternalOcrModel ? t('settings.ocr.modelLanguageActiveOverview', 'External CLI language family is active') : t('settings.ocr.modelLanguageInactiveOverview', 'Using built-in OCR pipeline') },
                { label: 'OCR Tags', value: `${selectedLanguagesCount}`, detail: selectedLanguageSummary || t('settings.ocr.languageTagEmpty', 'Keep at least one language selected'), detailTitle: selectedLanguageLabels.join(', ') },
                { label: 'Runtime', value: settings.ocrVlDevice || 'Auto', detail: runtimeCommandDisplay, detailTitle: settings.ocrVlCliCommand || 'paddleocr' }
            ];
        }
        return [
            { label: 'Entries', value: `${llmEntries.length}`, detail: '可用预设' },
            { label: 'Current', value: currentLlmName || 'None', detail: '当前编辑项' },
            { label: 'Trigger', value: currentLlmEntry?.triggerType || 'text', detail: currentLlmEntry?.model || '未设置模型' }
        ];
    })();

    if (loading) {
        return (
            <div className="ocr-tool-window">
                <div className="ocr-loading">{t('settings.ocr.toolWindowLoading', 'Loading...')}</div>
            </div>
        );
    }

    const handleClose = () => {
        if (dirty) {
            const confirmed = window.confirm(t('settings.ocr.closeDiscardConfirm', 'There are unapplied changes in this window. Close and discard them?'));
            if (!confirmed) return;
        }

        try { window.close(); } catch (_) { }
    };

    return (
        <div className="ocr-tool-window settings-tool-window">
            <div className="settings-tool-shell">
                <aside className="settings-tool-sidebar">
                    <div className="settings-tool-brand">
                        <span className="settings-tool-brand-kicker">CONTROL CENTER</span>
                        <h1>{t('settings.title', '设置')}</h1>
                        <p>{t('settings.ocr.toolWindowHint', '这里的修改会先保留在当前窗口，点击“保存并应用”后才会写入全局配置。')}</p>
                    </div>

                    <div className="settings-tool-status-card">
                        <span className={`settings-tool-status-pill ${dirty ? 'dirty' : 'synced'}`}>
                            {dirty ? t('settings.ocr.toolWindowDraftBadge', 'Draft') : t('settings.ocr.toolWindowAppliedBadge', 'Applied')}
                        </span>
                        <strong>{statusTitle}</strong>
                        <span>{statusText}</span>
                    </div>

                    <div className="settings-tool-tabbar" role="tablist" aria-label={t('settings.title', 'Settings')}>
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                className={`settings-tool-tab ${activeTab === tab.id ? 'active' : ''}`}
                                aria-selected={activeTab === tab.id}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                <span className="settings-tool-tab-badge" aria-hidden="true">{tab.badge}</span>
                                <span className="settings-tool-tab-copy">
                                    <span className="settings-tool-tab-kicker">{tab.kicker}</span>
                                    <span className="settings-tool-tab-title">{tab.label}</span>
                                    <span className="settings-tool-tab-description">{tab.description}</span>
                                </span>
                            </button>
                        ))}
                    </div>

                    <div className="settings-tool-sidebar-footer">
                        <span>{dirty ? t('settings.ocr.toolWindowDraftFooter', '保存并应用后才会广播到主窗口和 OCR 窗口。') : t('settings.ocr.toolWindowAppliedFooter', '这是统一的独立设置工作台。')}</span>
                    </div>
                </aside>

                <div className="settings-tool-main">
                    <div className="settings-tool-hero">
                        <div className="settings-tool-hero-copy">
                            <span className="settings-tool-hero-kicker">{activeTabMeta.kicker}</span>
                            <h2>{activeTabMeta.label}</h2>
                            <p>{activeTabMeta.description}</p>
                        </div>
                        <div className="settings-tool-hero-actions">
                            <button type="button" className="settings-tool-button settings-tool-button-ghost" onClick={handleClose}>
                                {t('settings.close', '关闭')}
                            </button>
                        </div>
                        <div className="settings-tool-overview-grid">
                            {overviewCards.map((card) => (
                                <div key={`${activeTab}-${card.label}`} className="settings-tool-overview-card">
                                    <span className="settings-tool-overview-label">{card.label}</span>
                                    <strong title={card.valueTitle || card.value}>{card.value}</strong>
                                    <span title={card.detailTitle || card.detail}>{card.detail}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="ocr-tool-body settings-tool-body">

                        {activeTab === 'general' && (
                            <section className="ocr-tool-section">
                                <div className="ocr-tool-section-title">{t('settings.general.title', 'General')}</div>
                                <div className="ocr-tool-grid">
                                    <label className="ocr-tool-field">
                                        <span>{t('settings.general.locale.label', 'Language')}</span>
                                        <select value={settings.locale || 'zh-CN'} onChange={(e) => updateField('locale', e.target.value)}>
                                            <option value="zh-CN">Chinese (Simplified)</option>
                                            <option value="en">English</option>
                                        </select>
                                        <small>{t('settings.general.locale.help', 'Change the display language for the app.')}</small>
                                    </label>

                                    <label className="ocr-tool-field">
                                        <span>{t('settings.general.previewLength.label', 'Preview length')}</span>
                                        <input type="number" min="20" max="500" value={settings.previewLength} onChange={(e) => updateField('previewLength', parseInt(e.target.value, 10) || DEFAULT_SETTINGS.previewLength)} />
                                        <small>{t('settings.general.previewLength.help', 'Control how much text to show in history previews.')}</small>
                                    </label>

                                    <label className="ocr-tool-field">
                                        <span>{t('settings.general.maxHistory.label', 'Max history items')}</span>
                                        <input type="number" min="10" max="100000" value={settings.maxHistoryItems} onChange={(e) => updateField('maxHistoryItems', parseInt(e.target.value, 10) || DEFAULT_SETTINGS.maxHistoryItems)} />
                                        <small>{t('settings.general.maxHistory.help', 'Limit how many clipboard entries are retained.')}</small>
                                    </label>
                                </div>

                                <div className="ocr-tool-checkbox-list">
                                    <label className="ocr-tool-checkbox-row">
                                        <input type="checkbox" checked={!!settings.useNumberShortcuts} onChange={(e) => updateField('useNumberShortcuts', e.target.checked)} />
                                        <span>{t('settings.general.useNumberShortcuts.label', 'Enable number shortcuts')}</span>
                                    </label>
                                    <label className="ocr-tool-checkbox-row">
                                        <input type="checkbox" checked={!!settings.enableTooltips} onChange={(e) => updateField('enableTooltips', e.target.checked)} />
                                        <span>{t('settings.general.enableTooltips.label', 'Enable tooltips')}</span>
                                    </label>
                                    <label className="ocr-tool-checkbox-row">
                                        <input type="checkbox" checked={!!settings.launchOnStartup} onChange={(e) => updateField('launchOnStartup', e.target.checked)} />
                                        <span>{t('settings.general.launchOnStartup.label', 'Launch on startup')}</span>
                                    </label>
                                </div>
                            </section>
                        )}

                        {activeTab === 'appearance' && (
                            <section className="ocr-tool-section">
                                <div className="ocr-tool-section-title">{t('settings.appearance.title', 'Appearance')}</div>
                                <div className="ocr-tool-grid ocr-tool-grid-single">
                                    <label className="ocr-tool-field">
                                        <span>{t('settings.appearance.theme.label', 'Theme')}</span>
                                        <select value={settings.theme} onChange={(e) => updateField('theme', e.target.value)}>
                                            {THEME_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>{t(option.key, option.fallback)}</option>
                                            ))}
                                        </select>
                                        <small>{t('settings.appearance.theme.help', 'Choose the application theme.')}</small>
                                    </label>
                                </div>
                            </section>
                        )}

                        {activeTab === 'shortcuts' && (
                            <section className="ocr-tool-section">
                                <div className="ocr-tool-section-title">{t('settings.shortcuts.title', 'Shortcuts')}</div>
                                <div className="ocr-tool-grid">
                                    <label className="ocr-tool-field">
                                        <span>{t('settings.shortcuts.globalShortcut.label', 'Global shortcut')}</span>
                                        <ShortcutCapture value={settings.globalShortcut} onChange={(value) => updateField('globalShortcut', value)} placeholder={t('settings.shortcuts.globalShortcut.placeholder', 'Press a shortcut')} />
                                        <small>{t('settings.shortcuts.globalShortcut.help', 'Open the clipboard panel with this shortcut.')}</small>
                                    </label>

                                    <label className="ocr-tool-field">
                                        <span>{t('settings.shortcuts.screenshotShortcut.label', 'Screenshot shortcut')}</span>
                                        <ShortcutCapture value={settings.screenshotShortcut} onChange={(value) => updateField('screenshotShortcut', value)} placeholder={t('settings.shortcuts.screenshotShortcut.placeholder', 'Press a shortcut')} />
                                        <small>{t('settings.shortcuts.screenshotShortcut.help', 'Start the screenshot flow with this shortcut.')}</small>
                                    </label>
                                </div>
                            </section>
                        )}

                        {activeTab === 'ocr' && (
                            <>
                                <div className="ocr-tool-note">
                                    {t('settings.ocr.rocmHint', 'For AMD/ROCm GPUs, point the CLI command to your ROCm-enabled Python or virtualenv and use device gpu:0.')}
                                </div>

                                <section className="ocr-tool-section">
                                    <div className="ocr-tool-section-title">{t('settings.ocr.runtimeDetectionSection', 'Runtime Detection')}</div>
                                    <div className="ocr-tool-grid">
                                        <label className="ocr-tool-field">
                                            <span>{t('settings.ocr.runtimeTarget', 'Detection target')}</span>
                                            <select value={runtimeTarget} onChange={(e) => setRuntimeTarget(e.target.value)}>
                                                <option value="auto">{t('settings.ocr.runtimeTargetAuto', 'Auto')}</option>
                                                <option value="rocm">{t('settings.ocr.runtimeTargetRocm', 'AMD / ROCm GPU')}</option>
                                                <option value="cpu">{t('settings.ocr.runtimeTargetCpu', 'CPU only')}</option>
                                            </select>
                                            <small>{t('settings.ocr.runtimeTargetHelp', 'Choose which runtime family the detector should prefer when it scans OCR environments on this machine.')}</small>
                                        </label>

                                        <label className="ocr-tool-field">
                                            <span>{t('settings.ocr.runtimeSummary', 'Detected runtime summary')}</span>
                                            <textarea readOnly rows={7} value={formatRuntimeSummary(runtimeInfo)} />
                                            <small>{t('settings.ocr.runtimeSummaryHelp', 'The detector inspects the current OCR CLI, local Python environments, and host hardware such as ROCm.')}</small>
                                        </label>
                                    </div>

                                    <div className="settings-tool-inline-actions">
                                        <button type="button" className="settings-tool-button settings-tool-button-secondary" onClick={() => loadRuntimeInfo()} disabled={saving || runtimeLoading || runtimeApplying}>
                                            {runtimeLoading ? t('settings.ocr.toolWindowLoading', 'Loading...') : t('settings.ocr.runtimeDetect', 'Detect runtime')}
                                        </button>
                                        <button type="button" className="settings-tool-button settings-tool-button-primary" onClick={() => loadRuntimeInfo({ persist: true })} disabled={saving || runtimeLoading || runtimeApplying}>
                                            {runtimeApplying ? t('settings.ocr.toolWindowLoading', 'Loading...') : t('settings.ocr.runtimeRedetect', 'Re-detect and update command')}
                                        </button>
                                    </div>

                                    {runtimeInfo && runtimeInfo.installSuggestion && Array.isArray(runtimeInfo.installSuggestion.commands) && runtimeInfo.installSuggestion.commands.length ? (
                                        <div className="ocr-tool-grid ocr-tool-grid-single">
                                            <label className="ocr-tool-field">
                                                <span>{t('settings.ocr.runtimeInstallCommands', 'Recommended install commands')}</span>
                                                <textarea readOnly rows={Math.min(12, runtimeInfo.installSuggestion.commands.length + 2)} value={runtimeInfo.installSuggestion.commands.join('\n')} />
                                                <small>{(runtimeInfo.installSuggestion.notes || []).join(' ') || t('settings.ocr.runtimeInstallCommandsHelp', 'Run these commands in a terminal, then use re-detect to switch the app to the new environment.')}</small>
                                            </label>
                                        </div>
                                    ) : null}
                                </section>

                                <section className="ocr-tool-section">
                                    <div className="settings-tool-section-header settings-tool-section-header-compact">
                                        <div className="settings-tool-section-heading">
                                            <div className="ocr-tool-section-title">{t('settings.ocr.languageTagSection', 'OCR language tags')}</div>
                                            <div className="settings-tool-section-helper">{t('settings.ocr.languageTagHelp', 'These tags control regular OCR language selection. The PaddleOCR-VL language family below only applies when the external CLI backend is enabled.')}</div>
                                        </div>
                                        <div className="settings-tool-selected-hint">{t('settings.ocr.languageTagSelectedCount', `${settings.ocrLanguages.length} selected`, { count: settings.ocrLanguages.length })}</div>
                                    </div>
                                    <div className="settings-tool-selected-language-row" aria-label={t('settings.ocr.languageTagSelectedRow', 'Selected OCR languages')}>
                                        {selectedLanguageLabels.map((label) => (
                                            <span key={label} className="settings-tool-selected-language-chip">{label}</span>
                                        ))}
                                    </div>
                                    <div className="ocr-tool-checkbox-list settings-tool-language-picker" role="group" aria-label={t('history.ocrLangTitle', 'Languages')}>
                                        {OCR_LANGUAGE_OPTIONS.map((lang) => {
                                            const checked = settings.ocrLanguages.includes(lang.code);
                                            return (
                                                <label key={lang.code} className={`ocr-tool-checkbox-row settings-tool-language-tag ${checked ? 'is-selected' : ''}`}>
                                                    <input type="checkbox" checked={checked} onChange={() => handleToggleLanguage(lang.code)} />
                                                    <span className="settings-tool-language-tag-copy">
                                                        <span className="settings-tool-language-tag-name">{t(lang.labelKey, lang.fallback)}</span>
                                                        <span className="settings-tool-language-tag-code">{lang.code}</span>
                                                    </span>
                                                    <span className="settings-tool-language-tag-state" aria-hidden="true">{checked ? t('settings.ocr.languageTagSelectedState', 'Selected') : t('settings.ocr.languageTagIdleState', 'Available')}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </section>

                                <section className="ocr-tool-section">
                                    <div className="ocr-tool-section-title">{t('settings.ocr.modelSection', 'Model Configuration')}</div>
                                    <div className="settings-tool-section-helper">{isExternalOcrModel
                                        ? t('settings.ocr.modelSectionActiveHelp', 'You are configuring the external PaddleOCR-VL CLI backend. Save and apply to write both the model source and language family together.')
                                        : t('settings.ocr.modelSectionInactiveHelp', 'You are currently using the built-in OCR engine. The PaddleOCR-VL language family below only matters after switching to the external CLI backend.')}</div>
                                    <div className="ocr-tool-grid">
                                        <label className="ocr-tool-field">
                                            <span>{t('settings.ocr.modelSource', 'Model source')}</span>
                                            <select value={settings.ocrModelSource || 'builtin'} onChange={(e) => updateField('ocrModelSource', e.target.value)}>
                                                <option value="builtin">{t('settings.ocr.modelSourceBuiltin', 'Built-in (PP-OCRv5 mobile)')}</option>
                                                <option value="paddleocr-vl-cli">{t('settings.ocr.modelSourcePaddleVlCli', 'PaddleOCR-VL (local CLI)')}</option>
                                            </select>
                                            <small>{t('settings.ocr.currentSummaryModel', `Current model: ${currentModelSourceLabel}, language: ${currentModelLanguageLabel}`, {
                                                source: currentModelSourceLabel,
                                                language: currentModelLanguageLabel
                                            })}</small>
                                        </label>

                                        <label className="ocr-tool-field">
                                            <span>{t('settings.ocr.modelLanguage', 'PaddleOCR-VL language family')}</span>
                                            <select value={settings.ocrModelLanguage || 'chinese'} onChange={(e) => updateField('ocrModelLanguage', e.target.value)} disabled={!isExternalOcrModel}>
                                                {OCR_MODEL_LANGUAGE_OPTIONS.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                            <small>{isExternalOcrModel
                                                ? t('settings.ocr.modelLanguageHelp', 'Choose the language family used by the local PaddleOCR-VL CLI backend.')
                                                : t('settings.ocr.modelLanguageDisabledHelp', 'This language family is only applied when model source is set to PaddleOCR-VL (local CLI).')}</small>
                                        </label>
                                    </div>
                                </section>

                                <section className="ocr-tool-section">
                                    <div className="ocr-tool-section-title">{t('settings.ocr.runtimeSection', 'PaddleOCR-VL Runtime')}</div>
                                    <div className="ocr-tool-grid">
                                        <label className="ocr-tool-field">
                                            <span>{t('settings.ocr.vlDevice', 'PaddleOCR device')}</span>
                                            <input type="text" value={typeof settings.ocrVlDevice === 'string' ? settings.ocrVlDevice : ''} onChange={(e) => updateField('ocrVlDevice', e.target.value)} placeholder="auto / cpu / gpu:0 / gpu:0,1" />
                                            <small>{t('settings.ocr.vlDeviceHelp', 'Leave blank to let PaddleOCR choose automatically. Use gpu:0 only when the selected environment really has a GPU-enabled Paddle build.')}</small>
                                        </label>

                                        <label className="ocr-tool-field">
                                            <span>{t('settings.ocr.vlCpuThreads', 'CPU threads')}</span>
                                            <input type="number" min="0" max="64" step="1" value={Number.isFinite(Number(settings.ocrVlCpuThreads)) ? Math.max(0, Number(settings.ocrVlCpuThreads)) : 0} onChange={(e) => updateField('ocrVlCpuThreads', Math.max(0, parseInt(e.target.value, 10) || 0))} />
                                            <small>{t('settings.ocr.vlCpuThreadsHelp', 'How many CPU threads the local PaddleOCR-VL CLI should use when running on CPU.')}</small>
                                        </label>

                                        <label className="ocr-tool-field">
                                            <span>{t('settings.ocr.vlMaxConcurrentJobs', 'Max concurrent OCR jobs')}</span>
                                            <input type="number" min="1" max="8" step="1" value={Number(settings.ocrVlMaxConcurrentJobs) > 0 ? Number(settings.ocrVlMaxConcurrentJobs) : DEFAULT_OCR_VL_MAX_CONCURRENT_JOBS} onChange={(e) => updateField('ocrVlMaxConcurrentJobs', Math.max(1, parseInt(e.target.value, 10) || 1))} />
                                            <small>{t('settings.ocr.vlMaxConcurrentJobsHelp', 'How many local OCR jobs can run at the same time.')}</small>
                                        </label>

                                        <label className="ocr-tool-field ocr-tool-checkbox-field">
                                            <span>{t('settings.ocr.vlEnableMkldnn', 'Enable MKL-DNN')}</span>
                                            <label className="ocr-tool-checkbox-row">
                                                <input type="checkbox" checked={settings.ocrVlEnableMkldnn !== false} onChange={(e) => updateField('ocrVlEnableMkldnn', e.target.checked)} />
                                                <span>{t('settings.ocr.vlEnableMkldnn', 'Enable MKL-DNN')}</span>
                                            </label>
                                            <small>{t('settings.ocr.vlEnableMkldnnHelp', 'Enable MKL-DNN acceleration for CPU inference when available.')}</small>
                                        </label>
                                    </div>
                                </section>

                                <section className="ocr-tool-section">
                                    <div className="ocr-tool-section-title">{t('settings.ocr.cliSection', 'CLI Integration')}</div>
                                    <div className="ocr-tool-grid ocr-tool-grid-single">
                                        <label className="ocr-tool-field">
                                            <span>{t('settings.ocr.vlCliCommand', 'PaddleOCR CLI command')}</span>
                                            <input type="text" value={settings.ocrVlCliCommand || 'paddleocr'} onChange={(e) => updateField('ocrVlCliCommand', e.target.value)} placeholder="paddleocr" />
                                            <small>{t('settings.ocr.vlCliCommandHelp', 'The command or absolute path used to launch PaddleOCR-VL.')}</small>
                                        </label>

                                        <label className="ocr-tool-field">
                                            <span>{t('settings.ocr.vlCliArgs', 'PaddleOCR CLI extra args')}</span>
                                            <input type="text" value={settings.ocrVlCliArgs || ''} onChange={(e) => updateField('ocrVlCliArgs', e.target.value)} placeholder="--engine transformers" />
                                            <small>{t('settings.ocr.vlCliArgsHelp', 'Extra raw arguments appended after the structured OCR runtime flags.')}</small>
                                        </label>
                                    </div>
                                </section>

                                <section className="ocr-tool-section">
                                    <div className="ocr-tool-section-title">{t('settings.ocr.preprocessSection', 'Image Preprocessing')}</div>
                                    <div className="ocr-tool-checkbox-list">
                                        <label className="ocr-tool-checkbox-row">
                                            <input type="checkbox" checked={settings.ocrPreprocessModels?.docOrientation !== false} onChange={(e) => updatePreprocess('docOrientation', e.target.checked)} />
                                            <span>{t('settings.ocr.docOrientation', 'Doc orientation')}</span>
                                        </label>
                                        <label className="ocr-tool-checkbox-row">
                                            <input type="checkbox" checked={!!settings.ocrPreprocessModels?.docUnwarp} onChange={(e) => updatePreprocess('docUnwarp', e.target.checked)} />
                                            <span>{t('settings.ocr.docUnwarp', 'Doc unwarp')}</span>
                                        </label>
                                        <label className="ocr-tool-checkbox-row">
                                            <input type="checkbox" checked={settings.ocrPreprocessModels?.textlineOrientation !== false} onChange={(e) => updatePreprocess('textlineOrientation', e.target.checked)} />
                                            <span>{t('settings.ocr.textlineOrientation', 'Textline orientation')}</span>
                                        </label>
                                    </div>
                                </section>

                                <section className="ocr-tool-section">
                                    <div className="ocr-tool-section-title">{t('settings.ocr.layoutSection', 'Text Layout')}</div>
                                    <div className="ocr-tool-grid">
                                        <label className="ocr-tool-field">
                                            <span>{t('settings.ocr.lineMergeThresholdRatio', 'Line merge threshold (ratio)')}</span>
                                            <input type="number" min="0.2" max="1.2" step="0.05" value={settings.ocrTextLayout?.lineMergeThresholdRatio ?? DEFAULT_OCR_TEXT_LAYOUT.lineMergeThresholdRatio} onChange={(e) => updateTextLayout('lineMergeThresholdRatio', parseFloat(e.target.value) || DEFAULT_OCR_TEXT_LAYOUT.lineMergeThresholdRatio)} />
                                        </label>

                                        <label className="ocr-tool-field">
                                            <span>{t('settings.ocr.lineMergeThresholdPx', 'Line merge threshold (px)')}</span>
                                            <input type="number" min="0" max="40" step="1" value={settings.ocrTextLayout?.lineMergeThresholdPx ?? DEFAULT_OCR_TEXT_LAYOUT.lineMergeThresholdPx} onChange={(e) => updateTextLayout('lineMergeThresholdPx', Math.max(0, parseInt(e.target.value, 10) || 0))} />
                                        </label>

                                        <label className="ocr-tool-field">
                                            <span>{t('settings.ocr.spaceGapRatio', 'Space gap threshold (ratio)')}</span>
                                            <input type="number" min="0.2" max="0.8" step="0.05" value={settings.ocrTextLayout?.spaceGapRatio ?? DEFAULT_OCR_TEXT_LAYOUT.spaceGapRatio} onChange={(e) => updateTextLayout('spaceGapRatio', parseFloat(e.target.value) || DEFAULT_OCR_TEXT_LAYOUT.spaceGapRatio)} />
                                        </label>

                                        <label className="ocr-tool-field">
                                            <span>{t('settings.ocr.spaceGapMinPx', 'Space gap threshold (px)')}</span>
                                            <input type="number" min="0" max="30" step="1" value={settings.ocrTextLayout?.spaceGapMinPx ?? DEFAULT_OCR_TEXT_LAYOUT.spaceGapMinPx} onChange={(e) => updateTextLayout('spaceGapMinPx', Math.max(0, parseInt(e.target.value, 10) || 0))} />
                                        </label>
                                    </div>

                                    <div className="ocr-tool-checkbox-list">
                                        <label className="ocr-tool-checkbox-row">
                                            <input type="checkbox" checked={settings.ocrTextLayout?.insertSpaceByGap !== false} onChange={(e) => updateTextLayout('insertSpaceByGap', e.target.checked)} />
                                            <span>{t('settings.ocr.insertSpaceByGap', 'Insert space by gap')}</span>
                                        </label>
                                        <label className="ocr-tool-checkbox-row">
                                            <input type="checkbox" checked={settings.ocrTextLayout?.splitByGap !== false} onChange={(e) => updateTextLayout('splitByGap', e.target.checked)} />
                                            <span>{t('settings.ocr.splitByGap', 'Split text by blank gap')}</span>
                                        </label>
                                    </div>
                                </section>
                            </>
                        )}

                        {activeTab === 'llm' && (
                            <>
                                <section className="ocr-tool-section">
                                    <div className="ocr-tool-section-title">{t('settings.llm.title', 'LLM')}</div>
                                    <div className="ocr-tool-grid ocr-tool-grid-single">
                                        <label className="ocr-tool-field">
                                            <span>{t('settings.llm.entryName.label', 'Entry name')}</span>
                                            <div className="settings-tool-inline-row">
                                                <input list="settings-tool-llm-names" value={settings._selectedLlm || ''} onChange={(e) => updateField('_selectedLlm', e.target.value)} placeholder={t('settings.llm.entryName.placeholder', 'Select or type an entry name')} />
                                                <datalist id="settings-tool-llm-names">
                                                    {Object.keys(settings.llms || {}).map((name) => (
                                                        <option key={name} value={name} />
                                                    ))}
                                                </datalist>
                                                <button
                                                    type="button"
                                                    className="settings-tool-button settings-tool-button-secondary"
                                                    onClick={() => {
                                                        const name = String(settings._selectedLlm || '').trim();
                                                        if (!name) return;
                                                        if ((settings.llms || {})[name]) {
                                                            updateField('_selectedLlm', name);
                                                            return;
                                                        }
                                                        updateField('llms', {
                                                            ...(settings.llms || {}),
                                                            [name]: {
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
                                                            }
                                                        });
                                                        updateField('_selectedLlm', name);
                                                    }}
                                                >
                                                    {t('settings.llm.addButton', 'Add')}
                                                </button>
                                            </div>
                                            <small>{t('settings.llm.description', 'Manage named LLM presets and their shortcuts from one place.')}</small>
                                        </label>
                                    </div>
                                </section>

                                {currentLlmEntry && (
                                    <section className="ocr-tool-section">
                                        <div className="ocr-tool-section-title">{currentLlmName}</div>
                                        <div className="ocr-tool-grid">
                                            <label className="ocr-tool-field">
                                                <span>{t('settings.llm.apiTypeLabel', 'API type')}</span>
                                                <select
                                                    value={currentLlmEntry.apitype || 'ollama'}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        const patch = { apitype: value };
                                                        if (value === 'ollama' && (!currentLlmEntry.baseurl || !String(currentLlmEntry.baseurl).trim())) {
                                                            patch.baseurl = 'http://localhost:11434';
                                                        }
                                                        updateLlmEntry(currentLlmName, patch);
                                                    }}
                                                >
                                                    <option value="ollama">{t('settings.llm.apiTypeOptions.ollama', 'Ollama')}</option>
                                                    <option value="openapi">{t('settings.llm.apiTypeOptions.openapi', 'OpenAPI')}</option>
                                                </select>
                                            </label>

                                            <label className="ocr-tool-field">
                                                <span>{t('settings.llm.triggerTypeLabel', 'Trigger type')}</span>
                                                <select
                                                    value={currentLlmEntry.triggerType || 'text'}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        const patch = { triggerType: value };
                                                        if (value === 'text' && (!currentLlmEntry.prompt || !String(currentLlmEntry.prompt).trim())) {
                                                            patch.prompt = 'Summarize {{text}}';
                                                        }
                                                        if (value === 'image' && currentLlmEntry.prompt === 'Summarize {{text}}') {
                                                            patch.prompt = '';
                                                        }
                                                        updateLlmEntry(currentLlmName, patch);
                                                    }}
                                                >
                                                    <option value="text">{t('settings.llm.triggerTypeOptions.text', 'Text')}</option>
                                                    <option value="image">{t('settings.llm.triggerTypeOptions.image', 'Image')}</option>
                                                </select>
                                                <small>{t('settings.llm.triggerHelp', 'Choose whether this preset is used for text or image flows.')}</small>
                                            </label>

                                            <label className="ocr-tool-field">
                                                <span>{t('settings.llm.modelLabel', 'Model')}</span>
                                                <input type="text" value={currentLlmEntry.model || ''} onChange={(e) => updateLlmEntry(currentLlmName, { model: e.target.value })} />
                                            </label>

                                            <label className="ocr-tool-field">
                                                <span>{t('settings.llm.baseUrlLabel', 'Base URL')}</span>
                                                <input type="text" value={currentLlmEntry.baseurl || ''} placeholder="http://localhost:11434" onChange={(e) => updateLlmEntry(currentLlmName, { baseurl: e.target.value })} />
                                            </label>

                                            <label className="ocr-tool-field">
                                                <span>{t('settings.llm.apiKeyLabel', 'API key')}</span>
                                                <input type="password" value={currentLlmEntry.apikey || ''} onChange={(e) => updateLlmEntry(currentLlmName, { apikey: e.target.value })} />
                                            </label>

                                            <label className="ocr-tool-field">
                                                <span>{t('settings.llm.entryShortcutLabel', 'Entry shortcut')}</span>
                                                <ShortcutCapture value={currentLlmEntry.llmShortcut || ''} onChange={(value) => updateLlmEntry(currentLlmName, { llmShortcut: value })} placeholder={t('settings.llm.shortcutPlaceholder', 'Press a shortcut')} />
                                                <small>{t('settings.llm.shortcutHelp', 'Optional shortcut bound to this LLM preset.')}</small>
                                            </label>
                                        </div>

                                        <div className="ocr-tool-grid ocr-tool-grid-single">
                                            <label className="ocr-tool-field">
                                                <span>{t('settings.llm.promptLabel', 'Prompt')}</span>
                                                <textarea rows={4} value={currentLlmEntry.prompt || ''} onChange={(e) => updateLlmEntry(currentLlmName, { prompt: e.target.value })} placeholder={(currentLlmEntry.triggerType || 'text') === 'text' ? 'Summarize {{text}}' : ''} />
                                            </label>
                                        </div>

                                        <div className="settings-tool-llm-params-header">
                                            <div className="ocr-tool-section-title settings-tool-llm-params-title">{t('settings.llm.paramsTitle', 'Parameters')}</div>
                                            <button type="button" className="settings-tool-button settings-tool-button-ghost settings-tool-button-compact" onClick={() => setParamsExpanded((prev) => ({ ...prev, [currentLlmName]: !prev[currentLlmName] }))}>
                                                {paramsExpanded[currentLlmName] ? t('settings.llm.collapse', 'Collapse') : t('settings.llm.expand', 'Expand')}
                                            </button>
                                        </div>

                                        {paramsExpanded[currentLlmName] ? (
                                            <div className="ocr-tool-grid">
                                                <label className="ocr-tool-field">
                                                    <span>{t('settings.llm.temperature', 'Temperature')}</span>
                                                    <input type="number" min="0" max="2" step="0.01" value={typeof currentLlmEntry.temperature !== 'undefined' ? currentLlmEntry.temperature : 0.7} onChange={(e) => updateLlmEntry(currentLlmName, { temperature: parseFloat(e.target.value) || 0 })} />
                                                </label>
                                                <label className="ocr-tool-field">
                                                    <span>{t('settings.llm.topP', 'Top P')}</span>
                                                    <input type="number" min="0" max="1" step="0.01" value={typeof currentLlmEntry.top_p !== 'undefined' ? currentLlmEntry.top_p : 0.95} onChange={(e) => updateLlmEntry(currentLlmName, { top_p: parseFloat(e.target.value) || 0 })} />
                                                </label>
                                                <label className="ocr-tool-field">
                                                    <span>{t('settings.llm.topK', 'Top K')}</span>
                                                    <input type="number" min="0" step="1" value={typeof currentLlmEntry.top_k !== 'undefined' ? currentLlmEntry.top_k : 0.9} onChange={(e) => updateLlmEntry(currentLlmName, { top_k: parseFloat(e.target.value) || 0 })} />
                                                </label>
                                                <label className="ocr-tool-field">
                                                    <span>{t('settings.llm.contextWindow', 'Context window')}</span>
                                                    <input type="number" min="0" step="1" value={typeof currentLlmEntry.context_window !== 'undefined' ? currentLlmEntry.context_window : 32768} onChange={(e) => updateLlmEntry(currentLlmName, { context_window: parseInt(e.target.value, 10) || 0 })} />
                                                </label>
                                                <label className="ocr-tool-field">
                                                    <span>{t('settings.llm.maxTokens', 'Max tokens')}</span>
                                                    <input type="number" min="0" step="1" value={typeof currentLlmEntry.max_tokens !== 'undefined' ? currentLlmEntry.max_tokens : 32768} onChange={(e) => updateLlmEntry(currentLlmName, { max_tokens: parseInt(e.target.value, 10) || 0 })} />
                                                </label>
                                                <label className="ocr-tool-field">
                                                    <span>{t('settings.llm.minP', 'Min P')}</span>
                                                    <input type="number" min="0" max="1" step="0.01" value={typeof currentLlmEntry.min_p !== 'undefined' ? currentLlmEntry.min_p : 0.05} onChange={(e) => updateLlmEntry(currentLlmName, { min_p: parseFloat(e.target.value) || 0 })} />
                                                </label>
                                                <label className="ocr-tool-field">
                                                    <span>{t('settings.llm.presencePenalty', 'Presence penalty')}</span>
                                                    <input type="number" min="-2" max="2" step="0.1" value={typeof currentLlmEntry.presence_penalty !== 'undefined' ? currentLlmEntry.presence_penalty : 1.1} onChange={(e) => updateLlmEntry(currentLlmName, { presence_penalty: parseFloat(e.target.value) || 0 })} />
                                                </label>
                                            </div>
                                        ) : (
                                            <div className="settings-tool-selected-hint">{t('settings.llm.paramsCollapsed', 'Advanced parameters are collapsed.')}</div>
                                        )}

                                        <div className="settings-tool-inline-actions">
                                            <button
                                                type="button"
                                                className="settings-tool-button settings-tool-button-danger"
                                                onClick={() => {
                                                    if (!window.confirm(t('settings.llm.deleteConfirm', `Delete ${currentLlmName}?`, { name: currentLlmName }))) {
                                                        return;
                                                    }
                                                    const nextLlms = { ...(settings.llms || {}) };
                                                    delete nextLlms[currentLlmName];
                                                    updateField('llms', nextLlms);
                                                    updateField('_selectedLlm', pickSelectedLlm(nextLlms, ''));
                                                }}
                                            >
                                                {t('settings.llm.delete', 'Delete')}
                                            </button>
                                            <span className="settings-tool-selected-hint">{t('settings.llm.saveNote', 'Save to persist your LLM changes.')}</span>
                                        </div>
                                    </section>
                                )}
                            </>
                        )}
                    </div>

                    <div className="ocr-tool-actions settings-tool-footer">
                        <div className="settings-tool-footer-copy">
                            <strong>{statusTitle}</strong>
                            <span>{statusText}</span>
                        </div>
                        <div className="ocr-tool-action-buttons settings-tool-action-buttons">
                            <button type="button" className="settings-tool-button settings-tool-button-secondary" onClick={() => Promise.allSettled([loadSettings(), loadRuntimeInfo()])} disabled={saving || runtimeLoading || runtimeApplying}>
                                {dirty ? t('settings.ocr.toolWindowDiscard', 'Discard changes') : t('settings.ocr.toolWindowReload', 'Reload')}
                            </button>
                            <button type="button" className="settings-tool-button settings-tool-button-primary" onClick={handleSave} disabled={loading || saving || !dirty}>
                                {saving ? t('settings.ocr.toolWindowSaving', 'Saving...') : t('settings.ocr.toolWindowApply', 'Save and apply')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default SettingsToolWindow;
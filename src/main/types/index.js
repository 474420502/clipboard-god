/**
 * 应用类型定义
 * 定义应用中使用的所有接口和数据类型
 */

/**
 * 剪贴板项目类型
 */
class ClipboardItem {
    constructor(data) {
        this.id = data.id;
        this.content = data.content;
        this.type = data.type; // 'text', 'image'
        this.timestamp = data.timestamp;
        this.pinned = data.pinned || false;
        this.size = data.size || 0;
        this.imagePath = data.imagePath || null;
    }
}

/**
 * AI配置类型
 */
class AIConfig {
    constructor(data) {
        this.llmKey = data.llmKey;
        this.api = {
            type: data.api?.type || 'ollama',
            model: data.api?.model || '',
            baseUrl: data.api?.baseUrl || '',
            apiKey: data.api?.apiKey || ''
        };
        this.initialPrompt = data.initialPrompt || '';
        this.llmParams = {
            temperature: data.llmParams?.temperature || 0.7,
            top_p: data.llmParams?.top_p || 0.95,
            top_k: data.llmParams?.top_k || 0.9,
            context_window: data.llmParams?.context_window || 32768,
            max_tokens: data.llmParams?.max_tokens || 32768,
            presence_penalty: data.llmParams?.presence_penalty || 1.0
        };
        this.initialImages = data.initialImages || [];
    }
}

/**
 * 应用配置类型
 */
class AppConfig {
    constructor(data) {
        this.maxHistoryItems = data.maxHistoryItems || 500;
        this.globalShortcut = data.globalShortcut || 'CommandOrControl+Alt+V';
        this.screenshotShortcut = data.screenshotShortcut || 'CommandOrControl+Shift+S';
        this.launchOnStartup = data.launchOnStartup || false;
        this.enableTooltips = data.enableTooltips !== false;
        this.locale = data.locale || 'en';
        this.llms = data.llms || {};
        this.theme = data.theme || 'default';
        this.previewLength = data.previewLength || 120;
    }
}

/**
 * 窗口配置类型
 */
class WindowConfig {
    constructor(data) {
        this.width = data.width || 400;
        this.height = data.height || 600;
        this.show = data.show || false;
        this.frame = data.frame !== false;
        this.resizable = data.resizable !== false;
        this.alwaysOnTop = data.alwaysOnTop || false;
        this.focusable = data.focusable !== false;
        this.skipTaskbar = data.skipTaskbar || false;
        this.transparent = data.transparent || false;
    }
}

/**
 * 事件监听器类型
 */
class EventListener {
    constructor(event, handler) {
        this.event = event;
        this.handler = handler;
    }
}

/**
 * 应用状态类型
 */
class AppState {
    constructor() {
        this.current = 'initializing';
        this.isPasting = false;
        this.isExiting = false;
        this.isInitialized = false;
    }
}

/**
 * 快捷键注册信息
 */
class ShortcutRegistration {
    constructor(shortcut, name) {
        this.shortcut = shortcut;
        this.name = name;
        this.isRegistered = false;
    }
}

/**
 * Tooltip载荷类型
 */
class TooltipPayload {
    constructor(data) {
        this.content = data.content || '';
        this.anchorRect = data.anchorRect || {};
        this.isHtml = data.isHtml || false;
    }
}

/**
 * 错误类型定义
 */
class AppError extends Error {
    constructor(message, code, type = 'general') {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.type = type;
    }
}

/**
 * IPC消息类型
 */
class IPCMessage {
    constructor(channel, data) {
        this.channel = channel;
        this.data = data;
        this.timestamp = Date.now();
    }
}

/**
 * 数据库操作结果类型
 */
class DatabaseResult {
    constructor(success, data = null, error = null) {
        this.success = success;
        this.data = data;
        this.error = error;
    }
}

/**
 * 存储项目类型
 */
class StorageItem {
    constructor(data) {
        this.id = data.id;
        this.dbId = data.dbId;
        this.content = data.content;
        this.type = data.type;
        this.timestamp = data.timestamp;
        this.pinned = data.pinned;
        this.size = data.size;
        this.imagePath = data.imagePath;
    }
}

module.exports = {
    ClipboardItem,
    AIConfig,
    AppConfig,
    WindowConfig,
    EventListener,
    AppState,
    ShortcutRegistration,
    TooltipPayload,
    AppError,
    IPCMessage,
    DatabaseResult,
    StorageItem
};

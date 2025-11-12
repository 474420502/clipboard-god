/**
 * IPC通信处理器
 * 统一管理主进程与渲染进程之间的通信
 */

const { ipcMain } = require('electron');
const { IPC_CHANNELS } = require('../constants');
const { IPCMessage, DatabaseResult } = require('../types');
const errorHandler = require('./errorHandler');

class IPCManager {
    constructor() {
        this.handlers = new Map();
        this.messageHistory = [];
        this.maxHistorySize = 1000;
    }

    /**
     * 注册IPC处理器
     */
    registerHandler(channel, handler, context = '') {
        try {
            if (this.handlers.has(channel)) {
                errorHandler.safeConsole.warn(`IPC处理器已存在: ${channel}`);
                return false;
            }

            this.handlers.set(channel, {
                handler,
                context,
                registeredAt: new Date().toISOString()
            });

            errorHandler.safeConsole.log(`IPC处理器注册成功: ${channel}`);
            return true;
        } catch (error) {
            errorHandler.handleError(error, `注册IPC处理器: ${channel}`);
            return false;
        }
    }

    /**
     * 注销IPC处理器
     */
    unregisterHandler(channel) {
        try {
            if (this.handlers.has(channel)) {
                this.handlers.delete(channel);
                errorHandler.safeConsole.log(`IPC处理器已注销: ${channel}`);
                return true;
            }
            return false;
        } catch (error) {
            errorHandler.handleError(error, `注销IPC处理器: ${channel}`);
            return false;
        }
    }

    /**
     * 初始化所有IPC处理器
     */
    initializeHandlers(mainWindow, clipboardManager, trayManager, screenshotManager, config) {
        try {
            // 剪贴板相关IPC
            this.registerClipboardHandlers(mainWindow, clipboardManager);

            // 设置相关IPC
            this.registerSettingHandlers(mainWindow, config);

            // 粘贴相关IPC
            this.registerPasteHandlers(mainWindow, clipboardManager);

            // 截图相关IPC
            this.registerScreenshotHandlers(mainWindow, screenshotManager, clipboardManager);

            // 编辑和固定功能IPC
            this.registerEditHandlers(mainWindow, clipboardManager);

            // Tooltip相关IPC
            this.registerTooltipHandlers(mainWindow);

            // 文件操作IPC
            this.registerFileHandlers(mainWindow);

            // 通知IPC
            this.registerNotificationHandlers(mainWindow);

            // AI相关IPC
            this.registerAIHandlers();

            // 国际化IPC
            this.registerLocaleHandlers(mainWindow, config);

            errorHandler.safeConsole.log('所有IPC处理器初始化完成');
        } catch (error) {
            errorHandler.handleError(error, '初始化IPC处理器');
            throw error;
        }
    }

    /**
     * 注册剪贴板相关IPC处理器
     */
    registerClipboardHandlers(mainWindow, clipboardManager) {
        // 获取历史记录
        this.registerHandler(IPC_CHANNELS.GET_HISTORY, (event) => {
            errorHandler.safeConsole.log('收到获取历史记录请求');
            event.reply(IPC_CHANNELS.HISTORY_DATA, clipboardManager.getHistory());
        }, '获取历史记录');

        // 监听剪贴板变化
        if (mainWindow && clipboardManager) {
            clipboardManager.addListener((history) => {
                if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send(IPC_CHANNELS.UPDATE_HISTORY, history);
                }
            });
        }
    }

    /**
     * 注册设置相关IPC处理器
     */
    registerSettingHandlers(mainWindow, config) {
        // 获取设置
        this.registerHandler(IPC_CHANNELS.GET_SETTINGS, async () => {
            const settings = config.getAll();
            errorHandler.safeConsole.log('获取设置:', settings);
            return settings;
        }, '获取设置');

        // 保存设置
        this.registerHandler(IPC_CHANNELS.SET_SETTINGS, async (event, values) => {
            errorHandler.safeConsole.log('保存设置 (原始):', values);

            try {
                // 规范化配置
                const toSave = this.normalizeConfig(values);
                const oldConfig = config.getAll();
                const result = await config.setMany(toSave);

                if (result.success) {
                    errorHandler.safeConsole.log('设置保存成功');
                    if (mainWindow && mainWindow.webContents) {
                        mainWindow.webContents.send(IPC_CHANNELS.SETTINGS_UPDATED, {
                            success: true,
                            config: result.config
                        });
                    }
                } else {
                    errorHandler.safeConsole.error('设置保存失败:', result.error);
                    if (mainWindow && mainWindow.webContents) {
                        mainWindow.webContents.send(IPC_CHANNELS.SETTINGS_UPDATED, {
                            success: false,
                            error: result.error
                        });
                    }
                }

                return result;
            } catch (error) {
                errorHandler.handleError(error, '保存设置');
                if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send(IPC_CHANNELS.SETTINGS_SAVE_ERROR, error.message);
                }
                return { success: false, error: error.message };
            }
        }, '保存设置');
    }

    /**
     * 注册粘贴相关IPC处理器
     */
    registerPasteHandlers(mainWindow, clipboardManager) {
        this.registerHandler(IPC_CHANNELS.PASTE_ITEM, async (event, item) => {
            errorHandler.safeConsole.log('粘贴项目:', item);

            // 简单的重复粘贴防护
            const now = Date.now();
            if (clipboardManager._lastPaste &&
                clipboardManager._lastPaste.id === item.id &&
                (now - clipboardManager._lastPaste.time) < 1000) {
                errorHandler.safeConsole.log('忽略重复粘贴请求:', item.id);
                return;
            }

            try {
                clipboardManager._lastPaste = { id: item.id, time: now };
                const PasteHandler = require('../pasteHandler');

                await PasteHandler.writeAndPaste(item);
                errorHandler.safeConsole.log('粘贴操作完成');
            } catch (error) {
                errorHandler.handleError(error, '粘贴操作');
                if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send(IPC_CHANNELS.ERROR, error.message);
                }
            }
        }, '粘贴项目');

        this.registerHandler(IPC_CHANNELS.HIDE_WINDOW, () => {
            errorHandler.safeConsole.log('收到隐藏窗口请求');
            if (mainWindow) {
                mainWindow.hide();
            }
        }, '隐藏窗口');
    }

    /**
     * 注册截图相关IPC处理器
     */
    registerScreenshotHandlers(mainWindow, screenshotManager, clipboardManager) {
        this.registerHandler(IPC_CHANNELS.START_SCREENSHOT, async () => {
            try {
                if (!screenshotManager) {
                    return { success: false, error: 'ScreenshotManager not initialized' };
                }

                screenshotManager.startScreenshot();
                return { success: true };
            } catch (error) {
                errorHandler.handleError(error, '启动截图');
                return { success: false, error: error.message };
            }
        }, '启动截图');

        this.registerHandler(IPC_CHANNELS.DOWNLOAD_IMAGE, async (event, imagePath) => {
            try {
                return await this.handleImageDownload(imagePath);
            } catch (error) {
                errorHandler.handleError(error, '下载图片');
                return { success: false, error: error.message };
            }
        }, '下载图片');

        this.registerHandler(IPC_CHANNELS.OPEN_IMAGE, async (event, imagePath) => {
            try {
                return await this.handleImageOpen(imagePath);
            } catch (error) {
                errorHandler.handleError(error, '打开图片');
                return { success: false, error: error.message };
            }
        }, '打开图片');
    }

    /**
     * 注册编辑和固定功能IPC处理器
     */
    registerEditHandlers(mainWindow, clipboardManager) {
        this.registerHandler(IPC_CHANNELS.EDIT_ITEM, async (event, { dbId, newContent }) => {
            try {
                if (!dbId) {
                    return { success: false, error: 'no-id' };
                }

                const ok = clipboardManager.updateTextItem(dbId, newContent);
                return { success: !!ok };
            } catch (error) {
                errorHandler.handleError(error, '编辑项目');
                return { success: false, error: error.message };
            }
        }, '编辑项目');

        this.registerHandler(IPC_CHANNELS.PIN_ITEM, async (event, { dbId, pinned }) => {
            try {
                if (!dbId) {
                    return { success: false, error: 'no-id' };
                }

                const ok = clipboardManager.setPinned(dbId, !!pinned);
                return { success: !!ok };
            } catch (error) {
                errorHandler.handleError(error, '固定项目');
                return { success: false, error: error.message };
            }
        }, '固定项目');
    }

    /**
     * 注册Tooltip相关IPC处理器
     */
    registerTooltipHandlers(mainWindow) {
        this.registerHandler(IPC_CHANNELS.SHOW_TOOLTIP, (event, payload) => {
            // 转发给主进程处理
            if (mainWindow && mainWindow._ipcHandleShowTooltip) {
                mainWindow._ipcHandleShowTooltip(payload);
            }
        }, '显示Tooltip');

        this.registerHandler(IPC_CHANNELS.HIDE_TOOLTIP, (event) => {
            // 转发给主进程处理
            if (mainWindow && mainWindow._ipcHandleHideTooltip) {
                mainWindow._ipcHandleHideTooltip();
            }
        }, '隐藏Tooltip');
    }

    /**
     * 注册文件操作IPC处理器
     */
    registerFileHandlers(mainWindow) {
        // 图片下载处理（已在截图处理器中处理）
        // 图片打开处理（已在截图处理器中处理）
    }

    /**
     * 注册通知IPC处理器
     */
    registerNotificationHandlers(mainWindow) {
        this.registerHandler(IPC_CHANNELS.SHOW_NOTIFICATION, async (event, payload) => {
            try {
                const { title = '', body = '' } = payload || {};
                const { Notification } = require('electron');
                const notif = new Notification({ title: String(title), body: String(body) });
                notif.show();
                return { success: true };
            } catch (error) {
                errorHandler.handleError(error, '显示通知');
                return { success: false, error: error.message };
            }
        }, '显示通知');
    }

    /**
     * 注册AI相关IPC处理器
     */
    registerAIHandlers() {
        this.registerHandler(IPC_CHANNELS.AI_GET_CONFIG, async (event) => {
            // 转发给主进程AI配置处理
            if (event.sender && event.sender._aiConfig) {
                return event.sender._aiConfig;
            }
            return null;
        }, '获取AI配置');
    }

    /**
     * 注册国际化IPC处理器
     */
    registerLocaleHandlers(mainWindow, config) {
        // 获取locale
        this.registerHandler(IPC_CHANNELS.GET_LOCALE, async () => {
            try {
                const persisted = config.get('locale');
                if (persisted) return persisted;

                const { app } = require('electron');
                return (app && typeof app.getLocale === 'function') ? app.getLocale() : 'en';
            } catch (error) {
                return 'en';
            }
        }, '获取语言设置');

        // 设置locale
        this.registerHandler(IPC_CHANNELS.SET_LOCALE, async (event, locale) => {
            try {
                await config.set('locale', locale);

                // 广播到所有窗口
                const wins = require('electron').BrowserWindow.getAllWindows();
                wins.forEach(w => {
                    try {
                        w.webContents.send(IPC_CHANNELS.LOCALE_CHANGED, locale);
                    } catch (e) { }
                });

                return { success: true };
            } catch (error) {
                errorHandler.handleError(error, '设置语言');
                return { success: false, error: error.message };
            }
        }, '设置语言');

        // 获取翻译
        this.registerHandler(IPC_CHANNELS.GET_TRANSLATIONS, async (event, locale) => {
            try {
                return await this.loadTranslations(locale);
            } catch (error) {
                errorHandler.handleError(error, '加载翻译');
                return null;
            }
        }, '获取翻译');
    }

    /**
     * 规范化配置数据
     */
    normalizeConfig(values) {
        const toSave = { ...values };

        if (toSave.llms && typeof toSave.llms === 'object') {
            const normalized = {};
            for (const [name, entry] of Object.entries(toSave.llms)) {
                if (!entry || typeof entry !== 'object') {
                    normalized[name] = entry;
                    continue;
                }

                const copy = { ...entry };
                if (!copy.triggerType || String(copy.triggerType).trim() === '') {
                    copy.triggerType = 'text';
                }
                normalized[name] = copy;
            }
            toSave.llms = normalized;
        }

        return toSave;
    }

    /**
     * 加载翻译文件
     */
    async loadTranslations(locale) {
        const path = require('path');
        const fs = require('fs');
        const { app } = require('electron');

        let localesDir;
        if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
            const projectRoot = path.resolve(__dirname, '..', '..');
            localesDir = path.join(projectRoot, 'locales');
        } else {
            localesDir = path.join(process.resourcesPath, 'locales');
            if (!fs.existsSync(localesDir)) {
                localesDir = path.join(app.getAppPath(), 'locales');
            }
        }

        const tryList = [];
        if (locale) tryList.push(locale);
        if (locale && locale.indexOf('-') !== -1) {
            tryList.push(locale.split('-')[0]);
        }
        tryList.push('en');

        for (const l of tryList) {
            const candidate = path.join(localesDir, `${l}.json`);
            if (fs.existsSync(candidate)) {
                try {
                    const txt = fs.readFileSync(candidate, 'utf8');
                    return JSON.parse(txt);
                } catch (e) {
                    continue;
                }
            }
        }

        return null;
    }

    /**
     * 处理图片下载
     */
    async handleImageDownload(imagePath) {
        const fs = require('fs');
        const { app, dialog } = require('electron');

        if (!imagePath) return { success: false, error: 'no-path' };

        const src = String(imagePath).replace(/^file:\/\//, '');
        if (!fs.existsSync(src)) {
            return { success: false, error: 'not-found' };
        }

        let defaultDir = '';
        try {
            defaultDir = app.getPath('downloads');
        } catch (err) {
            defaultDir = app.getPath('home');
        }

        const baseName = path.basename(src);
        const defaultPath = defaultDir ? path.join(defaultDir, baseName) : baseName;

        const { canceled, filePath } = await dialog.showSaveDialog({
            title: 'Save Image',
            defaultPath,
            filters: [
                { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (canceled || !filePath) {
            return { success: false, canceled: true };
        }

        await fs.promises.copyFile(src, filePath);
        return { success: true, path: filePath };
    }

    /**
     * 处理图片打开
     */
    async handleImageOpen(imagePath) {
        if (!imagePath) return { success: false, error: 'no-path' };

        const src = String(imagePath).replace(/^file:\/\//, '');
        const { shell } = require('electron');

        try {
            const res = await shell.openPath(src);
            if (res) {
                return { success: false, error: res };
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 清理资源
     */
    cleanup() {
        try {
            this.handlers.clear();
            this.messageHistory = [];
            errorHandler.safeConsole.log('IPC管理器清理完成');
        } catch (error) {
            errorHandler.handleError(error, '清理IPC管理器');
        }
    }

    /**
     * 获取消息历史
     */
    getMessageHistory() {
        return [...this.messageHistory];
    }
}

module.exports = IPCManager;

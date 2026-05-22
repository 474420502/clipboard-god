const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const MainProcess = require('./src/main/mainProcess.js');
const resourceManager = require('./src/main/core/resourceManager');

// 主进程实例
const mainProcess = new MainProcess();

// 优雅关闭标志
let isShuttingDown = false;

// Disable Chromium sandbox in AppImage builds where the setuid helper cannot be used
if (process.platform === 'linux' && process.env.APPIMAGE) {
    console.warn('Detected AppImage runtime, launching Electron without sandbox');
    app.commandLine.appendSwitch('no-sandbox');
}

function createWindow() {
    mainProcess.createWindow();
    setupRendererCaptureProbe();

    // 加载文件
    if (process.env.VITE_DEV_SERVER_URL) {
        mainProcess.mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
        mainProcess.mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
    }
}

function setupRendererCaptureProbe() {
    const capturePath = process.env.CLIPBOARD_GOD_CAPTURE_PATH || '';
    const wantsProbe = process.env.CLIPBOARD_GOD_CAPTURE_PROBE === '1' || !!capturePath;
    if (!wantsProbe) return;

    const captureWindowTarget = String(process.env.CLIPBOARD_GOD_CAPTURE_WINDOW || 'main').trim().toLowerCase();
    const targetWindow = captureWindowTarget === 'ocr-settings'
        ? mainProcess.openOcrSettingsWindow()
        : mainProcess.mainWindow;
    if (!targetWindow || targetWindow.isDestroyed() || !targetWindow.webContents) return;

    targetWindow.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
            try {
                try { targetWindow.show(); } catch (_) { }
                try { targetWindow.focus(); } catch (_) { }
                try { targetWindow.moveTop(); } catch (_) { }

                await targetWindow.webContents.executeJavaScript(`new Promise((resolve) => {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => setTimeout(resolve, 150));
                    });
                })`);

                const probeData = await targetWindow.webContents.executeJavaScript(`(() => {
                    const root = document.getElementById('root');
                    const appContainer = document.querySelector('.app-container');
                    const ocrToolWindow = document.querySelector('.ocr-tool-window');
                    const ocrToolButtons = Array.from(document.querySelectorAll('.ocr-tool-action-buttons .btn'));
                    const emptyState = document.querySelector('.empty-state');
                    const historyItems = Array.from(document.querySelectorAll('.history-item'));
                    const ocrSections = Array.from(document.querySelectorAll('.ocr-tool-section'));
                    const rectToObject = (rect) => ({
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    });
                    return {
                        title: document.title,
                        bodyTextLength: document.body ? document.body.innerText.length : 0,
                        bodyTextPreview: document.body ? document.body.innerText.slice(0, 240) : '',
                        search: window.location.search || '',
                        rootChildCount: root ? root.children.length : -1,
                        appContainerRect: appContainer ? rectToObject(appContainer.getBoundingClientRect()) : null,
                        ocrToolWindowRect: ocrToolWindow ? rectToObject(ocrToolWindow.getBoundingClientRect()) : null,
                        historyItemCount: historyItems.length,
                        ocrSectionCount: ocrSections.length,
                        ocrToolButtonCount: ocrToolButtons.length,
                        ocrToolButtonTexts: ocrToolButtons.map((button) => ({
                            text: (button.innerText || '').trim(),
                            disabled: !!button.disabled,
                            rect: rectToObject(button.getBoundingClientRect())
                        })),
                        firstHistoryText: historyItems.slice(0, 3).map((item) => item.innerText.slice(0, 120)),
                        firstOcrSectionText: ocrSections.slice(0, 3).map((item) => item.innerText.slice(0, 120)),
                        emptyStateText: emptyState ? emptyState.innerText : '',
                        background: document.body ? getComputedStyle(document.body).backgroundColor : '',
                        visible: document.visibilityState,
                        focused: document.hasFocus()
                    };
                })()`);
                console.log('CLIPBOARD_GOD_CAPTURE_PROBE', JSON.stringify(probeData));

                if (capturePath) {
                    const image = await targetWindow.webContents.capturePage();
                    fs.writeFileSync(capturePath, image.toPNG());
                    console.log('CLIPBOARD_GOD_CAPTURE_WRITTEN', capturePath);
                }
            } catch (error) {
                console.error('CLIPBOARD_GOD_CAPTURE_FAILED', error && error.stack ? error.stack : error);
            }
        }, 800);
    });
}

// 改进的优雅关闭处理函数 - 优先处理X11连接
async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`收到信号 ${signal}，开始优雅关闭...`);

    try {
        // 第一步：优先清理X11相关资源
        console.log('第一步：清理X11连接...');
        if (resourceManager && resourceManager.hasX11Resources) {
            resourceManager.forceCleanupX11();
        }

        // 第二步：使用资源管理器清理所有资源
        console.log('第二步：清理所有资源...');
        if (resourceManager && resourceManager.cleanupAllResources) {
            await resourceManager.cleanupAllResources({
                force: false,
                timeout: 3000
            });
        }

        // 第三步：通知主进程执行清理
        console.log('第三步：执行主进程清理...');
        if (mainProcess && typeof mainProcess.cleanup === 'function') {
            try {
                await Promise.race([
                    Promise.resolve(mainProcess.cleanup()),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('主进程清理超时')), 2000)
                    )
                ]);
            } catch (error) {
                console.warn('主进程清理超时或失败:', error.message);
            }
        }

        console.log('优雅关闭完成');

    } catch (error) {
        console.error('优雅关闭过程中发生错误:', error);
    } finally {
        // 确保应用退出
        setTimeout(() => {
            console.log('强制退出应用');
            process.exit(0);
        }, 500);
    }
}

// 注册信号监听器
function setupSignalHandlers() {
    if (process.platform !== 'linux' && process.platform !== 'darwin') {
        return; // 信号监听主要针对类Unix系统
    }

    try {
        // 处理SIGTERM信号 (优雅关闭请求)
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

        // 处理SIGINT信号 (Ctrl+C)
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        // 处理SIGUSR1和SIGUSR2信号 (用户自定义)
        process.on('SIGUSR1', () => gracefulShutdown('SIGUSR1'));
        process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));

        console.log('信号监听器已注册: SIGTERM, SIGINT, SIGUSR1, SIGUSR2');
    } catch (error) {
        console.warn('注册信号监听器失败:', error);
    }
}

app.whenReady().then(() => {
    // 在应用准备好后立即设置信号监听
    setupSignalHandlers();

    mainProcess.initialize();
    setupRendererCaptureProbe();

    // 加载文件
    if (process.env.VITE_DEV_SERVER_URL) {
        mainProcess.mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
        mainProcess.mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
    }
});

app.on('window-all-closed', () => {
    // 对于系统托盘应用，不应该在窗口关闭时退出应用
    // 让应用继续在后台运行，用户可以通过托盘图标重新打开窗口
    if (!isShuttingDown) {
        console.log('所有窗口已关闭，应用继续在后台运行');
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('before-quit', async (event) => {
    // 如果正在关闭过程中，阻止重复关闭
    if (isShuttingDown) {
        return;
    }

    console.log('应用即将退出，开始资源清理...');
    event.preventDefault(); // 阻止默认行为，使用我们的清理流程

    try {
        await gracefulShutdown('BEFORE_QUIT');
    } catch (error) {
        console.error('before-quit清理失败:', error);
    }
});

app.on('will-quit', (event) => {
    // 如果正在关闭过程中，阻止默认行为
    if (isShuttingDown) {
        return;
    }

    // 防止其他代码阻止关闭
    event.preventDefault();

    console.log('开始强制关闭流程...');

    // 设置超时，如果清理时间过长则强制退出
    setTimeout(() => {
        console.log('清理超时，强制退出');
        process.exit(0);
    }, 5000); // 5秒超时

    // 如果主进程有清理方法，执行清理
    if (mainProcess.cleanup) {
        try {
            mainProcess.cleanup();
        } catch (error) {
            console.error('清理资源时发生错误:', error);
        }
    }

    // 延迟一点时间再退出，确保资源清理完成
    setTimeout(() => {
        process.exit(0);
    }, 100);
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
    if (!isShuttingDown) {
        gracefulShutdown('UNCAUGHT_EXCEPTION');
    }
});

// 处理未处理的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
    if (!isShuttingDown) {
        gracefulShutdown('UNHANDLED_REJECTION');
    }
});

const { app, BrowserWindow } = require('electron');
const path = require('path');
const MainProcess = require('./src/main/mainProcess.js');

// 主进程实例
const mainProcess = new MainProcess();

function createWindow() {
    mainProcess.createWindow();

    // 在开发模式下加载 Vite 开发服务器的 URL
    if (process.env.VITE_DEV_SERVER_URL) {
        mainProcess.mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
        // 生产模式下加载构建后的 HTML
        mainProcess.mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
    }
}

app.whenReady().then(() => {
    createWindow();

    if (mainProcess.trayManager) {
        mainProcess.trayManager.createTray(mainProcess.mainWindow);
    }

    if (mainProcess.registerGlobalShortcuts) {
        mainProcess.registerGlobalShortcuts();
    }

    if (mainProcess.startClipboardMonitoring) {
        mainProcess.startClipboardMonitoring();
    }

    if (mainProcess.setupIpcHandlers) {
        mainProcess.setupIpcHandlers();
    }
});

app.on('window-all-closed', () => {
    // 对于系统托盘应用，不应该在窗口关闭时退出应用
    // 让应用继续在后台运行，用户可以通过托盘图标重新打开窗口
    console.log('所有窗口已关闭，应用继续在后台运行');
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('will-quit', () => {
    if (mainProcess.cleanup) {
        mainProcess.cleanup();
    }
});
const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');

// 安全的console包装器，防止EPIPE错误
const safeConsole = {
  log: (...args) => {
    try {
      if (process.stdout.writable) {
        console.log(...args);
      }
    } catch (error) {
      // 静默忽略EPIPE错误
    }
  },
  error: (...args) => {
    try {
      if (process.stderr.writable) {
        console.error(...args);
      }
    } catch (error) {
      // 静默忽略EPIPE错误
    }
  },
  warn: (...args) => {
    try {
      if (process.stderr.writable) {
        console.warn(...args);
      }
    } catch (error) {
      // 静默忽略EPIPE错误
    }
  }
};

class TrayManager {
  constructor() {
    this.tray = null;
  }

  // 创建系统托盘
  createTray(mainWindow, mainProcess) {
    let trayIcon = null;

    // 尝试使用自定义图标 — 尝试多个候选路径，覆盖打包和开发环境
    const candidates = [];
    try {
      // resourcesPath when packaged
      if (app && app.isPackaged) {
        candidates.push(path.join(process.resourcesPath || '', 'app', 'assets', 'icon.png'));
        candidates.push(path.join(process.resourcesPath || '', 'assets', 'icon.png'));
      }
    } catch (_) { }

    // standard dev location relative to source
    candidates.push(path.join(__dirname, '../../assets/icon.png'));
    candidates.push(path.join(__dirname, '../../../assets/icon.png'));
    // electron-builder may place files under dist-electron or linux-unpacked
    candidates.push(path.join(__dirname, '../../dist-electron/assets/icon.png'));

    // also try absolute path installed by packaging (hicolor path)
    candidates.push(path.join('/usr/share/icons/hicolor/64x64/apps/clipboard-god.png'));

    // dedupe
    const seen = new Set();
    const uniqCandidates = candidates.filter(p => p && !seen.has(p) && (seen.add(p) || true));

    try {
      console.log('托盘图标候选路径:', uniqCandidates);
      console.log('process.resourcesPath:', process.resourcesPath, 'app.isPackaged:', app && app.isPackaged);
      for (const c of uniqCandidates) {
        try {
          if (fs.existsSync(c)) {
            console.log('尝试加载托盘图标:', c);
            const ni = nativeImage.createFromPath(c);
            if (!ni.isEmpty()) {
              trayIcon = ni;
              console.log('找到有效托盘图标:', c);
              break;
            } else {
              console.warn('图标文件存在但 nativeImage 为空:', c);
            }
          } else {
            // not exists — continue
          }
        } catch (err) {
          console.warn('检查候选图标路径出错:', c, err && err.message);
        }
      }
    } catch (error) {
      console.error('加载托盘图标候选列表失败:', error && error.message);
    }

    // 如果找到了 trayIcon，调整大小
    if (trayIcon && !trayIcon.isEmpty()) {
      try {
        let targetSize;
        if (process.platform === 'darwin') targetSize = 18;
        else if (process.platform === 'win32') targetSize = 16;
        else targetSize = 22;
        trayIcon = trayIcon.resize({ width: targetSize, height: targetSize });
        console.log(`托盘图标加载成功，大小: ${targetSize}x${targetSize}`);
      } catch (err) {
        console.warn('调整托盘图标大小失败:', err && err.message);
      }
    }

    // 如果自定义图标加载失败，创建默认图标
    if (!trayIcon || trayIcon.isEmpty()) {
      console.log('使用默认托盘图标');
      trayIcon = this.createDefaultTrayIcon();
    }

    try {
      this.tray = new Tray(trayIcon);
      console.log('托盘创建成功');
    } catch (error) {
      console.error('创建托盘失败:', error);
      // 最后的备选方案
      this.tray = new Tray(nativeImage.createEmpty());
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '打开',
        click: () => {
          // Respect any temporary suppression (e.g., during paste we hide then paste)
          if (mainProcess && mainProcess._isPasting) {
            safeConsole.log('抑制托盘打开（正在执行粘贴）');
            return;
          }
          if (mainWindow) mainWindow.show();
        }
      },
      {
        label: '退出',
        click: () => {
          this.ClickQuit = true;
          require('electron').app.quit();
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
    this.tray.setToolTip('Clipboard God');

    // 点击托盘图标显示/隐藏窗口
    this.tray.on('click', () => {
      // If the mainWindow has requested suppression (e.g., during paste), ignore click toggles
      if (mainWindow && mainWindow.__suppressShow) {
        safeConsole.log('抑制托盘点击切换（正在执行粘贴）');
        return;
      }

      if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    });
  }

  // 创建默认托盘图标
  createDefaultTrayIcon() {
    try {
      // 创建一个简单的彩色图标作为备选
      let size;
      if (process.platform === 'darwin') {
        size = 18; // macOS
      } else if (process.platform === 'win32') {
        size = 16; // Windows
      } else {
        size = 22; // Linux
      }

      console.log(`创建默认托盘图标，大小: ${size}x${size}`);

      // 创建一个基本的彩色图标数据
      const buffer = Buffer.alloc(size * size * 4); // RGBA

      // 创建一个渐变背景
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = (y * size + x) * 4;
          // 从蓝色到深蓝色的渐变
          const factor = y / size;
          buffer[idx] = Math.floor(74 + (20 * factor));     // R
          buffer[idx + 1] = Math.floor(144 + (30 * factor)); // G
          buffer[idx + 2] = Math.floor(226 + (29 * factor)); // B
          buffer[idx + 3] = 255; // A (不透明)
        }
      }

      // 在图标中间画一个白色圆圈
      const centerX = size / 2;
      const centerY = size / 2;
      const radius = size / 3;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - centerX;
          const dy = y - centerY;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance <= radius) {
            const idx = (y * size + x) * 4;
            buffer[idx] = 255;     // R
            buffer[idx + 1] = 255; // G
            buffer[idx + 2] = 255; // B
            buffer[idx + 3] = 255; // A
          }
        }
      }

      return nativeImage.createFromBuffer(buffer, { width: size, height: size });
    } catch (error) {
      safeConsole.error('创建默认托盘图标失败:', error);
      // 如果连默认图标都创建失败，返回空图标
      return nativeImage.createEmpty();
    }
  }

  // 销毁托盘
  destroyTray() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = TrayManager;
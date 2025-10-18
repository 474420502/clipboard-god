const { Tray, Menu, nativeImage } = require('electron');
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

    // 尝试使用自定义图标
    const iconPath = path.join(__dirname, '../../assets/icon.png');

    try {
      if (fs.existsSync(iconPath)) {
        console.log('加载托盘图标:', iconPath);
        trayIcon = nativeImage.createFromPath(iconPath);

        // 确保图标不为空
        if (trayIcon.isEmpty()) {
          console.warn('托盘图标文件存在但为空，使用备选方案');
          trayIcon = null;
        } else {
          // 在不同操作系统上调整图标大小
          let targetSize;
          if (process.platform === 'darwin') {
            targetSize = 18; // macOS
          } else if (process.platform === 'win32') {
            targetSize = 16; // Windows
          } else {
            targetSize = 22; // Linux
          }
          trayIcon = trayIcon.resize({ width: targetSize, height: targetSize });
          console.log(`托盘图标加载成功，大小: ${targetSize}x${targetSize}`);
        }
      } else {
        console.warn('托盘图标文件不存在:', iconPath);
      }
    } catch (error) {
      console.error('加载托盘图标失败:', error.message);
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
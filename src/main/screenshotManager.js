const { clipboard, nativeImage, desktopCapturer } = require('electron');
let Screenshots;
try {
  Screenshots = require('electron-screenshots');
} catch (e) {
  Screenshots = null;
}

class ScreenshotManager {
  constructor(mainWindow, clipboardManager) {
    this.mainWindow = mainWindow;
    this.clipboardManager = clipboardManager;
    this.screenshots = null;
  }

  // 初始化截图功能
  init() {
    // 如果 electron-screenshots 不可用，则 fallback 到 desktopCapturer
    if (!Screenshots || typeof Screenshots !== 'function') {
      console.warn('electron-screenshots 模块不可用，使用 desktopCapturer 回退截图实现');
      this._useDesktopCapturer = true;
      return;
    }

    this.screenshots = new Screenshots({
      lang: {
        operation_cancel: '取消',
        operation_save: '保存',
        operation_redo: '撤销',
        operation_undo: '反撤销',
        operation_mosaic: '马赛克',
        operation_text: '文本',
        operation_rectangle: '矩形',
        operation_ellipse: '椭圆',
        operation_arrow: '箭头',
        operation_brush: '画笔',
        operation_finish: '完成'
      }
    });

    // 监听截图完成事件。我们使用一个可控的默认 handler（this._defaultOkHandler）
    // 当通过 captureImage() 发起的截图需要仅返回数据时，会临时抑制该 handler，
    // 避免把图像写入系统剪贴板或保存到历史。
    this._allowDefaultOk = true;
    this._defaultOkHandler = (event, buffer) => {
      if (!this._allowDefaultOk) return;
      this._processScreenshotBuffer(buffer, { writeToClipboard: true });
    };
    this.screenshots.on('ok', this._defaultOkHandler);

    // 监听取消事件
    this.screenshots.on('cancel', (event) => {
      console.log('截图已取消');
    });

    // 监听保存事件
    this.screenshots.on('save', (event, buffer) => {
      console.log('截图已保存到桌面');
    });
  }

  // 私有方法：处理截图缓冲区
  _processScreenshotBuffer(buffer, { writeToClipboard = true } = {}) {
    try {
      const image = nativeImage.createFromBuffer(buffer);
      if (image.isEmpty()) return;

      // Only write to system clipboard when explicitly requested.
      if (writeToClipboard) {
        try { clipboard.writeImage(image); } catch (_) { }

        const newItem = {
          id: Date.now(),
          type: 'image',
          content: image.toDataURL(),
          timestamp: new Date()
        };

        if (this.clipboardManager && typeof this.clipboardManager.addItem === 'function') {
          this.clipboardManager.addItem(newItem);
        }

        if (this.mainWindow && this.mainWindow.isVisible()) {
          this.mainWindow.hide();
        }
      }
      // If writeToClipboard is false, we still accept the buffer and the caller
      // will receive the base64 via captureImage(). Do not mutate clipboard or history here.
    } catch (error) {
      console.error('保存截图失败:', error);
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('error', error.message);
      }
    }
  }

  // 启动截图
  startScreenshot() {
    // 如果使用回退实现，则直接使用 desktopCapturer 捕获整个屏幕并写入剪贴板
    if (this._useDesktopCapturer) {
      // 异步获取屏幕缩略图（可以选择更高分辨率）
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
        .then(sources => {
          if (!sources || sources.length === 0) {
            throw new Error('未找到屏幕源');
          }
          // 选择第一个屏幕源作为截图
          const src = sources[0];
          const image = nativeImage.createFromDataURL(src.thumbnail.toDataURL());
          if (image && !image.isEmpty()) {
            this._processScreenshotBuffer(image.toPNG());
            console.log('desktopCapturer 截图并保存到剪贴板完成');
          }
        })
        .catch(err => {
          console.error('desktopCapturer 捕获失败:', err);
          if (this.mainWindow && this.mainWindow.webContents) this.mainWindow.webContents.send('error', err.message);
        });
      return;
    }

    if (!this.screenshots) {
      this.init();
    }

    // Ensure the default handler is enabled so the screenshot writes to clipboard/history
    try { this._allowDefaultOk = true; } catch (_) { }
    this.screenshots.startCapture();
  }

  // Capture a single screenshot and return a Promise resolving to { base64Full, base64Raw }
  captureImage(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      // If using desktopCapturer fallback, capture immediately and resolve
      if (this._useDesktopCapturer) {
        console.log('ScreenshotManager.captureImage: using desktopCapturer fallback');
        desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
          .then(sources => {
            if (!sources || sources.length === 0) return reject(new Error('未找到屏幕源'));
            const src = sources[0];
            const dataUrl = src.thumbnail.toDataURL();
            const base64Full = dataUrl;
            const base64Raw = dataUrl.split(',')[1];
            resolve({ base64Full, base64Raw });
          })
          .catch(err => reject(err));
        return;
      }

      // Otherwise use electron-screenshots which emits 'ok' with buffer
      try {
        if (!this.screenshots) this.init();

        let settled = false;
        // Temporarily disable the global ok handler so the capture only resolves via our
        // once('ok') listener and does not write to clipboard or history.
        try {
          console.log('ScreenshotManager.captureImage: disabling default ok handler');
          this._allowDefaultOk = false;
        } catch (_) { }
        const onOk = (_event, buffer) => {
          try {
            if (settled) return;
            settled = true;
            const image = nativeImage.createFromBuffer(buffer);
            const base64Full = image.toDataURL();
            const base64Raw = base64Full.split(',')[1];
            cleanup();
            // Restore default handler allowance after we processed the buffer
            try { console.log('ScreenshotManager.captureImage: restoring default ok handler'); this._allowDefaultOk = true; } catch (_) { }
            resolve({ base64Full, base64Raw });
          } catch (err) {
            cleanup();
            reject(err);
          }
        };

        const onCancel = () => {
          if (settled) return;
          settled = true;
          cleanup();
          try { this._allowDefaultOk = true; } catch (_) { }
          reject(new Error('截图已取消'));
        };

        const cleanup = () => {
          try { this.screenshots.removeListener('ok', onOk); } catch (_) { }
          try { this.screenshots.removeListener('cancel', onCancel); } catch (_) { }
        };

        this.screenshots.once('ok', onOk);
        this.screenshots.once('cancel', onCancel);

        // start capture UI
        this.screenshots.startCapture();

        // timeout guard
        const to = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error('截图超时'));
        }, timeoutMs);

      } catch (err) {
        reject(err);
      }
    });
  }
}

module.exports = ScreenshotManager;


const fs = require('fs');
const { clipboard, nativeImage, desktopCapturer } = require('electron');
let Screenshots;
try {
  const screenshotsModule = require('@474420502/electron-screenshots');
  Screenshots = screenshotsModule && screenshotsModule.default
    ? screenshotsModule.default
    : screenshotsModule;
} catch (e) {
  console.warn('加载 @474420502/electron-screenshots 失败，回退到 desktopCapturer:', e);
  Screenshots = null;
}

const OCR_LANGUAGE_LABELS = {
  chi_sim: '简中',
  chi_tra: '繁中',
  eng: 'EN',
  jpn: 'JP',
  kor: 'KR',
  deu: 'DE',
  fra: 'FR',
  spa: 'ES',
  por: 'PT',
  ita: 'IT',
  rus: 'RU',
  ara: 'AR',
  vie: 'VI',
  tha: 'TH',
  nld: 'NL',
  pol: 'PL'
};

const VISION_ACTION_ITEMS = {
  'vl-describe': {
    title: '解析当前截图',
    label: '解析图片',
    fileNamePrefix: 'vl-describe'
  },
  'vl-ocr': {
    title: '把图片转成文字',
    label: '转文字',
    fileNamePrefix: 'vl-ocr'
  },
  'vl-summary': {
    title: '总结当前图片',
    label: '总结',
    fileNamePrefix: 'vl-summary'
  },
  'vl-analyze': {
    title: '智能分析当前截图',
    label: '分析',
    fileNamePrefix: 'vl-analyze'
  }
};

class ScreenshotManager {
  constructor(mainWindow, clipboardManager, options = {}) {
    this.mainWindow = mainWindow;
    this.clipboardManager = clipboardManager;
    this.screenshots = null;
    this.options = options;
    this._useDesktopCapturer = false;
  }

  _emitError(error) {
    const message = error && error.message ? error.message : String(error || 'unknown-error');
    if (this.mainWindow && this.mainWindow.webContents) {
      this.mainWindow.webContents.send('error', message);
    }
  }

  _startDesktopCapturerScreenshot() {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
      .then(sources => {
        if (!sources || sources.length === 0) {
          throw new Error('未找到屏幕源');
        }
        const src = sources[0];
        const image = nativeImage.createFromDataURL(src.thumbnail.toDataURL());
        if (image && !image.isEmpty()) {
          this._processScreenshotBuffer(image.toPNG());
          console.log('desktopCapturer 截图并保存到剪贴板完成');
        }
      })
      .catch(err => {
        console.error('desktopCapturer 捕获失败:', err);
        this._emitError(err);
      });
  }

  _captureImageWithDesktopCapturer(resolve, reject) {
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
  }

  _getOcrLanguages() {
    if (!this.options || typeof this.options.getOcrLanguages !== 'function') {
      return [];
    }

    const languages = this.options.getOcrLanguages();
    if (!Array.isArray(languages)) {
      return [];
    }

    return languages.map((lang) => String(lang || '').trim()).filter(Boolean);
  }

  _getOcrLanguageSummary() {
    const languages = this._getOcrLanguages();
    if (!languages.length) {
      return '';
    }

    return languages
      .slice(0, 3)
      .map((lang) => OCR_LANGUAGE_LABELS[lang] || lang)
      .join('/');
  }

  _getOcrWindowTitle() {
    const summary = this._getOcrLanguageSummary();
    return summary ? `打开 OCR 窗口 (${summary})` : '打开 OCR 窗口';
  }

  _buildDefaultOperationItems() {
    return [
      {
        key: 'ocr',
        title: this._getOcrWindowTitle(),
        label: 'OCR',
        position: 'before-confirm',
        requiresSelection: true,
        includeImage: true,
        imageResource: {
          fileNamePrefix: 'ocr'
        },
        handler: async (context) => {
          await this._handleOcrOperation(context);
        }
      },
      {
        key: 'vl-describe',
        title: VISION_ACTION_ITEMS['vl-describe'].title,
        label: VISION_ACTION_ITEMS['vl-describe'].label,
        position: { after: 'ocr' },
        requiresSelection: true,
        includeImage: true,
        imageResource: {
          fileNamePrefix: VISION_ACTION_ITEMS['vl-describe'].fileNamePrefix
        },
        handler: async (context) => {
          await this._handleVisionOperation('vl-describe', context);
        }
      },
      {
        key: 'vl-ocr',
        title: VISION_ACTION_ITEMS['vl-ocr'].title,
        label: VISION_ACTION_ITEMS['vl-ocr'].label,
        position: { after: 'vl-describe' },
        requiresSelection: true,
        includeImage: true,
        imageResource: {
          fileNamePrefix: VISION_ACTION_ITEMS['vl-ocr'].fileNamePrefix
        },
        handler: async (context) => {
          await this._handleVisionOperation('vl-ocr', context);
        }
      },
      {
        key: 'vl-summary',
        title: VISION_ACTION_ITEMS['vl-summary'].title,
        label: VISION_ACTION_ITEMS['vl-summary'].label,
        position: { after: 'vl-ocr' },
        requiresSelection: true,
        includeImage: true,
        imageResource: {
          fileNamePrefix: VISION_ACTION_ITEMS['vl-summary'].fileNamePrefix
        },
        handler: async (context) => {
          await this._handleVisionOperation('vl-summary', context);
        }
      },
      {
        key: 'vl-analyze',
        title: VISION_ACTION_ITEMS['vl-analyze'].title,
        label: VISION_ACTION_ITEMS['vl-analyze'].label,
        position: { after: 'vl-summary' },
        requiresSelection: true,
        includeImage: true,
        imageResource: {
          fileNamePrefix: VISION_ACTION_ITEMS['vl-analyze'].fileNamePrefix
        },
        handler: async (context) => {
          await this._handleVisionOperation('vl-analyze', context);
        }
      }
    ];
  }

  async _setOperationItems(items) {
    if (!this.screenshots || typeof this.screenshots.setOperationItems !== 'function') {
      return;
    }

    await this.screenshots.setOperationItems(items);
  }

  async _handleOcrOperation(context) {
    try {
      if (context && typeof context.update === 'function') {
        await context.update({
          title: '打开中...',
          checked: true,
          disabled: true
        });
      }

      let buffer = context && context.buffer && Buffer.isBuffer(context.buffer)
        ? context.buffer
        : null;

      if (!buffer && context && context.imageResource && context.imageResource.filePath) {
        buffer = fs.readFileSync(context.imageResource.filePath);
      }

      if (!buffer || !Buffer.isBuffer(buffer)) {
        throw new Error('ocr-image-missing');
      }

      this._processScreenshotBuffer(buffer, { writeToClipboard: true });

      if (context && typeof context.endCapture === 'function') {
        await context.endCapture();
      } else if (this.screenshots && typeof this.screenshots.endCapture === 'function') {
        await this.screenshots.endCapture();
      }

      if (this.options && typeof this.options.openOcrWindow === 'function') {
        await Promise.resolve(this.options.openOcrWindow(buffer));
      }
    } catch (error) {
      if (context && typeof context.update === 'function') {
        await context.update({
          title: this._getOcrWindowTitle(),
          checked: false,
          disabled: false
        }).catch(() => { });
      }
      this._emitError(error);
    }
  }

  async _handleVisionOperation(actionId, context) {
    const action = VISION_ACTION_ITEMS[actionId] || VISION_ACTION_ITEMS['vl-describe'];

    try {
      if (context && typeof context.update === 'function') {
        await context.update({
          title: '打开中...',
          checked: true,
          disabled: true
        });
      }

      let buffer = context && context.buffer && Buffer.isBuffer(context.buffer)
        ? context.buffer
        : null;

      if (!buffer && context && context.imageResource && context.imageResource.filePath) {
        buffer = fs.readFileSync(context.imageResource.filePath);
      }

      if (!buffer || !Buffer.isBuffer(buffer)) {
        throw new Error('vision-image-missing');
      }

      this._processScreenshotBuffer(buffer, { writeToClipboard: true });

      if (context && typeof context.endCapture === 'function') {
        await context.endCapture();
      } else if (this.screenshots && typeof this.screenshots.endCapture === 'function') {
        await this.screenshots.endCapture();
      }

      if (this.options && typeof this.options.openVisionChat === 'function') {
        await Promise.resolve(this.options.openVisionChat({
          actionId,
          imageBuffer: buffer,
          mimeType: (context && context.imageResource && context.imageResource.mimeType) || 'image/png'
        }));
      }
    } catch (error) {
      if (context && typeof context.update === 'function') {
        await context.update({
          title: action.title,
          checked: false,
          disabled: false
        }).catch(() => { });
      }
      this._emitError(error);
    }
  }

  // 初始化截图功能
  init() {
    // 如果 @474420502/electron-screenshots 不可用，则 fallback 到 desktopCapturer
    if (!Screenshots || typeof Screenshots !== 'function') {
      console.warn('@474420502/electron-screenshots 模块不可用，使用 desktopCapturer 回退截图实现');
      this._useDesktopCapturer = true;
      return;
    }

    this.screenshots = new Screenshots({
      forwardEvents: ['error'],
      operationItems: this._buildDefaultOperationItems(),
      lang: {
        magnifier_position_label: '位置',
        operation_ok_title: '完成',
        operation_cancel_title: '取消',
        operation_save_title: '保存',
        operation_redo_title: '重做',
        operation_undo_title: '撤销',
        operation_mosaic_title: '马赛克',
        operation_text_title: '文本',
        operation_rectangle_title: '矩形',
        operation_ellipse_title: '椭圆',
        operation_arrow_title: '箭头',
        operation_brush_title: '画笔'
      }
    });

    // 监听截图完成事件。
    this._defaultOkHandler = (event, buffer) => {
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

    this.screenshots.on('error', (_event, rendererEvent) => {
      const payload = rendererEvent && rendererEvent.payload ? rendererEvent.payload : null;
      const message = payload && payload.message ? payload.message : 'screenshot-renderer-error';
      this._emitError(new Error(String(message)));
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
      this._startDesktopCapturerScreenshot();
      return;
    }

    if (!this.screenshots) {
      this.init();
    }

    if (this._useDesktopCapturer || !this.screenshots) {
      this._startDesktopCapturerScreenshot();
      return;
    }

    Promise.resolve(this._setOperationItems(this._buildDefaultOperationItems()))
      .catch((error) => this._emitError(error))
      .finally(() => {
        Promise.resolve(this.screenshots.startCapture())
          .catch((error) => this._emitError(error));
      });
  }

  async captureImage(timeoutMs = 30000) {
    if (this._useDesktopCapturer) {
      return new Promise((resolve, reject) => {
        this._captureImageWithDesktopCapturer(resolve, reject);
      });
    }

    if (!this.screenshots) {
      this.init();
    }

    if (this._useDesktopCapturer || !this.screenshots) {
      return new Promise((resolve, reject) => {
        this._captureImageWithDesktopCapturer(resolve, reject);
      });
    }

    if (typeof this.screenshots.captureOnce !== 'function') {
      throw new Error('screenshots-captureOnce-unavailable');
    }

    const result = await this.screenshots.captureOnce({ timeoutMs });
    return {
      base64Full: result.dataUrl,
      base64Raw: result.base64
    };
  }
}

module.exports = ScreenshotManager;


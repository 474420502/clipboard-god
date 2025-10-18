const { clipboard, app } = require('electron');
const SqliteStorage = require('./storage/sqliteStorage');

class ClipboardManager {
  constructor(options = {}) {
    this.history = [];
    this.listeners = [];

    // 最大历史条目数，默认 8000
    this.maxHistory = typeof options.maxHistory === 'number' ? options.maxHistory : 8000;

    // 初始化存储后端：使用 SqliteStorage
    this.storageBackend = new SqliteStorage({ maxHistory: this.maxHistory });
    // load history from db
    const rows = this.storageBackend.getHistory(this.maxHistory, 0);
    // convert to expected in-memory format
    this.history = rows.map(r => {
      if (r.type === 'text') return { id: r.id || Date.now(), type: 'text', content: r.content, timestamp: new Date(r.timestamp) };
      return { id: r.id || Date.now(), type: 'image', content: r.image_path || null, timestamp: new Date(r.timestamp), image_path: r.image_path };
    });
  }

  // 开始监控剪贴板
  startMonitoring() {
    this.checkClipboard();
    this.interval = setInterval(() => this.checkClipboard(), 1000);
  }

  // 停止监控剪贴板
  stopMonitoring() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  // 检查剪贴板内容变化
  checkClipboard() {
    try {
      const formats = clipboard.availableFormats();
      let newItem = null;

      // 检查是否有文本内容
      if (formats.includes('text/plain')) {
        const text = clipboard.readText();
        // 规范化行结束符：将 \r\n 和 \r 转换为 \n，避免在Linux终端显示 ^M
        const normalizedText = text ? text.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : '';
        if (normalizedText && (!this.history.length || this.history[0].type !== 'text' || this.history[0].content !== normalizedText)) {
          newItem = {
            id: Date.now(),
            type: 'text',
            content: normalizedText,
            timestamp: new Date()
          };
        }
      }
      // 检查是否有图像内容
      else if (formats.includes('image/png') || formats.includes('image/jpeg')) {
        const image = clipboard.readImage();
        if (!image.isEmpty()) {
          const imageData = image.toDataURL();
          if (!this.history.length || this.history[0].type !== 'image' || this.history[0].content !== imageData) {
            newItem = {
              id: Date.now(),
              type: 'image',
              content: imageData,
              timestamp: new Date()
            };
          }
        }
      }

      // 如果有新内容，则添加到历史记录
      if (newItem) {
        this.addItem(newItem);
        return true;
      }
    } catch (error) {
      console.error('检查剪贴板时出错:', error);
    }

    return false;
  }

  // 获取历史记录
  getHistory() {
    return this.history;
  }

  // 设置最大历史数
  setMaxHistory(n) {
    if (typeof n === 'number' && n > 0) {
      this.maxHistory = n;
      this.storageBackend.maxHistory = n; // 更新存储后端的 maxHistory
      // SqliteStorage 会自动处理修剪
    }
  }

  // 添加一项到历史，并负责裁剪、通知与持久化
  addItem(item) {
    try {
      // 简单防重复：如果与第一个相同则不插入
      if (this.history.length && this.history[0].type === item.type && this.history[0].content === item.content) {
        return false;
      }

      const info = this.storageBackend.addItem(item);
      // reload history from DB to reflect dedup/updated timestamps
      const rows = this.storageBackend.getHistory(this.maxHistory, 0);
      this.history = rows.map(r => {
        if (r.type === 'text') return { id: r.id || Date.now(), type: 'text', content: r.content, timestamp: new Date(r.timestamp) };
        return { id: r.id || Date.now(), type: 'image', content: r.image_path || null, timestamp: new Date(r.timestamp), image_path: r.image_path };
      });
      this.notifyListeners();
      return true;
    } catch (err) {
      console.error('添加历史项失败:', err);
      return false;
    }
  }

  // 添加监听器
  addListener(callback) {
    this.listeners.push(callback);
  }

  // 移除监听器
  removeListener(callback) {
    const index = this.listeners.indexOf(callback);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  // 通知所有监听者
  notifyListeners() {
    this.listeners.forEach(listener => listener(this.history));
  }
}

module.exports = ClipboardManager;


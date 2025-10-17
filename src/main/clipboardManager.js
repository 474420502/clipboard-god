const { clipboard, app } = require('electron');
const fs = require('fs');
const path = require('path');
let SqliteStorage;
try {
  SqliteStorage = require('./storage/sqliteStorage');
} catch (e) {
  SqliteStorage = null;
}

class ClipboardManager {
  constructor(options = {}) {
    this.history = [];
    this.listeners = [];

    // 最大历史条目数，默认 8000
    this.maxHistory = typeof options.maxHistory === 'number' ? options.maxHistory : 8000;

    // 存储目录：遵循 XDG 标准优先使用 XDG_CACHE_HOME，否则使用 ~/.cache
    const cacheBase = process.env.XDG_CACHE_HOME || path.join(require('os').homedir(), '.cache');
    this.storageDir = path.join(cacheBase, 'clipboard-god');
    this.storageFile = path.join(this.storageDir, 'history.json');

    // 初始化存储后端：优先 sqlite，否则使用 JSON 文件
    this._ensureStorageDir();
    this.storageBackend = null;
    try {
      if (SqliteStorage) {
        this.storageBackend = new SqliteStorage({ maxHistory: this.maxHistory });
        // load history from db
        const rows = this.storageBackend.getHistory(this.maxHistory, 0);
        // convert to expected in-memory format
        this.history = rows.map(r => {
          if (r.type === 'text') return { id: r.id || Date.now(), type: 'text', content: r.content, timestamp: new Date(r.timestamp) };
          return { id: r.id || Date.now(), type: 'image', content: r.image_path || null, timestamp: new Date(r.timestamp), image_path: r.image_path };
        });
      } else {
        this._loadFromDisk();
      }
    } catch (err) {
      console.error('初始化存储后端失败，回退到 JSON 存储:', err);
      this.storageBackend = null;
      this._loadFromDisk();
    }
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
      if (this.history.length > this.maxHistory) this.history.length = this.maxHistory;
      this._saveToDisk();
    }
  }

  // 添加一项到历史，并负责裁剪、通知与持久化
  addItem(item) {
    try {
      // 简单防重复：如果与第一个相同则不插入
      if (this.history.length && this.history[0].type === item.type && this.history[0].content === item.content) {
        return false;
      }

      // If sqlite backend available, let it handle persistence and pruning
      if (this.storageBackend) {
        try {
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
          console.error('sqlite 写入失败，回退到内存/文件写入:', err);
          // fallthrough to JSON fallback below
        }
      }

      // JSON fallback
      this.history.unshift(item);

      if (this.history.length > this.maxHistory) {
        this.history.length = this.maxHistory;
      }

      this.notifyListeners();
      this._saveToDisk();
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

  // 内部：确保存储目录存在
  _ensureStorageDir() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch (err) {
      console.error('无法创建存储目录:', err);
    }
  }

  // 从磁盘加载历史（非阻塞）
  _loadFromDisk() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, { encoding: 'utf8' });
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          this.history = data.slice(0, this.maxHistory);
        }
      }
    } catch (err) {
      console.error('加载历史失败:', err);
    }
  }

  // 将历史写入磁盘（异步写入）
  _saveToDisk() {
    try {
      const toWrite = JSON.stringify(this.history.slice(0, this.maxHistory));
      fs.writeFile(this.storageFile, toWrite, { encoding: 'utf8' }, (err) => {
        if (err) console.error('写入历史到磁盘失败:', err);
      });
    } catch (err) {
      console.error('保存历史失败:', err);
    }
  }
}

module.exports = ClipboardManager;


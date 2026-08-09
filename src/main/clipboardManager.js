const { clipboard } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const SqliteStorage = require('./storage/sqliteStorage');

class ClipboardManager {
  constructor(options = {}) {
    this.history = [];
    this.listeners = [];
    this._pendingItems = [];
    this._flushTimer = null;
    this._flushInProgress = false;
    this._suppressedChange = null;
    this._flushDelayMs = typeof options.flushDelayMs === 'number' ? options.flushDelayMs : 120;

    // 最大历史条目数，默认与配置保持一致
    this.maxHistory = typeof options.maxHistory === 'number' ? options.maxHistory : 500;

    // 初始化存储后端：使用 SqliteStorage
    this.storageBackend = new SqliteStorage({ maxHistory: this.maxHistory });
    // load history from db
    this._reloadHistoryFromStorage();
  }

  _reloadHistoryFromStorage() {
    const rows = this.storageBackend.getHistory(this.maxHistory, 0);
    // convert to expected in-memory format and keep db row id in _dbId
    this.history = rows.map(r => {
      if (r.type === 'text') return { id: r.id || Date.now(), _dbId: r._dbId || null, type: 'text', content: r.content, timestamp: new Date(r.timestamp), pinned: r.pinned ? 1 : 0, hash: r.hash || null };
      return this._normalizeImagePaths({
        id: r.id || Date.now(),
        _dbId: r._dbId || null,
        type: 'image',
        content: r.image_path || null,
        timestamp: new Date(r.timestamp),
        image_path: r.image_path,
        image_thumb: r.image_thumb,
        pinned: r.pinned ? 1 : 0,
        hash: r.hash || null
      });
    });
  }

  _normalizeImagePaths(item) {
    if (!item || item.type !== 'image') return item;
    const normalized = { ...item };
    if (normalized.image_thumb && !fs.existsSync(normalized.image_thumb)) {
      normalized.image_thumb = null;
    }
    if (normalized.image_path && !fs.existsSync(normalized.image_path)) {
      normalized.image_path = null;
      normalized.content = null;
    }
    return normalized;
  }

  _normalizeTimestamp(value) {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return new Date(parsed);
    }
    return new Date();
  }

  _normalizeText(text) {
    return text ? text.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : '';
  }

  _hashBuffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  _getTextIdentity(content = '') {
    const normalized = this._normalizeText(content);
    return normalized ? `text:${normalized}` : '';
  }

  _getImageIdentity(hash = '') {
    const normalized = String(hash || '').trim();
    return normalized ? `image:${normalized}` : '';
  }

  _resolveImageIdentity(item = null) {
    if (!item || item.type !== 'image') return '';

    if (item.imageHash || item.hash) {
      return this._getImageIdentity(item.imageHash || item.hash);
    }

    if (Buffer.isBuffer(item.imageBuffer) && item.imageBuffer.length) {
      return this._getImageIdentity(this._hashBuffer(item.imageBuffer));
    }

    const raw = item.imageDataUrl || item.content || '';
    if (!raw || typeof raw !== 'string') return '';
    if (raw.startsWith('image:')) return raw;
    if (!raw.startsWith('data:')) return '';

    const match = raw.match(/^data:(.*?);base64,(.*)$/);
    if (!match || !match[2]) return '';

    try {
      return this._getImageIdentity(this._hashBuffer(Buffer.from(match[2], 'base64')));
    } catch (error) {
      return '';
    }
  }

  _getItemIdentity(item = null) {
    if (!item || !item.type) return '';
    if (item.type === 'text') {
      return this._getTextIdentity(item.content || '');
    }
    if (item.type === 'image') {
      return this._resolveImageIdentity(item)
        || this._getImageIdentity(item.hash || '')
        || (item.image_path ? this._getImageIdentity(item.image_path) : '');
    }
    return '';
  }

  _createImagePayload(image) {
    if (!image || image.isEmpty()) return null;

    try {
      const imageBuffer = image.toPNG();
      if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) {
        return null;
      }
      const hash = this._hashBuffer(imageBuffer);
      return {
        imageBuffer,
        hash,
        identity: this._getImageIdentity(hash)
      };
    } catch (error) {
      console.error('生成剪贴板图片摘要失败:', error);
      return null;
    }
  }

  suppressNextChange(item = null) {
    if (!item || !item.type) {
      this._suppressedChange = null;
      return;
    }

    if (item.type === 'text') {
      const content = this._normalizeText(item.text ?? item.content ?? '');
      if (!content) {
        this._suppressedChange = null;
        return;
      }
      this._suppressedChange = {
        type: 'text',
        content: this._getTextIdentity(content)
      };
      this.previousText = content;
      return;
    }

    if (item.type === 'image') {
      const identities = [];
      if (Array.isArray(item.imageBuffers)) {
        for (const buf of item.imageBuffers) {
          if (Buffer.isBuffer(buf) && buf.length) {
            identities.push(this._getImageIdentity(this._hashBuffer(buf)));
          }
        }
      } else {
        const identity = this._resolveImageIdentity(item);
        if (identity) identities.push(identity);
      }
      if (!identities.length) {
        this._suppressedChange = null;
        return;
      }
      this._suppressedChange = {
        type: 'image',
        content: identities
      };
      // 以最后写入的候选（通常是读回字节）作为剪贴板当前快照
      this.previousImage = identities[identities.length - 1];
      return;
    }

    this._suppressedChange = null;
  }

  _shouldSuppressClipboardItem(type, content) {
    const suppressedChange = this._suppressedChange;
    if (!suppressedChange) return false;

    if (suppressedChange.type !== type) {
      this._suppressedChange = null;
      return false;
    }

    const matches = Array.isArray(suppressedChange.content)
      ? suppressedChange.content.includes(content)
      : suppressedChange.content === content;

    if (matches) {
      return true;
    }

    this._suppressedChange = null;
    return false;
  }

  // 开始监控剪贴板
  startMonitoring() {
    if (this._monitoring) return;
    this._monitoring = true;
    // 优先使用 watch API
    if (clipboard.watch) {
      this.previousText = this._normalizeText(clipboard.readText());
      const initialImagePayload = this._createImagePayload(clipboard.readImage());
      this.previousImage = initialImagePayload ? initialImagePayload.identity : '';

      clipboard.watch((type) => {
        if (type === 'text') {
          const currentText = this._normalizeText(clipboard.readText());
          if (currentText !== this.previousText) {
            this.previousText = currentText;
            // 剪贴板现在持有文本，清空图片快照，避免旧图片重复复制时被误判为未变化
            this.previousImage = '';
            this.checkClipboard();
          }
        } else if (type === 'image') {
          const currentImagePayload = this._createImagePayload(clipboard.readImage());
          const currentImageIdentity = currentImagePayload ? currentImagePayload.identity : '';
          if (currentImageIdentity !== this.previousImage) {
            this.previousImage = currentImageIdentity;
            // 剪贴板现在持有图片，清空文本快照
            this.previousText = '';
            this.checkClipboard();
          }
        }
      });
    } else {
      // 备选方案
      this.checkClipboard();
      this.interval = setInterval(() => this.checkClipboard(), 1000);
    }
  }

  // 停止监控剪贴板
  stopMonitoring() {
    this._monitoring = false;
    if (clipboard.unwatch) {
      try {
        clipboard.unwatch();
      } catch (e) {
        // ignore unwatch errors
      }
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    try {
      // flush pending items before shutdown
      this._flushPendingItems();
    } catch (e) {
      // ignore flush errors during shutdown
    }
  }

  // 检查剪贴板内容变化
  checkClipboard() {
    try {
      let newItem = null;
      const normalizedText = this._normalizeText(clipboard.readText());
      const textIdentity = this._getTextIdentity(normalizedText);

      // 检查是否有文本内容
      if (normalizedText) {
        if (this._shouldSuppressClipboardItem('text', textIdentity)) {
          return false;
        }
        if (textIdentity && (!this.history.length || this._getItemIdentity(this.history[0]) !== textIdentity)) {
          newItem = {
            id: Date.now(),
            type: 'text',
            content: normalizedText,
            timestamp: new Date()
          };
        }
      }
      // 检查是否有图像内容
      else {
        const image = clipboard.readImage();
        if (!image.isEmpty()) {
          const imagePayload = this._createImagePayload(image);
          const imageIdentity = imagePayload ? imagePayload.identity : '';
          if (this._shouldSuppressClipboardItem('image', imageIdentity)) {
            return false;
          }
          if (imagePayload && (!this.history.length || this._getItemIdentity(this.history[0]) !== imageIdentity)) {
            newItem = {
              id: Date.now(),
              type: 'image',
              content: imageIdentity,
              imageBuffer: imagePayload.imageBuffer,
              hash: imagePayload.hash,
              timestamp: new Date()
            };
          }
        } else {
          this.previousImage = '';
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
    let changed = false;
    for (let i = 0; i < this.history.length; i++) {
      const item = this.history[i];
      if (!item || item.type !== 'image') continue;
      const normalized = this._normalizeImagePaths(item);
      if (normalized.image_thumb !== item.image_thumb || normalized.image_path !== item.image_path || normalized.content !== item.content) {
        this.history[i] = normalized;
        changed = true;
      }
    }
    if (changed) this.notifyListeners();
    return this.history;
  }

  // 设置最大历史数
  setMaxHistory(n) {
    if (typeof n === 'number' && n > 0) {
      this.maxHistory = n;
      this.storageBackend.maxHistory = n; // 更新存储后端的 maxHistory
      // SqliteStorage 会自动处理修剪
      // Also prune in-memory history to match storage behavior
      if (this.history.length > this.maxHistory) {
        let nonPinnedCount = 0;
        for (const it of this.history) {
          if (!it || !it.pinned) nonPinnedCount += 1;
        }
        if (nonPinnedCount > this.maxHistory) {
          for (let i = this.history.length - 1; i >= 0 && nonPinnedCount > this.maxHistory; i--) {
            const it = this.history[i];
            if (!it || !it.pinned) {
              this.history.splice(i, 1);
              nonPinnedCount -= 1;
            }
          }
        }
        this.notifyListeners();
      }
    }
  }

  // 添加一项到历史，并负责裁剪、通知与持久化
  addItem(item) {
    try {
      const itemIdentity = this._getItemIdentity(item);
      // 简单防重复：如果与第一个相同则不插入
      const lastPending = this._pendingItems.length ? this._pendingItems[this._pendingItems.length - 1] : null;
      if (itemIdentity && lastPending && this._getItemIdentity(lastPending) === itemIdentity) {
        return false;
      }
      if (itemIdentity && this.history.length && this._getItemIdentity(this.history[0]) === itemIdentity) {
        return false;
      }

      this._pendingItems.push(item);
      if (!this._flushTimer) {
        this._flushTimer = setTimeout(() => this._flushPendingItems(), this._flushDelayMs);
      }
      return true;
    } catch (err) {
      console.error('添加历史项失败:', err);
      return false;
    }
  }

  _flushPendingItems() {
    if (this._flushInProgress) {
      if (!this._flushTimer) {
        this._flushTimer = setTimeout(() => this._flushPendingItems(), this._flushDelayMs);
      }
      return;
    }
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (!this._pendingItems.length) return;

    this._flushInProgress = true;
    const batch = this._pendingItems.splice(0, this._pendingItems.length);

    try {
      let results = [];
      try {
        results = this.storageBackend.addItemsBatch(batch) || [];
      } catch (e) {
        // fallback to single inserts on batch failure
        results = batch.map((it) => {
          try { return this.storageBackend.addItem(it); } catch (err) { return null; }
        });
      }

      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const result = results[i];
        if (!result) continue;

        const newItem = {
          id: result.id,
          _dbId: result.id,
          type: item.type,
          content: item.type === 'text' ? item.content : (result.image_path || item.image_path || null),
          timestamp: this._normalizeTimestamp(item.timestamp),
          image_path: result.image_path,
          image_thumb: result.image_thumb,
          pinned: result.pinned ? 1 : 0,
          hash: result.hash || item.hash || null
        };

        // 如果是更新时间戳，则找到旧项，移到最前面
        const existingIndex = this.history.findIndex(h => h._dbId === result.id || h.id === result.id);
        if (existingIndex > -1) {
          this.history.splice(existingIndex, 1);
        }

        // 插入到最前面
        this.history.unshift(newItem);
      }

      // 裁剪历史记录
      if (this.history.length > this.maxHistory) {
        // Only prune non-pinned items to match storage behavior
        let nonPinnedCount = 0;
        for (const it of this.history) {
          if (!it || !it.pinned) nonPinnedCount += 1;
        }
        if (nonPinnedCount > this.maxHistory) {
          for (let i = this.history.length - 1; i >= 0 && nonPinnedCount > this.maxHistory; i--) {
            const it = this.history[i];
            if (!it || !it.pinned) {
              this.history.splice(i, 1);
              nonPinnedCount -= 1;
            }
          }
        }
      }

      this.notifyListeners();
    } catch (err) {
      console.error('批量写入历史项失败:', err);
    } finally {
      this._flushInProgress = false;
      if (this._pendingItems.length && !this._flushTimer) {
        this._flushTimer = setTimeout(() => this._flushPendingItems(), this._flushDelayMs);
      }
    }
  }

  // Update the text content for an existing item (edit in-place)
  updateTextItem(dbId, newContent) {
    try {
      const res = this.storageBackend.updateTextItemByDbId(dbId, newContent);
      if (!res || !res.success) return false;
      if (res.merged) {
        // 编辑内容与已有条目合并：被编辑的行已在存储层删除，重新加载以保持一致
        this._reloadHistoryFromStorage();
        this.notifyListeners();
        return true;
      }
      const normalizedId = (dbId === null || typeof dbId === 'undefined') ? null : String(dbId);
      const idx = this.history.findIndex(h => {
        if (!h) return false;
        if (h._dbId !== null && typeof h._dbId !== 'undefined') {
          if (String(h._dbId) === normalizedId) return true;
        }
        if (h.id !== null && typeof h.id !== 'undefined') {
          if (String(h.id) === normalizedId) return true;
        }
        return false;
      });
      if (idx > -1) {
        this.history[idx].content = newContent;
        this.history[idx].timestamp = this._normalizeTimestamp(res.timestamp);
        // move to front
        const item = this.history.splice(idx, 1)[0];
        this.history.unshift(item);
        this.notifyListeners();
      } else {
        this._reloadHistoryFromStorage();
        this.notifyListeners();
      }
      return true;
    } catch (e) {
      console.error('updateTextItem failed:', e);
      return false;
    }
  }

  // Set pinned flag for an item (by db id)
  setPinned(dbId, pinned = true) {
    try {
      const normalizedId = (dbId === null || typeof dbId === 'undefined') ? null : String(dbId);
      const res = this.storageBackend.setPinnedByDbId(dbId, pinned ? 1 : 0);
      if (!res || !res.success) return false;
      const idx = this.history.findIndex(h => {
        if (!h) return false;
        if (h._dbId !== null && typeof h._dbId !== 'undefined') {
          if (String(h._dbId) === normalizedId) return true;
        }
        if (h.id !== null && typeof h.id !== 'undefined') {
          if (String(h.id) === normalizedId) return true;
        }
        return false;
      });
      if (idx > -1) {
        this.history[idx].pinned = pinned ? 1 : 0;
        // pinned items participate in ordering by timestamp but should NOT be
        // forcibly moved when pinned/unpinned. Preserve original list order.
        this.notifyListeners();
      } else {
        // Fallback: keep in-memory history consistent with DB even if lookup misses.
        this._reloadHistoryFromStorage();
        this.notifyListeners();
      }
      return true;
    } catch (e) {
      console.error('setPinned failed:', e);
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

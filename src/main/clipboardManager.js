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
    this._monitoring = false;
    this.interval = null;
    this._suppressedChange = null;
    this._flushDelayMs = typeof options.flushDelayMs === 'number' ? options.flushDelayMs : 120;
    this._pathValidationIntervalMs = typeof options.pathValidationIntervalMs === 'number' ? options.pathValidationIntervalMs : 30000;

    this.maxHistory = typeof options.maxHistory === 'number' ? options.maxHistory : 100000;
    this.storageBackend = new SqliteStorage({ maxHistory: this.maxHistory });
    this.history = this._loadHistoryFromStorage();
    this.previousText = this._normalizeText(clipboard.readText());
    const initialImageSignature = this._readClipboardImageSignature();
    this.previousImageHash = initialImageSignature ? initialImageSignature.hash : null;
  }

  _normalizeImagePaths(item) {
    if (!item || item.type !== 'image') return item;
    const lastCheckedAt = Number(item._pathsCheckedAt || 0);
    if (lastCheckedAt && (Date.now() - lastCheckedAt) < this._pathValidationIntervalMs) {
      return item;
    }

    const normalized = { ...item };
    if (normalized.image_thumb && !fs.existsSync(normalized.image_thumb)) {
      normalized.image_thumb = null;
    }
    if (normalized.image_path && !fs.existsSync(normalized.image_path)) {
      normalized.image_path = null;
      normalized.content = null;
    }
    normalized._pathsCheckedAt = Date.now();
    return normalized;
  }

  _hashBuffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  _normalizeText(text) {
    return text ? text.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : '';
  }

  _readClipboardImageSignature() {
    const image = clipboard.readImage();
    if (!image || image.isEmpty()) return null;
    const pngBuffer = image.toPNG();
    if (!pngBuffer || !pngBuffer.length) return null;
    const hash = this._hashBuffer(pngBuffer);
    return {
      pngBuffer,
      hash,
      dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`
    };
  }

  _createImageItemFromSignature(signature) {
    if (!signature) return null;
    return {
      id: Date.now(),
      type: 'image',
      content: signature.dataUrl,
      imageBuffer: signature.pngBuffer,
      hash: signature.hash,
      timestamp: new Date()
    };
  }

  _normalizeTimestamp(value) {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return new Date(parsed);
    }

    const parsedDate = new Date(value);
    if (!Number.isNaN(parsedDate.getTime())) return parsedDate;
    return new Date();
  }

  _mapStorageRow(row) {
    if (row.type === 'text') {
      return {
        id: row.id || Date.now(),
        _dbId: row._dbId || null,
        type: 'text',
        content: row.content,
        hash: row.hash || null,
        timestamp: this._normalizeTimestamp(row.timestamp),
        pinned: row.pinned ? 1 : 0
      };
    }

    return this._normalizeImagePaths({
      id: row.id || Date.now(),
      _dbId: row._dbId || null,
      type: 'image',
      content: row.image_path || null,
      hash: row.hash || null,
      timestamp: this._normalizeTimestamp(row.timestamp),
      image_path: row.image_path,
      image_thumb: row.image_thumb,
      pinned: row.pinned ? 1 : 0
    });
  }

  _loadHistoryFromStorage() {
    const rows = this.storageBackend.getHistory(this.maxHistory, 0);
    return rows.map(row => this._mapStorageRow(row));
  }

  _reloadHistoryFromStorage() {
    this.history = this._loadHistoryFromStorage();
  }

  _trimInMemoryHistory() {
    if (this.history.length <= this.maxHistory) return;

    let nonPinnedCount = 0;
    for (const item of this.history) {
      if (!item || !item.pinned) nonPinnedCount += 1;
    }

    if (nonPinnedCount <= this.maxHistory) return;

    for (let index = this.history.length - 1; index >= 0 && nonPinnedCount > this.maxHistory; index -= 1) {
      const item = this.history[index];
      if (!item || item.pinned) continue;
      this.history.splice(index, 1);
      nonPinnedCount -= 1;
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
        content
      };
      this.previousText = content;
      return;
    }

    if (item.type === 'image') {
      const content = item.imageDataUrl || item.content || '';
      if (!content) {
        this._suppressedChange = null;
        return;
      }

      this._suppressedChange = {
        type: 'image',
        content
      };
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

    const matched = suppressedChange.content === content;
    this._suppressedChange = null;
    return matched;
  }

  startMonitoring() {
    if (this._monitoring) return;
    this._monitoring = true;

    if (typeof clipboard.watch === 'function') {
      try {
        clipboard.watch((type) => {
          if (type === 'text') {
            const currentText = this._normalizeText(clipboard.readText());
            if (currentText !== this.previousText) {
              this.previousText = currentText;
              this.checkClipboard();
            }
            return;
          }

          if (type === 'image') {
            const signature = this._readClipboardImageSignature();
            const currentHash = signature ? signature.hash : null;
            if (currentHash !== this.previousImageHash) {
              this.previousImageHash = currentHash;
              this.checkClipboard();
            }
          }
        });
        return;
      } catch (error) {
        console.warn('clipboard.watch 不可用，回退到轮询模式:', error);
      }
    }

    this.interval = setInterval(() => this.checkClipboard(), 1000);
  }

  stopMonitoring() {
    this._monitoring = false;
    if (typeof clipboard.unwatch === 'function') {
      try {
        clipboard.unwatch();
      } catch (e) {
      }
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    try {
      this._flushPendingItems();
    } catch (e) {
    }
  }

  checkClipboard() {
    try {
      let newItem = null;
      const normalizedText = this._normalizeText(clipboard.readText());

      if (normalizedText) {
        const textHash = this._hashBuffer(Buffer.from(normalizedText, 'utf8'));
        const latestTextHash = this.history.length && this.history[0].type === 'text' ? this.history[0].hash : null;
        this.previousText = normalizedText;

        if (this._shouldSuppressClipboardItem('text', normalizedText)) {
          return false;
        }

        if (!latestTextHash || latestTextHash !== textHash) {
          newItem = {
            id: Date.now(),
            type: 'text',
            content: normalizedText,
            hash: textHash,
            timestamp: new Date()
          };
        }
      } else {
        const signature = this._readClipboardImageSignature();
        const latestImageHash = this.history.length && this.history[0].type === 'image' ? this.history[0].hash : null;
        this.previousImageHash = signature ? signature.hash : null;

        if (!signature) {
          return false;
        }

        if (this._shouldSuppressClipboardItem('image', signature.dataUrl)) {
          return false;
        }

        if (!latestImageHash || latestImageHash !== signature.hash) {
          newItem = this._createImageItemFromSignature(signature);
        }
      }

      if (newItem) {
        this.addItem(newItem);
        return true;
      }
    } catch (error) {
      console.error('检查剪贴板时出错:', error);
    }

    return false;
  }

  getHistory() {
    let changed = false;
    for (let i = 0; i < this.history.length; i += 1) {
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

  setMaxHistory(n) {
    if (typeof n === 'number' && n > 0) {
      this.maxHistory = n;
      this.storageBackend.maxHistory = n;
      this._trimInMemoryHistory();
      this.notifyListeners();
    }
  }

  addItem(item) {
    try {
      const lastPending = this._pendingItems.length ? this._pendingItems[this._pendingItems.length - 1] : null;
      const itemSignature = item.hash || item.content;
      const pendingSignature = lastPending ? (lastPending.hash || lastPending.content) : null;
      const latestHistorySignature = this.history.length ? (this.history[0].hash || this.history[0].content) : null;
      if (lastPending && lastPending.type === item.type && pendingSignature === itemSignature) {
        return false;
      }
      if (this.history.length && this.history[0].type === item.type && latestHistorySignature === itemSignature) {
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
        results = batch.map((it) => {
          try {
            return this.storageBackend.addItem(it);
          } catch (err) {
            return null;
          }
        });
      }

      for (let i = 0; i < batch.length; i += 1) {
        const item = batch[i];
        const result = results[i];
        if (!result) continue;

        const newItem = this._normalizeImagePaths({
          id: result.id,
          _dbId: result.id,
          type: item.type,
          content: item.type === 'text' ? item.content : (result.image_path || item.content),
          hash: result.hash || item.hash || null,
          timestamp: this._normalizeTimestamp(item.timestamp),
          image_path: result.image_path,
          image_thumb: result.image_thumb,
          pinned: result.pinned ? 1 : 0
        });

        const existingIndex = this.history.findIndex(historyItem => historyItem._dbId === result.id || historyItem.id === result.id);
        if (existingIndex > -1) {
          this.history.splice(existingIndex, 1);
        }

        this.history.unshift(newItem);
      }

      this._trimInMemoryHistory();
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

  updateTextItem(dbId, newContent) {
    try {
      const res = this.storageBackend.updateTextItemByDbId(dbId, newContent);
      if (!res || !res.success) return false;
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
        this.history[idx].hash = res.hash || this.history[idx].hash;
        this.history[idx].timestamp = this._normalizeTimestamp(res.timestamp);
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
        this.notifyListeners();
      } else {
        this._reloadHistoryFromStorage();
        this.notifyListeners();
      }
      return true;
    } catch (e) {
      console.error('setPinned failed:', e);
      return false;
    }
  }

  addListener(callback) {
    this.listeners.push(callback);
  }

  removeListener(callback) {
    const index = this.listeners.indexOf(callback);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  notifyListeners() {
    this.listeners.forEach(listener => listener(this.history));
  }
}

module.exports = ClipboardManager;

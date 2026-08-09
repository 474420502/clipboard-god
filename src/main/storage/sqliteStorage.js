const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { nativeImage } = require('electron');

let Database;
try {
    // better-sqlite3 is synchronous and easy to use in main process
    Database = require('better-sqlite3');
} catch (e) {
    Database = null;
}

class SqliteStorage {
    constructor(options = {}) {
        this.maxHistory = options.maxHistory || 500;
        this.cleanupDelayMs = typeof options.cleanupDelayMs === 'number' ? options.cleanupDelayMs : 3000;
        this._cleanupTimer = null;
        this._cleanupInProgress = false;
        const cacheBase = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
        this.baseDir = path.join(cacheBase, 'clipboard-god');
        this.dbPath = path.join(this.baseDir, 'db.sqlite');
        this.imagesDir = path.join(this.baseDir, 'images');

        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
        if (!fs.existsSync(this.imagesDir)) fs.mkdirSync(this.imagesDir, { recursive: true });

        if (!Database) {
            throw new Error('better-sqlite3 not installed');
        }

        this.db = new Database(this.dbPath);
        this._setup();
    }

    _setup() {
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA synchronous = NORMAL;');

        this.db.exec(`
                        CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id TEXT,
                type TEXT NOT NULL,
                content TEXT,
                                image_path TEXT,
                                image_thumb TEXT,
                hash TEXT,
                timestamp INTEGER,
                meta TEXT,
                pinned INTEGER DEFAULT 0
            );
        `);
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC);');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_history_hash ON history(hash);');
        // 去重迁移：同一 (type, hash) 只保留一行（优先保留置顶、其次最新），
        // 之后建立 UNIQUE 索引，防止再次产生重复 hash 行（如编辑内容与已有条目碰撞）。
        try {
            const migration = this.db.prepare(`
                DELETE FROM history
                WHERE hash IS NOT NULL AND hash != '' AND id NOT IN (
                    SELECT id FROM (
                        SELECT id, ROW_NUMBER() OVER (
                            PARTITION BY type, hash
                            ORDER BY pinned DESC, timestamp DESC, id DESC
                        ) AS rn
                        FROM history
                        WHERE hash IS NOT NULL AND hash != ''
                    ) WHERE rn = 1
                );
            `);
            const migrationResult = migration.run();
            if (migrationResult && migrationResult.changes > 0) {
                // 被删除的重复行可能持有图片文件，安排孤儿清理
                this._scheduleOrphanCleanup();
            }
            this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_history_type_hash ON history(type, hash);');
        } catch (e) {
            // 迁移或索引创建失败时降级：继续使用先查后插的去重路径
            console.warn('历史去重迁移失败:', e && e.message ? e.message : e);
        }
        // ensure image_thumb and pinned columns exist for older DBs
        this._ensureColumn('history', 'image_thumb', 'TEXT');
        this._ensureColumn('history', 'pinned', 'INTEGER DEFAULT 0');
    }

    _ensureColumn(table, column, definition) {
        const info = this.db.prepare(`PRAGMA table_info(${table})`).all();
        const exists = info.some(c => c.name === column);
        if (!exists) {
            try {
                this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
            } catch (e) {
                // ignore
            }
        }
    }

    _hashBuffer(buf) {
        return crypto.createHash('sha256').update(buf).digest('hex');
    }

    _dataUrlToBuffer(dataUrl) {
        const m = dataUrl.match(/^data:(.*?);base64,(.*)$/);
        if (!m) return null;
        return Buffer.from(m[2], 'base64');
    }

    saveImageBuffer(buf, hashHint = null) {
        if (!Buffer.isBuffer(buf) || buf.length === 0) return null;
        const hash = hashHint || this._hashBuffer(buf);
        const fileName = `${hash}.png`;
        const filePath = path.join(this.imagesDir, fileName);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, buf);
        }

        const thumbName = `${hash}.thumb.png`;
        const thumbPath = path.join(this.imagesDir, thumbName);
        try {
            const img = nativeImage.createFromBuffer(buf);
            const thumb = img.resize({ width: 128, height: 128 });
            const thumbBuf = thumb.toPNG();
            if (!fs.existsSync(thumbPath)) fs.writeFileSync(thumbPath, thumbBuf);
        } catch (e) {
            // if nativeImage not available or fails, ignore
        }

        return { path: filePath, thumbPath, hash };
    }

    saveImageFromDataUrl(dataUrl) {
        const buf = this._dataUrlToBuffer(dataUrl);
        if (!buf) return null;
        return this.saveImageBuffer(buf);
    }

    _scheduleOrphanCleanup() {
        if (this._cleanupInProgress) return;
        if (this._cleanupTimer) clearTimeout(this._cleanupTimer);
        this._cleanupTimer = setTimeout(() => {
            this._cleanupTimer = null;
            this._cleanupOrphanedImages();
        }, this.cleanupDelayMs);
    }

    _cleanupOrphanedImages() {
        if (this._cleanupInProgress) return;
        this._cleanupInProgress = true;
        try {
            const usedRows = this.db.prepare('SELECT DISTINCT hash FROM history WHERE type = ? AND hash IS NOT NULL').all('image');
            const used = new Set(usedRows.map(r => r.hash));
            const files = fs.readdirSync(this.imagesDir);
            for (const file of files) {
                const basename = path.parse(file).name;
                const rawHash = basename.endsWith('.thumb') ? basename.replace(/\.thumb$/i, '') : basename;
                if (!used.has(rawHash)) {
                    try { fs.unlinkSync(path.join(this.imagesDir, file)); } catch (e) { }
                }
            }
        } catch (e) {
            // ignore cleanup failures
        } finally {
            this._cleanupInProgress = false;
        }
    }

    _addItemInternal(item, options = {}) {
        const skipPrune = !!options.skipPrune;
        const now = Date.now();
        const timestamp = item.timestamp ? (typeof item.timestamp === 'number' ? item.timestamp : new Date(item.timestamp).getTime()) : now;

        if (item.type === 'text') {
            const hash = crypto.createHash('sha256').update(String(item.content || '')).digest('hex');
            // check existing
            const existing = this.db.prepare('SELECT id, pinned FROM history WHERE hash = ? AND type = ?').get(hash, 'text');
            if (existing) {
                // update timestamp
                this.db.prepare('UPDATE history SET timestamp = ? WHERE id = ?').run(timestamp, existing.id);
                return { id: existing.id, existed: true, hash, pinned: existing.pinned ? 1 : 0 };
            }
            const stmt = this.db.prepare('INSERT INTO history (item_id, type, content, hash, timestamp, meta) VALUES (?, ?, ?, ?, ?, ?)');
            const info = stmt.run(item.id || null, 'text', item.content || '', hash, timestamp, null);
            if (!skipPrune) this._pruneIfNeeded();
            return { id: info.lastInsertRowid, existed: false, hash };
        }

        if (item.type === 'image') {
            const saved = item.imageBuffer
                ? this.saveImageBuffer(item.imageBuffer, item.hash || null)
                : this.saveImageFromDataUrl(item.content || '');
            const hash = saved ? saved.hash : (item.hash || null);
            const image_path = saved ? saved.path : null;
            const image_thumb = saved && saved.thumbPath ? saved.thumbPath : null;
            // check existing by hash
            const existing = hash ? this.db.prepare('SELECT id, pinned FROM history WHERE hash = ? AND type = ?').get(hash, 'image') : null;
            if (existing) {
                this.db.prepare('UPDATE history SET timestamp = ?, image_path = ?, image_thumb = ? WHERE id = ?').run(timestamp, image_path, image_thumb, existing.id);
                return { id: existing.id, existed: true, hash, image_path, image_thumb, pinned: existing.pinned ? 1 : 0 };
            }
            const stmt = this.db.prepare('INSERT INTO history (item_id, type, image_path, image_thumb, hash, timestamp, meta) VALUES (?, ?, ?, ?, ?, ?, ?)');
            const info = stmt.run(item.id || null, 'image', image_path, image_thumb, hash, timestamp, null);
            if (!skipPrune) this._pruneIfNeeded();
            return { id: info.lastInsertRowid, existed: false, hash, image_path, image_thumb };
        }
        return null;
    }

    addItem(item) {
        return this._addItemInternal(item, { skipPrune: false });
    }

    addItemsBatch(items = []) {
        if (!Array.isArray(items) || items.length === 0) return [];
        const results = [];
        const tx = this.db.transaction((batch) => {
            for (const item of batch) {
                const res = this._addItemInternal(item, { skipPrune: true });
                results.push(res);
            }
        });
        tx(items);
        this._pruneIfNeeded();
        return results;
    }

    getHistory(limit = 100, offset = 0) {
        const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Number(limit)) : 100;
        const normalizedOffset = Number.isFinite(offset) ? Math.max(0, Number(offset)) : 0;

        // Keep all pinned rows visible while limiting only non-pinned rows.
        // This matches pruning behavior where pinned rows do not count toward maxHistory.
        const rows = this.db.prepare(`
            SELECT id, item_id, type, content, image_path, image_thumb, hash, timestamp, pinned
            FROM (
                SELECT id, item_id, type, content, image_path, image_thumb, hash, timestamp, pinned
                FROM history
                WHERE pinned = 1

                UNION ALL

                SELECT id, item_id, type, content, image_path, image_thumb, hash, timestamp, pinned
                FROM (
                    SELECT id, item_id, type, content, image_path, image_thumb, hash, timestamp, pinned
                    FROM history
                    WHERE pinned = 0
                    ORDER BY timestamp DESC
                    LIMIT ? OFFSET ?
                )
            )
            ORDER BY timestamp DESC
        `).all(normalizedLimit, normalizedOffset);

        return rows.map(r => ({
            id: r.item_id || r.id || null,
            _dbId: r.id,
            type: r.type,
            content: r.type === 'text' ? r.content : null,
            image_path: r.type === 'image' ? r.image_path : null,
            image_thumb: r.type === 'image' ? r.image_thumb : null,
            hash: r.hash,
            timestamp: r.timestamp,
            pinned: r.pinned ? 1 : 0
        }));
    }

    _pruneIfNeeded() {
        // Only count non-pinned items towards the maxHistory limit
        const countRow = this.db.prepare('SELECT COUNT(*) AS c FROM history WHERE pinned = 0').get();
        const count = countRow ? countRow.c : 0;
        if (count > this.maxHistory) {
            const toDelete = count - this.maxHistory;
            // find oldest ids and their hashes
            const rows = this.db.prepare('SELECT id, hash, type FROM history WHERE pinned = 0 ORDER BY timestamp ASC LIMIT ?').all(toDelete);
            const ids = rows.map(r => r.id);
            if (ids.length) {
                const placeholders = ids.map(() => '?').join(',');
                const deleteStmt = this.db.prepare(`DELETE FROM history WHERE id IN (${placeholders})`);
                deleteStmt.run(...ids);
                this._scheduleOrphanCleanup();
            }
        }
    }

    // Update text content for an existing row (also update hash and timestamp)
    updateTextItemByDbId(dbId, newContent) {
        try {
            const now = Date.now();
            const hash = crypto.createHash('sha256').update(String(newContent || '')).digest('hex');
            let changedRows = 0;
            let merged = false;
            const tx = this.db.transaction((dbId, content, hash, now) => {
                // 被编辑的行可能已被裁剪（编辑弹窗打开期间），此时不产生任何变更
                const current = this.db.prepare('SELECT pinned FROM history WHERE id = ?').get(dbId);
                if (!current) return;
                // 若目标内容已存在于另一行，则合并：保留置顶优先的一行，删除另一行，避免重复 hash
                const existing = this.db.prepare('SELECT id, pinned FROM history WHERE type = ? AND hash = ? AND id != ?').get('text', hash, dbId);
                if (existing) {
                    merged = true;
                    if (current.pinned && !existing.pinned) {
                        // 被编辑行是置顶的：保留它，删除已有行
                        this.db.prepare('UPDATE history SET content = ?, hash = ?, timestamp = ? WHERE id = ?').run(content, hash, now, dbId);
                        const info = this.db.prepare('DELETE FROM history WHERE id = ?').run(existing.id);
                        changedRows = info && typeof info.changes === 'number' ? info.changes : 0;
                    } else {
                        // 保留已有行（置顶优先，其次时间更新），删除被编辑行
                        this.db.prepare('UPDATE history SET timestamp = ? WHERE id = ?').run(now, existing.id);
                        const info = this.db.prepare('DELETE FROM history WHERE id = ?').run(dbId);
                        changedRows = info && typeof info.changes === 'number' ? info.changes : 0;
                    }
                    return;
                }
                const info = this.db.prepare('UPDATE history SET content = ?, hash = ?, timestamp = ? WHERE id = ?').run(content, hash, now, dbId);
                changedRows = info && typeof info.changes === 'number' ? info.changes : 0;
            });
            tx(dbId, newContent, hash, now);
            if (!changedRows) {
                return { success: false, error: 'not-found' };
            }
            return { success: true, hash, timestamp: now, merged };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    setPinnedByDbId(dbId, pinned) {
        try {
            const v = pinned ? 1 : 0;
            const info = this.db.prepare('UPDATE history SET pinned = ? WHERE id = ?').run(v, dbId);
            if (!info || !info.changes) {
                return { success: false, error: 'not-found' };
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    // migrateFromJson has been removed: migrations should be done externally when needed.
}

module.exports = SqliteStorage;

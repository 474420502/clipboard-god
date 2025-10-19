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
        this.maxHistory = options.maxHistory || 100000;
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
        meta TEXT
      );
    `);
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC);');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_history_hash ON history(hash);');
        // FTS table for text search
        try {
            this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(content, tokenize="unicode61");`);
        } catch (e) {
            // if FTS5 not available, ignore (search will not be available)
            console.warn('FTS5 not available in SQLite build, search disabled');
        }
        // ensure image_thumb column exists for older DBs
        this._ensureColumn('history', 'image_thumb', 'TEXT');
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

    saveImageFromDataUrl(dataUrl) {
        const buf = this._dataUrlToBuffer(dataUrl);
        if (!buf) return null;
        const hash = this._hashBuffer(buf);
        const fileName = `${hash}.png`;
        const filePath = path.join(this.imagesDir, fileName);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, buf);
        }
        // create thumbnail
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

    addItem(item) {
        const now = Date.now();
        const timestamp = item.timestamp ? (typeof item.timestamp === 'number' ? item.timestamp : new Date(item.timestamp).getTime()) : now;

        if (item.type === 'text') {
            const hash = crypto.createHash('sha256').update(String(item.content || '')).digest('hex');
            // check existing
            const existing = this.db.prepare('SELECT id FROM history WHERE hash = ? AND type = ?').get(hash, 'text');
            if (existing) {
                // update timestamp
                this.db.prepare('UPDATE history SET timestamp = ? WHERE id = ?').run(timestamp, existing.id);
                return { id: existing.id, existed: true, hash };
            }
            const stmt = this.db.prepare('INSERT INTO history (item_id, type, content, hash, timestamp, meta) VALUES (?, ?, ?, ?, ?, ?)');
            const info = stmt.run(item.id || null, 'text', item.content || '', hash, timestamp, null);
            // insert into FTS if available
            try {
                if (this.db.prepare('SELECT name FROM sqlite_master WHERE type = "table" AND name = "history_fts"').get()) {
                    this.db.prepare('INSERT INTO history_fts(rowid, content) VALUES (?, ?)').run(info.lastInsertRowid, item.content || '');
                }
            } catch (e) {
                // ignore fts errors
            }
            this._pruneIfNeeded();
            return { id: info.lastInsertRowid, existed: false, hash };
        }

        if (item.type === 'image') {
            const saved = this.saveImageFromDataUrl(item.content || '');
            const hash = saved ? saved.hash : null;
            const image_path = saved ? saved.path : null;
            const image_thumb = saved && saved.thumbPath ? saved.thumbPath : null;
            // check existing by hash
            const existing = hash ? this.db.prepare('SELECT id FROM history WHERE hash = ? AND type = ?').get(hash, 'image') : null;
            if (existing) {
                this.db.prepare('UPDATE history SET timestamp = ?, image_path = ?, image_thumb = ? WHERE id = ?').run(timestamp, image_path, image_thumb, existing.id);
                return { id: existing.id, existed: true, hash, image_path, image_thumb };
            }
            const stmt = this.db.prepare('INSERT INTO history (item_id, type, image_path, image_thumb, hash, timestamp, meta) VALUES (?, ?, ?, ?, ?, ?, ?)');
            const info = stmt.run(item.id || null, 'image', image_path, image_thumb, hash, timestamp, null);
            this._pruneIfNeeded();
            return { id: info.lastInsertRowid, existed: false, hash, image_path, image_thumb };
        }
        return null;
    }

    getHistory(limit = 100, offset = 0) {
        const stmt = this.db.prepare('SELECT item_id, type, content, image_path, image_thumb, hash, timestamp FROM history ORDER BY timestamp DESC LIMIT ? OFFSET ?');
        return stmt.all(limit, offset).map(r => ({
            id: r.item_id || null,
            type: r.type,
            content: r.type === 'text' ? r.content : null,
            image_path: r.type === 'image' ? r.image_path : null,
            image_thumb: r.type === 'image' ? r.image_thumb : null,
            hash: r.hash,
            timestamp: r.timestamp
        }));
    }

    _pruneIfNeeded() {
        const countRow = this.db.prepare('SELECT COUNT(*) AS c FROM history').get();
        const count = countRow ? countRow.c : 0;
        if (count > this.maxHistory) {
            const toDelete = count - this.maxHistory;
            // find oldest ids and their hashes
            const rows = this.db.prepare('SELECT id, hash, type FROM history ORDER BY timestamp ASC LIMIT ?').all(toDelete);
            const ids = rows.map(r => r.id);
            if (ids.length) {
                const placeholders = ids.map(() => '?').join(',');
                const deleteStmt = this.db.prepare(`DELETE FROM history WHERE id IN (${placeholders})`);
                const deleteFtsStmt = this.db.prepare(`DELETE FROM history_fts WHERE rowid IN (${placeholders})`);
                const tx = this.db.transaction((ids) => {
                    deleteStmt.run(...ids);
                    try {
                        // if FTS exists, delete related rows
                        if (this.db.prepare('SELECT name FROM sqlite_master WHERE type = "table" AND name = "history_fts"').get()) {
                            deleteFtsStmt.run(...ids);
                        }
                    } catch (e) { }
                });
                tx(ids);
                // cleanup image files that are no longer referenced
                const usedRows = this.db.prepare('SELECT DISTINCT hash FROM history WHERE type = ? AND hash IS NOT NULL').all('image');
                const used = new Set(usedRows.map(r => r.hash));
                // scan images dir
                try {
                    const files = fs.readdirSync(this.imagesDir);
                    for (const file of files) {
                        const basename = path.parse(file).name; // filename without ext -> hash
                        if (!used.has(basename)) {
                            // remove file
                            try { fs.unlinkSync(path.join(this.imagesDir, file)); } catch (e) { }
                        }
                    }
                } catch (e) { }
            }
        }
    }

    // full-text search (requires FTS5 support)
    search(query, limit = 100) {
        try {
            // ensure FTS exists
            if (!this.db.prepare('SELECT name FROM sqlite_master WHERE type = "table" AND name = "history_fts"').get()) return [];
            const stmt = this.db.prepare(`SELECT h.item_id as id, h.type, h.content, h.image_path, h.hash, h.timestamp
                FROM history h JOIN history_fts f ON f.rowid = h.id
                WHERE f MATCH ? ORDER BY h.timestamp DESC LIMIT ?`);
            return stmt.all(query, limit).map(r => ({ id: r.id || null, type: r.type, content: r.content, image_path: r.image_path, hash: r.hash, timestamp: r.timestamp }));
        } catch (e) {
            console.warn('search failed or FTS5 unavailable', e);
            return [];
        }
    }

    // migrateFromJson has been removed: migrations should be done externally when needed.
}

module.exports = SqliteStorage;

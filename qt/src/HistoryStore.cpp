#include "HistoryStore.h"
#include "HashUtil.h"

#include <QSqlError>
#include <QSqlQuery>
#include <QStandardPaths>
#include <QDir>
#include <QDateTime>
#include <QImage>
#include <QBuffer>
#include <QCryptographicHash>
#include <QFile>

HistoryStore::HistoryStore() = default;

bool HistoryStore::init()
{
    if (m_ready)
        return true;

    QString cacheBase = qEnvironmentVariable("XDG_CACHE_HOME");
    if (cacheBase.isEmpty())
        cacheBase = QDir::homePath() + QLatin1String("/.cache");

    const QString dataDir = cacheBase + QLatin1String("/clipboard-god");
    QDir().mkpath(dataDir);

    // 创建图片存储目录（与 Electron 版本一致）
    const QString imagesDir = dataDir + QLatin1String("/images");
    QDir().mkpath(imagesDir);

    // 使用 Electron 版本的数据库路径与表结构
    const QString dbPath = dataDir + QLatin1String("/db.sqlite");
    m_db = QSqlDatabase::addDatabase("QSQLITE", "clipboard_god");
    m_db.setDatabaseName(dbPath);

    if (!m_db.open())
    {
        m_ready = false;
        return false;
    }

    if (!ensureSchema())
    {
        m_ready = false;
        return false;
    }

    m_imagesDir = imagesDir;
    m_ready = true;
    return true;
}

bool HistoryStore::isReady() const
{
    return m_ready && m_db.isOpen();
}

bool HistoryStore::ensureSchema()
{
    // 检查现有表结构
    QSqlQuery query(m_db);

    // 获取表信息
    query.exec("PRAGMA table_info(history)");
    QVector<QString> existingColumns;
    while (query.next())
    {
        existingColumns.append(query.value("name").toString());
    }

    // 如果表不存在，创建新表
    if (existingColumns.isEmpty())
    {
        query.exec(
            "CREATE TABLE history ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "item_id TEXT,"
            "type TEXT NOT NULL,"
            "content TEXT,"
            "image_path TEXT,"
            "image_thumb TEXT,"
            "hash TEXT,"
            "timestamp INTEGER,"
            "meta TEXT,"
            "pinned INTEGER DEFAULT 0"
            ")");
    }
    else
    {
        // 迁移：添加缺失的列
        if (!existingColumns.contains("item_id"))
        {
            query.exec("ALTER TABLE history ADD COLUMN item_id TEXT");
        }
        if (!existingColumns.contains("image_path"))
        {
            query.exec("ALTER TABLE history ADD COLUMN image_path TEXT");
        }
        if (!existingColumns.contains("image_thumb"))
        {
            query.exec("ALTER TABLE history ADD COLUMN image_thumb TEXT");
        }
        if (!existingColumns.contains("hash"))
        {
            query.exec("ALTER TABLE history ADD COLUMN hash TEXT");
        }
        if (!existingColumns.contains("pinned"))
        {
            query.exec("ALTER TABLE history ADD COLUMN pinned INTEGER DEFAULT 0");
        }
        if (!existingColumns.contains("meta"))
        {
            query.exec("ALTER TABLE history ADD COLUMN meta TEXT");
        }
    }

    // 创建索引
    query.exec("CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC)");
    query.exec("CREATE INDEX IF NOT EXISTS idx_history_hash ON history(hash)");
    query.exec("CREATE INDEX IF NOT EXISTS idx_history_pinned ON history(pinned)");

    return true;
}

QString HistoryStore::imagesDirectory() const
{
    return m_imagesDir;
}

QString HistoryStore::saveImage(const QImage &image, QString &thumbPath)
{
    if (image.isNull())
        return QString();

    // 生成图片数据的哈希
    QByteArray bytes;
    QBuffer buffer(&bytes);
    buffer.open(QIODevice::WriteOnly);
    image.save(&buffer, "PNG");
    const QString hash = HashUtil::computeDataHash(bytes);

    // 保存原图
    const QString imagePath = m_imagesDir + QLatin1String("/") + hash + QLatin1String(".png");
    if (!QFile::exists(imagePath))
    {
        image.save(imagePath, "PNG");
    }

    // 生成缩略图
    QImage thumb = image.scaled(QSize(128, 128), Qt::KeepAspectRatio, Qt::SmoothTransformation);
    thumbPath = m_imagesDir + QLatin1String("/") + hash + QLatin1String(".thumb.png");
    if (!QFile::exists(thumbPath))
    {
        thumb.save(thumbPath, "PNG");
    }

    return imagePath;
}

QString HistoryStore::saveImageFromData(const QByteArray &imageData, QString &thumbPath)
{
    QImage image;
    if (!image.loadFromData(imageData))
        return QString();

    return saveImage(image, thumbPath);
}

bool HistoryStore::hasHash(const QString &hash) const
{
    if (!isReady() || hash.isEmpty())
        return false;

    QSqlQuery query(m_db);
    query.prepare("SELECT id FROM history WHERE hash = ? LIMIT 1");
    query.addBindValue(hash);

    if (query.exec() && query.next())
    {
        return true;
    }
    return false;
}

bool HistoryStore::updateTimestampByHash(const QString &hash)
{
    if (!isReady() || hash.isEmpty())
        return false;

    QSqlQuery query(m_db);
    query.prepare("UPDATE history SET timestamp = ? WHERE hash = ?");
    query.addBindValue(QDateTime::currentMSecsSinceEpoch());
    query.addBindValue(hash);

    return query.exec();
}

QVector<ClipboardItem> HistoryStore::loadLatest(int limit)
{
    QVector<ClipboardItem> items;
    if (!isReady())
        return items;

    QSqlQuery query(m_db);
    query.prepare("SELECT id, item_id, type, content, image_path, image_thumb, hash, timestamp, pinned FROM history ORDER BY pinned DESC, timestamp DESC LIMIT ?");
    query.addBindValue(limit);

    if (!query.exec())
        return items;

    while (query.next())
    {
        ClipboardItem item;
        item.id = query.value(0).toLongLong();
        item.itemId = query.value(1).toString();
        item.type = query.value(2).toString();
        item.content = query.value(3).toString();
        item.imagePath = query.value(4).toString();
        item.imageThumb = query.value(5).toString();
        item.hash = query.value(6).toString();
        item.timestamp = QDateTime::fromMSecsSinceEpoch(query.value(7).toLongLong());
        item.pinned = query.value(8).toInt();
        items.append(item);
    }

    return items;
}

bool HistoryStore::addItem(const ClipboardItem &item)
{
    if (!isReady())
        return false;

    QSqlQuery query(m_db);
    query.prepare(
        "INSERT INTO history (item_id, type, content, image_path, image_thumb, hash, timestamp, pinned) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    query.addBindValue(item.itemId);
    query.addBindValue(item.type);
    query.addBindValue(item.content);
    query.addBindValue(item.imagePath);
    query.addBindValue(item.imageThumb);
    query.addBindValue(item.hash);
    query.addBindValue(item.timestamp.toMSecsSinceEpoch());
    query.addBindValue(item.pinned);

    return query.exec();
}

bool HistoryStore::addItemWithDeduplication(const ClipboardItem &item)
{
    // 如果有 hash，先检查是否存在
    if (!item.hash.isEmpty() && hasHash(item.hash))
    {
        // 更新 timestamp（置顶功能除外）
        if (item.pinned == 0)
        {
            updateTimestampByHash(item.hash);
        }
        return false; // 已存在，不重复插入
    }

    return addItem(item);
}

bool HistoryStore::updateTextItem(qint64 dbId, const QString &content, const QString &hash)
{
    if (!isReady())
        return false;

    QSqlQuery query(m_db);
    query.prepare("UPDATE history SET content = ?, hash = ?, timestamp = ? WHERE id = ?");
    query.addBindValue(content);
    query.addBindValue(hash);
    query.addBindValue(QDateTime::currentMSecsSinceEpoch());
    query.addBindValue(dbId);

    return query.exec();
}

bool HistoryStore::setPinned(qint64 dbId, bool pinned)
{
    if (!isReady())
        return false;

    QSqlQuery query(m_db);
    query.prepare("UPDATE history SET pinned = ? WHERE id = ?");
    query.addBindValue(pinned ? 1 : 0);
    query.addBindValue(dbId);

    return query.exec();
}

bool HistoryStore::deleteById(qint64 dbId)
{
    if (!isReady())
        return false;

    // 获取要删除的项目（包括图片文件）
    QSqlQuery query(m_db);
    query.prepare("SELECT image_path, image_thumb FROM history WHERE id = ?");
    query.addBindValue(dbId);

    if (query.exec() && query.next())
    {
        const QString imagePath = query.value(0).toString();
        const QString imageThumb = query.value(1).toString();

        // 删除图片文件
        if (!imagePath.isEmpty())
        {
            QFile::remove(imagePath);
        }
        if (!imageThumb.isEmpty())
        {
            QFile::remove(imageThumb);
        }
    }

    // 删除数据库记录
    query.prepare("DELETE FROM history WHERE id = ?");
    query.addBindValue(dbId);

    return query.exec();
}

void HistoryStore::cleanupOrphanedImages(const QStringList &activePaths)
{
    // 清理不在活跃路径列表中的图片文件
    QDir imagesDir(m_imagesDir);
    const QStringList filters = {"*.png", "*.jpg", "*.jpeg"};
    const QStringList files = imagesDir.entryList(filters, QDir::Files);

    for (const QString &file : files)
    {
        const QString filePath = imagesDir.filePath(file);
        bool isActive = false;

        for (const QString &path : activePaths)
        {
            if (filePath == path || filePath == path + ".thumb.png")
            {
                isActive = true;
                break;
            }
        }

        if (!isActive)
        {
            QFile::remove(filePath);
        }
    }
}

bool HistoryStore::clear()
{
    if (!isReady())
        return false;

    // 清空图片目录
    QDir imagesDir(m_imagesDir);
    const QStringList files = imagesDir.entryList(QDir::Files);
    for (const QString &file : files)
    {
        imagesDir.remove(file);
    }

    QSqlQuery query(m_db);
    return query.exec("DELETE FROM clipboard_history");
}

int HistoryStore::countRows() const
{
    if (!isReady())
        return 0;

    QSqlQuery query(m_db);
    if (!query.exec("SELECT COUNT(*) FROM clipboard_history"))
        return 0;

    if (!query.next())
        return 0;

    return query.value(0).toInt();
}

bool HistoryStore::trimToLimit(int limit)
{
    if (!isReady() || limit <= 0)
        return false;

    const int total = countRows();
    const int overflow = total - limit;
    if (overflow <= 0)
        return true;

    // 首先删除被淘汰记录的图片文件
    QSqlQuery query(m_db);
    query.prepare(
        "SELECT image_path, image_thumb FROM clipboard_history "
        "WHERE pinned = 0 ORDER BY timestamp ASC LIMIT ?");
    query.addBindValue(overflow);

    if (query.exec())
    {
        while (query.next())
        {
            const QString imagePath = query.value(0).toString();
            const QString imageThumb = query.value(1).toString();
            if (!imagePath.isEmpty())
                QFile::remove(imagePath);
            if (!imageThumb.isEmpty())
                QFile::remove(imageThumb);
        }
    }

    // 删除数据库记录
    query.prepare(
        "DELETE FROM clipboard_history WHERE pinned = 0 AND id IN ("
        "SELECT id FROM clipboard_history WHERE pinned = 0 ORDER BY timestamp ASC LIMIT ?");
    query.addBindValue(overflow);

    return query.exec();
}
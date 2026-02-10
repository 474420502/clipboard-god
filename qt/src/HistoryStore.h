#pragma once

#include <QSqlDatabase>
#include <QVector>
#include <QStringList>

#include "HistoryModel.h"

class HistoryStore
{
public:
    HistoryStore();

    bool init();
    bool isReady() const;

    // 基础 CRUD
    QVector<ClipboardItem> loadLatest(int limit);
    bool addItem(const ClipboardItem &item);
    bool addItemWithDeduplication(const ClipboardItem &item); // 带去重的添加
    bool updateTextItem(qint64 dbId, const QString &content, const QString &hash);
    bool setPinned(qint64 dbId, bool pinned);
    bool deleteById(qint64 dbId);
    bool clear();
    bool trimToLimit(int limit);

    // 图片存储
    QString imagesDirectory() const;
    QString saveImage(const QImage &image, QString &thumbPath);
    QString saveImageFromData(const QByteArray &imageData, QString &thumbPath);
    void cleanupOrphanedImages(const QStringList &activePaths);

    // 去重检测
    bool hasHash(const QString &hash) const;
    bool updateTimestampByHash(const QString &hash);

    // 统计
    int countRows() const;

private:
    bool ensureSchema();

    QSqlDatabase m_db;
    QString m_imagesDir;
    bool m_ready = false;
    int m_countRows = 0; // 行数缓存
};
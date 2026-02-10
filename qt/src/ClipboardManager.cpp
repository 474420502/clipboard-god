#include "ClipboardManager.h"
#include "HistoryModel.h"
#include "HistoryStore.h"
#include "HashUtil.h"

#include <QGuiApplication>
#include <QClipboard>
#include <QBuffer>
#include <QImage>
#include <QMimeData>
#include <QTimer>
#include <QFile>
#include <QDateTime>

ClipboardManager::ClipboardManager(HistoryModel *model, QObject *parent)
    : QObject(parent), m_model(model), m_flushTimer(nullptr) {}

ClipboardManager::~ClipboardManager()
{
    stop();
}

void ClipboardManager::suppressNextChange()
{
    m_suppressNext = true;
}

void ClipboardManager::start()
{
    if (m_running)
        return;
    m_running = true;

    // 创建防抖定时器
    m_flushTimer = new QTimer(this);
    m_flushTimer->setSingleShot(true);
    connect(m_flushTimer, &QTimer::timeout, this, &ClipboardManager::flushPendingItems);

    QClipboard *clipboard = QGuiApplication::clipboard();
    if (clipboard)
    {
        connect(clipboard, &QClipboard::dataChanged, this, &ClipboardManager::onClipboardChanged);
    }
}

void ClipboardManager::stop()
{
    if (!m_running)
        return;
    m_running = false;

    // 刷新待处理项
    flushPendingItems();

    // 断开连接并清理定时器
    QClipboard *clipboard = QGuiApplication::clipboard();
    if (clipboard)
    {
        disconnect(clipboard, &QClipboard::dataChanged, this, &ClipboardManager::onClipboardChanged);
    }

    if (m_flushTimer)
    {
        m_flushTimer->deleteLater();
        m_flushTimer = nullptr;
    }
}

void ClipboardManager::onClipboardChanged()
{
    if (m_suppressNext)
    {
        m_suppressNext = false;
        return;
    }

    QClipboard *clipboard = QGuiApplication::clipboard();
    if (!clipboard || !m_model)
        return;

    const QMimeData *mime = clipboard->mimeData();
    if (!mime)
        return;

    // 检查图片
    if (mime->hasImage())
    {
        QImage image = qvariant_cast<QImage>(mime->imageData());
        if (image.isNull())
            return;

        // 计算图片哈希
        const QString hash = HashUtil::computeImageHash(image);

        // 准备待处理的图片项
        ClipboardItem item;
        item.id = QDateTime::currentMSecsSinceEpoch();
        item.type = "image";
        item.hash = hash;
        item.timestamp = QDateTime::currentDateTime();

        // 添加到待处理队列
        enqueueItem(item, image);
        return;
    }

    // 检查文本
    if (mime->hasText())
    {
        QString text = mime->text();

        // 文本规范化：统一换行符
        text.replace("\r\n", "\n");
        text.replace("\r", "\n");

        // 跳过空文本
        if (text.trimmed().isEmpty())
            return;

        // 计算文本哈希
        const QString hash = HashUtil::computeTextHash(text);

        // 准备待处理的文本项
        ClipboardItem item;
        item.id = QDateTime::currentMSecsSinceEpoch();
        item.type = "text";
        item.content = text;
        item.hash = hash;
        item.timestamp = QDateTime::currentDateTime();

        // 添加到待处理队列
        enqueueItem(item, QImage());
    }
}

void ClipboardManager::enqueueItem(const ClipboardItem &item, const QImage &image)
{
    // 检查待处理队列中是否已有相同 hash/type（防抖去重）
    for (int i = 0; i < m_pendingItems.size(); ++i)
    {
        if (m_pendingItems.at(i).hash == item.hash && m_pendingItems.at(i).type == item.type)
        {
            ClipboardItem updated = m_pendingItems.at(i);
            updated.timestamp = item.timestamp;
            if (item.type == QLatin1String("text"))
            {
                updated.content = item.content;
            }
            if (!image.isNull() && m_model && m_model->getStore())
            {
                QString thumbPath;
                const QString imagePath = m_model->getStore()->saveImage(image, thumbPath);
                updated.imagePath = imagePath;
                updated.imageThumb = thumbPath;
            }

            // 移到队尾，代表最新一次变更
            m_pendingItems.removeAt(i);
            m_pendingItems.append(updated);

            // 重置防抖定时器
            if (m_flushTimer)
            {
                m_flushTimer->start(FLUSH_DELAY_MS);
            }
            return;
        }
    }

    // 复制 item 并保存图片（如果有）
    ClipboardItem pendingItem = item;

    if (!image.isNull() && m_model && m_model->getStore())
    {
        // 保存图片到文件
        QString thumbPath;
        const QString imagePath = m_model->getStore()->saveImage(image, thumbPath);
        pendingItem.imagePath = imagePath;
        pendingItem.imageThumb = thumbPath;
    }

    // 添加到待处理队列
    m_pendingItems.append(pendingItem);

    // 启动或重置防抖定时器
    if (m_flushTimer)
    {
        m_flushTimer->start(FLUSH_DELAY_MS);
    }
}

void ClipboardManager::flushPendingItems()
{
    if (m_pendingItems.isEmpty())
        return;

    // 复制并清空队列
    const QVector<ClipboardItem> itemsToProcess = m_pendingItems;
    m_pendingItems.clear();

    // 移除 suppressNextChange（因为我们要主动写入剪贴板）
    m_suppressNext = false;

    // 批量处理每个待处理项
    for (const ClipboardItem &item : itemsToProcess)
    {
        // 添加到模型（带去重）
        if (m_model)
        {
            m_model->addItemWithDeduplication(item);
        }
    }
}

void ClipboardManager::clearPendingItems()
{
    m_pendingItems.clear();
    if (m_flushTimer)
    {
        m_flushTimer->stop();
    }
}

int ClipboardManager::pendingItemCount() const
{
    return m_pendingItems.size();
}

bool ClipboardManager::isSuppressingNext() const
{
    return m_suppressNext;
}

void ClipboardManager::setSuppressNextChange(bool suppress)
{
    m_suppressNext = suppress;
}
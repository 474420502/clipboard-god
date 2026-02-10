#pragma once

#include <QObject>
#include <QVector>
#include <QTimer>

#include "HistoryModel.h"

class ClipboardManager : public QObject
{
    Q_OBJECT

public:
    explicit ClipboardManager(HistoryModel *model, QObject *parent = nullptr);
    ~ClipboardManager();

    void start();
    void stop();
    void suppressNextChange();

    // 防抖相关
    void clearPendingItems();
    int pendingItemCount() const;
    void setSuppressNextChange(bool suppress);
    bool isSuppressingNext() const;

    // 带图片的入队方法
    void enqueueItem(const ClipboardItem &item, const QImage &image = QImage());

    // 常量
    static constexpr int FLUSH_DELAY_MS = 120;

Q_SIGNALS:
    void historyChanged(const QVariantList &items);

private slots:
    void onClipboardChanged();
    void flushPendingItems();

private:
    void enqueueItem(const ClipboardItem &item);

    HistoryModel *m_model;
    QTimer *m_flushTimer;
    QVector<ClipboardItem> m_pendingItems;
    bool m_running = false;
    bool m_suppressNext = false;
};
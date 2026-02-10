#pragma once

#include <QAbstractListModel>
#include <QDateTime>
#include <QVector>
#include <QImage>

// 前向声明
class HistoryStore;

struct ClipboardItem
{
    qint64 id = 0;
    QString itemId;
    QString type;
    QString content;
    QString imagePath;
    QString imageThumb;
    QString hash;
    QDateTime timestamp;
    int pinned = 0;
};

class HistoryModel : public QAbstractListModel
{
    Q_OBJECT
    Q_PROPERTY(int maxHistory READ maxHistory WRITE setMaxHistory NOTIFY maxHistoryChanged)

public:
    enum Roles
    {
        IdRole = Qt::UserRole + 1,
        ItemIdRole,
        TypeRole,
        ContentRole,
        ImagePathRole,
        ImageThumbRole,
        HashRole,
        TimestampRole,
        PinnedRole
    };

    explicit HistoryModel(QObject *parent = nullptr);

    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override;
    QHash<int, QByteArray> roleNames() const override;

    int maxHistory() const;
    void setMaxHistory(int value);

    Q_INVOKABLE void clear();
    Q_INVOKABLE void setPinned(qint64 dbId, bool pinned);
    Q_INVOKABLE void deleteItem(qint64 dbId);
    Q_INVOKABLE void updateTextItem(qint64 dbId, const QString &content, const QString &hash);

    // 旧版接口（向后兼容）
    void addItem(const QString &type, const QString &content);

    // 新版接口（支持所有字段）
    void addItem(const ClipboardItem &item);
    void addItemWithDeduplication(const ClipboardItem &item);

    void setStore(HistoryStore *store);
    HistoryStore *getStore() const { return m_store; }
    void loadFromStore();

    // 获取所有项目的拷贝
    QVector<ClipboardItem> items() const { return m_items; }

signals:
    void maxHistoryChanged();

private:
    QVector<ClipboardItem> m_items;
    int m_maxHistory = 500;
    HistoryStore *m_store = nullptr;
};
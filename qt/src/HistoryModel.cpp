#include "HistoryModel.h"
#include "HistoryStore.h"

HistoryModel::HistoryModel(QObject *parent)
    : QAbstractListModel(parent) {}

int HistoryModel::rowCount(const QModelIndex &parent) const
{
    if (parent.isValid())
        return 0;
    return m_items.size();
}

QVariant HistoryModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() < 0 || index.row() >= m_items.size())
    {
        return {};
    }

    const ClipboardItem &item = m_items.at(index.row());
    switch (role)
    {
    case IdRole:
        return item.id;
    case ItemIdRole:
        return item.itemId;
    case TypeRole:
        return item.type;
    case ContentRole:
        return item.content;
    case ImagePathRole:
        return item.imagePath;
    case ImageThumbRole:
        return item.imageThumb;
    case HashRole:
        return item.hash;
    case TimestampRole:
        return item.timestamp.toString(Qt::ISODate);
    case PinnedRole:
        return item.pinned;
    default:
        return {};
    }
}

QHash<int, QByteArray> HistoryModel::roleNames() const
{
    return {
        {IdRole, "id"},
        {ItemIdRole, "itemId"},
        {TypeRole, "type"},
        {ContentRole, "content"},
        {ImagePathRole, "imagePath"},
        {ImageThumbRole, "imageThumb"},
        {HashRole, "hash"},
        {TimestampRole, "timestamp"},
        {PinnedRole, "pinned"}};
}

int HistoryModel::maxHistory() const
{
    return m_maxHistory;
}

void HistoryModel::setMaxHistory(int value)
{
    if (value <= 0 || value == m_maxHistory)
        return;
    m_maxHistory = value;
    emit maxHistoryChanged();

    if (m_store)
    {
        m_store->trimToLimit(m_maxHistory);
    }
}

void HistoryModel::clear()
{
    if (m_items.isEmpty())
        return;
    beginResetModel();
    m_items.clear();
    endResetModel();

    if (m_store)
    {
        m_store->clear();
    }
}

void HistoryModel::setPinned(qint64 dbId, bool pinned)
{
    if (!m_store)
        return;

    m_store->setPinned(dbId, pinned);

    // 更新本地数据
    for (ClipboardItem &item : m_items)
    {
        if (item.id == dbId)
        {
            item.pinned = pinned ? 1 : 0;
            // 触发重新排序（置顶项目移动到前面）
            emit dataChanged(index(0), index(m_items.size() - 1));
            break;
        }
    }
}

void HistoryModel::deleteItem(qint64 dbId)
{
    // 找到索引
    int row = -1;
    for (int i = 0; i < m_items.size(); ++i)
    {
        if (m_items.at(i).id == dbId)
        {
            row = i;
            break;
        }
    }

    if (row < 0)
        return;

    beginRemoveRows(QModelIndex(), row, row);
    ClipboardItem removed = m_items.takeAt(row);
    endRemoveRows();

    if (m_store)
    {
        m_store->deleteById(dbId);
    }
}

void HistoryModel::updateTextItem(qint64 dbId, const QString &content, const QString &hash)
{
    int row = -1;
    for (int i = 0; i < m_items.size(); ++i)
    {
        if (m_items.at(i).id == dbId)
        {
            row = i;
            break;
        }
    }
    if (row < 0)
        return;

    ClipboardItem updated = m_items.at(row);
    updated.content = content;
    updated.hash = hash;
    updated.timestamp = QDateTime::currentDateTime();

    m_items[row] = updated;
    emit dataChanged(index(row), index(row));

    if (m_store)
    {
        m_store->updateTextItem(dbId, content, hash);
    }
}

// 旧版接口（向后兼容）
void HistoryModel::addItem(const QString &type, const QString &content)
{
    ClipboardItem item;
    item.id = QDateTime::currentMSecsSinceEpoch();
    item.type = type;
    item.content = content;
    item.timestamp = QDateTime::currentDateTime();

    addItem(item);
}

// 新版接口（支持所有字段）
void HistoryModel::addItem(const ClipboardItem &item)
{
    beginInsertRows(QModelIndex(), 0, 0);
    m_items.prepend(item);
    endInsertRows();

    if (m_store)
    {
        m_store->addItem(item);
        m_store->trimToLimit(m_maxHistory);
    }

    if (m_items.size() > m_maxHistory)
    {
        const int last = m_items.size() - 1;
        beginRemoveRows(QModelIndex(), last, last);
        m_items.removeLast();
        endRemoveRows();
    }
}

void HistoryModel::addItemWithDeduplication(const ClipboardItem &item)
{
    if (item.hash.isEmpty())
    {
        addItem(item);
        return;
    }

    // 先更新数据库
    if (m_store && m_store->hasHash(item.hash))
    {
        if (item.pinned == 0)
        {
            m_store->updateTimestampByHash(item.hash);
        }

        // 更新内存并尽量移动到顶部
        int row = -1;
        for (int i = 0; i < m_items.size(); ++i)
        {
            if (m_items.at(i).hash == item.hash)
            {
                row = i;
                break;
            }
        }
        if (row >= 0)
        {
            ClipboardItem updated = m_items.at(row);
            updated.timestamp = item.timestamp;
            if (item.pinned == 0)
            {
                if (row != 0)
                {
                    beginMoveRows(QModelIndex(), row, row, QModelIndex(), 0);
                    m_items.removeAt(row);
                    m_items.prepend(updated);
                    endMoveRows();
                }
                else
                {
                    m_items[0] = updated;
                    emit dataChanged(index(0), index(0));
                }
            }
            else
            {
                m_items[row] = updated;
                emit dataChanged(index(row), index(row));
            }
        }
        return;
    }

    addItem(item);
}

void HistoryModel::setStore(HistoryStore *store)
{
    m_store = store;
}

void HistoryModel::loadFromStore()
{
    if (!m_store)
        return;

    QVector<ClipboardItem> items = m_store->loadLatest(m_maxHistory);
    if (items.isEmpty())
        return;

    beginResetModel();
    m_items = items;
    endResetModel();
}
#include "HistoryFilterModel.h"

#include <QAbstractItemModel>
#include <QRegularExpression>

HistoryFilterModel::HistoryFilterModel(QObject *parent)
    : QSortFilterProxyModel(parent)
{
    setFilterCaseSensitivity(Qt::CaseInsensitive);
    setDynamicSortFilter(true);
    setSortRole(Qt::UserRole + 4);
}

void HistoryFilterModel::setFilterText(const QString &text)
{
    const QString trimmed = text.trimmed();
    if (m_filterText == trimmed)
        return;
    m_filterText = trimmed;
    invalidateFilter();
}

void HistoryFilterModel::setTypeFilter(int type)
{
    if (m_typeFilter == type)
        return;
    m_typeFilter = type;
    invalidateFilter();
}

void HistoryFilterModel::setPinnedOnly(bool pinnedOnly)
{
    if (m_pinnedOnly == pinnedOnly)
        return;
    m_pinnedOnly = pinnedOnly;
    invalidateFilter();
}

void HistoryFilterModel::setSortBy(int sortBy)
{
    if (m_sortBy == sortBy)
        return;
    m_sortBy = sortBy;
    invalidate();
    sort(0);
}

bool HistoryFilterModel::filterAcceptsRow(int sourceRow, const QModelIndex &sourceParent) const
{
    if (m_filterText.isEmpty())
        return true;

    const QModelIndex idx = sourceModel()->index(sourceRow, 0, sourceParent);
    const QString content = sourceModel()->data(idx, Qt::UserRole + 3).toString();   // ContentRole
    const QString type = sourceModel()->data(idx, Qt::UserRole + 2).toString();      // TypeRole
    const QString timestamp = sourceModel()->data(idx, Qt::UserRole + 4).toString(); // TimestampRole
    const int pinned = sourceModel()->data(idx, Qt::UserRole + 5).toInt();           // PinnedRole

    if (m_typeFilter == 1 && type != QLatin1String("text"))
        return false;
    if (m_typeFilter == 2 && type != QLatin1String("image"))
        return false;
    if (m_pinnedOnly && pinned == 0)
        return false;

    const QStringList terms = m_filterText.split(QRegularExpression(QStringLiteral("\\s+")), Qt::SkipEmptyParts);
    if (terms.isEmpty())
        return true;

    for (const QString &term : terms)
    {
        if (content.contains(term, Qt::CaseInsensitive))
            continue;
        if (type.contains(term, Qt::CaseInsensitive))
            continue;
        if (timestamp.contains(term, Qt::CaseInsensitive))
            continue;
        return false;
    }
    return true;
}

bool HistoryFilterModel::lessThan(const QModelIndex &sourceLeft, const QModelIndex &sourceRight) const
{
    if (m_sortBy == 1)
    {
        const QString leftContent = sourceModel()->data(sourceLeft, Qt::UserRole + 3).toString();
        const QString rightContent = sourceModel()->data(sourceRight, Qt::UserRole + 3).toString();
        return leftContent.length() < rightContent.length();
    }

    const QString leftTs = sourceModel()->data(sourceLeft, Qt::UserRole + 4).toString();
    const QString rightTs = sourceModel()->data(sourceRight, Qt::UserRole + 4).toString();
    return leftTs > rightTs;
}

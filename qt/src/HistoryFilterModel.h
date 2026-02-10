#pragma once

#include <QSortFilterProxyModel>

class HistoryFilterModel : public QSortFilterProxyModel
{
    Q_OBJECT

public:
    explicit HistoryFilterModel(QObject *parent = nullptr);

    Q_INVOKABLE void setFilterText(const QString &text);
    Q_INVOKABLE void setTypeFilter(int type);
    Q_INVOKABLE void setPinnedOnly(bool pinnedOnly);
    Q_INVOKABLE void setSortBy(int sortBy);

protected:
    bool filterAcceptsRow(int sourceRow, const QModelIndex &sourceParent) const override;
    bool lessThan(const QModelIndex &sourceLeft, const QModelIndex &sourceRight) const override;

private:
    QString m_filterText;
    int m_typeFilter = 0; // 0: all, 1: text, 2: image
    bool m_pinnedOnly = false;
    int m_sortBy = 0; // 0: time, 1: length
};

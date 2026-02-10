#pragma once

#include <QObject>
#include <QHash>

class LocalizationManager : public QObject
{
    Q_OBJECT

public:
    explicit LocalizationManager(QObject *parent = nullptr);

    Q_INVOKABLE QString t(const QString &key) const;
    Q_INVOKABLE QString locale() const;
    Q_INVOKABLE bool setLocale(const QString &locale);

signals:
    void localeChanged(const QString &locale);

private:
    bool loadLocale(const QString &locale);

    QString m_locale;
    QHash<QString, QString> m_strings;
};

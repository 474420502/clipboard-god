#include "LocalizationManager.h"

#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QDir>
#include <QCoreApplication>

LocalizationManager::LocalizationManager(QObject *parent)
    : QObject(parent), m_locale(QStringLiteral("en"))
{
    loadLocale(m_locale);
}

QString LocalizationManager::t(const QString &key) const
{
    return m_strings.value(key, key);
}

QString LocalizationManager::locale() const
{
    return m_locale;
}

bool LocalizationManager::setLocale(const QString &locale)
{
    if (locale.trimmed().isEmpty() || locale == m_locale)
        return true;

    if (!loadLocale(locale))
        return false;

    m_locale = locale;
    emit localeChanged(m_locale);
    return true;
}

bool LocalizationManager::loadLocale(const QString &locale)
{
    const QString fileName = locale + QLatin1String(".json");
    const QStringList candidates = {
        QLatin1String(":/ClipboardGod/i18n/") + fileName,
        QDir::cleanPath(QDir::currentPath() + QLatin1String("/qt/i18n/")) + fileName,
        QDir::cleanPath(QCoreApplication::applicationDirPath() + QLatin1String("/i18n/")) + fileName,
        QDir::cleanPath(QCoreApplication::applicationDirPath() + QLatin1String("/../i18n/")) + fileName};

    QFile file;
    for (const QString &path : candidates)
    {
        file.setFileName(path);
        if (file.exists() && file.open(QIODevice::ReadOnly))
        {
            break;
        }
    }

    if (!file.isOpen())
        return false;

    const QByteArray raw = file.readAll();
    file.close();

    QJsonParseError err;
    const QJsonDocument doc = QJsonDocument::fromJson(raw, &err);
    if (err.error != QJsonParseError::NoError || !doc.isObject())
        return false;

    m_strings.clear();
    const QJsonObject obj = doc.object();
    for (auto it = obj.begin(); it != obj.end(); ++it)
    {
        m_strings.insert(it.key(), it.value().toString());
    }
    return true;
}

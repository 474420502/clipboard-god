#include "ConfigStore.h"

#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QStandardPaths>

ConfigStore::ConfigStore()
    : m_configPath(resolveConfigPath()), m_config(defaultConfig())
{
}

bool ConfigStore::load()
{
    QFile file(m_configPath);
    if (!file.exists())
    {
        m_config = defaultConfig();
        return save();
    }

    if (!file.open(QIODevice::ReadOnly))
    {
        m_config = defaultConfig();
        return false;
    }

    const QByteArray raw = file.readAll();
    file.close();

    if (raw.trimmed().isEmpty())
    {
        m_config = defaultConfig();
        return save();
    }

    QJsonParseError err;
    const QJsonDocument doc = QJsonDocument::fromJson(raw, &err);
    if (err.error != QJsonParseError::NoError || !doc.isObject())
    {
        m_config = defaultConfig();
        return save();
    }

    m_config = mergeWithDefaults(doc.object());
    return true;
}

bool ConfigStore::save()
{
    const QFileInfo info(m_configPath);
    QDir().mkpath(info.absolutePath());

    QFile file(m_configPath);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate))
    {
        return false;
    }

    const QJsonDocument doc(m_config);
    file.write(doc.toJson(QJsonDocument::Indented));
    file.close();
    return true;
}

QVariant ConfigStore::getValue(const QString &key) const
{
    return m_config.value(key).toVariant();
}

void ConfigStore::setValue(const QString &key, const QVariant &value)
{
    m_config.insert(key, QJsonValue::fromVariant(value));
}

QJsonObject ConfigStore::getAll() const
{
    return m_config;
}

QString ConfigStore::configPath() const
{
    return m_configPath;
}

QJsonObject ConfigStore::defaultConfig() const
{
    QJsonObject defaults;
    defaults.insert("maxHistoryItems", 500);
    defaults.insert("previewLength", 120);
    defaults.insert("customTooltip", false);
    defaults.insert("enableTooltips", true);
    defaults.insert("launchOnStartup", false);
    defaults.insert("pasteShortcut", "numbers");
    defaults.insert("useNumberShortcuts", true);
    defaults.insert("globalShortcut", "CommandOrControl+Alt+V");
    defaults.insert("screenshotShortcut", "CommandOrControl+Shift+S");
    defaults.insert("theme", "light");
    defaults.insert("locale", "en");
    defaults.insert("_selectedLlm", "");
    defaults.insert("llms", QJsonObject());
    return defaults;
}

QString ConfigStore::resolveConfigPath() const
{
    QString basePath;

#ifdef Q_OS_WIN
    basePath = qEnvironmentVariable("APPDATA");
    if (basePath.isEmpty())
        basePath = QStandardPaths::writableLocation(QStandardPaths::ConfigLocation);
#elif defined(Q_OS_MAC)
    basePath = QDir::homePath() + QLatin1String("/Library/Application Support");
#else
    basePath = qEnvironmentVariable("XDG_CONFIG_HOME");
    if (basePath.isEmpty())
        basePath = QStandardPaths::writableLocation(QStandardPaths::ConfigLocation);
#endif

    if (basePath.isEmpty())
        basePath = QDir::homePath() + QLatin1String("/.config");

    const QString appConfigPath = basePath + QLatin1String("/clipboard-god");
    return appConfigPath + QLatin1String("/config.json");
}

QJsonObject ConfigStore::mergeWithDefaults(const QJsonObject &input) const
{
    QJsonObject merged = defaultConfig();
    for (auto it = input.begin(); it != input.end(); ++it)
    {
        merged.insert(it.key(), it.value());
    }
    return merged;
}

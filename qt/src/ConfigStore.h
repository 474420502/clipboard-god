#pragma once

#include <QJsonObject>
#include <QString>
#include <QVariant>

class ConfigStore
{
public:
    ConfigStore();

    bool load();
    bool save();

    QVariant getValue(const QString &key) const;
    void setValue(const QString &key, const QVariant &value);

    QJsonObject getAll() const;

    QString configPath() const;

private:
    QJsonObject defaultConfig() const;
    QString resolveConfigPath() const;
    QJsonObject mergeWithDefaults(const QJsonObject &input) const;

    QString m_configPath;
    QJsonObject m_config;
};

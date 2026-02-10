#pragma once

#include <QObject>
#include <QNetworkAccessManager>
#include <QJsonObject>

class ConfigStore;

class AiManager : public QObject
{
    Q_OBJECT

public:
    explicit AiManager(QObject *parent = nullptr);

    void setConfigStore(ConfigStore *store);
    void sendPrompt(const QString &prompt);
    void sendPromptForLlm(const QString &llmKey, const QString &prompt);
    void sendPromptForLlmWithImage(const QString &llmKey, const QString &prompt, const QString &imageDataUrl);

signals:
    void responseReady(const QString &text);
    void warning(const QString &message);

private:
    QJsonObject resolveLlmEntry() const;
    QJsonObject resolveLlmEntry(const QString &llmKey) const;
    QString resolveOpenApiUrl(const QString &baseUrl) const;
    void sendOpenApiRequest(const QJsonObject &entry, const QString &userPrompt, const QString &imageDataUrl = QString());
    void sendOllamaRequest(const QJsonObject &entry, const QString &userPrompt, const QString &imageDataUrl = QString());

    ConfigStore *m_configStore = nullptr;
    QNetworkAccessManager m_network;
};

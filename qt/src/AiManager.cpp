#include "AiManager.h"
#include "ConfigStore.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QRegularExpression>
#include <QUrl>

AiManager::AiManager(QObject *parent) : QObject(parent) {}

void AiManager::setConfigStore(ConfigStore *store)
{
    m_configStore = store;
}

QJsonObject AiManager::resolveLlmEntry() const
{
    if (!m_configStore)
        return {};

    const QVariant llmsVar = m_configStore->getValue(QStringLiteral("llms"));
    QJsonObject llmsObj;
    if (llmsVar.canConvert<QVariantMap>())
    {
        llmsObj = QJsonObject::fromVariantMap(llmsVar.toMap());
    }
    else if (llmsVar.canConvert<QJsonObject>())
    {
        llmsObj = llmsVar.toJsonObject();
    }

    if (llmsObj.isEmpty())
        return {};

    const QString selected = m_configStore->getValue(QStringLiteral("_selectedLlm")).toString();
    if (!selected.isEmpty() && llmsObj.contains(selected))
    {
        return llmsObj.value(selected).toObject();
    }

    const QString firstKey = llmsObj.keys().isEmpty() ? QString() : llmsObj.keys().first();
    return llmsObj.value(firstKey).toObject();
}

QJsonObject AiManager::resolveLlmEntry(const QString &llmKey) const
{
    if (!m_configStore)
        return {};

    const QVariant llmsVar = m_configStore->getValue(QStringLiteral("llms"));
    QJsonObject llmsObj;
    if (llmsVar.canConvert<QVariantMap>())
    {
        llmsObj = QJsonObject::fromVariantMap(llmsVar.toMap());
    }
    else if (llmsVar.canConvert<QJsonObject>())
    {
        llmsObj = llmsVar.toJsonObject();
    }

    if (llmsObj.isEmpty())
        return {};

    if (!llmKey.isEmpty() && llmsObj.contains(llmKey))
        return llmsObj.value(llmKey).toObject();

    return {};
}

QString AiManager::resolveOpenApiUrl(const QString &baseUrl) const
{
    const QString trimmed = baseUrl.trimmed();
    if (trimmed.isEmpty())
        return {};

    QUrl url(trimmed);
    if (!url.isValid())
        return {};

    const QString path = url.path().toLower();
    if (path.contains(QStringLiteral("/chat/completions")))
        return url.toString();

    if (path.endsWith(QStringLiteral("/v1")) || path.endsWith(QStringLiteral("/v1/")))
    {
        url.setPath(path + QStringLiteral("/chat/completions"));
        return url.toString();
    }

    if (path.isEmpty() || path == QStringLiteral("/"))
    {
        url.setPath(QStringLiteral("/v1/chat/completions"));
        return url.toString();
    }

    url.setPath(path + QStringLiteral("/chat/completions"));
    return url.toString();
}

void AiManager::sendPrompt(const QString &prompt)
{
    const QString trimmed = prompt.trimmed();
    if (trimmed.isEmpty())
    {
        emit responseReady(QString());
        return;
    }

    const QJsonObject entry = resolveLlmEntry();
    if (entry.isEmpty())
    {
        emit warning(QStringLiteral("No LLM configuration found. Please configure llms in config.json"));
        emit responseReady(QStringLiteral(""));
        return;
    }

    const QString apiType = entry.value(QStringLiteral("apitype")).toString(QStringLiteral("ollama")).toLower();
    if (apiType == QStringLiteral("openapi"))
    {
        sendOpenApiRequest(entry, trimmed, QString());
    }
    else
    {
        sendOllamaRequest(entry, trimmed, QString());
    }
}

void AiManager::sendPromptForLlm(const QString &llmKey, const QString &prompt)
{
    const QString trimmed = prompt.trimmed();
    if (trimmed.isEmpty())
    {
        emit responseReady(QString());
        return;
    }

    const QJsonObject entry = resolveLlmEntry(llmKey);
    if (entry.isEmpty())
    {
        emit warning(QStringLiteral("LLM entry not found: ") + llmKey);
        emit responseReady(QString());
        return;
    }

    const QString apiType = entry.value(QStringLiteral("apitype")).toString(QStringLiteral("ollama")).toLower();
    if (apiType == QStringLiteral("openapi"))
    {
        sendOpenApiRequest(entry, trimmed, QString());
    }
    else
    {
        sendOllamaRequest(entry, trimmed, QString());
    }
}

static QString applyPromptTemplate(const QJsonObject &entry, const QString &userPrompt)
{
    QString templateText = entry.value(QStringLiteral("prompt")).toString();
    if (templateText.trimmed().isEmpty())
        return userPrompt;

    QString out = templateText;
    out.replace(QRegularExpression(QStringLiteral("\\{\\{\\s*text\\s*\\}\\}")), userPrompt);
    return out;
}

static QString extractBase64FromDataUrl(const QString &dataUrl)
{
    const int commaIdx = dataUrl.indexOf(QLatin1Char(','));
    if (commaIdx <= 0)
        return {};
    return dataUrl.mid(commaIdx + 1);
}

void AiManager::sendOpenApiRequest(const QJsonObject &entry, const QString &userPrompt, const QString &imageDataUrl)
{
    const QString baseUrl = entry.value(QStringLiteral("baseurl")).toString();
    const QString apiKey = entry.value(QStringLiteral("apikey")).toString();
    const QString model = entry.value(QStringLiteral("model")).toString();

    const QString urlStr = resolveOpenApiUrl(baseUrl);
    if (urlStr.isEmpty() || model.isEmpty())
    {
        emit warning(QStringLiteral("OpenAPI config missing baseurl or model"));
        emit responseReady(QString());
        return;
    }

    QJsonObject body;
    body.insert(QStringLiteral("model"), model);

    const QString prompt = applyPromptTemplate(entry, userPrompt);
    QJsonArray messages;
    QJsonObject userMsg;
    userMsg.insert(QStringLiteral("role"), QStringLiteral("user"));

    if (!imageDataUrl.trimmed().isEmpty())
    {
        QJsonArray parts;
        if (!prompt.trimmed().isEmpty())
        {
            QJsonObject textPart;
            textPart.insert(QStringLiteral("type"), QStringLiteral("text"));
            textPart.insert(QStringLiteral("text"), prompt);
            parts.append(textPart);
        }
        QJsonObject imgPart;
        imgPart.insert(QStringLiteral("type"), QStringLiteral("image_url"));
        QJsonObject imageUrl;
        imageUrl.insert(QStringLiteral("url"), imageDataUrl);
        imgPart.insert(QStringLiteral("image_url"), imageUrl);
        parts.append(imgPart);
        userMsg.insert(QStringLiteral("content"), parts);
    }
    else
    {
        userMsg.insert(QStringLiteral("content"), prompt);
    }

    messages.append(userMsg);
    body.insert(QStringLiteral("messages"), messages);

    if (entry.contains(QStringLiteral("temperature")))
        body.insert(QStringLiteral("temperature"), entry.value(QStringLiteral("temperature")));
    if (entry.contains(QStringLiteral("top_p")))
        body.insert(QStringLiteral("top_p"), entry.value(QStringLiteral("top_p")));
    if (entry.contains(QStringLiteral("max_tokens")))
        body.insert(QStringLiteral("max_tokens"), entry.value(QStringLiteral("max_tokens")));
    if (entry.contains(QStringLiteral("presence_penalty")))
        body.insert(QStringLiteral("presence_penalty"), entry.value(QStringLiteral("presence_penalty")));

    QNetworkRequest req{QUrl(urlStr)};
    req.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    if (!apiKey.isEmpty())
    {
        if (urlStr.contains(QStringLiteral(".azure.")))
            req.setRawHeader("api-key", apiKey.toUtf8());
        else
            req.setRawHeader("Authorization", QByteArray("Bearer ") + apiKey.toUtf8());
    }

    QNetworkReply *reply = m_network.post(req, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply]()
            {
        const QByteArray raw = reply->readAll();
        const QNetworkReply::NetworkError err = reply->error();
        reply->deleteLater();

        if (err != QNetworkReply::NoError)
        {
            emit warning(QStringLiteral("AI request failed: ") + reply->errorString());
            emit responseReady(QString());
            return;
        }

        QJsonParseError parseError;
        const QJsonDocument doc = QJsonDocument::fromJson(raw, &parseError);
        if (parseError.error != QJsonParseError::NoError || !doc.isObject())
        {
            emit warning(QStringLiteral("Invalid AI response"));
            emit responseReady(QString());
            return;
        }

        const QJsonObject obj = doc.object();
        const QJsonArray choices = obj.value(QStringLiteral("choices")).toArray();
        if (choices.isEmpty())
        {
            emit responseReady(QString());
            return;
        }
        const QJsonObject choice = choices.first().toObject();
        const QJsonObject message = choice.value(QStringLiteral("message")).toObject();
        const QString content = message.value(QStringLiteral("content")).toString();
        emit responseReady(content); });
}

void AiManager::sendOllamaRequest(const QJsonObject &entry, const QString &userPrompt, const QString &imageDataUrl)
{
    const QString baseUrl = entry.value(QStringLiteral("baseurl")).toString();
    const QString apiKey = entry.value(QStringLiteral("apikey")).toString();
    const QString model = entry.value(QStringLiteral("model")).toString();

    if (baseUrl.trimmed().isEmpty() || model.trimmed().isEmpty())
    {
        emit warning(QStringLiteral("Ollama config missing baseurl or model"));
        emit responseReady(QString());
        return;
    }

    QUrl url(baseUrl);
    url.setPath(QStringLiteral("/api/chat"));

    QJsonObject body;
    body.insert(QStringLiteral("model"), model);

    const QString prompt = applyPromptTemplate(entry, userPrompt);
    QJsonArray messages;
    QJsonObject userMsg;
    userMsg.insert(QStringLiteral("role"), QStringLiteral("user"));
    userMsg.insert(QStringLiteral("content"), prompt);

    if (!imageDataUrl.trimmed().isEmpty())
    {
        const QString raw = extractBase64FromDataUrl(imageDataUrl);
        if (!raw.isEmpty())
        {
            QJsonArray images;
            images.append(raw);
            userMsg.insert(QStringLiteral("images"), images);
        }
    }

    messages.append(userMsg);
    body.insert(QStringLiteral("messages"), messages);
    body.insert(QStringLiteral("stream"), false);

    QJsonObject options;
    if (entry.contains(QStringLiteral("temperature")))
        options.insert(QStringLiteral("temperature"), entry.value(QStringLiteral("temperature")));
    if (entry.contains(QStringLiteral("top_p")))
        options.insert(QStringLiteral("top_p"), entry.value(QStringLiteral("top_p")));
    if (entry.contains(QStringLiteral("top_k")))
        options.insert(QStringLiteral("top_k"), entry.value(QStringLiteral("top_k")));
    if (entry.contains(QStringLiteral("context_window")))
        options.insert(QStringLiteral("num_ctx"), entry.value(QStringLiteral("context_window")));
    if (entry.contains(QStringLiteral("max_tokens")))
        options.insert(QStringLiteral("num_predict"), entry.value(QStringLiteral("max_tokens")));
    if (entry.contains(QStringLiteral("min_p")))
        options.insert(QStringLiteral("min_p"), entry.value(QStringLiteral("min_p")));
    if (entry.contains(QStringLiteral("presence_penalty")))
        options.insert(QStringLiteral("presence_penalty"), entry.value(QStringLiteral("presence_penalty")));

    if (!options.isEmpty())
        body.insert(QStringLiteral("options"), options);

    QNetworkRequest req(url);
    req.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    if (!apiKey.isEmpty())
    {
        req.setRawHeader("Authorization", QByteArray("Bearer ") + apiKey.toUtf8());
    }

    QNetworkReply *reply = m_network.post(req, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply]()
            {
        const QByteArray raw = reply->readAll();
        const QNetworkReply::NetworkError err = reply->error();
        reply->deleteLater();

        if (err != QNetworkReply::NoError)
        {
            emit warning(QStringLiteral("AI request failed: ") + reply->errorString());
            emit responseReady(QString());
            return;
        }

        QJsonParseError parseError;
        const QJsonDocument doc = QJsonDocument::fromJson(raw, &parseError);
        if (parseError.error != QJsonParseError::NoError || !doc.isObject())
        {
            emit warning(QStringLiteral("Invalid AI response"));
            emit responseReady(QString());
            return;
        }

        const QJsonObject obj = doc.object();
        const QJsonObject message = obj.value(QStringLiteral("message")).toObject();
        const QString content = message.value(QStringLiteral("content")).toString();
        emit responseReady(content); });
}

void AiManager::sendPromptForLlmWithImage(const QString &llmKey, const QString &prompt, const QString &imageDataUrl)
{
    const QString trimmed = prompt.trimmed();
    if (trimmed.isEmpty() && imageDataUrl.trimmed().isEmpty())
    {
        emit responseReady(QString());
        return;
    }

    const QJsonObject entry = resolveLlmEntry(llmKey);
    if (entry.isEmpty())
    {
        emit warning(QStringLiteral("LLM entry not found: ") + llmKey);
        emit responseReady(QString());
        return;
    }

    const QString apiType = entry.value(QStringLiteral("apitype")).toString(QStringLiteral("ollama")).toLower();
    if (apiType == QStringLiteral("openapi"))
    {
        sendOpenApiRequest(entry, trimmed, imageDataUrl);
    }
    else
    {
        sendOllamaRequest(entry, trimmed, imageDataUrl);
    }
}

#include "AppController.h"

#include <QGuiApplication>
#include <QScreen>
#include <QClipboard>
#include <QJsonObject>
#include <QBuffer>
#include <QImage>
#include <QByteArray>
#include <QFileInfo>
#include <QUrl>
#include <QDesktopServices>
#include <QFileDialog>
#include <QStandardPaths>
#include <QFile>
#include <QQuickView>
#include <QQuickItem>
#include <QQmlContext>
#include <QScreen>

#include "HashUtil.h"

namespace
{
    QString sanitizeShortcutString(const QString &shortcut)
    {
        const QString trimmed = shortcut.trimmed();
        if (trimmed.isEmpty())
            return QString();

        for (const QChar &ch : trimmed)
        {
            const ushort code = ch.unicode();
            if (code < 0x20 || code == 0x7F || ch.category() == QChar::Other_Control)
                return QString();
        }

        return trimmed;
    }
}

AppController::AppController(QObject *parent)
    : QObject(parent),
      m_historyModel(),
      m_historyFilter(),
      m_historyStore(),
      m_configStore(),
      m_i18n(),
      m_clipboardManager(&m_historyModel, this),
      m_trayManager(this),
      m_screenshotManager(this),
      m_pasteManager(this),
      m_hotkeyManager(this),
      m_aiManager(this)
{

    connect(&m_trayManager, &TrayManager::toggleRequested, this, &AppController::onTrayToggle);
    connect(&m_trayManager, &TrayManager::quitRequested, this, &AppController::onTrayQuit);
    connect(&m_hotkeyManager, &HotkeyManager::warning, this, &AppController::onHotkeyWarning);
    connect(&m_hotkeyManager, &HotkeyManager::toggleRequested, this, &AppController::onHotkeyToggle);
    connect(&m_hotkeyManager, &HotkeyManager::screenshotRequested, this, &AppController::onHotkeyScreenshot);
    connect(&m_hotkeyManager, &HotkeyManager::pasteRequested, this, &AppController::onPasteHotkeyRequested);
    connect(&m_hotkeyManager, &HotkeyManager::llmRequested, this, &AppController::onLlmHotkeyRequested);
    connect(&m_aiManager, &AiManager::responseReady, this, &AppController::onAiResponse);
    connect(&m_pasteManager, &PasteManager::warning, this, &AppController::onHotkeyWarning);
    connect(&m_screenshotManager, &ScreenshotManager::screenshotCaptured, this, &AppController::screenshotReady);
    connect(&m_screenshotManager, &ScreenshotManager::screenshotFailed, this, &AppController::warning);

    m_configStore.load();
    const QString locale = m_configStore.getValue("locale").toString();
    if (!locale.isEmpty())
    {
        m_i18n.setLocale(locale);
    }
    m_aiManager.setConfigStore(&m_configStore);
    const int maxHistory = m_configStore.getValue("maxHistoryItems").toInt();
    if (maxHistory > 0)
    {
        m_historyModel.setMaxHistory(maxHistory);
    }

    if (m_historyStore.init())
    {
        m_historyModel.setStore(&m_historyStore);
        m_historyModel.loadFromStore();
    }

    m_historyFilter.setSourceModel(&m_historyModel);

    m_trayManager.init();
    const QString rawToggleShortcut = m_configStore.getValue("globalShortcut").toString();
    const QString rawScreenshotShortcut = m_configStore.getValue("screenshotShortcut").toString();
    const QString toggleShortcut = sanitizeShortcutString(rawToggleShortcut);
    const QString screenshotShortcut = sanitizeShortcutString(rawScreenshotShortcut);
    const QString defaultToggleShortcut = QStringLiteral("CommandOrControl+Alt+V");
    const QString defaultScreenshotShortcut = QStringLiteral("CommandOrControl+Shift+S");
    if (!rawToggleShortcut.isEmpty() && toggleShortcut.isEmpty())
    {
        m_configStore.setValue("globalShortcut", defaultToggleShortcut);
        m_configStore.save();
    }
    if (!rawScreenshotShortcut.isEmpty() && screenshotShortcut.isEmpty())
    {
        m_configStore.setValue("screenshotShortcut", defaultScreenshotShortcut);
        m_configStore.save();
    }
    m_hotkeyManager.registerDefaultShortcuts(
        toggleShortcut.isEmpty() ? defaultToggleShortcut : toggleShortcut,
        screenshotShortcut.isEmpty() ? defaultScreenshotShortcut : screenshotShortcut);
    const QString rawPasteShortcut = m_configStore.getValue("pasteShortcut").toString();
    const QString pasteShortcut = sanitizeShortcutString(rawPasteShortcut);
    if (!rawPasteShortcut.isEmpty() && pasteShortcut.isEmpty())
    {
        m_configStore.setValue("pasteShortcut", QStringLiteral("numbers"));
        m_configStore.save();
    }
    if (!pasteShortcut.isEmpty() && pasteShortcut != QStringLiteral("numbers"))
    {
        m_hotkeyManager.registerPasteShortcut(pasteShortcut);
    }
    registerLlmHotkeysFromConfig();

    // 设置 PasteManager 的 ClipboardManager 引用
    m_pasteManager.setClipboardManager(&m_clipboardManager);

    // 连接 PasteManager 信号
    connect(&m_pasteManager, &PasteManager::pasteSuccess, this, []()
            { qDebug("Paste completed successfully"); });
    connect(&m_pasteManager, &PasteManager::pasteFailed, this, [](const QString &reason)
            { qWarning() << "Paste failed:" << reason; });

    m_clipboardManager.start();
}

HistoryModel *AppController::historyModel()
{
    return &m_historyModel;
}

HistoryFilterModel *AppController::filteredHistoryModel()
{
    return &m_historyFilter;
}

LocalizationManager *AppController::i18n()
{
    return &m_i18n;
}

void AppController::setMainWindow(QObject *windowObject)
{
    QWindow *window = qobject_cast<QWindow *>(windowObject);
    if (window)
    {
        m_mainWindow = window;
        connect(m_mainWindow.data(), &QWindow::visibleChanged, this, [this]()
                {
            if (m_mainWindow && !m_mainWindow->isVisible())
            {
                hideTooltip();
            } });
    }
}

void AppController::ensureTooltipWindow()
{
    if (m_tooltipWindow && !m_tooltipWindow->isVisible())
    {
        // exists
        return;
    }

    if (m_tooltipWindow)
    {
        return;
    }

    QQuickView *view = new QQuickView();
    view->setFlags(Qt::Tool | Qt::FramelessWindowHint | Qt::WindowStaysOnTopHint);
    view->setColor(Qt::transparent);
    view->setResizeMode(QQuickView::SizeRootObjectToView);
    view->setSource(QUrl(QStringLiteral("qrc:/ClipboardGod/qml/TooltipWindow.qml")));
    m_tooltipWindow = view;
}

static QString toImageUrlString(const QString &value)
{
    if (value.isEmpty())
        return value;
    if (value.startsWith(QStringLiteral("file://")) || value.startsWith(QStringLiteral("qrc:/")) ||
        value.startsWith(QStringLiteral("image://")) || value.startsWith(QStringLiteral("data:")))
        return value;
    if (value.startsWith(QLatin1Char('/')))
        return QStringLiteral("file://") + value;
    return value;
}

void AppController::updateTooltipContent(const QString &type, const QString &content)
{
    if (!m_tooltipWindow)
        return;

    QQuickView *view = qobject_cast<QQuickView *>(m_tooltipWindow.data());
    if (!view)
        return;

    QObject *root = view->rootObject();
    if (!root)
        return;

    root->setProperty("tooltipType", type);
    if (type == QLatin1String("image"))
    {
        root->setProperty("tooltipImage", toImageUrlString(content));
        root->setProperty("tooltipContent", QString());
        view->resize(460, 320);
    }
    else
    {
        root->setProperty("tooltipContent", content);
        root->setProperty("tooltipImage", QString());
        view->resize(420, 200);
    }
}

void AppController::positionTooltipWindow()
{
    if (!m_tooltipWindow || !m_mainWindow)
        return;

    QQuickView *view = qobject_cast<QQuickView *>(m_tooltipWindow.data());
    if (!view)
        return;

    const QRect mainBounds = m_mainWindow->geometry();
    QScreen *screen = m_mainWindow->screen() ? m_mainWindow->screen() : QGuiApplication::primaryScreen();
    if (!screen)
        return;

    const QRect workArea = screen->availableGeometry();
    const int tooltipWidth = view->width();
    const int tooltipHeight = view->height();
    const int offsetX = 8;

    const int spaceRight = workArea.x() + workArea.width() - (mainBounds.x() + mainBounds.width());
    const int spaceLeft = mainBounds.x() - workArea.x();
    const bool placeRight = spaceRight >= tooltipWidth || spaceRight >= spaceLeft;

    int x = placeRight ? (mainBounds.x() + mainBounds.width() + offsetX)
                       : (mainBounds.x() - tooltipWidth - offsetX);
    int y = mainBounds.y();

    if (y + tooltipHeight > workArea.y() + workArea.height())
        y = workArea.y() + workArea.height() - tooltipHeight - 8;
    if (y < workArea.y())
        y = workArea.y() + 8;

    if (x + tooltipWidth > workArea.x() + workArea.width())
        x = workArea.x() + workArea.width() - tooltipWidth - 8;
    if (x < workArea.x())
        x = workArea.x() + 8;

    view->setPosition(QPoint(x, y));
}

void AppController::showTooltip(const QString &type, const QString &content, const QVariantMap &anchorRect)
{
    Q_UNUSED(anchorRect);
    const QVariant enabled = m_configStore.getValue("enableTooltips");
    if (enabled.isValid() && enabled.toBool() == false)
        return;

    ensureTooltipWindow();
    updateTooltipContent(type, content);
    positionTooltipWindow();

    if (m_tooltipWindow)
    {
        m_tooltipWindow->show();
    }
}

void AppController::hideTooltip()
{
    if (m_tooltipWindow)
    {
        m_tooltipWindow->hide();
    }
}

void AppController::showWindow()
{
    if (m_mainWindow)
    {
        m_mainWindow->show();
        m_mainWindow->raise();
        m_mainWindow->requestActivate();
    }
}

void AppController::hideWindow()
{
    if (m_mainWindow)
    {
        m_mainWindow->hide();
    }
}

void AppController::toggleWindow()
{
    if (!m_mainWindow)
        return;
    if (m_mainWindow->isVisible())
    {
        m_mainWindow->hide();
    }
    else
    {
        m_mainWindow->show();
        m_mainWindow->raise();
        m_mainWindow->requestActivate();
    }
}

void AppController::requestScreenshot()
{
    QString dataUrl = m_screenshotManager.captureSelectionDataUrl();
    if (dataUrl.isEmpty())
    {
        dataUrl = m_screenshotManager.captureFullScreenDataUrl();
    }
    if (!dataUrl.isEmpty())
    {
        emit screenshotReady(dataUrl);
    }
    else
    {
        emit warning(QStringLiteral("Screenshot capture failed"));
    }
}

void AppController::requestAi(const QString &prompt)
{
    m_aiManager.sendPrompt(prompt);
}

void AppController::copyItem(const QString &type, const QString &content)
{
    QClipboard *clipboard = QGuiApplication::clipboard();
    if (!clipboard)
    {
        emit warning(QStringLiteral("Clipboard not available"));
        return;
    }

    m_clipboardManager.suppressNextChange();

    if (type == QLatin1String("image"))
    {
        QImage image;

        if (content.startsWith(QStringLiteral("data:image/")))
        {
            const int commaIdx = content.indexOf(QLatin1Char(','));
            if (commaIdx <= 0)
            {
                emit warning(QStringLiteral("Invalid image data"));
                return;
            }
            const QByteArray bytes = QByteArray::fromBase64(content.mid(commaIdx + 1).toUtf8());
            image.loadFromData(bytes);
        }
        else
        {
            QString filePath = content;
            if (content.startsWith(QStringLiteral("file://")))
            {
                filePath = QUrl(content).toLocalFile();
            }
            if (!filePath.isEmpty() && QFileInfo::exists(filePath))
            {
                image.load(filePath);
            }
        }

        if (image.isNull())
        {
            emit warning(QStringLiteral("Invalid image data"));
            return;
        }
        clipboard->setImage(image);
        return;
    }

    if (content.trimmed().isEmpty())
    {
        emit warning(QStringLiteral("Clipboard text is empty"));
        return;
    }
    clipboard->setText(content);
}

void AppController::pasteClipboard()
{
    if (!m_pasteManager.paste())
    {
        emit warning(QStringLiteral("Paste automation failed"));
    }
}

bool AppController::pasteItem(qint64 dbId)
{
    // 从历史模型获取指定项目
    const HistoryModel *model = historyModel();
    if (!model)
        return false;

    // 查找指定 ID 的项目
    const QVector<ClipboardItem> items = model->items();
    for (const ClipboardItem &item : items)
    {
        if (item.id == dbId)
        {
            // 使用 PasteManager 的 writeAndPaste 方法
            return m_pasteManager.writeAndPaste(item);
        }
    }

    emit warning(QStringLiteral("Item not found"));
    return false;
}

void AppController::togglePin(qint64 dbId, bool pinned)
{
    m_historyModel.setPinned(dbId, pinned);
}

void AppController::deleteItem(qint64 dbId)
{
    m_historyModel.deleteItem(dbId);
}

void AppController::updateTextItem(qint64 dbId, const QString &content)
{
    const QString normalized = content;
    const QString hash = HashUtil::computeTextHash(normalized);
    m_historyModel.updateTextItem(dbId, normalized, hash);
}

static bool loadImageFromItem(const ClipboardItem &item, QImage &image)
{
    if (!item.imagePath.isEmpty())
    {
        return image.load(item.imagePath);
    }
    if (item.content.startsWith(QStringLiteral("data:image/")))
    {
        const int commaIdx = item.content.indexOf(QLatin1Char(','));
        if (commaIdx <= 0)
            return false;
        const QByteArray bytes = QByteArray::fromBase64(item.content.mid(commaIdx + 1).toUtf8());
        return image.loadFromData(bytes);
    }
    return false;
}

void AppController::openImage(qint64 dbId)
{
    const QVector<ClipboardItem> items = m_historyModel.items();
    for (const ClipboardItem &item : items)
    {
        if (item.id != dbId)
            continue;

        if (!item.imagePath.isEmpty())
        {
            QDesktopServices::openUrl(QUrl::fromLocalFile(item.imagePath));
            return;
        }

        QImage image;
        if (!loadImageFromItem(item, image))
        {
            emit warning(QStringLiteral("Invalid image data"));
            return;
        }

        const QString tempDir = QStandardPaths::writableLocation(QStandardPaths::TempLocation);
        QDir().mkpath(tempDir);
        const QString tempPath = tempDir + QLatin1String("/clipboard-god-preview-") + HashUtil::computeImageHash(image) + QLatin1String(".png");
        image.save(tempPath, "PNG");
        QDesktopServices::openUrl(QUrl::fromLocalFile(tempPath));
        return;
    }
}

void AppController::saveImageAs(qint64 dbId)
{
    const QVector<ClipboardItem> items = m_historyModel.items();
    for (const ClipboardItem &item : items)
    {
        if (item.id != dbId)
            continue;

        QImage image;
        if (!loadImageFromItem(item, image))
        {
            emit warning(QStringLiteral("Invalid image data"));
            return;
        }

        const QString defaultDir = QStandardPaths::writableLocation(QStandardPaths::PicturesLocation);
        const QString filePath = QFileDialog::getSaveFileName(nullptr, tr("Save Image"), defaultDir, tr("Images (*.png *.jpg *.jpeg *.bmp)"));
        if (filePath.isEmpty())
            return;

        if (!image.save(filePath))
        {
            emit warning(QStringLiteral("Save image failed"));
        }
        return;
    }
}

void AppController::setHistoryFilter(const QString &text)
{
    m_historyFilter.setFilterText(text);
}

QVariant AppController::getConfig(const QString &key)
{
    return m_configStore.getValue(key);
}

bool AppController::setConfig(const QString &key, const QVariant &value)
{
    m_configStore.setValue(key, value);
    const bool ok = m_configStore.save();
    if (ok)
    {
        if (key == QLatin1String("maxHistoryItems"))
        {
            const int maxHistory = value.toInt();
            if (maxHistory > 0)
            {
                m_historyModel.setMaxHistory(maxHistory);
            }
        }
        else if (key == QLatin1String("globalShortcut") || key == QLatin1String("screenshotShortcut"))
        {
            const QString rawToggleShortcut = m_configStore.getValue("globalShortcut").toString();
            const QString rawScreenshotShortcut = m_configStore.getValue("screenshotShortcut").toString();
            const QString toggleShortcut = sanitizeShortcutString(rawToggleShortcut);
            const QString screenshotShortcut = sanitizeShortcutString(rawScreenshotShortcut);
            const QString defaultToggleShortcut = QStringLiteral("CommandOrControl+Alt+V");
            const QString defaultScreenshotShortcut = QStringLiteral("CommandOrControl+Shift+S");
            if (!rawToggleShortcut.isEmpty() && toggleShortcut.isEmpty())
            {
                m_configStore.setValue("globalShortcut", defaultToggleShortcut);
                m_configStore.save();
            }
            if (!rawScreenshotShortcut.isEmpty() && screenshotShortcut.isEmpty())
            {
                m_configStore.setValue("screenshotShortcut", defaultScreenshotShortcut);
                m_configStore.save();
            }
            m_hotkeyManager.registerDefaultShortcuts(
                toggleShortcut.isEmpty() ? defaultToggleShortcut : toggleShortcut,
                screenshotShortcut.isEmpty() ? defaultScreenshotShortcut : screenshotShortcut);
        }
        else if (key == QLatin1String("pasteShortcut"))
        {
            const QString rawPasteShortcut = m_configStore.getValue("pasteShortcut").toString();
            const QString pasteShortcut = sanitizeShortcutString(rawPasteShortcut);
            if (!rawPasteShortcut.isEmpty() && pasteShortcut.isEmpty())
            {
                m_configStore.setValue("pasteShortcut", QStringLiteral("numbers"));
                m_configStore.save();
            }
            if (!pasteShortcut.isEmpty() && pasteShortcut != QStringLiteral("numbers"))
            {
                m_hotkeyManager.registerPasteShortcut(pasteShortcut);
            }
        }
        else if (key == QLatin1String("llms"))
        {
            registerLlmHotkeysFromConfig();
        }
        else if (key == QLatin1String("locale"))
        {
            m_i18n.setLocale(value.toString());
        }
        emit configChanged(key, value);
    }
    return ok;
}

void AppController::onTrayToggle()
{
    toggleWindow();
}

void AppController::onTrayQuit()
{
    QCoreApplication::quit();
}

void AppController::onHotkeyWarning(const QString &message)
{
    emit warning(message);
}

void AppController::onAiResponse(const QString &text)
{
    emit aiResponseReady(text);
}

void AppController::onHotkeyToggle()
{
    toggleWindow();
}

void AppController::onHotkeyScreenshot()
{
    requestScreenshot();
}

void AppController::onPasteHotkeyRequested()
{
    pasteClipboard();
}

void AppController::registerLlmHotkeysFromConfig()
{
    const QVariant llmsVar = m_configStore.getValue(QStringLiteral("llms"));
    QJsonObject llmsObj;
    if (llmsVar.canConvert<QVariantMap>())
    {
        llmsObj = QJsonObject::fromVariantMap(llmsVar.toMap());
    }
    else if (llmsVar.canConvert<QJsonObject>())
    {
        llmsObj = llmsVar.toJsonObject();
    }

    QHash<QString, QString> shortcuts;
    for (auto it = llmsObj.begin(); it != llmsObj.end(); ++it)
    {
        const QString llmKey = it.key();
        const QJsonObject entry = it.value().toObject();
        const QString shortcut = entry.value(QStringLiteral("llmShortcut")).toString();
        if (!shortcut.trimmed().isEmpty())
        {
            shortcuts.insert(llmKey, shortcut);
        }
    }
    m_hotkeyManager.registerLlmShortcuts(shortcuts);
}

void AppController::onLlmHotkeyRequested(const QString &llmKey)
{
    QJsonObject entry;
    const QVariant llmsVar = m_configStore.getValue(QStringLiteral("llms"));
    if (llmsVar.canConvert<QVariantMap>())
    {
        const QJsonObject llmsObj = QJsonObject::fromVariantMap(llmsVar.toMap());
        entry = llmsObj.value(llmKey).toObject();
    }
    else if (llmsVar.canConvert<QJsonObject>())
    {
        const QJsonObject llmsObj = llmsVar.toJsonObject();
        entry = llmsObj.value(llmKey).toObject();
    }

    const QString triggerType = entry.value(QStringLiteral("triggerType")).toString(QStringLiteral("text")).toLower();
    QClipboard *clipboard = QGuiApplication::clipboard();

    if (triggerType == QStringLiteral("image"))
    {
        QString imageDataUrl;
        if (clipboard && !clipboard->image().isNull())
        {
            const QImage image = clipboard->image();
            QByteArray bytes;
            QBuffer buffer(&bytes);
            buffer.open(QIODevice::WriteOnly);
            image.save(&buffer, "PNG");
            imageDataUrl = QStringLiteral("data:image/png;base64,") + QString::fromLatin1(bytes.toBase64());
        }
        if (imageDataUrl.isEmpty())
        {
            imageDataUrl = m_screenshotManager.captureFullScreenDataUrl();
        }
        if (imageDataUrl.isEmpty())
        {
            emit warning(QStringLiteral("No image available for LLM"));
            return;
        }
        m_aiManager.sendPromptForLlmWithImage(llmKey, QString(), imageDataUrl);
        return;
    }

    QString prompt;
    if (clipboard)
    {
        prompt = clipboard->text();
    }
    if (prompt.trimmed().isEmpty())
    {
        emit warning(QStringLiteral("Clipboard is empty"));
        return;
    }
    m_aiManager.sendPromptForLlm(llmKey, prompt);
}

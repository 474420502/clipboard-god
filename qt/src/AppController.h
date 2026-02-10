#pragma once

#include <QObject>
#include <QPointer>
#include <QWindow>
#include <QVariantMap>

#include "ClipboardManager.h"
#include "HistoryModel.h"
#include "HistoryFilterModel.h"
#include "HistoryStore.h"
#include "TrayManager.h"
#include "ScreenshotManager.h"
#include "HotkeyManager.h"
#include "AiManager.h"
#include "ConfigStore.h"
#include "LocalizationManager.h"
#include "PasteManager.h"

class AppController : public QObject
{
    Q_OBJECT
    Q_PROPERTY(HistoryModel *historyModel READ historyModel CONSTANT)
    Q_PROPERTY(HistoryFilterModel *filteredHistoryModel READ filteredHistoryModel CONSTANT)
    Q_PROPERTY(LocalizationManager *i18n READ i18n CONSTANT)

public:
    explicit AppController(QObject *parent = nullptr);

    HistoryModel *historyModel();
    HistoryFilterModel *filteredHistoryModel();
    LocalizationManager *i18n();

    Q_INVOKABLE void setMainWindow(QObject *windowObject);
    Q_INVOKABLE void showWindow();
    Q_INVOKABLE void hideWindow();
    Q_INVOKABLE void toggleWindow();
    Q_INVOKABLE void requestScreenshot();
    Q_INVOKABLE void requestAi(const QString &prompt);
    Q_INVOKABLE void copyItem(const QString &type, const QString &content);
    Q_INVOKABLE void pasteClipboard();
    Q_INVOKABLE bool pasteItem(qint64 dbId); // 粘贴指定的历史项目
    Q_INVOKABLE void togglePin(qint64 dbId, bool pinned);
    Q_INVOKABLE void deleteItem(qint64 dbId);
    Q_INVOKABLE void updateTextItem(qint64 dbId, const QString &content);
    Q_INVOKABLE void openImage(qint64 dbId);
    Q_INVOKABLE void saveImageAs(qint64 dbId);
    Q_INVOKABLE void setHistoryFilter(const QString &text);
    Q_INVOKABLE QVariant getConfig(const QString &key);
    Q_INVOKABLE bool setConfig(const QString &key, const QVariant &value);
    Q_INVOKABLE void showTooltip(const QString &type, const QString &content, const QVariantMap &anchorRect);
    Q_INVOKABLE void hideTooltip();

signals:
    void screenshotReady(const QString &dataUrl);
    void aiResponseReady(const QString &text);
    void warning(const QString &message);
    void configChanged(const QString &key, const QVariant &value);

private slots:
    void onTrayToggle();
    void onTrayQuit();
    void onHotkeyWarning(const QString &message);
    void onAiResponse(const QString &text);
    void onHotkeyToggle();
    void onHotkeyScreenshot();
    void onLlmHotkeyRequested(const QString &llmKey);
    void onPasteHotkeyRequested();

private:
    void registerLlmHotkeysFromConfig();
    void ensureTooltipWindow();
    void updateTooltipContent(const QString &type, const QString &content);
    void positionTooltipWindow();

    QPointer<QWindow> m_mainWindow;
    QPointer<QWindow> m_tooltipWindow;
    QVariantMap m_tooltipAnchor;
    QString m_tooltipType;
    QString m_tooltipContent;
    HistoryModel m_historyModel;
    HistoryFilterModel m_historyFilter;
    HistoryStore m_historyStore;
    ConfigStore m_configStore;
    LocalizationManager m_i18n;
    ClipboardManager m_clipboardManager;
    TrayManager m_trayManager;
    ScreenshotManager m_screenshotManager;
    PasteManager m_pasteManager;
    HotkeyManager m_hotkeyManager;
    AiManager m_aiManager;
};

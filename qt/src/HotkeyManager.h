#pragma once

#include <QObject>
#include <QHash>
#include <QString>

#ifdef USE_QHOTKEY
#include <QHotkey>
#endif

class HotkeyManager : public QObject
{
    Q_OBJECT

public:
    explicit HotkeyManager(QObject *parent = nullptr);

    void registerDefaultShortcuts(const QString &toggleShortcut, const QString &screenshotShortcut);
    void registerLlmShortcuts(const QHash<QString, QString> &shortcuts);
    void registerPasteShortcut(const QString &shortcut);

signals:
    void toggleRequested();
    void screenshotRequested();
    void llmRequested(const QString &llmKey);
    void pasteRequested();
    void warning(const QString &message);

private:
#ifdef USE_QHOTKEY
    QHotkey *m_toggleHotkey = nullptr;
    QHotkey *m_screenshotHotkey = nullptr;
    QHotkey *m_pasteHotkey = nullptr;
    QList<QHotkey *> m_llmHotkeys;
    QHash<QHotkey *, QString> m_llmHotkeyMap;
#endif
};

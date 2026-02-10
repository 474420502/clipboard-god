#include "HotkeyManager.h"

#include <QKeySequence>
#include <QDebug>

namespace
{
    QString normalizeShortcutForLinux(const QString &shortcut)
    {
#ifdef Q_OS_LINUX
        QString normalized = shortcut;
        normalized.replace(QStringLiteral("CommandOrControl"), QStringLiteral("Ctrl"), Qt::CaseInsensitive);
        normalized.replace(QStringLiteral("CmdOrCtrl"), QStringLiteral("Ctrl"), Qt::CaseInsensitive);
        normalized.replace(QStringLiteral("Command"), QStringLiteral("Meta"), Qt::CaseInsensitive);
        normalized.replace(QStringLiteral("Control"), QStringLiteral("Ctrl"), Qt::CaseInsensitive);
        return normalized;
#else
        return shortcut;
#endif
    }
}

HotkeyManager::HotkeyManager(QObject *parent) : QObject(parent)
{
}

void HotkeyManager::registerDefaultShortcuts(const QString &toggleShortcut, const QString &screenshotShortcut)
{
#ifdef USE_QHOTKEY
    // X11 环境使用 QHotkey
    if (m_toggleHotkey)
    {
        m_toggleHotkey->deleteLater();
        m_toggleHotkey = nullptr;
    }
    if (m_screenshotHotkey)
    {
        m_screenshotHotkey->deleteLater();
        m_screenshotHotkey = nullptr;
    }

    if (toggleShortcut.trimmed().isEmpty())
    {
        emit warning(QStringLiteral("Toggle shortcut is empty"));
    }
    else
    {
        const QString normalizedToggle = normalizeShortcutForLinux(toggleShortcut);
        m_toggleHotkey = new QHotkey(QKeySequence(normalizedToggle), true, this);
        if (!m_toggleHotkey->isRegistered())
        {
            emit warning(QStringLiteral("Failed to register toggle shortcut: ") + toggleShortcut);
        }
        connect(m_toggleHotkey, &QHotkey::activated, this, &HotkeyManager::toggleRequested);
    }

    if (screenshotShortcut.trimmed().isEmpty())
    {
        emit warning(QStringLiteral("Screenshot shortcut is empty"));
    }
    else
    {
        const QString normalizedScreenshot = normalizeShortcutForLinux(screenshotShortcut);
        m_screenshotHotkey = new QHotkey(QKeySequence(normalizedScreenshot), true, this);
        if (!m_screenshotHotkey->isRegistered())
        {
            emit warning(QStringLiteral("Failed to register screenshot shortcut: ") + screenshotShortcut);
        }
        connect(m_screenshotHotkey, &QHotkey::activated, this, &HotkeyManager::screenshotRequested);
    }
#else
    Q_UNUSED(toggleShortcut)
    Q_UNUSED(screenshotShortcut)
    emit warning(QStringLiteral("Global shortcuts are not available. Build with USE_QHOTKEY=ON."));
#endif
}

void HotkeyManager::registerLlmShortcuts(const QHash<QString, QString> &shortcuts)
{
#ifdef USE_QHOTKEY
    for (QHotkey *hk : m_llmHotkeys)
    {
        if (hk)
            hk->deleteLater();
    }
    m_llmHotkeys.clear();
    m_llmHotkeyMap.clear();

    for (auto it = shortcuts.constBegin(); it != shortcuts.constEnd(); ++it)
    {
        const QString llmKey = it.key();
        const QString shortcut = it.value().trimmed();
        if (shortcut.isEmpty())
            continue;

        const QString normalizedShortcut = normalizeShortcutForLinux(shortcut);
        QHotkey *hotkey = new QHotkey(QKeySequence(normalizedShortcut), true, this);
        if (!hotkey->isRegistered())
        {
            emit warning(QStringLiteral("Failed to register LLM shortcut: ") + llmKey + QStringLiteral(" ( ") + shortcut + QStringLiteral(" )"));
        }
        m_llmHotkeys.append(hotkey);
        m_llmHotkeyMap.insert(hotkey, llmKey);
        connect(hotkey, &QHotkey::activated, this, [this, hotkey]()
                {
            const QString key = m_llmHotkeyMap.value(hotkey);
            if (!key.isEmpty())
                emit llmRequested(key); });
    }
#else
    Q_UNUSED(shortcuts)
    emit warning(QStringLiteral("Global shortcuts are not available. Build with USE_QHOTKEY=ON."));
#endif
}

void HotkeyManager::registerPasteShortcut(const QString &shortcut)
{
#ifdef USE_QHOTKEY
    if (m_pasteHotkey)
    {
        m_pasteHotkey->deleteLater();
        m_pasteHotkey = nullptr;
    }

    if (shortcut.trimmed().isEmpty())
    {
        emit warning(QStringLiteral("Paste shortcut is empty"));
        return;
    }

    const QString normalizedPaste = normalizeShortcutForLinux(shortcut);
    m_pasteHotkey = new QHotkey(QKeySequence(normalizedPaste), true, this);
    if (!m_pasteHotkey->isRegistered())
    {
        emit warning(QStringLiteral("Failed to register paste shortcut: ") + shortcut);
    }
    connect(m_pasteHotkey, &QHotkey::activated, this, &HotkeyManager::pasteRequested);
#else
    Q_UNUSED(shortcut)
    emit warning(QStringLiteral("Global shortcuts are not available. Build with USE_QHOTKEY=ON."));
#endif
}
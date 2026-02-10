#include "TrayManager.h"

#include <QAction>
#include <QApplication>
#include <QMenu>
#include <QSystemTrayIcon>

TrayManager::TrayManager(QObject *parent) : QObject(parent) {}

void TrayManager::init()
{
    if (m_tray)
        return;

    if (!QSystemTrayIcon::isSystemTrayAvailable())
    {
        return;
    }

    QIcon trayIcon = QIcon::fromTheme("clipboard");
    if (trayIcon.isNull())
        trayIcon = QIcon::fromTheme("edit-paste");
    if (trayIcon.isNull())
        trayIcon = QIcon::fromTheme("edit-copy");
    if (trayIcon.isNull())
        trayIcon = QIcon::fromTheme("application-x-executable");
    if (trayIcon.isNull())
    {
        return;
    }

    m_tray = new QSystemTrayIcon(trayIcon, this);
    m_menu = new QMenu();

    QAction *openAction = new QAction(tr("Open"), m_menu);
    QAction *quitAction = new QAction(tr("Quit"), m_menu);

    connect(openAction, &QAction::triggered, this, &TrayManager::toggleRequested);
    connect(quitAction, &QAction::triggered, this, &TrayManager::quitRequested);

    m_menu->addAction(openAction);
    m_menu->addSeparator();
    m_menu->addAction(quitAction);

    m_tray->setContextMenu(m_menu);
    m_tray->setToolTip(QStringLiteral("Clipboard God"));
    m_tray->show();

    connect(m_tray, &QSystemTrayIcon::activated, this, [this](QSystemTrayIcon::ActivationReason reason)
            {
        if (reason == QSystemTrayIcon::Trigger) {
            emit toggleRequested();
        } });
}

#pragma once

#include <QObject>

class QSystemTrayIcon;
class QMenu;

class TrayManager : public QObject
{
    Q_OBJECT

public:
    explicit TrayManager(QObject *parent = nullptr);
    void init();

signals:
    void toggleRequested();
    void quitRequested();

private:
    QSystemTrayIcon *m_tray = nullptr;
    QMenu *m_menu = nullptr;
};

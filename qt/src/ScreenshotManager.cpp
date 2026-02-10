#include "ScreenshotManager.h"

#include <QGuiApplication>
#include <QScreen>
#include <QPixmap>
#include <QBuffer>
#include <QProcess>
#include <QStandardPaths>
#include <QByteArray>

ScreenshotManager::ScreenshotManager(QObject *parent) : QObject(parent)
{
}

QString ScreenshotManager::captureFullScreenDataUrl()
{
    QScreen *screen = QGuiApplication::primaryScreen();
    if (!screen)
    {
        emit screenshotFailed(QStringLiteral("No screen available for screenshot"));
        return {};
    }

    QPixmap pixmap = screen->grabWindow(0);
    if (pixmap.isNull())
    {
        emit screenshotFailed(QStringLiteral("Failed to grab screen"));
        return {};
    }

    QByteArray bytes;
    QBuffer buffer(&bytes);
    buffer.open(QIODevice::WriteOnly);
    pixmap.save(&buffer, "PNG");

    return QStringLiteral("data:image/png;base64,") + QString::fromLatin1(bytes.toBase64());
}

QString ScreenshotManager::captureSelectionDataUrl()
{
#if defined(Q_OS_LINUX)
    return fallbackToMaim();
#else
    return captureFullScreenDataUrl();
#endif
}

QString ScreenshotManager::dataUrlFromPngBytes(const QByteArray &bytes)
{
    if (bytes.isEmpty())
        return {};
    return QStringLiteral("data:image/png;base64,") + QString::fromLatin1(bytes.toBase64());
}

bool ScreenshotManager::isValidPngHeader(const QByteArray &bytes)
{
    static const QByteArray PNG_HEADER = "\x89PNG\r\n\x1a\n";
    return bytes.startsWith(PNG_HEADER);
}

QString ScreenshotManager::fallbackToMaim()
{
    const QString maim = QStandardPaths::findExecutable(QStringLiteral("maim"));

    if (!maim.isEmpty())
    {
        QProcess proc;
        proc.start(maim, {QStringLiteral("-s"),
                          QStringLiteral("-u")});

        if (!proc.waitForStarted(FALLBACK_TIMEOUT_MS))
        {
            emit screenshotFailed(QStringLiteral("Failed to start maim"));
        }
        else if (!proc.waitForFinished(FALLBACK_TIMEOUT_MS))
        {
            proc.kill();
            proc.waitForFinished(1000);
            emit screenshotFailed(QStringLiteral("maim timed out"));
        }
        else if (proc.exitStatus() != QProcess::NormalExit || proc.exitCode() != 0)
        {
            const QString err = QString::fromLocal8Bit(proc.readAllStandardError());
            emit screenshotFailed(QStringLiteral("maim failed") + (err.isEmpty() ? QString() : QStringLiteral(": ") + err));
        }
        else
        {
            QByteArray png = proc.readAllStandardOutput();
            if (isValidPngHeader(png))
            {
                return dataUrlFromPngBytes(png);
            }
            emit screenshotFailed(QStringLiteral("maim returned invalid PNG data"));
        }
    }
    else
    {
        emit screenshotFailed(QStringLiteral("maim not found. Install maim to use selection screenshots."));
    }

    // 最终回退：使用 Qt 自己的截屏
    return captureFullScreenDataUrl();
}
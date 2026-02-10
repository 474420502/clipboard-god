#pragma once

#include <QObject>
#include <QString>

class ScreenshotManager : public QObject
{
    Q_OBJECT

public:
    explicit ScreenshotManager(QObject *parent = nullptr);

    // 现有接口（同步）
    QString captureFullScreenDataUrl();
    QString captureSelectionDataUrl();

signals:
    // 异步结果信号
    void screenshotCaptured(const QString &dataUrl);
    void screenshotFailed(const QString &errorMessage);

private:
    // 回退方法
    QString fallbackToMaim();

    // 工具方法
    static QString dataUrlFromPngBytes(const QByteArray &bytes);
    static bool isValidPngHeader(const QByteArray &bytes);

    static constexpr int FALLBACK_TIMEOUT_MS = 15000;
};

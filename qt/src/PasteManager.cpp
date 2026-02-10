#include "PasteManager.h"
#include "ClipboardManager.h"

#include <QProcess>
#include <QStandardPaths>
#include <QGuiApplication>
#include <QFileInfo>
#include <QDir>
#include <QClipboard>
#include <QMimeData>
#include <QImage>
#include <QByteArray>
#include <QBuffer>
#include <QThread>

#if defined(Q_OS_WIN)
#include <windows.h>
#endif

PasteManager::PasteManager(QObject *parent) : QObject(parent) {}

void PasteManager::setClipboardManager(void *manager)
{
    m_clipboardManager = manager;
}

void PasteManager::suppressNextChange()
{
    if (m_clipboardManager)
    {
        // 调用 ClipboardManager::suppressNextChange()
        auto cbManager = static_cast<class ClipboardManager *>(m_clipboardManager);
        cbManager->suppressNextChange();
    }
}

bool PasteManager::writeText(const QString &text)
{
    QClipboard *clipboard = QGuiApplication::clipboard();
    if (!clipboard)
    {
        emit warning(QStringLiteral("无法访问剪贴板"));
        return false;
    }

    // 抑制剪贴板监控
    suppressNextChange();

    // 写入文本
    clipboard->setText(text);

    return true;
}

bool PasteManager::writeImage(const QString &filePath)
{
    QClipboard *clipboard = QGuiApplication::clipboard();
    if (!clipboard)
    {
        emit warning(QStringLiteral("无法访问剪贴板"));
        return false;
    }

    // 加载图片
    QImage image;
    if (!image.load(filePath))
    {
        emit warning(QStringLiteral("无法加载图片文件: %1").arg(filePath));
        return false;
    }

    // 抑制剪贴板监控
    suppressNextChange();

    // 写入图片
    clipboard->setImage(image);

    return true;
}

bool PasteManager::writeImageFromDataUrl(const QString &dataUrl)
{
    QClipboard *clipboard = QGuiApplication::clipboard();
    if (!clipboard)
    {
        emit warning(QStringLiteral("无法访问剪贴板"));
        return false;
    }

    // 解析 dataUrl
    QByteArray data;
    QString format;

    if (dataUrl.startsWith("data:image/"))
    {
        const int commaIndex = dataUrl.indexOf(',');
        if (commaIndex > 0)
        {
            const QString header = dataUrl.left(commaIndex);
            const QByteArray base64Data = dataUrl.mid(commaIndex + 1).toLatin1();
            data = QByteArray::fromBase64(base64Data);

            // 提取图片格式
            if (header.contains("png"))
                format = "PNG";
            else if (header.contains("jpeg") || header.contains("jpg"))
                format = "JPEG";
            else if (header.contains("gif"))
                format = "GIF";
            else if (header.contains("bmp"))
                format = "BMP";
            else
                format = "PNG"; // 默认格式
        }
    }
    else
    {
        emit warning(QStringLiteral("无效的 dataUrl 格式"));
        return false;
    }

    // 加载图片
    QImage image;
    if (!image.loadFromData(data, format.toLatin1()))
    {
        emit warning(QStringLiteral("无法解析图片数据"));
        return false;
    }

    // 抑制剪贴板监控
    suppressNextChange();

    // 写入图片
    clipboard->setImage(image);

    return true;
}

bool PasteManager::writeAndPaste(const ClipboardItem &item)
{
    bool success = false;

    if (item.type == "text")
    {
        success = writeAndPasteText(item.content);
    }
    else if (item.type == "image")
    {
        // 优先使用 imagePath（独立文件存储）
        if (!item.imagePath.isEmpty())
        {
            success = writeAndPasteImage(item.imagePath);
        }
        // 其次使用 content（可能是 dataUrl）
        else if (!item.content.isEmpty())
        {
            success = writeImageFromDataUrl(item.content);
            if (success)
            {
                suppressNextChange();
                success = performPaste();
            }
        }
    }

    if (success)
        emit pasteSuccess();
    else
        emit pasteFailed(QStringLiteral("写入并粘贴失败"));

    return success;
}

bool PasteManager::writeAndPasteText(const QString &text)
{
    // 先写入剪贴板
    if (!writeText(text))
        return false;

    // 短暂延迟确保剪贴板就绪
    QThread::msleep(50);

    // 执行粘贴
    return performPaste();
}

bool PasteManager::writeAndPasteImage(const QString &filePath)
{
    // 先写入剪贴板
    if (!writeImage(filePath))
        return false;

    // 较长的延迟确保图片剪贴板就绪
    QThread::msleep(100);

    // 执行粘贴
    return performPaste();
}

bool PasteManager::performPaste()
{
#if defined(Q_OS_LINUX)
    const QString xdotool = QStandardPaths::findExecutable(QStringLiteral("xdotool"));
    if (!xdotool.isEmpty())
    {
        const int code = QProcess::execute(xdotool, {QStringLiteral("key"),
                                                     QStringLiteral("--clearmodifiers"),
                                                     QStringLiteral("ctrl+v")});
        if (code == 0)
            return true;
        emit warning(QStringLiteral("xdotool 粘贴失败"));
        return false;
    }

    emit warning(QStringLiteral("xdotool 未安装"));
    return false;

#elif defined(Q_OS_MAC)
    const QString script = QStringLiteral("tell application \"System Events\" to keystroke \"v\" using {command down}");
    const int code = QProcess::execute(QStringLiteral("/usr/bin/osascript"), {QStringLiteral("-e"), script});
    if (code == 0)
        return true;
    emit warning(QStringLiteral("macOS 粘贴失败"));
    return false;

#elif defined(Q_OS_WIN)
    INPUT inputs[4] = {};

    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].ki.wVk = VK_CONTROL;

    inputs[1].type = INPUT_KEYBOARD;
    inputs[1].ki.wVk = 'V';

    inputs[2].type = INPUT_KEYBOARD;
    inputs[2].ki.wVk = 'V';
    inputs[2].ki.dwFlags = KEYEVENTF_KEYUP;

    inputs[3].type = INPUT_KEYBOARD;
    inputs[3].ki.wVk = VK_CONTROL;
    inputs[3].ki.dwFlags = KEYEVENTF_KEYUP;

    const UINT sent = SendInput(4, inputs, sizeof(INPUT));
    if (sent != 4)
    {
        emit warning(QStringLiteral("SendInput 粘贴失败"));
        return false;
    }
    return true;

#else
    emit warning(QStringLiteral("当前平台不支持自动粘贴"));
    return false;
#endif
}

bool PasteManager::paste()
{
    return performPaste();
}
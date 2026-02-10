#pragma once

#include <QObject>

#include "HistoryModel.h"

class PasteManager : public QObject
{
    Q_OBJECT

public:
    explicit PasteManager(QObject *parent = nullptr);

    // 纯粘贴快捷键（原有功能）
    bool paste();
    
    // 写入剪贴板
    bool writeText(const QString &text);
    bool writeImage(const QString &filePath);
    bool writeImageFromDataUrl(const QString &dataUrl);
    
    // 写入 + 粘贴组合操作
    bool writeAndPaste(const ClipboardItem &item);
    bool writeAndPasteText(const QString &text);
    bool writeAndPasteImage(const QString &filePath);

    // 设置/获取剪贴板管理器（用于 suppressNextChange）
    void setClipboardManager(void *manager);
    void suppressNextChange();

signals:
    void warning(const QString &message);
    void pasteSuccess();
    void pasteFailed(const QString &reason);

private:
    bool performPaste();  // 执行粘贴快捷键
    
    void *m_clipboardManager = nullptr;
};
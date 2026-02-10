#pragma once

#include <QString>
#include <QImage>

class HashUtil
{
public:
    // 计算文本哈希
    static QString computeTextHash(const QString &text);
    
    // 计算通用数据哈希
    static QString computeDataHash(const QByteArray &data);
    
    // 计算图片哈希
    static QString computeImageHash(const QImage &image);
    
    // 计算图片数据哈希（从字节数组）
    static QString computeImageDataHash(const QByteArray &imageData);
};
#include "HashUtil.h"

#include <QCryptographicHash>
#include <QByteArray>
#include <QImage>
#include <QBuffer>

QString HashUtil::computeTextHash(const QString &text)
{
    QByteArray data = text.toUtf8();
    return computeDataHash(data);
}

QString HashUtil::computeDataHash(const QByteArray &data)
{
    QCryptographicHash hash(QCryptographicHash::Sha256);
    hash.addData(data);
    return QString::fromLatin1(hash.result().toHex());
}

QString HashUtil::computeImageHash(const QImage &image)
{
    // 将图片转换为字节数据进行哈希
    QByteArray bytes;
    QBuffer buffer(&bytes);
    buffer.open(QIODevice::WriteOnly);
    image.save(&buffer, "PNG");
    
    return computeDataHash(bytes);
}

QString HashUtil::computeImageDataHash(const QByteArray &imageData)
{
    return computeDataHash(imageData);
}
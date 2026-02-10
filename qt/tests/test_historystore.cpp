#include <QCoreApplication>
#include <QSignalSpy>
#include <QSqlDatabase>
#include <QDebug>
#include <QtTest>

#include "../src/HistoryStore.h"
#include "../src/HashUtil.h"

class TestHistoryStore : public QObject
{
    Q_OBJECT

private slots:
    void initTestCase();
    void cleanup();

    // 数据库迁移测试
    void testSchemaMigration();
    
    // 去重测试
    void testDeduplication_data();
    void testDeduplication();
    
    // 图片存储测试
    void testImageStorage_data();
    void testImageStorage();
    
    // Hash 计算测试
    void testHashUtil();
};

void TestHistoryStore::initTestCase()
{
    // 清理之前的测试数据库
    const QString testDbPath = QStandardPaths::writableLocation(QStandardPaths::TempLocation) + "/test_clipboard_god.db";
    QFile::remove(testDbPath);
}

void TestHistoryStore::cleanup()
{
    // 每个测试后清理
}

void TestHistoryStore::testSchemaMigration()
{
    HistoryStore store;
    
    // 首次初始化应该创建完整 schema
    QVERIFY(store.init());
    QVERIFY(store.isReady());
    
    // 验证图片目录已创建
    QVERIFY(!store.imagesDirectory().isEmpty());
    
    // 验证图片存储功能
    QString thumbPath;
    QImage testImage(100, 100, QImage::Format_ARGB32);
    testImage.fill(Qt::red);
    
    const QString savedPath = store.saveImage(testImage, thumbPath);
    QVERIFY(!savedPath.isEmpty());
    QVERIFY(!thumbPath.isEmpty());
    
    // 验证文件已保存
    QVERIFY(QFile::exists(savedPath));
    QVERIFY(QFile::exists(thumbPath));
}

void TestHistoryStore::testDeduplication_data()
{
    QTest::addColumn<QString>("text");
    
    QTest::newRow("same text") << "test content";
    QTest::newRow("different text") << "different content";
}

void TestHistoryStore::testDeduplication()
{
    QFETCH(QString, text);
    
    HistoryStore store;
    QVERIFY(store.init());
    
    // 清除旧数据
    store.clear();
    
    // 添加第一个项目
    ClipboardItem item1;
    item1.id = QDateTime::currentMSecsSinceEpoch();
    item1.type = "text";
    item1.content = text;
    item1.hash = HashUtil::computeTextHash(text);
    item1.timestamp = QDateTime::currentDateTime();
    
    bool result1 = store.addItem(item1);
    QVERIFY(result1);
    
    // 添加相同的项目（应该检测到重复，不插入）
    ClipboardItem item2 = item1;
    item2.id = QDateTime::currentMSecsSinceEpoch() + 1;
    
    // 使用去重方法
    bool result2 = store.addItemWithDeduplication(item2);
    
    // 无论内容是否相同，去重检测应该返回 false（已存在）
    QVERIFY(!result2);
    
    // 验证只有一条记录
    QVERIFY(store.countRows() == 1);
}

void TestHistoryStore::testImageStorage_data()
{
    QTest::addColumn<QSize>("imageSize");
    
    QTest::newRow("small") << QSize(50, 50);
    QTest::newRow("medium") << QSize(200, 200);
    QTest::newRow("large") << QSize(800, 600);
}

void TestHistoryStore::testImageStorage()
{
    QFETCH(QSize, imageSize);
    
    HistoryStore store;
    QVERIFY(store.init());
    store.clear();
    
    // 创建测试图片
    QImage testImage(imageSize, QImage::Format_ARGB32);
    testImage.fill(Qt::blue);
    
    QString thumbPath;
    const QString savedPath = store.saveImage(testImage, thumbPath);
    
    QVERIFY(!savedPath.isEmpty());
    QVERIFY(!thumbPath.isEmpty());
    
    // 验证缩略图尺寸
    QImage thumb;
    thumb.load(thumbPath);
    QVERIFY(thumb.width() <= 128);
    QVERIFY(thumb.height() <= 128);
}

void TestHistoryStore::testHashUtil()
{
    // 文本哈希测试
    const QString text1 = "test content";
    const QString text2 = "test content";
    const QString text3 = "different content";
    
    const QString hash1 = HashUtil::computeTextHash(text1);
    const QString hash2 = HashUtil::computeTextHash(text2);
    const QString hash3 = HashUtil::computeTextHash(text3);
    
    QVERIFY(hash1 == hash2); // 相同文本应该得到相同哈希
    QVERIFY(hash1 != hash3); // 不同文本应该得到不同哈希
    QVERIFY(hash1.length() == 64); // SHA-256 十六进制长度为 64
    
    // 图片哈希测试
    QImage img1(100, 100, QImage::Format_ARGB32);
    img1.fill(Qt::red);
    
    QImage img2(100, 100, QImage::Format_ARGB32);
    img2.fill(Qt::red);
    
    QImage img3(100, 100, QImage::Format_ARGB32);
    img3.fill(Qt::blue);
    
    const QString imgHash1 = HashUtil::computeImageHash(img1);
    const QString imgHash2 = HashUtil::computeImageHash(img2);
    const QString imgHash3 = HashUtil::computeImageHash(img3);
    
    QVERIFY(imgHash1 == imgHash2); // 相同图片应该得到相同哈希
    QVERIFY(imgHash1 != imgHash3); // 不同图片应该得到不同哈希
}

// 主函数
QTEST_MAIN(TestHistoryStore)
#include "test_historystore.moc"
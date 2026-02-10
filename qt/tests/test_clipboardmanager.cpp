#include <QtTest>

#include "../src/ClipboardManager.h"
#include "../src/HistoryModel.h"
#include "../src/HashUtil.h"

class TestClipboardManager : public QObject
{
    Q_OBJECT

private slots:
    void testDebounceCoalesce();
    void testDebounceDistinct();
};

void TestClipboardManager::testDebounceCoalesce()
{
    HistoryModel model;
    ClipboardManager manager(&model);

    ClipboardItem item1;
    item1.type = "text";
    item1.content = "hello";
    item1.hash = HashUtil::computeTextHash(item1.content);
    item1.timestamp = QDateTime::currentDateTime();

    ClipboardItem item2 = item1;
    item2.timestamp = QDateTime::currentDateTime().addMSecs(5);

    manager.enqueueItem(item1, QImage());
    manager.enqueueItem(item2, QImage());

    QCOMPARE(manager.pendingItemCount(), 1);
}

void TestClipboardManager::testDebounceDistinct()
{
    HistoryModel model;
    ClipboardManager manager(&model);

    ClipboardItem item1;
    item1.type = "text";
    item1.content = "hello";
    item1.hash = HashUtil::computeTextHash(item1.content);
    item1.timestamp = QDateTime::currentDateTime();

    ClipboardItem item2;
    item2.type = "text";
    item2.content = "world";
    item2.hash = HashUtil::computeTextHash(item2.content);
    item2.timestamp = QDateTime::currentDateTime().addMSecs(5);

    manager.enqueueItem(item1, QImage());
    manager.enqueueItem(item2, QImage());

    QCOMPARE(manager.pendingItemCount(), 2);
}

QTEST_MAIN(TestClipboardManager)
#include "test_clipboardmanager.moc"

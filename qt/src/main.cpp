#include <QApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>

#include "AppController.h"

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    app.setOrganizationName("ClipboardGod");
    app.setApplicationName("Clipboard God");

    QQmlApplicationEngine engine;

    AppController controller;
    engine.rootContext()->setContextProperty("app", &controller);
    engine.rootContext()->setContextProperty("i18n", controller.i18n());

    const QUrl url(QStringLiteral("qrc:/ClipboardGod/qml/Main.qml"));
    QObject::connect(
        &engine, &QQmlApplicationEngine::objectCreated,
        &app, [url](QObject *obj, const QUrl &objUrl)
        {
            if (!obj && url == objUrl) {
                QCoreApplication::exit(-1);
            } }, Qt::QueuedConnection);
    engine.load(url);

    return app.exec();
}

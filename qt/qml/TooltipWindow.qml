import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

Item {
    id: root
    implicitWidth: 420
    implicitHeight: 200
    width: implicitWidth
    height: implicitHeight

    property string tooltipType: "text"
    property string tooltipContent: ""
    property string tooltipImage: ""

    Rectangle {
        anchors.fill: parent
        radius: 8
        color: "#2b2b2b"
        border.color: "#444444"
        border.width: 1
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8

        Loader {
            id: contentLoader
            Layout.fillWidth: true
            Layout.fillHeight: true
            sourceComponent: root.tooltipType === "image" ? imageComp : textComp
        }

        Text {
            visible: root.tooltipType === "image"
            text: qsTr("Click to paste image")
            color: "#cfcfcf"
            font.pixelSize: 12
            wrapMode: Text.WordWrap
        }
    }

    Component {
        id: textComp
        Text {
            text: root.tooltipContent
            color: "#f1f1f1"
            wrapMode: Text.WordWrap
            font.pixelSize: 14
        }
    }

    Component {
        id: imageComp
        Image {
            source: root.tooltipImage
            fillMode: Image.PreserveAspectFit
            smooth: true
            cache: false
            anchors.fill: parent
        }
    }
}

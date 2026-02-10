import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

RowLayout {
    id: root
    property string shortcut: ""

    TextField {
        id: shortcutField
        Layout.fillWidth: true
        readOnly: true
        text: root.shortcut
        placeholderText: qsTr("Press any key combination")
        focus: true
        Keys.onPressed: {
            event.accepted = true
            var mods = []
            if (event.modifiers & Qt.ControlModifier) mods.push("Ctrl")
            if (event.modifiers & Qt.AltModifier) mods.push("Alt")
            if (event.modifiers & Qt.ShiftModifier) mods.push("Shift")
            if (event.modifiers & Qt.MetaModifier) mods.push("Meta")

            var keyText = event.text
            if (!keyText || keyText.length === 0) {
                keyText = event.key === Qt.Key_Return ? "Enter" : ""
            }
            if (!keyText) return

            var result = mods.length ? (mods.join("+") + "+" + keyText) : keyText
            root.shortcut = result
        }
    }

    Button {
        text: qsTr("Clear")
        onClicked: {
            root.shortcut = ""
        }
    }
}

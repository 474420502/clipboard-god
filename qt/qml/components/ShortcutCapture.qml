import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

RowLayout {
    id: root
    property string shortcut: ""
    signal shortcutUpdated(string newShortcut)

    onShortcutChanged: shortcutUpdated(shortcut)

    TextField {
        id: shortcutField
        Layout.fillWidth: true
        readOnly: true
        text: root.shortcut
        placeholderText: qsTr("Press any key combination")
        focus: true
        function keyToText(key) {
            if (key >= Qt.Key_A && key <= Qt.Key_Z)
                return String.fromCharCode(key)
            if (key >= Qt.Key_0 && key <= Qt.Key_9)
                return String.fromCharCode(key)

            switch (key) {
            case Qt.Key_Return:
            case Qt.Key_Enter:
                return "Enter"
            case Qt.Key_Space:
                return "Space"
            case Qt.Key_Tab:
                return "Tab"
            case Qt.Key_Backtab:
                return "Backtab"
            case Qt.Key_Backspace:
                return "Backspace"
            case Qt.Key_Escape:
                return "Esc"
            case Qt.Key_Delete:
                return "Delete"
            case Qt.Key_Insert:
                return "Insert"
            case Qt.Key_Home:
                return "Home"
            case Qt.Key_End:
                return "End"
            case Qt.Key_PageUp:
                return "PageUp"
            case Qt.Key_PageDown:
                return "PageDown"
            case Qt.Key_Up:
                return "Up"
            case Qt.Key_Down:
                return "Down"
            case Qt.Key_Left:
                return "Left"
            case Qt.Key_Right:
                return "Right"
            case Qt.Key_F1:
                return "F1"
            case Qt.Key_F2:
                return "F2"
            case Qt.Key_F3:
                return "F3"
            case Qt.Key_F4:
                return "F4"
            case Qt.Key_F5:
                return "F5"
            case Qt.Key_F6:
                return "F6"
            case Qt.Key_F7:
                return "F7"
            case Qt.Key_F8:
                return "F8"
            case Qt.Key_F9:
                return "F9"
            case Qt.Key_F10:
                return "F10"
            case Qt.Key_F11:
                return "F11"
            case Qt.Key_F12:
                return "F12"
            case Qt.Key_Plus:
                return "+"
            case Qt.Key_Minus:
                return "-"
            case Qt.Key_Equal:
                return "="
            case Qt.Key_Slash:
                return "/"
            case Qt.Key_Backslash:
                return "\\"
            case Qt.Key_BracketLeft:
                return "["
            case Qt.Key_BracketRight:
                return "]"
            case Qt.Key_Semicolon:
                return ";"
            case Qt.Key_Apostrophe:
                return "'"
            case Qt.Key_Comma:
                return ","
            case Qt.Key_Period:
                return "."
            case Qt.Key_QuoteLeft:
                return "`"
            default:
                return ""
            }
        }
        Keys.onPressed: function(event) {
            event.accepted = true
            var mods = []
            if (event.modifiers & Qt.ControlModifier) mods.push("Ctrl")
            if (event.modifiers & Qt.AltModifier) mods.push("Alt")
            if (event.modifiers & Qt.ShiftModifier) mods.push("Shift")
            if (event.modifiers & Qt.MetaModifier) mods.push("Meta")

            var keyText = keyToText(event.key)
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

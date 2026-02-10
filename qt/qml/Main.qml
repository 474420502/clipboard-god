import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Controls.Material 2.15
import QtQuick.Layouts 1.15
import QtQuick.Window 2.15
import ClipboardGod 1.0

ApplicationWindow {
    id: window
    width: 400
    height: 600
    minimumWidth: 300
    minimumHeight: 400
    visible: true
    title: tr("app_title", "Clipboard God")

    property bool configLoaded: false
    property string currentTheme: "light"
    property int i18nRevision: 0
    property string llmJsonError: ""
    property var llmMap: ({})
    property string selectedLlmKey: ""
    property bool settingsOpen: false
    property int settingsTabIndex: 0
    property int previewLength: 120
    property bool advancedSearchOpen: false
    property var themeTokens: ({
        "light": {"background":"#ffffff","alt":"#f5f5f5","selected":"#e3f2fd","hover":"#f0f0f0","text":"#212121","secondaryText":"#757575","border":"#e0e0e0","shortcut":"#2196f3","accent":"#2196f3","highlightBg":"#ffe082","highlightFg":"#000000"},
        "dark": {"background":"#2b2b2b","alt":"#1f1f1f","selected":"#333333","hover":"#3a3a3a","text":"#e8eaed","secondaryText":"#9aa0a6","border":"#444444","shortcut":"#4fc3f7","accent":"#4fc3f7","highlightBg":"#5c3d00","highlightFg":"#ffffff"},
        "blue": {"background":"#e3f2fd","alt":"#bbdefb","selected":"#90caf9","hover":"#bbdefb","text":"#0d47a1","secondaryText":"#1976d2","border":"#64b5f6","shortcut":"#1565c0","accent":"#1976d2","highlightBg":"#bbdefb","highlightFg":"#0d47a1"},
        "purple": {"background":"#f3e5f5","alt":"#e1bee7","selected":"#ce93d8","hover":"#e1bee7","text":"#4a148c","secondaryText":"#6a1b9a","border":"#ba68c8","shortcut":"#6a1b9a","accent":"#6a1b9a","highlightBg":"#e1bee7","highlightFg":"#4a148c"},
        "green": {"background":"#e8f5e9","alt":"#c8e6c9","selected":"#a5d6a7","hover":"#c8e6c9","text":"#1b5e20","secondaryText":"#2e7d32","border":"#81c784","shortcut":"#2e7d32","accent":"#2e7d32","highlightBg":"#c8e6c9","highlightFg":"#1b5e20"},
        "orange": {"background":"#fff3e0","alt":"#ffe0b2","selected":"#ffcc80","hover":"#ffe0b2","text":"#e65100","secondaryText":"#ef6c00","border":"#ffb74d","shortcut":"#ef6c00","accent":"#ef6c00","highlightBg":"#ffe0b2","highlightFg":"#e65100"},
        "pink": {"background":"#fce4ec","alt":"#f8bbd0","selected":"#f48fb1","hover":"#f8bbd0","text":"#880e4f","secondaryText":"#ad1457","border":"#f06292","shortcut":"#ad1457","accent":"#ad1457","highlightBg":"#f8bbd0","highlightFg":"#880e4f"},
        "gray": {"background":"#f5f5f5","alt":"#eeeeee","selected":"#e0e0e0","hover":"#eeeeee","text":"#424242","secondaryText":"#616161","border":"#e0e0e0","shortcut":"#616161","accent":"#616161","highlightBg":"#e0e0e0","highlightFg":"#424242"},
        "eye-protection": {"background":"#eaf4e4","alt":"#dcedc8","selected":"#c5e1a5","hover":"#dcedc8","text":"#2e7d32","secondaryText":"#388e3c","border":"#c5e1a5","shortcut":"#2e7d32","accent":"#2e7d32","highlightBg":"#dcedc8","highlightFg":"#2e7d32"},
        "high-contrast": {"background":"#000000","alt":"#111111","selected":"#222222","hover":"#333333","text":"#ffffff","secondaryText":"#cccccc","border":"#666666","shortcut":"#00e5ff","accent":"#00e5ff","highlightBg":"#ffeb3b","highlightFg":"#000000"}
    })

    function tr(key, fallback) {
        i18nRevision
        return i18n ? i18n.t(key) : fallback
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;")
    }

    function highlightText(text) {
        const q = String(searchField.text || "").trim()
        const base = escapeHtml(text)
        if (!q) return base
        const terms = q.split(/\s+/).filter(Boolean)
        const bg = themeColor("highlightBg")
        const fg = themeColor("highlightFg")
        let out = base
        for (let i = 0; i < terms.length; i++) {
            const esc = terms[i].replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
            const re = new RegExp(esc, "gi")
            out = out.replace(re, function(match) {
                return "<span style='background-color:" + bg + ";color:" + fg + ";'>" + match + "</span>"
            })
        }
        return out
    }

    function themeColor(role) {
        const t = themeTokens[currentTheme] || themeTokens["light"]
        return t[role] || "#ffffff"
    }

    function previewText(text) {
        const value = String(text || "")
        if (value.length <= previewLength) return value
        return value.substring(0, previewLength) + "..."
    }

    function positionTooltipWindow() {
        const offsetX = 8
        var geo = window.screen ? window.screen.availableGeometry : null
        if (!geo || geo.width === undefined || geo.height === undefined) {
            geo = Qt.rect(0, 0, Screen.desktopAvailableWidth || window.width, Screen.desktopAvailableHeight || window.height)
        }
        var globalPos = window.contentItem ? window.contentItem.mapToGlobal(Qt.point(0, 0)) : Qt.point(window.x, window.y)
        const mainX = globalPos.x
        const mainY = globalPos.y
        const rightX = mainX + window.width + offsetX
        const leftX = mainX - tooltipWindow.width - offsetX
        const rightFits = rightX + tooltipWindow.width <= geo.x + geo.width
        const leftFits = leftX >= geo.x

        if (!rightFits && !leftFits) {
            return false
        }

        const placeRight = rightFits && (!leftFits || (geo.x + geo.width - rightX) >= (window.x - geo.x))
        var x = placeRight ? rightX : leftX
        var y = mainY
        const maxX = geo.x + geo.width - tooltipWindow.width - 8
        const maxY = geo.y + geo.height - tooltipWindow.height - 8
        if (y < geo.y + 8) y = geo.y + 8
        if (y > maxY) y = maxY

        // Guard against overlap after positioning
        if (placeRight && x <= mainX + window.width) {
            return false
        }
        if (!placeRight && x + tooltipWindow.width >= mainX) {
            return false
        }
        tooltipWindow.x = x
        tooltipWindow.y = y
        return true
    }

    function showTooltipWindow(type, content) {
        if (!app || !app.getConfig("enableTooltips")) return
        tooltipItem.tooltipType = type
        if (type === "image") {
            tooltipItem.tooltipImage = content
            tooltipItem.tooltipContent = ""
            tooltipWindow.width = 460
            tooltipWindow.height = 320
        } else {
            tooltipItem.tooltipContent = content
            tooltipItem.tooltipImage = ""
            tooltipWindow.width = 420
            tooltipWindow.height = 200
        }
        if (positionTooltipWindow()) {
            tooltipWindow.visible = true
        } else {
            tooltipWindow.visible = false
        }
    }

    function hideTooltipWindow() {
        tooltipWindow.visible = false
    }

    Window {
        id: tooltipWindow
        width: 420
        height: 200
        visible: false
        color: "transparent"
        transientParent: null
        flags: Qt.Window | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint

        TooltipWindow {
            id: tooltipItem
            anchors.fill: parent
        }
    }

    function pasteSelectedItem() {
        if (!historyList.currentItem) return
        app.copyItem(historyList.currentItem.itemType, historyList.currentItem.itemContent)
        app.pasteClipboard()
    }

    function copySelectedItem() {
        if (!historyList.currentItem) return
        app.copyItem(historyList.currentItem.itemType, historyList.currentItem.itemContent)
    }

    property int editItemId: -1
    property string editItemText: ""

    function moveSelection(delta) {
        const count = historyList.count
        if (count <= 0) return
        let next = historyList.currentIndex
        if (next < 0) next = 0
        next = Math.max(0, Math.min(count - 1, next + delta))
        historyList.currentIndex = next
        historyList.positionViewAtIndex(next, ListView.Visible)
    }

    function loadConfig() {
        maxHistorySpin.value = Number(app.getConfig("maxHistoryItems")) || 500
        previewLength = Number(app.getConfig("previewLength")) || 120
        previewLengthSpin.value = previewLength
        customTooltipSwitch.checked = Boolean(app.getConfig("customTooltip"))
        enableTooltipsSwitch.checked = Boolean(app.getConfig("enableTooltips"))
        launchOnStartupSwitch.checked = Boolean(app.getConfig("launchOnStartup"))
        useNumberShortcutsSwitch.checked = Boolean(app.getConfig("useNumberShortcuts"))
        pasteShortcutField.text = String(app.getConfig("pasteShortcut") || "numbers")
        if (globalShortcutField) {
            globalShortcutField.shortcut = String(app.getConfig("globalShortcut") || "CommandOrControl+Alt+V")
        }
        if (screenshotShortcutField) {
            screenshotShortcutField.shortcut = String(app.getConfig("screenshotShortcut") || "CommandOrControl+Shift+S")
        }
        currentTheme = String(app.getConfig("theme") || "light")
        const localeValue = String(app.getConfig("locale") || "en")
        localeCombo.currentIndex = Math.max(0, localeCombo.model.indexOf(localeValue))
        selectedLlmKey = String(app.getConfig("_selectedLlm") || "")
        loadLlmMap(app.getConfig("llms") || {})
        configLoaded = true
    }

    function loadLlmMap(obj) {
        if (!obj || typeof obj !== "object") {
            llmMap = {}
        } else {
            llmMap = obj
        }
        const keys = Object.keys(llmMap)
        if (keys.length === 0) {
            selectedLlmKey = ""
            return
        }
        if (!selectedLlmKey || !llmMap[selectedLlmKey]) {
            selectedLlmKey = keys[0]
        }
    }

    function persistLlmMap() {
        if (!configLoaded) return
        app.setConfig("llms", llmMap)
        app.setConfig("_selectedLlm", selectedLlmKey)
    }

    function addLlm(name) {
        const key = String(name || "").trim()
        if (!key) return
        if (!llmMap[key]) {
            llmMap[key] = {
                apitype: "ollama",
                model: "",
                triggerType: "text",
                baseurl: "http://localhost:11434",
                apikey: "",
                prompt: "Summarize {{text}}",
                temperature: 0.7,
                top_p: 0.95,
                top_k: 0.9,
                context_window: 32768,
                max_tokens: 32768,
                min_p: 0.05,
                presence_penalty: 1.1,
                llmShortcut: ""
            }
        }
        selectedLlmKey = key
        persistLlmMap()
    }

    function removeSelectedLlm() {
        if (!selectedLlmKey || !llmMap[selectedLlmKey]) return
        delete llmMap[selectedLlmKey]
        const keys = Object.keys(llmMap)
        selectedLlmKey = keys.length ? keys[0] : ""
        persistLlmMap()
    }

    function updateLlmField(field, value) {
        if (!selectedLlmKey || !llmMap[selectedLlmKey]) return
        llmMap[selectedLlmKey][field] = value
        persistLlmMap()
    }

    Material.theme: currentTheme === "dark" ? Material.Dark : Material.Light

    Item {
        id: keyHandler
        anchors.fill: parent
        focus: true
        Keys.onPressed: (event) => {
        if (event.key === Qt.Key_Up) {
            moveSelection(-1)
            event.accepted = true
        } else if (event.key === Qt.Key_Down) {
            moveSelection(1)
            event.accepted = true
        } else if (event.key === Qt.Key_PageUp) {
            moveSelection(-10)
            event.accepted = true
        } else if (event.key === Qt.Key_PageDown) {
            moveSelection(10)
            event.accepted = true
        } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            pasteSelectedItem()
            event.accepted = true
        } else if (event.key === Qt.Key_Escape) {
            window.hide()
            event.accepted = true
        } else if (event.key >= Qt.Key_1 && event.key <= Qt.Key_9) {
            if (app && app.getConfig("useNumberShortcuts")) {
                const index = event.key - Qt.Key_1
                if (index >= 0 && index < historyList.count) {
                    historyList.currentIndex = index
                    pasteSelectedItem()
                    event.accepted = true
                }
                }
                }
        }
    }

    Component.onCompleted: {
        if (app) app.setMainWindow(window)
        if (app) loadConfig()
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            TextField {
                id: searchField
                Layout.fillWidth: true
                placeholderText: tr("search_clipboard", "Search clipboard")
                onTextChanged: if (app) app.setHistoryFilter(text)
                Keys.onUpPressed: {
                    moveSelection(-1)
                }
                Keys.onDownPressed: {
                    moveSelection(1)
                }
                Keys.onReturnPressed: {
                    pasteSelectedItem()
                }
            }

            ToolButton {
                text: "⚙️"
                onClicked: settingsOpen = true
            }

            ToolButton {
                text: "▾"
                onClicked: advancedSearchOpen = !advancedSearchOpen
            }
        }

        ColumnLayout {
            Layout.fillWidth: true
            visible: advancedSearchOpen
            spacing: 6

            RowLayout {
                Layout.fillWidth: true
                spacing: 8

                ComboBox {
                    id: typeFilter
                    model: [tr("filter_all", "All"), tr("filter_text", "Text"), tr("filter_image", "Image")]
                    onActivated: if (app) app.filteredHistoryModel.setTypeFilter(currentIndex)
                }

                ComboBox {
                    id: sortByFilter
                    model: [tr("sort_time", "Time"), tr("sort_length", "Length")]
                    onActivated: if (app) app.filteredHistoryModel.setSortBy(currentIndex)
                }

                CheckBox {
                    id: pinnedOnlyCheck
                    text: tr("pinned_only", "Pinned only")
                    onToggled: if (app) app.filteredHistoryModel.setPinnedOnly(checked)
                }
            }
        }

        ListView {
            id: historyList
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: app ? app.filteredHistoryModel : null
            function toImageUrl(path) {
                if (!path || path.length === 0) return ""
                if (path.startsWith("file://") || path.startsWith("qrc:/") || path.startsWith("image://") || path.startsWith("data:")) return path
                if (path.startsWith("/")) return "file://" + path
                return path
            }
            onCountChanged: {
                if (count > 0 && currentIndex < 0) currentIndex = 0
            }
            delegate: Rectangle {
                width: historyList.width
                height: implicitHeight
                property string itemType: type
                property string itemContent: type === "image" ? (imagePath && imagePath.length ? imagePath : content) : content
                property string itemThumb: type === "image" ? (imageThumb && imageThumb.length ? imageThumb : (imagePath && imagePath.length ? imagePath : content)) : ""
                property string itemThumbUrl: historyList.toImageUrl(itemThumb)
                property bool isSelected: ListView.isCurrentItem
                  color: isSelected
                      ? themeColor("selected")
                      : (index % 2 === 0 ? themeColor("alt") : themeColor("background"))
                radius: 8
                border.color: themeColor("border")
                border.width: 1
                implicitHeight: contentColumn.implicitHeight + 12
                anchors.margins: 4

                Column {
                    id: contentColumn
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.margins: 8
                    spacing: 6

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 6

                        Text {
                            text: index < 9 && app.getConfig("useNumberShortcuts") ? (index + 1) : ""
                            color: themeColor("shortcut")
                            font.pixelSize: 12
                            Layout.preferredWidth: 16
                            horizontalAlignment: Text.AlignHCenter
                        }

                        Text {
                            text: highlightText(type + " · " + timestamp)
                            color: themeColor("secondaryText")
                            font.pixelSize: 12
                            textFormat: Text.RichText
                            font.bold: false
                            Layout.fillWidth: true
                        }

                        Text {
                            text: pinned ? "📌" : ""
                            visible: pinned
                            font.pixelSize: 12
                        }
                    }

                    Loader {
                        active: true
                        sourceComponent: type === "image" ? imageComp : textComp
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 6

                        Text {
                            text: timestamp
                            color: themeColor("secondaryText")
                            font.pixelSize: 11
                            Layout.fillWidth: true
                        }
                    }
                }

                Component {
                    id: textComp
                    Text {
                        text: highlightText(previewText(content))
                        color: themeColor("text")
                        wrapMode: Text.Wrap
                        font.pixelSize: 14
                        textFormat: Text.RichText
                        maximumLineCount: 2
                        elide: Text.ElideRight
                    }
                }

                Component {
                    id: imageComp
                    Image {
                        source: itemThumbUrl
                        fillMode: Image.PreserveAspectFit
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.margins: 0
                        height: 180
                    }
                }

                MouseArea {
                    id: rowMouseArea
                    anchors.fill: parent
                    acceptedButtons: Qt.LeftButton | Qt.RightButton
                    onClicked: {
                        historyList.currentIndex = index
                    }
                    onPressed: function(mouse) {
                        if (mouse.button === Qt.RightButton) {
                            historyList.currentIndex = index
                            contextMenu.open()
                        }
                    }
                    onDoubleClicked: {
                        historyList.currentIndex = index
                        pasteSelectedItem()
                    }
                    onEntered: {
                        showTooltipWindow(type, type === "image" ? itemThumbUrl : content)
                    }
                    onExited: {
                        hideTooltipWindow()
                    }
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                }

                onIsSelectedChanged: {
                    if (isSelected && !rowMouseArea.containsMouse) {
                        showTooltipWindow(type, type === "image" ? itemThumbUrl : content)
                    } else if (!isSelected) {
                        hideTooltipWindow()
                    }
                }

                Menu {
                    id: contextMenu

                    MenuItem {
                        text: tr("edit", "Edit")
                        visible: type === "text"
                        onTriggered: {
                            editItemId = id
                            editItemText = content
                            editDialog.open()
                        }
                    }

                    MenuItem {
                        text: tr("copy", "Copy")
                        onTriggered: copySelectedItem()
                    }

                    MenuItem {
                        text: tr("view", "View")
                        visible: type === "image"
                        onTriggered: if (app) app.openImage(id)
                    }

                    MenuItem {
                        text: tr("save", "Save")
                        visible: type === "image"
                        onTriggered: if (app) app.saveImageAs(id)
                    }

                    MenuItem {
                        text: pinned ? tr("unpin", "Unpin") : tr("pin", "Pin")
                        onTriggered: if (app) app.togglePin(id, !pinned)
                    }

                    MenuSeparator {}

                    MenuItem {
                        text: tr("delete", "Delete")
                        onTriggered: if (app) app.deleteItem(id)
                    }
                }
            }

            Text {
                anchors.centerIn: parent
                text: tr("history_empty", "No clipboard history yet")
                visible: historyList.count === 0
                color: currentTheme === "dark" ? "#9aa0a6" : "#9e9e9e"
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            Button {
                text: tr("screenshot", "Screenshot")
                onClicked: if (app) app.requestScreenshot()
            }

            Button {
                text: tr("paste", "Paste")
                onClicked: {
                    if (!app) return
                    pasteSelectedItem()
                }
            }

            Button {
                text: tr("settings", "Settings")
                onClicked: settingsOpen = true
            }

            Item { Layout.fillWidth: true }

            Button {
                text: tr("search", "Search")
                onClicked: searchField.forceActiveFocus()
            }
        }
    }

    Dialog {
        id: editDialog
        title: tr("edit", "Edit")
        modal: true
        standardButtons: Dialog.Ok | Dialog.Cancel
        onAccepted: {
            if (app && editItemId >= 0) {
                app.updateTextItem(editItemId, editTextArea.text)
            }
        }

        ColumnLayout {
            width: Math.min(window.width - 60, 600)
            spacing: 8

            TextArea {
                id: editTextArea
                Layout.fillWidth: true
                Layout.preferredHeight: 200
                text: editItemText
                wrapMode: TextArea.Wrap
            }
        }
    }

    Popup {
        id: settingsPopup
        modal: true
        focus: true
        visible: settingsOpen
        onClosed: settingsOpen = false
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
        x: (window.width - width) / 2
        y: (window.height - height) / 2
        width: Math.min(window.width - 40, 860)
        height: Math.min(window.height - 40, 620)

        Rectangle {
            anchors.fill: parent
            color: currentTheme === "dark" ? "#2b2b2b" : "#ffffff"
            border.color: currentTheme === "dark" ? "#444" : "#ddd"
            radius: 10

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 12
                spacing: 10

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    Text {
                        text: tr("settings", "Settings")
                        font.pixelSize: 18
                        color: currentTheme === "dark" ? "#e8eaed" : "#212121"
                    }

                    Item { Layout.fillWidth: true }

                    Button {
                        text: "✕"
                        onClicked: settingsPopup.close()
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: 12

                    ColumnLayout {
                        Layout.preferredWidth: 160
                        spacing: 6

                        Button { text: tr("settings_tab_general", "General"); onClicked: settingsTabIndex = 0 }
                        Button { text: tr("settings_tab_appearance", "Appearance"); onClicked: settingsTabIndex = 1 }
                        Button { text: tr("settings_tab_shortcuts", "Shortcuts"); onClicked: settingsTabIndex = 2 }
                        Button { text: tr("settings_tab_llm", "LLM"); onClicked: settingsTabIndex = 3 }
                    }

                    StackLayout {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        currentIndex: settingsTabIndex

                        Flickable {
                            contentWidth: parent.width
                            contentHeight: generalColumn.implicitHeight
                            clip: true
                            ColumnLayout {
                                id: generalColumn
                                width: parent.width
                                spacing: 10

                                Label { text: tr("locale", "Locale") }
                                ComboBox {
                                    id: localeCombo
                                    model: ["en", "zh-CN"]
                                    onActivated: if (configLoaded) app.setConfig("locale", currentText)
                                }

                                Label { text: tr("preview_length", "Preview length") }
                                SpinBox {
                                    id: previewLengthSpin
                                    from: 20
                                    to: 500
                                    stepSize: 10
                                    editable: true
                                    onValueModified: if (configLoaded) app.setConfig("previewLength", value)
                                }

                                Label { text: tr("max_history_items", "Max history items") }
                                SpinBox {
                                    id: maxHistorySpin
                                    from: 50
                                    to: 5000
                                    stepSize: 50
                                    editable: true
                                    onValueModified: if (configLoaded) app.setConfig("maxHistoryItems", value)
                                }

                                RowLayout {
                                    Layout.fillWidth: true
                                    Label { text: tr("enable_tooltips", "Enable tooltips") }
                                    Switch {
                                        id: enableTooltipsSwitch
                                        onToggled: if (configLoaded) app.setConfig("enableTooltips", checked)
                                    }
                                }

                                RowLayout {
                                    Layout.fillWidth: true
                                    Label { text: tr("custom_tooltip", "Custom tooltip") }
                                    Switch {
                                        id: customTooltipSwitch
                                        onToggled: if (configLoaded) app.setConfig("customTooltip", checked)
                                    }
                                }

                                RowLayout {
                                    Layout.fillWidth: true
                                    Label { text: tr("launch_on_startup", "Launch on startup") }
                                    Switch {
                                        id: launchOnStartupSwitch
                                        onToggled: if (configLoaded) app.setConfig("launchOnStartup", checked)
                                    }
                                }
                            }
                        }

                        Flickable {
                            contentWidth: parent.width
                            contentHeight: appearanceColumn.implicitHeight
                            clip: true
                            ColumnLayout {
                                id: appearanceColumn
                                width: parent.width
                                spacing: 10

                                Label { text: tr("theme", "Theme") }
                                Flow {
                                    width: parent.width
                                    spacing: 8

                                    Repeater {
                                        model: Object.keys(themeTokens)
                                        delegate: Rectangle {
                                            width: 110
                                            height: 44
                                            radius: 6
                                            color: themeTokens[modelData].background
                                            border.width: 2
                                            border.color: currentTheme === modelData ? themeTokens[modelData].accent : themeTokens[modelData].border

                                            Text {
                                                anchors.centerIn: parent
                                                text: modelData
                                                color: themeTokens[modelData].text
                                                font.pixelSize: 11
                                            }

                                            MouseArea {
                                                anchors.fill: parent
                                                onClicked: if (configLoaded) app.setConfig("theme", modelData)
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        Flickable {
                            contentWidth: parent.width
                            contentHeight: shortcutColumn.implicitHeight
                            clip: true
                            ColumnLayout {
                                id: shortcutColumn
                                width: parent.width
                                spacing: 10

                                RowLayout {
                                    Layout.fillWidth: true
                                    Label { text: tr("use_number_shortcuts", "Use number shortcuts") }
                                    Switch {
                                        id: useNumberShortcutsSwitch
                                        onToggled: if (configLoaded) app.setConfig("useNumberShortcuts", checked)
                                    }
                                }

                                Label { text: tr("paste_shortcut", "Paste shortcut") }
                                TextField {
                                    id: pasteShortcutField
                                    placeholderText: qsTr("numbers")
                                    onEditingFinished: if (configLoaded) app.setConfig("pasteShortcut", text)
                                }

                                Label { text: tr("global_shortcut", "Global shortcut") }
                                ShortcutCapture {
                                    id: globalShortcutField
                                    shortcut: String(app.getConfig("globalShortcut") || "CommandOrControl+Alt+V")
                                    onShortcutUpdated: function(newShortcut) {
                                        if (configLoaded) app.setConfig("globalShortcut", newShortcut)
                                    }
                                }

                                Label { text: tr("screenshot_shortcut", "Screenshot shortcut") }
                                ShortcutCapture {
                                    id: screenshotShortcutField
                                    shortcut: String(app.getConfig("screenshotShortcut") || "CommandOrControl+Shift+S")
                                    onShortcutUpdated: function(newShortcut) {
                                        if (configLoaded) app.setConfig("screenshotShortcut", newShortcut)
                                    }
                                }
                            }
                        }

                        Flickable {
                            contentWidth: parent.width
                            contentHeight: llmColumn.implicitHeight
                            clip: true
                            ColumnLayout {
                                id: llmColumn
                                width: parent.width
                                spacing: 8

                                RowLayout {
                                    Layout.fillWidth: true
                                    spacing: 8

                                    Label { text: tr("llm_selected", "Selected LLM") }
                                    ComboBox {
                                        id: llmSelector
                                        Layout.fillWidth: true
                                        model: Object.keys(llmMap)
                                        currentIndex: Math.max(0, model.indexOf(selectedLlmKey))
                                        onActivated: {
                                            selectedLlmKey = currentText
                                            persistLlmMap()
                                        }
                                    }

                                    Button { text: tr("llm_add", "Add"); onClicked: addLlm(llmNewName.text) }
                                    Button { text: tr("llm_remove", "Remove"); onClicked: removeSelectedLlm() }
                                }

                                TextField {
                                    id: llmNewName
                                    Layout.fillWidth: true
                                    placeholderText: tr("llm_new_name", "New LLM name")
                                    onEditingFinished: addLlm(text)
                                }

                                Rectangle {
                                    Layout.fillWidth: true
                                    color: "transparent"
                                    border.color: currentTheme === "dark" ? "#333" : "#e0e0e0"
                                    radius: 8
                                    visible: selectedLlmKey.length > 0

                                    ColumnLayout {
                                        anchors.margins: 8
                                        anchors.fill: parent
                                        spacing: 8

                                        RowLayout {
                                            Layout.fillWidth: true
                                            Label { text: tr("llm_api_type", "API Type") }
                                            ComboBox {
                                                Layout.fillWidth: true
                                                model: ["ollama", "openapi"]
                                                currentIndex: Math.max(0, model.indexOf((llmMap[selectedLlmKey] || {}).apitype || "ollama"))
                                                onActivated: updateLlmField("apitype", currentText)
                                            }
                                        }

                                        RowLayout {
                                            Layout.fillWidth: true
                                            Label { text: tr("llm_trigger_type", "Trigger Type") }
                                            ComboBox {
                                                Layout.fillWidth: true
                                                model: ["text", "image"]
                                                currentIndex: Math.max(0, model.indexOf((llmMap[selectedLlmKey] || {}).triggerType || "text"))
                                                onActivated: updateLlmField("triggerType", currentText)
                                            }
                                        }

                                        RowLayout {
                                            Layout.fillWidth: true
                                            Label { text: tr("llm_model", "Model") }
                                            TextField {
                                                Layout.fillWidth: true
                                                text: (llmMap[selectedLlmKey] || {}).model || ""
                                                onEditingFinished: updateLlmField("model", text)
                                            }
                                        }

                                        RowLayout {
                                            Layout.fillWidth: true
                                            Label { text: tr("llm_base_url", "Base URL") }
                                            TextField {
                                                Layout.fillWidth: true
                                                text: (llmMap[selectedLlmKey] || {}).baseurl || ""
                                                onEditingFinished: updateLlmField("baseurl", text)
                                            }
                                        }

                                        RowLayout {
                                            Layout.fillWidth: true
                                            Label { text: tr("llm_api_key", "API Key") }
                                            TextField {
                                                Layout.fillWidth: true
                                                echoMode: TextInput.Password
                                                text: (llmMap[selectedLlmKey] || {}).apikey || ""
                                                onEditingFinished: updateLlmField("apikey", text)
                                            }
                                        }

                                        Label { text: tr("llm_prompt", "Prompt") }
                                        TextArea {
                                            Layout.fillWidth: true
                                            Layout.preferredHeight: 80
                                            text: (llmMap[selectedLlmKey] || {}).prompt || ""
                                            onEditingFinished: updateLlmField("prompt", text)
                                        }

                                        RowLayout {
                                            Layout.fillWidth: true
                                            Label { text: tr("llm_shortcut", "LLM Shortcut") }
                                            TextField {
                                                Layout.fillWidth: true
                                                text: (llmMap[selectedLlmKey] || {}).llmShortcut || ""
                                                onEditingFinished: updateLlmField("llmShortcut", text)
                                            }
                                        }

                                        GridLayout {
                                            columns: 2
                                            Layout.fillWidth: true
                                            columnSpacing: 12
                                            rowSpacing: 6

                                            Label { text: tr("llm_temperature", "Temperature") }
                                            TextField {
                                                text: String((llmMap[selectedLlmKey] || {}).temperature || 0.7)
                                                onEditingFinished: updateLlmField("temperature", parseFloat(text) || 0)
                                            }

                                            Label { text: tr("llm_top_p", "Top P") }
                                            TextField {
                                                text: String((llmMap[selectedLlmKey] || {}).top_p || 0.95)
                                                onEditingFinished: updateLlmField("top_p", parseFloat(text) || 0)
                                            }

                                            Label { text: tr("llm_top_k", "Top K") }
                                            TextField {
                                                text: String((llmMap[selectedLlmKey] || {}).top_k || 0.9)
                                                onEditingFinished: updateLlmField("top_k", parseFloat(text) || 0)
                                            }

                                            Label { text: tr("llm_context_window", "Context Window") }
                                            TextField {
                                                text: String((llmMap[selectedLlmKey] || {}).context_window || 32768)
                                                onEditingFinished: updateLlmField("context_window", parseInt(text) || 0)
                                            }

                                            Label { text: tr("llm_max_tokens", "Max Tokens") }
                                            TextField {
                                                text: String((llmMap[selectedLlmKey] || {}).max_tokens || 32768)
                                                onEditingFinished: updateLlmField("max_tokens", parseInt(text) || 0)
                                            }

                                            Label { text: tr("llm_min_p", "Min P") }
                                            TextField {
                                                text: String((llmMap[selectedLlmKey] || {}).min_p || 0.05)
                                                onEditingFinished: updateLlmField("min_p", parseFloat(text) || 0)
                                            }

                                            Label { text: tr("llm_presence_penalty", "Presence Penalty") }
                                            TextField {
                                                text: String((llmMap[selectedLlmKey] || {}).presence_penalty || 1.1)
                                                onEditingFinished: updateLlmField("presence_penalty", parseFloat(text) || 0)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Connections {
        target: app
        function onScreenshotReady(dataUrl) {
            if (app && dataUrl && dataUrl.length) {
                app.copyItem("image", dataUrl)
            }
        }
        function onWarning(message) {
            console.warn(message)
        }
        function onConfigChanged(key, value) {
            if (!configLoaded) return
            if (key === "globalShortcut") {
                if (globalShortcutField) globalShortcutField.shortcut = String(value)
            } else if (key === "screenshotShortcut") {
                if (screenshotShortcutField) screenshotShortcutField.shortcut = String(value)
            } else if (key === "previewLength") {
                previewLength = Number(value) || 120
            } else if (key === "theme") {
                currentTheme = String(value || "light")
            } else if (key === "locale") {
                i18nRevision++
            } else if (key === "_selectedLlm") {
                selectedLlmKey = String(value || "")
            } else if (key === "llms") {
                loadLlmMap(value || {})
            }
        }
    }

    Connections {
        target: i18n
        function onLocaleChanged() {
            i18nRevision++
        }
    }
}

/*
                text: tr("screenshot", "Screenshot")
                onClicked: if (app) app.requestScreenshot()
            }

            Button {
                text: tr("paste", "Paste")
                onClicked: if (app) app.pasteClipboard()
            }

            Button {
                text: tr("settings", "Settings")
                onClicked: settingsOpen = true
            }
        }

        ListView {
            id: historyList
            Layout.fillWidth: true
            Layout.fillHeight: true
            model: app ? app.filteredHistoryModel : null
            delegate: Rectangle {
                width: historyList.width
                height: implicitHeight
                color: index % 2 === 0 ? (currentTheme === "dark" ? "#1f1f1f" : "#f5f5f5")
                                       : (currentTheme === "dark" ? "#232323" : "#ffffff")
                radius: 8
                border.color: currentTheme === "dark" ? "#333" : "#e0e0e0"
                border.width: 1
                implicitHeight: contentColumn.implicitHeight + 12
                anchors.margins: 4

                Column {
                    id: contentColumn
                    anchors.left: parent.left
                    import QtQuick 2.15
                    import QtQuick.Controls 2.15
                    import QtQuick.Controls.Material 2.15
                    import QtQuick.Layouts 1.15
                    import ClipboardGod 1.0
                    
                    ApplicationWindow {
                        id: window
                        width: 900
                        height: 600
                        visible: true
                        title: tr("app_title", "Clipboard God")

                        property bool configLoaded: false
                        property string currentTheme: "light"
                        property int i18nRevision: 0
                        property string llmJsonError: ""
                        property var llmMap: ({})
                        property string selectedLlmKey: ""
                        property bool settingsOpen: false
                        property int settingsTabIndex: 0

                        function tr(key, fallback) {
                            i18nRevision
                            return i18n ? i18n.t(key) : fallback
                        }

                        function escapeHtml(text) {
                            return String(text)
                                .replace(/&/g, "&amp;")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;")
                                .replace(/\"/g, "&quot;")
                                .replace(/'/g, "&#39;")
                        }

                        function highlightText(text) {
                            const q = String(searchField.text || "").trim()
                            const base = escapeHtml(text)
                            if (!q) return base
                            const terms = q.split(/\s+/).filter(Boolean)
                            const bg = currentTheme === "dark" ? "#5c3d00" : "#ffe082"
                            const fg = currentTheme === "dark" ? "#ffffff" : "#000000"
                            let out = base
                            for (let i = 0; i < terms.length; i++) {
                                const esc = terms[i].replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
                                const re = new RegExp(esc, "gi")
                                out = out.replace(re, function(match) {
                                    return "<span style='background-color:" + bg + ";color:" + fg + ";'>" + match + "</span>"
                                })
                            }
                            return out
                        }

                        function loadConfig() {
                            maxHistorySpin.value = Number(app.getConfig("maxHistoryItems")) || 500
                            previewLengthSpin.value = Number(app.getConfig("previewLength")) || 120
                            customTooltipSwitch.checked = Boolean(app.getConfig("customTooltip"))
                            enableTooltipsSwitch.checked = Boolean(app.getConfig("enableTooltips"))
                            launchOnStartupSwitch.checked = Boolean(app.getConfig("launchOnStartup"))
                            useNumberShortcutsSwitch.checked = Boolean(app.getConfig("useNumberShortcuts"))
                            pasteShortcutField.text = String(app.getConfig("pasteShortcut") || "numbers")
                            if (globalShortcutField) globalShortcutField.shortcut = String(app.getConfig("globalShortcut") || "CommandOrControl+Alt+V")
                            if (screenshotShortcutField) screenshotShortcutField.shortcut = String(app.getConfig("screenshotShortcut") || "CommandOrControl+Shift+S")
                            currentTheme = String(app.getConfig("theme") || "light")
                            const localeValue = String(app.getConfig("locale") || "en")
                            localeCombo.currentIndex = Math.max(0, localeCombo.model.indexOf(localeValue))
                            selectedLlmKey = String(app.getConfig("_selectedLlm") || "")
                            loadLlmMap(app.getConfig("llms") || {})
                            configLoaded = true
                        }

                        function loadLlmMap(obj) {
                            if (!obj || typeof obj !== "object") {
                                llmMap = {}
                            } else {
                                llmMap = obj
                            }
                            const keys = Object.keys(llmMap)
                            if (keys.length === 0) {
                                selectedLlmKey = ""
                                return
                            }
                            if (!selectedLlmKey || !llmMap[selectedLlmKey]) {
                                selectedLlmKey = keys[0]
                            }
                        }

                        function persistLlmMap() {
                            if (!configLoaded) return
                            app.setConfig("llms", llmMap)
                            app.setConfig("_selectedLlm", selectedLlmKey)
                        }

                        function addLlm(name) {
                            const key = String(name || "").trim()
                            if (!key) return
                            if (!llmMap[key]) {
                                llmMap[key] = {
                                    apitype: "ollama",
                                    model: "",
                                    triggerType: "text",
                                    baseurl: "http://localhost:11434",
                                    apikey: "",
                                    prompt: "Summarize {{text}}",
                                    temperature: 0.7,
                                    top_p: 0.95,
                                    top_k: 0.9,
                                    context_window: 32768,
                                    max_tokens: 32768,
                                    min_p: 0.05,
                                    presence_penalty: 1.1,
                                    llmShortcut: ""
                                }
                            }
                            selectedLlmKey = key
                            persistLlmMap()
                        }

                        function removeSelectedLlm() {
                            if (!selectedLlmKey || !llmMap[selectedLlmKey]) return
                            delete llmMap[selectedLlmKey]
                            const keys = Object.keys(llmMap)
                            selectedLlmKey = keys.length ? keys[0] : ""
                            persistLlmMap()
                        }

                        function updateLlmField(field, value) {
                            if (!selectedLlmKey || !llmMap[selectedLlmKey]) return
                            llmMap[selectedLlmKey][field] = value
                            persistLlmMap()
                        }

                        Material.theme: currentTheme === "dark" ? Material.Dark : Material.Light

                        Component.onCompleted: {
                            if (app) app.setMainWindow(window)
                            if (app) loadConfig()
                        }

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: 12
                            spacing: 8

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: 8

                                TextField {
                                    id: searchField
                                    Layout.fillWidth: true
                                    placeholderText: tr("search_clipboard", "Search clipboard")
                                    onTextChanged: if (app) app.setHistoryFilter(text)
                                }

                                RowLayout {
                                    spacing: 6

                                    ToolButton {
                                        text: "📷"
                                        onClicked: if (app) app.requestScreenshot()
                                    }

                                    ToolButton {
                                        text: "📋"
                                        onClicked: if (app) pasteSelectedItem()
                                    }

                                    ToolButton {
                                        text: "⚙️"
                                        onClicked: settingsOpen = true
                                    }
                                }
                            }

                            Item { Layout.fillWidth: true }
                                        }

                                        Loader {
                                            active: true
                                            sourceComponent: type === "image" ? imageComp : textComp
                                        }
                                    }

                                    Component {
                                        id: textComp
                                        Text {
                                            text: highlightText(content)
                                            color: currentTheme === "dark" ? "#e8eaed" : "#212121"
                                            wrapMode: Text.Wrap
                                            font.pixelSize: 14
                                            textFormat: Text.RichText
                                        }
                                    }

                                    Component {
                                        id: imageComp
                                        Image {
                                            source: content
                                            fillMode: Image.PreserveAspectFit
                                            anchors.left: parent.left
                                            anchors.right: parent.right
                                            anchors.margins: 0
                                            height: 180
                                        }
                                    }

                                    MouseArea {
                                        anchors.fill: parent
                                        onClicked: if (app) app.copyItem(type, content)
                                        hoverEnabled: true
                                        cursorShape: Qt.PointingHandCursor
                                    }
                                }
                            }

                            GroupBox {
                                title: tr("ai_assistant", "AI Assistant")
                                Layout.fillWidth: true

                                ColumnLayout {
                                    anchors.fill: parent
                                    spacing: 6

                                    TextArea {
                                        id: promptInput
                                        Layout.fillWidth: true
                                        Layout.preferredHeight: 80
                                        placeholderText: tr("ask_ai", "Ask AI to summarize or transform your clipboard")
                                    }

                                    Button {
                                        text: tr("send", "Send")
                                        onClicked: if (app) app.requestAi(promptInput.text)
                                    }

                                    Text {
                                        id: aiResponse
                                        text: ""
                                        color: currentTheme === "dark" ? "#e8eaed" : "#212121"
                                        wrapMode: Text.Wrap
                                    }
                                }
                            }
                        }

                        Popup {
                            id: settingsPopup
                            modal: true
                            focus: true
                            visible: settingsOpen
                            onClosed: settingsOpen = false
                            closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
                            x: (window.width - width) / 2
                            y: (window.height - height) / 2
                            width: Math.min(window.width - 40, 860)
                            height: Math.min(window.height - 40, 620)

                            Rectangle {
                                anchors.fill: parent
                                color: currentTheme === "dark" ? "#2b2b2b" : "#ffffff"
                                border.color: currentTheme === "dark" ? "#444" : "#ddd"
                                radius: 10

                                ColumnLayout {
                                    anchors.fill: parent
                                    anchors.margins: 12
                                    spacing: 10

                                    RowLayout {
                                        Layout.fillWidth: true
                                        spacing: 8

                                        Text {
                                            text: tr("settings", "Settings")
                                            font.pixelSize: 18
                                            color: currentTheme === "dark" ? "#e8eaed" : "#212121"
                                        }

                                        Item { Layout.fillWidth: true }

                                        Button {
                                            text: "✕"
                                            onClicked: settingsPopup.close()
                                        }
                                    }

                                    RowLayout {
                                        Layout.fillWidth: true
                                        Layout.fillHeight: true
                                        spacing: 12

                                        ColumnLayout {
                                            Layout.preferredWidth: 160
                                            spacing: 6

                                            Button { text: tr("settings_tab_general", "General"); onClicked: settingsTabIndex = 0 }
                                            Button { text: tr("settings_tab_appearance", "Appearance"); onClicked: settingsTabIndex = 1 }
                                            Button { text: tr("settings_tab_shortcuts", "Shortcuts"); onClicked: settingsTabIndex = 2 }
                                            Button { text: tr("settings_tab_llm", "LLM"); onClicked: settingsTabIndex = 3 }
                                        }

                                        StackLayout {
                                            Layout.fillWidth: true
                                            Layout.fillHeight: true
                                            currentIndex: settingsTabIndex

                                            Flickable {
                                                contentWidth: parent.width
                                                contentHeight: generalColumn.implicitHeight
                                                clip: true
                                                ColumnLayout {
                                                    id: generalColumn
                                                    width: parent.width
                                                    spacing: 10

                                                    Label { text: tr("locale", "Locale") }
                                                    ComboBox {
                                                        id: localeCombo
                                                        model: ["en", "zh-CN"]
                                                        onActivated: if (configLoaded) app.setConfig("locale", currentText)
                                                    }

                                                    Label { text: tr("preview_length", "Preview length") }
                                                    SpinBox {
                                                        id: previewLengthSpin
                                                        from: 20
                                                        to: 500
                                                        stepSize: 10
                                                        editable: true
                                                        onValueModified: if (configLoaded) app.setConfig("previewLength", value)
                                                    }

                                                    Label { text: tr("max_history_items", "Max history items") }
                                                    SpinBox {
                                                        id: maxHistorySpin
                                                        from: 50
                                                        to: 5000
                                                        stepSize: 50
                                                        editable: true
                                                        onValueModified: if (configLoaded) app.setConfig("maxHistoryItems", value)
                                                    }

                                                    RowLayout {
                                                        Layout.fillWidth: true
                                                        Label { text: tr("enable_tooltips", "Enable tooltips") }
                                                        Switch {
                                                            id: enableTooltipsSwitch
                                                            onToggled: if (configLoaded) app.setConfig("enableTooltips", checked)
                                                        }
                                                    }

                                                    RowLayout {
                                                        Layout.fillWidth: true
                                                        Label { text: tr("custom_tooltip", "Custom tooltip") }
                                                        Switch {
                                                            id: customTooltipSwitch
                                                            onToggled: if (configLoaded) app.setConfig("customTooltip", checked)
                                                        }
                                                    }

                                                    RowLayout {
                                                        Layout.fillWidth: true
                                                        Label { text: tr("launch_on_startup", "Launch on startup") }
                                                        Switch {
                                                            id: launchOnStartupSwitch
                                                            onToggled: if (configLoaded) app.setConfig("launchOnStartup", checked)
                                                        }
                                                    }
                                                }
                                            }

                                            Flickable {
                                                contentWidth: parent.width
                                                contentHeight: appearanceColumn.implicitHeight
                                                clip: true
                                                ColumnLayout {
                                                    id: appearanceColumn
                                                    width: parent.width
                                                    spacing: 10

                                                    Label { text: tr("theme", "Theme") }
                                                    Flow {
                                                        width: parent.width
                                                        spacing: 8

                                                        Repeater {
                                                            model: Object.keys(themeTokens)
                                                            delegate: Rectangle {
                                                                width: 110
                                                                height: 44
                                                                radius: 6
                                                                color: themeTokens[modelData].background
                                                                border.width: 2
                                                                border.color: currentTheme === modelData ? themeTokens[modelData].accent : themeTokens[modelData].border

                                                                Text {
                                                                    anchors.centerIn: parent
                                                                    text: modelData
                                                                    color: themeTokens[modelData].text
                                                                    font.pixelSize: 11
                                                                }

                                                                MouseArea {
                                                                    anchors.fill: parent
                                                                    onClicked: if (configLoaded) app.setConfig("theme", modelData)
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }

                                            Flickable {
                                                contentWidth: parent.width
                                                contentHeight: shortcutColumn.implicitHeight
                                                clip: true
                                                ColumnLayout {
                                                    id: shortcutColumn
                                                    width: parent.width
                                                    spacing: 10

                                                    RowLayout {
                                                        Layout.fillWidth: true
                                                        Label { text: tr("use_number_shortcuts", "Use number shortcuts") }
                                                        Switch {
                                                            id: useNumberShortcutsSwitch
                                                            onToggled: if (configLoaded) app.setConfig("useNumberShortcuts", checked)
                                                        }
                                                    }

                                                    Label { text: tr("paste_shortcut", "Paste shortcut") }
                                                    TextField {
                                                        id: pasteShortcutField
                                                        placeholderText: qsTr("numbers")
                                                        onEditingFinished: if (configLoaded) app.setConfig("pasteShortcut", text)
                                                    }

                                                    Label { text: tr("global_shortcut", "Global shortcut") }
                                                    TextField {
                                                        id: globalShortcutField
                                                        placeholderText: qsTr("CommandOrControl+Alt+V")
                                                        onEditingFinished: if (configLoaded) app.setConfig("globalShortcut", text)
                                                    }

                                                    Label { text: tr("screenshot_shortcut", "Screenshot shortcut") }
                                                    TextField {
                                                        id: screenshotShortcutField
                                                        placeholderText: qsTr("CommandOrControl+Shift+S")
                                                        onEditingFinished: if (configLoaded) app.setConfig("screenshotShortcut", text)
                                                    }
                                                }
                                            }

                                            Flickable {
                                                contentWidth: parent.width
                                                contentHeight: llmColumn.implicitHeight
                                                clip: true
                                                ColumnLayout {
                                                    id: llmColumn
                                                    width: parent.width
                                                    spacing: 8

                                                    RowLayout {
                                                        Layout.fillWidth: true
                                                        spacing: 8

                                                        Label { text: tr("llm_selected", "Selected LLM") }
                                                        ComboBox {
                                                            id: llmSelector
                                                            Layout.fillWidth: true
                                                            model: Object.keys(llmMap)
                                                            currentIndex: Math.max(0, model.indexOf(selectedLlmKey))
                                                            onActivated: {
                                                                selectedLlmKey = currentText
                                                                persistLlmMap()
                                                            }
                                                        }

                                                        Button { text: tr("llm_add", "Add"); onClicked: addLlm(llmNewName.text) }
                                                        Button { text: tr("llm_remove", "Remove"); onClicked: removeSelectedLlm() }
                                                    }

                                                    TextField {
                                                        id: llmNewName
                                                        Layout.fillWidth: true
                                                        placeholderText: tr("llm_new_name", "New LLM name")
                                                        onEditingFinished: addLlm(text)
                                                    }

                                                    Rectangle {
                                                        Layout.fillWidth: true
                                                        color: "transparent"
                                                        border.color: currentTheme === "dark" ? "#333" : "#e0e0e0"
                                                        radius: 8
                                                        visible: selectedLlmKey.length > 0

                                                        ColumnLayout {
                                                            anchors.margins: 8
                                                            anchors.fill: parent
                                                            spacing: 8

                                                            RowLayout {
                                                                Layout.fillWidth: true
                                                                Label { text: tr("llm_api_type", "API Type") }
                                                                ComboBox {
                                                                    Layout.fillWidth: true
                                                                    model: ["ollama", "openapi"]
                                                                    currentIndex: Math.max(0, model.indexOf((llmMap[selectedLlmKey] || {}).apitype || "ollama"))
                                                                    onActivated: updateLlmField("apitype", currentText)
                                                                }
                                                            }

                                                            RowLayout {
                                                                Layout.fillWidth: true
                                                                Label { text: tr("llm_trigger_type", "Trigger Type") }
                                                                ComboBox {
                                                                    Layout.fillWidth: true
                                                                    model: ["text", "image"]
                                                                    currentIndex: Math.max(0, model.indexOf((llmMap[selectedLlmKey] || {}).triggerType || "text"))
                                                                    onActivated: updateLlmField("triggerType", currentText)
                                                                }
                                                            }

                                                            RowLayout {
                                                                Layout.fillWidth: true
                                                                Label { text: tr("llm_model", "Model") }
                                                                TextField {
                                                                    Layout.fillWidth: true
                                                                    text: (llmMap[selectedLlmKey] || {}).model || ""
                                                                    onEditingFinished: updateLlmField("model", text)
                                                                }
                                                            }

                                                            RowLayout {
                                                                Layout.fillWidth: true
                                                                Label { text: tr("llm_base_url", "Base URL") }
                                                                TextField {
                                                                    Layout.fillWidth: true
                                                                    text: (llmMap[selectedLlmKey] || {}).baseurl || ""
                                                                    onEditingFinished: updateLlmField("baseurl", text)
                                                                }
                                                            }

                                                            RowLayout {
                                                                Layout.fillWidth: true
                                                                Label { text: tr("llm_api_key", "API Key") }
                                                                TextField {
                                                                    Layout.fillWidth: true
                                                                    echoMode: TextInput.Password
                                                                    text: (llmMap[selectedLlmKey] || {}).apikey || ""
                                                                    onEditingFinished: updateLlmField("apikey", text)
                                                                }
                                                            }

                                                            Label { text: tr("llm_prompt", "Prompt") }
                                                            TextArea {
                                                                Layout.fillWidth: true
                                                                Layout.preferredHeight: 80
                                                                text: (llmMap[selectedLlmKey] || {}).prompt || ""
                                                                onEditingFinished: updateLlmField("prompt", text)
                                                            }

                                                            RowLayout {
                                                                Layout.fillWidth: true
                                                                Label { text: tr("llm_shortcut", "LLM Shortcut") }
                                                                TextField {
                                                                    Layout.fillWidth: true
                                                                    text: (llmMap[selectedLlmKey] || {}).llmShortcut || ""
                                                                    onEditingFinished: updateLlmField("llmShortcut", text)
                                                                }
                                                            }

                                                            GridLayout {
                                                                columns: 2
                                                                Layout.fillWidth: true
                                                                columnSpacing: 12
                                                                rowSpacing: 6

                                                                Label { text: tr("llm_temperature", "Temperature") }
                                                                TextField {
                                                                    text: String((llmMap[selectedLlmKey] || {}).temperature || 0.7)
                                                                    onEditingFinished: updateLlmField("temperature", parseFloat(text) || 0)
                                                                }

                                                                Label { text: tr("llm_top_p", "Top P") }
                                                                TextField {
                                                                    text: String((llmMap[selectedLlmKey] || {}).top_p || 0.95)
                                                                    onEditingFinished: updateLlmField("top_p", parseFloat(text) || 0)
                                                                }

                                                                Label { text: tr("llm_top_k", "Top K") }
                                                                TextField {
                                                                    text: String((llmMap[selectedLlmKey] || {}).top_k || 0.9)
                                                                    onEditingFinished: updateLlmField("top_k", parseFloat(text) || 0)
                                                                }

                                                                Label { text: tr("llm_context_window", "Context Window") }
                                                                TextField {
                                                                    text: String((llmMap[selectedLlmKey] || {}).context_window || 32768)
                                                                    onEditingFinished: updateLlmField("context_window", parseInt(text) || 0)
                                                                }

                                                                Label { text: tr("llm_max_tokens", "Max Tokens") }
                                                                TextField {
                                                                    text: String((llmMap[selectedLlmKey] || {}).max_tokens || 32768)
                                                                    onEditingFinished: updateLlmField("max_tokens", parseInt(text) || 0)
                                                                }

                                                                Label { text: tr("llm_min_p", "Min P") }
                                                                TextField {
                                                                    text: String((llmMap[selectedLlmKey] || {}).min_p || 0.05)
                                                                    onEditingFinished: updateLlmField("min_p", parseFloat(text) || 0)
                                                                }

                                                                Label { text: tr("llm_presence_penalty", "Presence Penalty") }
                                                                TextField {
                                                                    text: String((llmMap[selectedLlmKey] || {}).presence_penalty || 1.1)
                                                                    onEditingFinished: updateLlmField("presence_penalty", parseFloat(text) || 0)
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        Connections {
                            target: app
                            function onScreenshotReady(dataUrl) {
                                // For now, push screenshot into history as image content
                            }
                            function onAiResponseReady(text) {
                                aiResponse.text = text
                            }
                            function onWarning(message) {
                                console.warn(message)
                            }
                            function onConfigChanged(key, value) {
                                if (!configLoaded) return
                                if (key === "globalShortcut") {
                                    if (globalShortcutField) globalShortcutField.shortcut = String(value)
                                } else if (key === "screenshotShortcut") {
                                    if (screenshotShortcutField) screenshotShortcutField.shortcut = String(value)
                                } else if (key === "theme") {
                                    currentTheme = String(value || "light")
                                } else if (key === "locale") {
                                    i18nRevision++
                                } else if (key === "_selectedLlm") {
                                    selectedLlmKey = String(value || "")
                                } else if (key === "llms") {
                                    loadLlmMap(value || {})
                                }
                            }
                        }

                        Connections {
                            target: i18n
                            function onLocaleChanged() {
                                i18nRevision++
                            }
                        }
                    }
*/

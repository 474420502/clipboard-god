cmake_minimum_required(VERSION 3.20)
project(ClipboardGodQt LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Qt6 REQUIRED COMPONENTS Core Gui Qml Quick QuickControls2 Widgets Sql Network)

qt_standard_project_setup()

add_executable(clipboard-god-qt
  src/main.cpp
  src/AppController.h
  src/AppController.cpp
  src/ClipboardManager.h
  src/ClipboardManager.cpp
  src/HistoryModel.h
  src/HistoryModel.cpp
  src/HistoryFilterModel.h
  src/HistoryFilterModel.cpp
  src/HistoryStore.h
  src/HistoryStore.cpp
  src/HashUtil.h
  src/HashUtil.cpp
  src/TrayManager.h
  src/TrayManager.cpp
  src/ScreenshotManager.h
  src/ScreenshotManager.cpp
  src/HotkeyManager.h
  src/HotkeyManager.cpp
  src/AiManager.h
  src/AiManager.cpp
  src/ConfigStore.h
  src/ConfigStore.cpp
  src/LocalizationManager.h
  src/LocalizationManager.cpp
  src/PasteManager.h
  src/PasteManager.cpp
)

qt_add_qml_module(clipboard-god-qt
  URI ClipboardGod
  VERSION 1.0
  QML_FILES
    qml/Main.qml
    qml/components/ShortcutCapture.qml
    qml/TooltipWindow.qml
  RESOURCES
    i18n/en.json
    i18n/zh-CN.json
)

target_link_libraries(clipboard-god-qt PRIVATE
  Qt6::Core
  Qt6::Gui
  Qt6::Qml
  Qt6::Quick
  Qt6::QuickControls2
  Qt6::Widgets
  Qt6::Sql
  Qt6::Network
)

# 测试配置
enable_testing()
find_package(Qt6 COMPONENTS Test REQUIRED)

add_executable(clipboard_god_test
  tests/test_historystore.cpp
  src/HistoryStore.cpp
  src/HashUtil.cpp
)
target_link_libraries(clipboard_god_test PRIVATE
  Qt6::Core
  Qt6::Gui
  Qt6::Sql
  Qt6::Test
)
target_include_directories(clipboard_god_test PRIVATE ${CMAKE_SOURCE_DIR}/src)
add_test(NAME ClipboardGodTests COMMAND clipboard_god_test)

add_executable(clipboard_god_test_clipboardmanager
  tests/test_clipboardmanager.cpp
  src/ClipboardManager.cpp
  src/HistoryModel.cpp
  src/HistoryStore.cpp
  src/HashUtil.cpp
)
target_link_libraries(clipboard_god_test_clipboardmanager PRIVATE
  Qt6::Core
  Qt6::Gui
  Qt6::Sql
  Qt6::Test
)
target_include_directories(clipboard_god_test_clipboardmanager PRIVATE ${CMAKE_SOURCE_DIR}/src)
add_test(NAME ClipboardGodClipboardManagerTests COMMAND clipboard_god_test_clipboardmanager)


option(USE_QHOTKEY "Use QHotkey for global shortcuts" ON)
if (USE_QHOTKEY)
  include(FetchContent)
  set(QHOTKEY_INSTALL OFF CACHE BOOL "" FORCE)
  set(QHOTKEY_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  set(QHOTKEY_SOURCE_DIR "${CMAKE_SOURCE_DIR}/_deps/qhotkey-src")
  if (EXISTS "${QHOTKEY_SOURCE_DIR}/CMakeLists.txt")
    add_subdirectory("${QHOTKEY_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/qhotkey-build")
  else()
    FetchContent_Declare(qhotkey
      GIT_REPOSITORY https://github.com/Skycoder42/QHotkey.git
      GIT_TAG 1.5.0
    )
    FetchContent_MakeAvailable(qhotkey)
  endif()
  target_link_libraries(clipboard-god-qt PRIVATE QHotkey::QHotkey)
  target_compile_definitions(clipboard-god-qt PRIVATE USE_QHOTKEY)
endif()
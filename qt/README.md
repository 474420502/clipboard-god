# Clipboard God Qt/QML 迁移工程

这个目录用于把现有 Electron/React 版本逐步迁移到 Qt/QML，并保持跨平台能力。

## 已完成的迁移骨架
- QML 界面入口（列表、搜索、截图按钮、AI 输入区）
- 剪贴板监控（QClipboard dataChanged）
- 托盘图标与菜单
- 截图（全屏基础版）
- AI 占位接口（后续替换为真实 API）

## 还需要迁移的功能
- 全局快捷键（建议接入 QHotkey 或平台原生 API）
- 剪贴板历史持久化（SQLite）
- AI 窗口与多模型配置
- 更完整的托盘菜单、设置页、国际化

## 下一步建议
1. 引入 QHotkey 或平台原生快捷键后端。
2. 添加 SQLite 存储（QtSql + 迁移表结构）。
3. 对接现有配置结构，迁移 config.json 与 UI。
4. 继续完善截图、粘贴体验与快捷键稳定性。

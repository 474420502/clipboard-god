# Clipboard God（中文说明）

Clipboard God 是一个基于 Electron 和 React 的跨平台剪贴板管理器。它提供可搜索的剪贴板历史、截图工具、托盘集成，并支持可选的 AI/LLM 功能用于文本摘要、翻译与智能粘贴。

## 视频演示

[点击观看演示视频（YouTube）](https://www.youtube.com/watch?v=u0lFLiHmbdI)

## 功能亮点

- 长期保留的剪贴板历史，支持文本、截图与图片预览。
- 键盘优先的快速搜索、固定收藏和多主题界面，支持中英双语。
- 截图捕获、下载管理、托盘菜单以及多平台粘贴兼容（含 Wayland）。
- AI 动作可自定义：总结、翻译、重写、智能提示，支持为每个动作绑定快捷键。
- Linux 自动粘贴支持 `Shift+Insert`、`Ctrl+V` 等组合，提供 xdotool/ydotool/Wayland 备用方案。

## AI / LLM 功能

AI 功能完全可选，在设置页面选择 OpenAI 兼容接口或本地服务（如 Ollama）：

- **一键动作**：内置摘要、翻译、重写，亦可添加自定义提示词。
- **图片一同发送**：支持附件或剪贴板中的图片随消息一起提交到模型。
- **可调参数**：模型、API Key、温度、最大 tokens、上下文窗口、惩罚因子等均可配置。
- **快捷触发**：可为任意 LLM 条目分配快捷键，结合全局热键快速调用。

示例配置（OpenAI 兼容接口）：

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "temperature": 0.6,
  "maxTokens": 512
}
```

示例配置（本地服务器 / Ollama）：

```json
{
  "provider": "local",
  "model": "llama3",
  "baseUrl": "http://127.0.0.1:11434",
  "apiKey": "",
  "temperature": 0.3,
  "maxTokens": 256
}
```

## 快速开始

### 环境要求

- Node.js >= 16
- npm >= 8
- Linux: 建议安装 `xdotool`（X11）或 `ydotool` / `wl-clipboard` 以获得最佳粘贴体验。

### 从源码运行

```bash
git clone https://github.com/474420502/clipboard-god.git
cd clipboard-god
npm install
npm run dev
```

### 生产构建

```bash
npm run build
npm start
```

### 发布版下载

在 [Releases 页面](https://github.com/474420502/clipboard-god/releases) 可获取最新的安装包（AppImage、DEB、ZIP 等）。

## 配置说明

用户配置文件位于：

- Linux: `~/.config/clipboard-god/config.json`
- Windows: `%APPDATA%\clipboard-god\config.json`
- macOS: `~/Library/Application Support/clipboard-god/config.json`

可自定义的内容包含历史上限、主题、语言、全局快捷键以及 LLM 条目的提示词与模型参数。

## 快捷键

- `Ctrl+Alt+V`：默认全局快捷键，显示/隐藏历史窗口。
- `1-9`：快速粘贴对应编号的历史条目。
- 方向键：在列表中导航，`Enter` 粘贴当前选项。
- Linux 自动粘贴默认使用 `Shift+Insert`，图片或富文本可降级为 `Ctrl+V`。
- `Esc`：立即隐藏窗口。

## 构建与打包

- 前端使用 Vite 构建，electron-builder 负责产出可分发安装包。
- 执行 `npm run build` 后，发行文件位于 `dist-electron/`。
- 项目自带 `deb/` 脚本，可生成 Debian 包并自动处理 desktop/icon 缓存。
- GitHub Actions 工作流在推送类似 `v1.2.3` 的标签时自动构建三平台发行包。

## 故障排除

- 应用无法启动：确认 Node.js >= 16，必要时删除 `node_modules` 后重新安装。
- 截图功能异常：Linux 安装 `libxss1`、`libgconf-2-4`；macOS 授予屏幕录制权限。
- 数据库损坏：删除配置目录，会自动重建 `config.json` 与历史数据库。
- AI 请求失败：检查 API Key、模型地址是否正确，本地服务需保持运行可访问。

## 项目结构

```
clipboard-god/
├── src/
│   ├── main/        Electron 主进程代码
│   ├── preload/     预加载脚本（安全桥接）
│   └── renderer/    React 18 UI
├── dist/            Vite 输出
├── dist-electron/   打包后的应用
└── assets/          图标及资源
```

## 贡献指南

欢迎 PR：Fork 仓库，创建开发分支，完成修改与测试后提交 Pull Request。

## 许可证

MIT License

## 作者

Eson <474420502@qq.com>

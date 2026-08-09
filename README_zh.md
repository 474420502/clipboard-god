# Clipboard God（中文说明）

Clipboard God 是一个基于 Electron 和 React 的跨平台剪贴板管理器。它提供可搜索的剪贴板历史、截图工具、托盘集成，并支持可选的 AI/LLM 功能用于文本摘要、翻译与智能粘贴。

## 发行 v1.3.0

主要更新：

- 视觉 LLM / VLM：新增独立的视觉模型设置区，与命名文本 LLM 条目彻底分开。
- 视觉动作：截图窗口与 OCR 窗口现在共用可配置的内置/自定义图片动作，内置包含看图解析、提取结构化信息、复刻 Web 组件等能力。
- 设置：OCR 与视觉模型参数统一收拢到独立设置工作台里，视觉动作编辑支持默认折叠、按需展开。
- 结果页：图片分析不再复用普通聊天页，而是使用独立的结果优先界面来分离展示区与分析区。

完整更新记录见 [CHANGELOG.md](CHANGELOG.md)。

## 视频演示

[点击观看演示视频（YouTube）](https://www.youtube.com/watch?v=u0lFLiHmbdI)

## 功能亮点

- 长期保留的剪贴板历史，支持文本、截图与图片预览。
- 键盘优先的快速搜索、固定收藏和多主题界面，支持中英双语。
- 截图捕获支持可定制工具栏动作，内置 OCR / 视觉分析快捷入口、下载管理、托盘菜单以及多平台粘贴兼容。
- AI 动作可自定义：支持命名 LLM 文本动作与视觉 LLM 图片动作，并可为每个动作绑定快捷键。
- Linux（X11）自动粘贴依赖 xdotool，支持 `Ctrl+V` 与 `Shift+Insert` 组合（不兼容 Wayland）。

## OCR（从图片提取文字）

对任意图片类剪贴板条目，你都可以进行 OCR 提取文字。

- 在图片条目上点击 OCR（按钮或右键菜单）。
- OCR 窗口支持：
  - **点击绿色文字框**（或右侧分块）复制该段文字。
  - 复制全部识别结果。
  - **框选**区域后仅对选区重新识别。
  - 缩放 / 适合窗口。
- OCR 相关设置统一在标题区域的 **OCR 菜单**：
  - 语言
  - 文本排版
  - 模型与预处理

可选的 PaddleOCR-VL 后端：

- 如果你希望获得高于内置 PP-OCRv5 的文档解析能力，可把 **模型来源** 切到 **PaddleOCR-VL（本地 CLI）**。
- 先安装：`python -m pip install -U "paddleocr[doc-parser]"`。
- 如果 `paddleocr` 不在系统 `PATH` 里，可在 **设置 > OCR > PaddleOCR CLI 命令** 中填写可执行文件路径。
- 如需传入运行参数，可在 **设置 > OCR > PaddleOCR CLI 额外参数** 中填写，例如 `--device cpu` 或 `--engine transformers`。

## AI / LLM 功能

AI 功能完全可选，在设置页面选择 OpenAI 兼容接口或本地服务（如 Ollama）：

- **一键动作**：内置摘要、翻译、重写，亦可添加自定义提示词。
- **视觉 LLM / VLM 动作**：截图或 OCR 窗口可直接触发图片解析、提取结构化信息、下一步建议、复刻 Web 组件等动作，并支持自定义提示词。
- **图片一同发送**：支持附件或剪贴板中的图片随消息一起提交到模型。
- **可调参数**：文本模型与视觉模型的模型名、API Key、温度、最大 tokens、上下文窗口、惩罚因子等均可分别配置。
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

- Node.js >= 20
- pnpm >= 10
- Linux（X11）: 需要安装 `xdotool` 才能自动粘贴（不兼容 Wayland）。

### 从源码运行

```bash
git clone https://github.com/474420502/clipboard-god.git
cd clipboard-god
git submodule update --init --recursive
pnpm install
pnpm run dev
```

### 快速调试工作流

日常调试不要默认跑 `bash build.sh`，只有在需要最终发行产物时再跑它。

```bash
# 初次 clone 后，或修改了 vendor/screenshots 之后，先执行一次
pnpm run build:screenshots

# 日常最快的编辑 / 调试循环，适合 renderer、preload 以及大多数主进程改动
pnpm run dev:fast

# 直接启动 Electron，并打开截图相关 DEBUG 日志
pnpm run start:debug

# 只验证打包后的运行效果，不生成 .deb、不安装系统包
pnpm run pack:dir
./dist-electron/linux-unpacked/clipboard-god
```

- `pnpm run dev` 仍然是更稳妥的初始化命令，因为它会先重建 screenshots workspace。
- `pnpm run dev:fast` 会跳过这一步，依赖已准备好之后应优先使用它。
- `pnpm run pack:dir` 比 `bash build.sh` 快得多，适合验证 packaged app 行为。
- `bash build.sh` 建议仅用于最终发包前确认。

### 生产构建

```bash
pnpm run build
pnpm start
```

### 发布版下载

在 [Releases 页面](https://github.com/474420502/clipboard-god/releases) 可获取最新的安装包（AppImage、DEB、ZIP 等）。

## 配置说明

用户配置文件位于：

- Linux: `~/.config/clipboard-god/config.json`
- Windows: `%APPDATA%\clipboard-god\config.json`
- macOS: `~/Library/Application Support/clipboard-god/config.json`

可自定义的内容包含历史上限、主题、语言、全局快捷键、命名 LLM 条目、视觉动作提示词，以及文本/视觉模型参数。

## 快捷键

- `Ctrl+Alt+V`：默认全局快捷键，显示/隐藏历史窗口。
- `1-9`：快速粘贴对应编号的历史条目。
- 方向键：在列表中导航，`Enter` 粘贴当前选项。
- Linux（X11）自动粘贴默认使用 `Ctrl+V`，必要时回退 `Shift+Insert`。
- `Esc`：立即隐藏窗口。

OCR 窗口快捷键：

- `Esc`：取消框选 / 关闭 OCR 菜单 / 关闭窗口。
- `Ctrl/Cmd+C`：复制全部识别文本。
- `Ctrl/Cmd+R`：重新识别。
- `Ctrl/Cmd+加号` / `Ctrl/Cmd+减号` / `Ctrl/Cmd+0`：放大 / 缩小 / 还原。
- `F`：适合窗口。

## 构建与打包

- 前端使用 Vite 构建，electron-builder 负责产出可分发安装包。
- `pnpm run dev:fast` 会启动开发模式，但不会重复构建 screenshots workspace。
- 初次 clone 后或 `vendor/screenshots` 有变更时，先执行一次 `pnpm run build:screenshots`。
- 执行 `pnpm run build` 会生成前端与 electron 相关产物。
- `pnpm run pack:dir` 会生成 `dist-electron/linux-unpacked/`，适合快速验证打包运行效果。
- `pnpm run pack:linux:fast` 会更快地产出 Linux AppImage，用于半成品打包验证。
- 如需完整发行构建（包含可选 `.deb` 打包），建议直接运行 `bash build.sh`。
- `.deb` 包由 `build.sh` 产出并放在 `dist/`，同时会复制一份到 `dist-electron/`。
- Linux 打包说明见 [DEB_BUILD.md](DEB_BUILD.md)。
- GitHub Actions 工作流在推送类似 `v1.2.3` 的标签时自动构建三平台发行包。

## 故障排除

- 应用无法启动：确认 Node.js >= 20，然后执行 `git submodule update --init --recursive && pnpm install` 重新安装依赖。
- 截图功能异常：Linux 安装 `libxss1`；macOS 授予屏幕录制权限。
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

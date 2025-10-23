# Clipboard God（中文说明）

一个基于 Electron 与 React 的强力剪贴板管理器，内置部分 AI/LLM 实用功能（可选）。

## v1.0.2 更新摘要

- 新增“开机自动启动”开关，分别针对 Windows、macOS、Linux 配置系统级自启动。
- 图片下载按钮改为弹出系统保存对话框，可先选择保存路径再写入文件。

## 亮点

- 持久化的剪贴板历史（文本、图片、截图）
- 快速搜索与键盘驱动的导航
- 多主题 UI 和国际化（中/英）
- 截图捕获与管理
- LLM 驱动的实用工具（本地或远程模型，用于摘要、翻译、智能粘贴等）
- 跨平台：Windows、macOS、Linux

## LLM / AI 功能

Clipboard God 提供可选的 LLM 功能（在设置中配置）：

- 智能摘要：将较长文本概括为简短要点
- 自动补全 / 片段：使用模型建议扩展提示或保存的片段
- 翻译：在语言间翻译剪贴板文本
- 上下文提示：将剪贴板内容发送给 LLM 进行转换（例如格式化代码、重写文本）

注意：LLM 功能可使用本地模型或远程 API（如 OpenAI 兼容）。在设置中配置 model、baseUrl 和 apiKey。远程调用可能涉及费用并需要网络或 API Key。

### LLM 配置示例

以下示例展示在设置中可填写的配置 JSON（演示用）：

- OpenAI（远程 API）示例：

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "temperature": 0.7,
  "maxTokens": 512
}
```

- 本地或兼容服务器（例如本地 LLM 服务或 llama.cpp http 包装器）示例：

```json
{
  "provider": "local",
  "model": "local-ggml-vicuna-13b",
  "baseUrl": "http://127.0.0.1:8080",
  "apiKey": "",
  "temperature": 0.3,
  "maxTokens": 256
}
```

### 推荐模型及使用场景

- 小型本地模型（如 LLaMA / Alpaca 变体、Vicuna）：适合离线或对隐私敏感的场景，能在 CPU 上做轻量推理，用于简要摘要与基础重写。
- 中等模型（13B）：在有一定 GPU 的情况下提供较好的质量与性能平衡，适用于更高质量的摘要与上下文重写。
- 大型远程模型（如 OpenAI GPT-4 系列）：推荐用于更高质量、多轮上下文和复杂转换，但会产生网络延迟与按 token 计费的成本。

### API 使用与流量限制、成本建议

- 远程 API 通常按 token（输入+输出）计费。对摘要和短转换，建议设置合理的 `maxTokens`（例如 128-512）并将 `temperature` 设置较低以获得更确定性的结果。
- 避免对每次复制都自动调用 LLM：建议采用显式操作（例如用户点击“摘要”或“翻译”），或对频繁变化的内容做去抖（debounce）。
- 限流：请遵守服务商的速率限制。应用支持配置最小请求间隔以防止突发多次请求。
- 隐私：剪贴板可能包含敏感信息。若隐私是优先考虑，请优先使用本地模型或避免将敏感内容发送到远程 API。

### 示例：推荐的“摘要”动作设置

- Temperature: 0.2（用于更确定性的摘要）
- Max tokens: 150
- Prompt 模板：

```
Summarize the following text in 3 concise bullet points:

{content}
```

该配置能在控制成本的同时产出高质量的简洁摘要。

## 安装

### 从源码安装

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

从 Releases 页面下载： https://github.com/474420502/clipboard-god/releases

## 配置

配置文件路径：

- Linux: `~/.config/clipboard-god/config.json`
- Windows: `%APPDATA%\\clipboard-god\\config.json`
- macOS: `~/Library/Application Support/clipboard-god/config.json`

可配置项：
- 最大历史条目（默认: 1000）
- 主题选择
- 全局快捷键
- 语言（en / zh-CN）
- LLM 模型 / API 配置

## 快捷键

- 全局: `Ctrl+Alt+V`（切换历史窗口）
- 数字键: 1-9 选择历史项
- 方向键: 列表导航
- Enter: 粘贴选中项
- Esc: 隐藏窗口

## 开发

项目结构：

```
clipboard-god/
├── src/
│   ├── main/        # Electron 主进程
│   ├── preload/     # 预加载脚本（暴露安全 API）
│   └── renderer/    # React UI
├── dist/
├── dist-electron/
└── assets/
```

### 技术栈与核心依赖

- Electron
- React 18
- Vite
- better-sqlite3（存储）
- i18next / react-i18next（国际化）
- electron-builder（打包）

## 安全

遵循 Electron 的安全最佳实践：

- 启用 Context Isolation
- 在 renderer 中禁用 Node 集成
- 使用 preload 暴露最小化 API

## 故障排除

1. 应用无法启动：
	- 确认 Node.js >= 16
	- 重新安装依赖：`rm -rf node_modules && npm install`

2. 截图功能不可用：
	- Linux：安装 `libxss1` 和 `libgconf-2-4`
	- macOS：授予屏幕录制权限

3. 数据库问题：
	- 删除配置文件夹：`rm -rf ~/.config/clipboard-god/`

4. LLM 集成问题：
	- 检查设置中的 API Key 与模型配置
	- 如果使用本地模型，确认模型服务已启动并可访问

## 贡献

1. Fork
2. 创建功能分支
3. 实现并测试
4. 提交 PR

## 许可证

MIT License

## 作者

Eson <474420502@qq.com>

# Clipboard God

[![GitHub license](https://img.shields.io/github/license/474420502/clipboard-god)](https://github.com/474420502/clipboard-god/blob/master/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/474420502/clipboard-god)](https://github.com/474420502/clipboard-god/stargazers)

Clipboard God is a cross-platform clipboard manager built with Electron and React. It keeps your clipboard history searchable, adds screenshot tooling, and bundles optional AI helpers for fast summarisation, translation, and smart paste workflows.

> Note: The Qt/QML port under qt/ is temporarily deprecated and not maintained as a release target.

## Release v1.3.0

Highlights:

- Vision LLM / VLM: Image-capable models now have a dedicated settings area, separate from named text LLM entries.
- Vision actions: Screenshot and OCR windows now share configurable built-in and custom image actions, including structured extraction and recreate-web helpers.
- Settings: OCR and vision controls are consolidated inside the detached settings workbench with a cleaner editing flow.
- Vision results: Image analysis now opens a dedicated result-first page instead of reusing the generic chat transcript layout.

See [CHANGELOG.md](CHANGELOG.md) for the full list.

## Video Demo

[Watch on YouTube](https://www.youtube.com/watch?v=u0lFLiHmbdI)

## Feature Highlights

- Persistent clipboard history for text, screenshots, and pasted images with quick preview.
- Powerful search with keyboard-first navigation and pinning for favourites.
- Multi-theme interface, tray integration, and localisation (English and Simplified Chinese).
- Screenshot capture with customizable toolbar actions, OCR/VLM shortcuts, download helpers, and quick paste support on Windows, macOS, and Linux.
- Optional named LLM and vision LLM actions that can route text or images to local or remote models for summarising, rewriting, translation, and visual analysis.

## OCR (Extract Text From Images)

You can extract text from any image entry in the clipboard history.

- Open OCR from an image item (button or context menu).
- The OCR window supports:
  - **Click a green text box** (or a block on the right) to copy that block.
  - **Copy all** recognized text.
  - **Select** an area to re-run OCR on the selected region.
  - Zoom controls and auto-fit.
- OCR settings are grouped under **OCR Menu** in the title area:
  - Languages
  - Text layout
  - OCR model & preprocessing

Optional PaddleOCR-VL backend:

- Switch **Model source** to **PaddleOCR-VL (local CLI)** if you want document parsing quality beyond the built-in PP-OCRv5 flow.
- Install it first with `python -m pip install -U "paddleocr[doc-parser]"`.
- If `paddleocr` is not on your shell `PATH`, set the executable path in **Settings > OCR > PaddleOCR CLI command**.
- You can pass extra runtime flags such as `--device cpu` or `--engine transformers` from **Settings > OCR > PaddleOCR CLI extra args**.

## AI & Automation Tools

All AI features are opt-in and configurable from Settings. Pick OpenAI-compatible endpoints or a local server such as Ollama.

- **One-click prompts** for summarise, translate, rewrite, and custom actions with per-entry shortcuts.
- **Vision LLM / VLM actions** for screenshot and OCR flows, with editable built-in prompts plus custom image actions.
- **Inline image support** so clipboard snapshots or staged uploads are sent together with prompts.
- **Configurable parameters** for both text and vision models (model, API key, temperature, max tokens, context window, penalties).
- **Per-OS paste automation** with xdotool on Linux X11 plus native keystrokes on Windows and macOS (Wayland is not supported).

Example: OpenAI compatible configuration

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

Example: Local server (e.g. Ollama)

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

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 10
- Linux (X11) users: install `xdotool` for paste automation. Wayland is not supported.

### Install from Source

```bash
git clone https://github.com/474420502/clipboard-god.git
cd clipboard-god
git submodule update --init --recursive
pnpm install
pnpm run dev
```

### Fast Debug Workflow

For day-to-day debugging, avoid `bash build.sh` unless you actually need release artifacts.

```bash
# First time after clone, or after changing vendor/screenshots
pnpm run build:screenshots

# Fastest edit/run loop for renderer, preload, and most main-process changes
pnpm run dev:fast

# Run Electron directly with screenshot debug logs
pnpm run start:debug

# Build an unpacked app for packaging validation without installing a .deb
pnpm run pack:dir
./dist-electron/linux-unpacked/clipboard-god
```

- `pnpm run dev` is still the safe bootstrap command because it rebuilds the screenshots workspace first.
- `pnpm run dev:fast` skips that rebuild and is the recommended default once dependencies are already prepared.
- `pnpm run pack:dir` is much faster than `bash build.sh` for packaged-app checks because it skips `.deb` creation and system installation.
- Keep `bash build.sh` for final release verification only.

### Production Build

```bash
pnpm run build
pnpm start
```

### Pre-built Releases

Grab the latest installers and AppImage/DEB packages from the [Releases](https://github.com/474420502/clipboard-god/releases) page.

## Configuration

Per-user configuration is stored at:

- Linux: `~/.config/clipboard-god/config.json`
- Windows: `%APPDATA%\clipboard-god\config.json`
- macOS: `~/Library/Application Support/clipboard-god/config.json`

Key options include maximum history items, theme, language, global shortcut, named AI entries, vision actions, and separate text/vision model credentials.

## Keyboard Shortcuts

- `Ctrl+Alt+V` toggle history window (default global shortcut).
- `1-9` paste the corresponding item from the history list.
- Arrow keys navigate between items; `Enter` pastes the active entry.
- Linux (X11): `Ctrl+V` default with `Shift+Insert` fallback for automated paste.
- `Esc` hides the window instantly.

OCR window shortcuts:

- `Esc` cancel selection / close OCR menu / close window.
- `Ctrl/Cmd+C` copy all recognized text.
- `Ctrl/Cmd+R` re-run OCR.
- `Ctrl/Cmd+Plus` / `Ctrl/Cmd+Minus` / `Ctrl/Cmd+0` zoom in/out/reset.
- `F` fit image to window.

## Build & Packaging

- Uses Vite for renderer builds and electron-builder for packaging.
- `pnpm run dev:fast` starts the development loop without rebuilding the screenshots workspace.
- Run `pnpm run build:screenshots` once after cloning or whenever `vendor/screenshots` changes.
- `pnpm run build` produces renderer + electron bundles.
- `pnpm run pack:dir` creates `dist-electron/linux-unpacked/` for quick packaged-app validation.
- `pnpm run pack:linux:fast` builds a Linux AppImage faster than the full release flow by skipping native rebuilds during packaging.
- For a full distribution build (including optional `.deb` packaging), use `bash build.sh`.
- Debian packages (`.deb`) are produced by `build.sh` and staged under `dist/` (a copy is also placed into `dist-electron/`).
- See [DEB_BUILD.md](DEB_BUILD.md) for Linux packaging notes.
- CI workflow (GitHub Actions) builds tagged releases for Windows, macOS, and Linux.

## Troubleshooting & Support

- App fails to start: verify Node.js >= 20, then reinstall dependencies with `git submodule update --init --recursive && pnpm install`.
- Screenshots on Linux: install `libxss1`; on macOS ensure Screen Recording permission.
- Database corruption: remove the config directory to recreate `config.json` and history database.
- AI requests failing: double-check API keys, base URLs, and that local servers are reachable.

## Project Structure

```
clipboard-god/
├── src/
│   ├── main/        Electron main process
│   ├── preload/     Exposed, sandboxed bridges
│   └── renderer/    React 18 UI
├── dist/            Vite build output
├── dist-electron/   Packaged application bundles
└── assets/          Icons and marketing assets
```

## Contributing

Contributions are welcome: fork the repo, create a feature branch, add tests where possible, and submit a pull request.

## License

MIT License

## Author

Eson <474420502@qq.com>

# Clipboard God

[![GitHub license](https://img.shields.io/github/license/474420502/clipboard-god)](https://github.com/474420502/clipboard-god/blob/master/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/474420502/clipboard-god)](https://github.com/474420502/clipboard-god/stargazers)

Clipboard God is a cross-platform clipboard manager built with Electron and React. It keeps your clipboard history searchable, adds screenshot tooling, and bundles optional AI helpers for fast summarisation, translation, and smart paste workflows.

> Note: The Qt/QML port under qt/ is temporarily deprecated and not maintained as a release target.

## Release v1.1.0

Highlights:

- OCR: Dedicated OCR window with selectable regions, per-block copy, confidence display, and improved text layout controls.
- OCR: All OCR-related settings are grouped under a single **OCR Menu** (not mixed with action buttons).
- UX: More keyboard-first actions in the OCR window (copy, retry, zoom, cancel/close).

See [CHANGELOG.md](CHANGELOG.md) for the full list.

## Video Demo

[Watch on YouTube](https://www.youtube.com/watch?v=u0lFLiHmbdI)

## Feature Highlights

- Persistent clipboard history for text, screenshots, and pasted images with quick preview.
- Powerful search with keyboard-first navigation and pinning for favourites.
- Multi-theme interface, tray integration, and localisation (English and Simplified Chinese).
- Screenshot capture, download helpers, and quick paste support on Windows, macOS, and Linux.
- Optional AI actions that send content to local or remote LLMs for summarising, rewriting, or translating.

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

## AI & Automation Tools

All AI features are opt-in and configurable from Settings. Pick OpenAI-compatible endpoints or a local server such as Ollama.

- **One-click prompts** for summarise, translate, rewrite, and custom actions with per-entry shortcuts.
- **Inline image support** so clipboard snapshots or staged uploads are sent together with prompts.
- **Configurable parameters** (model, API key, temperature, max tokens, context window, penalties).
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

- Node.js >= 16
- npm >= 8
- Linux (X11) users: install `xdotool` for paste automation. Wayland is not supported.

### Install from Source

```bash
git clone https://github.com/474420502/clipboard-god.git
cd clipboard-god
npm install
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

### Pre-built Releases

Grab the latest installers and AppImage/DEB packages from the [Releases](https://github.com/474420502/clipboard-god/releases) page.

## Configuration

Per-user configuration is stored at:

- Linux: `~/.config/clipboard-god/config.json`
- Windows: `%APPDATA%\clipboard-god\config.json`
- macOS: `~/Library/Application Support/clipboard-god/config.json`

Key options include maximum history items, theme, language, global shortcut, and AI entries (prompt, trigger type, model credentials).

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
- `npm run build` produces renderer + electron bundles.
- For a full distribution build (including optional `.deb` packaging), use `bash build.sh`.
- Debian packages (`.deb`) are produced by `build.sh` and staged under `dist/` (a copy is also placed into `dist-electron/`).
- See [DEB_BUILD.md](DEB_BUILD.md) for Linux packaging notes.
- CI workflow (GitHub Actions) builds tagged releases for Windows, macOS, and Linux.

## Troubleshooting & Support

- App fails to start: verify Node.js >= 16, reinstall dependencies (`rm -rf node_modules && npm install`).
- Screenshots on Linux: install `libxss1` and `libgconf-2-4`; on macOS ensure Screen Recording permission.
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

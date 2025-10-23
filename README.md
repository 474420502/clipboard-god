# Clipboard God

[![GitHub license](https://img.shields.io/github/license/474420502/clipboard-god)](https://github.com/474420502/clipboard-god/blob/master/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/474420502/clipboard-god)](https://github.com/474420502/clipboard-god/stargazers)

Clipboard God is a cross-platform clipboard manager built with Electron and React. It keeps your clipboard history searchable, adds screenshot tooling, and bundles optional AI helpers for fast summarisation, translation, and smart paste workflows.

## Video Demo

[Watch on YouTube](https://www.youtube.com/watch?v=u0lFLiHmbdI)

## Feature Highlights

- Persistent clipboard history for text, screenshots, and pasted images with quick preview.
- Powerful search with keyboard-first navigation and pinning for favourites.
- Multi-theme interface, tray integration, and localisation (English and Simplified Chinese).
- Screenshot capture, download helpers, and quick paste support on Windows, macOS, and Linux (Wayland/X11).
- Optional AI actions that send content to local or remote LLMs for summarising, rewriting, or translating.

## AI & Automation Tools

All AI features are opt-in and configurable from Settings. Pick OpenAI-compatible endpoints or a local server such as Ollama.

- **One-click prompts** for summarise, translate, rewrite, and custom actions with per-entry shortcuts.
- **Inline image support** so clipboard snapshots or staged uploads are sent together with prompts.
- **Configurable parameters** (model, API key, temperature, max tokens, context window, penalties).
- **Per-OS paste automation** with fallbacks (xdotool/ydotool/Wayland) and Linux Shift+Insert support for rich text workflows.

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
- Linux users: install `xdotool` (X11) or `ydotool`/`wl-clipboard` for best paste automation results.

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
- `Shift+Insert` (Linux rich text) or `Ctrl+V` (default) for automated paste.
- `Esc` hides the window instantly.

## Build & Packaging

- Uses Vite for renderer builds and electron-builder for packaging.
- `npm run build` produces distributable binaries under `dist-electron/`.
- Debian packages (`.deb`) can be generated via the provided scripts in `deb/`.
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


`<parameter name="filePath">`/home/eson/workspace/clipboard-god/README.md

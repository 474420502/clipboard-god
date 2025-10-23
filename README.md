# Clipboard God

[![GitHub license](https://img.shields.io/github/license/474420502/clipboard-god)](https://github.com/474420502/clipboard-god/blob/master/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/474420502/clipboard-god)](https://github.com/474420502/clipboard-god/stargazers)

A powerful clipboard manager built with Electron, React and small helpful AI features.

## What's New (v1.0.2)

- Added a cross-platform "Start at login" toggle that configures auto-launch on Windows, macOS, and Linux.
- Image downloads now use the native save dialog so you can pick the destination before saving.

## Highlights

- Persistent clipboard history (text, images, screenshots)
- Fast search and keyboard-driven navigation
- Multi-theme UI and internationalization (English/Chinese)
- Screenshot capture and management
- LLM-powered utilities (local or remote models for text summarization, translation, and smart paste)
- Cross-platform: Windows, macOS, Linux

## LLM / AI Features

Clipboard God includes optional LLM-powered features (configurable in Settings):

- Smart Summarize: summarize long copied text into short notes
- Auto-complete / Snippets: expand prompts or saved snippets using model suggestions
- Translation: translate copied text between languages
- Contextual prompts: send clipboard content to an LLM for transformation (e.g., format code, rewrite text)

Notes:
- LLM features can use a local model or remote API (OpenAI/compatible). Configure model, base URL, and API key in Settings.
- LLM usage may require additional CPU/GPU resources or API keys and could incur costs when calling remote services.

### LLM Configuration Examples

You can configure LLM/AI integrations from the Settings modal. Below are example configurations you might use.

- OpenAI (remote API)

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

- Self-hosted or compatible server (e.g., local LLM server, llama.cpp http wrapper)

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

### Recommended Models and When to Use Them

- Small, local models (e.g., LLaMA/Alpaca variants, Vicuna): best for offline / privacy-sensitive use and cheap local inference on CPU. Use for light summarization and simple rewriting.
- Medium models (13B): good balance of quality and local performance if you have a decent GPU. Use for higher-quality summarization and contextual rewriting.
- Large remote models (OpenAI GPT-4 family or comparable hosted models): recommend for best quality, multi-turn context and complex transformations. These may incur cost per token and network latency.

### API Usage, Rate Limits and Cost Guidance

- Remote APIs typically charge per token (input + output). For summarization and short transforms, set sensible `maxTokens` (e.g., 128-512) and lower `temperature` for deterministic results.
- Be conservative with automatic calls: avoid calling LLM on every clipboard copy. Use explicit actions (e.g., "Summarize" or "Translate") or debounce frequent changes.
- Rate limits: respect the provider's rate limits. The app exposes settings to throttle or batch requests — configure a minimum interval between calls.
- Privacy: clipboard content can be sensitive. If privacy is a concern, prefer local models, or avoid sending sensitive content to remote APIs.

### Example: Add a "Summarize" action (recommended settings)

- Temperature: 0.2 (lower for more deterministic summaries)
- Max tokens: 150
- Prompt template: `"Summarize the following text in 3 concise bullet points:\n\n{content}"`

These settings limit cost while producing high quality concise summaries.

## Installation

### From source

```bash
git clone https://github.com/474420502/clipboard-god.git
cd clipboard-god
npm install
npm run dev
```

### Production build

```bash
npm run build
npm start
```

### Pre-built releases

Download binaries from the Releases page: https://github.com/474420502/clipboard-god/releases

## Configuration

User config path:

- Linux: `~/.config/clipboard-god/config.json`
- Windows: `%APPDATA%\\clipboard-god\\config.json`
- macOS: `~/Library/Application Support/clipboard-god/config.json`

Settings include:
- Max history items (default: 1000)
- Theme selection
- Global shortcut
- Language (en / zh-CN)
- LLM model / API configuration

## Shortcuts

- Global: `Ctrl+Alt+V` (toggle history window)
- Numeric keys: 1-9 select items in the history list
- Arrow keys: navigate list
- Enter: paste selected
- Esc: hide window

## Development

Project structure:

```
clipboard-god/
├── src/
│   ├── main/        # Electron main process
│   ├── preload/     # Preload scripts (expose safe APIs)
│   └── renderer/    # React UI
├── dist/
├── dist-electron/
└── assets/
```

### Tech stack and core dependencies

- Electron
- React 18
- Vite (dev + build)
- better-sqlite3 (storage)
- i18next / react-i18next (i18n)
- electron-builder (packaging)

Core package.json dependencies are listed in the project manifest.

## Security

Follows Electron security best practices:

- Context isolation enabled
- Node integration disabled in renderer
- Use preload to expose minimal APIs

## Troubleshooting

1. App fails to start:
   - Ensure Node.js >= 16
   - Reinstall dependencies: `rm -rf node_modules && npm install`

2. Screenshots not working:
   - Linux: install `libxss1` and `libgconf-2-4`
   - macOS: grant Screen Recording permission

3. Database issues:
   - Remove config folder: `rm -rf ~/.config/clipboard-god/`

4. LLM integration issues:
   - Verify API key and model settings in Settings
   - If using a local model, ensure the model server is running and reachable

## Contributing

1. Fork
2. Create a feature branch
3. Implement changes and tests
4. Submit a pull request

## License

MIT License

## Author

Eson <474420502@qq.com>

---

If you'd like, I can also:

- Split `README.md` to be purely English and leave `README_zh.md` as the Chinese translation (I'll do that now),
- Add example screenshots or a short GIF to the README,
- Add badges for CI or release status.

## Releases / CI

This repository includes a GitHub Actions workflow that builds platform binaries and creates a Release when you push a tag that starts with `v` (for example: `v1.2.3`). The workflow builds on the matching OS runners and uploads the `dist-electron/` output as release assets.

How to create a release tag locally and push:

```bash
git tag v1.2.3
git push origin v1.2.3
```

Notes:
- The action uses the repository's default `GITHUB_TOKEN` so no extra secrets are required for basic releases.
- macOS code signing or notarization requires additional secrets/certificates and is not configured by default. If you need signed macOS builds, add the appropriate signing keys to the Actions secrets and update the workflow.
- The workflow builds the platform-specific target on the corresponding runner (Linux on ubuntu-latest, macOS on macos-latest, Windows on windows-latest).


`<parameter name="filePath">`/home/eson/workspace/clipboard-god/README.md

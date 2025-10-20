# Clipboard God

A powerful clipboard manager built with Electron and React.

## Features

- **Persistent Clipboard History**: Never lose your copied content
- **Smart Search**: Quickly find items in your clipboard history
- **Keyboard Navigation**: Navigate through history with arrow keys
- **Screenshot Support**: Capture and manage screenshots
- **Multiple Themes**: Choose from 10 beautiful themes
- **Cross-Platform**: Works on Windows, macOS, and Linux

## Installation

### From Source

1. Clone the repository:

```bash
git clone https://github.com/your-username/clipboard-god.git
cd clipboard-god
```

2. Install dependencies:

```bash
npm install
```

3. Start development:

```bash
npm run dev
```

4. Build for production:

```bash
npm run build
npm start
```

### Pre-built Binaries

Download the latest release from the [Releases](https://github.com/your-username/clipboard-god/releases) page.

#### Linux (AppImage)

```bash
chmod +x "Clipboard God-1.0.0.AppImage"
./"Clipboard God-1.0.0.AppImage"
```

#### Windows

Run the `.exe` installer from the releases.

#### macOS

Open the `.dmg` file and drag the app to Applications.

## Building from Source

### Prerequisites

- Node.js 16+
- npm or yarn

### Build Commands

```bash
# gfw 
npm config set registry https://registry.npmmirror.com
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
ELECTRON_BUILDER_BINARIES_MIRROR="https://registry.npmmirror.com/-/binary/electron-builder-binaries/"

# Install dependencies
npm install

# Development
npm run dev

# Build for current platform
npm run dist

# Build for specific platforms
npm run dist:win    # Windows
npm run dist:mac    # macOS
npm run dist:linux  # Linux
npm run dist:all    # All platforms
```

## Configuration

The app stores its configuration in:

- **Linux**: `~/.config/clipboard-god/config.json`
- **Windows**: `%APPDATA%\clipboard-god\config.json`
- **macOS**: `~/Library/Application Support/clipboard-god/config.json`

### Settings

- **Max History Items**: Control how many items to keep in history (default: 1000)
- **Theme**: Choose from 10 available themes
- **Keyboard Shortcuts**: Customize global shortcuts

## Development

### Project Structure

```
clipboard-god/
├── src/
│   ├── main/           # Electron main process
│   ├── preload/        # Preload scripts
│   └── renderer/       # React UI
├── dist/               # Built frontend
├── dist-electron/      # Built Electron app
└── assets/             # Icons and assets
```

### Technologies Used

- **Electron**: Cross-platform desktop app framework
- **React**: UI framework
- **Vite**: Build tool and dev server
- **Better SQLite3**: Database for clipboard storage
- **Electron Screenshots**: Screenshot functionality

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Author

Eson <474420502@qq.com>`</content>`
`<parameter name="filePath">`/home/eson/workspace/clipboard-god/README.md

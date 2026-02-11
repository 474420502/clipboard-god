# Qt Build Record

Date: 2026-02-09

## Successful build steps (Linux)

```bash
sudo apt-get update && sudo apt-get install -y ninja-build build-essential cmake qt6-base-dev qt6-base-dev-tools qt6-qml-dev qt6declarative-dev qt6svg6-dev libqt6sql6-sqlite libqt6svg6 qt6etworkauth-dev libdbus-1-dev
cmake -S /home/eson/workspace/clipboard-god/qt -B /home/eson/workspace/clipboard-god/qt/build -G Ninja
cmake --build /home/eson/workspace/clipboard-god/qt/build
```

Result: build succeeded, binary at `qt/build/clipboard-god-qt`.

## X11 Shortcut Support

### Build Options

- `USE_QHOTKEY` (default: ON): Enable QHotkey for X11 shortcuts

### Build Examples

```bash
# Enable QHotkey (X11)
cmake -S . -B build -DUSE_QHOTKEY=ON

# Disable QHotkey (X11 shortcuts off)
cmake -S . -B build -DUSE_QHOTKEY=OFF
```

## Notes
- If `cmake -S . -B build -G Ninja` is run from the repo root, it fails because there is no top-level CMakeLists.txt. Use the `qt` directory as the source path.
- Wayland shortcut portals are not supported.
- On X11, QHotkey is used if available.
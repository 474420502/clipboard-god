# Qt Build Record

Date: 2026-02-09

## Successful build steps (Linux)

```bash
sudo apt-get update && sudo apt-get install -y ninja-build build-essential cmake qt6-base-dev qt6-base-dev-tools qt6-qml-dev qt6declarative-dev qt6svg6-dev libqt6sql6-sqlite libqt6svg6 qt6etworkauth-dev libdbus-1-dev
cmake -S /home/eson/workspace/clipboard-god/qt -B /home/eson/workspace/clipboard-god/qt/build -G Ninja
cmake --build /home/eson/workspace/clipboard-god/qt/build
```

Result: build succeeded, binary at `qt/build/clipboard-god-qt`.

## Wayland Portal Shortcuts Support

### Build Options

- `USE_WAYLAND_PORTAL` (default: ON): Enable xdg-desktop-portal shortcuts for Wayland
- `USE_QHOTKEY` (default: ON): Enable QHotkey for X11 shortcuts

### Build Examples

```bash
# Enable Wayland Portal shortcuts (default)
cmake -S . -B build -DUSE_WAYLAND_PORTAL=ON

# Disable Wayland Portal shortcuts
cmake -S . -B build -DUSE_WAYLAND_PORTAL=OFF

# Disable QHotkey (X11 only)
cmake -S . -B build -DUSE_QHOTKEY=ON -DUSE_WAYLAND_PORTAL=ON
```

### Runtime Dependencies

For Wayland portal shortcuts to work:
- `xdg-desktop-portal` >= 1.14
- `xdg-desktop-portal-gtk` (or your desktop's portal implementation)
- DBus session bus

### Testing

```bash
# Run all tests
ctest --test-dir build

# Run Wayland shortcut tests
ctest --test-dir build -R WaylandShortcut
```

## Notes
- If `cmake -S . -B build -G Ninja` is run from the repo root, it fails because there is no top-level CMakeLists.txt. Use the `qt` directory as the source path.
- Wayland portal shortcuts require a running DBus session and portal service.
- On X11, QHotkey is used if available.
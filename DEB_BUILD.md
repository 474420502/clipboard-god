# Building the Clipboard God .deb package

This repository includes a simple packaging helper `build-deb.sh` that creates a Debian package (.deb) containing the app, desktop entry and icons.

Usage:

1. Ensure you have the build artifacts available (recommended):
   - `linux-unpacked/` should contain the packaged Electron app (or otherwise populate `/opt/clipboard-god` in the package).
   - `assets/` should contain icon PNGs named like `icon-16.png`, `icon-32.png`, `icon-256.png`, etc., or a fallback `icon.png`.

2. Run the builder (optionally pass version):

```bash
./build-deb.sh 1.0.0
```

3. Install the generated package:

```bash
sudo dpkg -i dist/clipboard-god_1.0.0_amd64.deb
sudo apt-get install -f # if dependencies are missing
```

Notes:
- The script places application files under `/opt/clipboard-god` and provides a wrapper at `/usr/bin/clipboard-god`.
- The `.desktop` entry will point to `/usr/bin/clipboard-god` and the Icon name `clipboard-god`. The package installs icons into `/usr/share/icons/hicolor/<size>x<size>/apps/clipboard-god.png` and updates icon cache in maintainer scripts.
- Customize `deb/DEBIAN/*` scripts and `control` if you need extra dependencies or behaviors.

Tray / Indicator support:
- On some desktop environments (Unity, GNOME on X11), the system needs indicator/StatusNotifier support for Electron tray icons to appear. The deb control file recommends/depends on the following packages to improve compatibility:
   - `libayatana-appindicator3-1` (Depends)
   - `libappindicator3-1` (Depends)
   - `indicator-application` (Recommends) — provides the system indicator host on some Ubuntu/Unity setups

If users report the tray icon not appearing, ensure these packages are installed and then log out and log back in (or restart the panel).

#!/bin/bash

# If the user invoked this script with `sh build.sh`, /bin/sh may be dash and
# does not support bash-only features used below (regex, BASH_REMATCH, [[ ).
# Re-exec under bash if we're not already running in bash.
if [ -z "${BASH_VERSION:-}" ]; then
	if command -v bash >/dev/null 2>&1; then
		exec bash "$0" "$@"
	else
		echo "ERROR: this script requires bash. Run with 'bash build.sh' or install bash." >&2
		exit 1
	fi
fi

# Clipboard God Build Script
# This script builds the application for distribution

PKG_NAME="clipboard-god"
DEFAULT_VERSION="1.0.0"
if command -v node >/dev/null 2>&1 && [ -f package.json ]; then
	CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "$DEFAULT_VERSION")
else
	CURRENT_VERSION="$DEFAULT_VERSION"
fi

echo "🚀 Building Clipboard God..."

# Native deps rebuild guard (X11 only; no Wayland support)
STAMP_DIR=".cache/build"
STAMP_FILE="$STAMP_DIR/native-deps.stamp"
mkdir -p "$STAMP_DIR"

PKG_HASH=""
LOCK_HASH=""
PKG_MANAGER="npm"
LOCK_FILE="package-lock.json"
INSTALL_CMD=(npm install)
BUILD_CMD=(npm run build)

if [ -f pnpm-workspace.yaml ]; then
	PKG_MANAGER="pnpm"
	LOCK_FILE="pnpm-lock.yaml"
	INSTALL_CMD=(pnpm install)
	BUILD_CMD=(pnpm run build)
	if ! command -v pnpm >/dev/null 2>&1; then
		echo "ERROR: pnpm is required for this workspace. Install pnpm first." >&2
		exit 1
	fi
fi

if command -v sha256sum >/dev/null 2>&1; then
	PKG_HASH=$(sha256sum package.json 2>/dev/null | awk '{print $1}')
	if [ -f "$LOCK_FILE" ]; then
		LOCK_HASH=$(sha256sum "$LOCK_FILE" 2>/dev/null | awk '{print $1}')
	fi
fi

ELECTRON_VERSION=""
if [ -f node_modules/electron/package.json ]; then
	ELECTRON_VERSION=$(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null || echo "")
fi

STAMP_CONTENT="manager=${PKG_MANAGER} pkg=${PKG_HASH} lockFile=${LOCK_FILE} lock=${LOCK_HASH} electron=${ELECTRON_VERSION} platform=$(uname -s) arch=$(uname -m)"

SKIP_NATIVE_REBUILD=0
if [ -d node_modules ] && [ -f "$STAMP_FILE" ] && grep -qxF "$STAMP_CONTENT" "$STAMP_FILE"; then
	SKIP_NATIVE_REBUILD=1
fi

# Resume an interrupted .deb packaging run only when explicitly requested.
# By default we remove stale staging directories so source changes always
# produce a fresh package instead of finalizing an old dist-deb-* tree.
if [ "${CONTINUE_BUILD:-0}" = "1" ]; then
	LATEST_DIR=$(ls -1dt dist-deb-* 2>/dev/null | head -n1 || true)
	if [ -n "$LATEST_DIR" ]; then
		STAGING_SUB=$(ls -1 "$LATEST_DIR" 2>/dev/null | grep "^${PKG_NAME}_" | head -n1 || true)
		if [ -n "$STAGING_SUB" ]; then
			STAGING_PATH="$LATEST_DIR/$STAGING_SUB"
			# try to read control to determine package file name
			if [ -f "$STAGING_PATH/DEBIAN/control" ]; then
				pkg_ver=$(grep -i '^Version:' "$STAGING_PATH/DEBIAN/control" | head -n1 | cut -d: -f2 | tr -d ' \t') || pkg_ver=""
				pkg_arch=$(grep -i '^Architecture:' "$STAGING_PATH/DEBIAN/control" | head -n1 | cut -d: -f2 | tr -d ' \t') || pkg_arch=""
			else
				pkg_ver=""
				pkg_arch=""
			fi
			# fallback values
			pkg_ver=${pkg_ver:-$CURRENT_VERSION}
			pkg_arch=${pkg_arch:-$(dpkg --print-architecture 2>/dev/null || echo amd64)}
			DEB_FILE_EXPECTED="dist/${PKG_NAME}_${pkg_ver}_${pkg_arch}.deb"
			if [ ! -f "$DEB_FILE_EXPECTED" ]; then
				echo "Detected existing staging: $STAGING_PATH"
				echo "Building .deb from staging into $DEB_FILE_EXPECTED"
				# Ensure DEBIAN/control exists; if not, create a minimal one so dpkg-deb can build
				if [ ! -f "$STAGING_PATH/DEBIAN/control" ]; then
					echo "Staging is missing DEBIAN/control — creating a minimal control file"
					mkdir -p "$STAGING_PATH/DEBIAN"
					write_debian_control "$STAGING_PATH/DEBIAN/control" "${pkg_ver:-$CURRENT_VERSION}" "${pkg_arch:-amd64}"
				fi
				# Copy any maintainer scripts from deb/DEBIAN into the staging DEBIAN
				if [ -d deb/DEBIAN ]; then
					for f in postinst postrm prerm preinst; do
						if [ -f "deb/DEBIAN/$f" ]; then
							cp "deb/DEBIAN/$f" "$STAGING_PATH/DEBIAN/$f"
							chmod 0755 "$STAGING_PATH/DEBIAN/$f" || true
						fi
					done
				fi
				mkdir -p dist
				dpkg-deb --build "$STAGING_PATH" "$DEB_FILE_EXPECTED"
				mkdir -p dist-electron
				cp -v "$DEB_FILE_EXPECTED" dist-electron/ || true
				echo ".deb rebuilt from previous staging and copied to dist-electron/"
				exit 0
			fi
		fi
	fi
fi

prune_old_staging_dirs() {
	shopt -s nullglob
	local stale_dirs=(dist-deb-*)
	if [ ${#stale_dirs[@]} -gt 0 ]; then
		echo "🧹 Removing stale Debian staging directories..."
		rm -rf -- "${stale_dirs[@]}"
	fi
	shopt -u nullglob
}

write_debian_control() {
	local target="$1"
	local version="$2"
	local arch="$3"

	if [ -f deb/DEBIAN/control ]; then
		awk -v pkg="$PKG_NAME" -v version="$version" -v arch="$arch" '
			BEGIN {
				seenPkg = 0
				seenVersion = 0
				seenArch = 0
			}
			/^#/ { next }
			/^Package:/ {
				print "Package: " pkg
				seenPkg = 1
				next
			}
			/^Version:/ {
				print "Version: " version
				seenVersion = 1
				next
			}
			/^Architecture:/ {
				print "Architecture: " arch
				seenArch = 1
				next
			}
			{ print }
			END {
				if (!seenPkg) {
					print "Package: " pkg
				}
				if (!seenVersion) {
					print "Version: " version
				}
				if (!seenArch) {
					print "Architecture: " arch
				}
			}
		' deb/DEBIAN/control > "$target"
	else
		cat > "$target" <<EOF
Package: $PKG_NAME
Version: $version
Section: utils
Priority: optional
Architecture: $arch
Depends: libc6 (>= 2.17)
Maintainer: Clipboard God Packager <packager@example.com>
Description: A powerful clipboard manager built with Electron and React
 A small clipboard manager.
EOF
	fi
}

prune_old_staging_dirs

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist dist-electron dist-deb-*

# Install dependencies (only when needed)
if [ "$SKIP_NATIVE_REBUILD" = "1" ]; then
	echo "📦 Dependencies unchanged; skipping ${PKG_MANAGER} install"
else
	echo "📦 Installing dependencies..."
	"${INSTALL_CMD[@]}"
	if command -v sha256sum >/dev/null 2>&1 && [ -f "$LOCK_FILE" ]; then
		LOCK_HASH=$(sha256sum "$LOCK_FILE" 2>/dev/null | awk '{print $1}')
	fi
	# refresh electron version after install and update stamp
	if [ -f node_modules/electron/package.json ]; then
		ELECTRON_VERSION=$(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null || echo "")
	fi
	STAMP_CONTENT="manager=${PKG_MANAGER} pkg=${PKG_HASH} lockFile=${LOCK_FILE} lock=${LOCK_HASH} electron=${ELECTRON_VERSION} platform=$(uname -s) arch=$(uname -m)"
	echo "$STAMP_CONTENT" > "$STAMP_FILE"
fi

# Build the application
echo "🔨 Building application..."
"${BUILD_CMD[@]}"

# Create distributables
echo "📦 Creating distributables..."
if [ "$SKIP_NATIVE_REBUILD" = "1" ]; then
	# Skip native rebuild when nothing changed
	npx electron-builder --config.npmRebuild=false --config.nodeGypRebuild=false
else
	npx electron-builder
fi

# -------------------------
# Optional: build .deb package
# Set SKIP_DEB=1 to skip deb packaging
# -------------------------
if [ "${SKIP_DEB:-0}" = "1" ]; then
	echo "Skipping .deb packaging because SKIP_DEB=1"
else
	echo "📦 Packaging .deb..."

	PKG_NAME="clipboard-god"
	ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"

	# Try to detect version from package.json
	if [ -n "${1:-}" ]; then
		VERSION="$1"
	else
		VERSION="$CURRENT_VERSION"
	fi


  # Use a timestamped staging directory to avoid permission issues from prior runs
	BUILD_DIR="dist-deb-$(date +%s)"
	STAGING="$BUILD_DIR/${PKG_NAME}_${VERSION}_${ARCH}"

	mkdir -p "$STAGING"

	mkdir -p "$STAGING/DEBIAN"
	mkdir -p "$STAGING/opt/$PKG_NAME"
	mkdir -p "$STAGING/usr/bin"
	mkdir -p "$STAGING/usr/share/applications"
	mkdir -p "$STAGING/usr/share/icons/hicolor"

	# Copy locales directory to the package
	mkdir -p "$STAGING/opt/$PKG_NAME/locales"
	cp -r locales/*.json "$STAGING/opt/$PKG_NAME/locales/"

	# Copy electron-builder output into /opt if available (prefer dist-electron/linux-unpacked)
	UNPACKED_SRC=""
	if [ -d "dist-electron/linux-unpacked" ]; then
		UNPACKED_SRC="dist-electron/linux-unpacked"
	elif [ -d "linux-unpacked" ]; then
		UNPACKED_SRC="linux-unpacked"
	fi

#	If $UNPACKED_SRC exists, copy the full payload. Otherwise fallback wrapper.
	if [ -n "$UNPACKED_SRC" ]; then
		echo "Copying $UNPACKED_SRC to /opt/$PKG_NAME"
		cp -a "$UNPACKED_SRC" "$STAGING/opt/$PKG_NAME/"
		# ensure permissions: readable and executable for dirs and already-executable files
		chmod -R a+rX "$STAGING/opt/$PKG_NAME"
		# If main binary exists, ensure it's executable
		if [ -f "$STAGING/opt/$PKG_NAME/$(basename "$UNPACKED_SRC")/clipboard-god" ]; then
			chmod 0755 "$STAGING/opt/$PKG_NAME/$(basename "$UNPACKED_SRC")/clipboard-god" || true
			ln -sf "/opt/$PKG_NAME/$(basename "$UNPACKED_SRC")/clipboard-god" "$STAGING/usr/bin/clipboard-god" || true
		elif [ -f "$STAGING/opt/$PKG_NAME/clipboard-god" ]; then
			chmod 0755 "$STAGING/opt/$PKG_NAME/clipboard-god" || true
			ln -sf "/opt/$PKG_NAME/clipboard-god" "$STAGING/usr/bin/clipboard-god" || true
		else
			# fallback wrapper
			cat > "$STAGING/usr/bin/clipboard-god" <<EOF
#!/bin/sh
exec /opt/clipboard-god/$(basename "$UNPACKED_SRC")/clipboard-god "$@"
EOF
			chmod 0755 "$STAGING/usr/bin/clipboard-god"
		fi
	else
		echo "Warning: no linux-unpacked output found. Creating wrapper for /opt/$PKG_NAME"
		cat > "$STAGING/usr/bin/clipboard-god" <<EOF
#!/bin/sh
exec /opt/clipboard-god/clipboard-god "$@"
EOF
		chmod 0755 "$STAGING/usr/bin/clipboard-god"
	fi

	# Copy locales directory
	cp -r locales "$STAGING/opt/$PKG_NAME/"

	# Ensure desktop entry points to /usr/bin/clipboard-god and Icon name clipboard-god
	if [ -f clipboard-god.desktop ]; then
		sed -e 's|^Exec=.*|Exec=/usr/bin/clipboard-god|' -e 's|^Icon=.*|Icon=clipboard-god|' clipboard-god.desktop > "$STAGING/usr/share/applications/clipboard-god.desktop"
	else
		cat > "$STAGING/usr/share/applications/clipboard-god.desktop" <<'EOF'
[Desktop Entry]
Name=Clipboard God
Comment=A powerful clipboard manager built with Electron and React
Exec=/usr/bin/clipboard-god
Icon=clipboard-god
Type=Application
Categories=Utility;
Terminal=false
StartupWMClass=clipboard-god
Keywords=clipboard;manager;electron;
EOF
	fi

	# Copy available icons into hicolor dirs
	for icon in assets/icon-*.png assets/icon.png; do
		[ -e "$icon" ] || continue
		base=$(basename "$icon")
		if [[ "$base" =~ icon-([0-9]+)\.png ]]; then
			size=${BASH_REMATCH[1]}
		else
			size=64
		fi
		dest_dir="$STAGING/usr/share/icons/hicolor/${size}x${size}/apps"
		mkdir -p "$dest_dir"
		cp "$icon" "$dest_dir/clipboard-god.png"
		echo "Installed icon $icon -> $dest_dir/clipboard-god.png"
	done

	# Build DEBIAN/control
	write_debian_control "$STAGING/DEBIAN/control" "$VERSION" "$ARCH"

	# Copy maintainer scripts if exist
	if [ -d deb/DEBIAN ]; then
		# Ensure source maintainer scripts are executable so their mode is preserved
		# when copied into the staging tree and packed into the .deb.
		for f in postinst postrm prerm preinst; do
			if [ -f "deb/DEBIAN/$f" ]; then
				chmod 0755 "deb/DEBIAN/$f" || true
			fi
		done
		for f in postinst postrm prerm preinst; do
			if [ -f "deb/DEBIAN/$f" ]; then
				cp "deb/DEBIAN/$f" "$STAGING/DEBIAN/$f"
				chmod 0755 "$STAGING/DEBIAN/$f"
			fi
		done
	fi

	mkdir -p dist
	DEB_FILE="dist/${PKG_NAME}_${VERSION}_${ARCH}.deb"
	LATEST_DEB_FILE="dist/${PKG_NAME}_latest_${ARCH}.deb"
	dpkg-deb --build "$STAGING" "$DEB_FILE"
	cp -f "$DEB_FILE" "$LATEST_DEB_FILE"

	echo "Built $DEB_FILE"
	echo "Updated latest alias: $LATEST_DEB_FILE"
	echo "You can install it with: sudo apt install ./$DEB_FILE"
	echo "Or safer (always newest): sudo apt install ./$LATEST_DEB_FILE"

	# Also copy .deb into dist-electron for convenience (group release artifacts together)
	if [ -d dist-electron ]; then
		mkdir -p dist-electron
		cp "$DEB_FILE" dist-electron/ || true
		cp -f "$DEB_FILE" "dist-electron/${PKG_NAME}_latest_${ARCH}.deb" || true
		echo "Copied $DEB_FILE -> dist-electron/"
	fi
fi

# After packaging steps, prune dist-electron to keep only final installers
if [ -d dist-electron ]; then
	echo "🗑️  Pruning non-installer artifacts from dist-electron..."
	TMPDIR=$(mktemp -d)
	shopt -s nullglob
	for pattern in "*.AppImage" "*.deb" "*.dmg" "*.exe" "*.msi" "*.zip"; do
		for f in dist-electron/$pattern; do
			if [ -e "$f" ]; then
				mv "$f" "$TMPDIR/"
			fi
		done
	done
	rm -rf dist-electron/*
	mv "$TMPDIR"/* dist-electron/ 2>/dev/null || true
	rmdir "$TMPDIR" 2>/dev/null || true
	shopt -u nullglob
fi

echo "✅ Build complete!"
echo ""
echo "Generated files:"
ls -la dist-electron/*.AppImage 2>/dev/null || echo "No AppImage found"
ls -la dist-electron/*.exe 2>/dev/null || echo "No Windows executable found"
ls -la dist-electron/*.dmg 2>/dev/null || echo "No macOS DMG found"
ls -la dist-electron/*.deb 2>/dev/null || echo "No Debian package found"

echo ""
echo "To test the AppImage on Linux:"
echo "chmod +x dist-electron/Clipboard\\ God-*.AppImage"
echo "./dist-electron/Clipboard\\ God-*.AppImage"


#!/bin/bash

# Clipboard God Desktop Integration Script
# This script installs/updates the .desktop file for Clipboard God

echo "Clipboard God Desktop Integration"
echo "================================="

# Get the absolute path of the project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_FILE="$PROJECT_DIR/clipboard-god.desktop"
ICONS_DIR="$PROJECT_DIR/assets"
USER_APPS_DIR="$HOME/.local/share/applications"
USER_ICONS_DIR="$HOME/.local/share/icons/hicolor"

echo "Project directory: $PROJECT_DIR"
echo "Desktop file: $DESKTOP_FILE"
echo "User applications directory: $USER_APPS_DIR"
echo "Icons directory: $ICONS_DIR"

# Create user applications directory if it doesn't exist
mkdir -p "$USER_APPS_DIR"

# Copy desktop file
if cp "$DESKTOP_FILE" "$USER_APPS_DIR/"; then
    echo "✓ Desktop file copied successfully"
else
    echo "✗ Failed to copy desktop file"
    exit 1
fi

# Make it executable
if chmod +x "$USER_APPS_DIR/clipboard-god.desktop"; then
    echo "✓ Desktop file made executable"
else
    echo "✗ Failed to make desktop file executable"
    exit 1
fi

# Install icons into the user's hicolor icon theme so the desktop environment can find them by name
if [ -d "$ICONS_DIR" ]; then
    echo "Installing icons from $ICONS_DIR to $USER_ICONS_DIR/..."
    # list of sizes we generate
    sizes=(16 32 48 64 128 256 512 1024)
    for s in "${sizes[@]}"; do
        src="$ICONS_DIR/icon-$s.png"
        if [ -f "$src" ]; then
            dest_dir="$USER_ICONS_DIR/${s}x${s}/apps"
            mkdir -p "$dest_dir"
            dest="$dest_dir/clipboard-god.png"
            if cp "$src" "$dest"; then
                echo "✓ Installed icon $s x $s"
            else
                echo "✗ Failed to install icon $s"
            fi
        fi
    done
    # also copy fallback icon.png if present
    if [ -f "$ICONS_DIR/icon.png" ]; then
        mkdir -p "$USER_ICONS_DIR/64x64/apps"
        cp "$ICONS_DIR/icon.png" "$USER_ICONS_DIR/64x64/apps/clipboard-god.png" || true
    fi

    # Update icon cache if possible
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
        echo "Updating icon cache..."
        gtk-update-icon-cache -f -t "$USER_ICONS_DIR" || true
    else
        echo "! gtk-update-icon-cache not found, you may need to log out/in to see icons"
    fi
else
    echo "! Icons directory $ICONS_DIR not found, skipping icon install"
fi

# Update desktop database
if command -v update-desktop-database >/dev/null 2>&1; then
    if update-desktop-database "$USER_APPS_DIR"; then
        echo "✓ Desktop database updated"
    else
        echo "✗ Failed to update desktop database"
    fi
else
    echo "! update-desktop-database not found, you may need to restart your session"
fi

# Validate desktop file
if command -v desktop-file-validate >/dev/null 2>&1; then
    if desktop-file-validate "$USER_APPS_DIR/clipboard-god.desktop"; then
        echo "✓ Desktop file validation passed"
    else
        echo "✗ Desktop file validation failed"
    fi
else
    echo "! desktop-file-validate not found, skipping validation"
fi

echo ""
echo "Installation complete!"
echo "You should now see 'Clipboard God' in your application menu."
echo "If it doesn't appear immediately, try logging out and back in,"
echo "or run: update-desktop-database ~/.local/share/applications/"
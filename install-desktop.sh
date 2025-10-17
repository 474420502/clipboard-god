#!/bin/bash

# Clipboard God Desktop Integration Script
# This script installs/updates the .desktop file for Clipboard God

echo "Clipboard God Desktop Integration"
echo "================================="

# Get the absolute path of the project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_FILE="$PROJECT_DIR/clipboard-god.desktop"
USER_APPS_DIR="$HOME/.local/share/applications"

echo "Project directory: $PROJECT_DIR"
echo "Desktop file: $DESKTOP_FILE"
echo "User applications directory: $USER_APPS_DIR"

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
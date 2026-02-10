#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$SCRIPT_DIR/build/clipboard-god-qt"

# Force X11/XWayland backend for Qt
export QT_QPA_PLATFORM=xcb
# Hint other toolkits (optional but helps when mixed)
export GDK_BACKEND=x11

exec "$BIN" "$@"

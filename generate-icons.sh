#!/bin/bash

# Clipboard God Icon Generator
# Generate PNG icons from SVG source for electron-builder

echo "🎨 Generating icons from SVG..."

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick not found. Please install it first:"
    echo "   Ubuntu/Debian: sudo apt-get install imagemagick"
    echo "   CentOS/RHEL: sudo yum install ImageMagick"
    echo "   macOS: brew install imagemagick"
    exit 1
fi

# Check if source SVG exists
if [ ! -f "assets/icon.svg" ]; then
    echo "❌ Source file assets/icon.svg not found!"
    exit 1
fi

# Create assets directory if it doesn't exist
mkdir -p assets

# Generate icons in different sizes
echo "📐 Generating 256x256 icon (electron-builder requirement)..."
convert assets/src-png.png -resize 256x256 -background transparent assets/icon-256.png

echo "📐 Generating 512x512 icon (high DPI)..."
convert assets/src-png.png -resize 512x512 -background transparent assets/icon-512.png

echo "📐 Generating 1024x1024 icon (macOS)..."
convert assets/src-png.png -resize 1024x1024 -background transparent assets/icon-1024.png

echo "📐 Generating 64x64 icon (fallback)..."
convert assets/src-png.png -resize 64x64 -background transparent assets/icon.png

echo "📐 Generating 32x32 icon (small)..."
convert assets/src-png.png -resize 32x32 -background transparent assets/icon-32.png

echo "📐 Generating 16x16 icon (tiny)..."
convert assets/src-png.png -resize 16x16 -background transparent assets/icon-16.png

echo "📐 Generating ICO file (Windows)..."
convert assets/src-png.png -resize 256x256 -background transparent assets/icon.ico

echo "✅ Icon generation complete!"
echo ""
echo "Generated files:"
ls -la assets/icon*.png assets/icon*.ico 2>/dev/null || echo "No icon files found"

echo ""
echo "📋 Usage in package.json:"
echo '  "build": {'
echo '    "icon": "assets/icon-256.png"'
echo '  }'

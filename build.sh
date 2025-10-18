#!/bin/bash

# Clipboard God Build Script
# This script builds the application for distribution

echo "🚀 Building Clipboard God..."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist dist-electron

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the application
echo "🔨 Building application..."
npm run build

# Create distributables
echo "📦 Creating distributables..."
npm run dist

echo "✅ Build complete!"
echo ""
echo "Generated files:"
ls -la dist-electron/*.AppImage 2>/dev/null || echo "No AppImage found"
ls -la dist-electron/*.exe 2>/dev/null || echo "No Windows executable found"
ls -la dist-electron/*.dmg 2>/dev/null || echo "No macOS DMG found"

echo ""
echo "To test the AppImage on Linux:"
echo "chmod +x dist-electron/Clipboard\\ God-*.AppImage"
echo "./dist-electron/Clipboard\\ God-*.AppImage"
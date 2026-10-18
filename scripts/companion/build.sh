#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== Building Sisyfuz Companion Menu Bar App ==="

# Compile Swift file to ARM64 native binary
swiftc -O -target arm64-apple-macos14.0 SisyfuzCompanion.swift -o SisyfuzCompanion

# Create macOS .app bundle directory structure
APP_NAME="SisyfuzCompanion.app"
rm -rf "$APP_NAME"
mkdir -p "$APP_NAME/Contents/MacOS"
mkdir -p "$APP_NAME/Contents/Resources"

# Move binary to Contents/MacOS
cp SisyfuzCompanion "$APP_NAME/Contents/MacOS/SisyfuzCompanion"
cp ChatHUD.html "$APP_NAME/Contents/Resources/ChatHUD.html"

# Create minimal Info.plist
cat << 'EOF' > "$APP_NAME/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>SisyfuzCompanion</string>
    <key>CFBundleIdentifier</key>
    <string>com.sisyfuz.companion</string>
    <key>CFBundleName</key>
    <string>SisyfuzCompanion</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

echo "[OK] Built $DIR/$APP_NAME successfully!"
echo "     Launch with: open $DIR/$APP_NAME"

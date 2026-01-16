#!/bin/bash

echo "==================================================="
echo "  NeoTavern Launcher"
echo "==================================================="

if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed."
    exit 1
fi

PKG_HASH_FILE="node_modules/.package-json.hash"
LAST_PKG_HASH="none"
if [ -f "$PKG_HASH_FILE" ]; then
    LAST_PKG_HASH=$(cat "$PKG_HASH_FILE")
fi

# Calculate Hash
CURRENT_PKG_HASH=$(node -p "require('crypto').createHash('sha256').update(require('fs').readFileSync('package.json')).digest('hex')")

NEED_INSTALL=false
if [ ! -d "node_modules" ]; then
    echo "[1/2] Installing dependencies..."
    NEED_INSTALL=true
elif [ "$CURRENT_PKG_HASH" != "$LAST_PKG_HASH" ]; then
    echo "[1/2] package.json changed. Reinstalling..."
    NEED_INSTALL=true
else
    echo "[1/2] Dependencies verified."
fi

if [ "$NEED_INSTALL" = true ]; then
    npm ci
    if [ $? -ne 0 ]; then
        echo "[ERROR] npm ci failed."
        exit 1
    fi
    echo "$CURRENT_PKG_HASH" > "$PKG_HASH_FILE"
fi

echo "[2/2] Starting..."
node launcher.js
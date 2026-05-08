#!/bin/bash
# Generates og-image.png from og-image.html using headless Chrome
# Usage: ./generate-og.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new \
  --disable-gpu \
  --screenshot="$SCRIPT_DIR/og-image.png" \
  --window-size=1200,630 \
  --hide-scrollbars \
  "file://$SCRIPT_DIR/og-image.html" 2>/dev/null

echo "✅ og-image.png generated"

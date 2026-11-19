#!/bin/sh
# Renders the store listing images into store/. Needs Google Chrome and Node.
# Usage: sh tools/store-images/build.sh
set -e
cd "$(dirname "$0")/../.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
node tools/store-images/server.js &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1
shot() { # name width height path
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size="$2,$3" \
    --virtual-time-budget=12000 --screenshot="store/$1.png" "http://localhost:8793$4" >/dev/null 2>&1
  echo "wrote store/$1.png"
}
mkdir -p store
shot screenshot-1-results 1280 800 "/slide?n=1"
shot screenshot-2-status-codes 1280 800 "/slide?n=2"
shot screenshot-3-sign-in-and-bot-checks 1280 800 "/slide?n=3"
shot screenshot-4-search-and-export 1280 800 "/slide?n=4"
shot screenshot-5-sitemap-files 1280 800 "/slide?n=5"
shot promo-small-440x280 440 280 "/promo"
shot promo-marquee-1400x560 1400 560 "/marquee"

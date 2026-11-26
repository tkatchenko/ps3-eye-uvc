#!/bin/sh
set -eu
iconset=../build/EyeControls.iconset
mkdir -p "$iconset" "$1"
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" assets/EyeControls.png --out "$iconset/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z "$double" "$double" assets/EyeControls.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$1/EyeControls.icns"

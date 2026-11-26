#!/bin/sh
set -eu
cd "$(dirname "$0")"
usb=$(brew --prefix libusb)
bundle='../build/Eye Controls.app'
mkdir -p "$bundle/Contents/MacOS"
sh build-icon.sh "$bundle/Contents/Resources"
cp Info.plist "$bundle/Contents/Info.plist"
cc -Wall -Wextra -Wno-unused-parameter -Werror -fobjc-arc \
    -I"$usb/include/libusb-1.0" main.m "$usb/lib/libusb-1.0.a" \
    -framework AVFoundation -framework CoreMedia -framework CoreVideo -framework CoreMediaIO -framework Cocoa -framework IOKit -framework Security \
    -o "$bundle/Contents/MacOS/EyeControls"
codesign --force --sign - "$bundle"
codesign --verify --strict "$bundle"

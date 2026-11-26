#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
usb=$(brew --prefix libusb)
mkdir -p build
cc -Wall -Wextra -Werror -I"$usb/include/libusb-1.0" tools/eye-usb.c \
    "$usb/lib/libusb-1.0.a" -framework IOKit -framework CoreFoundation \
    -framework Security -o build/eye-usb

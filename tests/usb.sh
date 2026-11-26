#!/bin/sh
# Run with the matching private factory backup and the built Stage 8.2 image.
set -eu
test "$#" -eq 2
stock=$1
target=$2
root=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cc -I"$(brew --prefix libusb)/include/libusb-1.0" -Wall -Wextra -Werror \
    "$root/tools/eye-usb.c" "$root/tests/mock-eye.c" -o "$scratch/eye"
export EYE_FIXTURE="$stock" EYE_RESULT="$scratch/readback"
"$scratch/eye" backup "$scratch/backup"
cmp "$stock" "$scratch/backup"
if "$scratch/eye" backup "$scratch/backup"; then exit 1; fi
"$scratch/eye" check "$scratch/backup" "$target"
cmp "$stock" "$EYE_RESULT"
if "$scratch/eye" install "$target" "$stock"; then exit 1; fi
if EYE_FIXTURE="$target" "$scratch/eye" install "$stock" "$target"; then exit 1; fi
cmp "$target" "$EYE_RESULT"
if EYE_CORRUPT_WRITE=1 "$scratch/eye" install "$stock" "$target"; then exit 1; fi
"$scratch/eye" install "$stock" "$target"
cmp "$target" "$EYE_RESULT"
echo "Simulated backup, install, readback and rejection checks passed."

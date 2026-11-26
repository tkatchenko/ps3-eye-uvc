#!/bin/sh
set -eu
if [ "$#" -ne 2 ]; then
    echo "Usage: firmware/build.sh FACTORY_EEPROM LINUX_V6_12_OV534_C" >&2
    exit 2
fi
root=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
for tool in node sdas8051 sdld ucsim_51; do
    command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
done
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/firmware/stages"
cp "$1" "$scratch/ps3-eye-B4.04.27.1-eeprom.bin"
cp "$2" "$scratch/firmware/ov534.c"
cd "$scratch"
echo '54e981e66a754134e2695b0297c5dfed68aacf696548bf54940aef7d02002c73  firmware/ov534.c' | shasum -a 256 -c -
cp "$root/firmware/build-descriptors.ts" firmware/
cp "$root"/firmware/stages/*.ts "$root"/firmware/stages/*.asm firmware/stages/
node firmware/build-descriptors.ts
for step in bench test-stage4 stage7 stage8 stage8-1 stage8-2; do
    node "firmware/stages/build-$step.ts"
done
image=firmware/stages/stage8-2.eeprom.bin
echo "7cf9d48dc24beb04a4f075315783fefb85ac568fe7bf00f785386d247de13c61  $image" | shasum -a 256 -c -
mkdir -p "$root/build"
cp "$image" "$root/build/stage8-2.eeprom.bin"

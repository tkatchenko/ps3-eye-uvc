# PlayStation Eye UVC for macOS

This project converts the tested PlayStation Eye into a USB Video Class webcam. The Mac receives video through its built-in camera driver and audio through the Eye's USB microphone. The optional Eye Controls app adjusts the camera and saves a profile on the device.

Stage 8.2 is an experimental source release for one hardware revision. The macOS USB tool backs up a stock Eye and installs an image built from that backup. Eye Controls is optional after installation.

## Read before installing

**A failed write or a power interruption can leave the Eye unable to start.** Keep a separate copy of the factory backup. A backup preserves the bytes, but a camera that no longer appears on USB may require an external EEPROM programmer. USB recovery after an interrupted installation has not been demonstrated.

The physical test camera reached Stage 8.2 through several incremental updates. The direct stock-to-Stage-8.2 installer has passed simulated USB tests, including full readback and injected write corruption. A direct installation on a second, stock camera is still unverified. Use the installer only if you accept the possibility of losing the camera.

This is an independent community project. Sony, PlayStation, OmniVision and Apple have not endorsed it. The firmware and tools are provided as experimental software without a guarantee of compatibility or recovery.

## Tested hardware and performance

The test unit was a USB high-speed PlayStation Eye with an OV538 bridge, OV772x sensor, USB ID `1415:2000` and factory product string `USB Camera-B4.04.27.1`. The prototype identifies itself as `USB Camera-B4.04.27.T`. Other revisions have not been tested.

| Mode | Capture with the Eye microphone on macOS | Longest delivery gap |
| --- | --- | --- |
| 640 x 480 YUY2, 30 fps | 30.2 fps over 12 seconds | 44 ms |
| 640 x 480 YUY2, 60 fps | 57.7 fps over 90 seconds | 89 ms |

Both tests used the frame rate confirmed by the camera's USB controls. The 90-second run delivered 5,174 frames and recorded no repeated frame signatures. Presentation timestamps indicated about 209 missing frame periods. Use 30 fps for steadier capture.

## Back up a stock Eye over USB

Install the Xcode Command Line Tools, Homebrew and libusb on the Mac. Connect exactly one Eye and close applications using its camera or microphone. Run these commands from the repository root.

```sh
brew install libusb
./tools/build.sh
./build/eye-usb backup factory-backup.bin
```

Use a new filename. The tool reads the EEPROM twice, compares both reads, saves the file and verifies it from disk. It refuses to overwrite an existing file. If the tool reports an unsupported EEPROM, keep the backup and stop here. Copy the verified backup to separate storage before continuing.

## Build Eye Controls

On macOS, install the Xcode Command Line Tools and Homebrew, then run these commands from the repository root.

```sh
brew install libusb
./app/build.sh
open "build/Eye Controls.app"
```

The build signs the app locally and verifies its signature. Open a camera preview to adjust orientation, exposure or white balance. To change warmth while keeping automatic exposure, choose **Lock current white balance**, then move **Warmth**. The slider adjusts relative red and blue gains. Choose **Save to Camera** to keep the resulting settings after a power cycle. Close other camera previews before running the app's frame-rate and microphone test.

## Reproduce the firmware

The build requires Node.js with native TypeScript stripping (tested with Node 26), SDCC 4.6 tools (`sdas8051`, `sdld` and `ucsim_51` on PATH), and your own 8,192-byte factory EEPROM backup. The expected SHA-256 is `5a11ae9f011060025aac82c6dbcda55d9d4ff0e226e9f65185cd3e9e9df76ffa`. A different image will fail the build check.

Fetch the matching Linux camera driver for its sensor and bridge register tables, then build from the repository root.

```sh
mkdir -p build
curl --fail --location https://raw.githubusercontent.com/torvalds/linux/v6.12/drivers/media/usb/gspca/ov534.c -o build/ov534.c
./firmware/build.sh factory-backup.bin build/ov534.c
```

The offline build verifies the inputs, runs the 8051 simulator checks and verifies the final image before placing it at `build/stage8-2.eeprom.bin`. Its expected SHA-256 is `7cf9d48dc24beb04a4f075315783fefb85ac568fe7bf00f785386d247de13c61`. The build makes no USB writes. A failed EEPROM installation can prevent the camera from enumerating over USB.

## Install Stage 8.2 over USB

Build the firmware from your verified backup using the instructions above. With capture apps closed, run the preflight check. It verifies the backup and release hashes, then compares the live EEPROM against the backup without writing to the EEPROM.

```sh
./build/eye-usb check factory-backup.bin build/stage8-2.eeprom.bin
```

After the check passes, keep the Mac awake and the camera connected. This command starts the EEPROM write immediately.

```sh
caffeinate -i ./build/eye-usb install factory-backup.bin build/stage8-2.eeprom.bin
```

The installer repeats the checks, writes the changed bytes and verifies each one. Unplug the camera **only after** the tool prints `All 8192 bytes verified. Unplug and reconnect the Eye.` Reconnect it, select `USB Camera-B4.04.27.T` in a macOS camera app and check the preview. Select the Eye separately as the audio input to use its microphone.

If a write or readback fails, keep the Eye powered and save the terminal output. The installer requires an exact stock image and will refuse a partially written EEPROM. Full readback confirms the stored bytes. The first successful cold boot and capture confirm that the camera runs them.

## Third-party components

The firmware build reads register tables from the Linux v6.12 OV534 driver by Antonio Ospite, Jim Paris, Jean-Francois Moine and other contributors, under GPL-2.0-or-later. The app links against the locally installed libusb library. Supply your own factory backup and build the app locally. [Linux OV534 source](https://github.com/torvalds/linux/blob/v6.12/drivers/media/usb/gspca/ov534.c) and [libusb](https://github.com/libusb/libusb).

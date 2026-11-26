// Generate local emulator fixtures from the verified B4 EEPROM.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const file = (name: string) => new URL(name, import.meta.url);
const stock = readFileSync(file('../../ps3-eye-B4.04.27.1-eeprom.bin'));
assert.equal(createHash('sha256').update(stock).digest('hex'),
  '5a11ae9f011060025aac82c6dbcda55d9d4ff0e226e9f65185cd3e9e9df76ffa');
const marker = Buffer.from(stock);
const original = Buffer.from('USB Camera-B4.04.27.1', 'utf16le');
const label = Buffer.from('USB Camera-B4.04.27.T', 'utf16le');
const start = marker.indexOf(original);
assert.equal(start, 0x36c);
label.copy(marker, start);
assert.equal(marker.filter((v,i) => v !== stock[i]).length, 1);
writeFileSync(file('identity-only.eeprom.bin'), marker);

const bench = Buffer.from(marker);
function patch(pc: number, before: string, after: string) {
  const offset = 4 + pc;
  const old = Buffer.from(before, 'hex');
  const replacement = Buffer.from(after, 'hex');
  assert.equal(old.length, replacement.length);
  assert(bench.subarray(offset, offset + old.length).equals(old));
  replacement.copy(bench, offset);
}
// SUBB A,wLengthHi in the high-byte clamp comparison.
patch(0x053d, '9400', '9535');
// Copy wLengthHi to the response length when the host asks for fewer bytes.
patch(0x0543, '752e00', '85352e');
// The later 16-bit sent == clamped-length test covers both completion cases.
// Skip the redundant low-byte host-length test and reuse that comparison.
patch(0x0595, 'af36', '8009');
writeFileSync(file('length-fix.eeprom.bin'), bench);

// Third bench stage: advertise the proposed configuration at high speed.
// This image has no UVC streaming-control integration or sensor start routine.
const hs = readFileSync(file('../high-speed-config.bin'));
const other = Buffer.from(hs);
other[1] = 7;
const highSpeedAddress = bench.readUInt16BE(2);
const otherSpeedAddress = highSpeedAddress + hs.length;
// A Device Qualifier describes the device as it would appear at the OTHER speed.
const fsQualifierAddress = otherSpeedAddress + other.length;
const hsQualifierAddress = fsQualifierAddress + 10;
const selectorAddress = hsQualifierAddress + 10;
const selector = Buffer.from([
  0xe5,0x29,                          // MOV A, speed flags
  0x30,0xe5,0x07,                     // JNB ACC.5, running_full_speed
  0x7e,fsQualifierAddress >> 8,0x7f,fsQualifierAddress & 255,
  0x02,0x04,0xee,                     // stock descriptor pointer/length path
  0x7e,hsQualifierAddress >> 8,0x7f,hsQualifierAddress & 255,
  0x02,0x04,0xee
]);
const payloadSize = selectorAddress + selector.length;
assert(payloadSize + 4 < 0x1fe0); // leave the stock EEPROM trailer intact
hs.copy(bench, 4 + highSpeedAddress);
other.copy(bench, 4 + otherSpeedAddress);
bench.writeUInt16BE(payloadSize, 2);
function redirect(pc: number, old: string, address: number) {
  const load = Buffer.from([0x7e,address >> 8,0x7f,address & 255]);
  patch(pc, old, load.toString('hex'));
}
redirect(0x04c3, '7e017f12', highSpeedAddress);
redirect(0x0518, '7e027fa4', otherSpeedAddress);
// High-speed device descriptor uses the IAD composite device class triple.
patch(0x00f2, '000000', 'ef0201');
function writeQualifier(deviceAddress: number, address: number) {
  const device = bench.subarray(4 + deviceAddress, 4 + deviceAddress + 18);
  const qualifier = Buffer.from([10,6,...device.subarray(2,8),device[17],0]);
  qualifier.copy(bench,4 + address);
}
// Match the full-speed microphone endpoint interval in its other-speed copy.
patch(0x0222 + 120, "04", "01");
selector.copy(bench,4 + selectorAddress);
writeQualifier(0x100, fsQualifierAddress);
writeQualifier(0x00ee, hsQualifierAddress);
patch(0x04f8,'750b03',Buffer.from([2,selectorAddress >> 8,selectorAddress & 255]).toString('hex'));
writeFileSync(file('high-speed-enumeration-only.eeprom.bin'), bench);

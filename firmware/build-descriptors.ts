// Offline high-speed configuration fixture. This program only reads and writes local files.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const local = (path: string) => new URL(path, import.meta.url);
const eeprom = readFileSync(local('../ps3-eye-B4.04.27.1-eeprom.bin'));
assert.equal(createHash('sha256').update(eeprom).digest('hex'),
  '5a11ae9f011060025aac82c6dbcda55d9d4ff0e226e9f65185cd3e9e9df76ffa');

function le16(n: number) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function le32(n: number) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
function descriptor(type: number, ...fields: number[]) {
  return Buffer.from([2 + fields.length, type, ...fields]);
}
function split(b: Buffer) {
  const items: Buffer[] = [];
  for (let offset = 0; offset < b.length;) {
    const length = b[offset];
    assert(length >= 2 && offset + length <= b.length);
    items.push(b.subarray(offset, offset + length));
    offset += length;
  }
  return items;
}
const frameSize = 640 * 480 * 2;
const interval = 333333; // units of 100 ns
const bitrate = frameSize * 8 * 30;
const clock = 30_000_000; // Nominal PTS clock inferred from two stock-camera runs.
const cameraTerminal = descriptor(0x24, 2, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0);
const outputTerminal = descriptor(0x24, 3, 2, 1, 1, 0, 1, 0);
const vcHeader = descriptor(0x24, 1, 0x10, 1, ...le16(13 + cameraTerminal.length + outputTerminal.length),
  ...le32(clock), 1, 1);
const yuy2 = Buffer.from('5955593200001000800000aa00389b71', 'hex');
const format = descriptor(0x24, 4, 1, 1, ...yuy2, 16, 1, 0, 0, 0, 0);
const frame = descriptor(0x24, 5, 1, 0, ...le16(640), ...le16(480), ...le32(bitrate),
  ...le32(bitrate), ...le32(frameSize), ...le32(interval), 1, ...le32(interval));
const vsHeader = descriptor(0x24, 1, 1, ...le16(14 + format.length + frame.length),
  0x81, 0, 2, 0, 0, 0, 1, 0);
const iface = (id: number, endpoints: number, subclass: number) =>
  descriptor(4, id, 0, endpoints, 14, subclass, 0, 0);
const iad = (first: number, cls: number, sub: number) => descriptor(11, first, 2, cls, sub, 0, 0);
const audio = Buffer.from(eeprom.subarray(4 + 0x139, 4 + 0x1a0));
for (const item of split(audio)) {
  if (item[1] === 4) item[2]++; // AC 1 -> 2 and AS 2 -> 3, including both alternates
}
assert.equal(audio[9 + 8], 2);
audio[9 + 8] = 3; // AudioControl header's baInterfaceNr points to AudioStreaming
const body = Buffer.concat([iad(0, 14, 3), iface(0, 0, 1), vcHeader, cameraTerminal,
  outputTerminal, iface(1, 1, 2), vsHeader, format, frame,
  descriptor(5, 0x81, 2, ...le16(512), 0), iad(2, 1, 0), audio]);
const config = Buffer.concat([descriptor(2, ...le16(9 + body.length), 4, 1, 0, 0x80, 250), body]);
const probe = Buffer.alloc(34);
probe[2] = 1; probe[3] = 1;
probe.writeUInt32LE(interval, 4);
probe.writeUInt32LE(frameSize, 18);
probe.writeUInt32LE(2048, 22);
probe.writeUInt32LE(clock, 26);
probe[30] = 3; // FID and EOF required by the proposed framing contract
// One payload format version for this fixture.
probe.fill(1, 31, 34);
const parts = split(config);
assert.deepEqual(parts.filter(p => p[1] === 4).map(p => [p[2],p[3]]), [[0,0],[1,0],[2,0],[3,0],[3,1]]);
assert.deepEqual(parts.filter(p => p[1] === 5).map(p => p[2]), [0x81,0x84]);
assert.deepEqual([vcHeader.length,cameraTerminal.length,outputTerminal.length,vsHeader.length,format.length,frame.length], [13,18,9,14,27,30]);
assert.equal(config.readUInt16LE(2), config.length);
writeFileSync(local('high-speed-config.bin'), config);
writeFileSync(local('probe-default.bin'), probe);
console.log(config.length, 'configuration bytes;', probe.length, 'probe bytes');

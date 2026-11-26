import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';

const file=(name:string)=>new URL(name,import.meta.url);
const image=readFileSync(file('stage8-1.eeprom.bin'));
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(image),'508629a2a694d6f1e2e0966e1413327227e603f36a08631d8c951a8a6a52b1f1');
const payload=4092;
const field=4+0xd50+22;
assert.equal(image.readUInt32LE(field),16384);
image.writeUInt32LE(payload,field);
// 60 fps bridge setup. Select PLOAD_H, write the high and low size bytes
// through the auto-increment port, then tail-call the common settings code.
const pc=4+0x1b89;
const original=Buffer.from('78e57404f2781c7401f2087410f2e4f2021565ff','hex');
assert(image.subarray(pc,pc+original.length).equals(original));
const units=payload/4;
Buffer.from([0x78,0xe5,0x74,4,0xf2,0x78,0x1c,0x74,1,0xf2,8,0x74,units>>8,0xf2,0x74,units&255,0xf2,2,0x15,0x65]).copy(image,pc);
assert.equal(image.readUInt32LE(field),4*(image[pc+12]*256+image[pc+15]));
writeFileSync(file('stage8-2.eeprom.bin'),image);
console.log(digest(image));

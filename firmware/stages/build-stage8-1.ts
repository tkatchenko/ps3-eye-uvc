import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
const file=(name:string)=>new URL(name,import.meta.url);
const image=readFileSync(file('stage8-controls.eeprom.bin'));
assert.equal(createHash('sha256').update(image).digest('hex'),'313c77c0426c0932aecb2b2fd66c43e55c5b1f81d2c6e6dcf78446291c82ff26');
function patch(pc:number,original:string,next:string){
  const after=Buffer.from(next,'hex'),target=image.subarray(pc+4,pc+4+after.length);
  assert.equal(target.toString('hex'),original);after.copy(target);
}
// Leave the gain stage enabled when automatic gain calculation stops.
patch(0x1591,'742a','74aa');
// The fast mode advertises a 16384-byte payload in UVC Probe and Commit.
patch(0x0d50+22,'00080000','00400000');
// Both modes enter here after the base register table has selected 2048 bytes.
// Normal speed branches directly to apply_profile. Fast speed selects 16384.
patch(0x1601,'6013','6013');
patch(0x1611,'78e57404f2','021b890000');
// Preserve fast-mode clock programming, set indirect payload size in units
// of four bytes, then tail-call the common settings routine.
const fast='78e57404f2781c7401f2087410f2e4f2021565';
patch(0x1b89,'ff'.repeat(fast.length/2),fast);
writeFileSync(file('stage8-1.eeprom.bin'),image);
console.log(createHash('sha256').update(image).digest('hex'));

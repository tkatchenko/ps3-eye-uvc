// Run with SDCC's sdas8051, sdld and ucsim_51 on PATH. No USB access.
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir = mkdtempSync(join(tmpdir(),'eye-query-'));
const local = (s:string) => fileURLToPath(new URL(s,import.meta.url));
const stage = readFileSync(local('high-speed-enumeration-only.eeprom.bin'));
const originalEnd = stage.readUInt16BE(2);
assert(originalEnd <= 0xc00);
const code = Buffer.alloc(0xd44);
stage.copy(code,0,4,4+originalEnd);
assert.equal(code.subarray(0x469,0x46c).toString('hex'),'12055e');
code.writeUInt16BE(0xc00,0x46a);
const mode = readFileSync(local('../probe-default.bin'));
assert.equal(mode.length,34);
mode.copy(code,0xd00);
execFileSync('sdas8051',['-los','query.rel',local('stage4-query.asm')],{cwd:dir});
execFileSync('sdld',['-i','query','query.rel'],{cwd:dir});
for(const line of readFileSync(join(dir,'query.ihx'),'utf8').trim().split(/\r?\n/)){
  const row=Buffer.from(line.slice(1),'hex');
  assert.equal(row.reduce((a,b)=>a+b,0)&255,0);
  if(row[3]===1)break;
  assert.equal(row[3],0);
  const addr=row.readUInt16BE(1);
  assert(addr>=0xc00 && addr+row[0]<=0xd00);
  row.copy(code,addr,4,4+row[0]);
}
const listing=readFileSync(join(dir,'query.lst'),'utf8');
const bytePC=parseInt(listing.match(/^\s*([0-9A-F]{6})\s+\d+ after_byte:/m)![1],16);
const records:string[]=[];
for(let i=0;i<code.length;i+=16){
  const block=code.subarray(i,i+16);
  const row=[block.length,i>>8,i&255,0,...block];
  row.push(-row.reduce((a,b)=>a+b,0)&255);
  records.push(':'+Buffer.from(row).toString('hex'));
}
writeFileSync(join(dir,'combined.ihx'),records.join('\n')+'\n:00000001FF\n');
const commands=[`break ${bytePC}`,'break 0x046c','break 0x055e','break 0x08fb'];
const expected:number[]=[];
function observe(expr:string,value:number){
  commands.push('expression /d 100000+'+expr);
  expected.push(100000+value);
}
function setup(type:number,request:number,selector:number,index:number,length:number,high=true){
  commands.push('set memory sfr 0x81 0x39','set memory sfr 0xa0 0',
    `set memory iram 0x27 ${index>>8} ${index&255} ${high?32:0} ${selector} 0 ${request} ${type}`,
    `set memory iram 0x35 ${length>>8} ${length&255}`);
}
let cases=0;
for(const selector of [1,2]){
  for(const [request,reply] of [[0x85,[34,0]],[0x86,[1]],[0x81,[...mode]],[0x82,[...mode]],[0x83,[...mode]],[0x84,Array(34).fill(0)],[0x87,[...mode]]] as const){
    if([0x82,0x83,0x84,0x87].includes(request) && selector===2)continue;
    for(const length of [0,1,2,8,33,34,64,256,65535]){
      setup(0xa1,request,selector,1,length);
      commands.push('run 0x044a');
      for(const byte of reply.slice(0,length)){
        observe('PC',bytePC); observe('xram[5]',byte); commands.push('run');
      }
      observe('PC',0x46c);observe('xram[6]',5);cases++;
    }
  }
}
// Read path bounds, audio and the stock full-speed personality.
for(const [type,index,selector,request,high] of [[0xa1,2,1,0x85,1],[0xa2,0x84,1,0x81,1],
    [0x80,0,1,6,1],[0xa1,1,1,0x85,0],[0xa1,0x101,1,0x85,1],[0xa1,1,2,0x87,1]]){
  setup(type,request,selector,index,2,!!high);
  commands.push('run 0x044a');observe('PC',0x55e);cases++;
}
// Stock OUT data-stage routing from the second interrupt.
for(const [type,index] of [[0x21,2],[0x22,0x84],[0x21,1]]){
  setup(type,1,1,index,34);commands.push('run 0x045f');observe('PC',0x8fb);cases++;
}
writeFileSync(join(dir,'test.cmd'),commands.join('\n')+'\n');
const output=execFileSync('ucsim_51',['-q','-c','-','combined.ihx'],{
  cwd:dir,input:'exec "test.cmd"\nquit\n',encoding:'utf8',timeout:30000,maxBuffer:8e6});
const actual=Array.from(output.matchAll(/^([1-9][0-9]{5})\s*$/gm),m=>Number(m[1]));
assert.deepEqual(actual,expected);
console.log(`${cases} cases and ${expected.length} observations passed`);

const image = Buffer.from(stage);
code.copy(image, 4);
image.writeUInt16BE(code.length, 2);
assert(image.subarray(code.length + 4).equals(stage.subarray(code.length + 4)));
writeFileSync(local('stage4-mode-queries.eeprom.bin'),image);

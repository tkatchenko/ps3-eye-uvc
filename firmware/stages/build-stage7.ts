import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const local = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'eye-stream-'));
const image = readFileSync(local('stage4-mode-queries.eeprom.bin'));
assert.equal(createHash('sha256').update(image).digest('hex'),'74e744975ff150ab3c866a1916150cbfb8998438e68218dfb7888eea19aac70e');
const tables = readFileSync(local('../ov534.c'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
function table(name:string,type:number) {
  const body = tables.split(name+'[][2] = {')[1].split('};')[0];
  const entries = Array.from(body.matchAll(/\{\s*(0x[\da-f]+),\s*(0x[\da-f]+)\s*\}/gi));
  assert(entries.length>5);
  return entries.map(([,a,b])=>[type,Number(a),Number(b)]);
}
const sequence=[...table('bridge_init_772x',1),...table('sensor_init_772x',2),[1,0xe0,9],
  ...table('bridge_start_vga_yuyv_772x',1),...table('sensor_start_vga_yuyv_772x',2),
  [2,0x0c,0xd0],[2,0x0e,0x4d],[2,0x11,4],[2,0x0d,0x81],[1,0xe5,2]];
const asm=readFileSync(local('stage7-idle.asm'),'utf8')+sequence.map(row=>'    .db '+row.join(',')).join('\n')+'\n    .db 0\n';
writeFileSync(join(dir,'stream.asm'),asm);
execFileSync('sdas8051',['-los','stream.rel','stream.asm'],{cwd:dir});
execFileSync('sdld',['-i','stream','stream.rel'],{cwd:dir});
function patch(pc:number,old:string,bytes:string) {
  assert.equal(image.subarray(pc+4,pc+4+old.length/2).toString('hex'),old);
  Buffer.from(bytes,'hex').copy(image,pc+4);
}
patch(0x03bf,'7806e2','120fa0');
patch(0x044a,'e52d30e708','020fa70000');
patch(0x473,'1208fb','120e00');
patch(0x7bd,'e534b401fb','020e800000');
const stage4info=image.indexOf(Buffer.from('02055e220001','hex'));
assert(stage4info>0xc00 && stage4info<0xd04);
image[stage4info+5]=3;
let end=0;
for(const line of readFileSync(join(dir,'stream.ihx'),'utf8').trim().split(/\r?\n/)){
  const row=Buffer.from(line.slice(1),'hex');
  assert.equal(row.reduce((a,b)=>a+b,0)&255,0);
  if(row[3]===1)break;
  assert.equal(row[3],0);
  const pc=row.readUInt16BE(1);
  assert(pc>=0xe00 && pc+row[0]<0x1fe0);
  row.copy(image,pc+4,4,4+row[0]);
  end=Math.max(end,pc+row[0]);
}
// Preserve the factory audio interface numbers. Interface 0 has no endpoints.
const hs=readFileSync(local('../high-speed-config.bin'));
const factory=readFileSync(local('../../ps3-eye-B4.04.27.1-eeprom.bin'));
const audio=factory.subarray(4+0x139,4+0x1a0);
const video=Buffer.from(hs.subarray(9,153));
for(let i=0;i<video.length;i+=video[i]){
  if(video[i+1]===11)video[i+2]=3;
  if(video[i+1]===4)video[i+2]+=3;
  if(video[i]===13 && video[i+1]===0x24 && video[i+2]===1)video[i+12]=4;
}
const config=Buffer.concat([hs.subarray(0,9),Buffer.from([9,4,0,0,0,255,0,0,0,8,11,1,2,1,0,0,0]),audio,video]);
config.writeUInt16LE(config.length,2);config[4]=5;
assert.equal(config.length,273);
const interfaces=[], endpoints=[];
for(let i=0;i<config.length;){
  const size=config[i];assert(size>=2 && i+size<=config.length);
  if(config[i+1]===4)interfaces.push([config[i+2],config[i+3]]);
  if(config[i+1]===5)endpoints.push(config[i+2]);
  i+=size;
}
assert.deepEqual(interfaces,[[0,0],[1,0],[2,0],[2,1],[3,0],[4,0]]);
assert.deepEqual(endpoints,[0x84,0x81]);
function redirect(pc:number,previous:number,address:number){
  const load=(v:number)=>Buffer.from([0x7e,v>>8,0x7f,v&255]).toString('hex');
  patch(pc,load(previous),load(address));
}
redirect(0x4c3,0x96d,end);config.copy(image,end+4);end+=config.length;
redirect(0x518,0xa75,end);const other=Buffer.from(config);other[1]=7;other.copy(image,end+4);end+=other.length;
assert(end+4<0x1fe0);
patch(0xc0a,'e528b401','e528b404');
image.writeUInt16BE(end,2);
const records=[];
for(let pc=0;pc<end;pc+=16){
  const data=image.subarray(4+pc,4+Math.min(end,pc+16));
  const row=[data.length,pc>>8,pc&255,0,...data];
  row.push(-row.reduce((a,b)=>a+b,0)&255);
  records.push(':'+Buffer.from(row).toString('hex'));
}
writeFileSync(join(dir,'test.ihx'),records.join('\n')+'\n:00000001FF\n');
const listing=readFileSync(join(dir,'stream.lst'),'utf8');
const label=(s:string)=>parseInt(listing.match(new RegExp('^\\s*([0-9A-F]{6})\\s+\\d+ '+s+':','m'))![1],16);
assert.equal(label('setup_dispatch'),0xfa7);
const commands=['set memory sfr 0x81 0x39','set memory sfr 0xa0 0','break 0x090d','break 0x08fb','break 0x07c2'];
const expected:number[]=[];
function observe(expr:string,value:number){commands.push('expression /d 100000+'+expr);expected.push(100000+value);}
for(const [selector,index,length,byte,pc,pending] of [[1,4,34,1,0x90d,0],[2,4,34,1,0x90d,1],[2,4,34,2,0x90d,0],[2,1,34,1,0x8fb,0],[2,4,2,1,0x8fb,0]]){
  commands.push('set memory iram 0x16 0 0', 'set memory iram 0x27 0 '+index+' 32 '+selector+' 0 1 33','set memory iram 0x35 0 '+length,'set memory xram 5 '+byte,'run 0xe00');
  observe('PC',pc);observe('iram[0x17]',pending);
}
commands.push('set memory iram 0x16 1 0','set memory iram 0x27 0 4 32 2 0 1 33','set memory iram 0x35 0 34','set memory xram 5 1','run 0xe00');observe('PC',0x90d);observe('iram[0x17]',0);
commands.push('set memory iram 0x34 1','run 0x0e80');observe('PC',0x7c2);
for(const [status,target] of [[0,'enable_video'],[4,'failed'],[1,'failed']] as const){
  commands.push('set memory iram 0x17 1','set memory iram 0x34 0','set memory xram 0xf6 '+status,'break '+label(target),'run 0xe80');
  observe('PC',label(target));observe('iram[0x17]',0);
  if(!status){observe('xram[0xc0]',0x50);observe('xram[0xe5]',2);observe('xram[0xf1]',0x42);}
  commands.push('clear '+label(target));
}
commands.push('break 0x0457','set memory iram 0x16 1 1','set memory iram 0x27 0 129 32 0 0 1 2','set memory iram 0x35 0 0','run 0x044a');
observe('PC',0x457);observe('iram[0x16]',0);observe('iram[0x17]',0);observe('xram[0xe0]',9);
commands.push('clear 0x0457','set memory iram 0x16 1 0','set memory iram 0x34 0','set memory xram 0xe6 98','set memory xram 0x23 225','break '+label('ready'),'run 0xe80');
observe('iram[0x16]',0);observe('xram[0xe0]',9);observe('xram[0x23]',97);
commands.push('step 2');observe('xram[0xe6]',97);
writeFileSync(join(dir,'check.cmd'),commands.join('\n')+'\n');
const out=execFileSync('ucsim_51',['-q','-c','-','test.ihx'],{cwd:dir,input:'exec "check.cmd"\nquit\n',encoding:'utf8',timeout:60000,maxBuffer:4e6});
assert.deepEqual([...out.matchAll(/^([1-9][0-9]{5})\s*$/gm)].map(m=>Number(m[1])),expected);
writeFileSync(local('stage7-idle.eeprom.bin'),image);
console.log(expected.length+' machine-code checks passed. SHA-256 '+createHash('sha256').update(image).digest('hex'));

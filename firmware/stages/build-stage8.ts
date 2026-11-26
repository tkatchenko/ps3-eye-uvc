import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeControls} from './stage8-controls.ts';
const here=(name:string)=>fileURLToPath(new URL(name,import.meta.url));
const old=readFileSync(here('stage7-idle.eeprom.bin'));
assert.equal(createHash('sha256').update(old).digest('hex'),'2de505b567c0c8cde3219a2705fe9bc9669d4f5958ffa4e310668e9f93b3d746');
const image=Buffer.from(old), dir=mkdtempSync(join(tmpdir(),'eye-profile-'));
const hs=old.subarray(4+0x118e,4+0x129f);
const parts:Buffer[]=[];
let subclass=0;
for(let i=0;i<hs.length;i+=hs[i]){
  const d=Buffer.from(hs.subarray(i,i+hs[i]));
  if(d[1]===4)subclass=d[5]===14?d[6]:0;
  if(subclass===1&&d[1]===36){
    if(d[2]===1)d.writeUInt16LE(d.readUInt16LE(5)+13+26,5);
    if(d[2]===2)d[15]=10;
    if(d[2]===3){
      parts.push(Buffer.from([13,36,5,3,1,0,0,3,128,36,0,0,0]));
      parts.push(Buffer.from([26,36,6,4,...Buffer.from('c4e7a12cc4bb4cc9979e64f74d914b08','hex'),3,1,3,1,7,0]));
      d[7]=4;
    }
  }
  if(subclass===2&&d[1]===36){
    if(d[2]===1)d.writeUInt16LE(d.readUInt16LE(4)+4,4);
    if(d[2]===5){
      d[0]+=4;d.writeUInt32LE(640*480*16*60,13);d[25]=2;d.writeUInt32LE(166667,26);
      parts.push(Buffer.concat([d,Buffer.from([21,22,5,0])]));continue;
    }
  }
  parts.push(d);
}
const config=Buffer.concat(parts);config.writeUInt16LE(config.length,2);
assert.equal(config.length,316);
const other=Buffer.from(config);other[1]=7;
const asData=(b:Buffer)=>Array.from({length:Math.ceil(b.length/16)},(_,i)=>'.db '+[...b.subarray(i*16,i*16+16)].join(',')).join('\n')+'\n';
const seq=old.indexOf(Buffer.from([1,0x88,0xf8,1,0x89,0xff]),4+0xfa0);
assert(seq>0); const table=old.subarray(seq,4+0x118e);assert.equal(table.at(-1),0);
let asm=readFileSync(here('stage7-idle.asm'),'utf8');
function replace(a:string,b:string){assert(asm.includes(a));asm=asm.replace(a,b);}
replace('mov r6,#30','lcall capture_interval');
replace('cjne a,#2,ack','cjne a,#2,probe_rate');
replace('    mov a,0x16\n    jnz ack',`    mov a,r1
    cjne a,0x49,change_rate
    mov a,0x16
    jnz ack
change_rate:
    mov 0x49,r1`);
replace('ack:\n','    sjmp ack\nprobe_rate:\n    mov 0x48,r1\nack:\n');
replace('check_pending:\n','check_pending:\n    lcall service8\n');
replace('    lcall initialise','    inc 0x4a\n    lcall initialise');
replace('enable_video:\n','enable_video:\n    lcall rate_setup\n');
replace('failed:\n','failed:\n    inc 0x4c\n    mov 0x4d,#4\n');
replace('    lcall stop_video\n    mov r0,#0xe6','    mov 0x4d,#1\n    lcall stop_video\n    mov r0,#0xe6');
replace('usb_reset:\n    lcall stop_video','usb_reset:\n    lcall reset_stop');
replace('    lcall stop_video\noriginal_setup','    mov 0x4d,#3\n    lcall stop_video\noriginal_setup');
replace('    mov 0x16,#0\n    mov r0,#0xe0\n    mov a,#9\n    movx @r0,a\n    mov r0,#0x23','    inc 0x4b\n    mov 0x16,#0\n    mov r0,#0xe0\n    mov a,#9\n    movx @r0,a\n    mov r0,#0x23');
asm+=asData(table)+'config8:\n'+asData(config)+'other8:\n'+asData(other)+'descriptors_end:\n';
asm+=readFileSync(here('stage8-core.asm'),'utf8').replace('ljmp 0x0c58','ljmp 0x0c59');
asm+='\nreset_stop:\nmov 0x4d,#2\nljmp stop_video\n'+makeControls()+'code_end:\n';
const mode=readFileSync(here('../probe-default.bin'));mode.writeUInt32LE(166667,4);
asm+='.org 0x0d50\nmode60:\n'+asData(mode);
asm+='.org 0x096d\n';
for(const fps of [30,60]){
  asm+='lines'+fps+':\n'+asData(Buffer.from(Array.from({length:161},(_,i)=>Math.min(255,Math.round(i*0.0001*fps*510/2)))));
}
writeFileSync(join(dir,'stage.asm'),asm);
execFileSync('sdas8051',['-los','stage.rel','stage.asm'],{cwd:dir});
execFileSync('sdld',['-i','stage','stage.rel'],{cwd:dir});
const listing=readFileSync(join(dir,'stage.lst'),'utf8');
const label=(name:string)=>parseInt(listing.match(new RegExp('^\\s*([0-9A-F]{6})\\s+\\d+ '+name+':','m'))![1],16);
assert(label('descriptors_end')<=0x1500);assert(label('code_end')<0x1fb0);
const occupied=new Set<number>();
for(const l of readFileSync(join(dir,'stage.ihx'),'utf8').trim().split(/\r?\n/)){
  const r=Buffer.from(l.slice(1),'hex');assert.equal(r.reduce((a,b)=>a+b,0)&255,0);
  if(r[3]===1)break;
  assert.equal(r[3],0);
  const pc=r.readUInt16BE(1);
  for(let n=0;n<r[0];n++){assert(!occupied.has(pc+n));occupied.add(pc+n);}
  r.copy(image,4+pc,4,4+r[0]);
}
function patch(pc:number,prev:string,newData:Buffer){assert(old.subarray(pc+4,pc+4+newData.length).equals(Buffer.from(prev,'hex')));newData.copy(image,pc+4);}
function jump(pc:number,prev:string,op:number,name:string){const x=label(name);patch(pc,prev,Buffer.from([op,x>>8,x&255]));}
jump(0x954,'758139',2,'boot8');jump(0x469,'120c00',18,'in8');jump(0x473,'120e00',18,'out8');jump(0xc56,'900d00',2,'interval_reply');
for(const [pc,src,name] of [[0x4c3,'7e117f8e','config8'],[0x518,'7e127f9f','other8']] as const){
 const x=label(name);patch(pc,src,Buffer.from([0x7e,x>>8,0x7f,x&255]));
}
assert.equal(label('setup_dispatch'),0xfa7);
image.writeUInt16BE(0x1fca,2);
const records=[];
for(let pc=0;pc<0x1fca;pc+=16){const b=image.subarray(4+pc,4+Math.min(0x1fca,pc+16));const row=[b.length,pc>>8,pc&255,0,...b];row.push(-row.reduce((a,b)=>a+b,0)&255);records.push(':'+Buffer.from(row).toString('hex'));}
writeFileSync(join(dir,'test.ihx'),records.join('\n')+'\n:00000001FF\n');
const cmds:string[]=[], checks:number[]=[];
function cmd(s:string){cmds.push(s);}
function check(expr:string,value:number){cmd('expression /d 100000+'+expr);checks.push(100000+value);}
cmd('set memory sfr 0xa0 0');cmd('break 0x755');cmd('run 0x954');check('iram[0x41]',2);check('iram[0x42]',120);
cmd('break 0x090d');cmd('break 0x060a');
for(const [unit,sel,len,value,reg] of [[1,2,1,1,65],[3,13,1,0,67],[3,5,1,1,70],[4,3,1,1,122]]){
 cmd('set memory iram 0x27 '+unit+' 3 32 '+sel+' 0 1 33');
 cmd('set memory iram 0x35 0 '+len);cmd('set memory xram 5 '+value);cmd('run '+label('out8'));check('PC',0x90d);check('iram['+reg+']',value);
}
for(const [unit,sel,len,last] of [[1,2,1,1],[1,4,4,0],[3,5,1,1],[4,2,1,8],[4,1,7,1]]){
 cmd('set memory iram 0x27 '+unit+' 3 32 '+sel+' 0 129 161');cmd('set memory iram 0x35 0 '+len);cmd('run '+label('in8'));check('PC',0x60a);check('xram[5]',last);
}
cmd('set memory iram 0x27 0 4 32 1 0 129 161');cmd('set memory iram 0x35 0 5');cmd('set memory iram 0x48 1');cmd('run '+label('in8'));check('xram[5]',11);
cmd('set memory iram 0x48 0');cmd('run '+label('in8'));check('xram[5]',21);
// Feed each interval byte as the FIFO register advances, then check the real OUT path.
cmd('break '+label('capture_interval'));
for(const [selector,bytes,expected] of [[1,[11,139,2,0],1],[2,[11,139,2,0],1],[2,[21,22,5,0],0]] as const){
 cmd('set memory iram 0x27 0 4 32 '+selector+' 0 1 33');cmd('set memory iram 0x35 0 34');
 cmd('set memory xram 5 1');cmd('run '+label('out8'));check('PC',label('capture_interval'));
 for(const [i,byte] of bytes.entries()){cmd('set memory xram 5 '+byte);cmd(i===3?'step 1':'step 2');}
 cmd('run');check('PC',0x90d);check('iram['+(selector===1?72:73)+']',expected);
}
cmd('clear '+label('capture_interval'));
// A NAK must restore the sensor bus target and leave the active generation untouched.
cmd('set memory iram 0x16 0');cmd('set memory iram 0x7a 1');cmd('set memory xram 0xf6 4');
cmd('break '+label('service_end'));cmd('run '+label('service8'));check('iram[0x7a]',4);check('xram[0xf1]',66);check('iram[0x4f]',0);
// Validate cold-boot slot selection including a torn write and generation rollover.
function slot(gen:number,red:number,valid:boolean){
 const bytes=[168,gen,1,2,120,1,red,128,0];bytes.push((-bytes.reduce((a,b)=>a+b,0)+(valid?0:1))&255);return bytes.join(' ');
}
for(const [ga,gb,valid,red] of [[8,9,0,100],[8,9,1,150],[255,0,1,150],[0,255,1,100]]){
 cmd('set memory rom 0x1fb0 '+slot(ga,100,true));cmd('set memory rom 0x1fc0 '+slot(gb,150,!!valid));
 cmd('run 0x954');check('iram[0x44]',red);
}
writeFileSync(join(dir,'checks.cmd'),cmds.join('\n')+'\n');
const log=execFileSync('ucsim_51',['-q','-c','-','test.ihx'],{cwd:dir,input:'exec "checks.cmd"\nquit\n',encoding:'utf8',timeout:20000});
assert.deepEqual([...log.matchAll(/^([1-9][0-9]{5})\s*$/gm)].map(m=>Number(m[1])),checks);
writeFileSync(here('stage8-controls.eeprom.bin'),image);
console.log(checks.length+' checks passed; code ends at '+label('code_end').toString(16)+'; '+createHash('sha256').update(image).digest('hex'));

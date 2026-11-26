// Generate the EP0 dispatch from the same unit/selector lengths used for its reply table.
const controls = [
  {name:'ae',unit:1,sel:2,len:1,min:1,max:2,res:3,def:2},
  {name:'exp',unit:1,sel:4,len:4,min:1,max:160,res:1,def:120},
  {name:'frequency',unit:3,sel:5,len:1,min:0,max:1,res:1,def:0},
  {name:'colour',unit:3,sel:12,len:4,min:0,max:255,res:1,def:128},
  {name:'auto_colour',unit:3,sel:13,len:1,min:0,max:1,res:1,def:1},
  {name:'profile',unit:4,sel:1,len:7,min:0,max:0,res:0,def:0},
  {name:'diagnostic',unit:4,sel:2,len:12,min:0,max:0,res:0,def:0},
  {name:'action',unit:4,sel:3,len:1,min:0,max:2,res:1,def:0},
];
export function makeControls(){
  const lines:string[]=[];
  const add=(s:string)=>lines.push(s);
  for(const direction of ['in','out']){
    add('control_'+direction+':');
    for(const [i,c] of controls.entries()){
      const next='next_'+direction+i;
      add(`mov a,0x27
cjne a,#${c.unit},${next}
mov a,0x2a
cjne a,#${c.sel},${next}
mov r6,#${c.len}
ljmp ${direction}_${c.name}
${next}:`);
    }
    add('ljmp '+(direction==='in'?'0x055e':'0x090d'));
  }
  const fields:Record<string,number[]>={ae:[0x41],exp:[0x42,0,0,0],frequency:[0x46],
    colour:[0x45,0,0x44,0],auto_colour:[0x43],profile:[64,65,66,67,68,69,70],
    diagnostic:[-8,0x4a,0x4b,0x4c,0x4d,0x7a,0x49,0x16,0x4e,0x4f,0x7f,0x47],action:[0x7a]};
  for(const c of controls){
    add(`in_${c.name}:
mov a,0x2c
cjne a,#0x81,meta_${c.name}`);
    fields[c.name].forEach((reg,i)=>add(`mov ${80+i},${reg<=0?'#'+(-reg):reg}`));
    add(`ljmp send_ram
meta_${c.name}:
mov dptr,#meta_data_${c.name}
mov r4,#${c.name==='diagnostic'?1:3}`);
    if(c.name==='exp'||c.name==='colour'){
      add(c.name==='exp'?'mov a,0x41\ncjne a,#2,exp_manual':'mov a,0x43\njz colour_manual');
      add(`mov r4,#7\n${c.name}_manual:`);
    }
    add(`ljmp metadata
meta_data_${c.name}:
.db ${[c.min,c.max,c.res,c.def].flatMap(v=>Array.from({length:c.len},(_,i)=>i===0||(c.name==='colour'&&i===2)?v:0)).join(',')}`);
  }
  add(`metadata:
mov a,0x2c
cjne a,#0x85,info
mov 0x50,r6
mov 0x51,#0
mov r6,#2
sjmp send_ram
info:
cjne a,#0x86,attribute
mov 0x50,r4
mov r6,#1
sjmp send_ram
attribute:
cjne a,#0x87,min_max
mov a,#3
sjmp table_row
min_max:
clr c
subb a,#0x82
cjne a,#3,check_row
ljmp 0x055e
check_row:
jc table_row
ljmp 0x055e
table_row:
mov r4,a
jz copy_row
skip_row:
mov a,r6
add a,dpl
mov dpl,a
clr a
addc a,dph
mov dph,a
djnz r4,skip_row
copy_row:
mov r1,#0x50
mov a,r6
mov r4,a
row_loop:
clr a
movc a,@a+dptr
inc dptr
mov @r1,a
inc r1
djnz r4,row_loop
send_ram:
mov r0,#4
clr a
movx @r0,a
inc r0
mov r1,#0x50
mov a,0x35
jnz send_loop
mov a,0x36
clr c
subb a,r6
jnc send_loop
mov r6,0x36
mov a,r6
jz send_done
send_loop:
mov a,@r1
movx @r0,a
inc r1
djnz r6,send_loop
send_done:
ljmp 0x060a
get_payload:
mov a,0x36
xrl a,r6
jnz wrong_len
mov r0,#4
clr a
movx @r0,a
inc r0
mov r1,#0x60
get_loop:
movx a,@r0
mov @r1,a
inc r1
djnz r6,get_loop
clr a
wrong_len:
ret`);
  const logic:Record<string,string>={
    ae:'mov a,0x60\ndec a\ncjne a,#2,ae_range\nsjmp invalid_ae\nae_range:\njnc invalid_ae\nmov 0x41,0x60',
    exp:'mov a,0x41\ncjne a,#1,invalid_exp\nmov a,0x61\norl a,0x62\norl a,0x63\njnz invalid_exp\nmov a,0x60\njz invalid_exp\nclr c\nsubb a,#161\njnc invalid_exp\nmov 0x42,0x60',
    frequency:'mov a,0x60\nanl a,#0xfe\njnz invalid_frequency\nmov 0x46,0x60',
    colour:'mov a,0x43\norl a,0x61\norl a,0x63\njnz invalid_colour\nmov 0x45,0x60\nmov 0x44,0x62',
    auto_colour:'mov a,0x60\nanl a,#0xfe\njnz invalid_auto_colour\nmov 0x43,0x60',
    profile:'mov a,0x60\norl a,0x63\norl a,0x66\nanl a,#0xfe\njnz invalid_profile\nmov a,0x61\ndec a\nanl a,#0xfe\njnz invalid_profile\nmov a,0x62\njz invalid_profile\nclr c\nsubb a,#161\njnc invalid_profile\n'+Array.from({length:7},(_,i)=>'mov '+(64+i)+','+(96+i)).join('\n'),
    action:'mov a,0x60\ncjne a,#1,lock_action\nmov a,0x7a\ncjne a,#2,queue_save\nsjmp invalid_action\nqueue_save:\nmov 0x7a,#1\nsjmp invalid_action\nlock_action:\ncjne a,#2,invalid_action\nmov a,0x16\njz invalid_action\nmov 0x7f,#1\nsjmp invalid_action',
  };
  for(const c of controls){
    add('out_'+c.name+':');
    if(c.name!=='diagnostic')add(`lcall get_payload\njnz invalid_${c.name}\n${logic[c.name]}\nmov 0x47,#1\ninvalid_${c.name}:`);
    add('ljmp 0x090d');
  }
  return lines.join('\n')+'\n';
}

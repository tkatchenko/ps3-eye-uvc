; B4.04.27.T high-speed fixed VGA mode. Tables follow this file at assembly.
.module stream
.area STREAM (ABS,CODE)
.org 0x0e00
out_data:
    mov a,0x29
    jnb acc.5,stock
    mov a,0x2d
    cjne a,#0x21,stock
    mov a,0x28
    cjne a,#4,stock
    mov a,0x27
    orl a,0x2b
    orl a,0x35
    jnz stock
    mov a,0x2c
    cjne a,#1,stock
    mov a,0x36
    cjne a,#34,stock
    mov a,0x2a
    cjne a,#1,check_commit
    sjmp read_payload
check_commit:
    cjne a,#2,stock
read_payload:
    mov r0,#4
    clr a
    movx @r0,a
    inc r0
    movx a,@r0
    movx a,@r0
    movx a,@r0
    mov r3,a                 ; format
    movx a,@r0
    mov r4,a                 ; frame
    mov r6,#30
drain:
    movx a,@r0
    djnz r6,drain
    mov a,0x2a
    cjne a,#2,ack
    cjne r3,#1,ack
    cjne r4,#1,ack
    mov r0,#0xe6            ; a new Commit supersedes a pending stop
    mov a,#0x61
    movx @r0,a
    mov a,0x16
    jnz ack                 ; a repeat Commit for this fixed mode needs no reset
    mov 0x17,#1              ; serviced by the foreground loop after the status command
ack:
    ljmp 0x090d
stock:
    ljmp 0x08fb

.org 0x0e80
foreground:
    mov a,0x34
    cjne a,#1,check_start
    ljmp 0x07c2
check_start:
    mov r0,#0xe6            ; OV538 USER register, owned by the idle handshake
    movx a,@r0
    cjne a,#0x61,check_stop
    sjmp check_pending
check_stop:
    cjne a,#0x62,ready
    lcall stop_video
    mov r0,#0xe6
ready:
    mov a,#0x61
    movx @r0,a
check_pending:
    mov a,0x17
    jz foreground
    mov 0x17,#0
    mov 0x16,#1
    lcall initialise
    sjmp foreground

; All sensor addresses and values come from code memory.
; A finite poll budget handles a missing sensor.
sensor_write:
    mov r0,#0xf2
    mov a,r3
    movx @r0,a
    inc r0
    mov a,r4
    movx @r0,a
    mov r0,#0xf5
    mov a,#0x37
    movx @r0,a
    inc r0
    mov r2,#0
poll:
    movx a,@r0
    jb acc.0,busy
    anl a,#4
    ret
busy:
    djnz r2,poll
    mov a,#4
    ret

; R7 is a count of delay quanta. Interrupts stay enabled.
delay:
    mov r2,#2
delay_outer:
    mov r1,#0
delay_inner:
    djnz r1,delay_inner
    djnz r2,delay_outer
    djnz r7,delay
    ret

initialise:
    mov r0,#0xe7
    mov a,#0x3a
    movx @r0,a
    mov r0,#0xe0
    mov a,#8
    movx @r0,a
    mov r7,#20
    lcall delay
    mov r0,#0xf1
    mov a,#0x42
    movx @r0,a
    mov r3,#0x12
    mov r4,#0x80
    lcall sensor_write
    jnz failed
    mov r7,#4
    lcall delay
    mov dptr,#sequence
next:
    clr a
    movc a,@a+dptr
    inc dptr
    jz enable_video
    mov r6,a                 ; 1 = bridge, 2 = sensor
    clr a
    movc a,@a+dptr
    inc dptr
    mov r3,a
    clr a
    movc a,@a+dptr
    inc dptr
    mov r4,a
    cjne r6,#1,sensor
    mov a,r3
    mov r0,a
    mov a,r4
    movx @r0,a
    sjmp next
sensor:
    lcall sensor_write
    jnz failed
    cjne r3,#0x12,next
    cjne r4,#0x80,next
    mov r7,#4
    lcall delay
    sjmp next
enable_video:
    mov a,0x16
    jz failed
    mov r0,#0x21
    movx a,@r0
    orl a,#0x80
    movx @r0,a
    mov r0,#0x23
    movx a,@r0
    orl a,#0x80
    movx @r0,a
    mov r0,#0xe0
    clr a
    movx @r0,a
    ret
failed:
    mov 0x16,#0
    mov r0,#0xe0
    mov a,#9
    movx @r0,a
    ret
.org 0x0fa0
usb_reset:
    lcall stop_video
    mov r0,#6
    movx a,@r0
    ret
setup_dispatch:
    mov a,0x2d
    cjne a,#2,original_setup
    mov a,0x2c
    cjne a,#1,original_setup
    mov a,0x28
    cjne a,#0x81,original_setup
    mov a,0x27
    orl a,0x2a
    orl a,0x2b
    orl a,0x35
    orl a,0x36
    jnz original_setup
    lcall stop_video
original_setup:
    mov a,0x2d
    jb acc.7,in_setup
    ljmp 0x0457
in_setup:
    ljmp 0x044f
stop_video:
    mov 0x17,#0
    mov a,0x16
    jz stop_done
    mov 0x16,#0
    mov r0,#0xe0
    mov a,#9
    movx @r0,a
    mov r0,#0x23
    movx a,@r0
    anl a,#0x7f
    movx @r0,a
stop_done:
    ret
sequence:

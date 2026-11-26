; High-speed UVC 1.1 capability queries, PS3 Eye B4.04.27.1.
; Entered through the stock IN-setup LCALL at CODE 0469.
; USB setup fields in internal RAM come from CODE 0432..0448.
.module ep0_query
.area QUERY (ABS,CODE)
.org 0x0c00
query:
    mov a,0x29
    jnb acc.5,stock         ; full-speed configuration retains its original interfaces
    mov a,0x2d
    cjne a,#0xa1,stock      ; class IN, interface recipient
    mov a,0x28
    cjne a,#1,stock         ; VideoStreaming interface
    mov a,0x27
    orl a,0x2b              ; entity and low byte of wValue must both be zero
    jnz stock
    mov a,0x2a
    cjne a,#1,check_commit
    sjmp check_request
check_commit:
    cjne a,#2,stock
check_request:
    mov a,0x2c
    cjne a,#0x85,check_info
    mov r6,#2
    mov dptr,#length_reply
    sjmp start_reply
check_info:
    cjne a,#0x86,check_mode
    mov r6,#1
    mov dptr,#info_reply
    sjmp start_reply
check_mode:
    cjne a,#0x81,probe_only
    sjmp fixed_mode
probe_only:
    mov a,0x2a
    cjne a,#1,stock
    mov a,0x2c
    cjne a,#0x82,check_max
    sjmp fixed_mode
check_max:
    cjne a,#0x83,check_res
    sjmp fixed_mode
check_res:
    cjne a,#0x84,check_def
    mov dptr,#0x0d22
    sjmp mode_length
check_def:
    cjne a,#0x87,stock
fixed_mode:
    mov dptr,#0x0d00
mode_length:
    mov r6,#34
start_reply:
    mov r0,#4
    clr a
    movx @r0,a
    inc r0
    mov a,0x35
    jnz emit
    mov a,0x36
    jz finish
    clr c
    subb a,r6
    jnc emit
    mov r6,0x36
emit:
    clr a
    movc a,@a+dptr
    movx @r0,a
after_byte:
    inc dptr
    djnz r6,emit
finish:
    ljmp 0x060a             ; stock final IN command and RET
stock:
    ljmp 0x055e             ; original IN handler
length_reply:
    .db 34,0
info_reply:
    .db 1

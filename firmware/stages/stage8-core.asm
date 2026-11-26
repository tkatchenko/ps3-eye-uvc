; Direct RAM 40..46: rotate, AE mode, manual exposure (100 us), AWB, red, blue, indoor.
; 47 dirty, 48 probe rate, 49 commit rate; 4a..4f diagnostic counters/state.
; 50..5f IN response, 60..6f OUT payload, 70..79 journal scratch, 7a..7f work.
; Stack is moved above these variables into the upper internal RAM.
.org 0x1500
boot8:
    mov sp,#0x8f
    mov r0,#0x40
    mov r7,#64
    clr a
boot_clear:
    mov @r0,a
    inc r0
    djnz r7,boot_clear
    mov 0x40,#1
    mov 0x41,#2
    mov 0x42,#120
    mov 0x43,#1
    mov 0x44,#128
    mov 0x45,#128
    mov dptr,#0x1fb0
    lcall load_slot
    mov dptr,#0x1fc0
    lcall load_slot
    ljmp 0x0755
load_slot:
    mov r0,#0x70
    mov r7,#10
    mov r6,#0
slot_read:
    clr a
    movc a,@a+dptr
    inc dptr
    mov @r0,a
    inc r0
    add a,r6
    mov r6,a
    djnz r7,slot_read
    mov a,r6
    jnz slot_done
    mov a,0x70
    cjne a,#0xa8,slot_done
    mov a,0x4f
    jz slot_copy
    mov a,0x71
    clr c
    subb a,0x4e
    jz slot_done
    jb acc.7,slot_done
slot_copy:
    mov 0x4e,0x71
    mov 0x4f,dpl
    mov r0,#0x72
    mov r1,#0x40
    mov r7,#7
slot_loop:
    mov a,@r0
    mov @r1,a
    inc r0
    inc r1
    djnz r7,slot_loop
slot_done:
    ret

; Called in foreground before enabling the video endpoint or after a settings change.
apply_profile:
    mov 0x47,#0
    mov r0,#0xf1
    mov a,#0x42
    movx @r0,a
    mov a,0x40
    jz normal
    mov a,#0xc0
normal:
    orl a,#0x10
    mov r3,#0x0c
    lcall write_checked
    mov a,0x41
    dec a
    mov r4,a
    mov a,0x43
    rl a
    orl a,r4
    orl a,#0xfc
    mov r3,#0x13
    lcall write_checked
    mov a,0x43
    jz manual_wb
    mov a,#0xea
    sjmp wb_mode
manual_wb:
    mov a,#0x2a
wb_mode:
    mov r3,#0x63
    lcall write_checked
    mov a,0x43
    jnz exposure
    mov a,0x44
    mov r3,#2
    lcall write_checked
    mov a,0x45
    mov r3,#1
    lcall write_checked
exposure:
    mov a,0x41
    cjne a,#1,lighting
    mov dptr,#lines30
    mov a,0x49
    jz lines
    mov dptr,#lines60
lines:
    mov a,0x42
    movc a,@a+dptr
    add a,acc
    mov 0x7e,a
    clr a
    rlc a
    mov r3,#8
    lcall write_checked
    mov r3,#0x10
    mov a,0x7e
    lcall write_checked
lighting:
    mov a,0x46
    jz normal_light
    mov a,#0x9e
normal_light:
    mov r3,#0x2b
    lcall write_checked
    mov a,0x46
    jz standard_thresholds
    mov r3,#0x24
    mov a,#0x64
    lcall write_checked
    mov r3,#0x25
    mov a,#0x46
    ljmp write_checked
standard_thresholds:
    mov r3,#0x24
    mov a,#0x40
    lcall write_checked
    mov r3,#0x25
    mov a,#0x30
write_checked:
    mov r4,a
    lcall sensor_write
    jz written
    inc 0x4c
written:
    ret
rate_setup:
    mov a,0x49
    jz apply_settings
    mov a,#1
    mov r3,#0x11
    lcall write_checked
    mov a,#0xc1
    mov r3,#0x0d
    lcall write_checked
    mov r0,#0xe5
    mov a,#4
    movx @r0,a
apply_settings:
    ljmp apply_profile

; Dispatch UVC VideoControl and extension-unit IN/OUT requests.
in8:
    mov a,0x2d
    cjne a,#0xa1,in_fallback
    mov a,0x29
    jnb acc.5,in_fallback
    mov a,0x28
    cjne a,#3,in_fallback
    mov a,0x2b
    jnz in_fallback
    ljmp control_in
in_fallback:
    ljmp 0x0c00
out8:
    mov a,0x2d
    cjne a,#0x21,out_fallback
    mov a,0x29
    jnb acc.5,out_fallback
    mov a,0x28
    cjne a,#3,out_fallback
    mov a,0x2b
    orl a,0x35
    jnz out_fallback
    mov a,0x2c
    cjne a,#1,out_fallback
    ljmp control_out
out_fallback:
    ljmp 0x0e00

; CAPTURE RATES. A host set selects the exact discrete interval or falls back to 30.
capture_interval:
    movx a,@r0
    mov r1,a
    movx a,@r0
    mov r2,a
    movx a,@r0
    mov r7,a
    movx a,@r0
    jnz slow
    cjne r1,#0x0b,slow
    cjne r2,#0x8b,slow
    cjne r7,#2,slow
    mov r1,#1
    sjmp rate_read
slow:
    mov r1,#0
rate_read:
    mov r6,#26
    ret
interval_reply:
    mov dptr,#0x0d00
    mov a,0x2c
    cjne a,#0x82,which_cur
    sjmp fast_reply
which_cur:
    cjne a,#0x81,reply_rate
    mov a,0x2a
    cjne a,#1,commit_reply
    mov a,0x48
    sjmp choose_reply
commit_reply:
    mov a,0x49
choose_reply:
    jz reply_rate
fast_reply:
    mov dptr,#mode60
reply_rate:
    ljmp 0x0c58

; Only foreground owns SCCB. Writing a slot invalidates its marker first;
; each byte is verified before the marker makes the new generation visible.
journal_save:
    mov 0x7a,#2
    mov r0,#0x40
    mov r1,#0x72
    mov r7,#7
    clr ea
journal_copy:
    mov a,@r0
    mov @r1,a
    inc r0
    inc r1
    djnz r7,journal_copy
    setb ea
    mov 0x70,#0xa8
    mov a,0x4e
    inc a
    mov 0x71,a
    mov r0,#0x70
    mov r7,#9
    clr a
journal_sum:
    add a,@r0
    inc r0
    djnz r7,journal_sum
    cpl a
    inc a
    mov 0x79,a
    mov 0x7b,#0xb4
    mov a,0x4f
    cjne a,#0xba,new_slot
    mov 0x7b,#0xc4
new_slot:
    mov r0,#0xf1
    mov a,#0xac
    movx @r0,a
    mov 0x7c,0x7b
    mov 0x7d,#0
    lcall ee_byte
    jnz save_failed
    mov r1,#0x71
save_payload:
    inc 0x7c
    mov a,@r1
    mov 0x7d,a
    push 0x01
    lcall ee_byte
    pop 0x01
    jnz save_failed
    inc r1
    cjne r1,#0x7a,save_payload
    mov 0x7c,0x7b
    mov 0x7d,#0xa8
    lcall ee_byte
    jnz save_failed
    mov 0x4e,0x71
    mov a,0x7b
    add a,#6
    mov 0x4f,a
    mov 0x7a,#3
    sjmp save_exit
save_failed:
    mov 0x7a,#4
    mov a,#0x20
    lcall bus_op
save_exit:
    mov r0,#0xf1
    mov a,#0x42
    movx @r0,a
    ret
ee_byte:
    mov r0,#0xf2
    mov a,#0x1f
    movx @r0,a
    mov a,#0x13
    lcall bus_op
    jnz ee_exit
    mov a,0x7c
    lcall burst_data
    jnz ee_exit
    mov a,0x7d
    lcall burst_data
    jnz ee_exit
    mov a,#0x20
    lcall bus_op
    jnz ee_exit
    mov r7,#4
    lcall delay
    mov r0,#0xf2
    mov a,#0x1f
    movx @r0,a
    inc r0
    mov a,0x7c
    movx @r0,a
    mov a,#0x37
    lcall bus_op
    jnz ee_exit
    mov a,#0xf9
    lcall bus_op
    jnz ee_exit
    mov r0,#0xf4
    movx a,@r0
    xrl a,0x7d
ee_exit:
    ret
burst_data:
    mov r0,#0xf2
    movx @r0,a
    inc r0
    movx @r0,a
    mov a,#2
bus_op:
    mov r0,#0xf5
    movx @r0,a
    inc r0
    mov r2,#0
bus_poll:
    movx a,@r0
    jb acc.0,bus_busy
    anl a,#4
    ret
bus_busy:
    djnz r2,bus_poll
    mov a,#4
    ret
read_sensor:
    mov r0,#0xf2
    movx @r0,a
    mov a,#0x33
    lcall bus_op
    jnz read_error
    mov a,#0xf9
    lcall bus_op
    jnz read_error
    mov r0,#0xf4
    movx a,@r0
    clr c
    ret
read_error:
    setb c
    ret
lock_wb:
    mov 0x7f,#0
    mov a,#0x13
    lcall read_sensor
    jc lock_error
    anl a,#0xfd
    mov r3,#0x13
    mov r4,a
    lcall sensor_write
    jnz lock_error
    mov a,#2
    lcall read_sensor
    jc lock_error
    mov r7,a
    mov a,#1
    lcall read_sensor
    jc lock_error
    mov 0x45,a
    mov 0x44,r7
    mov 0x43,#0
    mov 0x47,#1
    ret
lock_error:
    inc 0x4c
    mov 0x47,#1
    ret
service8:
    mov a,0x7a
    cjne a,#1,no_save
    lcall journal_save
no_save:
    mov a,0x16
    jz service_end
    mov a,0x7f
    jz no_lock
    lcall lock_wb
no_lock:
    mov a,0x47
    jz service_end
    lcall apply_profile
service_end:
    ret

// In-memory stock Eye for the public CLI. This file is only linked by the test.
#include <libusb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned char memory[8192],reg[256];
static unsigned address,phase;
static int pending=-1;
static libusb_device *devices[]={(libusb_device *)1,NULL};

int usleep(unsigned int micros){(void)micros;return 0;}
int libusb_init(libusb_context **ctx){
    (void)ctx;
    FILE *f=fopen(getenv("EYE_FIXTURE"),"rb");
    if(!f)return -1;
    int ok=fread(memory,1,sizeof memory,f)==sizeof memory;fclose(f);return ok?0:-1;
}
void libusb_exit(libusb_context *ctx){
    (void)ctx;
    FILE *f=fopen(getenv("EYE_RESULT"),"wb");
    if(!f || fwrite(memory,1,sizeof memory,f)!=sizeof memory || fclose(f))abort();
}
ssize_t libusb_get_device_list(libusb_context *ctx,libusb_device ***list){
    (void)ctx;*list=devices;return 1;
}
void libusb_free_device_list(libusb_device **list,int unref){(void)list;(void)unref;}
int libusb_get_device_descriptor(libusb_device *d,struct libusb_device_descriptor *desc){
    (void)d;desc->idVendor=0x1415;desc->idProduct=0x2000;return 0;
}
int libusb_open(libusb_device *d,libusb_device_handle **h){*h=(libusb_device_handle *)d;return 0;}
void libusb_close(libusb_device_handle *h){(void)h;}
int libusb_claim_interface(libusb_device_handle *h,int n){(void)h;return n==0?0:-1;}
int libusb_get_string_descriptor_ascii(libusb_device_handle *h,uint8_t n,unsigned char *s,int len){
    (void)h;(void)n;return snprintf((char *)s,len,"USB Camera-B4.04.27.1");
}
int libusb_control_transfer(libusb_device_handle *h,uint8_t type,uint8_t req,uint16_t val,
                            uint16_t index,unsigned char *v,uint16_t len,unsigned int timeout){
    (void)h;(void)timeout;
    if(req!=1 || len!=1 || val || index>255)return -1;
    if(type==0xc0){*v=reg[index];return 1;}
    if(type!=0x40)return -1;
    reg[index]=*v;
    if(index!=0xf5)return 1;
    if(reg[0xf1]!=0xac)return -1;
    switch(*v){
        case 0x37: address=reg[0xf2]*256+reg[0xf3];break;
        case 0xf9: if(address>=sizeof memory)return -1;reg[0xf4]=memory[address++];break;
        case 0x13: address=reg[0xf2]*256;phase=1;break;
        case 0x02:
            if(reg[0xf2]!=reg[0xf3])return -1;
            if(phase==1)address+=reg[0xf3];
            else if(phase==2)pending=reg[0xf3];
            else return -1;
            phase++;break;
        case 0x20:
            if(phase!=3 || address>=sizeof memory || pending<0)return -1;
            memory[address]=(unsigned char)pending;
            if(getenv("EYE_CORRUPT_WRITE"))memory[address]^=1;
            pending=-1;phase=0;break;
        default:return -1;
    }
    return 1;
}

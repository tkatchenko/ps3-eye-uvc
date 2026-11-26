#include <libusb.h>
#include <unistd.h>
#include <string.h>
typedef struct {int rotate, automaticExposure, exposure, automaticWhite, red, blue;} Settings;
static int usb(libusb_device_handle *d,int in,int r,unsigned char *v){
    return libusb_control_transfer(d,in?0xc0:0x40,1,0,r,v,1,400)==1;
}
static int put(libusb_device_handle *d,int r,unsigned char v){return usb(d,0,r,&v);}
static int operation(libusb_device_handle *d,unsigned char op){
    if(!put(d,0xf5,op))return 0;
    for(int i=0;i<30;i++){
        unsigned char status;
        usleep(500);
        if(!usb(d,1,0xf6,&status))return 0;
        if(!(status&1))return !(status&4);
    }
    return 0;
}
static int sensorRead(libusb_device_handle *d,int r,unsigned char *v){
    return put(d,0xf2,r)&&operation(d,0x33)&&operation(d,0xf9)&&usb(d,1,0xf4,v);
}
static int ensure(libusb_device_handle *d,int r,int mask,int value){
    unsigned char old,check;
    if(!sensorRead(d,r,&old))return 0;
    if((old&mask)==(value&mask))return 1;
    unsigned char next=(old&~mask)|(value&mask);
    return put(d,0xf2,r)&&put(d,0xf3,next)&&operation(d,0x37)&&sensorRead(d,r,&check)&&((check^next)&mask)==0;
}
// Only access the OV772x sensor when the firmware has finished its startup sequence.
static __attribute__((unused)) const char *configure(Settings s){
    libusb_context *ctx=NULL;
    if(libusb_init(&ctx)<0)return "USB unavailable";
    libusb_device_handle *d=libusb_open_device_with_vid_pid(ctx,0x1415,0x2000);
    const char *result="Connect the Eye";
    if(d){
        unsigned char name[80],state,target,hi,lo;
        result="Waiting for the camera stream";
        if(libusb_get_string_descriptor_ascii(d,2,name,sizeof name)>0 &&
           !strcmp((char*)name,"USB Camera-B4.04.27.T") &&
           usb(d,1,0xe0,&state)&&state==0&&usb(d,1,0xf1,&target)&&target==0x42 &&
           sensorRead(d,0x0a,&hi)&&sensorRead(d,0x0b,&lo)&&hi==0x77&&lo==0x21){
            int ok=ensure(d,0x0c,0xc0,s.rotate?0xc0:0)
                &&ensure(d,0x13,3,(s.automaticExposure?1:0)|(s.automaticWhite?2:0))
                &&ensure(d,0x63,0xc0,s.automaticWhite?0xc0:0x80);
            if(ok&&!s.automaticExposure)ok=ensure(d,8,0xff,s.exposure>>7)&&ensure(d,0x10,0xff,s.exposure<<1);
            if(ok&&!s.automaticWhite)ok=ensure(d,2,255,s.red)&&ensure(d,1,255,s.blue);
            result=ok?"Applied to the camera":"Sensor did not verify the settings";
        }
        libusb_close(d);
    }
    libusb_exit(ctx);return result;
}

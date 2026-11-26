#import <CoreMediaIO/CMIOHardware.h>
#import <os/log.h>

// Inspect all matching devices. An unknown state must never authorise a stop.
static int eyeActivity(void) {
    CMIOObjectPropertyAddress a = {kCMIOHardwarePropertyDevices,
        kCMIOObjectPropertyScopeGlobal, kCMIOObjectPropertyElementMain};
    UInt32 size = 0, used = 0;
    if (CMIOObjectGetPropertyDataSize(kCMIOObjectSystemObject,&a,0,NULL,&size) || !size) return -1;
    NSMutableData *data = [NSMutableData dataWithLength:size];
    if (CMIOObjectGetPropertyData(kCMIOObjectSystemObject,&a,0,NULL,size,&used,data.mutableBytes)) return -1;
    const CMIODeviceID *ids = data.bytes;
    int matches = 0, active = -1;
    for (unsigned i=0; i<used/sizeof(*ids); i++) {
        a.mSelector = kCMIODevicePropertyDeviceUID;
        CFStringRef uid = NULL;
        UInt32 count = 0;
        if (CMIOObjectGetPropertyData(ids[i],&a,0,NULL,sizeof uid,&count,&uid) || !uid) continue;
        BOOL match = [((__bridge NSString *)uid).lowercaseString hasSuffix:@"14152000"];
        CFRelease(uid);
        if (!match) continue;
        matches++;
        a.mSelector = kCMIODevicePropertyDeviceIsRunningSomewhere;
        UInt32 value = 0;
        if (!CMIOObjectGetPropertyData(ids[i],&a,0,NULL,sizeof value,&count,&value)) active = value ? 1 : 0;
    }
    return matches == 1 ? active : -1;
}
static NSString *stopIdleEye(void) {
    libusb_context *ctx = NULL;
    if (libusb_init(&ctx)<0) return @"USB unavailable";
    libusb_device_handle *d = libusb_open_device_with_vid_pid(ctx,0x1415,0x2000);
    NSString *message = @"Camera disconnected";
    if (d) {
        unsigned char name[80], state, gpio, mailbox;
        message = @"Checking camera";
        if (libusb_get_string_descriptor_ascii(d,2,name,sizeof name)>0 &&
            !strcmp((char *)name,"USB Camera-B4.04.27.T") &&
            usb(d,1,0xe0,&state) && usb(d,1,0x23,&gpio)) {
            if (state==9 && !(gpio&128)) message=@"Camera idle";
            else if (state==0 && usb(d,1,0xe6,&mailbox) && mailbox==0x61 && eyeActivity()==0) {
                message=@"Stopping video";
                if (put(d,0xe6,0x62)) {
                    for(int i=0;i<10;i++){
                        usleep(10000);
                        if (usb(d,1,0xe0,&state) && state==9 && usb(d,1,0x23,&gpio) && !(gpio&128)){
                            os_log_info(OS_LOG_DEFAULT,"Eye Controls verified standby after macOS reported the camera idle");
                            message=@"Camera idle";break;
                        }
                    }
                }
            } else if (state==0) message=@"Waiting for camera standby";
        }
        libusb_close(d);
    }
    libusb_exit(ctx);
    return message;
}

// Fixed-length UVC 1.1 extension controls on interface 3, unit 4.
typedef struct { libusb_context *ctx; libusb_device_handle *dev; } EyeConnection;
static void closeEye(EyeConnection *eye){
    if(eye->dev)libusb_close(eye->dev);
    if(eye->ctx)libusb_exit(eye->ctx);
}
static int eyeControl(EyeConnection eye,int input,int selector,unsigned char *bytes,int count){
    return libusb_control_transfer(eye.dev,input?0xa1:0x21,input?0x81:1,
        selector<<8,0x403,bytes,count,750)==count;
}
static int openEye(EyeConnection *eye,unsigned char diagnostics[12]){
    if(libusb_init(&eye->ctx))return 0;
    eye->dev=libusb_open_device_with_vid_pid(eye->ctx,0x1415,0x2000);
    return eye->dev && eyeControl(*eye,1,2,diagnostics,12) && diagnostics[0]==8;
}
static int profileBytes(Settings s,int indoor,unsigned char values[7]){
    if(s.exposure<1||s.exposure>160)return 0;
    values[0]=!!s.rotate;values[1]=s.automaticExposure?2:1;
    values[2]=s.exposure;values[3]=!!s.automaticWhite;
    values[4]=s.red;values[5]=s.blue;values[6]=!!indoor;return 1;
}
static int applyProfile(EyeConnection eye,unsigned char values[7]){
    unsigned char back[7];
    for(int attempt=0;attempt<8;attempt++){
        if(!eyeControl(eye,1,1,back,7))return 0;
        if(!memcmp(values,back,7))return 1;
        if(!eyeControl(eye,0,1,values,7))return 0;
        usleep(80000);
    }
    return eyeControl(eye,1,1,back,7)&&!memcmp(values,back,7);
}
static NSString *diagnosticText(const unsigned char d[12]){
    NSArray *reason=@[@"None since boot",@"Mac reported idle",@"USB reset",@"Endpoint cleared",@"Sensor setup failed"];
    NSString *last=d[4]<reason.count?reason[d[4]]:@"Unknown";
    return [NSString stringWithFormat:@"Firmware 8  ·  %@  ·  %d fps\nStarts %u  ·  Stops %u  ·  Sensor errors %u\nLast stop: %@\nCamera profile: %@",
      d[7]?@"Stream enabled":@"Idle",d[6]?60:30,d[1],d[2],d[3],last,
      d[9]?[NSString stringWithFormat:@"generation %u",d[8]]:@"Factory defaults"];
}

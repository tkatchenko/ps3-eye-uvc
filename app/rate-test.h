#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
@interface RateTest : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate,AVCaptureAudioDataOutputSampleBufferDelegate>
@property NSUInteger frames,audioSamples,gaps,repeated;
@property uint64_t previousHash;
@property double first,last,maxGap;
@property BOOL signal;
@property int rate;
@end
@implementation RateTest
- (void)captureOutput:(AVCaptureOutput *)output didOutputSampleBuffer:(CMSampleBufferRef)buffer fromConnection:(AVCaptureConnection *)connection{
    if([output isKindOfClass:AVCaptureAudioDataOutput.class]){
        self.audioSamples+=CMSampleBufferGetNumSamples(buffer);
        CMBlockBufferRef block=CMSampleBufferGetDataBuffer(buffer);
        if(!self.signal && block){
            unsigned char bytes[128];size_t size=MIN(sizeof bytes,CMBlockBufferGetDataLength(block));
            if(CMBlockBufferCopyDataBytes(block,0,size,bytes)==0)for(size_t i=0;i<size;i++)if(bytes[i]){self.signal=YES;break;}
        }
        return;
    }
    CVPixelBufferRef pixels=CMSampleBufferGetImageBuffer(buffer);
    if(pixels && CVPixelBufferLockBaseAddress(pixels,kCVPixelBufferLock_ReadOnly)==kCVReturnSuccess){
        BOOL planar=CVPixelBufferIsPlanar(pixels);
        const unsigned char *base=planar?CVPixelBufferGetBaseAddressOfPlane(pixels,0):CVPixelBufferGetBaseAddress(pixels);
        size_t stride=planar?CVPixelBufferGetBytesPerRowOfPlane(pixels,0):CVPixelBufferGetBytesPerRow(pixels);
        size_t height=planar?CVPixelBufferGetHeightOfPlane(pixels,0):CVPixelBufferGetHeight(pixels);
        uint64_t hash=1469598103934665603ULL;
        if(base && height>=24 && stride>=32){
            for(int y=1;y<24;y++)for(int x=1;x<32;x++)hash=(hash^base[(height*y/24)*stride+stride*x/32])*1099511628211ULL;
            if(self.frames && self.previousHash==hash)self.repeated++;
            self.previousHash=hash;
        }
        CVPixelBufferUnlockBaseAddress(pixels,kCVPixelBufferLock_ReadOnly);
    }
    double now=NSProcessInfo.processInfo.systemUptime;
    if(!isfinite(now))return;
    if(!self.frames)self.first=now;
    else{
        double gap=now-self.last;self.maxGap=MAX(self.maxGap,gap);
        if(gap>1.5/self.rate)self.gaps+=MAX(1,lround(gap*self.rate)-1);
    }
    self.frames++;self.last=now;
}
- (NSString *)run:(int)rate {
    self.rate=rate;
    for(AVMediaType type in @[AVMediaTypeVideo,AVMediaTypeAudio]){
        if([AVCaptureDevice authorizationStatusForMediaType:type]==AVAuthorizationStatusNotDetermined){
            dispatch_semaphore_t reply=dispatch_semaphore_create(0);
            [AVCaptureDevice requestAccessForMediaType:type completionHandler:^(BOOL granted){dispatch_semaphore_signal(reply);}];
            if(dispatch_semaphore_wait(reply,dispatch_time(DISPATCH_TIME_NOW,60*NSEC_PER_SEC)))return @"Permission request timed out.";
        }
        if([AVCaptureDevice authorizationStatusForMediaType:type]!=AVAuthorizationStatusAuthorized)
            return @"Allow Eye Controls to use Camera and Microphone in System Settings.";
    }
    if(eyeActivity()!=0)return @"Close other capture sessions before testing.";
    AVCaptureSession *session=[AVCaptureSession new];
    AVCaptureSession *microphone=[AVCaptureSession new];
    [session beginConfiguration];
    AVCaptureDevice *video=nil;
    for(AVMediaType type in @[AVMediaTypeVideo,AVMediaTypeAudio]){
        AVCaptureDeviceDiscoverySession *devices=[AVCaptureDeviceDiscoverySession discoverySessionWithDeviceTypes:([type isEqual:AVMediaTypeAudio]?@[AVCaptureDeviceTypeMicrophone,AVCaptureDeviceTypeExternal]:@[AVCaptureDeviceTypeExternal]) mediaType:type position:AVCaptureDevicePositionUnspecified];
        AVCaptureDevice *eye=nil;
        for(AVCaptureDevice *device in devices.devices)if([device.localizedName isEqual:@"USB Camera-B4.04.27.T"]){eye=device;break;}
        if(!eye)return [NSString stringWithFormat:@"Eye %@ input unavailable.",type==AVMediaTypeVideo?@"video":@"microphone"];
        NSError *error=nil;AVCaptureDeviceInput *input=[AVCaptureDeviceInput deviceInputWithDevice:eye error:&error];
        AVCaptureSession *owner=[type isEqual:AVMediaTypeVideo]?session:microphone;
        if(!input||![owner canAddInput:input])return error.localizedDescription?:@"Input unavailable";
        [owner addInput:input];if(type==AVMediaTypeVideo)video=eye;
    }
    AVCaptureDeviceFormat *format=nil;AVFrameRateRange *selectedRange=nil;
    for(AVCaptureDeviceFormat *f in video.formats){
        CMVideoDimensions dimensions=CMVideoFormatDescriptionGetDimensions(f.formatDescription);
        if(dimensions.width!=640||dimensions.height!=480)continue;
        if(CMFormatDescriptionGetMediaSubType(f.formatDescription)!=kCVPixelFormatType_422YpCbCr8_yuvs)continue;
        for(AVFrameRateRange *r in f.videoSupportedFrameRateRanges)
            if(r.minFrameRate<=rate+0.1 && r.maxFrameRate>=rate-0.1){format=f;selectedRange=r;break;}
        if(format)break;
    }
    if(!format)return @"The requested frame rate is unavailable.";
    dispatch_queue_t samples=dispatch_queue_create("local.ps3eye.samples",DISPATCH_QUEUE_SERIAL);
    AVCaptureVideoDataOutput *v=[AVCaptureVideoDataOutput new];AVCaptureAudioDataOutput *a=[AVCaptureAudioDataOutput new];
    v.videoSettings=@{(id)kCVPixelBufferPixelFormatTypeKey:@(kCVPixelFormatType_422YpCbCr8_yuvs)};
    [v setSampleBufferDelegate:self queue:samples];[a setSampleBufferDelegate:self queue:samples];
    if(![session canAddOutput:v])return @"Video output unavailable";[session addOutput:v];
    if(![microphone canAddOutput:a])return @"Audio output unavailable";[microphone addOutput:a];
    NSError *error=nil;if(![video lockForConfiguration:&error])return error.localizedDescription;
    video.activeFormat=format;CMTime period=CMTimeMake(1,rate);
    if(CMTimeCompare(period,selectedRange.minFrameDuration)<0)period=selectedRange.minFrameDuration;
    if(CMTimeCompare(period,selectedRange.maxFrameDuration)>0)period=selectedRange.maxFrameDuration;
    video.activeVideoMinFrameDuration=period;video.activeVideoMaxFrameDuration=period;
    [session commitConfiguration];[microphone startRunning];[session startRunning];[video unlockForConfiguration];
    [NSThread sleepForTimeInterval:30];EyeConnection eye={0};unsigned char d[12];
    int committed=openEye(&eye,d)&&d[7]?(d[6]?60:30):0;closeEye(&eye);
    [session stopRunning];[microphone stopRunning];dispatch_sync(samples,^{});
    double fps=self.last>self.first?(self.frames-1)/(self.last-self.first):0;
    return [NSString stringWithFormat:@"%d fps USB  ·  %.1f delivered  ·  %lu frames  ·  %lu repeats\n%lu missing intervals  ·  %.0f ms longest gap\n%lu audio sample frames  ·  %@",committed,fps,self.frames,self.repeated,self.gaps,self.maxGap*1000,self.audioSamples,self.signal?@"Microphone signal detected":@"No signal detected"];
}
@end

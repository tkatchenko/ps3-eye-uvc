#import <Cocoa/Cocoa.h>
#include "sensor.h"
#import "activity.h"
#import "controls8.h"
#import "rate-test.h"

@interface Panel : NSObject <NSApplicationDelegate, NSTextFieldDelegate>
@property(strong) NSWindow *window;
@property(strong) NSStackView *stack, *group;
@property(strong) NSTextField *status;
@property(strong) NSMutableDictionary<NSString *, NSSwitch *> *switches;
@property(strong) NSMutableDictionary<NSString *, NSSlider *> *sliders;
@property(strong) NSMutableDictionary<NSString *, NSTextField *> *values;
@property BOOL busy, testing, loadedCamera;
@property(strong) NSTextField *details;
@property NSInteger idleSamples, referenceRed, referenceBlue;
@property NSUInteger settingsRevision;
@property NSUInteger appliedRevision;
@end

@implementation Panel
- (void)show:(id)sender {
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)app hasVisibleWindows:(BOOL)visible {
    [self show:nil];return YES;
}
- (void)section:(NSString *)name symbol:(NSString *)symbol {
    NSTextField *title=[NSTextField labelWithString:name];
    title.font=[NSFont systemFontOfSize:13 weight:NSFontWeightSemibold];
    NSImageView *icon=[NSImageView imageViewWithImage:[NSImage imageWithSystemSymbolName:symbol accessibilityDescription:nil]];
    icon.contentTintColor=NSColor.secondaryLabelColor;
    NSStackView *heading=[NSStackView stackViewWithViews:@[icon,title]];
    heading.spacing=6;[self.stack addArrangedSubview:heading];
    NSBox *box=[NSBox new];box.titlePosition=NSNoTitle;box.boxType=NSBoxPrimary;
    self.group=[NSStackView new];self.group.orientation=NSUserInterfaceLayoutOrientationVertical;
    self.group.spacing=10;self.group.edgeInsets=NSEdgeInsetsMake(10,14,10,14);
    box.contentView=self.group;box.contentViewMargins=NSZeroSize;
    [self.stack addArrangedSubview:box];
    [box.widthAnchor constraintEqualToAnchor:self.stack.widthAnchor].active=YES;
    [box.heightAnchor constraintEqualToAnchor:self.group.heightAnchor].active=YES;
    [self.stack setCustomSpacing:16 afterView:box];
}
- (void)row:(NSString *)title controls:(NSArray<NSView *> *)controls {
    NSTextField *label=[NSTextField labelWithString:title];
    NSView *space=[NSView new];
    NSStackView *row=[NSStackView stackViewWithViews:[@[label,space] arrayByAddingObjectsFromArray:controls]];
    row.spacing=8;[space setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    [self.group addArrangedSubview:row];
    [row.widthAnchor constraintEqualToAnchor:self.group.widthAnchor constant:-28].active=YES;
}
- (void)toggle:(NSString *)title key:(NSString *)key {
    NSSwitch *control=[NSSwitch new];control.controlSize=NSControlSizeSmall;
    control.state=[[NSUserDefaults standardUserDefaults] boolForKey:key];
    control.target=self;control.action=@selector(changed:);control.identifier=key;
    [control setAccessibilityLabel:title];self.switches[key]=control;[self row:title controls:@[control]];
}
- (void)slider:(NSString *)title key:(NSString *)key {
    BOOL exposure=[key isEqualToString:@"exposure"];
    BOOL warmth=[key isEqualToString:@"warmth"];
    int value=warmth?0:(int)[[NSUserDefaults standardUserDefaults] integerForKey:key];
    NSSlider *slider=[NSSlider sliderWithValue:value minValue:warmth?-100:(exposure?1:0) maxValue:warmth?100:(exposure?160:255) target:self action:@selector(changed:)];
    slider.identifier=key;slider.continuous=YES;slider.controlSize=NSControlSizeSmall;
    [slider setAccessibilityLabel:title];[slider.widthAnchor constraintEqualToConstant:145].active=YES;
    NSTextField *field=[NSTextField textFieldWithString:[NSString stringWithFormat:@"%d",value]];
    NSNumberFormatter *format=[NSNumberFormatter new];format.numberStyle=NSNumberFormatterDecimalStyle;
    format.allowsFloats=NO;format.minimum=@(slider.minValue);format.maximum=@(slider.maxValue);field.formatter=format;
    field.alignment=NSTextAlignmentRight;field.identifier=key;field.delegate=self;
    field.font=[NSFont monospacedDigitSystemFontOfSize:12 weight:NSFontWeightRegular];
    [field setAccessibilityLabel:[title stringByAppendingString:@" value"]];
    [field.widthAnchor constraintEqualToConstant:43].active=YES;
    self.sliders[key]=slider;self.values[key]=field;[self row:title controls:@[slider,field]];
}
- (void)controlTextDidEndEditing:(NSNotification *)note {[self changed:note.object];}
- (void)centreWarmth {
    self.referenceRed=self.sliders[@"red"].integerValue;
    self.referenceBlue=self.sliders[@"blue"].integerValue;
    self.sliders[@"warmth"].integerValue=0;self.values[@"warmth"].integerValue=0;
}
- (void)changed:(NSControl *)sender {
    NSString *key=sender.identifier;
    if(key){
        self.settingsRevision++;
        if(sender==self.values[key])self.sliders[key].integerValue=MAX(self.sliders[key].minValue,MIN(self.sliders[key].maxValue,sender.integerValue));
        if(self.sliders[key]) {
            NSInteger value=lround(self.sliders[key].doubleValue);
            self.values[key].integerValue=value;
            [[NSUserDefaults standardUserDefaults] setInteger:value forKey:key];
            if([key isEqual:@"warmth"]){
                double factor=exp2(value/100.0);
                for(NSString *channel in @[@"red",@"blue"]){
                    double gain=[channel isEqual:@"red"]?self.referenceRed*factor:self.referenceBlue/factor;
                    NSInteger adjusted=MIN(255,lround(gain));
                    self.sliders[channel].integerValue=adjusted;self.values[channel].integerValue=adjusted;
                    [[NSUserDefaults standardUserDefaults] setInteger:adjusted forKey:channel];
                }
            } else if([key isEqual:@"red"]||[key isEqual:@"blue"])[self centreWarmth];
        } else [[NSUserDefaults standardUserDefaults] setBool:self.switches[key].state forKey:key];
    }
    for(NSString *k in self.sliders){
        BOOL manual=!self.switches[[k isEqual:@"exposure"]?@"ae":@"awb"].state;
        self.sliders[k].enabled=manual;self.values[k].enabled=manual;
    }
    [self refresh:nil];
}
- (Settings)settings {
    return (Settings){(int)self.switches[@"rotate"].state,(int)self.switches[@"ae"].state,
        self.sliders[@"exposure"].intValue,(int)self.switches[@"awb"].state,self.sliders[@"red"].intValue,self.sliders[@"blue"].intValue};
}
- (void)displayProfile:(const unsigned char *)p {
    NSArray *keys=@[@"rotate",@"ae",@"exposure",@"awb",@"red",@"blue",@"indoor"];
    for(NSUInteger i=0;i<keys.count;i++){
        NSString *key=keys[i];NSInteger value=i==1?p[i]==2:p[i];
        if(self.switches[key])self.switches[key].state=value?NSControlStateValueOn:NSControlStateValueOff;
        else {self.sliders[key].integerValue=value;self.values[key].integerValue=value;}
        [[NSUserDefaults standardUserDefaults] setInteger:value forKey:key];
    }
    [self centreWarmth];[self changed:nil];
}
- (void)cameraAction:(NSButton *)sender {
    if(self.busy){[self performSelector:@selector(cameraAction:) withObject:sender afterDelay:0.15];return;}
    self.busy=YES;
    NSInteger action=sender.tag;
    Settings settings=[self settings];int indoor=(int)self.switches[@"indoor"].state;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
        unsigned char d[12]={0},p[7]={0};EyeConnection eye={0};NSString *text=@"Reconnect the Eye with firmware 8.";
        NSData *updated=nil;
        if(openEye(&eye,d)){
            if(action==0)text=diagnosticText(d);
            else if(action==4){
                BOOL ok=eyeControl(eye,1,1,p,7);
                if(ok)updated=[NSData dataWithBytes:p length:7];
                text=ok?@"Read current settings from the camera.":@"Camera settings unavailable.";
            }
            else if(action==2&&!d[7])text=@"Start a camera preview before locking white balance.";
            else {
                BOOL ok=YES;
                if(action==1)ok=profileBytes(settings,indoor,p)&&applyProfile(eye,p);
                unsigned char command=(unsigned char)action;
                unsigned char nextGeneration=(unsigned char)(d[8]+1);
                ok=ok&&eyeControl(eye,0,3,&command,1);
                BOOL finished=NO;
                for(int i=0;ok&&i<80;i++){
                    usleep(25000);ok=eyeControl(eye,1,2,d,12);
                    if(action==1 && d[5]==3 && d[8]==nextGeneration && d[9]){finished=YES;break;}
                    if(action==2 && !d[10] && !d[11] && eyeControl(eye,1,1,p,7)){
                        if(p[3]==0){finished=YES;break;}
                        if(i%8==7)ok=eyeControl(eye,0,3,&command,1);
                    }
                }
                if(finished && action==2)updated=[NSData dataWithBytes:p length:7];
                text=finished?(action==1?@"Saved and verified on the camera.":@"White balance locked to the current lighting."):@"The camera did not confirm the operation.";
            }
        }
        closeEye(&eye);
        dispatch_async(dispatch_get_main_queue(),^{
            if(updated)[self displayProfile:updated.bytes];
            self.details.stringValue=text;self.busy=NO;
        });
    });
}
- (NSButton *)button:(NSString *)title action:(SEL)selector tag:(NSInteger)tag {
    NSButton *button=[NSButton buttonWithTitle:title target:self action:selector];button.tag=tag;
    return button;
}
- (void)testCapture:(NSButton *)sender {
    if(self.testing)return;
    if(eyeActivity()!=0){self.details.stringValue=@"Close the other capture session before running this test.";return;}
    self.testing=YES;int rate=(int)sender.tag;
    self.details.stringValue=[NSString stringWithFormat:@"Testing %d fps and microphone for 30 seconds…",rate];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
        NSString *text=[[RateTest new] run:rate];dispatch_async(dispatch_get_main_queue(),^{
            self.details.stringValue=text;self.testing=NO;
        });
    });
}

- (void)refresh:(id)sender {
    if(self.busy)return;
    self.busy=YES;
    Settings settings={(int)self.switches[@"rotate"].state,(int)self.switches[@"ae"].state,
        self.sliders[@"exposure"].intValue,(int)self.switches[@"awb"].state,
        self.sliders[@"red"].intValue,self.sliders[@"blue"].intValue};
    NSInteger previous=self.idleSamples;
    BOOL load=!self.loadedCamera;
    BOOL indoor=self.switches[@"indoor"].state;
    NSUInteger revision=self.settingsRevision;
    BOOL needsApply=self.appliedRevision!=revision;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{
        int active=eyeActivity();
        NSInteger idle=active==0 ? MIN(previous+1,3) : 0;
        NSString *text=nil;
        NSData *profile=nil;BOOL detected=NO;
        if(load || (active==1 && needsApply)){
            EyeConnection eye={0};unsigned char d[12],p[7];
            detected=openEye(&eye,d);
            if(detected && load && d[9] && eyeControl(eye,1,1,p,7))profile=[NSData dataWithBytes:p length:7];
            if(active==1 && needsApply && !profile){
                BOOL ok=detected && profileBytes(settings,indoor,p) && applyProfile(eye,p);
                text=ok?@"Applied to the camera":@"Waiting for camera controls";
            }
            closeEye(&eye);
        }
        if(active==1){if(!text)text=@"Applied to the camera";}
        else if(idle>=3)text=stopIdleEye();
        else text=active==0?@"Waiting for camera standby":@"Waiting for PlayStation Eye";
        dispatch_async(dispatch_get_main_queue(),^{
            if(active<0)self.loadedCamera=NO;else if(detected)self.loadedCamera=YES;
            if(profile && revision==self.settingsRevision)[self displayProfile:profile.bytes];
            if(active<0)self.appliedRevision=0;
            else if([text isEqualToString:@"Applied to the camera"])self.appliedRevision=revision;
            self.status.stringValue=text;self.idleSamples=idle;self.busy=NO;
        });
    });
}
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    self.settingsRevision=1;
    [[NSUserDefaults standardUserDefaults] registerDefaults:@{@"rotate":@YES,@"ae":@YES,@"awb":@YES,@"exposure":@120,@"red":@128,@"blue":@128}];
    self.switches=[NSMutableDictionary new];self.sliders=[NSMutableDictionary new];self.values=[NSMutableDictionary new];
    self.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,440,470) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
    self.window.title=@"Eye Controls Settings";self.window.releasedWhenClosed=NO;
    self.stack=[NSStackView new];self.stack.orientation=NSUserInterfaceLayoutOrientationVertical;
    self.stack.alignment=NSLayoutAttributeLeading;self.stack.spacing=6;self.stack.translatesAutoresizingMaskIntoConstraints=NO;
    NSView *content=self.window.contentView;[content addSubview:self.stack];
    [NSLayoutConstraint activateConstraints:@[[self.stack.topAnchor constraintEqualToAnchor:content.topAnchor constant:22],
        [self.stack.leadingAnchor constraintEqualToAnchor:content.leadingAnchor constant:22],
        [self.stack.trailingAnchor constraintEqualToAnchor:content.trailingAnchor constant:-22]]];
    [self section:@"Orientation" symbol:@"rotate.right"];[self toggle:@"Rotate 180°" key:@"rotate"];
    [self section:@"Exposure" symbol:@"sun.max"];[self toggle:@"Automatic exposure" key:@"ae"];[self slider:@"Exposure (0.1 ms)" key:@"exposure"];
    [self toggle:@"Indoor lighting (50 Hz)" key:@"indoor"];
    [self section:@"White balance" symbol:@"thermometer.medium"];[self toggle:@"Automatic white balance" key:@"awb"];
    [self slider:@"Warmth (cool to warm)" key:@"warmth"];
    [self slider:@"Red gain" key:@"red"];[self slider:@"Blue gain" key:@"blue"];
    [self row:@"" controls:@[[self button:@"Lock current white balance" action:@selector(cameraAction:) tag:2]]];
    [self centreWarmth];
    [self section:@"Camera" symbol:@"video"];
    [self row:@"" controls:@[[self button:@"Save to Camera" action:@selector(cameraAction:) tag:1],[self button:@"Read settings" action:@selector(cameraAction:) tag:4],[self button:@"Diagnostics" action:@selector(cameraAction:) tag:0]]];
    [self row:@"Test capture" controls:@[[self button:@"30 fps" action:@selector(testCapture:) tag:30],[self button:@"60 fps" action:@selector(testCapture:) tag:60]]];
    self.details=[NSTextField wrappingLabelWithString:@"30 fps is the default. Capture apps select the frame rate."];
    self.details.font=[NSFont systemFontOfSize:12];self.details.selectable=YES;
    [self.stack addArrangedSubview:self.details];[self.details.widthAnchor constraintEqualToAnchor:self.stack.widthAnchor].active=YES;
    [self.details.heightAnchor constraintEqualToConstant:62].active=YES;
    self.status=[NSTextField labelWithString:@"Checking camera"];self.status.textColor=NSColor.secondaryLabelColor;
    self.status.font=[NSFont systemFontOfSize:12];[self.stack addArrangedSubview:self.status];
    [content layoutSubtreeIfNeeded];[self.window setContentSize:NSMakeSize(440,self.stack.fittingSize.height+44)];
    NSMenu *bar=[NSMenu new];NSMenuItem *root=[bar addItemWithTitle:@"Eye Controls" action:nil keyEquivalent:@""];
    NSMenu *menu=[NSMenu new];root.submenu=menu;
    NSMenuItem *settings=[menu addItemWithTitle:@"Settings…" action:@selector(show:) keyEquivalent:@","];
    settings.target=self;[menu addItem:[NSMenuItem separatorItem]];
    [menu addItemWithTitle:@"Quit Eye Controls" action:@selector(terminate:) keyEquivalent:@"q"];
    NSApp.mainMenu=bar;
    [self.window center];[self show:nil];[self changed:nil];
    [NSTimer scheduledTimerWithTimeInterval:1 target:self selector:@selector(refresh:) userInfo:nil repeats:YES];
}
@end
int main(int argc,const char **argv){@autoreleasepool{
    if(argc==2&&!strcmp(argv[1],"--apply-defaults")){
        EyeConnection eye={0};unsigned char diag[12],values[]={1,2,120,1,128,128,0};
        BOOL ok=openEye(&eye,diag)&&applyProfile(eye,values);closeEye(&eye);
        puts(ok?"Applied to the camera":"Firmware 8 camera unavailable");return !ok;
    }
    [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    __attribute__((objc_precise_lifetime)) Panel *panel=[Panel new];NSApp.delegate=panel;[NSApp run];
}return 0;}

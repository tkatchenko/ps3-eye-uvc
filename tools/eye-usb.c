#include <libusb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <CommonCrypto/CommonDigest.h>

enum { SIZE = 8192 };
static libusb_device_handle *dev;
static unsigned char old_target, old_sub, old_data;
static int saved, burst;
static int transfer(int in, int index, unsigned char *v) {
    return libusb_control_transfer(dev, in ? 0xc0 : 0x40, 1, 0, index, v, 1, 1000)==1;
}
static int put(int index,unsigned char value) {return transfer(0,index,&value);}
static int command(unsigned char op) {
    if (!put(0xf5,op)) return 0;
    for (int i=0;i<40;i++) {
        unsigned char status;
        if (!transfer(1,0xf6,&status)) return 0;
        if (!(status&1)) {
            if (status&4) fprintf(stderr,"SCCB NAK after %02x\n",op);
            return !(status&4);
        }
        usleep(1000);
    }
    return 0;
}
static int cleanup(void) {
    int ok=1;
    if (burst) ok=command(0x20);
    if (saved){ok &= put(0xf3,old_data);ok &= put(0xf2,old_sub);ok &= put(0xf1,old_target);}
    libusb_close(dev);libusb_exit(NULL);return ok;
}
static int snapshot(unsigned char *out) {
    for(int base=0;base<SIZE;base+=256) {
        if(!put(0xf2,base>>8)||!put(0xf3,0)||!command(0x37))return 0;
        for(int i=0;i<256;i++)
            if(!command(0xf9)||!transfer(1,0xf4,&out[base+i]))return 0;
    }
    return 1;
}
static int write_byte(unsigned address, unsigned char value) {
    if(!put(0xf2,address>>8))return 0;
    burst=1;
    if(!command(0x13)||!put(0xf2,address&255)||!put(0xf3,address&255)||!command(0x02)||
       !put(0xf2,value)||!put(0xf3,value)||!command(0x02)||!command(0x20))return 0;
    burst=0;usleep(20000);return 1;
}
static int read_image(const char *path,unsigned char *bytes) {
    FILE *f=fopen(path,"rb");
    if(!f)return 0;
    int exact=fread(bytes,1,SIZE,f)==SIZE && fgetc(f)==EOF && !ferror(f);
    fclose(f);
    return exact;
}
static int matches_hash(const unsigned char *bytes,const char *digest) {
    unsigned char h[32];char hex[65];
    CC_SHA256(bytes,SIZE,h);
    for(int i=0;i<32;i++)snprintf(hex+2*i,3,"%02x",h[i]);
    return strcmp(hex,digest)==0;
}
static int load_image(const char *path,const char *digest,unsigned char *bytes) {
    return read_image(path,bytes) && matches_hash(bytes,digest);
}
static const char stock_hash[]="5a11ae9f011060025aac82c6dbcda55d9d4ff0e226e9f65185cd3e9e9df76ffa";
static const char release_hash[]="7cf9d48dc24beb04a4f075315783fefb85ac568fe7bf00f785386d247de13c61";

static int save_backup(const char *path,const unsigned char *image) {
    FILE *f=fopen(path,"wbx");
    if(!f){perror(path);return 0;}
    int ok=fwrite(image,1,SIZE,f)==SIZE && fflush(f)==0 && fsync(fileno(f))==0;
    if(fclose(f)!=0)ok=0;
    unsigned char check[SIZE];
    if(!ok || !read_image(path,check) || memcmp(image,check,SIZE)){
        fprintf(stderr,"Backup file incomplete or failed verification: %s\n",path);return 0;
    }
    puts("Backup saved and verified against two live reads.");
    if(!matches_hash(image,stock_hash))puts("This EEPROM differs from the supported factory image. Installation is unavailable.");
    return 1;
}
static int connect_stock(void) {
    libusb_device **list=NULL;
    ssize_t count=libusb_get_device_list(NULL,&list);
    if(count<0)return 0;
    int eyes=0;
    libusb_device *candidate=NULL;
    for(ssize_t i=0;i<count;i++){
        struct libusb_device_descriptor desc;
        if(libusb_get_device_descriptor(list[i],&desc)==0 && desc.idVendor==0x1415 && desc.idProduct==0x2000){
            candidate=list[i];eyes++;
        }
    }
    int ok=eyes==1 && libusb_open(candidate,&dev)==0;
    libusb_free_device_list(list,1);
    if(!ok){fprintf(stderr,"Connect exactly one accessible PlayStation Eye. Found %d.\n",eyes);return 0;}
    unsigned char name[80];
    if(libusb_get_string_descriptor_ascii(dev,2,name,sizeof name)<0 || strcmp((char*)name,"USB Camera-B4.04.27.1")){
        fputs("Only a stock USB Camera-B4.04.27.1 is supported.\n",stderr);return 0;
    }
    if(libusb_claim_interface(dev,0)!=0){
        fputs("Stock video interface is busy or unavailable. Close capture apps.\n",stderr);return 0;
    }
    return 1;
}
static int install(const unsigned char *before,const unsigned char *after) {
    // Install the payload before the original code and the boot header last.
    const unsigned bounds[][2]={{2417,SIZE},{4,2417},{0,4}};
    for(size_t region=0;region<3;region++){
        for(unsigned i=bounds[region][0];i<bounds[region][1];i++){
            if(before[i]==after[i])continue;
            unsigned char check;
            if(!write_byte(i,after[i]) || !put(0xf2,i>>8) || !put(0xf3,i&255) ||
               !command(0x37) || !command(0xf9) || !transfer(1,0xf4,&check) || check!=after[i]){
                fprintf(stderr,"Write or verification failed at byte %u. Keep the camera powered.\n",i);return 0;
            }
        }
    }
    unsigned char verify[SIZE];
    if(!snapshot(verify) || memcmp(verify,after,SIZE)){
        fputs("Full readback failed. Keep the camera powered.\n",stderr);return 0;
    }
    return 1;
}
int main(int argc,char **argv) {
    int save=argc==3 && !strcmp(argv[1],"backup");
    int flash=argc==4 && !strcmp(argv[1],"install");
    int check=argc==4 && !strcmp(argv[1],"check");
    if(!save && !check && !flash){
        fputs("Usage: eye-usb backup NEW_FILE\n       eye-usb check BACKUP STAGE82\n       eye-usb install BACKUP STAGE82\n",stderr);return 2;
    }
    unsigned char original[SIZE],target[SIZE],first[SIZE],second[SIZE];
    if(!save && (!load_image(argv[2],stock_hash,original)||!load_image(argv[3],release_hash,target))){
        fputs("Backup or firmware has the wrong length or SHA-256, or could not be read.\n",stderr);return 1;
    }
    if(libusb_init(NULL)!=0)return 1;
    if(!connect_stock()){if(dev)libusb_close(dev);libusb_exit(NULL);return 1;}
    int ok=transfer(1,0xf1,&old_target)&&transfer(1,0xf2,&old_sub)&&transfer(1,0xf3,&old_data);
    saved=ok;
    ok=ok && put(0xf1,0xac) && snapshot(first) && snapshot(second) && !memcmp(first,second,SIZE);
    if(!ok)fputs("Could not obtain two identical live EEPROM reads.\n",stderr);
    else if(save)ok=save_backup(argv[2],first);
    else if(memcmp(first,original,SIZE)){ok=0;fputs("Live EEPROM differs from verified stock backup.\n",stderr);}
    else if(check)puts("Stock camera, backup and Stage 8.2 image verified. No EEPROM write.");
    else {
        puts("Installing Stage 8.2. Keep USB connected until verification completes.");fflush(stdout);
        ok=install(first,target);
    }
    if(!cleanup()){fputs("USB cleanup failed.\n",stderr);return 1;}
    if(ok && flash)puts("All 8192 bytes verified. Unplug and reconnect the Eye.");
    return !ok;
}

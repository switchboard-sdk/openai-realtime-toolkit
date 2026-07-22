//
//  OpenAIRealtimeToolkitModuleProvider.mm
//  OpenAIRealtimeToolkit
//

#import "OpenAIRealtimeToolkitModuleProvider.h"

#import <AVFAudio/AVFAudio.h>
#import <ReactCommon/CallInvoker.h>
#import <ReactCommon/TurboModule.h>

#import "NativeOpenAIRealtimeToolkit.h"

@implementation OpenAIRealtimeToolkitModuleProvider

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  // Hand the C++ module a writable location for recordings/logs.
  NSArray<NSString *> *paths =
      NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
  NSString *documentsDir = paths.firstObject;
  if (documentsDir) {
    facebook::react::NativeOpenAIRealtimeToolkit::setDocumentsPath(
        std::string(documentsDir.UTF8String));
  }

  // Mic-permission request lives here — the C++ module can't reach AVFoundation.
  // Prompts once; a prior decision resolves without UI.
  facebook::react::NativeOpenAIRealtimeToolkit::setMicrophonePermissionHook(
      [](std::function<void(bool)> completion) {
        if (@available(iOS 17.0, *)) {
          [AVAudioApplication requestRecordPermissionWithCompletionHandler:^(BOOL granted) {
            completion(granted);
          }];
        } else {
          [[AVAudioSession sharedInstance] requestRecordPermission:^(BOOL granted) {
            completion(granted);
          }];
        }
      });

  return std::make_shared<facebook::react::NativeOpenAIRealtimeToolkit>(params.jsInvoker);
}

@end

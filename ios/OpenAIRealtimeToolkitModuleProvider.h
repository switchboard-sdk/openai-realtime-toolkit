//
//  OpenAIRealtimeToolkitModuleProvider.h
//  OpenAIRealtimeToolkit
//
//  RCTModuleProvider for the OpenAIRealtimeToolkit C++ TurboModule. Registered with React
//  Native via package.json `codegenConfig.ios.modulesProvider` so autolinking
//  hands JS's `OpenAIRealtimeToolkit` module off to the shared C++ implementation.
//

#import <Foundation/Foundation.h>
#import <ReactCommon/RCTTurboModule.h>

NS_ASSUME_NONNULL_BEGIN

@interface OpenAIRealtimeToolkitModuleProvider : NSObject <RCTModuleProvider>

@end

NS_ASSUME_NONNULL_END

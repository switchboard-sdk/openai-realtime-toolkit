#pragma once

// Codegen-generated C++ TurboModule spec for `src/NativeOpenAIRealtimeToolkit.ts`.
// The umbrella header name comes from package.json `codegenConfig.name`.
#include <RNOpenAIRealtimeToolkitSpecJSI.h>

#include <functional>
#include <memory>
#include <string>

#include <react/bridging/Promise.h>
#include <switchboard/SwitchboardJSONRPC.hpp>

namespace facebook::react {

// Platform-provided mic-permission request; calls the completion with the
// grant result (async, may complete on any thread).
using MicrophonePermissionHook = std::function<void(std::function<void(bool)>)>;

/**
 * OpenAIRealtimeToolkit's native core: a C++ TurboModule wrapping `SwitchboardJSONRPC`.
 *
 * The entire SDK is driven over one JSON-RPC string channel (`processCommand`),
 * and SDK events are pushed to JS through the generated `emitOnEventReceived`.
 * The same source compiles for iOS and Android.
 */
class NativeOpenAIRealtimeToolkit : public NativeOpenAIRealtimeToolkitCxxSpec<NativeOpenAIRealtimeToolkit> {
public:
  NativeOpenAIRealtimeToolkit(std::shared_ptr<CallInvoker> jsInvoker);

  std::string processCommand(jsi::Runtime& rt, std::string command);
  std::string getDocumentsPath(jsi::Runtime& rt);
  bool writeFile(jsi::Runtime& rt, std::string path, std::string contents);
  AsyncPromise<bool> requestMicrophonePermission(jsi::Runtime& rt);

  /** Set by the platform layer (iOS provider / Android JNI) at startup. */
  static void setDocumentsPath(const std::string& path);
  /** Set by the platform layer to perform the mic-permission request. */
  static void setMicrophonePermissionHook(MicrophonePermissionHook hook);

private:
  switchboard::SwitchboardJSONRPC switchboard;
};

} // namespace facebook::react

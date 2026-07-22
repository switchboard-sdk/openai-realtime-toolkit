#include "NativeOpenAIRealtimeToolkit.h"

#include <fstream>

// Switchboard extensions. Each must be loaded once, before any graph that uses
// it is built — hence the constructor below. Headers resolve via the per-
// framework `include/` dirs added to the build's header search paths.
#include "SileroVADExtension.hpp"
#include "OnnxExtension.hpp"
#include "OpenAIExtension.hpp"
#include "SmartTurnExtension.hpp"

namespace facebook::react {

NativeOpenAIRealtimeToolkit::NativeOpenAIRealtimeToolkit(std::shared_ptr<CallInvoker> jsInvoker)
    : NativeOpenAIRealtimeToolkitCxxSpec(std::move(jsInvoker)) {
  // Register extensions with the SDK.
  switchboard::extensions::silerovad::SileroVADExtension::load();
  switchboard::extensions::onnx::OnnxExtension::load();
  switchboard::extensions::openai::OpenAIExtension::load();
  switchboard::extensions::smartturn::SmartTurnExtension::load();

  // Forward every SDK event to JS via the codegen-generated emitter.
  switchboard.setEventCallback(
      [this](const std::string& event) { emitOnEventReceived(event); });
}

static std::string s_documentsPath;
static MicrophonePermissionHook s_micPermissionHook;

void NativeOpenAIRealtimeToolkit::setDocumentsPath(const std::string& path) {
  s_documentsPath = path;
}

void NativeOpenAIRealtimeToolkit::setMicrophonePermissionHook(MicrophonePermissionHook hook) {
  s_micPermissionHook = std::move(hook);
}

std::string NativeOpenAIRealtimeToolkit::getDocumentsPath(jsi::Runtime& rt) {
  return s_documentsPath;
}

AsyncPromise<bool> NativeOpenAIRealtimeToolkit::requestMicrophonePermission(jsi::Runtime& rt) {
  AsyncPromise<bool> promise(rt, jsInvoker_);
  if (s_micPermissionHook) {
    // resolve() hops back to the JS thread; the completion may fire on any thread.
    s_micPermissionHook([promise](bool granted) mutable { promise.resolve(granted); });
  } else {
    // No hook (Android / tests): handled elsewhere.
    promise.resolve(true);
  }
  return promise;
}

bool NativeOpenAIRealtimeToolkit::writeFile(jsi::Runtime& rt, std::string path,
                                std::string contents) {
  std::ofstream file(path, std::ios::out | std::ios::trunc);
  if (!file.is_open()) {
    return false;
  }
  file << contents;
  return file.good();
}

std::string NativeOpenAIRealtimeToolkit::processCommand(jsi::Runtime& rt,
                                            std::string command) {
  return switchboard.processCommand(command);
}

} // namespace facebook::react

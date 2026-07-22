require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# Switchboard SDK + extensions, downloaded into ios/Frameworks/ by the script
# below. Android pulls the equivalents from Maven (see android/build.gradle).
switchboard_packages = %w[SwitchboardSDK SwitchboardSileroVAD SwitchboardSmartTurn SwitchboardOnnx SwitchboardOpenAI]

Pod::Spec.new do |s|
  s.name         = "OpenAIRealtimeToolkit"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/switchboard-sdk/openai-realtime-toolkit"
  s.license      = package["license"]
  s.authors      = package["author"]
  s.platforms    = { :ios => "13.4" }
  s.source       = { :git => "https://github.com/switchboard-sdk/openai-realtime-toolkit.git", :tag => "v#{s.version}" }

  # The shared C++ TurboModule (cpp/) + the iOS provider glue (ios/).
  s.source_files = "cpp/**/*.{h,hpp,cpp}", "ios/**/*.{h,mm}"

  # Privacy manifest, aggregated into the app's privacy report. Declares the
  # FileTimestamp required-reason API (stat/fstat) the bundled frameworks use.
  s.resource_bundles = { "OpenAIRealtimeToolkit_privacy" => ["ios/PrivacyInfo.xcprivacy"] }

  # Fetch the Switchboard xcframeworks during `pod install` — keeps the binaries
  # out of git and out of the npm tarball. Idempotent: skips if already present.
  s.prepare_command = "bash scripts/download-ios-frameworks.sh"

  # Link the downloaded xcframeworks (each carries the C++ headers we compile
  # against). Declared as explicit paths; populated by prepare_command above.
  s.vendored_frameworks = switchboard_packages.map do |pkg|
    "ios/Frameworks/#{pkg}/ios/#{pkg}.xcframework"
  end

  header_search_paths = switchboard_packages.map do |pkg|
    "\"${PODS_TARGET_SRCROOT}/ios/Frameworks/#{pkg}/ios/include\""
  end
  framework_search_paths = switchboard_packages.map do |pkg|
    "\"${PODS_TARGET_SRCROOT}/ios/Frameworks/#{pkg}/ios\""
  end

  s.pod_target_xcconfig = {
    "HEADER_SEARCH_PATHS"          => "$(inherited) " + header_search_paths.join(" "),
    "FRAMEWORK_SEARCH_PATHS"       => "$(inherited) " + framework_search_paths.join(" "),
    "CLANG_CXX_LANGUAGE_STANDARD"  => "c++20",
  }

  s.frameworks = "AVFoundation", "AudioToolbox"

  # Pulls in React-Core and wires up the new architecture + codegen (generates
  # RNOpenAIRealtimeToolkitSpecJSI.h, which cpp/NativeOpenAIRealtimeToolkit.h includes).
  install_modules_dependencies(s)
end

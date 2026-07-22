package com.synervoz.openairealtimetoolkit

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * The core OpenAIRealtimeToolkit engine is a pure C++ TurboModule (registered via RN's C++
 * autolinking, not the JVM). This package still has to exist so autolinking
 * recognizes the directory as an Android library — otherwise the CLI drops the
 * android config and its Switchboard Maven/Prefab wiring. It also registers the
 * one JVM module we need: {@link OpenAIRealtimeToolkitAudioSessionModule} (AudioManager
 * routing for speakerphone + AEC).
 */
class OpenAIRealtimeToolkitPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == OpenAIRealtimeToolkitAudioSessionModule.NAME) {
      OpenAIRealtimeToolkitAudioSessionModule(reactContext)
    } else {
      null
    }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      OpenAIRealtimeToolkitAudioSessionModule.NAME to
        ReactModuleInfo(
          OpenAIRealtimeToolkitAudioSessionModule.NAME, // name
          OpenAIRealtimeToolkitAudioSessionModule.NAME, // className
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          false, // isTurboModule
        )
    )
  }
}

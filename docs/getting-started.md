# Getting started

Install, native setup for each platform, credentials, and App Store privacy. If you are new here, start with the [landing README](../README.md) for what the toolkit is and a quickstart.

## Platforms

| Platform | Status    |
| -------- | --------- |
| iOS      | Supported |
| Android  | Supported |

## Install

```sh
npm install @synervoz/openai-realtime-toolkit
```

### Requirements

| Requirement      | Minimum                    |
| ---------------- | -------------------------- |
| React Native     | 0.76+                      |
| New Architecture | Required (enabled)         |
| iOS              | 13.4+                      |
| Android NDK      | 29, see [Android](#android) |
| Node.js          | 22+                        |

This is a **C++ TurboModule** and requires the **[New Architecture](https://reactnative.dev/architecture/landing-page)**. It works in both React Native CLI and Expo apps, but not in Expo Go (see [Expo](#expo)).

## iOS

From **your app's** `ios/` directory:

```sh
cd ios && pod install
```

Add a microphone usage string to your app's `Info.plist`. This is required, and without it the app crashes when the mic is requested:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Used for the voice assistant.</string>
```

## Android

There are two paths here. Pick the one that matches your app:

- **Expo.** Skip this section entirely. The [config plugin](#expo) applies all four steps below for you during `prebuild`. Go to [Expo](#expo).
- **React Native CLI** (bare React Native). Apply the four steps below to your app by hand.

The C++ TurboModule is compiled in your app's native build, so your app needs to know the audio-engine Maven repo, enable Prefab, and build with **NDK 29**. All three are required.

**1. Maven repo.** Add it to your app's root **`android/build.gradle`** (public, no credentials). Declare it at the project level. React Native's Gradle plugin adds its own repos the same way, so a settings-level `dependencyResolutionManagement` block would be ignored under Gradle's default `PREFER_PROJECT` mode:

```groovy
allprojects {
    repositories {
        maven { url "https://s3.amazonaws.com/synervoz-android-maven-repository" }
    }
}
```

**2. Prefab.** Enable it in your app's **`android/app/build.gradle`**:

```groovy
android {
    buildFeatures {
        prefab true
    }
}
```

**3. NDK 29.** Raise `ndkVersion` in the `buildscript { ext { … } }` block of your app's root **`android/build.gradle`**. The React Native template pins 27.x, which does not work:

```groovy
buildscript {
    ext {
        ndkVersion = "29.0.14206865"   // not the template's 27.x, see below
        // …
    }
}
```

Install it once if you do not have it:

```sh
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "ndk;29.0.14206865"
```

The native libraries need NDK 29's `libc++_shared.so`. On 27.x the app builds and installs fine but fails at launch with `UnsatisfiedLinkError: cannot locate symbol "__cxa_init_primary_exception"`.

**4. Drop 32-bit x86.** The native libraries ship `arm64-v8a`, `armeabi-v7a` and `x86_64`. There is no 32-bit `x86` slice, but the React Native template's `reactNativeArchitectures` asks for one. Remove it in your app's **`android/gradle.properties`**:

```properties
reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64
```

`run-android` and `expo run:android` build only the connected device's ABI, so they pass either way. A release build, CI or EAS is where it surfaces:

```
Execution failed for task ':app:configureCMakeDebug[x86]'.
> [CXX1210] … debug|x86 : No compatible library found [//SwitchboardSmartTurn/SwitchboardSmartTurn]
```

Then build:

```sh
npx react-native run-android
```

> **Confirming the NDK** (either path): every Android build prints the NDK it used, so you can check the right one landed:
>
> ```
> [ExpoRootProject]  - ndk:  29.0.14206865
> ```

## Expo

The toolkit works in an Expo app, but because it ships native code (a C++ TurboModule and the native audio frameworks) it can **not** run in Expo Go. You need a [development build](https://docs.expo.dev/develop/development-builds/introduction/).

- **New Architecture is required.** It is on by default in Expo SDK ≥ 52.
- **SDK version.** You need React Native ≥ 0.76 (Expo SDK ≥ 52). Developed and tested against RN 0.86, which is Expo SDK 57, an exact RN match so there is no TurboModule codegen mismatch. Older SDKs down to 52 should also work.

**1. Install.**

```sh
npx expo install @synervoz/openai-realtime-toolkit
```

**2. Add the config plugin to `app.json`.** Do this *before* prebuilding, because prebuild is what applies it. It declares the Maven repo, enables Prefab, raises `ndkVersion` to 29, and drops the unsupported 32-bit `x86` architecture from `reactNativeArchitectures` in your app's own Android build files. That is the wiring Expo cannot do on its own, since `expo-build-properties` has no `ndkVersion` option and the React Native CLI autolinking path cannot land it early enough under prebuild. The microphone string and permissions are handled by built-ins (below), so the plugin takes no options. It is only relevant to Android, since every setting it writes is a Gradle one, so on an iOS-only project it does nothing:

```json
{
  "expo": {
    "plugins": ["@synervoz/openai-realtime-toolkit"],
    "ios": {
      "infoPlist": {
        "NSMicrophoneUsageDescription": "Used for the voice assistant."
      }
    }
  }
}
```

`NSMicrophoneUsageDescription` is required for the iOS mic prompt. Android permissions (`RECORD_AUDIO`, `INTERNET`, `MODIFY_AUDIO_SETTINGS`) ship in the library's manifest and merge in automatically, so there is nothing to add.

**3. Prebuild, then build and launch the dev build.**

```sh
npx expo prebuild            # generates ios/ + android/; iOS runs pod install (fetches the frameworks)
npx expo run:ios             # or: npx expo run:android
```

Add `-p ios` or `-p android` to prebuild for a single platform. If you prebuilt *before* adding the plugin, run `npx expo prebuild` again so the Android wiring lands. Otherwise the generated `android/` has no Maven repo, no Prefab and NDK 27, and the app crashes at launch (see [Android](#android)).

## Credentials

Every credential the provider takes is optional. It works out of the box, and each one you pass overrides a built-in default.

- **OpenAI.** A Realtime-capable key from [platform.openai.com](https://platform.openai.com/api-keys). Omit `openAIApiKey` and the session runs on a shared test key instead.
- **Audio engine.** `appId` and `appSecret`, optional for testing and development, since the library ships with shared default credentials it falls back to. For production, create an app at [console.switchboard.audio](https://console.switchboard.audio/register) (free) to get its `APP_ID` and `APP_SECRET`.

> [!WARNING]
> **The OpenAI test key is for evaluation only.** It is shared and rate-limited, and it rotates without notice, so an app relying on it stops working the moment it turns over. You get no quota or billing control over it. Pass your own `openAIApiKey` for anything you ship. The toolkit `console.warn`s at init when no key is set. The bundled audio-engine credentials are fine to build and test against, but use your own `appId` and `appSecret` in production so the app runs under your own account.

> [!NOTE]
> Your `APP_ID` and `APP_SECRET` are safe to bundle in your application. They function like a publishing key and are meant to be distributed with your app. Your OpenAI key is not. Keep it out of source (for example with `react-native-dotenv`), and for a shipped app mint an ephemeral key server-side rather than embedding a standing one.

## Privacy (App Store)

The toolkit bundles its own iOS [privacy manifest](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api), so the one Apple-flagged API it uses (`FileTimestamp`, from loading model files) is already declared for you. There is nothing to do.

At the **app** level you still handle two things:

- **`NSMicrophoneUsageDescription`** in `Info.plist` (see [iOS](#ios)), the mic prompt string. The microphone is not a privacy-manifest API, so this string is all it needs.
- **App Store privacy labels.** Audio is streamed to the OpenAI Realtime API, so disclose that (for example, "Audio Data"). The toolkit itself stores nothing.

## Next

- [Turn detection](turn-detection.md) keeps turn-taking working when the room gets noisy.
- [Tools](tools.md) let the agent act on your app.
- [API reference](api-reference.md) has the provider, the hook, every export, and the error codes.

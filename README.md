# OpenAI-Realtime-Toolkit

On-device audio AI for React Native, powered by the [Switchboard SDK](https://switchboard.audio).
OpenAIRealtimeToolkit makes OpenAI Realtime voice models easy to use along with tool calling and customizable local turn-detection and barge-in handling.

## Platforms

| Platform | Status      |
| -------- | ----------- |
| iOS      | Supported   |
| Android  | Supported   |

## Install

```sh
npm install @synervoz/openai-realtime-toolkit
```

### Requirements

| Requirement      | Minimum                     |
| ---------------- | --------------------------- |
| React Native     | 0.76+                       |
| New Architecture | Required (enabled)          |
| iOS              | 13.4+                       |
| Android NDK      | 29 — see [Android](#android) |
| Node.js          | 22+                         |

OpenAIRealtimeToolkit is a bare React Native **C++ TurboModule** and requires the **[New Architecture](https://reactnative.dev/architecture/landing-page)**. It works in both Expo (prebuild) and bare React Native apps.

### iOS

From **your app's** `ios/` directory:

```sh
cd ios && pod install
```

Add a microphone usage string to your app's `Info.plist` (required — without it the
app crashes when the mic is requested):

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Used for the voice assistant.</string>
```

### Android

OpenAIRealtimeToolkit's C++ TurboModule is compiled in your app's native build, so your
app needs to (a) know the Switchboard Maven repo, (b) enable Prefab, and (c) build with
**NDK 29**. All three are required.

**1. Maven repo.** Add it to your app's root **`android/build.gradle`** (public, no
credentials). Declare it at the project level — React Native's Gradle plugin adds
its own repos the same way, so a settings-level `dependencyResolutionManagement`
block would be ignored under Gradle's default `PREFER_PROJECT` mode:

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

**3. NDK 29.** Raise `ndkVersion` in the `buildscript { ext { … } }` block of your app's
root **`android/build.gradle`** — the React Native template pins 27.x, which does not
work:

```groovy
buildscript {
    ext {
        ndkVersion = "29.0.14206865"   // not the template's 27.x — see below
        // …
    }
}
```

Install it once if you don't have it:

```sh
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "ndk;29.0.14206865"
```

The Switchboard native libraries reference `__cxa_init_primary_exception`, a symbol only
exported by NDK 29's `libc++_shared.so`. Your app packages exactly one
`libc++_shared.so` — the one from *its* NDK — so on the template's 27.x the Switchboard
libraries can't be loaded. This builds and installs fine; it fails at launch:

```
SoLoader: java.lang.UnsatisfiedLinkError: dlopen failed: cannot locate symbol
  "__cxa_init_primary_exception" referenced by ".../lib/arm64-v8a/libSwitchboardSDK.so"
SoLoader: couldn't find DSO to load: libSwitchboardSDK.so
ReactNativeJS: Invariant Violation: TurboModuleRegistry.getEnforcing(...):
  'PlatformConstants' could not be found.
```

(27.x is confirmed broken and 29 confirmed good; 28.x is untested — pin 29.)

**4. Drop 32-bit x86.** The Switchboard libraries ship `arm64-v8a`, `armeabi-v7a` and
`x86_64` — there is no 32-bit `x86` slice, but the React Native template's
`reactNativeArchitectures` asks for one. Remove it in your app's
**`android/gradle.properties`**:

```properties
reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64
```

Otherwise any build that doesn't narrow the ABI list — `./gradlew assembleDebug`,
a release build, CI, EAS — fails at configure time:

```
Execution failed for task ':app:configureCMakeDebug[x86]'.
> [CXX1210] … debug|x86 : No compatible library found [//SwitchboardSmartTurn/SwitchboardSmartTurn]
```

`npx react-native run-android` and `npx expo run:android` build only the connected
device's ABI, so they succeed either way — this surfaces the first time someone builds
without that narrowing. Nothing is lost: `armeabi-v7a` covers 32-bit ARM, `x86_64` covers
emulators and Intel Chromebooks, and Google Play requires 64-bit anyway.

Then build:

```sh
npx react-native run-android
```

> **Expo apps**: the [config plugin](#expo) applies all four during `prebuild`. Every
> Android build prints the NDK it used, so you can confirm it landed:
>
> ```
> [ExpoRootProject]  - ndk:  29.0.14206865
> ```

### Expo

OpenAIRealtimeToolkit works in an Expo app, but because it ships native code (a C++
TurboModule + the Switchboard frameworks) it can **not** run in Expo Go — you
need a [development build](https://docs.expo.dev/develop/development-builds/introduction/).

- **New architecture is required** — on by default in Expo SDK ≥ 52.
- **SDK version** — needs React Native ≥ 0.76 (Expo SDK ≥ 52). Developed and
  tested against RN 0.86, i.e. **Expo SDK 57**: an exact RN match, so there's no
  TurboModule codegen mismatch. Older SDKs down to 52 should also work.

**1. Install.**

```sh
npx expo install @synervoz/openai-realtime-toolkit
```

**2. Add the config plugin to `app.json`** — do this *before* prebuilding, because
prebuild is what applies it. It declares the Switchboard Maven repo, enables Prefab,
raises `ndkVersion` to 29, and drops the unsupported 32-bit `x86` architecture from
`reactNativeArchitectures` in your app's own Android build files — the wiring Expo can't
do on its own (`expo-build-properties` has no `ndkVersion` option), and which the bare-RN
autolinking path can't land early enough under prebuild. The microphone string and
permissions are handled by built-ins (below), so the plugin takes no options:

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

`NSMicrophoneUsageDescription` is required for the iOS mic prompt. Android
permissions (`RECORD_AUDIO`, `INTERNET`, `MODIFY_AUDIO_SETTINGS`) ship in the
library's manifest and merge in automatically — nothing to add.

**3. Prebuild, then build and launch the dev build.**

```sh
npx expo prebuild            # generates ios/ + android/; iOS runs pod install (fetches the frameworks)
npx expo run:ios             # or: npx expo run:android
```

Add `-p ios` / `-p android` to prebuild for a single platform. If you prebuilt *before*
adding the plugin, run `npx expo prebuild` again so the Android wiring lands — otherwise
the generated `android/` has no Maven repo, no Prefab and NDK 27, and the app crashes at
launch (see [Android](#android)).

## Privacy (App Store)

OpenAIRealtimeToolkit bundles its own iOS [privacy manifest](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api),
so the one Apple-flagged API it uses (`FileTimestamp`, from loading model files) is
already declared for you — nothing to do.

At the **app** level you still handle:

- **`NSMicrophoneUsageDescription`** in `Info.plist` (see [iOS install](#ios)) — the mic
  prompt string. (The microphone isn't a privacy-manifest API; this string is all it needs.)
- **App Store privacy labels** — audio is streamed to the **OpenAI Realtime API** with
  your key, so disclose that (e.g. "Audio Data"). OpenAIRealtimeToolkit itself stores nothing.

## Credentials

The provider takes three: a **Switchboard** `appId` / `appSecret` pair, and your **OpenAI**
API key.

- **Switchboard** — sign up at [console.switchboard.audio](https://console.switchboard.audio/register)
  (free) and create an app to get its `APP_ID` and `APP_SECRET`.
- **OpenAI** — a Realtime-capable key from
  [platform.openai.com](https://platform.openai.com/api-keys).

> [!TIP]
> The [example app](example) ships with working Switchboard demo credentials, so you can try
> the library out without creating an account — you only need to add your own OpenAI key.

> [!NOTE]
> Your Switchboard `APP_ID` and `APP_SECRET` are **safe to bundle in your application**. They
> function like a publishing key and are intended to be distributed with your app. Your
> **OpenAI key is not** — keep it out of source (e.g. `react-native-dotenv`), and for a
> shipped app mint an ephemeral key server-side rather than embedding a standing one.

## Usage

Wrap your app in `OpenAIRealtimeToolkitProvider` with your credentials, then drive it from
any component with the `useOpenAIRealtimeToolkit()` hook. `start()` requests the mic and
builds the voice graph — microphone → OpenAI.Realtime → speaker, with on-device
SileroVAD + SmartTurn taps for turn detection and barge-in, and hardware echo
cancellation (VPIO):

```tsx
import React from 'react';
import { SafeAreaView, Text, TouchableOpacity } from 'react-native';
import {
  OpenAIRealtimeToolkitProvider,
  useOpenAIRealtimeToolkit,
  useTool,
} from '@synervoz/openai-realtime-toolkit';

export default function App() {
  return (
    <OpenAIRealtimeToolkitProvider
      appId="YOUR_APP_ID"
      appSecret="YOUR_APP_SECRET"
      openAIApiKey="YOUR_OPENAI_API_KEY"
      instructions="You are a terse, friendly voice assistant.">
      <Screen />
    </OpenAIRealtimeToolkitProvider>
  );
}

function Screen() {
  const { isRunning, connectionStatus, start, stop } = useOpenAIRealtimeToolkit();

  // A tool the model can call; its return value is sent back automatically.
  useTool({
    name: 'get_time',
    description: 'Get the current time.',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ time: new Date().toLocaleTimeString() }),
  });

  return (
    <SafeAreaView style={{ flex: 1, padding: 24, gap: 16 }}>
      <TouchableOpacity onPress={isRunning ? stop : start}>
        <Text>{isRunning ? 'Stop' : 'Start talking'}</Text>
      </TouchableOpacity>
      <Text>Connection: {connectionStatus}</Text>
    </SafeAreaView>
  );
}
```

That's the whole app — `start()` handles mic permission and connects, and the model can
call the `get_time` tool (try asking it the time). Turn-detection tuning and styling are
opt-in; see below and [`example/App.tsx`](example/App.tsx) for the fuller version.

### Lifecycle & placement

Mount `OpenAIRealtimeToolkitProvider` **once, at your app root** (above your navigator). It
isn't unmounted by navigation or by the app going to the background, so the
assistant keeps running across screens and the exposed state stays consistent —
call the `useOpenAIRealtimeToolkit()` hook from any screen.

- `stop()` pauses the engine but keeps it warm, so a later `start()` resumes fast.
- `release()` frees the engine's native resources (audio session, models); the
  next `start()` rebuilds it.
- The provider **doesn't** stop or release on unmount — the engine's lifecycle is
  yours to drive explicitly.
- **Background operation** (mic while the app is backgrounded) needs native setup:
  the iOS `audio` background mode in `Info.plist`, and an Android microphone
  foreground service. Without it the OS suspends audio when you leave the app.

### Runtime settings

`instructions`, the voice settings, and turn handling all come off the
`useOpenAIRealtimeToolkit()` hook and can also be seeded as **props** on the provider.
Changes through the hook apply live, without dropping the OpenAI session (the two
exceptions are called out below).

```tsx
const { instructions, setInstructions, localTurnHandling } = useOpenAIRealtimeToolkit();

localTurnHandling.enabled;            // on-device turn detection vs OpenAI's server_vad
localTurnHandling.setEnabled(true);
```

#### Voice, speed, and model

Seed them on the provider:

```tsx
<OpenAIRealtimeToolkitProvider voice="marin" speed={1.1} model="gpt-realtime" … />
```

| Setting | Values | Default | Changing it at runtime |
| --- | --- | --- | --- |
| `voice` | `alloy` \| `ash` \| `ballad` \| `cedar` \| `coral` \| `echo` \| `marin` \| `sage` \| `shimmer` \| `verse` | `'cedar'` | `setVoice('marin')` — ⚠️ OpenAI starts a new session for the new voice, so the conversation so far is dropped. |
| `speed` | `0.5`–`1.5` (out-of-range values are clamped) | `1.0` | `setSpeed(1.25)` — free, applied to the live session. |
| `model` | any OpenAI Realtime model id, e.g. `'gpt-realtime'` | `'gpt-realtime-2'` | **Not supported.** The model is baked into the engine when it's built, so switching it would mean tearing the engine down — pick it on the provider; the hook exposes it read-only. |

```tsx
const { voice, setVoice, speed, setSpeed, model } = useOpenAIRealtimeToolkit();
```

`VOICES` and `SPEED_RANGE` are exported for building a picker or a slider.

`localTurnHandling.config` is the tuning (used only while `enabled`). Read a knob as a value;
write with `setConfig` — a partial patch tweaks, a full knob set selects a preset:

```tsx
import { QUIET_CONFIG, NOISY_CONFIG } from '@synervoz/openai-realtime-toolkit';

const { config, setConfig } = localTurnHandling;

config.pauseToleranceMs;                        // read one knob (hover shows the doc)
setConfig({ pauseToleranceMs: 3000 });          // tweak one (keeps the rest)
setConfig(NOISY_CONFIG);                         // select a preset (overwrites all)
setConfig({ ...QUIET_CONFIG, pauseToleranceMs: 3000 });  // preset + tweak
```

Or seed it on the provider: `localTurnHandling={{ enabled: true, config: QUIET_CONFIG }}`.
Reset from scratch with `DEFAULT_CONFIG` as the base: `setConfig({ ...DEFAULT_CONFIG, ...tweaks })`.

#### Config knobs

Each field of `config`. Hover any knob in your editor for the same docs; `KNOB_SPECS`
carries `min`/`max`/`options` at runtime for building sliders.

**Turn detection** — when is the user's turn over?

Disable-able duration knobs use `Infinity` to mean "off" (`semanticFailTimeoutMs`,
`pauseTimeMs`, `cancelTimeMs`) — e.g. `setConfig({ cancelTimeMs: Infinity })`.

| Knob | What it does | Default | Range |
| --- | --- | --- | --- |
| `vadThreshold` | SileroVAD activation threshold; higher needs louder speech | `0.5` | `0.0`–`1.0` |
| `vadSilenceMs` | Silence (ms) SileroVAD holds before declaring speech ended | `500` | `100`–`6000` |
| `minInputLengthMs` | How long (ms) the user must speak for it to count as a turn | `600` | `200`–`6000` |
| `pauseToleranceMs` | Silence (ms) held after the user stops before ending the turn | `0` | `0`–`6000` |
| `semanticStrategy` | How SmartTurn's verdict combines with utterance length | `'gate'` | `off` \| `rescue` \| `gate` |
| `minSemanticConfidence` | SmartTurn confidence for short utterances | `0.01` | `0`–`0.9` |
| `maxSemanticConfidence` | SmartTurn confidence for long utterances | `0.5` | `0`–`0.9` |
| `thresholdBreakpointMs` | Utterance duration (ms) splitting min- from max-confidence | `2000` | `1000`–`6000` |
| `semanticFailTimeoutMs` | Force a commit after a semantic reject if silence lasts this long (ms) | `Infinity` (off) | `3000`–`6000` |

**Barge-in** — how the in-flight AI response is interrupted.

| Knob | What it does | Default | Range |
| --- | --- | --- | --- |
| `pauseTimeMs` | Delay (ms) after the user speaks before pausing the AI | `800` | `400`–`6000` |
| `cancelTimeMs` | Delay (ms) after the user speaks before cancelling the AI's response | `Infinity` (off) | `2000`–`16000` |
| `duckGain` | Gain (0–1) the AI is attenuated to while the user speaks (0 = mute) | `0.3` | `0`–`1` |
| `duckTimeMs` | How quickly (ms) the AI fades in/out of the ducked level | `100` | `0`–`1000` |
| `commitBehavior` | What to do with the in-flight AI response when a turn completes | `'cancel'` | `cancel` \| `finish` |

### Tool calling

Register tools with the `useTool` hook. The handler runs when the model calls the
tool, and its return value is sent back to the model automatically (throwing
reports a tool error):

```tsx
import { useTool } from '@synervoz/openai-realtime-toolkit';

useTool({
  name: 'set_background_color',
  description: "Changes the application's background color.",
  parameters: {
    type: 'object',
    properties: { color: { type: 'string' } },
    required: ['color'],
  },
  handler: async ({ color }) => {
    setBackgroundColor(color);
    return { success: true, color };
  },
});
```

`useTool` scopes the tool to the component (registers on mount, unregisters on
unmount, re-registers on `name`/`description`/`parameters` change) and keeps the
`handler` live across renders — no stale closures. `parameters` is optional (omit
for a no-arg tool); names must be unique (re-registering a name replaces it).

**Dynamic tool sets.** Since `useTool` follows the rules of hooks (no loops), for
tools sourced from config or registered outside render use the imperative
`registerTool(tool)` / `unregisterTool(name)` from `useOpenAIRealtimeToolkit()` —
you own the lifetime and the handler's closure:

```tsx
const { registerTool, unregisterTool } = useOpenAIRealtimeToolkit();
registerTool({ name: 'apply_coupon', description: '…', parameters: {…}, handler });
unregisterTool('apply_coupon'); // later
```

See [`example/App.tsx`](example/App.tsx) for the full screen.

## API

The public surface is the provider, the `useOpenAIRealtimeToolkit()` hook, and `useTool` — plus config presets and types.

### Exports

| Import | What it is |
| --- | --- |
| `OpenAIRealtimeToolkitProvider` | Provider and entry point. Props: `{ appId, appSecret, openAIApiKey, instructions?, voice?, speed?, model?, localTurnHandling?: { enabled?, config? } }`. |
| `useOpenAIRealtimeToolkit()` | The main hook — everything you drive the assistant with ([below](#the-useopenairealtimetoolkit-hook)). |
| `useTool(tool)` | Register a tool for the model to call, scoped to the component. See [Tool calling](#tool-calling). |
| `OpenAIRealtimeToolkitTool` | Tool shape: `{ name, description, parameters?, handler }`. `parameters` (JSON Schema) is optional — omit for a no-arg tool. |
| `QUIET_CONFIG` / `BALANCED_CONFIG` / `NOISY_CONFIG` / `DEFAULT_CONFIG` | Turn-config presets (full `LocalTurnConfig` sets) for `setConfig(...)`. `DEFAULT_CONFIG` is the base for a from-scratch replace. |
| `VOICES` / `SPEED_RANGE` | Every selectable voice, and the `{ min, max, default }` the node accepts for `speed` — for building a picker / slider. |
| Types | `LocalTurnConfig`, `OpenAIVoice`, `OpenAIRealtimeToolkitProviderProps`, `OpenAIRealtimeToolkitContextValue`, `LocalTurnHandling`, `OpenAIRealtimeToolkitConnectionStatus`. |

### The `useOpenAIRealtimeToolkit()` hook

```ts
const {
  isRunning, error, connectionStatus,        // engine + session status
  inputTranscription, outputTranscription,   // live You / Assistant transcripts
  hasMicrophonePermission, requestMicrophonePermission,
  start, stop, release,                       // engine lifecycle
  instructions, setInstructions,              // system prompt (applies live)
  voice, setVoice,                            // AI voice (a change restarts the session)
  speed, setSpeed,                            // speech speed 0.5–1.5 (applies live)
  model,                                      // Realtime model id (read-only; set via the provider prop)
  localTurnHandling,                          // on-device turn detection + barge-in
  registerTool, unregisterTool,               // dynamic tool sets
} = useOpenAIRealtimeToolkit();
```

- **`stop()`** pauses but keeps the engine warm for a fast restart; **`release()`** frees native resources (the next `start()` rebuilds).
- **`setVoice` / `setSpeed`** — see [Voice, speed, and model](#voice-speed-and-model); `setVoice` drops the session context, `setSpeed` is free. `model` has no setter — it's fixed at provider mount.
- **`localTurnHandling`** → `{ enabled, setEnabled, config, setConfig }`. Read a knob as `config.x`; write with `setConfig({ x })` (partial = tweak, full set = select a preset). Applies only while `enabled` — see [Runtime settings](#runtime-settings).
- **`registerTool(tool)` / `unregisterTool(name)`** — imperative escape hatch for dynamic tool sets (add replaces a same-named tool). Prefer `useTool`.

## Running the example

[`example/`](example) is a complete RN 0.86 app that consumes the library and
demonstrates an OpenAI Realtime voice assistant with on-device turn detection,
noise presets, and a tool call.

> [!TIP]
> The example ships with built-in Switchboard demo credentials, so you can run it
> without creating a Switchboard account — you only need to add your own OpenAI API key.

See **[example/README.md](example/README.md)** for setup and run instructions
(credentials, install, iOS device signing, Android).

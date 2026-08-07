# openai-realtime-toolkit

On-device audio AI for React Native, powered by the [Switchboard SDK](https://switchboard.audio).
openai-realtime-toolkit makes OpenAI Realtime voice models easy to use along with tool calling and customizable local turn-detection and barge-in handling.

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

openai-realtime-toolkit is a bare React Native **C++ TurboModule** and requires the **[New Architecture](https://reactnative.dev/architecture/landing-page)**. It works in both Expo (prebuild) and bare React Native apps.

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

openai-realtime-toolkit's C++ TurboModule is compiled in your app's native build, so your
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

openai-realtime-toolkit works in an Expo app, but because it ships native code (a C++
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

openai-realtime-toolkit bundles its own iOS [privacy manifest](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api),
so the one Apple-flagged API it uses (`FileTimestamp`, from loading model files) is
already declared for you — nothing to do.

At the **app** level you still handle:

- **`NSMicrophoneUsageDescription`** in `Info.plist` (see [iOS install](#ios)) — the mic
  prompt string. (The microphone isn't a privacy-manifest API; this string is all it needs.)
- **App Store privacy labels** — audio is streamed to the **OpenAI Realtime API**, so
  disclose that (e.g. "Audio Data"). openai-realtime-toolkit itself stores nothing.

## Credentials

The provider takes a **Switchboard** `appId` / `appSecret` pair (required) and your
**OpenAI** API key (optional — see below).

- **Switchboard** — sign up at [console.switchboard.audio](https://console.switchboard.audio/register)
  (free) and create an app to get its `APP_ID` and `APP_SECRET`.
- **OpenAI** — a Realtime-capable key from
  [platform.openai.com](https://platform.openai.com/api-keys). Omit `openAIApiKey` and the
  session runs on a shared **test key** instead.

> [!TIP]
> The [example app](example) ships with working Switchboard demo credentials and needs no
> OpenAI key, so you can clone it and talk to the assistant with nothing to configure.

> [!WARNING]
> **The test key is for evaluation only.** It's shared, rate-limited, and **rotated without
> notice** — an app relying on it stops working the moment it turns over, and you get no
> quota, billing, or usage control over it. Pass your own `openAIApiKey` for anything you
> ship. The toolkit `console.warn`s at init when no key is set.

> [!NOTE]
> Your Switchboard `APP_ID` and `APP_SECRET` are **safe to bundle in your application**. They
> function like a publishing key and are intended to be distributed with your app. Your
> **OpenAI key is not** — keep it out of source (e.g. `react-native-dotenv`), and for a
> shipped app mint an ephemeral key server-side rather than embedding a standing one.

## Usage

Wrap your app in `OpenAIRealtimeToolkitProvider` with your credentials, then drive it from
any component with the `useOpenAIRealtimeToolkit()` hook. `start()` requests the mic and
builds the voice graph — microphone → OpenAI.Realtime → speaker, with optional on-device
turn detection and barge-in, and hardware echo cancellation (VPIO):

```tsx
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
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
  const { isRunning, connectionStatus, error, start, stop } = useOpenAIRealtimeToolkit();

  // A tool the model can call; its return value is sent back automatically.
  useTool({
    name: 'get_time',
    description: 'Get the current time.',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ time: new Date().toLocaleTimeString() }),
  });

  return (
    <View style={{ flex: 1, padding: 24, gap: 16 }}>
      <TouchableOpacity onPress={isRunning ? stop : start}>
        <Text>{isRunning ? 'Stop' : 'Start talking'}</Text>
      </TouchableOpacity>
      <Text>Connection: {connectionStatus}</Text>
      {!!error && <Text>Error: {error.message}</Text>}
    </View>
  );
}
```

That's the whole app — `start()` handles mic permission and connects, and the model can
call the `get_time` tool (try asking it the time). Drop the `openAIApiKey` line and it
still runs, on the shared test key ([above](#credentials)) — put your own key back before
you ship. Render `error.message`, as above: a rejected API key or a denied mic shows up
there ([details](#the-useopenairealtimetoolkit-hook)).
Layout is yours — the snippet's `View` keeps it minimal. Turn-detection tuning and styling
are opt-in; see below and [`example/App.tsx`](example/App.tsx) for the fuller version.

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

New to turn detection? Start at [How turn detection works](#how-turn-detection-works) —
it explains the pipeline before the knobs.

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

#### How turn detection works

Out of the box, OpenAI decides when you've stopped talking (its own `server_vad`).
Turning `localTurnHandling` on moves that decision **on-device**, where you can tune it:

```tsx
localTurnHandling.setEnabled(true);   // or <OpenAIRealtimeToolkitProvider localTurnHandling={{ enabled: true }} … />
```

It runs in two stages:

1. **Voice detection** — the *ear*. It only answers "is someone speaking right now?"
   Sound louder than `vadThreshold` counts as speech; once it hears `vadSilenceMs` of
   quiet it reports "speech ended."
2. **Semantic analysis** — the *listener*. When stage 1 says you went quiet, this stage
   looks at *what* you said and scores (0–1) how likely it is a **complete thought**
   rather than a mid-sentence pause ("so I was thinking, uh…"). That score is what the
   `*semantic*` knobs below govern.

The toolkit then decides your turn is over: it holds `pauseToleranceMs` longer (start
talking again inside that window and the turn simply continues), checks you spoke for at
least `minInputLengthMs`, and combines that with the semantic score per
`semanticStrategy`. If it agrees, your audio is **committed** to OpenAI and the reply
starts. If it doesn't, nothing is sent — `semanticFailTimeoutMs` is the safety net that
commits anyway when you stay quiet.

Separately, the instant stage 1 hears you start, **barge-in** runs on the AI's in-flight
reply: duck its volume to `duckGain` immediately, `pauseOutput` after `pauseTimeMs`, and
cancel the response after `cancelTimeMs` (off by default).

So, in short: the **`vad*` knobs** decide what counts as speech, the **`*semantic*` knobs**
decide whether a sentence sounds finished, and the **barge-in knobs** decide what happens
to the AI while you talk over it.

#### Start with a preset

Most apps never need to touch a knob — pick the preset that matches the room:

| Preset | Use it for | How it differs |
| --- | --- | --- |
| `QUIET_CONFIG` | Quiet room, phone at your face | Lower `vadThreshold` (`0.4`), short `minInputLengthMs` (`300`), semantic thresholds at `0` (semantic analysis always passes), fast + strong duck → snappiest replies |
| `BALANCED_CONFIG` | The default; every knob at its default | — |
| `NOISY_CONFIG` | Café, background chatter, speakerphone | Higher `vadThreshold` (`0.6`), `minInputLengthMs` `1000`, real semantic confidence required (`0.5`), slower/softer duck → far fewer turns triggered by noise |

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

#### Which knob do I reach for?

Match the symptom, then reach for the knob table below for exact ranges.

| It feels like… | Try |
| --- | --- |
| "It cuts me off mid-sentence" | Raise `pauseToleranceMs` (e.g. `1500`) so a thinking pause isn't the end of your turn, and/or `vadSilenceMs`. Raise `minSemanticConfidence` so semantic analysis has to be surer you're done. |
| "It's slow to reply after I stop" | Lower `vadSilenceMs` (e.g. `300`) and `pauseToleranceMs`. Lower the semantic confidences, or `semanticStrategy: 'off'` to skip the semantic stage entirely. |
| "Background noise / people in the next room trigger it" | `setConfig(NOISY_CONFIG)`. Raise `vadThreshold` (`0.6`–`0.7`) so quiet, distant speech doesn't register, and `minInputLengthMs` so short bursts don't count. |
| "Short answers ('yes', 'stop') get ignored" | Lower `minInputLengthMs`, or use `semanticStrategy: 'rescue'` so a confident semantic score commits an otherwise-too-short utterance. |
| "It went quiet — my turn never got answered" | Set `semanticFailTimeoutMs` (e.g. `4000`) so a semantically-rejected turn still commits after that much silence. |
| "The AI keeps talking over me" | Lower `pauseTimeMs`, lower `duckGain` (`0` mutes it), set a finite `cancelTimeMs` to drop the response outright. |
| "The AI's answer restarts/repeats after I interrupt" | `commitBehavior: 'finish'` keeps the in-flight response instead of cancelling it. |

#### Config knobs

The advanced reference — each field of `config`. Hover any knob in your editor for the same
docs; `KNOB_SPECS` carries `min`/`max`/`options` at runtime for building sliders.

**Turn detection** — when is the user's turn over?

Disable-able duration knobs use `Infinity` to mean "off" (`semanticFailTimeoutMs`,
`pauseTimeMs`, `cancelTimeMs`) — e.g. `setConfig({ cancelTimeMs: Infinity })`.

| Knob | What it does | Default | Range |
| --- | --- | --- | --- |
| `vadThreshold` | How loud speech has to be before it counts as talking. Raise it in a noisy room so background sound isn't heard as speech. | `0.5` | `0.0`–`1.0` |
| `vadSilenceMs` | How long you have to go quiet before voice detection calls your speech over. Lower = snappier, more likely to clip a pause. | `500` | `100`–`6000` |
| `minInputLengthMs` | Minimum time you must speak for it to count as a turn at all — filters out coughs and short noise bursts. | `600` | `200`–`6000` |
| `pauseToleranceMs` | Extra silence held *after* voice detection's own hold before ending the turn. Your grace period for thinking mid-sentence. | `0` | `0`–`6000` |
| `semanticStrategy` | Whether the "did that sound finished?" check is required, optional, or ignored (see below). | `'gate'` | `off` \| `rescue` \| `gate` |
| `minSemanticConfidence` | Score required for **short** utterances (under `thresholdBreakpointMs`) — short speech gives the check less to go on, so this is usually lower. | `0.01` | `0`–`0.9` |
| `maxSemanticConfidence` | Score required for **long** utterances. Raise both to be cut off less; lower both to reply sooner. | `0.5` | `0`–`0.9` |
| `thresholdBreakpointMs` | Where "short" ends and "long" begins, i.e. which of the two confidences applies. | `2000` | `1000`–`6000` |
| `semanticFailTimeoutMs` | Safety net: if semantic analysis rejected a real-length turn and you stay quiet this long, commit anyway so the assistant still answers. | `Infinity` (off) | `3000`–`6000` |

`semanticStrategy` is how the length check and the semantic score are combined:

| Value | Meaning |
| --- | --- |
| `'off'` | Semantic analysis is skipped; long enough (`minInputLengthMs`) is all it takes. Fastest, most likely to cut you off. |
| `'rescue'` | Long enough **or** sounds finished — a high score rescues an utterance that was too short. |
| `'gate'` (default) | Long enough **and** sounds finished — a low score vetoes a mid-sentence pause. |

**Barge-in** — how the in-flight AI response is interrupted.

| Knob | What it does | Default | Range |
| --- | --- | --- | --- |
| `pauseTimeMs` | How long you have to be talking before the AI stops speaking. Lower it if it talks over you. | `800` | `400`–`6000` |
| `cancelTimeMs` | How long before the AI's current answer is thrown away rather than just paused. Off by default, so it resumes. | `Infinity` (off) | `2000`–`16000` |
| `duckGain` | How far the AI's volume drops the moment you start talking (`0` = silent, `1` = unchanged). | `0.3` | `0`–`1` |
| `duckTimeMs` | How quickly that volume drop fades in and out — too fast can click, too slow feels laggy. | `100` | `0`–`1000` |
| `commitBehavior` | When your turn commits: `cancel` drops the AI's unfinished answer, `finish` lets it play out. | `'cancel'` | `cancel` \| `finish` |

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

A handler that throws is reported to the model as a tool error, so the conversation
continues — the model answers without the result rather than stalling. Nothing about a
tool call reaches `error`: the model is the one that has to recover, and there'd be
nothing to clear it afterwards. To watch them anyway, pass `onError` to the provider and
filter on `code` — `TOOL_HANDLER_FAILED` for a handler that threw,
`TOOL_RESULT_UNDELIVERED` when the result couldn't reach OpenAI at all (dead session,
stale call id), `RESPONSE_FAILED` when the model couldn't be resumed. See
[Errors](#errors).

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
| `OpenAIRealtimeToolkitProvider` | Provider and entry point. Props: `{ appId, appSecret, openAIApiKey?, instructions?, voice?, speed?, model?, localTurnHandling?: { enabled?, config? } }`. Omitting `openAIApiKey` falls back to the shared test key — see [Credentials](#credentials). |
| `useOpenAIRealtimeToolkit()` | The main hook — everything you drive the assistant with ([below](#the-useopenairealtimetoolkit-hook)). |
| `useTool(tool)` | Register a tool for the model to call, scoped to the component. See [Tool calling](#tool-calling). |
| `OpenAIRealtimeToolkitTool` | Tool shape: `{ name, description, parameters?, handler }`. `parameters` (JSON Schema) is optional — omit for a no-arg tool. |
| `QUIET_CONFIG` / `BALANCED_CONFIG` / `NOISY_CONFIG` / `DEFAULT_CONFIG` | Turn-config presets (full `LocalTurnConfig` sets) for `setConfig(...)`. `DEFAULT_CONFIG` is the base for a from-scratch replace. |
| `VOICES` / `SPEED_RANGE` | Every selectable voice, and the `{ min, max, default }` the node accepts for `speed` — for building a picker / slider. |
| `OpenAIRealtimeError` | Every failure the toolkit reports — an `Error` with a machine-readable `code`. See [Errors](#errors). |
| Types | `LocalTurnConfig`, `OpenAIVoice`, `OpenAIRealtimeErrorCode`, `OpenAIRealtimeToolkitProviderProps`, `OpenAIRealtimeToolkitContextValue`, `LocalTurnHandling`, `OpenAIRealtimeToolkitConnectionStatus`. |

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

- **`error` / `connectionStatus`** — see [Errors](#errors) below.
- **A refused `stop()` leaves `isRunning` true**, with the reason in `error` — the graph is
  still live and the mic still hot, so the state stays truthful rather than showing a
  stopped engine. `release()` always tears down regardless, so it remains the way out.
- **`stop()`** pauses but keeps the engine warm for a fast restart; **`release()`** frees native resources (the next `start()` rebuilds).
- **`setVoice` / `setSpeed`** — see [Voice, speed, and model](#voice-speed-and-model); `setVoice` drops the session context, `setSpeed` is free. `model` has no setter — it's fixed at provider mount.
- **`localTurnHandling`** → `{ enabled, setEnabled, config, setConfig }`. Read a knob as `config.x`; write with `setConfig({ x })` (partial = tweak, full set = select a preset). Applies only while `enabled` — see [Runtime settings](#runtime-settings).
- **`registerTool(tool)` / `unregisterTool(name)`** — imperative escape hatch for dynamic tool sets (add replaces a same-named tool). Prefer `useTool`.

## Errors

Every failure is an `OpenAIRealtimeError`: a real `Error` (so `instanceof` and `.message`
work) carrying a machine-readable `code`, a `fatal` flag, and sometimes `details`.

Failures are split by **how long they last**, not by where they came from:

- **`error`** — the outstanding failure the app has to act on, or null. A refused SDK init,
  a denied mic, a refused engine start or stop, a session that won't come up. Durable:
  it stays until something can clear it, which is `start()`, `stop()`, `release()`, or a
  session coming up.
- **`onError`** (provider prop) — called for **every** failure, including the ones that
  never reach `error` because the session absorbed them and carried on: a tool handler
  throwing, an undeliverable tool result, a session error during a live session. These
  are moments, not conditions — nothing would ever clear them, so they aren't state.
  Route them to your logger. With no `onError` prop they're `console.warn`ed instead,
  so they don't vanish silently.

```tsx
<OpenAIRealtimeToolkitProvider {...creds} onError={(e) => Sentry.captureException(e)}>
```

```tsx
const { error, connectionStatus } = useOpenAIRealtimeToolkit();

if (error?.code === 'MIC_PERMISSION_DENIED') return <OpenSettingsPrompt />;
if (error) return <Text>{error.message}</Text>;
```

| `code` | Meaning | `fatal` |
| --- | --- | --- |
| `INIT_FAILED` | The Switchboard SDK refused to initialize (rejected credentials, extension load failure). | yes |
| `NOT_INITIALIZED` | An action needed the SDK, which never came up. | yes |
| `MIC_PERMISSION_DENIED` | The user denied microphone access. | yes |
| `ENGINE_CREATION_FAILED` | The audio graph couldn't be built. | yes |
| `ENGINE_START_FAILED` | The engine refused to start (audio session unavailable, mic held by another app). | yes |
| `ENGINE_STOP_FAILED` | The engine refused to stop — still running, mic still hot. | yes |
| `SESSION_FAILED` | OpenAI reported a session failure (bad key, quota, unknown model, bad tool schema). | only when no session is up |
| `TOOL_HANDLER_FAILED` | A tool handler threw. Already reported to the model. | no |
| `TOOL_RESULT_UNDELIVERED` | A tool result never reached OpenAI (dead session, stale call id). | no |
| `RESPONSE_FAILED` | The model couldn't be resumed after a tool call. | no |

`connectionStatus` (`'none' | 'connecting' | 'connected' | 'error'`) tracks the OpenAI
session and nothing else. It reads `'error'` only when the session itself was attempted
and refused — and stays there, so the node's reconnect attempts can't make a rejected key
look like a slow connect; only a session coming up clears it. A `SESSION_FAILED` that
arrives *during* a live session is non-fatal and leaves it `'connected'`, because the
conversation still works. Failures that aren't the session's own (a denied mic, a refused
engine start) leave it `'none'` and report through `error` alone — so render `error`
first, then fall back to `connectionStatus` for the connection chrome.

Blank Switchboard credentials are the one exception to all of this: that's a caller mistake, not a
runtime failure, so the provider throws on mount.

## Running the example

[`example/`](example) is a complete RN 0.86 app that consumes the library and
demonstrates an OpenAI Realtime voice assistant with on-device turn detection,
noise presets, and a tool call.

> [!TIP]
> The example ships with built-in Switchboard demo credentials and runs on the shared
> OpenAI test key, so there's nothing to configure — no Switchboard account and no OpenAI
> key needed. See [Credentials](#credentials) for why that key isn't for production, and
> [`example/README.md`](example/README.md#1-credentials) for wiring in your own.

**Install the repo root first.** The example consumes the library via `file:..`, and the
package's `main`/`types` resolve to the built `dist/`, which the root's `npm install`
produces via `prepare`:

```sh
npm run example:install    # from the repo root: installs + builds here, then installs example/
```

Or by hand:

```sh
npm install                # repo root — installs deps and builds dist/
cd example && npm install
```

See **[example/README.md](example/README.md)** for setup and run instructions
(credentials, install, iOS device signing, Android).

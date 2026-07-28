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

| Requirement      | Minimum            |
| ---------------- | ------------------ |
| React Native     | 0.76+              |
| New Architecture | Required (enabled) |
| iOS              | 13.4+              |
| Node.js          | 22+                |

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
app needs to (a) know the Switchboard Maven repo and (b) enable Prefab.

Add the repo to your app's root **`android/build.gradle`** (public, no
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

Enable Prefab in your app's **`android/app/build.gradle`**:

```groovy
android {
    buildFeatures {
        prefab true
    }
}
```

Then build:

```sh
npx react-native run-android
```

> **Expo apps** don't do this by hand — the [config plugin](#expo) declares both
> for you during `prebuild`.

### Expo

OpenAIRealtimeToolkit works in an Expo app, but because it ships native code (a C++
TurboModule + the Switchboard frameworks) it can **not** run in Expo Go — you
need a [development build](https://docs.expo.dev/develop/development-builds/introduction/).

- **New architecture is required** — on by default in Expo SDK ≥ 52.
- **SDK version** — needs React Native ≥ 0.76 (Expo SDK ≥ 52). Developed and
  tested against RN 0.86, i.e. **Expo SDK 57**: an exact RN match, so there's no
  TurboModule codegen mismatch. Older SDKs down to 52 should also work.

```sh
npx expo install @synervoz/openai-realtime-toolkit
npx expo prebuild -p ios     # generates ios/ and runs pod install (fetches the frameworks)
npx expo run:ios             # build and launch the dev build
```

Add the config plugin to **`app.json`**. It declares the Switchboard Maven repo
and enables Prefab in your app's own Android build files — the one bit of wiring
Expo can't do on its own, and which the bare-RN autolinking path can't land early
enough under prebuild. The microphone string and permissions are handled by
built-ins (below), so the plugin takes no options:

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

## Privacy (App Store)

OpenAIRealtimeToolkit bundles its own iOS [privacy manifest](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api),
so the one Apple-flagged API it uses (`FileTimestamp`, from loading model files) is
already declared for you — nothing to do.

At the **app** level you still handle:

- **`NSMicrophoneUsageDescription`** in `Info.plist` (see [iOS install](#ios)) — the mic
  prompt string. (The microphone isn't a privacy-manifest API; this string is all it needs.)
- **App Store privacy labels** — audio is streamed to the **OpenAI Realtime API** with
  your key, so disclose that (e.g. "Audio Data"). OpenAIRealtimeToolkit itself stores nothing.

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

> [!NOTE]
> Your Switchboard `APP_ID` and `APP_SECRET` are **safe to bundle in your application**. They function like a publishing key and are intended to be distributed with your app.

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

`instructions` and turn handling both come off the `useOpenAIRealtimeToolkit()` hook and can
also be seeded as **props** on the provider. Changes through the hook apply live, without
dropping the OpenAI session.

```tsx
const { instructions, setInstructions, localTurnHandling } = useOpenAIRealtimeToolkit();

localTurnHandling.enabled;            // on-device turn detection vs OpenAI's server_vad
localTurnHandling.setEnabled(true);
```

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
| `OpenAIRealtimeToolkitProvider` | Provider and entry point. Props: `{ appId, appSecret, openAIApiKey, instructions?, localTurnHandling?: { enabled?, config? } }`. |
| `useOpenAIRealtimeToolkit()` | The main hook — everything you drive the assistant with ([below](#the-useopenairealtimetoolkit-hook)). |
| `useTool(tool)` | Register a tool for the model to call, scoped to the component. See [Tool calling](#tool-calling). |
| `OpenAIRealtimeToolkitTool` | Tool shape: `{ name, description, parameters?, handler }`. `parameters` (JSON Schema) is optional — omit for a no-arg tool. |
| `QUIET_CONFIG` / `BALANCED_CONFIG` / `NOISY_CONFIG` / `DEFAULT_CONFIG` | Turn-config presets (full `LocalTurnConfig` sets) for `setConfig(...)`. `DEFAULT_CONFIG` is the base for a from-scratch replace. |
| Types | `LocalTurnConfig`, `OpenAIRealtimeToolkitProviderProps`, `OpenAIRealtimeToolkitContextValue`, `LocalTurnHandling`, `OpenAIRealtimeToolkitConnectionStatus`. |

### The `useOpenAIRealtimeToolkit()` hook

```ts
const {
  isRunning, error, connectionStatus,        // engine + session status
  inputTranscription, outputTranscription,   // live You / Assistant transcripts
  hasMicrophonePermission, requestMicrophonePermission,
  start, stop, release,                       // engine lifecycle
  instructions, setInstructions,              // system prompt (applies live)
  localTurnHandling,                          // on-device turn detection + barge-in
  registerTool, unregisterTool,               // dynamic tool sets
} = useOpenAIRealtimeToolkit();
```

- **`stop()`** pauses but keeps the engine warm for a fast restart; **`release()`** frees native resources (the next `start()` rebuilds).
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

# OpenAIRealtimeToolkit

On-device audio AI for React Native, powered by the [Switchboard SDK](https://switchboard.audio).
OpenAIRealtimeToolkit uses the Switchboard **SileroVAD**, **SmartTurn**, **Onnx**, and **OpenAI** extensions and
drives them from JavaScript over a JSON-RPC channel into a shared C++ TurboModule.

- **iOS + Android**, new architecture (TurboModules), one shared C++ core.
- Switchboard binaries are fetched from Switchboard's hosting at build time — nothing to host yourself, no large binaries in git or the npm tarball.

## Install

Run these in **your React Native app** (not in this library repo):

```sh
npm install @synervoz/openai-realtime-toolkit
```

Requires React Native **≥ 0.76** (new architecture). Developed with RN 0.86.

> Trying it out inside this repo? The library itself has no app to build — use
> the bundled example app instead: see [Running the example](#running-the-example).

### iOS

From **your app's** `ios/` directory:

```sh
cd ios && pod install
```

The podspec's `prepare_command` downloads the Switchboard xcframeworks
(SwitchboardSDK / SileroVAD / SmartTurn / Onnx) into the pod's `ios/Frameworks/`
and vendors them. No extra steps.

Add a microphone usage string to your app's `Info.plist` (required — without it the
app crashes when the mic is requested):

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Used for the voice assistant.</string>
```

### Android

```sh
npx react-native run-android
```

No setup needed — OpenAIRealtimeToolkit pulls the Switchboard SDK + extensions from Maven and
wires up the repo and Prefab in your app automatically.

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

Declare the microphone string in **`app.json`** rather than editing `Info.plist`
by hand:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSMicrophoneUsageDescription": "Used for the voice assistant."
      }
    }
  }
}
```

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

`instructions` and on-device turn handling come off the single `useOpenAIRealtimeToolkit()` hook.
The turn-handling controls are grouped under `localTurnHandling` — the same name as the
provider prop — so the on/off switch and its tuning live together. Any can be set as
**initial props** on the provider (above) **or** changed live from the hook — changes
apply without dropping the OpenAI session:

```tsx
const { instructions, setInstructions, localTurnHandling } = useOpenAIRealtimeToolkit();

localTurnHandling.enabled;            // on-device turn detection vs OpenAI's server_vad
localTurnHandling.setEnabled(true);
```

The `config` under `localTurnHandling` is the tuning, and applies only while `enabled` is
true. A **preset is just a full knob set** — imported as a value. Read a knob as a plain
value; write one or several with a patch (partial = tweak, full set = select a preset):

```tsx
import { QUIET_CONFIG, NOISY_CONFIG } from '@synervoz/openai-realtime-toolkit';

const { config, setConfig } = localTurnHandling;

config.pauseToleranceMs;                        // → number (hover shows the doc)
setConfig({ pauseToleranceMs: 3000 });          // tweak one knob (keeps the rest)
setConfig(NOISY_CONFIG);                         // "select" a preset (overwrites all knobs)
setConfig({ ...QUIET_CONFIG, pauseToleranceMs: 3000 });  // a preset with a tweak
```

Seed the initial state declaratively via the `localTurnHandling` prop:
`localTurnHandling={{ enabled: true, config: QUIET_CONFIG }}`. A partial `config` patch
merges over the current values; use `DEFAULT_CONFIG` as a base to reset from scratch:
`setConfig({ ...DEFAULT_CONFIG, ...tweaks })`.

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

| Export | Description |
| --- | --- |
| `OpenAIRealtimeToolkitProvider` | React provider. Props: `{ appId, appSecret, openAIApiKey, instructions?, localTurnHandling?: { enabled?, config? } }`. The default entry point. |
| `useOpenAIRealtimeToolkit()` | Hook → `{ isRunning, error, connectionStatus, inputTranscription, outputTranscription, start, stop, release, hasMicrophonePermission, requestMicrophonePermission, instructions, setInstructions, localTurnHandling, registerTool, unregisterTool }`. `stop()` pauses (engine kept for a fast restart); `release()` frees it. |
| `localTurnHandling` (on the hook) | `{ enabled, setEnabled, config, setConfig }` — on-device turn detection + barge-in. Read a knob as `config.x`; write with `setConfig({ x })` (partial = tweak, full set = select a preset). Config applies only while `enabled`. |
| `useTool(tool)` | Register a tool for the model to call, scoped to the component: registers on mount, unregisters on unmount, re-registers on `name`/`description`/`parameters` change, and keeps the `handler` live (no stale closures). The usual way to add a tool. |
| `registerTool(tool)` / `unregisterTool(name)` (on the hook) | Imperative escape hatch for dynamic tool sets — add (replacing any same-named tool) or remove by name. Prefer `useTool` unless the set is dynamic. |
| `OpenAIRealtimeToolkitTool` | `{ name, description, parameters?, handler }` — a tool the model can call. `parameters` (JSON Schema) is optional; omit for a no-arg tool. |
| `QUIET_CONFIG` / `BALANCED_CONFIG` / `NOISY_CONFIG` | Curated presets as full `LocalTurnConfig` value sets — pass to `setConfig(...)` or the `localTurnHandling.config` seed. |
| `DEFAULT_CONFIG` | Every knob at its default — the base for a from-scratch replace. |
| `LocalTurnConfig` / `KNOB_SPECS` | Turn-config value shape (read type) + static per-knob metadata (label / min / max / options) for building a tuning UI. |
| `OpenAIRealtimeToolkitProviderProps` / `OpenAIRealtimeToolkitContextValue` / `LocalTurnHandling` / `OpenAIRealtimeToolkitConnectionStatus` | Provider-prop, hook-value, turn-handling, and connection-status types. |
| `getDocumentsPath()` | Absolute path to the app's documents directory (for recordings/logs). |

## Architecture

```
JS:   SwitchboardClient ──▶ NativeModuleRPCClient ──▶ (JSON-RPC 2.0 string)
                                                          │
native (cpp/NativeOpenAIRealtimeToolkit.cpp):  processCommand ──▶ switchboard::SwitchboardJSONRPC
                                   constructor loads SileroVAD / Onnx / OpenAI / SmartTurn(iOS)
                                   SDK events ──▶ emitOnEventReceived ──▶ JS callback
```

- **JS layer** (`src/`): the spec + JSON-RPC client classes.
- **Shared C++** (`cpp/`): the entire engine — wraps `SwitchboardJSONRPC`, loads extensions, emits events. Identical for both platforms.
- **iOS** (`ios/`): `OpenAIRealtimeToolkitModuleProvider` constructs the C++ module (registered via `codegenConfig.ios.modulesProvider`); `scripts/download-ios-frameworks.sh` fetches the binaries.
- **Android** (`android/`): `CMakeLists.txt` builds the cpp and links Switchboard via Prefab; registered through RN C++ autolinking (`react-native.config.js`).

## Running the example

[`example/`](example) is a complete RN 0.86 app that consumes the library and
demonstrates an OpenAI Realtime voice assistant with on-device turn detection,
noise presets, and a tool call.

```sh
cd example
npm install                      # symlinks the library via file:..
# iOS (CocoaPods pinned via example/Gemfile)
bundle install                   # one-time: installs the pinned `pod` tool
cd ios && bundle exec pod install && cd ..
npm run ios
# Android (no extra config)
npm run android
```

Add your Switchboard + OpenAI credentials in [`example/App.tsx`](example/App.tsx)
first. See [example/README.md](example/README.md) for details.

## Development

```sh
npm run build       # tsc → dist/ (JS + .d.ts); also runs on publish via prepare
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm run format      # Prettier
```

`main`/`types` resolve to the built `dist/`; `react-native`/`source` resolve to
`src/` so Metro uses the TypeScript directly (no prebuild needed in dev). 

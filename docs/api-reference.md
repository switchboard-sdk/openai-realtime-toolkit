# API reference

The public surface is the provider, the `useOpenAIRealtimeToolkit()` hook, and `useTool`, plus the config presets and types. For install see [Getting started](getting-started.md), for turn tuning see [Turn detection](turn-detection.md), and for `useTool` see [Tools](tools.md).

## Exports

| Import | What it is |
| --- | --- |
| `OpenAIRealtimeToolkitProvider` | Provider and entry point. Props: `{ appId?, appSecret?, openAIApiKey?, instructions?, voice?, speed?, model?, localTurnHandling?: { enabled?, config? }, onError? }`. The credentials are optional, see [Credentials](getting-started.md#credentials). |
| `useOpenAIRealtimeToolkit()` | The main hook, everything you drive the agent with ([below](#the-useopenairealtimetoolkit-hook)). |
| `useTool(tool)` | Register a tool for the model to call, scoped to the component. See [Tools](tools.md). |
| `OpenAIRealtimeToolkitTool` | Tool shape: `{ name, description, parameters?, handler }`. `parameters` (JSON Schema) is optional, so omit it for a no-arg tool. |
| `QUIET_CONFIG`, `BALANCED_CONFIG`, `NOISY_CONFIG`, `DEFAULT_CONFIG` | Turn-config presets (full `LocalTurnConfig` sets) for `setConfig(...)`. `DEFAULT_CONFIG` is the base for a from-scratch replace, and holds the same values as `BALANCED_CONFIG`. See [Turn detection](turn-detection.md#pick-a-preset-for-the-room). |
| `KNOB_SPECS` | The `min`, `max` and `options` for every turn-config knob, at runtime, for building sliders. |
| `VOICES`, `SPEED_RANGE` | Every selectable voice, and the `{ min, max, default }` the node accepts for `speed`, for building a picker or slider. |
| `OpenAIRealtimeError` | Every failure the toolkit reports, an `Error` with a machine-readable `code`. See [Errors](#errors). |
| Types | `LocalTurnConfig`, `OpenAIVoice`, `OpenAIRealtimeErrorCode`, `OpenAIRealtimeToolkitProviderProps`, `OpenAIRealtimeToolkitContextValue`, `LocalTurnHandling`, `OpenAIRealtimeToolkitConnectionStatus`. |

## Provider: lifecycle and placement

Mount `OpenAIRealtimeToolkitProvider` **once, at your app root**, above your navigator. It is not unmounted by navigation or by the app going to the background, so the agent keeps running across screens and the exposed state stays consistent. Call `useOpenAIRealtimeToolkit()` from any screen.

```tsx
<OpenAIRealtimeToolkitProvider
  openAIApiKey="YOUR_OPENAI_API_KEY"        // optional, falls back to a shared test key
  instructions="You are a terse, friendly voice assistant.">
  <App />
</OpenAIRealtimeToolkitProvider>
```

- `start()` requests the mic and builds the voice graph, wiring the microphone to OpenAI Realtime to the speaker, with optional on-device turn detection and barge-in, and hardware echo cancellation (VPIO).
- `stop()` pauses the engine but keeps it warm, so a later `start()` resumes fast.
- `release()` frees the engine's native resources (audio session, models), and the next `start()` rebuilds it.
- The provider does **not** stop or release on unmount. The engine's lifecycle is yours to drive explicitly.
- **Background operation** (mic while the app is backgrounded) needs native setup: the iOS `audio` background mode in `Info.plist`, and an Android microphone foreground service. Without it the OS suspends audio when you leave the app.

## Runtime settings

`instructions`, the voice settings, and turn handling all come off the `useOpenAIRealtimeToolkit()` hook, and can also be seeded as **props** on the provider. Changes through the hook apply live, without dropping the OpenAI session. The two exceptions are called out below.

```tsx
const { instructions, setInstructions, localTurnHandling } = useOpenAIRealtimeToolkit()

setInstructions('You are a curt, efficient assistant.')   // applies live
localTurnHandling.setEnabled(true)                          // on-device turn detection vs OpenAI's server_vad
```

`localTurnHandling` carries the on-device turn detection and barge-in. See [Turn detection](turn-detection.md) for `config` and the presets.

### Voice, speed, and model

Seed them on the provider, or read and set them on the hook:

```tsx
<OpenAIRealtimeToolkitProvider voice="marin" speed={1.1} … />
```

```tsx
const { voice, setVoice, speed, setSpeed, model } = useOpenAIRealtimeToolkit()
```

| Setting | Values | Default | Changing it at runtime |
| --- | --- | --- | --- |
| `voice` | `alloy`, `ash`, `ballad`, `cedar`, `coral`, `echo`, `marin`, `sage`, `shimmer`, `verse` | `'cedar'` | `setVoice('marin')`. OpenAI starts a new session for the new voice, so the conversation so far is dropped. |
| `speed` | `0.5` to `1.5` (out-of-range values are clamped) | `1.0` | `setSpeed(1.25)`. Free, applied to the live session. |
| `model` | any OpenAI Realtime model id, for example `'gpt-realtime-2'` | `'gpt-realtime-2'` | Not supported. The model is baked into the engine when it is built, so switching it would mean tearing the engine down. Pick it on the provider, and the hook exposes it read-only. |

`VOICES` and `SPEED_RANGE` are exported for building a picker or a slider.

## The `useOpenAIRealtimeToolkit()` hook

```ts
const {
  isRunning, error, connectionStatus,        // engine + session status
  inputTranscription, outputTranscription,   // live You / Assistant transcripts
  hasMicrophonePermission, requestMicrophonePermission,
  start, stop, release,                       // engine lifecycle
  instructions, setInstructions,              // system prompt (applies live)
  voice, setVoice,                            // agent voice (a change restarts the session)
  speed, setSpeed,                            // speech speed 0.5 to 1.5 (applies live)
  model,                                      // Realtime model id (read-only; set via the provider prop)
  localTurnHandling,                          // on-device turn detection + barge-in
  registerTool, unregisterTool,               // dynamic tool sets
} = useOpenAIRealtimeToolkit()
```

- **`error` and `connectionStatus`** are covered in [Errors](#errors) below.
- **A refused `stop()` leaves `isRunning` true**, with the reason in `error`. The graph is still live and the mic is still hot, so the state stays truthful rather than showing a stopped engine. `release()` always tears down regardless, so it remains the way out.
- **`stop()` and `release()`** are covered under [Provider: lifecycle and placement](#provider-lifecycle-and-placement).
- **`setVoice` and `setSpeed`** are covered in [Voice, speed, and model](#voice-speed-and-model). `setVoice` drops the session context, and `setSpeed` is free. `model` has no setter, since it is fixed at provider mount.
- **`localTurnHandling`** is `{ enabled, setEnabled, config, setConfig }`. Read a knob as `config.x`, and write with `setConfig({ x })`, where a partial patch tweaks and a full set selects a preset. It applies only while `enabled`, see [Turn detection](turn-detection.md).
- **`registerTool(tool)` and `unregisterTool(name)`** are the imperative escape hatch for dynamic tool sets, where adding replaces a same-named tool. Prefer `useTool`, see [Tools](tools.md).

## Errors

Every failure is an `OpenAIRealtimeError`, a real `Error` (so `instanceof` and `.message` work) carrying a machine-readable `code`, a `fatal` flag, and sometimes `details`.

Failures are split by how long they last, not by where they came from:

- **`error`** (hook state) is the outstanding failure the app has to act on, or null. A refused SDK init, a denied mic, a refused engine start or stop, or a session that will not come up. It is durable, and it stays until something can clear it, which is `start()`, `stop()`, `release()`, or a session coming up.
- **`onError`** (provider prop) is called for **every** failure, including the ones that never reach `error` because the session absorbed them and carried on: a tool handler throwing, an undeliverable tool result, a session error during a live session. These are moments rather than conditions, since nothing would ever clear them, so they are not state. Route them to your logger. With no `onError` prop they are `console.warn`ed instead, so they do not vanish silently.

```tsx
<OpenAIRealtimeToolkitProvider {...creds} onError={(e) => Sentry.captureException(e)}>
```

```tsx
const { error, connectionStatus } = useOpenAIRealtimeToolkit()

if (error?.code === 'MIC_PERMISSION_DENIED') return <OpenSettingsPrompt />
if (error) return <Text>{error.message}</Text>
```

| `code` | Meaning |
| --- | --- |
| `INIT_FAILED` | The audio engine refused to initialize (rejected credentials, extension load failure). |
| `NOT_INITIALIZED` | An action needed the audio engine, which never came up. |
| `MIC_PERMISSION_DENIED` | The user denied microphone access. |
| `ENGINE_CREATION_FAILED` | The audio graph could not be built. |
| `ENGINE_START_FAILED` | The engine refused to start (audio session unavailable, or mic held by another app). |
| `ENGINE_STOP_FAILED` | The engine refused to stop, so it is still running and the mic is still hot. |
| `SESSION_FAILED` | OpenAI reported a session failure (bad key, quota, unknown model, or bad tool schema). |
| `TOOL_HANDLER_FAILED` | A tool handler threw. Already reported to the model. |
| `TOOL_RESULT_UNDELIVERED` | A tool result never reached OpenAI (dead session, or stale call id). |
| `RESPONSE_FAILED` | The model could not be resumed after a tool call. |

`connectionStatus` is one of `'none'`, `'connecting'`, `'connected'`, `'error'`, and it tracks the OpenAI session and nothing else. It reads `'error'` only when the session itself was attempted and refused, and it stays there, so the node's reconnect attempts cannot make a rejected key look like a slow connect. Only a session coming up clears it. A `SESSION_FAILED` that arrives during a live session is non-fatal and leaves the status at `'connected'`, because the conversation still works. Failures that are not the session's own (a denied mic, a refused engine start) leave it at `'none'` and report through `error` alone. So render `error` first, then fall back to `connectionStatus` for the connection chrome.

A blank credential is the one exception to all of this. Passing `appId` or `appSecret` as an empty string is a caller mistake rather than a runtime failure, so the provider throws on mount. Omitting them entirely is fine, since that is the default-credentials path.

## Related

- [Getting started](getting-started.md) has install, platforms, credentials, and privacy.
- [Turn detection](turn-detection.md) has the `localTurnHandling` config and presets in depth.
- [Tools](tools.md) has `useTool` and dynamic tool sets.

import { NativeModules, PermissionsAndroid, Platform } from 'react-native'
import NativeOpenAIRealtimeToolkit from './NativeOpenAIRealtimeToolkit'
import { NativeModuleRPCClient } from './NativeModuleRPCClient'
import { SwitchboardClient } from './SwitchboardClient'
import { createLocalTurnController, type LocalTurnController } from './LocalTurnController'
import { resolveBargeIn, resolveTurnDetection } from './turnDetection'
import { PRESETS, type Preset, type TurnPreset } from './presets'
import { clampSpeed, DEFAULT_MODEL, DEFAULT_VOICE, SPEED_RANGE, type OpenAIVoice } from './voice'

/** Credentials for {@link OpenAIRealtimeToolkit.initialize}. */
export interface OpenAIRealtimeToolkitInitializeOptions {
  /** Switchboard app ID (console.switchboard.audio). */
  appId: string
  /** Switchboard app secret. */
  appSecret: string
  /** OpenAI API key, used by the OpenAI Realtime node. */
  openAIApiKey: string
  /**
   * System prompt for the OpenAI Realtime model. Update it later with
   * {@link OpenAIRealtimeToolkit.setInstructions}.
   */
  instructions?: string
  /**
   * Voice the model speaks with. Defaults to `'cedar'`. Change it later with
   * {@link OpenAIRealtimeToolkit.setVoice}.
   */
  voice?: OpenAIVoice
  /**
   * Speech speed multiplier, 0.5–1.5 (out-of-range values are clamped).
   * Defaults to 1.0. Change it later with {@link OpenAIRealtimeToolkit.setSpeed}.
   */
  speed?: number
  /**
   * OpenAI Realtime model id, e.g. `'gpt-realtime-2'` (the default). Baked into
   * the graph when the engine is built, so it's fixed for the engine's lifetime
   * — there's no live setter.
   */
  model?: string
  /**
   * Detect turns on-device with SileroVAD (barge-in) + SmartTurn (turn-end)
   * instead of OpenAI's `server_vad`. Defaults to false. Applied at
   * {@link OpenAIRealtimeToolkit.start}.
   */
  localTurnHandling?: boolean
  /**
   * Which preset tunes on-device turn detection
   * (`quiet` / `balanced` / `noisy` / `custom`). Defaults to `balanced`. Only
   * takes effect when {@link localTurnHandling} is true; ignored otherwise.
   */
  preset?: Preset
  /**
   * Knob values used when {@link preset} is `'custom'`; ignored for the
   * named presets. Any omitted knob falls back to its default. Update later with
   * {@link OpenAIRealtimeToolkit.setCustomKnobs}.
   */
  customKnobs?: TurnPreset
}

/** The categories of event OpenAIRealtimeToolkit surfaces, one per extension node. */
export type OpenAIRealtimeToolkitEventType = 'vad' | 'smartTurn' | 'openai'

/** A classified Switchboard event. */
export interface OpenAIRealtimeToolkitEvent {
  /** Which extension emitted it. */
  type: OpenAIRealtimeToolkitEventType
  /** Event name, e.g. 'speechStarted' / 'speechEnded'. */
  name: string
  /** The emitting node's URI. */
  objectURI: string
  /** Event payload. */
  data: unknown
  /** Emit time (ms since epoch), if provided. */
  timestamp?: number
  /** The original JSON string. */
  raw: string
}

/** Returned by {@link OpenAIRealtimeToolkit.addEventListener}; call `remove()` to unsubscribe. */
export interface OpenAIRealtimeToolkitSubscription {
  remove(): void
}

/** Handler for a classified OpenAIRealtimeToolkit event. */
export type OpenAIRealtimeToolkitEventListener = (event: OpenAIRealtimeToolkitEvent) => void

/** A tool the OpenAI Realtime model can call. Register it with the `useTool` hook (or `registerTool`). */
export interface OpenAIRealtimeToolkitTool {
  /** Function name the model calls. */
  name: string
  /** What it does — the model uses this to decide when to call it. */
  description: string
  /**
   * JSON Schema for the arguments object (OpenAI function-parameters format).
   * Omit for a no-argument tool.
   */
  parameters?: object
  /**
   * Runs when the model calls this tool. Receives the parsed arguments and
   * returns any JSON-serializable value (or a Promise of one); the result is
   * sent back to the model automatically. Throwing reports a tool error.
   */
  handler: (args: any) => unknown | Promise<unknown>
}

/** Payload of a `toolCall` event from the OpenAI node. */
interface ToolCall {
  callId: string
  name: string
  argumentsJson: string
}

// The graph's node IDs (see buildVoiceAssistantEngine) → event category. This is
// how the single native event stream is split into per-extension channels.
const NODE_EVENT_TYPE: Record<string, OpenAIRealtimeToolkitEventType> = {
  sileroVADNode: 'vad',
  smartTurnNode: 'smartTurn',
  openAIRealtimeNode: 'openai',
}

// Android AEC: open the mic as voice-communication. Pairs with
// MODE_IN_COMMUNICATION (set natively on start — see OpenAIRealtimeToolkitAudioSessionModule).
const ANDROID_VOICE_COMMUNICATION_INPUT_PRESET = 7 // oboe InputPreset.VoiceCommunication

/**
 * The Switchboard graph OpenAIRealtimeToolkit runs:
 * microphone → mono → OpenAI.Realtime → speaker, with SileroVAD and SmartTurn
 * tapped off the mic so voice activity is surfaced as events. When
 * `localTurnHandling` is off, OpenAI drives turn-taking via `server_vad`;
 * when on, the taps drive it and OpenAI's own detection is disabled.
 */
function buildVoiceAssistantEngine(
  instructions: string,
  tools: object[],
  localTurnHandling: boolean,
  session: { voice: OpenAIVoice; speed: number; model: string }
) {
  return {
    type: 'Switchboard.Realtime',
    configuration: {
      microphoneEnabled: true,
      voiceProcessingEnabled: true,
      inputPreset: ANDROID_VOICE_COMMUNICATION_INPUT_PRESET,
      graph: {
        nodes: [
          { id: 'multiChannelToMonoNode', type: 'Switchboard.MultiChannelToMono' },
          { id: 'micSplitterNode', type: 'Switchboard.BusSplitter' },
          {
            id: 'openAIRealtimeNode',
            type: 'OpenAI.Realtime',
            configuration: {
              model: session.model,
              voice: session.voice,
              speed: session.speed,
              turnDetection: localTurnHandling ? 'none' : 'server_vad',
              instructions,
              tools,
            },
          },
          // Gain stage after the AI node so local barge-in can duck its volume.
          { id: 'aiGainNode', type: 'Switchboard.Gain', configuration: { gain: 1.0 } },
          { id: 'monoToMultiChannelNode', type: 'Switchboard.MonoToMultiChannel' },
          {
            id: 'sileroVADNode',
            type: 'Silero.VAD',
            configuration: { threshold: 0.5, minSilenceDurationMs: 500 },
          },
          { id: 'smartTurnNode', type: 'SmartTurn.Turn', configuration: { threshold: 0.4 } },
        ],
        connections: [
          { sourceNode: 'inputNode', destinationNode: 'multiChannelToMonoNode' },
          { sourceNode: 'multiChannelToMonoNode', destinationNode: 'micSplitterNode' },
          { sourceNode: 'micSplitterNode', destinationNode: 'openAIRealtimeNode' },
          { sourceNode: 'openAIRealtimeNode', destinationNode: 'aiGainNode' },
          { sourceNode: 'aiGainNode', destinationNode: 'monoToMultiChannelNode' },
          { sourceNode: 'monoToMultiChannelNode', destinationNode: 'outputNode' },
          { sourceNode: 'micSplitterNode', destinationNode: 'sileroVADNode' },
          { sourceNode: 'micSplitterNode', destinationNode: 'smartTurnNode' },
        ],
      },
    },
  }
}

/** The OpenAIRealtimeToolkit engine's public surface (what {@link createOpenAIRealtimeToolkit} returns). */
export type OpenAIRealtimeToolkit = ReturnType<typeof createOpenAIRealtimeToolkit>

/**
 * High-level OpenAIRealtimeToolkit API.
 *
 * {@link OpenAIRealtimeToolkit.initialize} loads the SDK + extensions,
 * {@link OpenAIRealtimeToolkit.start}/{@link OpenAIRealtimeToolkit.stop} control the engine, and
 * {@link OpenAIRealtimeToolkit.addEventListener} delivers the VAD / SmartTurn / OpenAI event
 * streams separately. For full control, use {@link SwitchboardClient} directly
 * instead.
 *
 * State lives in closure — no classes, no `this`. Each call yields an
 * independent engine; the app uses the single {@link openAIRealtimeToolkit} instance below.
 */
export function createOpenAIRealtimeToolkit() {
  let client: SwitchboardClient | null = null
  let engineId: string | null = null
  // engineId = engine exists (kept across stop for reuse); running = started.
  let running = false
  let initialized = false
  // Why the SDK refused to initialize (rejected credentials, extension load
  // failure), or null. Recorded instead of thrown — see initialize().
  let initError: string | null = null
  let nativeSubscribed = false
  let instructions = ''
  let voice: OpenAIVoice = DEFAULT_VOICE
  let speed: number = SPEED_RANGE.default
  let model = DEFAULT_MODEL
  let localTurnHandling = false
  let preset: Preset = 'balanced'
  let customKnobs: TurnPreset = {}
  let localTurn: LocalTurnController | null = null
  const tools = new Map<string, OpenAIRealtimeToolkitTool>()

  const listeners: Record<OpenAIRealtimeToolkitEventType, Set<OpenAIRealtimeToolkitEventListener>> = {
    vad: new Set(),
    smartTurn: new Set(),
    openai: new Set(),
  }

  /**
   * Load the Switchboard SDK and its extensions (SileroVAD + Onnx + OpenAI)
   * with your credentials. Idempotent.
   *
   * Throws only for a caller mistake (a blank credential). An SDK-level refusal
   * is recorded in {@link OpenAIRealtimeToolkit.initError} and leaves this
   * uninitialized, so a later `start()` rejects with the reason: the provider
   * calls this from an effect, where a throw would red-box the app instead of
   * reaching its `error` state.
   */
  function initialize(options: OpenAIRealtimeToolkitInitializeOptions): void {
    if (initialized) {
      return
    }
    initError = null
    // Fail loudly on missing/blank credentials. The SDK rejects a missing
    // appID/appSecret asynchronously (via license validation) and only *logs* a
    // bad OpenAI key, so without these guards a config typo fails silently.
    if (!options.appId || options.appId.trim() === '') {
      throw new Error('appId is required')
    }
    if (!options.appSecret || options.appSecret.trim() === '') {
      throw new Error('appSecret is required')
    }
    if (!options.openAIApiKey || options.openAIApiKey.trim() === '') {
      throw new Error('openAIApiKey is required')
    }

    instructions = options.instructions ?? ''
    voice = options.voice ?? DEFAULT_VOICE
    speed = clampSpeed(options.speed ?? SPEED_RANGE.default)
    model = options.model ?? DEFAULT_MODEL
    localTurnHandling = options.localTurnHandling ?? false
    preset = options.preset ?? 'balanced'
    customKnobs = options.customKnobs ?? {}
    const c = ensureClient()
    // Native SDK survives JS reloads — skip re-init if already initialized.
    if (c.getValue('switchboard', 'isInitialized').result !== true) {
      const res = c.callAction('switchboard', 'initialize', {
        appID: options.appId,
        appSecret: options.appSecret,
        extensions: {
          Silero: {},
          Onnx: {},
          SmartTurn: {},
          OpenAI: { apiKey: options.openAIApiKey },
        },
      })
      if (res.error) {
        initError = `Switchboard initialization failed: ${res.error.message}`
        return
      }
    }
    // Re-adopt an engine that survived the reload so start() reuses it.
    const engines = c.getValue('switchboard', 'engines').result
    engineId = Array.isArray(engines) && engines.length > 0 ? String(engines[0]) : null
    running = engineId !== null && c.getValue(engineId, 'isRunning').result === true
    initialized = true
  }

  /**
   * Subscribe to a single category of events (`vad` / `smartTurn` / `openai`).
   * @returns a subscription — call `remove()` to stop listening.
   */
  function addEventListener(
    type: OpenAIRealtimeToolkitEventType,
    listener: OpenAIRealtimeToolkitEventListener
  ): OpenAIRealtimeToolkitSubscription {
    listeners[type].add(listener)
    return {
      remove: () => {
        listeners[type].delete(listener)
      },
    }
  }

  /**
   * Request microphone permission; resolves to whether it's granted. Android
   * uses `PermissionsAndroid` (RECORD_AUDIO); iOS shows the system prompt via
   * AVAudioApplication. Called automatically by {@link OpenAIRealtimeToolkit.start}.
   */
  async function requestMicrophonePermission(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
      return granted === PermissionsAndroid.RESULTS.GRANTED
    }
    return NativeOpenAIRealtimeToolkit.requestMicrophonePermission()
  }

  /**
   * Request the mic, build the voice-assistant graph, and start the engine.
   * @throws if not initialized, the mic is denied, or the engine fails to start.
   */
  async function start(): Promise<void> {
    if (!initialized || !client) {
      // An SDK refusal recorded by initialize() is the real reason — report that
      // rather than "call initialize() first", which would be misleading.
      throw new Error(initError ?? 'OpenAIRealtimeToolkit.initialize() must be called before start()')
    }
    if (running) {
      return // already running
    }
    // Capture before the await: `client` narrows to non-null here, and holding a
    // const keeps it stable across the async boundary.
    const c = client

    if (!(await requestMicrophonePermission())) {
      throw new Error('Microphone permission denied')
    }

    // Create the engine once; start/stop reuse it, release() frees it.
    let id = engineId
    if (!id) {
      const res = c.callAction(
        'switchboard',
        'createEngine',
        buildVoiceAssistantEngine(instructions, toolDefs(), localTurnHandling, { voice, speed, model })
      )
      id = res.result as string
      if (!id) {
        throw new Error(`createEngine failed: ${JSON.stringify(res.error ?? res)}`)
      }
      engineId = id
    }

    // Android: enter speakerphone comm mode before the streams open so AEC
    // engages on the loudspeaker. Best-effort — don't block the call on it.
    if (Platform.OS === 'android') {
      try {
        await NativeModules.OpenAIRealtimeToolkitAudioSession?.enableCommunicationRoute()
      } catch {
        // proceed without the route change; the call still works
      }
    }

    // Check the result: a refused start (audio session unavailable, mic held by
    // another app) would otherwise leave `running` true with a dead graph.
    const startRes = c.callAction(id, 'start')
    if (startRes.error) {
      throw new Error(`Engine start failed: ${startRes.error.message}`)
    }
    running = true

    applyPreset()
  }

  /**
   * (Re)build the turn controller from the current preset and apply its two
   * graph-node knobs. Armed only when localTurnHandling is on. Needs a running
   * graph.
   */
  function applyPreset(): void {
    if (!client) {
      return
    }
    const c = client
    // 'custom' has no static entry — its knobs are supplied at runtime.
    const active = preset === 'custom' ? customKnobs : PRESETS[preset]
    const turn = resolveTurnDetection(active.turnDetection)
    const bargeIn = resolveBargeIn(active.bargeIn)
    c.setValue('sileroVADNode', 'threshold', turn.vadThreshold)
    c.setValue('sileroVADNode', 'minSilenceDurationMs', turn.vadSilenceMs)
    c.setValue('aiGainNode', 'rampDurationMs', bargeIn.duckRampMs)
    // Clear the old controller before swapping in the retuned one.
    localTurn?.reset()
    localTurn = createLocalTurnController(
      c,
      { ai: 'openAIRealtimeNode', smartTurn: 'smartTurnNode', gain: 'aiGainNode' },
      turn,
      bargeIn
    )
    localTurn.setEnabled(localTurnHandling)
  }

  /**
   * Set the OpenAI Realtime model's system prompt. Call before
   * {@link OpenAIRealtimeToolkit.start} to bake it into the session, or while running to
   * update it live.
   */
  function setInstructions(next: string): void {
    instructions = next
    if (engineId) {
      client?.setValue('openAIRealtimeNode', 'instructions', next)
    }
  }

  /**
   * Set the voice the model speaks with. Applied live while running — OpenAI
   * starts a new session for the new voice, dropping the conversation so far;
   * otherwise the next {@link OpenAIRealtimeToolkit.start} picks it up.
   */
  function setVoice(next: OpenAIVoice): void {
    if (next === voice) {
      return
    }
    voice = next
    if (engineId) {
      client?.setValue('openAIRealtimeNode', 'voice', next)
    }
  }

  /**
   * Set the speech speed multiplier (0.5–1.5; out-of-range values are clamped).
   * Applied live while running — the session keeps its context.
   */
  function setSpeed(next: number): void {
    const clamped = clampSpeed(next)
    if (clamped === speed) {
      return
    }
    speed = clamped
    if (engineId) {
      client?.setValue('openAIRealtimeNode', 'speed', clamped)
    }
  }

  /**
   * Enable/disable on-device turn handling instead of OpenAI's `server_vad`.
   * Applied live while running; otherwise the next {@link OpenAIRealtimeToolkit.start} picks it up.
   */
  function setLocalTurnHandling(enabled: boolean): void {
    if (enabled === localTurnHandling) {
      return
    }
    localTurnHandling = enabled
    // No engine yet: next start() bakes it in.
    if (!client || !engineId) {
      return
    }
    // Engine exists: apply live so it survives a reuse-restart.
    client.setValue('openAIRealtimeNode', 'turnDetection', enabled ? 'none' : 'server_vad')
    localTurn?.setEnabled(enabled)
  }

  /**
   * Select the preset that tunes on-device turn detection. Applied live
   * while running; otherwise the next {@link OpenAIRealtimeToolkit.start} picks it up. Only
   * matters while {@link OpenAIRealtimeToolkit.setLocalTurnHandling} is on.
   */
  function setPreset(next: Preset): void {
    if (next === preset) {
      return
    }
    preset = next
    if (engineId) {
      applyPreset()
    }
  }

  /**
   * Set the knob values used when the active preset is `'custom'`. Applied live
   * while running only if `'custom'` is currently selected; otherwise stored for
   * the next time it is. Replaces the whole knob set — any omitted knob falls
   * back to its default (not the previous value). Only matters while
   * {@link OpenAIRealtimeToolkit.setLocalTurnHandling} is on.
   */
  function setCustomKnobs(knobs: TurnPreset): void {
    customKnobs = knobs
    if (engineId && preset === 'custom') {
      applyPreset()
    }
  }

  /**
   * Make a tool available to the model. Its `handler` runs when the model calls
   * it and the return value is sent back automatically. Registering before
   * {@link OpenAIRealtimeToolkit.start} bakes it into the session; registering while
   * running updates it live. Re-registering the same `name` replaces it — tool
   * names must be unique. Remove it with {@link OpenAIRealtimeToolkit.unregisterTool}.
   */
  function registerTool(tool: OpenAIRealtimeToolkitTool): void {
    tools.set(tool.name, tool)
    if (engineId) {
      client?.setValue('openAIRealtimeNode', 'tools', toolDefs())
    }
  }

  /** Remove a registered tool by name; no-op if it isn't registered. */
  function unregisterTool(name: string): void {
    if (tools.delete(name) && engineId) {
      client?.setValue('openAIRealtimeNode', 'tools', toolDefs())
    }
  }

  /** OpenAI function definitions for the registered tools (handlers stripped). */
  function toolDefs(): object[] {
    return Array.from(tools.values()).map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description,
      // No-arg tools omit `parameters`; emit an empty object schema so the
      // function definition stays well-formed.
      parameters: t.parameters ?? { type: 'object', properties: {}, additionalProperties: false },
    }))
  }

  /** Run a tool call: execute the handler, submit the result, resume the model. */
  async function handleToolCall(call: ToolCall): Promise<void> {
    const tool = tools.get(call.name)
    try {
      if (!tool) {
        throw new Error(`No tool registered for '${call.name}'`)
      }
      const args = call.argumentsJson ? JSON.parse(call.argumentsJson) : {}
      const result = await tool.handler(args)
      client?.callAction('openAIRealtimeNode', 'submitToolResult', {
        callId: call.callId,
        outputJson: JSON.stringify(result ?? null),
      })
    } catch (err) {
      client?.callAction('openAIRealtimeNode', 'submitToolError', {
        callId: call.callId,
        errorJson: JSON.stringify({ error: String(err) }),
      })
    }
    // Resume so the model speaks using the tool output.
    client?.callAction('openAIRealtimeNode', 'createResponse', {})
  }

  /**
   * Halt the graph. Returns the SDK's message if it refused, else null — `running`
   * only goes false when the graph actually stopped, so a refusal can't leave the
   * app showing a stopped engine over a live microphone.
   */
  function haltGraph(): string | null {
    // Cancel pending timers so they don't fire against a stopped engine.
    localTurn?.reset()
    localTurn = null
    if (client && engineId && running) {
      const res = client.callAction(engineId, 'stop')
      if (res.error) {
        return res.error.message ?? 'unknown error'
      }
    }
    running = false
    // Android: restore normal routing + mode. Only once the graph is down — while
    // it's still running the comm route is what keeps AEC engaged.
    if (Platform.OS === 'android') {
      NativeModules.OpenAIRealtimeToolkitAudioSession?.disableCommunicationRoute()?.catch(
        () => {}
      )
    }
    return null
  }

  /**
   * Stop the engine, keeping it for a fast restart via {@link OpenAIRealtimeToolkit.start}.
   * {@link OpenAIRealtimeToolkit.release} frees it.
   *
   * @throws if the engine refuses to stop — `isRunning` stays true, because it is.
   */
  function stop(): void {
    const failure = haltGraph()
    if (failure) {
      throw new Error(`Engine stop failed: ${failure}`)
    }
  }

  /** Stop and free the engine (audio session, models). The next {@link OpenAIRealtimeToolkit.start} rebuilds it. */
  function release(): void {
    // A refused stop must not block the release path: destroying the engine frees
    // the session either way, and release() is the app's way out of a bad state.
    haltGraph()
    if (client && engineId) {
      // 'engineID' param per Switchboard.destroyEngine.
      client.callAction('switchboard', 'destroyEngine', { engineID: engineId })
      engineId = null
      // The engine is gone, so nothing is running even if the stop above failed.
      running = false
    }
  }

  function ensureClient(): SwitchboardClient {
    if (!client) {
      client = new SwitchboardClient(new NativeModuleRPCClient())
    }
    if (!nativeSubscribed) {
      client.setEventReceivedCallback((raw) => dispatch(raw))
      client.addEventListener('*', '*')
      nativeSubscribed = true
    }
    return client
  }

  /** Parse a raw native event, classify by source node, and fan out. */
  function dispatch(raw: string): void {
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    // Tolerate either a flat Event or a {params: Event} envelope.
    const e = parsed?.params ?? parsed
    const objectURI: string = e?.objectURI ?? ''
    // A graph node's URI arrives dotted (e.g. "<engine>.openAIRealtimeNode"), so classify by
    // the last segment — matching against the full URI would drop every event.
    const nodeId = objectURI.split('.').pop() ?? ''
    const type = NODE_EVENT_TYPE[nodeId]
    if (!type) {
      return // emit only vad / smartTurn / openai
    }
    const event: OpenAIRealtimeToolkitEvent = {
      type,
      name: e?.name ?? e?.eventName ?? '',
      objectURI,
      data: e?.data,
      timestamp: e?.timestamp,
      raw,
    }
    // Tool calls are handled automatically (run handler → submit → resume); the
    // event still fans out below so callers can observe them.
    if (type === 'openai' && event.name === 'toolCall') {
      handleToolCall(event.data as ToolCall)
    }
    // On-device turn detection: SileroVAD speech edges drive barge-in + turn-end.
    if (type === 'vad') {
      if (event.name === 'speechStarted') {
        localTurn?.onSpeechStart()
      } else if (event.name === 'speechEnded') {
        localTurn?.onSpeechEnd()
      }
    }
    listeners[type].forEach((l) => l(event))
  }

  return {
    initialize,
    addEventListener,
    requestMicrophonePermission,
    start,
    setInstructions,
    setVoice,
    setSpeed,
    setLocalTurnHandling,
    setPreset,
    setCustomKnobs,
    registerTool,
    unregisterTool,
    stop,
    release,
    /** Whether the engine is started (between {@link OpenAIRealtimeToolkit.start} and {@link OpenAIRealtimeToolkit.stop}). */
    get isRunning(): boolean {
      return running
    },
    /**
     * Why the last {@link OpenAIRealtimeToolkit.initialize} was refused by the SDK,
     * or null. Set instead of throwing so a caller in a React effect can surface it.
     */
    get initError(): string | null {
      return initError
    },
  }
}

/**
 * The app-wide OpenAIRealtimeToolkit engine — one voice pipeline per app. Internal to the
 * package: {@link OpenAIRealtimeToolkitProvider} wraps this single instance and exposes it
 * through context, so the global state lives here and the hooks are its
 * consumers. Not part of the public API.
 */
export const openAIRealtimeToolkit = createOpenAIRealtimeToolkit()

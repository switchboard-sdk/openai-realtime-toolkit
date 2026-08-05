import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { openAIRealtimeToolkit, type OpenAIRealtimeToolkit, type OpenAIRealtimeToolkitTool } from './OpenAIRealtimeToolkit'
import { clampSpeed, DEFAULT_MODEL, DEFAULT_VOICE, SPEED_RANGE, type OpenAIVoice } from './voice'
import { knobsToPreset, resolveKnobValues } from './presets'
import { type LocalTurnConfig, type KnobValues } from './turnDetection'

/** OpenAI Realtime session connection state. */
export type OpenAIRealtimeToolkitConnectionStatus = 'none' | 'connecting' | 'connected' | 'error'

/**
 * On-device turn-handling controls — the `localTurnHandling` field of
 * {@link OpenAIRealtimeToolkitContextValue}. Groups the on/off switch with its tuning so it's clear
 * the `knobs` belong to this feature and apply only while `enabled` is true.
 */
export interface LocalTurnHandling {
  /** Whether on-device turn handling is enabled. */
  enabled: boolean
  /** Enable/disable on-device turn handling. Applied live while running. */
  setEnabled: (enabled: boolean) => void
  /**
   * The current value of every turn-detection / barge-in knob (read + hover docs),
   * e.g. `config.pauseToleranceMs`. Change values with {@link LocalTurnHandling.setConfig}.
   */
  config: LocalTurnConfig
  /**
   * Set one or more knobs. A partial patch tweaks — `setConfig({ pauseToleranceMs: 3000 })`;
   * a full knob set selects a preset — `setConfig(NOISY_CONFIG)`. Merges over the current
   * values (partial patches keep the rest); applied live while running.
   */
  setConfig: (patch: Partial<LocalTurnConfig>) => void
}

/** Value exposed by {@link useOpenAIRealtimeToolkit} — the whole OpenAIRealtimeToolkit surface. */
export interface OpenAIRealtimeToolkitContextValue {
  /** Whether the engine is currently running. */
  isRunning: boolean
  /**
   * Last failure message, or null: mic permission and `start()` errors, plus OpenAI
   * session errors (rejected key, quota, unknown model). Cleared by `start()` and by
   * a session that comes up.
   */
  error: string | null
  /**
   * OpenAI Realtime session connection state. `'error'` is sticky — the node's
   * reconnect attempts don't reset it to `'connecting'`; only a session that comes
   * up clears it. See {@link OpenAIRealtimeToolkitContextValue.error} for the reason.
   */
  connectionStatus: OpenAIRealtimeToolkitConnectionStatus
  /** Latest transcript of the user's speech. */
  inputTranscription: string
  /** Latest transcript of the model's spoken response. */
  outputTranscription: string
  /** Start the voice-assistant engine (ensures mic permission first). */
  start: () => Promise<void>
  /** Stop the engine, keeping it for a fast restart via {@link start}. */
  stop: () => void
  /** Stop and fully release the engine, freeing native resources. The next start() rebuilds it. */
  release: () => void
  /** Whether microphone permission is granted; `null` until first checked. */
  hasMicrophonePermission: boolean | null
  /** Request microphone permission; resolves to whether it's granted. Called automatically by {@link start}. */
  requestMicrophonePermission: () => Promise<boolean>
  /** The current OpenAI system prompt. */
  instructions: string
  /** Set the OpenAI system prompt. Takes effect live while running. */
  setInstructions: (instructions: string) => void
  /** The voice the model speaks with. */
  voice: OpenAIVoice
  /**
   * Set the voice. Takes effect live while running, but OpenAI starts a new
   * session for it — the conversation so far is dropped.
   */
  setVoice: (voice: OpenAIVoice) => void
  /** Speech speed multiplier (0.5–1.5, 1.0 = normal). */
  speed: number
  /** Set the speech speed (clamped to 0.5–1.5). Takes effect live while running. */
  setSpeed: (speed: number) => void
  /**
   * The OpenAI Realtime model id. Read-only: the model is baked into the engine
   * when it's built, so it's set once via the provider's `model` prop.
   */
  model: string
  /**
   * On-device turn handling (SileroVAD + SmartTurn) instead of OpenAI's `server_vad`,
   * plus its barge-in / turn-detection tuning. The `config` knobs apply only while
   * `enabled` is true. Applied live while running.
   */
  localTurnHandling: LocalTurnHandling
  /** Register a tool the model can call (replaces any tool with the same name). */
  registerTool: (tool: OpenAIRealtimeToolkitTool) => void
  /** Remove a registered tool by name. */
  unregisterTool: (name: string) => void
}

const OpenAIRealtimeToolkitContext = createContext<OpenAIRealtimeToolkitContextValue | null>(null)

/** Props for {@link OpenAIRealtimeToolkitProvider}. Credentials are required; the rest seed initial state. */
export interface OpenAIRealtimeToolkitProviderProps {
  /** Switchboard app ID (console.switchboard.audio). */
  appId: string
  /** Switchboard app secret. */
  appSecret: string
  /** OpenAI API key, used by the OpenAI Realtime node. */
  openAIApiKey: string
  /** System prompt. Initial value; also settable via `useOpenAIRealtimeToolkit().setInstructions`. */
  instructions?: string
  /** Voice the model speaks with (defaults to `'cedar'`). Initial value; also settable via the hook. */
  voice?: OpenAIVoice
  /** Speech speed multiplier, 0.5–1.5 (defaults to 1.0). Initial value; also settable via the hook. */
  speed?: number
  /**
   * OpenAI Realtime model id (defaults to `'gpt-realtime-2'`). Set here only —
   * the model is fixed once the engine is built, so the hook exposes it read-only.
   */
  model?: string
  /**
   * On-device turn handling seed. `enabled` defaults to false; `config` seeds the initial
   * tuning (e.g. `QUIET_CONFIG` or `{ pauseToleranceMs: 3000 }`; omitted knobs use their
   * defaults). Change it at runtime via `useOpenAIRealtimeToolkit().localTurnHandling`.
   */
  localTurnHandling?: { enabled?: boolean; config?: Partial<LocalTurnConfig> }
  /** Descendants that read the context via {@link useOpenAIRealtimeToolkit}. */
  children?: ReactNode
}

/**
 * Initializes OpenAIRealtimeToolkit with your credentials and exposes start/stop, the OpenAI
 * connection status, the input/output transcripts, and on-device turn-detection
 * config (`enabled` + `config`) to descendants via {@link useOpenAIRealtimeToolkit}.
 */
export function OpenAIRealtimeToolkitProvider(props: OpenAIRealtimeToolkitProviderProps) {
  const { appId, appSecret, openAIApiKey, children } = props
  if (!appId?.trim()) {
    throw new Error('OpenAIRealtimeToolkitProvider: appId is required')
  }
  if (!appSecret?.trim()) {
    throw new Error('OpenAIRealtimeToolkitProvider: appSecret is required')
  }
  if (!openAIApiKey?.trim()) {
    throw new Error('OpenAIRealtimeToolkitProvider: openAIApiKey is required')
  }

  const openAIRealtimeToolkitRef = useRef<OpenAIRealtimeToolkit>(openAIRealtimeToolkit)

  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<OpenAIRealtimeToolkitConnectionStatus>('none')
  const [inputTranscription, setInputTranscription] = useState('')
  const [outputTranscription, setOutputTranscription] = useState('')
  const [hasMicrophonePermission, setHasMicrophonePermission] = useState<boolean | null>(null)
  // Props seed the initial value only; runtime changes go through the setters.
  const [instructions, setInstructionsState] = useState(props.instructions ?? '')
  const [voice, setVoiceState] = useState<OpenAIVoice>(props.voice ?? DEFAULT_VOICE)
  const [speed, setSpeedState] = useState(() => clampSpeed(props.speed ?? SPEED_RANGE.default))
  // The model is fixed once the engine is built — no setter, so it never changes here.
  const [model] = useState(props.model ?? DEFAULT_MODEL)
  const [enabled, setEnabledState] = useState(props.localTurnHandling?.enabled ?? false)
  // Current resolved value for every knob — seeded from localTurnHandling.config over the defaults.
  const [values, setValues] = useState<KnobValues>(() =>
    resolveKnobValues(knobsToPreset(props.localTurnHandling?.config ?? {}))
  )
  // Latest effective values in a ref, so several setConfig() calls in one tick chain off
  // each other (each seeds from the ref, not the stale render snapshot) and the engine
  // push uses the merged result.
  const valuesRef = useRef(values)
  valuesRef.current = values

  useEffect(() => {
    const ea = openAIRealtimeToolkitRef.current!
    ea.initialize({
      appId,
      appSecret,
      openAIApiKey,
      instructions,
      voice,
      speed,
      model,
      localTurnHandling: enabled,
      // The engine keeps its named-preset machinery internally; the provider always
      // drives the 'custom' slot with the resolved knob values.
      preset: 'custom',
      customKnobs: knobsToPreset(valuesRef.current),
    })
    // An SDK-level refusal (rejected credentials, extension load failure) is
    // recorded rather than thrown — a throw here would red-box instead of
    // landing in `error`. start() will reject with the same reason.
    if (ea.initError) {
      setError(ea.initError)
    }
    // Reflect a native engine that survived the reload still running.
    setIsRunning(ea.isRunning)

    // Consume the internal OpenAI event channel and re-surface only the few
    // things worth exposing. Raw events stay internal to OpenAIRealtimeToolkit.
    const sub = ea.addEventListener('openai', (e) => {
      switch (e.name) {
        case 'sessionStarting':
        case 'sessionDisconnected':
          // Keep a known failure visible: the OpenAI node reconnects every few
          // seconds, so without this a rejected key would show 'error' for an
          // instant and then sit on 'connecting' forever, indistinguishable from
          // a slow connect. Only a session that actually comes up clears it.
          setConnectionStatus((prev) => (prev === 'error' ? 'error' : 'connecting'))
          break
        case 'sessionCreated':
          setConnectionStatus('connected')
          setError(null)
          break
        case 'error': {
          console.warn('[OpenAIRealtimeToolkit] session error:', e.raw)
          // Session failures (bad key, quota, unknown model) reach the app through
          // the same `error` string as engine failures — one channel, with the
          // reason in it, instead of only a console warning.
          const message = (e.data as { message?: string } | undefined)?.message
          setError(message?.trim() ? message : `Session error: ${e.raw}`)
          setConnectionStatus('error')
          break
        }
        case 'inputTranscription':
          setInputTranscription((e.data as { transcript?: string })?.transcript ?? '')
          break
        case 'responseTranscription':
          setOutputTranscription((e.data as { transcript?: string })?.transcript ?? '')
          break
      }
    })
    return () => {
      // Detach this view's listener only — the engine's lifecycle is app-owned
      // (start/stop/release), so unmount never stops a running agent.
      sub.remove()
    }
    // Settings are init-only seeds here; runtime changes go through the setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, appSecret, openAIApiKey])

  // Ensure mic permission before starting so a denial surfaces as an error
  // rather than silent empty input.
  const requestMicrophonePermission = useCallback(async (): Promise<boolean> => {
    try {
      const granted = (await openAIRealtimeToolkitRef.current?.requestMicrophonePermission()) ?? false
      setHasMicrophonePermission(granted)
      return granted
    } catch {
      setHasMicrophonePermission(false)
      return false
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      if (!(await requestMicrophonePermission())) {
        setError('Microphone permission denied')
        return
      }
      await openAIRealtimeToolkitRef.current?.start()
      setIsRunning(true)
    } catch (err) {
      // The message, not String(err) — this goes straight into an app's UI, and
      // String(err) would render as "Error: Engine start failed: …".
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [requestMicrophonePermission])

  const stop = useCallback(() => {
    try {
      openAIRealtimeToolkitRef.current?.stop()
      setIsRunning(false)
      setConnectionStatus('none')
    } catch (err) {
      // The graph is still live, so leave isRunning true — offering a Start
      // button over a hot mic would be worse than reporting the failure.
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const release = useCallback(() => {
    openAIRealtimeToolkitRef.current?.release()
    setIsRunning(false)
    setConnectionStatus('none')
  }, [])

  const setInstructions = useCallback((next: string) => {
    setInstructionsState(next)
    openAIRealtimeToolkitRef.current?.setInstructions(next)
  }, [])

  const setVoice = useCallback((next: OpenAIVoice) => {
    setVoiceState(next)
    openAIRealtimeToolkitRef.current?.setVoice(next)
  }, [])

  const setSpeed = useCallback((next: number) => {
    const clamped = clampSpeed(next)
    setSpeedState(clamped)
    openAIRealtimeToolkitRef.current?.setSpeed(clamped)
  }, [])

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next)
    openAIRealtimeToolkitRef.current?.setLocalTurnHandling(next)
  }, [])

  // The read surface is just the resolved values — each documented on `LocalTurnConfig`.
  const config: LocalTurnConfig = values

  // Merge the flat patch over the current values and push to the engine. Seeds from
  // `valuesRef` (not the render snapshot), so several setConfig() calls in one tick chain
  // off each other. A full-knob patch overwrites everything (= "select a preset").
  const setConfig = useCallback((patch: Partial<LocalTurnConfig>) => {
    const current = valuesRef.current
    const merged: KnobValues = { ...current }
    for (const key of Object.keys(patch) as (keyof KnobValues)[]) {
      const v = (patch as Record<string, unknown>)[key as string]
      if (v !== undefined) (merged as Record<string, unknown>)[key as string] = v
    }
    // No-op if nothing actually changed (skips a redundant re-apply / re-render).
    const changed = (Object.keys(merged) as (keyof KnobValues)[]).some((k) => merged[k] !== current[k])
    if (!changed) return
    valuesRef.current = merged
    setValues(merged)
    openAIRealtimeToolkitRef.current?.setCustomKnobs(knobsToPreset(merged))
  }, [])

  const registerTool = useCallback((tool: OpenAIRealtimeToolkitTool) => {
    openAIRealtimeToolkitRef.current?.registerTool(tool)
  }, [])

  const unregisterTool = useCallback((name: string) => {
    openAIRealtimeToolkitRef.current?.unregisterTool(name)
  }, [])

  const value: OpenAIRealtimeToolkitContextValue = {
    isRunning,
    error,
    connectionStatus,
    inputTranscription,
    outputTranscription,
    start,
    stop,
    release,
    hasMicrophonePermission,
    requestMicrophonePermission,
    instructions,
    setInstructions,
    voice,
    setVoice,
    speed,
    setSpeed,
    model,
    localTurnHandling: { enabled, setEnabled, config, setConfig },
    registerTool,
    unregisterTool,
  }

  return <OpenAIRealtimeToolkitContext.Provider value={value}>{children}</OpenAIRealtimeToolkitContext.Provider>
}

/** Access the OpenAIRealtimeToolkit state + controls. Must be used within {@link OpenAIRealtimeToolkitProvider}. */
export function useOpenAIRealtimeToolkit(): OpenAIRealtimeToolkitContextValue {
  const ctx = useContext(OpenAIRealtimeToolkitContext)
  if (!ctx) {
    throw new Error('useOpenAIRealtimeToolkit must be used within an OpenAIRealtimeToolkitProvider')
  }
  return ctx
}

/**
 * Register a tool for the model to call, scoped to this component's lifetime.
 * The usual way to add a tool: it registers on mount, unregisters on unmount, and
 * re-registers when the model-visible parts (`name`, `description`, `parameters`)
 * change. The `handler` is kept live across renders through a ref, so it always
 * sees current state/props without re-registering — no stale-closure footgun.
 *
 * For dynamic tool sets the rules of hooks can't express (variable-length lists,
 * tools from config, registration outside render), use {@link OpenAIRealtimeToolkitContextValue.registerTool}
 * / {@link OpenAIRealtimeToolkitContextValue.unregisterTool} from {@link useOpenAIRealtimeToolkit} directly.
 *
 * @example
 * useTool({
 *   name: 'get_weather',
 *   description: 'Current weather for a city',
 *   parameters: {
 *     type: 'object',
 *     properties: { city: { type: 'string' } },
 *     required: ['city'],
 *   },
 *   handler: async ({ city }) => fetchWeather(city),
 * });
 */
export function useTool(tool: OpenAIRealtimeToolkitTool): void {
  const { registerTool, unregisterTool } = useOpenAIRealtimeToolkit()
  const toolRef = useRef(tool)
  toolRef.current = tool

  // Re-register only when the model-visible parts change; the handler flows
  // through the ref, so its updates alone never trigger a re-register.
  const parametersKey = JSON.stringify(tool.parameters)
  useEffect(() => {
    const name = toolRef.current.name
    registerTool({
      name,
      description: toolRef.current.description,
      parameters: toolRef.current.parameters,
      handler: (args) => toolRef.current.handler(args),
    })
    // Unregister on unmount (and before re-running on a name/description/params change).
    return () => unregisterTool(name)
  }, [tool.name, tool.description, parametersKey, registerTool, unregisterTool])
}

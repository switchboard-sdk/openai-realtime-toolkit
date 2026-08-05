import React, { type ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react-native'

// Mock the app-wide singleton so the provider talks to a spy. The provider's job
// is (a) credential validation, (b) wiring the OpenAI event channel to React
// state, and (c) keeping the exposed setters reactive while delegating to the
// engine — all of which we assert without a real engine.
jest.mock('./OpenAIRealtimeToolkit', () => {
  let openaiListener: ((e: any) => void) | null = null
  const openAIRealtimeToolkit = {
    initialize: jest.fn(),
    isRunning: false,
    // Set by the real initialize() when the SDK refuses the credentials.
    initError: null as string | null,
    start: jest.fn(() => Promise.resolve()),
    stop: jest.fn(),
    release: jest.fn(),
    requestMicrophonePermission: jest.fn(() => Promise.resolve(true)),
    setInstructions: jest.fn(),
    setVoice: jest.fn(),
    setSpeed: jest.fn(),
    setLocalTurnHandling: jest.fn(),
    setPreset: jest.fn(),
    setCustomKnobs: jest.fn(),
    registerTool: jest.fn(),
    addEventListener: jest.fn((type: string, listener: (e: any) => void) => {
      if (type === 'openai') openaiListener = listener
      return {
        remove: jest.fn(() => {
          openaiListener = null
        }),
      }
    }),
  }
  return {
    openAIRealtimeToolkit,
    __emitOpenAI: (e: any) => openaiListener?.(e),
    __hasOpenAIListener: () => openaiListener !== null,
  }
})

import { OpenAIRealtimeToolkitProvider, useOpenAIRealtimeToolkit } from './OpenAIRealtimeToolkitProvider'
import { QUIET_CONFIG, NOISY_CONFIG } from './presets'

const mockModule = jest.requireMock('./OpenAIRealtimeToolkit') as {
  openAIRealtimeToolkit: {
    initialize: jest.Mock
    isRunning: boolean
    initError: string | null
    start: jest.Mock
    stop: jest.Mock
    release: jest.Mock
    requestMicrophonePermission: jest.Mock
    setInstructions: jest.Mock
    setVoice: jest.Mock
    setSpeed: jest.Mock
    setLocalTurnHandling: jest.Mock
    setPreset: jest.Mock
    setCustomKnobs: jest.Mock
    registerTool: jest.Mock
    addEventListener: jest.Mock
  }
  __emitOpenAI: (e: any) => void
  __hasOpenAIListener: () => boolean
}
const { openAIRealtimeToolkit, __emitOpenAI, __hasOpenAIListener } = mockModule

const CREDS = { appId: 'app-1', appSecret: 'secret-1', openAIApiKey: 'sk-1' }

function makeWrapper(props: Record<string, unknown> = {}) {
  return ({ children }: { children: ReactNode }) => (
    <OpenAIRealtimeToolkitProvider {...CREDS} {...props}>
      {children}
    </OpenAIRealtimeToolkitProvider>
  )
}

function renderProvider(props: Record<string, unknown> = {}) {
  return renderHook(() => useOpenAIRealtimeToolkit(), { wrapper: makeWrapper(props) })
}

beforeEach(() => {
  jest.clearAllMocks()
  openAIRealtimeToolkit.start.mockResolvedValue(undefined)
  // clearAllMocks clears calls, not implementations — a test that makes stop()
  // throw would otherwise leak into the rest of the suite.
  openAIRealtimeToolkit.stop.mockImplementation(() => {})
  openAIRealtimeToolkit.requestMicrophonePermission.mockResolvedValue(true)
  // Plain property — clearAllMocks doesn't reset it.
  openAIRealtimeToolkit.initError = null
})

describe('credential validation', () => {
  it('throws when appId is empty or whitespace', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderProvider({ appId: '' })).toThrow('appId is required')
    expect(() => renderProvider({ appId: '   ' })).toThrow('appId is required')
    errSpy.mockRestore()
  })

  it('throws when appSecret is empty', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderProvider({ appSecret: '' })).toThrow('appSecret is required')
    errSpy.mockRestore()
  })

  it('throws when openAIApiKey is empty or whitespace', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderProvider({ openAIApiKey: '' })).toThrow('openAIApiKey is required')
    expect(() => renderProvider({ openAIApiKey: '   ' })).toThrow('openAIApiKey is required')
    errSpy.mockRestore()
  })
})

describe('mount', () => {
  it('initializes the engine with creds and the seeded settings', () => {
    renderProvider({ instructions: 'hi', localTurnHandling: { enabled: true, config: { duckGain: 0.1 } } })
    expect(openAIRealtimeToolkit.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'app-1',
        appSecret: 'secret-1',
        openAIApiKey: 'sk-1',
        instructions: 'hi',
        localTurnHandling: true,
        // Provider always drives the engine's 'custom' slot with resolved knob values.
        preset: 'custom',
        customKnobs: expect.objectContaining({
          bargeIn: expect.objectContaining({ duckGain: 0.1 }),
        }),
      })
    )
  })

  it('seeds the exposed context values from the props', () => {
    const { result } = renderProvider({ instructions: 'seeded', localTurnHandling: { enabled: true } })
    expect(result.current.instructions).toBe('seeded')
    expect(result.current.localTurnHandling.enabled).toBe(true)
    expect(result.current.isRunning).toBe(false)
    expect(result.current.connectionStatus).toBe('none')
  })

  it('seeds voice / speed / model from the props, defaulting to the node defaults', () => {
    const seeded = renderProvider({ voice: 'marin', speed: 1.25, model: 'gpt-realtime' })
    expect(seeded.result.current.voice).toBe('marin')
    expect(seeded.result.current.speed).toBe(1.25)
    expect(seeded.result.current.model).toBe('gpt-realtime')
    expect(openAIRealtimeToolkit.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ voice: 'marin', speed: 1.25, model: 'gpt-realtime' })
    )
    const defaults = renderProvider()
    expect(defaults.result.current.voice).toBe('cedar')
    expect(defaults.result.current.speed).toBe(1.0)
    expect(defaults.result.current.model).toBe('gpt-realtime-2')
  })

  it('clamps an out-of-range seeded speed', () => {
    const { result } = renderProvider({ speed: 4 })
    expect(result.current.speed).toBe(1.5)
  })

  it('seeds knob values from the prop', () => {
    const { result } = renderProvider({ localTurnHandling: { config: { duckGain: 0.1 } } })
    // The seeded knob applies; the rest fall back to their defaults.
    expect(result.current.localTurnHandling.config.duckGain).toBe(0.1)
    expect(result.current.localTurnHandling.config.pauseToleranceMs).toBe(0)
  })
})

describe('engine-level failures', () => {
  it("surfaces the engine's initError as `error` on mount instead of red-boxing", () => {
    openAIRealtimeToolkit.initError = 'Switchboard initialization failed: Invalid app secret'
    const { result } = renderProvider()
    expect(result.current.error).toBe('Switchboard initialization failed: Invalid app secret')
  })

  it('leaves `error` null when the engine initialized cleanly', () => {
    const { result } = renderProvider()
    expect(result.current.error).toBeNull()
  })

  it('keeps isRunning true and reports why when stop() is refused', async () => {
    openAIRealtimeToolkit.stop.mockImplementation(() => {
      throw new Error('Engine stop failed: Engine busy')
    })
    const { result } = renderProvider()
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.isRunning).toBe(true)
    act(() => result.current.stop())
    // Still running — the UI must not offer "Start" over a live mic.
    expect(result.current.isRunning).toBe(true)
    expect(result.current.error).toBe('Engine stop failed: Engine busy')
  })

  it('reports a start() failure by message, without the "Error:" prefix', async () => {
    openAIRealtimeToolkit.start.mockRejectedValue(new Error('Engine start failed: Audio session unavailable'))
    const { result } = renderProvider()
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.error).toBe('Engine start failed: Audio session unavailable')
    expect(result.current.isRunning).toBe(false)
  })
})

describe('OpenAI event → React state mapping', () => {
  it('maps session lifecycle events to connectionStatus', () => {
    const { result } = renderProvider()
    act(() => __emitOpenAI({ name: 'sessionStarting' }))
    expect(result.current.connectionStatus).toBe('connecting')
    act(() => __emitOpenAI({ name: 'sessionCreated' }))
    expect(result.current.connectionStatus).toBe('connected')
    act(() => __emitOpenAI({ name: 'error' }))
    expect(result.current.connectionStatus).toBe('error')
  })

  it('surfaces a session error message through `error`', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderProvider()
    act(() =>
      __emitOpenAI({
        name: 'error',
        data: { code: 'invalid_api_key', message: 'Incorrect API key provided: sk-…' },
        raw: '{"…":"…"}',
      })
    )
    expect(result.current.error).toBe('Incorrect API key provided: sk-…')
    expect(result.current.connectionStatus).toBe('error')
    warnSpy.mockRestore()
  })

  it('falls back to the raw payload when the session error carries no message', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderProvider()
    act(() => __emitOpenAI({ name: 'error', data: {}, raw: '{"code":"oops"}' }))
    expect(result.current.error).toBe('Session error: {"code":"oops"}')
    warnSpy.mockRestore()
  })

  it("keeps 'error' sticky across the node's reconnect attempts", () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderProvider()
    act(() => __emitOpenAI({ name: 'error', data: { message: 'bad key' } }))
    // The OpenAI node retries every few seconds; neither leg may hide the failure.
    act(() => __emitOpenAI({ name: 'sessionDisconnected' }))
    expect(result.current.connectionStatus).toBe('error')
    act(() => __emitOpenAI({ name: 'sessionStarting' }))
    expect(result.current.connectionStatus).toBe('error')
    expect(result.current.error).toBe('bad key')
    // A session that actually comes up is the only thing that clears it.
    act(() => __emitOpenAI({ name: 'sessionCreated' }))
    expect(result.current.connectionStatus).toBe('connected')
    expect(result.current.error).toBeNull()
    warnSpy.mockRestore()
  })

  it('maps input/response transcription events to the transcripts', () => {
    const { result } = renderProvider()
    act(() => __emitOpenAI({ name: 'inputTranscription', data: { transcript: 'hello' } }))
    expect(result.current.inputTranscription).toBe('hello')
    act(() => __emitOpenAI({ name: 'responseTranscription', data: { transcript: 'hi there' } }))
    expect(result.current.outputTranscription).toBe('hi there')
  })
})

describe('start', () => {
  it('gates on mic permission then marks the engine running', async () => {
    const { result } = renderProvider()
    await act(async () => {
      await result.current.start()
    })
    expect(openAIRealtimeToolkit.requestMicrophonePermission).toHaveBeenCalled()
    expect(openAIRealtimeToolkit.start).toHaveBeenCalled()
    expect(result.current.isRunning).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('sets an error and stays stopped when mic permission is denied', async () => {
    openAIRealtimeToolkit.requestMicrophonePermission.mockResolvedValue(false)
    const { result } = renderProvider()
    await act(async () => {
      await result.current.start()
    })
    expect(openAIRealtimeToolkit.start).not.toHaveBeenCalled()
    expect(result.current.isRunning).toBe(false)
    expect(result.current.error).toBe('Microphone permission denied')
  })

  it('captures a thrown start error', async () => {
    openAIRealtimeToolkit.start.mockRejectedValue(new Error('engine boom'))
    const { result } = renderProvider()
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.isRunning).toBe(false)
    expect(result.current.error).toContain('engine boom')
  })
})

describe('requestMicrophonePermission', () => {
  it('degrades to denied (no crash) when the underlying check throws', async () => {
    // A rejected native permission call must be swallowed into "denied" rather
    // than propagating and tearing down the render tree.
    openAIRealtimeToolkit.requestMicrophonePermission.mockRejectedValue(new Error('no mic hardware'))
    const { result } = renderProvider()
    let granted: boolean | undefined
    await act(async () => {
      granted = await result.current.requestMicrophonePermission()
    })
    expect(granted).toBe(false)
    expect(result.current.hasMicrophonePermission).toBe(false)
  })
})

describe('stop', () => {
  it('clears running + connection state', async () => {
    const { result } = renderProvider()
    await act(async () => {
      await result.current.start()
    })
    act(() => __emitOpenAI({ name: 'sessionCreated' }))
    act(() => result.current.stop())
    expect(openAIRealtimeToolkit.stop).toHaveBeenCalled()
    expect(result.current.isRunning).toBe(false)
    expect(result.current.connectionStatus).toBe('none')
  })
})

describe('setters are reactive and delegate to the engine', () => {
  it('setInstructions updates the value and calls the engine', () => {
    const { result } = renderProvider()
    act(() => result.current.setInstructions('new prompt'))
    expect(result.current.instructions).toBe('new prompt')
    expect(openAIRealtimeToolkit.setInstructions).toHaveBeenCalledWith('new prompt')
  })

  it('setVoice updates the value and calls the engine', () => {
    const { result } = renderProvider()
    act(() => result.current.setVoice('verse'))
    expect(result.current.voice).toBe('verse')
    expect(openAIRealtimeToolkit.setVoice).toHaveBeenCalledWith('verse')
  })

  it('setSpeed clamps to the node range before exposing it and calling the engine', () => {
    const { result } = renderProvider()
    act(() => result.current.setSpeed(0.1))
    expect(result.current.speed).toBe(0.5)
    expect(openAIRealtimeToolkit.setSpeed).toHaveBeenCalledWith(0.5)
  })

  it('setEnabled updates the value and calls the engine', () => {
    const { result } = renderProvider()
    act(() => result.current.localTurnHandling.setEnabled(true))
    expect(result.current.localTurnHandling.enabled).toBe(true)
    expect(openAIRealtimeToolkit.setLocalTurnHandling).toHaveBeenCalledWith(true)
  })

  it('exposes the current numeric knob value', () => {
    const { result } = renderProvider()
    expect(result.current.localTurnHandling.config.pauseToleranceMs).toBe(0) // default
  })

  it('exposes the current enum knob value', () => {
    const { result } = renderProvider()
    expect(result.current.localTurnHandling.config.semanticStrategy).toBe('gate')
  })

  it('several setConfig() calls in one tick each land (no stale-snapshot clobber)', () => {
    const { result } = renderProvider()
    act(() => {
      result.current.localTurnHandling.setConfig({ vadThreshold: 0.7 })
      result.current.localTurnHandling.setConfig({ duckGain: 0 })
    })
    expect(result.current.localTurnHandling.config.vadThreshold).toBe(0.7)
    expect(result.current.localTurnHandling.config.duckGain).toBe(0)
  })

  it('setConfig() merges a partial patch over the current values and calls the engine', () => {
    const { result } = renderProvider({ localTurnHandling: { config: QUIET_CONFIG } })
    act(() => result.current.localTurnHandling.setConfig({ pauseToleranceMs: 3000 }))
    expect(result.current.localTurnHandling.config.pauseToleranceMs).toBe(3000)
    // quiet's other knobs preserved (it sets vadThreshold 0.4).
    expect(result.current.localTurnHandling.config.vadThreshold).toBe(0.4)
    expect(openAIRealtimeToolkit.setCustomKnobs).toHaveBeenCalled()
  })

  it('setConfig(FULL_PRESET) overwrites the whole set (selecting a preset)', () => {
    const { result } = renderProvider({ localTurnHandling: { config: QUIET_CONFIG } })
    expect(result.current.localTurnHandling.config.vadThreshold).toBe(0.4) // quiet
    act(() => result.current.localTurnHandling.setConfig(NOISY_CONFIG))
    expect(result.current.localTurnHandling.config.vadThreshold).toBe(0.6) // noisy
  })

  it('knobs reflects a preset passed as the seed', () => {
    const { result } = renderProvider({ localTurnHandling: { config: NOISY_CONFIG } })
    expect(result.current.localTurnHandling.config.vadThreshold).toBe(0.6)
  })

  it('setConfig() with no actual change is a no-op (no engine call)', () => {
    const { result } = renderProvider() // defaults: pauseToleranceMs = 0
    act(() => result.current.localTurnHandling.setConfig({ pauseToleranceMs: 0 }))
    expect(openAIRealtimeToolkit.setCustomKnobs).not.toHaveBeenCalled()
  })

  it('registerTool delegates straight to the engine', () => {
    const { result } = renderProvider()
    const tool = { name: 't', description: 'd', parameters: {}, handler: () => 1 }
    act(() => result.current.registerTool(tool))
    expect(openAIRealtimeToolkit.registerTool).toHaveBeenCalledWith(tool)
  })
})

describe('lifecycle', () => {
  it('removes the event subscription on unmount but does not stop the engine', () => {
    const { unmount } = renderProvider()
    expect(__hasOpenAIListener()).toBe(true)
    unmount()
    expect(__hasOpenAIListener()).toBe(false)
    expect(openAIRealtimeToolkit.stop).not.toHaveBeenCalled()
  })
})

describe('useOpenAIRealtimeToolkit outside a provider', () => {
  it('throws a helpful error', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useOpenAIRealtimeToolkit())).toThrow('must be used within an OpenAIRealtimeToolkitProvider')
    errSpy.mockRestore()
  })
})

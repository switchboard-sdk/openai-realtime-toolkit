jest.mock('./NativeOpenAIRealtimeToolkit')

import { PermissionsAndroid, Platform } from 'react-native'
import { createOpenAIRealtimeToolkit, type OpenAIRealtimeToolkit } from './OpenAIRealtimeToolkit'
import NativeOpenAIRealtimeToolkit from './NativeOpenAIRealtimeToolkit'
import { makeRpcResponse } from './test-helpers'

// Same-instance access to the manual mock's helpers (see NativeModuleRPCClient
// test for why importing the mock by path would be a second instance).
const mock = jest.requireMock('./NativeOpenAIRealtimeToolkit') as typeof import('./__mocks__/NativeOpenAIRealtimeToolkit')
const { emit, resetNativeMock } = mock

const native = NativeOpenAIRealtimeToolkit as unknown as {
  processCommand: jest.Mock<string, [string]>
  requestMicrophonePermission: jest.Mock<Promise<boolean>, []>
}

// OpenAIRealtimeToolkit is the orchestration layer that every consumer ultimately drives. It
// owns: what `switchboard.initialize` / `createEngine` get sent, how the single
// native event stream is classified into vad/smartTurn/openai channels, and the
// tool-call round-trip. These are exactly the seams that break when the
// Switchboard SDK's action names or event shapes change, so we assert them
// against the real SwitchboardClient → JSON-RPC → (mocked) native chain.

// ── Helpers to inspect / script the JSON-RPC channel ─────────────────────────

/** Every JSON-RPC request sent to the native channel, parsed. */
function sentCommands(): any[] {
  return native.processCommand.mock.calls.map(([json]) => JSON.parse(json))
}

/** The parsed request for a given callAction `actionName`, or undefined. */
function commandFor(actionName: string): any | undefined {
  return sentCommands().find(
    (c) => c.method === 'callAction' && c.params?.actionName === actionName
  )
}

/** setValue requests for a given objectURI + key. */
function setValuesFor(objectURI: string, key: string): any[] {
  return sentCommands().filter(
    (c) =>
      c.method === 'setValue' && c.params?.objectURI === objectURI && c.params?.key === key
  )
}

/**
 * Script `processCommand` by matched action/method so the return value depends
 * on what's being called (createEngine must return an id; everything else ok).
 */
function scriptNative(handler: (req: any) => string): void {
  native.processCommand.mockImplementation((json: string) => handler(JSON.parse(json)))
}

/** Default script: createEngine → engine id, everything else → null result. */
function happyPath(engineId = 'engine-1'): void {
  scriptNative((req) => {
    if (req.method === 'callAction' && req.params?.actionName === 'createEngine') {
      return makeRpcResponse(engineId)
    }
    return makeRpcResponse(null)
  })
}

const CREDS = {
  appId: 'app-123',
  appSecret: 'secret-456',
  openAIApiKey: 'sk-openai',
}

async function initializedEngine(): Promise<OpenAIRealtimeToolkit> {
  const ea = createOpenAIRealtimeToolkit()
  ea.initialize(CREDS)
  return ea
}

/** Emit a classified event as the native stream would deliver it (flat form). */
function emitEvent(objectURI: string, name: string, data?: unknown): void {
  emit(JSON.stringify({ objectURI, name, data }))
}

beforeEach(() => {
  resetNativeMock()
  happyPath()
})

describe('initialize', () => {
  it('sends switchboard.initialize with creds and all four extensions', () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    const cmd = commandFor('initialize')
    expect(cmd.params.objectURI).toBe('switchboard')
    expect(cmd.params.params.appID).toBe('app-123')
    expect(cmd.params.params.appSecret).toBe('secret-456')
    expect(cmd.params.params.extensions).toEqual({
      Silero: {},
      Onnx: {},
      SmartTurn: {},
      OpenAI: { apiKey: 'sk-openai' },
    })
  })

  it('is idempotent — a second initialize does not re-send', () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    const callsAfterFirst = native.processCommand.mock.calls.length
    ea.initialize({ ...CREDS, appId: 'other' })
    expect(native.processCommand.mock.calls.length).toBe(callsAfterFirst)
  })

  // Credential guards: a blank key must throw here (with a field-named error)
  // rather than reaching the SDK, which rejects appID/appSecret asynchronously
  // and only logs a bad OpenAI key — both silent from the caller's view.
  it.each([
    ['appId', { ...CREDS, appId: '' }],
    ['appId', { ...CREDS, appId: '   ' }],
    ['appSecret', { ...CREDS, appSecret: '' }],
    ['openAIApiKey', { ...CREDS, openAIApiKey: '' }],
    ['openAIApiKey', { ...CREDS, openAIApiKey: undefined as unknown as string }],
  ])('throws "%s is required" for a missing/blank %s', (field, creds) => {
    const ea = createOpenAIRealtimeToolkit()
    expect(() => ea.initialize(creds)).toThrow(`${field} is required`)
    // Nothing was sent to the SDK — the guard runs before the RPC call.
    expect(commandFor('initialize')).toBeUndefined()
  })

  it('surfaces an SDK error from switchboard.initialize instead of swallowing it', () => {
    scriptNative((req) => {
      if (req.method === 'callAction' && req.params?.actionName === 'initialize') {
        return makeRpcResponse(undefined, { code: -1, message: 'Missing appID in configuration.' })
      }
      return makeRpcResponse(null)
    })
    const ea = createOpenAIRealtimeToolkit()
    expect(() => ea.initialize(CREDS)).toThrow(/Switchboard initialization failed: Missing appID/)
  })

  it('leaves the engine uninitialized after an SDK error so a retry re-sends', () => {
    let fail = true
    scriptNative((req) => {
      if (req.method === 'callAction' && req.params?.actionName === 'initialize') {
        return fail ? makeRpcResponse(undefined, { code: -1, message: 'boom' }) : makeRpcResponse(null)
      }
      return makeRpcResponse(null)
    })
    const ea = createOpenAIRealtimeToolkit()
    expect(() => ea.initialize(CREDS)).toThrow(/Switchboard initialization failed/)
    fail = false
    // initialized stayed false → the second call actually re-sends and succeeds.
    expect(() => ea.initialize(CREDS)).not.toThrow()
    const initCalls = sentCommands().filter(
      (c) => c.method === 'callAction' && c.params?.actionName === 'initialize'
    )
    expect(initCalls.length).toBe(2)
  })

  it('re-adopts the live engine on reload instead of re-initializing or duplicating', async () => {
    // Simulate a JS reload: the native SDK is already initialized and still owns
    // a running engine.
    scriptNative((req) => {
      if (req.method === 'getValue' && req.params?.key === 'isInitialized') {
        return makeRpcResponse(true)
      }
      if (req.method === 'getValue' && req.params?.key === 'engines') {
        return makeRpcResponse(['engine-7'])
      }
      if (req.method === 'getValue' && req.params?.key === 'isRunning') {
        return makeRpcResponse(true)
      }
      if (req.method === 'callAction' && req.params?.actionName === 'createEngine') {
        return makeRpcResponse('engine-NEW')
      }
      return makeRpcResponse(null)
    })
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    // Already initialized natively → no re-initialize sent.
    expect(commandFor('initialize')).toBeUndefined()
    // Adopted the surviving engine and rehydrated its running state.
    expect(ea.isRunning).toBe(true)
    // A later start() reuses the adopted engine — never creates a second one.
    await ea.start()
    expect(commandFor('createEngine')).toBeUndefined()
  })
})

describe('start guards', () => {
  it('throws if initialize was never called', async () => {
    const ea = createOpenAIRealtimeToolkit()
    await expect(ea.start()).rejects.toThrow('initialize')
  })

  it('requests mic permission and throws when denied', async () => {
    native.requestMicrophonePermission.mockResolvedValue(false)
    const ea = await initializedEngine()
    await expect(ea.start()).rejects.toThrow('Microphone permission denied')
    // Engine was never created because permission gate failed first.
    expect(commandFor('createEngine')).toBeUndefined()
  })
})

describe('start builds and starts the engine', () => {
  it("sends turnDetection 'server_vad' when local turn detection is off", async () => {
    const ea = await initializedEngine()
    await ea.start()
    const engine = commandFor('createEngine').params.params
    const openai = engine.configuration.graph.nodes.find((n: any) => n.id === 'openAIRealtimeNode')
    expect(openai.configuration.turnDetection).toBe('server_vad')
    expect(engine.configuration.microphoneEnabled).toBe(true)
    expect(engine.configuration.voiceProcessingEnabled).toBe(true)
  })

  it("sends turnDetection 'none' when local turn detection is on", async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize({ ...CREDS, localTurnHandling: true })
    await ea.start()
    const engine = commandFor('createEngine').params.params
    const openai = engine.configuration.graph.nodes.find((n: any) => n.id === 'openAIRealtimeNode')
    expect(openai.configuration.turnDetection).toBe('none')
  })

  it('carries the seeded instructions and registered tool defs into the graph', async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize({ ...CREDS, instructions: 'be brief' })
    ea.registerTool({
      name: 'get_time',
      description: 'current time',
      parameters: { type: 'object' },
      handler: () => '12:00',
    })
    await ea.start()
    const openai = commandFor('createEngine').params.params.configuration.graph.nodes.find(
      (n: any) => n.id === 'openAIRealtimeNode'
    )
    expect(openai.configuration.instructions).toBe('be brief')
    expect(openai.configuration.tools).toEqual([
      { type: 'function', name: 'get_time', description: 'current time', parameters: { type: 'object' } },
    ])
  })

  it('starts the engine after creating it', async () => {
    const ea = await initializedEngine()
    await ea.start()
    // The engine id returned by createEngine is the objectURI of the start call.
    const startCmd = sentCommands().find(
      (c) => c.method === 'callAction' && c.params.actionName === 'start' && c.params.objectURI === 'engine-1'
    )
    expect(startCmd).toBeDefined()
  })

  it('throws with the error body when createEngine returns no id', async () => {
    scriptNative((req) => {
      if (req.method === 'callAction' && req.params?.actionName === 'createEngine') {
        return makeRpcResponse(undefined, { code: -1, message: 'bad graph' })
      }
      return makeRpcResponse(null)
    })
    const ea = await initializedEngine()
    await expect(ea.start()).rejects.toThrow(/createEngine failed/)
  })

  it('applies the active preset knobs to the graph after start', async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize({ ...CREDS, localTurnHandling: true, preset: 'noisy' })
    await ea.start()
    // noisy preset → vadThreshold 'noisy' → VAD threshold 0.6.
    const vadWrites = setValuesFor('sileroVADNode', 'threshold')
    expect(vadWrites[vadWrites.length - 1].params.value).toBe(0.6)
    // vadSilenceMs isn't overridden by noisy → falls back to its 500ms default.
    const silenceWrites = setValuesFor('sileroVADNode', 'minSilenceDurationMs')
    expect(silenceWrites[silenceWrites.length - 1].params.value).toBe(500)
    // The ramp duration is written to the gain node from the barge-in config.
    expect(setValuesFor('aiGainNode', 'rampDurationMs').length).toBeGreaterThan(0)
  })
})

describe('setInstructions', () => {
  it('is stored (not sent) when not running, then baked into the next start', async () => {
    const ea = await initializedEngine()
    ea.setInstructions('updated')
    expect(setValuesFor('openAIRealtimeNode', 'instructions').length).toBe(0)
    await ea.start()
    const openai = commandFor('createEngine').params.params.configuration.graph.nodes.find(
      (n: any) => n.id === 'openAIRealtimeNode'
    )
    expect(openai.configuration.instructions).toBe('updated')
  })

  it('is applied live via setValue while running', async () => {
    const ea = await initializedEngine()
    await ea.start()
    ea.setInstructions('live update')
    const writes = setValuesFor('openAIRealtimeNode', 'instructions')
    expect(writes[writes.length - 1].params.value).toBe('live update')
  })
})

describe('setLocalTurnHandling', () => {
  it('is a no-op when the value is unchanged', async () => {
    const ea = await initializedEngine()
    await ea.start()
    const before = native.processCommand.mock.calls.length
    ea.setLocalTurnHandling(false) // already false
    expect(native.processCommand.mock.calls.length).toBe(before)
  })

  it('flips turnDetection live without rebuilding the engine', async () => {
    const ea = await initializedEngine()
    await ea.start()
    const createEnginesBefore = sentCommands().filter(
      (c) => c.params?.actionName === 'createEngine'
    ).length
    ea.setLocalTurnHandling(true)
    const writes = setValuesFor('openAIRealtimeNode', 'turnDetection')
    expect(writes[writes.length - 1].params.value).toBe('none')
    // No second createEngine — the switch happens in place.
    const createEnginesAfter = sentCommands().filter(
      (c) => c.params?.actionName === 'createEngine'
    ).length
    expect(createEnginesAfter).toBe(createEnginesBefore)
  })

  it('is only stored (applied at next start) when not running', async () => {
    const ea = await initializedEngine()
    ea.setLocalTurnHandling(true)
    expect(setValuesFor('openAIRealtimeNode', 'turnDetection').length).toBe(0)
    await ea.start()
    const openai = commandFor('createEngine').params.params.configuration.graph.nodes.find(
      (n: any) => n.id === 'openAIRealtimeNode'
    )
    expect(openai.configuration.turnDetection).toBe('none')
  })
})

describe('setPreset', () => {
  it('is a no-op when unchanged', async () => {
    const ea = await initializedEngine()
    await ea.start()
    const before = native.processCommand.mock.calls.length
    ea.setPreset('balanced') // default is balanced
    expect(native.processCommand.mock.calls.length).toBe(before)
  })

  it('re-applies preset knobs live when running', async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize({ ...CREDS, localTurnHandling: true })
    await ea.start()
    ea.setPreset('quiet')
    // quiet preset → vadThreshold 'room' → VAD threshold 0.4.
    const vadWrites = setValuesFor('sileroVADNode', 'threshold')
    expect(vadWrites[vadWrites.length - 1].params.value).toBe(0.4)
  })

  it('is stored (not applied) when set before running, then used at next start', async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize({ ...CREDS, localTurnHandling: true })
    ea.setPreset('quiet')
    // Not running yet → nothing applied to the graph.
    expect(setValuesFor('sileroVADNode', 'threshold').length).toBe(0)
    await ea.start()
    // start() picks up the stored preset → quiet → vadThreshold 'room' → 0.4.
    const vadWrites = setValuesFor('sileroVADNode', 'threshold')
    expect(vadWrites[vadWrites.length - 1].params.value).toBe(0.4)
  })
})

describe('custom preset', () => {
  it("resolves from customKnobs when preset is 'custom'", async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize({
      ...CREDS,
      localTurnHandling: true,
      preset: 'custom',
      customKnobs: { turnDetection: { vadThreshold: 0.7 } },
    })
    await ea.start()
    // custom → vadThreshold 0.7 → VAD threshold 0.7 (not the balanced default 0.5).
    const vadWrites = setValuesFor('sileroVADNode', 'threshold')
    expect(vadWrites[vadWrites.length - 1].params.value).toBe(0.7)
  })

  it("empty customKnobs on 'custom' matches the balanced defaults", async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize({ ...CREDS, localTurnHandling: true, preset: 'custom' })
    await ea.start()
    // {} → all defaults → vadThreshold 'balanced' → 0.5.
    const vadWrites = setValuesFor('sileroVADNode', 'threshold')
    expect(vadWrites[vadWrites.length - 1].params.value).toBe(0.5)
  })

  it("re-applies live when 'custom' is the active preset", async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize({ ...CREDS, localTurnHandling: true, preset: 'custom' })
    await ea.start()
    ea.setCustomKnobs({ turnDetection: { vadThreshold: 0.3 } })
    // vadThreshold 0.3.
    const vadWrites = setValuesFor('sileroVADNode', 'threshold')
    expect(vadWrites[vadWrites.length - 1].params.value).toBe(0.3)
  })

  it('is stored (not applied) when a named preset is active', async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize({ ...CREDS, localTurnHandling: true, preset: 'balanced' })
    await ea.start()
    const before = setValuesFor('sileroVADNode', 'threshold').length
    ea.setCustomKnobs({ turnDetection: { vadThreshold: 0.7 } })
    // Not active → no new graph write until 'custom' is selected.
    expect(setValuesFor('sileroVADNode', 'threshold').length).toBe(before)
    ea.setPreset('custom')
    const vadWrites = setValuesFor('sileroVADNode', 'threshold')
    expect(vadWrites[vadWrites.length - 1].params.value).toBe(0.7)
  })
})

describe('registerTool', () => {
  it('applies tools live via setValue when running', async () => {
    const ea = await initializedEngine()
    await ea.start()
    ea.registerTool({
      name: 'a',
      description: 'd',
      parameters: {},
      handler: () => 1,
    })
    const writes = setValuesFor('openAIRealtimeNode', 'tools')
    expect(writes.length).toBeGreaterThan(0)
    expect(writes[writes.length - 1].params.value).toEqual([
      { type: 'function', name: 'a', description: 'd', parameters: {} },
    ])
  })

  it('re-registering the same name replaces the previous tool', async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    ea.registerTool({ name: 'x', description: 'first', parameters: {}, handler: () => 1 })
    ea.registerTool({ name: 'x', description: 'second', parameters: {}, handler: () => 2 })
    await ea.start()
    const tools = commandFor('createEngine').params.params.configuration.graph.nodes.find(
      (n: any) => n.id === 'openAIRealtimeNode'
    ).configuration.tools
    expect(tools).toHaveLength(1)
    expect(tools[0].description).toBe('second')
  })

  it('unregisterTool removes the tool and re-pushes the remaining set when running', async () => {
    const ea = await initializedEngine()
    await ea.start()
    ea.registerTool({ name: 'a', description: 'd', parameters: {}, handler: () => 1 })
    ea.registerTool({ name: 'b', description: 'd', parameters: {}, handler: () => 2 })
    ea.unregisterTool('a')
    const writes = setValuesFor('openAIRealtimeNode', 'tools')
    const last = writes[writes.length - 1].params.value
    expect(last.map((t: any) => t.name)).toEqual(['b'])
  })

  it('unregisterTool is a no-op for an unknown name (no extra setValue write)', async () => {
    const ea = await initializedEngine()
    await ea.start()
    ea.registerTool({ name: 'a', description: 'd', parameters: {}, handler: () => 1 })
    const before = setValuesFor('openAIRealtimeNode', 'tools').length
    ea.unregisterTool('does-not-exist')
    expect(setValuesFor('openAIRealtimeNode', 'tools').length).toBe(before)
  })

  it('emits an empty object schema for a tool registered without parameters', async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    ea.registerTool({ name: 'noargs', description: 'd', handler: () => 1 })
    await ea.start()
    const tools = commandFor('createEngine').params.params.configuration.graph.nodes.find(
      (n: any) => n.id === 'openAIRealtimeNode'
    ).configuration.tools
    expect(tools[0].parameters).toEqual({ type: 'object', properties: {}, additionalProperties: false })
  })
})

describe('event dispatch and classification', () => {
  it('classifies a dotted node URI by its last segment', () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    const openaiEvents: any[] = []
    ea.addEventListener('openai', (e) => openaiEvents.push(e))
    emitEvent('engine-1.openAIRealtimeNode', 'sessionCreated')
    expect(openaiEvents).toHaveLength(1)
    expect(openaiEvents[0].type).toBe('openai')
    expect(openaiEvents[0].name).toBe('sessionCreated')
  })

  it('drops events from unknown nodes', () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    const seen: any[] = []
    ea.addEventListener('vad', (e) => seen.push(e))
    ea.addEventListener('smartTurn', (e) => seen.push(e))
    ea.addEventListener('openai', (e) => seen.push(e))
    emitEvent('engine-1.someRandomNode', 'whatever')
    expect(seen).toHaveLength(0)
  })

  it('handles the {params: event} envelope form', () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    const vadEvents: any[] = []
    ea.addEventListener('vad', (e) => vadEvents.push(e))
    emit(JSON.stringify({ params: { objectURI: 'x.sileroVADNode', name: 'speechStarted' } }))
    expect(vadEvents).toHaveLength(1)
    expect(vadEvents[0].name).toBe('speechStarted')
  })

  it('falls back to eventName when name is absent (SDK event-shape compat)', () => {
    // The dispatch reads `e.name ?? e.eventName`; some SDK events arrive with
    // `eventName`. If that fallback regresses, these events surface with an
    // empty name and break the provider's status/transcript switch.
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    const openai: any[] = []
    ea.addEventListener('openai', (e) => openai.push(e))
    emit(JSON.stringify({ objectURI: 'x.openAIRealtimeNode', eventName: 'sessionCreated' }))
    expect(openai).toHaveLength(1)
    expect(openai[0].name).toBe('sessionCreated')
  })

  it('swallows malformed JSON without throwing', () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    expect(() => emit('{not valid json')).not.toThrow()
  })

  it('fans out only to the matching channel', () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    const vad: any[] = []
    const openai: any[] = []
    ea.addEventListener('vad', (e) => vad.push(e))
    ea.addEventListener('openai', (e) => openai.push(e))
    emitEvent('x.sileroVADNode', 'speechStarted')
    expect(vad).toHaveLength(1)
    expect(openai).toHaveLength(0)
  })

  it('stops delivering to a listener after remove()', () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    const seen: any[] = []
    const sub = ea.addEventListener('openai', (e) => seen.push(e))
    emitEvent('x.openAIRealtimeNode', 'sessionCreated')
    sub.remove()
    emitEvent('x.openAIRealtimeNode', 'sessionCreated')
    expect(seen).toHaveLength(1)
  })
})

describe('tool-call handling', () => {
  function emitToolCall(name: string, argumentsJson: string, callId = 'call-1'): void {
    emitEvent('x.openAIRealtimeNode', 'toolCall', { callId, name, argumentsJson })
  }

  it('submits an error for an unknown tool, then always creates a response', async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    emitToolCall('nope', '{}')
    await Promise.resolve() // let the async handler settle
    await Promise.resolve()
    expect(commandFor('submitToolError')).toBeDefined()
    expect(commandFor('submitToolResult')).toBeUndefined()
    expect(commandFor('createResponse')).toBeDefined()
  })

  it('runs the handler and submits its result JSON-encoded', async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    const handler = jest.fn((args: any) => ({ echo: args.q }))
    ea.registerTool({ name: 'echo', description: 'd', parameters: {}, handler })
    emitToolCall('echo', '{"q":"hi"}')
    await flushMicrotasks()
    expect(handler).toHaveBeenCalledWith({ q: 'hi' })
    const submit = commandFor('submitToolResult')
    expect(submit.params.params.outputJson).toBe(JSON.stringify({ echo: 'hi' }))
    expect(commandFor('createResponse')).toBeDefined()
  })

  it('passes {} to the handler when argumentsJson is empty', async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    const handler = jest.fn(() => 'ok')
    ea.registerTool({ name: 'noargs', description: 'd', parameters: {}, handler })
    emitToolCall('noargs', '')
    await flushMicrotasks()
    expect(handler).toHaveBeenCalledWith({})
  })

  it('submits a tool error when the handler throws', async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    ea.registerTool({
      name: 'boom',
      description: 'd',
      parameters: {},
      handler: () => {
        throw new Error('kaboom')
      },
    })
    emitToolCall('boom', '{}')
    await flushMicrotasks()
    expect(commandFor('submitToolError')).toBeDefined()
    expect(commandFor('submitToolResult')).toBeUndefined()
    expect(commandFor('createResponse')).toBeDefined()
  })
})

describe('vad edges drive the turn controller', () => {
  it('forwards speechStarted while local turn detection is armed (ducks the AI)', async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize({ ...CREDS, localTurnHandling: true })
    await ea.start()
    const gainWritesBefore = setValuesFor('aiGainNode', 'gain').length
    emitEvent('x.sileroVADNode', 'speechStarted')
    // The controller ducks immediately on speech start → a gain write appears.
    expect(setValuesFor('aiGainNode', 'gain').length).toBeGreaterThan(gainWritesBefore)
  })

  it('forwards both speech edges and still fans them out to vad listeners', async () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize({ ...CREDS, localTurnHandling: true })
    await ea.start()
    const vad: string[] = []
    ea.addEventListener('vad', (e) => vad.push(e.name))
    emitEvent('x.sileroVADNode', 'speechStarted')
    emitEvent('x.sileroVADNode', 'speechEnded')
    expect(vad).toEqual(['speechStarted', 'speechEnded'])
  })
})

describe('requestMicrophonePermission', () => {
  let originalOS: typeof Platform.OS

  beforeEach(() => {
    originalOS = Platform.OS
  })
  afterEach(() => {
    Platform.OS = originalOS
    jest.restoreAllMocks()
  })

  it('delegates to the native module on iOS', async () => {
    Platform.OS = 'ios'
    native.requestMicrophonePermission.mockResolvedValue(true)
    const ea = createOpenAIRealtimeToolkit()
    expect(await ea.requestMicrophonePermission()).toBe(true)
    expect(native.requestMicrophonePermission).toHaveBeenCalled()
  })

  it('uses PermissionsAndroid on Android and maps GRANTED → true', async () => {
    Platform.OS = 'android'
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED)
    const ea = createOpenAIRealtimeToolkit()
    expect(await ea.requestMicrophonePermission()).toBe(true)
    expect(PermissionsAndroid.request).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    )
  })

  it('returns false on Android when permission is not granted', async () => {
    Platform.OS = 'android'
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED)
    const ea = createOpenAIRealtimeToolkit()
    expect(await ea.requestMicrophonePermission()).toBe(false)
  })
})

describe('stop', () => {
  it('is a no-op when never started', () => {
    const ea = createOpenAIRealtimeToolkit()
    ea.initialize(CREDS)
    expect(() => ea.stop()).not.toThrow()
    expect(commandFor('stop')).toBeUndefined()
  })

  it('stops the running engine', async () => {
    const ea = await initializedEngine()
    await ea.start()
    ea.stop()
    const stopCmd = sentCommands().find(
      (c) => c.method === 'callAction' && c.params.actionName === 'stop' && c.params.objectURI === 'engine-1'
    )
    expect(stopCmd).toBeDefined()
  })
})

// Flush the promise chain in handleToolCall (handler await + two callAction awaits).
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

import { createLocalTurnController, type LocalTurnController, type LocalTurnNodes } from './LocalTurnController'
import {
  type ResolvedBargeIn,
  type ResolvedTurnDetection,
} from './turnDetection'
import { mockSwitchboardClient, stubInferProbability, type MockSwitchboardClient } from './test-helpers'

// Advance timers well past any real delay to prove a disabled (Infinity) timer never
// fires — you can't advanceTimersByTime(Infinity), so use a large finite value.
const FAR_FUTURE_MS = 10 * 60_000

// The on-device turn-taking state machine: SileroVAD speech edges in, ducking /
// pause / cancel / commit actions out, all gated on timers + SmartTurn's verdict.
// A regression here manifests as the assistant talking over the user, cutting
// them off, or never responding — none of which a type-check would catch. We
// drive it purely through the public speech-edge + timer API (never private
// fields), asserting the observable RPC actions.

const NODES: LocalTurnNodes = { ai: 'ai', smartTurn: 'st', gain: 'gain' }

// Hand-built resolved configs so each test tunes exactly the knobs it exercises,
// independent of the option→value tables in turnDetection.ts.
function turnCfg(overrides: Partial<ResolvedTurnDetection> = {}): ResolvedTurnDetection {
  return {
    vadThreshold: 0.5,
    vadSilenceMs: 500,
    minInputMs: 600,
    silenceHoldMs: 1000,
    semanticStrategy: 'gate',
    minSemanticConfidence: 0.2,
    maxSemanticConfidence: 0.9,
    thresholdBreakpointMs: 2000,
    semanticFailTimeoutMs: Infinity,
    ...overrides,
  }
}

function bargeCfg(overrides: Partial<ResolvedBargeIn> = {}): ResolvedBargeIn {
  return {
    // pause / cancel default to disabled so decision tests aren't polluted by
    // barge-in timers firing mid-advance; tests that need them override.
    pauseAfterMs: Infinity,
    cancelAfterMs: Infinity,
    duckGain: 0.3,
    duckRampMs: 100,
    commitBehavior: 'cancel',
    ...overrides,
  }
}

let now = 0

function makeController(
  turn: Partial<ResolvedTurnDetection> = {},
  barge: Partial<ResolvedBargeIn> = {}
): { controller: LocalTurnController; client: MockSwitchboardClient } {
  const client = mockSwitchboardClient()
  const controller = createLocalTurnController(client, NODES, turnCfg(turn), bargeCfg(barge))
  return { controller, client }
}

/** Action names sent to the AI node, in call order. */
function aiActions(client: MockSwitchboardClient): string[] {
  return client.callAction.mock.calls
    .filter(([uri]) => uri === NODES.ai)
    .map(([, action]) => action)
}

/** The final gain value written (ducking / unducking). */
function lastGain(client: MockSwitchboardClient): number | undefined {
  const gainWrites = client.setValue.mock.calls.filter(([uri]) => uri === NODES.gain)
  return gainWrites.length ? gainWrites[gainWrites.length - 1]![2] : undefined
}

beforeEach(() => {
  jest.useFakeTimers()
  now = 0
  jest.spyOn(Date, 'now').mockImplementation(() => now)
})

afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('disabled controller', () => {
  it('ignores speech edges when never enabled', () => {
    const { controller, client } = makeController()
    controller.onSpeechStart()
    controller.onSpeechEnd()
    jest.advanceTimersByTime(FAR_FUTURE_MS)
    expect(client.setValue).not.toHaveBeenCalled()
    expect(client.callAction).not.toHaveBeenCalled()
  })
})

describe('barge-in on speech start', () => {
  it('ducks the AI immediately', () => {
    const { controller, client } = makeController()
    controller.setEnabled(true)
    controller.onSpeechStart()
    expect(client.setValue).toHaveBeenCalledWith(NODES.gain, 'gain', 0.3)
  })

  it('fires pauseOutput after the pause delay, not before', () => {
    const { controller, client } = makeController({}, { pauseAfterMs: 800 })
    controller.setEnabled(true)
    controller.onSpeechStart()
    jest.advanceTimersByTime(799)
    expect(aiActions(client)).not.toContain('pauseOutput')
    jest.advanceTimersByTime(1)
    expect(aiActions(client)).toContain('pauseOutput')
  })

  it('fires cancelResponse after the cancel delay', () => {
    const { controller, client } = makeController({}, { cancelAfterMs: 8000 })
    controller.setEnabled(true)
    controller.onSpeechStart()
    jest.advanceTimersByTime(8000)
    expect(aiActions(client)).toContain('cancelResponse')
  })

  it('never schedules pause/cancel when their delay is Infinity (disabled)', () => {
    const { controller, client } = makeController({}, { pauseAfterMs: Infinity, cancelAfterMs: Infinity })
    controller.setEnabled(true)
    controller.onSpeechStart()
    jest.advanceTimersByTime(FAR_FUTURE_MS)
    expect(aiActions(client)).not.toContain('pauseOutput')
    expect(aiActions(client)).not.toContain('cancelResponse')
  })

  it('does not touch the gain when duck strength is none (gain 1.0)', () => {
    // duckGain 'none' resolves to duckGain 1.0 — the AI must stay at full
    // volume, so no gain write should happen on speech start.
    const { controller, client } = makeController({}, { duckGain: 1.0 })
    controller.setEnabled(true)
    controller.onSpeechStart()
    const gainWrites = client.setValue.mock.calls.filter(([uri]) => uri === NODES.gain)
    expect(gainWrites).toHaveLength(0)
  })
})

// Helper: run a full utterance and advance through the silence hold.
function speakAndHold(
  controller: LocalTurnController,
  { durationMs, holdMs = 1000 }: { durationMs: number; holdMs?: number }
): void {
  now = 1000
  controller.onSpeechStart()
  now = 1000 + durationMs
  controller.onSpeechEnd()
  jest.advanceTimersByTime(holdMs)
}

describe('silence-hold commit decision', () => {
  it('gate: commits only when length OK and semantic OK', () => {
    const { controller, client } = makeController({ semanticStrategy: 'gate' })
    stubInferProbability(client, 0.95) // >= max confidence 0.9
    controller.setEnabled(true)
    speakAndHold(controller, { durationMs: 3000 }) // long → uses max threshold, lengthOk
    expect(aiActions(client)).toContain('commitAudioBuffer')
  })

  it('gate: does not commit when semantic fails despite length OK', () => {
    const { controller, client } = makeController({ semanticStrategy: 'gate' })
    stubInferProbability(client, 0.5) // < max confidence 0.9
    controller.setEnabled(true)
    speakAndHold(controller, { durationMs: 3000 }) // long → max threshold not met
    expect(aiActions(client)).not.toContain('commitAudioBuffer')
  })

  it('gate: does not commit when the utterance is too short', () => {
    const { controller, client } = makeController({ semanticStrategy: 'gate' })
    stubInferProbability(client, 0.99)
    controller.setEnabled(true)
    speakAndHold(controller, { durationMs: 300 }) // < minInputMs 600
    expect(aiActions(client)).not.toContain('commitAudioBuffer')
  })

  it('rescue: commits on length even when semantic fails', () => {
    const { controller, client } = makeController({ semanticStrategy: 'rescue' })
    stubInferProbability(client, 0.0) // semantic fails
    controller.setEnabled(true)
    speakAndHold(controller, { durationMs: 3000 }) // lengthOk → rescue commits
    expect(aiActions(client)).toContain('commitAudioBuffer')
  })

  it('rescue: commits on semantic even when too short', () => {
    const { controller, client } = makeController({ semanticStrategy: 'rescue' })
    stubInferProbability(client, 0.99) // semantic passes
    controller.setEnabled(true)
    speakAndHold(controller, { durationMs: 100 }) // lengthOk false, semanticOk → commit
    expect(aiActions(client)).toContain('commitAudioBuffer')
  })

  it('off: commits on length alone and never calls SmartTurn infer', () => {
    const { controller, client } = makeController({ semanticStrategy: 'off' })
    controller.setEnabled(true)
    speakAndHold(controller, { durationMs: 3000 }) // lengthOk
    expect(aiActions(client)).toContain('commitAudioBuffer')
    // 'off' short-circuits the semantic check → no infer call.
    expect(client.callAction).not.toHaveBeenCalledWith(NODES.smartTurn, 'infer', expect.anything())
    expect(client.callAction).not.toHaveBeenCalledWith(NODES.smartTurn, 'infer')
  })

  it('off: does not commit when too short', () => {
    const { controller, client } = makeController({ semanticStrategy: 'off' })
    controller.setEnabled(true)
    speakAndHold(controller, { durationMs: 300 }) // < minInputMs
    expect(aiActions(client)).not.toContain('commitAudioBuffer')
  })
})

describe('semantic threshold picks by utterance length', () => {
  // prob 0.5 sits between minSemanticConfidence 0.2 and maxSemanticConfidence 0.9.
  it('short utterance uses the (lower) min confidence → passes', () => {
    const { controller, client } = makeController({ semanticStrategy: 'gate' })
    stubInferProbability(client, 0.5)
    controller.setEnabled(true)
    // duration 1500 < breakpoint 2000 → min threshold 0.2; 0.5 >= 0.2 → commit.
    speakAndHold(controller, { durationMs: 1500 })
    expect(aiActions(client)).toContain('commitAudioBuffer')
  })

  it('long utterance uses the (higher) max confidence → fails', () => {
    const { controller, client } = makeController({ semanticStrategy: 'gate' })
    stubInferProbability(client, 0.5)
    controller.setEnabled(true)
    // duration 2500 >= breakpoint 2000 → max threshold 0.9; 0.5 < 0.9 → no commit.
    speakAndHold(controller, { durationMs: 2500 })
    expect(aiActions(client)).not.toContain('commitAudioBuffer')
  })

  it('measures duration at speech-end, not inflated by the silence-hold wait', () => {
    const { controller, client } = makeController({ semanticStrategy: 'gate' })
    stubInferProbability(client, 0.5)
    controller.setEnabled(true)
    now = 1000
    controller.onSpeechStart()
    now = 1000 + 1500 // 1500ms utterance → short branch
    controller.onSpeechEnd()
    now = 100000 // lots of wall-clock passes during the hold
    jest.advanceTimersByTime(1000)
    // If duration were remeasured now (huge), it'd be the long branch and fail;
    // committing proves the 1500ms speech-end value was used.
    expect(aiActions(client)).toContain('commitAudioBuffer')
  })
})

describe('cancel-fired forces a commit', () => {
  it('commits even when both length and semantic checks fail', () => {
    const { controller, client } = makeController(
      { semanticStrategy: 'gate' },
      { cancelAfterMs: 5000 }
    )
    stubInferProbability(client, 0.0)
    controller.setEnabled(true)
    now = 1000
    controller.onSpeechStart()
    jest.advanceTimersByTime(5000) // cancel fires → response is gone
    expect(aiActions(client)).toContain('cancelResponse')
    now = 1100 // tiny utterance → lengthOk false
    controller.onSpeechEnd()
    jest.advanceTimersByTime(1000)
    // Response was pre-emptively cancelled, so a commit is forced to get a reply.
    expect(aiActions(client)).toContain('commitAudioBuffer')
  })
})

describe('fallback commit', () => {
  it('schedules a fallback commit for a length-OK but semantic-rejected turn', () => {
    const { controller, client } = makeController({
      semanticStrategy: 'gate',
      semanticFailTimeoutMs: 3000,
    })
    stubInferProbability(client, 0.0) // semantic fails
    controller.setEnabled(true)
    speakAndHold(controller, { durationMs: 3000 }) // lengthOk, semantic rejected
    // Not committed yet — waiting out the fallback window.
    expect(aiActions(client)).not.toContain('commitAudioBuffer')
    jest.advanceTimersByTime(3000)
    expect(aiActions(client)).toContain('commitAudioBuffer')
  })

  it('does not schedule a fallback commit when the timeout is Infinity (disabled)', () => {
    const { controller, client } = makeController({
      semanticStrategy: 'gate',
      semanticFailTimeoutMs: Infinity,
    })
    stubInferProbability(client, 0.0)
    controller.setEnabled(true)
    speakAndHold(controller, { durationMs: 3000 })
    jest.advanceTimersByTime(FAR_FUTURE_MS)
    expect(aiActions(client)).not.toContain('commitAudioBuffer')
  })
})

describe('commit action sequence', () => {
  it("commitBehavior 'cancel' emits truncate → cancel → clear → commit in order", () => {
    const { controller, client } = makeController(
      { semanticStrategy: 'off' },
      { commitBehavior: 'cancel' }
    )
    controller.setEnabled(true)
    speakAndHold(controller, { durationMs: 3000 })
    const actions = aiActions(client)
    // The four commit actions appear first, in this exact order (resumeOutput follows).
    expect(actions.slice(0, 4)).toEqual([
      'truncateResponse',
      'cancelResponse',
      'clearOutputBuffer',
      'commitAudioBuffer',
    ])
  })

  it("commitBehavior 'finish' emits only commitAudioBuffer", () => {
    const { controller, client } = makeController(
      { semanticStrategy: 'off' },
      { commitBehavior: 'finish' }
    )
    controller.setEnabled(true)
    speakAndHold(controller, { durationMs: 3000 })
    const actions = aiActions(client)
    expect(actions).toContain('commitAudioBuffer')
    expect(actions).not.toContain('truncateResponse')
    expect(actions).not.toContain('cancelResponse')
    expect(actions).not.toContain('clearOutputBuffer')
  })
})

describe('resume + unduck after a decision', () => {
  it('resumes output and unducks even for a rejected blip', () => {
    const { controller, client } = makeController({ semanticStrategy: 'gate' })
    stubInferProbability(client, 0.0)
    controller.setEnabled(true)
    speakAndHold(controller, { durationMs: 100 }) // too short → rejected
    expect(aiActions(client)).not.toContain('commitAudioBuffer')
    expect(aiActions(client)).toContain('resumeOutput')
    expect(lastGain(client)).toBe(1.0) // unducked back to full volume
  })
})

describe('barge-in restart', () => {
  it('a new speech start before the hold cancels the pending commit', () => {
    const { controller, client } = makeController({ semanticStrategy: 'off' })
    controller.setEnabled(true)
    now = 1000
    controller.onSpeechStart()
    now = 4000
    controller.onSpeechEnd() // schedules silenceHold
    controller.onSpeechStart() // user resumed → should clear the pending hold
    jest.advanceTimersByTime(1000)
    expect(aiActions(client)).not.toContain('commitAudioBuffer')
  })
})

describe('reset', () => {
  it('cancels all pending timers so nothing fires afterwards', () => {
    const { controller, client } = makeController({}, { pauseAfterMs: 800, cancelAfterMs: 5000 })
    controller.setEnabled(true)
    now = 1000
    controller.onSpeechStart()
    now = 3000
    controller.onSpeechEnd()
    controller.reset()
    client.callAction.mockClear()
    jest.advanceTimersByTime(FAR_FUTURE_MS)
    expect(client.callAction).not.toHaveBeenCalled()
  })
})

describe('setEnabled(false)', () => {
  it('resets timers and unducks the AI back to full volume', () => {
    const { controller, client } = makeController({}, { pauseAfterMs: 800 })
    controller.setEnabled(true)
    controller.onSpeechStart() // ducks to 0.3, schedules pause
    controller.setEnabled(false)
    expect(lastGain(client)).toBe(1.0)
    // The pending pause timer was cancelled by the reset inside setEnabled(false).
    client.callAction.mockClear()
    jest.advanceTimersByTime(FAR_FUTURE_MS)
    expect(client.callAction).not.toHaveBeenCalled()
  })
})

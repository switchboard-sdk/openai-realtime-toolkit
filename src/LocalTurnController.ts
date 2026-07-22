import type { SwitchboardClient } from './SwitchboardClient'
import { type ResolvedBargeIn, type ResolvedTurnDetection } from './turnDetection'

/** Graph node ids the controller drives. */
export interface LocalTurnNodes {
  /** OpenAI.Realtime node. */
  ai: string
  /** SmartTurn.Turn node (semantic turn-end inference). */
  smartTurn: string
  /** Switchboard.Gain node after the AI node (ducking). */
  gain: string
}

/** The turn controller's public surface (what {@link createLocalTurnController} returns). */
export type LocalTurnController = ReturnType<typeof createLocalTurnController>

/**
 * On-device turn-taking, active only when OpenAIRealtimeToolkit runs with `localTurnHandling`
 * (OpenAI's `server_vad` off). SileroVAD speech edges drive it:
 *
 *   • speech start → barge-in: duck the AI now, then pause / cancel its
 *     in-flight response on their configured delays.
 *   • speech end   → after a silence-hold, decide the turn is complete from
 *     utterance length + SmartTurn's semantic verdict, and if so commit the
 *     user's audio (which also asks OpenAI for a response).
 *
 * The caller (OpenAIRealtimeToolkit) forwards VAD speech edges; everything else — timers,
 * thresholds, commit sequencing — lives here. State is held in closure, so each
 * call yields an independent controller.
 */
export function createLocalTurnController(
  client: SwitchboardClient,
  nodes: LocalTurnNodes,
  turn: ResolvedTurnDetection,
  bargeIn: ResolvedBargeIn
) {
  let enabled = false
  let inSpeech = false
  let speechStartMs = 0
  // Set when the cancel-delay fired: the AI's response is already gone, so the
  // turn must commit to request a replacement even if the semantic check fails.
  let cancelFired = false
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * Arm or disarm turn-taking. While disarmed the controller ignores speech
   * edges; disarming also cancels pending timers and undoes any in-progress duck.
   */
  function setEnabled(next: boolean): void {
    if (next === enabled) {
      return
    }
    enabled = next
    if (!next) {
      reset()
      unduck()
    }
  }

  /** SileroVAD detected the user starting to speak. */
  function onSpeechStart(): void {
    if (!enabled) {
      return
    }
    // A new utterance cancels any pending end-of-turn work.
    clearTimer('silenceHold')
    clearTimer('fallbackCommit')
    if (inSpeech) {
      return
    }
    inSpeech = true
    cancelFired = false
    speechStartMs = Date.now()

    // Barge-in: duck immediately so the user isn't talking over full-volume AI,
    // then pause and (optionally) cancel the response on their own delays.
    duck(bargeIn.duckGain)
    setTimer('pause', bargeIn.pauseAfterMs, () => {
      client.callAction(nodes.ai, 'pauseOutput')
    })
    setTimer('cancel', bargeIn.cancelAfterMs, () => {
      cancelFired = true
      client.callAction(nodes.ai, 'cancelResponse')
    })
  }

  /** SileroVAD detected the user stopping. Decide the turn after a silence hold. */
  function onSpeechEnd(): void {
    if (!enabled) {
      return
    }
    // Capture duration at the moment speech ends, not inside the deferred body —
    // otherwise the silence-hold wait would inflate it.
    const durationMs = speechStartMs ? Date.now() - speechStartMs : 0

    // Defer the decision by the pause-tolerance window; if the user resumes
    // within it, onSpeechStart cancels this and the turn continues.
    setTimer('silenceHold', turn.silenceHoldMs, () => {
      inSpeech = false
      clearTimer('pause')
      clearTimer('cancel')
      speechStartMs = 0

      const lengthOk = durationMs > turn.minInputMs
      const semanticOk = semanticComplete(durationMs)
      let shouldCommit = decideCommit(lengthOk, semanticOk)
      // The response was already cancelled pre-emptively — must commit to get a
      // replacement, else the assistant stays silent.
      if (cancelFired) {
        shouldCommit = true
      }
      cancelFired = false

      unduck()
      if (shouldCommit) {
        commit()
      } else if (lengthOk && Number.isFinite(turn.semanticFailTimeoutMs)) {
        // Real-length turn the semantic check rejected: if the user stays quiet,
        // force a commit so the assistant still answers.
        setTimer('fallbackCommit', turn.semanticFailTimeoutMs, () => commit())
      }
      // Resume playback — for a rejected blip this lets the AI keep talking; for
      // a committed turn the new response re-clears and resumes anyway.
      client.callAction(nodes.ai, 'resumeOutput')
    })
  }

  /** Cancel all timers and clear state (call on stop). */
  function reset(): void {
    timers.forEach((id) => clearTimeout(id))
    timers.clear()
    inSpeech = false
    speechStartMs = 0
    cancelFired = false
  }

  /** Has SmartTurn judged the utterance semantically complete? */
  function semanticComplete(durationMs: number): boolean {
    if (turn.semanticStrategy === 'off') {
      return true
    }
    // Short utterances give SmartTurn less context, so use the lower threshold.
    const threshold =
      durationMs < turn.thresholdBreakpointMs
        ? turn.minSemanticConfidence
        : turn.maxSemanticConfidence
    const res = client.callAction(nodes.smartTurn, 'infer')
    const probability = ((res.result ?? {}) as { probability?: number }).probability ?? 0
    return probability >= threshold
  }

  /** Combine length + semantic verdict per the configured strategy. */
  function decideCommit(lengthOk: boolean, semanticOk: boolean): boolean {
    switch (turn.semanticStrategy) {
      case 'off':
        return lengthOk
      case 'rescue':
        return lengthOk || semanticOk
      case 'gate':
        return lengthOk && semanticOk
    }
  }

  /** End the user's turn: (optionally) drop the stale response, then commit. */
  function commit(): void {
    if (bargeIn.commitBehavior === 'cancel') {
      // Stop the AI mid-sentence and discard its queued audio.
      client.callAction(nodes.ai, 'truncateResponse')
      client.callAction(nodes.ai, 'cancelResponse')
      client.callAction(nodes.ai, 'clearOutputBuffer')
    }
    // commitAudioBuffer also sends response.create (see OpenAIWebSocketClient),
    // so this both commits the input and requests the reply.
    client.callAction(nodes.ai, 'commitAudioBuffer')
  }

  function duck(gain: number): void {
    if (gain < 1) {
      client.setValue(nodes.gain, 'gain', gain)
    }
  }

  function unduck(): void {
    client.setValue(nodes.gain, 'gain', 1.0)
  }

  /** Run `fn` after `ms`, replacing any pending timer of the same key. A non-finite
   *  delay (`Infinity`) means "disabled" — the timer is simply not scheduled. */
  function setTimer(key: string, ms: number, fn: () => void): void {
    clearTimer(key)
    if (!Number.isFinite(ms)) {
      return
    }
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        fn()
      }, ms)
    )
  }

  function clearTimer(key: string): void {
    const id = timers.get(key)
    if (id !== undefined) {
      clearTimeout(id)
      timers.delete(key)
    }
  }

  return { setEnabled, onSpeechStart, onSpeechEnd, reset }
}

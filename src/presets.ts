// Curated turn-detection + barge-in presets, ported from graph-runner-internal
// (`QUIET_KNOB_VALUES` / `NOISY_KNOB_VALUES` in its `useKnobs.ts`).

import type { BargeInKnobs, LocalTurnConfig, KnobValues, TurnDetectionKnobs } from './turnDetection'
import { DEFAULT_CONFIG, KNOB_SPECS } from './turnDetection'

/** A curated knob combination. Anything omitted falls back to the defaults. */
export interface TurnPreset {
  /** Turn-detection knob overrides (unset knobs fall back to defaults). */
  turnDetection?: Partial<TurnDetectionKnobs>
  /** Barge-in knob overrides (unset knobs fall back to defaults). */
  bargeIn?: Partial<BargeInKnobs>
}

/** Preset tuned for a quiet, low-noise environment. */
export const QUIET_PRESET: TurnPreset = {
  turnDetection: {
    vadThreshold: 0.4, // room
    minInputLengthMs: 300,
    minSemanticConfidence: 0,
    maxSemanticConfidence: 0,
  },
  bargeIn: {
    pauseTimeMs: 400,
    duckGain: 0.1, // strong duck
  },
}

/** Preset tuned for a loud, high-noise environment. */
export const NOISY_PRESET: TurnPreset = {
  turnDetection: {
    vadThreshold: 0.6, // noisy
    minInputLengthMs: 1000,
    minSemanticConfidence: 0.5,
  },
  bargeIn: {
    pauseTimeMs: 1200,
    duckGain: 0.5, // soft duck
    duckTimeMs: 200,
  },
}

/** Default tuning — every knob at its default. Equivalent to no preset. */
export const BALANCED_PRESET: TurnPreset = {}

/** The named presets, keyed by id (quiet/balanced/noisy tune for noise environments). */
export const PRESETS = {
  balanced: BALANCED_PRESET,
  quiet: QUIET_PRESET,
  noisy: NOISY_PRESET,
} as const

/** A named preset a consumer can select (everything but the runtime-only `'custom'`). */
export type NamedPreset = keyof typeof PRESETS

/**
 * A preset the engine can apply. `'custom'` has no static entry in {@link PRESETS};
 * its knob values are supplied at runtime via {@link OpenAIRealtimeToolkit.setCustomKnobs}. The
 * provider always drives this `'custom'` slot from `useOpenAIRealtimeToolkit().localTurnHandling.config`.
 */
export type Preset = NamedPreset | 'custom'

/** Flatten a (partial) preset over the defaults → the current option for every knob. */
export function resolveKnobValues(preset: TurnPreset): KnobValues {
  const merged: Record<string, unknown> = { ...DEFAULT_CONFIG }
  // Skip explicit `undefined` so it falls back to the default rather than blanking the knob.
  for (const partial of [preset.turnDetection, preset.bargeIn]) {
    for (const key in partial) {
      const v = (partial as Record<string, unknown>)[key]
      if (v !== undefined) merged[key] = v
    }
  }
  return merged as KnobValues
}

/** Split a (partial) flat knob set into a preset's two sections (routing each knob by its group). */
export function knobsToPreset(knobs: Partial<LocalTurnConfig>): TurnPreset {
  const turnDetection: Partial<TurnDetectionKnobs> = {}
  const bargeIn: Partial<BargeInKnobs> = {}
  for (const key of Object.keys(knobs) as (keyof LocalTurnConfig)[]) {
    const v = knobs[key]
    if (v === undefined) continue
    const target = KNOB_SPECS[key].group === 'turnDetection' ? turnDetection : bargeIn
    ;(target as Record<string, unknown>)[key] = v
  }
  return { turnDetection, bargeIn }
}

/** Fully-resolved knob options for each named preset (so a UI can read/preview any preset). */
export const PRESET_KNOBS: Record<NamedPreset, KnobValues> = {
  balanced: resolveKnobValues(BALANCED_PRESET),
  quiet: resolveKnobValues(QUIET_PRESET),
  noisy: resolveKnobValues(NOISY_PRESET),
}

// Each preset as a full `LocalTurnConfig` value — pass to `useOpenAIRealtimeToolkit().localTurnHandling.setConfig(...)`
// to "select" it, or to the provider's `localTurnHandling={{ config }}` prop to seed it. A preset
// is just a complete knob set; spread one to tweak it: `setConfig({ ...QUIET_CONFIG, pauseToleranceMs: 3000 })`.
/** Quiet, low-noise environment — a full knob set. */
export const QUIET_CONFIG: LocalTurnConfig = PRESET_KNOBS.quiet
/** Balanced defaults — a full knob set (every knob at its default). */
export const BALANCED_CONFIG: LocalTurnConfig = PRESET_KNOBS.balanced
/** Loud, high-noise environment — a full knob set. */
export const NOISY_CONFIG: LocalTurnConfig = PRESET_KNOBS.noisy

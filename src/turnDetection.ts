// On-device turn-detection + barge-in knobs, ported from graph-runner-internal.
//
// Two sections, mirroring the reference UI:
//   • Turn detection — deciding when the user's turn has ended.
//   • Barge-in       — how the in-flight AI response is interrupted.
//
// SINGLE SOURCE OF TRUTH: every knob is declared once in `KNOBS` below. Two kinds:
//   • numeric knobs — a raw value with `{ default, min, max }` (ms / gain / threshold).
//                     A disable-able duration defaults to `Infinity` to mean "off".
//   • enum knobs    — a typed string with `{ default, options }` (no numeric meaning).
// The knob name/value types, the section interfaces, the defaults, the exported
// {@link KNOB_SPECS} metadata, and the numeric resolvers are ALL derived from that
// record, so adding or renaming a knob is a one-line change here.
//
// HUMAN DESCRIPTIONS live as JSDoc on the {@link LocalTurnConfig} interface — NOT as runtime
// data — so a developer sees what each knob does on hover (e.g. `config.vadThreshold`)
// without running the app. That's the one thing not derived from `KNOBS`: a mapped
// type can't carry per-member JSDoc, so `LocalTurnConfig` is hand-declared. A compile-time
// assertion below keeps its keys in lock-step with `KNOBS`, so adding a knob is a
// line here + a documented member on `LocalTurnConfig` (the build fails if you forget).

// A disable-able duration knob (ms) uses `Infinity` as its "off" value — an infinite
// delay never fires (the `staleTime: Infinity` idiom). Disable one with
// `setConfig({ cancelTimeMs: Infinity })`; test one with `Number.isFinite(value)`.

// ── The single source of truth ───────────────────────────────────────────────
const KNOBS = {
  // Turn detection — when is the user's turn over?
  vadThreshold: {
    kind: 'numeric',
    group: 'turnDetection',
    label: 'VAD threshold',
    default: 0.5,
    min: 0.0,
    max: 1.0,
  },
  vadSilenceMs: {
    kind: 'numeric',
    group: 'turnDetection',
    label: 'VAD silence duration',
    default: 500,
    min: 100,
    max: 6000,
  },
  minInputLengthMs: {
    kind: 'numeric',
    group: 'turnDetection',
    label: 'Min input length',
    default: 600,
    min: 200,
    max: 6000,
  },
  pauseToleranceMs: {
    kind: 'numeric',
    group: 'turnDetection',
    label: 'Pause tolerance',
    default: 0,
    min: 0,
    max: 6000,
  },
  semanticStrategy: {
    kind: 'enum',
    group: 'turnDetection',
    label: 'Semantic strategy',
    default: 'gate',
    options: ['off', 'rescue', 'gate'],
  },
  minSemanticConfidence: {
    kind: 'numeric',
    group: 'turnDetection',
    label: 'Min semantic confidence',
    default: 0.01,
    min: 0,
    max: 0.9,
  },
  maxSemanticConfidence: {
    kind: 'numeric',
    group: 'turnDetection',
    label: 'Max semantic confidence',
    default: 0.5,
    min: 0,
    max: 0.9,
  },
  thresholdBreakpointMs: {
    kind: 'numeric',
    group: 'turnDetection',
    label: 'Threshold breakpoint',
    default: 2000,
    min: 1000,
    max: 6000,
  },
  semanticFailTimeoutMs: {
    kind: 'numeric',
    group: 'turnDetection',
    label: 'Semantic fail timeout',
    default: Infinity,
    min: 3000,
    max: 6000,
  },
  // Barge-in — how is the in-flight AI response interrupted?
  pauseTimeMs: {
    kind: 'numeric',
    group: 'bargeIn',
    label: 'Pause time',
    default: 800,
    min: 400,
    max: 6000,
  },
  cancelTimeMs: {
    kind: 'numeric',
    group: 'bargeIn',
    label: 'Cancel time',
    default: Infinity,
    min: 2000,
    max: 16000,
  },
  duckGain: {
    kind: 'numeric',
    group: 'bargeIn',
    label: 'Duck gain',
    default: 0.3,
    min: 0,
    max: 1,
  },
  duckTimeMs: {
    kind: 'numeric',
    group: 'bargeIn',
    label: 'Duck time',
    default: 100,
    min: 0,
    max: 1000,
  },
  commitBehavior: {
    kind: 'enum',
    group: 'bargeIn',
    label: 'Commit behavior',
    default: 'cancel',
    options: ['cancel', 'finish'],
  },
} as const

// ── Derived types ────────────────────────────────────────────────────────────
/** Which section a knob belongs to. */
export type KnobGroup = 'turnDetection' | 'bargeIn'
/** A knob is either a raw number or a typed string enum. */
export type KnobKind = 'numeric' | 'enum'
/** A knob's name. */
export type KnobName = keyof typeof KNOBS
/** True for enum knobs (those declared with `options`), false for numeric knobs. */
export type IsEnumKnob<K extends KnobName> =
  (typeof KNOBS)[K] extends { readonly options: readonly unknown[] } ? true : false
/** A knob's value type: the option union for enum knobs, else `number` (a
 *  disable-able duration uses `Infinity` as "off", which is still a number). */
export type KnobValue<K extends KnobName> =
  (typeof KNOBS)[K] extends { readonly options: readonly (infer O)[] } ? O : number
/** The current value for every knob, flattened into one record. */
export type KnobValues = { [K in KnobName]: KnobValue<K> }

// Knob names within a section — used to derive the two public interfaces below.
type NamesInGroup<G extends KnobGroup> = {
  [K in KnobName]: (typeof KNOBS)[K]['group'] extends G ? K : never
}[KnobName]

/** LocalTurnConfig governing when the user's turn is considered complete. */
export type TurnDetectionKnobs = { [K in NamesInGroup<'turnDetection'>]: KnobValue<K> }
/** LocalTurnConfig governing how the in-flight AI response is interrupted. */
export type BargeInKnobs = { [K in NamesInGroup<'bargeIn'>]: KnobValue<K> }

// ── Derived defaults ─────────────────────────────────────────────────────────
const KNOB_NAMES = Object.keys(KNOBS) as KnobName[]

function defaultsFor<G extends KnobGroup>(group: G): { [K in NamesInGroup<G>]: KnobValue<K> } {
  const out: Record<string, unknown> = {}
  for (const key of KNOB_NAMES) {
    if (KNOBS[key].group === group) out[key] = KNOBS[key].default
  }
  return out as { [K in NamesInGroup<G>]: KnobValue<K> }
}

/** Default turn-detection knobs, derived from the declarations. */
export const DEFAULT_TURN_DETECTION_KNOBS: TurnDetectionKnobs = defaultsFor('turnDetection')
/** Default barge-in knobs, derived from the declarations. */
export const DEFAULT_BARGE_IN_KNOBS: BargeInKnobs = defaultsFor('bargeIn')
/** Every knob at its default, flattened. */
export const DEFAULT_CONFIG: KnobValues = {
  ...DEFAULT_TURN_DETECTION_KNOBS,
  ...DEFAULT_BARGE_IN_KNOBS,
} as KnobValues

// ── Knob metadata (for building UIs) ─────────────────────────────────────────
interface KnobSpecBase<K extends KnobName> {
  /** The knob's name (key in {@link KnobValues}). */
  key: K
  /** Which section it lives under. */
  group: KnobGroup
  /** Human-readable label. */
  label: string
}
/** A numeric knob: a raw value bounded by `min`/`max`. */
export interface NumericKnobSpec<K extends KnobName = KnobName> extends KnobSpecBase<K> {
  /** Discriminant — this is a numeric knob. */
  kind: 'numeric'
  /** Default value (`Infinity` for a disable-able duration that defaults to off). */
  default: number
  /** Minimum allowed value (when enabled). */
  min: number
  /** Maximum allowed value (when enabled). */
  max: number
}
/** An enum knob: one of a fixed set of typed string `options`. */
export interface EnumKnobSpec<K extends KnobName = KnobName> extends KnobSpecBase<K> {
  /** Discriminant — this is an enum knob. */
  kind: 'enum'
  /** Default option. */
  default: KnobValue<K>
  /** The selectable options, in order. */
  options: readonly KnobValue<K>[]
}
/** Static metadata for one knob — a numeric spec or an enum spec, per its kind. */
export type KnobSpec<K extends KnobName = KnobName> =
  IsEnumKnob<K> extends true ? EnumKnobSpec<K> : NumericKnobSpec<K>

/** Metadata for every knob, keyed by name. Numeric knobs carry `min`/`max`; enum knobs carry `options`. */
export const KNOB_SPECS = Object.fromEntries(
  KNOB_NAMES.map((key) => [key, Object.freeze({ key, ...KNOBS[key] })])
) as unknown as { [K in KnobName]: KnobSpec<K> }

// ── The knob read shape (single source of the per-knob descriptions) ──
/**
 * Every knob, keyed by name — the READ shape returned by `useOpenAIRealtimeToolkit().localTurnHandling.config`,
 * e.g. `config.pauseToleranceMs`. Every member is REQUIRED: a knob always has a current
 * value, so reads are a clean `T`, never `T | undefined`.
 *
 * Writes take `Partial<LocalTurnConfig>` — `setConfig({ pauseToleranceMs: 3000 })` and the
 * `localTurnHandling={{ config }}` prop — where you pass only the knobs you want to change.
 * `Partial` is homomorphic, so each member's doc comment still surfaces on hover at the write
 * site; the descriptions live here and nowhere else.
 *
 * Hand-declared (not derived from {@link KNOBS}) because mapped types (`Partial<…>`,
 * `{ [K in KnobName]: … }`) can't carry per-member JSDoc; the `_KnobsCoverage`
 * assertion below fails the build if these keys drift from {@link KNOBS}. Static
 * metadata (label / min / max / options) lives on {@link KNOB_SPECS}.
 */
export interface LocalTurnConfig {
  /**
   * SileroVAD activation threshold. Higher = needs louder speech (noisier rooms).
   * @defaultValue 0.5
   * @remarks Range 0.3–0.7.
   */
  vadThreshold: number
  /**
   * How long (ms) SileroVAD must hear silence before it declares the user's
   * speech ended. Lower = snappier turn-ends but risks chopping mid-sentence
   * pauses; higher = more tolerant of pauses but slower to respond. This is the
   * VAD's own hold; {@link pauseToleranceMs} adds a further software hold on top.
   * @defaultValue 500
   * @remarks Range 100–2000.
   */
  vadSilenceMs: number
  /**
   * How long (ms) the user must speak for it to count as a turn.
   * @defaultValue 600
   * @remarks Range 300–2000.
   */
  minInputLengthMs: number
  /**
   * Silence (ms) held after the user stops before ending the turn.
   * @defaultValue 0
   * @remarks Range 0–3000.
   */
  pauseToleranceMs: number
  /**
   * How SmartTurn's verdict combines with utterance length.
   * @defaultValue 'gate'
   * @remarks Options: `off` | `rescue` | `gate`.
   */
  semanticStrategy: KnobValue<'semanticStrategy'>
  /**
   * SmartTurn confidence (0–1) required for short utterances.
   * @defaultValue 0.01
   * @remarks Range 0–0.7.
   */
  minSemanticConfidence: number
  /**
   * SmartTurn confidence (0–1) required for long utterances.
   * @defaultValue 0.5
   * @remarks Range 0–0.7.
   */
  maxSemanticConfidence: number
  /**
   * Utterance duration (ms) splitting min- from max-confidence.
   * @defaultValue 2000
   * @remarks Range 1000–3000.
   */
  thresholdBreakpointMs: number
  /**
   * After a semantic-rejected turn, force a commit if silence lasts this long (ms).
   * @defaultValue Infinity (disabled)
   * @remarks Range 3000–6000, or `Infinity` to disable.
   */
  semanticFailTimeoutMs: number
  /**
   * Delay (ms) after the user starts speaking before pausing the AI.
   * @defaultValue 800
   * @remarks Range 400–6000, or `Infinity` to disable.
   */
  pauseTimeMs: number
  /**
   * Delay (ms) after the user starts speaking before cancelling the AI's response.
   * @defaultValue Infinity (disabled)
   * @remarks Range 2000–16000, or `Infinity` to disable.
   */
  cancelTimeMs: number
  /**
   * Gain (0–1) the AI is attenuated to while the user speaks (0 = mute).
   * @defaultValue 0.3
   * @remarks Range 0–1.
   */
  duckGain: number
  /**
   * How quickly (ms) the AI fades into/out of the ducked level.
   * @defaultValue 100
   * @remarks Range 0–400.
   */
  duckTimeMs: number
  /**
   * What to do with the in-flight AI response when a turn completes.
   * @defaultValue 'cancel'
   * @remarks Options: `cancel` | `finish`.
   */
  commitBehavior: KnobValue<'commitBehavior'>
}

// Compile-time guard: `LocalTurnConfig` must document exactly the knobs declared in `KNOBS`.
// If a knob is added/removed/renamed in `KNOBS` without matching `LocalTurnConfig`, the two
// key unions stop being equal and `Assert<false>` fails to typecheck.
type ExactlyEqual<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false
type Assert<T extends true> = T
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _KnobsCoverage = Assert<ExactlyEqual<keyof LocalTurnConfig, KnobName>>

// ── Resolution to the engine's numeric config ────────────────────────────────
// Knob values are already raw numbers/strings; resolving is just renaming the
// fields to the shape the engine + turn controller consume.
/** Turn-detection knobs resolved to the engine's field names. */
export interface ResolvedTurnDetection {
  /** SileroVAD activation threshold. */
  vadThreshold: number
  /** Silence (ms) SileroVAD holds before declaring speech ended (VAD node's `minSilenceDurationMs`). */
  vadSilenceMs: number
  /** Min speech duration (ms) for a turn to count. */
  minInputMs: number
  /** Silence (ms) held after speech before ending the turn. */
  silenceHoldMs: number
  /** How SmartTurn's verdict is applied. */
  semanticStrategy: KnobValue<'semanticStrategy'>
  /** SmartTurn confidence required for short utterances. */
  minSemanticConfidence: number
  /** SmartTurn confidence required for long utterances. */
  maxSemanticConfidence: number
  /** Utterance duration (ms) splitting min- from max-confidence. */
  thresholdBreakpointMs: number
  /** Fallback-commit timeout (ms) after a semantic reject; `Infinity` = disabled. */
  semanticFailTimeoutMs: number
}

/** Barge-in knobs resolved to the engine's field names. */
export interface ResolvedBargeIn {
  /** Delay (ms) before pausing the AI once the user speaks; `Infinity` = disabled. */
  pauseAfterMs: number
  /** Delay (ms) before cancelling the AI's response; `Infinity` = disabled. */
  cancelAfterMs: number
  /** Gain (0–1) the AI ducks to while the user speaks. */
  duckGain: number
  /** Duck fade duration (ms). */
  duckRampMs: number
  /** What to do with the in-flight response when the turn completes. */
  commitBehavior: KnobValue<'commitBehavior'>
}

/** Merge `knobs` over the turn-detection defaults and map to the engine's field names. */
export function resolveTurnDetection(knobs?: Partial<TurnDetectionKnobs>): ResolvedTurnDetection {
  const k: TurnDetectionKnobs = { ...DEFAULT_TURN_DETECTION_KNOBS, ...knobs }
  return {
    vadThreshold: k.vadThreshold,
    vadSilenceMs: k.vadSilenceMs,
    minInputMs: k.minInputLengthMs,
    silenceHoldMs: k.pauseToleranceMs,
    semanticStrategy: k.semanticStrategy,
    minSemanticConfidence: k.minSemanticConfidence,
    maxSemanticConfidence: k.maxSemanticConfidence,
    thresholdBreakpointMs: k.thresholdBreakpointMs,
    semanticFailTimeoutMs: k.semanticFailTimeoutMs,
  }
}

/** Merge `knobs` over the barge-in defaults and map to the engine's field names. */
export function resolveBargeIn(knobs?: Partial<BargeInKnobs>): ResolvedBargeIn {
  const k: BargeInKnobs = { ...DEFAULT_BARGE_IN_KNOBS, ...knobs }
  return {
    pauseAfterMs: k.pauseTimeMs,
    cancelAfterMs: k.cancelTimeMs,
    duckGain: k.duckGain,
    duckRampMs: k.duckTimeMs,
    commitBehavior: k.commitBehavior,
  }
}

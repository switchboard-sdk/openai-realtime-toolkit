/**
 * The OpenAI Realtime node's voice settings — the pure value layer (no native
 * imports), mirroring the node's own options and defaults.
 */

/** The voices the OpenAI Realtime node supports. */
export type OpenAIVoice =
  | 'alloy'
  | 'ash'
  | 'ballad'
  | 'cedar'
  | 'coral'
  | 'echo'
  | 'marin'
  | 'sage'
  | 'shimmer'
  | 'verse'

/** Every {@link OpenAIVoice}, in the node's order — for building a voice picker. */
export const VOICES: readonly OpenAIVoice[] = [
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'marin',
  'sage',
  'shimmer',
  'verse',
]

/** The range the node accepts for `speed`, and its default — for building a slider. */
export const SPEED_RANGE = { min: 0.5, max: 1.5, default: 1.0 } as const

/** The node's defaults, mirrored so the hook can report them before start(). */
export const DEFAULT_VOICE: OpenAIVoice = 'cedar'
export const DEFAULT_MODEL = 'gpt-realtime-2'

/** Speeds outside {@link SPEED_RANGE} are rejected by the node, so clamp instead. */
export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) {
    return SPEED_RANGE.default
  }
  return Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, speed))
}

import NativeOpenAIRealtimeToolkit from './NativeOpenAIRealtimeToolkit'

/**
 * OpenAIRealtimeToolkit — on-device audio processing for voice AI pipelines.
 *
 * Thin React Native wrapper over the Switchboard SDK. Wrap your app in
 * {@link OpenAIRealtimeToolkitProvider} and drive it with the hooks below; the engine,
 * JSON-RPC transport, and turn-taking are internal.
 */

// The entire public API is the provider + hooks.
export { OpenAIRealtimeToolkitProvider, useOpenAIRealtimeToolkit, useTool } from './OpenAIRealtimeToolkitProvider'
export type {
  OpenAIRealtimeToolkitProviderProps,
  OpenAIRealtimeToolkitContextValue,
  LocalTurnHandling,
  OpenAIRealtimeToolkitConnectionStatus,
} from './OpenAIRealtimeToolkitProvider'
// Shape passed to the `useTool` hook (or `registerTool` from useOpenAIRealtimeToolkit()).
export type { OpenAIRealtimeToolkitTool } from './OpenAIRealtimeToolkit'
// Every selectable voice + the accepted `speed` range — for building a voice picker / speed slider.
export { VOICES, SPEED_RANGE } from './voice'
export type { OpenAIVoice } from './voice'
// Presets as full knob sets — pass to `setConfig(...)` or the `localTurnHandling={{ config }}` prop.
export { QUIET_CONFIG, BALANCED_CONFIG, NOISY_CONFIG } from './presets'
// Knob values (read via `useOpenAIRealtimeToolkit().localTurnHandling.config`) + static metadata for a tuning UI.
// DEFAULT_CONFIG is the "replace from scratch" base: `setConfig({ ...DEFAULT_CONFIG, ...tweaks })`.
// Disable a duration knob with `Infinity`: `setConfig({ cancelTimeMs: Infinity })`.
export { KNOB_SPECS, DEFAULT_CONFIG } from './turnDetection'
export type {
  LocalTurnConfig,
  KnobSpec,
  NumericKnobSpec,
  EnumKnobSpec,
  KnobValue,
  KnobValues,
  KnobName,
  KnobGroup,
  KnobKind,
  TurnDetectionKnobs,
  BargeInKnobs,
} from './turnDetection'

/** Absolute path to the app's documents directory (for recordings/logs). */
export function getDocumentsPath(): string {
  return NativeOpenAIRealtimeToolkit.getDocumentsPath()
}

/** Write `contents` to `path`, overwriting. Returns whether it succeeded. */
export function writeFile(path: string, contents: string): boolean {
  return NativeOpenAIRealtimeToolkit.writeFile(path, contents)
}

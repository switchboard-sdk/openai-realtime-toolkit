import { PRESETS, PRESET_KNOBS, knobsToPreset, resolveKnobValues } from './presets'
import { DEFAULT_CONFIG, KNOB_SPECS } from './turnDetection'

// resolveKnobValues / knobsToPreset are the flatten ⇄ split pair that lets a UI
// read every knob's current option and set one without knowing the two-section
// TurnPreset shape. PRESET_KNOBS is their static application to the named presets.

describe('resolveKnobValues', () => {
  it('fills unset knobs with defaults', () => {
    expect(resolveKnobValues({})).toEqual(DEFAULT_CONFIG)
  })

  it('overlays a preset over the defaults, leaving the rest at default', () => {
    const v = resolveKnobValues(PRESETS.quiet)
    expect(v.vadThreshold).toBe(0.4) // set by quiet
    expect(v.duckTimeMs).toBe(DEFAULT_CONFIG.duckTimeMs) // untouched → default
  })

  it('treats an explicit undefined as "use default", not a blank', () => {
    const v = resolveKnobValues({ turnDetection: { vadThreshold: undefined } })
    expect(v.vadThreshold).toBe(0.5) // default, not undefined
  })
})

describe('knobsToPreset', () => {
  it('routes each knob into the section its spec declares', () => {
    const preset = knobsToPreset(DEFAULT_CONFIG)
    expect(KNOB_SPECS.vadThreshold.group).toBe('turnDetection')
    expect(KNOB_SPECS.duckGain.group).toBe('bargeIn')
    expect(preset.turnDetection?.vadThreshold).toBe(0.5)
    expect(preset.bargeIn?.duckGain).toBe(0.3)
  })

  it('round-trips with resolveKnobValues', () => {
    const v = resolveKnobValues(PRESETS.noisy)
    expect(resolveKnobValues(knobsToPreset(v))).toEqual(v)
  })
})

describe('PRESET_KNOBS', () => {
  it('exposes fully-resolved knobs for each named preset', () => {
    expect(PRESET_KNOBS.balanced).toEqual(DEFAULT_CONFIG)
    expect(PRESET_KNOBS.quiet.vadThreshold).toBe(0.4)
    expect(PRESET_KNOBS.noisy.duckGain).toBe(0.6)
  })
})

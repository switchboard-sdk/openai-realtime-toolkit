import {
  DEFAULT_CONFIG,
  DEFAULT_TURN_DETECTION_KNOBS,
  KNOB_SPECS,
  resolveBargeIn,
  resolveTurnDetection,
} from './turnDetection'
import { PRESETS } from './presets'

// Knob values are raw numbers (or, for the 2 enum knobs, typed strings), so
// resolving is a merge-over-defaults + rename to the engine's field names. We test
// the merge behavior and the disabled-duration `Infinity` sentinel, not every field.

describe('resolveTurnDetection', () => {
  it('resolves defaults when given no knobs', () => {
    const r = resolveTurnDetection()
    expect(r.vadThreshold).toBe(0.5) // vadThreshold default
    expect(r.vadSilenceMs).toBe(500) // vadSilenceMs default
    expect(r.semanticStrategy).toBe('gate')
    // Default semanticFailTimeoutMs is Infinity, so the fallback-commit timer is disabled.
    expect(r.semanticFailTimeoutMs).toBe(Infinity)
  })

  it('merges a partial knob set over the defaults, leaving the rest untouched', () => {
    const r = resolveTurnDetection({ vadThreshold: 0.6, vadSilenceMs: 250 })
    expect(r.vadThreshold).toBe(0.6) // overridden
    expect(r.vadSilenceMs).toBe(250) // overridden
    const defaults = resolveTurnDetection()
    expect(r.minInputMs).toBe(defaults.minInputMs)
    expect(r.semanticStrategy).toBe(defaults.semanticStrategy)
    expect(r.thresholdBreakpointMs).toBe(defaults.thresholdBreakpointMs)
  })

  it('passes Infinity through as the disabled value, but a finite value untouched', () => {
    expect(resolveTurnDetection({ semanticFailTimeoutMs: Infinity }).semanticFailTimeoutMs).toBe(Infinity)
    expect(resolveTurnDetection({ semanticFailTimeoutMs: 5000 }).semanticFailTimeoutMs).toBe(5000)
  })
})

describe('resolveBargeIn', () => {
  it('passes Infinity through; cancelTimeMs defaults to disabled', () => {
    expect(resolveBargeIn({ pauseTimeMs: Infinity }).pauseAfterMs).toBe(Infinity)
    expect(resolveBargeIn().cancelAfterMs).toBe(Infinity) // cancelTimeMs default = Infinity (disabled)
  })
})

describe('presets resolve as intended', () => {
  it('balanced preset equals the defaults', () => {
    expect(resolveTurnDetection(PRESETS.balanced.turnDetection)).toEqual(
      resolveTurnDetection(DEFAULT_TURN_DETECTION_KNOBS)
    )
  })

  it('quiet preset lowers the VAD threshold and shortens min input', () => {
    const r = resolveTurnDetection(PRESETS.quiet.turnDetection)
    expect(r.vadThreshold).toBe(0.4)
    expect(r.minInputMs).toBe(300)
    expect(r.minSemanticConfidence).toBe(0)
  })

  it('noisy preset raises the VAD threshold and lengthens min input', () => {
    const r = resolveTurnDetection(PRESETS.noisy.turnDetection)
    expect(r.vadThreshold).toBe(0.6)
    expect(r.minInputMs).toBe(1000)
    expect(r.minSemanticConfidence).toBe(0.5)
  })
})

// KNOB_SPECS + DEFAULT_CONFIG are derived from the single KNOBS declaration; these
// assert the derivation stays internally consistent per knob kind.
describe('KNOB_SPECS (derived metadata)', () => {
  it('exposes all 14 knobs, each with numeric bounds or enum options per its kind', () => {
    const names = Object.keys(KNOB_SPECS) as (keyof typeof KNOB_SPECS)[]
    expect(names).toHaveLength(14)
    for (const name of names) {
      const spec = KNOB_SPECS[name]
      expect(spec.key).toBe(name)
      expect(['turnDetection', 'bargeIn']).toContain(spec.group)
      expect(spec.label.length).toBeGreaterThan(0)
      if (spec.kind === 'enum') {
        expect(spec.options).toContain(spec.default)
      } else {
        // Numeric knobs default to a number — including Infinity for a disable-able one.
        expect(typeof spec.default).toBe('number')
        expect(spec.min).toBeLessThanOrEqual(spec.max)
      }
    }
  })

  it('carries numeric bounds and enum options', () => {
    expect(KNOB_SPECS.vadThreshold.min).toBe(0.0)
    expect(KNOB_SPECS.vadThreshold.max).toBe(1.0)
    expect(KNOB_SPECS.vadThreshold.default).toBe(0.5)
    expect(KNOB_SPECS.semanticStrategy.options).toEqual(['off', 'rescue', 'gate'])
    expect(KNOB_SPECS.vadThreshold.label).toBe('VAD threshold')
  })

  it('disable-able duration knobs default to Infinity (off)', () => {
    expect(KNOB_SPECS.cancelTimeMs.default).toBe(Infinity)
    expect(KNOB_SPECS.semanticFailTimeoutMs.default).toBe(Infinity)
    // pauseTimeMs is disable-able too, but ships enabled (a real default).
    expect(KNOB_SPECS.pauseTimeMs.default).toBe(800)
    // A non-disable-able knob has a finite default.
    expect(Number.isFinite(KNOB_SPECS.vadThreshold.default)).toBe(true)
  })

  it('is frozen so consumers cannot mutate the metadata', () => {
    expect(Object.isFrozen(KNOB_SPECS.vadThreshold)).toBe(true)
    expect(Object.isFrozen(KNOB_SPECS.semanticStrategy)).toBe(true)
  })
})

describe('DEFAULT_CONFIG', () => {
  it('holds every knob at its declared default (numbers + enum strings)', () => {
    expect(DEFAULT_CONFIG.vadThreshold).toBe(0.5)
    expect(DEFAULT_CONFIG.pauseToleranceMs).toBe(0)
    expect(DEFAULT_CONFIG.duckGain).toBe(0.3)
    expect(DEFAULT_CONFIG.semanticStrategy).toBe('gate')
    expect(DEFAULT_CONFIG.cancelTimeMs).toBe(Infinity)
  })
})

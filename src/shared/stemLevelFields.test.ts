// The level pass in the feature row (spec 2026-10-05-radio-intensity-arc-design section 7.2-7.3):
// stemAnalysis.ts's extraChannels, stemFeatures.ts's levelVersion, stemAnalysisNeeds' `level`.
import { describe, expect, it } from 'vitest'
import { analyzeStemSamples, assembleStemFeatures } from './stemAnalysis'
import { stemLevelVersionOf, toFeatureArray, STEM_FEATURE_VERSION } from './stemFeatures'
import { ALL_STEM_ANALYSIS_NEEDS, needsAnyAnalysis } from './stemAnalysisNeeds'
import { STEM_LEVEL_VERSION } from './stemLevel'

const fs = 22050
const tone = (hz: number, a: number): Float32Array => {
  const out = new Float32Array(fs * 2)
  for (let i = 0; i < out.length; i++) out[i] = a * Math.sin((2 * Math.PI * hz * i) / fs)
  return out
}

describe('the level pass in the analysis', () => {
  it('runs only when the other channels are handed over, and reads them all', () => {
    const left = tone(220, 0.3)
    expect(analyzeStemSamples(left, fs).level).toBeUndefined()
    const mono = analyzeStemSamples(left, fs, []).level!
    const stereo = analyzeStemSamples(left, fs, [left.slice()]).level!
    expect(stereo.loudnessLufs! - mono.loudnessLufs!).toBeCloseTo(3.01, 1)
  })

  it('leaves every other field exactly as it was', () => {
    const left = tone(220, 0.3)
    const without = { ...analyzeStemSamples(left, fs, [tone(330, 0.1)]) }
    delete without.level
    expect(without).toEqual(analyzeStemSamples(left, fs))
  })

  it('stamps levelVersion on a fresh row, and stays out of toFeatureArray', () => {
    const a = analyzeStemSamples(tone(220, 0.3), fs, [])
    const f = assembleStemFeatures(a, [0.5])
    expect(f.featureVersion).toBe(STEM_FEATURE_VERSION)
    expect(f.levelVersion).toBe(STEM_LEVEL_VERSION)
    expect(typeof f.loudnessLufs).toBe('number')
    expect(stemLevelVersionOf(f)).toBe(STEM_LEVEL_VERSION)
    const rest = { ...f }
    delete rest.loudnessLufs
    delete rest.lowLevelDb
    delete rest.activeFraction
    delete rest.levelVersion
    expect(toFeatureArray(f)).toEqual(toFeatureArray(rest))
    expect(stemLevelVersionOf(rest)).toBe(0)
    const plain = assembleStemFeatures(analyzeStemSamples(tone(220, 0.3), fs), [0.5])
    expect('levelVersion' in plain).toBe(false)
  })
})

describe('the level need', () => {
  it('counts as work, and a fresh extraction asks for none', () => {
    expect(ALL_STEM_ANALYSIS_NEEDS.level).toBe(false)
    const none = { peaks: false, features: false, embedding: false, zeroShot: false }
    expect(needsAnyAnalysis(none)).toBe(false)
    expect(needsAnyAnalysis({ ...none, level: true })).toBe(true)
  })
})

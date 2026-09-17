import { beforeAll, describe, expect, it, vi } from 'vitest'
import type * as YamnetWorker from './yamnetWorker'

// yamnetWorker.ts is a webworker module -- it assigns `self.onmessage = ...`
// at the top level on import. `self` doesn't exist in vitest's `node` test
// environment, so (same convention as peakCache.test.ts's window/
// AudioContext stubbing) stub it before dynamically importing the module.
let meanPoolEmbedding: typeof YamnetWorker.meanPoolEmbedding
let topClassIndexFromScores: typeof YamnetWorker.topClassIndexFromScores

beforeAll(async () => {
  vi.stubGlobal('self', {})
  const mod = await import('./yamnetWorker')
  meanPoolEmbedding = mod.meanPoolEmbedding
  topClassIndexFromScores = mod.topClassIndexFromScores
})

describe('topClassIndexFromScores', () => {
  it('returns the index with the highest mean score across frames', () => {
    // 2 frames, 4 classes. Frame 0: class 2 highest. Frame 1: class 2 still
    // highest overall once averaged.
    // prettier-ignore
    const data = new Float32Array([
      0.1, 0.2, 0.9, 0.05,
      0.2, 0.1, 0.8, 0.1
    ])
    expect(topClassIndexFromScores(data, 2, 4)).toBe(2)
  })

  it('returns null for zero frames (a clip too short to produce any analysis window)', () => {
    expect(topClassIndexFromScores(new Float32Array([]), 0, 4)).toBeNull()
  })

  it('handles a single frame', () => {
    const data = new Float32Array([0.9, 0.05, 0.03, 0.02])
    expect(topClassIndexFromScores(data, 1, 4)).toBe(0)
  })
})

describe('meanPoolEmbedding', () => {
  it('is exported for reuse by this test file', () => {
    expect(typeof meanPoolEmbedding).toBe('function')
  })
})

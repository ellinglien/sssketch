import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FOLD_SEED,
  FOLD_SEED_ALPHABET,
  newFoldSeed,
  normalizeFoldAmount,
  normalizeFoldSeed,
  radioFoldAllowedCycles,
  radioFoldAnchor,
  radioFoldCanFold,
  radioFoldPath,
  radioFoldRealignBeats,
  type RadioFoldRow
} from './radioFold'

const row = (id: string, over: Partial<RadioFoldRow> = {}): RadioFoldRow => ({
  id,
  stemId: `${id}-stem`,
  kinds: ['rhythmic'],
  barLength: 2,
  hooked: false,
  audible: true,
  percussive: false,
  ...over
})

describe('the realignment window', () => {
  it('realigns on a half-beat grid: 7 vs 16, 3.5 vs 16, 5 vs 8, 9 vs 16', () => {
    expect(radioFoldRealignBeats(7, 16)).toBe(112)
    expect(radioFoldRealignBeats(3.5, 16)).toBe(112)
    expect(radioFoldRealignBeats(5, 8)).toBe(40)
    expect(radioFoldRealignBeats(9, 16)).toBe(144)
  })

  it('allows 7 against 16 at 120 bpm (56 s) and refuses 3 (24 s)', () => {
    expect(radioFoldAllowedCycles(16, 120)).toEqual([3.5, 5, 5.5, 7, 9])
  })

  it('refuses everything outside 30-120 s: 9 against 32 at 120 bpm is 144 s', () => {
    expect(radioFoldAllowedCycles(32, 120)).not.toContain(9)
    expect(radioFoldAllowedCycles(32, 120)).toContain(7)
  })

  it('every allowed cycle is inside the window at a range of tempos and loops', () => {
    for (const bpm of [70, 96, 120, 140, 174]) {
      for (const loopBeats of [4, 8, 16, 24, 32]) {
        for (const c of radioFoldAllowedCycles(loopBeats, bpm)) {
          const sec = (radioFoldRealignBeats(c, loopBeats) * 60) / bpm
          expect(sec).toBeGreaterThanOrEqual(30 - 1e-9)
          expect(sec).toBeLessThanOrEqual(120 + 1e-9)
        }
      }
    }
  })

  it('has nothing for no tempo or no loop', () => {
    expect(radioFoldAllowedCycles(16, 0)).toEqual([])
    expect(radioFoldAllowedCycles(0, 120)).toEqual([])
  })
})

describe('the anchor and what may fold', () => {
  it('the anchor is the longest audible drums or bass row', () => {
    const rows = [
      row('a', { kinds: ['lead'], barLength: 8 }),
      row('b', { kinds: ['drums'], barLength: 2 }),
      row('c', { kinds: ['bass'], barLength: 4 })
    ]
    expect(radioFoldAnchor(rows)).toBe('c')
  })

  it('with no drums or bass row, the longest audible row', () => {
    expect(
      radioFoldAnchor([
        row('a', { kinds: ['lead'], barLength: 4 }),
        row('b', { barLength: 8, audible: false }),
        row('c', { barLength: 2 })
      ])
    ).toBe('a')
    expect(radioFoldAnchor([])).toBeNull()
  })

  it('never folds the anchor, a melodic, hooked, long, silent or empty row', () => {
    expect(radioFoldCanFold(row('a'), 'a')).toBe(false)
    expect(radioFoldCanFold(row('a', { kinds: ['lead'] }), null)).toBe(false)
    expect(radioFoldCanFold(row('a', { kinds: ['rhythmic', 'bass'] }), null)).toBe(false)
    expect(radioFoldCanFold(row('a', { hooked: true }), null)).toBe(false)
    expect(radioFoldCanFold(row('a', { barLength: 8 }), null)).toBe(false)
    expect(radioFoldCanFold(row('a', { audible: false }), null)).toBe(false)
    expect(radioFoldCanFold(row('a', { stemId: null }), null)).toBe(false)
  })

  it('folds a short drums, rhythmic or bright row, or a percussive warm one', () => {
    expect(radioFoldCanFold(row('a', { kinds: ['drums'] }), 'z')).toBe(true)
    expect(radioFoldCanFold(row('a', { kinds: ['bright'], barLength: 4 }), 'z')).toBe(true)
    expect(radioFoldCanFold(row('a', { kinds: ['warm'] }), 'z')).toBe(false)
    expect(radioFoldCanFold(row('a', { kinds: ['warm'], percussive: true }), 'z')).toBe(true)
  })
})

describe('radioFoldPath', () => {
  it('steps toward the target on the half-beat grid and lands on it', () => {
    expect(radioFoldPath(16, 7, 3)).toEqual([13, 10, 7])
    expect(radioFoldPath(16, 7, 2)).toEqual([11.5, 7])
    expect(radioFoldPath(7, 16, 4)).toEqual([9.5, 11.5, 14, 16])
  })

  it('drops a repeated length', () => {
    expect(radioFoldPath(8, 7, 4)).toEqual([7.5, 7])
  })
})

describe('fold settings', () => {
  it('amounts clamp to 0..100 and junk takes the fallback', () => {
    expect(normalizeFoldAmount(140, 40)).toBe(100)
    expect(normalizeFoldAmount(-3, 40)).toBe(0)
    expect(normalizeFoldAmount(33.6, 40)).toBe(34)
    expect(normalizeFoldAmount('50', 40)).toBe(40)
    expect(normalizeFoldAmount(Number.NaN, 25)).toBe(25)
  })

  it('a seed is six characters of the alphabet; a pasted one is cleaned', () => {
    expect(normalizeFoldSeed('k3x9pq')).toBe('k3x9pq')
    expect(normalizeFoldSeed(' K3X-9PQ ')).toBe('k3x9pq')
    expect(normalizeFoldSeed('abc')).toBe(DEFAULT_FOLD_SEED)
    expect(normalizeFoldSeed('k3x9pq0')).toBe('k3x9pq') // 0 is not in the alphabet
    expect(normalizeFoldSeed(42)).toBe(DEFAULT_FOLD_SEED)
  })

  it('new draws six characters from the alphabet', () => {
    let i = 0
    const seed = newFoldSeed(() => (i++ % 10) / 10)
    expect(seed).toHaveLength(6)
    for (const ch of seed) expect(FOLD_SEED_ALPHABET).toContain(ch)
    expect(newFoldSeed(() => 0.9999999)).toBe('999999')
  })
})

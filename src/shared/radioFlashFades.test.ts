// The flash's quick fades (spec 2026-10-05-radio-move-visuals-design, "Flash words"): a move's
// word on for the move's duration, then out fast; a moment's word for its window. radioReadout.ts.
import { describe, expect, it } from 'vitest'
import {
  RADIO_FLASH_FADE_IN_SEC,
  RADIO_FLASH_FADE_OUT_SEC,
  pruneRadioFlashes,
  radioFlashShown,
  type RadioFlash
} from './radioReadout'
import { radioRowPlates } from './radioRowPlates'

// the web's clock: seconds, a 2 s bar (120 bpm)
const FADE = { in: RADIO_FLASH_FADE_IN_SEC, out: RADIO_FLASH_FADE_OUT_SEC }
const log: RadioFlash[] = [
  // a lift over the last 2 bars before the wrap at 20
  { rowId: 'a', word: 'lift', at: 16, until: 20, key: 'ta@20' },
  // a moment's word: hook out on b at 20
  { rowId: 'b', word: 'hook out', at: 20, key: 'b@20' }
]

describe("a move's word", () => {
  it('fades in quickly, stays on for the move, and fades out fast after it', () => {
    expect(radioFlashShown(log, 'a', 15.9, 2, FADE)).toBeNull()
    expect(radioFlashShown(log, 'a', 16.05, 2, FADE)?.opacity).toBeCloseTo(0.5, 9)
    expect(radioFlashShown(log, 'a', 16.1, 2, FADE)?.opacity).toBe(1)
    expect(radioFlashShown(log, 'a', 19.99, 2, FADE)?.opacity).toBe(1) // longer than a bar: still on
    expect(radioFlashShown(log, 'a', 20.075, 2, FADE)?.opacity).toBeCloseTo(0.5, 9)
    expect(radioFlashShown(log, 'a', 20.15, 2, FADE)).toBeNull()
  })

  it("a moment's word: on for its window (a bar), then out fast", () => {
    expect(radioFlashShown(log, 'b', 21, 2, FADE)?.opacity).toBe(1)
    expect(radioFlashShown(log, 'b', 22.075, 2, FADE)?.opacity).toBeCloseTo(0.5, 9)
    expect(radioFlashShown(log, 'b', 22.2, 2, FADE)).toBeNull()
  })

  it('without the fades, exactly as before (one window from its start, no opacity)', () => {
    expect(radioFlashShown(log, 'a', 17, 2)).toEqual({ word: 'lift', t: 0.5 })
    expect(radioFlashShown(log, 'a', 19, 2)).toBeNull()
  })

  it('the latest start wins while both show', () => {
    const two: RadioFlash[] = [...log, { rowId: 'a', word: 'gap', at: 19, until: 20, key: 'ta@20' }]
    expect(radioFlashShown(two, 'a', 19.5, 2, FADE)?.word).toBe('gap')
    expect(radioFlashShown(two, 'a', 18, 2, FADE)?.word).toBe('lift')
  })

  it('on the bars clock the same (sssketch: a bar is 1, the fades in bars)', () => {
    const bars = { in: 0.05, out: 0.075 }
    const l: RadioFlash[] = [{ rowId: 'a', word: 'wash', at: 6, until: 8, key: 'k' }]
    expect(radioFlashShown(l, 'a', 7.5, 1, bars)?.opacity).toBe(1)
    expect(radioFlashShown(l, 'a', 8.0375, 1, bars)?.opacity).toBeCloseTo(0.5, 9)
  })

  it('is kept until its move and its fade out are over', () => {
    expect(pruneRadioFlashes(log, 19, 2, undefined, 0.15).map((f) => f.key)).toEqual([
      'ta@20',
      'b@20'
    ])
    expect(pruneRadioFlashes(log, 20.1, 2, undefined, 0.15).map((f) => f.key)).toEqual([
      'ta@20',
      'b@20'
    ])
    expect(pruneRadioFlashes(log, 20.2, 2, undefined, 0.15).map((f) => f.key)).toEqual(['b@20'])
    expect(pruneRadioFlashes(log, 22.2, 2, undefined, 0.15)).toEqual([])
  })

  it('the plates draw the opacity it carries', () => {
    const plates = radioRowPlates(
      {
        rowId: 'a',
        label: 'pad',
        age: '2 laps',
        nextLabel: null,
        flash: { word: 'lift', t: 0.9, opacity: 1 }
      },
      null
    )
    expect(plates.cue?.flash).toEqual({ word: 'lift', opacity: 1 })
  })
})

describe('the prune without the fades', () => {
  it("keeps a word exactly as long as radioFlashShown shows it (today's `now - at < window`)", () => {
    // 0.7 + 0.1 and 0.8 - 0.7 disagree in floating point: the word still shows here
    const l: RadioFlash[] = [{ rowId: 'a', word: 'hole', at: 0.7, key: 'k' }]
    const now = 0.7999999999999999
    expect(radioFlashShown(l, 'a', now, 0.1)).not.toBeNull()
    expect(pruneRadioFlashes(l, now, 0.1)).toEqual(l)
    expect(pruneRadioFlashes(l, 0.8, 0.1)).toEqual([])
  })
})

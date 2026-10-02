import { describe, expect, it } from 'vitest'
import {
  ROW_PAN,
  discoverStemPans,
  panForSlots,
  stemPansForRifff,
  stereoPanFrame
} from './radioPan'
import { stemKey, type SoundType } from './types'

const slot = (...kinds: string[]): { kinds: never[] } => ({ kinds: kinds as never[] })

// moved from ell.ing/radio src/radio/pan.test.ts (2026-10-01), unchanged but for the width cases
describe('panForSlots', () => {
  it('is subtle: 0.25', () => {
    expect(ROW_PAN).toBe(0.25)
  })

  it('keeps drums and bass in the middle', () => {
    expect(panForSlots([slot('drums'), slot('bass')])).toEqual([0, 0])
  })

  it('a slot carrying drums or bass among other kinds stays centred too', () => {
    expect(panForSlots([slot('lead', 'bass'), slot('warm', 'drums')])).toEqual([0, 0])
  })

  it('alternates the rest +, -, + in slot order, skipping the centred ones', () => {
    expect(
      panForSlots([slot('drums'), slot('bass'), slot('lead'), slot('warm'), slot('bright')])
    ).toEqual([0, 0, ROW_PAN, -ROW_PAN, ROW_PAN])
    expect(panForSlots([slot('lead'), slot('drums'), slot('warm')])).toEqual([ROW_PAN, 0, -ROW_PAN])
  })

  it('a slot with no kinds is not drums or bass: it is placed', () => {
    expect(panForSlots([slot()])).toEqual([ROW_PAN])
  })

  it('is empty for no slots', () => {
    expect(panForSlots([])).toEqual([])
  })

  it('honours a width (the sound settings), ROW_PAN when none is given', () => {
    expect(panForSlots([slot('lead'), slot('drums'), slot('warm')], 0.4)).toEqual([0.4, 0, -0.4])
    expect(panForSlots([slot('lead'), slot('warm')], 0)).toEqual([0, -0])
  })
})

describe('stemPansForRifff (the timeline: a rifff clip stems, by slot and SoundType)', () => {
  const stem = (slot: number, type: SoundType): { slot: number; type: SoundType } => ({
    slot,
    type
  })

  it('drums and bass are centred; the rest alternate +, - in slot order, keyed by slot', () => {
    const pans = stemPansForRifff([
      stem(1, 'drums'),
      stem(2, 'notes'),
      stem(3, 'bass'),
      stem(4, 'fx'),
      stem(5, 'sampler')
    ])
    expect([...pans.entries()]).toEqual([
      [1, 0],
      [2, ROW_PAN],
      [3, 0],
      [4, -ROW_PAN],
      [5, ROW_PAN]
    ])
  })

  it('goes by slot order, not the order the stems are given in', () => {
    const pans = stemPansForRifff([stem(4, 'fx'), stem(2, 'notes'), stem(1, 'drums')])
    expect(pans.get(2)).toBe(ROW_PAN)
    expect(pans.get(4)).toBe(-ROW_PAN)
    expect(pans.get(1)).toBe(0)
  })

  it('honours a width', () => {
    const pans = stemPansForRifff([stem(1, 'notes'), stem(2, 'extInst')], 0.1)
    expect(pans.get(1)).toBe(0.1)
    expect(pans.get(2)).toBe(-0.1)
  })

  it('is empty for no stems', () => {
    expect(stemPansForRifff([]).size).toBe(0)
  })
})

describe('discoverStemPans (Discover: every slot, by slot id, onto the preview stems)', () => {
  const s = (id: string, ...kinds: string[]): { id: string; kinds: never[] } => ({
    id,
    kinds: kinds as never[]
  })
  const slots = [s('a', 'drums'), s('b', 'lead'), s('c', 'warm'), s('d', 'bass'), s('e', 'bright')]

  it('pans over ALL the slots, so a member keeps its row pan whoever else is playing', () => {
    // Only b and e are in the mix (c is muted): e is still the third placed row, so +width.
    const pans = discoverStemPans(slots, ['b', 'e'], 'g')
    expect(pans.get(stemKey('g', 1))).toBe(ROW_PAN)
    expect(pans.get(stemKey('g', 2))).toBe(ROW_PAN)
    expect(pans.size).toBe(2)
  })

  it('a mute or a solo moves no row', () => {
    const all = discoverStemPans(slots, ['a', 'b', 'c', 'd', 'e'], 'g')
    const fewer = discoverStemPans(slots, ['c'], 'g')
    expect(all.get(stemKey('g', 3))).toBe(-ROW_PAN)
    expect(fewer.get(stemKey('g', 1))).toBe(-ROW_PAN)
  })

  it('keys by member order, the preview rifff numbering (stem i + 1)', () => {
    const pans = discoverStemPans(slots, ['e', 'a', 'c'], 'g')
    expect([...pans.entries()]).toEqual([
      [stemKey('g', 1), ROW_PAN],
      [stemKey('g', 2), 0],
      [stemKey('g', 3), -ROW_PAN]
    ])
  })

  it('honours a width', () => {
    const pans = discoverStemPans(slots, ['b', 'c'], 'g', 0.5)
    expect(pans.get(stemKey('g', 1))).toBe(0.5)
    expect(pans.get(stemKey('g', 2))).toBe(-0.5)
  })

  it('a member whose slot is not listed is centred', () => {
    expect(discoverStemPans(slots, ['zzz'], 'g').get(stemKey('g', 1))).toBe(0)
  })
})

describe('stereoPanFrame (the StereoPannerNode law, twin of the engine StemPan.h)', () => {
  it('pan 0 is the frame unchanged', () => {
    expect(stereoPanFrame(0.3, -0.2, 0)).toEqual([0.3, -0.2])
  })

  it('+p: L cos(p pi/2), R + L sin(p pi/2)', () => {
    const [l, r] = stereoPanFrame(0.3, -0.2, 0.25)
    expect(l).toBeCloseTo(0.3 * Math.cos(Math.PI / 8), 12)
    expect(r).toBeCloseTo(-0.2 + 0.3 * Math.sin(Math.PI / 8), 12)
  })

  it('-p: L + R cos((1 - p) pi/2), R sin((1 - p) pi/2)', () => {
    const [l, r] = stereoPanFrame(0.3, -0.2, -0.25)
    expect(l).toBeCloseTo(0.3 + -0.2 * Math.cos((0.75 * Math.PI) / 2), 12)
    expect(r).toBeCloseTo(-0.2 * Math.sin((0.75 * Math.PI) / 2), 12)
  })

  it('a mono frame at +0.25: L = cos(pi/8) x, R = (1 + sin(pi/8)) x', () => {
    const [l, r] = stereoPanFrame(0.5, 0.5, 0.25)
    expect(l).toBeCloseTo(Math.cos(Math.PI / 8) * 0.5, 12)
    expect(r).toBeCloseTo((1 + Math.sin(Math.PI / 8)) * 0.5, 12)
  })

  it('clamps out of range and treats non-finite as centred', () => {
    expect(stereoPanFrame(0.3, -0.2, 5)).toEqual(stereoPanFrame(0.3, -0.2, 1))
    expect(stereoPanFrame(0.3, -0.2, NaN)).toEqual([0.3, -0.2])
  })
})

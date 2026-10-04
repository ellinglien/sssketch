// Dig on the desktop's rows (spec 2026-10-03-radio-anointed-stems-design section 3; plan Task 14):
// the dug row pruned with its rows, the anchor's candidate, the riff neighbours the ranking learns,
// and the near pool from the adjacency call.
import { describe, expect, it } from 'vitest'
import {
  learnRadioDigNear,
  pruneRadioDig,
  radioDigAnchorCandidate,
  radioDigNearOf,
  radioDigNearPool
} from './radioDig'

const c = (stemCID: string, riffCID = 'r'): { stemCID: string; riffCID: string } => ({
  stemCID,
  riffCID
})

describe('pruneRadioDig', () => {
  it('keeps the dug row while it is live, and goes with it', () => {
    expect(pruneRadioDig('a', new Set(['a', 'b']))).toBe('a')
    expect(pruneRadioDig('a', new Set(['b']))).toBeNull()
    expect(pruneRadioDig(null, new Set(['a']))).toBeNull()
  })
})

describe('radioDigAnchorCandidate', () => {
  it('what the row plays, with no hook', () => {
    const playing = c('p')
    expect(radioDigAnchorCandidate(playing, null)).toBe(playing)
    expect(radioDigAnchorCandidate(null, null)).toBeNull()
  })
  it("the hook's stem when the row has one (in or away), its candidate known", () => {
    const hooked = c('h')
    expect(radioDigAnchorCandidate(c('sub'), { stemId: 'h', candidate: hooked })).toBe(hooked)
  })
  it("a hook in plays its own stem: either candidate is the hook's", () => {
    const playing = c('h')
    expect(radioDigAnchorCandidate(playing, { stemId: 'h', candidate: null })).toBe(playing)
  })
  it("the hook's candidate unknown: what the row plays", () => {
    const playing = c('sub')
    expect(radioDigAnchorCandidate(playing, { stemId: 'h', candidate: null })).toBe(playing)
    expect(radioDigAnchorCandidate(playing, { stemId: 'h', candidate: c('other') })).toBe(playing)
  })
})

describe('the riff neighbours, learned per anchor riff', () => {
  it('adds to the same anchor riff, starts again for another', () => {
    let k = learnRadioDigNear(null, 'r1', ['a', 'b'])
    expect([...radioDigNearOf(k, 'r1')!]).toEqual(['a', 'b'])
    k = learnRadioDigNear(k, 'r1', ['b', 'c'])
    expect([...radioDigNearOf(k, 'r1')!].sort()).toEqual(['a', 'b', 'c'])
    expect(radioDigNearOf(k, 'r2')).toBeUndefined()
    k = learnRadioDigNear(k, 'r2', ['x'])
    expect([...radioDigNearOf(k, 'r2')!]).toEqual(['x'])
    expect(radioDigNearOf(k, 'r1')).toBeUndefined()
  })
  it('nothing learned is nothing near', () => {
    expect(radioDigNearOf(null, 'r1')).toBeUndefined()
    expect(radioDigNearOf(learnRadioDigNear(null, 'r1', []), 'r1')).toBeUndefined()
  })
  it('an empty riff is never a neighbour', () => {
    expect(radioDigNearOf(learnRadioDigNear(null, 'r1', ['', 'a']), 'r1')).toEqual(new Set(['a']))
  })
})

describe('radioDigNearPool', () => {
  it('newer then older, when any is unused', () => {
    const near = { newer: [c('n1'), c('n2')], older: [c('o1')] }
    expect(radioDigNearPool(near, (x) => x.stemCID === 'o1')?.map((x) => x.stemCID)).toEqual([
      'n1',
      'n2',
      'o1'
    ])
  })
  it('null when none is unused or there are none', () => {
    expect(radioDigNearPool({ newer: [c('n1')], older: [] }, () => false)).toBeNull()
    expect(radioDigNearPool({ newer: [], older: [] }, () => true)).toBeNull()
  })
})

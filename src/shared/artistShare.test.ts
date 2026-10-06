// src/shared/artistShare.test.ts -- combine artists' even share (spec 2026-10-06-combine-artists-
// design §3). Seeded: every "random" here is seededRandom, so a failure reproduces.
import { describe, expect, it } from 'vitest'
import {
  ARTIST_EMPTY_TTL_MS,
  ARTIST_SHARE_MAX_OWED,
  EMPTY_ARTIST_MEMO,
  EMPTY_ARTIST_SHARE,
  artistKnownEmpty,
  artistPickAttempts,
  artistShareOrder,
  beginArtistTurn,
  endArtistTurn,
  landArtistTurn,
  noteArtistEmpty,
  reconcileArtistShare,
  type ArtistShareLedger
} from './artistShare'
import { memberKey, type ArtistMember, type ArtistSelection } from './artistSelection'
import { rollFilterForArtist } from './discoverArtist'
import { seededRandom } from './seededRandom'

function counting(random: () => number): { random: () => number; calls: () => number } {
  let n = 0
  return {
    random: () => {
      n += 1
      return random()
    },
    calls: () => n
  }
}

/** Sequential picks: ask in order, the first member that `fits` the row lands. */
function simulate(
  selection: ArtistSelection,
  rows: readonly string[],
  fits: (member: ArtistMember, row: string) => boolean,
  seed: string
): { landed: ArtistMember[]; ledger: ArtistShareLedger } {
  const random = seededRandom(seed)
  let ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, selection)
  const landed: ArtistMember[] = []
  for (const row of rows) {
    const who = artistShareOrder(selection, ledger, random).find((m) => fits(m, row))
    if (who === undefined) continue
    ledger = landArtistTurn(ledger, who)
    landed.push(who)
  }
  return { landed, ledger }
}

function tally(landed: readonly ArtistMember[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of landed) out[memberKey(m)] = (out[memberKey(m)] ?? 0) + 1
  return out
}

function longestRun(landed: readonly ArtistMember[], member: ArtistMember): number {
  let best = 0
  let run = 0
  for (const m of landed) {
    run = m === member ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

describe('one member', () => {
  it('is one attempt with today’s filter, and draws nothing', () => {
    for (const [sel, own, onlyOwn] of [
      [[null], 'elling', false],
      [[null], 'elling', true],
      [[null], '', false],
      [['bananepoep'], 'elling', false],
      [['bananepoep'], '', true]
    ] as [ArtistSelection, string, boolean][]) {
      const r = counting(seededRandom('one'))
      const attempts = artistPickAttempts(sel, EMPTY_ARTIST_SHARE, r.random, own, onlyOwn)
      expect(attempts).toEqual([
        { member: sel[0], filter: rollFilterForArtist(sel[0], own, onlyOwn) }
      ])
      expect(r.calls()).toBe(0)
    }
  })
  it('still draws nothing with a ledger and a skip memo', () => {
    const r = counting(Math.random)
    let ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, ['a'])
    ledger = landArtistTurn(beginArtistTurn(ledger, 'a'), 'a')
    expect(artistShareOrder(['a'], ledger, r.random, new Set(['a']))).toEqual(['a'])
    expect(r.calls()).toBe(0)
  })
})

describe('even turns', () => {
  it('three artists who all fit: exactly level after every round', () => {
    const sel: ArtistSelection = ['a', 'b', null]
    const { landed } = simulate(sel, Array(300).fill('row'), () => true, 'level')
    expect(tally(landed)).toEqual({ a: 100, b: 100, ':me': 100 })
    // never more than one apart at any point
    const running: Record<string, number> = {}
    for (const m of landed) {
      running[memberKey(m)] = (running[memberKey(m)] ?? 0) + 1
      const v = Object.values(running)
      expect(Math.max(...v) - (v.length < 3 ? 0 : Math.min(...v))).toBeLessThanOrEqual(1)
    }
  })

  it('size does not matter: the share counts turns, not stems', () => {
    // a: 30,000 stems, b: 300 -- both fit every row, so both get half
    const { landed } = simulate(['a', 'b'], Array(200).fill('row'), () => true, 'size')
    expect(tally(landed)).toEqual({ a: 100, b: 100 })
  })

  it('ties break randomly, and reproducibly from a seed', () => {
    const order = (seed: string): ArtistMember[] =>
      simulate(['a', 'b', 'c'], Array(30).fill('row'), () => true, seed).landed
    expect(order('s1')).toEqual(order('s1'))
    expect(order('s1')).not.toEqual(order('s2'))
    expect(order('s1').slice(0, 3)).not.toEqual(['a', 'b', 'c']) // not plain round-robin
  })

  it('picks in flight count: a roll-all of four spreads two and two', () => {
    const random = seededRandom('flight')
    const sel: ArtistSelection = ['a', 'b']
    let ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, sel)
    const asked: ArtistMember[] = []
    for (let i = 0; i < 4; i += 1) {
      const m = artistShareOrder(sel, ledger, random)[0]
      ledger = beginArtistTurn(ledger, m)
      asked.push(m)
    }
    expect(tally(asked)).toEqual({ a: 2, b: 2 })
    for (const m of asked) ledger = endArtistTurn(ledger, m)
    expect(ledger.inFlight).toEqual({ a: 0, b: 0 })
    expect(endArtistTurn(ledger, 'a').inFlight.a).toBe(0) // never below zero
  })
})

describe('a member with nothing for a row', () => {
  it('passes its turn on; the others share the rest evenly', () => {
    const sel: ArtistSelection = ['nobass', 'b', 'c']
    const rows = Array(300).fill('bass')
    const { landed } = simulate(sel, rows, (m) => m !== 'nobass', 'pass')
    expect(tally(landed)).toEqual({ b: 150, c: 150 })
  })

  it('is owed at most MAX_OWED, so it never takes a burst when it fits again', () => {
    const sel: ArtistSelection = ['nobass', 'b']
    const rows = [...Array(100).fill('bass'), ...Array(100).fill('drums')]
    const fits = (m: ArtistMember, row: string): boolean => m !== 'nobass' || row !== 'bass'
    const { landed } = simulate(sel, rows, fits, 'owed')
    const drums = landed.slice(100)
    expect(longestRun(drums, 'nobass')).toBeLessThanOrEqual(ARTIST_SHARE_MAX_OWED + 1)
    const t = tally(drums)
    expect(Math.abs(t.nobass - t.b)).toBeLessThanOrEqual(ARTIST_SHARE_MAX_OWED + 1)
  })

  it('a row nobody fits is skipped by everyone and charges nobody', () => {
    const { landed, ledger } = simulate(['a', 'b'], ['x', 'x'], () => false, 'none')
    expect(landed).toEqual([])
    expect(ledger.landed).toEqual({ a: 0, b: 0 })
  })
})

describe('the empty memo', () => {
  it('skips a member known empty for those kinds, until it expires', () => {
    let memo = noteArtistEmpty(EMPTY_ARTIST_MEMO, 'a', 'bass', 1000)
    expect([...artistKnownEmpty(memo, ['a', 'b'], 'bass', 1000)]).toEqual(['a'])
    expect([...artistKnownEmpty(memo, ['a', 'b'], 'drums', 1000)]).toEqual([])
    expect([...artistKnownEmpty(memo, ['a', 'b'], 'bass', 1000 + ARTIST_EMPTY_TTL_MS)]).toEqual([])
    memo = noteArtistEmpty(memo, null, 'bass', 1000)
    expect([...artistKnownEmpty(memo, [null, 'a'], 'bass', 2000)].sort()).toEqual([':me', 'a'])
  })
  it('the order leaves skipped members out, but never everyone', () => {
    const random = seededRandom('skip')
    const ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, ['a', 'b'])
    expect(artistShareOrder(['a', 'b'], ledger, random, new Set(['a']))).toEqual(['b'])
    expect(artistShareOrder(['a', 'b'], ledger, random, new Set(['a', 'b'])).sort()).toEqual([
      'a',
      'b'
    ])
  })
})

describe('reconcileArtistShare', () => {
  it('a joining artist starts level with the least served, not at zero', () => {
    let ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, ['a', 'b'])
    for (let i = 0; i < 9; i += 1) ledger = landArtistTurn(landArtistTurn(ledger, 'a'), 'b')
    ledger = landArtistTurn(ledger, 'a')
    const next = reconcileArtistShare(ledger, ['a', 'b', 'c'])
    expect(next.landed).toEqual({ a: 10, b: 9, c: 9 })
  })
  it('drops members gone, and starts a fresh selection from zero', () => {
    let ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, ['a', 'b'])
    ledger = beginArtistTurn(landArtistTurn(ledger, 'a'), 'b')
    expect(reconcileArtistShare(ledger, ['b'])).toEqual({ landed: { b: 0 }, inFlight: { b: 1 } })
    expect(reconcileArtistShare(ledger, ['x', 'y'])).toEqual({
      landed: { x: 0, y: 0 },
      inFlight: {}
    })
  })
  it('the debt cap holds across landings', () => {
    let ledger = reconcileArtistShare(EMPTY_ARTIST_SHARE, ['a', 'b'])
    for (let i = 0; i < 50; i += 1) ledger = landArtistTurn(ledger, 'b')
    expect(ledger.landed).toEqual({ a: 48, b: 50 })
  })
})

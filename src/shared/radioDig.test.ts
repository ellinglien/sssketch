// Dig (spec 2026-10-03-radio-anointed-stems-design section 3): the anchor, the near draw and the
// ranking term.
import { describe, expect, it } from 'vitest'
import type { DiscoverCandidate } from './discoverCandidate'
import { rankCandidates } from './discoverRanking'
import { favesDraw } from './discoverFaves'
import {
  DIG_NEAR_SEC,
  DIG_NEAR_SHARE,
  DIG_TIME_SCALE_SEC,
  DIG_WEIGHT,
  digNearDraw,
  isNearForDig,
  radioDigAnchorStemId,
  radioDigCloseness,
  toggleRadioDig,
  type RankDig
} from './radioDig'
import { seededRandom } from './seededRandom'

const c = (o: Partial<DiscoverCandidate>): DiscoverCandidate => ({
  stemCID: 's',
  jamCID: 'j',
  riffCID: 'r',
  presetName: '',
  creatorUserName: 'elling',
  slotKinds: ['lead'],
  drumSubRole: null,
  riffBpm: 120,
  traitValues: {},
  traitPercentiles: {},
  kindSources: {},
  riffCreationTime: null,
  ...o
})
const DIG: RankDig = { jamCID: 'j', t: 1000, traits: { bright: 0.8 } }

describe('the anchor and the toggle', () => {
  it('one dug row: tapping another moves it, tapping it again stops', () => {
    expect(toggleRadioDig(null, 'a')).toBe('a')
    expect(toggleRadioDig('a', 'b')).toBe('b')
    expect(toggleRadioDig('a', 'a')).toBeNull()
  })
  it('a dug row with a hook anchors on the hook', () => {
    expect(radioDigAnchorStemId('sub', 'hooked')).toBe('hooked')
    expect(radioDigAnchorStemId('playing', null)).toBe('playing')
  })
})

describe('closeness', () => {
  it('the parts: jam 0.5, time 0.3, traits 0.2, the trait part neutral when unknown', () => {
    expect(
      radioDigCloseness(DIG, c({ riffCreationTime: 1000, traitPercentiles: { bright: 0.8 } }))
    ).toBeCloseTo(1)
    expect(radioDigCloseness(DIG, c({ jamCID: 'x' }))).toBeCloseTo(0.1)
    expect(radioDigCloseness(DIG, c({}))).toBeCloseTo(0.5 + 0.1)
    expect(
      radioDigCloseness(DIG, c({ jamCID: 'x', riffCreationTime: 1000 + DIG_TIME_SCALE_SEC }))
    ).toBeCloseTo(0.3 * Math.exp(-1) + 0.1)
    expect(
      radioDigCloseness(DIG, c({ jamCID: 'x', traitPercentiles: { bright: 0.3 } }))
    ).toBeCloseTo(0.2 * 0.5)
  })
  it('a riff neighbour is near in time, whatever the clock says', () => {
    const dig = { ...DIG, nearRiffCIDs: new Set(['n']) }
    expect(radioDigCloseness(dig, c({ riffCID: 'n', riffCreationTime: 1e9 }))).toBeCloseTo(
      0.5 + 0.3 + 0.1
    )
    // the web's candidates have no riff: never a neighbour
    expect(
      radioDigCloseness({ ...DIG, nearRiffCIDs: new Set(['']) }, c({ riffCID: '' }))
    ).toBeCloseTo(0.6)
  })
})

describe('rankCandidates dig', () => {
  const pool = Array.from({ length: 40 }, (_, i) =>
    c({
      stemCID: `s${i}`,
      jamCID: i % 3 === 0 ? 'j' : `j${i}`,
      riffBpm: 100 + i,
      riffCreationTime: 1000 + i * 3600,
      traitPercentiles: { bright: (i % 10) / 10 }
    })
  )
  it('absent: identical ranking', () => {
    const a = rankCandidates(pool, { targetBpm: 120 })
    const b = rankCandidates(pool, { targetBpm: 120, dig: undefined })
    expect(b).toEqual(a)
  })
  it('the term is between 0 and DIG_WEIGHT, added to every candidate', () => {
    const plain = new Map(
      rankCandidates(pool, { targetBpm: 120 }).map((r) => [r.candidate.stemCID, r.score])
    )
    for (const r of rankCandidates(pool, { targetBpm: 120, dig: DIG })) {
      const d = r.score - plain.get(r.candidate.stemCID)!
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(DIG_WEIGHT + 1e-9)
    }
  })
})

describe('the near draw', () => {
  it('a third of picks while on; no draw at all while off', () => {
    let n = 0
    const r = seededRandom('near')
    const counting = (): number => {
      n++
      return r()
    }
    expect(digNearDraw(false, counting)).toBe(false)
    expect(n).toBe(0)
    let near = 0
    for (let i = 0; i < 10000; i++) if (digNearDraw(true, counting)) near++
    expect(n).toBe(10000)
    expect(near / 10000).toBeCloseTo(DIG_NEAR_SHARE, 1)
  })
  it('composes after the faves draw: favourites-only first, so the dig draw is the second', () => {
    const r = seededRandom('order')
    const draws: string[] = []
    const tag = (name: string) => (): number => {
      draws.push(name)
      return r()
    }
    favesDraw(50, tag('faves'))
    digNearDraw(true, tag('dig'))
    expect(draws).toEqual(['faves', 'dig'])
  })
  it("the web's near pool: same jam, within 3 hours; unknown time or wide: the whole jam", () => {
    const anchor = { jamCID: 'j', t: 10000 }
    expect(isNearForDig(anchor, { jam: 'j', t: 10000 + DIG_NEAR_SEC })).toBe(true)
    expect(isNearForDig(anchor, { jam: 'j', t: 10000 + DIG_NEAR_SEC + 1 })).toBe(false)
    expect(isNearForDig(anchor, { jam: 'j', t: 10000 + DIG_NEAR_SEC + 1 }, true)).toBe(true)
    expect(isNearForDig(anchor, { jam: 'j', t: null })).toBe(true)
    expect(isNearForDig({ jamCID: 'j', t: null }, { jam: 'j', t: 5 })).toBe(true)
    expect(isNearForDig(anchor, { jam: 'k', t: 10000 })).toBe(false)
  })
})

// Dig (spec 2026-10-03-radio-anointed-stems-design section 3): the anchor, the near draw and the
// ranking term.
import { describe, expect, it } from 'vitest'
import type { DiscoverCandidate } from './discoverCandidate'
import type { DiscoverTraitKind } from './discoverSlotKind'
import { rankCandidates } from './discoverRanking'
import { favesDraw } from './discoverFaves'
import {
  DIG_NEAR_SEC,
  DIG_NEAR_SHARE,
  DIG_TIME_SCALE_SEC,
  DIG_WEIGHT,
  digNearDraw,
  isNearForDig,
  radioDigAnchorOf,
  radioDigAnchorStemId,
  radioDigCloseness,
  rankDigOf,
  toggleRadioDig,
  type RankDig
} from './radioDig'
import { hashText, seededRandom } from './seededRandom'

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

/** A fingerprint of rankCandidates over 60 seeded pools: ranked stemCIDs and exact scores, with
 * favourites (sets, weights, scale), target traits (percentiles, raw fields, nulls) and clash. */
function rankTrace(dig?: RankDig): string {
  const KINDS: DiscoverTraitKind[] = ['bassHeavy', 'rhythmic', 'bright', 'warm']
  const out: string[] = []
  for (let seed = 0; seed < 60; seed++) {
    const r = seededRandom(`rank-fp-${seed}`)
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
    const maybe = (v: number): number | null => (r() < 0.2 ? null : v)
    const n = 1 + Math.floor(r() * 40)
    const pool: DiscoverCandidate[] = []
    for (let i = 0; i < n; i++) {
      const pct: Partial<Record<DiscoverTraitKind, number | null>> = {}
      const vals: Partial<Record<DiscoverTraitKind, number | null>> = {}
      for (const k of KINDS) {
        if (r() < 0.6) pct[k] = maybe(r())
        if (r() < 0.6) vals[k] = maybe(r() * 4000)
      }
      pool.push(
        c({
          stemCID: `s${seed}-${i}`,
          jamCID: pick(['j', 'k', 'l', 'm']),
          riffCID: pick(['r1', 'r2', 'r3', '']),
          riffBpm: 70 + Math.floor(r() * 110),
          riffCreationTime: r() < 0.2 ? null : 1000 + Math.floor(r() * 86400 * 3),
          traitValues: vals,
          traitFieldValues:
            r() < 0.5
              ? {
                  spectralCentroidHz: maybe(r() * 4000),
                  spectralCentroidFftHz: maybe(r() * 4000),
                  transientDensity: maybe(r() * 10),
                  rhythmicStrength: maybe(r()),
                  bassEnergyRatio: maybe(r())
                }
              : undefined,
          traitPercentiles: pct
        })
      )
    }
    const faves = new Set(pool.filter(() => r() < 0.25).map((p) => p.stemCID))
    const weighted = r() < 0.5
    const opts: Parameters<typeof rankCandidates>[1] = {
      targetBpm: 80 + Math.floor(r() * 100),
      ...(r() < 0.7 ? { favouriteStemCIDs: faves } : {}),
      ...(weighted ? { favouriteWeight: (id: string) => (id.length % 5) / 4 } : {}),
      ...(r() < 0.5 ? { favouriteScale: r() } : {}),
      targetTraits: KINDS.filter(() => r() < 0.4),
      ...(r() < 0.4
        ? { clash: { amount: r(), bed: { rhythmic: r(), ...(r() < 0.5 ? { bright: r() } : {}) } } }
        : {}),
      ...(dig !== undefined ? { dig } : {})
    }
    for (const x of rankCandidates(pool, opts)) out.push(`${x.candidate.stemCID}:${x.score}`)
    out.push('|')
  }
  return out.join(',')
}

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

describe('the anchor from a record or a candidate', () => {
  it("the web's index record: id, jam, t, traits", () => {
    expect(
      radioDigAnchorOf('row1', { id: 'stem', jam: 'j', t: 5, traits: { bright: 0.4 } })
    ).toEqual({ rowId: 'row1', stemId: 'stem', jamCID: 'j', t: 5, traits: { bright: 0.4 } })
    expect(radioDigAnchorOf('row1', { id: 'stem', jam: 'j', t: Number.NaN })).toEqual({
      rowId: 'row1',
      stemId: 'stem',
      jamCID: 'j',
      t: null,
      traits: {}
    })
  })
  it("the desktop's candidate: stemCID, jamCID, riffCreationTime, traitPercentiles, riffCID", () => {
    const cand = c({
      stemCID: 'stem',
      jamCID: 'j',
      riffCID: 'riff',
      riffCreationTime: 7,
      traitPercentiles: { warm: 0.2, bright: null }
    })
    const a = radioDigAnchorOf('row2', cand)
    expect(a).toEqual({
      rowId: 'row2',
      stemId: 'stem',
      jamCID: 'j',
      t: 7,
      traits: { warm: 0.2, bright: null },
      riffCID: 'riff'
    })
    expect(a.traits).not.toBe(cand.traitPercentiles)
    expect(radioDigAnchorOf('row2', c({ riffCID: '' })).riffCID).toBeUndefined()
  })
  it('feeds rankDigOf and closeness: the anchor is near itself', () => {
    const cand = c({ jamCID: 'j', riffCreationTime: 1000, traitPercentiles: { bright: 0.8 } })
    const dig = rankDigOf(radioDigAnchorOf('row', cand))!
    expect(radioDigCloseness(dig, cand)).toBeCloseTo(1)
    expect(rankDigOf(null)).toBeUndefined()
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
  it('a riff neighbour overrides a far time, across jams too', () => {
    const far = c({ jamCID: 'x', riffCID: 'n', riffCreationTime: 1000 + 100 * DIG_TIME_SCALE_SEC })
    expect(radioDigCloseness(DIG, far)).toBeCloseTo(0.1)
    expect(radioDigCloseness({ ...DIG, nearRiffCIDs: new Set(['n']) }, far)).toBeCloseTo(0.3 + 0.1)
    expect(radioDigCloseness({ ...DIG, nearRiffCIDs: new Set(['other']) }, far)).toBeCloseTo(0.1)
  })
  it('null and non-finite traits and times are unknown; out-of-range percentiles stay in bounds', () => {
    const odd: RankDig = {
      jamCID: 'j',
      t: Number.NaN,
      traits: { bright: Number.NaN, warm: null, rhythmic: Number.POSITIVE_INFINITY }
    }
    expect(
      radioDigCloseness(
        odd,
        c({ riffCreationTime: 1000, traitPercentiles: { bright: 0.5, warm: 0.5, rhythmic: null } })
      )
    ).toBeCloseTo(0.5 + 0.1)
    expect(
      radioDigCloseness(
        { jamCID: 'x', t: 1000, traits: { bright: 0 } },
        c({ riffCreationTime: Number.POSITIVE_INFINITY, traitPercentiles: { bright: 5 } })
      )
    ).toBe(0)
    const r = seededRandom('bounds')
    const wild = (): number | null =>
      [null, Number.NaN, Number.NEGATIVE_INFINITY, r() * 4 - 2, r()][Math.floor(r() * 5)]
    for (let i = 0; i < 2000; i++) {
      const v = radioDigCloseness(
        { jamCID: 'j', t: wild(), traits: { bright: wild(), warm: wild(), bassHeavy: wild() } },
        c({
          jamCID: r() < 0.5 ? 'j' : 'k',
          riffCreationTime: wild(),
          traitPercentiles: { bright: wild(), warm: wild(), bassHeavy: wild() }
        })
      )
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
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
  it('absent: scores and order exactly as before dig (fingerprint recorded from 78522b9)', () => {
    expect(hashText(rankTrace())).toBe('c35bcf87')
    expect(rankTrace().length).toBe(27861)
    // and the trace sees the term when it is there
    expect(hashText(rankTrace(DIG))).not.toBe('c35bcf87')
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

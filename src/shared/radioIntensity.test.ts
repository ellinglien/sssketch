// The per-stem intensity score and the lean on picks (spec 2026-10-05-radio-intensity-arc-design
// sections 2.1-2.3): radioIntensity.ts, and rankCandidates' `intensity`.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  INTENSITY_BAND_CHANCE,
  INTENSITY_WEIGHTS,
  applyIntensityBand,
  intensityPoolRanks,
  intensityTerms,
  radioBedIntensity,
  radioIntensityRankOf,
  radioIntensityRoleWeight,
  roundIntensity,
  stemIntensityParts,
  stemIntensityScore,
  type IntensityValues
} from './radioIntensity'
import { buildQuantileTable, type TraitQuantileTables } from './traitQuantiles'
import { rankCandidates } from './discoverRanking'
import type { DiscoverCandidate } from './discoverCandidate'
import { seededRandom } from './seededRandom'

/** Tables where a value v in 0..100 sits at percentile v / 100 for every field. */
const linear = buildQuantileTable(Array.from({ length: 101 }, (_, i) => i))!
const TABLES: TraitQuantileTables = {
  transientDensity: linear,
  rhythmicStrength: linear,
  bassEnergyRatio: linear,
  lowLevelDb: linear,
  loudnessLufs: linear,
  activeFraction: linear,
  spectralCentroidHz: linear,
  spectralCentroidFftHz: linear
}
const ALL: IntensityValues = {
  transientDensity: 80,
  rhythmicStrength: 60,
  bassEnergyRatio: 40,
  lowLevelDb: 20,
  loudnessLufs: 50,
  activeFraction: 70,
  spectralCentroidHz: 10,
  spectralCentroidFftHz: 90
}

describe('stemIntensityScore', () => {
  it('weighs busy, low, full and bright 0.40, 0.35, 0.15, 0.10', () => {
    expect(INTENSITY_WEIGHTS).toEqual({ busy: 0.4, low: 0.35, full: 0.15, bright: 0.1 })
    const parts = stemIntensityParts(ALL, TABLES)
    expect(parts.busy).toBeCloseTo(0.6 * 0.8 + 0.4 * 0.6, 9)
    expect(parts.low).toBeCloseTo(0.5 * 0.4 + 0.5 * 0.2, 9)
    expect(parts.full).toBeCloseTo(0.5 * 0.5 + 0.5 * 0.7, 9)
    expect(parts.bright).toBeCloseTo(0.9, 9) // the FFT centroid wins when it has a table
    expect(stemIntensityScore(ALL, TABLES)).toBeCloseTo(
      0.4 * parts.busy! + 0.35 * parts.low! + 0.15 * parts.full! + 0.1 * parts.bright!,
      9
    )
  })

  it('renormalises inside a part when an input is missing (version 1, before the backfill)', () => {
    const v1 = { ...ALL, rhythmicStrength: undefined, lowLevelDb: null }
    const parts = stemIntensityParts(v1, TABLES)
    expect(parts.busy).toBeCloseTo(0.8, 9)
    expect(parts.low).toBeCloseTo(0.4, 9)
  })

  it('renormalises across parts when a part is missing', () => {
    const noFull = { ...ALL, loudnessLufs: null, activeFraction: undefined }
    const p = stemIntensityParts(noFull, TABLES)
    expect(p.full).toBeNull()
    expect(stemIntensityScore(noFull, TABLES)).toBeCloseTo(
      (0.4 * p.busy! + 0.35 * p.low! + 0.1 * p.bright!) / 0.85,
      9
    )
  })

  it('a field with no table yet counts as missing for every stem', () => {
    const early: TraitQuantileTables = { ...TABLES }
    delete early.lowLevelDb
    delete early.loudnessLufs
    delete early.activeFraction
    const before = stemIntensityScore(ALL, early)
    const p = stemIntensityParts(ALL, early)
    expect(p.full).toBeNull()
    expect(p.low).toBeCloseTo(0.4, 9)
    expect(before).toBeCloseTo((0.4 * p.busy! + 0.35 * 0.4 + 0.1 * p.bright!) / 0.85, 9)
  })

  it('bright falls back to the 3-band centroid without the FFT one or its table', () => {
    expect(stemIntensityParts({ ...ALL, spectralCentroidFftHz: null }, TABLES).bright).toBeCloseTo(
      0.1,
      9
    )
    const noFft: TraitQuantileTables = { ...TABLES }
    delete noFft.spectralCentroidFftHz
    expect(stemIntensityParts(ALL, noFft).bright).toBeCloseTo(0.1, 9)
  })

  it('is null with neither busy nor low, and stays in [0, 1]', () => {
    expect(
      stemIntensityScore({ loudnessLufs: 50, activeFraction: 50, spectralCentroidHz: 50 }, TABLES)
    ).toBeNull()
    expect(stemIntensityScore({}, TABLES)).toBeNull()
    const r = seededRandom('score-bounds')
    for (let i = 0; i < 2000; i++) {
      const v: IntensityValues = {}
      for (const k of Object.keys(ALL) as (keyof IntensityValues)[]) {
        if (r() < 0.7) v[k] = r() * 140 - 20
      }
      const s = stemIntensityScore(v, TABLES)
      if (s !== null) {
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThanOrEqual(1)
      }
    }
  })

  it('rounds for the index', () => {
    expect(roundIntensity(0.123456)).toBe(0.123)
    expect(roundIntensity(null)).toBeNull()
    expect(roundIntensity(Number.NaN)).toBeNull()
  })
})

describe('the role weight', () => {
  it('is the largest over the slot kinds', () => {
    expect(radioIntensityRoleWeight(['drums'])).toBe(1)
    expect(radioIntensityRoleWeight(['bass'])).toBe(1)
    expect(radioIntensityRoleWeight(['bassHeavy'])).toBe(0.8)
    expect(radioIntensityRoleWeight(['rhythmic'])).toBe(0.8)
    expect(radioIntensityRoleWeight(['lead'])).toBe(0.35)
    expect(radioIntensityRoleWeight(['bright'])).toBe(0.35)
    expect(radioIntensityRoleWeight(['warm'])).toBe(0.25)
    expect(radioIntensityRoleWeight(['warm', 'lead', 'rhythmic'])).toBe(0.8)
  })

  it('scales the term by 0.4 + 0.6 drama', () => {
    expect(radioIntensityRankOf(0.9, ['drums'], 0).weight).toBeCloseTo(0.4, 9)
    expect(radioIntensityRankOf(0.9, ['drums'], 100).weight).toBeCloseTo(1, 9)
    expect(radioIntensityRankOf(0.9, ['warm'], 60).weight).toBeCloseTo(0.25 * 0.76, 9)
    expect(radioIntensityRankOf(1.4, ['drums'], 50).target).toBe(1)
  })
})

const C = (intensity: number | null | undefined, id = String(intensity)): DiscoverCandidate => ({
  stemCID: id,
  jamCID: 'j',
  riffCID: 'r',
  presetName: '',
  creatorUserName: '',
  slotKinds: ['drums'],
  drumSubRole: null,
  riffBpm: 120,
  traitValues: {},
  traitPercentiles: {},
  kindSources: {},
  riffCreationTime: null,
  ...(intensity !== undefined && { intensity })
})

describe('pool ranks', () => {
  it('ranks by score in the pool, ties in the middle of their run, unscored none', () => {
    const pool = [C(0.9, 'a'), C(0.1, 'b'), C(null, 'c'), C(0.5, 'd'), C(0.5, 'e'), C(undefined)]
    const r = intensityPoolRanks(pool)
    expect(r.get(1)).toBe(0)
    expect(r.get(3)).toBeCloseTo(0.5, 9)
    expect(r.get(4)).toBeCloseTo(0.5, 9)
    expect(r.get(0)).toBe(1)
    expect(r.has(2)).toBe(false)
    expect(r.has(5)).toBe(false)
    expect(intensityPoolRanks([C(0.3)]).get(0)).toBe(0.5)
    expect(intensityPoolRanks([]).size).toBe(0)
  })

  it('the term is in [0, weight], neutral for the unscored', () => {
    const pool = [C(0.1, 'a'), C(0.9, 'b'), C(null, 'c')]
    const t = intensityTerms(pool, { target: 1, weight: 0.7 })
    expect(t[0]).toBeCloseTo(0, 9)
    expect(t[1]).toBeCloseTo(0.7, 9)
    expect(t[2]).toBeCloseTo(0.35, 9)
  })
})

describe('the band draw', () => {
  const big = Array.from({ length: 80 }, (_, i) => C(i / 79, `s${i}`))

  it('keeps only ranks near the target when drawn', () => {
    const r = applyIntensityBand(big, {
      target: 0.9,
      kinds: ['drums'],
      drama: 100,
      random: () => 0
    })
    expect(r.banded).toBe(true)
    expect(r.pool.length).toBeGreaterThanOrEqual(10)
    for (const c of r.pool)
      expect(Math.abs((c.intensity as number) - 0.9)).toBeLessThanOrEqual(0.2501)
  })

  it('draws once, at 0.5 w d', () => {
    let n = 0
    const counting = (v: number) => () => {
      n += 1
      return v
    }
    const half = INTENSITY_BAND_CHANCE * 0.35 * 0.6
    expect(
      applyIntensityBand(big, {
        target: 0.5,
        kinds: ['lead'],
        drama: 60,
        random: counting(half - 1e-6)
      }).banded
    ).toBe(true)
    expect(
      applyIntensityBand(big, { target: 0.5, kinds: ['lead'], drama: 60, random: counting(half) })
        .banded
    ).toBe(false)
    expect(n).toBe(2)
    // drama 0: never banded, still one draw
    expect(
      applyIntensityBand(big, { target: 0.5, kinds: ['drums'], drama: 0, random: counting(0) })
        .banded
    ).toBe(false)
    expect(n).toBe(3)
  })

  it('backs off when too few would remain (max(8, pool / 8))', () => {
    const small = Array.from({ length: 12 }, (_, i) => C(i / 11, `t${i}`))
    const r = applyIntensityBand(small, {
      target: 1,
      kinds: ['drums'],
      drama: 100,
      random: () => 0
    })
    expect(r).toMatchObject({ banded: false, backedOff: true })
    expect(r.pool).toHaveLength(12)
    const unscored = Array.from({ length: 40 }, (_, i) => C(null, `u${i}`))
    expect(
      applyIntensityBand(unscored, { target: 1, kinds: ['drums'], drama: 100, random: () => 0 })
        .backedOff
    ).toBe(true)
  })
})

describe('rankCandidates with intensity', () => {
  function pool(r: () => number, n: number): DiscoverCandidate[] {
    return Array.from({ length: n }, (_, i) => ({
      ...C(r() < 0.2 ? null : r(), `c${i}`),
      riffBpm: 90 + r() * 60,
      traitPercentiles: { rhythmic: r() < 0.3 ? null : r() },
      traitValues: { rhythmic: r() }
    }))
  }
  const hash = (x: unknown): string =>
    createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 8)

  it('without `intensity`, identical to the ranking it replaces (10k seeded pools)', () => {
    const r = seededRandom('rank-identity')
    for (let k = 0; k < 10000; k++) {
      const p = pool(r, 1 + Math.floor(r() * 12))
      const opts = { targetBpm: 120, targetTraits: ['rhythmic' as const] }
      const a = rankCandidates(p, opts)
      // the candidates' own `intensity` field changes nothing while the option is absent
      const b = rankCandidates(
        p.map((c) => {
          const plain = { ...c }
          delete plain.intensity
          return plain
        }),
        opts
      )
      expect(a.map((x) => [x.candidate.stemCID, x.score])).toEqual(
        b.map((x) => [x.candidate.stemCID, x.score])
      )
    }
  })

  it('pins the absent ranking (a hash of 2000 seeded rankings)', () => {
    const r = seededRandom('rank-fingerprint')
    const out: unknown[] = []
    for (let k = 0; k < 2000; k++) {
      const p = pool(r, 1 + Math.floor(r() * 10))
      out.push(
        rankCandidates(p, { targetBpm: 120, targetTraits: ['rhythmic'] }).map((x) => [
          x.candidate.stemCID,
          Math.round(x.score * 1e9)
        ])
      )
    }
    expect(hash(out)).toBe(RANK_FINGERPRINT)
  })

  it('leans toward the target, and an unscored pool ranks as before plus a constant', () => {
    const p = [C(0.1, 'low'), C(0.5, 'mid'), C(0.9, 'high')]
    const up = rankCandidates(p, { targetBpm: 120, intensity: { target: 1, weight: 1 } })
    expect(up[0].candidate.stemCID).toBe('high')
    const down = rankCandidates(p, { targetBpm: 120, intensity: { target: 0, weight: 1 } })
    expect(down[0].candidate.stemCID).toBe('low')
    const r = seededRandom('unscored')
    const u = pool(r, 9).map((c) => ({ ...c, intensity: null }))
    const base = rankCandidates(u, { targetBpm: 120 })
    const leaned = rankCandidates(u, { targetBpm: 120, intensity: { target: 0.8, weight: 0.6 } })
    expect(leaned.map((x) => x.candidate.stemCID)).toEqual(base.map((x) => x.candidate.stemCID))
    leaned.forEach((x, i) => expect(x.score - base[i].score).toBeCloseTo(0.3, 9))
  })
})

describe('the bed intensity', () => {
  it('is the role-weighted mean of the scored rows', () => {
    expect(
      radioBedIntensity([
        { kinds: ['drums'], score: 0.8 },
        { kinds: ['warm'], score: 0.2 },
        { kinds: ['lead'], score: null }
      ])
    ).toBeCloseTo((0.8 + 0.25 * 0.2) / 1.25, 9)
    expect(radioBedIntensity([{ kinds: ['drums'], score: null }])).toBeNull()
  })
})

/** Recorded from the unmodified discoverRanking.ts (a9d68ef4) by running this test's trace with
 * the `intensity` term not yet added. */
const RANK_FINGERPRINT = 'b6fdd2ab'

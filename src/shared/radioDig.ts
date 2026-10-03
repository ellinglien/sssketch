// src/shared/radioDig.ts
//
// DIG (docs/superpowers/specs/2026-10-03-radio-anointed-stems-design.md section 3): "more from
// around here" without freezing anything. One dug row at a time; while it is on, a third of radio's
// picks are drawn only from near the dug stem (the same jam, close in time -- the desktop: its riff
// neighbours), and every pick leans toward it in rankCandidates (DIG_WEIGHT * closeness). The dig
// follows its row: the anchor is the stem the row plays now, or its hook's when it has one.
//
// Pure. No dig: no draw, and rankCandidates is exactly as without it.

import type { DiscoverCandidate } from './discoverCandidate'
import type { DiscoverTraitKind } from './discoverSlotKind'

/** Share of picks drawn only from near the anchor, while dig is on. */
export const DIG_NEAR_SHARE = 1 / 3
/** The web's near pool: the same jam, within this many seconds of the anchor's creation time. */
export const DIG_NEAR_SEC = 3 * 3600
/** How fast closeness in time falls off, across jams too (the same week in another jam is near). */
export const DIG_TIME_SCALE_SEC = 6 * 3600
/** The ranking term's weight: under one trait (1) and the favourite boost (1.5). */
export const DIG_WEIGHT = 0.75
/** The parts of closeness. */
export const DIG_CLOSENESS_PARTS = Object.freeze({ jam: 0.5, time: 0.3, traits: 0.2 })
/** The readout's log word when a near-only pick found nothing. */
export const NO_NEAR_FITS = 'no near fits'

const TRAIT_KINDS: readonly DiscoverTraitKind[] = ['bassHeavy', 'rhythmic', 'bright', 'warm']

const finite = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/** The dug stem, as both runtimes know it: the web from its index record, the desktop from its
 * candidate (riffCreationTime, traitPercentiles, riffCID). */
export interface RadioDigAnchor {
  rowId: string
  stemId: string
  jamCID: string
  /** Creation time, Unix seconds; null unknown. */
  t: number | null
  traits: Partial<Record<DiscoverTraitKind, number | null>>
  riffCID?: string
}

/** What rankCandidates' `dig` reads. */
export interface RankDig {
  jamCID: string
  t: number | null
  traits: Partial<Record<DiscoverTraitKind, number | null>>
  /** The desktop's riff-sequence neighbours (getAdjacentDiscoverCandidates): near in time. */
  nearRiffCIDs?: ReadonlySet<string>
}

/** The row's dig toggle: dig this row, move the dig here, or (tapped again) stop. */
export function toggleRadioDig(dugRowId: string | null, rowId: string): string | null {
  return dugRowId === rowId ? null : rowId
}

/** The stem a dug row anchors on: its hook's (in or away) when it has one, else what it plays. */
export function radioDigAnchorStemId(
  playingStemId: string | null,
  hookStemId: string | null
): string | null {
  return hookStemId ?? playingStemId
}

/** What a dug row's anchor is built from: the web's index record (`id`, `jam`, `t`, `traits`) or
 * the desktop's candidate (`stemCID`, `jamCID`, `riffCreationTime`, `traitPercentiles`, `riffCID`). */
export type RadioDigSource =
  | {
      id: string
      jam: string
      t: number | null
      traits?: Partial<Record<DiscoverTraitKind, number | null>>
    }
  | Pick<
      DiscoverCandidate,
      'stemCID' | 'jamCID' | 'riffCID' | 'riffCreationTime' | 'traitPercentiles'
    >

/** The dug row's anchor, from the stem it anchors on (radioDigAnchorStemId's): a time that is not
 * finite is unknown, no traits is {}, and an empty riffCID (the web has none) is left out. */
export function radioDigAnchorOf(rowId: string, source: RadioDigSource): RadioDigAnchor {
  if ('stemCID' in source) {
    return {
      rowId,
      stemId: source.stemCID,
      jamCID: source.jamCID,
      t: finite(source.riffCreationTime) ? source.riffCreationTime : null,
      traits: { ...(source.traitPercentiles ?? {}) },
      ...(source.riffCID !== '' ? { riffCID: source.riffCID } : {})
    }
  }
  return {
    rowId,
    stemId: source.id,
    jamCID: source.jam,
    t: finite(source.t) ? source.t : null,
    traits: { ...(source.traits ?? {}) }
  }
}

export function rankDigOf(
  anchor: RadioDigAnchor | null,
  nearRiffCIDs?: ReadonlySet<string>
): RankDig | undefined {
  if (anchor === null) return undefined
  return {
    jamCID: anchor.jamCID,
    t: anchor.t,
    traits: anchor.traits,
    ...(nearRiffCIDs !== undefined ? { nearRiffCIDs } : {})
  }
}

/** Whether this pick is drawn only from near the anchor: one draw while dig is on, none off. */
export function digNearDraw(on: boolean, random: () => number = Math.random): boolean {
  return on && random() < DIG_NEAR_SHARE
}

/** The web's near pool: the same jam and within DIG_NEAR_SEC; with `t` unknown on either side,
 * the whole jam. `wide`: the whole jam (the widening when the narrow pool has nothing unused). */
export function isNearForDig(
  anchor: Pick<RadioDigAnchor, 'jamCID' | 't'>,
  record: { jam: string; t: number | null },
  wide = false
): boolean {
  if (record.jam !== anchor.jamCID) return false
  if (wide || anchor.t === null || record.t === null) return true
  return Math.abs(record.t - anchor.t) <= DIG_NEAR_SEC
}

/** How near a candidate is to the dug stem, 0..1: 0.5 the same jam, 0.3 closeness in time (1 for
 * a riff neighbour), 0.2 closeness in traits (0.5 when no trait is known on both sides). */
export function radioDigCloseness(
  dig: RankDig,
  c: Pick<DiscoverCandidate, 'jamCID' | 'riffCID' | 'riffCreationTime' | 'traitPercentiles'>
): number {
  const sameJam = c.jamCID === dig.jamCID ? 1 : 0
  let timeNear = 0
  if (dig.nearRiffCIDs !== undefined && c.riffCID !== '' && dig.nearRiffCIDs.has(c.riffCID)) {
    timeNear = 1
  } else if (finite(dig.t) && finite(c.riffCreationTime)) {
    timeNear = Math.exp(-Math.abs(c.riffCreationTime - dig.t) / DIG_TIME_SCALE_SEC)
  }
  let sum = 0
  let n = 0
  for (const k of TRAIT_KINDS) {
    const a = dig.traits[k]
    const b = c.traitPercentiles?.[k]
    if (finite(a) && finite(b)) {
      sum += Math.abs(b - a)
      n++
    }
  }
  // clamped: a percentile outside [0, 1] must not push closeness past its bounds
  const traitNear = n === 0 ? 0.5 : Math.min(1, Math.max(0, 1 - sum / n))
  const p = DIG_CLOSENESS_PARTS
  return p.jam * sameJam + p.time * timeNear + p.traits * traitNear
}

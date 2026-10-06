// src/shared/artistShare.ts
//
// Combine artists' even share (docs/superpowers/specs/2026-10-06-combine-artists-design.md §3):
// with several artists chosen, each gets roughly equal turns -- NOT one pooled list, where an
// artist with 30,000 stems would drown one with 300 (Elling, 2026-10-05).
//
// A TURN is a fresh pick landing on a row (DiscoverPanel's commitSlotPick, hook returns excluded),
// counted for the member it was picked under (memberOfPick). Each pick asks the member furthest
// behind first; picks still in flight count as theirs already, so a roll-all spreads at once. A
// member with nothing for a row passes the turn on (artistPickAttempts' order) and stays owed --
// at most ARTIST_SHARE_MAX_OWED turns, so a member who could not use its turns for a while never
// takes a burst of them when rows it fits come back.
//
// Pure. `random` is injected: the app passes Math.random, the tests a seededRandom. A one-member
// selection never draws from it, so today's single-artist picks consume exactly the random numbers
// they did before (artistShare.test.ts pins it).
import {
  memberKey,
  rollFilterForMember,
  type ArtistMember,
  type ArtistSelection
} from './artistSelection'
import type { ArtistRollFilter } from './discoverArtist'

export interface ArtistShareLedger {
  /** Turns landed per member (memberKey), current members only. */
  readonly landed: Readonly<Record<string, number>>
  /** Picks asked of a member and not back yet (memberKey). */
  readonly inFlight: Readonly<Record<string, number>>
}

export const EMPTY_ARTIST_SHARE: ArtistShareLedger = Object.freeze({
  landed: Object.freeze({}),
  inFlight: Object.freeze({})
})

/** How many turns a member can be owed. */
export const ARTIST_SHARE_MAX_OWED = 2

/** How long "this member has nothing for these kinds" is believed (noteArtistEmpty): long enough
 * that a radio of bass rows does not ask an artist without bass every pick, short enough that the
 * overnight scan's new classifications show up within a few minutes. */
export const ARTIST_EMPTY_TTL_MS = 5 * 60_000

function get(record: Readonly<Record<string, number>>, key: string): number {
  return record[key] ?? 0
}

/** Who to ask, in order: least landed-plus-in-flight first; ties in a random order (drawn only
 * where there is a tie, so never for one member). Members in `skip` (memberKey; known to have
 * nothing for this row, artistKnownEmpty) are left out, unless that would leave nobody, in which
 * case they are all asked anyway (the memo can be wrong, and a row must never go unpicked because
 * of it). */
export function artistShareOrder(
  selection: ArtistSelection,
  ledger: ArtistShareLedger,
  random: () => number,
  skip: ReadonlySet<string> = new Set()
): ArtistMember[] {
  const asked = selection.filter((m) => !skip.has(memberKey(m)))
  const members = asked.length > 0 ? asked : [...selection]
  if (members.length === 1) return members
  const load = (m: ArtistMember): number =>
    get(ledger.landed, memberKey(m)) + get(ledger.inFlight, memberKey(m))
  const byLoad = new Map<number, ArtistMember[]>()
  for (const m of members) {
    const l = load(m)
    const group = byLoad.get(l)
    if (group) group.push(m)
    else byLoad.set(l, [m])
  }
  const out: ArtistMember[] = []
  for (const l of [...byLoad.keys()].sort((a, b) => a - b)) {
    const group = byLoad.get(l) as ArtistMember[]
    // Fisher-Yates, drawing only for a real tie.
    for (let i = group.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1))
      ;[group[i], group[j]] = [group[j], group[i]]
    }
    out.push(...group)
  }
  return out
}

export interface ArtistPickAttempt {
  member: ArtistMember
  filter: ArtistRollFilter
}

/** One pick's plan: the members to try, in order, each with the filter its turn sends main. A
 * one-member selection is exactly one attempt with today's filter (rollFilterForArtist), and
 * draws nothing from `random`. */
export function artistPickAttempts(
  selection: ArtistSelection,
  ledger: ArtistShareLedger,
  random: () => number,
  ownUsername: string,
  onlyOwnStems: boolean,
  skip?: ReadonlySet<string>
): ArtistPickAttempt[] {
  return artistShareOrder(selection, ledger, random, skip).map((member) => ({
    member,
    filter: rollFilterForMember(member, selection, ownUsername, onlyOwnStems)
  }))
}

function bump(
  record: Readonly<Record<string, number>>,
  key: string,
  by: number
): Record<string, number> {
  return { ...record, [key]: Math.max(0, get(record, key) + by) }
}

/** A pick asked of `member` (before the pick's first await). */
export function beginArtistTurn(
  ledger: ArtistShareLedger,
  member: ArtistMember
): ArtistShareLedger {
  return { ...ledger, inFlight: bump(ledger.inFlight, memberKey(member), 1) }
}

/** That pick is back, whatever came of it (pickForSlot's finally). Never below zero. */
export function endArtistTurn(ledger: ArtistShareLedger, member: ArtistMember): ArtistShareLedger {
  return { ...ledger, inFlight: bump(ledger.inFlight, memberKey(member), -1) }
}

/** A pick by `member` landed on a row. Every member is then raised to within MAX_OWED of the
 * leader: the debt cap. Members with no entry yet (reconcileArtistShare gives every member one)
 * are left as they are. */
export function landArtistTurn(ledger: ArtistShareLedger, member: ArtistMember): ArtistShareLedger {
  const landed = bump(ledger.landed, memberKey(member), 1)
  const floor = Math.max(...Object.values(landed)) - ARTIST_SHARE_MAX_OWED
  for (const key of Object.keys(landed)) landed[key] = Math.max(landed[key], floor)
  return { ...ledger, landed }
}

/** The ledger for a new selection. Members kept keep their counts; a member joining starts level
 * with the least-served one kept (it does not get a burst of catch-up turns); members gone are
 * dropped. A selection sharing nobody with the last starts from zero. */
export function reconcileArtistShare(
  ledger: ArtistShareLedger,
  selection: ArtistSelection
): ArtistShareLedger {
  const keys = selection.map(memberKey)
  const kept = keys.filter((k) => k in ledger.landed)
  const start = kept.length > 0 ? Math.min(...kept.map((k) => ledger.landed[k])) : 0
  const landed: Record<string, number> = {}
  const inFlight: Record<string, number> = {}
  for (const k of keys) {
    landed[k] = k in ledger.landed ? ledger.landed[k] : start
    if (get(ledger.inFlight, k) > 0) inFlight[k] = ledger.inFlight[k]
  }
  return { landed, inFlight }
}

/** "This member had nothing for these kinds" (memberKey|kindsKey -> expiry, ms). */
export type ArtistEmptyMemo = ReadonlyMap<string, number>

export const EMPTY_ARTIST_MEMO: ArtistEmptyMemo = new Map()

function memoKey(member: ArtistMember, kindsKey: string): string {
  return `${memberKey(member)}|${kindsKey}`
}

/** Remember that `member`'s pool for `kindsKey` was EMPTY (no candidate at all, both sources --
 * not merely all already on other rows, which changes from pick to pick). */
export function noteArtistEmpty(
  memo: ArtistEmptyMemo,
  member: ArtistMember,
  kindsKey: string,
  now: number
): ArtistEmptyMemo {
  const next = new Map(memo)
  next.set(memoKey(member, kindsKey), now + ARTIST_EMPTY_TTL_MS)
  return next
}

/** The members (memberKey) believed empty for `kindsKey` now: artistShareOrder's `skip`. */
export function artistKnownEmpty(
  memo: ArtistEmptyMemo,
  selection: ArtistSelection,
  kindsKey: string,
  now: number
): Set<string> {
  const out = new Set<string>()
  for (const m of selection) {
    const until = memo.get(memoKey(m, kindsKey))
    if (until !== undefined && until > now) out.add(memberKey(m))
  }
  return out
}

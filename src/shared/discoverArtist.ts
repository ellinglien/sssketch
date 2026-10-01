// src/shared/discoverArtist.ts
//
// Discover artist mode (docs/superpowers/specs/2026-10-01-discover-artist-
// mode-design.md): Discover plays another Endlesss user's stems, listen
// only. Every rule the renderer and main both need lives here, so the
// dimmed buttons and the main-process guards read ONE list.

import { DISCOVERED_JAM_CID } from './discoveredRoom'

export type ArtistMode = 'own' | 'other'

/** `artist` null is `me`. With no own username, `me` is still today's
 * unfiltered Discover ('own'); any NAMED artist is then 'other' (spec §2). */
export function artistMode(artist: string | null, ownUsername: string): ArtistMode {
  if (artist === null) return 'own'
  const own = ownUsername.trim()
  return own !== '' && artist.trim() === own ? 'own' : 'other'
}

/** Everything listen-only switches off (spec §2). 'dragOut' and
 * 'duplicateToArrange' have no Discover entry point today; they stay listed
 * so a future one has to consult this list. */
export type ListenOnlyAction =
  | 'keep'
  | 'star'
  | 'addToTimeline'
  | 'addToShelf'
  | 'dragOut'
  | 'duplicateToArrange'
  | 'export'
  | 'fetchHearts'

export const LISTEN_ONLY_ACTIONS: readonly ListenOnlyAction[] = Object.freeze([
  'keep',
  'star',
  'addToTimeline',
  'addToShelf',
  'dragOut',
  'duplicateToArrange',
  'export',
  'fetchHearts'
])

const NONE: ReadonlySet<ListenOnlyAction> = new Set()
const ALL: ReadonlySet<ListenOnlyAction> = new Set(LISTEN_ONLY_ACTIONS)

/** The one list the UI dims and main refuses. */
export function listenOnlyActions(mode: ArtistMode): ReadonlySet<ListenOnlyAction> {
  return mode === 'other' ? ALL : NONE
}

export function artistNotice(user: string): string {
  return `listening to ${user}'s stems. to use them in your own work, ask them first.`
}

export function listenOnlyTooltip(user: string): string {
  return `listening only: these are ${user}'s stems`
}

/** The header field. `me` reads as the own username when there is one. */
export function artistFieldLabel(artist: string | null, ownUsername: string): string {
  if (artist !== null) return `artist: ${artist}`
  const own = ownUsername.trim()
  return `artist: ${own !== '' ? own : 'me'}`
}

/** A pick from the search box, as stored: blank or the own name is `me`. */
export function normalizeArtistPick(picked: string | null, ownUsername: string): string | null {
  const name = (picked ?? '').trim()
  if (name === '') return null
  const own = ownUsername.trim()
  return own !== '' && name === own ? null : name
}

export interface ArtistRollFilter {
  onlyOwnStems: boolean
  targetUser: string
  /** Set only in artist mode -- main then pre-filters every pool to this
   * artist's stems BEFORE its bounded sample (discoverArtistStems.ts). */
  artist: string | undefined
}

/** What a roll sends to main. Own mode passes today's values through
 * untouched, so `me` stays exactly today's path. */
export function rollFilterForArtist(
  artist: string | null,
  ownUsername: string,
  onlyOwnStems: boolean
): ArtistRollFilter {
  const name = (artist ?? '').trim()
  // A blank artist is `me` too, so it can never send an empty creator filter.
  if (name === '' || artistMode(name, ownUsername) === 'own') {
    return { onlyOwnStems, targetUser: ownUsername, artist: undefined }
  }
  return { onlyOwnStems: true, targetUser: name, artist: name }
}

/** The nearby-jam filter: no artist allows everything. */
export function creatorAllowed(
  creator: string | null | undefined,
  artist: string | undefined
): boolean {
  return artist === undefined || creator === artist
}

/** Rows a mid-radio artist change turns over: every row holding a stem
 * not by the new target (the artist, or the own username for `me` -- or
 * every row when there is no own username). Names match case-sensitively,
 * as Endlesss usernames are stored. */
export function artistTurnoverIds(
  slots: readonly { id: string; creator: string | null }[],
  artist: string | null,
  ownUsername: string
): Set<string> {
  const picked = (artist ?? '').trim()
  // A blank artist is `me`, the same as null.
  const target = picked !== '' ? picked : ownUsername.trim()
  return new Set(
    slots
      .filter((s) => s.creator !== null && (target === '' || s.creator !== target))
      .map((s) => s.id)
  )
}

/** The next row to turn over: the first ELIGIBLE row still pending, in
 * eligible order. Null when none is (all done, or the rest are locked or
 * muted -- radio never changes those). */
export function nextTurnoverSlotId(
  eligible: readonly string[],
  pending: ReadonlySet<string>
): string | null {
  return eligible.find((id) => pending.has(id)) ?? null
}

export interface ArtistCount {
  user: string
  stems: number
}
export interface JammedWith {
  user: string
  sharedJams: number
}
/** What the picker gets from main. `jammedWith` is null until main's
 * background pairs walk finishes (~15 s on the USB archive, once per
 * archive change); `jammedWithPending` says whether one is running. */
export interface ArtistIndex {
  counts: ArtistCount[]
  jammedWith: JammedWith[] | null
  jammedWithPending: boolean
}

export function mergeArtistCounts(lists: readonly (readonly ArtistCount[])[]): ArtistCount[] {
  const total = new Map<string, number>()
  for (const list of lists) {
    for (const { user, stems } of list) total.set(user, (total.get(user) ?? 0) + stems)
  }
  return [...total].map(([user, stems]) => ({ user, stems }))
}

/** Not jams: the Shared Feed's synthetic jams and kept groups. */
function isRealJam(jamCID: string): boolean {
  return !jamCID.startsWith('shared:') && jamCID !== DISCOVERED_JAM_CID
}

/** "People you've jammed with" (spec §1): users with stems in jams where
 * the own user also has stems, by number of shared jams, then name. */
export function jammedWithFromPairs(
  pairs: Iterable<readonly [jamCID: string, user: string]>,
  ownUsername: string
): JammedWith[] {
  const own = ownUsername.trim()
  if (own === '') return []
  const usersByJam = new Map<string, Set<string>>()
  for (const [jam, user] of pairs) {
    if (!isRealJam(jam)) continue
    let users = usersByJam.get(jam)
    if (!users) {
      users = new Set()
      usersByJam.set(jam, users)
    }
    users.add(user)
  }
  const shared = new Map<string, number>()
  for (const users of usersByJam.values()) {
    if (!users.has(own)) continue
    for (const user of users) if (user !== own) shared.set(user, (shared.get(user) ?? 0) + 1)
  }
  return [...shared]
    .map(([user, sharedJams]) => ({ user, sharedJams }))
    .sort((a, b) => b.sharedJams - a.sharedJams || a.user.localeCompare(b.user))
}

export type ArtistSuggestion =
  { kind: 'me' } | { kind: 'user'; user: string; stems: number; sharedJams: number | null }

const SUGGESTION_LIMIT = 12

interface IndexLookups {
  stemsOf: Map<string, number>
  sharedOf: Map<string, number>
  /** Every user, most stems first, then name. */
  byStems: string[]
}
/** Built once per index object: the picker calls suggestArtists on every
 * keystroke with the same index, and counts can hold ~6,000 users. */
const lookups = new WeakMap<ArtistIndex, IndexLookups>()

function lookupsFor(index: ArtistIndex): IndexLookups {
  let hit = lookups.get(index)
  if (!hit) {
    hit = {
      stemsOf: new Map(index.counts.map((c) => [c.user, c.stems])),
      sharedOf: new Map((index.jammedWith ?? []).map((j) => [j.user, j.sharedJams])),
      byStems: [...index.counts]
        .sort((a, b) => b.stems - a.stems || a.user.localeCompare(b.user))
        .map((c) => c.user)
    }
    lookups.set(index, hit)
  }
  return hit
}

export function suggestArtists(
  index: ArtistIndex,
  query: string,
  ownUsername: string,
  limit = SUGGESTION_LIMIT
): ArtistSuggestion[] {
  const q = query.trim().toLowerCase()
  const own = ownUsername.trim()
  const { stemsOf, sharedOf, byStems } = lookupsFor(index)
  const toSuggestion = (user: string): ArtistSuggestion => ({
    kind: 'user',
    user,
    stems: stemsOf.get(user) ?? 0,
    sharedJams: sharedOf.get(user) ?? null
  })
  const me: ArtistSuggestion = { kind: 'me' }
  if (q === '') {
    // An EMPTY jammed-with list (no own username, or nobody shared a jam)
    // falls back to stem count too, so the picker is never just `me`.
    const ordered = index.jammedWith?.length ? index.jammedWith.map((j) => j.user) : byStems
    return [
      me,
      ...ordered
        .filter((u) => u !== own)
        .slice(0, limit)
        .map(toSuggestion)
    ]
  }
  const matches = index.counts.filter((c) => c.user !== own && c.user.toLowerCase().includes(q))
  const rank = (user: string): number => (user.toLowerCase().startsWith(q) ? 0 : 1)
  matches.sort(
    (a, b) => rank(a.user) - rank(b.user) || b.stems - a.stems || a.user.localeCompare(b.user)
  )
  const users = matches.slice(0, limit).map((c) => toSuggestion(c.user))
  // `me` leads only on a PREFIX (of "me" or of the own name), so Enter on a
  // query that merely occurs inside the own name picks the user it typed.
  const mePrefix = 'me'.startsWith(q) || (own !== '' && own.toLowerCase().startsWith(q))
  const meSubstring = own !== '' && own.toLowerCase().includes(q)
  if (mePrefix) return [me, ...users]
  return meSubstring ? [...users, me] : users
}

export function suggestionLabel(s: ArtistSuggestion, ownUsername: string): string {
  if (s.kind === 'me') {
    const own = ownUsername.trim()
    return own !== '' ? `me · ${own}` : 'me'
  }
  return `${s.user} · ${s.stems.toLocaleString('en-US')}`
}

export function analysedLabel(analysed: number, total: number): string {
  if (total <= 0 || analysed <= 0) return 'analysed: 0%'
  const pct = (analysed / total) * 100
  return pct < 1 ? 'analysed: <1%' : `analysed: ${Math.floor(pct)}%`
}

/** save-discovered-rifff's answer when listen-only refused the keep. A
 * distinct value, because null already means "nothing was kept" (no
 * resolvable loop) and a kept riff is `{ riffCID, name, duplicate }`; both
 * keep exactly that meaning. */
export interface KeepRefused {
  refused: 'listening only'
}

export const KEEP_REFUSED: KeepRefused = Object.freeze({ refused: 'listening only' })

export function isKeepRefused(value: unknown): value is KeepRefused {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { refused?: unknown }).refused === 'listening only'
  )
}

/** A roll's result as the renderer keeps it: tagged with the artist it was
 * rolled under (DiscoverCandidate.pickedUnderArtist). A `me` roll
 * (artist undefined) is returned untouched -- the same object. */
export function tagPickedUnderArtist<T extends object>(
  candidate: T,
  artist: string | undefined
): T | (T & { pickedUnderArtist: string }) {
  return artist === undefined ? candidate : { ...candidate, pickedUnderArtist: artist }
}

/** Whether a pick belongs to the CURRENT selection (null = me): rolled under
 * that artist, or -- for `me` -- rolled with no artist at all. Tags, not
 * creators: a `me` pick is often a collaborator's stem from Elling's own
 * jams, whose creator is not him. Used to decide that a row has turned
 * over after a switch; a pick still in flight from before it does not
 * count. */
export function pickMatchesSelection(
  candidate: { pickedUnderArtist?: string } | null | undefined,
  artist: string | null
): boolean {
  if (!candidate) return false
  return artist === null
    ? candidate.pickedUnderArtist === undefined
    : candidate.pickedUnderArtist === artist
}

/** The artists whose stems are still on Discover's rows (picked under artist
 * mode), once each, in name order. In `me` mode any of these blocks keep
 * (Elling, 2026-10-01): the loop still holds someone else's work. */
export function lingeringArtists(
  slots: readonly { candidate: { pickedUnderArtist?: string } | null }[]
): string[] {
  const artists = new Set<string>()
  for (const s of slots) {
    const tag = s.candidate?.pickedUnderArtist
    if (tag !== undefined && tag !== '') artists.add(tag)
  }
  return [...artists].sort((a, b) => a.localeCompare(b))
}

export function lingeringNotice(artists: readonly string[]): string {
  return `listening only: ${artists.map((a) => `${a}'s`).join(' and ')} stems still playing`
}

// src/shared/discoverArtist.ts
//
// Discover artist mode (docs/superpowers/specs/2026-10-01-discover-artist-
// mode-design.md): Discover plays another Endlesss user's stems, listen
// only. Every rule the renderer and main both need lives here, so the
// dimmed buttons and the main-process guards read ONE list.

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
  if (artistMode(artist, ownUsername) === 'own') {
    return { onlyOwnStems, targetUser: ownUsername, artist: undefined }
  }
  const name = (artist as string).trim()
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
 * every row when there is no own username). */
export function artistTurnoverIds(
  slots: readonly { id: string; creator: string | null }[],
  artist: string | null,
  ownUsername: string
): Set<string> {
  const target = artist ?? ownUsername.trim()
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

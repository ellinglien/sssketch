// src/main/discoverArtistSession.ts
//
// Main's mirror of Discover's chosen artist (spec §3 "Enforcement"). The
// renderer pushes every change (discover-set-artist); a renderer load
// resets it to `me` (index.ts createWindow), so a reload can never leave
// main refusing keep while the UI shows `me`. No electron, no sqlite --
// unit-tested in CI.
import {
  artistMode,
  listenOnlyActions,
  type ArtistMode,
  type ListenOnlyAction
} from '@shared/discoverArtist'

export interface DiscoverArtistSession {
  artist: string | null
  ownUsername: string
}

/** What the renderer pushes: the session, plus (optionally) the artists
 * whose stems still play on Discover's rows (lingeringArtists). */
export interface DiscoverArtistSessionUpdate extends DiscoverArtistSession {
  lingering?: readonly string[]
}

const ME: DiscoverArtistSession = Object.freeze({ artist: null, ownUsername: '' })
let session: DiscoverArtistSession = ME
/** Kept apart from `session` so its shape stays the two fields. */
let lingering: readonly string[] = []

/** Only non-empty strings; anything else is not a list of artists. */
function artistList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
}

export function setDiscoverArtistSession(next: DiscoverArtistSessionUpdate): ArtistMode {
  const artist = next.artist === null ? null : next.artist.trim() || null
  session = { artist, ownUsername: next.ownUsername.trim() }
  lingering = artistList(next.lingering)
  return currentArtistMode()
}

export function getDiscoverArtistSession(): DiscoverArtistSession {
  return session
}

export function currentArtistMode(): ArtistMode {
  return artistMode(session.artist, session.ownUsername)
}

/** True when `action` must be refused now. While the mode is `other`, the
 * action is refused outright, whatever the stem's creator: spec §2 keeps
 * even already-owned stems listen-only in artist mode, which is a superset
 * of §3's per-creator rule. */
export function refusesListenOnly(action: ListenOnlyAction): boolean {
  const refused = listenOnlyActions(currentArtistMode()).has(action)
  if (refused) {
    console.warn(`discover: refused ${action} -- listening only to ${session.artist}'s stems`)
  }
  return refused
}

/** The keep guard (Elling, 2026-10-01). Refused in artist mode, and in `me`
 * while any row still plays a stem picked under artist mode -- named by the
 * keep call itself (`lingeringFromCall`, the renderer's rows at the moment
 * of the keep, so no push can lag it) or by the session's last push. */
export function refusesKeep(lingeringFromCall?: unknown): boolean {
  if (refusesListenOnly('keep')) return true
  const still = [...artistList(lingeringFromCall), ...lingering]
  if (still.length === 0) return false
  console.warn(`discover: refused keep -- ${still.join(', ')}'s stems still playing`)
  return true
}

/** The star guard: refused in artist mode, and in `me` while the session's
 * mirror names lingering artists (Elling, 2026-10-01). The toggle IPC
 * carries one stem id and no rows, so the session is what it reads. */
export function refusesStar(): boolean {
  if (refusesListenOnly('star')) return true
  if (lingering.length === 0) return false
  console.warn(`discover: refused star -- ${lingering.join(', ')}'s stems still playing`)
  return true
}

/** Whether the phone's keep is off: the same rule, from the session alone
 * (the phone's request carries no rows). No warning -- polled. */
export function keepBlockedForPhone(): boolean {
  return currentArtistMode() === 'other' || lingering.length > 0
}

export function resetDiscoverArtistSession(): void {
  lingering = []
  session = ME
}

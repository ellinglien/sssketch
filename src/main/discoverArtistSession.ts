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

const ME: DiscoverArtistSession = Object.freeze({ artist: null, ownUsername: '' })
let session: DiscoverArtistSession = ME

export function setDiscoverArtistSession(next: DiscoverArtistSession): ArtistMode {
  const artist = next.artist === null ? null : next.artist.trim() || null
  session = { artist, ownUsername: next.ownUsername.trim() }
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

export function resetDiscoverArtistSession(): void {
  session = ME
}

// src/renderer/src/audio/riffLibraryUsername.ts
//
// "Who am I": the typed "your username" setting, and the resolvers built on
// @shared/ownUsernameReport's resolveOwnUsername -- the one rule for "me"
// (a typed username wins, even an empty one: then nobody is "me"; else the
// Endlesss session's; else nobody). LibraryBrowser (its username box, "only
// my jams", Discover's `mine`), the background passes' priority
// (stemPriority.ts in main) and main's saved name (OwnUsernameReporter) all
// go through it. There is no default identity.
//
// LibraryBrowser announces a possible change (a username edit, a login or
// logout) with RIFF_LIBRARY_USERNAME_CHANGED_EVENT on `window`; listeners
// resolve again and compare.

import {
  ownUsernameReportFrom,
  resolveOwnUsername,
  type EndlesssAuthAnswer,
  type OwnUsernameReport
} from '@shared/ownUsernameReport'

/** LibraryBrowser's persisted username (localStorage). */
export const RIFF_LIBRARY_USERNAME_STORAGE_KEY = 'sssketch:riffLibraryUsername'
/** The pre-rename key LibraryBrowser carries forward once. */
const LEGACY_LORE_USERNAME_STORAGE_KEY = 'sssketch:loreUsername'

export const RIFF_LIBRARY_USERNAME_CHANGED_EVENT = 'riff-library-username-changed'

export function announceRiffLibraryUsernameChanged(): void {
  window.dispatchEvent(new Event(RIFF_LIBRARY_USERNAME_CHANGED_EVENT))
}

/** The user just logged out of Endlesss: the same change, plus the one fact a
 * later lookup can't tell apart from a failed one -- no session now means
 * nobody (OwnUsernameReporter). Call it once the logout has resolved. */
export function announceEndlesssLoggedOut(): void {
  window.dispatchEvent(
    new CustomEvent(RIFF_LIBRARY_USERNAME_CHANGED_EVENT, { detail: { loggedOut: true } })
  )
}

/** Whether a RIFF_LIBRARY_USERNAME_CHANGED_EVENT came from a logout. */
export function isLoggedOutEvent(event: Event): boolean {
  const detail = (event as CustomEvent<{ loggedOut?: boolean } | null>).detail
  return detail?.loggedOut === true
}

/** The typed username: a string (maybe empty) when one was ever set, else
 * null. */
function storedUsername(): string | null {
  try {
    return (
      localStorage.getItem(RIFF_LIBRARY_USERNAME_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_LORE_USERNAME_STORAGE_KEY)
    )
  } catch {
    return null
  }
}

/** LibraryBrowser's read of the typed username (null when never set), which
 * also carries the pre-rename key forward once, so nobody's setting resets
 * just because the storage key was renamed. */
export function loadTypedRiffLibraryUsername(): string | null {
  try {
    const current = localStorage.getItem(RIFF_LIBRARY_USERNAME_STORAGE_KEY)
    if (current !== null) return current
    const legacy = localStorage.getItem(LEGACY_LORE_USERNAME_STORAGE_KEY)
    if (legacy === null) return null
    // Best-effort: a failed write still returns the legacy value in hand.
    try {
      localStorage.setItem(RIFF_LIBRARY_USERNAME_STORAGE_KEY, legacy)
      localStorage.removeItem(LEGACY_LORE_USERNAME_STORAGE_KEY)
    } catch (err) {
      console.error('loadTypedRiffLibraryUsername: failed to persist the carry-forward:', err)
    }
    return legacy
  } catch {
    return null
  }
}

/** Persists an edit of the "your username" box (written on the edit itself,
 * never from an effect, so nothing writes a name nobody typed). */
export function storeTypedRiffLibraryUsername(username: string): void {
  try {
    localStorage.setItem(RIFF_LIBRARY_USERNAME_STORAGE_KEY, username)
  } catch (err) {
    console.error('storeTypedRiffLibraryUsername: failed to persist the username:', err)
  }
}

/** What to tell main about "me" (report-own-username): unlike
 * resolveRiffLibraryUsername, a failed session lookup is 'unknown', never
 * "nobody" -- it must not wipe the name main saved (ownUsernameReport.ts). */
export async function resolveOwnUsernameReport(afterLogout = false): Promise<OwnUsernameReport> {
  const typed = storedUsername()
  let auth: EndlesssAuthAnswer = 'failed'
  if (typed === null) {
    try {
      auth = await window.rifffApi.endlesssAuthStatus()
    } catch (err) {
      console.error('resolveOwnUsernameReport: endlesssAuthStatus() failed:', err)
    }
  }
  return ownUsernameReportFrom(typed, auth, afterLogout)
}

/** The configured username, or null when there is none. */
export async function resolveRiffLibraryUsername(): Promise<string | null> {
  const typed = storedUsername()
  let session: string | null = null
  if (typed === null) {
    try {
      const auth = await window.rifffApi.endlesssAuthStatus()
      if (auth.loggedIn) session = auth.username
    } catch (err) {
      console.error('resolveRiffLibraryUsername: endlesssAuthStatus() failed:', err)
    }
  }
  const me = resolveOwnUsername(typed, session)
  return me === '' ? null : me
}

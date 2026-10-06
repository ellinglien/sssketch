// src/renderer/src/audio/riffLibraryUsername.ts
//
// "Who am I" for the background passes' priority (own stems first,
// stemPriority.ts in main), resolved by the same rule LibraryBrowser's
// riffLibraryUsername uses: a username typed on this machine wins (even an
// empty one: then nobody is "me"); else the Endlesss session's; else none.
// RIFF_LIBRARY_USERNAME, the compile-time fallback LibraryBrowser shows when
// neither exists, does not count -- with no username configured the passes
// keep their own order.
//
// LibraryBrowser announces a possible change (a username edit, a login or
// logout) with RIFF_LIBRARY_USERNAME_CHANGED_EVENT on `window`; listeners
// resolve again and compare.

/** LibraryBrowser's persisted username (localStorage). */
export const RIFF_LIBRARY_USERNAME_STORAGE_KEY = 'sssketch:riffLibraryUsername'
/** The pre-rename key LibraryBrowser carries forward once. */
const LEGACY_LORE_USERNAME_STORAGE_KEY = 'sssketch:loreUsername'

export const RIFF_LIBRARY_USERNAME_CHANGED_EVENT = 'riff-library-username-changed'

export function announceRiffLibraryUsernameChanged(): void {
  window.dispatchEvent(new Event(RIFF_LIBRARY_USERNAME_CHANGED_EVENT))
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

/** The configured username, or null when there is none. */
export async function resolveRiffLibraryUsername(): Promise<string | null> {
  const stored = storedUsername()
  if (stored !== null) return stored.trim() === '' ? null : stored.trim()
  try {
    const auth = await window.rifffApi.endlesssAuthStatus()
    if (auth.loggedIn && auth.username.trim() !== '') return auth.username.trim()
  } catch (err) {
    console.error('resolveRiffLibraryUsername: endlesssAuthStatus() failed:', err)
  }
  return null
}

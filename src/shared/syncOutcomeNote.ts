import type { SyncOutcome } from './riffLibraryTypes'

/** What the Library Browser says beside a jam's sync button once a sync has
 * ended short for a reason the user can act on (riffLibrarySync.ts), or null
 * when it has nothing to say. `now` is epoch ms, for the wait after a 429. */
export function syncOutcomeNote(outcome: SyncOutcome, now: number): string | null {
  if (outcome.stopped === 'logged-out') return 'log in to sync'
  if (outcome.stopped !== 'rate-limited') return null
  const minutes = Math.max(1, Math.ceil(((outcome.retryAt ?? now) - now) / 60_000))
  return `endlesss asked to slow down — try again in ${minutes} min`
}

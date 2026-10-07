import type { SyncOutcome } from './riffLibraryTypes'

/** What the Library Browser says beside a jam's sync button once a sync has
 * ended short for a reason the user can act on (riffLibrarySync.ts), or null
 * when it has nothing to say. `now` is epoch ms: after a 429 the wait counts
 * down to `retryAt`, and the note goes once it has passed (review of
 * a00e7aab -- it was worked out once, when the sync ended, and stayed). */
export function syncOutcomeNote(outcome: SyncOutcome, now: number): string | null {
  if (outcome.stopped === 'logged-out') return 'log in to sync'
  if (outcome.stopped !== 'rate-limited') return null
  const left = (outcome.retryAt ?? now + 1) - now
  if (left <= 0) return null
  const minutes = Math.max(1, Math.ceil(left / 60_000))
  return `endlesss asked to slow down — try again in ${minutes} min`
}

/** How long from `now` until syncOutcomeNote's text for `outcome` next
 * changes (its minutes tick over, or it goes), so the browser re-renders
 * then; null when it never will. */
export function syncOutcomeNoteRefreshMs(outcome: SyncOutcome, now: number): number | null {
  if (outcome.stopped !== 'rate-limited' || outcome.retryAt === undefined) return null
  const left = outcome.retryAt - now
  if (left <= 0) return null
  return ((left - 1) % 60_000) + 1
}

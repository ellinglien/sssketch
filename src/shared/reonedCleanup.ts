// Part 3 of the re-oned copies spec, the pure half: when the launch notice offers a cleanup, how
// long "not now" lasts, how old an unused copy must be, how sizes read, and every word the
// cleanup shows. The cleanup covers EEEDIT's renders (`.shapes`) too, so its words name both. See docs/superpowers/specs/2026-10-09-reoned-copies-cleanup-design.md. All UI
// copy lives here, lowercase (AGENTS.md section 2).

const DAY_MS = 24 * 60 * 60 * 1000

/** The launch notice shows from this many unused bytes (decimal, as Finder counts). */
export const CLEANUP_OFFER_BYTES = 200_000_000
/** "not now" keeps the launch notice quiet this long. */
export const CLEANUP_NOT_NOW_MS = 7 * DAY_MS
/** An unused copy younger than this is never cleaned: an audition or bake may be about to use
 * it. */
export const CLEANUP_GRACE_MS = DAY_MS

export function shouldOfferCleanup(input: {
  unusedBytes: number
  now: number
  notNowUntil: number | null
}): boolean {
  if (input.notNowUntil !== null && input.now < input.notNowUntil) return false
  return input.unusedBytes >= CLEANUP_OFFER_BYTES
}

/** `340 MB`, `1.2 GB` (one decimal from 1 GB), or `less than 1 MB`. */
export function formatCopySize(bytes: number): string {
  if (bytes < 1e6) return 'less than 1 MB'
  const mb = Math.round(bytes / 1e6)
  if (mb < 1000) return `${mb} MB`
  return `${(bytes / 1e9).toFixed(1)} GB`
}

export function cleanupOfferText(bytes: number): string {
  const size = bytes >= 1e6 ? `about ${formatCopySize(bytes)}` : formatCopySize(bytes)
  return `${size} of re-oned and EEEDIT stem copies aren't used by any project. your rifffs, stems and projects aren't touched, and any re-oned copy needed later is rebuilt automatically.`
}

export function clearedText(bytes: number): string {
  return `cleared ${formatCopySize(bytes)}`
}

export const CLEAN_UP_BUTTON = 'clean up'
export const NOT_NOW_BUTTON = 'not now'
export const OK_BUTTON = 'ok'
export const MISSING_COPY_TEXT = 're-oned copy missing · rebuilds when its original is back'
export const NOTHING_TO_CLEAN_TEXT =
  'every re-oned and EEEDIT stem copy is in use. nothing to clean up.'
export const CLEANUP_MENU_LABEL = 'clean up unused stem copies…'
export const LIBRARY_MISSING_TITLE = 'project library not found'
export const COULD_NOT_CHECK_TEXT = "couldn't read every project, so nothing was cleaned."
export const LOOKING_TEXT = 'looking…'
export const CLEANING_TEXT = 'cleaning…'

export function missingCopiesTitle(count: number): string {
  return `${count} re-oned ${count === 1 ? 'copy' : 'copies'} missing`
}

/** What a survey found: the launch notice and the gear menu's button read it. */
export type ReonedSurvey =
  | { status: 'library-missing' }
  | { status: 'snoozed' }
  | { status: 'unreadable'; path: string }
  | { status: 'ok'; unusedBytes: number; unusedCount: number; notNowUntil: number | null }

export type ReonedCleanResult =
  | { status: 'library-missing' }
  | { status: 'unreadable'; path: string }
  | { status: 'ok'; freedBytes: number; deletedCount: number; failedCount: number }

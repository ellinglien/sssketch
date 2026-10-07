// src/shared/ownUsernameReport.ts
//
// What the renderer tells main about "me" (report-own-username): the user
// whose own-only index a startup rebuild serves first, and whose stems the
// background passes rank first (faster startup plan,
// docs/superpowers/plans/2026-10-06-faster-startup.md). Main keeps the last
// name across launches (ownUsernameStore.ts).
//
// Three answers, not two (review of the faster-startup commits, 2026-10-06):
// a session lookup that failed used to read as "nobody", and wiped the saved
// name for this launch and the next. Only a deliberate act clears it: a typed
// empty username, or a logout.

/** THE rule for who "me" is, everywhere (the import browser's username box
 * and its "only my jams", Discover's `mine` and artist `me`, the background
 * passes' own-first priority, main's ownUsername.json and the startup own
 * index -- the last three through the report below, which follows it):
 * a typed username wins (a typed empty one deliberately means nobody); else
 * the Endlesss login's username; else nobody (''). There is no default
 * identity: until 2026-10-07 the renderer fell back to 'elling', so a
 * stranger with no login browsed and rolled as Elling (share-readiness
 * audit, B1).
 *
 * `typed`: the stored "your username" setting, null when never set.
 * `sessionUsername`: the logged-in account's username, null when logged out. */
export function resolveOwnUsername(typed: string | null, sessionUsername: string | null): string {
  if (typed !== null) return typed.trim()
  return (sessionUsername ?? '').trim()
}

export type OwnUsernameReport =
  | { kind: 'name'; name: string }
  /** Deliberately nobody: a typed empty username, or just logged out. */
  | { kind: 'none' }
  /** Can't tell (the session lookup failed, or no session and nothing typed
   * at launch): keep whatever main has. */
  | { kind: 'unknown' }

/** What endlesssAuthStatus() said, or 'failed' when it threw. */
export type EndlesssAuthAnswer = { loggedIn: boolean; username?: string } | 'failed'

/** The report for `typed` (LibraryBrowser's username: null when never set,
 * '' when set to empty) and the Endlesss session. `afterLogout`: resolved
 * because the user just logged out, so no session means nobody. */
export function ownUsernameReportFrom(
  typed: string | null,
  auth: EndlesssAuthAnswer,
  afterLogout: boolean
): OwnUsernameReport {
  if (typed !== null) {
    const name = resolveOwnUsername(typed, null)
    return name === '' ? { kind: 'none' } : { kind: 'name', name }
  }
  if (auth === 'failed') return { kind: 'unknown' }
  const session = resolveOwnUsername(null, auth.loggedIn ? (auth.username ?? null) : null)
  if (session !== '') return { kind: 'name', name: session }
  return afterLogout && !auth.loggedIn ? { kind: 'none' } : { kind: 'unknown' }
}

/** Main's username after `report`. */
export function ownUsernameAfterReport(
  current: string | null,
  report: OwnUsernameReport
): string | null {
  if (report.kind === 'name') return report.name
  if (report.kind === 'none') return null
  return current
}

/** A report from over IPC; anything that isn't one is 'unknown', so it can
 * never clear the name. */
export function parseOwnUsernameReport(value: unknown): OwnUsernameReport {
  if (typeof value !== 'object' || value === null) return { kind: 'unknown' }
  const { kind, name } = value as { kind?: unknown; name?: unknown }
  if (kind === 'none') return { kind: 'none' }
  if (kind === 'name' && typeof name === 'string' && name.trim() !== '') {
    return { kind: 'name', name: name.trim() }
  }
  return { kind: 'unknown' }
}

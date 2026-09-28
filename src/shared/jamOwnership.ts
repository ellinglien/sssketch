// src/shared/jamOwnership.ts
//
// "Which of these jams have I actually played in?" -- the ordering and
// filtering rules for the import browser's jam sidebar.
//
// The list it orders is a union of two very different sources (see
// LibraryBrowser.tsx's own visibleJams): every jam present in whichever
// riff archive is configured, and the live Endlesss membership list. On
// Elling's real external LORE archive the first of those is 5,056 jams,
// of which he has riffs in 42 -- so "all the jams in existence" is what
// the sidebar looks like, and this module is what narrows it back down.
//
// The whole subtlety lives in ONE fact: a jam's authorship can be
// unknowable. Riffs.UserName is fully populated in a real LORE-synced
// archive (0 blank out of 372,319, measured 2026-09-28), but sssketch's
// OWN sync writes it empty for every privately-synced jam, because the
// jam listing endpoint carries no per-riff userName at all (see the note
// on syncJam in main/riffLibrarySync.ts). A filter that read "0 of his
// riffs" off that would hide his entire own library. So every rule below
// distinguishes "the archive says none of these are yours" from "the
// archive cannot say", and only ever hides on the first.
//
// No import from riffLibraryTypes.ts, deliberately: RiffLibraryJam
// extends JamOwnership below, so the dependency has to run that one way.

/** A jam's authorship counts as `listJams` attaches them, both optional
 * because plenty of RiffLibraryJam values never get them: the live
 * Endlesss membership list (endlesssApi.ts), the synthetic Shared Feed
 * entry, and any listJams call made without a username to count against.
 * Absent is meaningfully different from zero -- see the module comment. */
export interface JamOwnership {
  /** Riffs in this jam authored by the user the count was asked for. */
  ownRiffCount?: number
  /** Riffs in this jam with no author recorded at all (UserName null or
   * empty). Non-zero means this jam's authorship is only partly knowable,
   * so a zero ownRiffCount proves nothing. */
  unknownAuthorRiffCount?: number
}

/** Something we can order by recency, which is every jam list in the app
 * -- kept structural so callers can sort their own richer row types. */
type Sortable = JamOwnership & { lastRiffTime: number }

/** The archive positively attributes at least one riff in this jam to the
 * user. */
export function jamIsMine(jam: JamOwnership): boolean {
  return (jam.ownRiffCount ?? 0) > 0
}

/** Whether a zero ownRiffCount on this jam can be trusted to mean "none of
 * these are yours". True only when counts were taken AND every riff in the
 * jam carried an author; false for an uncounted jam and for one whose sync
 * never recorded who made what. */
export function jamAuthorshipIsKnown(jam: JamOwnership): boolean {
  return jam.unknownAuthorRiffCount === 0 && jam.ownRiffCount !== undefined
}

/** The jams to show when "only my jams" is on: the ones he has riffs in,
 * plus every jam the data cannot rule out. Deliberately errs towards
 * showing -- a filter that hides a jam he IS in is a filter he cannot
 * trust, and one that hides everything (which counting alone would do to
 * sssketch's own authorless warehouse) is worse than no filter at all. */
export function filterToMyJams<T extends JamOwnership>(jams: T[]): T[] {
  return jams.filter((jam) => jamIsMine(jam) || !jamAuthorshipIsKnown(jam))
}

/** How many jams `filterToMyJams` would drop. Zero means the filter has
 * nothing to say about this library, which is exactly when the UI should
 * stop offering it rather than showing a toggle that does nothing. */
export function hiddenJamCount(jams: JamOwnership[]): number {
  return jams.length - filterToMyJams(jams).length
}

/** Most of his own riffs first, then most-recently-active first -- which
 * is the order the list had before counts existed, so an uncounted or
 * all-zero library keeps exactly its old ordering. Returns a new array. */
export function sortJamsByOwnRiffs<T extends Sortable>(jams: T[]): T[] {
  return [...jams].sort(
    (a, b) => (b.ownRiffCount ?? 0) - (a.ownRiffCount ?? 0) || b.lastRiffTime - a.lastRiffTime
  )
}

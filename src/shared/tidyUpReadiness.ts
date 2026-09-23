import type { BusId } from './types'
import { ARRANGE_ROLE_TO_BUS, type ArrangeRole } from './stemRole'

/** One stem sitting on the timeline, in the only two terms this rule needs:
 * the project-local key `busOf` is indexed by, and the file path the global
 * `StemCategories` table is indexed by. */
export interface PlacedStemRef {
  stemKey: string
  path: string
}

export interface TidyUpReadiness {
  /** True when at least one placed stem is unanswered -- see
   * assessTidyUpReadiness's own doc comment for why it is "every" and not
   * "any". */
  needsNudge: boolean
  /** The stems nobody has said anything about, in placement order. */
  unansweredStemKeys: string[]
  /** busOf entries implied by a confirmed role, for stems that have no real
   * bus assignment. Keyed by stemKey, so it drops straight into busOf. */
  derivedBusOf: Record<string, BusId>
}

/**
 * The distinct file paths worth asking the global role table about: the
 * stems with no bus. A stem that already has a bus is already answered, so
 * looking its role up could not change any outcome -- and skipping those is
 * what lets a fully tidied project export with no database round trip at
 * all.
 */
export function unbussedStemPaths(
  placedStems: readonly PlacedStemRef[],
  busOf: Readonly<Record<string, BusId>>
): string[] {
  const seen = new Set<string>()
  for (const stem of placedStems) {
    if (busOf[stem.stemKey] !== undefined) continue
    seen.add(stem.path)
  }
  return [...seen]
}

/**
 * Does the app know what the stems on this timeline are?
 *
 * The tidy-up nudge used to ask `Object.keys(state.busOf).length === 0`,
 * which asks whether Tidy Up in particular has been run. That is not the
 * same question, and since 2026-09-23 it is demonstrably the wrong one:
 * the auto-arrange role step confirms an `ArrangeRole` for every stem
 * through `recordStemRoles`, which is global, canonical, and the very thing
 * Tidy Up itself writes -- but it never touches this project's `busOf`. A
 * user who answered every question the wizard asked was still told he had
 * not tidied up (reported 2026-09-23: "i had prepared for the auto arrange,
 * it should use that information").
 *
 * So a stem is ANSWERED when it has either a bus in this project or a
 * confirmed role in the global table. The rule is **every placed stem**,
 * not any:
 *
 * - "any" is far too weak. One confirmed role out of forty leaves the other
 *   thirty-nine falling through `state.busOf[key] ?? 'aux'` in
 *   buildAlsXml.ts, which is exactly the dozens-of-tracks export the nudge
 *   exists to prevent. A warning that stops firing as soon as you have done
 *   one per cent of the work is a warning that never fires.
 * - "buses only" is today's bug.
 * - "every" is precisely the property that makes the export well packed --
 *   every stem lands on a bus a person chose, by one route or the other.
 *
 * An empty timeline passes vacuously, and should: there is nothing placed,
 * so there is nothing to tidy and nothing to warn about.
 *
 * `derivedBusOf` is the other half of "it should use that information". A
 * role maps onto a bus totally and deterministically through
 * `ARRANGE_ROLE_TO_BUS` -- the same mapping Tidy Up itself uses to turn a
 * click into an `ASSIGN_STEMS_TO_BUS` -- so a confirmed role is not merely
 * evidence that the user answered, it IS the bus. Handing these back lets
 * the export pack tracks from a role-only project instead of piling
 * everything onto aux. A real `busOf` entry always wins: it was chosen for
 * this project, where the role is a fact about the file.
 */
export function assessTidyUpReadiness(
  placedStems: readonly PlacedStemRef[],
  busOf: Readonly<Record<string, BusId>>,
  confirmedRoles: Readonly<Record<string, ArrangeRole>>
): TidyUpReadiness {
  const unansweredStemKeys: string[] = []
  const derivedBusOf: Record<string, BusId> = {}
  for (const stem of placedStems) {
    if (busOf[stem.stemKey] !== undefined) continue
    const role = confirmedRoles[stem.path]
    if (role === undefined) {
      unansweredStemKeys.push(stem.stemKey)
      continue
    }
    derivedBusOf[stem.stemKey] = ARRANGE_ROLE_TO_BUS[role]
  }
  return { needsNudge: unansweredStemKeys.length > 0, unansweredStemKeys, derivedBusOf }
}

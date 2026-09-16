// src/main/resolveStemArrangeRole.ts
import type Database from 'better-sqlite3'
import type { ArrangeRole } from '@shared/stemRole'

// Prepared statements, cached per `db` connection (WeakMap, so a closed/
// GC'd connection's own statements are never kept alive artificially).
// Direct request, 2026-09-16 ("can we take a good look at the things we
// just added... and see if we can improve the speed"): discoverAdjacency.ts's
// own matchRole calls resolveStemArrangeRole once per stem while walking
// outward from a center riff -- up to 8 stems x up to 32 riffs per
// direction in the worst case (a rare role in a large jam). Re-preparing
// the SAME two statements from scratch on every single call (better-
// sqlite3 does not cache repeated .prepare() calls itself) re-parses the
// same SQL text hundreds of times for no reason -- keyed by `db` (not a
// bare module-level singleton) specifically because this codebase's own
// tests each create a fresh `:memory:` db per test; a singleton cache
// would silently serve a PREVIOUS test's now-closed statement to a later
// one using a different db instance.
const statementCache = new WeakMap<
  Database.Database,
  {
    confirmed: Database.Statement
    auto: Database.Statement
  }
>()

function statementsFor(ownDb: Database.Database): {
  confirmed: Database.Statement
  auto: Database.Statement
} {
  const cached = statementCache.get(ownDb)
  if (cached) return cached
  const prepared = {
    confirmed: ownDb.prepare(
      `SELECT ArrangeRole FROM StemCategories WHERE StemCID = ? AND ArrangeRole IS NOT NULL`
    ),
    auto: ownDb.prepare(`SELECT ArrangeRole FROM StemAutoCategory WHERE StemCID = ?`)
  }
  statementCache.set(ownDb, prepared)
  return prepared
}

/** The single most-trusted ArrangeRole known for one specific stem, checked
 * in order: a real human confirmation (StemCategories, written by Tidy Up/
 * Auto Arrange's own role-confirmation step), then the background
 * audio-analysis classifier's own result (StemAutoCategory --
 * stemAutoClassify.ts, YAMNet embeddings + a centroid classifier, itself
 * TRAINED from those same human confirmations), falling back to
 * `fallback()` (a caller-supplied blunt guess -- typically the existing
 * instrument-mask/preset-name chain) only when NEITHER has an answer yet.
 *
 * Direct request, 2026-09-16: "the audio analysis should be able to detect
 * and differentiate drums from leads etc etc . there must be a better
 * way [than hand-tuning Tidy Up]." Both StemCategories and StemAutoCategory
 * already exist and are already trained by ordinary Tidy Up/Auto Arrange
 * use -- but nothing in Discover's own role inference (seeding, and the
 * temporal-adjacency popover's own role-matching) ever consulted either
 * one, only the blunt chain. This is the missing link -- ground truth first,
 * trained classifier second, blunt guess last.
 *
 * Both tables only ever live in the OWN warehouse db (see
 * stemCategoriesStore.ts's/stemAutoCategoryStore.ts's own repeated notes on
 * why an external LORE archive db is never a candidate for either) --
 * callers pass `openOwnRiffLibraryDb()` regardless of which db the stem
 * itself was actually resolved from. */
export function resolveStemArrangeRole(
  ownDb: Database.Database,
  stemCID: string,
  fallback: () => ArrangeRole | null
): ArrangeRole | null {
  const stmts = statementsFor(ownDb)

  const confirmed = stmts.confirmed.get(stemCID) as { ArrangeRole: ArrangeRole } | undefined
  if (confirmed) return confirmed.ArrangeRole

  const auto = stmts.auto.get(stemCID) as { ArrangeRole: ArrangeRole } | undefined
  if (auto) return auto.ArrangeRole

  return fallback()
}

/** Batched form of resolveStemArrangeRole, for a renderer-side caller
 * resolving every stem of one riff (at most 8) at once over a single IPC
 * round trip rather than one per stem. `fallback` is looked up by stemCID
 * so a caller can supply each stem's own blunt guess (already computed
 * client-side from data it already has, e.g. instrumentMask/presetName)
 * without this function needing to know anything about how that guess is
 * derived. */
export function resolveStemArrangeRoles(
  ownDb: Database.Database,
  stemCIDs: string[],
  fallback: (stemCID: string) => ArrangeRole | null
): Record<string, ArrangeRole | null> {
  const result: Record<string, ArrangeRole | null> = {}
  for (const stemCID of stemCIDs) {
    result[stemCID] = resolveStemArrangeRole(ownDb, stemCID, () => fallback(stemCID))
  }
  return result
}

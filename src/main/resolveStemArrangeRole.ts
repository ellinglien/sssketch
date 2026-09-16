// src/main/resolveStemArrangeRole.ts
import type Database from 'better-sqlite3'
import type { ArrangeRole } from '@shared/stemRole'

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
  const confirmed = ownDb
    .prepare(`SELECT ArrangeRole FROM StemCategories WHERE StemCID = ? AND ArrangeRole IS NOT NULL`)
    .get(stemCID) as { ArrangeRole: ArrangeRole } | undefined
  if (confirmed) return confirmed.ArrangeRole

  const auto = ownDb
    .prepare(`SELECT ArrangeRole FROM StemAutoCategory WHERE StemCID = ?`)
    .get(stemCID) as { ArrangeRole: ArrangeRole } | undefined
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

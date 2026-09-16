// src/main/stemFavouriteStore.ts
import type Database from 'better-sqlite3'

/** Every currently-favourited StemCID, on `ownDb` only (StemFavourite, like
 * StemAutoCategory/StemEmbeddingCache/StemFeatureCache, only ever lives
 * there -- see discoverCandidates.ts's own repeated notes on why an
 * external LORE archive db is never a candidate for these
 * sssketch-exclusive tables). Direct request, 2026-09-16: star an
 * individual stem in Discover -- distinct from riffLibraryWriter.ts's own
 * listWarehouseFavourites/toggleWarehouseFavourite, which favourite a
 * whole RIFF (Tags.Favour, part of the real LORE-compatible schema) rather
 * than one stem within it. */
export function listStemFavourites(ownDb: Database.Database): string[] {
  const rows = ownDb.prepare(`SELECT StemCID FROM StemFavourite`).all() as { StemCID: string }[]
  return rows.map((r) => r.StemCID)
}

/** Toggles one stem's favourite status and returns the updated full list --
 * same "return the whole updated list" contract riffLibraryWriter.ts's own
 * toggleWarehouseFavourite uses, so the IPC handler/renderer side follows
 * the identical shape as the existing riff-favourite feature. */
export function toggleStemFavourite(ownDb: Database.Database, stemCID: string): string[] {
  const existing = ownDb.prepare(`SELECT 1 FROM StemFavourite WHERE StemCID = ?`).get(stemCID)
  if (existing) {
    ownDb.prepare(`DELETE FROM StemFavourite WHERE StemCID = ?`).run(stemCID)
  } else {
    ownDb
      .prepare(`INSERT INTO StemFavourite (StemCID, FavouritedAt) VALUES (?, ?)`)
      .run(stemCID, Date.now())
  }
  return listStemFavourites(ownDb)
}

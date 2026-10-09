// Which jam a library stem file belongs to, for aligning Discover candidates from a seed's own
// jam to the seed's rotation (src/shared/discoverSeedPhase.ts). No electron here: tests pass
// in-memory dbs.
import type Database from 'better-sqlite3'
import { basename } from 'node:path'

const CHUNK = 500

/** path -> Stems.OwnerJamCID, for each path that is a library stem file (named after its
 * StemCID, no extension) some db in `dbs` knows; the first db that knows it wins. A file with an
 * extension (an imported WAV, a re-oned copy) is never a library stem and is left out. One query
 * per chunk per db, never one per stem. */
export function stemJamsForPaths(
  dbs: readonly Database.Database[],
  paths: readonly string[]
): Record<string, string> {
  const pathsByStem = new Map<string, string[]>()
  for (const path of paths) {
    const stemCID = basename(path)
    if (stemCID.length === 0 || stemCID.includes('.')) continue
    pathsByStem.set(stemCID, [...(pathsByStem.get(stemCID) ?? []), path])
  }
  const jams: Record<string, string> = {}
  let pending = [...pathsByStem.keys()]
  for (const db of dbs) {
    if (pending.length === 0) break
    const found = new Set<string>()
    for (let i = 0; i < pending.length; i += CHUNK) {
      const chunk = pending.slice(i, i + CHUNK)
      const rows = db
        .prepare(
          `SELECT StemCID, OwnerJamCID FROM Stems WHERE StemCID IN (${chunk.map(() => '?').join(',')})`
        )
        .all(...chunk) as { StemCID: string; OwnerJamCID: string | null }[]
      for (const row of rows) {
        if (!row.OwnerJamCID) continue
        found.add(row.StemCID)
        for (const path of pathsByStem.get(row.StemCID) ?? []) jams[path] = row.OwnerJamCID
      }
    }
    pending = pending.filter((stemCID) => !found.has(stemCID))
  }
  return jams
}

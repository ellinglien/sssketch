// Which jam a library stem file belongs to, for aligning Discover candidates from a seed's own
// jam to the seed's rotation (src/shared/discoverSeedPhase.ts). No electron here: tests pass the
// lookup and in-memory dbs.
//
// The jam is the riff index's (findRiffForStemPath in discoverAdjacency.ts: the jam of the riff
// a stem is mapped to), never Stems.OwnerJamCID. Every Discover candidate's jamCID is the riff
// index's too, so the seed and a candidate that is the same stem always agree on its jam. The
// two can differ: Stems.OwnerJamCID is whichever jam first wrote the stem's row (a Shared Feed
// sync, or a kept group in the discovered room), not the riff it plays from.
import type Database from 'better-sqlite3'
import { basename } from 'node:path'

/** path -> jam, for each path that is a library stem file (named after its StemCID, no
 * extension) that `jamOf` places. A file with an extension (an imported WAV, a re-oned copy) is
 * never a library stem and is left out. One lookup per StemCID, in order (the riff index is
 * cached in memory, so each is a map read once it is built). */
export async function stemJamsForPaths(
  paths: readonly string[],
  jamOf: (path: string) => Promise<string | null>
): Promise<Record<string, string>> {
  const pathsByStem = new Map<string, string[]>()
  for (const path of paths) {
    const stemCID = basename(path)
    if (stemCID.length === 0 || stemCID.includes('.')) continue
    pathsByStem.set(stemCID, [...(pathsByStem.get(stemCID) ?? []), path])
  }
  const jams: Record<string, string> = {}
  for (const stemPaths of pathsByStem.values()) {
    const jam = await jamOf(stemPaths[0])
    if (jam === null) continue
    for (const path of stemPaths) jams[path] = jam
  }
  return jams
}

const CHUNK = 500

/** jamCID -> Jams.PublicName, from the first db that names it; a db that can't be read (an
 * external file missing the table) is skipped. For the line that says a stem from the seed's jam
 * couldn't be lined up. A seed's few jams: one query per db. */
export function jamNamesFor(
  dbs: readonly Database.Database[],
  jamCIDs: readonly string[]
): Record<string, string> {
  const names: Record<string, string> = {}
  let pending = [...new Set(jamCIDs)]
  for (const db of dbs) {
    if (pending.length === 0) break
    for (let i = 0; i < pending.length; i += CHUNK) {
      const chunk = pending.slice(i, i + CHUNK)
      let rows: { JamCID: string; PublicName: string | null }[]
      try {
        rows = db
          .prepare(
            `SELECT JamCID, PublicName FROM Jams WHERE JamCID IN (${chunk.map(() => '?').join(',')})`
          )
          .all(...chunk) as typeof rows
      } catch {
        continue
      }
      for (const row of rows) if (row.PublicName) names[row.JamCID] = row.PublicName
    }
    pending = pending.filter((jamCID) => names[jamCID] === undefined)
  }
  return names
}

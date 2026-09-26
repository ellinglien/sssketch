// src/main/discoveredLibrary.ts
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { RiffLibraryResolvedRiff, RiffLibraryResolvedStem } from '@shared/riffLibraryTypes'
import {
  DISCOVERED_JAM_CID,
  DISCOVERED_USER_NAME,
  findDuplicateDiscoveredGroup
} from '@shared/discoveredRoom'
import { friendlyRiffName } from '@shared/friendlyRiffName'
import { discoveredStemPath } from './riffLibraryStore'
import { stemCIDForPath } from './stemCategoriesStore'
import { upsertJam, writeRiffDetail } from './riffLibraryWriter'
import { appendInstrumentRows, appendRiffIndexRows } from './discoverIndexCache'

/** One slot as the renderer sends it. Paths only -- resolveDiscoverRifff's
 * own ResolvedCandidateStems have already thrown away stemCID/riffCID, and
 * that is fine: main recovers identity from the path via stemCIDForPath,
 * the same function every cache read already uses. */
export interface DiscoveredMemberInput {
  path: string
  /** 0-1, already forced to 0 for a slot muted in Discover's preview mix --
   * a muted stem is saved as SILENCE, still there, still un-muteable later. */
  gain: number
  name: string
  author: string
  barLength: number
  durationSec: number
}

export interface SaveDiscoveredInput {
  members: DiscoveredMemberInput[]
  bpm: number
  barLength: number
  /** Unix seconds -- when he KEPT it, not the source riffs' own times.
   * Browse groups by day, and "today" is the true answer for a thing
   * discovered today. */
  creationTime: number
}

export interface SaveDiscoveredResult {
  riffCID: string
  name: string
  duplicate: boolean
  /** Everything the CALLER needs to fold this save into
   * discoverCandidates.ts's IN-MEMORY caches once the transaction has
   * committed. Returned rather than applied here because
   * appendToInMemoryDiscoverCaches re-reads the tables' change signals and
   * has to see post-commit counts. Both empty for a duplicate, which wrote
   * nothing. */
  indexRows: {
    stemCID: string
    entry: { riffCID: string; ownerJamCID: string; bpmRnd: number; creationTime: number | null }
  }[]
  newInstrumentRows: { StemCID: string; Instrument: number | null; OwnerJamCID: string }[]
}

interface SourceStemRow {
  StemCID: string
  CreatorUserName: string | null
  PresetName: string | null
  Instrument: number | null
  BPMrnd: number | null
  Length16s: number | null
  FileEndpoint: string | null
  FileBucket: string | null
  FileKey: string | null
}

const STEM_SLOT_COLUMNS = Array.from({ length: 8 }, (_, i) => `StemCID_${i + 1}`)

/** Every kept group in the room, as {riffCID, stemCIDs} -- ONE query over
 * the whole room, never a per-stem lookup. Both the duplicate check and
 * forget's "is this copy still needed" test read this same list. At a
 * realistic few hundred saved groups it is free. */
export function listDiscoveredGroups(
  ownDb: Database.Database
): { riffCID: string; stemCIDs: string[] }[] {
  const rows = ownDb
    .prepare(`SELECT RiffCID, ${STEM_SLOT_COLUMNS.join(', ')} FROM Riffs WHERE OwnerJamCID = ?`)
    .all(DISCOVERED_JAM_CID) as Record<string, string | null>[]
  return rows.map((row) => ({
    riffCID: row.RiffCID as string,
    stemCIDs: STEM_SLOT_COLUMNS.map((c) => row[c]).filter((c): c is string => Boolean(c))
  }))
}

function findSourceStemRow(dbs: Database.Database[], stemCID: string): SourceStemRow | undefined {
  for (const db of dbs) {
    const row = db
      .prepare(
        `SELECT StemCID, CreatorUserName, PresetName, Instrument, BPMrnd, Length16s,
                FileEndpoint, FileBucket, FileKey
         FROM Stems WHERE StemCID = ?`
      )
      .get(stemCID) as SourceStemRow | undefined
    if (row) return row
  }
  return undefined
}

/** Saves whatever loop Discover currently has as a real rifff in the
 * `discovered` room.
 *
 * `ownDb` is sssketch's own WRITABLE warehouse (openOwnRiffLibraryDb); it
 * is also where the Stems rows and the Discover cache tables live.
 * `browseDbs` are the extra databases a stem's row might live in instead
 * (candidateDbsForRiff -- typically an external LORE archive), checked
 * after ownDb, read-only.
 *
 * Returns null only when there is nothing placeable to save.
 *
 * A duplicate -- the same SET of StemCIDs, unordered, ignoring gain -- is a
 * no-op that says so: nothing is written, not a second row and not a
 * silent bump of the original's timestamp, and the caller is told.
 *
 * Files are copied BEFORE the transaction, on purpose: the filesystem is
 * not transactional, and an orphaned copy is harmless where a Riffs row
 * pointing at a missing file renders as a permanently uncached circle.
 *
 * Everything that writes is inside ONE ownDb.transaction -- the Jams
 * upsert, writeRiffDetail (whose own db.transaction nests as a SAVEPOINT),
 * and both Discover index-cache appends. The in-memory cache append is
 * deliberately left to the caller AFTER this returns, because it has to
 * read post-commit table signals (see appendToInMemoryDiscoverCaches). */
export function saveDiscoveredRifff(
  ownDb: Database.Database,
  browseDbs: Database.Database[],
  input: SaveDiscoveredInput
): SaveDiscoveredResult | null {
  if (input.members.length === 0) return null

  // Eight point lookups on an explicit, human-initiated action -- not a
  // batch path. A path with no real Stems row behind it (a shelf-seeded
  // slot, a wav dropped on the panel, an in-app recording) gets a freshly
  // minted StemCID and a real Stems row of its own, so save is TOTAL: it
  // never refuses and never silently drops a slot. Such a stem loses its
  // old analysis (new id, cold caches) and re-saving the same dropped wav
  // makes a second copy -- accepted; those slots are rare in the loop this
  // is for.
  const resolved = input.members.map((member) => {
    const stemCID = stemCIDForPath(ownDb, member.path, browseDbs)
    return {
      member,
      stemCID: stemCID ?? `discovered-${randomUUID()}`,
      minted: stemCID === null
    }
  })

  const duplicateOf = findDuplicateDiscoveredGroup(
    listDiscoveredGroups(ownDb),
    resolved.map((r) => r.stemCID)
  )
  if (duplicateOf !== null) {
    return {
      riffCID: duplicateOf,
      name: friendlyRiffName(duplicateOf, 'library'),
      duplicate: true,
      indexRows: [],
      newInstrumentRows: []
    }
  }

  const riffCID = `discovered-${randomUUID()}`

  for (const { member, stemCID } of resolved) {
    const destination = discoveredStemPath(stemCID)
    if (existsSync(destination)) continue
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(member.path, destination)
  }

  const knownStemCIDs = new Set(
    (
      ownDb
        .prepare(
          `SELECT StemCID FROM Stems WHERE StemCID IN (${resolved.map(() => '?').join(',')})`
        )
        .all(...resolved.map((r) => r.stemCID)) as { StemCID: string }[]
    ).map((r) => r.StemCID)
  )

  const stems: RiffLibraryResolvedStem[] = resolved.map(({ member, stemCID }, index) => {
    const source = findSourceStemRow([ownDb, ...browseDbs], stemCID)
    return {
      stemCID,
      slot: index + 1,
      path: discoveredStemPath(stemCID),
      gain: member.gain,
      creatorUserName: source?.CreatorUserName ?? member.author,
      presetName: source?.PresetName ?? member.name,
      instrumentMask: source?.Instrument ?? 0,
      durationSec: member.durationSec,
      barLength: member.barLength,
      bpm: source?.BPMrnd ?? input.bpm,
      // Carried through so writeRiffDetail's unconditional
      // UPDATE Stems SET FileEndpoint/FileBucket/FileKey does not null out
      // a real synced stem's download columns -- see riffLibraryStore.ts's
      // buildResolvedRiff, fixed for the same reason.
      fileEndpoint: source?.FileEndpoint ?? undefined,
      fileBucket: source?.FileBucket ?? undefined,
      fileKey: source?.FileKey ?? undefined,
      downloadUrl: null
    }
  })

  // Root/Scale stay NULL, deliberately: a collage of stems from different
  // jams has no honest key, and the Inspector already handles an absent one.
  const riff: RiffLibraryResolvedRiff = {
    riffCID,
    bpm: input.bpm,
    barLength: input.barLength,
    creationTime: input.creationTime,
    stems
  }

  const sourceDbKey = ownDb.name
  const newStemRows = resolved.filter((r) => !knownStemCIDs.has(r.stemCID))
  const indexRows = stems.map((stem) => ({
    stemCID: stem.stemCID,
    entry: {
      riffCID,
      ownerJamCID: DISCOVERED_JAM_CID,
      bpmRnd: input.bpm,
      creationTime: input.creationTime as number | null
    }
  }))
  const newInstrumentRows = newStemRows.map(({ stemCID }) => ({
    StemCID: stemCID,
    Instrument: stems.find((s) => s.stemCID === stemCID)?.instrumentMask ?? null,
    OwnerJamCID: DISCOVERED_JAM_CID
  }))

  ownDb.transaction(() => {
    upsertJam(ownDb, DISCOVERED_JAM_CID, DISCOVERED_JAM_CID)
    writeRiffDetail(
      ownDb,
      DISCOVERED_JAM_CID,
      { creationTime: input.creationTime, userName: DISCOVERED_USER_NAME },
      riff
    )
    appendRiffIndexRows(
      ownDb,
      sourceDbKey,
      indexRows.map((row) => ({ stemCID: row.stemCID, ...row.entry })),
      1
    )
    appendInstrumentRows(ownDb, sourceDbKey, newInstrumentRows, newInstrumentRows.length)
  })()

  return {
    riffCID,
    name: friendlyRiffName(riffCID, 'library'),
    duplicate: false,
    indexRows,
    newInstrumentRows
  }
}

/** Deletes one kept group: its Riffs row, plus any copied stem file that no
 * OTHER kept group still references (computed in JS from
 * listDiscoveredGroups' single query -- no per-stem query).
 *
 * Never deletes a Stems row and never touches StemCategories /
 * StemFeatureCache / StemPeaksCache / StemEmbeddingCache / StemAutoCategory
 * / StemFavourite: those are keyed by StemCID and are still true about the
 * stem, wherever else it lives.
 *
 * Deliberately does NOT touch the Discover index caches. Deleting a Riffs
 * row moves the count they are validated against, so within
 * CACHE_CHANGE_CHECK_INTERVAL_MS the own db's in-memory index rebuilds
 * once. Forgetting is not in the roll/keep loop, and a symmetric delete
 * would have to decide what to do about a stem the index maps to this riff
 * but that other riffs also contain -- a correctness risk for no benefit
 * here. */
export function forgetDiscoveredRifff(ownDb: Database.Database, riffCID: string): void {
  const groups = listDiscoveredGroups(ownDb)
  const target = groups.find((g) => g.riffCID === riffCID)
  if (!target) return
  const stillUsed = new Set<string>()
  for (const group of groups) {
    if (group.riffCID === riffCID) continue
    for (const stemCID of group.stemCIDs) stillUsed.add(stemCID)
  }

  ownDb.transaction(() => {
    ownDb
      .prepare(`DELETE FROM Riffs WHERE RiffCID = ? AND OwnerJamCID = ?`)
      .run(riffCID, DISCOVERED_JAM_CID)
    ownDb.prepare(`DELETE FROM Tags WHERE RiffCID = ?`).run(riffCID)
  })()

  for (const stemCID of target.stemCIDs) {
    if (stillUsed.has(stemCID)) continue
    rmSync(discoveredStemPath(stemCID), { force: true })
  }
}

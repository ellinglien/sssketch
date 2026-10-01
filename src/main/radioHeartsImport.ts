// src/main/radioHeartsImport.ts
//
// "fetch radio hearts" (Discover, next to keep): GETs ell.ing/radio's
// private hearts.json and brings every newly hearted combination home as a
// kept riff, through the very same saveDiscoveredRifff path keep uses, and
// stars every hearted stem so Discover's favourites boost applies here too.
// Liked single stems (the radio's 👍, hearts.json's `likes`) are starred the
// same way, once each, on first import (planLikeImport).
// What to import is decided by @shared/radioHearts' planHeartImport; this
// module is the fetch and the writes.
// ell.ing/radio docs/specs/2026-09-30-radio-controls-and-hearts-design.md §2.4.
//
// Only ever writes sssketch's OWN db (StemFavourite, RadioHeartImport, and
// whatever `save` writes there) -- never an external LORE archive.
import { existsSync } from 'node:fs'
import type Database from 'better-sqlite3'
import {
  RADIO_HEARTS_URL,
  parseHeartsResponse,
  parseLikesResponse,
  planHeartImport,
  planLikeImport,
  type RadioHeartsResult
} from '@shared/radioHearts'
import type { DiscoveredMemberInput } from './discoveredLibrary'
import { discoveredStemPath, resolveStemPath } from './riffLibraryStore'
import { addStemFavourites, listStemFavourites } from './stemFavouriteStore'
import {
  listImportedHeartCombos,
  listImportedLikes,
  recordHeartImport,
  recordLikeImports,
  refreshHeartCount
} from './radioHeartImportStore'

/** The narrow slice of fetch this module uses -- injected, so tests never
 * touch the network. */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export interface FetchRadioHeartsDeps {
  /** The hearts.json key from settings; null when none is set. */
  key: string | null
  fetch: FetchLike
  /** sssketch's own writable warehouse (openOwnRiffLibraryDb). */
  ownDb: Database.Database
  /** False when the configured LORE archive is away -- the whole import is
   * refused. riffLibraryArchiveReachable in production. */
  archiveReachable: () => boolean
  /** A stem's local audio and metadata, or null if it is not on this
   * machine. resolveHeartStem in production. */
  resolveStem: (stemCID: string) => DiscoveredMemberInput | null
  /** keep's own save: saveDiscoveredRifff plus the in-memory cache append
   * (index.ts's keepDiscovered). */
  save: (
    members: DiscoveredMemberInput[],
    bpm: number,
    barLength: number
  ) => { riffCID: string; name: string; duplicate: boolean } | null
  log?: (line: string) => void
  now?: () => number
}

interface HeartStemRow {
  OwnerJamCID: string
  BPMrnd: number | null
  Length16s: number | null
  PresetName: string | null
  CreatorUserName: string | null
}

/** A hearted stem as keep's own member shape, or null when it has no local
 * audio. Looks the stem up in each db in turn (own first, then any external
 * archive -- candidateDbsForRiff), and takes its path from resolveStemPath,
 * falling back to a copy an earlier keep already made. Loop length and
 * duration are the stem's OWN (Length16s / BPMrnd), the same derivation
 * riffLibraryStore.ts's buildResolvedRiff uses -- a stem can be a shorter
 * loop tiled across a longer riff. Gain is 1: a heart carries no mix. */
export function resolveHeartStem(
  stemCID: string,
  dbs: readonly Database.Database[]
): DiscoveredMemberInput | null {
  for (const db of dbs) {
    let row: HeartStemRow | undefined
    try {
      row = db
        .prepare(
          `SELECT OwnerJamCID, BPMrnd, Length16s, PresetName, CreatorUserName
           FROM Stems WHERE StemCID = ?`
        )
        .get(stemCID) as HeartStemRow | undefined
    } catch {
      continue // an external db this app does not control
    }
    if (!row || !row.BPMrnd || row.BPMrnd <= 0) continue
    const path = [resolveStemPath(row.OwnerJamCID, stemCID), discoveredStemPath(stemCID)].find(
      (p) => existsSync(p)
    )
    if (!path) continue
    const barLength = (row.Length16s ?? 16) / 16
    return {
      path,
      gain: 1,
      name: row.PresetName ?? '',
      author: row.CreatorUserName ?? '',
      barLength,
      durationSec: barLength * (60 / row.BPMrnd) * 4
    }
  }
  return null
}

/** One fetch, start to finish. Never throws: a missing key, a refused key,
 * an unreachable server, a malformed body or an absent archive each come
 * back as a reason with nothing written, and anything unexpected as
 * 'import failed'.
 *
 * Writes, per combo: `save` first, on its own (it copies files and runs
 * its own transaction), then -- only if it saved -- the combo's
 * RadioHeartImport row and its stars together in ONE transaction. A combo
 * is therefore either fully brought home or not recorded at all, and an
 * unrecorded one is simply tried again next fetch (its save then comes
 * back a duplicate, which is recorded like any other). */
export async function fetchRadioHearts(deps: FetchRadioHeartsDeps): Promise<RadioHeartsResult> {
  const log = deps.log ?? ((line: string) => console.log(line))
  try {
    return await fetchRadioHeartsUnguarded({ ...deps, log })
  } catch (err) {
    log(`radio hearts: import failed: ${err instanceof Error ? err.message : String(err)}`)
    return { ok: false, reason: 'import failed' }
  }
}

async function fetchRadioHeartsUnguarded({
  key,
  fetch,
  ownDb,
  archiveReachable,
  resolveStem,
  save,
  log,
  now = Date.now
}: FetchRadioHeartsDeps & { log: (line: string) => void }): Promise<RadioHeartsResult> {
  if (!key) return { ok: false, reason: 'no key' }
  // Before anything else: with the archive away, every stem living there
  // would read as missing audio, and combos would be kept short a stem
  // and recorded as done.
  if (!archiveReachable()) return { ok: false, reason: 'archive not mounted' }

  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await fetch(RADIO_HEARTS_URL, { headers: { authorization: `Bearer ${key}` } })
  } catch (err) {
    log(`radio hearts: fetch failed: ${err instanceof Error ? err.message : String(err)}`)
    return { ok: false, reason: 'unreachable' }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'key refused' }
  if (!res.ok) {
    log(`radio hearts: hearts.json answered ${res.status}`)
    return { ok: false, reason: 'unreachable' }
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, reason: 'bad response' }
  }
  const hearts = parseHeartsResponse(body)
  if (!hearts) return { ok: false, reason: 'bad response' }
  // Absent on the older server; that is no likes, not a bad response.
  const likes = parseLikesResponse(body)

  // A stem both hearted and liked is looked up once.
  const resolved = new Map<string, DiscoveredMemberInput | null>()
  const resolveOnce = (stemCID: string): DiscoveredMemberInput | null => {
    if (!resolved.has(stemCID)) resolved.set(stemCID, resolveStem(stemCID))
    return resolved.get(stemCID) ?? null
  }
  const favourites = new Set(listStemFavourites(ownDb))
  const plan = planHeartImport(hearts, listImportedHeartCombos(ownDb), favourites, resolveOnce)
  const likePlan = planLikeImport(likes, listImportedLikes(ownDb), favourites, resolveOnce)

  for (const heart of plan.alreadyImported) refreshHeartCount(ownDb, heart.combo, heart.count)

  let kept = 0
  let alreadyKept = 0
  let favourited = 0
  for (const { heart, members, missing, stars } of plan.combosToKeep) {
    if (missing.length > 0)
      log(`radio hearts: ${heart.combo} kept without ${missing.join(', ')} (no local audio)`)
    try {
      const saved = save(members, heart.bpm, heart.loopBars)
      if (saved === null) {
        // Only an empty member list saves nothing, and a planned combo has
        // at least two -- but if it ever happens, leave it unrecorded.
        log(`radio hearts: ${heart.combo} saved nothing`)
        continue
      }
      const starred = ownDb.transaction(() => {
        recordHeartImport(ownDb, {
          combo: heart.combo,
          riffCID: saved.riffCID,
          count: heart.count,
          at: now()
        })
        return addStemFavourites(ownDb, stars)
      })()
      favourited += starred
      if (saved.duplicate) alreadyKept += 1
      else kept += 1
    } catch (err) {
      // Not recorded, no stars: the next fetch tries it again.
      log(
        `radio hearts: ${heart.combo} not brought home: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  for (const { heart, missing } of plan.tooFew) {
    log(`radio hearts: ${heart.combo} not kept -- no local audio for ${missing.join(', ')}`)
  }

  // Likes: every record and star in ONE transaction, after the combos. A
  // stem a combo just starred is already there, so addStemFavourites
  // counts it once, not twice.
  let likesImported = 0
  if (likePlan.missing.length > 0)
    log(`radio hearts: liked but no local audio: ${likePlan.missing.join(', ')}`)
  if (likePlan.toRecord.length > 0) {
    try {
      favourited += ownDb.transaction(() => {
        recordLikeImports(ownDb, likePlan.toRecord, now())
        return addStemFavourites(ownDb, likePlan.toStar)
      })()
      likesImported = likePlan.toRecord.length
    } catch (err) {
      // Nothing recorded, nothing starred: the next fetch tries again.
      log(
        `radio hearts: likes not brought home: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return {
    ok: true,
    kept,
    alreadyKept,
    skipped: plan.alreadyImported.length,
    tooFew: plan.tooFew.length,
    favourited,
    likes: likesImported,
    missingStems: new Set([...plan.missingStems, ...likePlan.missing]).size
  }
}

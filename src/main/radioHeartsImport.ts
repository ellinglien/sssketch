// src/main/radioHeartsImport.ts
//
// "fetch radio hearts" (Discover, next to keep): GETs ell.ing/radio's
// private hearts.json and brings every newly hearted combination home as a
// kept riff, through the very same saveDiscoveredRifff path keep uses, and
// stars every hearted stem so Discover's favourites boost applies here too.
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
  heartRiffName,
  parseHeartsResponse,
  planHeartImport,
  type RadioHeartsResult
} from '@shared/radioHearts'
import type { DiscoveredMemberInput } from './discoveredLibrary'
import { discoveredStemPath, resolveStemPath } from './riffLibraryStore'
import { addStemFavourites, listStemFavourites } from './stemFavouriteStore'

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

/** Every combo a previous fetch already brought home. */
export function listImportedHeartCombos(ownDb: Database.Database): Set<string> {
  const rows = ownDb.prepare(`SELECT Combo FROM RadioHeartImport`).all() as { Combo: string }[]
  return new Set(rows.map((r) => r.Combo))
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
 * an unreachable server or a malformed body each come back as a reason, and
 * nothing is written in any of those cases. */
export async function fetchRadioHearts({
  key,
  fetch,
  ownDb,
  resolveStem,
  save,
  log = (line) => console.log(line),
  now = Date.now
}: FetchRadioHeartsDeps): Promise<RadioHeartsResult> {
  if (!key) return { ok: false, reason: 'no key' }

  let body: unknown
  try {
    const res = await fetch(RADIO_HEARTS_URL, { headers: { authorization: `Bearer ${key}` } })
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'key refused' }
    if (!res.ok) {
      log(`radio hearts: hearts.json answered ${res.status}`)
      return { ok: false, reason: 'unreachable' }
    }
    body = await res.json()
  } catch (err) {
    log(`radio hearts: fetch failed: ${err instanceof Error ? err.message : String(err)}`)
    return { ok: false, reason: 'unreachable' }
  }
  const hearts = parseHeartsResponse(body)
  if (!hearts) return { ok: false, reason: 'bad response' }

  const plan = planHeartImport(
    hearts,
    listImportedHeartCombos(ownDb),
    new Set(listStemFavourites(ownDb)),
    resolveStem
  )

  const record = ownDb.prepare(
    `INSERT INTO RadioHeartImport (Combo, RiffCID, Name, ImportedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(Combo) DO NOTHING`
  )
  let kept = 0
  let alreadyKept = 0
  for (const { heart, members, missing } of plan.combosToKeep) {
    if (missing.length > 0)
      log(`radio hearts: ${heart.combo} kept without ${missing.join(', ')} (no local audio)`)
    let saved: ReturnType<FetchRadioHeartsDeps['save']>
    try {
      saved = save(members, heart.bpm, heart.loopBars)
    } catch (err) {
      // Not recorded, so the next fetch tries it again.
      log(
        `radio hearts: saving ${heart.combo} failed: ${err instanceof Error ? err.message : String(err)}`
      )
      continue
    }
    if (!saved) continue
    if (saved.duplicate) alreadyKept += 1
    else kept += 1
    record.run(heart.combo, saved.riffCID, heartRiffName(heart.count, saved.name), now())
  }
  for (const { heart, missing } of plan.tooFew) {
    log(`radio hearts: ${heart.combo} not kept -- no local audio for ${missing.join(', ')}`)
  }

  const favourited = addStemFavourites(ownDb, plan.favouritesToAdd)

  return {
    ok: true,
    kept,
    alreadyKept,
    skipped: plan.alreadyImported,
    tooFew: plan.tooFew.length,
    favourited,
    missingStems: plan.missingStems.length
  }
}

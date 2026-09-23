// src/main/tidyUpLibraryStems.ts
import type Database from 'better-sqlite3'
import type { SoundType } from '@shared/types'
import type { ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { resolveStemPath } from './riffLibraryStore'
import { createDirListingExists } from './discoverLibraryStems'
import { countWork } from './workCounters'

/** One library stem, as Tidy Up's library population needs it. */
export interface TidyUpLibraryStem {
  stemCID: string
  path: string
  /** The stem's own raw Endlesss preset name -- what
   * guessArrangeRoleFromPresetName matches against. */
  presetName: string
  author: string
  type: SoundType
  barLength: number
  durationSec: number
  /** What a human already said this is, or null. Rows with one sort LAST. */
  confirmedRole: ArrangeRole | null
  /** The overnight classifier's own guess (StemAutoCategory), or null. */
  suggestedRole: ArrangeRole | null
}

/** One page of the eligible-id scan. Keyset-paged on StemCID (the PK), so
 * a page is an index range scan rather than an OFFSET the engine has to
 * count its way to. */
const PAGE_SIZE = 2000

/** One IN-list query per chunk, the same 500 stemCategoriesStore.ts's own
 * chunked role lookup uses. */
const HYDRATE_CHUNK_SIZE = 500

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

interface EligibleRow {
  StemCID: string
  ConfirmedRole: string | null
  SuggestedRole: string | null
}

interface MetadataRow {
  StemCID: string
  OwnerJamCID: string
  CreationTime: number | null
  BPMrnd: number | null
  Length16s: number | null
  PresetName: string | null
  CreatorUserName: string | null
  Instrument: number | null
}

/**
 * The library population, in the order the spec chose.
 *
 * **UNCONFIRMED FIRST, THEN MOST-RECENTLY-IMPORTED** (spec, SETTLED
 * 2026-09-23). It matches why the surface was opened -- a jam just came in
 * and wants labelling -- and it is the cheapest labelling condition there
 * is: a stem from last week is one you can still recognise, where a stem
 * from two years ago has to be auditioned from scratch.
 *
 * **Least-confident-first was considered and REJECTED as the default.** It
 * optimises for the classifier rather than the person: the stems it is
 * least sure about are disproportionately the noisy, odd, genuinely
 * unclassifiable ones, so it opens with the hardest possible screen and the
 * least useful stems in the library, at the highest compute cost. A pass
 * that opens with ten things you cannot confidently name is a pass you
 * close. If it earns a place later it is as a deliberate secondary mode,
 * never the default. Do not "improve" this ordering.
 *
 * Only stems whose FEATURES have already been scanned are offered
 * (StemFeatureCache) and only ones whose audio is already on disk
 * (existsFn) -- the same rule listLibraryScanTargets follows and for the
 * same reason: Elling's consent is about working with what is already
 * there, not triggering tens of thousands of downloads.
 *
 * Paged with a yield between pages, and `.all()` per page -- never a
 * statement held open across an await (MEMORY.md's hard-won SQLite rule).
 *
 * `ownDb` holds StemFeatureCache / StemCategories / StemAutoCategory, which
 * are sssketch-exclusive and live only on the user's own writable db.
 * `extraCandidateDbs` are the read-only external archives a stem's own
 * `Stems` row may live in instead -- so the eligible-id query runs against
 * ownDb and the metadata hydration runs across both, which is why this is
 * two passes rather than one JOIN.
 *
 * A scanned stem with no `Stems` row in ANY of those dbs is dropped rather
 * than half-invented: without OwnerJamCID there is no path to resolve and
 * nothing to audition.
 */
export async function listTidyUpLibraryStems(
  ownDb: Database.Database,
  extraCandidateDbs: Database.Database[],
  limit: number,
  existsFn: (path: string) => boolean = createDirListingExists()
): Promise<TidyUpLibraryStem[]> {
  if (limit <= 0) return []

  // PASS ONE -- eligible ids and what is already known about them, from
  // ownDb only. Keyset-paged on the PK with a yield between pages, so a
  // ~45,000-row StemFeatureCache never blocks the main process in one go.
  const eligible: EligibleRow[] = []
  let after = ''
  for (;;) {
    countWork('sql:tidy-up-library.eligible')
    const page = ownDb
      .prepare(
        `SELECT f.StemCID AS StemCID,
                c.ArrangeRole AS ConfirmedRole,
                a.ArrangeRole AS SuggestedRole
         FROM StemFeatureCache f
         LEFT JOIN StemCategories c ON c.StemCID = f.StemCID
         LEFT JOIN StemAutoCategory a ON a.StemCID = f.StemCID
         WHERE f.StemCID > ?
         ORDER BY f.StemCID LIMIT ?`
      )
      .all(after, PAGE_SIZE) as EligibleRow[]
    if (page.length === 0) break
    eligible.push(...page)
    after = page[page.length - 1].StemCID
    if (page.length < PAGE_SIZE) break
    await yieldToEventLoop()
  }
  if (eligible.length === 0) return []

  // PASS TWO -- metadata, in chunks, across ownDb and every read-only
  // external archive. First db that answers for a StemCID wins, matching
  // stemCIDForPath's own candidate-db order.
  const wanted = eligible.map((row) => row.StemCID)
  const metadata = new Map<string, MetadataRow>()
  const dbs = [ownDb, ...extraCandidateDbs]
  for (let start = 0; start < wanted.length; start += HYDRATE_CHUNK_SIZE) {
    const chunk = wanted.slice(start, start + HYDRATE_CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(',')
    for (const db of dbs) {
      countWork('sql:tidy-up-library.hydrate')
      const rows = db
        .prepare(
          `SELECT StemCID, OwnerJamCID, CreationTime, BPMrnd, Length16s, PresetName,
                  CreatorUserName, Instrument
           FROM Stems WHERE StemCID IN (${placeholders})`
        )
        .all(...chunk) as MetadataRow[]
      for (const row of rows) if (!metadata.has(row.StemCID)) metadata.set(row.StemCID, row)
    }
    await yieldToEventLoop()
  }

  // Assemble, dropping anything with no metadata row and anything whose
  // audio is not already on disk.
  const assembled: { stem: TidyUpLibraryStem; creationTime: number }[] = []
  for (const row of eligible) {
    const meta = metadata.get(row.StemCID)
    if (meta === undefined) continue
    const path = resolveStemPath(meta.OwnerJamCID, row.StemCID)
    if (!existsFn(path)) continue
    // Derived exactly as riffLibraryStore.ts's own resolveRiff does --
    // Length16s (the stem's native loop length in sixteenth notes), NOT the
    // Stems table's BarLength column, which that file records as having
    // matched measured duration 1/300 times against real cached audio.
    const barLength = (meta.Length16s ?? 16) / 16
    const durationSec = barLength * (60 / (meta.BPMrnd ?? 120)) * 4
    // Exactly as DiscoverPanel.tsx already derives it for a library stem:
    // the instrument bitmask is provenance, the preset name is the
    // fallback, and 'fx' is the catch-all that means "nothing said".
    const type =
      instrumentMaskToSoundType(meta.Instrument ?? 0) ??
      guessSoundTypeFromPresetName(meta.PresetName ?? '') ??
      'fx'
    assembled.push({
      stem: {
        stemCID: row.StemCID,
        path,
        presetName: meta.PresetName ?? '',
        author: meta.CreatorUserName ?? '',
        type,
        barLength,
        durationSec,
        confirmedRole: (row.ConfirmedRole as ArrangeRole | null) ?? null,
        suggestedRole: (row.SuggestedRole as ArrangeRole | null) ?? null
      },
      creationTime: meta.CreationTime ?? 0
    })
  }

  // Unconfirmed first, then newest first. Sorted here rather than in SQL
  // because CreationTime lives on the `Stems` row, which may be in a
  // read-only external archive while the confirmation is in ownDb -- there
  // is no one table to ORDER BY across both.
  assembled.sort(
    (a, b) =>
      Number(a.stem.confirmedRole !== null) - Number(b.stem.confirmedRole !== null) ||
      b.creationTime - a.creationTime
  )
  return assembled.slice(0, limit).map((entry) => entry.stem)
}

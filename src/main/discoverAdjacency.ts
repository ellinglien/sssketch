// src/main/discoverAdjacency.ts
import { basename } from 'node:path'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import type { SoundType } from '@shared/types'
import { DISCOVER_TRAIT_SLOT_KINDS, type DiscoverSlotKind } from '@shared/discoverSlotKind'
import type { StemFeatures } from '@shared/stemFeatures'
import {
  resolveRiffWithContext,
  listRiffs,
  resolveRiff,
  downloadMissingStems,
  listJamsWithDb,
  resolveStemPath
} from './riffLibraryStore'
import { openOwnRiffLibraryDb } from './riffLibrarySchema'
import { getRiffIndexForDb, type DiscoverCandidate } from './discoverCandidates'

/** Result of walking outward from a center index in both directions --
 * `newer`/`older` name the two directions unambiguously in real, wall-clock
 * time (not "earlier"/"later", which inverts depending on whether you mean
 * chronological order or DESC-rank order). `newer[0]`/`older[0]`, when
 * present, are always the CLOSEST match to the center in that direction --
 * the row a popover's own step ("skip to the next one this direction")
 * button should act on. */
export interface AdjacentWalkResult<Match> {
  newer: Match[]
  older: Match[]
}

/** Walks outward from `centerIndex` in `window` (already ordered so that a
 * SMALLER index means a row recorded chronologically LATER -- exactly what
 * listRiffs' own `ORDER BY CreationTime DESC` produces, rank 0 = newest) in
 * both directions, calling `matcher` on each row until `maxPerDirection`
 * non-null results are collected per direction OR that direction's rows are
 * exhausted, whichever comes first. Pure -- no I/O of its own; `matcher` may
 * do I/O (real usage resolves a candidate riff's stems over IPC/SQLite), but
 * this function itself has no side effects and is safe to unit test with
 * plain data. */
export async function walkAdjacentWindow<Row, Match>(
  window: Row[],
  centerIndex: number,
  matcher: (row: Row) => Promise<Match | null>,
  maxPerDirection: number
): Promise<AdjacentWalkResult<Match>> {
  // Smaller index = smaller rank = larger CreationTime = recorded AFTER the
  // center = "newer". Walking from centerIndex - 1 down to 0 walks outward,
  // closest-to-center first -- .reverse() after the slice, since slice
  // itself preserves ascending order (index 0 first).
  const newerRows = window.slice(0, centerIndex).reverse()
  // Larger index = larger rank = smaller CreationTime = recorded BEFORE the
  // center = "older". Already closest-to-center first after slicing.
  const olderRows = window.slice(centerIndex + 1)

  async function collect(rows: Row[]): Promise<Match[]> {
    const out: Match[] = []
    for (const row of rows) {
      if (out.length >= maxPerDirection) break
      const match = await matcher(row)
      if (match !== null) out.push(match)
    }
    return out
  }

  const [newer, older] = await Promise.all([collect(newerRows), collect(olderRows)])
  return { newer, older }
}

// How many role-matched candidates to surface per direction -- matches the
// design spec's own fixed default (docs/superpowers/specs/2026-09-16-
// discover-temporal-adjacency-design.md).
const ADJACENT_MATCHES_PER_DIRECTION = 4

// How many RAW riffs (matched or not) to fetch per direction before giving
// up looking for that many matches -- generously larger than
// ADJACENT_MATCHES_PER_DIRECTION, since most riffs in a jam won't have a
// stem in any one specific requested role at all.
const ADJACENT_FETCH_MULTIPLIER = 8
const ADJACENT_FETCH_PER_DIRECTION = ADJACENT_MATCHES_PER_DIRECTION * ADJACENT_FETCH_MULTIPLIER

/** A DiscoverCandidate plus its own already-resolved local file path --
 * see matchRole's own doc comment (below) for why this is precomputed
 * here rather than left for the renderer to resolve a second time. */
export interface AdjacentDiscoverCandidate extends DiscoverCandidate {
  path: string
  soundType: SoundType | null
}

// Field this trait kind's adjacency match requires a cached row for --
// mirrors discoverCandidates.ts's own TRAIT_FIELD table exactly (kept as a
// separate small copy here rather than exported/shared, matching this
// codebase's own "small duplicated tables are cheaper than coupling two
// independently-scoped files" convention used elsewhere, e.g.
// DiscoverLibraryScan.tsx's own BATCH_SIZE not importing from
// BackgroundFeatureScan.tsx).
const TRAIT_FIELD: Record<
  'bassHeavy' | 'rhythmic' | 'bright' | 'warm',
  keyof Pick<StemFeatures, 'bassEnergyRatio' | 'transientDensity' | 'spectralCentroidHz'>
> = {
  bassHeavy: 'bassEnergyRatio',
  rhythmic: 'transientDensity',
  bright: 'spectralCentroidHz',
  warm: 'spectralCentroidHz'
}

/** Finds up to ADJACENT_MATCHES_PER_DIRECTION riffs recorded near
 * `centerRiffCID`, in the SAME jam's own iteration sequence, that have at
 * least one stem matching `kind` -- see this plan's own header for the
 * architecture. `newer`/`older` are unambiguous, real chronological
 * directions (see walkAdjacentWindow's own doc comment) -- the CALLER maps
 * them to "earlier"/"later" UI labels (older -> earlier, newer -> later).
 * Returns `{ newer: [], older: [] }` (never throws) if `centerRiffCID`
 * can't be resolved at all -- same "never throws, empty means unavailable"
 * convention every other riffLibraryStore.ts-backed function in this
 * codebase already follows. */
export async function getAdjacentDiscoverCandidates(
  centerRiffCID: string,
  kind: DiscoverSlotKind
): Promise<AdjacentWalkResult<AdjacentDiscoverCandidate>> {
  const context = resolveRiffWithContext(centerRiffCID)
  if (!context) return { newer: [], older: [] }

  const windowOffset = Math.max(0, context.rank - ADJACENT_FETCH_PER_DIRECTION)
  const page = listRiffs(context.jamCID, {
    offset: windowOffset,
    limit: ADJACENT_FETCH_PER_DIRECTION * 2 + 1
  })
  const centerIndex = page.riffs.findIndex((r) => r.riffCID === context.matchedRiffCID)
  // Shouldn't happen (the center riff itself is always inside a window
  // built around its own rank) -- defensive, matching this codebase's own
  // "never throw, degrade to empty" convention for riff-library lookups.
  if (centerIndex === -1) return { newer: [], older: [] }

  // Captured locally (rather than read off `context` inside matchRole
  // below) so the null-check above stays in effect -- TS doesn't carry a
  // const's narrowing into a nested function closure.
  const jamCID = context.jamCID

  // Opened once, outside the per-riff matchRole closure below, not once
  // per stem -- openOwnRiffLibraryDb() caches its own connection, but
  // there's no reason to re-look-it-up on every call either.
  const ownDb = openOwnRiffLibraryDb()
  const isTraitKind = DISCOVER_TRAIT_SLOT_KINDS.includes(kind)

  async function matchRole(summary: {
    riffCID: string
  }): Promise<AdjacentDiscoverCandidate | null> {
    const resolved = resolveRiff(summary.riffCID)
    if (!resolved) return null
    for (const stem of resolved.stems) {
      const soundType = instrumentMaskToSoundType(stem.instrumentMask)

      if (!isTraitKind) {
        // Mask kinds: direct check, same shape as discoverCandidates.ts's
        // own getInstrumentMatchedStemCIDs.
        const isMatch =
          (soundType === 'drums' && kind === 'drums') ||
          (soundType === 'bass' && kind === 'bass') ||
          (soundType === 'notes' && kind === 'lead')
        if (!isMatch) continue
        return {
          stemCID: stem.stemCID,
          jamCID,
          riffCID: summary.riffCID,
          presetName: stem.presetName,
          creatorUserName: stem.creatorUserName,
          slotKind: kind,
          drumSubRole: null,
          riffBpm: resolved.bpm,
          traitValue: null,
          soundType,
          // Pure string computation (resolveStemPath's own doc comment --
          // no filesystem/db access) -- correct regardless of whether the
          // file is actually on disk YET, since downloadMissingStems below
          // ensures it will be by the time this whole function returns.
          // Direct request, 2026-09-16 ("can we take a good look at the
          // things we just added... and see if we can improve the speed"):
          // pre-resolving here means DiscoverNearbyPopover.tsx's own
          // CandidateRow no longer needs a second, redundant full-riff
          // resolve (riffLibraryResolveRiff) per candidate just to learn a
          // path this function already knew.
          path: resolveStemPath(jamCID, stem.stemCID)
        }
      }

      // Trait kinds: excluded if the mask reliably places it elsewhere
      // (drums/bass/notes already belong to the 3 mask kinds' own pool),
      // otherwise needs a cached StemFeatureCache row to have any trait
      // value to match on at all.
      if (soundType === 'drums' || soundType === 'bass' || soundType === 'notes') continue
      const featureRow = ownDb
        .prepare(`SELECT FeaturesJSON FROM StemFeatureCache WHERE StemCID = ?`)
        .get(stem.stemCID) as { FeaturesJSON: string } | undefined
      if (!featureRow) continue
      let features: StemFeatures
      try {
        features = JSON.parse(featureRow.FeaturesJSON) as StemFeatures
      } catch {
        continue
      }
      return {
        stemCID: stem.stemCID,
        jamCID,
        riffCID: summary.riffCID,
        presetName: stem.presetName,
        creatorUserName: stem.creatorUserName,
        slotKind: kind,
        drumSubRole: null,
        riffBpm: resolved.bpm,
        traitValue: features[TRAIT_FIELD[kind as keyof typeof TRAIT_FIELD]],
        soundType,
        path: resolveStemPath(jamCID, stem.stemCID)
      }
    }
    return null
  }

  const result = await walkAdjacentWindow(
    page.riffs,
    centerIndex,
    matchRole,
    ADJACENT_MATCHES_PER_DIRECTION
  )

  // Download audio only for riffs actually being returned (has a role
  // match) -- not speculatively for the whole fetched window, most of
  // which gets discarded before ever needing its audio. Matches the design
  // spec's own "Resolve concurrency" note.
  await Promise.all([...result.newer, ...result.older].map((c) => downloadMissingStems(c.riffCID)))

  return result
}

/** Recovers a stem's own riffCID/jamCID/bpm from nothing but its local file
 * path -- for a Discover slot seeded from Shelf (or anything else already
 * imported into the project), which carries a real, already-downloaded
 * `seedStem.path` but no explicit riffCID/stemCID field at all (see
 * DiscoverSlot's own `seedStem` doc comment in DiscoverPanel.tsx). Works
 * because a stem downloaded through this app's own riff-library pipeline
 * is always saved at a path whose BASENAME is literally its own StemCID
 * (resolveStemPath, riffLibraryStore.ts's own doc comment) -- the
 * information was never actually lost at import time, just not carried as
 * an explicit field on the in-project `Stem` type.
 *
 * Direct request, 2026-09-16: "i imported a batch of rifffs using the
 * import from library feature and attempting to discover the individual
 * riffs i find that i cannot use the adjacent rifffs feature. it should
 * know the adjacent rifffs still, right?" -- yes, via exactly this
 * content-addressed lookup.
 *
 * Reuses getRiffIndexForDb's own already-warm, per-db cache (the SAME one
 * prewarmDiscoverCandidateCaches populates at app startup, and every
 * normal Discover roll already reads from) -- searches every currently
 * configured jam's own db, stopping at the first match. Returns null
 * (never throws) if the stem isn't found in any known jam -- a real
 * possibility for a stem that came from somewhere other than this app's
 * own riff-library sync (a locally-recorded take, a plain folder import
 * unrelated to any Endlesss jam). */
export async function findRiffForStemPath(
  stemPath: string
): Promise<{ stemCID: string; riffCID: string; jamCID: string; bpm: number } | null> {
  const stemCID = basename(stemPath)
  const uniqueDbs = new Set(listJamsWithDb().map(({ db }) => db))
  for (const db of uniqueDbs) {
    const index = await getRiffIndexForDb(db)
    const entry = index.get(stemCID)
    if (entry)
      return { stemCID, riffCID: entry.riffCID, jamCID: entry.ownerJamCID, bpm: entry.bpmRnd }
  }
  return null
}

// src/main/discoverAdjacency.ts
import { SOUND_TYPE_TO_ARRANGE_ROLE, type ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import {
  resolveRiffWithContext,
  listRiffs,
  resolveRiff,
  downloadMissingStems
} from './riffLibraryStore'
import { openOwnRiffLibraryDb } from './riffLibrarySchema'
import { resolveStemArrangeRole } from './resolveStemArrangeRole'
import type { DiscoverCandidate } from './discoverCandidates'

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

/** Finds up to ADJACENT_MATCHES_PER_DIRECTION riffs recorded near
 * `centerRiffCID`, in the SAME jam's own iteration sequence, that have at
 * least one stem matching `role` -- see this plan's own header for the
 * architecture. `newer`/`older` are unambiguous, real chronological
 * directions (see walkAdjacentWindow's own doc comment) -- the CALLER maps
 * them to "earlier"/"later" UI labels (older -> earlier, newer -> later).
 * Returns `{ newer: [], older: [] }` (never throws) if `centerRiffCID`
 * can't be resolved at all -- same "never throws, empty means unavailable"
 * convention every other riffLibraryStore.ts-backed function in this
 * codebase already follows. */
export async function getAdjacentDiscoverCandidates(
  centerRiffCID: string,
  role: ArrangeRole
): Promise<AdjacentWalkResult<DiscoverCandidate>> {
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

  // Direct request, 2026-09-16: "the audio analysis should be able to
  // detect and differentiate drums from leads etc etc." Checks the real
  // trained classifier (resolveStemArrangeRole -- human-confirmed
  // StemCategories, else the audio-analysis-backed StemAutoCategory) for
  // each stem BEFORE falling back to the blunt instrument-mask/preset-name
  // chain, same precedence discoverCandidates.ts's own pool-building
  // already uses for the opposite lookup direction (role -> matching
  // stems). Opened once, outside the per-riff matchRole closure below, not
  // once per stem -- openOwnRiffLibraryDb() caches its own connection, but
  // there's no reason to re-look-it-up on every call either.
  const ownDb = openOwnRiffLibraryDb()

  async function matchRole(summary: { riffCID: string }): Promise<DiscoverCandidate | null> {
    const resolved = resolveRiff(summary.riffCID)
    if (!resolved) return null
    for (const stem of resolved.stems) {
      const bluntSoundType =
        instrumentMaskToSoundType(stem.instrumentMask) ??
        guessSoundTypeFromPresetName(stem.presetName)
      const stemRole = resolveStemArrangeRole(ownDb, stem.stemCID, () =>
        bluntSoundType === null ? null : SOUND_TYPE_TO_ARRANGE_ROLE[bluntSoundType]
      )
      if (stemRole !== role) continue
      return {
        stemCID: stem.stemCID,
        jamCID,
        riffCID: summary.riffCID,
        presetName: stem.presetName,
        creatorUserName: stem.creatorUserName,
        arrangeRole: role,
        drumSubRole: null,
        riffBpm: resolved.bpm
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

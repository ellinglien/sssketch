// Part 1 of the re-oned copies spec, the pure half: which stems of a project name a re-oned copy
// that could be rebuilt, and how main's outcomes change the project's riffs. Main
// (src/main/reonedRebuild.ts) checks which copies are actually missing and rebuilds them.
import type { Rifff } from './types'
import { rebuildRotationCandidates } from './reonedRotation'

export interface ReonedRepairStem {
  /** The copy the project names. */
  path: string
  sourcePath: string
  rotationSecCandidates: number[]
  /** The lineage the candidates came from, so main can add one from the stem's own LORE
   * metadata, which only main can read (reonedRebuild.ts). */
  phaseBars: number
  barLength: number
}

export interface ReonedRepairBatch {
  groupId: string
  stems: ReonedRepairStem[]
}

/** Why a copy couldn't be rebuilt. `unreachable`: its original, or the library folder, can't be
 * read (an unplugged drive, a deleted file); retried while the project is open, since it works
 * once that is back. `render-failed`: everything was there and the bake failed; not retried
 * until the project is opened again. */
export type ReonedMissingReason = 'unreachable' | 'render-failed'

export type ReonedRepairOutcome =
  | { path: string; status: 'present' }
  | { path: string; status: 'rebuilt'; bakedPath: string; durationSec: number }
  | { path: string; status: 'missing'; reason: ReonedMissingReason }

export interface ReonedMissing {
  path: string
  reason: ReonedMissingReason
}

const isCopyPath = (path: string): boolean => path.toLowerCase().endsWith('.baked.wav')

/** One batch per riff (the spec's all-or-nothing unit). Only stems on a copy that can be
 * rebuilt: a lineage to bake from. Main checks which of them are actually missing. A copy two
 * stems of one riff name is planned once, from the first: a recipe name implies one lineage, and
 * two renders for one path would leave one orphaned. */
export function planReonedRepair(
  rifffs: Readonly<Record<string, Rifff>>,
  options: { placedOnly?: boolean } = {}
): ReonedRepairBatch[] {
  const batches: ReonedRepairBatch[] = []
  for (const rifff of Object.values(rifffs)) {
    // An export renders only what is on the timeline: a shelf riff's copies can wait for an open.
    if (options.placedOnly && rifff.startBar === undefined) continue
    const stems: ReonedRepairStem[] = []
    const planned = new Set<string>()
    // An EEEDIT render plays its own file, but its recipe's source (stem.shape.source) may be a
    // copy too: EEEDIT reopens and resets from it. Not for an export, which renders what plays.
    const candidates = rifff.stems.flatMap((s) =>
      !options.placedOnly && s.shape ? [s, s.shape.source] : [s]
    )
    for (const s of candidates) {
      if (!isCopyPath(s.path) || s.phaseSourcePath === undefined || s.phaseSourcePath === s.path) {
        continue
      }
      if (planned.has(s.path)) continue
      planned.add(s.path)
      stems.push({
        path: s.path,
        sourcePath: s.phaseSourcePath,
        rotationSecCandidates: rebuildRotationCandidates(s, rifff.bpm),
        phaseBars: s.phaseBars ?? 0,
        barLength: s.barLength
      })
    }
    if (stems.length > 0) batches.push({ groupId: rifff.groupId, stems })
  }
  return batches
}

/** Applies main's outcomes to every stem naming each copy. A copy rebuilt at its own path
 * changes nothing (not even durationSec), so the project isn't marked unsaved; only a new
 * path repoints the stem. A copy is missing only if no batch found or rebuilt it: two riffs
 * can name one copy, and the second batch finds what the first rebuilt.
 *
 * Repointing is path-wide, like APPLY_BAKE: a riff whose own batch failed still has a stem on a
 * copy another riff rebuilt under a new name repointed. That is deliberate, not a partial
 * batch: the riff's other stems stay missing (silent), never on a runtime offset, so no stem
 * can play out of phase with the rest. */
export function applyReonedRepair(
  rifffs: Readonly<Record<string, Rifff>>,
  outcomes: readonly (readonly ReonedRepairOutcome[])[]
): { rifffs: Readonly<Record<string, Rifff>>; missing: ReonedMissing[] } {
  const moved = new Map<string, { bakedPath: string; durationSec: number }>()
  const found = new Set<string>()
  const missing = new Map<string, ReonedMissingReason>()
  for (const outcome of outcomes.flat()) {
    if (outcome.status === 'missing') {
      // Named missing twice (two riffs), "unreachable" wins: it is the one a retry can fix.
      if (missing.get(outcome.path) !== 'unreachable') missing.set(outcome.path, outcome.reason)
      continue
    }
    found.add(outcome.path)
    if (outcome.status === 'rebuilt' && outcome.bakedPath !== outcome.path) {
      moved.set(outcome.path, outcome)
    }
  }
  // Missing means a stem plays it: a copy only an EEEDIT recipe names is rebuilt when it can be,
  // but nothing is silent without it, so it isn't reported.
  const played = new Set<string>()
  for (const rifff of Object.values(rifffs)) for (const s of rifff.stems) played.add(s.path)
  const stillMissing = [...missing]
    .filter(([path]) => !found.has(path) && played.has(path))
    .map(([path, reason]) => ({ path, reason }))
  if (moved.size === 0) return { rifffs, missing: stillMissing }
  const next: Record<string, Rifff> = {}
  let anyTouched = false
  for (const [groupId, rifff] of Object.entries(rifffs)) {
    const touched = rifff.stems.some(
      (s) => moved.has(s.path) || (s.shape !== undefined && moved.has(s.shape.source.path))
    )
    anyTouched ||= touched
    next[groupId] = touched
      ? {
          ...rifff,
          stems: rifff.stems.map((s) => {
            const m = moved.get(s.path)
            const repointed = m ? { ...s, path: m.bakedPath, durationSec: m.durationSec } : s
            const ms = s.shape ? moved.get(s.shape.source.path) : undefined
            return ms && repointed.shape
              ? {
                  ...repointed,
                  shape: {
                    ...repointed.shape,
                    source: {
                      ...repointed.shape.source,
                      path: ms.bakedPath,
                      durationSec: ms.durationSec
                    }
                  }
                }
              : repointed
          })
        }
      : rifff
  }
  return { rifffs: anyTouched ? next : rifffs, missing: stillMissing }
}

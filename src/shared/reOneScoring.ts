import type { Rifff } from './types'

// Heuristic weights, not scientifically tuned -- see this module's own doc
// comment for the reasoning behind each term. Tune here if the picked
// default turns out to be a poor guess in practice.
const BARS_WEIGHT = 1
const REPEATS_WEIGHT = 2
const MELODIC_BONUS = 8
const DRUMS_BONUS = 4

/**
 * Scores how good a candidate default is for "re-one" (the downbeat-picking
 * step BeatPicker.tsx drives right after import) -- higher is better.
 * Favors rifffs with more musical content to visually confirm phase
 * against: a longer loop (more bars per repeat), more repeats within the
 * audio actually present (more chances to see the pattern line up
 * consistently), a melodic/bassline stem (a sustained pitch contour is
 * easier to trace phase against than pure percussion), and a drum stem (a
 * sharp, unambiguous downbeat transient to click on).
 *
 * Deliberately metadata-only -- no audio decoding, so this can run
 * instantly the moment an import batch lands, before the picker has even
 * opened. It leans on Stem.type ('notes'/'bass'/'drums'), which is a guess
 * (see LoreLibraryBrowser.tsx's instrumentMaskToSoundType/
 * guessSoundTypeFromPresetName), not a verified analysis of the actual
 * audio -- good enough for picking a reasonable *default*, since the
 * existing batch-navigation UI already lets the user override it.
 */
export function scoreRifffForReOne(rifff: Rifff): number {
  if (rifff.stems.length === 0) return 0

  const loopBars = Math.max(rifff.barLength, ...rifff.stems.map((s) => s.barLength))
  const secPerBar = rifff.bpm > 0 ? (60 / rifff.bpm) * 4 : 0
  const loopDurationSec = loopBars * secPerBar
  const longestStem = rifff.stems.reduce((a, b) => (b.durationSec > a.durationSec ? b : a))
  const repeatCount = loopDurationSec > 0 ? longestStem.durationSec / loopDurationSec : 0

  const hasMelodic = rifff.stems.some((s) => s.type === 'notes' || s.type === 'bass')
  const hasDrums = rifff.stems.some((s) => s.type === 'drums')

  return (
    loopBars * BARS_WEIGHT +
    repeatCount * REPEATS_WEIGHT +
    (hasMelodic ? MELODIC_BONUS : 0) +
    (hasDrums ? DRUMS_BONUS : 0)
  )
}

/**
 * Picks the best default rifff (by groupId) from a freshly-imported batch
 * for the re-one step -- see scoreRifffForReOne. Returns null for an empty
 * list. Ties keep the FIRST highest-scoring rifff in the given order, so
 * the result is deterministic rather than depending on iteration order of
 * some internal structure.
 */
export function pickBestRifffForReOne(rifffs: Rifff[]): string | null {
  if (rifffs.length === 0) return null
  let best = rifffs[0]
  let bestScore = scoreRifffForReOne(best)
  for (let i = 1; i < rifffs.length; i++) {
    const score = scoreRifffForReOne(rifffs[i])
    if (score > bestScore) {
      best = rifffs[i]
      bestScore = score
    }
  }
  return best.groupId
}

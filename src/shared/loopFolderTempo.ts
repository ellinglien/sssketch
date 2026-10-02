// src/shared/loopFolderTempo.ts
import { guessBpmFromFilename } from './guessBpmFromFilename'
import { LOOP_BAR_CANDIDATES, bpmForLoopBars } from './loopBarGuess'

/** Where a linked loop's tempo came from. Only 'filename' is certain; the
 * other three are guesses, and the browser shows them as such (a `~` and
 * dimmer text -- never a colour). See docs/superpowers/specs/
 * 2026-10-01-import-loop-folders-design.md, "Tempo: the guess". */
export type LoopTempoSource = 'filename' | 'folder' | 'siblings' | 'length'

export interface LoopTempoInput {
  /** The loop's filename, with or without its extension. */
  fileName: string
  /** The folder it is browsed in, after format folders (WAV/, REX2/ ...) are
   * flattened away -- the folder a person sees, not the one on disk. */
  folderName: string
  /** Every loop's filename in that same folder. May include this loop. */
  siblingFileNames: string[]
  durationSec: number
  /** The open project's tempo: the prior of last resort. */
  projectBpm: number
}

export interface LoopTempo {
  bpm: number
  bars: number
  source: LoopTempoSource
  irregular: boolean
}

/** A length further than this from every whole power-of-two bar count, at
 * the loop's tempo, is irregular: still importable, and marked. */
export const IRREGULAR_TOLERANCE = 0.03

/** The tie-break range: when two bar counts imply tempos equally near the
 * prior, the one whose tempo lies in here wins. */
export const PLAUSIBLE_LOOP_BPM_MIN = 70
export const PLAUSIBLE_LOOP_BPM_MAX = 180

/** Absorbs floating-point noise in an exact log-space tie, such as a prior
 * of 60*sqrt(2) sitting exactly between 60 and 120. */
const TIE_EPSILON = 1e-9

function isPlausibleLoopBpm(bpm: number): boolean {
  return bpm >= PLAUSIBLE_LOOP_BPM_MIN && bpm <= PLAUSIBLE_LOOP_BPM_MAX
}

/** With the tempo known: the whole power-of-two bar count nearest (in log
 * space) to the bars the length really spans, and whether it misses every
 * candidate by more than IRREGULAR_TOLERANCE. */
export function barsAtTempo(
  durationSec: number,
  bpm: number
): { bars: number; irregular: boolean } {
  const rawBars = (durationSec * bpm) / 240
  let bars = LOOP_BAR_CANDIDATES[0]
  let bestScore = Infinity
  for (const candidate of LOOP_BAR_CANDIDATES) {
    const score = Math.abs(Math.log(rawBars / candidate))
    if (score < bestScore) {
      bestScore = score
      bars = candidate
    }
  }
  return { bars, irregular: Math.abs(rawBars / bars - 1) > IRREGULAR_TOLERANCE }
}

/** With only a prior: the bar count whose implied tempo is log-nearest the
 * prior. This is loopBarGuess.ts's guessLoopBars plus one rule: an exact
 * tie goes to the candidate whose tempo is inside 70-180. guessLoopBars
 * itself is left alone -- the Shelf's import prompt depends on it as is. */
export function pickBarsNearTempo(durationSec: number, priorBpm: number): number {
  let bars = LOOP_BAR_CANDIDATES[0]
  let bestScore = Infinity
  for (const candidate of LOOP_BAR_CANDIDATES) {
    const implied = bpmForLoopBars(durationSec, candidate)
    const score = Math.abs(Math.log(implied / priorBpm))
    const tied = Math.abs(score - bestScore) <= TIE_EPSILON
    const better = tied
      ? isPlausibleLoopBpm(implied) && !isPlausibleLoopBpm(bpmForLoopBars(durationSec, bars))
      : score < bestScore
    if (better) {
      bestScore = score
      bars = candidate
    }
  }
  return bars
}

/** The tempo the most names carry, through the same filename parser. A tie
 * goes to the lower tempo, so the answer never depends on listing order. */
export function mostCommonFilenameTempo(fileNames: string[]): number | null {
  const counts = new Map<number, number>()
  for (const name of fileNames) {
    const bpm = guessBpmFromFilename(name)
    if (bpm !== null) counts.set(bpm, (counts.get(bpm) ?? 0) + 1)
  }
  let best: number | null = null
  let bestCount = 0
  for (const [bpm, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && bpm < best)) {
      best = bpm
      bestCount = count
    }
  }
  return best
}

/** The cascade, in the spec's order:
 *
 * 1. The filename (certain). The bar count is then the nearest whole
 *    power of two the length spans at that tempo, irregular past 3%.
 * 2. The folder name's tempo, else the siblings' most common tempo -- a
 *    PRIOR, not the answer.
 * 3. The length: the bar count whose implied tempo is nearest that prior
 *    (or the project tempo when step 2 found nothing), and the tempo is the
 *    one that bar count implies. A guessed tempo therefore always loops
 *    whole, so it is never irregular. `source` records where the prior
 *    came from. */
export function loopTempo(input: LoopTempoInput): LoopTempo {
  const fromName = guessBpmFromFilename(input.fileName)
  if (fromName !== null) {
    const { bars, irregular } = barsAtTempo(input.durationSec, fromName)
    return { bpm: fromName, bars, source: 'filename', irregular }
  }

  const fromFolder = guessBpmFromFilename(input.folderName)
  const fromSiblings = fromFolder === null ? mostCommonFilenameTempo(input.siblingFileNames) : null
  const prior = fromFolder ?? fromSiblings ?? input.projectBpm
  const source: LoopTempoSource =
    fromFolder !== null ? 'folder' : fromSiblings !== null ? 'siblings' : 'length'

  const bars = pickBarsNearTempo(input.durationSec, prior)
  return { bpm: bpmForLoopBars(input.durationSec, bars), bars, source, irregular: false }
}

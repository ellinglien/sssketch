// src/shared/loopBarGuess.ts

/** Plausible bar counts for a dropped external loop file (drum breaks,
 * sample-pack loops) -- deliberately just powers of two, matching how loop
 * packs are almost universally authored. Exported so callers (the import
 * prompt's own default-guess display) show the same candidate set this
 * module reasons over, rather than a second, possibly-drifting copy. */
export const LOOP_BAR_CANDIDATES = [1, 2, 4, 8, 16, 32]

/** The native bpm a loop of `barCount` bars would have to be at in order to
 * span exactly `durationSec` -- the inverse of buildRifff.ts's own
 * `barsForDuration` (bpm known, solve for bars) used for Endlesss stems,
 * rearranged to solve for bpm instead: durationSec = barCount * (240/bpm)
 * => bpm = barCount * 240 / durationSec. Real 2026-09-16 report: "it
 * doesn't want to loop... it is out of time although it is a perfect loop"
 * -- a dragged-in external WAV has no filename-embedded bpm the way an
 * Endlesss export does, and this codebase has no audio-content bpm/beat
 * detection (confirmed: nothing in src/shared or src/renderer/src/audio
 * does onset/tempo analysis). Asking the user for the one thing they
 * usually DO know at a glance -- how many bars the loop is -- lets this
 * exact same durationSec/bpm relationship back-solve a native bpm, with no
 * new audio analysis required. */
export function bpmForLoopBars(durationSec: number, barCount: number): number {
  return (barCount * 240) / durationSec
}

/** Best-guess default bar count for a dropped external loop, shown as a
 * pre-filled (but always user-correctable) suggestion rather than a silent
 * final answer -- see the "Ask every time" decision this was built for
 * (2026-09-16). Picks whichever LOOP_BAR_CANDIDATES entry implies a native
 * bpm closest to the CURRENT project bpm, comparing in log-space so a
 * candidate implying exactly double the project bpm and one implying
 * exactly half are equally plausible (raw bpm difference would wrongly
 * favor whichever numeric value happens to be closer, biasing toward
 * higher bar counts at low project tempos). Not a real tempo estimate --
 * just the least-surprising starting point for a project already at a
 * roughly musical tempo, always overridable in the prompt itself. */
export function guessLoopBars(durationSec: number, projectBpm: number): number {
  let best = LOOP_BAR_CANDIDATES[0]
  let bestScore = Infinity
  for (const barCount of LOOP_BAR_CANDIDATES) {
    const impliedBpm = bpmForLoopBars(durationSec, barCount)
    const score = Math.abs(Math.log(impliedBpm / projectBpm))
    if (score < bestScore) {
      bestScore = score
      best = barCount
    }
  }
  return best
}

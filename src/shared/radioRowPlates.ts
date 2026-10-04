// src/shared/radioRowPlates.ts -- what the radio view draws ON a row's waveform (spec
// 2026-10-03-sssketch-radio-view-design section 1.2): the web radio's full-mode plates (ell.ing/radio
// src/ui/full.ts's row render, as of 22de927), lifted so the desktop draws the same words from the
// same readout. Pure. The web keeps its own copy for now (scope A changes only the desktop).
//
//   info  top left: the readout's label, cut with an ellipsis, then its tail kept whole -- the age
//         and the role words after it (`3 laps · hook · back in 16 bars`). The web's tail starts
//         with a no-break space, since a flex item's leading space would collapse.
//   cue   bottom right: the gesture flash (its word and opacity over its bar) and `next · ...`.
//         Hidden when it has neither.
//   fold  top right: fold mode's `7 / 16` on a folded row; the phase dot under it is the
//         panel's (data-fold-dot), never this module's.
import { radioFlashOpacity, type RadioReadoutRow } from './radioReadout'

export interface RadioRowPlates {
  /** Null when the row has neither a label nor an age. */
  info: { label: string; tail: string } | null
  /** Null when the row has neither a flash nor a `next`. */
  cue: { flash: { word: string; opacity: number } | null; next: string | null } | null
  /** Null on a row playing straight, and with fold mode off. */
  fold: string | null
}

export const NO_RADIO_ROW_PLATES: RadioRowPlates = { info: null, cue: null, fold: null }

/** The plates for one row: its readout (null while radio is off) and fold's label for it (null
 * unless it is folded). */
export function radioRowPlates(
  row: RadioReadoutRow | null,
  foldLabel: string | null
): RadioRowPlates {
  const label = row?.label ?? ''
  const age = row?.age ?? ''
  const tail = age === '' ? '' : label === '' ? age : `\u00a0· ${age}`
  const flash =
    row?.flash != null ? { word: row.flash.word, opacity: radioFlashOpacity(row.flash.t) } : null
  const next = row?.nextLabel != null && row.nextLabel !== '' ? row.nextLabel : null
  return {
    info: label === '' && tail === '' ? null : { label, tail },
    cue: flash === null && next === null ? null : { flash, next },
    fold: foldLabel !== null && foldLabel !== '' ? foldLabel : null
  }
}

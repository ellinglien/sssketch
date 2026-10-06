// src/renderer/src/components/radioIntensityGlue.ts
//
// The Discover panel's pure reads of the intensity arc (@shared/radioIntensityArc; spec
// docs/superpowers/specs/2026-10-05-radio-intensity-arc-design.md), kept beside the panel so they
// are tested: which rows the arc holds, what the readout says next, which rows flash, whether an
// add held for a phrase start goes, whether the throws aim at the drop. The panel
// (DiscoverPanel.tsx) does the rest from its refs.

import {
  RADIO_BREAKDOWN_WORD,
  RADIO_BUILD_WORD,
  RADIO_DROP_WORD,
  type RadioIntensityArc
} from '@shared/radioIntensityArc'
import type { RadioReadoutInput } from '@shared/radioReadout'

type Next = RadioReadoutInput['nextChange']

/** Every row the arc holds: its rests, and its decided event's (a breakdown's rests, a drop's
 * returning and renewed rows), once each. */
export function intensityRowsHeld(arc: RadioIntensityArc): string[] {
  const d = arc.decided
  const decided =
    d?.event === 'breakdown' ? d.rest : d?.event === 'drop' ? [...d.returning, ...d.renew] : []
  return [...new Set([...arc.rests, ...decided])]
}

/** The rows a decided breakdown rests at the coming wrap. */
export function intensityRestsDecided(arc: RadioIntensityArc): ReadonlySet<string> {
  return new Set(arc.decided?.event === 'breakdown' ? arc.decided.rest : [])
}

/**
 * The readout's `next` with the arc's event at the coming top (spec 9), `loopBars - pos` away:
 *   - a breakdown: its first rest still queued (`arcEntryOf` is the arc's landing queued on a
 *     row), the others riding it -- `next: row 2 +1 rests`, every one `next · rests`;
 *   - a drop: `next: drop` (the readout says it once: not while the breakdown counts down to it),
 *     named on a row coming back when one is queued.
 * Whatever lands sooner keeps `next`; at the top the arc's event is named. Otherwise `next`.
 */
export function intensityNextChange(
  arc: RadioIntensityArc,
  next: Next,
  arcEntryOf: (rowId: string) => 'rest' | 'return' | undefined,
  pos: number,
  loopBars: number
): Next {
  const d = arc.decided
  if (d === null || !(loopBars > 0)) return next
  const toWrap = Math.max(0, loopBars - pos)
  if (next !== null && next.barsAway !== null && next.barsAway < toWrap - 1e-6) return next
  if (d.event === 'breakdown') {
    const rests = d.rest.filter((id) => arcEntryOf(id) === 'rest')
    if (rests.length === 0) return next
    return {
      rowId: rests[0],
      kind: null,
      barsAway: toWrap,
      rests: true,
      ...(rests.length > 1 && { with: rests.slice(1) })
    }
  }
  if (d.event === 'drop') {
    const back = d.returning.find((id) => arcEntryOf(id) === 'return')
    return { rowId: back ?? '', kind: null, barsAway: toWrap, drop: true }
  }
  return next
}

/** The rows the arc's event at the coming top flashes, and the word: `breakdown` on the rests
 * queued, `drop` on the rows coming back (every heard row for a quick drop), `build` on every row
 * at a pressed build's top. Null for anything else (the clock's own cycle, an add). */
export function intensityFlashRows(
  arc: RadioIntensityArc,
  o: {
    arcEntryOf: (rowId: string) => 'rest' | 'return' | undefined
    heard: readonly string[]
    rows: readonly string[]
  }
): { ids: string[]; word: string } | null {
  const d = arc.decided
  if (d === null) return null
  switch (d.event) {
    case 'breakdown':
      return { ids: d.rest.filter((id) => o.arcEntryOf(id) === 'rest'), word: RADIO_BREAKDOWN_WORD }
    case 'drop':
      return { ids: d.quick === true ? [...o.heard] : [...d.returning], word: RADIO_DROP_WORD }
    case 'cycle':
      return d.forced === true ? { ids: [...o.rows], word: RADIO_BUILD_WORD } : null
    case 'add':
      return null
  }
}

/** An add held for a phrase start (picked and warmed a lap early) that its decide wrap did not
 * take goes -- a silent row with nothing to join -- unless the build goes on with nothing
 * decided or waiting, when a later phrase start may take it. Only at a decide wrap (`arc` the
 * machine after that wrap's step). */
export function intensityHeldAddGoes(
  arc: RadioIntensityArc,
  at: { decideWrap: boolean; tookAdd: boolean }
): boolean {
  if (!at.decideWrap || at.tookAdd) return false
  return !(arc.phase === 'build' && arc.decided === null && arc.forced === null)
}

/** The throws aim at the drop (spec 5.5): in the breakdown's last phrase, or with the drop
 * decided for the coming top. */
export function intensityThrowDropDue(arc: RadioIntensityArc): boolean {
  if (!arc.begun) return false
  return arc.decided?.event === 'drop' || (arc.phase === 'breakdown' && arc.done + 1 >= arc.phrases)
}

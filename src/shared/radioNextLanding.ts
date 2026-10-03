// src/shared/radioNextLanding.ts
//
// sssketch's Discover readout `next`: whatever lands first, read the way the panel's radio clock
// lands it -- the density arc taking a row out (stepArcExit: silent from its drop-out, partway
// through a lap) or bringing one in (the manual queue, at a loop top), a course change (the whole
// bed at the next top), radio's own change (held for its bar or the top, or armed with the wait
// radioBarsUntilChange counts, phrase grid included), or a manual change queued for the top. The
// web radio's twin is `coming` in ell.ing/radio's step.ts; the two runtimes land things
// differently (here an arc step and radio's change share a top, there the arc takes it), so each
// reads its own. Pure: the panel fills the input from its refs.

import type { DensityLeg } from './radioDensity'
import type { RadioReadoutInput } from './radioReadout'
import type { RadioTransitionKind } from './radioTransition'

export interface RadioNextLandingInput {
  pos: number
  loopBars: number
  /** A course change armed: the rows it turns over at the next top. Radio's own change waits
   * behind it (the course change re-arms radio once it lands). */
  course: readonly string[] | null
  /** Radio's held change: how it arrives, and the bar of this lap it lands on (undefined: the
   * top). */
  led: {
    rowId: string
    kind: RadioTransitionKind
    atBars?: number
    /** The pace slider's companions riding it (radioReadout's `with`). */
    with?: readonly string[]
  } | null
  /** Radio's armed pick and the bars until it comes due (radioBarsUntilChange), null unknown. */
  pending: { rowId: string; barsUntil: number | null; with?: readonly string[] } | null
  /** Changes queued for the next top, the arc's joining row among them: how each arrives, and
   * whether its stem is warm (a cold one waits for a later top, bar unknown). */
  manual: readonly { rowId: string; kind: RadioTransitionKind | null; ready: boolean }[]
  /** The density arc, null when it is off. */
  arc: {
    /** The row it is bringing in (picking, then in `manual`). */
    adding: { rowId: string } | null
    /** The row it is taking out: waiting for its drop-out, or fading (`thisLap`: in the lap
     * playing); `heldBack` (arcExitHeldBack) and whether the row is heard at all (one that is not
     * goes on the next tick). */
    exit: {
      rowId: string
      phase: 'waiting' | 'fading'
      thisLap: boolean
      heldBack: boolean
      heard: boolean
    } | null
    /** The exit's drop-out length (ARC_EXIT_BEATS). */
    exitBeats: number
    leg: DensityLeg | null
    count: number
    /** nextArcKind found a kind to add. */
    canAdd: boolean
    /** arcRemovalCandidate: the row a thinning step would take out now. */
    removal: string | null
  } | null
}

type Next = NonNullable<RadioReadoutInput['nextChange']>

const EPS = 1e-6

/** How far into the lap stepArcExit stops arming a waiting exit's drop-out for that lap. */
const EXIT_ARM_MARGIN = 0.25

export function radioNextLanding(input: RadioNextLandingInput): Next | null {
  const { loopBars } = input
  if (!(loopBars > 0) || !Number.isFinite(input.pos)) return null
  const pos = Math.min(loopBars, Math.max(0, input.pos))
  const toWrap = loopBars - pos
  // In the order a tie is named: the arc's step, then a course change, radio, the manual queue.
  const candidates: Next[] = []

  const arc = input.arc
  if (arc !== null) {
    const dropBars = Math.min(arc.exitBeats / 4, loopBars / 2)
    const leaveAt = loopBars - dropBars
    if (arc.exit !== null) {
      const e = arc.exit
      let bars: number
      if (!e.heard) bars = 0
      else if (e.phase === 'fading' && e.thisLap) bars = Math.max(0, leaveAt - pos)
      // armed this lap if nothing holds it back and its drop is still ahead, else the next lap's
      else if (!e.heldBack && pos < leaveAt - EXIT_ARM_MARGIN) bars = leaveAt - pos
      else bars = toWrap + leaveAt
      candidates.push({ rowId: e.rowId, kind: null, barsAway: bars, leaving: true })
    }
    if (arc.adding !== null) {
      const queued = input.manual.find((m) => m.rowId === arc.adding!.rowId)
      candidates.push({
        rowId: arc.adding.rowId,
        kind: queued?.kind ?? null,
        barsAway: queued?.ready ? toWrap : null,
        adding: true
      })
    }
    // Foreseen: no step on its way, so the leg takes its next at the top its bars complete
    // (advanceDensityLeg adds a lap's bars, then compares; wrap 0 ends this lap) -- unless it
    // turns round there instead. An add appears then and joins at the top after; a removal arms
    // its drop-out in the lap that top starts.
    if (arc.adding === null && arc.exit === null && arc.leg !== null) {
      const leg = arc.leg
      const m = Math.max(0, Math.ceil((leg.stepBars - leg.bars) / loopBars - 1e-9) - 1)
      if (leg.phase === 'growing' && arc.count < leg.target && arc.canAdd) {
        candidates.push({
          rowId: '',
          kind: null,
          barsAway: toWrap + (m + 1) * loopBars,
          adding: true
        })
      } else if (leg.phase === 'thinning' && arc.count > leg.target && arc.removal !== null) {
        candidates.push({
          rowId: arc.removal,
          kind: null,
          barsAway: toWrap + m * loopBars + leaveAt,
          leaving: true
        })
      }
    }
  }

  if (input.course !== null && input.course.length > 0) {
    candidates.push({
      rowId: input.course[0],
      kind: 'cut',
      barsAway: toWrap,
      course: input.course
    })
  } else if (input.led !== null) {
    const at = input.led.atBars ?? loopBars
    candidates.push({
      rowId: input.led.rowId,
      kind: input.led.kind,
      barsAway: Math.max(0, at - pos),
      ...(input.led.with && input.led.with.length > 0 && { with: input.led.with })
    })
  } else if (input.pending !== null) {
    const b = input.pending.barsUntil
    candidates.push({
      rowId: input.pending.rowId,
      kind: null,
      barsAway: b !== null && Number.isFinite(b) ? Math.max(0, b) : null,
      ...(input.pending.with && input.pending.with.length > 0 && { with: input.pending.with })
    })
  }

  for (const m of input.manual) {
    if (arc?.adding?.rowId === m.rowId) continue
    candidates.push({ rowId: m.rowId, kind: m.kind, barsAway: m.ready ? toWrap : null })
  }

  let best: Next | null = null
  for (const c of candidates) {
    if (c.barsAway === null) continue
    if (best === null || c.barsAway < best.barsAway! - EPS) best = c
  }
  return best ?? candidates[0] ?? null
}

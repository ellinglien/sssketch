// src/shared/radioSchedule.ts
//
// Radio mode's whole schedule -- docs/superpowers/specs/2026-09-26-radio-
// mode-design.md. Radio is Discover with a clock: every so often one
// unlocked layer rerolls on its own. Everything here is pure and injected
// with its own randomness, both so it can be tested deterministically and
// because this codebase's react-hooks/purity lint rule rejects a bare
// Math.random() inside a component-scoped function (see DiscoverPanel's
// own freshSlotId/pickRandomKind, which live at module scope for the same
// reason).

/** The three speeds radio can run at. Literal values double as their own
 * UI text (the same convention DISCOVER_SLOT_KIND_OPTIONS uses for its
 * non-camelCase kinds), so there is no label table. */
export type RadioPace = 'slow' | 'mid' | 'fast'

export const RADIO_PACE_OPTIONS: RadioPace[] = ['slow', 'mid', 'fast']

export const DEFAULT_RADIO_PACE: RadioPace = 'mid'

/** Each pace is a WINDOW of bars, not a number. Exactly every N bars reads
 * as mechanical; a change landing somewhere in a range feels like
 * something is making decisions (spec 3.3).
 *
 * The 2:1 ratio is the decision; the absolute numbers are taste. 2:1 is
 * wide enough that you cannot count along with it and narrow enough that
 * it never feels stalled at the top or frantic at the bottom. A 4:1 range
 * would give a change at 6 bars and then nothing for 24, which reads as
 * broken rather than loose.
 *
 * At 120bpm in 4/4 (2s a bar): slow = 48-96s, mid = 24-48s, fast =
 * 12-24s. */
export const RADIO_PACE_BARS: Record<RadioPace, { min: number; max: number }> = {
  slow: { min: 24, max: 48 },
  mid: { min: 12, max: 24 },
  fast: { min: 6, max: 12 }
}

/** Anything unrecognised (an older settings file, a hand-edited JSON)
 * becomes the default rather than throwing -- same shape as
 * normalizeTraitMatchBar (traitBar.ts). */
export function normalizeRadioPace(value: unknown): RadioPace {
  return RADIO_PACE_OPTIONS.includes(value as RadioPace) ? (value as RadioPace) : DEFAULT_RADIO_PACE
}

/** A fresh whole number of bars to wait, drawn uniformly across the pace's
 * own window (both ends inclusive). Drawn again after every change, which
 * is what stops radio being a metronome. */
export function nextRadioIntervalBars(pace: RadioPace, random: () => number = Math.random): number {
  const { min, max } = RADIO_PACE_BARS[pace]
  const span = max - min + 1
  const offset = Math.min(span - 1, Math.floor(random() * span))
  return min + offset
}

/** Radio's own sense of time. Fed ONLY by the engine's existing ~30Hz
 * position-update stream (IpcServer.cpp's 33ms kPositionTimerId ->
 * main's subscribeToPositionUpdates -> preload's onEnginePositionUpdate ->
 * StoreContext's SET_POS -> DiscoverPanel's usePos()). There is no
 * setInterval anywhere in radio, on purpose: the engine stops its timer on
 * "pause", so this clock stops with the transport and resumes exactly
 * where it was, for free. */
export interface RadioClock {
  /** Bars of real playback since the last change landed. Fractional. */
  barsElapsed: number
  /** The freshly-drawn target for THIS interval (nextRadioIntervalBars). */
  intervalBars: number
  /** The previous tick's position, so a wrap can be spotted as a decrease
   * -- the engine emits no loop-wrap event of any kind. */
  lastPos: number
}

export function createRadioClock(intervalBars: number, startPos = 0): RadioClock {
  return { barsElapsed: 0, intervalBars, lastPos: startPos }
}

export interface RadioClockStep {
  clock: RadioClock
  /** The loop restarted between the previous tick and this one. */
  wrapped: boolean
  /** Commit a change NOW: the interval has elapsed AND we are at a loop
   * boundary. Quantising to the wrap is deliberate (spec 2.2) -- a change
   * dropped at bar 7 of an 8-bar loop is a splice; a change dropped at the
   * wrap is a new section. The cost is that the effective interval is
   * ceil(intervalBars / loopBars) * loopBars, which for a long loop and a
   * short pace can collapse the pace's whole window onto one value. */
  due: boolean
}

/** One position tick. `loopBars` is the preview loop's own length --
 * DiscoverPanel's `maxBarLength`, which is exactly what went to the engine
 * as loopLengthBars, so the wrap this spots and the wrap the engine
 * performed are the same event. */
export function advanceRadioClock(
  clock: RadioClock,
  pos: number,
  loopBars: number
): RadioClockStep {
  if (!(loopBars > 0) || !Number.isFinite(pos)) {
    return { clock, wrapped: false, due: false }
  }
  const wrapped = pos < clock.lastPos
  // Across a wrap, count the tail of the old pass as well as the head of
  // the new one -- otherwise every wrap silently loses up to a full bar.
  const delta = wrapped ? loopBars - clock.lastPos + pos : pos - clock.lastPos
  const barsElapsed = clock.barsElapsed + Math.max(0, delta)
  return {
    clock: { ...clock, barsElapsed, lastPos: pos },
    wrapped,
    due: wrapped && barsElapsed >= clock.intervalBars
  }
}

/** Which single layer turns over next.
 *
 * ONE at a time is the whole point (spec 3.1): everything changing
 * together is just a new loop on a timer, while one at a time lets a bed
 * you recognise evolve under you.
 *
 * `eligible` is decided by the caller -- unlocked, audible, already
 * holding a candidate, not mid-reroll. The only rule here is "not the same
 * one twice running", which is enough variety without a rotation nobody
 * asked for (a least-recently-changed order is an explicit "not now").
 * Returns null only for an empty list, which is radio idling rather than
 * an error: everything locked is a legitimate state and radio simply
 * retries at the next boundary. */
export function pickRadioSlotId(
  eligible: readonly string[],
  lastChangedId: string | null,
  random: () => number = Math.random
): string | null {
  if (eligible.length === 0) return null
  const pool = eligible.length > 1 ? eligible.filter((id) => id !== lastChangedId) : eligible
  const choices = pool.length > 0 ? pool : eligible
  const index = Math.min(choices.length - 1, Math.floor(random() * choices.length))
  return choices[index]
}

/** One layer's state, as far as radio's eligibility cares. */
export interface RadioSlotEligibility {
  locked: boolean
  /** In the preview mix -- a muted layer is not part of what he is
   * listening to, so changing it would be a change he cannot hear. */
  audible: boolean
  hasCandidate: boolean
  /** A slot seeded from a rifff or the shelf carries a resolved stem and
   * NO candidate until it is first rerolled. */
  hasSeedStem: boolean
  rerolling: boolean
}

/** Whether radio may turn this layer over.
 *
 * Live report, 2026-09-28: "if i start radio with stems already there..
 * it seems to not transition". Radio's own filter tested
 * `s.candidate !== null`, which is false for every slot seeded from a
 * rifff or the shelf and never since rerolled -- so starting radio on a
 * loop he had already built made every layer ineligible and radio idled
 * forever, doing nothing, with no way to tell it apart from a long
 * interval.
 *
 * A seedStem IS a fully resolved stem; it is simply held in a different
 * field. resolveDiscoverRifff hit this exact bug on 2026-09-16 (see its
 * own comment) and fixed it the same way. Living here, in shared, rather
 * than as a filter inline in the component, is so the next thing that
 * needs to ask "may radio touch this layer" cannot get a third answer. */
export function isRadioEligibleSlot(slot: RadioSlotEligibility): boolean {
  if (slot.locked) return false
  if (!slot.audible) return false
  if (slot.rerolling) return false
  return slot.hasCandidate || slot.hasSeedStem
}

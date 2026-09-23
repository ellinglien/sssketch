/**
 * Phase three, as plain data: which moves a BOUNDARY BETWEEN TWO NAMED
 * SECTIONS justifies, how long each one is, and what shape it writes.
 *
 * THE RULE THIS FILE EXISTS TO ENCODE (spec, "What he is allowed to say"):
 * **every offer here is justified by a name the user typed.** A riser is
 * offered at a build into a drop because the next section is literally
 * called "drop" -- a fact about the arrangement, not an opinion about the
 * audio. Nothing below reads a stem, a waveform, a trait or a gain. The
 * only numbers involved are the bar lengths the user set with phase two's
 * own nudge buttons, and they decide how LONG an offer is, never WHETHER it
 * is offered.
 *
 * The second rule, and the reason this phase's toggles start OFF: phase two
 * puts everything on and lets you subtract, because a section is the whole
 * loop until you say otherwise. Phase three ADDS material to the
 * arrangement, so the default has to be the other way round -- writing a
 * sweep onto somebody's clips before they asked is an edit they then have
 * to notice and undo, which is exactly what phase two's rule exists to
 * prevent.
 *
 * Every shape here is built out of automationEdit.ts's OWN primitives, not
 * out of new geometry: a swell and a fade are `applyEdgeFade` (the function
 * the lane's edge grabbers call) and a sweep is `applyStroke` over
 * `rampStroke` (the function the lane's shift-drag calls). So what lands is
 * indistinguishable from a curve drawn by hand, and the grabbers can pick
 * it straight back up -- which is the spec's "everything he makes is
 * ordinary, editable material" written into the implementation rather than
 * promised in a comment.
 */

import { applyEdgeFade, applyStroke, rampStroke } from './automationEdit'
import type { CoachSection, CoachSectionType } from './coachSections'
import { MIN_RISER_LENGTH_BARS } from './riser'
import type { AutomationParam, AutomationPoint } from './toolkit'

/** The four moves the tension pass can make. */
export type CoachTensionKind = 'filter-sweep' | 'swell' | 'fade' | 'riser'

/** What the phase-three panel's own buttons do, as data rather than as
 * callbacks -- the same shape CoachSectionOp uses, so a step row can list
 * them under "stuck?" and the bubble's "do it for me" can run one without
 * src/shared/ knowing React exists. */
export type CoachTensionOp = 'add-all' | 'listen'

/** The balance step's one move. Its own union rather than a bare string so
 * the switch in App.tsx stays exhaustive when a second one is added. */
export type CoachTransportOp = 'play-from-top'

/** Which of the export menu's three entries the flow is asking for. The
 * names match what the menu itself says. */
export type CoachExportOp = 'mix' | 'stems' | 'project'

export interface CoachTensionDef {
  id: CoachTensionKind
  /** The toggle's own label. Lowercase, like all UI copy in this app. */
  label: string
  /** The one line under it, saying exactly what will be written. Flat and
   * unrotated, like COACH_SUGGESTED_DROP_HINT: it is a label on a control,
   * not something sssketchy says. */
  note: string
  /** Which drawable parameter this writes, or null for the riser -- which
   * is a placed clip, not an envelope. */
  param: AutomationParam | null
}

const COACH_TENSION_BY_ID: Record<CoachTensionKind, CoachTensionDef> = {
  'filter-sweep': {
    id: 'filter-sweep',
    label: 'sweep the filter open',
    note: 'a filter curve across this section, closed at its start, wide open at the join',
    param: 'filterCutoff'
  },
  swell: {
    id: 'swell',
    label: 'swell into it',
    note: 'a volume curve across this section, up from silence to its own level',
    param: 'volume'
  },
  fade: {
    id: 'fade',
    label: 'fade out of it',
    note: 'a volume curve across this section, down to silence at the join',
    param: 'volume'
  },
  riser: {
    id: 'riser',
    label: 'put a riser in',
    note: 'one noise riser across this section, on a row of its own',
    param: null
  }
}

/** In the order the panel renders them. */
export const COACH_TENSION_KINDS: readonly CoachTensionKind[] = [
  'filter-sweep',
  'swell',
  'fade',
  'riser'
]

/** Total by construction -- CoachTensionKind is a closed union over this
 * record's own keys, so there is no "unknown kind" branch to get wrong. */
export function coachTensionDef(kind: CoachTensionKind): CoachTensionDef {
  return COACH_TENSION_BY_ID[kind]
}

export function isCoachTensionKind(value: unknown): value is CoachTensionKind {
  return typeof value === 'string' && value in COACH_TENSION_BY_ID
}

/** Where a swept filter starts: 0.3 is roughly 160Hz on the engine's own log
 * map (ChannelFilter.h), and it is deliberately the same number a freshly
 * dropped riser starts at (RISER_DEFAULTS.startCutoffValue) -- the two are
 * the same gesture in two media, and having them start at the same place is
 * what makes a sweep and a riser at one boundary sound like one move. */
export const COACH_SWEEP_START_VALUE = 0.3

/** Where it ends: 1 is a lowpass's own neutral end (neutralCutoff), so the
 * clip is doing nothing at all by the time the join arrives. */
export const COACH_SWEEP_END_VALUE = 1

/**
 * WHAT A PAIR OF SECTION NAMES ASKS FOR -- the whole of this phase's
 * musical content, and the only place in it that decides anything.
 *
 * Read straight off the spec: "filter sweep/swell into drops, fade into
 * breakdowns", plus "at every build->drop boundary sssketchy offers to drop
 * a riser".
 *
 * Note what it does NOT do: it never looks at the sections' stems, lengths,
 * roles or gains. Both arguments are names the user chose from five
 * options. That is what makes every offer true by construction -- "there is
 * a drop after this" is something the app can read, "this track needs a
 * riser" is not.
 */
export function tensionOffersAt(
  from: CoachSectionType,
  into: CoachSectionType
): readonly CoachTensionKind[] {
  if (into === 'drop') {
    // The riser is the one offer that reads BOTH names: the spec names the
    // build->drop pair specifically, and it is the least ambiguous
    // suggestion in the whole method.
    return from === 'build' ? ['filter-sweep', 'swell', 'riser'] : ['filter-sweep', 'swell']
  }
  if (into === 'breakdown') return ['fade']
  return []
}

/** One join between two placed sections, with everything the panel needs to
 * print it and everything the write path needs to build it. */
export interface CoachSectionBoundary {
  /** Index of the OUTGOING section in CoachState.sections -- which is also
   * the section every offer here is WRITTEN ONTO. */
  index: number
  from: CoachSectionType
  into: CoachSectionType
  /** The names the user actually gave them. */
  fromName: string
  intoName: string
  /** The absolute bar the two meet on. */
  bar: number
  /** "the bars leading in" (spec) -- the outgoing section's own length, a
   * number the user set with phase two's nudge buttons. Every offer at this
   * boundary spans exactly this. */
  leadBars: number
  offers: readonly CoachTensionKind[]
}

/**
 * Every join the section NAMES ask something of, in timeline order.
 *
 * Boundaries with nothing on offer are left out rather than listed empty: a
 * row saying "nothing here" at every intro->build join would be four lines
 * of noise around the one line that matters, and the step's own copy
 * already covers the case where there are none at all.
 */
export function coachSectionBoundaries(sections: readonly CoachSection[]): CoachSectionBoundary[] {
  const boundaries: CoachSectionBoundary[] = []
  for (let index = 0; index < sections.length - 1; index += 1) {
    const from = sections[index]
    const into = sections[index + 1]
    const offers = tensionOffersAt(from.type, into.type)
    if (offers.length === 0) continue
    boundaries.push({
      index,
      from: from.type,
      into: into.type,
      fromName: from.name,
      intoName: into.name,
      bar: from.startBar + from.bars,
      leadBars: from.bars,
      offers
    })
  }
  return boundaries
}

/**
 * The curve one offer writes onto one clip, or null when this offer is not
 * a curve (the riser) or there is nowhere to put one.
 *
 * `clipBars` is the clip's REAL current length, which the caller measures
 * off the live state -- never assumed equal to the section's own bars,
 * because the user may have resized or cropped the clip since phase two
 * placed it. The lead is clamped to it, so nothing can ever land past the
 * audio it automates (toolkit spec 2b).
 *
 * `existing` is whatever the clip already has on that parameter. Both
 * primitives below splice rather than replace, so a hand-drawn point
 * outside the lead survives untouched.
 */
export function tensionCurveFor(
  kind: CoachTensionKind,
  existing: readonly AutomationPoint[],
  opts: { leadBars: number; clipBars: number }
): AutomationPoint[] | null {
  const clipBars = Number.isFinite(opts.clipBars) ? Math.max(0, opts.clipBars) : 0
  const rawLead = Number.isFinite(opts.leadBars) ? Math.max(0, opts.leadBars) : 0
  const leadBars = Math.min(clipBars, rawLead)
  if (leadBars <= 0) return null
  const points = [...existing]
  // The lane's own edge grabbers, called directly: a swell IS a fade in and
  // a fade IS a fade out, so there is no second shape to invent and the
  // grabber can pick either straight back up afterwards.
  if (kind === 'swell') {
    return applyEdgeFade(points, { edge: 'start', bars: leadBars, lengthBars: clipBars })
  }
  if (kind === 'fade') {
    return applyEdgeFade(points, { edge: 'end', bars: leadBars, lengthBars: clipBars })
  }
  if (kind === 'filter-sweep') {
    // The lane's own shift-drag, called directly.
    return applyStroke(
      points,
      rampStroke(clipBars - leadBars, COACH_SWEEP_START_VALUE, clipBars, COACH_SWEEP_END_VALUE)
    )
  }
  return null
}

/**
 * Where a riser goes: it ENDS on the join and is as long as the bars
 * leading in (spec, "pre-sized to the bars leading in").
 *
 * Sized off the section rather than off RISER_DEFAULTS.lengthBars
 * deliberately. A fixed four bars would be a taste judgement about somebody
 * else's build; the section's own length is a number they typed. It is an
 * ordinary riser the moment it lands, so making it shorter is a drag on its
 * right edge, not an undo.
 */
export function coachRiserFieldsFor(boundary: { bar: number; leadBars: number }): {
  startBar: number
  lengthBars: number
} {
  const lengthBars = Math.max(MIN_RISER_LENGTH_BARS, boundary.leadBars)
  return { startBar: Math.max(0, boundary.bar - lengthBars), lengthBars }
}

/** One move the tension pass has actually put down. Plain, persisted data,
 * and the ONLY record that a toggle is on -- there is no derived "does this
 * clip look swept" check anywhere, because a hand-edited curve would make
 * such a check lie. */
export interface CoachTensionApplied {
  /** The OUTGOING section it was written onto -- see CoachSectionBoundary. */
  sectionIndex: number
  kind: CoachTensionKind
  /** The riser this put down, for 'riser' only, so taking it off again
   * removes exactly that riser and not one the user placed by hand. null
   * for the three curve moves. */
  riserId: string | null
}

export function tensionIsApplied(
  applied: readonly CoachTensionApplied[],
  sectionIndex: number,
  kind: CoachTensionKind
): boolean {
  return applied.some((entry) => entry.sectionIndex === sectionIndex && entry.kind === kind)
}

/** The riser this boundary put down, or null. */
export function appliedTensionRiserId(
  applied: readonly CoachTensionApplied[],
  sectionIndex: number
): string | null {
  const entry = applied.find(
    (candidate) => candidate.sectionIndex === sectionIndex && candidate.kind === 'riser'
  )
  return entry?.riserId ?? null
}

/** The most recently placed riser. The renderer uses it to put the NEXT
 * riser on the same arranger row, so a track with three drops gets one
 * riser row rather than three. */
export function lastAppliedRiserId(applied: readonly CoachTensionApplied[]): string | null {
  for (let i = applied.length - 1; i >= 0; i -= 1) {
    const entry = applied[i]
    if (entry.kind === 'riser' && entry.riserId !== null) return entry.riserId
  }
  return null
}

/**
 * Turns whatever a `.sssketchproj` actually contains into an applied list --
 * the same repair-rather-than-trust rule the rest of the load path follows,
 * for the same reason: a project file is plain JSON people can and do
 * hand-edit, and a load must never throw. An entry whose kind is not one of
 * the four, or whose index is not a whole non-negative number, is dropped
 * entirely rather than guessed at.
 */
export function sanitiseCoachTension(value: unknown): CoachTensionApplied[] {
  if (!Array.isArray(value)) return []
  const applied: CoachTensionApplied[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const loose = entry as Record<string, unknown>
    if (!isCoachTensionKind(loose.kind)) continue
    const index = loose.sectionIndex
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) continue
    applied.push({
      sectionIndex: index,
      kind: loose.kind,
      riserId: typeof loose.riserId === 'string' && loose.riserId !== '' ? loose.riserId : null
    })
  }
  return applied
}

// src/renderer/src/components/radioIntensityGlue.ts
//
// The Discover panel's pure reads of the intensity arc (@shared/radioIntensityArc; spec
// docs/superpowers/specs/2026-10-05-radio-intensity-arc-design.md), kept beside the panel so they
// are tested: which rows the arc holds, what the readout says next, which rows flash, whether an
// add held for a phrase start goes, whether the throws aim at the drop, what the strip's and the
// phone's build and drop buttons show. The panel
// (DiscoverPanel.tsx) does the rest from its refs.

import {
  RADIO_BREAKDOWN_WORD,
  RADIO_BUILD_WORD,
  RADIO_BUILDING_WORD,
  RADIO_DROP_WORD,
  RADIO_DROPPING_WORD,
  pressRadioIntensity,
  radioIntensityButtonLabel,
  type RadioIntensityArc,
  type RadioIntensityPhase,
  type RadioIntensityRoom
} from '@shared/radioIntensityArc'
import type { RadioReadoutInput } from '@shared/radioReadout'
import type { RemoteArcView } from '@shared/remoteState'

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

/** The regular throws aim at the drop (spec 5.5): in the breakdown's last phrase, until the
 * drop is decided. From there the panel arms the drop's own aimed throw at the decide wrap
 * (armDiscoverAimedThrow), before the drop's stage exists: the regular rule could not, as the
 * returns queued for the drop keep it from arming (stepDiscoverThrows' canArm). */
export function intensityThrowDropDue(arc: RadioIntensityArc): boolean {
  if (!arc.begun || arc.decided?.event === 'drop') return false
  return arc.phase === 'breakdown' && arc.done + 1 >= arc.phrases
}

/** The loop the lap after a wrap's landings plays (the hook exit's and the breakdown echo's
 * rule): the resolved row lengths with every landed row's known length over its old one, the
 * longest of them (`fallback` with no rows). Null while a landed row's length is not known yet
 * (its stem still resolving): the lap is unknown, and nothing is aimed at its end. */
export function intensityLapAfterLandings(
  resolved: ReadonlyMap<string, number>,
  landed: ReadonlyMap<string, number | null>,
  fallback: number
): number | null {
  const lengths = new Map(resolved)
  for (const [id, bars] of landed) {
    if (bars === null) return null
    if (bars > 0) lengths.set(id, bars)
  }
  return lengths.size > 0 ? Math.max(...lengths.values()) : fallback
}

/** What the drop's owed throw does on a tick (the panel's intensityDropThrowTick, once the drop
 * is still decided and the throws are on):
 *   - give up once the lap it was owed in has ended -- the drop's top has come (an aim from
 *     there would end a lap after the drop), whatever it was waiting on;
 *   - wait while a roll, a turn or a stage is out (`waitingOn`), a landing's length is not known
 *     (`loopBars` null), or the throw clock has not ticked (`pos` null);
 *   - else arm, at the throw clock's own position (`pos`, the throws' lastPos, which their
 *     elapsed bars count to) in the lap the landings make. */
export function intensityDropThrowStep(o: {
  owedLap: number
  lap: number
  /** What it last waited on, for the give-up's log. */
  waited: string | null
  waitingOn: string | null
  loopBars: number | null
  pos: number | null
}):
  | { act: 'arm'; loopBars: number; pos: number }
  | { act: 'wait'; on: string }
  | { act: 'give-up'; why: string } {
  if (o.lap !== o.owedLap) {
    return {
      act: 'give-up',
      why: `dry (the drop's top came ${o.waited !== null ? `while it waited on ${o.waited}` : 'before it armed'})`
    }
  }
  if (o.waitingOn !== null) return { act: 'wait', on: o.waitingOn }
  if (o.loopBars === null || !(o.loopBars > 0)) return { act: 'wait', on: "a landing's length" }
  if (o.pos === null) return { act: 'wait', on: 'the throw clock' }
  return { act: 'arm', loopBars: o.loopBars, pos: o.pos }
}

/** Whether the arc may put a new add's row on the panel now (a button's add with nothing held,
 * the lap-early pick): no add of its own on the way, and no one-lap phrase's next add picked
 * ahead (that row takes the held slot once picked: another would be a second silent row). */
export function intensityMayPickAdd(o: { adding: boolean; nextAdd: boolean }): boolean {
  return !o.adding && !o.nextAdd
}

/** The arc's rests to sweep (radio's resting rows, owner `arc` only): `gone` leave radio's rests
 * at once -- rows no longer on the panel, and (`inMix` given) rows already back in the mix;
 * `back` come back at the next top with their own stem (intensityBringBack) -- on the panel, not
 * held by the arc (`holds`: none once it is gone), nothing queued on them (a change given up to a
 * withdrawn hand change leaves a rest with nothing to end it). */
export function intensityRestSweep(
  resting: Iterable<readonly [string, string]>,
  o: {
    live: ReadonlySet<string>
    holds: ReadonlySet<string>
    queued: (rowId: string) => boolean
    inMix?: (rowId: string) => boolean
  }
): { gone: string[]; back: string[] } {
  const gone: string[] = []
  const back: string[] = []
  for (const [id, owner] of resting) {
    if (owner !== 'arc') continue
    if (!o.live.has(id) || (o.inMix?.(id) ?? false)) gone.push(id)
    else if (!o.holds.has(id) && !o.queued(id)) back.push(id)
  }
  return { gone, back }
}

/** What the strip's `build` and `drop` buttons show (radioArcShown; spec 6): the phase, each
 * button's label (`building` / `dropping` while its press waits for the top), and whether a press
 * would act now -- what intensityPress does with it, asked of the machine itself
 * (pressRadioIntensity with the rows now, `room`; the lap's late stretch only moves a press to the
 * top after, so it is not asked). Neither acts before the machine has begun; `drop` outside a
 * breakdown, with no drop decided, is the quick drop, which needs the planner's `low drop` to
 * sound (`quickDropCanSound`, the check intensityPress makes). */
export interface RadioArcShown {
  phase: RadioIntensityPhase
  build: string
  drop: string
  canBuild: boolean
  canDrop: boolean
}

export function intensityArcShown(
  arc: RadioIntensityArc,
  o: { lap: number; phraseLaps: number; room: RadioIntensityRoom; quickDropCanSound: boolean }
): RadioArcShown {
  const where = { lap: o.lap, phraseLaps: o.phraseLaps, late: false, can: o.room }
  const quick = arc.phase !== 'breakdown' && arc.decided?.event !== 'drop'
  return {
    phase: arc.phase,
    build: radioIntensityButtonLabel('build', arc),
    drop: radioIntensityButtonLabel('drop', arc),
    canBuild: arc.begun && pressRadioIntensity(arc, 'build', where) !== null,
    canDrop:
      arc.begun &&
      (!quick || o.quickDropCanSound) &&
      pressRadioIntensity(arc, 'drop', where) !== null
  }
}

/** Field by field: the strip's state is kept when unchanged, so a tick re-renders nothing. */
export function sameArcShown(a: RadioArcShown | null, b: RadioArcShown | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.phase === b.phase &&
    a.build === b.build &&
    a.drop === b.drop &&
    a.canBuild === b.canBuild &&
    a.canDrop === b.canDrop
  )
}

/** The phone's view of the buttons (RemoteArcView): `waiting` read off the labels, a drop's first
 * (it lands at the next top; a build pressed after it waits for the top after). */
export function intensityArcRemote(shown: RadioArcShown | null): RemoteArcView | null {
  if (shown === null) return null
  const waiting =
    shown.drop === RADIO_DROPPING_WORD
      ? 'drop'
      : shown.build === RADIO_BUILDING_WORD
        ? 'build'
        : null
  return { phase: shown.phase, waiting, canBuild: shown.canBuild, canDrop: shown.canDrop }
}

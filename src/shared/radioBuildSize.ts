// src/shared/radioBuildSize.ts
//
// Build-ups sized to the change, and every turnaround paid off
// (docs/superpowers/specs/2026-10-03-radio-anointed-stems-design.md section 4).
//
// Elling, listening to the web radio: "the noise sweep almost oversells the change that's about
// to come" -- and then "a turnaround feels like a letdown kinda if there isn't a somewhat dramatic
// change to the current state". So the pairing goes both ways:
//   - the size of a build follows the size of the change it leads into (radioBuildSize), and
//   - a turnaround that fires is paid off by a change on its wrap (radioPayoffMet): two or more
//     rows, a hook back or an arc step; three or more, or the low end back, after a gap.
//
// Pure, no randomness: every function here only classifies. The runtimes fill the forecast from
// what they know a lap ahead, keep the build clock on their own play clock, and assemble a payoff
// from what is due (radio's armed pick, its companions, spare picks).

import type { TurnaroundArc, TurnaroundPlan } from './radioTurnaround'

/** How big a build a change earns. */
export type RadioBuildSize = 'none' | 'small' | 'medium' | 'large'

/** What a turnaround's wrap can pay off with, or must: `none` (nothing can change there),
 * `medium` (two rows, a hook back, an arc step), `large` (three rows, a hook back with another
 * row, the low end back, a course change). */
export type RadioPayoff = 'none' | 'medium' | 'large'

export const RADIO_BUILD_SIZES: readonly RadioBuildSize[] = ['none', 'small', 'medium', 'large']

/** What changes or joins at one loop top, as the runtime knows it when it decides. Hook exits
 * (a dub exit: no build) and arc removals are not `rows`. */
export interface RadioChangeForecast {
  /** Rows changing or joining: radio's change, its companions, manual changes queued for the top,
   * a hook return, an arc add. */
  rows: number
  /** A hook coming back at this top, and how long it was away (bars). */
  hookReturn: { awayBars: number } | null
  /** A row with drums or bass among its kinds, silent in the lap before and heard after it (a
   * hook return on such a row, a rest ending, an arc add). */
  lowEndReturn: boolean
  /** The density arc's step landing at this top. */
  arcStep: 'add' | 'remove' | null
  /** A desktop course change at this top (every row at once). */
  course: boolean
}

export const NO_CHANGE_FORECAST: RadioChangeForecast = Object.freeze({
  rows: 0,
  hookReturn: null,
  lowEndReturn: false,
  arcStep: null,
  course: false
}) as RadioChangeForecast

/** Bars a hook must be away, at pace scale 1, for its return to be a large change (spec 4.2:
 * "a long absence (24 or more)"). Scaled by radioHookPaceScale. */
export const HOOK_LONG_AWAY_BARS = 16

/** No build of any size within this many bars of the last one: a second falls to `small`. */
export const BUILD_SPACING_BARS = 8

/** The build clock: bars since the last build landed (any riser, per-change or a turnaround's)
 * and since the last LARGE build (a turnaround rolled at `large` that fired). Null: none yet.
 * The runtime advances it at every wrap while radio runs and is not held (advanceRadioBuildClock)
 * and notes a build at the wrap it lands on (noteRadioBuild). */
export interface RadioBuildClock {
  sinceBuild: number | null
  sinceLarge: number | null
}

export const NO_RADIO_BUILDS: RadioBuildClock = Object.freeze({
  sinceBuild: null,
  sinceLarge: null
}) as RadioBuildClock

export function advanceRadioBuildClock(clock: RadioBuildClock, bars: number): RadioBuildClock {
  const add = Number.isFinite(bars) && bars > 0 ? bars : 0
  if (add === 0 || (clock.sinceBuild === null && clock.sinceLarge === null)) return clock
  return {
    sinceBuild: clock.sinceBuild === null ? null : clock.sinceBuild + add,
    sinceLarge: clock.sinceLarge === null ? null : clock.sinceLarge + add
  }
}

/** A build landed now: `large` when it was a turnaround rolled at large that fired (spec 4.2: a
 * large build is that, riser or not). `riser` (default true): a riser was in it, so it counts for
 * the 8-bar spacing too; a riserless large resets only the large count, and a riserless anything
 * else is no build at all. */
export function noteRadioBuild(
  clock: RadioBuildClock,
  large: boolean,
  riser = true
): RadioBuildClock {
  if (riser) return { sinceBuild: 0, sinceLarge: large ? 0 : clock.sinceLarge }
  return large ? { sinceBuild: clock.sinceBuild, sinceLarge: 0 } : clock
}

/** Whether a plan or a gesture is a build for the clock: a riser in it. */
export function radioPlanIsBuild(plan: Pick<TurnaroundPlan, 'riserBars'> | null): boolean {
  return plan !== null && (plan.riserBars ?? 0) > 0
}

/** A phrase-end turnaround that played at its wrap, for the clock: its riser (radioPlanIsBuild)
 * and whether it was rolled at `large`. Null (none played): the clock as it was. */
export function radioNoteTurnaround(
  clock: RadioBuildClock,
  plan: Pick<TurnaroundPlan, 'riserBars'> | null,
  large: boolean
): RadioBuildClock {
  if (plan === null) return clock
  return noteRadioBuild(clock, large, radioPlanIsBuild(plan))
}

const RANK: Readonly<Record<RadioBuildSize, number>> = { none: 0, small: 1, medium: 2, large: 3 }

export function radioBuildSizeAtLeast(a: RadioBuildSize, b: RadioBuildSize): boolean {
  return RANK[a] >= RANK[b]
}

/** The tier a change earns, before the budget (spec 4.2). */
export function radioBuildTier(f: RadioChangeForecast, hookScale = 1): RadioBuildSize {
  const scale = Number.isFinite(hookScale) && hookScale > 0 ? hookScale : 1
  if (
    f.lowEndReturn ||
    f.course ||
    f.arcStep !== null ||
    f.rows >= 3 ||
    (f.hookReturn !== null && f.hookReturn.awayBars > HOOK_LONG_AWAY_BARS * scale)
  ) {
    return 'large'
  }
  if (f.hookReturn !== null || f.rows === 2) return 'medium'
  if (f.rows === 1) return 'small'
  return 'none'
}

export interface RadioBuildBudget {
  /** The build clock, as advanced to now. */
  clock: RadioBuildClock
  /** Bars from now to the top this build lands on: the clock is compared at that top. */
  aheadBars: number
  /** The turnaround phrase, in bars: a large build at most once per phrase. */
  phraseBars: number
  /** A phrase end's own build (radioPhraseEndBuild): its `large` is spared the 8-bar spacing, so
   * a cheap mid-phrase riser (at a high pace) cannot eat the phrase start's big moment. The
   * once-a-phrase rule still applies, and a `medium` keeps its spacing. Absent: false. */
  phraseEnd?: boolean
}

/** The budget (Huron: a build that comes too often stops meaning anything): `large` falls to
 * `medium` within a phrase of the last large build; `medium` or `large` falls to `small` within
 * BUILD_SPACING_BARS of the last build of any size -- except a phrase end's `large`
 * (`phraseEnd`), which only the once-a-phrase rule limits. */
export function radioApplyBuildBudget(size: RadioBuildSize, b: RadioBuildBudget): RadioBuildSize {
  const ahead = Number.isFinite(b.aheadBars) && b.aheadBars > 0 ? b.aheadBars : 0
  const since = (x: number | null): number => (x === null ? Number.POSITIVE_INFINITY : x + ahead)
  let out = size
  if (out === 'large' && since(b.clock.sinceLarge) < b.phraseBars) out = 'medium'
  const spaced = out === 'medium' || (out === 'large' && b.phraseEnd !== true)
  if (spaced && since(b.clock.sinceBuild) < BUILD_SPACING_BARS) {
    out = 'small'
  }
  return out
}

/** A per-change gesture's tier: the change's own, after the budget. */
export function radioBuildSize(
  f: RadioChangeForecast,
  opts: { hookScale?: number } & RadioBuildBudget
): RadioBuildSize {
  return radioApplyBuildBudget(radioBuildTier(f, opts.hookScale), opts)
}

/** The arc a build is drawn for (spec 4.2): `growing` when it comes from a hook return, the low
 * end returning, three or more rows, an arc add or a course change; `thinning` when it comes only
 * from an arc removal (a thinning mix softens; it does not drop); otherwise the leg's own. */
export function radioBuildArc(f: RadioChangeForecast, legArc: TurnaroundArc): TurnaroundArc {
  if (f.hookReturn !== null || f.lowEndReturn || f.rows >= 3 || f.arcStep === 'add' || f.course) {
    return 'growing'
  }
  if (f.arcStep === 'remove' && f.rows === 0) return 'thinning'
  return legArc
}

// ---- every turnaround paid off (Elling, 2026-10-03: "a turnaround feels like a letdown kinda if
// there isn't a somewhat dramatic change to the current state") ----

/** Whether what lands at a turnaround's wrap pays it off. `medium`: two or more rows, a hook back,
 * an arc step, the low end back or a course change. `large`: three or more rows, a hook back with
 * another row, the low end back or a course change. `none` is always met. */
export function radioPayoffMet(f: RadioChangeForecast, need: RadioPayoff): boolean {
  if (need === 'none') return true
  if (f.lowEndReturn || f.course) return true
  if (need === 'medium') return f.rows >= 2 || f.hookReturn !== null || f.arcStep !== null
  return f.rows >= 3 || (f.hookReturn !== null && f.rows >= 2)
}

/** The largest payoff a forecast meets. */
export function radioPayoffOf(f: RadioChangeForecast): RadioPayoff {
  if (radioPayoffMet(f, 'large')) return 'large'
  if (radioPayoffMet(f, 'medium')) return 'medium'
  return 'none'
}

/** The payoff a fired turnaround needs: `large` after a gap (the silence before the one is the
 * biggest promise radio makes), `medium` otherwise. */
export function radioTurnaroundPayoffNeed(plan: Pick<TurnaroundPlan, 'gapBeats'>): RadioPayoff {
  return (plan.gapBeats ?? 0) > 0 ? 'large' : 'medium'
}

/** How many more rows must change at the wrap for `f` to meet `need` (0 when it already does).
 * Rows are what a runtime can add: radio's armed pick pulled forward, its companions, spares. */
export function radioPayoffShortfall(f: RadioChangeForecast, need: RadioPayoff): number {
  if (radioPayoffMet(f, need)) return 0
  if (need === 'large') return Math.max(0, (f.hookReturn !== null ? 2 : 3) - f.rows)
  return Math.max(0, 2 - f.rows)
}

/** `f` with `n` more rows changing (assembled for a payoff). */
export function radioForecastWithRows(f: RadioChangeForecast, n: number): RadioChangeForecast {
  return n > 0 ? { ...f, rows: f.rows + n } : f
}

/**
 * THE PHRASE END's size, and the payoff it may promise (spec 4.4, 4.7), from `f` -- what already
 * lands at the wrap -- and `spare`, the rows the runtime could add there (radio's armed pick when
 * it is not already in `f`, its companions, spare picks: each warm and eligible).
 *
 * - `skip`: no payoff is possible (`f` plus every spare row does not meet `medium`): the phrase
 *   end gets no turnaround, and its roll draws nothing.
 * - `size`: the tier `f` earns, raised to `medium` (a fired turnaround always brings at least a
 *   medium change: the runtime assembles it), then the budget (a phrase end's: its `large` is
 *   spared the 8-bar spacing).
 * - `payoff`: the largest payoff `f` plus the spares can meet. rollTurnaround's gap needs `large`.
 */
export function radioPhraseEndBuild(
  f: RadioChangeForecast,
  spare: number,
  opts: { hookScale?: number } & RadioBuildBudget
): { skip: boolean; size: RadioBuildSize; payoff: RadioPayoff } {
  const best = radioForecastWithRows(f, Math.max(0, Math.floor(spare)))
  const payoff = radioPayoffOf(best)
  const raw = radioBuildTier(f, opts.hookScale)
  const floored: RadioBuildSize = radioBuildSizeAtLeast(raw, 'medium') ? raw : 'medium'
  const size = radioApplyBuildBudget(floored, { ...opts, phraseEnd: true })
  return { skip: payoff === 'none', size, payoff }
}

// ---- big moments on phrase starts (spec 4.5) ----

/**
 * Whether a density-arc step that is ready waits (sizedBuilds): it lands only on a phrase start
 * -- decided at the wrap starting a phrase's last lap (`decidesForPhraseStart`, the clock's
 * turnaroundLapStarts) -- and waits at most one phrase past being ready (`overdueBars`: the leg's
 * bars beyond its step). Off (`sized` false): never. Legs are 96-192 bars, so the wait is
 * invisible to the arc; it makes every arc step meet the phrase-end turnaround.
 */
export function radioArcStepWaits(o: {
  sized: boolean
  decidesForPhraseStart: boolean
  overdueBars: number
  phraseBars: number
}): boolean {
  if (!o.sized || o.decidesForPhraseStart) return false
  return o.overdueBars < o.phraseBars
}

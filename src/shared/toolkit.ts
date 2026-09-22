/**
 * The built-in sound toolkit's project data: a per-CLIP filter, a per-clip
 * send into one shared reverb, and drawn automation over a deliberately small
 * set of parameters.
 *
 * See docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md,
 * including section 2b (REVISION, 2026-09-22): the toolkit was per CHANNEL
 * for exactly one build, and moved to per placed stem clip after the first
 * live walkthrough. A "clip" here is one placed stem, keyed by
 * stemKey(groupId, slot) -- the same key state.vol/state.mute/
 * state.muteRegions already use -- and its curves are measured in
 * CLIP-RELATIVE bars (0 = the clip's own left edge), which is what makes a
 * moved or duplicated clip carry its automation with it and what makes a
 * curve unable to extend past the audio it belongs to.
 *
 * Everything here is the TS half of a HAND-SYNCED PAIR with the native
 * engine (CLAUDE.md): StemFilterSettings/StemAutomation mirror
 * EngineStem::EngineStemToolkit, and ProjectReverbSettings mirrors
 * ReverbSettings, both in native-engine/Source/. Changing a field on one
 * side means changing it on the other and on every test that constructs
 * either. Values are NORMALISED to [0,1] on this side; mapping to real units
 * (Hz, Q, gain) is deliberately the engine's job and lives in exactly one
 * place there, so the renderer can never drift from what is actually heard.
 * The one exception is reverb pre-delay, which is in real milliseconds
 * because that is how people think about it.
 */

export type FilterMode = 'lowpass' | 'highpass'

/** The whole DRAWABLE set. Deliberately small -- "a limited set of tools"
 * (Elling, 2026-09-22) -- so the automation lane's parameter picker stays a
 * short list rather than an inspector of everything.
 *
 * `filterResonance` used to be a fourth entry here and is deliberately NOT
 * one any more (Elling, after using it: "that's confusing to have it
 * separate from cut though isn't it?"). Resonance is a peak AT the cutoff
 * corner, so a resonance curve on a clip whose cutoff isn't moving does
 * nothing audible at all -- which read as a broken lane rather than as a
 * parameter that needs a partner. It is now a STORED PER-CLIP setting
 * (StemFilterSettings.resonance) written by a small dial in the filter
 * lane's own corner: one filter lane you draw, with its resonance as a knob
 * beside it. That is also how Ableton's Auto Filter works (you automate
 * Frequency; Resonance is a knob) and how both export mappings already
 * describe it (docs/superpowers/references/ableton12-automation-mapping.md,
 * reaper-automation-mapping.md). */
export type AutomationParam = 'filterCutoff' | 'reverbSend' | 'volume'

export const AUTOMATION_PARAMS: readonly AutomationParam[] = [
  'filterCutoff',
  'reverbSend',
  'volume'
]

/** How each parameter reads in the automation lane's own picker. Lowercase,
 * no punctuation, matching this app's UI copy rules (tokens.css). Lives
 * here rather than in the component for the same reason
 * DISCOVER_SLOT_KIND_LABEL does: one table, next to the union it labels, so
 * adding a parameter can't leave a lane showing a raw identifier. */
export const AUTOMATION_PARAM_LABEL: Record<AutomationParam, string> = {
  // Just "filter", not "filter cutoff": there is only ONE filter lane now,
  // and it carries its own resonance dial in its corner, so the picker is
  // naming the whole filter rather than distinguishing one of its two
  // parameters from the other.
  filterCutoff: 'filter',
  reverbSend: 'reverb send',
  volume: 'volume'
}

/** The same three, short enough to fit inside a narrow clip's own lane --
 * the picker lives ON the clip (spec section 2b), and a two-bar clip at the
 * default zoom is barely wider than the words "reverb send". Lowercase, no
 * punctuation, same rules as the full labels above; the full label is still
 * what the picker's tooltip/aria-label says, so nothing is only ever
 * expressed as an abbreviation. */
export const AUTOMATION_PARAM_SHORT_LABEL: Record<AutomationParam, string> = {
  filterCutoff: 'filt',
  reverbSend: 'verb',
  volume: 'vol'
}

/** One drawn breakpoint: a normalised value at a CLIP-RELATIVE bar -- 0 is
 * the clip's own left edge, not the arrangement's. Deliberately not the
 * absolute coordinate space Rifff.startBar and muteRegions use: a curve
 * belongs to its clip, so moving or duplicating the clip must carry the
 * shape unchanged, and nothing should be able to draw a breakpoint past the
 * end of the audio it is automating (see the spec's section 2b). The
 * absolute bar a point lands on is resolved in exactly one place, on the way
 * to the engine -- buildEngineProject.ts's clipOriginBar. */
export interface AutomationPoint {
  bar: number
  value: number
}

/** One clip's drawn curves. A parameter ABSENT from this record (or present
 * with an empty array) is "not automated", which is a different thing from
 * "automated and currently flat": the former uses the clip's own static
 * setting, the latter the curve. */
export type StemAutomation = Partial<Record<AutomationParam, AutomationPoint[]>>

export interface StemFilterSettings {
  mode: FilterMode
  /** [0,1]; the engine maps this logarithmically onto 20Hz..20kHz. */
  cutoff: number
  /** [0,1]; the engine maps this onto Q 0.707..8.0. Never a drawn curve --
   * see AUTOMATION_PARAMS above for why resonance is a per-clip dial rather
   * than a lane. This is the only place a clip's resonance lives. */
  resonance: number
}

export interface ProjectReverbSettings {
  /** [0,1] -- the engine maps this onto 0.5..8 seconds of decay. */
  roomSize: number
  /** [0,1] -- more damping means a darker tail. */
  damping: number
  /** Real milliseconds, not normalised. Clamped by the engine into what
   * zita-rev1's own input delay line can address. */
  preDelayMs: number
}

export const DEFAULT_REVERB: ProjectReverbSettings = {
  roomSize: 0.5,
  damping: 0.5,
  preDelayMs: 20
}

/** The cutoff value at which a given mode does nothing at all: fully open for
 * a lowpass, fully down for a highpass. This is what "neutral" means
 * everywhere else in this file, and it is the same rule the engine's own
 * neutralCutoffValue() implements. */
export function neutralCutoff(mode: FilterMode): number {
  return mode === 'lowpass' ? 1 : 0
}

export function defaultFilterSettings(mode: FilterMode = 'lowpass'): StemFilterSettings {
  return { mode, cutoff: neutralCutoff(mode), resonance: 0 }
}

// Reads the CUTOFF only, deliberately: resonance is a peak at the cutoff
// corner, so a clip whose cutoff is parked at its neutral end and has no
// cutoff curve sounds identical whatever its resonance dial says. Leaving a
// resonance-only clip "neutral" is therefore not a rounding error -- it is
// what keeps such a project's render bit-identical to its pre-toolkit self
// (see isStemToolkitNeutral below). The dial's value is still stored and
// still saved; it simply starts mattering the moment a cutoff curve exists.
function isNeutralFilter(filter: StemFilterSettings | undefined): boolean {
  if (!filter) return true
  if (!Number.isFinite(filter.cutoff)) return false
  // A tolerance rather than an exact compare, for the same reason the engine
  // uses one: a slider parked at its end stop can land a hair off 1/0 after a
  // JSON round trip, and a millionth of the control's travel is not a sound.
  return Math.abs(filter.cutoff - neutralCutoff(filter.mode)) <= 1e-6
}

function hasCurve(automation: StemAutomation | undefined, param: AutomationParam): boolean {
  const points = automation?.[param]
  return Array.isArray(points) && points.length > 0
}

/**
 * Whether a clip's toolkit does nothing -- i.e. whether it can be left off
 * the wire entirely, which is what keeps a project that never touches the
 * toolkit byte-identical to its pre-toolkit self all the way down to the
 * engine's render path.
 *
 * Mirrors stemToolkitIsNeutral() in native-engine/Source/PlaybackEngine.cpp;
 * the two are checked against each other by intent, not by code sharing (the
 * hand-synced pair rule above). Any automation curve at all counts as "the
 * user is using this", even one sitting at its default value -- drawing a
 * curve is a declaration that this clip has the tool on it.
 */
export function isStemToolkitNeutral(
  filter: StemFilterSettings | undefined,
  reverbSend: number | undefined,
  automation: StemAutomation | undefined
): boolean {
  if (!isNeutralFilter(filter)) return false
  if (hasCurve(automation, 'filterCutoff')) return false
  if (reverbSend !== undefined && reverbSend > 0) return false
  if (hasCurve(automation, 'reverbSend')) return false
  if (hasCurve(automation, 'volume')) return false
  return true
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** The two ends of the filter's own cutoff range, in real Hz. Twins of
 * kFilterCutoffMinHz/kFilterCutoffMaxHz in
 * native-engine/Source/ChannelFilter.h. */
export const FILTER_CUTOFF_MIN_HZ = 20
export const FILTER_CUTOFF_MAX_HZ = 20000

/** The two ends of the resonance dial, as a filter Q. Twins of kMinQ/kMaxQ in
 * native-engine/Source/ChannelFilter.cpp (the low end is Butterworth -- no
 * resonant peak at all). */
export const FILTER_MIN_Q = 0.7071067811865476
export const FILTER_MAX_Q = 8

/**
 * A normalised cutoff dial position as REAL Hz -- log-uniform between 20Hz and
 * 20kHz, so equal movements of the dial are equal musical intervals.
 *
 * A deliberate port of filterCutoffHz() in
 * native-engine/Source/ChannelFilter.cpp, not a second opinion: toolkit.ts's
 * own header says mapping [0,1] onto real units is the ENGINE's job and lives
 * in one place there, and that stays true for anything that is going to be
 * HEARD. This copy exists for one job the engine can't do -- writing a cutoff
 * curve into another DAW's project file, where the envelope has to be in that
 * device's own units (Ableton's Auto Filter takes real Hz; see
 * docs/superpowers/references/ableton12-automation-mapping.md). Exporting
 * through a differently-shaped curve than the one being listened to would put
 * the sweep in the wrong place, which is exactly the failure this port
 * prevents. Its tests pin the same three properties ChannelFilterTests.cpp
 * pins, so the two can't drift apart silently.
 */
export function filterCutoffHz(value01: number): number {
  const v = clamp01(value01)
  return FILTER_CUTOFF_MIN_HZ * Math.pow(FILTER_CUTOFF_MAX_HZ / FILTER_CUTOFF_MIN_HZ, v)
}

/** The resonance dial as a filter Q. Port of filterResonanceQ() in
 * native-engine/Source/ChannelFilter.cpp, for the same export-only reason
 * filterCutoffHz above is -- REAPER's ReaEQ band takes a bandwidth/Q, not a
 * 0..1 dial (docs/superpowers/references/reaper-automation-mapping.md). */
export function filterResonanceQ(value01: number): number {
  const v = clamp01(value01)
  return FILTER_MIN_Q * Math.pow(FILTER_MAX_Q / FILTER_MIN_Q, v)
}

/** What an export does with the toolkit: bake it into the rendered audio, or
 * leave the audio dry and write the curves as the target DAW's own
 * automation. See section 4 of
 * docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md. */
export type ToolkitExportMode = 'bake' | 'automation'

export const DEFAULT_TOOLKIT_EXPORT_MODE: ToolkitExportMode = 'bake'

/**
 * Whether this project uses the built-in toolkit at all -- i.e. whether the
 * export dialog should offer the bake/automation choice, or just get on with
 * the export the way it always did.
 *
 * Structurally typed rather than taking AppState, so src/shared stays
 * importable without the renderer store; AppState satisfies it as-is.
 *
 * A clip counts exactly when isStemToolkitNeutral says it isn't neutral --
 * one rule, the same one the wire format and the engine already use. The
 * consequence worth knowing: a clip with ONLY a resonance dial turned up (no
 * cutoff curve, cutoff parked at its neutral end) does NOT count, because it
 * makes no sound -- resonance is a peak AT the corner frequency, so with
 * nothing moving the corner there is nothing to export and nothing to bake.
 * Risers count on their own: a riser is audible by existing.
 */
export function projectUsesToolkit(project: {
  stemFilters?: Record<string, StemFilterSettings>
  stemSends?: Record<string, number>
  stemAutomation?: Record<string, StemAutomation>
  risers?: Record<string, unknown>
}): boolean {
  if (Object.keys(project.risers ?? {}).length > 0) return true
  const keys = new Set([
    ...Object.keys(project.stemFilters ?? {}),
    ...Object.keys(project.stemSends ?? {}),
    ...Object.keys(project.stemAutomation ?? {})
  ])
  for (const key of keys) {
    if (
      !isStemToolkitNeutral(
        project.stemFilters?.[key],
        project.stemSends?.[key],
        project.stemAutomation?.[key]
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * Puts a drawn curve into the shape everything downstream assumes: sorted
 * ascending by bar, values clamped into [0,1], non-finite points dropped.
 *
 * Applied on the way OUT (buildEngineProject) as well as being enforced again
 * on the way IN on the engine side -- belt and braces on purpose, since a
 * `.sssketchproj` is a plain JSON file people can and do hand-edit, and a
 * malformed curve reaching the audio thread is the one place this would stop
 * being a cosmetic problem. A stable sort, so two points a free-draw stroke
 * left on the same bar keep the order they were drawn in: that is what makes
 * a vertical step read as "jump to the later value".
 */
export function normaliseAutomationCurve(points: AutomationPoint[]): AutomationPoint[] {
  return points
    .filter((point) => Number.isFinite(point.bar) && Number.isFinite(point.value))
    .map((point) => ({ bar: point.bar, value: clamp01(point.value) }))
    .sort((a, b) => a.bar - b.bar)
}

/**
 * The value of a curve at a given bar: linear interpolation between the
 * surrounding points, flat hold before the first and after the last, and
 * `fallback` for an empty curve.
 *
 * A deliberate reimplementation of evaluateAutomation() in
 * native-engine/Source/AutomationCurve.cpp -- the renderer needs it to draw
 * the curve and show a value under the playhead, and having the two agree
 * exactly (including the "a stacked pair of points is a step to the LATER
 * value" rule) is what stops the drawn line disagreeing with what is heard.
 * `points` must already be normalised (see above).
 */
export function evaluateAutomation(
  points: AutomationPoint[],
  bar: number,
  fallback: number
): number {
  if (points.length === 0) return fallback
  if (!Number.isFinite(bar)) return fallback
  if (bar <= points[0].bar) return points[0].value
  const last = points[points.length - 1]
  if (bar >= last.bar) return last.value
  for (let i = 1; i < points.length; i += 1) {
    const b = points[i]
    if (bar >= b.bar) continue
    const a = points[i - 1]
    const span = b.bar - a.bar
    if (span <= 0) return b.value
    return a.value + (b.value - a.value) * ((bar - a.bar) / span)
  }
  return last.value
}

/**
 * A whole curve reduced to ONE number: the value it spends its time at, on
 * average, over its own span.
 *
 * Written for exactly one job -- turning a `filterResonance` curve drawn
 * during the day resonance was a lane into the clip's static resonance
 * dial, at load time (see deserializeProject's own migration step). Time-
 * weighted (trapezoidal over the bars between consecutive points) rather
 * than a plain mean of the point values, because a free-draw stroke leaves
 * points wherever the hand moved and simplification then thins the flat
 * stretches hardest: a plain mean would let three points crowded into one
 * busy bar outvote a long plateau. Weighting by bars asks the only question
 * that matters for a knob -- "where was this parameter, most of the time?"
 *
 * The span is the curve's own first-to-last bar; the flat holds outside it
 * are ignored, since their length depends on the clip and the answer
 * shouldn't. A curve whose points all sit on one bar (or a single point) has
 * no span to weight by, so it falls back to a plain mean. An empty curve
 * returns `fallback`. Points need not be normalised -- they are normalised
 * here, so a hand-edited project file can't produce a NaN dial.
 */
export function averageAutomationValue(points: AutomationPoint[], fallback = 0): number {
  const curve = normaliseAutomationCurve(points)
  if (curve.length === 0) return fallback
  const span = curve[curve.length - 1].bar - curve[0].bar
  if (!(span > 0)) {
    const total = curve.reduce((sum, point) => sum + point.value, 0)
    return clamp01(total / curve.length)
  }
  let area = 0
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1]
    const b = curve[i]
    area += ((a.value + b.value) / 2) * (b.bar - a.bar)
  }
  return clamp01(area / span)
}

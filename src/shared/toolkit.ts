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

/** The whole automatable set. Deliberately small -- "a limited set of tools"
 * (Elling, 2026-09-22) -- so the automation lane's parameter picker stays a
 * short list rather than an inspector of everything. */
export type AutomationParam = 'filterCutoff' | 'filterResonance' | 'reverbSend' | 'volume'

export const AUTOMATION_PARAMS: readonly AutomationParam[] = [
  'filterCutoff',
  'filterResonance',
  'reverbSend',
  'volume'
]

/** How each parameter reads in the automation lane's own picker. Lowercase,
 * no punctuation, matching this app's UI copy rules (tokens.css). Lives
 * here rather than in the component for the same reason
 * DISCOVER_SLOT_KIND_LABEL does: one table, next to the union it labels, so
 * adding a parameter can't leave a lane showing a raw identifier. */
export const AUTOMATION_PARAM_LABEL: Record<AutomationParam, string> = {
  filterCutoff: 'filter cutoff',
  filterResonance: 'filter resonance',
  reverbSend: 'reverb send',
  volume: 'volume'
}

/** The same four, short enough to fit inside a narrow clip's own lane -- the
 * picker now lives ON the clip (spec section 2b), and a two-bar clip at the
 * default zoom is barely wider than the words "filter resonance". Lowercase,
 * no punctuation, same rules as the full labels above; the full label is
 * still what the picker's tooltip/aria-label says, so nothing is only ever
 * expressed as an abbreviation. */
export const AUTOMATION_PARAM_SHORT_LABEL: Record<AutomationParam, string> = {
  filterCutoff: 'cut',
  filterResonance: 'res',
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
  /** [0,1]; the engine maps this onto Q 0.707..8.0. */
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
  if (hasCurve(automation, 'filterCutoff') || hasCurve(automation, 'filterResonance')) return false
  if (reverbSend !== undefined && reverbSend > 0) return false
  if (hasCurve(automation, 'reverbSend')) return false
  if (hasCurve(automation, 'volume')) return false
  return true
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
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

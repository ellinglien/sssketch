/**
 * The noise riser: a GENERATED audio element placed on the timeline --
 * step 4 of docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md
 * ("a placeable element rendered by the engine: white/pink noise through a
 * rising bandpass + volume ramp over its own bar length... It's an audio
 * SOURCE clip, not a channel effect").
 *
 * The distinction matters everywhere below. A riser has no file, no stems,
 * no `Rifff` behind it and no entry in state.vol/state.mute/state.exp: it is
 * a handful of numbers that the ENGINE turns into audio, which is exactly
 * what makes it bakeable later (step 5) without a second render path -- the
 * engine produces it inside the one `renderBlock` both live playback
 * (Transport.cpp) and offline export (RenderExport.cpp) already go through.
 *
 * Everything here is the TS half of a HAND-SYNCED PAIR with the native
 * engine (CLAUDE.md): RiserClip mirrors EngineRiser in
 * native-engine/Source/EngineProject.h, riserCutoffAt mirrors
 * `riserCutoffAt` and riserEnvelopeAt mirrors `riserEnvelopeAt`, both in
 * native-engine/Source/NoiseRiser.h. Changing one side means changing the
 * other and every test that constructs either. Values are NORMALISED to
 * [0,1] on this side (bars excepted); mapping a cutoff value to Hz is the
 * engine's job and lives in exactly one place there (ChannelFilter.h's
 * filterCutoffHz), the same rule the rest of the toolkit already follows.
 */

import { evaluateAutomation, normaliseAutomationCurve, type AutomationPoint } from './toolkit'

/** One placed riser.
 *
 * `curve` deserves its own note, because it is the one field whose shape was
 * a real choice. The spec's own sketch was `{ ... startCutoff, endCutoff,
 * curve, level }`, where `curve` could be a shape exponent/enum OR a drawn
 * breakpoint list. It is a BREAKPOINT LIST here, in the same
 * `AutomationPoint[]` shape (clip-relative bars, normalised values) every
 * other curve in this app already uses, because that is what lets the riser's
 * sweep be DRAWN in the ordinary automation lane (spec section 3, "its sweep
 * shape is editable as a curve in its own lane") instead of needing a second,
 * parallel editor for a shape enum. The wire cost of that is two points for a
 * riser nobody has drawn on -- smaller than the exponent-plus-enum pair it
 * replaces would have been once a lane had to be able to express an arbitrary
 * hand-drawn sweep anyway.
 *
 * `startCutoffValue`/`endCutoffValue` stay real fields rather than becoming
 * "the curve's first and last point": they are the riser's DECLARED ends, and
 * they are what it falls back to when the curve is cleared (right-clicking a
 * lane clears it -- see AutomationLane.tsx). A cleared riser lane therefore
 * plays the plain ramp it was dropped with rather than going flat or silent,
 * which is the behaviour that makes "clear" feel like undo rather than like
 * breakage. */
export interface RiserClip {
  id: string
  /** Which arranger row this riser sits on -- the same channel ids
   * state.channelOf points placed rifffs at. A riser keeps its channel row
   * alive on its own (see selectors.ts's channelsInOrder), so a riser can be
   * the only thing on a row. */
  channelId: string
  /** Absolute arrangement bar of the riser's left edge -- the same
   * coordinate space Rifff.startBar lives in. */
  startBar: number
  /** How long the riser sounds, in bars. The sweep and the swell are both
   * measured over exactly this, which is what makes resizing a riser
   * re-time it rather than crop it. */
  lengthBars: number
  /** [0,1] normalised bandpass centre at the riser's start. */
  startCutoffValue: number
  /** [0,1] at its end. Above the start for the usual rising riser; putting
   * it below is a perfectly good falling one, and nothing here assumes a
   * direction. */
  endCutoffValue: number
  /** The drawn sweep, in CLIP-RELATIVE bars (0 = this riser's own left
   * edge), values being normalised cutoffs. EMPTY means "use the plain
   * startCutoffValue -> endCutoffValue ramp" -- see riserCutoffAt. */
  curve: AutomationPoint[]
  /** [0,1] peak level the swell reaches at the riser's very end. */
  level: number
  /** What this riser's ROW is called. A riser owns a whole arranger row now
   * (one row per riser -- Elling, 2026-09-23: "give the riser ... its own
   * channel"), so the riser's name IS the row's label and there is no
   * separate channel-name concept to invent. EMPTY means "unnamed, number
   * me": the reducer's ADD_RISER fills it with nextRiserName, because that
   * is the only place that can see the other risers -- and the only place
   * that stays correct inside a BATCH adding several at once. */
  name: string
  /** Silences this riser. Renderer-side ONLY: there is no `muted` on
   * EngineRiser, and there must not be. A muted riser is simply ABSENT from
   * the wire (see audibleRisers / buildEngineRisers), which is the same
   * "absence is load-bearing" trick a neutral toolkit already uses, and it
   * is why muting a riser needs no native-engine change at all.
   *
   * A riser has no stems, so state.mute -- keyed by stemKey -- has nothing
   * to key it by. This flag is the riser's half of the channel's m button;
   * store.ts's SET_CHANNEL_MUTE and SOLO_CHANNEL move both halves together. */
  muted: boolean
}

/** What a freshly dropped riser is. Four bars is one phrase at this app's
 * usual working lengths -- long enough to read as a build, short enough that
 * the first thing a user does is more likely to be "drag it longer" than
 * "delete it". The cutoff ends are deliberately not the filter's own 0/1
 * extremes: 0.3 is ~160Hz and 0.95 is ~14kHz (ChannelFilter.h's log map), so
 * a default riser sweeps most of the audible band while still leaving the
 * lane somewhere to draw above and below the line it starts with. */
export const RISER_DEFAULTS = {
  lengthBars: 4,
  startCutoffValue: 0.3,
  endCutoffValue: 0.95,
  level: 0.6
} as const

/** The shortest riser that can exist. Matches store.ts's own
 * MIN_PLAYED_BARS, for the same reason it exists there: a zero-length
 * element would never render any audio and would divide by zero in the
 * progress math the engine runs per sample. */
export const MIN_RISER_LENGTH_BARS = 0.25

/** The stem of every default riser name -- "riser 1", "riser 2", ... Lower
 * case with no punctuation, matching this app's copy rules (tokens.css). */
export const RISER_NAME_PREFIX = 'riser'

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** The two-point ramp a riser plays when nothing has been drawn on it --
 * also what a NEW riser's `curve` is seeded with, so its lane opens showing
 * the sweep it is actually going to play rather than an empty box. */
export function defaultRiserCurve(
  startCutoffValue: number,
  endCutoffValue: number,
  lengthBars: number
): AutomationPoint[] {
  return [
    { bar: 0, value: clamp01(startCutoffValue) },
    { bar: Math.max(MIN_RISER_LENGTH_BARS, lengthBars), value: clamp01(endCutoffValue) }
  ]
}

export function createRiser(fields: {
  id: string
  channelId: string
  startBar: number
  lengthBars?: number
  /** Left out by every caller today. Naming happens in the reducer, not
   * here -- see RiserClip.name. */
  name?: string
}): RiserClip {
  const lengthBars = Math.max(MIN_RISER_LENGTH_BARS, fields.lengthBars ?? RISER_DEFAULTS.lengthBars)
  return normaliseRiser({
    id: fields.id,
    channelId: fields.channelId,
    startBar: Math.max(0, fields.startBar),
    lengthBars,
    startCutoffValue: RISER_DEFAULTS.startCutoffValue,
    endCutoffValue: RISER_DEFAULTS.endCutoffValue,
    curve: defaultRiserCurve(
      RISER_DEFAULTS.startCutoffValue,
      RISER_DEFAULTS.endCutoffValue,
      lengthBars
    ),
    level: RISER_DEFAULTS.level,
    name: fields.name ?? '',
    muted: false
  })
}

/**
 * Puts a riser into the shape everything downstream assumes: bars finite and
 * non-negative, a real length, normalised values in [0,1], and a curve in the
 * same sorted/clamped shape normaliseAutomationCurve enforces everywhere
 * else.
 *
 * Applied in the reducer on every write AND again on the way out to the wire,
 * belt-and-braces on purpose for the same reason normaliseAutomationCurve is:
 * a `.sssketchproj` is plain JSON people can and do hand-edit, and a riser is
 * the one thing here that reaches the audio thread as GENERATOR parameters --
 * a NaN length would not merely draw wrong, it would divide by zero inside a
 * per-sample loop on a real-time callback.
 */
export function normaliseRiser(riser: RiserClip): RiserClip {
  const lengthBars = Number.isFinite(riser.lengthBars)
    ? Math.max(MIN_RISER_LENGTH_BARS, riser.lengthBars)
    : MIN_RISER_LENGTH_BARS
  return {
    id: riser.id,
    channelId: riser.channelId,
    startBar: Number.isFinite(riser.startBar) ? Math.max(0, riser.startBar) : 0,
    lengthBars,
    startCutoffValue: clamp01(riser.startCutoffValue),
    endCutoffValue: clamp01(riser.endCutoffValue),
    curve: normaliseAutomationCurve(riser.curve ?? []),
    name: typeof riser.name === 'string' ? riser.name.trim() : '',
    muted: riser.muted === true,
    level: clamp01(riser.level)
  }
}

/** The next unused default riser name for this project. Skips every number
 * already taken (in any order, and ignoring hand-typed names, which are
 * nobody's business to renumber around), so deleting "riser 2" and adding
 * one gets "riser 2" back rather than a forever-climbing counter. */
export function nextRiserName(risers: Record<string, RiserClip>): string {
  const taken = new Set(Object.values(risers).map((riser) => riser.name))
  let n = 1
  while (taken.has(`${RISER_NAME_PREFIX} ${n}`)) n += 1
  return `${RISER_NAME_PREFIX} ${n}`
}

/**
 * Every riser that should actually SOUND -- normalised, unmuted, earliest
 * first with `id` as the tiebreak.
 *
 * The one place the mute rule lives, used by the wire (buildEngineRisers)
 * and by both DAW exports (buildRppProject, buildAlsXml) so a muted riser
 * cannot be silent in the rendered audio while still getting a clip in the
 * .rpp/.als that points at it.
 *
 * The ordering is load-bearing in the same quiet way the stem loop's is: the
 * engine sums risers into their channel in the order it receives them, and
 * float addition is not associative, so an unstable order (which
 * Object.values over a record is, across a save/load round trip) would make
 * a project's render differ from itself by a few ULPs for no reason.
 */
export function audibleRisers(risers: Record<string, RiserClip>): RiserClip[] {
  return Object.values(risers)
    .map(normaliseRiser)
    .filter((riser) => !riser.muted)
    .sort((a, b) => a.startBar - b.startBar || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** One riser exactly as it might come off disk: every field optional,
 * because a `.sssketchproj` saved before a field existed simply does not
 * have it, and one that has been hand-edited might be missing anything. */
export type PersistedRiser = Partial<RiserClip> & { id?: string }

/**
 * Every saved riser, brought up to today's shape -- run once at load time
 * (serialize.ts's deserializeProject).
 *
 * The reducer normalises on every write and buildEngineRisers normalises
 * again on the way out, but neither of those has run yet at the moment a
 * project is opened: without this, a riser saved before `name` existed would
 * render its row label as literally "undefined" until something happened to
 * dispatch against it.
 *
 * Keys are walked in sorted order so the numbers a project picks up on its
 * first open are the same every time, rather than depending on JSON key
 * order.
 */
export function normaliseLoadedRisers(
  risers: Record<string, PersistedRiser> | undefined
): Record<string, RiserClip> {
  if (!risers) return {}
  const out: Record<string, RiserClip> = {}
  for (const id of Object.keys(risers).sort()) {
    const saved = risers[id]
    if (saved === null || typeof saved !== 'object') continue
    const normalised = normaliseRiser({
      id,
      // A riser with no channel gets a row of its own, named after itself --
      // which is exactly the one-row-per-riser rule everything else here
      // follows, rather than silently dropping it.
      channelId: saved.channelId ?? id,
      startBar: saved.startBar ?? 0,
      lengthBars: saved.lengthBars ?? RISER_DEFAULTS.lengthBars,
      startCutoffValue: saved.startCutoffValue ?? RISER_DEFAULTS.startCutoffValue,
      endCutoffValue: saved.endCutoffValue ?? RISER_DEFAULTS.endCutoffValue,
      curve: saved.curve ?? [],
      level: saved.level ?? RISER_DEFAULTS.level,
      name: saved.name ?? '',
      muted: saved.muted ?? false
    })
    out[id] = normalised.name === '' ? { ...normalised, name: nextRiserName(out) } : normalised
  }
  return out
}

/** The absolute bar the riser stops sounding on. */
export function riserEndBar(riser: RiserClip): number {
  return riser.startBar + riser.lengthBars
}

/**
 * The riser's bandpass centre, as a normalised [0,1] cutoff value, at a
 * CLIP-RELATIVE bar.
 *
 * A deliberate reimplementation of riserCutoffAt() in
 * native-engine/Source/NoiseRiser.cpp -- the renderer needs it to DRAW the
 * sweep line on the block, and having the two agree exactly is what stops the
 * drawn slope disagreeing with what is heard. Same relationship (and same
 * reason) as evaluateAutomation's own TS/C++ pair in toolkit.ts.
 *
 * With a drawn curve, the curve IS the sweep -- linear interpolation between
 * points, flat hold outside them, exactly like every other automation curve.
 * With no curve (a cleared lane), it is the plain declared ramp, also held
 * flat outside the riser's own span so a block boundary landing a hair before
 * bar 0 can't produce a value below the declared start.
 */
export function riserCutoffAt(riser: RiserClip, clipBar: number): number {
  if (riser.curve.length > 0) {
    return evaluateAutomation(riser.curve, clipBar, riser.startCutoffValue)
  }
  if (!Number.isFinite(clipBar)) return riser.startCutoffValue
  const length = Math.max(MIN_RISER_LENGTH_BARS, riser.lengthBars)
  const progress = Math.min(1, Math.max(0, clipBar / length))
  return riser.startCutoffValue + (riser.endCutoffValue - riser.startCutoffValue) * progress
}

/**
 * The riser's own volume swell, as a gain multiplier in [0,1], at a fraction
 * of the way through it.
 *
 * Squared rather than linear, which is the whole difference between "a riser"
 * and "a fade-in": a linear ramp spends half its length already audible and
 * arrives feeling like it has been going on too long, while a squared one
 * stays out of the way and then rushes the last quarter. It also lands at
 * exactly 0 and exactly 1 at the two ends, so a riser starts from silence (no
 * click going in) and peaks precisely where the drop is.
 *
 * Mirrored by riserEnvelopeAt() in native-engine/Source/NoiseRiser.cpp. One
 * deliberate difference, which is why that side is not simply this function:
 * the engine also applies a few milliseconds of linear declick at the very
 * END of the riser, because stopping at full level would click. That is a
 * real-seconds concern this shared layer has no sample rate to express, and
 * nothing on this side draws it.
 */
export function riserEnvelopeAt(progress01: number): number {
  const p = clamp01(progress01)
  return p * p
}

/** Every riser on one channel, earliest first. The ordering is what makes a
 * row's risers render (and, in the engine, sum) in a stable order regardless
 * of the insertion order of the record they live in. */
export function risersOnChannel(risers: Record<string, RiserClip>, channelId: string): RiserClip[] {
  return Object.values(risers)
    .filter((riser) => riser.channelId === channelId)
    .sort((a, b) => a.startBar - b.startBar)
}

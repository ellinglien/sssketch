// src/shared/radioTransition.ts
//
// Radio's transitions -- docs/superpowers/specs/2026-09-28-radio-controls-
// design.md section 5. Only the SETTING's shape exists so far: the
// temperament weighting and the curve builders are phase E, and nothing
// reads `RadioSettings.transitions` until they land.
//
// The shape ships early on purpose. It is the one field whose absence
// would force a second settings migration later, and a migration is the
// part of this that touches a real file on a real user's disk.
//
// Phase E (2026-09-28) made it real: the temperament below now picks a
// weighted gesture per change, and the curve builders at the bottom of
// this file are what the engine actually performs.
import type { DiscoverSlotKind } from './discoverSlotKind'
import type { RiserClip } from './riser'
import type { AutomationPoint } from './toolkit'

export type RadioTransitions = 'off' | 'subtle' | 'bold'

export const RADIO_TRANSITIONS_OPTIONS: RadioTransitions[] = ['off', 'subtle', 'bold']

export const DEFAULT_RADIO_TRANSITIONS: RadioTransitions = 'subtle'

export function normalizeRadioTransitions(value: unknown): RadioTransitions {
  return RADIO_TRANSITIONS_OPTIONS.includes(value as RadioTransitions)
    ? (value as RadioTransitions)
    : DEFAULT_RADIO_TRANSITIONS
}

/** The one-stem palette. Every one of these acts on stems that are ALREADY
 * in the project when the gesture is armed, which is what keeps them clear
 * of the three renderer-side 1:1 assumptions a crossfade would hit (spec
 * 5.4: slotIndexById's Map<string, number>, setRemoteLoop's positional id
 * pairing, and the "no unrelated load-project mid-transition" rule).
 *
 * Two of them run BEFORE the change they decorate and three run WITH it.
 * `hole` and `riser` announce a change -- the layer leaves a gap, or a
 * noise sweep builds -- so the change they belong to is held back to the
 * loop top they end on. `filter in`, `bloom` and `duck` are how the new
 * layer ARRIVES, so they are armed on the change itself. DiscoverPanel's
 * radioGestureLeadsChange owns that split; nothing here needs to know it
 * except that the two halves exist. */
export type RadioTransitionKind = 'cut' | 'hole' | 'filter in' | 'bloom' | 'duck' | 'riser'

/** THE TEMPERAMENT CHOOSES THE MOOD, THE KIND CHOOSES THE WEIGHTS.
 *
 * A single fixed transition is a rhythm -- the same failure the pace
 * windows exist to avoid; it would be perverse to randomise WHEN a change
 * happens and then make HOW it happens perfectly predictable. And a
 * per-kind matrix is musically right (a drum layer cutting while a pad
 * blooms is obviously correct) but it is a grid the user has to fill in,
 * which is a lot of UI for a control that should be pressed and listened
 * to.
 *
 * So the menu picks a temperament and the changing slot's kind picks the
 * weights inside it. Per-kind musicality, zero per-kind UI, and the whole
 * table is a pure value so it can be argued with and adjusted without
 * touching a component. */
type WeightTable = Partial<Record<RadioTransitionKind, number>>

const DRUMMY: { subtle: WeightTable; bold: WeightTable } = {
  // A drum layer wants a cut or a hole. A bloom on drums is a wash.
  subtle: { cut: 0.6, hole: 0.3, 'filter in': 0.1 },
  bold: { cut: 0.35, hole: 0.35, 'filter in': 0.1, duck: 0.1, riser: 0.1 }
}

const PADDY: { subtle: WeightTable; bold: WeightTable } = {
  // A pad or a texture is where a filter sweep and a reverb bloom belong.
  subtle: { cut: 0.4, 'filter in': 0.4, bloom: 0.2 },
  bold: { cut: 0.2, 'filter in': 0.3, bloom: 0.25, duck: 0.15, riser: 0.1 }
}

const MELODIC: { subtle: WeightTable; bold: WeightTable } = {
  subtle: { cut: 0.5, hole: 0.2, 'filter in': 0.3 },
  bold: { cut: 0.3, hole: 0.15, 'filter in': 0.25, bloom: 0.1, duck: 0.1, riser: 0.1 }
}

/** `drums` first, because a combination slot carrying it is a drum layer
 * for this purpose whatever else it also carries -- the same "strongest
 * eligible kind wins" reading radioDropOut's own weighting uses. The four
 * trait kinds (bassHeavy/rhythmic/bright/warm) have no instrument identity
 * and fall to PADDY, which is where a sweep and a bloom belong. */
function tableFor(temperament: 'subtle' | 'bold', kinds: readonly DiscoverSlotKind[]): WeightTable {
  if (kinds.includes('drums')) return DRUMMY[temperament]
  if (kinds.includes('bass') || kinds.includes('lead')) return MELODIC[temperament]
  if (kinds.length > 0) return PADDY[temperament]
  return { cut: 1 }
}

/** Which transition this change gets. `off` is always `cut`, which is
 * exactly what shipped 2026-09-26 -- and `cut` arms nothing at all, so a
 * cut project is byte-identical to a pre-transition one. */
export function pickTransition(
  temperament: RadioTransitions,
  kinds: readonly DiscoverSlotKind[],
  random: () => number = Math.random
): RadioTransitionKind {
  if (temperament === 'off') return 'cut'
  const table = tableFor(temperament, kinds)
  const entries = Object.entries(table) as [RadioTransitionKind, number][]
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  if (!(total > 0)) return 'cut'
  let draw = random() * total
  for (const [kind, weight] of entries) {
    draw -= weight
    if (draw < 0) return kind
  }
  return 'cut'
}

/** True for the two gestures that ANNOUNCE a change rather than decorate
 * its arrival.
 *
 * A hole is the outgoing layer leaving a gap for the new one to land in,
 * and a riser is a sweep INTO the moment -- both of them are over by the
 * time the change happens, so both are meaningless armed after it. Since
 * every curve in this file is anchored to the loop top (see
 * buildFilterInCurve), "before the change" and "the change waits for the
 * loop top this gesture ends on" are the same sentence, and that is what
 * DiscoverPanel does with this answer: arm the gesture now, hold the
 * commit back to the next wrap, land them together.
 *
 * `filter in`, `bloom` and `duck` are how the new layer ARRIVES, so they
 * are armed on the change itself and need no hold. */
export function radioGestureLeadsChange(kind: RadioTransitionKind): boolean {
  return kind === 'hole' || kind === 'riser'
}

/** No gesture may run into the wrap it is anchored to. The same rule, for
 * the same reason, that FadeGain.cpp:33-51 already applies to clip fades. */
function clampToHalfLoop(loopBars: number, bars: number): number {
  return Math.min(bars, loopBars / 2)
}

/** The new layer sweeps open from closed over `bars`, starting at the loop
 * top. Values are normalised cutoffs; buildStemToolkit defaults an un-set
 * filter to lowpass, so a bare filterCutoff curve is a lowpass sweep with
 * no other field needed, and the curve holds its last value (fully open)
 * through the rest of the lap.
 *
 * This is the flagship. It is the app's own signature move, it is usually
 * more musical than a fade, and it needs exactly one curve on one stem
 * that is already in the project.
 *
 * Every curve in this file starts at bar 0 for the same reason
 * buildDropOutCurve ends there: a toolkit curve is CLIP-RELATIVE
 * (originBar, which is 0 for a preview clip at startBar 0) and the
 * transport wraps at loopLengthBars, so a curve repeats every lap and can
 * only be anchored to the top of the loop. That is the anchor Elling
 * asked for -- "not just the downbeat, the proper start of the loop" --
 * and the mechanism does not merely permit it, it insists on it. Nothing
 * here reads a clock, so a hundred milliseconds of jitter in WHEN the
 * curve is armed has exactly zero effect on WHEN it fires. */
export function buildFilterInCurve(loopBars: number, bars: number): AutomationPoint[] {
  if (!(loopBars > 0) || !(bars > 0)) return []
  return [
    { bar: 0, value: 0 },
    { bar: clampToHalfLoop(loopBars, bars), value: 1 }
  ]
}

/** How wet the incoming layer arrives. 0.7 rather than 1 because a send at
 * full is a wash rather than a bloom. */
const BLOOM_SEND = 0.7

/** The new layer arrives drenched and dries out. */
export function buildBloomCurve(loopBars: number, bars: number): AutomationPoint[] {
  if (!(loopBars > 0) || !(bars > 0)) return []
  return [
    { bar: 0, value: BLOOM_SEND },
    { bar: clampToHalfLoop(loopBars, bars), value: 0 }
  ]
}

/** How far the OTHER layers dip so the new one lands in space. About 7dB. */
const DUCK_FLOOR = 0.45

/** Applied to every audible slot EXCEPT the changing one.
 *
 * This is the one curve that lands on stems nothing is changing, and it is
 * a `volume` curve, so while it is armed those stems' EngineStem.volume is
 * inert (PlaybackEngine.cpp's volumeAutomated branch) and their gain drags
 * stop reaching the engine live. That is why a duck lives exactly one lap
 * and why every path that ends a gesture clears it -- see DiscoverPanel's
 * clearRadioGesture. */
export function buildDuckCurve(loopBars: number, bars: number): AutomationPoint[] {
  if (!(loopBars > 0) || !(bars > 0)) return []
  return [
    { bar: 0, value: DUCK_FLOOR },
    { bar: clampToHalfLoop(loopBars, bars), value: 1 }
  ]
}

/** A noise sweep INTO the change: it ends exactly at the loop top it
 * announces, so it is placed at loopBars - lengthBars.
 *
 * Generated live by the engine (NoiseRiser.cpp, straight into the
 * channel's bus) -- there is no file, no render and no cache. Risers are
 * rendered audio only on EXPORT, which is what makes a riser into a change
 * cheap enough to draw for one lap and throw away.
 *
 * Unlike the stem curves this is NOT clip-relative: a RiserClip's startBar
 * is an absolute arrangement bar, and the Discover preview's one rifff
 * sits at startBar 0, so loop-relative and absolute are the same number
 * here. `id` is stable per channel so a re-sync of the same armed riser
 * cannot produce two. `level` is well under the 0.6 a hand-dropped riser
 * gets (RISER_DEFAULTS): this one is announcing a layer change under a
 * full mix, not being the moment itself. */
export function buildTransitionRiser(
  channelId: string,
  loopBars: number,
  bars: number
): RiserClip | null {
  if (!(loopBars > 0) || !(bars > 0)) return null
  const lengthBars = clampToHalfLoop(loopBars, bars)
  return {
    id: `radio-riser-${channelId}`,
    channelId,
    startBar: loopBars - lengthBars,
    lengthBars,
    startCutoffValue: 0.2,
    endCutoffValue: 0.95,
    curve: [],
    level: 0.35,
    name: 'radio',
    muted: false
  }
}

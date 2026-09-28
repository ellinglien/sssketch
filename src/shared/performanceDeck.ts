import type { AutomationPoint } from './toolkit'

/** The master strip's arithmetic -- one fader and one reverb send over the
 * WHOLE Discover/radio preview mix.
 *
 * `docs/superpowers/specs/2026-09-28-performance-mode-design.md` section 4A.
 * This module is phase 3 of that spec's plan only; the deck (the card state
 * machine and the set arithmetic) is phase 1 and is not built yet, so this
 * file is deliberately just the master half for now.
 *
 * Everything here is in the WIRE's 0-1 domain. The `Dial` component the
 * strip is drawn with is 0-100 (Dial.tsx), and the conversion happens
 * exactly once, at each push -- a second unit floating around is how one of
 * these ends up a hundred times too loud. */

/** The master level that changes nothing. */
export const MASTER_LEVEL_UNITY = 1

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  return value > 1 ? 1 : value
}

/** Each slot's own gain, scaled by the master fader.
 *
 * MULTIPLICATIVE, not a replacement: a master fader scales the mix and
 * preserves the balance the user set slot by slot. Setting every slot to the
 * master value would be a different and much worse control.
 *
 * Clamped into [0,1] because the value goes to set-live-param, where a
 * NEGATIVE number is the wire's "clear this override" sentinel
 * (IpcServer.cpp:338-342) -- a negative master would silently un-scale the
 * mix instead of silencing it. Above unity is clamped rather than allowed:
 * there is no headroom meter here, and a master that can clip is a worse
 * default than one that cannot. */
export function masterScaledGains(
  slotGains: ReadonlyMap<string, number>,
  masterLevel: number
): Map<string, number> {
  const level = clamp01(masterLevel)
  const out = new Map<string, number>()
  for (const [key, gain] of slotGains) out.set(key, clamp01(gain) * level)
  return out
}

/** One reverb send value, applied to every stem in the preview.
 *
 * The engine's reverb is ONE shared bus fed by per-stem sends
 * (ReverbBus.h:38-58), so N equal sends into it IS a master send -- there is
 * nothing being approximated here, unlike the master filter (spec 4A.3).
 *
 * Returns {} at zero so the caller writes no sends at all and
 * isStemToolkitNeutral drops the toolkit key entirely, leaving the project
 * bit-identical to one built without this feature. */
export function masterSendsFor(stemKeys: readonly string[], send: number): Record<string, number> {
  const value = clamp01(send)
  if (value <= 0) return {}
  const out: Record<string, number> = {}
  for (const key of stemKeys) out[key] = value
  return out
}

/** A radio gesture's `volume` curve, brought under the master fader (and
 * under the slot's own gain, which a curve otherwise also ignores).
 *
 * This exists because of one engine rule: a non-empty `volume` curve makes
 * `EngineStem.volume` INERT (`PlaybackEngine.cpp:317-329`, `volumeAutomated`)
 * -- the clip runs at the curve's own value and the live-param override the
 * master fader writes is not consulted at all. So a `duck`, which writes a
 * volume curve onto every OTHER audible layer, would slam those layers back
 * to full for the length of the gesture however far the master is pulled
 * down. Multiplying the curve is what keeps the master honest through a
 * gesture, and it is the same multiply `masterScaledGains` does on the
 * live-param side -- one rule, applied on whichever side is actually
 * reading the number.
 *
 * Note what this does NOT do: it does not drop the curve at scale 0. A
 * dropped curve is an un-automated stem, which hands the clip straight back
 * to the live-override path in the middle of a gesture. Silence is a scaled
 * curve, not a missing one. */
export function masterScaledCurve(
  points: readonly AutomationPoint[],
  scale: number
): AutomationPoint[] {
  const factor = clamp01(scale)
  return points.map((point) => ({ bar: point.bar, value: clamp01(point.value) * factor }))
}

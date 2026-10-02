// src/shared/radioDropOut.ts
//
// The two pieces of radio's standalone drop-out that outlived it: how long a drop is
// (pickDropOutBeats) and the curve that plays it (buildDropOutCurve). The drop-out itself --
// one layer muted for a few beats now and then (docs/superpowers/specs/2026-09-28-radio-
// controls-design.md section 4) -- became one move of the phrase turnaround on 2026-10-02
// (radioTurnaround.ts; docs/superpowers/specs/2026-10-02-radio-turnarounds-design.md). A hole,
// the density arc's exit and every turnaround drop are made of these two.
//
// Pure, with its randomness injected.
import type { AutomationPoint } from './toolkit'

/** How long, in beats. Weighted rather than fixed for the same reason the
 * pace is a window rather than a number: a fixed length is a rhythm, a
 * varied length is a gesture. Two beats is the safe and common one; a full
 * bar is the dramatic one. */
const DROP_OUT_BEAT_WEIGHTS: { beats: number; weight: number }[] = [
  { beats: 1, weight: 0.2 },
  { beats: 2, weight: 0.5 },
  { beats: 4, weight: 0.3 }
]

export function pickDropOutBeats(random: () => number = Math.random): number {
  let draw = random()
  for (const { beats, weight } of DROP_OUT_BEAT_WEIGHTS) {
    draw -= weight
    if (draw < 0) return beats
  }
  return DROP_OUT_BEAT_WEIGHTS[DROP_OUT_BEAT_WEIGHTS.length - 1].beats
}

/** 4/4, as everywhere else in Discover. */
const BEATS_PER_BAR = 4

/** The ramp in and out of silence, in bars. Short enough to read as a cut,
 * long enough not to pop -- the same order as FadeGain's own ~3ms
 * anti-click and the phone's 15ms MUTE_RAMP. At 120bpm 0.02 bars is 40ms;
 * at 160 it is 30ms. Expressed in bars rather than ms because everything
 * on an automation lane is, and because a bar-relative ramp means the same
 * thing at every tempo. */
const DROP_OUT_RAMP_BARS = 0.02

/**
 * The whole drop-out, as one `volume` curve in CLIP-RELATIVE bars, ready
 * to go into previewState.stemAutomation[stemKey(groupId, slot)].
 *
 * THIS IS THE ENTIRE REASON THE FEATURE IS ACCURATE. Elling, 2026-09-28:
 * "also make sure to transition on the proper beat... that's key" and then
 * "not just the downbeat, the proper start of the loop, i think".
 *
 * Radio's clock is a React effect fed at 30Hz, so a gesture FIRED from it
 * would be up to 33ms late plus a render plus an IPC round trip, every
 * time. A curve is different in kind: it is part of the material the
 * engine is already playing, evaluated per block and smoothed per sample
 * (AutomationCurve.h's ParamSmoother, kAutomationSmoothingSec = 0.015), so
 * the 30Hz tick is nowhere in the timed path. Arming can be a whole lap
 * early and a hundred milliseconds of jitter in WHEN it is armed has
 * exactly zero effect on WHEN it fires.
 *
 * And the anchor comes free. A toolkit curve is clip-relative (originBar,
 * which is 0 for a preview clip at startBar 0) and the transport wraps at
 * loopLengthBars, so the curve REPEATS EVERY LAP and can only be anchored
 * to the top of the loop. The constraint is the requirement.
 *
 * Read the shape: full gain at bar 0 (the return -- the curve resets here
 * on every wrap), holding until `beats` before the end, a short ramp to
 * silence, silent through to the wrap. Durations count BACKWARDS from the
 * return, never forwards from the trigger; building it the other way round
 * is the single most likely way to make this sound broken.
 *
 * Clamped to half the loop so a gesture can never run into the wrap it is
 * anchored to -- the same rule, for the same reason, that FadeGain.cpp
 * already applies to clip fades. Returns [] for anything it cannot place,
 * which the caller treats as "no drop-out this time" rather than an error.
 */
export function buildDropOutCurve(loopBars: number, beats: number): AutomationPoint[] {
  if (!(loopBars > 0) || !(beats > 0)) return []
  const wanted = beats / BEATS_PER_BAR
  const dropBars = Math.min(wanted, loopBars / 2)
  const leaveAt = loopBars - dropBars
  const silentAt = leaveAt + Math.min(DROP_OUT_RAMP_BARS, dropBars / 2)
  if (!(leaveAt > 0) || !(silentAt < loopBars)) return []
  return [
    { bar: 0, value: 1 },
    { bar: leaveAt, value: 1 },
    { bar: silentAt, value: 0 },
    { bar: loopBars, value: 0 }
  ]
}

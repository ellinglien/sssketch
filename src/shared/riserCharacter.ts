// src/shared/riserCharacter.ts -- what a riser sounds like, drawn per riser (Elling, 2026-10-01:
// "can the noise sweep vary a bit too? it seems a bit anemic sometimes"). Pure: an injected
// random draws the character; the radio's riserVoice.ts (and, natively, NoiseRiser) plays it.
// Only the character varies: the riser's length and timing are sssketch's
// (buildTransitionRiser), always. Moved here from ell.ing/radio's src/audio/riserCharacter.ts
// by the native radio sound plan, Task 0; the radio re-exports it.

export interface RiserCharacter {
  /** Pink has more body (more low end under the sweep); white is sssketch's. */
  colour: 'white' | 'pink'
  /** The bandpass's Q: 2 was sssketch's (kRiserBandwidthQ); higher is a resonant, whistling
   * sweep. The voice keeps the level independent of it. */
  q: number
  /** The sweep's ends on the normalised cutoff scale (20 Hz..20 kHz, log). */
  startCutoff: number
  endCutoff: number
  /** The sweep's shape: cutoff = start + (end - start) * progress ^ curve; 1 is sssketch's line. */
  curve: number
  /** 'wide': a different noise in each side (decorrelated); 'mono': one noise in both. */
  stereo: 'wide' | 'mono'
  /** Level relative to sssketch's radio riser (level 0.35), dB. */
  levelDb: number
  /** Send into the reverb, 0..1, so the riser blooms into the room. */
  send: number
}

export const RISER_RANGES = {
  pinkShare: 0.5,
  /** Q 1-3 usually; 3-6 (a resonant sweep) this often. */
  resonantShare: 0.2,
  q: [1, 3] as const,
  resonantQ: [3, 6] as const,
  startCutoff: [0.1, 0.3] as const,
  endCutoff: [0.85, 1] as const,
  /** Log-uniform: a slight bow either way. */
  curve: [0.8, 1.25] as const,
  monoShare: 0.15,
  /** +3 dB on sssketch's 0.35, +-2. */
  levelDb: [1, 5] as const,
  send: [0.2, 0.4] as const
}

/** The riser as it was before any of this: sssketch's buildTransitionRiser through a Q 2 bandpass. */
export const RISER_BEFORE: RiserCharacter = {
  colour: 'white',
  q: 2,
  startCutoff: 0.2,
  endCutoff: 0.95,
  curve: 1,
  stereo: 'wide',
  levelDb: 0,
  send: 0
}

const between = (r: number, [lo, hi]: readonly [number, number]): number => lo + (hi - lo) * r

export function drawRiserCharacter(random: () => number): RiserCharacter {
  const R = RISER_RANGES
  const colour = random() < R.pinkShare ? 'pink' : 'white'
  const q = random() < R.resonantShare ? between(random(), R.resonantQ) : between(random(), R.q)
  const startCutoff = between(random(), R.startCutoff)
  const endCutoff = between(random(), R.endCutoff)
  const curve = Math.exp(between(random(), [Math.log(R.curve[0]), Math.log(R.curve[1])]))
  const stereo = random() < R.monoShare ? 'mono' : 'wide'
  const levelDb = between(random(), R.levelDb)
  const send = between(random(), R.send)
  return { colour, q, startCutoff, endCutoff, curve, stereo, levelDb, send }
}

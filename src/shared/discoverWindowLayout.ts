// src/shared/discoverWindowLayout.ts
//
// Discover's rows all show the same window of bars, so a bar is the same
// width everywhere and no row rescales when a longer or shorter stem
// arrives elsewhere (Elling, 2026-09-29; docs/superpowers/specs/2026-09-29-
// discover-fixed-waveform-window-design.md). Everything here is a
// percentage of that window, so the row stays fluid-width with no DOM
// measurement -- the same trick the old inline tiling used.

/** 32 bars covers essentially every stem in a real library -- in Elling's
 * own (545,299 stems) only 1.2% are longer than 16 bars. A longer LOOP
 * grows the window rather than being cropped. */
export const DISCOVER_WINDOW_BARS = 32

/** Every tile renders its own <Waveform> (dozens of SVG rects), twice --
 * the grey layer and the colour layer. The cap is what keeps a sub-bar
 * one-shot from asking for hundreds of them: such a stem is drawn at the
 * minimum tile width instead. One tile per bar at the default window. */
export const DISCOVER_MAX_TILES = 32

const EPS = 1e-9

export interface DiscoverWindowLayout {
  windowBars: number
  tiles: { leftPct: number; widthPct: number }[]
  /** The row's own stem starting over -- arrange's restart line. Never at
   * the left edge, never where a loop-top line already is. */
  restartLinePcts: number[]
  /** The whole loop wrapping, on every row -- where changes land. */
  loopTopLinePcts: number[]
}

export function discoverWindowLayout({
  stemBars,
  loopBars,
  minWindowBars = DISCOVER_WINDOW_BARS
}: {
  stemBars: number
  loopBars: number
  minWindowBars?: number
}): DiscoverWindowLayout {
  const stem = stemBars > 0 ? stemBars : loopBars > 0 ? loopBars : 1
  const loop = loopBars > 0 ? loopBars : stem
  const windowBars = Math.max(minWindowBars, loop)
  const tileBars = Math.max(stem, windowBars / DISCOVER_MAX_TILES)
  const pct = (bars: number): number => (bars / windowBars) * 100

  const tileCount = Math.ceil(windowBars / tileBars - EPS)
  const tiles = Array.from({ length: tileCount }, (_, i) => ({
    leftPct: pct(i * tileBars),
    widthPct: pct(tileBars)
  }))

  const loopTopLinePcts: number[] = []
  for (let i = 1; i * loop < windowBars - EPS; i++) loopTopLinePcts.push(pct(i * loop))

  const restartLinePcts = tiles
    .slice(1)
    .map((t) => t.leftPct)
    .filter((p) => !loopTopLinePcts.some((q) => Math.abs(q - p) < 1e-6))

  return { windowBars, tiles, restartLinePcts, loopTopLinePcts }
}

/** One playhead per lap, all at the same place in their own lap -- so the
 * copies reach a loop-top line together, at the instant the loop wraps
 * (Elling's choice, 2026-09-29, over a single sweep across the window). */
export function discoverPlayheadPcts(pos: number, loopBars: number, windowBars: number): number[] {
  if (!Number.isFinite(pos) || !(loopBars > 0) || !(windowBars > 0)) return []
  const inLap = ((pos % loopBars) + loopBars) % loopBars
  const out: number[] = []
  for (let k = 0; k * loopBars + inLap < windowBars - EPS; k++) {
    out.push(((k * loopBars + inLap) / windowBars) * 100)
  }
  return out
}

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

/** Where the ONE playhead sits, as a percentage of the window. It sweeps
 * across as many WHOLE laps as fit, then returns to the left edge -- so a
 * 12-bar loop in a 32-bar window sweeps 24 bars and never restarts mid-lap
 * at the left edge, where every row's tiles show bar 0 of their stem. A
 * loop at least as long as the window is a single sweep. `lapIndex` counts
 * loop wraps since the preview started (DiscoverPanel keeps it); `pos` is
 * the transport position in bars and is wrapped into the lap here.
 * Elling, 2026-09-30: "shouldn't it be one long one moving across all of
 * them?" -- replacing the earlier one-playhead-per-lap. */
export function discoverSweepPct(
  lapIndex: number,
  pos: number,
  loopBars: number,
  windowBars: number
): number | null {
  if (
    !Number.isFinite(lapIndex) ||
    !Number.isFinite(pos) ||
    !Number.isFinite(loopBars) ||
    !Number.isFinite(windowBars) ||
    !(loopBars > 0) ||
    !(windowBars > 0)
  ) {
    return null
  }
  const inLap = ((pos % loopBars) + loopBars) % loopBars
  const lapsPerSweep = Math.max(1, Math.floor(windowBars / loopBars + EPS))
  const lap = Math.floor(lapIndex)
  const lapInSweep = ((lap % lapsPerSweep) + lapsPerSweep) % lapsPerSweep
  return ((lapInSweep * loopBars + inLap) / windowBars) * 100
}

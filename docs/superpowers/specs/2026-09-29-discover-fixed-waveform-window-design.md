# Discover: a fixed 32-bar waveform window — design

2026-09-29. Agreed with Elling:

> "i'd like the discover lengths to be the same for each waveform.. like a fixed time for each
> tempo, with the stems looped as many times to fit ... so it doesn't change length depending on if
> it['s a long or short stem]"
>
> "the loop points should be displayed clearly, like in arrange.. lines between each loop"
>
> Window: "length of the longest stem we'd realistically load", then 32 bars. Longer stems: "try to
> avoid that". Playhead: one in every lap, moving together.

## The problem

Each Discover row tiles its stem against `maxBarLength`, which is the longest stem currently
resolved in the loop. A row is therefore always one loop wide. When a 16-bar stem arrives, every
other row suddenly shows its 4-bar stem four times, squeezed into the same width. When that stem
leaves, every row stretches back. The picture keeps changing scale depending on which stems happen
to be loaded.

## The design

### A fixed window

Every row shows the same **window of bars**: `windowBars = max(32, loopBars)`.

In Elling's own library (545,299 stems, measured 2026-09-29):

| stem length | share |
|---|---|
| 8 bars or less | 93% |
| 16 bars or less | 99% |
| more than 16 bars | 1.2% |

So 32 bars covers essentially everything real. The longest stem in the library is a 760-bar
recording, which is why "the longest possible" was never the target. If a stem longer than 32 bars
is actually in the loop, the window grows to the loop's length while it is there. Nothing is
cropped or scrolled. This affects about one row in a hundred, and only while that stem plays.

A bar has the same width in every row. A row's width never depends on the other rows.

### Tiling

Each row repeats its stem from bar 0 to fill the whole window: `windowBars / stemBars` copies, the
last one cut off at the window edge. This is the same arithmetic as today (`tileOffsetsPx`), only
against the window instead of `maxBarLength`.

### Loop lines

Two kinds of lines, both monochrome and full height, with `pointer-events: none`:

- **Stem restart lines.** A line at every point the row's own stem starts over, except the window's
  left edge. They use the arrange view's exact style (`StemWaveformRow.tsx`'s restart lines: 1px,
  `color-mix(in srgb, var(--ra-text) 35%, transparent)`).
- **Loop-top lines.** A line at every multiple of `loopBars` inside the window, on every row. They
  are drawn a step stronger (1px, `color-mix(in srgb, var(--ra-text) 70%, transparent)`) because
  this is where the whole loop wraps and where radio's changes land. Where a stem restart line and a
  loop-top line fall on the same bar, only the loop-top line is drawn.

The arrange view's restart line is currently inlined in `StemWaveformRow.tsx`. `BeatPicker.tsx`
computes the same boundaries (`tileBoundaryPcts`). This feature lifts the line into one small shared
component, `LoopLines`, which takes percentages and a strength. `StemWaveformRow` and the Discover
row both use it. `BeatPicker` moves to it only if doing so is a pure refactor.

### The playhead: one per lap

The engine loop is `loopBars` long and the window is `windowBars`. A red playhead is drawn at
`pos` inside **every** loop-length section of the window: at `k·loopBars + pos` for every `k` where
that point falls inside the window. All the copies move together.

This keeps today's meaning. When the playheads reach a loop-top line, the loop wraps, and that is
where a radio change or a waiting manual change lands. The row's breathing still says "something is
coming", and the playhead still says "when", exactly as designed on 2026-09-29.

When the loop is the window (32 bars, or a longer loop that grew the window), there is one
playhead, as today.

The playhead only shows while a preview is loaded, as today.

### What is unchanged

- The gain overlay, mute greying, click-to-preview, the breathing animation, and everything about
  radio.
- Engine behaviour. This is display only.

## How it is built

- **Pure layout, test-first.** A new module, `src/shared/discoverWindowLayout.ts`, exports
  `discoverWindowLayout({ stemBars, loopBars, minWindowBars = 32 })`. It returns, as percentages of
  the window:
  - `windowBars`
  - `tiles: { leftPct, widthPct }[]`
  - `restartLinePcts`
  - `loopTopLinePcts`

  Restart lines that coincide with a loop-top line (to 1e-6 of a percent) are removed. It also exports
  `discoverPlayheadPcts(pos, loopBars, windowBars)`, one percentage per lap.

  It handles `stemBars <= 0` and `loopBars <= 0` safely, as today's code does: treat a missing loop
  as the stem's own length.
- **The tile cap stays.** Today's `MAX_TILES = 24` guard exists because every tile renders a
  `<Waveform>` of dozens of SVG rects, twice (the grey layer and the colour layer).
  - With a 32-bar window, a 1-bar stem needs 32 tiles. The cap rises to **32** and moves into the
    layout module.
  - A stem shorter than `windowBars / 32` is drawn at that minimum tile width. That is less than 1
    bar only for about 1% of the library (sub-bar one-shots). This is the same trade today's cap
    already makes.
  - **Performance risk:** up to 32 × 2 `<Waveform>`s per row. Six rows is about 384. Every tile is
    an identical copy, so if rendering cost shows up, the fix is to render the stem's SVG once and
    reuse it (`<svg><defs>` + `<use>`), not to lower the cap. Elling's walkthrough should include a
    six-row loop with 1-bar drums.
- **The row** replaces its inline tiling and playhead math with the layout module's output, and
  renders `LoopLines` for both kinds of line. `DiscoverPanel` passes `pos` and `loopBars` down
  instead of the single `playheadPct`.
- **`StemWaveformRow`** renders its restart lines through `LoopLines`. It must look exactly the same
  as before.

## Verification

- `npx vitest run`, `npm run typecheck`, `npm run lint`.
- **Needs Elling:**
  - rows keep their scale when a longer or shorter stem arrives;
  - both kinds of loop line read clearly;
  - the playheads move together and reach the loop-top line when the loop wraps;
  - a stem longer than 32 bars grows the window, and it shrinks back when that stem leaves;
  - scrolling and playback stay smooth with six rows of short stems;
  - the arrange view's loop lines are unchanged.

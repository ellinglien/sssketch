# Discover fixed 32-bar waveform window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Discover row shows the same 32-bar window, which widens only for a longer loop. Stems are tiled to fill it, with the arrange view's loop lines, a stronger loop-top line, and one playhead per lap.

**Architecture:**
- A pure layout module computes tiles, lines and playheads as percentages, test-first.
- A tiny shared `LoopLines` component draws the lines. The arrange view's `StemWaveformRow` switches to it without looking any different.
- The Discover row replaces its inline tiling and playhead maths with the module's output.

**Tech Stack:** TypeScript, React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-discover-fixed-waveform-window-design.md`

---

## Ground rules

- Read `CLAUDE.md`. Monochrome chrome, no `border-radius`, and colour only on audio information.
- Stage explicit paths only; never `git add -A`.
- `DiscoverPanel.tsx` is about 8,000 lines. Anchor on quoted code, not line numbers.
- After each task, `npm run typecheck`, `npx vitest run` and eslint on the changed files must all be clean.
- No agent can see the app. Never claim a visual result.

## File map

| file | change |
|---|---|
| `src/shared/discoverWindowLayout.ts` | **create** (Task 1) |
| `src/shared/discoverWindowLayout.test.ts` | **create** (Task 1) |
| `src/renderer/src/components/LoopLines.tsx` | **create** (Task 2) |
| `src/renderer/src/components/StemWaveformRow.tsx` | restart lines through `LoopLines` (Task 2) |
| `src/renderer/src/components/DiscoverPanel.tsx` | row uses the layout module (Task 2) |

---

### Task 1: The layout module

**Files:** Create `src/shared/discoverWindowLayout.ts` and `src/shared/discoverWindowLayout.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  DISCOVER_MAX_TILES,
  DISCOVER_WINDOW_BARS,
  discoverPlayheadPcts,
  discoverWindowLayout
} from './discoverWindowLayout'

describe('discoverWindowLayout', () => {
  it('is 32 bars wide whatever the stem, while the loop fits', () => {
    expect(DISCOVER_WINDOW_BARS).toBe(32)
    expect(discoverWindowLayout({ stemBars: 4, loopBars: 16 }).windowBars).toBe(32)
    expect(discoverWindowLayout({ stemBars: 1, loopBars: 4 }).windowBars).toBe(32)
  })

  it('grows to a loop longer than the window', () => {
    expect(discoverWindowLayout({ stemBars: 48, loopBars: 48 }).windowBars).toBe(48)
  })

  it('tiles the stem from bar 0 across the window', () => {
    const { tiles } = discoverWindowLayout({ stemBars: 4, loopBars: 16 })
    expect(tiles).toHaveLength(8)
    expect(tiles[0]).toEqual({ leftPct: 0, widthPct: 12.5 })
    expect(tiles[7]).toEqual({ leftPct: 87.5, widthPct: 12.5 })
  })

  it('cuts the last tile at the window edge rather than dropping it', () => {
    // 32 / 12 = 2.67 -- three tiles, the third overhanging.
    const { tiles } = discoverWindowLayout({ stemBars: 12, loopBars: 12 })
    expect(tiles.map((t) => t.leftPct)).toEqual([0, 37.5, 75])
  })

  it('draws a loop-top line at every multiple of the loop inside the window', () => {
    expect(discoverWindowLayout({ stemBars: 4, loopBars: 16 }).loopTopLinePcts).toEqual([50])
    expect(discoverWindowLayout({ stemBars: 4, loopBars: 8 }).loopTopLinePcts).toEqual([
      25, 50, 75
    ])
    expect(discoverWindowLayout({ stemBars: 32, loopBars: 32 }).loopTopLinePcts).toEqual([])
  })

  it('draws a restart line at every repeat except the left edge and any loop top', () => {
    expect(discoverWindowLayout({ stemBars: 4, loopBars: 16 }).restartLinePcts).toEqual([
      12.5, 25, 37.5, 62.5, 75, 87.5
    ])
  })

  it('draws no restart lines for a stem as long as the window', () => {
    expect(discoverWindowLayout({ stemBars: 32, loopBars: 32 }).restartLinePcts).toEqual([])
  })

  it('never draws more than DISCOVER_MAX_TILES tiles', () => {
    expect(DISCOVER_MAX_TILES).toBe(32)
    const { tiles } = discoverWindowLayout({ stemBars: 0.25, loopBars: 4 })
    expect(tiles).toHaveLength(32)
    expect(tiles[1].leftPct).toBeCloseTo(100 / 32)
  })

  it('treats a missing stem or loop length safely', () => {
    expect(discoverWindowLayout({ stemBars: 0, loopBars: 8 }).tiles).toHaveLength(4)
    expect(discoverWindowLayout({ stemBars: 4, loopBars: 0 }).windowBars).toBe(32)
    expect(discoverWindowLayout({ stemBars: 0, loopBars: 0 }).tiles.length).toBeGreaterThan(0)
  })
})

describe('discoverPlayheadPcts', () => {
  it('puts one playhead in each lap, all at the same place in their lap', () => {
    expect(discoverPlayheadPcts(3, 16, 32)).toEqual([9.375, 59.375])
  })

  it('drops a lap copy that would fall past the window', () => {
    expect(discoverPlayheadPcts(10, 12, 32)).toEqual([31.25, 68.75])
    expect(discoverPlayheadPcts(2, 12, 32)).toEqual([6.25, 43.75, 81.25])
  })

  it('is a single playhead when the loop fills the window', () => {
    expect(discoverPlayheadPcts(8, 32, 32)).toEqual([25])
  })

  it('wraps a position at or past the loop length', () => {
    expect(discoverPlayheadPcts(16, 16, 32)).toEqual([0, 50])
  })

  it('draws nothing it cannot place', () => {
    expect(discoverPlayheadPcts(Number.NaN, 16, 32)).toEqual([])
    expect(discoverPlayheadPcts(1, 0, 32)).toEqual([])
    expect(discoverPlayheadPcts(1, 16, 0)).toEqual([])
  })
})
```

- [ ] **Step 2: Run and verify it fails**

Run `npx vitest run src/shared/discoverWindowLayout.test.ts`. Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run and verify it passes**

Run the test file, then `npm run typecheck`, then eslint on both files.

- [ ] **Step 5: Commit**

```bash
git add src/shared/discoverWindowLayout.ts src/shared/discoverWindowLayout.test.ts
git commit -m "the layout of a fixed discover window: tiles, loop lines, a playhead per lap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared loop lines, and the row on the new layout

**Files:**
- Create `src/renderer/src/components/LoopLines.tsx`.
- Modify `StemWaveformRow.tsx` and `DiscoverPanel.tsx`.

- [ ] **Step 1: `LoopLines`**

```tsx
// src/renderer/src/components/LoopLines.tsx
//
// Vertical loop markers over a tiled waveform. One component, so the
// arrange view and Discover cannot drift apart (Elling, 2026-09-29: "the
// loop points should be displayed clearly, like in arrange.. lines between
// each loop"). Monochrome and non-interactive.

/** `restart`: the stem starting over -- arrange's long-standing line.
 * `loopTop`: the whole loop wrapping -- a step stronger, because that is
 * where changes land. */
const LINE_COLOR: Record<'restart' | 'loopTop', string> = {
  restart: 'color-mix(in srgb, var(--ra-text) 35%, transparent)',
  loopTop: 'color-mix(in srgb, var(--ra-text) 70%, transparent)'
}

export function LoopLines({
  lefts,
  kind
}: {
  /** CSS `left` values -- `'40px'` or `'12.5%'`. */
  lefts: readonly string[]
  kind: 'restart' | 'loopTop'
}): React.JSX.Element {
  return (
    <>
      {lefts.map((left, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left,
            width: 1,
            background: LINE_COLOR[kind],
            pointerEvents: 'none'
          }}
        />
      ))}
    </>
  )
}
```

- [ ] **Step 2: `StemWaveformRow` uses it without looking any different**

Replace the block that draws `tileOffsets.slice(1).map((left) => <div ... background: 'color-mix(in srgb, var(--ra-text) 35%, transparent)' ... />)` with:

```tsx
          {tileOffsets.length > 1 && (
            <LoopLines lefts={tileOffsets.slice(1).map((left) => `${left}px`)} kind="restart" />
          )}
```

Keep the comment above it, and add "Drawn by the shared LoopLines, which Discover's rows also use." Check that the old line elements had no other style properties (z-index or similar) that `LoopLines` lacks. If they did, stop and report rather than changing `LoopLines`' look. The output must be pixel-identical.

`BeatPicker.tsx` computes `tileBoundaryPcts` and draws its own lines. Move it to `LoopLines` only if its lines are the same 1px, 35% style. Otherwise leave it and say so.

- [ ] **Step 3: The Discover row uses the layout**

In `DiscoverPanel.tsx`:

1. **Panel side.** Keep the `maxBarLength` computation (search `const playheadPct =`) as the loop length. Stop computing `playheadPct`, and pass the row the raw `pos` (or `null` when not previewing, using the same condition `playheadPct` used today) and `loopBars={maxBarLength}`.
   - Rename the row props: `playheadPct: number | null` becomes `playheadPos: number | null`. `maxBarLength` stays, and its doc comment should say it is the loop length, no longer the tiling reference.
   - Grep for every other use of the row's `playheadPct` and `maxBarLength` props and update them. The phone does not use these.
2. **Row side.** Replace the IIFE that begins `const loopBars = maxBarLength > 0 ? maxBarLength : resolvedStem.barLength` and uses `MAX_TILES`, `tileOffsetsPx`, `tileWidthPct` with:
   ```tsx
   const layout = discoverWindowLayout({
     stemBars: resolvedStem.barLength,
     loopBars: maxBarLength
   })
   const playheads =
     playheadPos === null
       ? []
       : discoverPlayheadPcts(playheadPos, maxBarLength > 0 ? maxBarLength : resolvedStem.barLength, layout.windowBars)
   ```
   - Both tile layers (grey and colour) map over `layout.tiles`. They keep index keys, since the long comment there explains why, and use `left: \`${t.leftPct}%\`` and `width: \`${t.widthPct}%\``.
   - After the colour layer and gain line, and before the playhead, render:
     ```tsx
     <LoopLines lefts={layout.restartLinePcts.map((p) => `${p}%`)} kind="restart" />
     <LoopLines lefts={layout.loopTopLinePcts.map((p) => `${p}%`)} kind="loopTop" />
     ```
   - Replace the single playhead `div` with one per entry of `playheads`, same style, index keys.
3. **The container must clip the overhanging last tile.** Check that the waveform button has `overflow: 'hidden'`. If it doesn't, add it, and check it doesn't clip anything that should overhang, such as a focus ring. Report what you found.
4. **Remove dead imports.** If `tileOffsetsPx` has no other use in `DiscoverPanel.tsx`, drop that import.
5. **Update the comments.** The long comment above the tiling ("Tiled, not a single stretched-to-fit Waveform ... `loopBars` is every row's own SAME shared reference (DiscoverPanel's own maxBarLength ...)") is now wrong about the reference. Rewrite that part to describe the fixed window and cite the spec. Keep the gain-envelope explanation. Also update the playhead comment ("Only this row's own resolved-and-tiled width is relevant ... `playheadPct` is already directly usable").

- [ ] **Step 4: Verify**

- `npm run typecheck`
- `npx vitest run` (the full suite)
- `CI=1 npx vitest run`
- `npx eslint` on all changed files (0 errors, 0 warnings)
- `npm run lint` (exactly 4 pre-existing warnings)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/LoopLines.tsx src/renderer/src/components/StemWaveformRow.tsx src/renderer/src/components/DiscoverPanel.tsx
git commit -m "discover rows share one 32-bar window, with arrange's loop lines and a playhead per lap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Add `BeatPicker.tsx` to the commit if you changed it.

- [ ] **Step 6: Manual check (hand to Elling; do not claim it)**

1. Rows keep their scale when a longer or shorter stem arrives.
2. The restart lines match the arrange view, and the loop-top lines read as stronger.
3. The playheads move together and reach a loop-top line exactly when the loop wraps. A radio change lands there.
4. A stem longer than 32 bars widens the window, and it goes back to 32 when that stem leaves.
5. Six rows of 1-bar drums stay smooth while playing and scrolling.
6. The arrange view looks exactly as before.

# Handoff: Rifff Arranger v1

## Overview

A lightweight arranger for stitching Endlesss rifffs (multi-stem jam recordings) into a finished track. Not a DAW: no MIDI, no plugin instruments, no realtime FX chains, no session/arrangement duality. The scope is exactly five things:

1. Drag-and-drop rifffs into the arranger as **linked, pre-aligned stem groups** (reference-based, never copied)
2. **Unlink** to break a group into independent stems
3. **BPM-aware time-stretch** per rifff/stem, pitch preserved
4. **Grid-snapped offset** per stem/group for fine sync correction
5. **Per-stem volume**

The recommended direction is **option 2a** (shelf + collapsed rifff blocks + inspector). Options 1a/1b/1c are earlier explorations kept in the same file for reference.

## About the Design Files

`Rifff Arranger.dc.html` is a **design reference created in HTML** — a prototype showing intended look and behavior. It is not production code to lift. The task is to **recreate these designs in the target codebase's environment** (React/Vue/Electron/native — Endlesss-adjacent tooling like OUROVEON is C++/ImGui, in which case treat this as a visual spec, not markup) using that codebase's established patterns. If no environment exists yet, pick the most appropriate stack and implement there.

The prototype's structure detail: it is a single streaming component file. Data lives in a `RIFFFS` array; all derived geometry/labels are computed in one `renderVals()` pass; markup is inline-styled. Read it for exact values, not for architecture.

## Fidelity

**High-fidelity.** Colors, type, spacing, and control behavior are final-intent. Recreate faithfully. Two caveats:

- The prototype fakes audio engine work: time-stretch and offset are **visual + numeric only** except for rifff #1, whose three real WAVs actually play (offset applied as a `currentTime` shift; no stretching).
- The 3 real stems are 80 BPM (project tempo 80). Rifffs r2/r3 are synthetic stand-ins at 96/88 BPM so the stretch readouts have something to display.

## Screens / Views

### 2a — Shelf + blocks + inspector (recommended)

**Purpose:** audition rifffs from the shelf, drag into the arrangement, tune the selected group in the inspector.

**Layout** (frame 1300px wide, `#131316`, 1px `#2a2a2f`, radius 12, `overflow:hidden`):

1. **Titlebar** — height 38, padding 0 14, bottom border `#1e1e22`. Left: `rifff arranger` (13px/700) · `|` in `#33333a` · `untitled sketch 04` in `#8a8a92`. Right: `4 rifffs referenced · 0 files copied` (10px, `#5a5a62`).
2. **Shelf** — padding 12/14, background `#101012`, bottom border `#2a2a2f`. Eyebrow `SHELF` (10px, 600, uppercase, tracking .08em, `#5a5a62`) + hint `drag one down into the arrangement · stems land linked and pre-aligned` (10px, `#33333a`). Row of cards, `display:flex; gap:10px`:
   - **Rifff card** — 212px wide, radius 8, padding 9/10, `gap:8px`. Unselected: bg `#131316`, border `#2a2a2f`. Selected: bg = rifff color @10% alpha, border = rifff color @60%. Contents: 40px polar glyph, then name (11px/700, ellipsis) + `{bpm} BPM · {n} stems · {len} bars` (9px, `#8a8a92`, tracking .06em); below, wrapping stem chips (9px, radius 3, bg = stem type color @14%, text = stem type color).
   - **Drop target** — `flex:1`, min-width 150, 1px dashed `#3a3a41`, radius 8, centered 10px `#5a5a62` copy: `drop rifff folders from finder` / `reference only, nothing copied`.
3. **Body** — `display:flex`: timeline column (`flex:1`) + inspector (308px fixed, left border `#2a2a2f`, bg `#17171a`).

**Transport bar** (height 46, bg `#17171a`, bottom border `#2a2a2f`, padding 0 14, gap 12):
- play button 36×26, radius 6, border `#3a3a41`; idle bg `#1e1e22` / text `#f2f2f4`; playing bg `#4fada0` / text `#05231d`; glyph `▶` / `❙❙`
- stop button 28×26, radius 6, border `#2a2a2f`, bg `#1e1e22`, `■` in `#8a8a92`
- position readout `001.1.1` (16px/700) + elapsed `0:00.0` (10px `#5a5a62`); format `bar.beat.16th`, bar zero-padded to 3
- tempo group inside vertical rules (`#2a2a2f`, height 26): label `tempo` (10px uppercase, tracking .08em, `#5a5a62`), −/+ buttons 20×20 radius 4, value 14px/700 width 26 centered
- `snap 1/16` chip, height 22, radius 6, border `#2a2a2f`, bg `#1e1e22`, 10px `#8a8a92` — cycles 1/4 → 1/8 → 1/16 → 1/32
- right: hint `chevron opens stems · block selects` (10px `#5a5a62`)

**Ruler** (height 24, bg `#101012`, bottom border `#2a2a2f`): 212px spacer matching the lane-header column, then absolute bar ticks every 24px (PPB2 = 24px per bar, 32 bars = 768px). Bar line `#2a2a2f` every 4 bars, else `#1c1c20`; numeric label every 8 bars (9px `#5a5a62`, 3px left padding).

**Rifff block row** (per rifff, bottom border `#1e1e22`):
- header cell 212px, height 52, right border `#2a2a2f`, gap 7, padding 0 10; bg `#16161a`, selected `#1e1e22`; cursor pointer (click selects)
  - chevron button 18×18, radius 4, border `#2a2a2f`, bg `#1e1e22`, `▸`/`▾` 9px
  - 30px polar glyph
  - name (11px/700, ellipsis) + `{n} stems · {len} bars · {bpm} bpm` (9px `#5a5a62`)
- clip area `flex:1`, height 52, position relative. Clip: absolute, top/bottom 4, `left = start*24 + offsetPx`, `width = shownBars*24`, radius 4, border = rifff color @55%, bg `rgba(255,255,255,0.03)`. Inside: 12px caption strip `rgba(255,255,255,0.05)` with `linked · {n} stems` (9px, rifff color) then a summed waveform SVG (`viewBox 0 0 128 100`, `preserveAspectRatio:none`, fill = rifff color @75% opacity).

**Expanded stem sub-row** (when block expanded; bg `#101013`, top border `#16161a`):
- header cell 212px, height 26, padding `0 10 0 34`: 6×12 type swatch (radius 2, stem type color), slot number (9px `#5a5a62`), name (10px, ellipsis), dB readout (9px `#5a5a62`)
- lane: one clip per loop repetition — absolute, top/bottom 3, radius 2, border = type color @50%, bg = type color @7%, waveform fill = type color; muted → `opacity:0.35`

**Playhead:** overlay absolutely positioned from `left:212px` to the right edge, `pointer-events:none`; 1px vertical line in `#c87c46` at `left = pos*24`.

**Inspector** (308px, bg `#17171a`), four stacked sections separated by 1px `#2a2a2f`, each padding 12/14:
1. **Header** — eyebrow `INSPECTOR`; 34px glyph + rifff name (14px/700); source path (10px `#5a5a62`, `word-break:break-all`), e.g. `~/endlesss/stems/2023-07-26-15-53/`
2. **Tempo** — eyebrow `TEMPO`; `{rifffBpm}` (19px/700) `→` `{projectBpm}` (19px/700, rifff color); right-aligned stretch toggle (height 22, radius 6; on+mismatched: bg `rgba(139,92,246,0.22)`, border/text `#7f66c4`; native: text `#5a5a62`, border `#2a2a2f`). Note line (10px `#8a8a92`): `native tempo — nothing to stretch.` / `stretched 83.3% to fit the project grid. pitch preserved.` / `playing at source tempo — will drift against the grid.`
3. **Offset** — eyebrow `OFFSET` + right meta `grid 1/16 · 187.5 ms/step` (9px, nowrap). Row: − button 26×24 (radius 6, border `#3a3a41`), tick ruler, + button. Ruler: 17 ticks at `((i+8)/16)*100%`, heights 14 (center) / 9 (every 4) / 5, colors `#8a8a92` center else `#33333a`; 2px marker in rifff color at `((steps+8)/16)*100%`; `−8 / 0 / +8` labels (9px `#33333a`). Below: value (16px/700, rifff color when non-zero else `#8a8a92`) `+2/16`, ms readout `+375 ms` or `dead on` (10px `#5a5a62`), and a `zero` button (height 20, radius 4).
4. **Stems** — eyebrow `STEMS` + `unlink group` / `relink group` button (height 20, radius 4; unlink state text `#c46389` border @55%, relink `#8a8a92`/`#2a2a2f`). Per stem row height 24, gap 7: type swatch, slot, name (11px), mute button 18×18 (`m`; active bg `#c46389`, ink `#2a0713`), volume range 82px, dB readout width 30 right-aligned. Footer note (10px `#5a5a62`): `source: elling and 2 more, left where they are.`

### 1a — Lane-first (reference)
Every stem is its own 34px lane; all controls live in a 296px lane header (slot, name, mute, 82px volume, dB). Above each stem block sits a 74px group header carrying the rifff name, a stretch chip (`96→80 · 83.3%`), `unlink group`, and a compact offset stepper. Timeline PPB = 30px/bar. Footer holds a full-width dashed drop zone. Downside: very tall at 6+ stems per rifff.

### 1b — Rifff-first without shelf (reference)
Same as 2a minus the shelf; rifffs are only added via a bottom drop zone.

### 1c — Shelf + per-stem popover (reference)
Shelf on top, all stems as flat 28px lanes, controls in a 268px popover anchored under the clicked stem name (volume / offset ± / stretch toggle / `linked with 3 others` + unlink). Useful if the inspector is dropped later.

## Interactions & Behavior

- **Drop a rifff folder** → all its stems appear as one linked group at the drop bar, pre-aligned, stored as a path reference. Never copy audio.
- **Click block or shelf card** → selects that group (drives the inspector) and expands it.
- **Chevron** → expand/collapse stems for that block (independent of selection).
- **Play/pause** → wall-clock transport over 32 bars, looping; playhead redraw throttled to ~18fps (55ms) to keep re-render cheap. Stop resets to bar 1 and pauses all stems.
- **Tempo ±** → 1 BPM steps, clamp 40–200. Changes every group's stretch ratio and clip widths live.
- **Snap cycle** → 1/4, 1/8, 1/16, 1/32. Changes the offset step size and ms/step readout; existing offsets keep their step count.
- **Offset ±** → ±1 grid step, clamped −8…+8 steps. When the group is linked the offset applies to the whole group (key = group id); when unlinked each stem has its own key.
- **Stretch toggle** → on: clip length = `len` bars at project tempo. Off: clip length = `len * (rifffBpm / projectBpm)` — visibly drifts off the grid. Pitch always preserved.
- **Unlink** → group becomes independent stems; each stem inherits the group's current offset as its own starting value; clip borders go neutral (`#3a3a41`); the chip becomes `relink`. Relink restores group-level control.
- **Mute** → per stem; row text dims to `#5a5a62`, clip drops to 35% opacity, dB readout shows `mute`, gain to 0.
- **Volume** → 0–100 slider → dB readout `20*log10(v)`, `0.0` at unity, `−inf` at zero.
- **Loop-length handling** — a stem's loop may be shorter than the rifff (e.g. 4-bar stems inside an 8-bar rifff): draw one clip per repetition so the repeat is visible. Real example: `Lowpass` and `Endless Smile` are 4 bars (12.0s at 80 BPM), `Audio In` is 8 bars (24.0s).
- **Hover** — brighten background one step (`#1e1e22` → `#2a2a2f`); never scale. **Focus** — 1px accent border, no ring. **Disabled** — 30% opacity.

## State Management

```
playing        boolean
pos            number            // playhead in bars (float), 0..32
bpm            number            // project tempo, default 80
snapIdx        0..3              // -> 1/4, 1/8, 1/16, 1/32
vol            { [stemKey]: 0..1 }
mute           { [stemKey]: boolean }
off            { [groupId|stemKey]: int }   // grid steps, -8..8
stretch        { [groupId]: boolean }
unlinked       { [groupId]: boolean }
sel            groupId           // inspector target
exp            { [groupId]: boolean }
pop            stemKey | null    // option 1c only
```

`stemKey = "{groupId}:{slot}"`. Offset key = `unlinked ? stemKey : groupId`.

Derived per render: stretch ratio `projectBpm / rifffBpm`; `offsetPx = steps * PPB / snapDiv`; `msPerStep = (60/bpm)*4*1000 / snapDiv` (187.5ms at 80 BPM, 1/16); shown clip bars; segment list per stem; dB labels; bar.beat.16th readout.

Data fetching: rifff metadata (name, author, bpm, bar length, stem list with slot + sound type + loop length + source file path) read from the referenced folder. Audio decoded lazily; peak arrays cached per stem for waveform drawing.

## Design Tokens

**Shell (dark, near-black)**
```
--bg-page      #08080a
--bg-frame     #131316
--bg-bar       #17171a
--bg-rail      #101012
--bg-row       #16161a
--bg-row-sub   #101013
--bg-control   #1e1e22
--border       #2a2a2f
--border-soft  #1e1e22
--border-strong#3a3a41
--grid-minor   #1c1c20
--text         #f2f2f4
--text-2       #8a8a92
--text-3       #5a5a62
--text-4       #33333a
```

**Sound-type colors** (muted from Endlesss Studio's Sounds palette; these drive stem swatches, clip borders/fills, waveforms and chips)
```
drums     #c87c46
notes     #cbb85a
bass      #5b95c4
ext inst  #c46389
sampler   #7f66c4
fx        #4fada0
ext fx    #5fae62
audio in  #c56164
```
Usage alphas: clip bg = color @7%, clip border = color @50%, chip bg = color @14%, glyph petal = color @55% opacity, selected shelf card bg @10% / border @60%.

**Rifff identity color** = its lead stem's type color (r1 `#c56164`, r2 `#c87c46`, r3 `#c46389`, r4 `#7f66c4`). Playhead `#c87c46`. Play-active `#4fada0` on `#05231d`. Mute-active `#c46389` on `#2a0713`. Stretch-on accent `#7f66c4` on `rgba(139,92,246,0.22)`.

**Typography** — Atkinson Hyperlegible Mono (self-hosted TTF; fallback `ui-monospace, Menlo, Consolas, monospace`) for everything. Sizes 9 / 10 / 11 / 13 / 14 / 16 / 19 / 22 / 26px. Weights 400 / 600 / 700. Line-height 1.25 tight, 1.5–1.7 body. Tracking 0 normal, .06em labels, .08em eyebrows. UI copy is **lowercase**, no emoji, no exclamation marks; eyebrows uppercase.

**Geometry** — radius 2 (swatches, small clips) / 3 (chips) / 4 (small buttons, clips) / 6 (buttons) / 8 (cards) / 10 (popover) / 12 (frame). Spacing 4 / 7 / 8 / 9 / 10 / 12 / 14 / 20 / 32. Rows: block 52, stem lane 34 (1a) / 28 (1c) / 26 (sub-row), ruler 24, transport 46. Columns: lane header 296 (1a/1c), 212 (2a/1b), inspector 308, shelf card 212. Timeline scale PPB 30px/bar (1a/1c), 24px/bar (2a/1b), 32 bars.

**Elevation** — popover only: `0 6px 20px rgba(0,0,0,0.4)`. No inner glow, no ambient glow, no gradients on chrome.

**Motion** — 120ms hovers, 220ms state changes, 380ms panel slides; ease `cubic-bezier(0.22,0.8,0.32,1)`. No looping animation except the playhead.

## Polar rifff glyph

Each rifff's identity mark is its own audio rendered in polar, one layered petal ring per stem — matching Endlesss's rifff glyphs.

```
downsample(peaks, points)                     // mean-bucket to 13 + i*2 points
r0   = 17 + stemIndex * 2.5                   // inner radius (viewBox 0 0 100 100)
amp  = 10 + 15 * min(1, stemVolume + 0.1)     // petal reach
path: M at (angle 0, r0), then per point:
      Q (angleMid, r0 + norm*amp) (angleNext, r0)
```
Layers are sorted by `amp` descending (largest behind), filled with the stem's type color at `opacity 0.55`, **no blend mode** (screen blending blew out white in the center). A core disc `r=9` in the rifff's identity color at 85% opacity sits on top. Sizes in use: 40px (shelf card), 34px (inspector), 30px (block header), 24px (1a group header).

Waveform clips use the same peak arrays as a mirrored linear path (`viewBox 0 0 128 100`, `preserveAspectRatio:none`, filled).

## Assets

- `uploads/3 - elling - Lowpass - 80BPM - 2023-07-26-15-53.wav` — 12.0s, 48kHz, 4 bars, type **fx**, slot 3
- `uploads/5 - elling - Endless Smile - 80BPM - 2023-07-26-15-52.wav` — 12.0s, 48kHz, 4 bars, type **fx**, slot 5
- `uploads/8 - elling - Audio In - 80BPM - 2023-07-26-15-39.wav` — 24.0s, 48kHz, 8 bars, type **audio in**, slot 8
- `stem-peaks.json` — 128 peak values per stem, extracted from those WAVs (waveform source of truth for the prototype)
- `fonts/AtkinsonHyperlegibleMono-{Regular,Bold}.ttf`
- Filename convention worth parsing on import: `{slot} - {author} - {stem name} - {bpm}BPM - {timestamp}.wav`
- No icon set; every affordance is a text label or a unicode glyph (`▶ ❙❙ ■ ▸ ▾ − + →`).

## Files

- `Rifff Arranger.dc.html` — the design. Options in document order: **2a** (recommended), then 1a, 1b, 1c. Data model in the logic class (`RIFFFS`, `TYPE`, `radial()`, `pathFrom()`); all markup inline-styled.
- `stem-peaks.json` — extracted peaks.
- `uploads/*.wav` — the three real stems.
- `fonts/` — Atkinson Hyperlegible Mono.
- `tokens.css` — the full token set as CSS custom properties, ready to port.
- `rifff-visuals.js` — copy-pasteable helpers: peak extraction, clip waveform path, polar glyph path, dB / offset / position readout formatting.
- `screenshots/` — `2a-shelf-blocks-inspector.png` (the recommended build), plus `1a-lane-first.png`, `1b-rifff-first.png`, `1c-shelf-popover.png` at 2×.
- `support.js` — runtime the prototype needs to render. Keep it beside the HTML and open `Rifff Arranger.dc.html` directly in a browser; the canvas pans and zooms. Nothing in this file is part of the design.

## Out of scope for v1

MIDI, plugin instruments, realtime FX, automation, fades/crossfades, clip trimming, multiple takes per lane, export/bounce, undo history beyond the arranger's own actions, mobile layout.

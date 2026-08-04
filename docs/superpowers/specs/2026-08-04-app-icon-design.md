# App Icon Design

**Status:** approved, ready for implementation plan.

## Background

`resources/icon.png` (the dev-mode `BrowserWindow` icon, imported in `src/main/index.ts`) and
`build/icon.png` / `build/icon.icns` / `build/icon.ico` (electron-builder's packaged app icon
for mac/win/linux, picked up automatically from `directories.buildResources: build` in
`electron-builder.yml` since no explicit `icon:` override is configured) are all still the
unmodified default Electron atom logo — never customized for this app. This replaces all four
with a real identity mark.

## Concept

Derived from `LoadingLoader.tsx`'s own loading-spinner animation — four horizontal bars that
step between a flat row and a broken zigzag (`ra-loader-bounce` keyframes). The icon freezes a
simplified two-bar version of that same "broken line" motion: two horizontal bars, touching
edge-to-edge with no horizontal gap, offset vertically — left bar low, right bar high. Chosen
through visual iteration (see below) over the literal four-bar animation frame because two
larger bars read more clearly at small icon sizes than four thin ones.

## Exact geometry

1024×1024 master canvas (standard mac icon source size):

- **Background:** solid `#0a0a0a` (matches `--ra-bg-frame`), filling the full canvas edge to
  edge. **No corner rounding** — a deliberate exception to macOS convention. Since this app
  isn't Mac-App-Store-distributed, macOS displays the bundled icon's own art as-is rather than
  auto-masking it into the rounded squircle every other dock icon has; a hard square will look
  like an outlier next to neighboring app icons. Explicitly chosen anyway, prioritizing
  consistency with the app's own design system (`tokens.css`: "sharp corners everywhere — no
  `border-radius`") over dock conformity.
- **Two bars**, both fill `#ededed` (matches `--ra-text`), each 48px thick, 352px wide,
  touching at the canvas's horizontal center (x=512) with 160px of empty padding on the outer
  left/right edges (352 + 352 + 160 + 160 = 1024).
  - **Left bar** ("low"): spans x 160–512. Vertically centered at y=608 (96px below the
    canvas's vertical center, y=512) → top edge y=584, bottom edge y=632.
  - **Right bar** ("high"): spans x 512–864. Vertically centered at y=416 (96px above the
    canvas's vertical center) → top edge y=392, bottom edge y=440.

No gradients, no glow, no drop shadow — flat fills only, matching the rest of the app's visual
language (color spent only on the two bars themselves, everything else is the flat dark
background).

## Scope

Exactly four output files, all derived from the one 1024×1024 master:

- `resources/icon.png` — dev-mode window icon (also the source `src/main/index.ts` imports via
  `?asset`)
- `build/icon.png` — electron-builder's linux icon source
- `build/icon.icns` — electron-builder's mac icon source
- `build/icon.ico` — electron-builder's windows icon source

No in-app usage beyond the window icon — this app has no "About" panel
(`app.setAboutPanelOptions`) today, and adding one is out of scope for this change.

## Design process

Explored via the `superpowers:brainstorming` visual-companion browser tool. Started from the
real `LoadingLoader.tsx` component's own CSS keyframes (reproduced live + frozen at each
keyframe: 23.33%, 46.67%), then iterated per feedback: dropped from four bars to two (reads
clearer, can be larger), removed horizontal gaps between bars (touching, not spaced), tried
both vertical orientations (left-high/right-low, then corrected to left-low/right-high),
compared monochrome vs. one accented bar (monochrome chosen — the design system reserves color
for audio-carrying data, and an accent risked a false association with an unrelated existing UI
color, e.g. the new `--ra-recording-live` purple), and compared a filled background tile vs.
transparent (filled chosen, matches how the placeholder icon already works and how app icons
need to look in the dock/Finder/taskbar regardless of platform).

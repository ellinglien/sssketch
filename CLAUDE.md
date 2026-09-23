# sssketch — agent handoff

Read this before touching code. It's a map of the project and a list of things that have
already burned a session — re-reading `git log` and the specs in `docs/superpowers/` will
tell you *what* was built; this file is about *how this codebase actually behaves*.

## What this is

An Electron + React desktop app (macOS-first) for arranging Endlesss "rifff" stem exports
into a timeline/DAW-like project, with real-time playback and plugin hosting handled by a
separate native JUCE/C++ audio engine subprocess. Formerly named **ssstitch** — renamed to
**sssketch** on 2026-08-01 (repo, app id, project filenames `.sssketchproj`, all internal
`namespace`/identifiers). If you see "ssstitch" anywhere outside `docs/superpowers/specs/`,
`docs/superpowers/plans/`, or `native-engine/PHASE*_FINDINGS.md` (deliberately preserved as
historical records), that's a bug — the rest of the rename was exhaustive.

## Running it

```bash
npm run dev          # electron-vite dev — hot-reloads the Electron/React side only
npm run typecheck    # tsc, node + web configs
npm run lint         # eslint --cache .
npm test             # vitest run (TypeScript/shared logic only)
```

The native engine is a **separate build**, not part of `npm run dev`:

```bash
cd native-engine && cmake -B build && cmake --build build
```

Then run its own test suite (JUCE `UnitTestRunner`, compiled into the same binary):

```bash
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```

**The single most expensive mistake made in this codebase's history:** the native engine does
NOT hot-reload, and it's only spawned once at app startup (`startPlaybackEngine()` in
`src/main/index.ts`). After editing anything under `native-engine/Source/`:
1. Rebuild it (`cmake --build build`) — do this immediately, not "later."
2. **Fully quit (Cmd+Q) and relaunch** the Electron app. A renderer reload is not enough —
   the engine subprocess itself needs to restart to pick up the new binary.

If you're testing against a *packaged* build (`dist/mac-arm64/sssketch.app` or similar from
`electron-builder`), know that it's a completely separate, frozen artifact — rebuilding
`native-engine/` or running `npm run dev` never touches it. Rebuild the package itself
(`npm run build:mac` / `dist:mac`) if that's genuinely what needs testing. Prefer `npm run dev`
for iteration; only use a packaged build when you specifically need to test packaging/signing.

## Architecture

```
Electron main (src/main/)  <---IPC--->  Renderer/React (src/renderer/src/)
        |
        | spawns + talks to over a local socket (engineClient.ts / IpcServer.cpp)
        v
Native engine subprocess (native-engine/, JUCE/C++, built separately)
```

- **`src/main/`** — Electron main process. File I/O, project save/load (`projectFile.ts`),
  audio import (`importRifff.ts`), plugin scanning (`pluginScan.ts`, `runFullScan.ts`,
  `pluginCatalog.ts`), the riff library integration (`riffLibraryStore.ts`, `riffLibrarySchema.ts`,
  `riffLibrarySync.ts`, `riffLibraryWriter.ts` — sssketch's own self-built, always-on riff-sync
  database, plus an optional connection to a real external LORE-synced archive if the user already
  has one), and the engine subprocess lifecycle (`engineProcess.ts` spawns it, `engineClient.ts`
  talks to it, `playbackEngineLifecycle.ts` wires it into app startup). Every `ipcMain.handle(...)`
  call in `index.ts` is the full IPC surface — grep there first when tracing a feature end to end.
- **`src/preload/`** — thin bridge exposing `window.rifffApi` to the renderer. Any new
  IPC channel needs a matching entry here.
- **`src/renderer/src/`** — the React UI. `state/store.ts` is a single reducer (see its
  action types for the full list of things that can happen to a project); `state/
  StoreContext.tsx` wires that reducer plus several derived contexts (plugin catalog, scan
  progress, etc.) into React. `components/` is mostly presentational; `audio/` holds
  browser-side (Web Audio) analysis and caching — see "Analysis caches" below.
- **`src/shared/`** — pure, framework-agnostic TypeScript imported by *both* main and
  renderer (and mirrored in spirit by native-engine C++ in a few places — see "Wire format
  twins" below). This is where you want new logic to live if it doesn't need Electron or
  DOM APIs: it's the only layer with real unit test coverage by convention.
- **`native-engine/`** — a JUCE `juce_add_gui_app` target (yes, GUI app, not console — see
  "Why the engine is a GUI app" below) providing real-time playback, plugin hosting (VST3 +
  AU), and offline rendering/export. Talks to Electron over a local socket server
  (`IpcServer.cpp`). Has several CLI modes on the same binary, dispatched in `Main.cpp`:
  `--test` (unit tests), `--serve <port>` (the real IPC server mode Electron spawns),
  `--scan-one-json <path>` (isolated single-plugin scan probe, see "Plugin scanning" below),
  `--render-test`, `--spike`, `--test-client`. Check `Main.cpp`'s argv dispatch before adding
  a new mode.

### Wire format twins

`EngineProject` (native-engine's C++ struct) and `buildEngineProject.ts` (the TS function
that serializes renderer state into the JSON blob the engine consumes over IPC) are a
**hand-synced pair, not code-shared**. If you change one side's shape, you must change the
other and every test that constructs either. This has been the single largest-blast-radius
kind of change all session (see the "Channel plugins Task 9" and "Plugin scan Task 9" work in
`docs/superpowers/plans/`) — go file by file, methodically, when touching this boundary.

### Analysis caches (`src/renderer/src/audio/`)

Several path-keyed caches (`peakCache.ts`, `bandEnergyCache.ts`, `pitchCache.ts`) decode a
stem's audio once and memoize the result by file path — because the same stem's waveform/
glyph can render in many places at once (shelf, library browser, timeline, inspector) and a
naive implementation would re-decode+re-analyze on every mount. When adding a new per-stem
analysis, follow this pattern (cache by path, evict on rejection so a transient failure
doesn't permanently poison it) rather than decoding inline in a component. `peakCache.ts`
specifically computes peaks AND zero-crossing brightness from the *same* decode — don't split
that back into two decodes for two cheap derived values.

## Why the engine is a GUI app, and why its plugin editor windows are `setAlwaysOnTop`

The engine started as a `juce_add_console_app` and was converted to `juce_add_gui_app`
specifically so hosted VST3/AU plugin editor windows could exist at all on macOS. It runs as
an `LSUIElement` (no Dock icon) accessory app.

**Do not try to "fix" plugin editor windows not coming to the front by chasing process
activation.** Three different mechanisms were tried and empirically failed on recent macOS:
`juce::Process::makeForegroundProcess()` (self-activation), `open -a <bundle>` from Electron,
and `NSRunningApplication::activateWithOptions:` via osascript from Electron. All three were
verified to execute successfully with no error, and still didn't bring the window forward —
this isn't a "try harder" problem. The actual fix (see `PluginChain.h`'s `EditorWindow`) is
`setAlwaysOnTop(true)` on the window itself: pin it above everything at the window-server
level, which macOS enforces independent of which app is "active." This works and is what's
shipped. If you're tempted to touch this again, read the comment directly above the
`setAlwaysOnTop(true)` call first.

Also already investigated and ruled out: swapping `Main.cpp`'s `--serve` mode's custom
`MessageManager::runDispatchLoopUntil(50)` polling loop for the standard `runDispatchLoop()`
(which blocks on `[NSApp run]`). Confirmed by actually testing it that `[NSApp run]` still
exits immediately in this context — not the cause of anything, don't re-attempt without new
evidence.

## Plugin scanning

Scanning a plugin directory naively (loading every candidate's code in-process) is unsafe —
see `native-engine/PHASE0_FINDINGS.md` for a documented real hang in JUCE's AU scanner
against certain system component bundles. The mitigation already in place:
`pluginScan.ts`'s `scanOneCandidate()` spawns the engine binary in `--scan-one-json` mode as
an isolated, timeout-and-kill subprocess *per candidate*. A hang or crash on one bad plugin
costs only that candidate's timeout; it never blocks the rest of a scan. Don't reintroduce a
bulk in-process scan.

## Design system

`src/renderer/src/styles/tokens.css` is the single source of truth — read it before adding
any UI. Summary: near-black monochrome shell, Supermercado One throughout (ONE face, for
labels and prose alike), lowercase by default with uppercase as the emphasis, sharp corners
everywhere (no `border-radius`), color spent *only* on things that carry audio information
(stem waveforms/glyphs, the playhead, mute/danger state) — never on chrome. UI copy is
lowercase, no emoji, no exclamation marks. `typeColorVar(soundType)` is the one legitimate
way to get a color; don't hand-roll a second color table.

## Testing conventions

- **TypeScript/shared logic**: TDD by convention — write the failing test, verify it fails,
  implement, verify it passes. `vitest run` for the full suite. Pure logic lives in
  `src/shared/` specifically so it's easy to test without mocking Electron.
- **Electron-dependent code** (anything importing from `'electron'`): this codebase's
  convention is to avoid mocking the `electron` module wholesale. Where a function needs a
  real binary/process (`engineProcess.ts`, `pluginScan.ts`), tests use a real compiled
  artifact via an injectable `binaryPathOverride`/similar rather than a fake. Where a function
  only needs `app.getPath(...)`, tests mock just that narrow surface (see
  `pluginCatalog.test.ts`, `bandEnergyCache.test.ts` for the pattern).
- **React components**: generally untested directly in this codebase — verified via
  typecheck + lint + the underlying pure logic's own tests, plus manual verification. This
  environment has no GUI/audio interaction tooling, so a coding agent cannot itself click
  through the app — say so explicitly rather than claiming a UI change was "tested."
- **Native C++**: JUCE `UnitTestRunner`, run via the binary's own `--test` flag (see above).
  Some native functionality (real plugin scanning against whatever's actually installed,
  live playback) has no automated test and is verified by manual walkthrough instead —
  that's an intentional, documented choice in this codebase, not a gap to "fix" by mocking.

## Where the history actually lives

`docs/superpowers/specs/*.md` and `docs/superpowers/plans/*.md` are a complete, dated record
of every feature built this way (design doc → implementation plan → executed). If you need to
understand *why* something is shaped the way it is, check there before re-deriving it from
scratch — grep by topic (`master-plugin-chain`, `plugin-scan-favourites`, `daw-mode`,
`channel-plugin-inserts`, `signed-notarized-auto-update`, `spectral-viz` mockup discussion in
chat history, etc.). `native-engine/PHASE0_FINDINGS.md` through `PHASE3_FINDINGS.md` are the
native engine's own build-out history — also worth reading before touching engine
architecture.

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

`--test <name>` runs only the tests whose name or category is `<name>` (e.g. `--test ChannelChainRegistry`):
handy for looping one suite under stress or AddressSanitizer.

**Build type (optimisation).** The Makefile generator is single-config: optimisation comes from
`-DCMAKE_BUILD_TYPE=...` **at configure time**, and `cmake --build ... --config Release` does nothing.
A plain `cmake -B build` (the local default above) has an empty build type: JUCE still defines `NDEBUG`,
so asserts are off, but there is no `-O` at all, i.e. an unoptimised build. That's fine for local
iteration. **Shipped** engines are Release (`-O3`, `NDEBUG`): `release.yml` and
`scripts/build-x64-test.sh` configure with `-DCMAKE_BUILD_TYPE=Release` (engine and bridge). Until
2026-10-01 they didn't, and every release shipped the unoptimised build: an offline render of 8 stems
over 35 s took ~0.95 s, against ~0.11 s at Release, with bit-identical output. `scripts/rebuild-app.sh`
and `npm run build:mac` package whatever `native-engine/build` is configured as, so for a locally packaged
app that should perform like a release, configure that dir with `-DCMAKE_BUILD_TYPE=Release` (one-time;
`cmake -B build -DCMAKE_BUILD_TYPE=Release`, then rebuild). The Faust sources keep `-ffp-contract=off`, and
nothing may use `-ffast-math`/`-Ofast` (see `native-engine/CMakeLists.txt`), so `FaustStageTests`'
bit-exact golden match holds at `-O3` too. Use `-DCMAKE_BUILD_TYPE=Debug` for an asserting build. An
out-of-tree build (e.g. ASan in a temp dir) needs `SSSKETCH_GOLDEN_DIR=<repo>/native-engine/test/golden`
for `FaustStageTests` to find its vectors.

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

### One running app (single-instance lock)

`src/main/singleInstance.ts`'s `claimSingleInstance()` runs at module load in `index.ts`, before
`app.whenReady()`. Two copies of the app meant two playback engines playing the same project a few
ms apart (comb filtering that sounds like underruns). A second launch calls `app.exit(0)` (not
`quit()`: it must never reach `whenReady`, open the databases or spawn an engine), and the first
instance's `second-instance` handler brings its window forward. The `whenReady` handler also
returns early when `isPrimaryInstance` is false. Keep that check first if you restructure startup.

### Stopping the engine: the `transport-stopped` handshake

Stop is confirmed, not fire-and-forget, because a Web Audio preview (Shelf tile, import riff,
loop folder, backup) must not start until the arrangement is actually silent. The renderer's
`engine-stop` IPC goes through `src/main/engineStop.ts` (one shared, token-correlated request for
concurrent callers): main sends `stop { token }`, and the engine answers
`transport-stopped { token, stopped }` once the audio callback has finished its 15 ms halt fade.
`stopped: false` means a newer Play (or arming a recording) superseded it
(`playSupersedingStops` in `IpcServer.cpp`). When the audio device isn't rendering at all, the
engine answers at once instead of waiting for a fade that can't run (`native-engine/Source/
HaltAck.h`). `EngineClient` removes a waiter that times out, so it can't take a later reply.
Renderer callers use `pauseArrangementBeforeShelfPreview()` (`audio/shelfPreviewHandoff.ts`),
which resolves `true`/`false` and never rejects: on `false`, don't start the preview, but don't
skip unrelated work either (an import riff's stems still download).

### Disable, Mute and Solo: three layers

- **Disable** is `state.mute` (stem keys): saved with the project, in exports, undoable
  (`TOGGLE_MUTE`, `SET_GROUP_MUTE`).
- **Mute** is `state.mixerMute` (stem and riser keys): what a row's `m` writes
  (`SET_CHANNEL_MUTE`). Temporary: not saved (`serializeProject` drops it), not in exports, not
  an undo step (`history.ts` lists it as transient and pins it across undo/redo).
- **Solo** is `state.mixerSolo` (the exact keys allowed through, or `null`): temporary like Mute,
  and separate from both, so clearing Solo restores the exact Mute state underneath. It's drawn
  blue (`--ra-solo-on`), the one chrome colour Elling accepted outside audio information.

Only the engine snapshot sees Mute and Solo: `stateWithMixerMute()` (`state/mixerMute.ts`)
overlays them in `StoreContext`'s engine sync. Disable always wins. A riser's own saved `muted`
is legacy from the old row `m`: nothing sets it now, `risersForRowMute()` lights the row's `m` for
it, and unmuting the row clears it (`rowMuteToggleActions()` in `selectors.ts`).

### Phase lineage and the `.bakes` folder

A re-one (downbeat correction) is baked into new audio files, never into the source:
`src/main/bakeOffset.ts` renders a whole riff's stems as one all-or-nothing batch into
`<library root>/.bakes/<recipe>.baked.wav` (`bakeAssetsDir()` in `projectLibrary.ts`). A published
copy is never rewritten; a different rotation is a different file. Results don't come back in job order (WAVs render before
LORE stems), so always match them to stems by `path`. Each stem records where its audio came from
(`phaseSourcePath`) and how far it has been rotated (`phaseBars`). Each riff can carry a
`phaseLinkId`: a re-one moves exactly the riffs sharing it (`bakeTargetGroupIds()` in
`src/shared/bakePropagation.ts`). Auto-arrange's window copies keep their source's id, so they
follow it; a pasted riff or stem, an ungrouped stem and a Cross child get their own id and stay
independent, even when they point at the same file. Riffs saved before the field fall back to the
old path-based rule.

Auditioning never adopts a bake: Cross (`components/crossFromSketch.ts`) and a Discover seed
render a riff's live offset to `.bakes` and use those files without dispatching `APPLY_BAKE`, so
the project isn't edited or marked unsaved.

`.bakes` is a rebuildable cache. A copy is named by its recipe (`src/main/reonedRecipe.ts`: the
original's path, size and mtime, the rotation in samples, `BAKER_VERSION`), and a re-one bakes
from the stem's original (`phaseSourcePath`) by the total rotation (`phaseBars`), falling back to
the current file only while the original is away. So the same riff at the same phase, whether
re-oned, crossed or seeded into Discover, reuses one file. A saved lineage counts only while the
stem's file is a `.baked.wav` copy (`phaseLineage()` in `src/shared/reonedRotation.ts`); a stretched
one-shot drops it. A riff's first re-one gives it a `phaseLinkId`, so two riffs that merely reuse
one copy never move together. A copy a project names but that is missing is rebuilt from that
lineage when the project opens (`state/reonedRepairOnOpen.ts`) and before any export
(`ensureReonedCopiesForState`, `reonedRebuild.ts`, placed riffs only). It lands on the same name,
so the project isn't marked unsaved. One that can't be rebuilt shows "re-oned copy missing ·
rebuilds when its original is back" (`ReonedCopyMissingNotice.tsx`, the Inspector) and is retried
every 15 s while its original is unreachable. Each round first drops entries no stem in the open
project names any more (`reconcileReonedMissing`, also run when an open fails after its repair),
so the timer stops once nothing is left to retry. A copy rebuilt under a new name is repointed by
`REPAIR_REONED_PATHS` in the present and every undo and redo step (`history.ts`): it is the same
audio, and no undo step is added. Unused copies are cleaned by the launch notice
(`ReonedCopiesNotice.tsx`, from 200 MB, "not now" for 7 days) and the gear menu's "clean up
re-oned stem copies…". Their IPC (rebuild, library check, survey, clean, not now) is in
`src/main/reonedCopiesIpc.ts`, registered from `index.ts`.

"Used" means named by:
- the autosave or its aside snapshot, read first (a recover deletes the autosave; it is written to
  a temporary and renamed over, so it is never read half-written);
- any project file under the library root: the scan walks the whole tree (`reonedUsage.ts`), every
  `.sssketchproj` at any depth, dot-named and symlinked folders included (each real folder once),
  and every file in any `.backups` folder. It skips only `.bakes`, `.samples-cache` and macOS's
  volume folders (`.Trashes`, `.Spotlight-V100`, ...), and stops at a folder it can't list or a
  symlink whose target is away. `isInsideLibrary` (`projectFile.ts`) uses the walk's own rule
  (`isReadByLibraryWalk`), so a project the walk doesn't read is remembered instead;
- a remembered outside project (`reonedCopiesStore.ts`, 50 kept). A store that can't be read is
  never written over; a corrupt one is moved aside to `reonedCopies.corrupt-<time>.json`, and the
  survey and the clean stop until that file is deleted;
- the open project, its undo history, Cross, Discover and Discover's undo and redo
  (`state/reonedInUse.ts`);
- this session (`reonedCopiesSession.ts`, read again inside the `.bakes` lock at delete time):
  copies handed out, and copies named by any project text main handed to the renderer or wrote
  (open, library open, backup read or restore, autosave offer, save, autosave). That covers a
  project opened, recovered or saved while a clean's scan runs.

The survey and the clean read the library root once, for the scan and the delete alike.

A copy is deleted only if it is unused and more than a day old (`reonedUsage.ts`). Rules:
- Bump `BAKER_VERSION` whenever the baker's bytes change (rotation, seam blend, `BakeStem.cpp`).
  `bakeOffset.test.ts`'s golden hashes fail with "baker output changed: bump BAKER_VERSION".
- Anything new that can hold a stem path, such as a new session type or a new saved file, must
  join the used set.
- A failed bake never deletes a copy it didn't create.
- Never delete outside `.bakes`, and leave the legacy `.sssketch-bakes/` folders alone.
- `bakeOffset` and the scans are async and yield between stems and slices: the library is often
  on a USB drive.

Known limit: the scan finds a copy name only as plain text. A name inside a plugin's base64
state (or any other encoded blob in a project) isn't seen, so a plugin that stored a `.bakes` path
in its own state doesn't keep that copy. No shipped feature puts one there.

### Cross

Cross combines two selected riffs into a new one. Open it from exactly two riffs selected in
Sketch or the Shelf (`openCrossFromRiffs` in `App.tsx`); it's a full-window workspace like
Discover. The draft model is pure, in `src/shared/cross.ts`: the two parents, the center rows,
gains, mute/solo, undo/redo, and `assembleCrossRifff()`, which builds the committed riff (with
`phaseLinkId` set to its own id). `components/CrossPanel.tsx` is the UI. `state/useCrossPreview.ts`
plays a throwaway engine project under an engine-ownership token and restores the real project on
stop, Back or unmount. The draft is session-only and disposable (closing discards it), and nothing
in Cross touches the project until "add to shelf" / "add to timeline". That includes its tempo
control, which changes only `draft.targetBpm`.

### Metronome

On/off and volume (`metronomeVolume`, drag the metronome button up/down) are app state, not saved
with the project. Main keeps the last `set-metronome` it sent (`src/main/metronomeSetting.ts`) and
re-sends it to a respawned engine, which otherwise starts at its own defaults. The button is one
component, `components/MetronomeButton.tsx`, used by the main transport and by Cross. The click has
no tempo of its own: the engine clicks at the loaded project's bpm, so during a Cross preview it
follows `draft.targetBpm` and after it the project's tempo (`PlaybackEngineTests`).

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
any UI. Summary: near-black monochrome shell, Silkscreen font throughout, sharp corners
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

## Faust DSPs (the radio sound's master stages)

`native-engine/Source/dsp/faust/*.dsp` are the single copy of the web radio's Faust DSPs:
ell.ing/radio compiles them to wasm, `scripts/build-faust-cpp.mjs` compiles them to the committed
C++ in `generated/` with the native `faust` pinned in `FAUST_VERSION` (Homebrew, `brew pin`ned).
After editing a `.dsp`: run that script here, `node scripts/build-faust.mjs` and
`node scripts/golden-vectors.mjs` in the radio repo, then rebuild the engine. After editing `saturate.dsp`,
`glue.dsp` or `truepeak.dsp` (or the radio's `masterChain.ts`), also re-render the whole master chain's goldens here with
`node scripts/golden-master-chain.mjs` (headless Chrome running the radio's own chain, saturation off and on;
`MasterGlueToneTests`, `MasterSaturationTests`). CI checks only that
the hashes agree (no `faust` there, so the regenerate-and-compare test skips, as expected); the
full drift check and the bit-exact `FaustStageTests` against the web's output run locally. See
`native-engine/Source/dsp/faust/LICENSES.md`. The dub echo (`DubDelay.h`) is hand-written C++, not
Faust, but is matched to the web the same way: after editing the radio's `dubDelay.ts` or the `DUB_*`
numbers, re-render `node scripts/golden-dub-delay.mjs` (`DubDelayBusTests`).

## Where the history actually lives

`docs/superpowers/specs/*.md` and `docs/superpowers/plans/*.md` are a complete, dated record
of every feature built this way (design doc → implementation plan → executed). If you need to
understand *why* something is shaped the way it is, check there before re-deriving it from
scratch — grep by topic (`master-plugin-chain`, `plugin-scan-favourites`, `daw-mode`,
`channel-plugin-inserts`, `signed-notarized-auto-update`, `spectral-viz` mockup discussion in
chat history, etc.). `native-engine/PHASE0_FINDINGS.md` through `PHASE3_FINDINGS.md` are the
native engine's own build-out history — also worth reading before touching engine
architecture.

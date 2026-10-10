# AGENTS.md: rules for coding agents working on sssketch

sssketch is an Electron + React desktop app (macOS-first) for arranging Endlesss stem exports,
with playback, plugin hosting and export done by a separate native JUCE/C++ engine subprocess.
Elling is the maintainer: he reviews and merges everything.

This file stands on its own. `CLAUDE.md` in the repo root has the depth: the reasons, the
history, the things that have already burned a session. Rules first here; read the long
version before you change code.

## 1. Read CLAUDE.md before changing code

The sections that matter most:

- **Running it**: `npm run dev`, typecheck, lint, test; the engine is a separate cmake build.
- **The engine doesn't hot-reload**: after editing `native-engine/Source/`, rebuild, then fully
  quit and relaunch the app. A renderer reload is not enough.
- **Wire format twins**: `EngineProject` (C++) and `buildEngineProject.ts` are hand-synced.
  Change one, change the other and every test that builds either.
- **Analysis caches**: per-stem analysis is cached by path in `src/renderer/src/audio/`,
  decoded once, evicted on failure. Never decode inline in a component.
- **Why the engine is a GUI app**: plugin editor windows use `setAlwaysOnTop`. Don't chase
  process activation; it was tried three ways and fails.
- **Plugin scanning**: one isolated, timeout-and-kill subprocess per candidate. Never a bulk
  in-process scan.
- **Design system**: summarised in section 2 below.
- **Testing conventions**: summarised in section 5 below.
- **Faust DSPs**: the `.dsp` files are shared with the web radio and golden-tested bit-exact.
  Follow the regeneration steps exactly.
- **One running app, the stop handshake, Disable/Mute/Solo, phase lineage and `.bakes`, Cross,
  the metronome**: how each works and what it relies on. Read the matching section before
  touching any of them.

## 2. Design system (hard rules)

`src/renderer/src/styles/tokens.css` is the single source of truth. Read it before any UI work.

- **Tokens only.** No hardcoded colours, no hex values in components, CSS or SVG assets. An SVG
  that needs a colour takes it from CSS (`currentColor` or a token), not a baked-in fill.
- **Silkscreen font** throughout (`--ra-font`).
- **Sharp corners.** No `border-radius`.
- **Colour only on audio information**: stem waveforms and glyphs, the playhead, mute/danger
  state. Never on chrome. One accepted exception: Solo is blue (`--ra-solo-on`). Selection,
  highlights and toggles stay monochrome (grey fill, bright ink).
- **No gradients, glow, blur or scale-on-hover** on chrome. Shadows use the tokens.
- **Lowercase UI copy**, including `aria-label`s, titles, tooltips and dialog text. No emoji, no
  exclamation marks.
- **`typeColorVar(soundType)`** is the one way to get a sound-type colour. Don't add a second
  colour table.

## 3. Work in reviewable pieces

- **One feature per branch and pull request.** Not one big branch that carries several.
- **No direct pushes to master.** Open a PR; Elling merges after review.
- **Design doc and plan first.** Each feature gets
  `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and a matching plan in
  `docs/superpowers/plans/`. Read a few recent ones for the format: decisions, the shape of the
  change, what's open.
- **Keep the handoff docs current.** When you add a subsystem, a protocol message (IPC channel,
  engine message, wire field) or a convention, update `CLAUDE.md` and this file in the same PR.

## 4. Commits

- **Subject:** lowercase `area: what changed`, as in `git log` (e.g.
  `saving: the autosave can't be starved, and a save leaves no stale recovery file`).
- **Body:** says why.
- **One concern per commit.** No 700-line commits that mix features.
- **No noise.** Fifteen commits tweaking a glow get squashed before the PR.
- **No commit/revert pairs.** If it was wrong, drop it from the branch.

## 5. Tests

- **TDD for logic**: write the failing test, see it fail, implement, see it pass.
- **Pure logic lives in `src/shared/`** (or another pure module) with vitest tests.
- **React components** are verified by typecheck, lint and the pure logic's tests. An agent
  can't click through the app, so say so in the PR rather than claiming a UI change was tested.
- **Electron code**: don't mock `electron` wholesale. Use injectable binary paths or mock only
  the narrow surface (e.g. `app.getPath`).
- **Native engine**: JUCE `UnitTestRunner` via the binary's `--test` flag.
- **Before pushing**, run all of:
  ```bash
  npm run typecheck
  npm run lint
  CI=1 npx vitest run
  ```
  When engine code changed, also rebuild and run
  `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test`.
- **better-sqlite3 in tests:** any new test file that opens a database must go on the CI
  `exclude` list in `vitest.config.ts`. It crashes vitest workers on the CI runner.

## 6. Behaviours that must not regress

Shipped in 1.5.0, or merged with `codex/phase-cache` on 2026-10-09. Breaking one of these blocks
a merge.

- **Who "me" is:** a typed name, else the Endlesss login, else nobody. Never a default username.
- **The advanced-features switch** (`src/shared/features.ts`) gates plugins, recording, the
  phone remote, sound defaults, hearts and EEEDIT. New power features go behind it.
- **Plugin settings safety:** every save path goes through `serializeForSave()`. Plugin on/off
  goes through `src/shared/pluginSwitch.ts`.
- **Crash recovery:** the autosave/recovery file is never disabled or deleted while work is
  unsaved, by any path (dismissing a dialog included). An offered snapshot is deleted only by the
  welcome's recover or discard. Closing the welcome any other way (its ×, open, Endlesss, tour,
  new) leaves it undecided, and the autosave runs again (`autosaveWaitsOnRecoveryOffer`): the
  first autosave or save then moves it aside to `autosave.previous.sssketchproj` instead of
  overwriting or deleting it (`projectFile.ts`). One older snapshot is kept, and the next launch
  offers it with the current one.
- **The startup gate** shows until the library is usable, and has a × that closes it early. The
  welcome has a × too, which hides it for the session. Both are Elling's decisions; keep them.
- **Disable, Mute and Solo are three layers** (CLAUDE.md has the detail). Disable (`state.mute`)
  is saved and affects exports. A row's `m` is a temporary Mute (`mixerMute`) and its `s` a
  temporary Solo (`mixerSolo`): neither is saved, exported or undoable, and clearing Solo restores
  the Mute underneath. A riser's old saved mute still clears with its row's `m`. Don't change what
  these mean without Elling's decision.
- **Auditioning doesn't edit the project:** opening Cross or a Discover seed, and Cross's tempo
  control, never change the project, its undo history or its saved state. Bakes they need are
  rendered, not adopted.
- **One running app:** the single-instance lock is claimed before `whenReady`, and a second launch
  exits before it can open a database or spawn an engine.
- **Stopping is confirmed:** a preview starts only after `transport-stopped` reports silence, and a
  failed or superseded stop never rejects into a caller (`pauseArrangementBeforeShelfPreview`).
- **SQLite in main:** never `.iterate()` across an `await`; use `.all()`. Jams share one db, so
  batch per-jam work by db connection instead of re-querying per jam.
- **Main thread:** no blocks over ~100 ms. The LORE archive often lives on a slow USB drive.
- **Audio thread (engine):** no locks, no allocation, no logging.
- **Disk:** every file the app generates needs a cleanup story. No unbounded hidden folders.
  `<library>/.bakes` is a rebuildable cache (CLAUDE.md, phase lineage). Keep three rules:
  anything new that holds stem paths joins the used set (`reonedUsage.ts` /
  `state/reonedInUse.ts`, and `noteSessionProjectText` for any new way main hands a project to
  the renderer or writes one); `BAKER_VERSION` is bumped when the baker's output changes; and
  cleanup deletes only unused copies more than a day old, never outside `.bakes` and `.shapes`
  (EEEDIT's renders, cleaned by the same rules).
- **Re-oned copies:** a missing copy is rebuilt on open and before export without marking the
  project unsaved, and a failed bake never deletes a copy it didn't create.

## 7. Product decisions are Elling's

If a change alters behaviour he has chosen (colour rules, mute semantics, the startup gate,
defaults, what a control means), don't decide it. Raise it as a question in the PR description
and keep the shipped behaviour until he answers.

## 8. Public repo

- No personal names, home-directory paths, tokens or keys, in code, tests, fixtures or docs.
  Use made-up names in tests.
- `CHANGELOG.md` and `TO-DO.md` are in the repo: keep the "Unreleased" section and open items
  current when a change affects them. Don't add other top-level docs without asking.
- Release notes are written by hand at release time. Don't generate them.

## 9. Engine and Ableton Link

Only the playback engine joins Link: it alone is spawned with `--link`
(`engineServeArgs` in `src/main/engineProcess.ts`). Test engines, render engines and scan
probes must never pass it, or a test run can retune a running app's tempo.

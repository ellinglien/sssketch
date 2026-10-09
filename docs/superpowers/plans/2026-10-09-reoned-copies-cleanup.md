# Re-oned Stem Copies: Reuse, Rebuild, Clean Up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `<library root>/.bakes/` a rebuildable cache, so that cleaning it can't lose
anything:
- **Reuse.** Every new copy is named by its recipe (`<hash>.baked.wav`). Re-oning to the same
  spot, or a Cross or Discover-seed audition of a riff that's already baked, writes nothing.
- **Rebuild.** A copy that a project names but that is missing is rebuilt from the stem's lineage
  (`phaseSourcePath` + `phaseBars`) when the project opens and before an export renders it. It
  lands on the same name, so the project isn't marked unsaved.
- **Clean up.** After startup a background pass sizes the unused copies. From 200 MB a small
  notice offers to delete them, and "not now" keeps it quiet for 7 days. The gear menu gets
  "clean up re-oned stem copies…", which works at any size.

**Spec:** `docs/superpowers/specs/2026-10-09-reoned-copies-cleanup-design.md` (dcbdd2b5). Read it
first. Its Tests section is the acceptance list. Task 19 maps each spec test to the task that
writes it.

**Architecture:**
- **Pure rules, TDD, in `src/shared/`:**
  - `audioHeaderSampleRate.ts`: the sample rate from a WAV, Ogg Vorbis or FLAC header;
  - `reonedRotation.ts`: bars → seconds, the re-one job, and the rebuild's rotation candidates;
  - `reonedNames.ts`: the copy-name pattern, names in a text, names in an object tree;
  - `reonedRepair.ts`: which stems to check, and how outcomes change a project's riffs;
  - `reonedCleanup.ts`: thresholds, grace, snooze, sizes and every UI string.
- **Main:**
  - `reonedRecipe.ts`: the recipe name (sha-256 of source identity + rotation in samples +
    `BAKER_VERSION`);
  - `reonedCopiesSession.ts`: one lock around bakes and deletes, and this session's issued names;
  - `bakeOffset.ts`: recipe names, reuse before rendering, bake from the original, and a failed
    batch that never deletes a copy it didn't create;
  - `reonedRebuild.ts`: rebuild missing copies per riff, plus `ensureReonedCopiesForState` for
    exports;
  - `reonedUsage.ts`: the used set (time-sliced), the survey and the clean;
  - `reonedCopiesStore.ts`: remembered external projects and "not now", in
    `userData/reonedCopies.json`;
  - `reonedCopiesIpc.ts`: the IPC surface (one line in `index.ts`).
- **Renderer:**
  - `state/reonedInUse.ts`: names held in memory (history past/present/future, Cross draft,
    Discover slots);
  - `state/reonedMissing.ts`: the session-only "copy missing" set;
  - `state/reonedRepairOnOpen.ts`: the open-time repair;
  - `components/ReonedCopyMissingNotice.tsx`: the missing-copy pill and the retry loop;
  - `components/ReonedCopiesNotice.tsx`: the launch pass, the offer, and cleaning;
  - one Inspector line, one gear-menu item, a `REPAIR_REONED_PATHS` transient action.
- **Unchanged:**
  - the `EngineProject` wire format and `native-engine/` (no rebuild needed);
  - the save format (no new fields: `phaseSourcePath` and `phaseBars` are enough);
  - APPLY_BAKE's matching (results stay keyed by the job's `path`).

**Tech Stack:** TypeScript, vitest, React, Electron. No native changes.

**Base:** `master` at 188e45e6 (the spec is dcbdd2b5; 188e45e6 adds the autosave aside-snapshot
this plan's used set reads). **Branch:** `reoned-copies-cleanup` (`git switch -c
reoned-copies-cleanup`). One PR (AGENTS.md §3).

**Commits:** subject `area: what changed`, lowercase. Every message ends with exactly these two
lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

Commit each task's own files only (`git add <paths>` then `git commit --only <paths>`), never
`git add -A`. Other agents share this working tree.

**Before you start:**
- Run `git status --short`. Note other agents' files and leave them alone. When this plan was
  written, other agents were editing **`App.tsx`, `index.ts`, `CrossPanel.tsx` and
  `bakeOffset.ts`** (one of them may move `bakeOffset`'s `mkdirSync` inside its `try`). The
  tasks that touch those files say so. Make those edits by hand on whatever is there, anchored on
  the quoted context and function names, never on line numbers.
- Run `npm test` and `npm run typecheck`. The suite is green except for the machine-dependent
  engine-spawn tests (memory `coreaudiod_thread_leak`). In a checkout with no
  `native-engine/build`, those fail with "binary not found". This includes `bakeOffset.test.ts`'s
  native (extensionless) cases. Build the engine once (`cd native-engine && cmake -B build &&
  cmake --build build`) so Tasks 4 and 8 can run them.
- **CI's better-sqlite3 exclude list** (`vitest.config.ts`): no test in this plan opens a
  database, so none goes on it. Keep it that way:
  - `reonedUsage.ts`, `reonedRebuild.ts`, `reonedRecipe.ts`, `reonedCopiesSession.ts` and
    `reonedCopiesStore.ts` must not import `riffLibraryStore`, `discoverCandidates` or anything
    else that loads `better-sqlite3`, even transitively.
  - Copy the local `yieldToEventLoop` one-liner instead of importing `discoverCandidates.ts`'s.
  - If a test file you add ends up importing such a module, put it on the list (AGENTS.md §5).
- **Main thread under ~100 ms** (AGENTS.md §6):
  - every new filesystem read in the pass uses `node:fs/promises`;
  - the text scans run in 1 MB chunks with a yield between chunks;
  - existence checks for rebuilds are async `access` calls.

  `bakeOffset`'s own sync file reads stay as they are today.

---

## How this plan's claims were checked

Planning scratchpad:
`/private/tmp/claude-501/-Users-nickel-Claudecode-sssketch/16705ad5-406f-4f11-81e4-e91aab27bbc8/scratchpad/reoned/`

- **`chain.ts`** (bundled with esbuild, run on node) uses the real `src/shared/rotateWav.ts` on a
  4000-frame, 1000 Hz 16-bit ramp (4 bars, 1 s per bar):
  - **re-one 1 bar, then re-one 0.5 bar (today's chain: the second bake rotates the first copy,
    no blend)** is byte-identical to **one rotation of the original by 1.5 bars**: `true`;
  - **the wrap case** (3 bars then 2.5 bars = 5.5 ≡ 1.5) is byte-identical too: `true`;
  - **the edge case is not.** A first rotation of 3900 frames puts the seam at frame 100, inside
    `blendSeamInt16`'s `seamFrame <= 2 * LOOP_SEW_WINDOW_FRAMES` guard (256), so the chain never
    blended, while the direct rotation does: `false`. The difference is 128 blended frames, only
    when an earlier re-one landed within 256 frames of the loop's end. Task 4's pin test avoids
    that edge and names it.
- **Everything else was read, not run.** The code blocks below are written against 188e45e6.
  They have not been compiled, so treat them as the shape to build, and fix names against the
  real files. Every test listed must be seen failing first, then passing.

---

## Findings this plan rests on

**F1. How a re-one computes its rotation, and how `phaseBars` accumulates.**
- Every caller does the same thing: `BeatPicker.tsx`'s `bakeStems` and `rebakeRifff`,
  `crossFromSketch.ts`'s `rifffForSketchCross` (also Discover's seed path in `App.tsx`), and the
  LORE batch path (`App.tsx` → `bakeStems`). Each sends
  `{ path: stem.path, rotationSec: rotationSecondsForStem(steps, snapDiv, stem) }`:
  - `kBars = -steps / snapDiv`;
  - `rotationSec = wrap(kBars, stem.barLength) × stem.durationSec / stem.barLength`.
- **It rotates the stem's current file.** After the first re-one that is a `.baked.wav`, so
  repeated re-ones chain copy → copy. `isPreviouslyBaked` skips the seam blend on a re-bake.
- **`phaseBars` adds up unwrapped:** `phaseBars' = (phaseBars ?? 0) − steps / snapDiv`, i.e.
  `phaseBars + kBars`. So the total rotation of the current file relative to `phaseSourcePath` is
  `wrap(phaseBars, barLength) × durationSec / barLength`. The scratch check shows that one bake
  at that total equals the chain, except at the seam edge noted above.
- **`durationSec` is not stable across the first bake of a LORE stem.** Before it,
  `durationSec = barLength × (60 / bpm) × 4` (metadata: `riffLibraryStore.ts`,
  `endlesssApi.ts`, `radioHeartsImport.ts`, `tidyUpLibraryStems.ts`). APPLY_BAKE then overwrites
  it with the decoded copy's measured length (`BakeResult.durationSec`'s doc comment says the two
  differ). So the first re-one of a LORE stem used metadata seconds-per-bar, and a rebuild that
  reads today's `durationSec` would rotate by a few samples more or less. Decision D5 handles it.

**F2. Where a stem path can live** (the used set):
- saved files:
  - library projects `<root>/<name>/<name>.sssketchproj`;
  - backups `<root>/<name>/.backups/*.sssketchproj`;
  - the autosave `userData/autosave.sssketchproj`;
  - the aside snapshot `userData/autosave.previous.sssketchproj` (188e45e6);
  - external files the app opened or saved;
- renderer memory:
  - `history.past/present/future` (`state/history.ts`, `MAX_HISTORY` 100);
  - App's `crossDraft` (its own `past`/`future`);
  - App's `discoverSlots` (`seedStem`, `candidate`);
- main: bakes it has handed out this session.

The Discover keeps (`discoveredLibrary.ts`) **copy** the audio into their own room
(`copyFileSync(member.path, discoveredStemPath(...))`), and the DAW exports **copy** into
`.samples-cache` or their export folder (`materializeStemsForExport`). Neither one names `.bakes`,
so neither joins the set.

**F3. Where projects load and exports render.**
- **Renderer load sites** (each does `deserializeProject` → `warmStemCaches` → `restoreState` →
  `lastSavedJsonRef.current = dirtyCheckJson(loaded)`):
  - `loadRecoveredSnapshot`;
  - the library browser's `onSelect`;
  - `onOpenFromDisk`.

  Find all of them with `grep -n "deserializeProject(" src/renderer/src/App.tsx`.
- **Main export choke points** (each receives a full `AppState`):
  - `buildAndWriteAlsProject` (`exportAbleton.ts`);
  - `buildAndWriteRppProject` (`exportReaper.ts`);
  - `nativeExport`, `renderStemsToDir` and `renderStemTracksToDir` (`nativeExport.ts`).
- **The engine load** (`engine-load-project`) receives a built `EngineProject`. It has no
  lineage, and it is fire-and-forget.

**F4. The gear menu** is `TransportBar.tsx`'s settings menu (`SettingsGearIcon`,
`handleOpenSettingsMenu`, `ContextMenu` items with `disabled`/`title`). App.tsx's `gearMenu` is
the "tidy" button, despite its name.

**F5. Notices.** Small fixed pills stack at the top right: `StemsUnavailableIndicator` (top 70),
`PluginsOffNotice` (100), `PluginsHeldNotice` (128), all mounted in `App.tsx` beside
`BackgroundWorkIndicator`. "After startup" is main's `libraryWarmupDone`
(`getLibraryWarmupStatus` + `onLibraryWarmupComplete`, query-plus-push).

---

## Decisions (made here; flag any Elling disagrees with in the PR)

- **D1. Re-ones bake from the original with the total rotation.** The job carries an optional
  `recipe: { sourcePath, rotationSec }`. It is computed from `phaseSourcePath` and the new
  `phaseBars`. A copy's name can only be rebuilt if it is a function of the original and the
  total rotation, and chained bakes from an intermediate copy aren't. When the original is
  unreachable (LORE drive unplugged), the bake falls back to today's chain from `job.path`. That
  copy is still recipe-named, from the file it was really made from.
  - **Cost:** re-oning a LORE stem a second time now decodes the Ogg original through the engine.
    Today it rotates the first copy in JS. Reuse wins the time back on repeats.
- **D2. Results stay keyed by `job.path`.** APPLY_BAKE, `rifffForSketchCross` and `bakeStems`
  keep matching results the same way.
- **D3. The rotation in the recipe is in samples:** `round(rotationSec × sampleRate)`, with the
  rate read from the source's first 64 KB (WAV `fmt `, Ogg Vorbis identification header, FLAC
  STREAMINFO). The baker is handed the quantised `samples / rate`, so two rotations that round to
  the same frame produce the same bytes and the same name. For an unrecognised format the key is
  the seconds to 6 decimals, and the rotation is passed through unchanged.
- **D4. Source identity is the spec's: path + size + `Math.trunc(mtimeMs)`.** A LORE archive
  that moves to another mount point gives new names on rebuild. That is correct, just not
  path-stable. (A content id such as the StemCID basename would survive the move; left as a
  follow-up.)
- **D5. A rebuild tries up to two rotations and keeps the one whose recipe name matches the
  missing file's name.**
  - (a) from the stem's current `durationSec`;
  - (b) from LORE metadata, `barLength × (60 / rifff.bpm) × 4`.

  (b) is what the first re-one of a LORE stem used (F1). If neither matches (a legacy uuid copy,
  or a Discover-assembled riff with mixed bpm), it uses (a): the path changes and the project is
  marked unsaved, as the spec allows.
- **D6. "Before the engine loads it" is the renderer's open-time repair.** It runs before
  `restoreState`, and `restoreState` is what triggers the first engine load. Main does not hold
  `engine-load-project`: the `EngineProject` wire format carries no lineage, and making that
  fire-and-forget call wait would let a later load overtake an earlier one (radio staging relies
  on the order). Exports are repaired in main at the five choke points (F3), because they receive
  a full `AppState`.
- **D7. The used set matches basenames, read as raw text.** No `JSON.parse`. A copy is used if
  any file or memory names `<name>.baked.wav` anywhere, in any folder. This is conservative: it
  still holds after the library root has moved, and a `phaseSourcePath` naming a copy counts too.
  Copy names are hex or uuid, so the regex `[0-9A-Za-z_-]+\.baked\.wav` needs no JSON unescaping.
- **D8. In-flight safety comes from a lock and a session set, not from touching files.**
  - `reonedCopiesSession.ts` serialises `bakeOffset` with the clean's delete phase.
  - Every name `bakeOffset` returns joins `sessionIssuedNames()`, which always counts as used.
    That covers the window between main handing a reused copy out and the renderer holding it.
  - Touching the mtime on reuse was rejected: `stemCacheKey` (Ableton export's
    `.samples-cache`) hashes the stem file's mtime, so every touch would orphan a cached sample.
- **D9. Remembered external projects also remember their names.** `userData/reonedCopies.json`
  keeps `{ path, names, at }`: newest first, capped at **50**, recorded on open, save as, in-place
  save outside the library, and rename. At scan time a readable file's current names are joined
  with the remembered ones, so a project on an unplugged drive still protects its copies. The same
  file holds `notNowUntil`.
- **D10. An unreadable library project or backup stops the pass.** That means a read error other
  than "not found". The launch notice stays hidden, and the manual button says nothing was
  cleaned. A missing file between listing and reading (deleted meanwhile) is skipped.
- **D11. Stale temporaries count.** `.<…>.baking.wav` files older than a day are leftovers of a
  crash mid-bake and are cleaned with the unused copies (they count in the size). They are never
  in use.
- **D12. Copy the spec doesn't give** (all lowercase, in `reonedCleanup.ts`):
  - under 1 MB: "less than 1 MB of re-oned stem copies aren't used by any project. …" (no
    "about");
  - nothing to clean: "every re-oned stem copy is in use. nothing to clean up." with one button,
    "ok";
  - the pass couldn't read a project: "couldn't read every project, so nothing was cleaned."
    with "ok";
  - the greyed gear item's title: "project library not found";
  - while working: "looking…" and "cleaning…".
- **D13. "not now" snoozes for 7 days whichever way the notice was opened.**
- **D14. The missing state lives in the renderer only.** It is not saved and not undoable.
  - `state/reonedMissing.ts` holds the missing copy paths.
  - A persistent pill (top 156) shows the spec's exact wording, "re-oned copy missing · rebuilds
    when its original is back". Its `title` gives the count.
  - The Inspector shows the same words under each affected stem.
  - **Retry:** while the set is non-empty, every 15 s, the open project's riffs that hold a
    missing copy are re-sent to the rebuild. Main fails fast (async `access`) while the original
    or the library is away. This is "retried when the library reconnects".
  - A rebuild that lands on the same path dispatches nothing. It evicts that path's analysis and
    flushes the engine sync (`StemBufferCache::load` doesn't cache a failed load, so a re-send
    retries the decode). A rebuild that lands on a new path dispatches `REPAIR_REONED_PATHS`
    (transient, so not an undo step), and the project is then unsaved.
- **D15. The pass is not shown in `BackgroundWorkIndicator`.** It is a few seconds of stats and
  text scans; the notice itself shows "looking…" or "cleaning…" when it was asked for.
- **D16. A failed batch only deletes what it created.** A reused copy, or a final that existed
  before this call, is never unlinked by `bakeOffset`'s cleanup. Today's `finally` unlinks every
  planned `finalPath` on failure. With reuse that would delete a copy other projects share.
- **D17. The baker never recreates a missing library root.** When `outputDir`'s parent is absent
  (the library's drive is unplugged), the batch fails instead of `mkdirSync` creating a stray
  folder.
- **D18. Not behind the advanced switch** (spec).

## Spec ambiguities resolved

1. **"The rotation that `phaseBars` gives in seconds":** which seconds-per-bar (F1, D5).
2. **"Before the engine loads it":** the renderer's open-time repair, not an intercept of
   `engine-load-project` (D6). A copy deleted by hand while its project is open is repaired at the
   next open or export, not mid-session.
3. **"The gear menu":** the transport's settings gear (F4).
4. **Copy for the cases the spec doesn't show** (D12).
5. **"200 MB":** decimal, 200,000,000 bytes, matching how Finder reports sizes. Sizes display as
   `1.2 GB` (one decimal, at 1 GB and up) or `340 MB`.
6. **What "used" includes:** the spec's list plus this session's issued names (D8). The Discover
   keeps are excluded, because they copy their audio (F2).
7. **"The stem shows as missing":** a pill plus an Inspector line, with the spec's wording for
   one or many (D14).
8. **Stale `.baking.wav` temporaries** (D11).
9. **A library project that can't be read** (D10).

## Risks

- **R1. Re-ones change how they render** (D1). Bytes match today's chain, except when an earlier
  re-one put the seam within 256 frames of the loop's start (verified above). LORE re-ones after
  the first now spawn the engine every time.
  - Walkthrough step 3 times a second re-one of a LORE riff.
- **R2. Audio is truly lost** when a copy is cleaned and its original can never come back: a
  LORE stem dropped from the cache and no longer downloadable, a deleted WAV, a project kept
  outside the library and dropped off the remembered 50.
  - The spec accepts this ("A project moved by hand outside the library, never opened since").
  - A not-yet-downloaded LORE original isn't fetched by the rebuild either. It shows as missing.
    Fetching it is a follow-up.
- **R3. Concurrent edits** to `App.tsx`, `index.ts` and `bakeOffset.ts`. Tasks 4, 13, 15 and 17
  must be rebased by hand.
- **R4. A project too large to scan quickly.** The scan is chunked, but readdir of a library with
  thousands of sketches × 10 backups is thousands of async reads. It runs in the background, so
  it is slow but never blocking.
- **R5. A rebuilt copy is not byte-identical when the original changed.** If the original was
  re-downloaded or re-saved, its mtime changes, so the recipe name changes. The rebuild then
  lands on a new path (unsaved).
- **R6. A copy that shows blank after a same-path mid-session rebuild.** A waveform already on
  screen keeps its failed decode until remount (`evictStemAnalysis` doc). Audio plays after the
  engine flush.
- **R7. Undo can reach back past a path-changing repair.** `REPAIR_REONED_PATHS` is transient,
  so undoing past a path-changing repair restores the missing path. The retry loop only runs while
  something is known missing, so that riff is silent until the next open or export repairs it
  again. Accepted as rare.

---

## File map

**New (each with a test unless noted):**
- `src/shared/audioHeaderSampleRate.ts`
- `src/shared/reonedRotation.ts`
- `src/shared/reonedNames.ts`
- `src/shared/reonedRepair.ts`
- `src/shared/reonedCleanup.ts`
- `src/main/reonedRecipe.ts`
- `src/main/reonedCopiesSession.ts`
- `src/main/reonedRebuild.ts`
- `src/main/reonedUsage.ts`
- `src/main/reonedCopiesStore.ts`
- `src/main/reonedCopiesIpc.ts` (no test: wiring only, verified by typecheck)
- `src/renderer/src/state/reonedInUse.ts`
- `src/renderer/src/state/reonedMissing.ts`
- `src/renderer/src/state/reonedRepairOnOpen.ts`
- `src/renderer/src/components/ReonedCopyMissingNotice.tsx` (no test, per convention)
- `src/renderer/src/components/ReonedCopiesNotice.tsx` (no test, per convention)

**Modified:**
- `src/main/bakeOffset.ts` (+ `bakeOffset.test.ts`): **another agent is editing it**
- `src/renderer/src/state/selectors.ts`: `rotationSecondsForStem` delegates
- `src/renderer/src/components/BeatPicker.tsx`, `components/crossFromSketch.ts`
  (+ `crossFromSketch.test.ts`)
- `src/preload/index.ts`: the `bakeOffset` job type, plus the new API
- `src/main/projectFile.ts` (+ `projectFile.test.ts`)
- `src/main/exportAbleton.ts`, `src/main/exportReaper.ts`, `src/main/nativeExport.ts`
- `src/main/index.ts`: one line. **Another agent is editing it.**
- `src/renderer/src/state/StoreContext.tsx`, `state/store.ts`, `state/history.ts`
  (+ `store.test.ts`)
- `src/renderer/src/App.tsx`: three load sites, two mounts, two effects. **Another agent is
  editing it.**
- `src/renderer/src/components/Inspector.tsx`, `components/TransportBar.tsx`
- `CLAUDE.md`, `AGENTS.md`, `TO-DO.md`, `CHANGELOG.md`

---

## Phase 1: reuse (Tasks 1-5)

### Task 1: The sample rate from a file header

**Files:**
- Create: `src/shared/audioHeaderSampleRate.ts`
- Test: `src/shared/audioHeaderSampleRate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/audioHeaderSampleRate.test.ts
import { describe, expect, it } from 'vitest'
import { sampleRateFromHeader } from './audioHeaderSampleRate'

function wavHeader(sampleRate: number, declaredDataBytes = 0): Uint8Array {
  const buf = new Uint8Array(44)
  const view = new DataView(buf.buffer)
  const ascii = (at: number, s: string): void =>
    s.split('').forEach((c, i) => (buf[at + i] = c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + declaredDataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 2, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 4, true)
  view.setUint16(32, 4, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, declaredDataBytes, true)
  return buf
}

function oggVorbisHeader(sampleRate: number): Uint8Array {
  const buf = new Uint8Array(58)
  buf.set([0x4f, 0x67, 0x67, 0x53], 0) // OggS
  buf[26] = 1 // one segment
  buf[27] = 30 // of 30 bytes: the identification packet
  const packet = 28
  buf.set([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73], packet) // \x01vorbis
  buf[packet + 11] = 2 // channels
  new DataView(buf.buffer).setUint32(packet + 12, sampleRate, true)
  return buf
}

function flacHeader(sampleRate: number): Uint8Array {
  const buf = new Uint8Array(42)
  buf.set([0x66, 0x4c, 0x61, 0x43], 0) // fLaC
  buf[4] = 0x80 // last metadata block, type 0 (STREAMINFO)
  buf[7] = 34
  buf[18] = (sampleRate >> 12) & 0xff
  buf[19] = (sampleRate >> 4) & 0xff
  buf[20] = (sampleRate & 0x0f) << 4
  return buf
}

describe('sampleRateFromHeader', () => {
  it('reads a WAV fmt chunk, even when the data chunk runs past the bytes read', () => {
    expect(sampleRateFromHeader(wavHeader(44100))).toBe(44100)
    expect(sampleRateFromHeader(wavHeader(48000, 10_000_000))).toBe(48000)
  })

  it('reads an Ogg Vorbis identification header (a LORE stem, no extension)', () => {
    expect(sampleRateFromHeader(oggVorbisHeader(44100))).toBe(44100)
    expect(sampleRateFromHeader(oggVorbisHeader(48000))).toBe(48000)
  })

  it('reads FLAC STREAMINFO', () => {
    expect(sampleRateFromHeader(flacHeader(96000))).toBe(96000)
  })

  it('returns null for anything it does not recognise, or a header cut short', () => {
    expect(sampleRateFromHeader(new Uint8Array(0))).toBeNull()
    expect(sampleRateFromHeader(new TextEncoder().encode('ID3 not an mp3 parser'))).toBeNull()
    expect(sampleRateFromHeader(oggVorbisHeader(44100).subarray(0, 30))).toBeNull()
    expect(sampleRateFromHeader(wavHeader(0))).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/shared/audioHeaderSampleRate.test.ts`
Expected: FAIL, cannot find module `./audioHeaderSampleRate`.

- [ ] **Step 3: Implement**

```ts
// src/shared/audioHeaderSampleRate.ts
import { findWavChunks } from './wavChunks'

/** \x01vorbis: the start of an Ogg Vorbis identification packet. */
const VORBIS_ID = [0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]
/** The identification packet sits in the first page; it never needs a long search. */
const OGG_SEARCH_BYTES = 512

/** The sample rate a source decodes at, read from the first bytes of the file only, so a
 * re-oned copy's recipe (src/main/reonedRecipe.ts) can name its rotation in samples before any
 * audio is decoded. WAV (an import), Ogg Vorbis (a LORE stem, path with no extension) and FLAC.
 * null for anything else: the recipe then keys the rotation in seconds instead. */
export function sampleRateFromHeader(bytes: Uint8Array): number | null {
  if (bytes.length < 12) return null
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (tag === 'RIFF') {
    try {
      // findWavChunks clamps a data chunk that runs past the bytes it was given, so a header
      // read is enough; it throws only on a truncated fmt chunk.
      return findWavChunks(bytes).sampleRate || null
    } catch {
      return null
    }
  }
  if (tag === 'OggS') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const last = Math.min(bytes.length - 16, OGG_SEARCH_BYTES)
    for (let i = 0; i <= last; i++) {
      if (VORBIS_ID.every((value, k) => bytes[i + k] === value)) {
        const rate = view.getUint32(i + 12, true)
        return rate > 0 ? rate : null
      }
    }
    return null
  }
  if (tag === 'fLaC' && bytes.length >= 21) {
    const rate = (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4)
    return rate > 0 ? rate : null
  }
  return null
}
```

- [ ] **Step 4: Run it and see it pass.** Same command. Expected: 4 passed.
- [ ] **Step 5: Commit**

```bash
git add src/shared/audioHeaderSampleRate.ts src/shared/audioHeaderSampleRate.test.ts
git commit --only src/shared/audioHeaderSampleRate.ts src/shared/audioHeaderSampleRate.test.ts \
  -m "re-one: read a source's sample rate from its header (wav, ogg vorbis, flac)" \
  -m "A re-oned copy will be named by its recipe, with the rotation in samples, before any audio is decoded." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

### Task 2: The recipe name

**Files:**
- Create: `src/main/reonedRecipe.ts`
- Test: `src/main/reonedRecipe.test.ts`

- [ ] **Step 1: Write the failing test** (spec: "stable for the same inputs, different for a
  different source, rotation or baker version")

```ts
// src/main/reonedRecipe.test.ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BAKER_VERSION, recipeName, resolveRecipe, rotationKeyFor } from './reonedRecipe'

const source = { path: '/lib/stems/abc.wav', size: 1000, mtimeMs: 1_700_000_000_123.456 }

describe('recipeName', () => {
  it('is a 32-hex name with the .baked.wav suffix, stable for the same inputs', () => {
    const a = recipeName(source, { samples: 250 })
    expect(a).toMatch(/^[0-9a-f]{32}\.baked\.wav$/)
    expect(recipeName({ ...source }, { samples: 250 })).toBe(a)
    // Sub-millisecond mtime noise is not part of the identity.
    expect(recipeName({ ...source, mtimeMs: 1_700_000_000_123.9 }, { samples: 250 })).toBe(a)
  })

  it('changes with the source path, size or mtime', () => {
    const a = recipeName(source, { samples: 250 })
    expect(recipeName({ ...source, path: '/lib/stems/abd.wav' }, { samples: 250 })).not.toBe(a)
    expect(recipeName({ ...source, size: 1001 }, { samples: 250 })).not.toBe(a)
    expect(recipeName({ ...source, mtimeMs: source.mtimeMs + 1000 }, { samples: 250 })).not.toBe(a)
  })

  it('changes with the rotation and with the baker version', () => {
    const a = recipeName(source, { samples: 250 })
    expect(recipeName(source, { samples: 251 })).not.toBe(a)
    expect(recipeName(source, { seconds: 0.25 })).not.toBe(a)
    expect(recipeName(source, { samples: 250 }, BAKER_VERSION + 1)).not.toBe(a)
  })
})

describe('rotationKeyFor', () => {
  it('rounds to whole samples when the rate is known, so float noise names one file', () => {
    expect(rotationKeyFor(0.25, 1000)).toEqual({ samples: 250 })
    expect(rotationKeyFor(0.2500000001, 1000)).toEqual({ samples: 250 })
    expect(rotationKeyFor(0.25, null)).toEqual({ seconds: 0.25 })
  })
})

describe('resolveRecipe', () => {
  it('reads the identity and rate from disk and hands back the quantised rotation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recipe-'))
    try {
      const path = join(dir, 'src.wav')
      const header = Buffer.alloc(44)
      header.write('RIFF', 0)
      header.writeUInt32LE(36, 4)
      header.write('WAVEfmt ', 8)
      header.writeUInt32LE(16, 16)
      header.writeUInt16LE(1, 20)
      header.writeUInt16LE(1, 22)
      header.writeUInt32LE(1000, 24)
      header.writeUInt32LE(2000, 28)
      header.writeUInt16LE(2, 32)
      header.writeUInt16LE(16, 34)
      header.write('data', 36)
      writeFileSync(path, header)
      utimesSync(path, 1_700_000_000, 1_700_000_000)
      const r = await resolveRecipe(path, 0.2504)
      expect(r.rotationFrames).toBe(250)
      expect(r.rotationSec).toBe(0.25)
      expect(r.name).toBe(
        recipeName({ path, size: 44, mtimeMs: 1_700_000_000_000 }, { samples: 250 })
      )
      await expect(resolveRecipe(join(dir, 'gone.wav'), 0.25)).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/main/reonedRecipe.test.ts`. Expected: FAIL (no module).
- [ ] **Step 3: Implement**

```ts
// src/main/reonedRecipe.ts
// The name of a re-oned stem copy (`<library>/.bakes/<name>`): a hash of exactly what the baker
// needs to reproduce its bytes. See docs/superpowers/specs/2026-10-09-reoned-copies-cleanup-design.md.
// No better-sqlite3 and no electron here: imported by bakeOffset.ts, reonedRebuild.ts and tests.
import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { sampleRateFromHeader } from '@shared/audioHeaderSampleRate'

/** Bump whenever the baker's output for the same inputs changes: rotateWav.ts's rotation or
 * seam blend, LOOP_SEW_WINDOW_FRAMES, BakeStem.cpp's decode or bit depth, bakeOffset.ts's
 * blend-once rule. Old copies are then never reused; cleanup clears them once unused. */
export const BAKER_VERSION = 1

const HEADER_BYTES = 64 * 1024

export interface SourceIdentity {
  path: string
  size: number
  mtimeMs: number
}

export type RotationKey = { samples: number } | { seconds: number }

export function rotationKeyFor(rotationSec: number, sampleRate: number | null): RotationKey {
  return sampleRate
    ? { samples: Math.round(rotationSec * sampleRate) }
    : { seconds: Number(rotationSec.toFixed(6)) }
}

export function recipeName(
  source: SourceIdentity,
  rotation: RotationKey,
  bakerVersion: number = BAKER_VERSION
): string {
  const recipe = JSON.stringify([
    'sssketch-reone',
    bakerVersion,
    source.path,
    source.size,
    Math.trunc(source.mtimeMs),
    'samples' in rotation ? `s${rotation.samples}` : `t${rotation.seconds}`
  ])
  return `${createHash('sha256').update(recipe).digest('hex').slice(0, 32)}.baked.wav`
}

export interface ResolvedRecipe {
  sourcePath: string
  name: string
  /** What the renderer is handed: quantised to whole frames when the rate is known, so two
   * rotations that name the same file also render the same bytes. */
  rotationSec: number
  rotationFrames: number | null
}

/** Reads the source's identity and header. Rejects when the source can't be read: the caller
 * decides whether that means "fall back" (a re-one) or "missing" (a rebuild). */
export async function resolveRecipe(sourcePath: string, rotationSec: number): Promise<ResolvedRecipe> {
  const info = await stat(sourcePath)
  const handle = await open(sourcePath, 'r')
  let header: Uint8Array
  try {
    const buf = Buffer.alloc(Math.min(HEADER_BYTES, info.size))
    await handle.read(buf, 0, buf.length, 0)
    header = new Uint8Array(buf)
  } finally {
    await handle.close()
  }
  const sampleRate = sampleRateFromHeader(header)
  const key = rotationKeyFor(rotationSec, sampleRate)
  return {
    sourcePath,
    name: recipeName({ path: sourcePath, size: info.size, mtimeMs: info.mtimeMs }, key),
    rotationSec: 'samples' in key && sampleRate ? key.samples / sampleRate : rotationSec,
    rotationFrames: 'samples' in key ? key.samples : null
  }
}
```

- [ ] **Step 4: Run it and see it pass.** Expected: 5 passed.
- [ ] **Step 5: Commit** `src/main/reonedRecipe.ts src/main/reonedRecipe.test.ts`. Subject:
  `re-one: name a copy by its recipe (source identity, rotation in samples, baker version)`.

### Task 3: Bars to seconds, the re-one job, the rebuild's candidates

**Files:**
- Create: `src/shared/reonedRotation.ts`
- Test: `src/shared/reonedRotation.test.ts`
- Modify: `src/renderer/src/state/selectors.ts`. `rotationSecondsForStem` delegates, so there is
  one formula.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/reonedRotation.test.ts
import { describe, expect, it } from 'vitest'
import type { Stem } from './types'
import {
  nextPhaseBars,
  rebuildRotationCandidates,
  reoneJob,
  rotationSecForBars
} from './reonedRotation'

const stem = (over: Partial<Stem> = {}): Stem => ({
  slot: 1,
  author: 'a',
  name: 'drums',
  type: 'drums',
  path: '/src/one.wav',
  durationSec: 8,
  barLength: 4,
  ...over
})

describe('rotationSecForBars', () => {
  it('wraps unwrapped bars into the stem loop and scales by its seconds per bar', () => {
    expect(rotationSecForBars(1, stem())).toBe(2)
    expect(rotationSecForBars(5.5, stem())).toBe(3) // 5.5 ≡ 1.5 bars
    expect(rotationSecForBars(-0.5, stem())).toBe(7) // -0.5 ≡ 3.5 bars
    expect(rotationSecForBars(0, stem())).toBe(0)
  })
})

describe('nextPhaseBars', () => {
  it('accumulates unwrapped, the way BeatPicker always has: phaseBars - steps / snapDiv', () => {
    expect(nextPhaseBars(stem(), -4, 4)).toBe(1)
    expect(nextPhaseBars(stem({ phaseBars: 1 }), -2, 4)).toBe(1.5)
    expect(nextPhaseBars(stem({ phaseBars: 3 }), -10, 4)).toBe(5.5)
  })
})

describe('reoneJob', () => {
  it('a stem never re-oned: the job rotates its own file, no separate recipe', () => {
    expect(reoneJob(stem(), -4, 4)).toEqual({ path: '/src/one.wav', rotationSec: 2 })
  })

  it('a stem already re-oned: keeps the chain job, and adds the recipe from the original at the total', () => {
    const s = stem({ path: '/lib/.bakes/x.baked.wav', phaseSourcePath: '/src/one.wav', phaseBars: 1 })
    expect(reoneJob(s, -2, 4)).toEqual({
      path: '/lib/.bakes/x.baked.wav',
      rotationSec: 1, // 0.5 bar of the current file: today's chain, the fallback
      recipe: { sourcePath: '/src/one.wav', rotationSec: 3 } // 1.5 bars of the original
    })
  })
})

describe('rebuildRotationCandidates', () => {
  it('first from durationSec, then from the riff bpm the way a LORE import computed durationSec', () => {
    // A LORE stem first re-oned with metadata durationSec 8 (4 bars at 120), then
    // APPLY_BAKE stored the measured 8.01.
    const s = stem({ durationSec: 8.01, phaseSourcePath: '/lore/CID', phaseBars: 1 })
    const [measured, metadata] = rebuildRotationCandidates(s, 120)
    expect(measured).toBeCloseTo(2.0025, 10)
    expect(metadata).toBe(2)
  })

  it('drops a duplicate or unusable candidate', () => {
    const s = stem({ phaseSourcePath: '/src/one.wav', phaseBars: 1 })
    expect(rebuildRotationCandidates(s, 120)).toEqual([2])
    expect(rebuildRotationCandidates(s, 0)).toEqual([2])
  })
})
```

- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/shared/reonedRotation.test.ts`.
- [ ] **Step 3: Implement**

```ts
// src/shared/reonedRotation.ts
import type { Stem } from './types'

/** Where `bars` (clockwise, unwrapped, as phaseBars accumulates) lands inside the stem's own
 * loop, in seconds. The one formula: selectors.ts's rotationSecondsForStem delegates here. */
export function rotationSecForBars(
  bars: number,
  stem: Pick<Stem, 'barLength' | 'durationSec'>
): number {
  const wrapped = ((bars % stem.barLength) + stem.barLength) % stem.barLength
  return wrapped * (stem.durationSec / stem.barLength)
}

export function nextPhaseBars(stem: Pick<Stem, 'phaseBars'>, steps: number, snapDiv: number): number {
  return (stem.phaseBars ?? 0) - steps / snapDiv
}

export interface ReoneBakeJob {
  /** The stem's current file. Results come back keyed by it (APPLY_BAKE matches on it). */
  path: string
  /** This step's rotation of `path`: what the baker falls back to if the original is away. */
  rotationSec: number
  /** Bake from the original by the total instead, so the copy is named, reused and rebuilt by
   * its recipe. Absent when `path` is the original. */
  recipe?: { sourcePath: string; rotationSec: number }
}

/** The job every re-one, re-bake, Cross parent and Discover seed sends to bakeOffset. */
export function reoneJob(stem: Stem, steps: number, snapDiv: number): ReoneBakeJob {
  const job = { path: stem.path, rotationSec: rotationSecForBars(-steps / snapDiv, stem) }
  if (stem.phaseSourcePath === undefined || stem.phaseSourcePath === stem.path) return job
  return {
    ...job,
    recipe: {
      sourcePath: stem.phaseSourcePath,
      rotationSec: rotationSecForBars(nextPhaseBars(stem, steps, snapDiv), stem)
    }
  }
}

/** The rotations a rebuild of a missing copy may have been made with, most likely first (D5):
 * from the stem's current durationSec, then from LORE metadata (barLength × 60/bpm × 4, how
 * riffLibraryStore/endlesssApi set durationSec before APPLY_BAKE replaced it with the measured
 * length). Main keeps the one whose recipe name matches the missing file. */
export function rebuildRotationCandidates(stem: Stem, rifffBpm: number): number[] {
  const bars = stem.phaseBars ?? 0
  const candidates = [rotationSecForBars(bars, stem)]
  if (rifffBpm > 0) {
    const metadataDuration = stem.barLength * (60 / rifffBpm) * 4
    candidates.push(rotationSecForBars(bars, { barLength: stem.barLength, durationSec: metadataDuration }))
  }
  return candidates.filter((c, i) => Number.isFinite(c) && candidates.indexOf(c) === i)
}
```

In `selectors.ts`, replace `rotationSecondsForStem`'s body (keep its doc comment):

```ts
export function rotationSecondsForStem(offsetSteps: number, snapDiv: number, stem: Stem): number {
  return rotationSecForBars(-offsetSteps / snapDiv, stem)
}
```

and add `import { rotationSecForBars } from '@shared/reonedRotation'`.

- [ ] **Step 4: Run** `npx vitest run src/shared/reonedRotation.test.ts src/renderer/src/state/selectors.test.ts`.
  Expected: all pass. The existing `rotationSecondsForStem` tests pin that the delegation changed
  nothing.
- [ ] **Step 5: Commit** the three files. Subject:
  `re-one: one bars-to-seconds formula, the re-one job with its recipe, rebuild candidates`.

### Task 4: `bakeOffset` names by recipe, reuses, bakes from the original, never deletes a shared copy

**Files:**
- Create: `src/main/reonedCopiesSession.ts` (+ `reonedCopiesSession.test.ts`)
- Modify: `src/main/bakeOffset.ts`, `src/main/bakeOffset.test.ts`. **Another agent may have
  changed `bakeOffset.ts`** (`mkdirSync` inside the `try`). Run `git log -3 -- src/main/bakeOffset.ts`
  and work on what is there.

- [ ] **Step 1: The session module, test first**

```ts
// src/main/reonedCopiesSession.test.ts
import { describe, expect, it } from 'vitest'
import { noteIssuedCopy, sessionIssuedNames, withReonedCopiesLock } from './reonedCopiesSession'

describe('withReonedCopiesLock', () => {
  it('runs one holder at a time, in call order, and survives a rejection', async () => {
    const order: string[] = []
    const slow = withReonedCopiesLock(async () => {
      order.push('a-start')
      await new Promise((r) => setTimeout(r, 20))
      order.push('a-end')
    })
    const failing = withReonedCopiesLock(async () => {
      order.push('b')
      throw new Error('boom')
    })
    const after = withReonedCopiesLock(async () => order.push('c'))
    await slow
    await expect(failing).rejects.toThrow('boom')
    await after
    expect(order).toEqual(['a-start', 'a-end', 'b', 'c'])
  })
})

describe('sessionIssuedNames', () => {
  it('remembers the basename of every copy handed out', () => {
    noteIssuedCopy('/lib/.bakes/0123abcd.baked.wav')
    expect(sessionIssuedNames().has('0123abcd.baked.wav')).toBe(true)
  })
})
```

```ts
// src/main/reonedCopiesSession.ts
// One process-wide lock around everything that creates or deletes files in `.bakes`
// (bakeOffset, reonedUsage's clean), and the names this session has handed to the renderer.
// A handed-out name always counts as used (decision D8 in the plan): the renderer may hold it
// in memory before it can report it.
import { basename } from 'node:path'

let tail: Promise<unknown> = Promise.resolve()

export function withReonedCopiesLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn)
  tail = run.catch(() => undefined)
  return run
}

const issued = new Set<string>()

export function noteIssuedCopy(path: string): void {
  issued.add(basename(path))
}

export function sessionIssuedNames(): ReadonlySet<string> {
  return issued
}
```

Run `npx vitest run src/main/reonedCopiesSession.test.ts`: fail, implement, pass, commit
(`re-one: a lock around .bakes writes and deletes, and this session's handed-out copies`).

- [ ] **Step 2: Write the failing `bakeOffset` tests.** Append to `src/main/bakeOffset.test.ts`. It
  already has `writeRampWav` and `findDataChunkOffset`. Reuse them.

```ts
import { rotationSecForBars } from '@shared/reonedRotation'
import { recipeName } from './reonedRecipe'
import { statSync } from 'node:fs'

describe('bakeOffset recipes', () => {
  // 4 bars of 1 s at 1000 Hz: bar-aligned rotations are whole frames, and every seam
  // lands far from the blend guard's 256-frame edge (see the plan's scratch check).
  const stemShape = { barLength: 4, durationSec: 4 }

  it('names a copy by its recipe, and re-oning twice to the same spot writes one file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const out = join(dir, 'bakes')
      const first = await bakeOffset([{ path: source, rotationSec: 1 }], out)
      const info = statSync(source)
      expect(first[0].bakedPath).toBe(
        join(out, recipeName({ path: source, size: info.size, mtimeMs: info.mtimeMs }, { samples: 1000 }))
      )
      const second = await bakeOffset([{ path: source, rotationSec: 1.0000001 }], out)
      expect(second).toEqual(first)
      expect(readdirSync(out)).toEqual([basename(first[0].bakedPath)])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('PIN: two chained re-ones and a bake from the original at the total phaseBars give the same bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const legacy = join(dir, 'legacy') // today's behaviour: chain, no recipe
      const a = await bakeOffset([{ path: source, rotationSec: rotationSecForBars(1, stemShape) }], legacy)
      const chained = await bakeOffset(
        [{ path: a[0].bakedPath, rotationSec: rotationSecForBars(0.5, stemShape) }],
        legacy
      )
      // phaseBars after the two re-ones: 0 + 1 + 0.5 (nextPhaseBars). A rebuild bakes the
      // original by rotationSecForBars(phaseBars).
      const out = join(dir, 'bakes')
      const rebuilt = await bakeOffset(
        [{ path: '/missing/copy.baked.wav', rotationSec: 0, recipe: { sourcePath: source, rotationSec: rotationSecForBars(1.5, stemShape) } }],
        out
      )
      expect(readFileSync(rebuilt[0].bakedPath)).toEqual(readFileSync(chained[0].bakedPath))
      expect(rebuilt[0].path).toBe('/missing/copy.baked.wav')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a re-one of an already re-oned stem bakes from the original when it is there, and chains when it is not', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const out = join(dir, 'bakes')
      const [copy] = await bakeOffset([{ path: source, rotationSec: 1 }], out)
      const job = { path: copy.bakedPath, rotationSec: 0.5, recipe: { sourcePath: source, rotationSec: 1.5 } }
      const [fromOriginal] = await bakeOffset([job], out)
      const [direct] = await bakeOffset([{ path: source, rotationSec: 1.5 }], out)
      expect(fromOriginal.bakedPath).toBe(direct.bakedPath) // reuse: same recipe, one file
      rmSync(source)
      const [chained] = await bakeOffset([job], out)
      expect(chained.bakedPath).not.toBe(fromOriginal.bakedPath) // named from the copy it came from
      expect(readFileSync(chained.bakedPath)).toEqual(readFileSync(fromOriginal.bakedPath))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a failed batch deletes nothing it did not create, even a copy it was about to reuse', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const out = join(dir, 'bakes')
      const [shared] = await bakeOffset([{ path: source, rotationSec: 1 }], out)
      const results = await bakeOffset(
        [
          { path: source, rotationSec: 1 }, // reuses `shared`
          { path: source, rotationSec: 2 }, // would be new
          { path: join(dir, 'gone.wav'), rotationSec: 1 } // fails the batch
        ],
        out
      )
      expect(results).toEqual([])
      expect(readdirSync(out)).toEqual([basename(shared.bakedPath)])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to recreate a library root that is not there (an unplugged drive)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const out = join(dir, 'unplugged-root', '.bakes')
      expect(await bakeOffset([{ path: source, rotationSec: 1 }], out)).toEqual([])
      expect(existsSync(join(dir, 'unplugged-root'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

Add `basename` to the `node:path` import. Also update the two older WAV tests' regex
`/\.sssketch-bakes\/.+\.baked\.wav$/` to stay as they are: with no `outputDir`, the default
`.sssketch-bakes` beside the source is unchanged.

- [ ] **Step 3: Run it and see the new ones fail.** `npx vitest run src/main/bakeOffset.test.ts`.
  Expected: the five new tests fail (uuid names, no `recipe`, the reused copy is unlinked, the
  root is created).
- [ ] **Step 4: Implement in `bakeOffset.ts`.** Keep every existing doc comment that still holds
  (the blend-once essay, `blendNativeBakeSeam`, `bakeNativeJobs`).
  1. `BakeJob` gains `recipe?: { sourcePath: string; rotationSec: number }`, documented as in
     `ReoneBakeJob` (Task 3). Export nothing new from the renderer side. The preload type changes
     in Task 5.
  2. Replace `allocateDestination` / `BakeDestination` with a planned job:

     ```ts
     interface PlannedJob {
       job: BakeJob
       recipe: ResolvedRecipe // reonedRecipe.ts
       finalPath: string
       temporaryPath: string // `.${recipe.name}.${randomUUID()}.baking.wav`: unique, so two racing bakes never share a temp
       /** Set when the final already existed before this call: reused, never rendered, never deleted here. */
       reusedDurationSec: number | null
     }

     async function planJob(job: BakeJob, dir: string): Promise<PlannedJob> {
       let recipe: ResolvedRecipe
       if (job.recipe) {
         try {
           recipe = await resolveRecipe(job.recipe.sourcePath, job.recipe.rotationSec)
         } catch {
           // The original is away (an unplugged LORE drive): today's chain from the current
           // file, still recipe-named, from what it was really made from.
           recipe = await resolveRecipe(job.path, job.rotationSec)
         }
       } else {
         recipe = await resolveRecipe(job.path, job.rotationSec)
       }
       const finalPath = join(dir, recipe.name)
       return {
         job,
         recipe,
         finalPath,
         temporaryPath: join(dir, `.${recipe.name}.${randomUUID()}.baking.wav`),
         reusedDurationSec: existingCopyDuration(finalPath)
       }
     }

     /** A copy is only ever published by rename after a full write, so one that is there is
      * whole; a header that won't parse is treated as absent and rendered over. */
     function existingCopyDuration(path: string): number | null {
       if (!existsSync(path)) return null
       try {
         return readWavDurationSeconds(readWavHeaderBytes(path))
       } catch {
         return null
       }
     }
     ```

     `readWavHeaderBytes` is `importRifff.ts`'s. If importing `importRifff.ts` pulls in anything
     heavy, copy its 10 lines instead.
  3. `bakeWavJob` and `bakeNativeJobs` render **`recipe.sourcePath` by `recipe.rotationSec`** (not
     `job.path`). `isPreviouslyBaked(recipe.sourcePath)` decides the blend, as before. They still
     return the job's own `path` in the result.
  4. `bakeOffset` becomes:

     ```ts
     export async function bakeOffset(jobs: BakeJob[], outputDir?: string): Promise<BakeResult[]> {
       if (jobs.length === 0) return []
       return withReonedCopiesLock(() => bakeOffsetLocked(jobs, outputDir))
     }
     ```

     and `bakeOffsetLocked`:
     - **Directory.** `durableDir = outputDir ?? join(dirname(jobs[0].path), '.sssketch-bakes')`.
       Inside the `try`: if `outputDir` was given and `!existsSync(dirname(outputDir))`, log
       `bakeOffset: the library folder ${dirname(outputDir)} is not there; not baking` and return
       `[]` (D17). Then `mkdirSync(durableDir, { recursive: true })`.
     - **Plan** every job with `planJob`. A rejection (neither the original nor the current file
       is readable) fails the batch: return `[]`.
     - **Render** each distinct `recipe.name` whose `reusedDurationSec === null` once. Two jobs on
       the same recipe in one batch share one render. WAV sources go through `bakeWavJob`, the
       rest through `bakeNativeJobs` (`isWavPath(recipe.sourcePath)`).
     - **All or nothing.** If any render failed, unlink this call's temporaries only and return
       `[]`.
     - **Publish.** Rename each rendered temporary to its final and record it in a local
       `published: string[]`. If two bakes race to the same name, both wrote identical bytes, so
       the second rename is harmless (spec).
     - **Return** one result per job: `{ path: job.path, bakedPath: finalPath, durationSec }`,
       with `durationSec` taken from `reusedDurationSec` for a reused copy and the render's
       measured value otherwise. Call `noteIssuedCopy(finalPath)` for every result.
     - **`finally`** (D16). On failure, unlink every temporary of this call, plus **only** the
       finals in `published`. Never unlink a final this call didn't rename, and never a reused
       one.
- [ ] **Step 5: Run the whole file.** `npx vitest run src/main/bakeOffset.test.ts`. Expected: all
  pass, including the three original tests. The native (extensionless) cases need the engine
  binary.
- [ ] **Step 6: Commit** `src/main/bakeOffset.ts src/main/bakeOffset.test.ts`. Subject:
  `re-one: copies are named by recipe and reused; a re-one bakes from the original; a failed batch keeps shared copies`.
  The body explains D1, D3, D16 and D17 in two lines each.

**Review checkpoint A** (superpowers:requesting-code-review). Check:
- the lock wraps the whole batch;
- no path in `finally` can unlink a pre-existing final;
- the PIN test's numbers are bar-aligned and far from the 256-frame edge;
- the three original tests are unchanged.

### Task 5: Every bake caller sends the recipe

**Files:**
- Modify: `src/renderer/src/components/BeatPicker.tsx` (`bakeStems`, `rebakeRifff`),
  `components/crossFromSketch.ts` (+ `crossFromSketch.test.ts`), `src/preload/index.ts`
  (`bakeOffset`'s job type).
- Leave `App.tsx`'s Discover seed alone: it already goes through `rifffForSketchCross`. Confirm
  with `grep -n "bakeOffset" src/renderer/src/App.tsx`, which shows only the
  `(jobs) => window.rifffApi.bakeOffset(jobs)` lambdas.

- [ ] **Step 1: Failing test** in `crossFromSketch.test.ts`:

```ts
  it('sends each stem a recipe from its original at the total phase, so a repeat audition reuses the copy', async () => {
    const bakeOffset = vi.fn(async (jobs: { path: string }[]) =>
      jobs.map((job, i) => ({ path: job.path, bakedPath: `/baked-${i}.wav`, durationSec: 8 }))
    )
    await rifffForSketchCross(riff(), { 'parent-a': -2 }, 4, bakeOffset)
    expect(bakeOffset.mock.calls[0][0]).toEqual([
      { path: '/one.wav', rotationSec: 1 },
      {
        path: '/two.wav',
        rotationSec: 1,
        recipe: { sourcePath: '/original-two.wav', rotationSec: 1.5 } // 0.25 + 0.5 bars, 2 s per bar
      }
    ])
  })
```

- [ ] **Step 2: Run it and see it fail.**
  `npx vitest run src/renderer/src/components/crossFromSketch.test.ts`. It fails: no `recipe`.
- [ ] **Step 3: Implement.**
  - In `crossFromSketch.ts`, build jobs with `reoneJob(stem, steps[index], snapDiv)` and widen the
    `bakeOffset` parameter type to `(jobs: ReoneBakeJob[]) => Promise<CrossBakeResult[]>`.
  - In `BeatPicker.tsx`'s `bakeStems`, use
    `reoneJob(s, typeof steps === 'function' ? steps(s) : steps, snapDiv)`.
  - In `rebakeRifff`, use `reoneJob(s, steps, snapDiv)`.
  - Keep the `phaseBars` arithmetic where it is (or call `nextPhaseBars`, the same formula).
  - Preload: `bakeOffset: (jobs: ReoneBakeJob[]) => …` (import the type from
    `@shared/reonedRotation`).
- [ ] **Step 4: Run.** `npx vitest run src/renderer/src/components/crossFromSketch.test.ts
  src/shared && npm run typecheck`. Expected: pass, typecheck clean.
- [ ] **Step 5: Commit** the four files. Subject:
  `re-one: re-ones, re-bakes, cross and discover seeds bake from the original by the total phase`.

---

## Phase 2: rebuild (Tasks 6-9)

### Task 6: Copy names in text and in memory

**Files:**
- Create: `src/shared/reonedNames.ts`
- Test: `src/shared/reonedNames.test.ts`

- [ ] **Step 1: Failing test**

```ts
// src/shared/reonedNames.test.ts
import { describe, expect, it } from 'vitest'
import { collectReonedNames, isReonedCopyFileName, isStaleTempFileName, reonedNamesInText } from './reonedNames'

const HASH = '0123456789abcdef0123456789abcdef.baked.wav'
const UUID = '6f1c2a9e-1b2c-4d5e-8f90-123456789abc.baked.wav'

describe('reonedNamesInText', () => {
  it('finds hashed and legacy uuid names anywhere in raw project JSON, by basename', () => {
    const json = JSON.stringify({
      rifffs: { g: { stems: [{ path: `/Volumes/X/lib/.bakes/${HASH}`, phaseSourcePath: '/a.wav' }] } },
      other: `/old/root/.sssketch-bakes/${UUID}`
    })
    expect([...reonedNamesInText(json)].sort()).toEqual([HASH, UUID].sort())
  })

  it('ignores ordinary audio', () => {
    expect([...reonedNamesInText('{"path":"/a/b.wav","x":"baked.wav"}')]).toEqual([])
  })
})

describe('collectReonedNames', () => {
  it('walks shared undo snapshots once and finds names in any string', () => {
    const stems = [{ path: `/lib/.bakes/${HASH}` }]
    const present = { rifffs: { g: { stems } } }
    const past = Array.from({ length: 100 }, () => ({ rifffs: { g: { stems } } }))
    const crossDraft = { parents: [{ sources: [{ stem: { path: `/x/${UUID}` } }] }] }
    expect([...collectReonedNames([present, past, crossDraft, null, 3, new Float32Array(4)])].sort()).toEqual(
      [HASH, UUID].sort()
    )
  })
})

describe('file names in .bakes', () => {
  it('tells copies from temporaries', () => {
    expect(isReonedCopyFileName(HASH)).toBe(true)
    expect(isReonedCopyFileName(UUID)).toBe(true)
    expect(isReonedCopyFileName(`.${HASH}.0f0f.baking.wav`)).toBe(false)
    expect(isStaleTempFileName(`.${HASH}.0f0f.baking.wav`)).toBe(true)
    expect(isStaleTempFileName('.6f1c2a9e-1b2c.baking.wav')).toBe(true) // the old temp naming
    expect(isReonedCopyFileName('.DS_Store')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement**

```ts
// src/shared/reonedNames.ts
// What counts as naming a re-oned stem copy (decision D7): its basename, anywhere. Copy names
// are 32-hex recipe names or legacy uuids, so a plain regex over raw JSON text needs no
// unescaping, and a project that names a copy under an old library root still protects it.

const NAME_SOURCE = '[0-9A-Za-z_-]+\\.baked\\.wav'
const COPY_FILE = new RegExp(`^${NAME_SOURCE}$`)
const TEMP_FILE = /^\..+\.baking\.wav$/

export function isReonedCopyFileName(name: string): boolean {
  return COPY_FILE.test(name)
}

/** A bake's unpublished temporary: a crash mid-bake leaves one (decision D11). */
export function isStaleTempFileName(name: string): boolean {
  return TEMP_FILE.test(name)
}

export function reonedNamesInText(text: string, into: Set<string> = new Set()): Set<string> {
  const pattern = new RegExp(NAME_SOURCE, 'g')
  for (const match of text.matchAll(pattern)) into.add(match[0])
  return into
}

/** Every copy name in a tree of plain values: the history's states (which share structure, so
 * each object is visited once), a Cross draft, Discover's slots. */
export function collectReonedNames(roots: readonly unknown[], into: Set<string> = new Set()): Set<string> {
  const seen = new WeakSet<object>()
  const stack: unknown[] = [...roots]
  while (stack.length > 0) {
    const value = stack.pop()
    if (typeof value === 'string') {
      if (value.includes('.baked.wav')) reonedNamesInText(value, into)
      continue
    }
    if (value === null || typeof value !== 'object') continue
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue
    if (seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) stack.push(...value)
    else if (value instanceof Map) stack.push(...value.keys(), ...value.values())
    else if (value instanceof Set) stack.push(...value)
    else stack.push(...Object.values(value as Record<string, unknown>))
  }
  return into
}
```

- [ ] **Step 4: Run and pass.**
- [ ] **Step 5: Commit.** Subject: `re-one: find copy names in project text and in memory`.

### Task 7: Plan a repair, apply its outcomes

**Files:**
- Create: `src/shared/reonedRepair.ts`
- Test: `src/shared/reonedRepair.test.ts`

- [ ] **Step 1: Failing test**

```ts
// src/shared/reonedRepair.test.ts
import { describe, expect, it } from 'vitest'
import type { Rifff } from './types'
import { applyReonedRepair, planReonedRepair } from './reonedRepair'

const COPY = '/lib/.bakes/0123456789abcdef0123456789abcdef.baked.wav'

function rifffs(): Record<string, Rifff> {
  return {
    a: {
      groupId: 'a',
      name: 'a',
      bpm: 120,
      barLength: 4,
      folderPath: '',
      stems: [
        { slot: 1, author: '', name: 'd', type: 'drums', path: COPY, durationSec: 8, barLength: 4, phaseSourcePath: '/src/d.wav', phaseBars: 1 },
        { slot: 2, author: '', name: 'b', type: 'bass', path: '/src/b.wav', durationSec: 8, barLength: 4 }
      ]
    },
    b: {
      groupId: 'b',
      name: 'b (pasted)',
      bpm: 120,
      barLength: 4,
      folderPath: '',
      stems: [{ slot: 1, author: '', name: 'd', type: 'drums', path: COPY, durationSec: 8, barLength: 4, phaseSourcePath: '/src/d.wav', phaseBars: 1 }]
    }
  }
}

describe('planReonedRepair', () => {
  it('one batch per riff, only stems on a copy with a lineage, with their rotation candidates', () => {
    expect(planReonedRepair(rifffs())).toEqual([
      { groupId: 'a', stems: [{ path: COPY, sourcePath: '/src/d.wav', rotationSecCandidates: [2] }] },
      { groupId: 'b', stems: [{ path: COPY, sourcePath: '/src/d.wav', rotationSecCandidates: [2] }] }
    ])
  })

  it('nothing to do for a project with no copies', () => {
    const r = rifffs()
    delete r.b
    r.a.stems = [r.a.stems[1]]
    expect(planReonedRepair(r)).toEqual([])
  })
})

describe('applyReonedRepair', () => {
  it('leaves the riffs object untouched when every copy is present or rebuilt in place', () => {
    const r = rifffs()
    const out = applyReonedRepair(r, [[{ path: COPY, status: 'rebuilt', bakedPath: COPY, durationSec: 8.000001 }], [{ path: COPY, status: 'present' }]])
    expect(out.rifffs).toBe(r) // same object: dirtyCheckJson can't change, the project stays saved
    expect(out.missing).toEqual([])
  })

  it('repoints every stem naming a copy rebuilt under a new name, and reports the missing ones', () => {
    const r = rifffs()
    const NEW = '/lib/.bakes/ffffffffffffffffffffffffffffffff.baked.wav'
    const out = applyReonedRepair(r, [[{ path: COPY, status: 'rebuilt', bakedPath: NEW, durationSec: 8.01 }]])
    expect(out.rifffs.a.stems[0]).toMatchObject({ path: NEW, durationSec: 8.01, phaseSourcePath: '/src/d.wav', phaseBars: 1 })
    expect(out.rifffs.b.stems[0].path).toBe(NEW)
    expect(r.a.stems[0].path).toBe(COPY) // input not mutated

    const missing = applyReonedRepair(r, [[{ path: COPY, status: 'missing' }]])
    expect(missing.rifffs).toBe(r)
    expect(missing.missing).toEqual([COPY])
  })
})
```

- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement**

```ts
// src/shared/reonedRepair.ts
import type { Rifff } from './types'
import { rebuildRotationCandidates } from './reonedRotation'

export interface ReonedRepairStem {
  /** The copy the project names. */
  path: string
  sourcePath: string
  rotationSecCandidates: number[]
}

export interface ReonedRepairBatch {
  groupId: string
  stems: ReonedRepairStem[]
}

export type ReonedRepairOutcome =
  | { path: string; status: 'present' }
  | { path: string; status: 'rebuilt'; bakedPath: string; durationSec: number }
  | { path: string; status: 'missing' }

const isCopyPath = (path: string): boolean => path.toLowerCase().endsWith('.baked.wav')

/** One batch per riff (the spec's all-or-nothing unit). Only stems on a copy that can be
 * rebuilt: a lineage to bake from. Main checks which of them are actually missing. */
export function planReonedRepair(rifffs: Readonly<Record<string, Rifff>>): ReonedRepairBatch[] {
  const batches: ReonedRepairBatch[] = []
  for (const rifff of Object.values(rifffs)) {
    const stems = rifff.stems
      .filter((s) => isCopyPath(s.path) && s.phaseSourcePath !== undefined && s.phaseSourcePath !== s.path)
      .map((s) => ({
        path: s.path,
        sourcePath: s.phaseSourcePath!,
        rotationSecCandidates: rebuildRotationCandidates(s, rifff.bpm)
      }))
    if (stems.length > 0) batches.push({ groupId: rifff.groupId, stems })
  }
  return batches
}

/** Applies main's outcomes to every stem naming each copy. A copy rebuilt at its own path
 * changes nothing (not even durationSec), so the project isn't marked unsaved; only a new
 * path repoints the stem. */
export function applyReonedRepair(
  rifffs: Readonly<Record<string, Rifff>>,
  outcomes: readonly (readonly ReonedRepairOutcome[])[]
): { rifffs: Readonly<Record<string, Rifff>>; missing: string[] } {
  const moved = new Map<string, { bakedPath: string; durationSec: number }>()
  const missing = new Set<string>()
  for (const outcome of outcomes.flat()) {
    if (outcome.status === 'missing') missing.add(outcome.path)
    else if (outcome.status === 'rebuilt' && outcome.bakedPath !== outcome.path) moved.set(outcome.path, outcome)
  }
  if (moved.size === 0) return { rifffs, missing: [...missing] }
  const next: Record<string, Rifff> = {}
  for (const [groupId, rifff] of Object.entries(rifffs)) {
    const touched = rifff.stems.some((s) => moved.has(s.path))
    next[groupId] = touched
      ? {
          ...rifff,
          stems: rifff.stems.map((s) => {
            const m = moved.get(s.path)
            return m ? { ...s, path: m.bakedPath, durationSec: m.durationSec } : s
          })
        }
      : rifff
  }
  return { rifffs: next, missing: [...missing] }
}
```

- [ ] **Step 4: Run and pass.**
- [ ] **Step 5: Commit.** Subject: `re-one: plan a per-riff repair of missing copies and apply its outcomes`.

### Task 8: Main rebuilds missing copies

**Files:**
- Create: `src/main/reonedRebuild.ts`
- Test: `src/main/reonedRebuild.test.ts`

- [ ] **Step 1: Failing test** (spec: "a missing copy is rebuilt to the same name and the project
  isn't marked unsaved"; "an unreachable original leaves the stem marked missing, with no crash
  and no partial batch")

```ts
// src/main/reonedRebuild.test.ts
import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), getPath: () => tmpdir() } }))

import { bakeOffset } from './bakeOffset'
import { rebuildReonedCopies } from './reonedRebuild'
import { planReonedRepair, applyReonedRepair } from '@shared/reonedRepair'
import { rotationSecForBars } from '@shared/reonedRotation'
import type { Rifff } from '@shared/types'

// Same ramp fixture as bakeOffset.test.ts (each test file owns its own helpers).
function writeRampWav(path: string, numSamples: number, sampleRate = 1000): void {
  /* copy from bakeOffset.test.ts */
}

function riffOn(copy: string, source: string, phaseBars: number, durationSec = 4): Rifff {
  return {
    groupId: 'g',
    name: 'g',
    bpm: 240, // 1 s per bar: the metadata candidate equals the measured one here
    barLength: 4,
    folderPath: '',
    stems: [{ slot: 1, author: '', name: 'd', type: 'drums', path: copy, durationSec, barLength: 4, phaseSourcePath: source, phaseBars }]
  }
}

describe('rebuildReonedCopies', () => {
  it('rebuilds a missing copy to the same name; applying it leaves the project untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const root = join(dir, 'lib')
      mkdirSync(root)
      const bakes = join(root, '.bakes')
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const [copy] = await bakeOffset(
        [{ path: source, rotationSec: rotationSecForBars(1.5, { barLength: 4, durationSec: 4 }) }],
        bakes
      )
      rmSync(copy.bakedPath)
      const rifffs = { g: riffOn(copy.bakedPath, source, 1.5) }
      const outcomes = await rebuildReonedCopies(planReonedRepair(rifffs), { outputDir: bakes, libraryRoot: root })
      expect(outcomes).toEqual([[{ path: copy.bakedPath, status: 'rebuilt', bakedPath: copy.bakedPath, durationSec: expect.closeTo(4, 5) }]])
      expect(existsSync(copy.bakedPath)).toBe(true)
      expect(applyReonedRepair(rifffs, outcomes).rifffs).toBe(rifffs)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a present copy is left alone and nothing is baked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const copy = join(dir, 'x.baked.wav')
      writeFileSync(copy, 'anything')
      const outcomes = await rebuildReonedCopies(planReonedRepair({ g: riffOn(copy, '/nowhere.wav', 1) }), {
        outputDir: join(dir, '.bakes'),
        libraryRoot: dir
      })
      expect(outcomes).toEqual([[{ path: copy, status: 'present' }]])
      expect(existsSync(join(dir, '.bakes'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an unreachable original: every missing stem of that riff is missing, nothing is written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const rifff = riffOn(join(dir, '.bakes', 'a.baked.wav'), source, 1)
      rifff.stems.push({ ...rifff.stems[0], slot: 2, path: join(dir, '.bakes', 'b.baked.wav'), phaseSourcePath: join(dir, 'gone.wav') })
      const outcomes = await rebuildReonedCopies(planReonedRepair({ g: rifff }), { outputDir: join(dir, '.bakes'), libraryRoot: dir })
      expect(outcomes[0].map((o) => o.status)).toEqual(['missing', 'missing'])
      expect(existsSync(join(dir, '.bakes')) ? readdirSync(join(dir, '.bakes')) : []).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the library drive away: missing, and its folder is not recreated', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const root = join(dir, 'unplugged')
      const outcomes = await rebuildReonedCopies(planReonedRepair({ g: riffOn(join(root, '.bakes', 'a.baked.wav'), source, 1) }), {
        outputDir: join(root, '.bakes'),
        libraryRoot: root
      })
      expect(outcomes[0][0].status).toBe('missing')
      expect(existsSync(root)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('D5: a LORE copy first baked with metadata seconds-per-bar lands on its own name after durationSec was re-measured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const root = join(dir, 'lib')
      mkdirSync(root)
      const bakes = join(root, '.bakes')
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4010, 1000) // decodes 10 ms longer than its 4 metadata bars
      // The first re-one used metadata durationSec 4 (bpm 240, 4 bars).
      const [copy] = await bakeOffset([{ path: source, rotationSec: rotationSecForBars(1, { barLength: 4, durationSec: 4 }) }], bakes)
      rmSync(copy.bakedPath)
      // APPLY_BAKE then stored the measured 4.01.
      const rifffs = { g: riffOn(copy.bakedPath, source, 1, 4.01) }
      const outcomes = await rebuildReonedCopies(planReonedRepair(rifffs), { outputDir: bakes, libraryRoot: root })
      expect(outcomes[0][0]).toMatchObject({ status: 'rebuilt', bakedPath: copy.bakedPath })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/main/reonedRebuild.test.ts`.
- [ ] **Step 3: Implement**

```ts
// src/main/reonedRebuild.ts
// Part 1 of the spec: a copy a project names but that is gone is rebuilt from its stem's
// lineage, through the same baker, one all-or-nothing batch per riff. No electron import at
// module scope beyond projectLibrary (lazy, only when a batch needs it); no better-sqlite3.
import { access } from 'node:fs/promises'
import { basename } from 'node:path'
import type { AppState } from '../renderer/src/state/store'
import {
  applyReonedRepair,
  planReonedRepair,
  type ReonedRepairBatch,
  type ReonedRepairOutcome
} from '@shared/reonedRepair'
import { bakeOffset } from './bakeOffset'
import { resolveRecipe } from './reonedRecipe'
import { bakeAssetsDir, libraryRootPath } from './projectLibrary'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export interface RebuildDirs {
  outputDir: string
  libraryRoot: string
}

/** Which candidate rotation made the copy the project names (decision D5): the one whose
 * recipe name is the missing file's name; else the first. null when the original can't be read. */
async function chooseRotation(stem: ReonedRepairBatch['stems'][number]): Promise<number | null> {
  try {
    for (const candidate of stem.rotationSecCandidates) {
      if ((await resolveRecipe(stem.sourcePath, candidate)).name === basename(stem.path)) return candidate
    }
    return stem.rotationSecCandidates[0] ?? null
  } catch {
    return null
  }
}

export async function rebuildReonedCopies(
  batches: readonly ReonedRepairBatch[],
  dirs: RebuildDirs = { outputDir: bakeAssetsDir(), libraryRoot: libraryRootPath() }
): Promise<ReonedRepairOutcome[][]> {
  const all: ReonedRepairOutcome[][] = []
  // Sequential on purpose: a copy two riffs share is rebuilt by the first and found by the second.
  for (const batch of batches) {
    const present = await Promise.all(batch.stems.map((s) => exists(s.path)))
    const needed = batch.stems.filter((_, i) => !present[i])
    const out: ReonedRepairOutcome[] = batch.stems.map((s, i) =>
      present[i] ? { path: s.path, status: 'present' } : { path: s.path, status: 'missing' }
    )
    if (needed.length > 0 && (await exists(dirs.libraryRoot))) {
      const rotations = await Promise.all(needed.map(chooseRotation))
      if (rotations.every((r): r is number => r !== null)) {
        const results = await bakeOffset(
          needed.map((s, i) => ({ path: s.path, rotationSec: 0, recipe: { sourcePath: s.sourcePath, rotationSec: rotations[i] } })),
          dirs.outputDir
        )
        if (results.length === needed.length) {
          const byPath = new Map(results.map((r) => [r.path, r]))
          for (let i = 0; i < out.length; i++) {
            const r = byPath.get(out[i].path)
            if (r) out[i] = { path: r.path, status: 'rebuilt', bakedPath: r.bakedPath, durationSec: r.durationSec }
          }
        }
      }
    }
    all.push(out)
  }
  return all
}

/** For the export choke points (D6): the state with every missing copy rebuilt, repointed only
 * where a rebuild landed under a new name. A copy still missing is left as is: that stem
 * renders silent, as a missing file always has. */
export async function ensureReonedCopiesForState(state: AppState): Promise<AppState> {
  const batches = planReonedRepair(state.rifffs)
  if (batches.length === 0) return state
  const outcomes = await rebuildReonedCopies(batches)
  const { rifffs, missing } = applyReonedRepair(state.rifffs, outcomes)
  if (missing.length > 0) console.error(`ensureReonedCopiesForState: ${missing.length} re-oned copies still missing`)
  return rifffs === state.rifffs ? state : { ...state, rifffs: rifffs as AppState['rifffs'] }
}
```

The default `dirs` touch `app.getPath` (through `libraryRootPath`). The tests pass explicit
`dirs`, and `ensureReonedCopiesForState` returns before calling it when there's nothing to repair.
That keeps `nativeExport.test.ts` (whose mock has only `getAppPath`) safe.

- [ ] **Step 4: Run** `npx vitest run src/main/reonedRebuild.test.ts src/main/bakeOffset.test.ts`. Expected: pass.
- [ ] **Step 5: Commit.** Subject: `re-one: rebuild a project's missing copies from their lineage, one batch per riff`.

**Review checkpoint B.** Check:
- no partial batch can be adopted;
- a present copy is never re-baked;
- `ensureReonedCopiesForState` returns the identical state when nothing moved;
- D5's test really exercises the second candidate (remove it and see the test fail).

### Task 9: Exports repair first

**Files:**
- Modify: `src/main/exportAbleton.ts` (`buildAndWriteAlsProject`), `src/main/exportReaper.ts`
  (`buildAndWriteRppProject`), `src/main/nativeExport.ts` (`nativeExport`, `renderStemsToDir`,
  `renderStemTracksToDir`).

- [ ] **Step 1: In each of the five functions**, make the first statement
  `state = await ensureReonedCopiesForState(state)` (rename the parameter if it is `const`-like;
  it is a plain parameter in all five). Import from `./reonedRebuild`.
- [ ] **Step 2: Run** `npx vitest run src/main/nativeExport.test.ts src/main/exportFileNames.test.ts && npm run typecheck`.
  Expected: unchanged results. Those states have no copies, so the repair returns early.
- [ ] **Step 3: Commit** the three files. Subject:
  `export: rebuild missing re-oned copies before rendering a mix, stems, ableton or reaper`.

---

## Phase 3: the used set and cleanup, main side (Tasks 10-13)

### Task 10: Cleanup rules and words

**Files:**
- Create: `src/shared/reonedCleanup.ts`
- Test: `src/shared/reonedCleanup.test.ts`

- [ ] **Step 1: Failing test** (spec: "popup threshold and 'not now'"; exact copy)

```ts
// src/shared/reonedCleanup.test.ts
import { describe, expect, it } from 'vitest'
import {
  CLEANUP_GRACE_MS,
  CLEANUP_NOT_NOW_MS,
  CLEANUP_OFFER_BYTES,
  MISSING_COPY_TEXT,
  NOTHING_TO_CLEAN_TEXT,
  cleanupOfferText,
  clearedText,
  formatCopySize,
  shouldOfferCleanup
} from './reonedCleanup'

describe('the offer', () => {
  it('at 200 MB or more, and not while "not now" is running', () => {
    const now = 1_000_000_000_000
    expect(CLEANUP_OFFER_BYTES).toBe(200_000_000)
    expect(shouldOfferCleanup({ unusedBytes: 199_999_999, now, notNowUntil: null })).toBe(false)
    expect(shouldOfferCleanup({ unusedBytes: 200_000_000, now, notNowUntil: null })).toBe(true)
    expect(shouldOfferCleanup({ unusedBytes: 5e9, now, notNowUntil: now + 1 })).toBe(false)
    expect(shouldOfferCleanup({ unusedBytes: 5e9, now, notNowUntil: now })).toBe(true)
    expect(CLEANUP_NOT_NOW_MS).toBe(7 * 24 * 60 * 60 * 1000)
    expect(CLEANUP_GRACE_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('words', () => {
  it("the spec's message, word for word", () => {
    expect(cleanupOfferText(1_200_000_000)).toBe(
      "about 1.2 GB of re-oned stem copies aren't used by any project. your rifffs, stems and projects aren't touched, and anything needed later is rebuilt automatically."
    )
    expect(clearedText(1_200_000_000)).toBe('cleared 1.2 GB')
    expect(MISSING_COPY_TEXT).toBe('re-oned copy missing · rebuilds when its original is back')
  })

  it('sizes', () => {
    expect(formatCopySize(340_400_000)).toBe('340 MB')
    expect(formatCopySize(999_600_000)).toBe('1.0 GB')
    expect(formatCopySize(12_345_000_000)).toBe('12.3 GB')
    expect(formatCopySize(400_000)).toBe('less than 1 MB')
    expect(cleanupOfferText(400_000).startsWith('less than 1 MB of re-oned')).toBe(true)
    expect(NOTHING_TO_CLEAN_TEXT).toBe('every re-oned stem copy is in use. nothing to clean up.')
  })
})
```

- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.** The constants as tested, plus:
  - `formatCopySize`: `< 1e6` → `'less than 1 MB'`; `round(bytes / 1e6) < 1000` → `` `${n} MB` ``;
    else `` `${(bytes / 1e9).toFixed(1)} GB` ``.
  - `cleanupOfferText(bytes)`: prefix `about ` only when `bytes >= 1e6`.
  - `clearedText`.
  - Exported strings:
    - `CLEANUP_MENU_LABEL = 'clean up re-oned stem copies…'`;
    - `LIBRARY_MISSING_TITLE = 'project library not found'`;
    - `COULD_NOT_CHECK_TEXT = "couldn't read every project, so nothing was cleaned."`;
    - `LOOKING_TEXT = 'looking…'`;
    - `CLEANING_TEXT = 'cleaning…'`.
  - The IPC result types, shared by main, preload and renderer:

```ts
export type ReonedSurvey =
  | { status: 'library-missing' }
  | { status: 'snoozed' }
  | { status: 'unreadable'; path: string }
  | { status: 'ok'; unusedBytes: number; unusedCount: number; notNowUntil: number | null }

export type ReonedCleanResult =
  | { status: 'library-missing' }
  | { status: 'unreadable'; path: string }
  | { status: 'ok'; freedBytes: number; deletedCount: number; failedCount: number }
```

- [ ] **Step 4: Run and pass.**
- [ ] **Step 5: Commit.** Subject: `re-one cleanup: thresholds, grace, snooze, sizes and words`.

### Task 11: Remembered external projects and "not now"

**Files:**
- Create: `src/main/reonedCopiesStore.ts`
- Test: `src/main/reonedCopiesStore.test.ts`
- Modify: `src/main/projectFile.ts` (+ `projectFile.test.ts`)

- [ ] **Step 1: Failing store test.** Mock `app.getPath('userData')` to a temp dir, as
  `projectFile.test.ts` does.

```ts
// src/main/reonedCopiesStore.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))

import {
  MAX_KNOWN_PROJECTS,
  knownProjects,
  notNowUntil,
  rememberExternalProject,
  renameKnownProject,
  setNotNow
} from './reonedCopiesStore'

const NAME = '0123456789abcdef0123456789abcdef.baked.wav'

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-reoned-store-'))
})
afterEach(() => rmSync(userDataDir, { recursive: true, force: true }))

describe('remembered external projects', () => {
  it('keeps the path and the copies it named, newest first, once per path', () => {
    rememberExternalProject('/ext/a.sssketchproj', `{"path":"/lib/.bakes/${NAME}"}`, 1)
    rememberExternalProject('/ext/b.sssketchproj', '{}', 2)
    rememberExternalProject('/ext/a.sssketchproj', `{"path":"/lib/.bakes/${NAME}"}`, 3)
    expect(knownProjects()).toEqual([
      { path: '/ext/a.sssketchproj', names: [NAME], at: 3 },
      { path: '/ext/b.sssketchproj', names: [], at: 2 }
    ])
  })

  it(`caps at ${MAX_KNOWN_PROJECTS}, dropping the oldest`, () => {
    for (let i = 0; i < MAX_KNOWN_PROJECTS + 5; i++) rememberExternalProject(`/ext/${i}.sssketchproj`, '{}', i)
    const list = knownProjects()
    expect(list).toHaveLength(MAX_KNOWN_PROJECTS)
    expect(list.at(-1)?.path).toBe('/ext/5.sssketchproj')
  })

  it('follows a rename', () => {
    rememberExternalProject('/ext/a.sssketchproj', `"${NAME}"`, 1)
    renameKnownProject('/ext/a.sssketchproj', '/ext/b.sssketchproj')
    expect(knownProjects().map((p) => p.path)).toEqual(['/ext/b.sssketchproj'])
  })
})

describe('not now', () => {
  it('is stored as a time, and absent by default', () => {
    expect(notNowUntil()).toBeNull()
    setNotNow(1000)
    expect(notNowUntil()).toBe(1000 + 7 * 24 * 60 * 60 * 1000)
  })
})
```

- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.**
  - The store file is `userData/reonedCopies.json`, shaped
    `{ version: 1, notNowUntil?: number, knownProjects: { path, names, at }[] }`.
  - Read it fresh on each call, as `pluginCatalog`/`appFeaturesStore` do. A missing or corrupt
    file reads as empty.
  - Write it with a temp file and rename.
  - Use `reonedNamesInText` for `names`.
  - `MAX_KNOWN_PROJECTS = 50`.
  - `setNotNow(now)` stores `now + CLEANUP_NOT_NOW_MS`.
  - Name every function the test imports. Every write is wrapped in `try`/`catch` + `console.error`:
    remembering must never fail a save or an open.
- [ ] **Step 4: Hook `projectFile.ts`.** Write a failing test in `projectFile.test.ts` first: after
  `saveProjectInPlace(externalPath, json)` and `renameExternalSketchFile`, `knownProjects()` holds
  the right paths and names. A library save (`saveProjectToLibrary`) adds nothing. Then add the
  hooks:
  - `saveProjectAs`: after the write succeeds, `rememberExternalProject(result.filePath, json)`.
  - `saveProjectInPlace(path, json)`: after the write, remember the path unless
    `isInsideLibrary(path)`, i.e. `resolve(path).startsWith(resolve(libraryRootPath()) + sep)`.
    `saveProjectToLibrary` calls this too, which is why the check is needed.
  - `openProject`: after the read succeeds, `rememberExternalProject(path, json)`.
  - `renameExternalSketchFile`: after the rename, `renameKnownProject(oldPath, newPath)`.
  - Leave `openLibrarySketch`/`saveProjectToLibrary` alone: library files are scanned anyway.
- [ ] **Step 5: Run** `npx vitest run src/main/reonedCopiesStore.test.ts src/main/projectFile.test.ts`. Expected: pass.
- [ ] **Step 6: Commit** the four files. Subject:
  `re-one cleanup: remember external projects and the copies they name, and "not now"`.

### Task 12: The used set, the survey, the clean

**Files:**
- Create: `src/main/reonedUsage.ts`
- Test: `src/main/reonedUsage.test.ts`. No electron and no sqlite: every root comes in as a
  parameter.

- [ ] **Step 1: Failing test.** It covers the spec's "what counts as used" (each source alone
  keeps a copy), "the grace day", and "cleanup deletes only unused files and reports the freed
  size".

```ts
// src/main/reonedUsage.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanBakes, collectUsedNames, surveyBakes, type UsedNameSources } from './reonedUsage'

const DAY = 24 * 60 * 60 * 1000
const name = (n: number): string => `${String(n).padStart(32, '0')}.baked.wav`
let dir: string
let root: string
let bakes: string
let userData: string
const now = Date.now()

function copy(n: number, ageMs = 2 * DAY, bytes = 1000): void {
  const path = join(bakes, name(n))
  writeFileSync(path, Buffer.alloc(bytes))
  const t = (now - ageMs) / 1000
  utimesSync(path, t, t)
}
function project(path: string, ...names: number[]): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify({ rifffs: { g: { stems: names.map((n) => ({ path: `/anywhere/.bakes/${name(n)}` })) } } }))
}
function sources(over: Partial<UsedNameSources> = {}): UsedNameSources {
  return {
    libraryRoot: root,
    userDataFiles: [join(userData, 'autosave.sssketchproj'), join(userData, 'autosave.previous.sssketchproj')],
    knownProjects: [],
    inMemoryNames: [],
    sessionIssued: [],
    ...over
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sssketch-usage-'))
  root = join(dir, 'lib')
  bakes = join(root, '.bakes')
  userData = join(dir, 'userData')
  mkdirSync(bakes, { recursive: true })
  mkdirSync(userData)
  for (let n = 1; n <= 9; n++) copy(n)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('collectUsedNames: each source on its own keeps a copy', () => {
  it('library projects, their backups, autosave and the aside snapshot', async () => {
    project(join(root, 's', 's.sssketchproj'), 1)
    project(join(root, 's', '.backups', 's-2026-10-01.sssketchproj'), 2)
    project(join(userData, 'autosave.sssketchproj'), 3)
    project(join(userData, 'autosave.previous.sssketchproj'), 4)
    const scan = await collectUsedNames(sources())
    expect(scan.ok && [...scan.used].sort()).toEqual([name(1), name(2), name(3), name(4)])
  })

  it('a remembered outside project: read when it is there, remembered names when it is not', async () => {
    const ext = join(dir, 'elsewhere', 'x.sssketchproj')
    project(ext, 5)
    const scan = await collectUsedNames(
      sources({ knownProjects: [{ path: ext, names: [], at: 1 }, { path: join(dir, 'unplugged', 'y.sssketchproj'), names: [name(6)], at: 2 }] })
    )
    expect(scan.ok && [...scan.used].sort()).toEqual([name(5), name(6)])
  })

  it('the in-memory project, undo, cross and discover (reported by the renderer), and this session', async () => {
    const scan = await collectUsedNames(sources({ inMemoryNames: [name(7)], sessionIssued: [name(8)] }))
    expect(scan.ok && [...scan.used].sort()).toEqual([name(7), name(8)])
  })

  it('a project too big for one slice still yields between chunks', async () => {
    const big = join(root, 'big', 'big.sssketchproj')
    mkdirSync(join(root, 'big'))
    writeFileSync(big, `{"pad":"${'x'.repeat(3_000_000)}","p":"/b/${name(9)}"}`)
    let yields = 0
    const scan = await collectUsedNames(sources(), async () => void yields++)
    expect(scan.ok && scan.used.has(name(9))).toBe(true)
    expect(yields).toBeGreaterThanOrEqual(3)
  })

  it('stops when a library project cannot be read (D10)', async () => {
    project(join(root, 's', 's.sssketchproj'), 1)
    chmodSync(join(root, 's', 's.sssketchproj'), 0o000)
    const scan = await collectUsedNames(sources())
    expect(scan.ok).toBe(false)
    chmodSync(join(root, 's', 's.sssketchproj'), 0o644)
  })
})

describe('surveyBakes and cleanBakes', () => {
  it('a copy younger than a day is never unused (the grace day)', async () => {
    copy(10, DAY - 60_000)
    const survey = await surveyBakes(bakes, new Set(), now)
    expect(survey.unused.map((f) => f.name)).not.toContain(name(10))
  })

  it('counts stale temporaries; deletes only unused files; reports the freed size', async () => {
    writeFileSync(join(bakes, `.${name(1)}.abcd.baking.wav`), Buffer.alloc(500))
    utimesSync(join(bakes, `.${name(1)}.abcd.baking.wav`), (now - 2 * DAY) / 1000, (now - 2 * DAY) / 1000)
    writeFileSync(join(bakes, 'notes.txt'), 'not ours')
    const used = new Set([name(1), name(2)])
    const survey = await surveyBakes(bakes, used, now)
    expect(survey.unusedBytes).toBe(7 * 1000 + 500)
    const result = await cleanBakes(bakes, used, now)
    expect(result).toEqual({ freedBytes: 7500, deletedCount: 8, failedCount: 0 })
    expect(readdirSync(bakes).sort()).toEqual([name(1), name(2), 'notes.txt'].sort())
  })

  it('re-checks age right before deleting: a copy refreshed since the survey stays', async () => {
    const result = await cleanBakes(bakes, new Set(), now - 3 * DAY) // "now" too early: nothing is old enough
    expect(result.deletedCount).toBe(0)
  })
})
```

The chmod test is skipped when run as root. Guard it with
`it.skipIf(process.getuid?.() === 0)`.

- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement** `reonedUsage.ts`:

```ts
// src/main/reonedUsage.ts
// Part 3 of the spec: what is used, how much is not, and the delete. Reads every project as
// raw text in 1 MB slices (decision D7), async I/O only, yielding between slices so the main
// thread never blocks (AGENTS.md §6). No electron, no better-sqlite3: index.ts / reonedCopiesIpc.ts
// pass every root in.
import { readdir, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { CLEANUP_GRACE_MS } from '@shared/reonedCleanup'
import { isReonedCopyFileName, isStaleTempFileName, reonedNamesInText } from '@shared/reonedNames'
import { withReonedCopiesLock } from './reonedCopiesSession'

const SLICE_CHARS = 1_000_000
const OVERLAP_CHARS = 128 // longer than any copy name, so none is cut in two

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export interface UsedNameSources {
  libraryRoot: string
  userDataFiles: string[]
  knownProjects: { path: string; names: string[]; at: number }[]
  inMemoryNames: Iterable<string>
  sessionIssued: Iterable<string>
}

export type UsedScan = { ok: true; used: Set<string> } | { ok: false; path: string }

const isNotFound = (err: unknown): boolean => (err as { code?: string } | null)?.code === 'ENOENT'

async function scanText(text: string, into: Set<string>, yieldFn: () => Promise<void>): Promise<void> {
  for (let start = 0; start < text.length; start += SLICE_CHARS) {
    reonedNamesInText(text.slice(start, start + SLICE_CHARS + OVERLAP_CHARS), into)
    await yieldFn()
  }
}

/** Every .sssketchproj in the library: each sketch folder's own and its .backups. Dot folders
 * (.bakes, .samples-cache) hold no projects. */
async function libraryProjectFiles(root: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.sssketchproj')) files.push(join(root, entry.name))
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    for (const sub of [join(root, entry.name), join(root, entry.name, '.backups')]) {
      try {
        for (const f of await readdir(sub)) if (f.endsWith('.sssketchproj')) files.push(join(sub, f))
      } catch (err) {
        if (!isNotFound(err)) throw err
      }
    }
  }
  return files
}

export async function collectUsedNames(
  src: UsedNameSources,
  yieldFn: () => Promise<void> = yieldToEventLoop
): Promise<UsedScan> {
  const used = new Set<string>([...src.inMemoryNames, ...src.sessionIssued])
  for (const p of src.knownProjects) for (const n of p.names) used.add(n)
  let files: string[]
  try {
    files = await libraryProjectFiles(src.libraryRoot)
  } catch {
    return { ok: false, path: src.libraryRoot }
  }
  const optional = [...src.userDataFiles, ...src.knownProjects.map((p) => p.path)]
  for (const path of [...files, ...optional]) {
    let text: string
    try {
      text = await readFile(path, 'utf-8')
    } catch (err) {
      // Gone since listing, or an unplugged outside project: its remembered names already count.
      if (isNotFound(err) || optional.includes(path)) continue
      return { ok: false, path }
    }
    await scanText(text, used, yieldFn)
  }
  return { ok: true, used }
}

export interface BakesFile {
  name: string
  size: number
  mtimeMs: number
}

export async function surveyBakes(
  bakesDir: string,
  used: ReadonlySet<string>,
  now: number
): Promise<{ unused: BakesFile[]; unusedBytes: number }> {
  let names: string[]
  try {
    names = await readdir(bakesDir)
  } catch (err) {
    if (isNotFound(err)) return { unused: [], unusedBytes: 0 }
    throw err
  }
  const unused: BakesFile[] = []
  for (const name of names) {
    const candidate = isStaleTempFileName(name) || (isReonedCopyFileName(name) && !used.has(name))
    if (!candidate) continue
    try {
      const info = await stat(join(bakesDir, name))
      if (info.isFile() && now - info.mtimeMs >= CLEANUP_GRACE_MS) unused.push({ name, size: info.size, mtimeMs: info.mtimeMs })
    } catch {
      // gone meanwhile
    }
  }
  return { unused, unusedBytes: unused.reduce((sum, f) => sum + f.size, 0) }
}

/** Under the lock (no bake can publish or hand out a copy meanwhile), re-surveys and deletes. */
export function cleanBakes(
  bakesDir: string,
  used: ReadonlySet<string>,
  now: number
): Promise<{ freedBytes: number; deletedCount: number; failedCount: number }> {
  return withReonedCopiesLock(async () => {
    const { unused } = await surveyBakes(bakesDir, used, now)
    let freedBytes = 0
    let deletedCount = 0
    let failedCount = 0
    for (const file of unused) {
      try {
        await unlink(join(bakesDir, file.name))
        freedBytes += file.size
        deletedCount++
      } catch (err) {
        if (!isNotFound(err)) failedCount++
      }
      await yieldToEventLoop()
    }
    return { freedBytes, deletedCount, failedCount }
  })
}
```

- [ ] **Step 4: Run and pass.** `npx vitest run src/main/reonedUsage.test.ts`.
- [ ] **Step 5: Commit.** Subject: `re-one cleanup: the used set, sized and cleaned in time slices`.

### Task 13: The IPC surface

**Files:**
- Create: `src/main/reonedCopiesIpc.ts`
- Modify: `src/main/index.ts` (one import, one call, beside the existing `bake-offset` handler.
  **Another agent is editing it.**), `src/preload/index.ts`

- [ ] **Step 1: `reonedCopiesIpc.ts`** exports `registerReonedCopiesIpc(ipcMain: IpcMain)` with:
  - `rebuild-reoned-copies (batches: ReonedRepairBatch[]) → ReonedRepairOutcome[][]`:
    `rebuildReonedCopies(batches)`.
  - `reoned-copies-library-available () → boolean`: async `access(libraryRootPath())`.
  - `reoned-copies-survey ({ inMemoryNames, respectNotNow }) → ReonedSurvey`. In order:
    1. library root unreachable → `library-missing`;
    2. `respectNotNow && notNowUntil() > Date.now()` → `snoozed`, without scanning;
    3. otherwise run `collectUsedNames` with:
       - `userDataFiles`: `autosave.sssketchproj` and `autosave.previous.sssketchproj` under
         `app.getPath('userData')`. Import the filename constants from `projectFile.ts` if they
         are exported; if not, export them there (one-word change) rather than retyping;
       - `knownProjects: knownProjects()`;
       - `sessionIssued: sessionIssuedNames()`;
    4. then `surveyBakes(bakeAssetsDir(), used, Date.now())` →
       `ok` (with `notNowUntil()`) or `unreadable`.
  - `reoned-copies-clean (inMemoryNames: string[]) → ReonedCleanResult`. The same, without the
    snooze check, then `cleanBakes`. It recomputes the used set from scratch; it never reuses a
    survey's list.
  - `reoned-copies-not-now () → void`: `setNotNow(Date.now())`.

  Validate inputs, as `engine-stage-cycles` does: arrays of strings, else `[]`.
- [ ] **Step 2: `index.ts`.** Add `import { registerReonedCopiesIpc } from './reonedCopiesIpc'`
  and call `registerReonedCopiesIpc(ipcMain)` next to `ipcMain.handle('bake-offset', …)`.
- [ ] **Step 3: Preload.** Add `rebuildReonedCopies`, `reonedCopiesLibraryAvailable`,
  `reonedCopiesSurvey`, `reonedCopiesClean`, `reonedCopiesNotNow`, typed from
  `@shared/reonedRepair` and `@shared/reonedCleanup`. `RifffApi` is `typeof api`, so `index.d.ts`
  needs nothing.
- [ ] **Step 4: Verify.** `npm run typecheck && npm run lint`. Expected: clean.
- [ ] **Step 5: Commit** the three files. Subject: `re-one cleanup: ipc for rebuild, survey, clean and not now`.

**Review checkpoint C.** Check:
- the clean recomputes the used set at click time;
- an unreachable library short-circuits every handler;
- nothing in `reonedCopiesIpc.ts`'s import graph reaches `better-sqlite3` beyond what
  `index.ts` already loads;
- `knownProjects` are read fresh.

---

## Phase 4: the renderer (Tasks 14-17)

### Task 14: What the renderer holds

**Files:**
- Modify: `src/renderer/src/state/StoreContext.tsx`. Mirror the history beside `currentState`.
- Create: `src/renderer/src/state/reonedInUse.ts`
- Test: `src/renderer/src/state/reonedInUse.test.ts`

- [ ] **Step 1: Failing test** (spec: "the in-memory project and undo, open Cross/Discover sessions")

```ts
// src/renderer/src/state/reonedInUse.test.ts
import { describe, expect, it } from 'vitest'
import { __setHistoryForTest } from './StoreContext'
import { collectInMemoryReonedNames, setReonedSessionRoot } from './reonedInUse'

const n = (i: number): string => `${String(i).padStart(32, '0')}.baked.wav`
const stateWith = (i: number) => ({ rifffs: { g: { stems: [{ path: `/b/${n(i)}` }] } } })

describe('collectInMemoryReonedNames', () => {
  it('the project, its undo and redo, and open cross and discover sessions', () => {
    __setHistoryForTest({ past: [stateWith(1)], present: stateWith(2), future: [stateWith(3)] } as never)
    setReonedSessionRoot('cross', { parents: [{ sources: [{ path: `/b/${n(4)}` }] }] })
    setReonedSessionRoot('discover', [{ seedStem: { path: `/b/${n(5)}` } }])
    expect(collectInMemoryReonedNames().sort()).toEqual([n(1), n(2), n(3), n(4), n(5)])
    setReonedSessionRoot('cross', null)
    expect(collectInMemoryReonedNames()).not.toContain(n(4))
  })
})
```

- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.**
  - In `StoreContext.tsx`, next to `let currentState`, add `let currentHistory` (initial
    `createHistoryState(startupState)`), `getHistorySnapshot()` and `__setHistoryForTest()`.
    Assign `currentHistory = history` on the same line pair where `currentState = state` is
    assigned in `StoreProvider`'s render body. The same safety argument as that comment applies,
    and it is read only from event handlers.
  - `reonedInUse.ts`:
    - `setReonedSessionRoot(key: 'cross' | 'discover', value: unknown)` stores into a module
      `Map`;
    - `collectInMemoryReonedNames(): string[]` returns `collectReonedNames([h.past, h.present,
      h.future, ...sessionRoots.values()])`.
- [ ] **Step 4: App wiring** (**`App.tsx` is being edited by another agent**). Beside the
  `crossDraft` / `discoverSlots` `useState`s, add:

```tsx
useEffect(() => setReonedSessionRoot('cross', crossDraft), [crossDraft])
useEffect(() => setReonedSessionRoot('discover', discoverSlots), [discoverSlots])
```

- [ ] **Step 5: Run** `npx vitest run src/renderer/src/state/reonedInUse.test.ts src/renderer/src/state/StoreContext.test.ts && npm run typecheck`.
- [ ] **Step 6: Commit** the four files. Subject:
  `re-one cleanup: the renderer reports copies held in memory (project, undo, cross, discover)`.

### Task 15: Repair on open, the missing set, and the repair action

**Files:**
- Create: `src/renderer/src/state/reonedMissing.ts`,
  `src/renderer/src/state/reonedRepairOnOpen.ts` (+ `reonedRepairOnOpen.test.ts`)
- Modify: `src/renderer/src/state/store.ts` (`REPAIR_REONED_PATHS`), `state/history.ts`
  (transient), `state/store.test.ts`, `App.tsx` (the three load sites; **being edited by
  another agent**)

- [ ] **Step 1: Failing tests**

```ts
// src/renderer/src/state/reonedRepairOnOpen.test.ts
import { describe, expect, it, vi } from 'vitest'
import { initialState, type AppState } from './store'
import { dirtyCheckJson } from './saveSerialization'
import { repairReonedCopiesOnOpen } from './reonedRepairOnOpen'
import { reonedMissingPaths } from './reonedMissing'

const COPY = '/lib/.bakes/0123456789abcdef0123456789abcdef.baked.wav'
function loaded(): AppState {
  return {
    ...initialState,
    rifffs: {
      g: { groupId: 'g', name: 'g', bpm: 120, barLength: 4, folderPath: '', stems: [
        { slot: 1, author: '', name: 'd', type: 'drums', path: COPY, durationSec: 8, barLength: 4, phaseSourcePath: '/src/d.wav', phaseBars: 1 }
      ] }
    }
  }
}

describe('repairReonedCopiesOnOpen', () => {
  it('a copy rebuilt to the same name: the same state comes back, so the project is not unsaved', async () => {
    const state = loaded()
    const rebuild = vi.fn(async () => [[{ path: COPY, status: 'rebuilt' as const, bakedPath: COPY, durationSec: 8 }]])
    const repaired = await repairReonedCopiesOnOpen(state, rebuild)
    expect(repaired).toBe(state)
    expect(dirtyCheckJson(repaired)).toBe(dirtyCheckJson(state))
    expect(reonedMissingPaths()).toEqual([])
  })

  it('an unreachable original marks the stem missing and changes nothing else', async () => {
    const state = loaded()
    const repaired = await repairReonedCopiesOnOpen(state, async () => [[{ path: COPY, status: 'missing' as const }]])
    expect(repaired).toBe(state)
    expect(reonedMissingPaths()).toEqual([COPY])
  })

  it('no IPC at all for a project without copies; a failing IPC is logged, not thrown', async () => {
    const rebuild = vi.fn()
    const plain = { ...loaded(), rifffs: {} }
    await expect(repairReonedCopiesOnOpen(plain, rebuild)).resolves.toBe(plain)
    expect(rebuild).not.toHaveBeenCalled()
    const state = loaded()
    await expect(repairReonedCopiesOnOpen(state, async () => { throw new Error('ipc') })).resolves.toBe(state)
  })
})
```

In `store.test.ts`:

```ts
describe('REPAIR_REONED_PATHS', () => {
  it('repoints every stem naming the copy and leaves off and phase lineage alone', () => {
    /* a state with two rifffs naming COPY, off[g] = 3; dispatch the action with NEW; assert
       both stems' path/durationSec moved, phaseSourcePath/phaseBars kept, off unchanged */
  })
  it('returns the same state when no stem names the path', () => { /* toBe(state) */ })
})
```

And in `history.test.ts`, check that `REPAIR_REONED_PATHS` adds no undo step.

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - **`reonedMissing.ts`:** a module store (`useSyncExternalStore` shape, like
    `pendingPluginStates.ts`). It exposes `setReonedMissing(paths)`, `addReonedMissing`,
    `clearReonedMissing(paths)`, `reonedMissingPaths()`, `subscribeReonedMissing`, and a
    `useReonedMissing()` hook.
  - **`reonedRepairOnOpen.ts`:**

```ts
export async function repairReonedCopiesOnOpen(
  loaded: AppState,
  rebuild: (b: ReonedRepairBatch[]) => Promise<ReonedRepairOutcome[][]> = (b) => window.rifffApi.rebuildReonedCopies(b)
): Promise<AppState> {
  const batches = planReonedRepair(loaded.rifffs)
  setReonedMissing([])
  if (batches.length === 0) return loaded
  try {
    const { rifffs, missing } = applyReonedRepair(loaded.rifffs, await rebuild(batches))
    setReonedMissing(missing)
    return rifffs === loaded.rifffs ? loaded : { ...loaded, rifffs: rifffs as AppState['rifffs'] }
  } catch (err) {
    console.error('repairReonedCopiesOnOpen: rebuild failed; opening as saved:', err)
    return loaded
  }
}
```

  - **`store.ts`:** the action is
    `{ type: 'REPAIR_REONED_PATHS'; results: { path: string; bakedPath: string; durationSec: number }[] }`.
    Its reducer delegates to `applyReonedRepair(state.rifffs, [results.map((r) => ({ ...r, status: 'rebuilt' }))])`
    and returns `state` when the `rifffs` object comes back identical. Comment it: a repair is not
    a phase edit, so `off` is untouched, and it applies to every riff naming the path, unlike
    APPLY_BAKE.
  - **`history.ts`:** add `'REPAIR_REONED_PATHS'` to `TRANSIENT_ACTION_TYPES`, with a comment: a
    repair is not an undo step (R7).
  - **`App.tsx`:** at each site from `grep -n "deserializeProject(" src/renderer/src/App.tsx`
    (`loadRecoveredSnapshot`, the library `onSelect`, `onOpenFromDisk`, and any others that
    restore a project), between `deserializeProject` and `warmStemCaches`:

```ts
const repaired = await repairReonedCopiesOnOpen(loaded)
await warmStemCaches(repaired)
restoreState(repaired, pluginStates)
// The baseline is the file as saved: a copy rebuilt under its own name changes nothing; one
// rebuilt under a new name shows as unsaved, which is true.
lastSavedJsonRef.current = dirtyCheckJson(loaded)
```

    New project / "discard" paths clear the set with `setReonedMissing([])`.
- [ ] **Step 4: Run** `npx vitest run src/renderer/src/state && npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** (state files, then App.tsx in its own commit, so a conflict there stays
  small). Subjects:
  - `re-one: rebuild missing copies when a project opens, without marking it unsaved`;
  - `app: run the re-oned copy repair at every project load`.

### Task 16: Show what is missing, and retry

**Files:**
- Create: `src/renderer/src/components/ReonedCopyMissingNotice.tsx`
- Modify: `src/renderer/src/components/Inspector.tsx`, `App.tsx` (mount, one line beside
  `<PluginsHeldNotice />`)

- [ ] **Step 1: The pill.** It is a `role="status"` div styled exactly like `PluginsHeldNotice`,
  at `top: 156`. Its text is `MISSING_COPY_TEXT`, and its `title` is
  `` `${n} re-oned ${n === 1 ? 'copy' : 'copies'} missing` ``. Render nothing when the set is
  empty.
- [ ] **Step 2: The retry**, in the same component. While `useReonedMissing()` is non-empty:
  - every 15 s (`RETRY_MS = 15_000`), plan a repair over only the riffs of `getStateSnapshot()`
    whose stems name a missing path;
  - call `window.rifffApi.rebuildReonedCopies`, then for each outcome:
    - **`rebuilt` with the same path:** `clearReonedMissing([path])`,
      `evictStemAnalysis([path])`, and call `useFlushEngineSyncNow()`'s function once after the
      batch;
    - **`rebuilt` with a new path:** dispatch `REPAIR_REONED_PATHS` and clear the old path;
    - **`missing`:** leave it.

  Clear the interval when the set empties or the component unmounts. Use one in-flight guard, so
  a slow rebuild (an engine spawn for LORE) is never re-entered.
- [ ] **Step 3: Inspector.** Inside the `rifff.stems.map` row (`Inspector.tsx`, the `Fragment`
  per stem), after the row's `div`: when `useReonedMissing()` includes `stem.path`, render a 9 px
  `var(--ra-text-3)` line with `MISSING_COPY_TEXT`. Use lowercase, tokens only, and no colour (it
  isn't audio information).
- [ ] **Step 4: Mount** `<ReonedCopyMissingNotice />` in `App.tsx` beside `<PluginsHeldNotice />`.
- [ ] **Step 5: Verify.** `npm run typecheck && npm run lint`. Then manual: no agent can click
  through the app; say so in the PR.
- [ ] **Step 6: Commit.** Subject:
  `re-one: say when a re-oned copy is missing, and rebuild it once its original is back`.

### Task 17: The launch notice and the gear button

**Files:**
- Create: `src/renderer/src/components/ReonedCopiesNotice.tsx`
- Create: `src/renderer/src/state/reonedCleanupRequest.ts`, a two-function module:
  `requestReonedCleanup()` and `subscribeReonedCleanupRequest(cb)`. The gear menu needs no new
  App prop.
- Modify: `src/renderer/src/components/TransportBar.tsx` (the settings menu), `App.tsx` (mount)

- [ ] **Step 1: The notice component.** It is a fixed box styled like the pills
  (`var(--ra-bg-bar)`, `var(--ra-border)`, no radius, fontSize 9) at `top: 184`, with up to two
  text buttons separated by ` · `.

  | state | text | buttons |
  |---|---|---|
  | `looking` (manual only) | `LOOKING_TEXT` | none |
  | `offer` | `cleanupOfferText(bytes)` | `clean up` · `not now` |
  | `cleaning` | `CLEANING_TEXT` | none |
  | `done` | `clearedText(freedBytes)` | none; hides after 14 s or on click |
  | `nothing` (manual only) | `NOTHING_TO_CLEAN_TEXT` | `ok` |
  | `unreadable` (manual only) | `COULD_NOT_CHECK_TEXT` | `ok` |

  - **The launch pass**, once per renderer session:
    1. wait for `getLibraryWarmupStatus()` or `onLibraryWarmupComplete`, then 30 s more;
    2. call `reonedCopiesSurvey({ inMemoryNames: collectInMemoryReonedNames(), respectNotNow: true })`;
    3. show `offer` only when `status === 'ok'` and
       `shouldOfferCleanup({ unusedBytes, now: Date.now(), notNowUntil })`;
    4. every other outcome stays hidden (`library-missing`, `snoozed`, `unreadable`, under
       200 MB).
  - **Manual**, on `subscribeReonedCleanupRequest`: `looking`, then
    `reonedCopiesSurvey({ …, respectNotNow: false })`:
    - `ok` with `unusedBytes > 0` → `offer`, at any size;
    - `ok` with 0 → `nothing`;
    - `unreadable` → `unreadable`;
    - `library-missing` → hidden. The button was greyed anyway.
  - **`clean up`:** `cleaning`, then
    `reonedCopiesClean(collectInMemoryReonedNames())`, collected again at click time. `ok` →
    `done`; anything else → hidden, logged.
  - **`not now`:** `reonedCopiesNotNow()`, then hidden (D13).
  - Not gated on the advanced switch (D18).
- [ ] **Step 2: The gear item.** In `TransportBar.tsx`:
  - when the settings menu opens (`handleOpenSettingsMenu`, beside the other fetch-on-open
    calls), fetch `reonedCopiesLibraryAvailable()` into state, as `boolean | null`;
  - add an item after "change save location…":

```ts
{
  label: CLEANUP_MENU_LABEL,
  onClick: () => requestReonedCleanup(),
  disabled: reonedLibraryAvailable !== true,
  title: reonedLibraryAvailable === false ? LIBRARY_MISSING_TITLE : undefined
}
```

- [ ] **Step 3: Mount** `<ReonedCopiesNotice />` in `App.tsx` beside the other notices.
- [ ] **Step 4: Verify.** `npm run typecheck && npm run lint && CI=1 npx vitest run`. Expected:
  clean and green. The engine-spawn caveat is the same as in "Before you start".
- [ ] **Step 5: Commit** (component + request module + TransportBar, then App.tsx). Subjects:
  - `re-one cleanup: the launch notice and the gear menu's clean up re-oned stem copies…`;
  - `app: mount the re-oned copies notices`.

**Review checkpoint D** (UI). Check:
- copy is word-for-word from `reonedCleanup.ts`, lowercase, no exclamation marks;
- tokens only;
- the notice never blocks input;
- "not now" is stored in main, not in the renderer;
- the gear item is greyed with its title when the library is away.

---

## Phase 5: docs and verification (Tasks 18-19)

### Task 18: CLAUDE.md, AGENTS.md, TO-DO.md, CHANGELOG.md

- [ ] **Step 1: CLAUDE.md**, section "Phase lineage and the `.bakes` folder".
  - First paragraph: replace "into `<library root>/.bakes/<uuid>.baked.wav`" with "into
    `<library root>/.bakes/<recipe>.baked.wav`".
  - Second paragraph: replace from "Nothing deletes from `.bakes` yet;" to the end of that
    paragraph with:

> `.bakes` is a rebuildable cache. A copy is named by its recipe (`src/main/reonedRecipe.ts`: the
> original's path, size and mtime, the rotation in samples, `BAKER_VERSION`), and a re-one bakes
> from the stem's original (`phaseSourcePath`) by the total rotation (`phaseBars`), falling back to
> the current file only while the original is away. So the same riff at the same phase, whether
> re-oned, crossed or seeded into Discover, reuses one file. A copy a project names but that is
> missing is rebuilt from that lineage when the project opens (`state/reonedRepairOnOpen.ts`) and
> before any export (`ensureReonedCopiesForState`, `reonedRebuild.ts`). It lands on the same name,
> so the project isn't marked unsaved. Unused copies are cleaned by the launch notice
> (`ReonedCopiesNotice.tsx`, from 200 MB, "not now" for 7 days) and the gear menu's "clean up
> re-oned stem copies…".
>
> "Used" means named by:
> - any library project or backup;
> - the autosave or its aside snapshot;
> - a remembered outside project (`reonedCopiesStore.ts`, 50 kept);
> - the open project, its undo history, Cross or Discover (`state/reonedInUse.ts`);
> - a copy handed out this session.
>
> A copy is deleted only if it is unused and more than a day old (`reonedUsage.ts`). Rules:
> - Bump `BAKER_VERSION` whenever the baker's bytes change (rotation, seam blend, `BakeStem.cpp`).
> - Anything new that can hold a stem path, such as a new session type or a new saved file, must
>   join the used set.
> - A failed bake never deletes a copy it didn't create.
> - Never delete outside `.bakes`, and leave the legacy `.sssketch-bakes/` folders alone.
- [ ] **Step 2: AGENTS.md** §6. Replace the last bullet ("**Disk:** … Known gap … design.") with:

> - **Disk:** every file the app generates needs a cleanup story. No unbounded hidden folders.
>   `<library>/.bakes` is a rebuildable cache (CLAUDE.md, phase lineage). Keep three rules:
>   anything new that holds stem paths joins the used set (`reonedUsage.ts` /
>   `state/reonedInUse.ts`); `BAKER_VERSION` is bumped when the baker's output changes; and
>   cleanup deletes only unused copies more than a day old, never outside `.bakes`.

  Also add to §6's list:

> - **Re-oned copies:** a missing copy is rebuilt on open and before export without marking the
>   project unsaved, and a failed bake never deletes a copy it didn't create.
- [ ] **Step 3: TO-DO.md.** Delete the whole `- [ ] Give the library's `.bakes/` folder a cleanup
  story.` item, including its four sub-bullets.
- [ ] **Step 4: CHANGELOG.md.** Under "Unreleased":
  - in "### Added": "Re-oned stem copies are now reused instead of duplicated, rebuilt
    automatically when one is missing, and can be cleaned up: a notice at launch from 200 MB of
    unused copies, or any time from the gear menu's "clean up re-oned stem copies…". Your
    rifffs, stems and projects are never touched."
  - in "### Changed": "A re-one now bakes from the stem's original audio."
- [ ] **Step 5: Commit** the four docs. Subject:
  `docs: re-oned copies are a rebuildable cache; the cleanup rules replace the open to-do`.

### Task 19: Verify, and map the spec's tests

- [ ] **Step 1: Full checks**

```bash
npm run typecheck
npm run lint
CI=1 npx vitest run
npx vitest run src/main/bakeOffset.test.ts src/main/reonedRebuild.test.ts   # with native-engine/build present
```

  Expected: all green, apart from the documented engine-spawn caveat. No file was added to
  `vitest.config.ts`'s exclude list, and `CI=1` must not crash a worker. If one does, a new test
  imports `better-sqlite3` transitively: find it and add it to the list.
- [ ] **Step 2: The spec's tests, each written by a task:**

| spec test | where |
|---|---|
| recipe name stable / differs by source, rotation, baker version | Task 2, `reonedRecipe.test.ts` |
| reuse: re-oning twice to the same spot writes one file | Task 4, `bakeOffset.test.ts` "names a copy by its recipe…" |
| rebuild to the same name, project not unsaved | Task 8 `reonedRebuild.test.ts` + Task 15 `reonedRepairOnOpen.test.ts` |
| unreachable original: missing, no crash, no partial batch | Task 8 + Task 15 |
| used: library projects, backups, autosave | Task 12 |
| used: in-memory project and undo, Cross/Discover | Task 14 (renderer collection) + Task 12 (main counts what it's sent) |
| used: remembered outside projects | Task 11 (recorded) + Task 12 (read or remembered) |
| the grace day | Task 12 |
| popup threshold and "not now" | Task 10 (+ Task 11 for the stored time) |
| cleanup deletes only unused, reports freed size | Task 12 |
| (plan) bars → seconds pinned against a real bake | Task 4 PIN, Task 3 |
| (plan) a failed batch keeps shared copies | Task 4 |

- [ ] **Step 3: Elling's walkthrough** (put it in the PR; agents can't click through the app):
  1. Re-one a WAV riff twice to the same downbeat. `ls <library>/.bakes` grows by one file, not
     two.
  2. Open Cross on a riff with a live offset, close it, open it again. No new file the second
     time.
  3. Re-one a LORE riff a second time and time the bake (R1). Is the wait acceptable?
  4. Save a re-oned project, quit, delete its copy from `.bakes`, and reopen it. The audio plays,
     the title shows no unsaved mark, and the same file name is back.
  5. Same, with the LORE drive unplugged: the pill and the Inspector line say "re-oned copy
     missing · rebuilds when its original is back". Plug the drive in. Within ~15 s it plays and
     the pill goes.
  6. Gear → "clean up re-oned stem copies…": a size, "clean up", then "cleared …". Reopen every
     project you have; they all still play.
  7. Unplug the library drive: the gear item is greyed, and no notice appears at launch.
  8. With ≥ 200 MB unused (Discover seeds made more than a day ago), relaunch. The notice appears
     about 30 s after the library is ready. "not now": not again on the next launch.
- [ ] **Step 4: Open the PR.** The description lists:
  - D1-D18 and the resolved ambiguities, as questions where they are Elling's call (D1's cost,
    D4, D12's words, D14's placement);
  - R1-R7;
  - the walkthrough.

  End it with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

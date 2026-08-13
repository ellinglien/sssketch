# Reaper Export + Stems Grouping — Design

## Goal

Add a REAPER (`.rpp`) project export as an alternative to the existing Ableton (`.als`)
export, and — in the same pass — group the existing stems export by bus (like the Ableton
export already does) and fold all three export types into a single "export project…" menu
item with a format picker (Ableton / Reaper / Stems).

## Background

`buildAlsXml.ts` + `exportAbleton.ts` are the existing model: a pure XML-builder function fed
by a template file, plus an orchestration module with three entry points (dialog-based for an
unsaved project, no-dialog for a library-resident sketch, no-dialog for an external-file
sketch). Bus grouping comes from `state.busOf` (assigned by the "tidy up" feature) via the
shared, format-agnostic `packIntoTracks` (`src/shared/packIntoTracks.ts`).

The existing stems export (`nativeExport.ts`'s `renderStemsToDir` /
`nativeExportStemsToDisk`) is a *different* pipeline — it renders each stem through the full
native engine, soloed, producing final processed audio (not the raw source-audio
materialization the Ableton/Reaper export uses) — and today writes every stem flat into one
folder with no bus awareness and no library-aware no-dialog entry points.

REAPER's `.rpp` format was researched directly from primary sources rather than assumed:
the [CockosWiki/ReaTeam "State Chunk Definitions" doc](https://github.com/ReaTeam/Doc/blob/master/State%20Chunk%20Definitions),
a complete real example project file
([cpmpercussion/Studio1-Demo](https://github.com/cpmpercussion/Studio1-Demo/blob/master/reaper/reaper-test.RPP)),
and REAPER's own [SWS extension color-conversion source](https://github.com/reaper-oss/sws/blob/master/Color/Color.cpp)
for the native color integer encoding. Field meanings not independently verifiable (exact
semantics of some trailing fade/playrate fields) are called out below as "copied from the real
example, not independently derived" — same posture this codebase already takes with the
Ableton `FadeInLength` unit hypothesis (`buildAlsXml.ts`).

## Non-goals

- Real nested REAPER folder/parent tracks (`FOLDERDEPTH` chunk fields) — flat, bus-colored,
  bus-adjacent tracks instead (see "Bus grouping" below).
- Baking stems to their played tempo before export — REAPER's own `PLAYRATE` does the
  tempo-matching, same audio files as the Ableton export's `Samples/Imported/` materialization.
- Changing `export mix`'s existing behavior or menu position — untouched by this work.
- MIDI, automation, or FX-chain export — audio items only, matching the Ableton export's own
  scope.

## Architecture

New files, mirroring `buildAlsXml.ts`/`exportAbleton.ts`'s shape:

- **`src/main/reaper/buildRppProject.ts`** — pure function
  `(state, outputDir, stemFileNames, stemSampleRates?) => string`, returning the full `.rpp`
  text. No checked-in template file (unlike Ableton's `template.xml`) — RPP's block structure
  is simple enough to construct directly from small field-line builders, each backed by a code
  comment citing the real example file it was derived from.
- **`src/main/reaper/rppNode.ts`** — a tiny node-builder/serializer for RPP's
  `<BLOCK ...\n  FIELD a b c\n>` nested-bracket text format, mirroring the role
  `alsXmlHelpers.ts` plays for Ableton's XML tree (used by both `buildRppProject.ts` and its
  test suite, which parses the generated text back into a tree for assertions).
- **`src/main/exportReaper.ts`** — orchestration, mirroring `exportAbleton.ts`'s three entry
  points: `exportReaperToLibrary`, `exportReaperNextToSource`, `exportReaper` (dialog-based).
- **Shared materialization**: `materializeStem` and the stem-into-`Samples/Imported/`-folder
  logic are extracted out of `exportAbleton.ts` into
  **`src/main/exportAudioMaterialization.ts`**, called by both `exportAbleton.ts` and
  `exportReaper.ts` — same audio files, same cache, format-agnostic.
- **`src/main/projectLibrary.ts`** — add `sketchReaperDir(name)` (`sketchDir(name)/Reaper`,
  same convention as `sketchAbletonDir`) and `sketchStemsDir(name)`
  (`sketchDir(name)/Stems`).
- **`src/shared/busNaming.ts`** — extract `humanizeSoundType`/`summarizeSoundTypes`/
  `busGroupName` out of `buildAlsXml.ts` (now needed by the Reaper builder, the stems-export
  bus-folder naming, and still by the Ableton builder) — the second and third consumers are
  what justify pulling this out now, not speculatively.

## Format mapping (`buildRppProject.ts`)

- **Header**: `<REAPER_PROJECT 0.1 "sssketch" <unix-timestamp>` (version/generator/timestamp
  fields per the real header format; sssketch doesn't need to claim a specific REAPER version
  string).
- **Tempo**: `TEMPO <state.bpm> 4 4` at project level — 4/4 fixed, matching the Ableton
  export's own existing assumption (sssketch has no per-project time signature).
- **Tracks**: one REAPER `TRACK` per lane from `packIntoTracks`'s bus partition (same
  function, same input, as the Ableton export's re-partition-by-bus step) — i.e. non-
  overlapping-in-time stems sharing one physical track where possible, one track minimum per
  bus. Each track's `PEAKCOL` is set from its bus's real hex color (from
  `typeColor.ts`/`ABLETON_BUS_COLORS`'s source palette) via
  `0x01000000 | (b<<16)|(g<<8)|r` — the `0x01000000` "custom color" flag plus a BGR-packed
  int, per the SWS source. Flagged for manual confirmation once a real export can be opened in
  REAPER, same posture as other unverified-but-well-sourced format details in this codebase.
- **Bus grouping (flat, not folder tracks)**: tracks for the same bus are emitted adjacently
  in track order; the first track for each bus is named after the bus (reusing
  `busGroupName` from the new `src/shared/busNaming.ts`).
- **Items**: one REAPER `ITEM` per audible segment (a stem split at its `muteRegions`
  boundaries, same `audibleSegments` computation `buildAlsXml.ts` already has — reused
  conceptually, not code-shared, since the target structures differ).
  - `POSITION`/`LENGTH`: real arrangement-timeline seconds, computed from `startBar`/
    `playedBars` (via the existing `resolvePlayedBarsFor`-equivalent) at *project* tempo
    (`240 / state.bpm` sec/bar in 4/4).
  - `LOOP`: `1` for a tiled (non-one-shot) stem, `0` for a one-shot take — REAPER repeats the
    source in place to fill `LENGTH` when `LOOP 1` and the item is longer than one source
    repeat, the same shape as Ableton's tiled-warped-clip approach.
  - `PLAYRATE <rate> 1 0 -1 0 -1`: `rate = state.bpm / nativeBpmFor(stem)` (same native-tempo
    derivation as `buildAlsXml.ts`'s `nativeBpmFor`). Preserve-pitch on (field 2 = `1`), no
    manual pitch adjust (field 3 = `0`), pitch-shift/stretch-mode preset left at project
    default (`-1`) rather than sssketch silently choosing an algorithm.
  - `SOFFS`: crop offset in *source-file* seconds at *native* tempo
    (`leftCropBars * 240 / nativeBpm`) — this is how far into the original recording to start
    reading, before `PLAYRATE` is applied; NOT the same unit as `POSITION`/`LENGTH`.
  - `MUTE`: `1` for a stem with `state.mute[key]` true, `0` otherwise — REAPER's native
    item-mute flag. Cleaner than the Ableton export's `SampleVolume 0` workaround (see
    `docs/superpowers/plans/2026-08-11-ableton-volume-fade-export.md`): a single click
    un-mutes in REAPER, vs. a fader move in Ableton.
  - `VOLPAN`: take-volume field (field 3) set to `state.vol[key] ?? 1`; other three fields
    (`1 0 · -1`) left at the real example's observed defaults, untouched.
  - `FADEIN`/`FADEOUT`: `<shape> <length_sec> 0 1 0 0` — shape and trailing fields copied
    verbatim from the real example (not independently derived — flagged in a code comment);
    `length_sec` is `fadeInBars`/`fadeOutBars` (same `state.dragFadeIn[groupId] ??
    state.fadeIn[groupId] ?? 0` sourcing as the Ableton export) converted at *project* tempo —
    a plain seconds value, no sample-count-unit hypothesis needed (unlike Ableton's
    `FadeInLength`). Fade-in only on a stem's first segment, fade-out only on its last,
    matching the Ableton export's own convention.
  - `NAME`: the stem's display name (rifff name + stem name), `GUID`/`IGUID`: fresh per item,
    formatted as REAPER's own `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}` (uppercase hex, dashes,
    braces) via Node's built-in `randomUUID()` — REAPER doesn't validate GUID provenance, only
    that each is well-formed and unique within the project.
  - `<SOURCE WAVE FILE "...">`: relative path into `Samples/Imported/`, from `stemFileNames`
    (same map the Ableton export already builds, reused as-is since both share
    `exportAudioMaterialization.ts`).

## Orchestration (`exportReaper.ts`)

Mirrors `exportAbleton.ts` exactly:

- `exportReaperToLibrary(state, libraryName)` — no dialog, writes into
  `sketchReaperDir(libraryName)`, clears `Samples/Imported/` first (folder is fully owned),
  opens Finder on success.
- `exportReaperNextToSource(state, sourcePath)` — no dialog, writes into
  `<dirname(sourcePath)>/Reaper/`, same clear-first/open-Finder behavior.
- `exportReaper(win, state, defaultName?)` — dialog-based (save-as `.rpp`), for an unsaved
  project; the escape-hatch "export a copy elsewhere" path.

A stem that fails to materialize is logged and dropped from the export (its item is simply
absent), not fatal — matching the Ableton export's existing "don't fail the whole export over
one bad piece" convention. Throws if nothing is placed on the timeline at all.

## Stems export: bus grouping + entry points

`renderStemsToDir` groups by `state.busOf[key]` directly (no `packIntoTracks` needed — unlike
DAW tracks, folders have no "can't overlap in time" constraint, so it's a straight
one-bus-one-subfolder split): `<destDir>/<busId>/<rifffName>-<stemName>.wav`.

Requires `busOf` to be populated (same "tidy up first" nudge as Ableton/Reaper export — see
UI below) — a stem export triggered before any tidy-up would otherwise have nothing to group
by.

New entry points, mirroring the Ableton/Reaper pattern:

- `exportStemsToLibrary(state, libraryName)` — no dialog, writes into
  `sketchStemsDir(libraryName)/<busId>/...`, clears stale contents first, opens Finder.
- `exportStemsNextToSource(state, sourcePath)` — no dialog, writes into
  `<dirname(sourcePath)>/Stems/<busId>/...`, opens Finder.
- `nativeExportStemsToDisk(win, state)` — kept as the dialog-based escape hatch for an unsaved
  project; the chosen folder now also gets bus subfolders instead of a flat file list.

## UI

- The "export" dropdown drops from 3 items to 2: `export mix` (unchanged) and
  `export project…`.
- `export project…` opens a small format picker — **Ableton** / **Reaper** / **Stems** —
  then proceeds via that format's three-entry-point dispatch (dialog vs. library vs.
  next-to-source), exactly matching how `runExportAbleton` already dispatches today based on
  `currentSketch`'s kind.
- The existing `TidyUpNudgeModal` gate (shown when `state.busOf` is empty) now covers all
  three formats, not just Ableton — reused as-is, just triggered from the format picker's
  submit handler instead of only `handleExportAbleton`.

## IPC / preload

New channels, mirroring the Ableton export's existing three
(`export-als`/`export-als-to-library`/`export-als-next-to-source`):

- `export-rpp`, `export-rpp-to-library`, `export-rpp-next-to-source`
- `export-stems-to-library`, `export-stems-next-to-source` (the existing
  `export-stems-native` dialog-based channel is kept, its handler updated to call the new
  bus-grouped `renderStemsToDir`)

Preload bridge (`window.rifffApi`) gains matching methods, same shape as the existing
`exportAls`/`exportAlsToLibrary`/`exportAlsNextToSource` trio.

## Testing

- **`src/main/reaper/rppNode.test.ts`**: node builder/serializer round-trips (build a tree,
  serialize, parse back, compare).
- **`src/main/reaper/buildRppProject.test.ts`**: mirrors `buildAlsXml.test.ts`'s structure —
  tempo, playrate math (native vs. project bpm), tiling/loop flag, whole-stem mute (native
  `MUTE` flag) vs. partial mute-regions (segment-splitting, gaps), volume, fades (first/last
  segment only, not a middle segment), track colors, bus-adjacency/naming, "nothing placed"
  throws, a stem missing from `stemFileNames` is skipped.
- **`src/main/exportAudioMaterialization.test.ts`**: the extracted `materializeStem` logic,
  covering what `exportAbleton.test.ts` (if any covers this today) already covers — cache hit,
  cache miss + decode, decode failure evicts the cache entry.
- **`src/main/exportReaper.test.ts`**: mirrors `exportAbleton.ts`'s existing test coverage for
  its three entry points and materialization-failure handling.
- **`src/main/nativeExport.test.ts`** (existing file, extended): `renderStemsToDir`'s new
  bus-subfolder grouping, and the new library/next-to-source entry points.
- **`src/shared/busNaming.test.ts`**: extracted from wherever `buildAlsXml.test.ts` currently
  covers `busGroupName`/`summarizeSoundTypes`/`humanizeSoundType` (moved, not newly written).

## Manual verification (cannot be automated)

Same posture as the Ableton fade-unit work: a real exported `.rpp` needs to be opened in
actual REAPER to confirm the researched-but-unverified-in-practice details — specifically the
`PEAKCOL` color encoding, `PLAYRATE`'s exact stretch-quality behavior, and that tiled/looped
items actually repeat as expected. This is a required final task before considering the
feature done, not optional polish.

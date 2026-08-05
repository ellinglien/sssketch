# Project Library Design

## Context

sssketch's graduation path to serious production is exporting to Ableton Live (`.als`), shipped
2026-08-04. Now that it actually works end-to-end, the user expects most of their working time to
end in an Ableton export, iterated on repeatedly. Today, project save (`.sssketchproj`) and
Ableton export are both bare native-dialog operations with no memory of location, no relationship
to each other, and no listing of what already exists — every export is a fresh, fully independent
`Samples/Imported/` copy, and the user has been manually incrementing folder names (`ssstitch/1`,
`ssstitch/2`, `ssstitch/3`, ...) during testing. The user wants this to require no manual file
organization, avoid redundant audio copies as they iterate, and stay easy to find things in.

## Scope

**In scope:**
- An app-owned default library folder that sketches live in, with routine save/export no longer
  prompting for a location.
- A "Project Library" browser (modal, opened on demand) listing existing sketches.
- Regenerate-in-place export behavior tied to a single project entry, with a safety warning
  before overwriting an `.als` that's been modified outside sssketch since the last export.
- An explicit "duplicate as new version" action with auto-incrementing names.
- A shared, content-keyed sample cache with copy-on-write cloning, so re-exports and new versions
  don't redundantly re-decode or re-copy unchanged stem audio.
- An emoji prefix on auto-generated sketch names.

**Out of scope (YAGNI, not requested):**
- Smarter *initial* sketch naming derived from content (tempo/rifff names) — only the
  auto-incrementing case for explicit duplication was requested.
- Sketch names that auto-update as content evolves.
- Any database/catalog beyond the filesystem itself (see "Approaches considered" in the prior
  discussion — rejected as unnecessary machinery for this scale).
- Search/filter/sort UI beyond a simple list (nothing requested; add later if the library grows
  large enough to need it).
- Migrating existing projects/exports made before this feature into the new library layout —
  they keep working via the existing "save a copy elsewhere" / native dialog path; nothing here
  breaks old files, it's purely additive for new ones.

## Architecture

### Library root

One folder, default `~/Music/sssketch/`, created on first use. A single new preference
(persisted the same way other app-level settings already are) allows relocating it — not a
per-sketch setting.

Each sketch is one subfolder:

```
~/Music/sssketch/
  🌙-2026-08-05-velvet-otter/
    🌙-2026-08-05-velvet-otter.sssketchproj
    .sssketch-meta.json              # { lastExportAlsMtimeMs: number }
    Ableton/
      🌙-2026-08-05-velvet-otter.als
      Samples/Imported/*.wav
  🌙-2026-08-05-velvet-otter-2/      # explicit "duplicate as new version"
    ...
  .samples-cache/
    <stemCID>.wav                    # LORE-sourced stems, keyed by their own stable CID
    <hash(path+size+mtime)>.wav      # drag-and-dropped WAV stems
```

The subfolder name and the `.sssketchproj`/`.als` filenames inside it are always the same string
(the sketch's name) — no separate "display name" vs "filename" concept.

### Shared sample cache

Every stem that ends up in an Ableton export's `Samples/Imported/` is first materialized once
into `.samples-cache/`, keyed by stem identity:
- A LORE-sourced stem uses its own `stemCID` (already a stable, globally unique identifier —
  see `loreWarehouse.ts`) directly as the cache key.
- A drag-and-dropped WAV (no stable ID) uses a hash of `(absolute path, file size, mtime)` — good
  enough to detect "this is the same file as before" without hashing file contents, matching the
  identification strategy this codebase already uses elsewhere for similar path-based caching
  (see `src/renderer/src/audio/`'s peak/band-energy caches).

Export logic, per stem:
1. Compute the cache key.
2. If `.samples-cache/<key>.wav` exists, clone it directly to the destination
   (`fs.copyFileSync(cachePath, destPath, fs.constants.COPYFILE_FICLONE)`). No decode, no
   re-read of the original source.
3. If not, decode/copy the stem into the cache first (existing WAV-copy vs. native `bake-stem`
   logic from `exportAbleton.ts`, unchanged), then clone from the cache to the destination the
   same way.

`COPYFILE_FICLONE` requests an APFS copy-on-write clone: near-instant, consumes no extra disk
space until either copy is later modified independently, and Node automatically falls back to a
normal full copy if the volume doesn't support it (e.g. an external non-APFS drive) — no special
handling needed for that fallback, it's the documented behavior of the flag.

This one mechanism is what makes re-exporting the same sketch AND creating a new version both
cheap: neither needs to know about the other, because the cache is indifferent to which sketch
is asking.

**Stale files on re-export**: regenerate-in-place only adds/overwrites files for stems currently
in the arrangement — without correction, a stem removed from the arrangement since the last
export would leave its old copy orphaned in `Samples/Imported/` forever. Since cache clones are
near-free, the fix is simple: a routine export clears the sketch's own `Ableton/Samples/Imported/`
directory before repopulating it from the cache. This never touches the shared cache itself
(other sketches/versions may still reference those cached files) — only the one sketch's own
destination folder.

### Overwrite safety

`.sssketch-meta.json` holds exactly one field: the `.als` file's own mtime at the moment
sssketch itself last wrote it. This check gates the entire regenerate-in-place operation — both
overwriting the `.als` and clearing/repopulating `Samples/Imported/` (see the "Stale files on
re-export" note above) — not just the `.als` bytes specifically, since a modified `.als` mtime is
the signal that the user may have added their own content to that folder via Ableton (e.g. a
manually-imported extra sample) that a silent wipe would destroy. Before a routine export would
overwrite that `.als`:
1. Stat the existing `.als` (if present).
2. If its current mtime doesn't match the stored `lastExportAlsMtimeMs`, something (almost
   certainly Ableton, saving the user's own mixing work) has touched it since — show a
   confirm-overwrite dialog before proceeding.
3. If it matches (or there's no prior export / no meta file), proceed without prompting.
4. After a successful export, stat the freshly-written `.als` and store its mtime back into
   `.sssketch-meta.json`.

A missing or corrupt `.sssketch-meta.json` is treated as "no prior export" — export proceeds
without the warning. This is the correct safe default: the failure mode is "might overwrite once
without asking," which is exactly today's existing (accepted) behavior, not a regression.

### Naming

`generateDefaultProjectName()` (`projectFile.ts`) gains an emoji prefix, randomly chosen from a
small curated set matching the existing adjective/noun list's tasteful, music/creative tone (e.g.
🎵🎶🎸🥁🎧🌊🔥✨🌙⚡🍃🌀🔮💫 — final list decided at implementation time, not load-bearing to this
design). Placed at the very front of the generated name, before the date — this means library
folders no longer sort chronologically by default in Finder the way the date-first scheme does
today; accepted as a known, easily-reversible tradeoff.

**Duplicate as new version**: an explicit action (see UI below) that:
1. Reads the current sketch's `.sssketchproj` JSON.
2. Computes the next unused name by appending `-2`, `-3`, ... to the base name (checking the
   library root for existing folders with that name) — e.g. `🌙-2026-08-05-velvet-otter` →
   `🌙-2026-08-05-velvet-otter-2`.
3. Writes the same JSON content into a new subfolder under that name.
4. Switches the app to the new sketch (so subsequent Save/Export target the duplicate, not the
   original) — matches the mental model of "Save As," not a background copy.

The duplicate's own `.sssketchproj` is pure JSON (stem paths, arrangement state) — trivially
small, nothing to be "efficient" about at that layer. Its *next* Ableton export automatically
benefits from the shared cache; no special-case code ties versioning to the cache at all.

## Data flow / UI

- **New sketch**: unchanged creation flow; first Save creates its library subfolder.
- **Save** (routine, e.g. ⌘S): writes `<name>.sssketchproj` into the sketch's own folder, no
  dialog. Replaces today's always-prompting `saveProjectAs` for the common case.
- **Export to Ableton** (routine): writes into the sketch's own `Ableton/` folder in place,
  subject to the overwrite-safety check above. Replaces today's always-prompting `exportAbleton`.
- **Duplicate as new version**: a new menu action (alongside the existing Save/Export controls,
  exact placement decided during implementation — likely the same menu `App.tsx` already wires
  `exportAls`/`saveProject` into) triggering the flow above.
- **Save a copy elsewhere**: existing native-dialog behavior kept as an explicit escape hatch
  (e.g. a menu item), for sharing a fully standalone copy outside the library — writes its own
  independent `Samples/Imported/` with real (non-cloned) copies, since a file leaving the library
  must be genuinely portable on its own.
- **Project Library browser**: a new modal component, following the existing
  `LoreLibraryBrowser.tsx`/`PluginCatalogBrowser.tsx` pattern (modal overlay, scrollable list,
  click to act) — not a native file browser. Opened on demand via a "Library" button near the
  existing Save/Export controls; the app does **not** show it automatically at launch (startup
  keeps resuming the last-open/autosaved project, unchanged). Lists each subfolder under the
  library root that contains a `.sssketchproj` file: name and last-modified time (from the file's
  own mtime — no separate metadata needed for the list itself). Clicking a row opens that sketch
  (loads its `.sssketchproj`, same as today's "Open Project" flow, just pointed at a
  library-relative path instead of a dialog-chosen one).

## Error handling

- Library root doesn't exist or isn't writable on first use: prompt once via a native folder-
  picker dialog to relocate it (mirrors existing dialog-based error recovery elsewhere in this
  codebase) rather than failing silently.
- Cache clone fails for a reason other than "unsupported filesystem" (e.g. disk full, permission
  error): falls through to the existing per-stem "log and skip" convention
  (`exportAbleton.ts`'s current behavior) — that stem's clip is absent from the export, the rest
  proceeds.
- `.sssketch-meta.json` missing/corrupt: treated as "no prior export" (see Overwrite Safety
  above) — never a hard failure.
- Duplicate-as-new-version name collision beyond simple numbering (e.g. someone manually created
  a folder with the exact computed name out-of-band): keep incrementing until an unused name is
  found; not expected to occur in practice given the emoji+date+word+number combination, but the
  loop must not infinitely stall — cap at a reasonable bound (e.g. 1000) and surface a clear
  error in the unlikely case every one is somehow taken.

## Testing

- Cache-key derivation (LORE `stemCID` vs. path+size+mtime hash for drag-and-dropped WAVs), the
  overwrite-safety mtime comparison, and the next-unused-name-for-duplication logic are all pure
  functions — get real unit test coverage, matching this codebase's established convention for
  anything not requiring Electron/native-process access.
- The actual `COPYFILE_FICLONE` clone call and library-folder scanning are Electron/filesystem-
  dependent — verified via manual walkthrough, matching `exportAbleton.ts`'s own existing
  untested-at-that-layer convention (real dialogs, real filesystem, no automated coverage
  expected at this layer).
- **The one thing nothing here can verify automatically**: opening a duplicated version's
  Ableton export in real Ableton and confirming the cloned stems actually play back correctly
  (i.e. an APFS clone behaves identically to a real file from Ableton's own point of view — this
  is standard, well-supported macOS behavior, but worth a single real confirmation the same way
  the original Ableton export work needed real-Ableton verification throughout).

## Known risks / open uncertainties

- **Emoji-first naming breaks default chronological Finder sort** — called out above, accepted
  as a known tradeoff by the user; trivially reversible (move the emoji after the date) if it
  turns out to bother them in practice.
- **APFS clone-on-write assumption**: this design leans on `COPYFILE_FICLONE`'s documented
  automatic-fallback behavior rather than the app detecting the filesystem type itself. If that
  assumption is ever wrong in practice (unexpected error instead of silent fallback on some
  volume/Node version combination), the fix is a plain `copyFileSync` fallback wrapped around
  the FICLONE attempt — not a redesign, just defensive code to add if it's ever actually observed
  to misbehave, not now.
- **Pre-existing projects/exports** made before this feature (e.g. everything under
  `~/Documents/ssstitch/`, from tonight's testing) are not migrated into the library
  automatically — they remain openable via the existing dialog-based path, just outside the new
  browser's listing, unless the user manually moves them into the library root.

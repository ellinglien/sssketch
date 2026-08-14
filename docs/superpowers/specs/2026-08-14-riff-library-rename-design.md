# Riff Library Rename + Relocation — Design

**Status:** Drafted through the brainstorming skill with Elling, following a systematic app-wide
audit of every use of the name "LORE." Elling's concern, in his own words: "LORE was developed
by a single developer and I don't know how he will feel about me using that name... he's a
friend and I don't want to appropriate anything from him." The audit confirmed the concern is
well-founded: sssketch built its own, entirely self-contained riff-sync database (modeled after
the real LORE application's schema for compatibility, but built and owned by sssketch), and
named the whole subsystem "lore" throughout — files, identifiers, IPC channels, an on-disk
folder, a prefs file — none of which have anything to do with the real, external LORE app beyond
sharing a schema shape.

## Background

The audit (full results already reviewed with Elling) found "lore" naming falls into two
genuinely distinct buckets:

- **Bucket A — rename this.** sssketch's own self-built system: `src/main/loreWarehouse.ts`,
  `loreWarehouseSchema.ts`, `loreWarehouseSync.ts`, `loreWarehouseWriter.ts`,
  `src/shared/loreLibrary.ts`, every `Lore*`/`lore*` TypeScript identifier across
  `src/main/`/`src/renderer/src/`/`src/preload/`/`src/shared/`, all 13 `lore-*` IPC channel
  strings, the on-disk `lore-warehouse/` folder sssketch creates for itself, the
  `loreWarehousePrefs.json` prefs file, the `sssketch:loreUsername` localStorage key, and the
  entire family of `docs/superpowers/{specs,plans}/*lore*` planning documents. None of this
  naming is required to explain real interop — it's just this app's own internal convention,
  applied even when the data came from sssketch's own self-built sync, not the real LORE app.

- **Bucket B — keep as-is.** ~20 spots, mostly in `native-engine/Source/` (e.g.
  `StemBufferCache.cpp`, `BakeStem.h`, `LoopSewing.h`) plus a handful in `src/shared/` and
  `src/main/`, that explain a real, empirically-verified quirk of files that actually came from
  the real LORE application (Ogg Vorbis encoding, no file extension, metadata-derived duration,
  public unauthenticated CDN URLs). These correctly say "LORE-sourced" and never claim to *be*
  LORE — they stay untouched. `README.md`'s one sentence about opening "an existing
  OUROVEON/LORE-synced `warehouse.db3`, if you already have one" is the one piece of shipped
  copy already worded correctly, and also stays.

One real, independent bug fell out of the audit: `src/shared/friendlyRiffName.ts` labels every
imported riff `'lore'` in its generated name (e.g. `"green leopard 2f29c140 lore"`),
**unconditionally** — whether the riff actually came from sssketch's own self-built sync or a
genuinely external, real LORE-built archive. This mislabels the common case (sssketch's own
sync) as something it isn't.

## Goal

1. Every Bucket-A name is renamed to something that makes no reference to "LORE" — sssketch's
   own system gets its own identity.
2. sssketch's own riff-sync database and the project-file library both move from their current
   locations to sibling, human-visible folders: `~/Music/sssketch/library/` (was hidden inside
   `~/Library/Application Support/.../lore-warehouse/`) and `~/Music/sssketch/projects/` (was
   directly in `~/Music/sssketch/`, no subfolder).
3. Existing users (anyone with real content already sitting at either old location) get migrated
   to the new locations automatically, once, on first launch after this ships — nothing goes
   missing.
4. The "connect to a real, external LORE-built archive" capability stays, correctly and
   narrowly named, as its own clearly-separate optional feature — sssketch's own riff library is
   always present regardless of whether an external LORE archive is ever connected.
5. `friendlyRiffName.ts`'s mislabeling bug is fixed: a riff's generated name reflects where it
   actually came from.
6. `docs/USER_GUIDE.md`'s "LORE library browser" section (currently stale — it claims a
   pre-existing external LORE archive is required, which hasn't been true since sssketch started
   self-syncing) is corrected.

## Non-goals

- **No new dual-source browsing UI in this pass.** Elling's longer-term interest (browsing his
  own riff library and a connected external LORE archive side-by-side, e.g. via tabs) is real
  and worth building, but it's a separate, additive UI feature on top of this rename — not
  required to fix the naming/appropriation concern or the location/migration issues this design
  addresses. Flagged as explicit future work below.
- **No change to what data is stored or how riffs are synced/downloaded/played** — this is a
  naming, location, and migration change, not a behavior change to the sync engine itself.
- **No change to Bucket-B code** (the native-engine and shared comments explaining real
  LORE-sourced file quirks) — already correctly scoped, left untouched.
- **No change to the real external-LORE-archive file-reading capability itself** — sssketch can
  already open a real `warehouse.db3` a user points it at; this design only renames/relocates
  the surrounding system and clarifies that this is an optional add-on, not the default.

## Design

### 1. Renaming scheme

Every Bucket-A name drops all "lore"/"Lore"/"LORE" and adopts a consistent new identity:
**"riff library"** in prose and user-facing copy, `riffLibrary`/`RiffLibrary` in TypeScript
identifiers, `riff-library` in IPC channel names and on-disk/kebab-case names. This deliberately
does NOT reuse "library" alone (already means the project library — `projectLibrary.ts`,
`ProjectLibraryBrowser.tsx` — elsewhere in this codebase) and does NOT reuse "rifff" alone
(already means a single Endlesss loop/stem-group throughout the app) — "riff library" as a
compound term is unambiguous against both existing meanings.

Concretely (the plan should pin down exact 1:1 file/identifier mappings by reading the real
current names, but the scheme is fixed):
- `src/main/loreWarehouse.ts` / `loreWarehouseSchema.ts` / `loreWarehouseSync.ts` /
  `loreWarehouseWriter.ts` (+ their `.test.ts` files) → equivalent `riffLibrary*.ts` files,
  same responsibilities, same file count and boundaries (this is a rename, not a restructure).
- `src/shared/loreLibrary.ts` (+ `.test.ts`) → a `riffLibrary`-scheme shared-types file (exact
  name for the plan — needs to stay distinguishable from the main-process `riffLibrary*.ts`
  files, e.g. `riffLibraryTypes.ts`).
- Every `Lore*`/`lore*` identifier (types, functions, constants, IPC bridge methods) → the
  equivalent `RiffLibrary*`/`riffLibrary*` name, preserving exact behavior.
- All 13 `lore-*` IPC channel strings → `riff-library-*` equivalents (main and preload updated
  in lockstep — this is a real request/response contract between two processes, get every pair
  right).
- The on-disk `lore-warehouse/` folder name → see §2 below (folded into the relocation, not just
  a rename in place).
- `loreWarehousePrefs.json` → a `riffLibraryPrefs.json`-scheme prefs filename.
- `localStorage['sssketch:loreUsername']` → a `sssketch:riffLibraryUsername`-scheme key (see
  §3's migration note — a renamed localStorage key needs its own one-time carry-forward, same
  principle as the file/folder migration, or an intentional accepted reset of that one small
  preference; the plan should decide which and say so explicitly, not leave it unaddressed).
- `docs/superpowers/{specs,plans}/*lore*` files — these are historical records, not shipped
  product; per this project's own convention (see root `CLAUDE.md`'s note on `ssstitch`→
  `sssketch`: old-name references inside `docs/superpowers/specs/`, `docs/superpowers/plans/`,
  and `PHASE*_FINDINGS.md` are deliberately preserved as historical records) — these do **NOT**
  need renaming. Only shipped, current-facing text (code, UI copy, `docs/USER_GUIDE.md`,
  `README.md`, current `CLAUDE.md` prose) is in scope.
- `CLAUDE.md`'s own line describing `loreWarehouse.ts` as "the LORE warehouse integration" needs
  a rewrite reflecting the new name and the two-bucket reality (sssketch's own riff library,
  optionally augmented by a real external LORE connection).

### 2. New default locations + migration

Two sibling folders under one parent, replacing two previously-unrelated locations:

```
~/Music/sssketch/
  projects/   <- was: ~/Music/sssketch/ directly (defaultLibraryRoot() in projectLibrary.ts)
  library/    <- was: <userData>/lore-warehouse/ (ownWarehouseRoot() in loreWarehouseSchema.ts,
                 hidden inside ~/Library/Application Support/ on macOS)
```

Both defaults change in the same functions that already define them today
(`defaultLibraryRoot()` in `projectLibrary.ts`; the renamed equivalent of `ownWarehouseRoot()`
in the renamed schema file) — this is a one-line return-value change in each, not new
infrastructure.

**Migration is required, not optional**, because both old defaults are silent fallbacks used
whenever no explicit override is stored in that system's own prefs file — meaning any existing
user who never manually changed either location (the common case) has real content sitting
exactly at the old default path, which would otherwise simply stop being found. This project
already has an established pattern for exactly this situation — a one-time, idempotent
migration wired into app startup (see `stemCacheMigration.ts` and `riffFavouritesMigration.ts`
for the precedent to follow). The new migration:

1. Runs once, early in main-process startup, before either system's own "does my folder exist"
   check would otherwise run.
2. For the project library: if content exists at the OLD default (`~/Music/sssketch/`, meaning
   subfolders that look like real sketch projects — not `projects` or `library` themselves) AND
   nothing exists yet at the NEW default (`~/Music/sssketch/projects/`), move it there.
3. For the riff library: if content exists at the OLD default (`<userData>/lore-warehouse/`) AND
   nothing exists yet at the NEW default (`~/Music/sssketch/library/`), move it there.
4. Idempotent and safe to run on every launch: once the new location has anything in it (whether
   from a real migration or a fresh install that never had old content), the migration is a
   no-op forever after — it must never overwrite or merge into an already-populated new
   location.
5. Only ever runs for users with NO explicit stored override in the relevant prefs file — anyone
   who already manually pointed either location elsewhere (an explicit `libraryPrefs.json` or
   `riffLibraryPrefs.json` entry) keeps their own choice untouched; this migration only rescues
   users who were relying on the silent default.
6. A move, not a copy — the old location ends up empty (or is left as an empty, harmless
   directory; the plan should decide whether to actually remove the empty old directory
   afterward or just leave it, and say so explicitly either way) once migrated, so there's never
   a moment with two "real" copies of the same data drifting apart.

### 3. `sssketch:loreUsername` localStorage key

Called out separately from the file/folder migration above because localStorage migration has a
different mechanism (no filesystem move — a renderer-side one-time read-old-key-write-new-key-
delete-old-key on startup, or an explicit accepted reset). The plan must pick one and implement
it; leaving this key's value to silently reset without deciding that on purpose would be a
process failure by this project's own "No Placeholders" convention for its own planning skill.

### 4. `friendlyRiffName.ts` mislabeling fix

Currently: `friendlyRiffName(riffCID, suffix: 'lore' | 'endlesss' = 'lore')`, and
`LibraryBrowser.tsx` always calls it with the hardcoded `'lore'` suffix regardless of actual
source. Fix: the suffix must reflect where the riff genuinely came from —
`'library'` (or whatever the plan settles on to match the new naming scheme) when it came from
sssketch's own riff library (the common case, and the default with no external connection at
all), and `'lore'` kept **only** for the genuine case of a riff resolved from a real, externally
-connected LORE archive (Bucket B — this specific label is accurate there, since the file really
did come from the real LORE app's own sync). The call site in `LibraryBrowser.tsx` needs to pass
the real source, not a hardcoded literal — the plan should trace exactly how `LibraryBrowser.tsx`
already knows (or could know) whether a given resolved riff came from the own-library path or
the external-connection path, and thread that through rather than guessing at a new signal.

### 5. `docs/USER_GUIDE.md` correction

The current "LORE library browser" section (`docs/USER_GUIDE.md` lines ~188-190) says: "If you
have a local OUROVEON/LORE-synced Endlesss archive, this is a searchable alternative to
drag-and-drop..." — no longer accurate, since the browser works out of the box via sssketch's
own self-built, always-present riff library; an external LORE archive is now an optional
override, not a prerequisite. Rewrite this section (and its other ~5 "LORE" mentions elsewhere
in the same doc) to describe the real, current two-tier reality: sssketch's own riff library
(always there, syncs directly from Endlesss, no setup required) plus the optional "connect an
external LORE archive" override for anyone who already has one.

## Testing

- Every renamed TypeScript module that currently has real test coverage (`loreWarehouse.test.ts`,
  `loreWarehouseSchema.test.ts`, `loreWarehouseSync.test.ts`, `loreWarehouseWriter.test.ts`,
  `loreLibrary.test.ts`, `friendlyRiffName.test.ts`) keeps that coverage under its renamed
  filename/identifiers — this is a rename, so existing test *behavior* shouldn't change, only
  names; the plan should verify no test assertion was implicitly relying on old string literals
  ('lore-warehouse', channel names, etc.) that need updating in lockstep.
- The migration logic (§2) is genuinely new behavior and needs real new TDD coverage, following
  the exact precedent of `stemCacheMigration.test.ts`/`riffFavouritesMigration.test.ts` (both
  already exist in this codebase — read them for the fixture/mocking convention to match:
  temp-directory-based, not touching the real filesystem locations).
- IPC channel renames touch both `src/main/index.ts` and `src/preload/index.ts` — no dedicated
  test exists for this pairing today (matches this project's own established convention that
  IPC wiring is typecheck/lint-verified, not unit-tested) — the plan's final verification task
  should include a manual-walkthrough item confirming the riff library browser still opens,
  browses, and imports correctly after the rename, since a channel-name mismatch between main
  and preload would only surface at runtime, not at typecheck time.
- The `docs/USER_GUIDE.md` and remaining `README.md`/`CLAUDE.md` prose corrections have no
  automated test — verified by a careful read-through as part of the plan's own self-review.

## Future work (explicitly out of scope now)

A dual-source browsing UI — tabs or a merged view letting a user browse their own riff library
and a connected external LORE archive side-by-side, rather than one always implicitly
overriding the other via a single "current root" setting. Raised by Elling during this same
conversation as a real interest, not designed here — a natural next step once this rename and
relocation work has landed cleanly.

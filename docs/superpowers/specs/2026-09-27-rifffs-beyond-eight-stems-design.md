# Rifffs beyond eight stems

Date: 2026-09-27
Status: shape chosen by Elling (side table, not new columns); grounded against the real code; awaiting his walkthrough

Discover builds a stack of stems. `keep` saves that stack into the `discovered` room as a real
rifff, and from there it browses, previews, imports to the shelf, seeds a new Discover loop and
exports like anything else (`docs/superpowers/specs/2026-09-26-discovered-library-design.md`).

He now builds stacks of about twelve and wants to go to **twenty**. Today a kept group is
**silently capped at eight** — no warning, no truncation notice, the extra stems simply are not
in what gets saved.

---

## Why eight, and why it is not one number

The cap is not one bug in one place. It is three different eights, each justified by the one
before it, and the reason this shipped unnoticed is that they got conflated. Naming them is the
first real work of this spec.

| | where | what it actually constrains |
|---|---|---|
| **the storage eight** | `Riffs.StemCID_1 … StemCID_8`, `src/main/riffLibrarySchema.ts:54-55` | how many stems one row of the riff library can *address*. The real constraint. Everything else is downstream of it |
| **the assembly eight** | `MAX_STEMS_PER_RIFFF`, `src/renderer/src/audio/discoverRifffAssembly.ts:36` | how many members `assembleDiscoverRifff` will put into an in-memory `Rifff` object. A *renderer* cap, defended in its own comment by the storage eight |
| **the seed eight** | `MAX_SEED_SLOTS`, `src/renderer/src/audio/discoverSeed.ts:34` | how many Discover slots seeding from a riff or the shelf creates. Defended in its own comment by the assembly eight |

There is a fourth eight that is not in this codebase at all: **a real Endlesss rifff is eight
stems.** That is the product fact the storage eight encodes, and it is the only one of the four
that is not ours to change.

The failure mode was mechanical. The assembly eight is `assembleDiscoverRifff`'s *default*
`maxMembers`, and `resolveDiscoverRifff()` (`DiscoverPanel.tsx:2362`) — shared verbatim by
`add to timeline`, `add to shelf` **and** `keep` — takes that default. So the truncation happens
in the renderer, before the IPC call, before main ever sees the ninth stem. This exact default
has already caused one live bug (the engine preview silently dropping a ninth slot,
2026-09-16, fixed by passing an explicit `maxMembers`) and it is causing this one. Elling is
separately removing its misapplication to `add to timeline`.

**Which eight this spec is about: the storage eight.** The other two follow from it and are
retired in the same breath, because leaving either behind means the DB can hold twenty and the
app still saves eight.

---

## The shape: a side table, not new columns

Elling chose this, and the reason is not aesthetic:

> **sssketch's own riff library is deliberately schema-compatible with OUROVEON's LORE
> warehouse**, and the app can also open a real external LORE `warehouse.db3` read-only.

That is stated in the README's acknowledgments (line 97: *"schema-compatible with OUROVEON's own
LORE warehouse … sssketch can also open an existing OUROVEON/LORE-synced `warehouse.db3`
directly, read-only"*) and it matters to him. Adding `StemCID_9 … StemCID_20` changes the shape
of `Riffs` itself — the one table the compatibility claim is actually about. A side table is
purely additive: `Riffs` is untouched, byte for byte, and an OUROVEON tool reading a sssketch
warehouse sees exactly the table it expects.

sssketch already has eight of its own tables living beside the LORE ones for precisely this
reason (`StemCategories`, `StemFeatureCache`, `StemPeaksCache`, `StemEmbeddingCache`,
`StemAutoCategory`, `StemFavourite`, `StemUnavailable`, the two `Discover*Cache` pairs). This is
the ninth. It is the established pattern here, not a new one.

### The table

```sql
CREATE TABLE IF NOT EXISTS RiffStemsExtra (
  RiffCID TEXT NOT NULL,
  Slot INTEGER NOT NULL CHECK (Slot >= 9),
  StemCID TEXT NOT NULL,
  PRIMARY KEY (RiffCID, Slot)
);
CREATE INDEX IF NOT EXISTS idx_riffstemsextra_stem ON RiffStemsExtra(StemCID);
```

Four decisions in there, each of which had a real alternative:

**Slots 9-20, not 1-20 with the first eight duplicated.** The single strongest argument for
1-20 is a uniform read path: one query, one shape, no merge. It is not worth what it costs.
Duplicating slots 1-8 creates **two sources of truth for the same eight stems**, and every
reader then needs a precedence rule for what to do when they disagree — which is exactly the
class of bug that produced this one. It also makes the external-archive path *different in kind*
rather than merely shorter: on an external warehouse slots 1-8 would come from the columns, on
the own warehouse from the table, and the two would have to be verified to agree forever. And
the duplicate rows are dead weight on every LORE-synced riff, of which Elling has 372,297.

With 9-20, a riff of eight stems or fewer has **no rows in this table at all**. On his real
archive the table is empty. Its entire size is proportional to the number of oversized groups he
keeps. The merge that 1-20 would have avoided is one function, in one place
(`mergeStemSlots`), written once and tested once.

`CHECK (Slot >= 9)` makes "the columns own 1-8" a structural invariant rather than a convention
someone can forget.

**No upper bound in the DDL.** `CHECK (Slot BETWEEN 9 AND 20)` was considered and rejected:
SQLite cannot `ALTER` a `CHECK`, so encoding the product ceiling in DDL means a full table
rebuild the first time twenty is not enough. The lower bound is an invariant that must never
move; the upper bound is a product decision that probably will. The ceiling lives in one shared
constant instead (see below), enforced in code.

**Primary key `(RiffCID, Slot)`, not `(RiffCID, StemCID)`.** Slot is already a de facto primary
key within a rifff everywhere in this codebase — `GainsJSON` is keyed by slot number,
`stemKey(groupId, slot)` is keyed by slot, `buildRifff.ts:76-86` dedupes by slot and says so in
its own comment. `(RiffCID, Slot)` enforces that at the storage layer: a rifff cannot have two
stems in slot 12. `(RiffCID, StemCID)` would instead forbid the *same stem in two slots*, which
is legal today and which `discoveredGroupKey` explicitly accommodates ("the same stem in two
slots is still one member of the set").

No `WITHOUT ROWID`, although this table is a pure key lookup and would benefit slightly. Every
other composite-key table in this schema (`DiscoverRiffIndexCache`, `DiscoverInstrumentRowsCache`,
`DiscoverScanTargetCache`) keeps its rowid, and `scanTargetCache.ts`'s change-signal machinery
reads `MAX(rowid)` from tables it watches. Consistency, and not foreclosing that, beat a
marginal page-size win.

**The index on `StemCID` is not optional.** `deleteJamRows` (`riffLibraryWriter.ts:248-255`) asks
"is this stem still referenced by *any* riff" once per candidate stem, and that question must now
also be asked of this table. Without the index it is a full scan per stem.

### No foreign key, deliberately

`REFERENCES Riffs(RiffCID) ON DELETE CASCADE` looks obviously right and is wrong here, for three
reasons:

1. **SQLite only enforces foreign keys when `PRAGMA foreign_keys = ON`, and this codebase never
   sets it** — there is not one occurrence of the pragma, or of `REFERENCES`, anywhere in `src/`
   or `native-engine/`. A declared FK would be decorative: it would read as a guarantee and
   enforce nothing. Turning the pragma on globally to make it real is a behaviour change across
   every table in the database, on a connection shared by the sync engine, and is not on the
   table for this feature.
2. **It would point our extension at OUROVEON's table.** The compatibility posture is that
   `Riffs` is theirs and we do not constrain it. An enforced FK means a write to `Riffs` can fail
   because of a row in *our* table.
3. **A dangling row is harmless.** Every read is driven *from* `Riffs` — the side table is only
   ever joined against riffCIDs that already exist. An orphan is never read.

So deletion is explicit instead, wherever a `Riffs` row is deleted: `forgetDiscoveredRifff` and
`deleteJamRows`. That is two call sites, both of which have to be touched for the stem-GC
question anyway.

### Gains ride along for free, and must not be "fixed"

`writeRiffDetail` builds `GainsJSON` as `gains[String(stem.slot)] = stem.gain` for **every** stem
in the riff, and `buildResolvedRiff` reads `gains[String(slot)]`. Both are already slot-keyed and
neither is bounded by eight. A twelve-stem group's gains for slots 9-12 persist today with no
change at all.

This is a happy accident, and it is worth a comment in the code so nobody later "tidies"
`GainsJSON` to eight keys. An older build reading that JSON simply ignores the keys it has no
slots for, which is the correct behaviour and is also the downgrade story below.

---

## The constraint that must not break: an external LORE warehouse

An external archive has no `RiffStemsExtra` and **cannot be given one** — sssketch opens those
`readonly: true` (`riffLibraryStore.ts:151-166`) and that is a promise, not an implementation
detail. Every read path must tolerate the table's absence and yield ≤8-stem rifffs there.

**Absence must not be an error path bolted on afterwards.** It is the normal state of most
databases this app opens.

### How absence is detected

By asking the schema:

```ts
db.prepare(`PRAGMA table_info(RiffStemsExtra)`).all().length > 0
```

This is the exact idiom `riffLibrarySchema.ts` already uses twice
(`ensureDiscoverRiffIndexCacheHasCreationTime`, `ensureStemCategoriesHasSubcategoryNote`), whose
own comments call it "cheap: one PRAGMA query". It is a lookup against the connection's in-memory
schema; it is called **once per read operation** — once per `listRiffs` page, once per
`resolveRiff`, once per full index scan — never once per riff and never once per stem.

**Two plausible detectors were considered and are both wrong here:**

- **`Database#readonly`.** Tempting, and it fails in the *default* configuration.
  `getRiffLibraryDb()` opens whatever root is configured with `readonly: true`, and the default
  configured root **is sssketch's own library** (`riffLibraryRootPath()` falls back to
  `ownRiffLibraryRoot()`). So on a normal install the own warehouse is open twice — writable via
  `openOwnRiffLibraryDb()` and read-only via `getRiffLibraryDb()` — and a `readonly` check would
  classify the second handle as external and hide slots 9-20 from browse for everyone who has
  never touched the folder picker. That is the whole user base except Elling.
- **Comparing `db.name` to `ownRiffLibraryDbPath()`.** Workable — `db.name` is already this
  codebase's stable identity for a connection (`sourceDbKey`) — but it answers a different
  question. It asks "which file is this", when what the reader needs to know is "does this
  database carry the extension". Those come apart on an own warehouse that predates the
  migration, and they drag in symlink and case-folding pitfalls for nothing.

### How absence is handled

One module, `src/main/riffStemsExtra.ts`, owns the table. Two readers, and both return the same
type whether the table is there or not:

```ts
readExtraStemSlots(db, riffCIDs: string[]): Map<string, ExtraSlot[]>   // batched by riffCID
readAllExtraStemSlots(db): Map<string, ExtraSlot[]>                     // whole table, for full scans
```

Absent table → **empty map**. That is the only place the `if` exists. No caller branches on it,
no caller can forget it, and the ≤8 behaviour on an external archive falls out of the same code
path as everything else rather than being a special case someone has to remember to write.

`readAllExtraStemSlots` exists because three readers (`discoverCandidates.ts`'s `buildRiffIndex`,
`discoverLibraryStems.ts`, `scanTargetCache.ts`) walk the *entire* `Riffs` table in pages. Those
must read the side table **once per database connection** and hold it as a map — not re-query per
page and certainly not per riff. Jams share one database; per-jam loop-requerying is the pattern
that caused two real bugs in one day and it is called out in CLAUDE.md. For an external archive
this read is free: the table is not there.

Both use `.all()`. Never `.iterate()` — that rule exists because `.iterate()` across an `await`
caused a real live crash, and `buildRiffIndex` is `async` and yields to the event loop inside its
page loop.

---

## The ceiling: twenty, in one place

```ts
// src/shared/riffStemSlots.ts
export const LORE_STEM_COLUMN_COUNT = 8   // Riffs.StemCID_1..8 -- OUROVEON's shape, not ours to change
export const MAX_RIFFF_STEM_SLOTS = 20    // sssketch's own ceiling: the 8 columns plus 12 side rows
```

`MAX_RIFFF_STEM_SLOTS` replaces the hardcoded 8 **only where 8 was really the storage limit**:

- `MAX_STEMS_PER_RIFFF` (`discoverRifffAssembly.ts:36`) becomes `MAX_RIFFF_STEM_SLOTS`. Its own
  doc comment already says why it is 8 — *"Real-Rifff.stems can only ever address 8 slots
  (StemCID_1..8 is the schema…)"* — so raising the storage limit raises this by its own stated
  reasoning. **This one change alone fixes `keep`**, because `resolveDiscoverRifff()` takes the
  default.
- `MAX_SEED_SLOTS` (`discoverSeed.ts:34`) becomes `MAX_RIFFF_STEM_SLOTS`, by the same chain. Left
  at 8, seeding Discover from a twelve-stem kept group would drop slots 9-12 on the way back in,
  breaking the round trip — `seed discover with this` on a kept group is, per the discovered-library
  spec, "probably the nicest thing about the whole feature."

`LORE_STEM_COLUMN_COUNT` replaces the literal `8` in the six places that enumerate the *columns*
(`STEM_SLOT_COLUMNS` is currently defined twice and inlined as a SQL string four more times). It
stays 8 forever. The point of naming it is that a future reader can tell at a glance which of the
two numbers they are looking at.

**Where the ceiling is enforced:** in main, in `saveDiscoveredRifff`, not in the renderer. The
ceiling is a database fact and it belongs on the side of the IPC that owns the database. The
renderer's cap being raised is what lets the stems *arrive*; main truncating at
`MAX_RIFFF_STEM_SLOTS` is what guarantees nothing can ever be written that a reader could not
read back.

---

## Migration, and what a downgrade does

**Migration is `CREATE TABLE IF NOT EXISTS` in `SCHEMA_SQL`, and nothing else.** No `ALTER`, no
backfill, no drop, no version flag. `openOwnRiffLibraryDb()` re-runs the whole DDL on every open
as a cheap no-op; an existing warehouse simply gains an empty table on next launch. Every rifff
in it has ≤8 stems, so there is nothing to backfill — the empty table is already the correct
state.

This is deliberately *not* either of the two special-cased migrations already in that file.
`ensureDiscoverRiffIndexCacheHasCreationTime` drops and rebuilds because `CREATE TABLE IF NOT
EXISTS` cannot add a column to an existing table; `ensureStemCategoriesHasSubcategoryNote` does a
real `ALTER TABLE` because that table holds irreplaceable data. Neither applies to adding a whole
new table. If a future change needs a *column* on `RiffStemsExtra`, those two are the precedents
to copy.

### Downgrade: an older build opening a database that has the table

It sees eight-stem rifffs. A twelve-stem kept group renders and plays as its first eight stems.
**Nothing is corrupted**, and this is worth stating precisely rather than hand-waving:

- The old build never drops a table it does not know about. The rows sit there untouched.
- The old build's `GainsJSON` reads ignore keys 9-12 (`gains[String(slot)]` is only ever asked
  for slots it knows). Its writes would rebuild `GainsJSON` from the eight stems it can see.
- Re-upgrading restores all twenty. The side rows were never touched, and the `Riffs` row's first
  eight columns are the same eight stems either way.

Two real consequences, both accepted:

1. **`forget this` on an old build orphans the side rows.** It deletes the `Riffs` row and knows
   nothing about `RiffStemsExtra`. The orphans are never read (every join is driven from `Riffs`)
   and can only be resurrected by a riffCID collision, which cannot happen — kept groups are
   `discovered-<randomUUID()>`. They are dead bytes, a few dozen at worst.
2. **The duplicate check gets weaker on an old build.** Identity is the *set* of StemCIDs
   (`discoveredGroupKey`), read via `listDiscoveredGroups`. An old build sees only eight of a
   twelve-stem group's CIDs, so keeping the same twelve again writes a second row instead of
   saying `already kept`. Annoying, not damaging, and only while downgraded.

There is no scenario where an old build *rewrites* a >8-stem riff and leaves the side rows
pointing at a different set of stems. `writeRiffDetail` is only reached from the sync engine
(which never touches the `discovered` room — it is not a synced jam) and from `saveDiscoveredRifff`
(which always mints a fresh riffCID; it never upserts an existing group). That is the one
genuinely dangerous downgrade shape and it is closed by construction, not by luck.

---

## Every read path, and whether it widens

Found by enumerating every reader of `StemCID_1..8`. This is the list; there is nothing else.

| path | widen? | why |
|---|---|---|
| `riffLibraryStore.ts:513` `buildResolvedRiff` | **yes** | the one that matters. Feeds preview, import-to-shelf, add-to-timeline, both exports. Without it a kept twelve is an eight everywhere downstream |
| `riffLibraryStore.ts:404,421` `listRiffs` | **yes** | `stemCount` / `cachedStemCount` drive the browse circle's hover title and the `onlyFullyCached` filter. "12 BPM · 8 stems" is a lie, and `onlyFullyCached` would pass a group whose stems 9-12 are missing from disk |
| `discoveredLibrary.ts:72` `listDiscoveredGroups` | **yes, and it is the dangerous one** | powers both the duplicate check *and* `forget this`'s "is this copy still needed by another group" test. Left at eight, forgetting group A deletes the copied files for stems 9-12 that group B still uses — a permanently uncached circle with no way back |
| `riffLibraryWriter.ts:98` `writeRiffDetail` | **yes (write)** | splits at `LORE_STEM_COLUMN_COUNT`: first eight to columns, the rest to the side table, same transaction. Delete-then-insert the riff's extra rows so an upsert that *shrinks* a rifff cannot leave stale ones |
| `riffLibraryWriter.ts:211-256` `deleteJamRows` | **yes** | its own comment calls the slot columns *"the actual source of truth for is this stem still needed by ANY jam"* (`:223`). That sentence stops being true the moment a stem can live only in slot 12. Both passes widen — collecting candidates, and the still-referenced check — and the jam's own extra rows are deleted with its `Riffs` rows |
| `scanTargetCache.ts:106` `slotsOf` | **yes** | a stem that only ever appears in slot 9+ would never be queued for analysis, so it would have no features, no peaks, no auto-category. `Slot` is stored in `DiscoverScanTargetCache` and used only for the earliest-position tiebreak (`isEarlier`), which stays correct with 9-20 |
| `discoverCandidates.ts:459` `buildRiffIndex` | **yes** | maps stemCID → its representative riff. A stem only in slot 9+ is invisible to Discover's own rolls, so a stem he found via Discover could never come back around |
| `discoverLibraryStems.ts:186` | **yes** | the library-wide stem walk behind Tidy Up and the classify scan. Same invisibility |
| `discoverCandidates.ts:1896-1903` `getRandomLibraryCandidate`'s riff lookup | **yes** | an eight-way `StemCID_N = ?` `OR` chain answering "which riff contains this stem". No match means `continue`, so a stem living only in slot 9+ would be skipped every time it came up as a random candidate — silently, and only for kept groups |
| `riffLibraryStore.ts:626` `resolveRiffWithContext` | **no** | reads `RiffCID`/`OwnerJamCID`/`CreationTime` only. No stems |
| `riffLibrarySync.ts` | **no** | writes through `writeRiffDetail`. A synced Endlesss riff is eight stems by definition; it will never produce a ninth |
| `endlesssApi.ts` | **no** | builds a resolved riff from the live Endlesss API. Same reason |
| `importResolvedRiff.ts` `buildImportedRifff` | **no change needed** | no numeric cap anywhere in it; it maps `resolved.stems` and keys by slot. Works at twenty unchanged, once `buildResolvedRiff` hands it twenty |
| **`src/shared/buildRifff.ts`** | **not on this path at all** | asked about specifically, so: it builds a `Rifff` from a scanned folder of `.wav` files (drag-and-drop of an Endlesss stem-folder export, via `importRifff.ts`). It never touches SQLite and never sees library data. Its slot dedupe at `:76-86` is about two *filenames* claiming the same slot, and its "slot is a de facto primary key" comment is the best statement of that rule in the codebase — it is the justification for this side table's primary key, not a thing this change edits. **Leave it alone.** A real Endlesss folder export is eight files |

### One page-size arithmetic note that has to be checked, not assumed

`listRiffs`' `RIFF_PAGE_SIZE = 1000` carries a comment justifying its batched creator lookup:
*"worst case one page's rows reference up to 8 distinct StemCIDs each, i.e. 8000 placeholders …
comfortably under the limit"* (SQLite's 32766). At twenty that worst case becomes 20,000. Still
legal, no longer comfortable, and the comment becomes false. Chunk that `IN (…)` at 900 and fix
the comment. Same for the new batched side-table read.

---

## What a twenty-stem rifff means everywhere else

A real Endlesss rifff is eight stems. Twenty is sssketch's own extension, and it will show.

- **Browse.** The hover title reads `120 BPM · 12 stems (12 cached)` — the existing string, with
  a bigger number. `RiffCircle` is an 18px div whose fill is a *fraction*; it has no per-stem
  geometry and no eight in it.
- **The shelf and the arranger.** A rifff is N stem rows. `RifffBlockRow` computes its height as
  `NAME_BAR_HEIGHT + rifff.stems.length * ROW_HEIGHT` — nothing fixed, nothing to change. Twenty
  rows is a tall group and will need more scrolling than eight. That is the honest cost of what
  he asked for.
- **`PolarGlyph`, the one place it visibly degrades.** It divides a fixed `RING_BUDGET` of 3
  across `stems.length - 1` (`PolarGlyph.tsx:99-103`), so twenty concentric rings are drawn
  0.16 units apart instead of 0.43. Its own comment already says the design targets 8-16. It
  will not break — every ring stays inside the frame by construction — it will just read as
  mush at twenty. Not addressed here: it is a visual judgement, and it needs Elling's eyes, not
  a number.
- **Project save/load.** `projectFile.ts` is JSON in and out with no schema or slot validation,
  and `serialize.ts` keys stem records by `stemKey(groupId, slot)`. A twenty-stem rifff round
  trips intact.
- **Export.** `.als`, `.rpp` and the stems/mix exports all iterate `rifff.stems` unbounded and
  partition through `packIntoTracks`. Ableton's template holds one `AudioTrack` that is cloned
  per track, never an array indexed by slot; both exporters' only fixed array is the five
  `BUS_IDS`, which has nothing to do with stem count. Twenty tracks instead of eight.
- **The native engine.** `EngineProject::EngineRifff::stems` is a `std::vector<EngineStem>`
  (`native-engine/Source/EngineProject.h:180`), keyed by `stemKey(groupId, slot)`. No fixed-size
  array, no eight. **No native-engine change is needed anywhere in this design.**
- **Discover itself** already supports more than eight slots on screen — that is how he got a
  twelve-stack to lose stems in the first place.

---

## Considered and rejected

- **`StemCID_9 … StemCID_20` on `Riffs`.** Elling's call, and the right one. It is the smaller
  diff: every existing `for (slot = 1; slot <= 8)` becomes `<= 20` and there is no join, no
  absence check, no migration subtlety. It also breaks the one compatibility claim the README
  makes by name, adds twelve always-NULL columns to 372,297 rows, and makes every LORE-synced
  riff pay for a feature only the `discovered` room uses.
- **A JSON column on `Riffs` (`ExtraStemsJSON`).** Still changes `Riffs`. Not indexable by
  StemCID, so `deleteJamRows`' orphan check and `buildRiffIndex` would both have to parse every
  row's JSON. Strictly worse than the table for the same compatibility cost.
- **A separate `extras.db3` beside the warehouse.** Keeps `Riffs` untouched *and* lets an
  external archive have extras. It also means two files that can be separated, backed up apart,
  or get out of sync, plus an `ATTACH` on every read, for a case that cannot arise: extras only
  ever exist for the `discovered` room, which by design only ever lives in sssketch's own
  writable warehouse.
- **Slots 1-20 with the first eight duplicated.** Argued above.

---

## Testing

Pure logic in `src/shared/` is TDD'd, as ever:

- `splitStemSlots` / `mergeStemSlots` and the two constants — the whole 8-vs-20 arithmetic lives
  here precisely so it can be tested without a database.

Main-process seams, TDD'd against a real `better-sqlite3` database, no mocking of the `electron`
module beyond `app.getPath` where a module needs it — the established convention
(`stemCategoriesStore.test.ts`, `riffLibraryStore.test.ts`):

- the table's readers against a db that **has** the table, and against one that **does not** —
  the second is the external-LORE case and it is a first-class test, not an afterthought
- `writeRiffDetail` round-tripping twelve stems, and an upsert that shrinks twelve back to five
  leaving no stale rows
- `deleteJamRows` not deleting a `Stems` row that only slot 12 of another jam's riff references
- `listDiscoveredGroups` seeing all twelve, so the duplicate check and `forget this`'s file-GC
  are both right
- `buildResolvedRiff` and `listRiffs` returning twelve, and returning eight against a warehouse
  without the table

**A new main-process test file that opens `better-sqlite3` must be added to the CI exclusion list
in `vitest.config.ts`.** This design adds exactly one (`src/main/riffStemsExtra.test.ts`). A stale
exclusion list is not a tidiness issue: it silently broke every release for six weeks, and the
failure signature is a non-zero exit with *zero* failed tests named.

React components are not unit-tested in this codebase, and nothing here should claim otherwise.
No agent in this environment can click, scroll or hear the result. **These are Elling's alone to
verify:**

- that `keep` on a real twelve-stack saves twelve, and that the kept circle says `12 stems`
- that importing that group to the shelf brings back all twelve, with the gains he set
- that `seed discover with this` on a twenty-stem group returns twenty slots and not eight
- whether a twenty-row group in the arranger is usable or just tall — the one part of this whose
  answer is a matter of taste
- that exporting it to Ableton or REAPER produces twenty tracks that play
- that a **real external LORE archive still browses identically** after this lands. That is the
  compatibility promise, and it can only be checked against his real `warehouse.db3`

---

## Could not settle

- **Twenty specifically.** It is what he asked for and it is a round number. Nothing in the design
  depends on it — the constant moves, and only the constant — but the DDL's lower `CHECK` means
  *lowering* it below nine would be a real migration. Raising it is free.
- **Whether `discovered` groups should be visually distinguishable from real Endlesss rifffs in
  browse.** A twelve-stem circle looks exactly like an eight-stem one until you hover. He has not
  asked for a marker and the room they live in is already the distinction, but the moment a group
  with twenty stems sits next to a jam's real eights, "is this an Endlesss rifff or one of mine"
  becomes a question the UI does not currently answer.
- **What a >8-stem group means if sssketch ever pushes back to Endlesss.** It cannot be
  represented there. Nothing in the app does this today and nothing plans to, but the answer would
  have to be "the first eight", and that is worth knowing before anyone builds an upload.
- **Whether the phone page wants twenty rows.** It renders one row per Discover slot and already
  scrolls. Twenty rows at arm's length in a dark room is a real question and it is not one this
  spec can answer from a terminal.

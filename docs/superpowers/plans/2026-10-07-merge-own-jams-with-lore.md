# Merge sssketch's own jams with the LORE library: Plan

**Asked by Elling (2026-10-07):** when the library root is the USB LORE archive, the jams sssketch
synced itself are invisible. Group them with the LORE library so Discover, radio, the library
browser and the background passes use both.

**Commits:** `git commit --only <paths>`. Every message ends with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

## Today (measured read-only, 2026-10-07)

Archive `/Volumes/Elling-Lien/ENDLESSS/cache/common/warehouse.db3` (5,056 Jams rows, 85 with riffs),
own db `~/Music/sssketch/library/cache/common/warehouse.db3`, both opened `mode=ro`.

The own db has 40 jams: 2 `shared:` feeds, `discovered`, and 37 regular jams. All 37 have a Jams row
in the archive too (LORE knows their names), but:

| | jams | riffs | stems | stems also in the archive (by StemCID) |
|---|---|---|---|---|
| own jams the archive has **no riffs** for | 17 (16 with riffs) | 21,673 | 20,051 | 1 |
| own jams the archive **has riffs** for | 20 | 58,208 | 56,544 | all but 97 |

- The 20 shared jams: the own copy is (almost) a subset of the archive's, e.g. "Remix Inspo:
  Elling" 4,537 own riffs against 4,544. 97 stems exist only in the own copy, in 4 jams:
  Minimalistic Techno #2 (85), Aethereal Forest (6), elling (3), Notes from the Sky (3). No riff of
  the 17 is in the archive (RiffCID).
- Of the 20,051 stems in the 17 jams: 1,765 are analysed (features v2, peaks, embedding), and none
  has the level pass. That is the "1,761 stems" the level backfill can't reach (the count moved by a
  few since). 15,692 of the 20,051 have audio in the dev app's `endlesss-cache` (4,395 in the
  packaged app's).
- The Shared Feed already overlaps the archive: 4,869 of its 5,163 stems are archive stems.

## How jams are routed now (riffLibraryStore.ts)

- **Library root** (`riffLibraryPrefs.json`, `riffLibraryRootPath()`): the own root, or an external
  LORE folder. Dev points at the USB archive.
- **`dbForJam(jamCID)`**: `shared:*` and `discovered` → own db; everything else → the configured
  root's db. With the archive as root, the 37 regular own jams resolve to the archive.
- **`listJams`**: the configured db's jams, plus (root external) the own db's `shared:*` and
  `discovered` rows only. The 17 own-only jams show as the archive's empty name-only stubs.
- **`listJamsWithDb`**: `listJams('')` mapped through `dbForJam`, cached against the Jams and Riffs
  signals of every source db (the archive, plus the own db when the root is external). This is the
  jam list of Discover, radio, the library scan work list, "discover this rifff" and the artist
  picker's db set.
- **`candidateDbsForRiff()`**: `[archive, own]` (root external) or `[own]`. Used where there is no
  jamCID: resolveRiff, the category/feature/peaks stores' StemCID checks, stemPriority, the
  classifier, the backfills. It already contains the own db.
- **`resolveStemPath(jamCID, stemCID)`**: `discovered` → own root's stem_v2; `shared:*` or own root →
  `<userData>/endlesss-cache/stems/<c>/<StemCID>`; otherwise `<root>/cache/common/stem_v2/<jam>/<c>/<StemCID>`.
  A stem of an own-synced jam therefore resolves to a LORE folder that doesn't hold it.

## Design

### One routing rule, per jam

With the root external, an own regular jam (not `shared:`, not `discovered`) that has at least one
riff in the own db and **no riff in the archive** is an **own-routed jam**:

- `dbForJam` → the own db;
- `resolveStemPath` → the own content-addressed cache (`endlesss-cache`), as for `shared:`.

Every other jam routes as today. So for a jam both dbs have riffs for, **the archive wins** whole:
its riffs, its stems, its stem_v2 paths. The own copy of that jam is ignored, as today.

Why per jam and not per riff/stem: every consumer filters by `(db, allowed jam set)`, so a jam that
lives in exactly one db needs no change in any of them. Splitting a jam across both dbs would need
stem-level dedupe in every pool and two path rules for one jam. The cost is the 97 own-only stems in
4 shared jams (0.5% of what this adds); they stay out, as today. Noted for Elling below.

The rule is computed from small reads: the own db's Jams rows (40) with an `EXISTS` riff seek each
(`idx_riffs_owner_created`), then one `EXISTS` seek per candidate on the archive's `Riff_IndexOwner`
covering index. No scan of the archive.

It is memoised for `resolveStemPath` (called once per stem in the scan work list, the
`cachedRiffLibraryRoot` lesson): a Set lookup on the hot path. The memo is dropped when
- `listJamsWithDb` rebuilds (its Jams/Riffs signals moved in either db: a LORE sync gave one of
  these jams riffs, or sssketch synced a new jam),
- the root changes or the archive connection closes or opens (`closeRiffLibraryDb`, `getRiffLibraryDb`),
- the own db connection is a different one (tests reopen it),
- it was computed while the archive was unreachable or a seek threw, after 30 s.

### Dedupe: same jam, riff or stem in both

- **Jam**: by JamCID. The archive wins when it has riffs for it (above).
- **Riff**: by RiffCID. Only arises inside shared jams, which are archive-routed, so the own copy is
  never listed. `resolveRiff`/`resolveRiffWithContext` already look in the archive first.
- **Stem**: by StemCID, the archive wins. Own-routed jams bring 1 stem the archive also has; the
  Shared Feed already brings 4,869. Consumers that take the first db's copy (the mask pool, the
  library scan work list's "a stem with an allowed pair in an earlier db is that db's", "discover
  this rifff") get the archive's because **`listJamsWithDb` now lists the archive's pairs first**
  (then the own db's, each in listJams' order), so every `jamCIDsByDb` map and `uniqueDbs` set
  starts with the archive. The trait pool keeps the **first** db's row per StemCID (it kept the last).
  The mask pool skips a StemCID it already emitted from an earlier db.
- **Paths**: an archive-routed stem keeps its stem_v2 path, an own-routed one its endlesss-cache
  path. The analysis caches are keyed by StemCID (`stemCIDForPath` is the basename), so a jam that
  later flips (LORE syncs one of the 17) keeps its analysis; only the path changes.

### Indexes across both dbs (verify, no change expected)

All are per db and table-wide, filtered later by `(db, allowed jams)` ("jams share one db"):
- **riff index / instrument rows** (discoverCandidates.ts, saved in DiscoverRiffIndexCache /
  DiscoverInstrumentRowsCache by SourceDbKey): the own db is already a prewarm db (the Shared Feed's),
  so its index already holds the 17 jams' rows. Nothing new is walked.
- **Stems walk + artist pairs** (stemsTableWalk.ts, discoverArtistIndex.ts): per db, by dbs, not
  jams: they already count the own db's rows.
- **scan-target pairs** (scanTargetCache.ts): per db, persisted; filtered by allowed jams in
  libraryScanWork.ts.
- **own index** (ownStemIndex.ts) and **stemPriority**: per db / `candidateDbsForRiff`, which already
  includes the own db.
Verified by a test that an own-routed jam's stems roll from the own db's index with no extra walk.

### Library browser jam list

`listJams` with the root external: the archive's rows, minus the stub row of each own-routed jam,
plus the own db's rows for own-routed jams, `shared:*` and `discovered`, sorted by last riff. One row
per JamCID. `listRiffs(jamCID)` follows `dbForJam`, so the grid reads the own db's riffs, and
cachedStemCount looks in `endlesss-cache`. Authorship counts come from the row's own db (as for the
Shared Feed today).

### Background passes

All go through `listJamsWithDb` (library scan work list → DiscoverLibraryScan: analysis, then the
level backfill) or `candidateDbsForRiff` + `resolveStemPath(row.OwnerJamCID, …)` (tidy up, the
instrument-mask centroid backfill, radio hearts import, adjacency). With the routing above they see
the 17 jams' stems at the right paths. No pass changes.

### Level backfill

The work list's rework step (stemCIDsNeedingRework) already asks for the level pass on any listed
stem with current features and no level. The 1,765 analysed stems become listed, so they get
measured; the rest (with audio on disk) get the full analysis first. Stems with no audio file drop
out at the existence step, as today.

### Performance

- No new walk of the archive: the routing is ≤ 40 index seeks, at most once per `listJamsWithDb`
  rebuild. The own db was already walked.
- The work list grows by the 17 jams' pairs (own db, SSD).
- `resolveStemPath` adds one root comparison and one Set lookup per call.

### Only LORE, only the own db, both

- **Only the own db** (root = own root): unchanged. Every jam is the own db's.
- **Only LORE** (root external, nothing synced by sssketch): no own-routed jams; unchanged.
- **Both**: as above.
- **Root external, archive unreachable** (drive unplugged): `listJams` lists no archive rows (as
  today), so every own regular jam with riffs is own-routed and listed (their data is all local).
  When the drive returns, the routing is recomputed and the shared jams go back to the archive.

## Tests (TDD, red first; riffLibraryStore.test.ts is a DB test, already on the CI exclude list)

riffLibraryStore.test.ts, root external, own db with an own-only jam, a shared jam (riffs in both),
a `shared:` feed:
1. `listJams` lists the own-only jam once, from the own db (its lastRiffTime), not the archive stub;
   the shared jam once, from the archive.
2. `listJamsWithDb` routes the own-only jam to the own db, the shared jam to the archive, and lists
   the archive's pairs first.
3. `listRiffs(ownOnlyJam)` returns the own db's riffs; `resolveStemPath(ownOnlyJam, s)` is the
   endlesss-cache path; the shared jam keeps stem_v2.
4. `resolveRiff` of an own-only riff resolves its stems to endlesss-cache paths.
5. A LORE sync that gives the own-only jam riffs flips it to the archive after the change check.
6. Archive unreachable: own jams are listed from the own db.
7. Root = own root: unchanged.
discoverCandidates.test.ts: a mask roll and a trait roll over `[archive pairs, own pairs]` with a
StemCID in both return it once, from the archive.

Checks: typecheck, lint on touched files, the DB tests locally, `CI=1 npx vitest run`.

## For Elling to check after a relaunch

- The library browser lists the 17 jams (e.g. "TC 24 Hour Jammageddon", "GRINDCORE", "Amen Breaks R
  Us") with their riffs, once each.
- The bottom-right line shows "analysing stems" picking up ~18k new stems, then the level pass for
  the 1,765.
- Discover and radio can draw stems from those jams.
- Not done: the 97 own-only stems inside 4 jams LORE also has.

## As built (2026-10-07)

Changes from the plan above:
- **16 jams, not 17.** The rule needs a riff in the own db; "ellingelling" has none, so it stays the
  archive's stub row.
- **The mask pool needed no change.** getDiscoverCandidatesPool's merge already keeps the first
  candidate per StemCID, and the archive's pairs now come first. Only the trait pool changed (it
  kept the last db's row).
- `listJams` checks the own db's Jams/Riffs signals before reusing the routing, so a jam sssketch
  syncs while the root is external shows up in the browser without waiting for a roll.

Measured on a scratch clone of his own db (`VACUUM INTO`, 2026-10-07) against the USB archive,
read-only; the dev app's stem cache read through a symlink:

| | before | after |
|---|---|---|
| jams listed (browser) | 5,058 rows | 5,058 rows, 5,058 distinct (16 stubs replaced by own rows) |
| pairs routed to the own db | 2 (Shared Feed, discovered) | 18, listed after the archive's |
| library scan work list | 236 stems | 15,871 stems: +15,635 from the 16 jams (1,667 need only the level pass, 13,968 the full analysis) |
| placeholders skipped | 607 | 607 |
| work list build (warm) | | 4.5 s |

- The routing itself: 4 ms for the own db's 36 candidates, 25 ms for the 36 archive seeks the first
  time, under 1 ms after. No archive walk. (The archive's own jam-list query, unchanged, takes 4.0 s
  on a fresh connection and 112 ms after.)
- `resolveStemPath` over all 81,902 own-db stems: 153-162 ms, 25,214 to the own cache (the 16 jams
  plus the Shared Feed and discovered).
- 15,635 of the 20,051 stems have audio in the dev app's cache; the rest drop out at the existence
  step, as any stem without audio does.

Tests: riffLibraryStore.test.ts (8 new, root external + archive unreachable + own root),
discoverCandidates.test.ts (a stem in both rolls once from the archive, mask and trait; an own jam
rolls from the own db's existing indexes with no walk).

### Review fixes (2026-10-07, review of b859757c and dc07ec69)

Corrections to the claims above:

- **"Archive unreachable … when the drive returns, the routing is recomputed and the shared jams go
  back to the archive"** was only half true. The routing did come back, but `listJamsWithDb`
  didn't. With the drive away at launch, its cache had only the own db as a source, so no signal
  moved, and it kept routing the archive's jams to the own db while `resolveStemPath` sent their
  stems to stem_v2. Fixed:
  - `getRiffLibraryDb`'s open branch drops the jam list as well as the routing.
  - The jam list remembers the archive connection it was built with. It calls `getRiffLibraryDb`
    first, so a file that has come back (or gone) rebuilds the list on the next call.
  - Test: the reviewer's replug repro, ported.
- **"the archive connection closes"**: before this fix nothing closed it when the drive was unplugged
  mid-session, and a dead handle was never reopened. Now:
  - `getRiffLibraryDb` checks an open external archive's file at most once a second. If the file is
    gone, it closes the connection and drops the caches, and the routing flips to the own db. When
    the file is back, it opens a new connection.
  - A read that fails with `SQLITE_IOERR*`/`SQLITE_CANTOPEN` closes the connection where the failure
    is noticed: the routing's archive seeks, or a jam-list rebuild. The read is then retried once
    through a new connection. This covers a drive that is pulled and pushed back in within a
    second.
  - Not covered: other modules' reads through a dead handle (the Discover walks, the stores'
    StemCID checks) still just fail and log. A fresh connection only replaces the dead one once one
    of the paths above notices. The Discover caches keyed by the old connection rebuild on demand
    for the new one, and the archive's row counts are not re-seeded on the worker for it.
- **"`listJams` checks the own db's Jams/Riffs signals"**: `resolveStemPath` didn't, so a jam
  sssketch synced while the root was external got stem_v2 paths until the next jam-list rebuild. Now
  the routing checks the own db's Jams/Riffs on every call:
  - this process's own writes (`tableWriteVersion`) at once, at no cost;
  - another connection's writes at the change check's pace.

  Jams/Riffs, not Stems: those are the tables the rule reads.
- **Artist picker counts** (`getArtistIndex`) summed the dbs, so a stem in both was counted twice:
  the own db's rows of jams the archive has, plus the Shared Feed's archive stems. On his data, 81,902
  own-db stems were counted where 20,345 are not in the archive. Each db after the first now counts
  only stems no earlier db has (`readArtistCountsAfter`), using the routing rule:
  - a real jam the archive has stems for is the archive's, whole;
  - a Shared Feed or kept-group stem is looked up by StemCID.

  Measured: 48-56 ms warm, 1.2-2.0 s with the archive's pages cold. Looking up every stem instead
  took 3.2 s warm and 8.3 s cold. The result is off from an exact union by the 97 own-only stems
  (which Discover also leaves out) and 1 stem.
- **Radio hearts** looked stems up in the own db first. They now use the archive-first order
  (`heartLookupDbs`), like every other reader.
- **Loading ETA** (dc07ec69): an extension walk reporting during a load restarted the single rate on
  every alternation, and the status line flipped between "loading" and "indexing". Fixed:
  - The rate is now kept per key.
  - `createLibraryProgressView` keeps the line on a load in progress until the load reaches its
    total or has been quiet for 5 s.

# Faster Startup: Spec and Plan

**Approved by Elling (2026-10-06):**
1. Open the startup screen as soon as the saved copies are loaded, and extend them in the background.
2. On a full rebuild, first build an own-only index from his own stems and riffs (the archive's
   creator/username indexes), so "only my stems" can roll before the full walk finishes.

**Added by the coordinator (same day):** the first `COUNT(*)` of the archive's Stems/Riffs blocks the
main process for 1.7-2.3 s once per launch. Cover it here.

**Commits:** `git commit --only <paths>`, never `git add -A`. Another agent owns `radioGuide.ts`,
`RadioGuide.tsx`, `RadioTopLine.tsx` and the web guide. Every message ends with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

## Today (measured read-only, 2026-10-06)

`StartupGate.tsx` stays up until `prewarmDiscoverCandidateCaches` has finished both indexes for both
dbs (the USB archive, 900,041 riffs / 891,062 stems, and the own db, 80,826 / 81,902). Usable = complete.

Measured with the real prewarm in a scratch harness: the external archive opened read-only, against a
`VACUUM INTO` snapshot of his ownDb (scratch only; his LORE archive and his caches untouched):

| Case | Time to usable (= complete) | Longest main-thread block |
|---|---|---|
| warm (saved copies current) | 4.4 s | 1,695 ms |
| extend (a sync of 20,000 riffs + 20,000 stems) | 10.6 s | 2,950 ms |
| full rebuild (no saved copies) | 148 s | 1,746 ms |

Where the time and the blocks go:
- **Loading a saved copy**: 891k riff-index rows 3.8 s cold, 891k instrument rows 3.1 s cold. Pages
  of 5,000 rows block up to 430 ms cold. Pages of 2,000 rows: at most 86 ms.
- **`loadCachedRiffIndex`/`loadCachedInstrumentRows` each start with `COUNT(*) ... WHERE SourceDbKey = ?`**,
  only for the progress total: 1.26 s and 0.91 s cold, one statement each.
- **The archive's first `COUNT(*)` per table** (`readTableSignal`): 1.7-2.3 s cold.
- **Full rebuild**: resetting the old copy (900k deletes, chunked) ~10 s; the riff walk + saves ~82 s;
  the Stems walk + saves ~53 s; the own db ~3 s.

Own stems on the archive ('elling'), read-only:
- `Stems WHERE CreatorUserName = ?` in rowid pages (Stems_IndexUser): 68,251 rows in 3.0 s. A
  2,000-row page blocks up to 133 ms, so pages are 1,000 rows.
- `Riffs WHERE UserName = ?` (Riff_IndexUser): 78,342 riffs in 3.8 s, up to 151 ms per 2,000 rows.
- They put 68,172 of his 68,251 stems in a riff (79 appear only in other people's riffs). For 62,714
  of them, it's the same riff the full index picks (smallest RiffCID). For 5,458, it's another riff
  that also holds the stem.
- His 85 jams are the archive's 85 jams, so "riffs in his jams" is every riff: the UserName index is
  the only cheap way in.
- The own db has no username indexes, and its Riffs.UserName is empty on 98% of rows. There, the own
  index walks every riff (80k rows, SSD), keeping only his stems.

## What gates what

Two indexes per source db: the **riff index** (StemCID → its riff) and the **instrument rows**
(StemCID, Instrument, OwnerJamCID). Each is in one of four states:

| State | When | What it serves |
|---|---|---|
| complete | current, or finished | everything |
| extending | a saved copy loaded, the walk past its watermark running (also a current copy re-reading its open riffs) | everything, from the loaded copy |
| own | the saved copy had to be rebuilt; own-only index built | only rolls restricted to that user's own stems |
| none | rebuild, own index not ready or no username | nothing: callers wait for complete |

| Feature | Needs | While extending | While rebuilding (own index served) |
|---|---|---|---|
| Discover roll, mask kinds (drums/bass/lead) | instrument rows + riff index | loaded copy | "only my stems": own index. All stems: waits for the full walk (today's behaviour, but with the app open). |
| Discover roll, trait kinds | riff index (and the trait value table, separate) | loaded copy | same as above |
| random stem, all stems | instrument rows + riff index | loaded copy | waits |
| random stem, "only my stems" | SQL only | unchanged | unchanged |
| radio (it rolls through get-discover-candidates) | same as Discover | loaded copy | own stems if the radio is on "only my stems", else waits |
| "discover this rifff" (findRiffForStemPath) | riff index | loaded copy; a stem it lacks waits for complete before saying "not found" | waits (own index never answers a point lookup) |
| artist mode for another artist | riff index + rows | loaded copy | waits |
| classifier masks (getInstrumentMaskLookup) | complete rows only | SQL fallback, as today | SQL fallback |
| artist picker counts / jammed with | its own pairs cache | unchanged (it already says pending) | unchanged |

**Who counts as "own"?** A roll may use the own index when every stem it can draw belongs to the
index's user: the IPC handler passes `ownStemsOf` = the artist (artist mode) or, with "only my
stems", the target user. The pools still drop anything the riff index lacks, so even the
unrestricted fallback (79c477a2) only ever offers his stems.

**The username** is the one the renderer resolves (`resolveRiffLibraryUsername`: typed, else the
Endlesss session). The renderer reports it at mount, before anything else. Main keeps the last one in
`ownUsername.json` (userData), so a rebuild at the very start of a launch knows it before the
renderer has spoken. No username, ever: no own stage, so rebuilds behave as today.

## Stale-while-extending stays correct

- **No deleted stems.** A saved copy is only served when the shared rule (`canExtendByRowid`) says
  extend. The rule refuses whenever a row at or below the watermark was deleted (cached count +
  rows past the watermark must equal the live count), so the copy is a subset of the live table.
  Every other case rebuilds, and its old copy is never served.
- **During the walk**, the riff index map only gains entries, or moves one to a riff with a smaller
  RiffCID. Both riffs hold the stem. A roll that awaits mid-loop never sees an entry disappear.
- **The instrument rows** are swapped as a new array at the end (`withWalkedRows`), so the kind index
  sees the new identity and rebuilds once, as it does today.
- **The own index** is read live from the table, so it holds no deleted stems. It is never persisted.
  It's replaced (dropped from memory) the moment the full index is installed.
- **After the swap**: a candidate already in a slot keeps its riff. A later roll may name the other
  riff (5,458 stems on his archive): both hold the stem.
- **Forget** (`dropInMemoryRiffIndex`) also drops any served copy, as it drops the cache.

## The archive counts (coordinator's finding)

`canExtendByRowid` needs a live count, so the count stays. Two changes make it cheap:
1. **Skip it when the file hasn't changed.** After each count, save it in ownDb
   (`SourceTableCountCache`) with the file's fingerprint: the SQLite header's file-change counter
   (bumped by every commit in rollback mode, his archive's mode), the db size and mtime, and the -wal
   size and mtime if one exists. At startup, before any reader, if the fingerprint and MAX(rowid)
   match, the saved count primes `readTableSignal`'s memo (`primeTableCount`), so no COUNT runs.
   Most launches don't follow a sync.
2. **Count in slices when it has.** 256 StemCID/RiffCID key ranges (`< '01'`, `'01'..'02'`, ...
   `>= 'ff'`: every key is in exactly one range, whatever its shape), each a covering-index range
   count, with a yield between. Measured: Stems 6.5 s total, the longest slice 106 ms; Riffs 5.5 s,
   42 ms. 4,096 ranges keep slices around 10-30 ms. The fingerprint is read before and after: if it
   moved, the slices may straddle a commit, so it counts again (twice at most, then it leaves the
   memo alone and `readTableSignal` counts as before).

Only read-only connections (the archive) take this path. The own db's counts are a few ms on SSD.

## Startup, new shape

`prewarmDiscoverCandidateCaches(jams, ownDb, onProgress, { ownUsername, onUsable })`:
1. Seed the archive counts (above).
2. **Usable phase**, per db: decide current/extend/rebuild per index.
   - Current or extend: load the saved copy (2,000-row pages, no COUNT; the progress total comes
     from the meta) and serve it (complete, or extending).
   - Rebuild: build the own index for the username (if any) and serve it.
   Then `onUsable()`: main sends `library-index-usable`, and StartupGate closes.
3. **Complete phase**, per db: extension walks, or reset + full walk (as today, page by page,
   persisted), then install the complete index and drop the served copy. Then
   `library-warmup-complete`, as today.
4. `prewarmTraitQuantileTables` starts at usable, not at complete.

## The indicator

- StartupGate: "starting engine…", then "indexing riffs/stems: n / m" while loading, then "indexing
  your stems" while the own index builds. It closes at usable.
- BackgroundWorkIndicator (bottom right) keeps "indexing library · n of m" until complete. While the
  own index is what's served, it adds "your stems ready".

## Tests (TDD, red first)

- `tableCountSeed.test.ts` (new, DB, **CI exclude**): an unchanged file primes the count and runs no
  COUNT (countWork); a changed file counts in slices and saves; a sliced count equals COUNT(*) for
  keys of any shape; a commit during the slices recounts; a read-write connection is left alone.
- `tableChangeSignal` (existing SQL test): `primeTableCount` is reused until the head moves.
- `discoverIndexCache.test.ts`: the loads issue no COUNT and report the total they're given.
- `ownStemIndex.test.ts` (new, DB, **CI exclude**): the own index holds exactly the user's stems
  that a riff of theirs holds (indexed path) or that any riff holds (walk path), with the smallest
  RiffCID among those riffs; the own rows are the user's Stems rows.
- `discoverCandidates.test.ts`:
  - extend: a roll during the walk is served from the loaded copy (it doesn't wait), and after the
    swap sees the new stems;
  - rebuild: a "mine" roll is served from the own index before the walk ends; an all-stems roll
    waits for the walk; `onUsable` fires before the walk ends;
  - a db whose saved copy has a deleted row is rebuilt and its copy never served;
  - findRiffForStemPath: a stem missing from a served copy waits for complete.
- `backgroundWork.test.ts`: the note on the line.
- StartupGate/BackgroundWorkIndicator: typecheck + lint (React components are not unit-tested here).

## For Elling to revisit

- **All-stems rolls during a full rebuild wait** (~2 minutes on his archive). Other options: roll
  from the partial walk (biased to the oldest rowids), or from his own stems with a note.
- **A worker thread** could take the archive count off the main thread entirely (2.3 s instead of
  ~6 s sliced, after a sync only). Not done: a new build entry and asar loading of better-sqlite3
  in a worker can't be checked without running the packaged app.
- The 30-second re-check (`readTableSignal`) still runs a synchronous COUNT after an in-session sync.
- The own index differs from the full one for 8% of his stems (another riff that holds the stem).

## As built (2026-10-06)

Commits: 49b65dce, 9853f44c, 7522cf9d, 72b398d6, 7fa09e42. Changes from the plan above:
- **The archive count runs on a worker thread, not in slices.** Key-range slices were measured at
  about 6 s per table (the CID indexes are much bigger than the small index one COUNT(*) uses).
  `countRowsInWorker` runs the same COUNT on a worker's own read-only connection. A worker that
  can't start leaves the count to `readTableSignal`, as before. It's **unverified in a packaged
  build** (better-sqlite3 loaded from inside app.asar in a worker).
- Counts are seeded when the archive opens (index.ts, `whenReady`). A matching saved count is primed
  synchronously. ~~`listJamsWithDb` and stemPriority's first read wait for the worker
  (`whenTableCountsSeeded`).~~ **Corrected after review:** only the prewarm's `listJamsWithDb` and
  stemPriority waited. The renderer's handlers (`get-discover-library-scan-work`,
  `discover-artist-index`, list-jams, rolls) and the background passes still ran the 1.7 s COUNT on
  the main thread when they landed first. Fixed (review follow-ups below).
- A saved copy that may be kept is loaded while the worker counts (`mayKeepSavedCopy`).
- `canExtendByRowidSliced` counts the rows past a watermark in 1,000-rowid windows. It's used by the
  four extend checks in discoverCandidates. Other callers (artist pairs, scan targets, stemPriority)
  still use the one-statement version.
- Walk pages and saved-copy load pages are 1,000 rows (2,000 blocked 100-160 ms through a rebuild).
- Roll loops yield on time (8 ms), not every 200 rows. Each yield used to wait behind a walk page,
  so a roll during a rebuild took ~90 s.
- The own index hands its stems to stemPriority (`seedStemPriorityOwnStems`), so "only my stems"
  doesn't read them a second time (that read took 19.5 s behind the walk).

### Measurements (read-only; archive on USB, scratch snapshot of ownDb)

| Case | Before: usable (= complete) | After: usable | After: complete | First "mine" roll | Longest block, before → after |
|---|---|---|---|---|---|
| warm, later launches | 4.4 s cold / 8.2 s | 3.0 s | 3.0 s | 7.4 s | 1,695 / 2,429 ms → 27 ms |
| warm, first launch on this code (no saved count) | same | 4.1 s | 4.1 s | 8.6 s | → 40 ms |
| extend (20,000 riffs + 20,000 stems) | 10.6 / 12.5 s | 8.8 s | 11.3 s | 14.6 s | 2,950 / 4,161 ms → 200-273 ms |
| full rebuild | 148 s | 10.6 s | 150 s | 12.4 s | 1,746 ms → 1,045 ms |

Notes on the table:
- **Before** for "mine" is the same as usable: nothing could roll until complete.
- **Warm and extend** were each run more than once. The archive's pages stayed cached between
  runs, so the after numbers are warm-cache. The first before-run was cold.
- **Extend, longest block (200-273 ms):** the first 1,000-row page of the saved copy, read off a
  cold ownDb file, under the gate.
- **Full rebuild, longest block (1,045 ms):** the first roll's own Stems lookup. That's
  `SELECT ... FROM Stems WHERE StemCID IN (200 ids)` against the USB archive, a random read per
  stem. It's roll-path and already there before this work. Everything else in the walks stayed
  under ~230 ms; 58 blocks went over 100 ms in 150 s (most were walk pages).
- **Full rebuild, usable (10.6 s):** the worker count took 3.7 s, his own stems on the archive
  6.5 s, and the own db 0.3 s. That's not the hoped-for ~4 s: the own index reads 68k stems and
  78k riffs through the username indexes (3.0 s + 3.8 s measured alone).

### Review follow-ups (2026-10-06)

- **No reader counts while the worker does.** `tableChangeSignal.ts` keeps the counts in flight
  (`noteCountInFlight`, set by `seedTableCounts`). Every entry point that reads the archive's signal
  waits for them (`whenTableCountsSettled` / `whenAllTableCountsSettled` / `readTableSignalSettled`):
  the IPC handlers built on `listJamsWithDb`, `refreshStemJamPairs`, `getArtistIndex`,
  `getArtistStemRows`, `getRiffIndexForDb`, `getInstrumentRowsForDb`, `buildOwnStemIndex`,
  `classifyAutoCategoryBatch`, `findRiffForStemPath`. A cached scan's 30-second check is put off
  while its table is counted. `readTableSignal` is synchronous, so it can't wait: one that counts
  anyway is noted (`sql:signal-count-during-seed.<table>` in the dev [work] line, plus one warning
  with its stack). Test: `tableCountsInFlight.test.ts`.
- A reset of a saved copy that throws no longer leaves the own index served for the session.
- The saved username is written through a temp file, fsync and rename. A failed Endlesss session
  lookup no longer clears it: the renderer reports a name, "none" (a typed empty username, or
  right after a logout) or "unknown", and main ignores "unknown" (`@shared/ownUsernameReport`).
  Reporting moved to `OwnUsernameReporter`, mounted once in App.
- When the worker can't run, the seed counts on the main thread itself and saves that count, so
  the next launch on an unchanged file takes none.
- The seed moved to right after `createWindow()`. Measured warm: 1-5 ms synchronous (not
  measured cold: needs `sudo purge`).
- StartupGate stops listening for progress once it has closed.

### Still open, for Elling
- **No username at all** (nothing typed, not logged into Endlesss): on a full rebuild the gate opens
  after about 4 s (the worker count and the decisions), but nothing is rollable for about 2.5
  minutes, until the walks finish. There's no own index to serve without a username. The
  bottom-right indicator shows "indexing library" meanwhile.
- A first roll's Stems IN lookup blocks ~1 s per 200 ids, cold. Smaller chunks only spread the
  same I/O.
- Other `canExtendByRowid` callers still count new rows in one statement after a sync.
- The 30-second re-check can still run a main-thread COUNT after an in-session sync.
- All-stems rolls during a full rebuild wait for the walk (~2.5 minutes).

# Merge the Remaining Background Scans: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Do every repeated background pass from the 2026-10-05 audit once, and incrementally where
the data allows it (Elling: "are there repeat scans we can bundle together? if so bundle away"). The
most important part is disk I/O on the USB/ExFAT archive (`/Volumes/Elling-Lien`). Then come
sustained CPU and memory. Nothing a user sees changes, except that:
- the scan stops decoding 0-byte placeholders;
- the progress count starts lower.

**Source:** `docs/superpowers/specs/2026-10-05-background-scan-audit.md` (70d7852d). Read its §1
(inventory), §2 (opportunities) and "Counter gaps" first. This plan numbers its tasks its own way. The
coverage table below maps each audit item to its task.

**Not in this plan (another agent is building them now). Each task below says what it waits for:**

| Audit item | State | What this plan relies on |
|---|---|---|
| 1. One shared table signal | **Landed** 453bfb49 | `readTableSignal` is memoised per (connection, table), and its COUNT is re-taken only when MAX(rowid), data_version, the write count or total_changes moved. T2-T4's extension checks read it. `scanTargetCache.readLiveSignal` already goes through it. |
| 2. Classifier: attempted set, plus masks from memory | In flight (uncommitted in the tree at planning time) | 2(b) adds `src/main/instrumentRowsLookup.ts` and `getInstrumentMaskLookup(db)` in `discoverCandidates.ts`. The lookup binary-searches the in-memory instrument rows **in StemCID order** and is exact only while the Stems signal is unchanged. **T3 must keep both working** (decision 6) and lands after it. T10 lands after it too. |
| 4(a). Quantile rebuild from the in-memory value table | In flight | T5 adds two columns to the same `TraitValueTable` and lands after it. |

**Overlap with the radio intensity arc** (`docs/superpowers/plans/2026-10-05-radio-intensity-arc.md`):
- **Untouched here:** `DiscoverPanel.tsx` (being edited now) and every `src/shared/radio*` file.
- **Touched here, in small, separate hunks:**
  - `stemAnalysisNeeds.ts`: T5, T8;
  - `traitQuantileCache.ts`: T5;
  - `discoverCandidates.ts`: T2, T3, T10, all in the prewarm, riff-index, instrument-row and kind-index
    code, never in the candidate or intensity code;
  - `src/shared/stemAnalysis.ts`: T9, one additive field.
- **Their Task 14 is still open:** the backfill, measured with dev counters. T6 and T7 change what the
  library scan does and how many decodes run at once. They wait until Task 14 Step 1 has been read, so
  the level numbers are not measured on a moving pipeline (audit §2 item 3).
- **Check first:** before each task, run `git log --oneline -15 -- <files>` and re-anchor on function
  names, never on line numbers.

**Architecture, in one paragraph each:**
- **Main, the persisted indexes (T2-T4).**
  - The three Discover indexes over the archive, all stored in ownDb, are kept but walked properly:
    - the riff index (DiscoverRiffIndexCache);
    - instrument rows (DiscoverInstrumentRowsCache);
    - artist pairs (DiscoverJamUserPairs).
  - Each is walked by keyset instead of `LIMIT/OFFSET`.
  - Each is **extended** from a rowid watermark, as `scanTargetCache.ts` already is (B6), instead of
    rebuilt whenever a count moves.
  - Two of the three walks read the same Stems table. They become one walk.
  - The watermark rule moves out of `scanTargetCache.ts` into a small shared helper, so all four
    caches use one copy of it.
- **Main, the library scan (T5-T6).** The library scan works out which stems need analysis before
  touching the disk:
  - SQL in ownDb drops stems that are already analysed. Measured: **0.38 s** for the whole external
    pair set, read-only.
  - The in-memory value table supplies the stale ones (feature or level version) without parsing JSON.
  - Only what remains has its folder listed. Listings are **async** and never `readdirSync`. Never-
    analysed stems are stat'ed, so 0-byte placeholders drop out.
  - The renderer's loop is unchanged. It still asks `needs` page by page, so exactness rests on
    today's needs function.
- **Renderer (T7-T9, T11-T12).**
  - One analysis queue replaces the two 3-wide loops.
  - Placed stems that aren't library stems skip YAMNet.
  - Glyph bands and pitch lines are primed from the feature pass and persisted, so opening a project
    stops decoding every stem again.
- **Main and renderer, the pick path (T10).** The mask kind index keeps its confirmed/tag layer and
  rebuilds only its small "guess" layer when the classifier writes.

**Tech stack:** TypeScript, vitest, better-sqlite3 (main), React and Web Audio (renderer).

**Branch:** `merge-background-scans` (`git switch -c merge-background-scans`), on master after
this plan's commit.

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

Commit each task's own files only (`git add <paths>` or `git commit --only <paths>`), never
`git add -A`. Other agents share this working tree.

**Before you start:**
- Run `git status --short` and note other agents' files (today: `DiscoverPanel.tsx`). Leave them
  alone.
- Run `npm test` and `npm run typecheck`.
  - The suite is green except for the machine-dependent engine-spawn tests (memory
    `coreaudiod_thread_leak`).
  - A slow suite with scattered engine-test failures means coreaudiod is pegged. Don't trust that
    run (`ps -M <coreaudiod pid> | wc -l`).
- **SQLite rules** (memories `sqlite_never_iterate_across_await`, `sssketch_jams_share_one_db_pattern`):
  - `.all()`, never `.iterate()` across an `await`;
  - yield only between closed statements;
  - group per-jam work by db connection. Jams share one db.
- **CI:** better-sqlite3 crashes vitest workers on GitHub's macOS runner (memory
  `ci_release_better_sqlite3_worker_crash`).
  - **Every new test file that opens a database goes into `vitest.config.ts`'s CI exclude list in the
    same commit.** Otherwise the release build dies with dead workers and no failed test named.
  - This plan's new DB-opening test files are `rowidWatermark.test.ts`, `stemsTableWalk.test.ts`,
    `libraryScanWork.test.ts`, `stemGlyphCacheStore.test.ts` and `startupBackfillGate.test.ts`.
  - Everything else goes into files already on the list, or opens no database.
- **The USB volume** (memory `radio_late_start_was_an_ordering_bug`):
  - pages are not held by macOS, so a "cached" read there is usually cold;
  - `existsSync` is about 220 µs;
  - one cold `readdirSync` of a big folder is 626 ms, uninterruptible.
  - Budget main-process slices in milliseconds (8 ms, as `discoverLibraryStems.ts` does), never in row
    counts.

---

## How this plan was checked (read-only, during planning)

No code was written or compiled. Every number below comes from read-only queries (`mode=ro`) or
`stat` calls against Elling's live data, taken while his app was running:

| Check | Result | Used by |
|---|---|---|
| Deep page on external `Stems`, `ORDER BY StemCID LIMIT 5000 OFFSET 850000` | **3.07 s cold**, 0.03 s warm. One synchronous statement. | T3 |
| Same depth on external `Stems`, `WHERE rowid > ? ORDER BY rowid LIMIT 5000` | 0.10 s | T3 |
| External `Stems`, keyset `WHERE StemCID > ? ORDER BY StemCID LIMIT 5000` (with `CreatorUserName`) | 0.02-0.03 s | T3 (rebuild order) |
| Deep page on external `Riffs`, `ORDER BY RiffCID LIMIT 5000 OFFSET 850000` | 0.03-0.05 s warm; keyset `RiffCID > ?` under 5 ms | T2 |
| Anti-join: external pairs in DiscoverScanTargetCache lacking a peaks, embedding or feature row (ownDb) | 747,627 of 894,330 pairs, in **0.38 s** | T6 |
| DiscoverScanTargetCache, both sources | 911,503 distinct StemCIDs, of which 765,572 lack at least one row | T6 |
| StemCID shape, both warehouses (891,062 + 81,902 rows) | All 32 lowercase hex. **None contain `.`** | T8, T9 |
| ExFAT directory mtime vs newest file in it: 392 jam/shard folders, every 5th jam on the USB archive | **392 of 392** folders hold files newer than the folder's mtime (median lag 393 days). On this volume a folder's mtime does **not** move when files are added. | T6 (rules out reusing listings across launches) |
| Uniqueness in the external archive | `Stems.StemCID` is UNIQUE (PK + `Stems_IndexStem`); `Riffs.RiffCID` is UNIQUE | T2, T3 |

The deep-page numbers are the important ones. A cold walk with OFFSET re-skips everything before each
page. The archive's pages are not held, so each page can be a cold multi-second synchronous call: about
180 pages per table, twice per archive change. That matches the minutes-long walks recorded in
`discoverCandidates.ts`'s comments.

## Coverage

| Audit item | Task | Notes |
|---|---|---|
| 1 | n/a | landed (453bfb49) |
| 2 | n/a | in flight |
| 3: needs before existence | **T6** | 4(b) is its first half: **T5** |
| 4(a) | n/a | in flight |
| 4(b): versions in the value table | **T5** | |
| 5A: merge the Stems walks, keyset, incremental | **T2, T3, T4** | |
| 5B: derive scan targets from the riff index | **T14** | decision only, after measuring |
| 6: no YAMNet for stems that can never be stored | **T8** | |
| 7: one renderer scan queue | **T7** | |
| 8(a): interactive decodes count for the analysis | **T11** | optional, gated on T1/T7 counters |
| 8(b): band energy and pitch persisted, warm bounded | **T9** | |
| 8(c): BeatPicker and previewLoop through decodeStemFile | **T12** | |
| 9: kind index rebuilt on every classification write | **T10** | |
| Minor: startup sync work, `getArtistAnalysed`, loop-folder stats, `tidyUpLibraryStems` listing | **T13** (M1-M4) | |
| Counter gaps | **T1** | `fs:readdir`, `prewarm:rows-loaded.*`, walk timings |

## Decisions made in planning

1. **The three persisted indexes stay three tables (5A, not 5B).**
   - They answer different questions, and each already has its own loaders and tests:
     - the riff index: StemCID → first riff, bpm, time;
     - instrument rows: every Stems row's mask;
     - pairs: distinct jam/user.
   - The repeated cost the audit found is in how they are **walked**, not in how they are stored:
     - OFFSET paging;
     - a full rewalk on any count move;
     - two walks of the same Stems table.
   - Folding them (5B) is T14, a decision after T2-T4 are measured.

2. **One extension rule, extracted** (`src/main/rowidWatermark.ts`).
   - A cache built at `(count, MaxRowid, keyAtMaxRowid)` can be **extended** when all of these hold:
     - the live count ≥ the cached count;
     - the row at MaxRowid still carries the same key (RiffCID / StemCID);
     - `cached count + COUNT(rowid > MaxRowid) = live count`.
   - Otherwise it is **rebuilt**. This is `scanTargetCache.ts`'s `canExtend`, unchanged.
   - `scanTargetCache.ts` moves onto the helper with no change in behaviour. Its existing tests are the
     oracle.

3. **Skeleton riffs.**
   - The sync inserts a riff with no stems and fills it in later with an UPDATE. The count doesn't
     move.
   - The riff index tracks open riffs exactly as the scan-target cache does, in its own
     `DiscoverRiffIndexOpenRiffs` table. Every extension re-reads them.
   - **This fixes a latent gap.** Today a skeleton filled in between launches leaves the count
     unchanged, so the persisted riff index loads without its stems until some later count move.
   - Stems rows are written once, never filled in place. That is `discoverJamUserPairsStore.ts`'s
     documented assumption, and T3 keeps it.

4. **First seen still wins, exactly.**
   - The riff index maps each StemCID to its first riff in RiffCID order.
   - On extension, an already-indexed stem moves to a newly read riff only when that riff's RiffCID
     sorts earlier. This is `scanTargetCache.ts`'s `isEarlier` rule.
   - The persisted upsert is `ON CONFLICT DO UPDATE ... WHERE excluded.RiffCID < RiffCID`.

5. **Kept discovered groups** (`appendRiffIndexRows`, `appendInstrumentRows`, `saveDiscoveredRifff`).
   - Once a meta row carries a watermark, these append rows but **leave the meta alone**. The next
     extension reads those few riffs and stems again, harmlessly, because the upserts are idempotent.
   - A meta row without a watermark (written before T2) keeps today's behaviour.
   - So a keep never needs to know whether other riffs arrived in between, which today's count bump
     silently assumes.

6. **Order.**
   - **Instrument rows stay in StemCID order.** Item 2(b)'s `instrumentRowsLookup.ts` binary-searches
     the sorted prefix of the rows array. Rows appended out of order go into its small Map, and a
     rowid-ordered array would push all ~900k rows into that Map (about 30 MB and 300 ms, by its own
     header).
     - So T3's **rebuild** walks Stems by keyset on StemCID (`StemCID > ? ORDER BY StemCID`, through
       the UNIQUE index). One such page on USB measured 20-30 ms.
     - Only an **extension** (`rowid > MaxRowid`) appends a tail out of order. That is the lookup's
       designed case, the same as a kept group's append.
   - Each StemCID has one Stems row (UNIQUE, measured), so contents never depend on order.
   - The library scan's work list is in StemCID order instead of RiffCID order. That is processing
     order only.
   - Tests compare sets and maps, not arrays, wherever order is not the contract.

7. **The library scan is driven by the pair list, with an SQL preselect** (T6). It is not driven by
   the disk.
   - **The alternative, rejected:** list every jam/shard folder and look each name up.
     - It would touch about 150k names instead of 750k rows.
     - But it needs the inverse of `resolveStemPath`, so it is coupled to three folder layouts:
       stem_v2, endlesss-cache and the discovered room.
     - And it changes which file counts as "the" path for a stem that lives in several jams.
   - **The chosen design** keeps `resolveStemPath`, the allowed-jams filter and "the first allowed pair
     decides the path", exactly as today.
   - **Exactness:** the work list must include every on-disk target that `getStemAnalysisNeeds` would
     flag. The renderer still asks needs for every work item, so false positives cost one needs row
     each, never a decode.

8. **No folder-listing reuse across launches.**
   - ExFAT folder mtimes don't move when files are added (measured above, 392 of 392). A saved listing
     can't be validated cheaply.
   - Listings stay one per folder per mount, but they become `fs.promises.readdir`, 2 at a time. They
     leave the main thread entirely, so the 626 ms cold `readdirSync` block is gone.
   - Only folders that hold at least one candidate are listed.

9. **Placeholders.**
   - A candidate with **no feature row**, present by name, gets an async `stat` (`size > 0`). This is
     `isUsableStemFile`'s rule, done async.
   - A stem with a feature row was decoded before. It is not stat'ed.
   - So the 2,361 0-byte placeholders stop being read, decoded and warned about every session. They
     cost about 2,361 async stats instead, off the main thread.

10. **Which paths are library stems.**
    - A basename containing `.` is never a StemCID. Measured: every one of the 972,964 StemCIDs is 32
      lowercase hex.
    - This includes drag-imported rifffs (`… .wav`), baked stems (`… .baked.wav`) and loop-folder
      files.
    - The test is zero I/O, with no Stems lookup on the USB archive.
    - An extensionless path keeps today's behaviour.

11. **The shared queue (T7).**
    - Tiers: **placed > artist > library**. One gate, one cap of 3, a 500 ms gap after each batch.
    - Producers pull. BFS pushes placed paths, the artist tier is DLS's existing `takeArtistScanBatch`,
      and the library tier is DLS's existing needs pages.
    - The indicator still shows `placedAnalysis` and `stemAnalysis` separately.
    - When consent goes off, DLS unmounts and removes its two tiers, so the queue keeps only placed
      stems (audit §3: consent gating kept).

12. **Glyph bands and pitch (T9) are stored at the resolution they are drawn at.**
    - **Bands:** `polarGlyph` reads `downsample(bands, 16)`, and `downsample` of a 16-element array to
      16 is the identity. So 16 points per band reproduce the glyph exactly.
    - **Pitch:** both `polarPitchLine` and `linearPitchLine` draw every frame. So pitch is stored at
      full resolution as a Float32 blob (about 2.8 KB for a 16 s stem).
    - **Keys:**
      - an extensionless name is keyed by its StemCID (content-addressed, no stamp);
      - anything else is keyed by its path, stamped `size:mtimeMs` (a stat in main, on the internal
        disk).
    - **Written only when a glyph or pitch line is computed for that stem** (screens, `warmStemCaches`),
      never by the library scan. Storage is bounded by the stems actually shown, not 146k.

13. **The kind index in two layers (T10).**
    - The base layer (confirmed + tag) is rebuilt when confirmations move or the instrument-row array
      changes.
    - The guess layer is rebuilt from the residue rows alone when only StemAutoCategory moved, at most
      once per `GUESS_LAYER_MIN_MS = 10_000`. Residue rows are the ones that are not confirmed and that
      the mask can't place.
    - A guess can be up to 10 s stale. That's acceptable, because guesses only ever add `guess`
      admissions to stems nothing else places.
    - `stemClassificationVersion.ts` keeps one counter per table instead of one shared counter.

14. **Interactive features adoption (T11) is optional and gated.**
    - It runs only on a persisted-peaks miss, only for an extensionless path, and computes features and
      level, never the embedding.
    - It ships only if the T1/T7 counters show those stems being decoded again in the next session.

15. **The old IPC goes.** `get-discover-library-scan-targets` and its preload entry are removed in
    T6. `listLibraryScanTargets` stays: it is the tests' oracle and the fallback for an uncacheable db
    (in-memory, no rowid).

## File map

**Create**
- `src/main/rowidWatermark.ts` and its test (T2): `canExtendByRowid` and the open-row helpers.
- `src/main/stemsTableWalk.ts` and its test (T3): one keyset Stems walk, two outputs.
- `src/main/libraryScanWork.ts` and its test (T6): the work list.
- `src/main/stemGlyphCacheStore.ts` and its test (T9).
- `src/main/startupBackfillGate.ts` and its test (T13 M1).
- `src/shared/stemPathKind.ts` and its test (T8): `isLibraryStemName(basename)`.
- `src/shared/glyphBands.ts` and its test (T9).
- `src/renderer/src/audio/backgroundAnalysisQueue.ts` and its test (T7).
- `src/renderer/src/audio/stemGlyphCache.ts` (T9): one in-flight `get-stem-glyph-cache` IPC per
  path.

**Modify**
- **Main:**
  - `discoverCandidates.ts`: T2 (riff index), T3 (instrument rows), T10 (kind index);
  - `discoverIndexCache.ts` (+ test): T2, T3;
  - `riffLibrarySchema.ts`: T2 and T3, the meta watermark columns, via an `ensure…` function;
  - `scanTargetCache.ts` (+ test): T2 (onto the helper) and T6 (exports);
  - `discoverArtistIndex.ts` (+ test), `discoverJamUserPairsStore.ts`: T4;
  - `traitQuantileCache.ts` (+ test): T5;
  - `stemAnalysisNeeds.ts` (+ test): T5, T8;
  - `discoverLibraryStems.ts` (+ test): T1, T6;
  - `stemClassificationVersion.ts`, `stemAutoCategoryStore.ts`, `stemCategoriesStore.ts`: T10;
  - `discoveredLibrary.ts`: T2 (the append call);
  - `index.ts`: T6, T9, T13;
  - `stemCategoriesBackfill.ts`, `stemCacheMigration.ts`, `loopFolderScan.ts`,
    `tidyUpLibraryStems.ts`: T13.
- **Preload:** `src/preload/index.ts` (T6, T9).
- **Renderer:**
  - `audio/DiscoverLibraryScan.tsx`: T6, T7;
  - `audio/BackgroundFeatureScan.tsx`: T7;
  - `audio/bandEnergyCache.ts`, `audio/pitchCache.ts`, `audio/stemFeaturesCache.ts`,
    `audio/warmStemCaches.ts`, `audio/stemAnalysisWorker.ts`, `audio/stemAnalysisClient.ts`,
    `components/PolarGlyph.tsx`: T9;
  - `audio/peakCache.ts`: T11;
  - `components/BeatPicker.tsx`, `audio/previewLoop.ts`: T12.
- **Shared:** `src/shared/stemAnalysis.ts` (T9, additive).
- **Config:** `vitest.config.ts` (T2, T3, T6, T9, T13).

## Task graph

```
T1 counters + baseline ───────────────────────────────────────────────────────┐
item 2 lands ─> T2 riff index ─> T3 Stems walk ─> T4 pairs ─> T10 kind index  │
item 4(a) + radio Task 14 Step 1 ─> T5 versions ─> T6 scan work ─> T7 queue ──┤
T8 non-library: no YAMNet   (parallel-safe)                                   │
T9 glyph bands + pitch      (parallel-safe) ─> T11 interactive adoption (opt.)│
T12 decodeStemFile          (parallel-safe)                                   │
T13 M1, M3 (parallel-safe) · M2 after T5 · M4 after T6                        │
T2-T4 measured ─> T14 decision (5B)                                           │
all ─> T15 verify + measure + review + handoff + walkthrough ──────────────────┘
```

- **Parallel-safe** (no file shared with another open task or with in-flight work, beyond add-only
  hunks in `index.ts` and preload): T8, T9, T12, T13 M1 and M3.
  - T8 is one hunk in `stemAnalysisNeeds.ts`. Land it before T5, or rebase T5 over it.
  - T1 touches `discoverCandidates.ts` with one counter line. Land it before T2.
- **Strictly in order:**
  - T2 → T3 → T4 → T10: `discoverCandidates.ts`, `discoverIndexCache.ts`, the watermark helper;
  - T5 → T6 → T7: T6 reads T5's versions, and both T6 and T7 edit `DiscoverLibraryScan.tsx`;
  - T9 → T11: `stemFeaturesCache.ts`.
- **Waits on others:**
  - T2 waits for item 2 (its `discoverCandidates.ts` lookup);
  - T5 waits for item 4(a) (`traitQuantileCache.ts`);
  - T6 and T7 wait for radio Task 14 Step 1 to be read.

### Order by payoff (USB disk I/O first)

| Rank | Task | What it saves | When it is paid today |
|---|---|---|---|
| 1 | T3 | Two cold OFFSET walks of 891k external Stems (3.07 s per cold deep page, about 180 pages each, synchronous) plus a rowid walk (15 s warm, measured 2026-10-01). After it: one keyset walk on a rebuild, and only the new rows on a LORE sync. | Every launch after any archive change; pick path after a change in-session |
| 2 | T2 | The external riff index: 900k riffs by OFFSET, then **one synchronous 844k-row INSERT transaction** to save it. After it: keyset, extension (new riffs and open riffs only), and time-budgeted saves. Also every own-warehouse sync, which today rebuilds the own riff index in full. | Same; own db after every sync |
| 3 | T4 | The third full Stems walk (artist pairs) rides T3's walk. | Artist picker after any change |
| 4 | T6 (+T5) | Every launch with consent, today: a 980k-pair load; resolving 1M paths; **1,359 synchronous USB folder listings** (626 ms for one cold big folder); a 146k-target IPC (tens of MB); 293 needs IPCs, each re-parsing FeaturesJSON (88.7 MB, the session's second full parse); and 2,361 placeholders read and warned. After it, once the backfill is done: 0.38 s of SQL, async listings, about 2,361 async stats, and work in the hundreds. | Every launch with consent |
| 5 | T7 | Up to 6 concurrent random USB reads and decodes (BFS + DLS), down to 3, with placed stems first. One needs fetch per stem. | While both scans run |
| 6 | T8 | YAMNet inference + zero-shot for every placed non-library stem, every session. | Every session |
| 7 | T9 | A decode, an FFT band pass and a pitch pass per project stem on every project open, all awaited before the project shows; and on every glyph or pitch-line mount. After it: one IPC read, decode only the first time. The warm is bounded to 4 paths at a time. | Every project open |
| 8 | T10 | A 973k-row JS pass, plus reads of 23k + 122k rows, on the next pick after **any** classifier or zero-shot write (about once a second while zero-shot is pending). After it: the residue rows only, at most once per 10 s. | Pick path while scanning |
| 9 | T11 (opt.) | A second-session decode of stems first seen in Discover or radio. | Next session |
| 10 | T12, T13 | Small: inline decodes; 51 project files (8 MB) parsed every launch before the window shows; old-cache dir listings; analysed recounts; serial loop-folder stats. | Various |

### Schedule

- **Wave 0, now:** T1, T8, T9, T12, T13 M1 and M3.
- **Wave 1, after item 2 lands:** T2 → T3 → T4.
- **Wave 2, after item 4(a) and radio Task 14 Step 1:** T5 → T6 → T7.
- **Wave 3:** T10 (after T4), T11 (after T7 and T9, if its gate passes), T13 M2 and M4, T14.
- **Last:** T15.

---

## Task 1: Counters and the baseline

**Parallel-safe:** mostly. One line in `discoverCandidates.ts`; land it before T2. **Depends on:**
nothing.

**Files:** `src/main/discoverLibraryStems.ts`, `src/main/discoverIndexCache.ts`,
`src/main/discoverCandidates.ts` (the two walk functions only), `src/main/discoverArtistIndex.ts`,
`src/renderer/src/audio/warmStemCaches.ts`, `src/renderer/src/audio/bandEnergyCache.ts`,
`src/renderer/src/audio/pitchCache.ts`.

Counters are dev-only and cost one boolean in a packaged build. Item 1 already added
`ms:signal.<table>`, `sql:signal-count.<table>` and `signal:count-reused.<table>`. Item 2 adds
`auto-classify:rows-retried`. Item 4 adds `trait-quantile:rebuild`. **Don't duplicate them.**

- [ ] **Step 1: Add the counters.** Each line is a `countWork` call. Times are summed ms
  (`Math.round(performance.now() - t0)`), in the `ms:` convention item 1 started.

| Counter | Where |
|---|---|
| `fs:readdir` and `ms:fs.readdir` | `createDirListingExists`, per listing |
| `prewarm:rows-loaded.riff-index` and `prewarm:rows-loaded.instrument-rows` | `loadCachedRiffIndex` / `loadCachedInstrumentRows`, per page |
| `walk:riff-index.page`, `ms:walk.riff-index` and `walk:instrument-rows.page`, `ms:walk.instrument-rows` | `buildRiffIndex` / `getInstrumentRowsForDb`, per page |
| `ms:walk.artist-pairs` | `readJamUserPairs`, per page |
| `warm:paths` and `ms:warm-stem-caches` | `warmStemCaches`, once per call |
| `analysis:band-energy` | `getBandEnergy`'s compute branch |
| `analysis:pitch-contour` | `getPitchContour`'s compute branch |

- [ ] **Step 2: Verify.** Run `npm run typecheck`, then
  `npx vitest run src/main/discoverLibraryStems.test.ts src/main/discoverIndexCache.test.ts src/main/discoverCandidates.test.ts src/main/discoverArtistIndex.test.ts src/renderer/src/audio`.
  Nothing changes behaviour, so no new test.
- [ ] **Step 3: Commit:**
  `perf counters: listings, prewarm loads, walk times, project-open warm (background scan audit, counter gaps)`.
- [ ] **Step 4: Baseline. Record it; don't change code.**
  1. **Main side.** Run `npm run dev` in the background with consent on, against Elling's real
     library. Leave it 5 minutes idle and read the `[work main]` lines from its stdout. Record:
     - `fs:readdir` and `ms:fs.readdir`;
     - `scan-targets.cached-pairs`;
     - `sql:stem-analysis-needs.*`;
     - `parse:stem-features`;
     - `sql:discover.kind-index-build`;
     - `ms:signal.*`.
  2. **Renderer side.** `[work renderer]` lines appear only in DevTools (View → Toggle Developer
     Tools, filter `[work`). Ask Elling to paste two minutes of them after opening one of his
     drag-imported projects, and one Discover roll. Record:
     - `decode`;
     - `yamnet`;
     - `analysis:band-energy`;
     - `analysis:pitch-contour`;
     - `ms:warm-stem-caches`;
     - `ipc:get-stem-analysis-needs`.
  3. **The walks.** These run only on an archive change. Time them with a **read-only replay**
     instead of forcing a rebuild. Never delete his cache rows: a rebuild costs minutes of his USB
     drive.
     - Write a scratch script (not committed) that opens the external archive with `mode=ro`. Time:
       - one full OFFSET walk of Riffs (5,000-row pages);
       - one full OFFSET walk of Stems (5,000-row pages);
       - the same two by keyset.
     - Run it **only with Elling's OK**: it reads the whole archive, which competes with his running
       app.
  4. Put the numbers in the T15 handoff note. **No number is claimed before it has been read.**

---

## Task 2: Riff index: keyset pages, extended by rowid, saved in slices (audit 5A)

**Depends on:** item 2 landed (`discoverCandidates.ts`) and T1. **Not parallel-safe.**

**Files:**
- Create: `src/main/rowidWatermark.ts`, `src/main/rowidWatermark.test.ts`
- Modify:
  - `src/main/scanTargetCache.ts`, moved onto the helper, behaviour unchanged;
  - `src/main/discoverCandidates.ts`: `buildRiffIndex`, `getRiffIndexForDb`, the riff half of
    `prewarmDiscoverCandidateCaches`, and `appendToInMemoryDiscoverCaches`;
  - `src/main/discoverIndexCache.ts` (+ test): `saveRiffIndexCache` → sliced, plus
    `extendRiffIndexCache` and the open riffs; `appendRiffIndexRows` per decision 5;
  - `src/main/riffLibrarySchema.ts`: `DiscoverRiffIndexCacheMeta` gains `MaxRowid INTEGER`,
    `WatermarkRiffCID TEXT` through an `ensureDiscoverRiffIndexCacheHasWatermark(db)` modelled on
    `ensureDiscoverRiffIndexCacheHasCreationTime`. Also a new `DiscoverRiffIndexOpenRiffs(SourceDbKey,
    RiffRowid, PK both)`;
  - `src/main/discoverCandidates.test.ts`, `vitest.config.ts`.

**What changes:**
- **The walk.**
  - `buildRiffIndex` pages with `WHERE RiffCID > ? ORDER BY RiffCID LIMIT ?`. The order is the same
    and the first-seen-wins rule is the same, so the result is identical.
  - It also records the RowId of every skeleton riff (no stems) into the open set.
- **The cache decision.** `prewarmDiscoverCandidateCaches`, and `getRiffIndexForDb` when its in-memory
  cache is stale, decide in this order:
  1. a meta row with a watermark and `live.count === meta.RiffCount && live.maxRowid ===
     meta.MaxRowid` → load, as today;
  2. else, if `canExtendByRowid` holds → load or keep, then extend: riffs `rowid > MaxRowid` by rowid
     keyset, plus a re-read of the open riffs. Merge with `isEarlier`, persist with the guarded upsert
     (decision 4), and update the meta in the last slice;
  3. else rebuild (keyset) and save in slices. Each slice is a time-budgeted transaction (16 ms, as
     `scanTargetCache.writePairs` does), with a yield between slices:
     - meta deleted first;
     - old rows deleted in chunks;
     - meta written last.
- **Legacy meta.** A meta row with no watermark (`MaxRowid` NULL) on a non-empty table loads as today
  while counts match. On the first move it rebuilds once, then extends from then on.
- **The in-memory cache.** `riffIndexCache` keeps `{ index, state, watermark: { maxRowid,
  keyAtMax, count } }`, so an in-session extension needs no ownDb read.

- [ ] **Step 1: Write the failing tests.**
  - `rowidWatermark.test.ts` (opens sqlite; **add to the CI exclude list**). Port
    `scanTargetCache`'s `canExtend` cases onto a generic table `T(rowid, K UNIQUE)`:
    - an append → extend;
    - a delete → rebuild;
    - a replaced file (different key at MaxRowid) → rebuild;
    - `count + added ≠ live` → rebuild;
    - an empty cache → extend only while the source is empty;
    - `maxRowid` null → extend only when the cached count is 0.
  - `discoverCandidates.test.ts` (already excluded), new cases:

```ts
describe('riff index walk and extension (background scan audit 5A)', () => {
  it('pages by keyset: the SQL has no OFFSET, and the index equals a whole-table read', async () => {
    // 12,345 riffs, some sharing stems across riffs; spy on db.prepare
    // expect(sqls.some((s) => /OFFSET/i.test(s))).toBe(false)
    // expect(index) toEqual the Map built from SELECT ... ORDER BY RiffCID in one go
  })
  it('extends: riffs added past the watermark are read, the rest are not', async () => {
    // prewarm; insert 30 riffs; prewarm again with a fresh in-memory cache
    // only rowid > watermark pages read (count the 'rowid >' statements); index == full rebuild
  })
  it('a new riff with an earlier RiffCID takes over a stem it shares (first seen by RiffCID)', ...)
  it('a skeleton riff filled in place between launches is picked up (open riffs)', ...)
  it('a delete, or a different RiffCID at the watermark rowid, rebuilds', ...)
  it('a kept discovered group appends rows and leaves the watermark meta alone; the next launch extends over it', ...)
  it('a legacy meta row (no watermark) loads while counts match, rebuilds once when they move', ...)
})
```

  - `discoverIndexCache.test.ts` (excluded): `saveRiffIndexCache` of 50k rows commits in more than
    one transaction, with a yield between them (spy `setImmediate`), and a load afterwards equals the
    input. The meta is absent until the last slice (simulate an interruption by rejecting from the
    yield).
  - **Run them:**
    `npx vitest run src/main/rowidWatermark.test.ts src/main/discoverCandidates.test.ts src/main/discoverIndexCache.test.ts`.
    The new cases fail (no OFFSET-free walk, no extension).
- [ ] **Step 2: Extract `rowidWatermark.ts`** from `scanTargetCache.ts`:
  - `canExtendByRowid(sourceDb, table, keyColumn, meta, live)`;
  - `keyAtRowid(sourceDb, table, keyColumn, rowid)`.

  Point `scanTargetCache.ts` at it. Its own tests must pass **unchanged**:
  `npx vitest run src/main/scanTargetCache.test.ts`.
- [ ] **Step 3: Implement the walk, the extension and the sliced save** described above, plus the
  schema ensure. `.all()` only. Yield between pages, and also inside a page when the 8 ms budget is
  spent: a page of 5,000 riffs × 8 slots is real work.
- [ ] **Step 4:** Make `appendRiffIndexRows` follow decision 5, and keep the
  `appendToInMemoryDiscoverCaches` contract. It refreshes the stored signal after the commit; also keep
  the in-memory watermark as it was (the next extension reads the kept riffs again).
- [ ] **Step 5: Verify.**
  - Run `npx vitest run src/main` (expect the engine-binary exceptions only), then
    `npm run typecheck` and `npm run lint`.
  - Add `rowidWatermark.test.ts` to `vitest.config.ts`'s CI list, then run `CI=1 npx vitest run`. The
    file count must drop by exactly the excluded files, and no worker may exit.
- [ ] **Step 6: Measure.** Read-only replay: time the keyset walk of external Riffs against the
  baseline's OFFSET walk. In a dev session after Elling's next LORE sync, read
  `walk:riff-index.page`, `ms:walk.riff-index` and `prewarm:rows-loaded.riff-index`. **Expect pages
  equal to (new riffs / 5,000) + 1, not about 180.**
- [ ] **Step 7: Commit:**
  `discover riff index: keyset pages, rowid-watermark extension with open riffs, sliced saves (audit 5A)`.

---

## Task 3: One Stems walk: instrument rows by keyset, extended by rowid (audit 5A)

**Depends on:** T2 (`rowidWatermark.ts`, `discoverCandidates.ts`). Item 2(b)'s lookup export must keep
answering. **Not parallel-safe.**

**Files:**
- Create: `src/main/stemsTableWalk.ts`, `src/main/stemsTableWalk.test.ts`
- Modify:
  - `src/main/discoverCandidates.ts`: `getInstrumentRowsForDb`, the instrument half of
    `prewarmDiscoverCandidateCaches`, and `appendToInMemoryDiscoverCaches`;
  - `src/main/discoverIndexCache.ts` (+ test): `loadCachedInstrumentRows` by keyset
    (`StemCID > ?`), sliced `saveInstrumentRowsCache`, `extendInstrumentRowsCache`, and
    `appendInstrumentRows` per decision 5;
  - `src/main/riffLibrarySchema.ts`: `DiscoverInstrumentRowsCacheMeta` gains `MaxRowid`,
    `WatermarkStemCID`;
  - `vitest.config.ts`.

**What changes:**
- **The walk.** `stemsTableWalk.ts` owns ONE walk per source db, de-duplicated while in flight. It
  has two shapes:

```sql
-- rebuild: StemCID order (decision 6; item 2(b)'s lookup needs the sorted rows)
SELECT StemCID, Instrument, OwnerJamCID, CreatorUserName
FROM Stems WHERE StemCID > ? ORDER BY StemCID LIMIT ?
-- extension: only the rows past the watermark
SELECT rowid AS rid, StemCID, Instrument, OwnerJamCID, CreatorUserName
FROM Stems WHERE rowid > ? ORDER BY rowid LIMIT ?
```

- **Its output:** `{ instrumentRows: InstrumentRow[] (new rows only when extending), pairs: Set<jam\0user> (new
  ones only when extending), signal, watermark }`.
  - The in-memory instrument rows become `old.concat(new)`. It is a **new array**, so the kind index,
    keyed by array identity, rebuilds as it does today.
  - T4 consumes `pairs`.
- **The cache decision** is T2's three cases: load, extend, rebuild.
- **The page size stays 2,000.** A cold USB page of 2,000 rows was measured at about 250 ms, and that
  slice must not grow.

- [ ] **Step 1: Write the failing tests.**
  - `stemsTableWalk.test.ts` (opens sqlite; **add to the CI list**):
    - a rebuild walk over 9k Stems rows (inserted in random StemCID order) yields every row once,
      **in StemCID order**, plus the distinct non-empty (jam, user) pairs;
    - two concurrent callers share one walk (count `.all` calls);
    - `extend from rowid N` reads only rows past N;
    - a NULL or empty `CreatorUserName` is skipped for pairs and kept for instrument rows.
  - `discoverCandidates.test.ts`: the prewarm's instrument rows after an extension equal a full
    rebuild **as a Map by StemCID**. No OFFSET appears in any Stems statement. A kept group's
    `appendInstrumentRows` plus the next launch's extension leave no duplicate rows.
    `getInstrumentMaskLookup` (item 2(b)) answers the same masks before and after an extension, and
    after a rebuild its lookup's sorted prefix covers every row.
- [ ] **Step 2: Implement.** `getInstrumentRowsForDb` and the prewarm go through
  `stemsTableWalk.ts`. Persist new rows with `INSERT ... ON CONFLICT(SourceDbKey, StemCID) DO NOTHING`
  in slices. Write the meta last.
- [ ] **Step 3: Verify** as in T2 Step 5. `stemsTableWalk.test.ts` goes on the CI list.
- [ ] **Step 4: Measure.** Read-only replay: the keyset Stems walk against the baseline's OFFSET walk.
  After a LORE sync, in dev, read `walk:instrument-rows.page` and `ms:walk.instrument-rows`.
- [ ] **Step 5: Commit:**
  `discover instrument rows: one keyset Stems walk, extended by rowid (audit 5A)`.

---

## Task 4: The artist pairs ride the same Stems walk (audit 5A)

**Depends on:** T3. **Not parallel-safe** (`discoverArtistIndex.ts` is shared with no in-flight work,
but it uses T3's walk).

**Files:** `src/main/discoverArtistIndex.ts` (+ test), `src/main/discoverJamUserPairsStore.ts`.

**What changes:**
- **`pairsFor`:**
  - when it is stale, or nothing is saved, it calls `stemsTableWalk`'s shared walk instead of
    `readJamUserPairs`;
  - when the saved pairs' `(StemCount, MaxRowid)` allow extension (`canExtendByRowid` on Stems, key
    StemCID: the pairs meta gains `WatermarkStemCID`, a nullable column that `ensureTables` adds with
    `ALTER TABLE` when `PRAGMA table_info` lacks it), it
    walks only rows past `MaxRowid`, then merges and `INSERT OR IGNORE`s the new pairs;
  - otherwise it walks fully and replaces the pairs as `savePairs` does today.
- **One walk, both consumers.** A walk started by either the instrument-row cache or the picker fills
  both: the walk module hands its pairs to a registered sink that `discoverArtistIndex.ts` installs.
  So a launch after a LORE sync walks Stems **once**.
- **`readJamUserPairs`** stays for its tests and for an uncacheable db (in-memory, no rowid).

- [ ] **Step 1: Write the failing tests** (`discoverArtistIndex.test.ts`, already excluded):
  - after a prewarm walk, `getArtistIndex` returns pairs with **no** `sql:discover.artist-pairs-page`
    statement (spy on `prepare`);
  - an append of 50 Stems rows then a poll extends: only `rowid >` pages, and the pairs equal a full
    walk's;
  - a delete rebuilds;
  - the known gap in the store's header (an in-place UPDATE) is unchanged, and still documented.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify:**
  `npx vitest run src/main/discoverArtistIndex.test.ts src/main/stemsTableWalk.test.ts src/main/discoverCandidates.test.ts`,
  then `npm run typecheck`, `npm run lint` and `CI=1 npx vitest run`.
- [ ] **Step 4: Measure.** In dev, open the artist picker after a launch that rebuilt: there should be
  no `sql:discover.artist-pairs-page` lines, and `walk:instrument-rows.page` should appear once.
- [ ] **Step 5: Commit:**
  `discover artist pairs: from the shared Stems walk, extended by rowid (audit 5A)`.

---

## Task 5: The value table carries feature and level versions; needs read them (audit 4(b))

**Depends on:** item 4(a) landed (`traitQuantileCache.ts`) and T8 (`stemAnalysisNeeds.ts`). Radio Task 14 Step
1 should be read first. **Not parallel-safe.**

**Files:** `src/main/traitQuantileCache.ts` (+ test), `src/main/stemAnalysisNeeds.ts` (+ test). Both
are already on the CI list.

**What changes:**
- **Two new columns.** `TraitValueTable` gains `featureVersion: Uint16Array` and
  `levelVersion: Uint16Array`, read with `stemFeatureVersionOf` and `stemLevelVersionOf`, the same
  functions the JSON path uses. It also gains `versionsOf(stemCID): { feature, level } | 'malformed' |
  undefined`.
  - `addFromBuild`, `applyWrite` and the level-merge path (`noteStemFeatureRowWritten`) keep them in
    step.
  - About +0.6 MB at 146k rows.
- **Needs read the table.** `currentFeatureStemCIDs` in `stemAnalysisNeeds.ts` reads the table when
  `getTraitValueTable(db)` is current (one COUNT on ownDb, internal disk), and the JSON path
  otherwise.
  - A malformed row counts as missing, the same as the JSON path's `catch`.
  - **The level logic is the same rule, read from a different place** (radio arc: keep it as is).

- [ ] **Step 1: Write the failing test.** An **equivalence test** in `stemAnalysisNeeds.test.ts`.
  - Build fixture rows: `current`, `noLevel`, `v1`, `corrupt`, a JSON `null`, a missing row, and a row
    level-merged after the build.
  - The result must be identical, by `toEqual` over the whole answer, with the value table current and
    with it absent.
  - With the table current, `parse:stem-features` stays 0 and no `SELECT ... FeaturesJSON` statement
    runs (spy on `prepare`).
- [ ] **Step 2: Write the failing tests** in `traitQuantileCache.test.ts`:
  - `versionsOf` after a build, after `applyWrite`, and after a level merge;
  - item 4(a)'s identical-tables test still passes.
- [ ] **Step 3: Implement. Then verify:**
  `npx vitest run src/main/traitQuantileCache.test.ts src/main/stemAnalysisNeeds.test.ts`, then
  `npm run typecheck` and `CI=1 npx vitest run`.
- [ ] **Step 4: Commit:**
  `trait value table: feature and level versions per stem; needs read them instead of parsing (audit 4(b))`.

---

## Task 6: Library scan work: what needs work first, then existence, asynchronously (audit 3)

**Depends on:** T5, T2 (watermark helper; `scanTargetCache.ts`), and radio Task 14 Step 1 read. **Not
parallel-safe.**

**Files:**
- Create: `src/main/libraryScanWork.ts`, `src/main/libraryScanWork.test.ts`
- Modify:
  - `src/main/scanTargetCache.ts` (+ test): split `getCachedStemJamPairs` into
    `refreshStemJamPairs(ownDb, sourceDb): Promise<boolean>` (extend or rebuild; false when
    uncacheable) and `loadPairs`. `getCachedStemJamPairs` stays as their composition. Export
    `readPairsForStemCIDs(ownDb, key, stemCIDs)`;
  - `src/main/discoverLibraryStems.ts` (+ test): `createAsyncDirListing({ concurrency: 2 })`,
    `fs.promises.readdir`, with `fs:readdir` counted;
  - `src/main/index.ts`: `get-discover-library-scan-work` replaces
    `get-discover-library-scan-targets`;
  - `src/preload/index.ts`;
  - `src/renderer/src/audio/DiscoverLibraryScan.tsx`;
  - `vitest.config.ts`.

**What `listLibraryScanWork(jams, ownDb)` does.** Per source db, in `jams` order, grouped by
connection:
1. **Refresh.** `refreshStemJamPairs(ownDb, db)`. If the db is uncacheable, fall back to
   `listLibraryScanTargets` for that db, as today.
2. **Preselect, never or partly analysed.** Page `DiscoverScanTargetCache` for this SourceDbKey by
   keyset on the PK `(StemCID, OwnerJamCID)`, 5,000 rows a page, returning only pairs whose StemCID
   lacks a peaks, embedding or feature row (anti-join; 0.38 s in total, measured). Each row carries
   `RiffCID`, `Slot`, and `hasFeatures`.
   - Pairs of one StemCID arrive together, so the first allowed pair, by `(RiffCID, Slot)` with the
     jam in the allowed set, is chosen per group. Carry the group across page boundaries. **No
     global `seen` set.**
3. **Preselect, analysed but stale.**
   - The StemCIDs whose `versionsOf` says the feature version is old, or the level is missing or old.
     These come from T5's table, or from a single JSON pass when it isn't current.
   - Union the zero-shot-pending set: today's `zeroShotPendingStemCIDs` join, run once over
     `StemEmbeddingCache` with no IN-list.
   - Their pairs come from `readPairsForStemCIDs` in 500-ID chunks. The first allowed pair rule is
     the same.
4. **Cross-db rule, exact.** A candidate from a later db is dropped when an earlier db (in `jams`
   order) has an allowed pair for that StemCID. Check with `readPairsForStemCIDs` on the earlier key,
   for the surviving candidates only. Today's `seen` set spans dbs the same way.
5. **Existence.**
   - Resolve each chosen pair with `resolveStemPath`. Group by folder, and list each needed folder
     once (async, 2 at a time). Present by name is today's rule.
   - Then, for candidates with no feature row, `fs.promises.stat` with `size > 0`, 8 at a time. This
     drops placeholders.
   - Time-slice all JS at 8 ms (`yieldSlice`, as today).
6. **Return** `{ work: LibraryScanTarget[], analysedSkipped: number, placeholdersSkipped: number }`.

**The renderer.** `DiscoverLibraryScan.tsx` calls `getDiscoverLibraryScanWork()` and uses `work` where it used
`targets`. It still fetches needs page by page, and items that need nothing are still counted done.
`total` is `work.length`. The indicator shows `left` only, so its meaning holds: what is left to
look at.

- [ ] **Step 1: Write the failing tests** (`libraryScanWork.test.ts`, which opens sqlite; **add it to
  the CI list**). Fixture: ownDb with the cache tables + DiscoverScanTargetCache, two source dbs, a temp
  folder tree for the files (placeholders are 0-byte files), and an injected `resolveStemPath`:

```ts
describe('listLibraryScanWork (background scan audit 3)', () => {
  it('equals the oracle: listLibraryScanTargets filtered by needsAnyAnalysis, minus placeholders', async () => {
    // fixture mixes: analysed+current, analysed+no level, v1 features, peaks-only, never analysed
    // on disk, never analysed absent, 0-byte placeholder, zero-shot pending, a stem in two jams
    // (first allowed pair absent on disk), a stem in both dbs, a riff in a jam not allowed
    // expect(new Set(work.map(key))) toEqual oracle set; paths equal per key
  })
  it('never lists a folder whose stems are all analysed and current', ...)   // spy readdir
  it('never calls readdirSync', ...)                                          // spy fs.readdirSync
  it('never loads the whole pair list', ...)  // no DiscoverScanTargetCache statement without the anti-join or an IN-list
  it('a placeholder is dropped; an analysed stem is never stat-ed', ...)
  it('the first allowed pair decides the path, across page boundaries (page size 3)', ...)
  it('an uncacheable db (in-memory) falls back to the walk', ...)
})
```

  - The oracle is today's `listLibraryScanTargets` plus `getStemAnalysisNeeds` over its result. That
    is why both functions stay.
  - **Run:** `npx vitest run src/main/libraryScanWork.test.ts src/main/scanTargetCache.test.ts src/main/discoverLibraryStems.test.ts`.
    These fail.
- [ ] **Step 2: Implement `libraryScanWork.ts`** and the `scanTargetCache.ts` split. That file's
  existing tests pass unchanged.
- [ ] **Step 3: Wire the IPC.** In `index.ts`, the handler calls
  `listLibraryScanWork(listJamsWithDb()…, openOwnRiffLibraryDb())`. Remove the old handler, its
  `LibraryScanTarget` import if unused, and the preload method. Add `getDiscoverLibraryScanWork` to
  preload, typed. Switch `DiscoverLibraryScan.tsx`, and rename its counter to
  `ipc:get-discover-library-scan-work`.
- [ ] **Step 4: Verify.** Run `npm run typecheck`, `npm run lint`, `npm test` and `CI=1 npx vitest run`.
  React is not unit-tested here (CLAUDE.md), so say plainly that the DLS loop was checked by typecheck
  and by the tests on the main side.
- [ ] **Step 5: Measure** in a dev launch with consent, against the T1 baseline. Read:
  - `fs:readdir`: about the same count, now async;
  - `ms:fs.readdir`;
  - `ipc:get-discover-library-scan-work`: 1;
  - `ipc:get-stem-analysis-needs`: after the backfill, `ceil(work / 500)`, not about 293;
  - `parse:stem-features` from needs: 0 while the value table is current;
  - `scan-targets.cached-pairs`: 0.

  Note how big the work list is. During the level backfill it is still about 146k, as today. After
  the backfill it should be in the hundreds.
- [ ] **Step 6: Commit:**
  `discover library scan: needs before existence (SQL preselect, value-table versions), async folder listings, placeholders dropped (audit 3)`.

---

## Task 7: One renderer analysis queue (audit 7)

**Depends on:** T6 (`DiscoverLibraryScan.tsx`) and radio Task 14 Step 1 read. It halves peak decode
concurrency, which changes the backfill's rate. **Not parallel-safe.**

**Files:**
- Create: `src/renderer/src/audio/backgroundAnalysisQueue.ts`, `backgroundAnalysisQueue.test.ts` (no
  database)
- Modify: `BackgroundFeatureScan.tsx`, `DiscoverLibraryScan.tsx`. `App.tsx` changes only if the queue
  needs a mount; prefer a module singleton like `backgroundScanGate`.

**What changes:**
- **The queue** is `createBackgroundAnalysisQueue({ analyze, fetchNeeds, gate, setTimeout, now })`, a
  pure, injectable module whose singleton uses the real `analyzeStemOnce`,
  `fetchStemAnalysisNeeds`, `backgroundScanGate`, `window.setTimeout` and `performance.now`.
- **Its API:**
  - `setPlaced(paths)`: replaces the placed tier, de-duplicated by path, skipping attempted paths;
  - `setSource('artist' | 'library', source | null)`: a source is
    `{ next(n): Promise<WorkItem[] | 'idle' | 'done'>, done(keys) }`;
  - `onProgress(kind, left)`.
- **The loop:** gate check → take up to 3 items from the highest non-empty tier → fetch needs in one
  call for items that came without them → `analyze` → 500 ms → repeat.
  - `idle` rests that tier 30 s (`PRIORITY_IDLE_POLL_MS`).
  - A new placed set, or an artist enqueue event, wakes the loop at once.
- **The producers:**
  - **BFS** becomes `setPlaced(uniquePaths)` plus reporting.
  - **DLS** installs the artist source (`takeArtistScanBatch` / `finishArtistScanBatch`, its error rest
    and its `ARTIST_SCAN_QUEUED_EVENT` listener are unchanged) and the library source (its needs pages).
    It removes both on unmount, so consent off stops them. Attempted sets are unchanged.

- [ ] **Step 1: Write the failing tests** (`backgroundAnalysisQueue.test.ts`, vitest fake timers):
  - at most 3 `analyze` calls in flight across all tiers;
  - placed items go before library items queued earlier;
  - artist goes before library;
  - the gate defers and never skips;
  - removing the library source mid-batch lets the batch finish and stops further work;
  - an item with needs asks no needs;
  - one needs call per batch for items without them;
  - a rejected needs fetch for the placed tier leaves those paths retryable;
  - progress per kind reaches 0.
- [ ] **Step 2: Implement.** Then switch BFS and DLS over. Remove their duplicated `BATCH_SIZE` and
  `BATCH_DELAY_MS`.
- [ ] **Step 3: Verify.** Run `npx vitest run src/renderer/src/audio`, then `npm run typecheck`,
  `npm run lint` and `npm test`. UI lifecycle can't be tested by an agent; say so.
- [ ] **Step 4: Measure** in dev, with a project open and consent on:
  - `decode` per minute should never exceed 3 concurrent. Add `queue:in-flight-max` as a high-water
    mark logged once a minute;
  - `ipc:get-stem-analysis-needs` per placed stem: 1.
- [ ] **Step 5: Commit:**
  `background analysis: one queue, tiers placed > artist > library, 3 at a time (audit 7)`.

---

## Task 8: Placed stems that can never be stored skip YAMNet (audit 6)

**Parallel-safe:** yes, one separate hunk in a radio-arc file; land it before T5. **Depends on:** nothing.

**Files:**
- Create: `src/shared/stemPathKind.ts` and its test.
- Modify: `src/main/stemAnalysisNeeds.ts` (+ test).

**What changes:**
- `isLibraryStemName(basename)` is `!basename.includes('.')` (decision 10). Its doc comment carries the
  measurement.
- In `getStemAnalysisNeeds`, a path whose basename is not a library stem name answers
  `embedding: false, zeroShot: false`. Peaks and features stay "needed": they are used in-session.
- **No SQL is added.** The writer's `resolveStemCIDs` stays as the backstop.

- [ ] **Step 1: Write the failing tests.**
  - `stemPathKind.test.ts`: true for a 32-hex name; false for `x.wav`, `<cid>.baked.wav` and
    `loop.aif`.
  - In `stemAnalysisNeeds.test.ts`, the deliberate change: the `/local/one-shot.wav` row in "reports
    each missing or stale analysis" becomes `embedding: false`. Add a case: `<cid>.baked.wav` with no
    rows needs peaks and features only.
- [ ] **Step 2: Implement. Verify:** `npx vitest run src/shared/stemPathKind.test.ts src/main/stemAnalysisNeeds.test.ts`,
  then `npm run typecheck`.
- [ ] **Step 3: Measure.** In dev, open a drag-imported project: `yamnet` should stay 0 for its stems.
  Elling pastes the renderer line.
- [ ] **Step 4: Commit:**
  `analysis needs: no YAMNet for paths that are not library stems (audit 6)`.

---

## Task 9: Glyph bands and pitch lines: primed, persisted, warmed in bounds (audit 8(b))

**Parallel-safe:** yes. New store; additive in shared; renderer audio; add-only `index.ts` and
preload hunks. **Depends on:** nothing.

**Files:**
- Create:
  - `src/shared/glyphBands.ts` (+ test);
  - `src/main/stemGlyphCacheStore.ts` (+ test, opens sqlite: **add it to the CI list**);
  - `src/renderer/src/audio/stemGlyphCache.ts`.
- Modify:
  - `src/shared/stemAnalysis.ts`: `StemAnalysis.glyphBands?: GlyphBands`, from the `bandEnergy` it
    already computes. Additive; the level part is untouched;
  - `stemAnalysisWorker.ts` / `stemAnalysisClient.ts`, to pass the field through;
  - `bandEnergyCache.ts`: now `getGlyphBands(path): Promise<GlyphBands>` plus `primeGlyphBands`;
  - `pitchCache.ts`: persisted first;
  - `stemFeaturesCache.ts`: primes the bands next to pitch;
  - `components/PolarGlyph.tsx`: consumes `GlyphBands`;
  - `warmStemCaches.ts`: 4 paths at a time;
  - `index.ts` and preload: `get-stem-glyph-cache` and `set-stem-glyph-cache`;
  - `vitest.config.ts`.

**The store.** The table `StemGlyphCache(CacheKey TEXT PRIMARY KEY, Stamp TEXT NOT NULL, BandsJSON
TEXT, PitchBlob BLOB, PitchFrames INTEGER, ExtractedAt INTEGER NOT NULL)` is created lazily, like
`DiscoverJamUserPairs`.
- **Key** (decision 12): an extensionless basename gives `CacheKey = StemCID` and `Stamp = ''`. Any
  other path gives `CacheKey = path` and `Stamp = size:mtimeMs`, from `fs.promises.stat` in main.
- **A read** with a different stamp is a miss.
- **A write** upserts the provided columns and replaces the stamp. A re-baked file, rewritten in place,
  therefore overwrites its own row.

- [ ] **Step 1: Write the failing tests.**
  - `glyphBands.test.ts` (pure): over random arrays of lengths 1..3000,
    `polarGlyph(glyphBandsFrom(be).bass, r0, amp, 16) === polarGlyph(Array.from(be.bass), r0, amp, 16)`,
    and the same for mid and treble. The pitch round trip is Float32 → Buffer → Float32, identical.
  - `stemAnalysis.test.ts`: `glyphBands` equals `glyphBandsFrom(computeBandEnergy(samples, sr))`.
  - `stemGlyphCacheStore.test.ts`: read and write by StemCID; by path with a stamp; a stamp mismatch
    is a miss; partial upserts (bands, then pitch) combine.
  - Renderer (`bandEnergyCache.test.ts`, `pitchCache.test.ts`, `stemFeaturesCache.test.ts` exist):
    - a persisted hit decodes nothing;
    - a miss decodes once and writes once;
    - a features extraction primes both bands and pitch, so a later `getGlyphBands` neither decodes
      nor writes;
    - `warmStemCaches` keeps at most 4 paths in flight (inject a fake).
- [ ] **Step 2: Implement.** The persisted read goes before the decode in both caches, through one
  shared in-flight IPC per path (`stemGlyphCache.ts`). The write happens after a computed result, not
  after a primed one.
- [ ] **Step 3: Verify.** Run `npx vitest run src/shared/glyphBands.test.ts src/shared/stemAnalysis.test.ts src/main/stemGlyphCacheStore.test.ts src/renderer/src/audio`,
  then `npm run typecheck`, `npm run lint` and `CI=1 npx vitest run`.
  - An agent can't see a glyph. The pure identity test is the proof that it draws the same.
- [ ] **Step 4: Measure.** Elling opens the same drag-imported project twice in two sessions. On the
  second, `analysis:band-energy` and `analysis:pitch-contour` should be 0, and `ms:warm-stem-caches`
  should be below the baseline.
- [ ] **Step 5: Commit:**
  `glyph bands and pitch lines: primed by the feature pass, persisted per stem, project warm 4 at a time (audit 8(b))`.

---

## Task 10: Kind index: only the guess layer rebuilds on classifier writes (audit 9)

**Depends on:** T3 (instrument rows), item 2 landed. **Not parallel-safe** (`discoverCandidates.ts`).

**Files:** `src/main/discoverCandidates.ts` (+ test), `src/main/stemClassificationVersion.ts`,
`src/main/stemAutoCategoryStore.ts`, `src/main/stemCategoriesStore.ts`.

**What changes:**
- **Counters.** `stemClassificationVersion.ts` gets one counter per table. `bumpStemClassificationVersion(db, 'confirmed' | 'auto')`;
  the two stores pass their table.
- **Signature.** `readClassificationSignature` returns `{ confirmed, auto }`: the same SQL, split.
- **The index has two layers:**
  - **base:** confirmed + tag lists, plus `residue: InstrumentRow[]`, the rows that are neither
    confirmed nor mask-placed;
  - **guess:** per kind, built from `residue` and a fresh read of `StemAutoCategory`.
- **Rebuilds:**
  - the base rebuilds when `rows` identity or `confirmed` moved;
  - the guess layer rebuilds when only `auto` moved, and only after `GUESS_LAYER_MIN_MS` since its
    last build. Until then the previous guess layer serves.
- **`getMaskKindStemMasks`** iterates the base list, then the guess list. The two are disjoint by
  StemCID: one Stems row per StemCID (decision 6).

- [ ] **Step 1: Write the failing tests** (`discoverCandidates.test.ts`):
  - an auto write followed by a roll does **not** re-run the base pass. Count the
    `scan:discover.kind-index-rows` work via an injected counter, or spy: the base builder is not
    called;
  - the guess layer reflects the write once 10 s have passed (fake timers);
  - a confirmation rebuilds both, at once;
  - the result as a Map (StemCID → {instrument, source}) equals a from-scratch build after any mix of
    writes.
- [ ] **Step 2: Implement. Verify:** `npx vitest run src/main/discoverCandidates.test.ts src/main/stemAutoCategoryStore.test.ts src/main/stemCategoriesStore.test.ts`,
  then `npm run typecheck` and `CI=1 npx vitest run`.
- [ ] **Step 3: Measure.** In dev, with the classifier awake: `sql:discover.kind-index-build` per
  minute should drop to about 0 between confirmations. Add `kind-index:guess-rebuild` to count the
  guess layer's rebuilds.
- [ ] **Step 4: Commit:**
  `discover kind index: confirmed/tag base layer, guess layer rebuilt alone at most every 10 s (audit 9)`.

---

## Task 11 (optional): An interactive peaks decode also adopts features and level (audit 8(a))

**Gate:** ship only if the counters (T1, T7) show stems first seen in Discover or radio being decoded
again in the next session. Otherwise record "not needed" in T15. **Depends on:** T9, T7.

**Files:** `src/renderer/src/audio/peakCache.ts` (+ test), `stemFeaturesCache.ts`.

**What changes:**
- In `getAnalysis`'s decode branch (a persisted-peaks miss), for a library stem name with no features
  entry (`peekStemFeaturesEntry` undefined), call
  `adoptStemFeaturesFromBuffer(path, undefined, Promise.resolve(buffer), Promise.resolve(result.brightness))`.
  It persists through `queueStemAnalysisWrite`, and the extraction measures the level itself.
- **No embedding.** That is YAMNet; it stays the scan's job.
- **Risk:** the worker is FIFO, so a radio Waveform's pitch job can queue behind these features jobs.
  Measure `analysis` latency during radio before keeping it.

- [ ] **Step 1: Write the failing test:** a `getPeaks` miss on an extensionless path installs a
  features entry and queues one write. A `.wav` path does not. An existing features entry is left
  alone.
- [ ] **Step 2: Implement, verify** (`npx vitest run src/renderer/src/audio`, then `npm run typecheck`)
  **and commit:** `peaks decode: adopt features and level from the same buffer for library stems (audit 8(a))`.

---

## Task 12: BeatPicker and previewLoop decode through decodeStemFile (audit 8(c))

**Parallel-safe:** yes. **Files:** `src/renderer/src/components/BeatPicker.tsx`,
`src/renderer/src/audio/previewLoop.ts`.

- [ ] **Step 1:** Replace each inline `readAudioFile` + `decodeAudioData` with `decodeStemFile(path)`.
  Keep each caller's own error handling: `decodeStemFile` rejects with the not-downloaded error for 0
  bytes.
  - `decodeStemFile` shares only in-flight work and keeps no buffer (audit §3), so memory is
    unchanged.
- [ ] **Step 2: Verify** (`npm run typecheck`, `npm run lint`, `npx vitest run src/renderer`) **and
  commit:** `beat picker, preview loop: decode through decodeStemFile (audit 8(c))`.

---

## Task 13: The minor items (audit "Minor")

Each is its own commit.

- [ ] **M1. Startup sync work before the window** (parallel-safe).
  - **Files:** create `src/main/startupBackfillGate.ts` (+ test, opens sqlite: **add it to the CI
    list**); modify `stemCategoriesBackfill.ts` and `stemCacheMigration.ts`.
  - **The backfill.** `backfillStemCategoriesFromProjectLibrary` re-parses only project files whose
    `(size, mtimeMs)` differs from a small `StartupBackfillSeen(Path PK, Stamp)` table in ownDb.
    - Same result: the upserts are guarded by `UpdatedAt`.
    - **Test:** a second run parses nothing (count `readFileSync` through an injected reader), and a
      touched file is parsed again.
  - **The migration.** `migrateEndlesssStemCache` writes a done-marker (a row in that table) after a
    pass that moved nothing. Later launches skip the listing.
    - **Test:** with the marker present, the old dirs are never listed.
  - **Commit:** `startup: skip re-parsing unchanged projects and the finished stem-cache migration (audit minor)`.
- [ ] **M2. `getArtistAnalysed`** (after T5).
  - When `getTraitValueTable(ownDb)` is current, count the artist's stems with `rowOf` instead of
    chunked IN-COUNTs, and drop the per-feature-count cache key.
  - **Test** in `discoverArtistIndex.test.ts`: the same answer, with no `artist-analysed-chunk`
    statement.
- [ ] **M3. Loop-folder rescans** (parallel-safe, interactive only).
  - In `loopFolderScan.ts`, stat files with bounded concurrency (8) instead of serially. The result
    order follows the walk, not stat completion.
  - **Test** in `loopFolderScan.test.ts`: the same output, and at most 8 stats in flight (injected
    `stat`).
- [ ] **M4. `tidyUpLibraryStems`** (after T6).
  - It uses T6's async listing (`createAsyncDirListing`) instead of building its own sync
    `createDirListingExists` on each call.
  - That needs an async `existsFn`, so `listTidyUpLibraryStems` becomes async where it calls it.
    Check its IPC handler.
  - Its tests keep their expectations.

Verify each with its own test file, then `npm run typecheck` and `CI=1 npx vitest run`.

---

## Task 14: Scan targets from the riff index: decision only (audit 5B)

**Depends on:** T2-T4 measured. **No code.**

- [ ] Measure the main process's heap after startup, with consent on, in dev: `process.memoryUsage()`
  logged once after the prewarm and T6's work list. Compare it with the T1 baseline.
- [ ] Write the decision into the T15 handoff note. 5B would retire DiscoverScanTargetCache (979,842
  rows) and derive targets from the riff index, which holds one jam per StemCID. Its one behavioural
  difference:
  - **the case:** a stem whose first riff is in a jam that isn't allowed, but which also appears in an
    allowed jam;
  - **today:** it is scanned through the allowed jam;
  - **under 5B:** it would be missed, unless the riff index keeps every jam.

  That is Elling's call only if the memory numbers say it matters. Otherwise record "not worth it".

---

## Task 15: Verification, measurement, review, handoff, walkthrough

- [ ] **Step 1: Green.** Run `npm test`, `npm run typecheck` and `npm run lint`. Then run
  `CI=1 npx vitest run`: no `Worker exited unexpectedly`, and the file count lower than local by
  exactly the CI list.
- [ ] **Step 2: Measure** the same session shape as T1's baseline, and record before → after for:
  - `fs:readdir` and `ms:fs.readdir`;
  - `ipc:get-stem-analysis-needs`;
  - `parse:stem-features`;
  - `sql:discover.kind-index-build`;
  - `yamnet` on a drag-imported project;
  - `analysis:band-energy` and `analysis:pitch-contour` on a second open;
  - `ms:warm-stem-caches`;
  - the walk pages after a LORE sync, if one happened.

  Numbers only where they were read.
- [ ] **Step 3: Review** with superpowers:requesting-code-review against this plan's decisions. Check:
  - the CI list;
  - `.all()` across awaits;
  - grouping by connection;
  - the consent gate.
- [ ] **Step 4: Handoff.**
  - Add a memory note `background_scans_merged.md` covering: what landed, the measurements, T11's and
    T14's outcomes, and that it needs Elling's walkthrough.
  - Add its line to `MEMORY.md`.
  - **Do not push.**
- [ ] **Step 5: The walkthrough** (Elling's; no agent can see the UI or hear playback). It takes 10
  minutes.
  1. **Launch with consent on.** For the first minute, typing and menus stay responsive. Discover
     rolls work. The background indicator's count is small once the level backfill is done.
  2. **After a LORE sync** (or the next own-library sync), relaunch. There should be no long "warming
     library" progress. In the artist picker, "jammed with" appears without a long wait.
  3. **Open a drag-imported project twice.** Waveforms, glyph rings and pitch lines look exactly as
     before. The second open is quicker.
  4. **Roll Discover while the classifier is running.** Rolls don't stall. A stem the classifier just
     placed can take up to 10 seconds to show up under its kind.
  5. **Turn consent off.** The library scan stops; placed stems are still analysed. Turn it back on and
     the scan starts again.
  6. **Paste one minute of `[work main]` and `[work renderer]`** while Discover is open, for the
     record.

---

## Risks

| Task | Risk | Guard |
|---|---|---|
| T2, T3, T4 | An extension misses a change the watermark can't see: an in-place UPDATE between launches | Riffs: open riffs are re-read every extension (decision 3). Stems: rows are written once (store header); within a session `data_version` and the write counts catch it (item 1). Any delete or replaced file rebuilds. |
| T2, T3 | The schema ensure runs on a 3.6 GB ownDb | `ALTER TABLE ADD COLUMN` on a tiny meta table and `CREATE TABLE IF NOT EXISTS`: instant. No data migration. A legacy meta loads as today. |
| T2, T3 | A sliced save is interrupted (quit mid-save) | Meta is deleted first and written last, so a partial cache is never trusted. This is `scanTargetCache`'s existing pattern. |
| T3 | Item 2(b)'s lookup breaks, or degrades to one ~900k-entry Map | The rebuild walks in StemCID order (decision 6). After an extension the cache's stored signal is the live one, so the lookup stays exact. Tests in T3 Step 1. |
| T3, T10 | Pools are ordered differently, which changes seeded test expectations | Tests compare Maps and Sets. If a seeded roll test pins exact picks, re-record it only after proving the pool sets are equal. |
| T6 | The work list misses a stem needs would flag | The oracle test (today's targets + needs) over a fixture covering every class. Needs still decides per page. |
| T6 | Async listings are slower in total wall time than sync | They are off the main thread, so the cost is the scan starting a little later. That is acceptable: it runs for hours anyway. Concurrency is 2, so interactive file reads still get libuv threads. |
| T6 | The progress count changes meaning | The indicator shows `left` only. It starts lower once analysed stems are excluded, which is correct. |
| T7 | Lifecycle: consent toggle, unmount, a batch in flight | Fake-timer tests for removing a source mid-batch. The DLS unmount still sets `cancelled`. |
| T7 | The backfill runs at half its peak decode rate | Intended: the audit's cap. It waits for radio Task 14's read. |
| T9 | A glyph is drawn differently | The pure identity test (decision 12). Pitch is stored at full resolution and bit-exact. |
| T9 | Stale glyph for a file rewritten in place | The path key is stamped with `size:mtimeMs`. StemCID files are content-addressed. |
| T10 | A guess is up to 10 s late in a pool | Accepted (decision 13). Confirmations are immediate. |
| T11 | Worker contention during radio | Optional and gated, and measured before it is kept. |
| All | coreaudiod pegged during a full run | Check its thread count. Engine-spawn failures under load are the machine (memory). |


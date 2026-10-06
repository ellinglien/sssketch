# Background scan audit: what runs, what overlaps, what to bundle

Date: 2026-10-05
Status: audit only (no code changed). Elling: "are there repeat scans we can bundle together? if so bundle away".
Follows: `2026-09-22-background-efficiency-design.md` (A1-A3, B1-B7 shipped).

## How this was measured

- Code read end to end: every background or ambient pass in `src/main/` and `src/renderer/src/audio/`, plus
  the startup sequence in `src/main/index.ts`.
- Real numbers come from **read-only** queries against Elling's own databases (`mode=ro`, nothing written):
  - `~/Music/sssketch/library/cache/common/warehouse.db3` (ownDb, 3.6 GB, internal disk);
  - `/Volumes/Elling-Lien/ENDLESSS/cache/common/warehouse.db3` (the external LORE archive, USB/ExFAT).
- Timings come from a fresh read-only connection, measured once, while the app was running. "Cold" is the
  first read of the table; "warm" is the same query repeated straight after.
- No dev `[work]` run was possible from here, because an agent can't drive the app. Where the counters
  can't answer a question yet, the gaps are listed in "Counter gaps".

### The library today

| What | Count |
|---|---|
| External archive | 900,041 Riffs and 891,062 Stems |
| Own warehouse | 80,826 Riffs and 81,902 Stems |
| StemFeatureCache | 146,304 rows (145,928 at feature v2; **148 with the level pass**). FeaturesJSON is 88.7 MB in total. |
| StemPeaksCache | 145,932 rows |
| StemEmbeddingCache | 146,289 rows. EmbeddingJSON is 1.66 GB in total, about 11.3 KB per row. |
| StemAutoCategory | 122,284 rows |
| Human or backfill confirmations (StemCategories.ArrangeRole) | 23,174, of which 8,507 also have an embedding |
| StemYamnetZeroShotAttempted | 104,320 rows |
| Classifier residue: embedded, not confirmed, not auto-classified | **20,426** |
| DiscoverRiffIndexCache rows | 761,929 (external) + 81,899 (own) |
| DiscoverInstrumentRowsCache rows | 891,062 + 81,902 |
| DiscoverScanTargetCache rows | 894,330 + 85,512 |
| Folders the scan's existence check lists | 1,359 jam/shard folders on USB + 608 on internal disk |

### Signal timings on the external archive (fresh read-only connection)

| Query | Cold | Warm |
|---|---|---|
| `COUNT(*) FROM Riffs` | 562-590 ms | 2.9 ms |
| `COUNT(*) FROM Stems` | 1,342-1,372 ms | 4.1 ms |
| `MAX(rowid)` | 0-3.8 ms | 0-3.8 ms |
| `pragma data_version` | 0 ms | 0 ms |

- Listing 150 sampled USB stem folders took 0.3 ms per folder (median) and 2.3 ms at most. That puts a full
  pass at about **0.5 s warm**.
- A cold listing of a large folder was measured at 626 ms earlier (see the
  `radio-late-start-was-an-ordering-bug` memory).

## 1. Inventory

**Abbreviations:**

| Short form | Meaning |
|---|---|
| DLS | `DiscoverLibraryScan.tsx` |
| BFS | `BackgroundFeatureScan.tsx` |
| aSO | `analyzeStemOnce.ts` |
| needs | `get-stem-analysis-needs` (`stemAnalysisNeeds.ts`) |
| gate | `backgroundScanGate`: pauses scans while a modal is open or for 1.5 s after any input |

### Startup and project load

| # | Pass (file) | Trigger | Walks | Reads, decodes, computes | Writes | Throttle and gating |
|---|---|---|---|---|---|---|
| 1 | Startup migrations and backfills: `migrateEndlesssStemCache`, `migrateLegacyFavourites`, `backfillStemCategoriesFromProjectLibrary`, `backfillInstrumentMaskCategories` (`index.ts` whenReady) | Every launch, synchronous, before the window | Old endlesss-cache dirs (readdir + lstat), 51 project files (8 MB JSON), own Stems (one SELECT) | JSON parse; mask to role | StemCategories, centroids | None (sync); no consent |
| 2 | `prewarmDiscoverCandidateCaches` (`discoverCandidates.ts`) | Window ready-to-show, every launch | Per source db: Riffs signal, then the riff index **from ownDb's DiscoverRiffIndexCache** when the count matches, else a full LIMIT/OFFSET walk of Riffs. Then the Stems signal, then **DiscoverInstrumentRowsCache**, else a full LIMIT/OFFSET walk of Stems. | About 1.8M persisted rows into two in-memory maps | The two caches, after a rewalk | Paged and yields; no consent |
| 3 | `prewarmTraitQuantileTables` (`traitQuantileCache.ts`) | After #2 finishes | Every StemFeatureCache row (keyset pages) | JSON.parse of all 146k FeaturesJSON (88.7 MB); builds quantile tables and the per-stem TraitValueTable (B1) | Memory only | Paged and yields; no consent |
| 15 | `warmStemCaches` (`warmStemCaches.ts`) | Project open, recover and library open; **awaited** before LOAD_STATE | Every stem in the project | getPeaks, getBrightness (persisted), getBandEnergy and getPitchContour (**never persisted, so a decode each time**), getStemFeatures (persisted) | Peaks (non-library stems only in memory) | None. Unbounded `Promise.allSettled` across all stems. |

### Ambient and consent-gated analysis scans

| # | Pass (file) | Trigger | Walks | Reads, decodes, computes | Writes | Throttle and gating |
|---|---|---|---|---|---|---|
| 4 | Overnight classifier (`stemAutoClassifyScheduler.ts`, `stemAutoClassify.ts`) | 3 s after launch, then self-rescheduling: 3 s busy, sleeps when caught up, woken by writes, **10-min safety rebuild** | Keyset id scans of StemEmbeddingCache and StemFeatureCache (eligibility NOT EXISTS), then 200-id blob fetches | EmbeddingJSON parse + cosine kNN against the confirmed pool; or the centroid; **Stems.Instrument IN-lookup per batch on every candidate db (USB)** | StemAutoCategory (one transaction per pass) | Consent re-read every tick; 200 per batch |
| 5 | BFS, the placed-stem scan | Mount, then every `flatStems` change | Placed stems (unique paths) | One needs IPC, then aSO for stems that need something: one decode, then peaks + features (worker) + YAMNet embedding / zero-shot / level | Through the batched write queue (B7) | 3 at a time, 500 ms gap, gate; no consent |
| 6 | DLS target list (`get-discover-library-scan-targets`, `discoverLibraryStems.ts` + `scanTargetCache.ts`) | DLS mount: launch with consent, or a consent toggle | Riffs signal + rowid watermark per db (extend or rebuild), **then loads all 979,842 cached pairs**, `resolveStemPath` for about 1M of them, then **readdirSync of 1,967 folders** (1,359 on USB) | Existence by name only, so 0-byte placeholders count as present | DiscoverScanTargetCache | 8 ms time-sliced yields; consent |
| 7 | DLS needs pages | After #6, 500 targets per IPC | Every target (at least 146k): about 293 IPCs, each running 4 SQL queries | **JSON.parse of every FeaturesJSON again** (version and level check), presence checks for peaks/embedding, zero-shot eligibility join | None | Fetched a page ahead; gate |
| 8 | DLS analysis loop | Needs say work | Targets needing work | aSO. **Today:** level-only for 146,156 rows (the radio arc's backfill, e0963118/06761383). | Write queue: one transaction per flush | 3 at a time, 500 ms gap, gate. **Runs alongside BFS: up to 6 decodes at once.** |
| 9 | Artist "analyse overnight" queue (`discoverArtistScanQueue.ts`, served inside DLS) | DiscoverPanel queues an artist; DLS serves it first each step | Queued StemCIDs (0 today) | Downloads (main), then needs, then aSO | DiscoverArtistScanQueue | Inside the DLS loop; rests 30 s when empty or paused |

### Picker, roll and radio caches

| # | Pass (file) | Trigger | Walks | Reads, decodes, computes | Writes | Throttle and gating |
|---|---|---|---|---|---|---|
| 10 | Artist index (`discoverArtistIndex.ts`) | Artist picker opens or polls | Stems GROUP BY over the index (counts); pairs: **a full rowid walk of Stems** when the saved count and max rowid moved | Pairs saved to ownDb | DiscoverJamUserPairs | Paged 2,000; no consent |
| 11 | Artist stem rows (`discoverArtistStems.ts`) | Artist-mode roll | Stems by CreatorUserName (index) | LRU per artist | Memory | Signal-checked |
| 12 | Mask kind index (`discoverCandidates.ts`, B2) | First roll after `readClassificationSignature` moves, which happens on any StemCategories or StemAutoCategory write | JS pass over all 972,964 instrument rows + full reads of StemCategories (23k) and StemAutoCategory (122k) | Admissions per kind | Memory | Yields |
| 13 | Table change signals (`tableChangeSignal.ts`) | Every cached scan, at most once per 30 s **each** | `MAX(rowid), data_version, COUNT(*)` per table. Independent copies: listJamsWithDb (Jams + Riffs), riff index (Riffs), jam riff counts (Riffs), instrument rows (Stems), artist stems (Stems), artist pairs (Stems), and scanTargetCache's own `readLiveSignal` (Riffs) | **A synchronous main-thread COUNT over 900k-row USB tables** | None | 30 s per cache |
| 14 | Riff index users: dig / near pool, findRiffForStemPath (`discoverAdjacency.ts`) | Roll, radio dig, seeds | In-memory riff index (#2) + `resolveRiff`, which stats each stem | Per-stem `isUsableStemFile` stat | None | n/a |

### Interactive decodes and other

| # | Pass (file) | Trigger | Walks | Reads, decodes, computes | Writes | Throttle and gating |
|---|---|---|---|---|---|---|
| 16 | Interactive decodes: Waveform (peaks, and pitch when `showPitchLine`), PolarGlyph (band + pitch), phraseCache (coach), classifyStems (import), BeatPicker and previewLoop (inline decode, **outside decodeStemFile**) | Screens mount | Shown stems | decodeStemFile shares only concurrent callers | Peaks (library stems only) | None |
| 17 | Loop folders (`loopFolderScan.ts`) | Link, or a pane's rescan | Folder tree (async readdir) + **a serial `stat` per file** + 4 KB header for changed WAVs | Durations, tempo guesses | LoopFiles | 8 ms slices; no consent |
| 18 | Engine and preview prefetch for radio (`warmEngineBuffer`, rubberband, `engine-preload-stem`) | Each radio pick | The picked stem | Rubberband reads the source; the engine reads the stretched file | stretch-cache | Per pick |

### The "needs" mechanism, as built

- **Main side:** `getStemAnalysisNeeds` takes paths and keys them by basename = StemCID. Per 500-path chunk it
  runs one IN query each against StemPeaksCache and StemEmbeddingCache, and one against StemFeatureCache
  (JSON-parsed in JS for `featureVersion` and `levelVersion`). It also runs one zero-shot eligibility join
  (it needs an ownDb Stems row).
- **A path with no rows needs everything.** That includes a path that isn't a library stem at all: these can
  never be persisted (see opportunity 6).
- **Renderer side:** `analyzeStemOnce` runs one read and one decode (shared through decodeStemFile's
  in-flight map). It installs each module's in-memory entry before decoding and computes only what is
  missing:
  - peaks and brightness, synchronously;
  - features in the worker, which also primes pitchCache;
  - the embedding, from the same buffer resampled to 16 kHz;
  - zero-shot for older embeddings;
  - the level-only pass (the `levelMeasured` session set).
- Results go to `analysisWriteQueue`: 10 stems or 1 s, then one `set-stem-analysis-results` IPC, then one
  time-budgeted main transaction.

## 2. Bundling opportunities, ranked by payoff

Disk I/O on the USB volume is weighted first, then sustained CPU, then memory.

**Overlap with the radio intensity arc work** (other agents, today):
- `traitQuantileCache.ts`, `discoverCandidates.ts`, `discoverAdjacency.ts` (commit 663aa099).
- `stemAnalysisNeeds.ts`, `analyzeStemOnce.ts`, `stemAnalysisResultsWriter.ts` (e0963118, 06761383).
- The radio plan's Task 14 (backfill measured) is still open.

Each item below says whether it touches those files. **Nothing proposed touches `DiscoverPanel.tsx` or
`src/shared/radio*`.**

### 1. One shared table signal per (db, table), and no COUNT on the read-only archive unless it moved

- **What's repeated:**
  - Up to seven independent caches (#13) each run their own `MAX(rowid), data_version, COUNT(*)` on the same
    external Riffs and Stems tables, each on its own 30 s clock.
  - On this archive the COUNT is **562 ms (Riffs) and 1,342 ms (Stems) cold**, synchronous on the main
    process. `MAX(rowid)` and `data_version` are about 0-4 ms.
  - With Discover or radio active, each 30 s window can hold several of these. The worst case, all cold, is
    about 2 × 0.56 s + 2-3 × 1.34 s, which is **3-5 s of uninterruptible main-thread time per 30 s**.
  - This is the same delivery-channel congestion that made radio changes land late
    (`radio-late-start-was-an-ordering-bug`).
  - At startup, Riffs is counted by: prewarm, listJamsWithDb, buildRiffIndex (on a rebuild), scanTargetCache
    `readLiveSignal`, and `canExtend`'s own `COUNT ... rowid > ?`.
  - Whether a given 30 s check is cold depends on how long ExFAT pages stay cached. The memory measured
    `listJamsWithDb` at 1,389 ms cold vs 41 ms warm.
- **Change:**
  - **(a)** Memoise `readTableSignal` per (db, table) for the 30 s check interval. Every cache's
    `isScanCacheCurrent` reads the same memo, so there is one COUNT per table per window instead of one per
    cache. Route `scanTargetCache.readLiveSignal` and `discoverArtistIndex.signalReader` through it.
  - **(b)** For a connection opened read-only (the external archive: `db.readonly`), take
    `MAX(rowid) + data_version` first, and run the COUNT only when either one moved.
    - Rows can only change on that file through another connection, and that moves `data_version`.
    - Keep COUNT for ownDb, where this process writes.
- **Risk:** low.
  - Pure plumbing in `tableChangeSignal.ts`; `isTableSignalCurrent`'s decision is unchanged.
  - Edge case: a foreign commit within the same 30 s window shows up up to 30 s later. That's already
    true per cache today.
- **Files:**
  - `src/main/tableChangeSignal.ts`
  - `src/main/scanTargetCache.ts`
  - `src/main/discoverArtistIndex.ts`
  - `src/main/riffLibraryStore.ts` (callers unchanged)
- **Radio-arc overlap:** none.
- **Verify:** add timing to the `sql:cache-check.*` counters (see "Counter gaps"), and compare one radio
  session before and after.

### 2. Stop the classifier redoing its unclassifiable residue every 10 minutes, and read masks from memory

- **What's repeated:**
  - At each 10-min safety wake, `getPendingState` finds both lists empty and rebuilds them from scratch.
  - The rebuild brings back the **20,426** embedded stems that neither classifier can place. The embedding
    axis is trained (8,507 refs), so they are ambiguous, not waiting on training.
  - Draining them takes 103 batches × 3 s, about **5 min of busy work out of every ~15 min**, for as long as
    the app is open with consent.
  - Each batch:
    - parses 200 × 11.3 KB EmbeddingJSON (2.3 MB);
    - runs about 200 × 8.5k × 1024 ≈ 1.7 G multiply-adds of cosine;
    - runs a 200-id `Stems.Instrument` IN query on each candidate db, **the external one on USB**.
  - Per hour that is about 82k re-classifications, about 0.9 GB of JSON re-parsed and about 400 USB index
    lookups, all to reach the answer of 10 minutes earlier.
  - The code's own comment says "the answer can't change until the training does", and training changes
    are already signalled (fingerprint, generation, centroid save).
- **Change:**
  - **(a)** Keep a session set of ids attempted under the current training key (fingerprint + generation).
    The safety rebuild adds only ids not yet attempted under that key. A training change clears the set,
    exactly as it now forces a rebuild. New rows still join through the wake path.
  - **(b)** `lookupInstrumentMasks` reads `Instrument` from discoverCandidates' in-memory instrument rows
    (already loaded at startup, #2) when it is current, and falls back to SQL. This needs a small exported
    lookup on that cache.
- **Risk:**
  - **(a)** low. A row written outside the stores is still caught by the safety rebuild: it's a new id.
  - **(b)** low-medium, because it adds a dependency from `stemAutoClassify.ts` on the instrument-row cache.
    Keep it behind a lookup function so `stemAutoClassify` stays testable.
- **Files:**
  - `src/main/stemAutoClassify.ts`
  - `src/main/stemAutoClassifyScheduler.ts`
  - `src/main/discoverCandidates.ts`, for (b) only: one exported read-only lookup. That file is shared with
    the radio arc, so coordinate.
- **Radio-arc overlap:** (a) none; (b) one small addition to `discoverCandidates.ts`.
- **Verify:** a new counter `auto-classify:rows-retried`. It should be 0 after the first drain.

### 3. Work out needs before checking existence; check only what needs work

- **What's repeated:** every DLS mount (each launch with consent) does all of this before it knows whether
  any stem needs anything:
  - loads all **979,842** cached pairs from ownDb;
  - resolves about 1M paths;
  - lists **1,967 folders** with synchronous `readdirSync` (1,359 on USB: about 0.5 s warm, and up to
    626 ms for one large folder cold);
  - sends about 146k+ targets over IPC (tens of MB structured-clone);
  - asks needs for every one in about 293 IPCs, which JSON-parses every FeaturesJSON again (88.7 MB, the
    second full parse of the session after #3).
- Once the level backfill finishes, almost all of it ends in "nothing to do".
- Because the check is by name, the **0-byte placeholders** (2,361 in the archive, per the 2026-10-01 note)
  pass it. Each session they are then read and warned about one by one.
- **Change:** new main-side `get-discover-library-scan-work`:
  - **(a)** In ownDb, where DiscoverScanTargetCache sits next to the cache tables, select the StemCIDs whose
    peaks, embedding or feature row is missing, using a SQL anti-join. Add the ones whose feature row is
    stale or level-less from the in-memory versions (opportunity 4), falling back to the existing JSON check.
  - **(b)** Check existence only for those, with `isUsableStemFile` (async stat or a per-folder listing), so
    placeholders drop out.
  - **(c)** Return `{ total, alreadyDone, work[] }` so the progress bar keeps its meaning.
- **Risk:** medium.
  - The progress semantics change.
  - The allowed-jams filter and the "first allowed pair decides the path" rule must be kept. Tests on
    `listLibraryScanTargets` cover the ordering.
  - Zero-shot eligibility needs the same join as today.
- **Files:**
  - `src/main/discoverLibraryStems.ts`
  - `src/main/scanTargetCache.ts`
  - `src/main/stemAnalysisNeeds.ts` (**radio-arc file**: its level logic must be kept as is)
  - `src/main/index.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/audio/DiscoverLibraryScan.tsx`
- **Radio-arc overlap:** `stemAnalysisNeeds.ts`. **Do it after Task 14** (the backfill measurement), so the
  level numbers aren't measured on a moving pipeline.

### 4. Rebuild the quantile tables from the in-memory value table; carry versions in it

- **What's repeated:**
  - **During the level backfill** (146,156 rows still to do), each level write counts as a "new-field write".
    That happens because a level-merged row carries the Phase 3 fields.
  - So every ~7.3k writes (5% of 146k) the next trait or intensity roll rebuilds the tables from SQL:
    **about 20 full rebuilds, each parsing all 88.7 MB of FeaturesJSON, about 1.8 GB in total**.
  - Each rebuild is **awaited inside `get-discover-candidates`**, which is a radio pick's path.
  - Every session also parses the same table twice: once at the startup prewarm (#3) and once in the DLS
    needs pages (#7).
- **Change:**
  - **(a)** When `getTraitValueTable(db)` is current, its columns are exactly the parsed rows:
    `applyWrite` keeps them in step with every write, including level merges. In that case `buildTables`
    takes each column's finite values plus `parsedRows = table.size`, with no SQL and no parse.
    - That is a sort of 8 columns × 146k, tens of ms.
    - Keep the SQL build for the first build and for when the table isn't current.
  - **(b)** Add `featureVersion` and `levelVersion` columns to TraitValueTable, so needs (and opportunity 3)
    can answer "current / needs level" without parsing.
- **Risk:** low-medium. Tests must prove the in-memory build gives identical tables to the SQL build.
  Malformed rows are already tracked separately.
- **Files:**
  - `src/main/traitQuantileCache.ts`
  - `src/main/stemAnalysisNeeds.ts`
  - `src/shared/traitQuantiles.ts` (unchanged API)
- **Radio-arc overlap:** both `traitQuantileCache.ts` and `stemAnalysisNeeds.ts` were changed today for
  intensity and level. **Hand (a) to the radio-arc agent or do it straight after its Task 14.** It directly
  affects pick timing during their backfill.

### 5. One main-process stem directory instead of three copies of StemCID → jam

- **What's repeated:**
  - DiscoverRiffIndexCache, DiscoverInstrumentRowsCache and DiscoverScanTargetCache all store the same
    relation, StemCID → owning jam (plus riff, bpm, instrument, slot): about **2.8M persisted rows** (843,828 + 972,964 + 979,842).
  - All three are loaded into separate in-memory structures every launch: two at startup, one on DLS mount.
    That is roughly a million JS objects that the main process holds twice over.
  - When the archive changes, three **separate full USB walks** run:
    - the riff index (Riffs, **LIMIT/OFFSET**, so each page re-skips everything before it);
    - instrument rows (Stems, LIMIT/OFFSET);
    - artist jam/user pairs (Stems, rowid keyset).
  - Only the scan-target cache extends incrementally (rowid watermark).
- **Change**, in two steps:
  - **Step A** (low risk, worth doing on its own):
    - Merge the two Stems walks (instrument rows #2 and jam/user pairs #10) into one keyset walk that
      selects `StemCID, Instrument, OwnerJamCID, CreatorUserName`.
    - Switch the riff index and instrument rows from OFFSET to keyset paging.
    - Give them scanTargetCache's rowid-watermark `extend`, instead of rebuilding when the count moves.
      Own-warehouse syncs move the count often.
  - **Step B** (medium-high risk):
    - Derive scan targets from the riff index (its first-riff jam per StemCID is the scan's
      first-allowed-pair in almost every case) and retire DiscoverScanTargetCache.
    - The one difference: a stem whose first riff's jam is filtered out but which appears in another allowed
      jam. Needs a decision.
- **Files:**
  - `src/main/discoverCandidates.ts` (**radio-arc file**)
  - `src/main/discoverIndexCache.ts`
  - `src/main/scanTargetCache.ts`
  - `src/main/discoverArtistIndex.ts`
  - `src/main/discoverJamUserPairsStore.ts`
  - `src/main/discoverLibraryStems.ts`
- **Radio-arc overlap:** `discoverCandidates.ts` (prewarm and riff-index functions only, not the candidate
  or intensity code).

### 6. Don't embed placed stems that can never be stored

- **What's repeated:**
  - Imported rifffs are copied to `~/Music/sssketch Library/<groupId>/…`. Their basename is not a StemCID,
    so needs says "everything" for them.
  - So BFS runs **YAMNet inference + zero-shot for every placed non-library stem, every session**.
  - The writer then drops the results (`resolveStemCIDs`: not a library stem).
  - The only reader, `useCachedStemEmbeddings`, reads persisted rows only, so these embeddings are never
    used.
  - Peaks and features are used in-session, so they aren't wasted.
- **Change:**
  - `getStemAnalysisNeeds` resolves the chunk's StemCIDs against Stems (the same batched IN-query the
    writer already does) and answers `embedding: false, zeroShot: false` for non-library paths.
  - Optional, later: a path+mtime-keyed cache for non-library features.
- **Risk:** low.
- **Files:** `src/main/stemAnalysisNeeds.ts` (**radio-arc file**, a small and separate hunk)
- **Payoff:** CPU only, on local files. The heaviest per-stem work (inference) goes away for every imported
  stem on every launch.

### 7. One renderer scan queue instead of two loops

- **What's repeated:**
  - BFS and DLS each run 3-wide with a 500 ms gap, so **up to 6 reads and decodes plus 6 inference jobs
    run at once**, mostly random reads on the USB volume.
  - Placed stems compete with the library walk rather than going first.
  - Both fetch needs separately for the same placed stems; aSO's in-memory guards stop a double decode, so
    the cost is extra IPC and needs SQL only.
  - `warmStemCaches` adds an unbounded burst on project open.
- **Change:**
  - One scheduler with tiers: placed, then the artist queue, then the library walk. One gate, one
    concurrency cap of 3, and one `backgroundWorkRegistry` report (still split by kind for the indicator).
  - BFS and DLS become producers into it.
  - The artist event (`announceArtistScanQueued`) is unchanged, so DiscoverPanel isn't touched.
- **Risk:** medium (lifecycle: consent toggle, unmount, cancelled batches).
- **Files:**
  - `src/renderer/src/audio/BackgroundFeatureScan.tsx`
  - `src/renderer/src/audio/DiscoverLibraryScan.tsx`
  - a new `audio/backgroundAnalysisQueue.ts`
  - `src/renderer/src/App.tsx` (mount only)
- **Radio-arc overlap:** none.

### 8. Make interactive decodes count for the analysis, and keep what they compute

- **(a) Unanalysed stems shown by Discover or radio:**
  - These are often just downloaded. `getPeaks`'s own decode persists peaks only.
  - Features, level and embedding then wait for the next session's DLS (targets are listed once per
    mount), which is a second USB read and decode.
  - **Change:** when `getPeaks` decodes a library stem, also adopt features and level from the same buffer
    (worker, cheap), through the same adopt functions aSO uses. Leave the embedding for the scan, or run it
    when consent is on.
- **(b) Band energy and pitch contour are never persisted:**
  - So `warmStemCaches` (awaited on every project open and recover) and every PolarGlyph or pitch-line
    Waveform decode each stem again every session.
  - The feature extraction already computes band energy (not primed) and pitch (primed only on a fresh
    extraction).
  - **Change:**
    - prime `bandEnergyCache` from `analyzeStemSamples`' own result (no risk);
    - persist a compact band and pitch summary next to peaks (a schema decision; glyph resolution must
      survive);
    - bound `warmStemCaches` concurrency.
- **(c)** `BeatPicker.tsx` and `previewLoop.ts` decode inline, outside `decodeStemFile`, so they never share
  with `classifyStems`' decode of the same just-imported files. Route them through `decodeStemFile`.
  Low payoff: the files are local and freshly written.
- **Risk:** (a) medium, because it adds work to an interactive path during radio; (b) and (c) low.
- **Files:**
  - `audio/peakCache.ts`, `audio/stemFeaturesCache.ts`, `audio/bandEnergyCache.ts`
  - `audio/warmStemCaches.ts`
  - `src/shared/stemAnalysis.ts` (returns band energy; read-only to the radio arc, which uses its level part)
  - `components/BeatPicker.tsx`, `audio/previewLoop.ts`
- **Radio-arc overlap:** `stemAnalysis.ts` is shared. Only an additive field.

### 9. The mask kind index rebuilds on every classification write

- **What's repeated:**
  - `readClassificationSignature` moves on any StemAutoCategory write: classifier passes, and zero-shot
    rows from scan flushes (about once a second while zero-shot work is pending).
  - So the next roll or pick rebuilds the index: a JS pass over 972,964 instrument rows plus full reads of
    StemCategories and StemAutoCategory.
  - Auto guesses only ever add `guess` admissions, for stems the mask can't place.
- **Change:** apply StemAutoCategory writes as deltas to the cached index (the writer knows StemCID and
  role), or rebuild for `guess` changes at most once per N seconds. Confirmations still force a rebuild.
- **Risk:** medium.
- **Files:** `src/main/discoverCandidates.ts` (**radio-arc file**), `src/main/stemAutoCategoryStore.ts`
- **Payoff:** CPU on the pick path while the classifier or the scan runs.

### Minor (not worth a task by themselves)

- **Startup sync work before the window:**
  - `backfillStemCategoriesFromProjectLibrary` parses all 51 project files (8 MB) every launch;
  - `migrateEndlesssStemCache` lists the old source dirs every launch.
  - Gate both on a done-flag or mtime.
- **`getArtistAnalysed`** recounts every chunk whenever StemFeatureCache's count moves, which is every
  picker poll while scanning. It could reuse the trait value table's `rowOf`.
- **Loop folder rescans** `stat` every file serially after a `readdir` that already gave Dirents. Parallel or
  bounded stats on the USB volume would help. Interactive only.
- **`tidyUpLibraryStems`** builds its own `createDirListingExists` per call. With opportunity 3 a shared
  per-session "on disk" set could serve both (plus `listRiffs`' per-stem `isUsableStemFile`).

## 3. Already bundled; keep as is

- **`analyzeStemOnce`:** one read and one decode for peaks + features + embedding + zero-shot + level. The
  in-memory entries are installed before the decode. Correct and measured. The level backfill riding it
  (1 decode per level-only stem) is the cheapest possible shape for that pass.
- **`decodeStemFile`'s in-flight sharing:** no buffer retention, by design (the 4 GB heap incident).
- **`get-stem-analysis-needs` batching** (A3) and the **B7 write queue** with time-budgeted transactions.
  B5 (zero-shot folded into needs) removed the old retroactive scan.
- **The classifier's pending lists, wake signals and sleep** (B4). Only the safety-rebuild residue behaviour
  needs fixing (opportunity 2), not the design.
- **The scan-target cache's rowid-watermark extension** (B6). It's the model the other persisted indexes
  should copy (opportunity 5A).
- **The TraitValueTable for rolls and intensity** (B1). It's the in-memory source opportunity 4 builds on.
- **`peakCache` peaks + brightness from one decode, and `phraseCache` envelope + brightness from one decode.**
- **Serving the artist queue from the library scan loop** rather than through a third scanner.
- **The consent gating:** DLS mounts only with consent; the classifier re-reads consent every tick. Any
  bundling must keep both, and opportunity 7's queue must drop the library tier when consent goes off.
- **The 8 ms time-sliced yields** in `listLibraryScanTargets` and `loopFolderScan`.

## Counter gaps

Add these before measuring opportunities 1-4. All dev-only, like the rest.

- `sql:cache-check.<table>` counts calls but not time. Add `ms:signal.<table>` (summed ms) so the COUNT cost
  shows up.
- No counter for the startup prewarm loads, or for folder listings: add `prewarm:rows-loaded.<cache>` and
  `fs:readdir`.
- The classifier counts batches, not rows re-attempted: add `auto-classify:rows-retried` and
  `auto-classify:rebuild`.
- `sql:trait-quantile.page` counts pages, so a rebuild's cost needs `trait-quantile:rebuild` and its ms.

## Suggested order

| Order | Opportunities | Why |
|---|---|---|
| 1 | 1 and 2 | Highest payoff, no radio-arc overlap except 2(b)'s one lookup |
| 2 | 6 and 4(a) | Small; coordinate with the radio-arc agent; 4(a) is best done before or as part of its Task 14 |
| 3 | 3 (with 4(b)), then 7 | |
| 4 | 5A, then 8, then 9 | 5B only if memory turns out to matter after 5A |

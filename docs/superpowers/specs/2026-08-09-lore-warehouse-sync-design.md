# Replacing the Endlesss Sync Index with an OUROVEON-Style LORE Warehouse — Design

**Status:** Drafted through the brainstorming skill with Elling, in stages, across one session.
Elling pushed the scope further at each checkpoint — starting from "extract just the resumable
JamFullSnapshot idea," then "replace our index, the bigger one," then "go all in, it's much more
mature than our code" — landing here: a full SQLite warehouse schema modeled on OUROVEON's, with
a full OUROVEON-style task-queue sync architecture (adapted to TypeScript/Node, not a literal
C++ port), fully replacing sssketch's current flat-JSON sync index. Architecture and data flow
were approved section-by-section during brainstorming; this doc also covers the remaining
sections (error handling, favourites/external-warehouse compatibility, testing) that were
presented after Elling stepped away with explicit instruction to proceed.

## Background

sssketch already has two separate, disconnected pieces of Endlesss-history machinery:

1. **`endlesssSyncIndex.ts` + `endlesssSync.ts`** — sssketch's own, current, ahead-of-time sync
   (shipped this session, see `2026-08-07-endlesss-stem-reliability-design.md` Part B). Flat
   per-source JSON index files, page-walking sync that stops at the first already-known riff
   boundary. Works, but has real structural gaps: no way to know if a specific riff/stem's
   *detail* was ever actually fetched (vs. just its ID being known), no permanent-failure
   tracking (a bad ID gets retried forever, or a transient failure looks identical to a
   permanent one), and the boundary-stop resume strategy breaks if a jam is edited/reordered
   upstream.
2. **`loreWarehouse.ts`** — a *reader* for an externally-built OUROVEON `warehouse.db3`, already
   shipped, already using `better-sqlite3`. This already proves the dependency and the reading
   side of the SQLite approach; the design below is really about closing the loop and making
   sssketch able to *write* that same schema itself, not just read someone else's.

Both are also each backing their own separate browser component (`EndlesssLibraryBrowser.tsx`
for the direct-API path, `LoreLibraryBrowser.tsx` for the external-warehouse path) — Elling
confirmed these should merge into one once there's a single underlying data source.

Meanwhile, real research into OUROVEON's actual C++ source (`toolkit.warehouse.cpp`, 3600+
lines) showed its sync isn't a bigger version of sssketch's page-walk — it's a fundamentally
different design: a SQLite-native, NULL-column-as-resume-state, priority task queue. That
mechanism directly solves the structural gaps above (see Non-goals below for what's explicitly
*not* being replicated), which is why the design converged on adopting it rather than patching
the page-walk approach further.

## Goals

- One local SQLite warehouse (schema modeled on OUROVEON's, since `loreWarehouse.ts` already
  reads that shape) that sssketch's own sync builds and maintains for a person's own shared feed
  and private jam(s) — the same two-source scope the current sync already targets, not widened.
- Resumability and gap-filling driven entirely by the database's own state (`NULL` columns =
  "not yet fetched") — no separate JSON/in-memory bookkeeping to keep in sync with reality.
- A single priority task queue that both bulk backlog-filling and live on-click browsing feed
  into, so clicking an unsynced riff jumps its detail fetch ahead of whatever bulk sync is
  already running, instead of the two paths being disconnected.
- One merged browser component reading one data source, replacing `EndlesssLibraryBrowser.tsx`
  and `LoreLibraryBrowser.tsx`.
- Real, permanent tracking of "this ID will never resolve," distinct from "this fetch failed
  once, try again later."
- Existing favourites and the existing external-warehouse folder-picker both keep working.

## Non-goals

- **Not a literal C++ port.** OUROVEON's task queue runs on real OS threads
  (`ITask`/`INetworkTask` dispatched across a thread pool); sssketch's version is a single-process
  async priority queue using the existing `runWithConcurrency` concurrency-cap pattern already in
  `endlesssSync.ts`. Same resumability semantics, different (and simpler, for a Node process)
  concurrency mechanism.
- **Not widening scope beyond the two existing sources.** No public/community jam discovery, no
  arbitrary-user browsing — same shared-feed + private-jam(s) boundary the current sync already
  enforces.
- **Not touching `loreWarehouse.ts`'s read side.** It already reads this exact schema against an
  externally-built warehouse; this design only adds a *writer*. The external-warehouse
  folder-picker path stays read-only and untouched (see Favourites + external-warehouse
  compatibility below).
- **Not a general-purpose Endlesss API client rewrite.** `endlesssApi.ts`'s existing
  auth/session/login logic is reused as-is; only the sync/index layer built on top of it changes.

## Architecture

```
EndlesssLibraryBrowser.tsx (merged, replaces both existing browsers)
        |
        | listSharedFeed / listRiffsInJam / resolveJamRiff
        v
loreWarehouseSync.ts (new)              <-- reads/writes -->   warehouse.db3 (sssketch's own,
  - TaskQueue (priority, async,                                 at <userData>/lore-warehouse/)
    runWithConcurrency-based)
  - JamSnapshotTask / RiffDataTask /
    StemDataTask
  - dispatcher: polls for NULL-column
    gaps, enqueues fill tasks
        |
        | HTTP (existing session/auth)
        v
endlesssApi.ts (unchanged: login, session, raw fetch helpers)
```

`loreWarehouse.ts` (the existing reader) continues to serve the external-warehouse-folder-picker
path unmodified, pointed at a user-chosen external `warehouse.db3`. The new
`loreWarehouseSync.ts` is a separate module that both reads and writes sssketch's *own*
self-built warehouse at a fixed default path — the two never point at the same file
simultaneously in normal operation (see Favourites + external-warehouse compatibility).

## Data flow

**Schema** (SQLite, matching what `loreWarehouse.ts` already reads, plus what's needed for
resumability):

```sql
CREATE TABLE Jams (JamCID TEXT PRIMARY KEY, PublicName TEXT NOT NULL);
-- shared feed = a real row: JamCID = 'shared:<username>', PublicName = 'Shared Feed'

CREATE TABLE Riffs (
  RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
  CreationTime INTEGER, Root INTEGER, Scale INTEGER,
  BPMrnd REAL, BarLength INTEGER, UserName TEXT,
  StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
  StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT,
  GainsJSON TEXT,
  AppVersion INTEGER  -- NULL = detail not yet fetched. The "incomplete" flag.
);

CREATE TABLE Stems (
  StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
  CreationTime INTEGER,  -- NULL = not yet fetched, same pattern
  FileEndpoint TEXT, FileBucket TEXT, FileKey TEXT,
  BPMrnd REAL, Instrument INTEGER, BarLength REAL,
  PresetName TEXT, CreatorUserName TEXT
);

CREATE TABLE Tags (RiffCID TEXT, OwnerJamCID TEXT, Favour INTEGER, Note TEXT);
-- replaces riffFavourites.ts's JSON store

CREATE TABLE StemLedger (StemCID TEXT, Type TEXT, Note TEXT);
-- permanently-bad references, stop retrying (see Error handling)
```

`root`/`scale` are already parsed by `endlesssApi.ts` (lines 298-299) but currently only
resolved to a display string; this schema is the reason to also persist the raw ints.

**Task types**, all dispatched through the one priority queue:

- `JamSnapshotTask(jamCID)` — one full-jam-listing call gets every riff ID in the jam,
  `INSERT OR IGNORE` skeleton rows into `Riffs`.
- `RiffDataTask(jamCID, riffCIDs[])` — batch-fetches riff docs, `UPDATE Riffs SET ...`,
  discovers and skeleton-inserts any new `Stems` rows along the way.
- `StemDataTask(jamCID, stemCIDs[])` — batch-fetches stem docs, `UPDATE Stems SET ...`.
- A dispatcher polls `WHERE AppVersion IS NULL LIMIT 40` / `WHERE CreationTime IS NULL LIMIT 40`
  (excluding anything already in `StemLedger`, see Error handling) for gaps and enqueues fill
  tasks — this is the entire "resume" mechanism; there is no separate resume state to track
  outside the database itself.

**Live browsing also feeds the queue**: `listSharedFeed`/`listRiffsInJam`'s own listing calls
skeleton-insert rows too, not just `JamSnapshotTask` — so clicking a riff that's never been
synced still gets a real DB row immediately, and clicking it enqueues its `RiffDataTask` at high
priority, ahead of whatever bulk backlog is already running.

## Error handling

- `StemLedger` is the "give up" table (mirrors OUROVEON's damaged-reference handling): a fetch
  failure that's clearly permanent — a 404, or a doc that resolves to something structurally
  wrong (e.g. a chat-message ID where a stem ID was expected) — writes a `StemLedger` row, and
  the dispatcher's gap query excludes ledgered IDs, so a permanently-bad reference is tried once,
  not forever. A *transient* failure (timeout, network blip, rate-limit) does **not** write to
  `StemLedger` — the row just stays `NULL` and is picked up again on the next dispatch cycle.
  This distinction matters: conflating "unfetchable" with "try later" would either spin forever
  on dead IDs or silently stop retrying real ones.
- Rate limiting: a short randomized sleep between dispatched network tasks (matching OUROVEON's
  ~250–750ms), plus the bounded-retry-with-matching-headers logic already shipped this session
  for stem CDN downloads (`downloadMissingStemsFor`) carries over into `StemDataTask` /
  `RiffDataTask` unchanged.
- The malformed-data repairs surfaced in the OUROVEON research — endpoint-string corruption
  stripping, key-from-URL fallback when a stem doc's key field is missing, hyphen-escaping for
  personal-jam CouchDB IDs — port directly into the new row-mapping functions
  (riff-doc-to-`Riffs`-row, stem-doc-to-`Stems`-row). This is the actual hard-won value
  independent of the architecture choice: without it, a warehouse column ends up silently wrong
  rather than correct.

## Favourites + external-warehouse compatibility

- `riffFavourites.ts`'s existing JSON favourites are migrated into `Tags.Favour` once, the first
  time the new warehouse initializes — a straight one-way copy, since the existing format is
  simple (a set of favourited riff CIDs) and this is early beta with realistically one real
  user's data to carry over. `riffFavourites.ts` itself is removed once the migration ships.
- The existing external-warehouse folder-picker (pointing `loreWarehouse.ts` at a real,
  externally-managed OUROVEON `warehouse.db3`) keeps working exactly as today, **read-only** —
  sssketch's own sync never writes into a warehouse it didn't create itself, so there's no risk
  of sssketch corrupting a file the real OUROVEON app is managing. sssketch's self-built
  warehouse lives at its own fixed path, `<userData>/lore-warehouse/warehouse.db3`, distinct
  from whatever external path a user might separately point at. The merged browser's data
  source is therefore a small runtime choice — sssketch's own warehouse by default, or a
  user-chosen external one if they've picked one via the existing folder-picker — not a schema
  difference, since both are the same shape.

## Testing

- Task-queue dispatch logic (priority ordering, `NULL`-column gap-finding, concurrency capping)
  is pure/testable with an injectable `fetchImpl` against a real tmp-file SQLite DB, matching
  this codebase's established convention for electron-adjacent-but-not-electron-dependent logic
  (see `pluginCatalog.test.ts`, `bandEnergyCache.test.ts`).
- Each OUROVEON-derived data-repair fixup (corrupted endpoint, missing key, chat-message-as-
  stemCID rejection, hyphen-escaping) gets its own regression test — each grounded in something
  OUROVEON's real source had to defend against, not a hypothetical.
- Favourites migration gets a test against real fixture JSON, asserting the resulting `Tags`
  rows and that a second run doesn't double-migrate.
- `endlesssSync.test.ts` / `endlesssSyncIndex.test.ts` are removed and replaced with tests for
  the new `loreWarehouseSync.ts`. `loreWarehouse.test.ts` (currently 35 read-only tests against a
  fixture warehouse) extends to cover the new write-side functions, reusing the same fixture
  approach.
- React changes (the merged browser component) are verified via typecheck + lint + manual
  walkthrough only, per this codebase's established convention — no GUI test tooling exists in
  this environment.

## Migration of existing code

- `endlesssSyncIndex.ts`, `endlesssSync.ts`, and `riffFavourites.ts` are removed once the new
  warehouse sync ships and the favourites migration runs — not kept alongside as dead code.
- `EndlesssLibraryBrowser.tsx` and `LoreLibraryBrowser.tsx` merge into one component reading the
  new warehouse (self-built or external, per the runtime choice above).
- `loreWarehouse.ts`'s existing read functions are reused as-is for reading sssketch's own
  self-built warehouse too, since it's the same schema — no fork needed between "reading an
  external warehouse" and "reading our own."

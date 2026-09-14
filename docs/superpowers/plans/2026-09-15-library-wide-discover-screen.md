# Library-Wide Discover Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "discover" tab inside `LibraryBrowser.tsx` — an Upcycle-style slot-based loop
builder (one stem per arrange-role slot, lock/reroll per slot, reroll-all, a chaos↔safe
looseness control) that pulls candidates from the whole synced library and can commit the
built loop onto the current timeline in one undo step.

**Architecture:** A new library-wide candidate query (`src/main/discoverCandidates.ts`) scans
every synced jam's `Riffs`/`Stems`, joined against the OWN database's `StemCategories` (role)
for every candidate regardless of which db the jam's own rows live in — this mirrors a real bug
fixed earlier this session (`StemCategories`/`StemEmbeddingCache` only ever exist in the own
db, never an external LORE archive). A pure, testable weighted-top-K selector
(`src/shared/discoverRanking.ts`) turns that candidate list into what "reroll" actually picks,
driven by the Chaos↔Safe slider. A new `DiscoverPanel.tsx` component renders inside
`LibraryBrowser.tsx`'s existing modal as a second tab, using the already-shipped `PolarGlyph`
component for each slot's radial waveform. Placement is a new batch reducer action
(`PLACE_LOOP_ON_TIMELINE`), following the exact precedent `ASSIGN_STEMS_TO_BUS` already
established for "N items, one undo step."

**Tech Stack:** TypeScript, React, Electron (main + renderer + preload IPC), better-sqlite3,
Vitest — no new dependencies.

**Known simplification, stated plainly rather than silently dropped:** sssketch's own project
state (`AppState`) has no normalized key/root/scale field — only individual placed `Rifff.key`
free-text display strings (`"E Minor (Aeolian)"`, LORE-imports only), and there is no existing
parser from that string back to the `Riffs.Root`/`Riffs.Scale` integers the library's own SQL
schema stores (only the reverse, `resolveKeyName(root, scale): string`,
`shared/riffLibraryTypes.ts:229`). Building that parser is out of scope here — it wasn't asked
for, and a fragile string round-trip is worse than not matching key at all. **v1's compatibility
ranking scores BPM closeness + role diversity + hand-confirmed-category priority only; key
matching is a known, explicitly-deferred gap**, not a silently-faked "always compatible."

**Known scope decision:** §8.3's own spec text says "stems with at least a role guess." The
candidate pool this plan builds is every stem with a real `StemCategories` row — i.e. every
stem a human has EVER confirmed a bus/role for, anywhere in the library (via Tidy Up,
Auto-Arrange, or the historical backfill) — not a live `resolveStemRole` computation run
library-wide at query time (computing SoundType/PresetName guesses for a 52k+-stem library on
every reroll would be far too slow, and this spec's own Non-goals rule out a manual
`StemCategories` editing UI, meaning it is already, by construction, "confirmed by normal use,"
never a raw auto-guess). This is a good v1 scope, not a compromise: it directly implements §4's
own "prioritize stuff that's categorized by hand."

---

### Task 1: Library-wide candidate query

**Files:**
- Create: `src/main/discoverCandidates.ts`
- Test: `src/main/discoverCandidates.test.ts`

**Before you start:** re-read `src/main/riffLibraryStore.ts`'s `listJams` (:208-222),
`dbForJam` (:191-193), `resolveStemPath` (:167-182), and `listRiffs`'s own `StemCID_1..8`
unpacking loop (:324-328) fresh — this task's own query reuses all four exactly, not a
paraphrase. Also re-read `src/main/stemCategoriesStore.ts`'s `getStemCategory` (:147-174) and
`src/main/embeddingMatch.ts` in full — both were touched THIS session (the latter fixed today,
commit `14505a0`, specifically because it queried `StemCategories` against a db that might not
have that table at all). This task's own db-per-candidate handling must not repeat that bug:
**`StemCategories` is looked up ONLY against `openOwnRiffLibraryDb()`, regardless of which db a
candidate's own `Riffs`/`Stems` rows came from** (a jam's raw content can live in an external
LORE archive db via `dbForJam`; its human-confirmed category never can).

- [ ] **Step 1: Write the failing test**

```ts
// src/main/discoverCandidates.test.ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { getDiscoverCandidates } from './discoverCandidates'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Jams (JamCID TEXT PRIMARY KEY, PublicName TEXT);
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      Root INTEGER, Scale INTEGER, BPMrnd REAL, BarLength INTEGER, UserName TEXT,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT,
      GainsJSON TEXT, AppVersion INTEGER
    );
    CREATE TABLE Stems (
      StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      FileEndpoint TEXT, FileBucket TEXT, FileKey TEXT, BPMrnd REAL,
      Instrument INTEGER, Length16s REAL, PresetName TEXT, CreatorUserName TEXT
    );
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
    );
  `)
  return db
}

function seedRiff(
  db: Database.Database,
  riffCID: string,
  jamCID: string,
  bpm: number,
  stemCIDs: string[]
): void {
  const cols = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `StemCID_${n}`)
  const values: Record<string, unknown> = {
    riffCID,
    jamCID,
    bpm,
    creationTime: 1000
  }
  cols.forEach((c, i) => {
    values[c] = stemCIDs[i] ?? null
  })
  db.prepare(
    `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, ${cols.join(', ')})
     VALUES (@riffCID, @jamCID, @creationTime, @bpm, ${cols.map((c) => '@' + c).join(', ')})`
  ).run(values)
}

function seedStem(
  db: Database.Database,
  stemCID: string,
  jamCID: string,
  fields: { presetName?: string; creatorUserName?: string; bpm?: number } = {}
): void {
  db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID, PresetName, CreatorUserName, BPMrnd)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    stemCID,
    jamCID,
    fields.presetName ?? 'test stem',
    fields.creatorUserName ?? 'elling',
    fields.bpm ?? null
  )
}

function seedCategory(
  db: Database.Database,
  stemCID: string,
  fields: { arrangeRole?: string; drumSubRole?: string; busId?: string }
): void {
  db.prepare(
    `INSERT INTO StemCategories (StemCID, ArrangeRole, DrumSubRole, BusId, Source, SourceProject, UpdatedAt)
     VALUES (@stemCID, @arrangeRole, @drumSubRole, @busId, 'tidyup', NULL, 1000)`
  ).run({
    stemCID,
    arrangeRole: fields.arrangeRole ?? null,
    drumSubRole: fields.drumSubRole ?? null,
    busId: fields.busId ?? null
  })
}

describe('getDiscoverCandidates', () => {
  it('returns only stems with a StemCategories row for the requested role', () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1', 's2'])
    seedStem(own, 's1', 'jam1')
    seedStem(own, 's2', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })
    // s2 has no StemCategories row at all -- excluded.

    const candidates = getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums'
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].stemCID).toBe('s1')
  })

  it('excludes a StemCategories row for a DIFFERENT arrangeRole', () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'bass', busId: 'bass' })

    expect(getDiscoverCandidates({ ownDb: own, jams: [{ jamCID: 'jam1', dbForJam: own }], arrangeRole: 'drums' })).toEqual([])
  })

  it('carries the owning riff\'s own BPM and jamCID/riffCID alongside each candidate', () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 140, ['s1'])
    seedStem(own, 's1', 'jam1', { presetName: '808 kick', creatorUserName: 'elling' })
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })

    const [c] = getDiscoverCandidates({ ownDb: own, jams: [{ jamCID: 'jam1', dbForJam: own }], arrangeRole: 'drums' })
    expect(c).toMatchObject({
      stemCID: 's1',
      riffCID: 'r1',
      jamCID: 'jam1',
      riffBpm: 140,
      presetName: '808 kick',
      creatorUserName: 'elling',
      arrangeRole: 'drums'
    })
  })

  it('looks up StemCategories ONLY against ownDb, even when a jam\'s own Riffs/Stems live in a different db', () => {
    const own = freshDb()
    const external = freshDb()
    // The candidate's raw Riffs/Stems rows live in the EXTERNAL db (an
    // external LORE archive) -- but its StemCategories confirmation, per
    // this codebase's own real convention (fixed commit 14505a0 today),
    // can only ever exist in the OWN db.
    seedRiff(external, 'r1', 'jamExt', 128, ['s1'])
    seedStem(external, 's1', 'jamExt')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })

    const candidates = getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jamExt', dbForJam: external }],
      arrangeRole: 'drums'
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].stemCID).toBe('s1')
  })

  it('does not throw when a jam\'s own db lacks StemCategories entirely (a real external archive)', () => {
    const own = freshDb()
    const external = new Database(':memory:')
    external.exec(`
      CREATE TABLE Riffs (
        RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
        BPMrnd REAL, StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
        StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT
      );
      CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT, PresetName TEXT, CreatorUserName TEXT, BPMrnd REAL);
    `)
    seedRiff(external, 'r1', 'jamExt', 128, ['s1'])
    seedStem(external, 's1', 'jamExt')

    expect(() =>
      getDiscoverCandidates({ ownDb: own, jams: [{ jamCID: 'jamExt', dbForJam: external }], arrangeRole: 'drums' })
    ).not.toThrow()
    expect(
      getDiscoverCandidates({ ownDb: own, jams: [{ jamCID: 'jamExt', dbForJam: external }], arrangeRole: 'drums' })
    ).toEqual([])
  })

  it('filters by ownership when onlyOwnStems is true, reusing computeOwnerFraction-equivalent per-stem authorship', () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1', 's2'])
    seedStem(own, 's1', 'jam1', { creatorUserName: 'elling' })
    seedStem(own, 's2', 'jam1', { creatorUserName: 'someone-else' })
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })
    seedCategory(own, 's2', { arrangeRole: 'drums', busId: 'drums' })

    const candidates = getDiscoverCandidates({
      ownDb: own,
      jams: [{ jamCID: 'jam1', dbForJam: own }],
      arrangeRole: 'drums',
      onlyOwnStems: true,
      targetUser: 'elling'
    })
    expect(candidates.map((c) => c.stemCID)).toEqual(['s1'])
  })

  it('aggregates candidates across multiple jams', () => {
    const own = freshDb()
    seedRiff(own, 'r1', 'jam1', 128, ['s1'])
    seedStem(own, 's1', 'jam1')
    seedCategory(own, 's1', { arrangeRole: 'drums', busId: 'drums' })
    seedRiff(own, 'r2', 'jam2', 130, ['s2'])
    seedStem(own, 's2', 'jam2')
    seedCategory(own, 's2', { arrangeRole: 'drums', busId: 'drums' })

    const candidates = getDiscoverCandidates({
      ownDb: own,
      jams: [
        { jamCID: 'jam1', dbForJam: own },
        { jamCID: 'jam2', dbForJam: own }
      ],
      arrangeRole: 'drums'
    })
    expect(candidates.map((c) => c.stemCID).sort()).toEqual(['s1', 's2'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/discoverCandidates.test.ts`
Expected: FAIL — `src/main/discoverCandidates.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/discoverCandidates.ts
import type Database from 'better-sqlite3'
import type { ArrangeRole, DrumSubRole } from '@shared/stemRole'

/** One library-wide candidate for a Discover slot -- a stem that ALREADY has
 * a human-confirmed StemCategories row for the requested ArrangeRole. See
 * this plan's own header for why the candidate pool is scoped to confirmed
 * rows only, not a live per-stem auto-guess. */
export interface DiscoverCandidate {
  stemCID: string
  jamCID: string
  riffCID: string
  presetName: string
  creatorUserName: string
  arrangeRole: ArrangeRole
  drumSubRole: DrumSubRole | null
  /** The OWNING RIFF's own BPM (Riffs.BPMrnd) -- the compatibility signal
   * this plan's own ranking (Task 3) actually scores against, since a
   * riff's BPM is always populated, unlike a stem's own (Stems.BPMrnd is
   * frequently null in real data -- LORE's own resolveRiff falls back to
   * the riff's BPM for exactly this reason, riffLibraryTypes.ts). */
  riffBpm: number
}

interface JamDbPair {
  jamCID: string
  dbForJam: Database.Database
}

interface RiffCandidateRow {
  RiffCID: string
  BPMrnd: number
  StemCID_1: string | null
  StemCID_2: string | null
  StemCID_3: string | null
  StemCID_4: string | null
  StemCID_5: string | null
  StemCID_6: string | null
  StemCID_7: string | null
  StemCID_8: string | null
}

/** Every stem, library-wide, already confirmed to the given ArrangeRole --
 * the data source Discover's own reroll (Task 3) samples from.
 *
 * `jams` is caller-supplied (not computed here) so this function stays a
 * pure-ish query over whatever set of {jamCID, db} pairs the caller already
 * resolved via listJams()/dbForJam() (riffLibraryStore.ts) -- keeps this
 * module free of any dependency on riffLibraryStore.ts's own module-level
 * "currently configured root" state, which makes it trivially testable
 * with in-memory dbs (see this file's own test).
 *
 * CRITICAL: StemCategories is looked up ONLY against `ownDb`, regardless of
 * which db a given jam's own Riffs/Stems rows live in (`dbForJam`) -- an
 * external LORE archive db never has a StemCategories table at all (fixed
 * commit 14505a0 today, after this exact assumption caused a real
 * "SqliteError: no such table" crash in getConfirmedEmbeddings). Never
 * repeat that mistake here. */
export function getDiscoverCandidates({
  ownDb,
  jams,
  arrangeRole,
  onlyOwnStems = false,
  targetUser
}: {
  ownDb: Database.Database
  jams: JamDbPair[]
  arrangeRole: ArrangeRole
  onlyOwnStems?: boolean
  targetUser?: string
}): DiscoverCandidate[] {
  const categoryStmt = ownDb.prepare(
    `SELECT ArrangeRole, DrumSubRole FROM StemCategories WHERE StemCID = ? AND ArrangeRole = ?`
  )
  const out: DiscoverCandidate[] = []

  for (const { jamCID, dbForJam } of jams) {
    let riffRows: RiffCandidateRow[]
    try {
      riffRows = dbForJam
        .prepare(
          `SELECT RiffCID, BPMrnd,
                  StemCID_1, StemCID_2, StemCID_3, StemCID_4,
                  StemCID_5, StemCID_6, StemCID_7, StemCID_8
           FROM Riffs WHERE OwnerJamCID = ?`
        )
        .all(jamCID) as RiffCandidateRow[]
    } catch {
      // A jam whose own db lacks even Riffs/Stems (shouldn't happen for a
      // real synced db, but this function is also exercised against
      // ad-hoc in-memory test dbs) -- skip rather than throw, same
      // resilience convention as getConfirmedEmbeddings' own corrupted-row
      // handling.
      continue
    }

    const stemStmt = dbForJam.prepare(
      `SELECT PresetName, CreatorUserName FROM Stems WHERE StemCID = ?`
    )

    for (const riff of riffRows) {
      const stemCIDs: string[] = []
      for (let slot = 1; slot <= 8; slot++) {
        const cid = riff[`StemCID_${slot}` as keyof RiffCandidateRow] as string | null
        if (cid) stemCIDs.push(cid)
      }
      for (const stemCID of stemCIDs) {
        let category: { ArrangeRole: string; DrumSubRole: string | null } | undefined
        try {
          category = categoryStmt.get(stemCID, arrangeRole) as
            | { ArrangeRole: string; DrumSubRole: string | null }
            | undefined
        } catch {
          // ownDb genuinely should always have this table -- but a test or
          // a not-yet-migrated db shouldn't crash the whole scan over one
          // missing table.
          continue
        }
        if (!category) continue

        const stemRow = stemStmt.get(stemCID) as
          | { PresetName: string | null; CreatorUserName: string | null }
          | undefined
        if (!stemRow) continue

        if (onlyOwnStems && stemRow.CreatorUserName !== targetUser) continue

        out.push({
          stemCID,
          jamCID,
          riffCID: riff.RiffCID,
          presetName: stemRow.PresetName ?? '',
          creatorUserName: stemRow.CreatorUserName ?? '',
          arrangeRole: category.ArrangeRole as ArrangeRole,
          drumSubRole: (category.DrumSubRole as DrumSubRole | null) ?? null,
          riffBpm: riff.BPMrnd
        })
      }
    }
  }

  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/discoverCandidates.test.ts`
Expected: PASS, 7/7.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/discoverCandidates.ts src/main/discoverCandidates.test.ts
git commit -m "$(cat <<'EOF'
Add getDiscoverCandidates: library-wide, per-role candidate query

Scans every given jam's Riffs (unpacking StemCID_1..8 the same way
listRiffs already does), joined against StemCategories for the
requested ArrangeRole -- but StemCategories is looked up ONLY against
the own db, regardless of which db a jam's own raw Riffs/Stems rows
live in, matching the real "no such table" bug fixed in
getConfirmedEmbeddings earlier this session (commit 14505a0).

Candidate pool is scoped to stems with a real, human-confirmed
StemCategories row -- not a live per-stem auto-guess across the whole
library, which would be far too slow to run on every reroll. This
directly implements the design spec's own "prioritize stuff that's
categorized by hand" (§4).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 2: `get-discover-candidates` IPC

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Before you start:** re-read `src/main/index.ts` around its `get-confirmed-embeddings` handler
(added this session, search for that string) and `candidateDbsForRiff`/`listJams` imports —
this task's handler needs `listJams` (`riffLibraryStore.ts`) and a per-jam `dbForJam`-equivalent
resolution. `dbForJam` itself is NOT exported from `riffLibraryStore.ts` (it's a private
function, confirmed by reading the file — only `listRiffs`/`listJams`/etc. are exported) — this
task adds a small exported wrapper rather than reaching past the module's own encapsulation.

- [ ] **Step 1: Export a `resolveJamDb` helper from `riffLibraryStore.ts`**

Add near `listJams` in `src/main/riffLibraryStore.ts` (the existing private `dbForJam` function
stays as-is; this is a new, separate exported wrapper so external callers don't reach into a
function named for one specific existing use):

```ts
/** Resolves every currently-synced jam to the db its own Riffs/Stems rows
 * actually live in -- Discover's own library-wide candidate query
 * (discoverCandidates.ts) needs exactly this {jamCID, db} pairing, and
 * `dbForJam` above is this module's own established per-jam resolution
 * logic, just not previously exposed outside this file. */
export function listJamsWithDb(): { jamCID: string; db: Database.Database }[] {
  return listJams('')
    .map((jam) => {
      const db = dbForJam(jam.jamCID)
      return db ? { jamCID: jam.jamCID, db } : null
    })
    .filter((pair): pair is { jamCID: string; db: Database.Database } => pair !== null)
}
```

- [ ] **Step 2: Add the IPC handler**

In `src/main/index.ts`, add the import alongside the other `riffLibraryStore` imports:

```ts
import { listJamsWithDb } from './riffLibraryStore'
import { getDiscoverCandidates } from './discoverCandidates'
import type { DiscoverCandidate } from './discoverCandidates'
```

Add the handler, near `get-confirmed-embeddings`:

```ts
  ipcMain.handle(
    'get-discover-candidates',
    (
      _event,
      arrangeRole: ArrangeRole,
      onlyOwnStems: boolean,
      targetUser: string
    ): DiscoverCandidate[] =>
      getDiscoverCandidates({
        ownDb: openOwnRiffLibraryDb(),
        jams: listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db })),
        arrangeRole,
        onlyOwnStems,
        targetUser
      })
  )
```

(`ArrangeRole` is already imported in `index.ts` from `@shared/stemRole` per this session's own
Plan B2 work — check before adding a duplicate import.)

- [ ] **Step 3: Expose in preload**

In `src/preload/index.ts`, add near `getConfirmedEmbeddings`:

```ts
  getDiscoverCandidates: (
    arrangeRole: ArrangeRole,
    onlyOwnStems: boolean,
    targetUser: string
  ): Promise<DiscoverCandidate[]> =>
    ipcRenderer.invoke('get-discover-candidates', arrangeRole, onlyOwnStems, targetUser),
```

(Import `DiscoverCandidate` from `@main/discoverCandidates` — check the existing preload
imports for whether main-process types are imported via a `@main` alias or a relative path;
match whatever convention `ConfirmedEmbedding`'s own import already uses in this same file.)

- [ ] **Step 4: Typecheck, lint, full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: no errors, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/main/riffLibraryStore.ts src/main/index.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
Add get-discover-candidates IPC

Exposes getDiscoverCandidates (Task 1) to the renderer, resolving
every synced jam to its own db via a new listJamsWithDb export
(riffLibraryStore.ts's existing private dbForJam, just not previously
exposed outside that file).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 3: Weighted-top-K reroll selection

**Files:**
- Create: `src/shared/discoverRanking.ts`
- Test: `src/shared/discoverRanking.test.ts`

**Before you start:** re-read `src/main/discoverCandidates.ts` (Task 1) for `DiscoverCandidate`'s
real shape. This task is pure logic with zero Electron/DB dependency, same convention as
`src/shared/embeddingMatch.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/discoverRanking.test.ts
import { describe, expect, it, vi } from 'vitest'
import { rankCandidates, pickReroll } from './discoverRanking'
import type { DiscoverCandidate } from '../main/discoverCandidates'

function candidate(overrides: Partial<DiscoverCandidate>): DiscoverCandidate {
  return {
    stemCID: 's1',
    jamCID: 'jam1',
    riffCID: 'r1',
    presetName: 'test',
    creatorUserName: 'elling',
    arrangeRole: 'drums',
    drumSubRole: null,
    riffBpm: 128,
    ...overrides
  }
}

describe('rankCandidates', () => {
  it('scores a candidate at the target BPM higher than one far from it', () => {
    const close = candidate({ stemCID: 'close', riffBpm: 128 })
    const far = candidate({ stemCID: 'far', riffBpm: 90 })
    const ranked = rankCandidates([far, close], { targetBpm: 128 })
    expect(ranked[0].candidate.stemCID).toBe('close')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('returns an empty ranking for an empty candidate list, never throwing', () => {
    expect(() => rankCandidates([], { targetBpm: 128 })).not.toThrow()
    expect(rankCandidates([], { targetBpm: 128 })).toEqual([])
  })

  it('scores every candidate identically when BPM is equidistant and nothing else differs', () => {
    const a = candidate({ stemCID: 'a', riffBpm: 120 })
    const b = candidate({ stemCID: 'b', riffBpm: 136 })
    const ranked = rankCandidates([a, b], { targetBpm: 128 })
    expect(ranked[0].score).toBeCloseTo(ranked[1].score, 5)
  })
})

describe('pickReroll', () => {
  it('always returns null for an empty ranked list', () => {
    expect(pickReroll([], 50)).toBeNull()
  })

  it('at chaos=0 (safest), always picks the single top-ranked candidate', () => {
    const ranked = [
      { candidate: candidate({ stemCID: 'best', riffBpm: 128 }), score: 1 },
      { candidate: candidate({ stemCID: 'worst', riffBpm: 60 }), score: 0.1 }
    ]
    // Run many times -- at chaos=0 the pool is exactly top-1, so there's
    // nothing to randomize; this must be deterministic, not "usually".
    for (let i = 0; i < 20; i++) {
      expect(pickReroll(ranked, 0)?.stemCID).toBe('best')
    }
  })

  it('at chaos=100 (loosest), can pick a candidate other than the top-ranked one', () => {
    const ranked = Array.from({ length: 10 }, (_, i) => ({
      candidate: candidate({ stemCID: `c${i}`, riffBpm: 128 - i }),
      score: 1 - i * 0.05
    }))
    const picks = new Set<string>()
    // Seed Math.random deterministically across calls so this test isn't
    // flaky -- mock it to cycle through a fixed sequence covering the
    // full [0,1) range.
    const values = Array.from({ length: 20 }, (_, i) => i / 20)
    let call = 0
    vi.spyOn(Math, 'random').mockImplementation(() => values[call++ % values.length])
    for (let i = 0; i < 20; i++) {
      const pick = pickReroll(ranked, 100)
      if (pick) picks.add(pick.stemCID)
    }
    vi.restoreAllMocks()
    expect(picks.size).toBeGreaterThan(1)
  })

  it('never returns a candidate outside the ranked list', () => {
    const ranked = [
      { candidate: candidate({ stemCID: 'only-one', riffBpm: 128 }), score: 1 }
    ]
    for (const chaos of [0, 25, 50, 75, 100]) {
      expect(pickReroll(ranked, chaos)?.stemCID).toBe('only-one')
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/discoverRanking.test.ts`
Expected: FAIL — `src/shared/discoverRanking.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/discoverRanking.ts
import type { DiscoverCandidate } from '../main/discoverCandidates'

export interface RankedCandidate {
  candidate: DiscoverCandidate
  score: number
}

// How many BPM away from the target counts as "completely incompatible"
// (score floors at 0 past this) -- wide enough that a half-time/double-time
// match (off by a clean factor of 2) still scores something, narrow enough
// that a genuinely unrelated tempo doesn't rank alongside a close one.
const BPM_FALLOFF = 40

/** Scores every candidate by BPM closeness to the target -- see this plan's
 * own header for why key/root-scale matching isn't included (no existing
 * normalized "project's own target key" value to compare against). Returns
 * candidates in descending score order. Never throws; an empty input
 * returns an empty ranking. */
export function rankCandidates(
  candidates: DiscoverCandidate[],
  { targetBpm }: { targetBpm: number }
): RankedCandidate[] {
  return candidates
    .map((candidate) => {
      const bpmDistance = Math.abs(candidate.riffBpm - targetBpm)
      const score = Math.max(0, 1 - bpmDistance / BPM_FALLOFF)
      return { candidate, score }
    })
    .sort((a, b) => b.score - a.score)
}

// chaos=0 -> exactly the top 1 candidate (deterministic, "safe"). chaos=100
// -> up to the whole ranked list is eligible (loosest). Linear in between.
function poolSizeForChaos(rankedLength: number, chaos: number): number {
  const clamped = Math.max(0, Math.min(100, chaos))
  const size = Math.round(1 + (clamped / 100) * (rankedLength - 1))
  return Math.max(1, Math.min(rankedLength, size))
}

/** Picks one candidate from `ranked` (already sorted by rankCandidates,
 * descending score) for a reroll -- weighted toward the top of a pool
 * whose SIZE is controlled by `chaos` (0 = safest, only the single best
 * candidate is ever eligible; 100 = loosest, the whole ranked list is
 * eligible). Within the eligible pool, weights are inverse-rank (the top
 * of the pool is still more likely than the bottom of it, at every chaos
 * setting) rather than uniform, so "reroll" never feels like it ignores
 * the ranking entirely even at chaos=100. Returns null only for an empty
 * `ranked` list. */
export function pickReroll(ranked: RankedCandidate[], chaos: number): DiscoverCandidate | null {
  if (ranked.length === 0) return null
  const poolSize = poolSizeForChaos(ranked.length, chaos)
  const pool = ranked.slice(0, poolSize)
  if (pool.length === 1) return pool[0].candidate

  // Inverse-rank weighting: index 0 gets weight poolSize, the last gets
  // weight 1 -- a simple, stable-enough curve without needing to reason
  // about each candidate's own absolute score gaps.
  const weights = pool.map((_, i) => poolSize - i)
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  let roll = Math.random() * totalWeight
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return pool[i].candidate
  }
  return pool[pool.length - 1].candidate
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/discoverRanking.test.ts`
Expected: PASS, 8/8.

- [ ] **Step 5: Typecheck, lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/discoverRanking.ts src/shared/discoverRanking.test.ts
git commit -m "$(cat <<'EOF'
Add discoverRanking: BPM-scored candidates + chaos-weighted reroll pick

rankCandidates scores by BPM closeness to the project's own tempo
(key matching deferred -- see this plan's own header for why).
pickReroll samples from a top-K pool whose size the Chaos<->Safe
slider controls (chaos=0 -> deterministic top-1, chaos=100 -> the
whole ranked list eligible), weighted toward the top of that pool at
every setting so reroll never ignores the ranking entirely.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 4: Discover scan-consent settings persistence + IPC

**Files:**
- Create: `src/main/discoverSettingsStore.ts`
- Test: `src/main/discoverSettingsStore.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Before you start:** re-read `src/main/categoryCentroidStore.ts` in full — this task's own
`storePath`/`load`/`save` shape mirrors it exactly (sync `readFileSync`/`writeFileSync`, `app`
from `'electron'`, a small JSON file in `app.getPath('userData')`), scaled down to a
single-boolean settings file rather than a whole classifier store.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/discoverSettingsStore.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))

describe('discoverSettingsStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'discover-settings-test-'))
    const { app } = await import('electron')
    vi.mocked(app.getPath).mockReturnValue(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('defaults to not consented when no file exists yet', async () => {
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    expect(loadDiscoverSettings()).toEqual({ consentedToLibraryScan: false })
  })

  it('persists consent across a save/load round trip', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({ consentedToLibraryScan: true })
    expect(loadDiscoverSettings()).toEqual({ consentedToLibraryScan: true })
  })

  it('defaults to not consented (not a thrown error) when the file is corrupted', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({ consentedToLibraryScan: true })
    const { writeFileSync } = await import('fs')
    writeFileSync(join(dir, 'discoverSettings.json'), 'not valid json{{{', 'utf-8')
    expect(() => loadDiscoverSettings()).not.toThrow()
    expect(loadDiscoverSettings()).toEqual({ consentedToLibraryScan: false })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/discoverSettingsStore.test.ts`
Expected: FAIL — `src/main/discoverSettingsStore.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/discoverSettingsStore.ts
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface DiscoverSettings {
  /** Whether the user has explicitly agreed to the whole-library background
   * scan Discover needs for a real candidate pool (see design spec §8.5).
   * Defaults false -- Discover is still usable without it, just limited to
   * whatever the existing placed-stems-only BackgroundFeatureScan.tsx has
   * already analyzed from ordinary use. Never silently flipped true. */
  consentedToLibraryScan: boolean
}

const STORE_FILENAME = 'discoverSettings.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

const DEFAULT_SETTINGS: DiscoverSettings = { consentedToLibraryScan: false }

/** Mirrors categoryCentroidStore.ts's own loadCategoryCentroidStore -- an
 * empty/default result (never a thrown error), both when nothing has been
 * saved yet and when reading fails. */
export function loadDiscoverSettings(): DiscoverSettings {
  const path = storePath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<DiscoverSettings>
    return { consentedToLibraryScan: parsed.consentedToLibraryScan ?? false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadDiscoverSettings: failed to read ${path}: ${message}`)
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveDiscoverSettings(settings: DiscoverSettings): void {
  try {
    writeFileSync(storePath(), JSON.stringify(settings, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`saveDiscoverSettings: failed to write ${storePath()}: ${message}`)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/discoverSettingsStore.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Wire the IPC handlers**

In `src/main/index.ts`, add the import:

```ts
import { loadDiscoverSettings, saveDiscoverSettings } from './discoverSettingsStore'
import type { DiscoverSettings } from './discoverSettingsStore'
```

Add the handlers, near the other small settings-style handlers:

```ts
  ipcMain.handle('get-discover-settings', (): DiscoverSettings => loadDiscoverSettings())
  ipcMain.handle('set-discover-settings', (_event, settings: DiscoverSettings): void =>
    saveDiscoverSettings(settings)
  )
```

- [ ] **Step 6: Expose in preload**

In `src/preload/index.ts`:

```ts
  getDiscoverSettings: (): Promise<DiscoverSettings> => ipcRenderer.invoke('get-discover-settings'),
  setDiscoverSettings: (settings: DiscoverSettings): Promise<void> =>
    ipcRenderer.invoke('set-discover-settings', settings),
```

(Import `DiscoverSettings` alongside preload's other main-process type imports.)

- [ ] **Step 7: Typecheck, lint, full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: no errors, no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/main/discoverSettingsStore.ts src/main/discoverSettingsStore.test.ts src/main/index.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
Add discover scan-consent settings, persisted like busCentroids.json

Small JSON file in userData (consentedToLibraryScan: boolean),
defaulting false -- mirrors categoryCentroidStore.ts's own
read/write-with-safe-defaults shape. Nothing reads this to gate a
scan yet -- that lands with the consent prompt UI task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 5: `PLACE_LOOP_ON_TIMELINE` batch reducer action

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts`

**Before you start:** re-read `store.ts`'s `ASSIGN_STEMS_TO_BUS` action type (search for that
string) and its reducer case fully, plus `PASTE_RIFFF`'s own reducer case and
`pasteStemAction`/`pasteStemWindowAction` (`state/selectors.ts:579-668`) — this task's action
places SEVERAL whole new rifffs (one per Discover slot) in one dispatch/one undo step, not one
stem pasted into an existing rifff, so it's closer in shape to a batch of `PASTE_RIFFF`+
`PLACE_ON_TIMELINE` pairs than to `ASSIGN_STEMS_TO_BUS`'s own "mutate existing entries" shape --
confirm the exact current `PASTE_RIFFF` payload shape and `channelOf`/`channelOrder` handling in
its reducer case before writing this task's own reducer, since a fresh multi-stem loop needs the
same channel-assignment treatment a normal paste already gets, not a hand-rolled duplicate.

- [ ] **Step 1: Write the failing test**

```ts
// Add to src/renderer/src/state/store.test.ts, alongside the existing
// PASTE_RIFFF / ASSIGN_STEMS_TO_BUS test blocks (re-read those for the
// exact `initialState`-building helper this file's own tests already use,
// and reuse it rather than hand-building AppState from scratch).
describe('PLACE_LOOP_ON_TIMELINE', () => {
  it('adds one new rifff per loop stem, each on its own channel, in one action', () => {
    const state = initialState()
    const before = Object.keys(state.rifffs).length
    const next = reducer(state, {
      type: 'PLACE_LOOP_ON_TIMELINE',
      startBar: 4,
      stems: [
        {
          groupId: 'discover-drums',
          name: 'discover: drums',
          bpm: 128,
          barLength: 4,
          folderPath: '',
          stems: [{ slot: 1, author: 'elling', name: 'kick.wav', path: '/tmp/kick.wav', type: 'drums', durationSec: 2, barLength: 4 }]
        },
        {
          groupId: 'discover-bass',
          name: 'discover: bass',
          bpm: 128,
          barLength: 4,
          folderPath: '',
          stems: [{ slot: 1, author: 'elling', name: 'bass.wav', path: '/tmp/bass.wav', type: 'bass', durationSec: 2, barLength: 4 }]
        }
      ]
    })
    expect(Object.keys(next.rifffs).length).toBe(before + 2)
    expect(next.rifffs['discover-drums'].startBar).toBe(4)
    expect(next.rifffs['discover-bass'].startBar).toBe(4)
    expect(next.channelOf['discover-drums']).toBe('discover-drums')
    expect(next.channelOf['discover-bass']).toBe('discover-bass')
    expect(next.channelOrder).toEqual(
      expect.arrayContaining(['discover-drums', 'discover-bass'])
    )
  })

  it('is exactly one undo step for however many stems the loop has', () => {
    const state = initialState()
    const next = reducer(state, {
      type: 'PLACE_LOOP_ON_TIMELINE',
      startBar: 0,
      stems: [
        {
          groupId: 'a',
          name: 'a',
          bpm: 120,
          barLength: 4,
          folderPath: '',
          stems: [{ slot: 1, author: 'elling', name: 'a.wav', path: '/tmp/a.wav', type: 'drums', durationSec: 2, barLength: 4 }]
        },
        {
          groupId: 'b',
          name: 'b',
          bpm: 120,
          barLength: 4,
          folderPath: '',
          stems: [{ slot: 1, author: 'elling', name: 'b.wav', path: '/tmp/b.wav', type: 'bass', durationSec: 2, barLength: 4 }]
        },
        {
          groupId: 'c',
          name: 'c',
          bpm: 120,
          barLength: 4,
          folderPath: '',
          stems: [{ slot: 1, author: 'elling', name: 'c.wav', path: '/tmp/c.wav', type: 'notes', durationSec: 2, barLength: 4 }]
        }
      ]
    })
    const undone = reducer(next, { type: 'UNDO' })
    expect(Object.keys(undone.rifffs).length).toBe(Object.keys(state.rifffs).length)
  })

  it('never touches an existing placed rifff already on the timeline', () => {
    let state = initialState()
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: {
        groupId: 'existing',
        name: 'existing',
        bpm: 120,
        barLength: 4,
        folderPath: '',
        stems: [{ slot: 1, author: 'elling', name: 'x.wav', path: '/tmp/x.wav', type: 'drums', durationSec: 2, barLength: 4 }]
      }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'existing', startBar: 0 })
    const before = state.rifffs['existing']

    const next = reducer(state, {
      type: 'PLACE_LOOP_ON_TIMELINE',
      startBar: 8,
      stems: [
        {
          groupId: 'new',
          name: 'new',
          bpm: 120,
          barLength: 4,
          folderPath: '',
          stems: [{ slot: 1, author: 'elling', name: 'y.wav', path: '/tmp/y.wav', type: 'bass', durationSec: 2, barLength: 4 }]
        }
      ]
    })
    expect(next.rifffs['existing']).toEqual(before)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t PLACE_LOOP_ON_TIMELINE`
Expected: FAIL — action type doesn't exist yet.

- [ ] **Step 3: Add the action type**

In `store.ts`'s action union (alongside `ASSIGN_STEMS_TO_BUS`):

```ts
  | {
      type: 'PLACE_LOOP_ON_TIMELINE'
      /** Every slot's own full Rifff -- one groupId per Discover slot, each
       * carrying exactly one Stem (a Discover slot is always a single
       * stem, never a multi-stem group of its own). */
      stems: Rifff[]
      startBar: number
    }
```

- [ ] **Step 4: Add the reducer case**

Add near `PASTE_RIFFF`'s own reducer case, reusing this codebase's own established
`channelOrder`/`channelOf` assignment (every fresh rifff gets its own new channel, same as a
normal paste/shelf-drop does per `channelOf`'s own doc comment in `AppState`):

```ts
    case 'PLACE_LOOP_ON_TIMELINE': {
      const rifffs = { ...state.rifffs }
      const channelOf = { ...state.channelOf }
      const channelOrder = [...state.channelOrder]
      for (const rifff of action.stems) {
        rifffs[rifff.groupId] = { ...rifff, startBar: action.startBar }
        channelOf[rifff.groupId] = rifff.groupId
        channelOrder.push(rifff.groupId)
      }
      return { ...state, rifffs, channelOf, channelOrder }
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t PLACE_LOOP_ON_TIMELINE`
Expected: PASS, 3/3.

- [ ] **Step 6: Confirm undo works with zero extra code**

This reducer case needs NO entry in `TRANSIENT_ACTION_TYPES` (history.ts) — a normal, real edit
gets a checkpoint automatically, same as `PASTE_RIFFF`/`ASSIGN_STEMS_TO_BUS`. The test in Step 1
("is exactly one undo step...") already confirms this; no separate history.ts change is needed.

- [ ] **Step 7: Typecheck, lint, full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: no errors, no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "$(cat <<'EOF'
Add PLACE_LOOP_ON_TIMELINE: place several whole rifffs in one undo step

Follows ASSIGN_STEMS_TO_BUS's own established precedent for "N items,
one undo step" (commit 2fa4995) -- placing a Discover loop's several
slots via N separate PASTE_RIFFF/PLACE_ON_TIMELINE dispatches would
otherwise cost N undo steps for what should read as one build action.
Each slot's own Rifff gets its own fresh channel, same treatment a
normal paste/shelf-drop already gets.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 6: `LibraryBrowser.tsx` browse/discover tab switcher

**Files:**
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`
- Modify: `src/renderer/src/App.tsx`

**Before you start:** re-read `LibraryBrowser.tsx` fresh — specifically its own component
signature (`export function LibraryBrowser({ onClose, onImported }: {...})`, around line 163),
and its outer JSX root (`return (` around line 1298, the `900x600` fixed-size modal container,
the header row at ~1323-1347 with the plain `<span>library</span>` label + close button). This
plan was grounded against that exact shape as of this session — confirm it still matches (low
drift risk, this file hasn't been touched this session before now) before editing, since line
numbers may have shifted if anything upstream changed.

- [ ] **Step 1: Add a `currentSketch` prop**

`LibraryBrowser` doesn't currently receive the current project (`ProjectRef`) at all — Discover
needs it for the "place loop" IPC/dispatch and to match `ClusterStemsBrowser`'s own established
`currentSketch` prop convention. Update the component signature:

```ts
export function LibraryBrowser({
  onClose,
  onImported,
  currentSketch
}: {
  onClose: () => void
  onImported: (groupIds: string[], rifffs?: Rifff[]) => void
  currentSketch: ProjectRef
}): React.JSX.Element {
```

(Add `import type { ProjectRef } from '@shared/types'` if not already imported in this file —
check first, several other types are likely already imported from `@shared/types` here.)

In `src/renderer/src/App.tsx`, update the render call (currently `App.tsx:2184-2187`):

```tsx
        {riffLibraryOpen && (
          <LibraryBrowser
            onClose={() => setRiffLibraryOpen(false)}
            onImported={handleLibraryImported}
            currentSketch={currentSketch}
          />
        )}
```

- [ ] **Step 2: Add the tab-switcher state and UI**

Add near `LibraryBrowser`'s other top-of-component `useState` declarations:

```ts
  const [libraryMode, setLibraryMode] = useState<'browse' | 'discover'>('browse')
```

Replace the header row's static label with a tab switcher (same `buttonStyle`-per-toggle
convention `ClusterStemsBrowser.tsx`'s own buttons already use elsewhere in this app — sharp
corners, bright border+text when active, dim otherwise):

```tsx
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid var(--ra-border)'
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setLibraryMode('browse')}
              style={{
                fontFamily: 'inherit',
                fontSize: 10,
                padding: '3px 8px',
                background: libraryMode === 'browse' ? 'var(--ra-stretch-on-bg)' : 'transparent',
                border: `1px solid ${libraryMode === 'browse' ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
                color: libraryMode === 'browse' ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
                fontWeight: libraryMode === 'browse' ? 700 : 400,
                cursor: 'pointer'
              }}
            >
              browse
            </button>
            <button
              onClick={() => setLibraryMode('discover')}
              style={{
                fontFamily: 'inherit',
                fontSize: 10,
                padding: '3px 8px',
                background: libraryMode === 'discover' ? 'var(--ra-stretch-on-bg)' : 'transparent',
                border: `1px solid ${libraryMode === 'discover' ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
                color: libraryMode === 'discover' ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
                fontWeight: libraryMode === 'discover' ? 700 : 400,
                cursor: 'pointer'
              }}
            >
              discover
            </button>
          </div>
          <button
            onClick={onClose}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            close
          </button>
        </div>
```

- [ ] **Step 3: Gate the existing browse UI behind `libraryMode === 'browse'`**

Wrap everything from the existing `<EndlesssLoginPanel onStatusChange={setAuthStatus} />` line
through the end of the modal body (everything currently rendered inside the 900×600 container,
before its own closing `</div></div>`) in a fragment gated on `libraryMode === 'browse'`:

```tsx
        {libraryMode === 'browse' && (
          <>
            <EndlesssLoginPanel onStatusChange={setAuthStatus} />
            {/* ... every existing line of this component's own browse-mode
                body, completely unchanged, down through the end of the
                modal's own body content ... */}
          </>
        )}
        {libraryMode === 'discover' && (
          <DiscoverPanel currentSketch={currentSketch} />
        )}
```

Add the import: `import { DiscoverPanel } from './DiscoverPanel'` (created in Task 7 — this
task's own typecheck will fail until that file exists; that's expected and resolved by Task 7,
not a bug in this task).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: FAILS at this point — `./DiscoverPanel` doesn't exist yet (Task 7). This is expected;
do not attempt to make this task typecheck standalone by stubbing `DiscoverPanel` here — Task 7
immediately follows and resolves it. Record this task as DONE_WITH_CONCERNS if executed via
subagent-driven-development, noting the expected typecheck failure, rather than inventing a stub.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/LibraryBrowser.tsx src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
Add browse/discover tab switcher to LibraryBrowser

Discover lives as a second tab inside the existing Import modal
(LibraryBrowser.tsx), not a standalone gear-menu screen, per the
design spec's own §8.0. currentSketch is now threaded into
LibraryBrowser for the first time (previously unused by its own
browse-mode UI) since Discover's placement action needs it.

NOTE: this commit intentionally does not yet typecheck clean --
DiscoverPanel.tsx (imported here) lands in the very next task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 7: `DiscoverPanel.tsx` — slot state, PolarGlyph rendering, add/remove/lock

**Files:**
- Create: `src/renderer/src/components/DiscoverPanel.tsx`

**Before you start:** re-read `components/PolarGlyph.tsx` in full (already shipped, no changes
needed) and `components/ClusterStemsBrowser.tsx`'s own `buttonStyle` function (this file's own
per-slot lock/reroll buttons reuse that exact visual convention, sharp corners + bright-when-
active). Re-read `shared/stemRole.ts`'s `ARRANGE_ROLE_OPTIONS`/`ARRANGE_ROLE_TO_BUS` exports for
their real current shape (already established this session, low drift risk). Also re-read
`LibraryBrowser.tsx`'s own real single-riff import chain in full: `handleImport` (:1223-1233) →
`ensureStemsDownloaded` (:961-978, which calls
`window.rifffApi.riffLibraryDownloadMissingStems(riffCID)` only when some stem isn't cached
yet, a no-op otherwise) → `buildImportedRifff` (`audio/importResolvedRiff.ts:29-51`). A
`DiscoverCandidate` (Task 1) names a stem by `stemCID`/`riffCID` only — it carries no local
file path — so **`PolarGlyph` cannot render a slot's own radial waveform until that candidate's
real local path is resolved the same way**, reusing this exact download/resolve chain. This
resolution is needed here, at DISPLAY time (every slot that has a candidate), not only later at
placement (Task 11) — Task 11 reuses the SAME `resolveCandidateStem` function this task defines
below rather than a second copy.

- [ ] **Step 1: Define the slot type and component skeleton**

```tsx
// src/renderer/src/components/DiscoverPanel.tsx
import { useEffect, useState } from 'react'
import { PolarGlyph } from './PolarGlyph'
import { stemColorVar } from '../theme/typeColor'
import { ARRANGE_ROLE_OPTIONS, type ArrangeRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import type { ProjectRef, SoundType, Stem } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'

/** Resolves one Discover candidate down to a real, locally-downloaded
 * `Stem` -- reused verbatim by both this component's own slot-preview
 * rendering (Step 1 below) and Task 11's "plunk in arranger" placement,
 * since both need exactly the same download-then-resolve step, just for
 * different reasons (a radial-waveform preview vs. a real placed clip).
 * Downloads the candidate's own riff's missing stems on demand (same
 * `riffLibraryDownloadMissingStems` call `LibraryBrowser.tsx`'s own
 * `ensureStemsDownloaded` already makes) -- a candidate isn't guaranteed
 * to be cached locally just because it's in the library-wide index (Task
 * 1's own query reads DB metadata only, never touches the filesystem).
 * Returns null (never throws) for a riff that fails to resolve/download
 * (network hiccup, since-deleted riff) -- callers treat that the same as
 * "no candidate yet" rather than surfacing an error for what's ultimately
 * a soft, retryable failure (reroll picks something else regardless). */
async function resolveCandidateStem(
  candidate: DiscoverCandidate
): Promise<{
  author: string
  name: string
  type: SoundType
  path: string
  durationSec: number
  barLength: number
} | null> {
  const resolved = await window.rifffApi.riffLibraryResolveRiff(candidate.riffCID)
  if (!resolved) return null
  const withStems = resolved.stems.some((s) => s.path === null)
    ? ((await window.rifffApi.riffLibraryDownloadMissingStems(candidate.riffCID)) ?? resolved)
    : resolved
  const stem = withStems.stems.find((s) => s.stemCID === candidate.stemCID)
  if (!stem || stem.path === null) return null
  return {
    author: stem.creatorUserName,
    name: stem.presetName,
    type:
      instrumentMaskToSoundType(stem.instrumentMask) ??
      guessSoundTypeFromPresetName(stem.presetName) ??
      'fx',
    path: stem.path,
    durationSec: stem.durationSec,
    barLength: stem.barLength
  }
}

interface DiscoverSlot {
  id: string
  role: ArrangeRole
  locked: boolean
  candidate: DiscoverCandidate | null
}

let nextSlotId = 0
function freshSlotId(): string {
  nextSlotId += 1
  return `slot-${nextSlotId}`
}

export function DiscoverPanel({
  currentSketch
}: {
  currentSketch: ProjectRef
}): React.JSX.Element {
  const [slots, setSlots] = useState<DiscoverSlot[]>([])
  const [chaos, setChaos] = useState(35)

  function addSlot(role: ArrangeRole): void {
    setSlots((prev) => [...prev, { id: freshSlotId(), role, locked: false, candidate: null }])
  }

  function removeSlot(id: string): void {
    setSlots((prev) => prev.filter((s) => s.id !== id))
  }

  function toggleLock(id: string): void {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, locked: !s.locked } : s)))
  }

  return (
    <div style={{ padding: 10, overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>tight</span>
        <input
          type="range"
          min={0}
          max={100}
          value={chaos}
          onChange={(e) => setChaos(Number(e.target.value))}
        />
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>loose</span>
      </div>

      {slots.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--ra-text-2)', padding: 12 }}>
          add a slot below to start building a loop
        </div>
      )}

      {slots.map((slot) => (
        <DiscoverSlotRow
          key={slot.id}
          slot={slot}
          onToggleLock={() => toggleLock(slot.id)}
          onRemove={() => removeSlot(slot.id)}
        />
      ))}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }}>
        {ARRANGE_ROLE_OPTIONS.map((role) => (
          <button
            key={role}
            onClick={() => addSlot(role)}
            style={{
              fontFamily: 'inherit',
              fontSize: 9,
              padding: '4px 8px',
              background: 'transparent',
              border: '1px dashed var(--ra-border-strong)',
              color: 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            + {role}
          </button>
        ))}
      </div>
    </div>
  )
}

function DiscoverSlotRow({
  slot,
  onToggleLock,
  onRemove
}: {
  slot: DiscoverSlot
  onToggleLock: () => void
  onRemove: () => void
}): React.JSX.Element {
  // Resolves the slot's own candidate down to a real, locally-downloaded
  // Stem (resolveCandidateStem, defined above) -- PolarGlyph needs a real
  // on-disk path to decode (getBandEnergy/getPitchContour both read the
  // file directly), and a DiscoverCandidate carries no local path of its
  // own until resolved. Re-resolves whenever `slot.candidate` itself
  // changes identity (a fresh reroll) -- `cancelled` guards against a
  // stale, slower-resolving previous candidate's download completing
  // AFTER a newer reroll has already replaced it, same stale-response
  // guard convention as this session's own useStemFeatureScan.ts. An
  // empty slot, or one whose candidate hasn't resolved yet (still
  // downloading, or resolution failed), renders a plain placeholder ring
  // instead of calling PolarGlyph with nothing to analyze.
  const [resolvedStem, setResolvedStem] = useState<Stem | null>(null)

  useEffect(() => {
    let cancelled = false
    setResolvedStem(null)
    if (!slot.candidate) return
    void resolveCandidateStem(slot.candidate).then((stem) => {
      if (cancelled || !stem) return
      setResolvedStem({ slot: 1, ...stem })
    })
    return () => {
      cancelled = true
    }
  }, [slot.candidate])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 0',
        borderBottom: '1px solid var(--ra-border-soft)'
      }}
    >
      <button
        onClick={onToggleLock}
        title={slot.locked ? 'locked -- survives reroll all' : 'unlocked'}
        style={{
          fontFamily: 'inherit',
          fontSize: 9,
          padding: '3px 6px',
          background: slot.locked ? 'var(--ra-stretch-on-bg)' : 'transparent',
          border: `1px solid ${slot.locked ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: slot.locked ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        {slot.locked ? 'locked' : 'unlocked'}
      </button>
      <span style={{ fontSize: 9, color: 'var(--ra-text-3)', width: 64 }}>{slot.role}</span>
      {resolvedStem ? (
        <PolarGlyph stems={[resolvedStem]} identityColor={stemColorVar(resolvedStem)} size={40} />
      ) : (
        <div
          style={{
            width: 40,
            height: 40,
            border: '1px dashed var(--ra-border)',
            borderRadius: '50%'
          }}
        />
      )}
      <span style={{ fontSize: 9, color: 'var(--ra-text)' }}>
        {slot.candidate?.presetName ?? 'no candidate yet'}
      </span>
      <button
        onClick={onRemove}
        style={{
          marginLeft: 'auto',
          fontFamily: 'inherit',
          fontSize: 9,
          padding: '3px 8px',
          background: 'transparent',
          border: '1px solid var(--ra-border)',
          color: 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        remove
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and lint (LibraryBrowser.tsx should now resolve too)**

Run: `npm run typecheck && npm run lint`
Expected: no errors. This also resolves Task 6's expected failure.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
Add DiscoverPanel: slot state, PolarGlyph rendering, add/remove/lock

Slots are local component state (session-only persistence, per the
design spec's own explicit non-goal against Saved Sets). Each slot
renders its stem via the existing PolarGlyph component (radial
waveform, direct request) rather than a new visualization. Reroll
wiring (the actual candidate query + chaos-weighted pick) lands next.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 8: Reroll slot / reroll all — wiring the candidate query and ranking into the UI

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

**Before you start:** re-read `src/preload/index.ts`'s real exposed names for
`getDiscoverCandidates`/`getConfirmedEmbeddings` (Tasks 1-2) — confirm the exact
`window.rifffApi.*` call signature this step dispatches, since preload naming conventions in
this codebase are camelCase method names wrapping kebab-case IPC channel strings.

- [ ] **Step 1: Add per-slot reroll and a global reroll-all**

Extend `DiscoverPanel`'s own state/handlers (same file as Task 7):

```tsx
  const bpm = useAppSelector((s) => s.bpm)
  const [onlyOwnStems, setOnlyOwnStems] = useState(true)

  async function rerollSlot(id: string): Promise<void> {
    const slot = slots.find((s) => s.id === id)
    if (!slot) return
    const candidates = await window.rifffApi.getDiscoverCandidates(
      slot.role,
      onlyOwnStems,
      RIFF_LIBRARY_USERNAME
    )
    const ranked = rankCandidates(candidates, { targetBpm: bpm })
    const picked = pickReroll(ranked, chaos)
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, candidate: picked } : s)))
  }

  async function rerollAll(): Promise<void> {
    // Sequential, not Promise.all -- each slot's own reroll is a real IPC
    // round trip; running them one at a time keeps this simple and avoids
    // hammering the main process with N simultaneous full-library scans at
    // once for a loop with many slots. Locked slots are skipped entirely.
    for (const slot of slots) {
      if (!slot.locked) await rerollSlot(slot.id)
    }
  }
```

Add the imports:

```ts
import { useAppSelector } from '../state/StoreContext'
import { rankCandidates, pickReroll } from '@shared/discoverRanking'
import { RIFF_LIBRARY_USERNAME } from '@shared/riffLibraryTypes'
```

- [ ] **Step 2: Wire reroll buttons into the UI**

Add a "reroll slot" button to `DiscoverSlotRow` (pass `onReroll: () => void` as a new prop from
`DiscoverPanel`, called as `() => void rerollSlot(slot.id)`) and a "reroll all" button near the
Chaos↔Safe slider in `DiscoverPanel`'s own top row:

```tsx
      <button
        onClick={() => void rerollAll()}
        style={{
          fontFamily: 'inherit',
          fontSize: 9,
          padding: '4px 10px',
          background: 'var(--ra-stretch-on-bg)',
          border: '1px solid var(--ra-stretch-on)',
          color: 'var(--ra-stretch-on)',
          fontWeight: 700,
          cursor: 'pointer'
        }}
      >
        ⚄ reroll all
      </button>
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
Wire reroll slot / reroll all into DiscoverPanel

Reroll fetches this role's library-wide candidates (Task 1/2),
scores them against the current project's own BPM (Task 3), and
picks one via the Chaos<->Safe-weighted selector. Reroll all skips
every locked slot, sequential (not parallel) to avoid N simultaneous
full-library scans for a many-slot loop.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 9: Scan-consent prompt, progress indicator, settings-menu revoke toggle

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`
- Modify: `src/renderer/src/components/TransportBar.tsx`

**Before you start:** re-read `TransportBar.tsx`'s settings `ContextMenu` items array (search
`change riff archive location`) for the exact real pattern to extend.

- [ ] **Step 1: One-time consent prompt on first Discover open**

Add to `DiscoverPanel`, right after its existing state declarations:

```tsx
  const [settings, setSettings] = useState<{ consentedToLibraryScan: boolean } | null>(null)
  const [showConsentPrompt, setShowConsentPrompt] = useState(false)

  useEffect(() => {
    void window.rifffApi.getDiscoverSettings().then((s) => {
      setSettings(s)
      if (!s.consentedToLibraryScan) setShowConsentPrompt(true)
    })
  }, [])

  function acceptScanConsent(): void {
    const next = { consentedToLibraryScan: true }
    setSettings(next)
    setShowConsentPrompt(false)
    void window.rifffApi.setDiscoverSettings(next)
  }

  function declineScanConsent(): void {
    setShowConsentPrompt(false)
    // consentedToLibraryScan stays false -- nothing persisted here, so the
    // prompt shows again next time Discover opens, matching "ask again
    // rather than silently remember a decline forever."
  }
```

Add `import { useEffect } from 'react'` to this file's existing React import.

- [ ] **Step 2: Render the prompt and gate candidate fetching on it**

```tsx
      {showConsentPrompt && (
        <div
          style={{
            border: '1px solid var(--ra-border-strong)',
            padding: 12,
            marginBottom: 10,
            fontSize: 10,
            color: 'var(--ra-text-2)'
          }}
        >
          <p style={{ margin: '0 0 8px' }}>
            discover can analyze your whole synced library in the background to find
            compatible stems -- this can take a while and uses some cpu. analyze now?
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={acceptScanConsent} style={{ fontFamily: 'inherit', fontSize: 9, padding: '4px 8px' }}>
              yes, analyze
            </button>
            <button onClick={declineScanConsent} style={{ fontFamily: 'inherit', fontSize: 9, padding: '4px 8px' }}>
              not now
            </button>
          </div>
        </div>
      )}
```

`rerollSlot`/`rerollAll` (Task 8) already work off `getDiscoverCandidates`, which reads whatever
`StemCategories` rows already exist regardless of consent — consent gates the SEPARATE
whole-library `BackgroundFeatureScan`-style extraction pass that populates MORE of those rows
over time (Step 3 below), not this query itself. A declined user still gets real candidates from
ordinary Tidy Up/Auto-Arrange confirmations; they're just not actively growing via a new
library-wide scan.

- [ ] **Step 3: Mount the real scan, gated on consent**

The actual whole-library scan pass (target enumeration IPC + the throttled renderer-side scan
loop + the real "analyzed X of Y" progress indicator) is built in full in **Task 10**, which
immediately follows this one. This step just mounts it here, gated on consent:

```tsx
      {settings?.consentedToLibraryScan && <DiscoverLibraryScan />}
```

Add the import: `import { DiscoverLibraryScan } from '../audio/DiscoverLibraryScan'` (created in
Task 10 — this task's own typecheck will fail until that file exists; expected, matching Task
6's own "next task resolves this" pattern, not a bug in this task).

- [ ] **Step 4: Add the settings-menu revoke/re-enable toggle**

In `TransportBar.tsx`'s settings `ContextMenu` items array, add after `change riff archive
location…`:

```ts
            {
              label: discoverConsented ? 'turn off discover library scan' : 'turn on discover library scan',
              onClick: () => void toggleDiscoverConsent()
            },
```

This needs `discoverConsented: boolean` and `toggleDiscoverConsent: () => Promise<void>` passed
into `TransportBar` as new props (check its own current prop list first — this file already
takes many callback props for its settings menu items, e.g. `onShowWelcome`/`onStartTour`; add
these two alongside them, threaded from `App.tsx` the same way those are, reading/writing via
`window.rifffApi.getDiscoverSettings`/`setDiscoverSettings`).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: FAILS at this point — `../audio/DiscoverLibraryScan` (imported in Step 3) doesn't
exist yet (Task 10). This is expected, same "next task resolves this" pattern as Task 6's own
Step 4 — do not stub `DiscoverLibraryScan` here.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/components/TransportBar.tsx src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
Add discover scan-consent prompt + settings-menu revoke toggle

One-time prompt on first Discover open (declining just re-asks next
time, nothing persisted). Candidate fetching itself is never gated on
consent -- it already only reads existing StemCategories confirmations
regardless, and the scan doesn't create those rows either (only a
human confirming a role in Tidy Up/Auto-Arrange does). Consent
instead gates the real whole-library feature/embedding scan pass
(Task 10, mounted here but implemented there), which pre-warms
StemFeatureCache/StemEmbeddingCache for stems nobody has placed
anywhere -- so whenever a human DOES later confirm one of those
stems' role, the analysis is already there rather than triggered
fresh at that moment.

NOTE: this commit intentionally does not yet typecheck clean --
DiscoverLibraryScan.tsx (imported here) lands in the very next task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 10: The real whole-library background scan

**Files:**
- Create: `src/main/discoverLibraryStems.ts`
- Test: `src/main/discoverLibraryStems.test.ts`
- Create: `src/renderer/src/audio/DiscoverLibraryScan.tsx`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Not deferred.** Task 9's own consent prompt gates a real mechanism, built here — not a
follow-up. **Before you start:** re-read `src/renderer/src/audio/BackgroundFeatureScan.tsx` in
full (its own `BATCH_SIZE`/`BATCH_DELAY_MS` throttle constants and `Promise.allSettled`-per-
stem reasoning are mirrored here, NOT imported — this is genuinely separate, wider-scope code
per this plan's own Architecture section; do not modify that file). Re-read
`main/riffLibraryStore.ts`'s exported `resolveStemPath` (`:167-182`) and this plan's own Task 2
`listJamsWithDb` export fresh.

- [ ] **Step 1: Write the failing test for target enumeration**

```ts
// src/main/discoverLibraryStems.test.ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { listLibraryScanTargets } from './discoverLibraryStems'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT
    );
  `)
  return db
}

function seedRiff(
  db: Database.Database,
  riffCID: string,
  jamCID: string,
  stemCIDs: string[]
): void {
  const cols = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `StemCID_${n}`)
  const values: Record<string, unknown> = { riffCID, jamCID }
  cols.forEach((c, i) => {
    values[c] = stemCIDs[i] ?? null
  })
  db.prepare(
    `INSERT INTO Riffs (RiffCID, OwnerJamCID, ${cols.join(', ')})
     VALUES (@riffCID, @jamCID, ${cols.map((c) => '@' + c).join(', ')})`
  ).run(values)
}

describe('listLibraryScanTargets', () => {
  it('only includes stems whose resolved path exists locally', () => {
    const db = freshDb()
    seedRiff(db, 'r1', 'jam1', ['s1', 's2'])

    const targets = listLibraryScanTargets(
      [{ jamCID: 'jam1', dbForJam: db }],
      (path) => path.endsWith('s1')
    )
    expect(targets.map((t) => t.key)).toEqual(['s1'])
  })

  it('dedupes a StemCID that appears in more than one riff', () => {
    const db = freshDb()
    seedRiff(db, 'r1', 'jam1', ['s1'])
    seedRiff(db, 'r2', 'jam1', ['s1'])

    const targets = listLibraryScanTargets([{ jamCID: 'jam1', dbForJam: db }], () => true)
    expect(targets).toHaveLength(1)
  })

  it('aggregates across multiple jams', () => {
    const db = freshDb()
    seedRiff(db, 'r1', 'jam1', ['s1'])
    seedRiff(db, 'r2', 'jam2', ['s2'])

    const targets = listLibraryScanTargets(
      [
        { jamCID: 'jam1', dbForJam: db },
        { jamCID: 'jam2', dbForJam: db }
      ],
      () => true
    )
    expect(targets.map((t) => t.key).sort()).toEqual(['s1', 's2'])
  })

  it('does not throw when a jam\'s own db lacks Riffs entirely', () => {
    const db = freshDb()
    const empty = new Database(':memory:')
    expect(() =>
      listLibraryScanTargets([{ jamCID: 'jamExt', dbForJam: empty }], () => true)
    ).not.toThrow()
    expect(listLibraryScanTargets([{ jamCID: 'jamExt', dbForJam: empty }], () => true)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/discoverLibraryStems.test.ts`
Expected: FAIL — `src/main/discoverLibraryStems.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/discoverLibraryStems.ts
import { existsSync } from 'fs'
import type Database from 'better-sqlite3'
import { resolveStemPath } from './riffLibraryStore'

interface JamDbPair {
  jamCID: string
  dbForJam: Database.Database
}

export interface LibraryScanTarget {
  key: string
  path: string
}

interface RiffStemColumnsRow {
  StemCID_1: string | null
  StemCID_2: string | null
  StemCID_3: string | null
  StemCID_4: string | null
  StemCID_5: string | null
  StemCID_6: string | null
  StemCID_7: string | null
  StemCID_8: string | null
}

/** Every stem, library-wide, whose audio is ALREADY downloaded locally --
 * deliberately excludes anything that would need a fresh download. Elling's
 * own consent (design spec §8.5) is about analyzing what's already on
 * disk, not triggering tens of thousands of new downloads -- that would be
 * a completely different, much larger cost this plan was never scoped to
 * incur. Deduplicated by StemCID (the same stem can appear in more than one
 * Riffs row's own StemCID_1..8 columns).
 *
 * `jams` is caller-supplied and `existsFn` is injectable (defaults to the
 * real `existsSync`) for the same testability reason as
 * discoverCandidates.ts's own getDiscoverCandidates -- this keeps the test
 * suite free of any real filesystem dependency. */
export function listLibraryScanTargets(
  jams: JamDbPair[],
  existsFn: (path: string) => boolean = existsSync
): LibraryScanTarget[] {
  const seen = new Set<string>()
  const out: LibraryScanTarget[] = []

  for (const { jamCID, dbForJam } of jams) {
    let riffRows: RiffStemColumnsRow[]
    try {
      riffRows = dbForJam
        .prepare(
          `SELECT StemCID_1, StemCID_2, StemCID_3, StemCID_4,
                  StemCID_5, StemCID_6, StemCID_7, StemCID_8
           FROM Riffs WHERE OwnerJamCID = ?`
        )
        .all(jamCID) as RiffStemColumnsRow[]
    } catch {
      continue
    }
    for (const riff of riffRows) {
      for (let slot = 1; slot <= 8; slot++) {
        const stemCID = riff[`StemCID_${slot}` as keyof RiffStemColumnsRow]
        if (!stemCID || seen.has(stemCID)) continue
        seen.add(stemCID)
        const path = resolveStemPath(jamCID, stemCID)
        if (existsFn(path)) out.push({ key: stemCID, path })
      }
    }
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/discoverLibraryStems.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Wire the IPC handler**

In `src/main/index.ts`:

```ts
import { listLibraryScanTargets } from './discoverLibraryStems'
import type { LibraryScanTarget } from './discoverLibraryStems'
```

```ts
  ipcMain.handle('get-discover-library-scan-targets', (): LibraryScanTarget[] =>
    listLibraryScanTargets(
      listJamsWithDb().map(({ jamCID, db }) => ({ jamCID, dbForJam: db }))
    )
  )
```

In `src/preload/index.ts`:

```ts
  getDiscoverLibraryScanTargets: (): Promise<LibraryScanTarget[]> =>
    ipcRenderer.invoke('get-discover-library-scan-targets'),
```

(Import `LibraryScanTarget` alongside preload's other main-process type imports.)

- [ ] **Step 6: Write the real scan component**

```tsx
// src/renderer/src/audio/DiscoverLibraryScan.tsx
import { useEffect, useRef, useState } from 'react'
import { getOrExtractStemEmbedding } from './stemEmbeddingCache'
import { getStemFeatures } from './stemFeaturesCache'

// Mirrors BackgroundFeatureScan.tsx's own throttle constants exactly --
// deliberately NOT imported from there. This is genuinely separate,
// wider-scope code (this plan's own Architecture section): duplicating two
// small constants is cheaper than coupling two independently-scoped scan
// mechanisms together.
const BATCH_SIZE = 3
const BATCH_DELAY_MS = 500

/** The real whole-library background scan Task 9's own consent prompt
 * gates -- mounted ONLY while `consentedToLibraryScan` is true
 * (DiscoverPanel.tsx). Enumerates every synced stem whose audio is already
 * downloaded locally (get-discover-library-scan-targets,
 * discoverLibraryStems.ts -- never triggers a fresh download) ONCE on
 * mount, then runs the exact same throttled batch/extract loop
 * BackgroundFeatureScan.tsx already established for placed stems, over
 * this much larger target list.
 *
 * HONEST ABOUT SCALE: for a real library the size of Elling's own (52,493
 * total stems, some smaller-but-still-large fraction already downloaded
 * locally), one full pass at BATCH_SIZE=3 / BATCH_DELAY_MS=500 is a
 * genuinely long-running background process -- order of HOURS, not
 * something that finishes in one sitting. Expected, not a bug: the
 * throttle exists specifically so this never meaningfully competes with
 * real playback/interaction, at the cost of how long one full pass takes.
 *
 * Progress is a SESSION-LOCAL count (how far THIS mount's own loop has
 * gotten), not a live re-query of the persistent cache's real hit count --
 * re-querying actual StemFeatureCache/StemEmbeddingCache row counts against
 * a 50k+-row target list on every batch tick would itself be wasteful. It
 * resets to 0 on every fresh mount (e.g. reopening Discover) even though a
 * prior session's own progress is still real, persisted work underneath
 * (getStemFeatures/getOrExtractStemEmbedding's own caches make a
 * re-attempt on an already-cached stem cheap, not wasted) -- this display
 * just doesn't claim credit for a prior session's work, rather than
 * inventing a persisted cursor this v1 doesn't have. */
export function DiscoverLibraryScan(): React.JSX.Element | null {
  const [total, setTotal] = useState<number | null>(null)
  const [completed, setCompleted] = useState(0)
  const attemptedRef = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    void window.rifffApi.getDiscoverLibraryScanTargets().then((targets) => {
      if (cancelled) return
      setTotal(targets.length)
      const toScan = targets.filter((t) => !attemptedRef.current.has(t.key))

      function runBatch(startIndex: number): void {
        if (cancelled) return
        const batch = toScan.slice(startIndex, startIndex + BATCH_SIZE)
        if (batch.length === 0) return
        for (const target of batch) {
          attemptedRef.current.add(target.key)
          void getStemFeatures(target.path).catch((err: unknown) => {
            console.error('DiscoverLibraryScan: feature extraction failed for', target.path, err)
          })
          // getOrExtractStemEmbedding never throws (see its own doc
          // comment) -- no .catch needed, same convention
          // BackgroundFeatureScan.tsx already established.
          void getOrExtractStemEmbedding(target.path)
        }
        setCompleted((c) => c + batch.length)
        const nextIndex = startIndex + BATCH_SIZE
        if (nextIndex < toScan.length) {
          window.setTimeout(() => runBatch(nextIndex), BATCH_DELAY_MS)
        }
      }
      runBatch(0)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (total === null) return null

  return (
    <p style={{ fontSize: 9, color: 'var(--ra-text-3)', margin: '0 0 10px' }}>
      analyzing library in background: {completed} / {total} locally-cached stems this session
    </p>
  )
}
```

`BackgroundFeatureScan.tsx` itself has no test file (confirmed — this codebase's own established
convention for this exact class of component); `DiscoverLibraryScan.tsx` follows the same
convention and gets none either, matching this plan's own Testing section.

- [ ] **Step 7: Make the consent-prompt copy honest about real scale**

Back in Task 9's own Step 2, the consent prompt currently reads "this can take a while and uses
some cpu." Update it now that the real scan behavior (Step 6 above) is known:

```tsx
          <p style={{ margin: '0 0 8px' }}>
            discover can analyze your whole synced library in the background to find
            compatible stems -- for a large library this can take hours to fully finish,
            running quietly and throttled so it doesn't compete with normal use. analyze now?
          </p>
```

- [ ] **Step 8: Typecheck, lint, full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: no errors, no regressions. This also resolves Task 9's own expected typecheck
failure.

- [ ] **Step 9: Commit**

```bash
git add src/main/discoverLibraryStems.ts src/main/discoverLibraryStems.test.ts src/main/index.ts src/preload/index.ts src/renderer/src/audio/DiscoverLibraryScan.tsx src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
Add the real whole-library background scan, gated on consent

Not deferred -- Task 9's own consent prompt now gates a real
mechanism. listLibraryScanTargets enumerates every synced stem whose
audio is ALREADY downloaded locally (never triggers a fresh
download -- consent here is about analyzing what's on disk, not
fetching new audio), deduplicated by StemCID across every Riffs row
that references it. DiscoverLibraryScan.tsx mirrors
BackgroundFeatureScan.tsx's own throttled batch/extract loop
(deliberately not imported -- genuinely separate, wider scope) over
that library-wide target list, with a real session-local "analyzed
X of Y" progress indicator.

Honest about scale: a full pass over a real library (Elling's own:
52,493 total stems) is a genuinely long-running background process,
order of hours -- the throttle exists so it never competes with real
playback/interaction, at that cost.

Also honest about what this does NOT do: Discover's own candidate
pool (Task 1) is StemCategories-row-based, and this scan never
writes those rows -- only a human confirming a role via Tidy
Up/Auto-Arrange does. This scan pre-warms feature/embedding caches
so THAT confirmation, whenever it happens, doesn't trigger fresh
analysis at that moment; it doesn't directly widen what Discover can
already offer today.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 11: "Plunk in arranger" placement

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

**Before you start:** re-read this session's own `PLACE_LOOP_ON_TIMELINE` action (Task 5) for
its exact `stems: Rifff[]` payload shape. `resolveCandidateStem` (the real download/resolve
step a candidate needs before it can be placed) is **already defined in this same file by Task
7** — it's the same function that task's own slot-preview rendering already calls, reused here
verbatim rather than redefined. Do not add a second copy or duplicate its imports.

- [ ] **Step 1: Build one `Rifff` per resolved slot and dispatch the batch action**

```tsx
  const dispatch = useDispatch()
  const rifffsState = useAppSelector((s) => s.rifffs)

  async function plunkInArranger(): Promise<void> {
    const placeable = slots.filter((s): s is DiscoverSlot & { candidate: DiscoverCandidate } =>
      s.candidate !== null
    )
    if (placeable.length === 0) return

    const resolvedStems = await Promise.all(
      placeable.map(async ({ candidate, role }, i) => {
        const stem = await resolveCandidateStem(candidate)
        if (!stem) return null
        return {
          groupId: `discover-${candidate.stemCID}-${i}`,
          name: `discover: ${role}`,
          bpm: candidate.riffBpm,
          barLength: stem.barLength,
          folderPath: '',
          stems: [{ slot: 1, ...stem }]
        }
      })
    )
    const rifffs = resolvedStems.filter((r): r is NonNullable<typeof r> => r !== null)
    if (rifffs.length === 0) return

    // Appends after the furthest-right currently-placed clip, matching
    // "adds alongside, never replaces" from the design spec's own §8.4 --
    // never touches an existing rifff's own startBar.
    const placedEnds = Object.values(rifffsState)
      .filter((r) => r.startBar !== undefined)
      .map((r) => (r.startBar ?? 0) + r.barLength)
    const startBar = placedEnds.length > 0 ? Math.max(...placedEnds) : 0

    dispatch({ type: 'PLACE_LOOP_ON_TIMELINE', stems: rifffs, startBar })
  }
```

A candidate whose own riff fails to resolve/download (network hiccup, since-deleted riff) is
silently excluded from the placed loop rather than blocking the whole plunk — same
`Promise.allSettled`-style resilience convention `useStemFeatureScan.ts` already established
for "one bad stem shouldn't block every other stem."

- [ ] **Step 2: Wire the "plunk in arranger" button**

```tsx
      <button
        onClick={() => void plunkInArranger()}
        style={{
          fontFamily: 'inherit',
          fontSize: 10,
          padding: '6px 14px',
          background: 'var(--ra-stretch-on-bg)',
          border: '1px solid var(--ra-stretch-on)',
          color: 'var(--ra-stretch-on)',
          fontWeight: 700,
          cursor: 'pointer'
        }}
      >
        plunk in arranger
      </button>
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
Wire "plunk in arranger" -- places the built loop in one undo step

Appends after the furthest-right currently-placed clip (adds
alongside, never replaces, per design spec §8.4). Dispatches
PLACE_LOOP_ON_TIMELINE (Task 5) with one fresh Rifff per locked-in
slot. Resolves each candidate's real local path via the same
download/resolve flow LibraryBrowser's own existing import already
uses, since a Discover candidate isn't necessarily cached locally yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 12: Empty and error states

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

**Scope note:** the design spec's own §8.6 describes two DISTINCT empty states — "no match"
(genuinely nothing compatible) vs. "nothing analyzed yet for this role" (scanning declined/not
run). Even with Task 10's own REAL scan now built (not deferred), there is still no separate
"unscanned" state to distinguish in this plan's own v1 — and this isn't a leftover gap, it's
structural: Discover's own candidate pool (Task 1) is `StemCategories`-row-based, and the scan
(Task 10) never writes those rows, only a human confirming a role via Tidy Up/Auto-Arrange does
(see Task 10's own commit message for this same point). So a role with zero confirmed stems
anywhere in the library reads as "no match" either way, consent granted or not, scan complete
or still running — the scan changes how FAST a future confirmation gets its analysis, not
whether today's candidate pool is empty. This task implements the single "no match" state §8.6
asks for; a genuine "unscanned vs. no match" distinction would need Discover's own ranking to
consume live per-stem scan status directly, which is out of this plan's v1 scope.

- [ ] **Step 1: Per-slot "no match" state**

When `rerollSlot` (Task 8) resolves `picked === null` (an empty ranked list — no candidate at
all for this role, at any chaos setting), the slot's own `candidate` field is already correctly
`null` (Task 8's own code already handles this, `pickReroll` returning `null` flows straight
through). Extend `DiscoverSlotRow`'s own "no candidate yet" label to distinguish "never
rerolled" from "rerolled, found nothing" using a new `hasRerolled: boolean` field on
`DiscoverSlot` (set `true` the first time `rerollSlot` runs for that slot, regardless of
outcome):

```tsx
      <span style={{ fontSize: 9, color: 'var(--ra-text)' }}>
        {slot.candidate
          ? slot.candidate.presetName
          : slot.hasRerolled
            ? 'no match for this role yet'
            : 'no candidate yet'}
      </span>
```

Update `DiscoverSlot`'s own interface (Task 7) to add `hasRerolled: boolean` (default `false` on
creation), and `rerollSlot` (Task 8) to set it `true` in the same `setSlots` call that sets
`candidate`.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
Distinguish "no match yet" from "never rerolled" in Discover slots

hasRerolled tracks whether a slot's own reroll has actually run at
least once, so a genuinely empty candidate pool for a role reads
differently from a slot nobody has clicked reroll on yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 13: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all tests pass, including every new file from Tasks 1, 3, 4, 5, 10.

- [ ] **Step 4: Grep for anything left un-resolved from earlier tasks' own flagged gaps**

Run: `grep -rn "path: ''" src/renderer/src/components/DiscoverPanel.tsx`
Expected: no matches — Task 7's own `resolveCandidateStem` (reused by Task 11 at placement time)
must be the only way a slot's `Stem.path` is ever populated; nothing should hardcode an empty
path anywhere in this file.

- [ ] **Step 5: Write the manual-walkthrough summary for Elling**

Post a summary (not a file) covering what needs a real, interactive walkthrough — this
environment cannot click-test a discovery/browsing flow, same convention as every prior plan
this session:

1. **Opening Discover**: click "import" on the Shelf, then the new "discover" tab. Confirm the
   consent prompt appears the first time, and that declining still leaves the screen usable.
2. **Adding slots and rerolling**: add a few role slots, reroll each, confirm candidates
   actually come back (this requires having confirmed SOME real stems via Tidy Up/Auto-Arrange
   already, in THIS library — a totally untrained library will show "no match" for everything,
   which is correct, not a bug).
3. **Lock + reroll all**: lock one slot, reroll all, confirm the locked one survives untouched
   and only unlocked ones change.
4. **Chaos↔Safe slider**: confirm low chaos rerolls the same candidate repeatedly (or close to
   it) and high chaos visibly varies more.
5. **Plunk in arranger**: confirm the loop lands alongside existing timeline content (never
   replacing it), each slot as its own new clip, and that undo removes the WHOLE loop in one
   step, not one stem at a time.
6. **Settings toggle**: confirm the new "turn on/off discover library scan" item appears in the
   gear/settings menu and actually flips what the consent prompt shows on next open.
7. **The real whole-library scan (Task 10)**: after accepting the consent prompt, confirm the
   "analyzed X of Y" progress indicator actually moves over time (leave the app open a few
   minutes) and that Y roughly matches the real library's own stem count. This is a genuinely
   long-running pass at real library scale (potentially hours for a large synced library, not
   something that finishes in one sitting) — confirm it doesn't visibly compete with normal
   playback/interaction (the same throttled-batch discipline `BackgroundFeatureScan.tsx` already
   uses for its own smaller, placed-only pass), and that declining consent (or turning it off via
   the settings-menu toggle) stops it without breaking anything already scanned.

- [ ] **Step 6: No commit for this task** (verification only — nothing to commit unless Steps
1-4 surface something to fix, in which case fix it and commit as its own small fix).

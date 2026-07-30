# LORE Library Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Elling browse his large local Endlesss archive (synced via OUROVEON's LORE to `/Volumes/Elling-Lien/ENDLESSS`) directly inside ssstitch, and import any riff whose stems are already locally cached — without leaving the app or manually locating exported folders.

**Architecture:** A new main-process module reads LORE's own SQLite warehouse (`warehouse.db3`) read-only via `better-sqlite3`, exposed to the renderer through four new IPC calls. A new overlay panel — jam list on one side, a grid of small ownership-colored circles (one per riff) on the other — lets Elling browse, preview (reusing `BeatPicker`'s existing Web Audio loop mechanism), and import. Import builds a `Rifff` directly from warehouse data and dispatches the same `ADD_TO_SHELF`/`SET_VOLUME` actions today's drag-and-drop import already uses, so nothing downstream needs to know a riff came from LORE.

**Tech Stack:** Electron/React/TypeScript (existing), `better-sqlite3` (new), JUCE/C++ native engine (Ogg Vorbis decoding, already available by default — verified, not newly added).

---

## Spec reference

Full design: `docs/superpowers/specs/2026-07-30-lore-library-browser-design.md`. Read it before starting if anything below is unclear — this plan implements it exactly, including its "Not in scope" list (no writing to the warehouse, no downloading missing stems, no replicating LORE's full heatmap system, no changes to `importRifff.ts`).

Traced facts this plan depends on (from the spec, verified against OUROVEON's own source and Elling's real data — don't re-derive):
- `Instrument` bitmask: bit 1 = drum, bit 2 = note, bit 3 = bass, bit 4 = mic, no bits set = other. Priority on ties: drum > note > bass > mic.
- Stem audio path: `<WAREHOUSE_ROOT>/cache/common/stem_v2/<JamCID>/<first-hex-char-of-StemCID>/<StemCID>` (no file extension), Ogg Vorbis.
- Warehouse DB path: `<WAREHOUSE_ROOT>/cache/common/warehouse.db3`.
- `WAREHOUSE_ROOT` = `/Volumes/Elling-Lien/ENDLESSS` (hardcoded — single-user, single-machine app, matching existing precedent elsewhere in this codebase for machine-specific paths).

---

### Task 1: Add better-sqlite3 dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

Run: `npm install better-sqlite3 && npm install --save-dev @types/better-sqlite3`

`package.json` already has `"postinstall": "electron-builder install-app-deps"` — this is the standard mechanism that rebuilds native modules (like `better-sqlite3`) against Electron's own Node ABI. No new rebuild tooling is needed; `npm install` triggers it automatically.

- [ ] **Step 2: Verify it loads under Electron's Node ABI**

Run: `npx electron -e "console.log(require('better-sqlite3'))"`
Expected: prints the `better-sqlite3` module object, not a "was compiled against a different Node.js version" ABI error. If it errors, run `npx electron-builder install-app-deps` manually and retry.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add better-sqlite3 dependency for reading LORE's warehouse database"
```

---

### Task 2: Verify Ogg Vorbis decoding in the native engine

**Files:**
- Modify: `native-engine/Source/StemBufferCache.cpp`
- Test: `native-engine/Source/StemBufferCacheTests.cpp`

JUCE's `juce_audio_formats` module (pulled in transitively via `juce_audio_utils`, already linked) has `JUCE_USE_OGGVORBIS` defined to `1` by default — confirmed by reading the module header directly (`native-engine/build/_deps/juce-src/modules/juce_audio_formats/juce_audio_formats.h`). `StemBufferCache`'s `registerBasicFormats()` call should already register Ogg Vorbis decoding with zero code changes. This task proves it empirically, the same way the existing WAV fixture test proves WAV loading, rather than trusting the default blindly.

- [ ] **Step 1: Write the failing test**

Add to `native-engine/Source/StemBufferCacheTests.cpp`, as a new `beginTest` block inside `StemBufferCacheTests::runTest()` (after the existing three, before the final `tempFile.deleteFile();`):

```cpp
            beginTest("loads a real Ogg Vorbis file and reports its sample data");
            {
                auto oggFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                    .getChildFile("ssstitch_test_fixture.ogg");

                juce::OggVorbisAudioFormat oggFormat;
                std::unique_ptr<juce::FileOutputStream> out(oggFile.createOutputStream());
                expect(out != nullptr);
                std::unique_ptr<juce::AudioFormatWriter> writer(
                    oggFormat.createWriterFor(out.get(), 44100.0, 1, 0, {}, 6));
                expect(writer != nullptr);
                out.release(); // writer now owns the stream

                const int numSamples = 4410;
                juce::AudioBuffer<float> source(1, numSamples);
                for (int i = 0; i < numSamples; ++i)
                    source.setSample(0, i, 0.5f);
                writer->writeFromAudioSampleBuffer(source, 0, numSamples);
                writer.reset(); // flush + close

                StemBufferCache cache;
                expect(cache.load(oggFile.getFullPathName()));
                auto* buffer = cache.get(oggFile.getFullPathName());
                expect(buffer != nullptr);
                expectEquals(buffer->getNumChannels(), 1);
                // Lossy compression means the sample count and exact values won't be
                // bit-identical to the source — assert it's in the right ballpark and
                // the known-constant value survived recognizably, not an exact match.
                expect(std::abs(buffer->getNumSamples() - numSamples) < 100);
                expectWithinAbsoluteError(buffer->getSample(0, 100), 0.5f, 0.05f);

                oggFile.deleteFile();
            }
```

Add `#include <cmath>` near the top of the file if not already present (needed for `std::abs`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd native-engine/build && cmake --build . --target ssstitch_engine -j 4 && ./ssstitch_engine_artefacts/Debug/ssstitch_engine --test`

Expected: either a compile error (if `juce::OggVorbisAudioFormat` isn't visible — would mean `JUCE_USE_OGGVORBIS` is somehow off in this build, contradicting the header check above and requiring investigation before continuing) or the new test fails on `cache.load(...)` returning false.

Given the header check already confirmed the flag defaults on, the far more likely outcome is this test **passes immediately** — that's fine and expected; it still serves as the empirical proof this plan's later native-side work depends on. If it does fail, stop and investigate before proceeding — every later task assumes Ogg Vorbis decoding works.

- [ ] **Step 3: Update the stale comment**

In `native-engine/Source/StemBufferCache.cpp`, the constructor currently reads:

```cpp
    StemBufferCache::StemBufferCache()
    {
        formatManager.registerBasicFormats(); // WAV, AIFF, etc. — Endlesss stems are WAV
    }
```

Change the comment to:

```cpp
    StemBufferCache::StemBufferCache()
    {
        // WAV, AIFF, Ogg Vorbis (default JUCE_USE_OGGVORBIS=1), etc. Endlesss's own
        // native export is WAV; LORE-cached stems (see the LORE library browser
        // feature) are Ogg Vorbis — both load through this same reader, no
        // format-specific code needed anywhere downstream.
        formatManager.registerBasicFormats();
    }
```

- [ ] **Step 4: Run tests to verify everything passes**

Run: `cmake --build . --target ssstitch_engine -j 4 && ./ssstitch_engine_artefacts/Debug/ssstitch_engine --test`
Expected: PASS, including the new Ogg Vorbis test.

- [ ] **Step 5: Commit**

```bash
cd /Users/nickel/Claudecode/bendlesss
git add native-engine/Source/StemBufferCache.cpp native-engine/Source/StemBufferCacheTests.cpp
git commit -m "Verify Ogg Vorbis decoding works in StemBufferCache"
```

---

### Task 3: Shared types and pure functions

**Files:**
- Create: `src/shared/loreLibrary.ts`
- Test: `src/shared/loreLibrary.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/loreLibrary.test.ts
import { describe, expect, it } from 'vitest'
import { instrumentMaskToSoundType, computeOwnerFraction, LORE_USERNAME } from './loreLibrary'

describe('instrumentMaskToSoundType', () => {
  it('maps the drum bit (2) to drums', () => {
    expect(instrumentMaskToSoundType(2)).toBe('drums')
  })

  it('maps the note bit (4) to notes', () => {
    expect(instrumentMaskToSoundType(4)).toBe('notes')
  })

  it('maps the bass bit (8) to bass', () => {
    expect(instrumentMaskToSoundType(8)).toBe('bass')
  })

  it('maps the mic bit (16) to audioIn', () => {
    expect(instrumentMaskToSoundType(16)).toBe('audioIn')
  })

  it('maps no bits set (0) to null', () => {
    expect(instrumentMaskToSoundType(0)).toBe(null)
  })

  it('prioritizes drum over note when both bits are set', () => {
    expect(instrumentMaskToSoundType(2 | 4)).toBe('drums')
  })

  it('prioritizes note over bass when both bits are set', () => {
    expect(instrumentMaskToSoundType(4 | 8)).toBe('notes')
  })

  it('prioritizes bass over mic when both bits are set', () => {
    expect(instrumentMaskToSoundType(8 | 16)).toBe('bass')
  })
})

describe('computeOwnerFraction', () => {
  it('is 1.0 when every creator matches', () => {
    expect(computeOwnerFraction(['elling', 'elling'], 'elling')).toBe(1)
  })

  it('is 0.0 when no creator matches', () => {
    expect(computeOwnerFraction(['ishaniii', 'mvdg'], 'elling')).toBe(0)
  })

  it('is the matching fraction for a mix', () => {
    expect(computeOwnerFraction(['elling', 'mvdg', 'elling', 'ishaniii'], 'elling')).toBe(0.5)
  })

  it('is 0 for an empty stem list, not NaN or a divide-by-zero error', () => {
    expect(computeOwnerFraction([], 'elling')).toBe(0)
  })

  it('matches LORE_USERNAME by default when no target is passed', () => {
    expect(computeOwnerFraction([LORE_USERNAME], undefined)).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/loreLibrary.test.ts`
Expected: FAIL — `./loreLibrary` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/loreLibrary.ts
import type { SoundType } from './types'

/** This app is single-user with no settings/config system — building one just
 * for a value that will essentially never change would be its own scope
 * creep. See the design spec's data model section. */
export const LORE_USERNAME = 'elling'

export interface LoreJam {
  jamCID: string
  name: string
  lastRiffTime: number // unix seconds
}

export interface LoreRiffSummary {
  riffCID: string
  creationTime: number
  bpm: number
  barLength: number
  userName: string
  stemCount: number // populated slots, 1-8
  cachedStemCount: number // of those, how many are on disk right now
  ownerFraction: number // 0-1, fraction of populated slots created by LORE_USERNAME
}

export interface LoreResolvedStem {
  stemCID: string
  slot: number // 1-8
  path: string | null // local file path, or null if not cached
  gain: number // from the riff's GainsJSON, default 1.0
  creatorUserName: string
  presetName: string
  instrumentMask: number
  durationSec: number // computed from this stem's own BPMrnd/BarLength, not the riff's
  barLength: number // this stem's own loop length — may differ from the riff's own barLength if the stem tiles
}

export interface LoreResolvedRiff {
  riffCID: string
  bpm: number
  barLength: number
  stems: LoreResolvedStem[]
}

/** Traced directly from OUROVEON's own source (toolkit.warehouse.cpp), not
 * guessed: bit 1 = drum, bit 2 = note, bit 3 = bass, bit 4 = mic. If multiple
 * bits are set, drum wins, then note, then bass, then mic — matching
 * OUROVEON's own getInstrumentType() resolution order. No bits set (or any
 * other combination without one of these four) returns null, meaning "no
 * confident mapping" — the caller falls back to the existing audio-content
 * heuristic (classifyStems) rather than guessing 'fx'. */
export function instrumentMaskToSoundType(mask: number): SoundType | null {
  if ((mask & (1 << 1)) !== 0) return 'drums'
  if ((mask & (1 << 2)) !== 0) return 'notes'
  if ((mask & (1 << 3)) !== 0) return 'bass'
  if ((mask & (1 << 4)) !== 0) return 'audioIn'
  return null
}

/** Fraction of `creatorUserNames` equal to `targetUser` (defaults to
 * LORE_USERNAME). Returns 0 for an empty list rather than dividing by zero. */
export function computeOwnerFraction(
  creatorUserNames: string[],
  targetUser: string = LORE_USERNAME
): number {
  if (creatorUserNames.length === 0) return 0
  const matching = creatorUserNames.filter((u) => u === targetUser).length
  return matching / creatorUserNames.length
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/loreLibrary.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/loreLibrary.ts src/shared/loreLibrary.test.ts
git commit -m "Add LORE library shared types and Instrument-bitmask/ownership pure functions"
```

---

### Task 4: Main-process warehouse reader — connection and availability

**Files:**
- Create: `src/main/loreWarehouse.ts`
- Test: `src/main/loreWarehouse.test.ts`

Establishes the module's core: opening the DB read-only, resolving stem paths, and the `warehouseAvailable()` check. Later tasks add the three query functions on top of this.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/loreWarehouse.test.ts
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  warehouseAvailable,
  resolveStemPath,
  setWarehouseRootForTests
} from './loreWarehouse'

function createFixtureWarehouse(root: string): void {
  mkdirSync(join(root, 'cache', 'common'), { recursive: true })
  const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
  db.exec(`
    CREATE TABLE "Jams" ("JamCID" TEXT NOT NULL UNIQUE, "PublicName" TEXT NOT NULL, PRIMARY KEY("JamCID"));
    CREATE TABLE "Riffs" (
      "RiffCID" TEXT NOT NULL UNIQUE, "OwnerJamCID" TEXT NOT NULL, "CreationTime" INTEGER,
      "BPMrnd" REAL, "BarLength" INTEGER, "UserName" TEXT,
      "StemCID_1" TEXT, "StemCID_2" TEXT, "StemCID_3" TEXT, "StemCID_4" TEXT,
      "StemCID_5" TEXT, "StemCID_6" TEXT, "StemCID_7" TEXT, "StemCID_8" TEXT,
      "GainsJSON" TEXT, PRIMARY KEY("RiffCID")
    );
    CREATE TABLE "Stems" (
      "StemCID" TEXT NOT NULL UNIQUE, "OwnerJamCID" TEXT NOT NULL, "CreatorUserName" TEXT,
      "PresetName" TEXT, "Instrument" INTEGER, "BPMrnd" REAL, "BarLength" REAL, PRIMARY KEY("StemCID")
    );
  `)
  db.close()
}

describe('loreWarehouse', () => {
  let root: string

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('warehouseAvailable() is false when the root directory does not exist', () => {
    setWarehouseRootForTests('/no/such/path/at/all')
    expect(warehouseAvailable()).toBe(false)
  })

  it('warehouseAvailable() is true when a real warehouse.db3 exists at the expected path', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    expect(warehouseAvailable()).toBe(true)
  })

  it('resolveStemPath shards by the first hex character of the StemCID', () => {
    setWarehouseRootForTests('/Volumes/Elling-Lien/ENDLESSS')
    const path = resolveStemPath('bandABC123', 'dc857530d08e11ecb5304f35d712ecc6')
    expect(path).toBe(
      '/Volumes/Elling-Lien/ENDLESSS/cache/common/stem_v2/bandABC123/d/dc857530d08e11ecb5304f35d712ecc6'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/loreWarehouse.test.ts`
Expected: FAIL — `./loreWarehouse` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/loreWarehouse.ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

// Single-user, single-machine app — this is the actual synced folder on
// Elling's machine. See the design spec's "Background" section for why this
// is hardcoded rather than configurable.
let warehouseRoot = '/Volumes/Elling-Lien/ENDLESSS'

/** Test-only seam: points the module at a fixture warehouse instead of the
 * real one. Also resets the cached connection, since a previously-opened DB
 * handle would otherwise keep pointing at the old root. */
export function setWarehouseRootForTests(root: string): void {
  warehouseRoot = root
  closeWarehouseDb()
}

function warehouseDbPath(): string {
  return join(warehouseRoot, 'cache', 'common', 'warehouse.db3')
}

function stemCacheRoot(): string {
  return join(warehouseRoot, 'cache', 'common', 'stem_v2')
}

let cachedDb: Database.Database | null = null

/** Lazily opens the warehouse DB read-only, with a busy-timeout so a moment
 * of LORE writing concurrently degrades gracefully instead of hanging.
 * Returns null (never throws) if the file doesn't exist or can't be opened —
 * callers treat that as "library unavailable", not a crash. */
function getWarehouseDb(): Database.Database | null {
  if (cachedDb) return cachedDb
  if (!existsSync(warehouseDbPath())) return null
  try {
    cachedDb = new Database(warehouseDbPath(), { readonly: true, fileMustExist: true, timeout: 2000 })
    return cachedDb
  } catch (err) {
    console.error('loreWarehouse: failed to open warehouse.db3:', err)
    return null
  }
}

function closeWarehouseDb(): void {
  cachedDb?.close()
  cachedDb = null
}

export function warehouseAvailable(): boolean {
  return getWarehouseDb() !== null
}

/** Stem audio is sharded by jam and by the first hex character of the
 * StemCID: cache/common/stem_v2/<JamCID>/<first-hex-char>/<StemCID>, no file
 * extension. Traced from real LORE-synced data, not guessed. */
export function resolveStemPath(jamCID: string, stemCID: string): string {
  const shard = stemCID[0]
  return join(stemCacheRoot(), jamCID, shard, stemCID)
}

export { getWarehouseDb }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/loreWarehouse.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/loreWarehouse.ts src/main/loreWarehouse.test.ts
git commit -m "Add LORE warehouse DB connection, availability check, and stem path resolution"
```

---

### Task 5: lore-list-jams query

**Files:**
- Modify: `src/main/loreWarehouse.ts`
- Test: `src/main/loreWarehouse.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/loreWarehouse.test.ts`, importing `listJams` alongside the existing imports, and a shared fixture-creation helper that also inserts rows (extend `createFixtureWarehouse` to optionally seed data, or add a second helper — shown here as a second helper so Task 4's existing empty-schema test is untouched):

```ts
import { warehouseAvailable, resolveStemPath, setWarehouseRootForTests, listJams } from './loreWarehouse'

function createSeededFixtureWarehouse(root: string): void {
  mkdirSync(join(root, 'cache', 'common'), { recursive: true })
  const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
  db.exec(`
    CREATE TABLE "Jams" ("JamCID" TEXT NOT NULL UNIQUE, "PublicName" TEXT NOT NULL, PRIMARY KEY("JamCID"));
    CREATE TABLE "Riffs" (
      "RiffCID" TEXT NOT NULL UNIQUE, "OwnerJamCID" TEXT NOT NULL, "CreationTime" INTEGER,
      "BPMrnd" REAL, "BarLength" INTEGER, "UserName" TEXT,
      "StemCID_1" TEXT, "StemCID_2" TEXT, "StemCID_3" TEXT, "StemCID_4" TEXT,
      "StemCID_5" TEXT, "StemCID_6" TEXT, "StemCID_7" TEXT, "StemCID_8" TEXT,
      "GainsJSON" TEXT, PRIMARY KEY("RiffCID")
    );
    CREATE TABLE "Stems" (
      "StemCID" TEXT NOT NULL UNIQUE, "OwnerJamCID" TEXT NOT NULL, "CreatorUserName" TEXT,
      "PresetName" TEXT, "Instrument" INTEGER, "BPMrnd" REAL, "BarLength" REAL, PRIMARY KEY("StemCID")
    );
  `)
  db.exec(`
    INSERT INTO Jams (JamCID, PublicName) VALUES
      ('jam-techno', 'Techno Jam'),
      ('jam-ambient', 'Ambient Sketches'),
      ('jam-empty', 'Never Jammed');
    INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName) VALUES
      ('riff-1', 'jam-techno', 1000, 130, 8, 'elling'),
      ('riff-2', 'jam-techno', 2000, 130, 8, 'elling'),
      ('riff-3', 'jam-ambient', 1500, 90, 16, 'elling');
  `)
  db.close()
}

describe('listJams', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('lists jams sorted by most recent riff activity, most recent first', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    const jams = listJams('')
    expect(jams.map((j) => j.jamCID)).toEqual(['jam-techno', 'jam-ambient', 'jam-empty'])
    expect(jams[0].lastRiffTime).toBe(2000)
  })

  it('filters by name, case-insensitively', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    const jams = listJams('techno')
    expect(jams.map((j) => j.jamCID)).toEqual(['jam-techno'])
  })

  it('a jam with no riffs yet still appears, sorted last (lastRiffTime 0)', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    const jams = listJams('')
    expect(jams[jams.length - 1]).toEqual({ jamCID: 'jam-empty', name: 'Never Jammed', lastRiffTime: 0 })
  })

  it('returns an empty array when the warehouse is unavailable, rather than throwing', () => {
    setWarehouseRootForTests('/no/such/path')
    expect(listJams('')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/loreWarehouse.test.ts`
Expected: FAIL — `listJams` is not exported yet.

- [ ] **Step 3: Write the implementation**

Add to `src/main/loreWarehouse.ts`, above the final `export { getWarehouseDb }` line:

```ts
import type { LoreJam } from '@shared/loreLibrary'

export function listJams(filterText: string): LoreJam[] {
  const db = getWarehouseDb()
  if (!db) return []
  const rows = db
    .prepare(
      `SELECT j.JamCID as jamCID, j.PublicName as name, COALESCE(MAX(r.CreationTime), 0) as lastRiffTime
       FROM Jams j
       LEFT JOIN Riffs r ON r.OwnerJamCID = j.JamCID
       WHERE j.PublicName LIKE ?
       GROUP BY j.JamCID
       ORDER BY lastRiffTime DESC`
    )
    .all(`%${filterText}%`) as LoreJam[]
  return rows
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/loreWarehouse.test.ts`
Expected: PASS, all tests including the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/main/loreWarehouse.ts src/main/loreWarehouse.test.ts
git commit -m "Add lore-list-jams query"
```

---

### Task 6: lore-list-riffs query

**Files:**
- Modify: `src/main/loreWarehouse.ts`
- Test: `src/main/loreWarehouse.test.ts`

The riff summary needs, per riff: `stemCount` (how many of `StemCID_1..8` are non-null), `cachedStemCount` (of those, how many resolve to a file that exists on disk), and `ownerFraction` (via `computeOwnerFraction` from Task 3, fed each populated stem's `CreatorUserName`). This requires a batched lookup into `Stems` for every `StemCID` referenced across the page's riffs — one `WHERE StemCID IN (...)` query, not one query per stem, to keep this fast for a 200-row page.

- [ ] **Step 1: Write the failing test**

Add to `src/main/loreWarehouse.test.ts`:

```ts
import { existsSync, mkdirSync as mkdirSyncFs, writeFileSync as writeFileSyncFs } from 'node:fs'
import { listRiffs } from './loreWarehouse'

function seedStemsAndGains(root: string): void {
  const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
  db.exec(`
    UPDATE Riffs SET StemCID_1 = 'stem-a', StemCID_2 = 'stem-b', GainsJSON = '{"1":0.8,"2":0.5}'
      WHERE RiffCID = 'riff-1';
    UPDATE Riffs SET StemCID_1 = 'stem-c' WHERE RiffCID = 'riff-2';
  `)
  db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument, BPMrnd, BarLength) VALUES (?,?,?,?,?,?,?)`
  ).run('stem-a', 'jam-techno', 'elling', 'Microphone', 16, 130, 8)
  db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument, BPMrnd, BarLength) VALUES (?,?,?,?,?,?,?)`
  ).run('stem-b', 'jam-techno', 'mvdg', 'Lowpass', 2, 130, 4)
  db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName, PresetName, Instrument, BPMrnd, BarLength) VALUES (?,?,?,?,?,?,?)`
  ).run('stem-c', 'jam-techno', 'elling', 'Pianabot', 4, 130, 8)
  db.close()

  // stem-a is "cached" (a real file at its resolved sharded path); stem-b and
  // stem-c are not — proves cachedStemCount only counts what's actually on disk.
  const stemADir = join(root, 'cache', 'common', 'stem_v2', 'jam-techno', 's')
  mkdirSyncFs(stemADir, { recursive: true })
  writeFileSyncFs(join(stemADir, 'stem-a'), 'fake ogg bytes')
}

describe('listRiffs', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('reports stemCount, cachedStemCount, and ownerFraction per riff', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    const riffs = listRiffs('jam-techno', {})
    const riff1 = riffs.find((r) => r.riffCID === 'riff-1')!
    expect(riff1.stemCount).toBe(2)
    expect(riff1.cachedStemCount).toBe(1) // only stem-a is actually on disk
    expect(riff1.ownerFraction).toBe(0.5) // elling (stem-a) + mvdg (stem-b)

    const riff2 = riffs.find((r) => r.riffCID === 'riff-2')!
    expect(riff2.stemCount).toBe(1)
    expect(riff2.cachedStemCount).toBe(0) // stem-c not on disk
    expect(riff2.ownerFraction).toBe(1) // elling (stem-c) only
  })

  it('only returns riffs for the requested jam', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    const riffs = listRiffs('jam-ambient', {})
    expect(riffs.map((r) => r.riffCID)).toEqual(['riff-3'])
  })

  it('filters by bpm when provided', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    const riffs = listRiffs('jam-techno', { bpm: 130 })
    expect(riffs).toHaveLength(2)
    expect(listRiffs('jam-techno', { bpm: 999 })).toHaveLength(0)
  })

  it('filters by userName when provided', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    expect(listRiffs('jam-techno', { userName: 'elling' })).toHaveLength(2)
    expect(listRiffs('jam-techno', { userName: 'nobody' })).toHaveLength(0)
  })

  it('filters to only fully-cached riffs when onlyFullyCached is true', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    // riff-1 has 1 of 2 stems cached (not fully); riff-2 has 0 of 1 (not
    // fully either) — neither should pass a strict "fully cached" filter.
    const riffs = listRiffs('jam-techno', { onlyFullyCached: true })
    expect(riffs).toHaveLength(0)
  })

  it('returns an empty array when the warehouse is unavailable, rather than throwing', () => {
    setWarehouseRootForTests('/no/such/path')
    expect(listRiffs('jam-techno', {})).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/loreWarehouse.test.ts`
Expected: FAIL — `listRiffs` is not exported yet.

- [ ] **Step 3: Write the implementation**

Add to `src/main/loreWarehouse.ts`:

```ts
import type { LoreJam, LoreRiffSummary } from '@shared/loreLibrary'
import { computeOwnerFraction } from '@shared/loreLibrary'

export interface RiffFilters {
  dateFrom?: number
  dateTo?: number
  bpm?: number
  userName?: string
  onlyFullyCached?: boolean
}

interface RiffRow {
  RiffCID: string
  CreationTime: number
  BPMrnd: number
  BarLength: number
  UserName: string
  StemCID_1: string | null
  StemCID_2: string | null
  StemCID_3: string | null
  StemCID_4: string | null
  StemCID_5: string | null
  StemCID_6: string | null
  StemCID_7: string | null
  StemCID_8: string | null
}

interface StemLookupRow {
  StemCID: string
  CreatorUserName: string
}

const RIFF_PAGE_SIZE = 200

export function listRiffs(jamCID: string, filters: RiffFilters): LoreRiffSummary[] {
  const db = getWarehouseDb()
  if (!db) return []

  const conditions = ['OwnerJamCID = ?']
  const params: (string | number)[] = [jamCID]
  if (filters.dateFrom !== undefined) {
    conditions.push('CreationTime >= ?')
    params.push(filters.dateFrom)
  }
  if (filters.dateTo !== undefined) {
    conditions.push('CreationTime <= ?')
    params.push(filters.dateTo)
  }
  if (filters.bpm !== undefined) {
    conditions.push('ROUND(BPMrnd) = ?')
    params.push(filters.bpm)
  }
  if (filters.userName !== undefined) {
    conditions.push('UserName = ?')
    params.push(filters.userName)
  }

  const rows = db
    .prepare(
      `SELECT RiffCID, CreationTime, BPMrnd, BarLength, UserName,
              StemCID_1, StemCID_2, StemCID_3, StemCID_4, StemCID_5, StemCID_6, StemCID_7, StemCID_8
       FROM Riffs
       WHERE ${conditions.join(' AND ')}
       ORDER BY CreationTime DESC
       LIMIT ${RIFF_PAGE_SIZE}`
    )
    .all(...params) as RiffRow[]

  // Batch-resolve every referenced StemCID's creator in one query, rather than
  // one query per stem — up to 8 stems x 200 riffs would otherwise be 1600
  // individual point lookups per page.
  const allStemCIDs = new Set<string>()
  for (const row of rows) {
    for (let slot = 1; slot <= 8; slot++) {
      const cid = row[`StemCID_${slot}` as keyof RiffRow] as string | null
      if (cid) allStemCIDs.add(cid)
    }
  }
  const stemCreators = new Map<string, string>()
  if (allStemCIDs.size > 0) {
    const cidList = [...allStemCIDs]
    const placeholders = cidList.map(() => '?').join(',')
    const stemRows = db
      .prepare(`SELECT StemCID, CreatorUserName FROM Stems WHERE StemCID IN (${placeholders})`)
      .all(...cidList) as StemLookupRow[]
    for (const s of stemRows) stemCreators.set(s.StemCID, s.CreatorUserName)
  }

  const summaries: LoreRiffSummary[] = rows.map((row) => {
    const stemCIDs: string[] = []
    for (let slot = 1; slot <= 8; slot++) {
      const cid = row[`StemCID_${slot}` as keyof RiffRow] as string | null
      if (cid) stemCIDs.push(cid)
    }
    const cachedStemCount = stemCIDs.filter((cid) => existsSync(resolveStemPath(jamCID, cid))).length
    const creatorNames = stemCIDs.map((cid) => stemCreators.get(cid) ?? '')
    return {
      riffCID: row.RiffCID,
      creationTime: row.CreationTime,
      bpm: row.BPMrnd,
      barLength: row.BarLength,
      userName: row.UserName,
      stemCount: stemCIDs.length,
      cachedStemCount,
      ownerFraction: computeOwnerFraction(creatorNames)
    }
  })

  return filters.onlyFullyCached
    ? summaries.filter((s) => s.cachedStemCount === s.stemCount)
    : summaries
}
```

Add `import { existsSync } from 'node:fs'` if not already imported by Task 4 (it is — reuse it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/loreWarehouse.test.ts`
Expected: PASS, all tests including the 6 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/main/loreWarehouse.ts src/main/loreWarehouse.test.ts
git commit -m "Add lore-list-riffs query with filters, cached-count, and ownership fraction"
```

---

### Task 7: lore-resolve-riff query

**Files:**
- Modify: `src/main/loreWarehouse.ts`
- Test: `src/main/loreWarehouse.test.ts`

This is the single source of truth for "what does importing/previewing this riff actually get you" — full per-stem detail (path, gain from `GainsJSON`, creator, preset, instrument mask), used by both the preview mechanism and the actual import.

- [ ] **Step 1: Write the failing test**

Add to `src/main/loreWarehouse.test.ts`:

```ts
import { resolveRiff } from './loreWarehouse'

describe('resolveRiff', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('resolves every populated stem slot with its path, gain, and metadata', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    const resolved = resolveRiff('riff-1')
    expect(resolved).not.toBeNull()
    expect(resolved!.bpm).toBe(130)
    expect(resolved!.barLength).toBe(8)
    expect(resolved!.stems).toHaveLength(2)

    const stemA = resolved!.stems.find((s) => s.stemCID === 'stem-a')!
    expect(stemA.slot).toBe(1)
    expect(stemA.gain).toBeCloseTo(0.8)
    expect(stemA.creatorUserName).toBe('elling')
    expect(stemA.presetName).toBe('Microphone')
    expect(stemA.instrumentMask).toBe(16)
    expect(stemA.path).not.toBeNull() // it's the one seeded as "on disk"
    // BPMrnd=130, BarLength=8 -> 8 * (60/130) * 4 = 14.7692...s
    expect(stemA.barLength).toBe(8)
    expect(stemA.durationSec).toBeCloseTo(14.7692, 3)

    const stemB = resolved!.stems.find((s) => s.stemCID === 'stem-b')!
    expect(stemB.slot).toBe(2)
    expect(stemB.gain).toBeCloseTo(0.5)
    expect(stemB.path).toBeNull() // not on disk
    // Deliberately seeded with a SHORTER BarLength (4) than stem-a's (8) and
    // than the riff's own BarLength (8, from createSeededFixtureWarehouse) —
    // proves this stem's own barLength/durationSec are used, not the riff's.
    expect(stemB.barLength).toBe(4)
    expect(stemB.durationSec).toBeCloseTo(7.3846, 3)
  })

  it('defaults a stem missing from GainsJSON to gain 1.0', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    const resolved = resolveRiff('riff-2') // riff-2 has no GainsJSON at all
    expect(resolved!.stems[0].gain).toBe(1.0)
  })

  it('returns null for a nonexistent RiffCID', () => {
    root = mkdtempSync(join(tmpdir(), 'ssstitch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    expect(resolveRiff('no-such-riff')).toBeNull()
  })

  it('returns null when the warehouse is unavailable, rather than throwing', () => {
    setWarehouseRootForTests('/no/such/path')
    expect(resolveRiff('riff-1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/loreWarehouse.test.ts`
Expected: FAIL — `resolveRiff` is not exported yet.

- [ ] **Step 3: Write the implementation**

Add to `src/main/loreWarehouse.ts`:

```ts
import type { LoreResolvedRiff, LoreResolvedStem } from '@shared/loreLibrary'

interface FullRiffRow extends RiffRow {
  OwnerJamCID: string
  GainsJSON: string | null
}

interface FullStemRow {
  StemCID: string
  CreatorUserName: string
  PresetName: string
  Instrument: number
  BPMrnd: number | null
  BarLength: number | null
}

export function resolveRiff(riffCID: string): LoreResolvedRiff | null {
  const db = getWarehouseDb()
  if (!db) return null

  const riffRow = db
    .prepare(
      `SELECT RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName, GainsJSON,
              StemCID_1, StemCID_2, StemCID_3, StemCID_4, StemCID_5, StemCID_6, StemCID_7, StemCID_8
       FROM Riffs WHERE RiffCID = ?`
    )
    .get(riffCID) as FullRiffRow | undefined
  if (!riffRow) return null

  // GainsJSON keys are slot numbers as strings (e.g. {"1": 0.8}) — malformed
  // or absent JSON just means every stem falls back to the default gain,
  // not a thrown error.
  let gains: Record<string, number> = {}
  if (riffRow.GainsJSON) {
    try {
      gains = JSON.parse(riffRow.GainsJSON) as Record<string, number>
    } catch (err) {
      console.error(`loreWarehouse: malformed GainsJSON for riff ${riffCID}:`, err)
    }
  }

  const slots: { slot: number; stemCID: string }[] = []
  for (let slot = 1; slot <= 8; slot++) {
    const cid = riffRow[`StemCID_${slot}` as keyof FullRiffRow] as string | null
    if (cid) slots.push({ slot, stemCID: cid })
  }

  const stems: LoreResolvedStem[] = slots.map(({ slot, stemCID }) => {
    const stemRow = db
      .prepare('SELECT StemCID, CreatorUserName, PresetName, Instrument, BPMrnd, BarLength FROM Stems WHERE StemCID = ?')
      .get(stemCID) as FullStemRow | undefined
    const path = resolveStemPath(riffRow.OwnerJamCID, stemCID)
    // This stem's OWN bpm/bar-length, not the riff's — a stem can be a
    // shorter loop tiled across a longer riff (the same distinction
    // ssstitch's own Stem.barLength vs Rifff.barLength already makes for
    // drag-and-drop imports). Falls back to the riff's own bpm/1-bar length
    // only if this stem's row is somehow missing that data.
    const stemBpm = stemRow?.BPMrnd ?? riffRow.BPMrnd
    const stemBarLength = stemRow?.BarLength ?? 1
    const durationSec = stemBarLength * (60 / stemBpm) * 4
    return {
      stemCID,
      slot,
      path: existsSync(path) ? path : null,
      gain: gains[String(slot)] ?? 1.0,
      creatorUserName: stemRow?.CreatorUserName ?? '',
      presetName: stemRow?.PresetName ?? '',
      instrumentMask: stemRow?.Instrument ?? 0,
      durationSec,
      barLength: stemBarLength
    }
  })

  return {
    riffCID: riffRow.RiffCID,
    bpm: riffRow.BPMrnd,
    barLength: riffRow.BarLength,
    stems
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/loreWarehouse.test.ts`
Expected: PASS, all tests including the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/main/loreWarehouse.ts src/main/loreWarehouse.test.ts
git commit -m "Add lore-resolve-riff query"
```

---

### Task 8: Wire IPC handlers and preload bridge

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the four IPC handlers**

In `src/main/index.ts`, add the import near the top:

```ts
import { warehouseAvailable, listJams, listRiffs, resolveRiff, type RiffFilters } from './loreWarehouse'
```

Add the handlers inside `app.whenReady().then(async () => { ... })`, alongside the other `ipcMain.handle` calls (e.g. right after the `import-rifff` handler):

```ts
  ipcMain.handle('lore-warehouse-available', () => warehouseAvailable())

  ipcMain.handle('lore-list-jams', (_event, filterText: string) => listJams(filterText))

  ipcMain.handle('lore-list-riffs', (_event, jamCID: string, filters: RiffFilters) =>
    listRiffs(jamCID, filters)
  )

  ipcMain.handle('lore-resolve-riff', (_event, riffCID: string) => resolveRiff(riffCID))
```

- [ ] **Step 2: Add the preload bridge methods**

In `src/preload/index.ts`, add the import:

```ts
import type { LoreJam, LoreRiffSummary, LoreResolvedRiff } from '@shared/loreLibrary'
```

Add to the `api` object, after `onEngineRestarted`:

```ts
  loreWarehouseAvailable: (): Promise<boolean> => ipcRenderer.invoke('lore-warehouse-available'),
  loreListJams: (filterText: string): Promise<LoreJam[]> =>
    ipcRenderer.invoke('lore-list-jams', filterText),
  loreListRiffs: (
    jamCID: string,
    filters: { dateFrom?: number; dateTo?: number; bpm?: number; userName?: string; onlyFullyCached?: boolean }
  ): Promise<LoreRiffSummary[]> => ipcRenderer.invoke('lore-list-riffs', jamCID, filters),
  loreResolveRiff: (riffCID: string): Promise<LoreResolvedRiff | null> =>
    ipcRenderer.invoke('lore-resolve-riff', riffCID)
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (No test covers this thin IPC-forwarding layer directly — it's exercised by the renderer work in later tasks and by manual verification in the final task.)

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Wire LORE warehouse IPC handlers and preload bridge"
```

---

### Task 9: Browser panel — jam list pane

**Files:**
- Create: `src/renderer/src/components/LoreLibraryBrowser.tsx`

Starts the panel with just the left pane (search + jam list) and the overlay shell/close behavior, matching `BeatPicker.tsx`'s existing overlay pattern (`position: fixed; inset: 0` backdrop, click-outside-to-close, Esc to close). Later tasks add the right pane (riff grid) inside the same component.

- [ ] **Step 1: Write the component**

```tsx
// src/renderer/src/components/LoreLibraryBrowser.tsx
import { useEffect, useState } from 'react'
import type { LoreJam } from '@shared/loreLibrary'

export function LoreLibraryBrowser({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [jamFilter, setJamFilter] = useState('')
  const [jams, setJams] = useState<LoreJam[]>([])
  const [selectedJamCID, setSelectedJamCID] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.rifffApi.loreWarehouseAvailable().then((v) => {
      if (!cancelled) setAvailable(v)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!available) return
    let cancelled = false
    void window.rifffApi.loreListJams(jamFilter).then((result) => {
      if (!cancelled) setJams(result)
    })
    return () => {
      cancelled = true
    }
  }, [available, jamFilter])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 900,
          height: 600,
          maxWidth: '90vw',
          maxHeight: '85vh',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="ra-eyebrow">lore library</span>
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

        {available === false && (
          <div style={{ marginTop: 20, fontSize: 11, color: 'var(--ra-text-2)' }}>
            library not available — is the drive mounted?
          </div>
        )}

        {available && (
          <div style={{ display: 'flex', gap: 12, marginTop: 12, flex: 1, minHeight: 0 }}>
            <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                type="text"
                value={jamFilter}
                onChange={(e) => setJamFilter(e.target.value)}
                placeholder="filter jams..."
                style={{
                  height: 24,
                  fontSize: 11,
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-text)',
                  border: '1px solid var(--ra-border)',
                  borderRadius: 0,
                  padding: '0 6px'
                }}
              />
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {jams.map((jam) => (
                  <button
                    key={jam.jamCID}
                    onClick={() => setSelectedJamCID(jam.jamCID)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '5px 6px',
                      fontSize: 11,
                      border: 'none',
                      borderRadius: 0,
                      background:
                        selectedJamCID === jam.jamCID ? 'var(--ra-bg-row-active)' : 'transparent',
                      color: 'var(--ra-text)'
                    }}
                  >
                    {jam.name}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {selectedJamCID === null && (
                <div style={{ fontSize: 11, color: 'var(--ra-text-3)', marginTop: 6 }}>
                  select a jam to browse its riffs
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Nothing renders this component yet (Task 13 wires the open button) — skip manual verification until then; this step exists to note that fact, not to actually verify now.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/LoreLibraryBrowser.tsx
git commit -m "Add LoreLibraryBrowser jam list pane"
```

---

### Task 10: Browser panel — riff circle grid and filters

**Files:**
- Modify: `src/renderer/src/components/LoreLibraryBrowser.tsx`

Adds the right pane: filter controls, and the grid of small ownership-colored circles, one per riff in the selected jam.

- [ ] **Step 1: Add filter state and the riff-fetching effect**

In `LoreLibraryBrowser.tsx`, add imports:

```ts
import type { LoreJam, LoreRiffSummary } from '@shared/loreLibrary'
```

(the `LoreRiffSummary` half is new; `LoreJam` already imported from Task 9)

Add state, alongside the existing `selectedJamCID` state:

```ts
  const [riffs, setRiffs] = useState<LoreRiffSummary[]>([])
  const [selectedRiffCID, setSelectedRiffCID] = useState<string | null>(null)
  const [bpmFilter, setBpmFilter] = useState('')
  const [userNameFilter, setUserNameFilter] = useState('')
  const [onlyFullyCached, setOnlyFullyCached] = useState(false)
```

Add an effect that re-queries whenever the selected jam or filters change:

```ts
  useEffect(() => {
    if (!selectedJamCID) {
      setRiffs([])
      return
    }
    let cancelled = false
    const filters: {
      bpm?: number
      userName?: string
      onlyFullyCached?: boolean
    } = {}
    if (bpmFilter.trim() !== '' && !Number.isNaN(Number(bpmFilter))) filters.bpm = Number(bpmFilter)
    if (userNameFilter.trim() !== '') filters.userName = userNameFilter.trim()
    if (onlyFullyCached) filters.onlyFullyCached = true

    void window.rifffApi.loreListRiffs(selectedJamCID, filters).then((result) => {
      if (!cancelled) setRiffs(result)
    })
    return () => {
      cancelled = true
    }
  }, [selectedJamCID, bpmFilter, userNameFilter, onlyFullyCached])
```

Reset `selectedRiffCID` whenever the jam changes (a riff selected in the previous jam shouldn't linger as "selected" once you've switched jams):

```ts
  useEffect(() => {
    setSelectedRiffCID(null)
  }, [selectedJamCID])
```

- [ ] **Step 2: Add the coloring helper**

```ts
/** Continuous brightness ramp from dark gray (0% ownership) to white (100%)
 * — a riff missing any cached stems overrides this entirely and renders flat
 * black, since it can't be previewed or imported yet regardless of who made
 * it. One brightness axis, no separate accent hue, matching the app's
 * existing "color spent only on things that carry information" design
 * language (see tokens.css). */
function riffCircleColor(riff: LoreRiffSummary): string {
  if (riff.cachedStemCount < riff.stemCount) return '#000000'
  const lo = 60 // dark gray floor, not pure black, so 0% still reads as "a riff", not "empty"
  const hi = 237 // matches --ra-text's near-white value
  const v = Math.round(lo + riff.ownerFraction * (hi - lo))
  return `rgb(${v}, ${v}, ${v})`
}
```

- [ ] **Step 3: Replace the "select a jam to browse" placeholder with the filter bar + grid**

Replace this block from Task 9:

```tsx
            <div style={{ flex: 1, minWidth: 0 }}>
              {selectedJamCID === null && (
                <div style={{ fontSize: 11, color: 'var(--ra-text-3)', marginTop: 6 }}>
                  select a jam to browse its riffs
                </div>
              )}
            </div>
```

with:

```tsx
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {selectedJamCID === null && (
                <div style={{ fontSize: 11, color: 'var(--ra-text-3)', marginTop: 6 }}>
                  select a jam to browse its riffs
                </div>
              )}
              {selectedJamCID !== null && (
                <>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="number"
                      value={bpmFilter}
                      onChange={(e) => setBpmFilter(e.target.value)}
                      placeholder="bpm"
                      style={{
                        width: 60,
                        height: 22,
                        fontSize: 10,
                        background: 'var(--ra-bg-row-active)',
                        color: 'var(--ra-text)',
                        border: '1px solid var(--ra-border)',
                        borderRadius: 0,
                        padding: '0 6px'
                      }}
                    />
                    <input
                      type="text"
                      value={userNameFilter}
                      onChange={(e) => setUserNameFilter(e.target.value)}
                      placeholder="username"
                      style={{
                        width: 100,
                        height: 22,
                        fontSize: 10,
                        background: 'var(--ra-bg-row-active)',
                        color: 'var(--ra-text)',
                        border: '1px solid var(--ra-border)',
                        borderRadius: 0,
                        padding: '0 6px'
                      }}
                    />
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 10,
                        color: 'var(--ra-text-2)'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={onlyFullyCached}
                        onChange={(e) => setOnlyFullyCached(e.target.checked)}
                      />
                      only fully cached
                    </label>
                    <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>{riffs.length} riffs</span>
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 5,
                      overflowY: 'auto',
                      flex: 1,
                      alignContent: 'flex-start'
                    }}
                  >
                    {riffs.map((riff) => (
                      <button
                        key={riff.riffCID}
                        onClick={() => setSelectedRiffCID(riff.riffCID)}
                        title={`${riff.bpm} BPM · ${riff.stemCount} stems (${riff.cachedStemCount} cached)`}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          border:
                            selectedRiffCID === riff.riffCID
                              ? '2px solid var(--ra-playhead)'
                              : '1px solid var(--ra-border)',
                          padding: 0,
                          background: riffCircleColor(riff),
                          cursor: 'pointer'
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/LoreLibraryBrowser.tsx
git commit -m "Add riff circle grid, filters, and ownership coloring to LoreLibraryBrowser"
```

---

### Task 11: Browser panel — selection, preview, and detail line

**Files:**
- Modify: `src/renderer/src/components/LoreLibraryBrowser.tsx`

Reuses `BeatPicker.tsx`'s exact decode-and-loop Web Audio pattern (`readAudioFile` → `decodeAudioData` → looped `AudioBufferSourceNode`s), pointed at `lore-resolve-riff`'s resolved paths instead of an already-imported rifff. Also renders a real `PolarGlyph` for the selected riff, reusing that component as-is (it already handles its own peak-decode-and-cache internally).

- [ ] **Step 1: Add resolved-riff state and the auto-preview effect**

Add imports:

```ts
import { useRef } from 'react'
import type { LoreResolvedRiff } from '@shared/loreLibrary'
import { getAudioContext } from '../audio/peakCache'
import { sqrtGain } from '@shared/mixGain'
import { usePlaying, useDispatch } from '../state/StoreContext'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'
import { instrumentMaskToSoundType } from '@shared/loreLibrary'
```

Add state and a ref for the active preview sources (mirrors `BeatPicker`'s `previewSourcesRef`):

```ts
  const [resolvedRiff, setResolvedRiff] = useState<LoreResolvedRiff | null>(null)
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const playing = usePlaying()
  const dispatch = useDispatch()

  function stopPreview(): void {
    for (const source of previewSourcesRef.current) {
      try {
        source.stop()
      } catch {
        // already stopped
      }
    }
    previewSourcesRef.current = []
  }
```

Add the resolve-and-preview effect, right after the `setSelectedRiffCID(null)`-on-jam-change effect from Task 10:

```ts
  useEffect(() => {
    stopPreview()
    if (!selectedRiffCID) {
      setResolvedRiff(null)
      return
    }
    let cancelled = false
    void window.rifffApi.loreResolveRiff(selectedRiffCID).then(async (resolved) => {
      if (cancelled || !resolved) return
      setResolvedRiff(resolved)

      // Auto-preview on selection, full mix only — same reasoning as
      // BeatPicker's own preview: pause the main arrangement first so the
      // two don't play over each other.
      if (playing) dispatch({ type: 'PAUSE' })
      const cachedStems = resolved.stems.filter((s) => s.path !== null)
      const ctx = getAudioContext()
      const gain = sqrtGain(cachedStems.length)
      for (const stem of cachedStems) {
        try {
          const bytes = await window.rifffApi.readAudioFile(stem.path!)
          const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
          const decoded = await ctx.decodeAudioData(arrayBuffer as ArrayBuffer)
          if (cancelled) return
          const source = ctx.createBufferSource()
          source.buffer = decoded
          source.loop = true
          const gainNode = ctx.createGain()
          gainNode.gain.value = gain * stem.gain
          source.connect(gainNode)
          gainNode.connect(ctx.destination)
          source.start(0)
          previewSourcesRef.current.push(source)
        } catch (err) {
          console.error(`LoreLibraryBrowser: failed to decode preview audio for ${stem.path}:`, err)
        }
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playing/dispatch intentionally excluded: this only re-runs on riff selection, matching BeatPicker's own pattern of reading transport state at the moment a preview starts rather than tracking it as a dependency
  }, [selectedRiffCID])
```

Stop any playing preview when the whole panel closes:

```ts
  useEffect(() => {
    return () => stopPreview()
  }, [])
```

- [ ] **Step 2: Add the detail line with PolarGlyph, metadata, and per-stem author list**

Replace the riff grid's closing `</div>` and the fragment's closing `</>` from Task 10 — i.e. insert a new block right after the grid `<div>...</div>` and before `</>`:

```tsx
                  {resolvedRiff && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                      <PolarGlyph
                        stems={resolvedRiff.stems
                          .filter((s) => s.path !== null)
                          .map((s) => ({
                            slot: s.slot,
                            author: s.creatorUserName,
                            name: s.presetName,
                            type: instrumentMaskToSoundType(s.instrumentMask) ?? 'fx',
                            path: s.path!,
                            durationSec: s.durationSec,
                            barLength: s.barLength
                          }))}
                        identityColor={typeColorVar('fx')}
                        size={40}
                      />
                      <div style={{ fontSize: 10, color: 'var(--ra-text-2)' }}>
                        {resolvedRiff.bpm} BPM · {resolvedRiff.stems.length} stems (
                        {resolvedRiff.stems.filter((s) => s.path !== null).length} cached)
                        <div style={{ marginTop: 2, color: 'var(--ra-text-3)' }}>
                          {resolvedRiff.stems.map((s) => s.creatorUserName || '?').join(', ')}
                        </div>
                      </div>
                    </div>
                  )}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Deferred to Task 13's end-to-end check, once the panel is actually reachable from the UI.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/LoreLibraryBrowser.tsx
git commit -m "Add riff selection, Web Audio preview, and detail line to LoreLibraryBrowser"
```

---

### Task 12: Browser panel — import

**Files:**
- Modify: `src/renderer/src/components/LoreLibraryBrowser.tsx`

Builds a `Rifff` directly from the resolved riff data and dispatches the same `ADD_TO_SHELF` action today's drag-and-drop import already uses, plus one `SET_VOLUME` per stem whose gain differs from the default — no new reducer actions needed (see the spec's Architecture section for why). Marks imported riffs so browsing doesn't lose track of what's already been grabbed.

- [ ] **Step 1: Add the import handler and imported-riffs tracking**

Add imports:

```ts
import { classifyStems } from '../audio/classifyStems'
import { stemKey } from '@shared/types'
```

Add state, alongside the existing state declarations:

```ts
  const [importedRiffCIDs, setImportedRiffCIDs] = useState<Set<string>>(new Set())
```

Add the import handler function, near `stopPreview`:

```ts
  function handleImport(): void {
    if (!resolvedRiff || !selectedRiffCID) return
    const cachedStems = resolvedRiff.stems.filter((s) => s.path !== null)
    if (cachedStems.length === 0) return

    const groupId = crypto.randomUUID()
    const rifff = {
      groupId,
      name: `LORE riff ${selectedRiffCID.slice(0, 8)}`,
      bpm: resolvedRiff.bpm,
      barLength: resolvedRiff.barLength,
      // Not a real folder — sourced from the LORE warehouse, not a drag-and-drop
      // import. Inspector.tsx's existing "re-import from folder" link displays
      // this field as-is; an empty string would render as a bare "/", so use a
      // human-readable descriptor instead. Clicking that link on a LORE-imported
      // rifff still works exactly like it does for any other rifff (opens a
      // folder picker and re-imports from wherever the user points it) — this
      // is display-only, not read back programmatically anywhere.
      folderPath: 'lore library',
      stems: cachedStems.map((s) => ({
        slot: s.slot,
        author: s.creatorUserName,
        name: s.presetName,
        type: instrumentMaskToSoundType(s.instrumentMask) ?? 'fx',
        path: s.path!,
        durationSec: s.durationSec, // this stem's own bpm/bar-length, not the riff's — see resolveRiff
        barLength: s.barLength
      }))
    }

    dispatch({ type: 'ADD_TO_SHELF', rifff })
    for (const stem of cachedStems) {
      if (Math.abs(stem.gain - 1.0) > 1e-6) {
        dispatch({ type: 'SET_VOLUME', stemKey: stemKey(groupId, stem.slot), volume: stem.gain })
      }
    }
    setImportedRiffCIDs((prev) => new Set(prev).add(selectedRiffCID))

    // Same "fill in unclassified stems by ear" heuristic drag-and-drop import
    // already uses — the Instrument bitmask covers drum/note/bass/mic
    // confidently, but a stem with no matching bit (mapped to 'fx' above)
    // gets a second chance here, same as today's importer gives every stem.
    classifyStems(rifff, dispatch).catch((err) => {
      console.error('LoreLibraryBrowser: failed to classify stem types:', err)
    })
  }
```

- [ ] **Step 2: Add the import button to the detail line**

Extend the detail-line block from Task 11 — replace:

```tsx
                      <div style={{ fontSize: 10, color: 'var(--ra-text-2)' }}>
                        {resolvedRiff.bpm} BPM · {resolvedRiff.stems.length} stems (
                        {resolvedRiff.stems.filter((s) => s.path !== null).length} cached)
                        <div style={{ marginTop: 2, color: 'var(--ra-text-3)' }}>
                          {resolvedRiff.stems.map((s) => s.creatorUserName || '?').join(', ')}
                        </div>
                      </div>
```

with:

```tsx
                      <div style={{ fontSize: 10, color: 'var(--ra-text-2)', flex: 1 }}>
                        {resolvedRiff.bpm} BPM · {resolvedRiff.stems.length} stems (
                        {resolvedRiff.stems.filter((s) => s.path !== null).length} cached)
                        <div style={{ marginTop: 2, color: 'var(--ra-text-3)' }}>
                          {resolvedRiff.stems.map((s) => s.creatorUserName || '?').join(', ')}
                        </div>
                      </div>
                      <button
                        onClick={handleImport}
                        disabled={resolvedRiff.stems.every((s) => s.path === null)}
                        style={{
                          height: 24,
                          borderRadius: 0,
                          padding: '0 12px',
                          fontSize: 10,
                          border: '1px solid var(--ra-border-strong)',
                          background:
                            selectedRiffCID !== null && importedRiffCIDs.has(selectedRiffCID)
                              ? 'var(--ra-stretch-on-bg)'
                              : 'var(--ra-bg-row-active)',
                          color:
                            selectedRiffCID !== null && importedRiffCIDs.has(selectedRiffCID)
                              ? 'var(--ra-stretch-on)'
                              : 'var(--ra-text)'
                        }}
                      >
                        {selectedRiffCID !== null && importedRiffCIDs.has(selectedRiffCID)
                          ? 'imported ✓ — import again'
                          : 'import'}
                      </button>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/LoreLibraryBrowser.tsx
git commit -m "Add import to LoreLibraryBrowser"
```

---

### Task 13: Wire the browser open button into Shelf

**Files:**
- Modify: `src/renderer/src/components/Shelf.tsx`

**Files:**
- Modify: `src/renderer/src/App.tsx` (if the panel is easier to mount at the App level — see Step 1 for the decision)

- [ ] **Step 1: Add the open button and panel state**

The panel is a full-screen overlay (`position: fixed; inset: 0`), same as `BeatPicker` — `BeatPicker` itself is mounted at the `Frame` component level in `App.tsx`, not inside `Shelf`, even though it's opened from a button that could live anywhere. Follow that same pattern: the *button* lives in `Shelf.tsx` (per the spec's "same conceptual home as today's import affordance"), but the *panel* is mounted in `App.tsx`'s `Frame` component, matching how `pickerGroupId`/`BeatPicker` already work there.

In `src/renderer/src/components/Shelf.tsx`, change the props and add the button:

```tsx
export function Shelf({
  onImported,
  onOpenLoreLibrary
}: {
  onImported: (groupId: string) => void
  onOpenLoreLibrary: () => void
}): React.JSX.Element {
```

Add the button inside the header row, after the existing `{detailRifff && (...)}` block:

```tsx
        <button
          onClick={onOpenLoreLibrary}
          style={{
            height: 18,
            borderRadius: 0,
            padding: '0 6px',
            fontSize: 9,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text-2)'
          }}
        >
          browse lore library
        </button>
```

- [ ] **Step 2: Mount the panel in App.tsx**

In `src/renderer/src/App.tsx`, add the import:

```ts
import { LoreLibraryBrowser } from './components/LoreLibraryBrowser'
```

Add state in the `Frame` component, alongside the existing `pickerGroupId` state:

```ts
  const [loreLibraryOpen, setLoreLibraryOpen] = useState(false)
```

Update the `<Shelf>` call to pass the new prop:

```tsx
      <Shelf onImported={setPickerGroupId} onOpenLoreLibrary={() => setLoreLibraryOpen(true)} />
```

Mount the panel conditionally, alongside the existing `{pickerGroupId && ...}` block:

```tsx
      {loreLibraryOpen && <LoreLibraryBrowser onClose={() => setLoreLibraryOpen(false)} />}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. Click "browse lore library" in the Shelf. Confirm:
- If the drive isn't mounted, the panel shows "library not available — is the drive mounted?" rather than a broken UI.
- If mounted: the jam list populates and is filterable; selecting a jam shows its riff grid; circles are colored per ownership, black for not-fully-cached; clicking a circle selects it, starts audio preview, and shows a PolarGlyph + metadata; clicking "import" adds it to the Shelf's own tile grid and the button flips to "imported ✓".
- Esc and clicking the backdrop both close the panel; a second open resets cleanly (no leftover selection/preview from the previous session).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Shelf.tsx src/renderer/src/App.tsx
git commit -m "Wire LoreLibraryBrowser open button into Shelf"
```

---

### Task 14: Inspector — per-stem author display

**Files:**
- Modify: `src/renderer/src/components/Inspector.tsx`

`Stem.author` already exists and is populated today (from Endlesss's own export filename convention for drag-and-drop imports, from `CreatorUserName` for LORE imports as of Task 12) — it's just never shown anywhere in the UI. This is a small, independent addition to the existing per-stem row.

- [ ] **Step 1: Add the author label**

In `src/renderer/src/components/Inspector.tsx`, find the per-stem row (inside `rifff.stems.map((stem) => { ... })`, the `<div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 24 }}>` block containing the type-cycle button, slot number, and `EditableText` name). Add a small label after the `EditableText`:

```tsx
                    <EditableText
                      value={stem.name}
                      onCommit={(name) =>
                        dispatch({ type: 'RENAME_STEM', groupId, slot: stem.slot, name })
                      }
                      title="click to rename"
                      style={{
                        flex: 1,
                        fontSize: 11,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    />
                    {stem.author && (
                      <span
                        title={`created by ${stem.author}`}
                        style={{
                          fontSize: 9,
                          color: 'var(--ra-text-3)',
                          flexShrink: 0,
                          maxWidth: 60,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {stem.author}
                      </span>
                    )}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Import a rifff via drag-and-drop (existing path) and confirm each stem row shows its author (if the dropped folder's filenames include one, per the existing `"<slot> - <author> - <name> - ..."` convention). Import a riff via the new LORE browser and confirm its stems show the `CreatorUserName` values from the warehouse.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Inspector.tsx
git commit -m "Show per-stem author in the Inspector"
```

---

### Task 15: Full verification and final review

- [ ] **Step 1: Native build and test**

```bash
cd native-engine/build && cmake --build . --target ssstitch_engine -j 4
./ssstitch_engine_artefacts/Debug/ssstitch_engine --test
```
Expected: PASS, all suites including the new Ogg Vorbis `StemBufferCache` test.

- [ ] **Step 2: Full JS/TS suite**

```bash
cd /Users/nickel/Claudecode/bendlesss
npm run typecheck
npm run lint
npx vitest run
```
Expected: PASS. Note: this session has repeatedly hit real flakiness from native-engine spawn/socket-based tests (`playbackEngineLifecycle.test.ts`, `native-engine/test/parity/ipc-roundtrip.test.ts`) unrelated to actual code changes — a single re-run always resolved it. If a run fails only in one of those specific files, re-run once before treating it as a real regression.

- [ ] **Step 3: Full production build**

```bash
npx electron-vite build
```
Expected: succeeds (main + preload + renderer).

- [ ] **Step 4: End-to-end manual verification**

With `npm run dev` running and `/Volumes/Elling-Lien/ENDLESSS` mounted:
- Open the LORE library browser from the Shelf. Confirm the jam list loads and filters correctly.
- Pick a jam you know well. Confirm the circle grid's ownership coloring matches your actual memory of who contributed (bright/white for riffs you know are all-you, dark for riffs you know are mostly others', black for anything you know isn't locally cached).
- Click through a few riffs and confirm preview audio plays correctly and the PolarGlyph renders.
- Import a riff. Confirm it appears in the Shelf's tile grid, can be dragged onto the timeline, plays correctly, and its stems show sensible sound types (drum/note/bass/mic-derived where the Instrument bitmask gave a confident answer) and per-stem author names in the Inspector.
- Confirm a riff with a `GainsJSON` entry that isn't 1.0 for some stem actually reflects that stem's starting volume in the Inspector after import.
- Save the project, close and reopen ssstitch, reopen the saved project, confirm the LORE-imported riff still plays (paths reference the LORE cache directly, so this also implicitly confirms the drive was still mounted).

- [ ] **Step 5: Self-review against the spec**

Re-read `docs/superpowers/specs/2026-07-30-lore-library-browser-design.md` section by section and confirm each is implemented: warehouse background/Instrument bitmask (Task 3), architecture/IPC (Tasks 4-8), data model (Task 3), UI — browser panel, circle grid, coloring, preview, import, Inspector author (Tasks 9-14), error handling (warehouse-unavailable in Task 9, missing-stem/corrupt-file handling inherited from existing `StemBufferCache`/`AudioEngine` resilience, no new code needed there), testing (unit tests in Tasks 3-7, manual verification in this task). Confirm the "Not in scope" list is genuinely respected: no warehouse writes anywhere in `loreWarehouse.ts`, no stem-downloading code, no multi-mode heatmap system, `importRifff.ts` untouched.

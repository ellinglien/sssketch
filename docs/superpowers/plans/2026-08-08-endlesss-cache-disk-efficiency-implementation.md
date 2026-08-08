# Endlesss Cache Disk Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Endlesss stem cache from storing the same audio twice (once per
`source`), safely migrate existing duplicated stems into one content-addressed copy each
without breaking already-saved projects, and add size-capped eviction to the currently
unbounded `stretch-cache`.

**Architecture:** Re-key `endlesss-cache/stems/` from `<source>/<riffCID>/<stemCID>` to
`<stemCID[0]>/<stemCID>` (mirroring LORE's own one-hex-char shard convention). A one-time
startup migration moves existing files to their new path and leaves a symlink at every old
path so already-saved `.sssketchproj` files (which store stem paths as literal strings)
keep resolving. Separately, `stretch-cache` gains an LRU eviction pass keyed by file mtime,
capped at a fixed size.

**Tech Stack:** TypeScript, Node `fs` (rename/symlink/lstat), Vitest with real temp
directories (this codebase's established convention — no fs mocking).

**Reference:** `docs/superpowers/specs/2026-08-08-endlesss-cache-disk-efficiency-design.md`

---

### Task 1: Re-key the Endlesss stem cache to content-addressed paths

**Files:**
- Modify: `src/main/endlesssApi.ts:395-397` (`endlesssStemCachePath`)
- Modify: `src/main/endlesssApi.ts:478-494` (`downloadMissingStemsFor`)
- Modify: `src/main/endlesssApi.ts:634` (call site inside `resolveSharedFeedRiff`)
- Modify: `src/main/endlesssApi.ts:898` (call site inside `resolveJamRiff`)
- Modify: `src/main/endlesssSync.ts:131` (call site inside `syncSharedFeed`)
- Test: `src/main/endlesssApi.test.ts` (existing suite — no assertions reference the old
  path shape, so this task's job is to confirm they still pass, not to edit them)

- [ ] **Step 1: Re-key `endlesssStemCachePath`**

Replace the current function:

```ts
function endlesssStemCachePath(source: 'shared' | 'jam', riffCID: string, stemCID: string): string {
  return join(app.getPath('userData'), 'endlesss-cache', 'stems', source, riffCID, stemCID)
}
```

with:

```ts
// One-hex-char shard, mirroring LORE's own warehouse convention
// (resolveStemPath in loreWarehouse.ts: cache/common/stem_v2/<JamCID>/
// <first-hex-char>/<StemCID>) rather than inventing a new scheme. Keyed by
// stemCID alone -- it's Endlesss's own content identifier, so the same
// audio always lands at the same path regardless of which riff or jam
// referenced it, unlike the old source-partitioned scheme this replaces
// (see docs/superpowers/specs/2026-08-08-endlesss-cache-disk-efficiency-design.md).
function endlesssStemCachePath(stemCID: string): string {
  return join(app.getPath('userData'), 'endlesss-cache', 'stems', stemCID.slice(0, 1), stemCID)
}
```

- [ ] **Step 2: Simplify `downloadMissingStemsFor`'s signature**

Replace:

```ts
export async function downloadMissingStemsFor(
  source: 'shared' | 'jam',
  riffCID: string,
  resolved: LoreResolvedRiff,
  fetchImpl: FetchLike
): Promise<LoreResolvedRiff> {
  const stems = await Promise.all(
    resolved.stems.map(async (stem) => {
      if (stem.path !== null || !stem.downloadUrl) return stem
      const path = endlesssStemCachePath(source, riffCID, stem.stemCID)
      if (existsSync(path)) return { ...stem, path }
      const ok = await downloadOneEndlesssStem(path, stem.downloadUrl, fetchImpl)
      return ok ? { ...stem, path } : stem
    })
  )
  return { ...resolved, stems }
}
```

with:

```ts
export async function downloadMissingStemsFor(
  resolved: LoreResolvedRiff,
  fetchImpl: FetchLike
): Promise<LoreResolvedRiff> {
  const stems = await Promise.all(
    resolved.stems.map(async (stem) => {
      if (stem.path !== null || !stem.downloadUrl) return stem
      const path = endlesssStemCachePath(stem.stemCID)
      if (existsSync(path)) return { ...stem, path }
      const ok = await downloadOneEndlesssStem(path, stem.downloadUrl, fetchImpl)
      return ok ? { ...stem, path } : stem
    })
  )
  return { ...resolved, stems }
}
```

Also update its doc comment (currently explains the `source` param's purpose, which no
longer exists):

```ts
/** Downloads every not-yet-cached stem in `resolved` (path === null but a
 * downloadUrl exists), returning a new LoreResolvedRiff with paths filled
 * in for whichever succeeded. Shared by both the shared-feed and
 * private-jam resolve paths. Exported for endlesssSync.ts's own use -- see
 * peekSharedFeedCache's doc comment for why syncSharedFeed needs to call
 * this directly rather than going through resolveSharedFeedRiff. */
```

- [ ] **Step 3: Update the three call sites**

`src/main/endlesssApi.ts` (inside `resolveSharedFeedRiff`):

```ts
  const cached = sharedFeedCache.get(riffCID)
  if (!cached) return null
  return downloadMissingStemsFor(cached, fetchImpl)
```

`src/main/endlesssApi.ts` (inside `resolveJamRiff`, last line):

```ts
  const resolved = buildResolvedRiff(riffCID, riffDoc, [...stemDocs.values()])
  return downloadMissingStemsFor(resolved, fetchImpl)
```

`src/main/endlesssSync.ts` (inside `syncSharedFeed`'s `runWithConcurrency` worker):

```ts
      const baseResolved = baseResolvedByCID.get(summary.riffCID)
      const resolved = baseResolved
        ? await downloadMissingStemsFor(baseResolved, fetchImpl)
        : null
```

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

```bash
npm test
```

Expected: all existing tests still pass (819+ tests) — no test in this codebase asserts
the literal old `stems/<source>/<riffCID>/<stemCID>` path shape, only that a stem's
`.path` ends up non-null with the right content, which is unaffected by this change.

```bash
npm run typecheck
```

Expected: clean (the two dropped parameters are gone from every call site, not just left
unused).

- [ ] **Step 5: Commit**

```bash
git add src/main/endlesssApi.ts src/main/endlesssSync.ts
git commit -m "Re-key Endlesss stem cache by stemCID instead of source+riffCID"
```

---

### Task 2: One-time migration off the old source-partitioned cache

**Files:**
- Create: `src/main/stemCacheMigration.ts`
- Test: `src/main/stemCacheMigration.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/stemCacheMigration.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => globalThis.__testUserDataDir
  }
}))

declare global {
  // eslint-disable-next-line no-var
  var __testUserDataDir: string
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-migration-test-'))
  globalThis.__testUserDataDir = userDataDir
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

function writeOldStem(
  source: 'shared' | 'jam',
  riffCID: string,
  stemCID: string,
  content: string
): string {
  const dir = join(userDataDir, 'endlesss-cache', 'stems', source, riffCID)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, stemCID)
  writeFileSync(path, content)
  return path
}

describe('migrateEndlesssStemCache', () => {
  it('moves a stem to its content-addressed path and symlinks the old path to it', async () => {
    const oldPath = writeOldStem('jam', 'riff_1', 'stem_abc', 'audio bytes')
    const { migrateEndlesssStemCache } = await import('./stemCacheMigration')
    migrateEndlesssStemCache()
    const newPath = join(userDataDir, 'endlesss-cache', 'stems', 's', 'stem_abc')
    expect(existsSync(newPath)).toBe(true)
    expect(readFileSync(newPath, 'utf-8')).toBe('audio bytes')
    expect(lstatSync(oldPath).isSymbolicLink()).toBe(true)
    expect(readFileSync(oldPath, 'utf-8')).toBe('audio bytes')
  })

  it('dedupes the same stemCID cached under both shared and jam into one real file', async () => {
    const sharedPath = writeOldStem('shared', 'riff_1', 'stem_dup', 'same audio')
    const jamPath = writeOldStem('jam', 'riff_2', 'stem_dup', 'same audio')
    const { migrateEndlesssStemCache } = await import('./stemCacheMigration')
    migrateEndlesssStemCache()
    const newPath = join(userDataDir, 'endlesss-cache', 'stems', 's', 'stem_dup')
    expect(lstatSync(sharedPath).isSymbolicLink()).toBe(true)
    expect(lstatSync(jamPath).isSymbolicLink()).toBe(true)
    expect(readFileSync(newPath, 'utf-8')).toBe('same audio')
  })

  it('is idempotent -- a second run is a no-op', async () => {
    const oldPath = writeOldStem('jam', 'riff_1', 'stem_abc', 'audio bytes')
    const { migrateEndlesssStemCache } = await import('./stemCacheMigration')
    migrateEndlesssStemCache()
    migrateEndlesssStemCache()
    expect(lstatSync(oldPath).isSymbolicLink()).toBe(true)
    const newPath = join(userDataDir, 'endlesss-cache', 'stems', 's', 'stem_abc')
    expect(readFileSync(newPath, 'utf-8')).toBe('audio bytes')
  })

  it('discards a stale .downloading leftover instead of migrating it as a fake stem', async () => {
    const dir = join(userDataDir, 'endlesss-cache', 'stems', 'jam', 'riff_1')
    mkdirSync(dir, { recursive: true })
    const staleDownloadPath = join(dir, 'stem_partial.downloading')
    writeFileSync(staleDownloadPath, 'incomplete')
    const { migrateEndlesssStemCache } = await import('./stemCacheMigration')
    migrateEndlesssStemCache()
    expect(existsSync(staleDownloadPath)).toBe(false)
  })

  it('does nothing when neither old tree exists', async () => {
    const { migrateEndlesssStemCache } = await import('./stemCacheMigration')
    expect(() => migrateEndlesssStemCache()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/main/stemCacheMigration.test.ts
```

Expected: FAIL — `Cannot find module './stemCacheMigration'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/main/stemCacheMigration.ts`:

```ts
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  symlinkSync,
  unlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const OLD_SOURCES: ('shared' | 'jam')[] = ['shared', 'jam']

function stemsRoot(): string {
  return join(app.getPath('userData'), 'endlesss-cache', 'stems')
}

function oldSourceDir(source: 'shared' | 'jam'): string {
  return join(stemsRoot(), source)
}

function newStemPath(stemCID: string): string {
  return join(stemsRoot(), stemCID.slice(0, 1), stemCID)
}

/**
 * One-time, idempotent migration off the old source-partitioned stem cache
 * (endlesss-cache/stems/<shared|jam>/<riffCID>/<stemCID>) onto the new
 * content-addressed one (endlesss-cache/stems/<stemCID[0]>/<stemCID>) -- see
 * docs/superpowers/specs/2026-08-08-endlesss-cache-disk-efficiency-design.md.
 *
 * For every real file still sitting under the old trees: moves it to its
 * new content-addressed path, or -- if that path is already occupied (the
 * SAME stemCID already migrated from the other source: a true duplicate) --
 * deletes this copy instead. Either way, leaves a symlink at the old path
 * pointing at the new one. The symlink matters: a stem's path can already
 * be baked as a literal string into a saved .sssketchproj project file, and
 * a plain move+delete would silently break playback for any such project.
 *
 * Skips anything already migrated -- checked via lstatSync (not existsSync)
 * so a symlink is recognized as "already done" without following it, making
 * a second run on every app startup a fast no-op scan once migration has
 * actually happened, with no separate "did this already run" marker file
 * needed. Also discards stale `.downloading` leftovers from an interrupted
 * download (see downloadOneEndlesssStem in endlesssApi.ts) rather than
 * migrating one as if it were a real stemCID.
 */
export function migrateEndlesssStemCache(): void {
  for (const source of OLD_SOURCES) {
    const sourceDir = oldSourceDir(source)
    if (!existsSync(sourceDir)) continue
    for (const riffCID of readdirSync(sourceDir)) {
      const riffDir = join(sourceDir, riffCID)
      if (!lstatSync(riffDir).isDirectory()) continue
      for (const entryName of readdirSync(riffDir)) {
        const oldPath = join(riffDir, entryName)
        if (lstatSync(oldPath).isSymbolicLink()) continue
        if (entryName.endsWith('.downloading')) {
          unlinkSync(oldPath)
          continue
        }
        const stemCID = entryName
        const newPath = newStemPath(stemCID)
        if (existsSync(newPath)) {
          unlinkSync(oldPath)
        } else {
          mkdirSync(join(stemsRoot(), stemCID.slice(0, 1)), { recursive: true })
          renameSync(oldPath, newPath)
        }
        symlinkSync(newPath, oldPath)
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/main/stemCacheMigration.test.ts
```

Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/stemCacheMigration.ts src/main/stemCacheMigration.test.ts
git commit -m "Add one-time migration off the old source-partitioned stem cache"
```

---

### Task 3: Run the migration at app startup

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Import and call the migration**

Find the import block near the top of `src/main/index.ts` (alongside the other
`./something` imports, e.g. `import { listFavouriteRiffCIDs, toggleFavouriteRiff } from
'./riffFavourites'`) and add:

```ts
import { migrateEndlesssStemCache } from './stemCacheMigration'
```

Then inside `app.whenReady().then(async () => {`, right after the
`electronApp.setAppUserModelId('com.ellinglien.sssketch')` line, add:

```ts
  // One-time (idempotent) migration off the old source-partitioned Endlesss
  // stem cache -- see stemCacheMigration.ts's own doc comment. Cheap once
  // already migrated (a symlink-recognizing scan, no real work), so no need
  // to gate this behind anything or run it off the main thread.
  migrateEndlesssStemCache()
```

- [ ] **Step 2: Verify the app still starts cleanly**

```bash
npm run typecheck
```

Expected: clean.

```bash
npm run dev
```

Expected: app launches with no errors in the terminal or DevTools console related to
`stemCacheMigration`. Quit the app (Cmd+Q) once confirmed.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "Run the Endlesss stem cache migration at app startup"
```

---

### Task 4: Size-capped LRU eviction for stretch-cache

**Files:**
- Modify: `src/main/rubberband.ts`
- Test: `src/main/rubberband.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/main/rubberband.test.ts` (below the existing `cacheKey` describe block):

```ts
import { pathsToEvict } from './rubberband'

describe('pathsToEvict', () => {
  it('evicts nothing when total size is under the limit', () => {
    const entries = [
      { path: '/a', size: 100, mtimeMs: 1 },
      { path: '/b', size: 100, mtimeMs: 2 }
    ]
    expect(pathsToEvict(entries, 1000)).toEqual([])
  })

  it('evicts the oldest entries first until under the limit', () => {
    const entries = [
      { path: '/old', size: 600, mtimeMs: 1 },
      { path: '/mid', size: 300, mtimeMs: 2 },
      { path: '/new', size: 300, mtimeMs: 3 }
    ]
    expect(pathsToEvict(entries, 700)).toEqual(['/old', '/mid'])
  })

  it('stops evicting as soon as the total drops back under the limit', () => {
    const entries = [
      { path: '/old', size: 500, mtimeMs: 1 },
      { path: '/new', size: 400, mtimeMs: 2 }
    ]
    expect(pathsToEvict(entries, 800)).toEqual(['/old'])
  })
})
```

(This needs the top-level `import { cacheKey } from './rubberband'` line changed to
`import { cacheKey, pathsToEvict } from './rubberband'`.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/main/rubberband.test.ts
```

Expected: FAIL — `pathsToEvict` is not exported yet.

- [ ] **Step 3: Implement eviction in `rubberband.ts`**

Update the import line at the top of `src/main/rubberband.ts`:

```ts
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  utimesSync
} from 'fs'
```

Replace `cacheDir`'s doc comment (the "no eviction policy" one, now stale) and add the
eviction constants/functions right after it:

```ts
function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'stretch-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

// A fixed constant rather than user-configurable, matching this codebase's
// existing convention for tuning knobs like STEM_DOWNLOAD_RETRIES in
// endlesssApi.ts.
const MAX_STRETCH_CACHE_BYTES = 1024 * 1024 * 1024 // 1GB

interface CacheEntry {
  path: string
  size: number
  mtimeMs: number
}

/** Pure sizing logic, kept separate from the real fs scan in
 * enforceStretchCacheLimit below so it's testable without touching disk --
 * given a cache's current entries and a byte cap, returns which paths to
 * delete (oldest mtime first) to bring the total back under the cap. */
export function pathsToEvict(entries: CacheEntry[], maxBytes: number): string[] {
  const sorted = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs)
  let total = entries.reduce((sum, e) => sum + e.size, 0)
  const toEvict: string[] = []
  for (const entry of sorted) {
    if (total <= maxBytes) break
    toEvict.push(entry.path)
    total -= entry.size
  }
  return toEvict
}

function enforceStretchCacheLimit(dir: string): void {
  const entries: CacheEntry[] = readdirSync(dir).map((name) => {
    const path = join(dir, name)
    const stat = statSync(path)
    return { path, size: stat.size, mtimeMs: stat.mtimeMs }
  })
  for (const path of pathsToEvict(entries, MAX_STRETCH_CACHE_BYTES)) {
    unlinkSync(path)
  }
}

// Marks a cache HIT as recently used. Without this, LRU-by-mtime would
// evict frequently-reused-but-never-re-rendered files first, since their
// mtime never updates on a hit -- backwards from correct LRU behavior.
function touchCacheEntry(path: string): void {
  const now = new Date()
  utimesSync(path, now, now)
}
```

Then update `renderStretched` itself:

```ts
export async function renderStretched(stemPath: string, ratio: number): Promise<StretchedStem> {
  if (Math.abs(ratio - 1) < 0.001) {
    return { path: stemPath, durationSec: readWavDurationSeconds(readFileSync(stemPath)) }
  }

  const outPath = join(cacheDir(), cacheKey(stemPath, ratio))
  if (existsSync(outPath)) {
    touchCacheEntry(outPath)
  } else {
    const binary = findRubberband()
    await execFileAsync(binary, ['-q', '--tempo', ratio.toFixed(6), stemPath, outPath])
    enforceStretchCacheLimit(cacheDir())
  }
  return { path: outPath, durationSec: readWavDurationSeconds(readFileSync(outPath)) }
}
```

(The `-- --tempo` comment block above the `execFileAsync` call stays exactly as-is, just
now followed by the new `enforceStretchCacheLimit` call instead of falling straight
through to the final `return`.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/main/rubberband.test.ts
```

Expected: PASS, all 8 tests (5 existing `cacheKey` + 3 new `pathsToEvict`).

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/rubberband.ts src/main/rubberband.test.ts
git commit -m "Add size-capped LRU eviction to stretch-cache"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass (819 existing + 5 new `stemCacheMigration` + 3 new
`pathsToEvict` = 827).

- [ ] **Step 2: Typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: both clean.

- [ ] **Step 3: Manual walkthrough (cannot be done by an agent — flag for Elling)**

This needs a real machine with actual synced Endlesss stems and actual tempo-stretch
usage, so it can't be verified by an agent alone:

1. Quit sssketch fully if running (Cmd+Q), then relaunch via `npm run dev`.
2. Check the terminal/DevTools console for any error mentioning
   `stemCacheMigration`/`migrateEndlesssStemCache`.
3. Open a project that has previously-synced Endlesss stems and confirm they still play
   back correctly (proves the migration's symlinks resolve).
4. Check `~/Library/Application Support/sssketch-dev/endlesss-cache/stems/` — the old
   `shared/`/`jam/` directories should still exist but their contents should now be
   symlinks (`ls -la` shows `->` targets), and a new top-level scheme of single-hex-char
   directories should be present alongside them.
5. Drag the tempo slider around on a project with a few rifffs, then check
   `~/Library/Application Support/sssketch-dev/stretch-cache/` total size stays bounded
   over an extended session (`du -sh stretch-cache`) rather than growing unboundedly.

- [ ] **Step 4: Commit if any fixes were needed during verification**

Only if Steps 1-3 above turned up something to fix — otherwise nothing to commit here.

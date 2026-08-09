# LORE Warehouse — Reading sssketch's Own Warehouse (Plan 2b-1 of 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `loreWarehouse.ts` (the existing reader, previously only used against an externally-synced
OUROVEON folder) able to read sssketch's own self-built warehouse too — as the new default when no
external folder has been configured — so the upcoming merged library browser (Plan 2b-2, not yet
written) can read through one set of `lore-*` IPC channels regardless of which warehouse is active.

**Architecture:** `loreWarehouse.ts` currently resolves a single active warehouse root
(`warehouseRootPath()`) and reads/writes exactly one on-disk convention (`cache/common/warehouse.db3`
+ jam-sharded `cache/common/stem_v2/<jamCID>/<shard>/<stemCID>` stem files) — the real layout a synced
OUROVEON/LORE folder produces on disk. Two small, additive changes make it also work correctly against
sssketch's own self-built warehouse (`loreWarehouseSchema.ts`'s `ownWarehouseRoot()`), without changing
any exported function's signature or touching the external-folder path at all when one is configured:
1. `warehouseRootPath()`'s *default* (when no `loreWarehousePrefs.json` exists yet) changes from a
   hardcoded path that only exists on Elling's machine to `ownWarehouseRoot()` — every other user, and
   Elling once he's explicitly picked a folder, is completely unaffected.
2. `resolveStemPath()` branches: when the *currently active* root is the self-built warehouse, stem
   audio is looked up via the same content-addressed cache `endlesssApi.ts`'s sync already downloads
   into (`<userData>/endlesss-cache/stems/<shard>/<stemCID>`) — not the jam-sharded `stem_v2` layout,
   which nothing populates for the self-built warehouse and which would make every stem look permanently
   uncached.

**Tech Stack:** TypeScript, `better-sqlite3`, Vitest.

**Scope note — this is Plan 2b-1 of 2 ("2b" being the browser-merge half of the larger LORE warehouse
redesign; "2b-2", not yet written, is the actual UI merge + retirement of `EndlesssLibraryBrowser.tsx`/
`LoreLibraryBrowser.tsx`/`endlesssSyncIndex.ts`/`endlesssSync.ts`).** This plan only changes
`loreWarehouse.ts`'s internals — no UI, no IPC channel, no other file changes. It's split out on its own
because it's a genuine, independently-testable architectural fix (a real gap: the self-built warehouse's
stems are stored differently than a real LORE folder's, and nothing currently reconciles that), and
because getting it right and merged first means Plan 2b-2 can build the merged browser directly against
already-working `lore-*` reads instead of discovering this gap mid-UI-work.

**Why this is a safe change despite touching an already-shipped, working file:** `loreWarehouse.ts`'s
own tests (`loreWarehouse.test.ts`) already exercise a real fixture warehouse via
`setWarehouseRootForTests()`. The design goal here is that with NO prefs file and NO test override
(fresh install, nobody has touched the folder picker), the default is now the self-built warehouse; the
moment a user (like Elling, who already has a real synced external folder) explicitly configures a root
via `setWarehouseRoot()`, that value is what `warehouseRootPath()` returns from then on, and every
existing behavior (jam-sharded stem lookup, real warehouse reading) is completely unchanged. Nothing
about the *external*-warehouse code path changes at all.

---

### Task 1: `warehouseRootPath()` defaults to the self-built warehouse

**Files:**
- Modify: `src/main/loreWarehouse.ts`
- Test: `src/main/loreWarehouse.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/loreWarehouse.test.ts`, inside the existing `describe('loreWarehouse', ...)` block
(near the other `warehouseRootPath`-related tests):

```typescript
  it('warehouseRootPath defaults to the self-built warehouse root when no prefs file exists', async () => {
    const { ownWarehouseRoot } = await import('./loreWarehouseSchema')
    setWarehouseRootForTests(null) // clear the test override this file's other tests rely on
    expect(warehouseRootPath()).toBe(ownWarehouseRoot())
  })
```

(This test file already mocks `electron`'s `app.getPath` to return an isolated `userDataDir`
per-test via `beforeEach`/`afterEach` — `ownWarehouseRoot()` reads the same mocked `app.getPath`,
so both sides of the comparison resolve against the same isolated directory.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/loreWarehouse.test.ts -t "defaults to the self-built"`
Expected: FAIL — `warehouseRootPath()` currently returns `LEGACY_DEFAULT_WAREHOUSE_ROOT`
(`/Volumes/Elling-Lien/ENDLESSS`), not `ownWarehouseRoot()`'s value.

- [ ] **Step 3: Write the implementation**

In `src/main/loreWarehouse.ts`, add an import:

```typescript
import { ownWarehouseRoot } from './loreWarehouseSchema'
```

Delete the `LEGACY_DEFAULT_WAREHOUSE_ROOT` constant and its doc comment entirely (both use sites are
replaced with `ownWarehouseRoot()` below). Elling's own existing setup is unaffected either way,
because he already has a `loreWarehousePrefs.json` file (from having used the folder picker
previously to point at his real synced folder) — the no-prefs-file default only ever mattered for
the very first launch before that file existed, which for Elling happened long ago. For every other
user, defaulting to a hardcoded path that only exists on Elling's own machine was already flagged as
a real bug (see this codebase's own beta-readiness cleanup, task "[Beta] Phase 1: broader sweep for
hardcoded Elling-specific defaults") — the fix is to remove it, not preserve it as a fallback.

Change `warehouseRootPath()` from:

```typescript
export function warehouseRootPath(): string {
  if (warehouseRootOverride !== null) return warehouseRootOverride
  const path = warehousePrefsPath()
  if (!existsSync(path)) return LEGACY_DEFAULT_WAREHOUSE_ROOT
  try {
    const prefs = JSON.parse(readFileSync(path, 'utf-8')) as { root?: string }
    return prefs.root ?? LEGACY_DEFAULT_WAREHOUSE_ROOT
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`warehouseRootPath: failed to read ${path}: ${message}`)
    return LEGACY_DEFAULT_WAREHOUSE_ROOT
  }
}
```

to:

```typescript
/** Where the user's LORE-style warehouse lives -- user-relocatable (see
 * setWarehouseRoot). Defaults to sssketch's own self-built warehouse
 * (ownWarehouseRoot(), populated by loreWarehouseSync.ts's background sync)
 * until a user explicitly points this at a real, externally-managed
 * OUROVEON-synced folder via the folder picker -- see the design spec's
 * Favourites + external-warehouse compatibility section
 * (docs/superpowers/specs/2026-08-09-lore-warehouse-sync-design.md).
 * Once a prefs file exists, whatever root is saved there always wins; this
 * default is only consulted on a genuinely first-ever launch. Read fresh
 * every call rather than cached, matching projectLibrary.ts's own
 * libraryRootPath convention. */
export function warehouseRootPath(): string {
  if (warehouseRootOverride !== null) return warehouseRootOverride
  const path = warehousePrefsPath()
  if (!existsSync(path)) return ownWarehouseRoot()
  try {
    const prefs = JSON.parse(readFileSync(path, 'utf-8')) as { root?: string }
    return prefs.root ?? ownWarehouseRoot()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`warehouseRootPath: failed to read ${path}: ${message}`)
    return ownWarehouseRoot()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/loreWarehouse.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones — confirms this default
change doesn't break any test that relies on `setWarehouseRootForTests` explicitly overriding the
root, since every existing test in this file already does that)

- [ ] **Step 5: Commit**

```bash
git add src/main/loreWarehouse.ts src/main/loreWarehouse.test.ts
git commit -m "$(cat <<'EOF'
warehouseRootPath() defaults to sssketch's own self-built warehouse

The old default (a hardcoded path only present on Elling's own machine)
was already flagged as a beta-readiness bug -- removed rather than kept as
a secondary fallback. Elling's own existing setup is unaffected: he already
has a loreWarehousePrefs.json from using the folder picker, which always
wins regardless of what the no-prefs-file default is.
EOF
)"
```

---

### Task 2: `resolveStemPath()` branches on own vs. external warehouse

**Files:**
- Modify: `src/main/loreWarehouse.ts`
- Test: `src/main/loreWarehouse.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/loreWarehouse.test.ts`:

```typescript
  it('resolveStemPath uses the content-addressed endlesss-cache layout for the self-built warehouse', async () => {
    const { ownWarehouseRoot } = await import('./loreWarehouseSchema')
    setWarehouseRootForTests(ownWarehouseRoot())
    expect(resolveStemPath('jam_1', 'stem_abc123')).toBe(
      join(userDataDir, 'endlesss-cache', 'stems', 's', 'stem_abc123')
    )
  })

  it('resolveStemPath still uses the jam-sharded stem_v2 layout for an external warehouse', () => {
    setWarehouseRootForTests('/some/external/lore-folder')
    expect(resolveStemPath('jam_1', 'stem_abc123')).toBe(
      join('/some/external/lore-folder', 'cache', 'common', 'stem_v2', 'jam_1', 's', 'stem_abc123')
    )
  })
```

(`userDataDir` is this test file's own existing module-level test variable, already set fresh per-test
by the existing `beforeEach`. `join` is already imported in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/loreWarehouse.test.ts -t "content-addressed"`
Expected: FAIL — `resolveStemPath` currently always uses the jam-sharded `stem_v2` layout regardless
of which root is active, so the first new test's expected path won't match.

- [ ] **Step 3: Write the implementation**

In `src/main/loreWarehouse.ts`, replace:

```typescript
/** Stem audio is sharded by jam and by the first hex character of the
 * StemCID: cache/common/stem_v2/<JamCID>/<first-hex-char>/<StemCID>, no file
 * extension. Traced from real LORE-synced data, not guessed. */
export function resolveStemPath(jamCID: string, stemCID: string): string {
  const shard = stemCID[0]
  return join(stemCacheRoot(), jamCID, shard, stemCID)
}
```

with:

```typescript
/** Stem audio lives in one of two places depending on which warehouse is
 * currently active:
 *
 * - An EXTERNAL, real OUROVEON-synced folder: sharded by jam and by the
 *   first hex character of the StemCID --
 *   cache/common/stem_v2/<JamCID>/<first-hex-char>/<StemCID>, no file
 *   extension. Traced from real LORE-synced data, not guessed.
 * - sssketch's OWN self-built warehouse: loreWarehouseSync.ts's sync
 *   downloads stem audio via endlesssApi.ts's downloadMissingStemsFor,
 *   which reuses that module's own existing content-addressed cache
 *   (endlesss-cache/stems/<first-hex-char>/<StemCID>, keyed by stemCID
 *   alone, no jam-sharding) rather than duplicating storage into a second,
 *   jam-sharded layout nothing else needs. jamCID is accepted but unused in
 *   this branch, kept for signature parity with the external case.
 */
export function resolveStemPath(jamCID: string, stemCID: string): string {
  const shard = stemCID[0]
  if (warehouseRootPath() === ownWarehouseRoot()) {
    return join(app.getPath('userData'), 'endlesss-cache', 'stems', shard, stemCID)
  }
  return join(stemCacheRoot(), jamCID, shard, stemCID)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/loreWarehouse.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add src/main/loreWarehouse.ts src/main/loreWarehouse.test.ts
git commit -m "$(cat <<'EOF'
resolveStemPath branches between own and external warehouse stem layouts

The self-built warehouse's sync reuses endlesssApi.ts's existing
content-addressed stem cache rather than duplicating storage into the
jam-sharded stem_v2 layout a real external LORE folder uses on disk --
without this, every stem in the self-built warehouse would read as
permanently uncached even after a successful sync.
EOF
)"
```

---

### Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: all tests pass except the same pre-existing, unrelated native-engine-binary failures
already documented in the prior two plans' own Task/Step verification (this worktree has no
compiled `native-engine/build`)

- [ ] **Step 4: Manual walkthrough — flag explicitly, don't claim it was done**

A real end-to-end check (fresh app launch with no `loreWarehousePrefs.json`, confirm
`LoreLibraryBrowser.tsx`'s existing "warehouse not available" UI now instead shows the self-built
warehouse as available once something has synced into it; confirm a real external-folder pick via
the existing folder-picker UI still works exactly as before) requires the real running app and, for
the external-folder half, a real synced OUROVEON folder on disk — cannot be completed by an
implementer subagent solo. Say so explicitly rather than claiming it was verified.

- [ ] **Step 5: Commit (only if Steps 1-3 required any fixes not already committed)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix verification issues found in full-suite run
EOF
)"
```

# Plugin Rescan Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a repeat "scan for plugins" fast by skipping the isolated-subprocess probe for any plugin bundle whose mtime hasn't changed since the last scan.

**Architecture:** Add a `getMtimeMs(path)` helper to `pluginScan.ts` (never throws — returns `null` on any stat failure). Add an `mtimeMs: number` field to `CatalogEntry` (`pluginCatalog.ts`). `runFullScan.ts` builds a `path -> CatalogEntry[]` lookup from the previous catalog and, for each candidate, reuses the previous entries verbatim when the freshly-stat'd mtime matches every one of them — otherwise it scans normally, exactly as today.

**Tech Stack:** TypeScript, Node `node:fs`, Vitest.

Full design context: `docs/superpowers/specs/2026-08-02-plugin-rescan-caching-design.md`.

---

### Task 1: `getMtimeMs` helper in `pluginScan.ts`

**Files:**
- Modify: `src/main/pluginScan.ts`
- Test: `src/main/pluginScan.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/pluginScan.test.ts`, after the existing `isAuCandidate` describe block (before `describe('scanOneCandidate', ...)`):

```ts
describe('getMtimeMs', () => {
  it('returns the mtime (in ms) of a file that exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-mtime-test-'))
    try {
      const path = join(dir, 'fake.vst3')
      writeFileSync(path, 'x')
      const mtimeMs = getMtimeMs(path)
      expect(mtimeMs).not.toBeNull()
      expect(mtimeMs).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a path that does not exist', () => {
    expect(getMtimeMs('/no/such/plugin.vst3')).toBeNull()
  })
})
```

Add `getMtimeMs` to the existing import line at the top of the file:

```ts
import { isVst3Candidate, isAuCandidate, scanOneCandidate, getMtimeMs } from './pluginScan'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/pluginScan.test.ts`
Expected: FAIL — `getMtimeMs` is not exported from `./pluginScan`.

- [ ] **Step 3: Implement `getMtimeMs`**

In `src/main/pluginScan.ts`, change the `node:fs` import (currently `import { readdirSync, existsSync } from 'node:fs'`) to also pull in `statSync`:

```ts
import { readdirSync, existsSync, statSync } from 'node:fs'
```

Add this function after `listPluginCandidates` (before `defaultBinaryPath`):

```ts
/** A candidate bundle's own mtime, in milliseconds -- `null` on any stat
 * failure (doesn't exist, permission error, race condition against
 * listPluginCandidates' own directory listing). Never throws. Used by
 * runFullScan.ts to skip re-scanning a candidate whose bundle hasn't
 * changed since the last scan -- see
 * docs/superpowers/specs/2026-08-02-plugin-rescan-caching-design.md. */
export function getMtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/pluginScan.test.ts`
Expected: PASS (all tests in the file, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/main/pluginScan.ts src/main/pluginScan.test.ts
git commit -m "Add getMtimeMs helper for plugin bundle change detection"
```

---

### Task 2: Add `mtimeMs` to `CatalogEntry`

**Files:**
- Modify: `src/main/pluginCatalog.ts`
- Modify: `src/main/pluginCatalog.test.ts`
- Modify: `src/main/runFullScan.test.ts`

This is a type-only addition with no new runtime behavior of its own — verified by `tsc`, not a new unit test. The two existing test files that construct `CatalogEntry` literals need updating so they still type-check.

- [ ] **Step 1: Add the field**

In `src/main/pluginCatalog.ts`, change:

```ts
export interface CatalogEntry {
  id: string // native engine's PluginDescription::createIdentifierString()
  name: string
  manufacturer: string
  path: string
  arch: 'arm64' | 'x86_64' | 'universal' | 'unknown'
}
```

to:

```ts
export interface CatalogEntry {
  id: string // native engine's PluginDescription::createIdentifierString()
  name: string
  manufacturer: string
  path: string
  arch: 'arm64' | 'x86_64' | 'universal' | 'unknown'
  mtimeMs: number // candidate bundle's own mtime at scan time -- see getMtimeMs (pluginScan.ts)
}
```

- [ ] **Step 2: Fix the now-broken test literals**

In `src/main/pluginCatalog.test.ts`, the `writeCatalog then loadCatalog round-trips` test's plugin literal (currently ends `path: '/a.vst3', arch: 'arm64' as const`) becomes:

```ts
    const catalog = {
      plugins: [
        {
          id: 'x',
          name: 'Solid Bus Comp',
          manufacturer: 'NI',
          path: '/a.vst3',
          arch: 'arm64' as const,
          mtimeMs: 1000
        }
      ],
      favouriteIds: ['x']
    }
```

The `toggleFavourite` test's plugin literal (currently `{ id: 'x', name: 'A', manufacturer: 'M', path: '/a.vst3', arch: 'arm64' }`) becomes:

```ts
      plugins: [{ id: 'x', name: 'A', manufacturer: 'M', path: '/a.vst3', arch: 'arm64', mtimeMs: 1000 }],
```

In `src/main/runFullScan.test.ts`, the `previous` catalog literal in the `preserves a favourite...` test (currently `{ id: 'id-gone', name: 'Gone', manufacturer: 'M', path: '/gone.vst3', arch: 'arm64' }`) becomes:

```ts
        { id: 'id-gone', name: 'Gone', manufacturer: 'M', path: '/gone.vst3', arch: 'arm64', mtimeMs: 1000 }
```

- [ ] **Step 3: Verify with typecheck**

Run: `npm run typecheck:node`
Expected: no errors.

- [ ] **Step 4: Run the full existing test suite to confirm nothing broke**

Run: `npx vitest run src/main/pluginCatalog.test.ts src/main/runFullScan.test.ts`
Expected: PASS (same tests as before, now type-checking cleanly with the new field).

- [ ] **Step 5: Commit**

```bash
git add src/main/pluginCatalog.ts src/main/pluginCatalog.test.ts src/main/runFullScan.test.ts
git commit -m "Add mtimeMs field to CatalogEntry"
```

---

### Task 3: Wire a controllable `getMtimeMs` into `runFullScan.test.ts`'s mock

**Files:**
- Modify: `src/main/runFullScan.test.ts`

Sets up the test infrastructure Task 4's new tests need, without changing any existing test's behavior: `getMtimeMs` defaults to returning `null` for everything, which — per the design — means "couldn't determine mtime, fall through to a full scan," i.e. exactly today's unconditional-scan behavior. This task should produce **zero change** in what the existing tests assert or how they behave.

- [ ] **Step 1: Add a hoisted mock and wire it into the `./pluginScan` mock**

At the top of `src/main/runFullScan.test.ts`, right after the `import` lines and before the existing `vi.mock('./pluginScan', ...)` call, add:

```ts
const { getMtimeMsMock } = vi.hoisted(() => ({
  getMtimeMsMock: vi.fn((): number | null => null)
}))
```

Change the existing mock's `scanOneCandidate` entry to keep its current body untouched, but add a `getMtimeMs` entry so the final mock reads:

```ts
vi.mock('./pluginScan', () => ({
  listPluginCandidates: () => [
    '/a.vst3',
    '/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3',
    '/instrument.vst3'
  ],
  scanOneCandidate: async (path: string) => {
    if (path === '/a.vst3') {
      return {
        success: true,
        plugins: [
          {
            name: 'A',
            manufacturer: 'M',
            identifierString: 'id-a',
            arch: 'arm64',
            isInstrument: false
          }
        ]
      }
    }
    if (path === '/instrument.vst3') {
      return {
        success: true,
        plugins: [
          {
            name: 'Some Synth',
            manufacturer: 'M',
            identifierString: 'id-synth',
            arch: 'arm64',
            isInstrument: true
          }
        ]
      }
    }
    return {
      success: true,
      plugins: [
        {
          name: 'Solid Bus Comp',
          manufacturer: 'NI',
          identifierString: 'id-sbc',
          arch: 'universal',
          isInstrument: false
        }
      ]
    }
  },
  getMtimeMs: getMtimeMsMock
}))
```

Reset the mock's behavior before every test so tests can't leak overrides into each other — add to the existing `beforeEach`:

```ts
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-fullscan-test-'))
    getMtimeMsMock.mockReset().mockImplementation(() => null)
  })
```

- [ ] **Step 2: Run the full existing test suite to confirm zero behavior change**

Run: `npx vitest run src/main/runFullScan.test.ts`
Expected: PASS — the same four pre-existing tests (favourite preservation, instrument exclusion, first-scan auto-favourite, progress-once-per-candidate) pass exactly as they did before this task, now via the `getMtimeMs → null → always falls through to scanOneCandidate` path once Task 4/5 add that branch. (At this point in the plan `runFullScan.ts` doesn't call `getMtimeMs` yet at all, so this step is really just confirming the test file's mock setup itself is valid — it should still pass.)

- [ ] **Step 3: Commit**

```bash
git add src/main/runFullScan.test.ts
git commit -m "Add controllable getMtimeMs mock to runFullScan tests"
```

---

### Task 4: Failing tests for the caching behavior

**Files:**
- Modify: `src/main/runFullScan.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `src/main/runFullScan.test.ts`, inside the outer `describe('runFullScan', ...)`, after the existing `it('reports progress once per candidate', ...)` test:

```ts
  describe('caching by mtime', () => {
    it('reuses a previous entry without rescanning when the bundle mtime is unchanged', async () => {
      const { writeCatalog } = await import('./pluginCatalog')
      writeCatalog({
        plugins: [
          {
            id: 'id-a',
            name: 'A (cached)',
            manufacturer: 'M (cached)',
            path: '/a.vst3',
            arch: 'arm64',
            mtimeMs: 5000
          }
        ],
        favouriteIds: []
      })
      getMtimeMsMock.mockImplementation((path: string) => (path === '/a.vst3' ? 5000 : null))

      const scanCalls: string[] = []
      const { scanOneCandidate } = await import('./pluginScan')
      vi.mocked(scanOneCandidate).mockImplementation(async (path: string) => {
        scanCalls.push(path)
        return { success: true, plugins: [] }
      })

      const { runFullScan } = await import('./runFullScan')
      const catalog = await runFullScan(() => {})

      expect(scanCalls).not.toContain('/a.vst3')
      const cachedEntry = catalog.plugins.find((p) => p.id === 'id-a')
      expect(cachedEntry).toEqual({
        id: 'id-a',
        name: 'A (cached)',
        manufacturer: 'M (cached)',
        path: '/a.vst3',
        arch: 'arm64',
        mtimeMs: 5000
      })
    })

    it('rescans a candidate whose mtime differs from its stored value', async () => {
      const { writeCatalog } = await import('./pluginCatalog')
      writeCatalog({
        plugins: [
          {
            id: 'id-a-old',
            name: 'A (stale)',
            manufacturer: 'M',
            path: '/a.vst3',
            arch: 'arm64',
            mtimeMs: 1111
          }
        ],
        favouriteIds: []
      })
      // Stored mtime was 1111; this scan sees 2222 -- a real change.
      getMtimeMsMock.mockImplementation((path: string) => (path === '/a.vst3' ? 2222 : null))

      const { runFullScan } = await import('./runFullScan')
      const catalog = await runFullScan(() => {})

      // scanOneCandidate's default mock (from the top-level vi.mock) returns
      // id-a for '/a.vst3' -- if caching incorrectly kicked in, we'd see
      // 'id-a-old' instead.
      expect(catalog.plugins.map((p) => p.id)).toContain('id-a')
      expect(catalog.plugins.map((p) => p.id)).not.toContain('id-a-old')
      const rescannedEntry = catalog.plugins.find((p) => p.id === 'id-a')
      expect(rescannedEntry?.mtimeMs).toBe(2222)
    })

    it('scans a candidate with no previous catalog entry normally', async () => {
      // No writeCatalog call -- previous catalog is empty, so every
      // candidate is "new." getMtimeMsMock's default (from beforeEach)
      // already returns null for everything.
      const { runFullScan } = await import('./runFullScan')
      const catalog = await runFullScan(() => {})
      expect(catalog.plugins.map((p) => p.id).sort()).toEqual(['id-a', 'id-sbc'])
    })

    it('reports progress once per candidate even when some are cached', async () => {
      const { writeCatalog } = await import('./pluginCatalog')
      writeCatalog({
        plugins: [
          {
            id: 'id-a',
            name: 'A',
            manufacturer: 'M',
            path: '/a.vst3',
            arch: 'arm64',
            mtimeMs: 5000
          }
        ],
        favouriteIds: []
      })
      getMtimeMsMock.mockImplementation((path: string) => (path === '/a.vst3' ? 5000 : null))

      const { runFullScan } = await import('./runFullScan')
      const progressCalls: unknown[] = []
      await runFullScan((p) => progressCalls.push(p))
      expect(progressCalls).toEqual([
        { done: 1, total: 3 },
        { done: 2, total: 3 },
        { done: 3, total: 3 }
      ])
    })
  })
```

Add `vi` to the existing top-of-file import if it isn't already there (it already is — `import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'`), and change the existing `scanOneCandidate: async (path: string) => { ... }` entry inside the `vi.mock('./pluginScan', ...)` factory (added in Task 3) to a `vi.fn()`-wrapped version so the new "reuses without rescanning" test can assert on calls to it:

```ts
  scanOneCandidate: vi.fn(async (path: string) => {
    if (path === '/a.vst3') {
      return {
        success: true,
        plugins: [
          {
            name: 'A',
            manufacturer: 'M',
            identifierString: 'id-a',
            arch: 'arm64',
            isInstrument: false
          }
        ]
      }
    }
    if (path === '/instrument.vst3') {
      return {
        success: true,
        plugins: [
          {
            name: 'Some Synth',
            manufacturer: 'M',
            identifierString: 'id-synth',
            arch: 'arm64',
            isInstrument: true
          }
        ]
      }
    }
    return {
      success: true,
      plugins: [
        {
          name: 'Solid Bus Comp',
          manufacturer: 'NI',
          identifierString: 'id-sbc',
          arch: 'universal',
          isInstrument: false
        }
      ]
    }
  }),
```

Since the "rescans a candidate whose mtime differs" and "no previous entry" and "progress" tests rely on this default implementation (not the one overridden inline in the "reuses" test), add a reset for it to `beforeEach` too, right after the `getMtimeMsMock` reset line from Task 3:

```ts
    const { scanOneCandidate } = await import('./pluginScan')
    vi.mocked(scanOneCandidate).mockClear()
```

(This goes inside `beforeEach`, which needs to become `async` to use `await import(...)`: change `beforeEach(() => {` to `beforeEach(async () => {`.)

- [ ] **Step 2: Run the tests to verify they fail correctly**

Run: `npx vitest run src/main/runFullScan.test.ts`
Expected: FAIL on the four new "caching by mtime" tests specifically (`runFullScan` doesn't call `getMtimeMs` yet, so nothing is ever cached — the "reuses without rescanning" test fails because `scanCalls` contains `/a.vst3`; the mtime-mismatch/no-entry/progress tests should already pass by coincidence since they describe today's behavior, which is fine). The four pre-existing tests above the new `describe` block still PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/runFullScan.test.ts
git commit -m "Add failing tests for plugin rescan caching"
```

---

### Task 5: Implement the caching logic

**Files:**
- Modify: `src/main/runFullScan.ts`

- [ ] **Step 1: Implement**

Replace the full contents of `src/main/runFullScan.ts` with:

```ts
// src/main/runFullScan.ts
import { listPluginCandidates, scanOneCandidate, getMtimeMs } from './pluginScan'
import { loadCatalog, writeCatalog, type CatalogEntry, type PluginCatalog } from './pluginCatalog'

export interface ScanProgress {
  done: number
  total: number
}

// The 5 plugins the old hardcoded allowlist (src/shared/masterChainAllowlist.ts,
// deleted once this scan feature replaced it) used to reference by path.
// Duplicated here rather than shared, matching this codebase's existing
// hand-synced-twin-table convention (e.g. schedulePlayback.ts/
// SchedulePlayback.cpp) -- see StoreContext.tsx's OLD_ALLOWLIST_SLUG_TO_PATH
// for the renderer-side twin (that one resolves a stale project save's old
// slug; this one seeds default favourites so upgrading from the hardcoded-
// allowlist version doesn't silently leave every dropdown empty).
const OLD_ALLOWLIST_PATHS = [
  '/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3',
  '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3',
  '/Library/Audio/Plug-Ins/VST3/soothe2.vst3',
  '/Library/Audio/Plug-Ins/VST3/SausageFattener.vst3',
  '/Library/Audio/Plug-Ins/VST3/TR5 Sunset Sound Studio Reverb.vst3'
]

/** Groups a catalog's entries by their bundle path -- a single bundle can
 * yield multiple entries (e.g. a multi-plugin VST3 bundle), so this is a
 * 1:many lookup, not 1:1. */
function groupByPath(entries: CatalogEntry[]): Map<string, CatalogEntry[]> {
  const map = new Map<string, CatalogEntry[]>()
  for (const entry of entries) {
    const list = map.get(entry.path) ?? []
    list.push(entry)
    map.set(entry.path, list)
  }
  return map
}

/** Runs a full VST3 + AU directory scan, one candidate at a time (sequential
 * -- see the design spec's rationale: simplest and safest for v1, avoids any
 * concurrency interaction with the per-candidate timeout/kill logic).
 * `onProgress` fires after each candidate finishes (success, cached, or not),
 * so the caller can push scan-progress over IPC without this module knowing
 * anything about IPC itself. Existing favourites are preserved for any
 * plugin id still found in this scan -- a scan is additive, never
 * destructive (see design spec's error-handling section).
 *
 * A candidate whose bundle mtime exactly matches every previously-scanned
 * entry at that path is reused without calling scanOneCandidate at all --
 * see docs/superpowers/specs/2026-08-02-plugin-rescan-caching-design.md.
 * getMtimeMs never throws; a stat failure (race condition, permissions)
 * just means this candidate can't be cache-matched and falls through to a
 * normal scan, same as if it had no previous entry at all. */
export async function runFullScan(
  onProgress: (progress: ScanProgress) => void
): Promise<PluginCatalog> {
  const candidates = listPluginCandidates()
  const previous = loadCatalog()
  const previousByPath = groupByPath(previous.plugins)
  const plugins: CatalogEntry[] = []

  for (let i = 0; i < candidates.length; i++) {
    const path = candidates[i]
    const mtimeMs = getMtimeMs(path)
    const cached = mtimeMs !== null ? previousByPath.get(path) : undefined
    const isUnchanged = cached !== undefined && cached.every((e) => e.mtimeMs === mtimeMs)

    if (isUnchanged) {
      plugins.push(...cached)
    } else {
      const result = await scanOneCandidate(path)
      if (result.success) {
        // Instruments (synths/samplers) are excluded from the catalog entirely --
        // this app hosts effects on stems/channels, never a sound source of its
        // own, so an instrument plugin would never be usable here anyway. Filtered
        // at scan time rather than just hidden in the browser, so it never takes
        // up space in the persisted catalog or a favourites list.
        for (const p of result.plugins.filter((p) => !p.isInstrument)) {
          plugins.push({
            id: p.identifierString,
            name: p.name,
            manufacturer: p.manufacturer,
            path,
            arch: p.arch,
            // 0 is a deliberate sentinel for "couldn't stat this time either" --
            // it will essentially never match a real future mtime, so this
            // candidate simply gets rescanned again next time too, rather than
            // silently caching against a wrong/missing value.
            mtimeMs: mtimeMs ?? 0
          })
        }
      }
    }
    onProgress({ done: i + 1, total: candidates.length })
  }

  // A favourite is NEVER dropped by a scan, whether or not this particular
  // scan found that plugin again -- a plugin can be temporarily unavailable
  // for reasons unrelated to being uninstalled (e.g. an external drive not
  // mounted). Only toggleFavourite (pluginCatalog.ts) ever removes one. See
  // the design spec's error-handling section.
  const favouriteIds = [...previous.favouriteIds]

  // One-time migration: the very first scan ever run (no catalog existed
  // before this one) auto-favourites any of the 5 old hardcoded-allowlist
  // plugins it finds, so upgrading from that version of the feature doesn't
  // silently leave every master-chain dropdown empty. Only on the first
  // scan -- a later rescan must never re-add a favourite the user
  // deliberately removed.
  if (previous.plugins.length === 0) {
    for (const plugin of plugins) {
      if (OLD_ALLOWLIST_PATHS.includes(plugin.path) && !favouriteIds.includes(plugin.id)) {
        favouriteIds.push(plugin.id)
      }
    }
  }

  const catalog: PluginCatalog = { plugins, favouriteIds }
  writeCatalog(catalog)
  return catalog
}
```

- [ ] **Step 2: Run the full test file to verify everything passes**

Run: `npx vitest run src/main/runFullScan.test.ts`
Expected: PASS — all 8 tests (4 pre-existing + 4 new caching tests).

- [ ] **Step 3: Run the full project test suite, typecheck, and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all three succeed with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/runFullScan.ts
git commit -m "Skip rescanning plugin bundles whose mtime is unchanged"
```

---

### Task 6: Manual verification

Not automatable — no live plugin directory / Electron GUI in this environment's test tooling.

- [ ] Launch the app (`npm run dev`), open the master chain panel, click "scan for plugins," let it finish, note roughly how long it took.
- [ ] Click "scan for plugins" again immediately (nothing on disk changed). Confirm it completes noticeably faster than the first run — the progress readout should fly through most/all candidates almost instantly.
- [ ] Confirm the plugin dropdowns/favourites look identical before and after the second scan (nothing lost, nothing duplicated).
- [ ] If convenient: rename or touch one installed `.vst3` bundle's top-level folder (changing its mtime) and rescan — confirm that one specific plugin gets freshly re-probed while the rest stay fast.

# LORE Riff-by-ID Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user paste a LORE riffCID into the library browser, resolve it, and jump straight to that riff's jam — centered on a ~20-riff window around it — instead of having to know which jam it's in and scroll to find it.

**Architecture:** One new backend function (`resolveRiffWithContext`) computes which jam a riffCID belongs to and an offset that centers a ~20-riff page on it, reusing the *existing* `listRiffs` pagination query to actually fetch that page — no new fetch machinery. The renderer gets a small ID input wired into `LoreLibraryBrowser`'s existing jam-select/riff-fetch/riff-select state, so importing a found riff is the exact same click-to-import flow already in place.

**Tech Stack:** Electron main process (`src/main/loreWarehouse.ts`, better-sqlite3), IPC (`src/main/index.ts` / `src/preload/index.ts`), React renderer (`src/renderer/src/components/LoreLibraryBrowser.tsx`), Vitest.

---

### Task 1: `resolveRiffWithContext` backend function

**Files:**
- Modify: `src/main/loreWarehouse.ts`
- Test: `src/main/loreWarehouse.test.ts`

`resolveRiff(riffCID)` (already in this file, around line 256) requires an *exact* match and returns stem data, not the jam/offset info this feature needs. This task adds a sibling function purpose-built for the lookup: given a riffCID (tolerating a trimmed/case-mismatched paste), return which jam it's in and the offset that centers a page on it — leaving the actual row-fetching to the existing `listRiffs`.

`listRiffs` also needs one small addition first: it always fetches `RIFF_PAGE_SIZE` (200) riffs per page, but the design spec calls for a ~20-riff centered window for a riff-ID jump, not a 200-riff one. This task adds an optional `limit` to `RiffFilters` (defaulting to `RIFF_PAGE_SIZE` when unset, so every existing caller is unaffected) so the jump feature can request a small page while normal jam browsing keeps its current page size.

- [ ] **Step 1: Write the failing tests**

Add this test to `src/main/loreWarehouse.test.ts`'s existing `describe('listRiffs', ...)` block, right after the `'paginates when a jam has more riffs than fit on one page'` test:

```ts
  it('respects a custom limit, for callers that want a smaller page than RIFF_PAGE_SIZE', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    seedStemsAndGains(root)
    setWarehouseRootForTests(root)

    // jam-techno has 2 riffs (riff-1, riff-2) -- a limit of 1 should return
    // exactly 1 and report hasMore correctly against THAT limit, not the
    // default RIFF_PAGE_SIZE.
    const page1 = listRiffs('jam-techno', { limit: 1 })
    expect(page1.riffs).toHaveLength(1)
    expect(page1.hasMore).toBe(true)
    expect(page1.nextOffset).toBe(1)

    const page2 = listRiffs('jam-techno', { limit: 1, offset: page1.nextOffset })
    expect(page2.riffs).toHaveLength(1)
    expect(page2.hasMore).toBe(false)
  })
```

Then add to `src/main/loreWarehouse.test.ts`, right after the closing `})` of the `describe('resolveRiff', ...)` block (before `describe('downloadMissingStems', ...)`):

```ts
describe('resolveRiffWithContext', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('resolves the jam and an offset centered on the riff, for a riff in the middle of a jam', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createFixtureWarehouse(root)
    const db = new Database(join(root, 'cache', 'common', 'warehouse.db3'))
    db.exec(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam-big', 'Big Jam')`)
    const insert = db.prepare(
      'INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName) VALUES (?,?,?,?,?,?)'
    )
    // 41 riffs, CreationTime 0..40 -- riff-20 sits at rank 20 (20 riffs
    // newer than it: CreationTime 21..40), so offset should be 20-10=10.
    for (let i = 0; i <= 40; i++) {
      insert.run(`riff-${i}`, 'jam-big', i, 130, 8, 'elling')
    }
    db.close()
    setWarehouseRootForTests(root)

    const result = resolveRiffWithContext('riff-20')
    expect(result).not.toBeNull()
    expect(result!.jamCID).toBe('jam-big')
    expect(result!.matchedRiffCID).toBe('riff-20')
    expect(result!.offset).toBe(10)
  })

  it('clamps the offset to 0 for a riff at (or near) the very start of a jam', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)

    // riff-2 (CreationTime 2000) is the NEWEST riff in jam-techno -- rank 0,
    // offset would be 0-10 = -10, clamped to 0.
    const result = resolveRiffWithContext('riff-2')
    expect(result).not.toBeNull()
    expect(result!.jamCID).toBe('jam-techno')
    expect(result!.offset).toBe(0)
  })

  it('matches case-insensitively and trims whitespace, as a typo-tolerant fallback', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)

    const result = resolveRiffWithContext('  RIFF-1  ')
    expect(result).not.toBeNull()
    // The MATCHED (real) riffCID is returned, not the mistyped input, so
    // the caller can highlight the actual row.
    expect(result!.matchedRiffCID).toBe('riff-1')
    expect(result!.jamCID).toBe('jam-techno')
  })

  it('returns null for a riffCID with no match at all, exact or fallback', () => {
    root = mkdtempSync(join(tmpdir(), 'sssketch-lore-test-'))
    createSeededFixtureWarehouse(root)
    setWarehouseRootForTests(root)
    expect(resolveRiffWithContext('no-such-riff')).toBeNull()
  })

  it('returns null when the warehouse is unavailable, rather than throwing', () => {
    setWarehouseRootForTests('/no/such/path')
    expect(resolveRiffWithContext('riff-1')).toBeNull()
  })
})
```

Also add `resolveRiffWithContext` to the existing `import { ... } from './loreWarehouse'` at the top of the test file (it doesn't exist yet, so this import will fail to resolve until Step 3):

```ts
import {
  warehouseAvailable,
  resolveStemPath,
  setWarehouseRootForTests,
  listJams,
  listRiffs,
  resolveRiff,
  resolveRiffWithContext,
  downloadMissingStems
} from './loreWarehouse'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/loreWarehouse.test.ts`
Expected: FAIL — the new `limit` test fails (limit is silently ignored, so `page1.riffs` has length 2 not 1), and `resolveRiffWithContext is not a function` (or a TypeScript error to that effect), since it doesn't exist in `loreWarehouse.ts` yet.

- [ ] **Step 3: Add `limit` support to `listRiffs`**

In `src/main/loreWarehouse.ts`, add `limit?: number` to the `RiffFilters` interface (right after `offset?: number`):

```ts
export interface RiffFilters {
  dateFrom?: number
  dateTo?: number
  bpm?: number
  userName?: string
  onlyFullyCached?: boolean
  targetUser?: string
  onlyContainsUser?: boolean
  offset?: number
  /** How many riffs to fetch, defaulting to RIFF_PAGE_SIZE when unset --
   * normal jam browsing never sets this; the riff-ID jump feature uses a
   * smaller value to fetch a tight centered window instead of a full page. */
  limit?: number
}
```

Then in `listRiffs`, change the query and its `hasMore` calculation to use this limit instead of the hardcoded `RIFF_PAGE_SIZE`:

```ts
  const rows = db
    .prepare(
      `SELECT RiffCID, CreationTime, BPMrnd, BarLength, UserName,
              StemCID_1, StemCID_2, StemCID_3, StemCID_4, StemCID_5, StemCID_6, StemCID_7, StemCID_8
       FROM Riffs
       WHERE ${conditions.join(' AND ')}
       ORDER BY CreationTime DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as RiffRow[]
```

(only the second-to-last argument changed, from `RIFF_PAGE_SIZE` to `limit`) with `limit` computed right above that query, alongside the existing `const offset = filters.offset ?? 0` near the top of the function:

```ts
  const offset = filters.offset ?? 0
  const limit = filters.limit ?? RIFF_PAGE_SIZE
```

And the return statement's `hasMore`:

```ts
  return {
    riffs,
    // Computed from the raw page (rows.length) against the LIMIT actually
    // used, not the onlyFullyCached-filtered summaries and not a hardcoded
    // RIFF_PAGE_SIZE -- otherwise a page where every riff happens to be
    // filtered out would look like "no more data" even though later pages
    // might have plenty, and a custom smaller `limit` would never report
    // hasMore correctly.
    hasMore: rows.length === limit,
    nextOffset: offset + rows.length
  }
```

- [ ] **Step 4: Run the `limit` test to verify it passes**

Run: `npx vitest run src/main/loreWarehouse.test.ts -t "respects a custom limit"`
Expected: PASS

- [ ] **Step 5: Implement `resolveRiffWithContext`**

In `src/main/loreWarehouse.ts`, add this right after `resolveRiff`'s closing `}` (before the `/** Downloads one stem's audio...` comment that precedes `downloadOneStem`):

```ts
export interface RiffContextResult {
  jamCID: string
  /** Offset to pass to listRiffs(jamCID, { offset }) to fetch a ~20-riff
   * page centered on the target riff (10 before, 10 after -- clamped to 0
   * for a riff near the very start of the jam). */
  offset: number
  /** The riffCID actually matched -- identical to the input except when the
   * typo-tolerant fallback below kicked in, so the caller can highlight the
   * right row even if the pasted ID had a case/whitespace mismatch. */
  matchedRiffCID: string
}

const RIFF_CONTEXT_WINDOW_BEFORE = 10

/** Resolves which jam a riffCID belongs to and an offset centered on it,
 * for "jump straight to this riff" lookups -- unlike resolveRiff, this
 * doesn't fetch stem data; the caller re-uses the existing listRiffs(jamCID,
 * { offset }) to actually fetch the surrounding page, exactly like normal
 * jam browsing already does.
 *
 * The local warehouse is a flat cache: a riff's row is either fully present
 * or it isn't in the database at all -- there's no separate index of
 * "riffs known to exist but not synced" to fall back on. The one real
 * exception is user error, so a failed exact match retries once, trimmed
 * and case-insensitive, before giving up. Returns null (never throws) if
 * neither matches, or if the warehouse itself is unavailable. */
export function resolveRiffWithContext(riffCID: string): RiffContextResult | null {
  const db = getWarehouseDb()
  if (!db) return null

  const trimmed = riffCID.trim()
  const exactRow = db
    .prepare(`SELECT RiffCID, OwnerJamCID, CreationTime FROM Riffs WHERE RiffCID = ?`)
    .get(trimmed) as { RiffCID: string; OwnerJamCID: string; CreationTime: number } | undefined
  const row =
    exactRow ??
    (db
      .prepare(`SELECT RiffCID, OwnerJamCID, CreationTime FROM Riffs WHERE RiffCID = ? COLLATE NOCASE`)
      .get(trimmed) as { RiffCID: string; OwnerJamCID: string; CreationTime: number } | undefined)
  if (!row) return null

  // Rank in the jam's most-recent-first ordering (listRiffs' own
  // `ORDER BY CreationTime DESC`, unchanged) -- how many riffs in this jam
  // are newer than this one. Riffs sharing the exact same unix-second
  // CreationTime have no stable secondary sort in listRiffs either; this is
  // an accepted, pre-existing simplification (see the design spec) that can
  // land the window a few positions off-center in that rare case.
  const { rank } = db
    .prepare(`SELECT COUNT(*) as rank FROM Riffs WHERE OwnerJamCID = ? AND CreationTime > ?`)
    .get(row.OwnerJamCID, row.CreationTime) as { rank: number }

  return {
    jamCID: row.OwnerJamCID,
    offset: Math.max(0, rank - RIFF_CONTEXT_WINDOW_BEFORE),
    matchedRiffCID: row.RiffCID
  }
}
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `npx vitest run src/main/loreWarehouse.test.ts`
Expected: PASS (all tests in the file, including the 6 new ones: the `limit` test plus 5 for `resolveRiffWithContext`)

- [ ] **Step 7: Commit**

```bash
git add src/main/loreWarehouse.ts src/main/loreWarehouse.test.ts
git commit -m "Add resolveRiffWithContext and listRiffs limit support"
```

---

### Task 2: IPC + preload wiring

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

No dedicated test — matches this codebase's own precedent for thin IPC pass-through handlers (see `lore-resolve-riff`'s own handler, which also has none).

- [ ] **Step 1: Add the IPC handler**

In `src/main/index.ts`, the `import { ... } from './loreWarehouse'` block (around line 24-31) needs `resolveRiffWithContext` added:

```ts
import {
  warehouseAvailable,
  listJams,
  listRiffs,
  resolveRiff,
  resolveRiffWithContext,
  downloadMissingStems,
  type RiffFilters
} from './loreWarehouse'
```

Then add the new handler right after the existing `lore-resolve-riff` handler (around line 152):

```ts
  ipcMain.handle('lore-resolve-riff', (_event, riffCID: string) => resolveRiff(riffCID))

  ipcMain.handle('lore-resolve-riff-with-context', (_event, riffCID: string) =>
    resolveRiffWithContext(riffCID)
  )

```

- [ ] **Step 2: Add the preload binding, and `limit` to `loreListRiffs`'s filters type**

In `src/preload/index.ts`, add `limit?: number` to the existing `loreListRiffs` filters type (around line 123-134), matching `RiffFilters`' own new field from Task 1:

```ts
  loreListRiffs: (
    jamCID: string,
    filters: {
      dateFrom?: number
      dateTo?: number
      bpm?: number
      userName?: string
      onlyFullyCached?: boolean
      targetUser?: string
      onlyContainsUser?: boolean
      offset?: number
      limit?: number
    }
  ): Promise<{ riffs: LoreRiffSummary[]; hasMore: boolean; nextOffset: number }> =>
    ipcRenderer.invoke('lore-list-riffs', jamCID, filters),
```

Then add this right after the existing `loreResolveRiff` binding (around line 138):

```ts
  loreResolveRiff: (riffCID: string): Promise<LoreResolvedRiff | null> =>
    ipcRenderer.invoke('lore-resolve-riff', riffCID),
  loreResolveRiffWithContext: (
    riffCID: string
  ): Promise<{ jamCID: string; offset: number; matchedRiffCID: string } | null> =>
    ipcRenderer.invoke('lore-resolve-riff-with-context', riffCID),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the new IPC handler's return type — `RiffContextResult | null` from `resolveRiffWithContext` — structurally matches the preload binding's declared return type)

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Wire resolveRiffWithContext through IPC and the preload bridge"
```

---

### Task 3: Renderer — riff-ID input and jam-context jump

**Files:**
- Modify: `src/renderer/src/components/LoreLibraryBrowser.tsx`

This is the one component-level task doing the full renderer-side wiring: a new ID input, the resolve handler, threading the resulting offset into the existing riff-fetch effect, and scrolling to + selecting the matched riff once its page loads. No automated test — this codebase has no React interaction-test setup yet (see `oneShotResize.ts`'s pure-function split for the established precedent of keeping testable logic out of components); covered by the manual walkthrough in Task 4 instead.

- [ ] **Step 1: Add state for the ID input, not-found message, and the pending jump**

In `LoreLibraryBrowser`, right after the existing `const [selectedRiffCID, setSelectedRiffCID] = useState<string | null>(null)` (around line 143), add:

```ts
  const [riffIdInput, setRiffIdInput] = useState('')
  const [riffIdNotFound, setRiffIdNotFound] = useState(false)
  // Set by handleGoToRiffId, consumed by the riff-fetch effect below once
  // the centered page for this jump has loaded -- see that effect's own
  // comment for why this can't just be done inline in handleGoToRiffId
  // itself (the render-time jam-change reset a few lines up would wipe out
  // an immediately-set selectedRiffCID before the fetch even starts).
  const [pendingJump, setPendingJump] = useState<{ offset: number; matchedRiffCID: string } | null>(
    null
  )
  // Per-riff DOM node refs, populated by each riff circle's own ref callback
  // below -- lets handleGoToRiffId's target scroll into view once its page
  // has loaded, the same way a normal click never needs to (the user is
  // already looking at whatever they clicked).
  const riffNodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())
```

- [ ] **Step 2: Write `handleGoToRiffId`**

Add this function near `handleRiffClick` (around line 432, right before it is a reasonable spot):

```ts
  function handleGoToRiffId(): void {
    const id = riffIdInput.trim()
    if (id === '') return
    setRiffIdNotFound(false)
    window.rifffApi
      .loreResolveRiffWithContext(id)
      .then((result) => {
        if (!result) {
          setRiffIdNotFound(true)
          return
        }
        // Clears every filter (not loreUsername -- that's a persistent
        // identity setting, not a filter scope) so nothing hides the
        // centered window this jump is about to fetch.
        setDateFromFilter('')
        setDateToFilter('')
        setBpmFilter('')
        setUserNameFilter('')
        setOnlyFullyCached(false)
        setOnlyContainsMe(false)
        setPendingJump({ offset: result.offset, matchedRiffCID: result.matchedRiffCID })
        setSelectedJamCID(result.jamCID)
      })
      .catch((err) => {
        console.error('LoreLibraryBrowser: loreResolveRiffWithContext() failed:', err)
        setRiffIdNotFound(true)
      })
  }
```

- [ ] **Step 3: Let `buildRiffFilters` request a custom page size**

The existing `buildRiffFilters(offset: number)` (around line 507-534) always builds filters for a full `RIFF_PAGE_SIZE` page. A riff-ID jump needs the small ~20-riff window the design spec calls for, not a full page. Add a constant right above `buildRiffFilters` (a local UI-tuning value, not imported from `loreWarehouse.ts` -- the renderer can't import from `src/main/*`, which uses Node-only modules; see `oneShotResize.ts`'s own doc comment for this codebase's established precedent of duplicating a small shared constant across layers rather than forcing an import across that boundary):

```ts
  // Matches loreWarehouse.ts's RIFF_CONTEXT_WINDOW_BEFORE * 2 (10 before, 10
  // after) -- kept as a separate constant here rather than imported since
  // the renderer can't import from src/main/* (Node-only modules).
  const RIFF_ID_JUMP_WINDOW_SIZE = 20
```

Then change `buildRiffFilters`'s signature to accept an optional limit and include it when set:

```ts
  function buildRiffFilters(
    offset: number,
    limit?: number
  ): {
    dateFrom?: number
    dateTo?: number
    bpm?: number
    userName?: string
    onlyFullyCached?: boolean
    targetUser?: string
    onlyContainsUser?: boolean
    offset?: number
    limit?: number
  } {
    const filters: ReturnType<typeof buildRiffFilters> = {}
    if (dateFromFilter !== '') {
      filters.dateFrom = Math.floor(new Date(`${dateFromFilter}T00:00:00`).getTime() / 1000)
    }
    if (dateToFilter !== '') {
      filters.dateTo = Math.floor(new Date(`${dateToFilter}T23:59:59`).getTime() / 1000)
    }
    if (bpmFilter.trim() !== '' && !Number.isNaN(Number(bpmFilter))) filters.bpm = Number(bpmFilter)
    if (userNameFilter.trim() !== '') filters.userName = userNameFilter.trim()
    if (onlyFullyCached) filters.onlyFullyCached = true
    if (loreUsername.trim() !== '') filters.targetUser = loreUsername.trim()
    if (onlyContainsMe) filters.onlyContainsUser = true
    if (offset > 0) filters.offset = offset
    if (limit !== undefined) filters.limit = limit
    return filters
  }
```

(only the final two lines — the new `limit` param and its `if (limit !== undefined)` — are new; everything else in the function body is unchanged from what's already there.)

- [ ] **Step 4: Thread `pendingJump` into the existing riff-fetch effect**

The existing effect (around line 536-568) always fetches page 1 with `buildRiffFilters(0)`. Change it to use the pending jump's offset and window size when one is set, and to select + scroll to the matched riff once that fetch lands:

```ts
  useEffect(() => {
    // No "deselect jam" affordance exists — selecting always moves to a new
    // non-null jamCID, so there's nothing to clear here; riffs simply starts
    // at its initial [] and is only ever populated once a jam is picked. The
    // grid itself is also only rendered when selectedJamCID !== null (see
    // below), so even a theoretical stale value would never be visible.
    if (!selectedJamCID) return
    let cancelled = false
    // Captured once at the start of this effect run -- if handleGoToRiffId
    // set this for the jam we're now fetching, land on it once the page
    // loads; a later, unrelated jam-filter change re-runs this effect with
    // pendingJump already null again, so it goes back to the normal
    // offset-0/full-page behavior automatically.
    const jump = pendingJump
    window.rifffApi
      .loreListRiffs(
        selectedJamCID,
        buildRiffFilters(jump?.offset ?? 0, jump ? RIFF_ID_JUMP_WINDOW_SIZE : undefined)
      )
      .then((result) => {
        if (cancelled) return
        setRiffs(result.riffs)
        setHasMoreRiffs(result.hasMore)
        nextOffsetRef.current = result.nextOffset
        if (jump) {
          setPendingJump(null)
          setSelectedRiffCID(jump.matchedRiffCID)
          setSelectedRiffCIDs(new Set([jump.matchedRiffCID]))
          // Deferred one frame so the grid has actually re-rendered with
          // this page's riffs (and their ref callbacks have run) before
          // scrollIntoView looks the node up.
          requestAnimationFrame(() => {
            riffNodeRefs.current.get(jump.matchedRiffCID)?.scrollIntoView({ block: 'center' })
          })
        }
      })
      .catch((err) => {
        console.error('LoreLibraryBrowser: loreListRiffs() failed:', err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildRiffFilters closes over these same deps; listing both would be redundant and buildRiffFilters itself isn't stable across renders. pendingJump is read via the `jump` local, not listed, so a later handleGoToRiffId call (which also sets selectedJamCID) still re-triggers this effect through that dependency.
  }, [
    selectedJamCID,
    dateFromFilter,
    dateToFilter,
    bpmFilter,
    userNameFilter,
    onlyFullyCached,
    loreUsername,
    onlyContainsMe
  ])
```

- [ ] **Step 5: Add the ref callback to each riff circle**

In the riff-circle rendering (around line 926-929), add a ref callback to the wrapper div:

```tsx
                              {tempoGroup.riffs.map((riff) => (
                                <div
                                  key={riff.riffCID}
                                  ref={(el) => {
                                    if (el) riffNodeRefs.current.set(riff.riffCID, el)
                                    else riffNodeRefs.current.delete(riff.riffCID)
                                  }}
                                  style={{ position: 'relative', width: 18, height: 18 }}
                                >
```

- [ ] **Step 6: Add the ID input UI**

In the jam-list sidebar column, right after the existing jam-filter `<input>` (around line 711-725, before the jam-buttons `<div style={{ overflowY: 'auto', flex: 1 }}>`), add:

```tsx
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    type="text"
                    value={riffIdInput}
                    onChange={(e) => {
                      setRiffIdInput(e.target.value)
                      setRiffIdNotFound(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleGoToRiffId()
                    }}
                    placeholder="go to riff ID..."
                    style={{
                      flex: 1,
                      height: 24,
                      fontSize: 11,
                      background: 'var(--ra-bg-row-active)',
                      color: 'var(--ra-text)',
                      border: '1px solid var(--ra-border)',
                      borderRadius: 0,
                      padding: '0 6px'
                    }}
                  />
                  <button
                    onClick={handleGoToRiffId}
                    style={{
                      height: 24,
                      padding: '0 8px',
                      fontSize: 11,
                      background: 'var(--ra-bg-row-active)',
                      color: 'var(--ra-text)',
                      border: '1px solid var(--ra-border)',
                      borderRadius: 0,
                      cursor: 'pointer'
                    }}
                  >
                    go
                  </button>
                </div>
                {riffIdNotFound && (
                  <span style={{ fontSize: 10, color: 'var(--ra-mute-on)' }}>
                    not found in local warehouse
                  </span>
                )}
              </div>
```

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `npx eslint src/renderer/src/components/LoreLibraryBrowser.tsx`
Expected: no errors (fix any prettier-only warnings with `npx eslint src/renderer/src/components/LoreLibraryBrowser.tsx --fix` and re-run)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/LoreLibraryBrowser.tsx
git commit -m "Add riff-ID lookup UI: jump to a riff's jam, centered and selected"
```

---

### Task 4: Final verification + manual walkthrough report

**Files:** none (verification only)

- [ ] **Step 1: Full automated verification**

Run, in order:

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
```

Expected: all clean/passing. (`pluginScan.test.ts`'s `scanOneCandidate` test is a known-flaky, unrelated real-subprocess test — see git history; if only that one fails, re-run it alone to confirm before treating it as a regression.)

- [ ] **Step 2: Report manual verification checklist to the user**

This feature can't be exercised by an automated test (no GUI interaction tooling, no React test harness in this codebase). Report clearly that automated checks (types, lint, unit tests) all pass, and that these need a real walkthrough with the LORE warehouse mounted:

1. Paste a known-valid riffCID (full length, exact case) into the new input, press Enter or click "go" — confirm it switches to the correct jam and the matching riff's circle shows the selection ring, roughly centered in the visible scroll area.
2. Confirm the riff auto-previews (plays), same as clicking any riff normally does.
3. Scroll up/down from the landed position — confirm there are genuinely riffs both before and after the target (not landed at the very edge unless the riff actually is near the start/end of the jam).
4. Paste the same ID with extra whitespace and/or wrong case — confirm it still resolves to the same riff (the typo-tolerant fallback).
5. Paste an ID that doesn't exist anywhere in the local warehouse — confirm the "not found in local warehouse" message appears, and that the current jam/riff list/selection is left completely untouched.
6. With a jam already selected and some filters set (bpm, date range, "only mine", etc.), do a riff-ID jump into a *different* jam — confirm all filters clear and the centered window isn't hidden by a stale filter.
7. Import the jumped-to riff via the normal click-to-import flow — confirm it works exactly like importing any other browsed riff.

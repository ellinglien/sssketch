# LORE Warehouse — Retire the Old Sync/Browser Code (Plan 2b-2b of 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the now-dead code the LORE warehouse redesign leaves behind: the two old library
browser components (`EndlesssLibraryBrowser.tsx`/`LoreLibraryBrowser.tsx`, replaced by
`LibraryBrowser.tsx`), the old JSON-index sync system (`endlesssSyncIndex.ts`/`endlesssSync.ts`,
replaced by `loreWarehouseSync.ts`), and every IPC channel/function that only those now-deleted
things ever called. Also apply two small, deferred cosmetic cleanups flagged during the browser
merge's own code review.

**Architecture:** Pure deletion + a few small, mechanical edits to `endlesssApi.ts`/`index.ts`/
`preload/index.ts`/`App.tsx` to remove now-dead call sites. No new files, no new IPC channels, no
behavior change to anything still in use — every function/channel this plan removes has zero
remaining callers by the time this plan starts (verified per-task, not assumed).

**Tech Stack:** TypeScript. No new dependencies.

**Scope note.** This is the last of the three sub-plans ("2b-1", "2b-2a", "2b-2b") that together
implement the browser-merge half of the larger LORE warehouse redesign
(`docs/superpowers/specs/2026-08-09-lore-warehouse-sync-design.md`). After this plan, that redesign
is complete: sssketch's own SQLite warehouse, background sync, favourites, and one merged library
browser are the only Endlesss-integration code path left — the old JSON-index sync and dual-browser
split are gone entirely.

**What is deliberately NOT removed by this plan**: `endlesssApi.ts`'s login/session functions
(`loginWithCredentials`, `logout`, `getAuthStatus`), `listSharedFeed`, `listJams`,
`listRiffsInJam`, `resolveJamRiff`, `downloadMissingStemsFor`, `peekSharedFeedCache` — all still
actively called by `loreWarehouseSync.ts` (the current sync engine) and/or `LibraryBrowser.tsx`
(login, live jam-membership discovery). Only the JSON-index *fast-path shortcut* inside three of
those functions is removed, not the functions themselves.

---

### Task 1: Delete the two old library browser components

**Files:**
- Delete: `src/renderer/src/components/EndlesssLibraryBrowser.tsx`
- Delete: `src/renderer/src/components/LoreLibraryBrowser.tsx`

Both are confirmed unreferenced by `App.tsx` (the only place either was ever imported) as of the
prior plan's own Task 4/5 — `grep -rn "EndlesssLibraryBrowser\|LoreLibraryBrowser" src/renderer/src`
should show zero import/JSX-usage hits before you start (a stale comment in `App.tsx` mentioning
`LoreLibraryBrowser.tsx` by filename is expected and fine — Task 4 of this plan fixes it).

- [ ] **Step 1: Confirm zero remaining references**

Run: `grep -rn "EndlesssLibraryBrowser\|LoreLibraryBrowser" src/renderer/src`
Expected: only comment-text hits (e.g. `App.tsx`'s stale doc comment), no `import` statements, no
JSX tag usage (`<EndlesssLibraryBrowser`, `<LoreLibraryBrowser`). If you find a real import/usage
hit, STOP — this plan's premise (both files are fully dead) doesn't hold, and deleting them would
break the build. Report BLOCKED rather than proceeding.

- [ ] **Step 2: Delete both files**

```bash
rm src/renderer/src/components/EndlesssLibraryBrowser.tsx
rm src/renderer/src/components/LoreLibraryBrowser.tsx
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Delete EndlesssLibraryBrowser.tsx and LoreLibraryBrowser.tsx

Both fully replaced by LibraryBrowser.tsx, unreferenced since the prior
browser-merge plan's App.tsx cutover.
EOF
)"
```

---

### Task 2: Retire the old JSON-index sync system

**Files:**
- Delete: `src/main/endlesssSyncIndex.ts`
- Delete: `src/main/endlesssSyncIndex.test.ts`
- Delete: `src/main/endlesssSync.ts`
- Delete: `src/main/endlesssSync.test.ts`
- Modify: `src/main/endlesssApi.ts`
- Modify: `src/main/endlesssApi.test.ts`
- Modify: `src/main/index.ts`

`endlesssSyncIndex.ts` (the flat-JSON per-source sync index) and `endlesssSync.ts` (the old
page-walk-with-boundary-stop sync built on top of it) are both fully superseded by
`loreWarehouseSync.ts`. But three functions in `endlesssApi.ts` (`listSharedFeed`,
`listRiffsInJam`, `resolveJamRiff`) each have a "check the JSON index first" fast-path shortcut at
their top that imports from `endlesssSyncIndex.ts` — these must be removed in the SAME commit as
deleting `endlesssSyncIndex.ts`, or the file won't compile.

- [ ] **Step 1: Remove the sync-index fast path from `listSharedFeed`**

In `src/main/endlesssApi.ts`, find `listSharedFeed` (search for `export async function
listSharedFeed`). Remove this block from the top of its body (read the real current code first —
this should be the first statement(s) inside the function, right after the parameter list):

```typescript
  const syncIndex = loadSyncIndex('shared', userName)
  if (syncIndex) {
    const syncedPage = sliceSyncedPage(syncIndex, offset, count)
    if (syncedPage) {
      // Warm sharedFeedCache from the WHOLE synced index (not just this
      // page) so resolveSharedFeedRiff can resolve any riff currently
      // rendered from a synced page, not just the very last one fetched --
      // strictly better than the live path's own "only the last page is
      // resolvable" limitation, and free since the index is already loaded
      // into memory to slice it.
      const newCache = new Map<string, LoreResolvedRiff>()
      for (const riffCID of syncIndex.order) {
        newCache.set(riffCID, syncIndex.riffs[riffCID].resolved)
      }
      sharedFeedCache = newCache
      return syncedPage
    }
  }

```

After removal, the function should go straight from its parameter list into building the live
fetch (`const session = activeSession()` or equivalent — verify against the real current code).

- [ ] **Step 2: Remove the sync-index fast path from `listRiffsInJam`**

Find `listRiffsInJam`. Remove this block (and update its doc comment — see below):

```typescript
  const syncIndex = loadSyncIndex('jam', jamId)
  if (syncIndex) {
    const syncedPage = sliceSyncedPage(syncIndex, offset, limit)
    if (syncedPage) return syncedPage
  }

```

This function's doc comment currently says "Checks the local sync index first (see
endlesssSyncIndex.ts) and serves straight from it, with zero network calls, whenever the requested
range is already fully synced -- the CouchDB view below only ever runs for whatever isn't." Delete
that sentence from the doc comment (the rest of the comment, describing the CouchDB view logic
itself, stays — this function still always does a live fetch now).

- [ ] **Step 3: Remove the sync-index fast path from `resolveJamRiff`**

Find `resolveJamRiff`. Remove this block (and update its doc comment):

```typescript
  const syncIndex = loadSyncIndex('jam', jamId)
  if (syncIndex) {
    const synced = sliceSyncedRiff(syncIndex, riffCID)
    if (synced) return synced
  }

```

This function's doc comment currently says "Checks the local sync index first (see
endlesssSyncIndex.ts) and returns straight from it, with zero network calls and no login required,
when this riff is already fully synced -- everything below only ever runs for a riff that isn't."
Delete that sentence.

- [ ] **Step 4: Remove the now-unused import**

Remove `import { loadSyncIndex, sliceSyncedPage, sliceSyncedRiff } from './endlesssSyncIndex'` from
the top of `endlesssApi.ts`.

- [ ] **Step 5: Delete the old sync files**

```bash
rm src/main/endlesssSyncIndex.ts
rm src/main/endlesssSyncIndex.test.ts
rm src/main/endlesssSync.ts
rm src/main/endlesssSync.test.ts
```

- [ ] **Step 6: Remove now-dead imports/usages in `index.ts`**

Remove these two lines from `src/main/index.ts`:

```typescript
import { syncSharedFeed, syncJam } from './endlesssSync'
import { getSyncStatus } from './endlesssSyncIndex'
```

(Their only callers — the `endlesss-start-sync-shared-feed`/`endlesss-start-sync-jam`/
`endlesss-sync-status-shared-feed`/`endlesss-sync-status-jam` IPC handlers — are removed in Task 3
of this plan, not this task. If removing these two import lines now causes a typecheck error
because those handlers still reference `syncSharedFeed`/`syncJam`/`getSyncStatus`, that's expected
and fine — Task 3 removes the handlers themselves; you can either do Task 3's handler removal as
part of this step too, or leave a typecheck error at the end of this task's own Step 8 and note it
in your report, whichever you judge cleaner. Given the two tasks are this tightly coupled, the
cleanest approach is probably to remove both the imports here AND the four handlers that use them
in this same task, even though the plan formally assigns "remove IPC handlers" to Task 3 — use your
judgment, and clearly note in your report which handlers you removed here if you take this
approach, so Task 3's implementer doesn't try to remove them a second time.)

- [ ] **Step 7: Remove the sync-index-fast-path tests from `endlesssApi.test.ts`**

Find the `describe('endlesssApi sync-index fast paths', ...)` block in `src/main/endlesssApi.test.ts`
and delete it entirely (it tests exactly the fast-path behavior removed in Steps 1-3 — these tests
would now fail, correctly, since the behavior they test no longer exists).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If you deferred the Task-3-owned handler removal per Step 6's note, you may
see errors referencing `syncSharedFeed`/`syncJam`/`getSyncStatus` in `index.ts` — that's the
expected, documented interim state; report it clearly rather than treating it as a surprise.

- [ ] **Step 9: Run the affected test suite**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: all remaining tests pass (the sync-index-fast-path describe block is gone; every other
test in the file is unaffected by these changes)

- [ ] **Step 10: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Retire the old JSON-index sync system

endlesssSyncIndex.ts/endlesssSync.ts are fully superseded by
loreWarehouseSync.ts. Removes the "check the JSON index first" fast path
from listSharedFeed/listRiffsInJam/resolveJamRiff -- those functions
themselves stay, still actively used by loreWarehouseSync.ts and
LibraryBrowser.tsx's login/jam-discovery flow.
EOF
)"
```

---

### Task 3: Remove dead IPC channels + dead `endlesssApi.ts` exports

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/endlesssApi.ts`
- Modify: `src/preload/index.ts`

Before starting, run `git log --oneline -3 -- src/main/index.ts` and read Task 2's own commit to
see whether its implementer already removed some of these handlers as part of resolving that
task's own Step 6 note. If so, skip whichever of the 9 handlers below are already gone and just
handle whatever's left, plus the preload/`endlesssApi.ts` cleanup, which Task 2 wasn't asked to do.

- [ ] **Step 1: Remove 9 dead IPC handlers from `index.ts`**

Remove these `ipcMain.handle(...)` calls entirely (find them by channel name — read the real
current file first, since Task 2 may have already removed some):
`'endlesss-list-shared-feed'`, `'endlesss-resolve-shared-feed-riff'`, `'endlesss-list-riffs'`,
`'endlesss-resolve-riff'`, `'endlesss-list-riff-ownership'`, `'endlesss-start-sync-shared-feed'`,
`'endlesss-start-sync-jam'`, `'endlesss-sync-status-shared-feed'`, `'endlesss-sync-status-jam'`.

**Do NOT remove** `'endlesss-login'`, `'endlesss-logout'`, `'endlesss-auth-status'`,
`'endlesss-list-jams'` — all four are still actively called by `LibraryBrowser.tsx` (login gating,
live jam-membership discovery for the sidebar).

- [ ] **Step 2: Remove now-unused imports in `index.ts`**

From the `import { ... } from './endlesssApi'` block, remove `listSharedFeed`,
`resolveSharedFeedRiff`, `listRiffsInJam`, `resolveJamRiff`, `listRiffOwnership` — **but keep**
`loginWithCredentials`, `logout as endlesssLogout`, `getAuthStatus as getEndlesssAuthStatus`,
`listJams as listEndlesssJams` (all four still used by the 4 handlers you did NOT remove in Step
1). Also remove the now-unused `import type { RiffFilters } from '@shared/loreLibrary'` line ONLY
if nothing else in `index.ts` still references `RiffFilters` after this change — grep the file for
`RiffFilters` first to check; `loreListRiffs`'s own handler also takes a `RiffFilters` parameter, so
this import is very likely still needed. Verify, don't assume.

- [ ] **Step 3: Remove the corresponding dead preload entries**

In `src/preload/index.ts`, remove: `endlesssListSharedFeed`, `endlesssResolveSharedFeedRiff`,
`endlesssListRiffs`, `endlesssResolveRiff`, `endlesssListRiffOwnership`,
`endlesssStartSyncSharedFeed`, `endlesssStartSyncJam`, `endlesssSyncStatusSharedFeed`,
`endlesssSyncStatusJam`, `onEndlesssSyncProgress`.

**Do NOT remove** `endlesssLogin`, `endlesssLogout`, `endlesssAuthStatus`, `endlesssListJams` — all
four are called by `LibraryBrowser.tsx`.

- [ ] **Step 4: Remove now-dead `endlesssApi.ts` exports**

`resolveSharedFeedRiff` and `listRiffOwnership` in `src/main/endlesssApi.ts` are now called from
nowhere (their only callers were the two IPC handlers just removed). Confirm with:

```bash
grep -rn "resolveSharedFeedRiff\|listRiffOwnership" src/main src/preload src/renderer
```

Expected: no real call sites remain outside `endlesssApi.ts`'s own definitions and doc-comment
mentions in OTHER functions (e.g. `downloadMissingStemsFor`'s doc comment mentions
`resolveSharedFeedRiff` by name as historical context — leave prose mentions alone, only remove the
two actual function definitions). If a real call site remains anywhere, STOP and report BLOCKED —
this plan's premise doesn't hold.

Delete both function definitions (`export async function resolveSharedFeedRiff(...) {...}` and
`export async function listRiffOwnership(...) {...}`) from `endlesssApi.ts`. Also remove their
matching `describe(...)`/`it(...)` test blocks from `endlesssApi.test.ts` (search for
`resolveSharedFeedRiff`/`listRiffOwnership` in that file).

`sharedFeedCache` (the module-level cache `resolveSharedFeedRiff` used to read) stays — it's still
populated by `listSharedFeed` and read by `peekSharedFeedCache`, which `loreWarehouseSync.ts`
actively uses. Update its own doc comment if it specifically mentions `resolveSharedFeedRiff` as a
reader, since that's no longer true — `peekSharedFeedCache` is now its only reader.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Run the affected test suites**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: all remaining tests pass

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Remove dead endlesss-* IPC channels and their now-unused endlesssApi.ts exports

login/logout/auth-status/list-jams stay -- still used by LibraryBrowser.tsx
for login gating and live jam-membership discovery. Everything else in this
IPC surface only ever existed for the now-deleted EndlesssLibraryBrowser.tsx.
EOF
)"
```

---

### Task 4: App.tsx cosmetic cleanup (deferred from the browser-merge plan's own review)

**Files:**
- Modify: `src/renderer/src/App.tsx`

Two small renames flagged as worth doing but deliberately deferred during the browser-merge plan's
own code review, specifically to avoid touching `App.tsx` twice for cosmetic-only reasons. Both are
pure renames with no behavior change.

- [ ] **Step 1: Rename `libraryOpen`/`setLibraryOpen` to `riffLibraryOpen`/`setRiffLibraryOpen`**

`App.tsx` has a separate, unrelated `libraryBrowserOpen` state (controls `ProjectLibraryBrowser`,
the project save/open modal) that's easy to confuse with `libraryOpen` (controls `LibraryBrowser`,
the Endlesss riff library) since the names are similar and their render blocks sit only a few lines
apart. Rename every occurrence of `libraryOpen`/`setLibraryOpen` in `App.tsx` to
`riffLibraryOpen`/`setRiffLibraryOpen` (the state declaration, the render call, and every other
call site: `Shelf`'s `onOpenLibrary`, `BeatPicker`'s `wasBatchImport` close effect,
`OnboardingModal`'s `onOpenEndlesss` callback). Do NOT touch `libraryBrowserOpen`/
`setLibraryBrowserOpen` (the pre-existing, unrelated `ProjectLibraryBrowser` state) — verify with a
final grep that it's untouched.

- [ ] **Step 2: Rename `handleLoreImported` to `handleLibraryImported`**

This handler (search for `const handleLoreImported` or similar) is pure logic with nothing
LORE-specific in its body — the name is a holdover from when only `LoreLibraryBrowser.tsx` called
it. Rename it to `handleLibraryImported` at its declaration and its one call site (the
`<LibraryBrowser onImported={...} />` prop). Check first whether an existing `handleImported`
(used by `Shelf`) already exists in the file — if so, `handleLibraryImported` avoids colliding with
it; don't rename to something that collides.

- [ ] **Step 3: Fix the stale doc comment**

Find the comment mentioning `LoreLibraryBrowser.tsx` by filename (search for `LoreLibraryBrowser` in
`App.tsx` — it's a comment about `loreUsername`'s localStorage-persisted convention, referencing a
file that Task 1 of this plan already deleted). Update it to reference the real current location of
that convention (`LibraryBrowser.tsx`, which now owns the same `loreUsername` state/localStorage
key) instead.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
App.tsx: rename libraryOpen/handleLoreImported for clarity

libraryOpen -> riffLibraryOpen (was easy to confuse with the pre-existing,
unrelated libraryBrowserOpen/ProjectLibraryBrowser state). handleLoreImported
-> handleLibraryImported (no LORE-specific logic in it, name was a holdover
from before the browser merge). Pure rename, no behavior change. Deferred
from the browser-merge plan's own code review to avoid touching this file
twice for cosmetic-only reasons.
EOF
)"
```

---

### Task 5: Full verification

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
documented in every prior plan's own verification task (this worktree has no compiled
`native-engine/build`) — the total passing count should be LOWER than before this plan started,
by however many tests lived in the deleted `endlesssSyncIndex.test.ts`/`endlesssSync.test.ts`/the
removed `endlesssApi.test.ts` describe blocks — that's expected and correct, not a regression.

- [ ] **Step 4: Confirm every deleted symbol is genuinely gone**

Run:
```bash
grep -rn "EndlesssLibraryBrowser\|LoreLibraryBrowser\|endlesssSyncIndex\|endlesssSync'\|resolveSharedFeedRiff\|listRiffOwnership\|endlesss-list-shared-feed\|endlesss-resolve-shared-feed-riff\|endlesss-list-riffs\|endlesss-resolve-riff\|endlesss-list-riff-ownership\|endlesss-start-sync\|endlesss-sync-status" src/ 2>/dev/null
```
Expected: no output, or only harmless prose/comment mentions (not import statements, not function
calls, not IPC channel-name strings in an active `ipcMain.handle`/`ipcRenderer.invoke` call) — read
whatever this returns carefully rather than assuming it's all fine.

- [ ] **Step 5: Confirm what's supposed to survive actually did**

Run:
```bash
grep -n "endlesssLogin\|endlesssLogout\|endlesssAuthStatus\|endlesssListJams" src/preload/index.ts
```
Expected: all four still present — this plan should not have touched login/auth/jam-listing.

- [ ] **Step 6: Manual walkthrough — flag explicitly, don't claim it was done**

The single most important manual check for this whole redesign: open the real app, open the
library browser, log in, browse/sync/import a riff end to end, confirm nothing regressed from this
cleanup pass (deleting dead code should be invisible to a user, but "should be" isn't "verified to
be"). This needs a real logged-in Endlesss account and cannot be completed by an implementer
subagent solo — say so explicitly.

- [ ] **Step 7: Commit (only if Steps 1-3 required any fixes not already committed)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix verification issues found in full-suite run
EOF
)"
```

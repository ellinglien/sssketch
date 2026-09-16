# Cross-Panel Engine Preview Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Discover's engine-based preview, Tidy Up/Auto Arrange's
engine-based preview, and the app's own always-on automatic real-project
sync from silently clobbering each other.

**Architecture:** One small, pure ownership-tracking module
(`src/shared/engineOwnership.ts`) that all three engine-project-sending
paths check/claim/release, additive to each one's own existing internal
generation-guard rather than replacing it.

**Tech Stack:** No new dependencies. Plain TypeScript + the existing
React/vitest setup this codebase already uses everywhere.

---

## Before you start

Every task below quotes exact current code from three files. All three
have been edited multiple times in the last day (most recently
`DiscoverPanel.tsx`, for a solo button and undo/redo). If a quoted snippet
doesn't match what you actually find at that location, match by CODE
CONTENT, not by trusting the line numbers in this plan's own prose --
search for the quoted snippet's own text and work from there. If the
surrounding shape has changed more than a line or two of drift (a whole
function restructured, a snippet simply gone), stop and escalate rather
than guessing how to reconcile it.

---

### Task 1: The ownership tracker

**Files:**
- Create: `src/shared/engineOwnership.ts`
- Test: `src/shared/engineOwnership.test.ts`

This is pure, framework-agnostic logic -- a tiny in-memory generation
counter with no Electron/DOM dependency, following this codebase's own
convention (see `src/shared/`'s other files) of putting anything testable
without mocking Electron here.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/shared/engineOwnership.test.ts
import { describe, expect, it } from 'vitest'
import { createEngineOwnershipTracker } from './engineOwnership'

describe('createEngineOwnershipTracker', () => {
  it('starts with no owner', () => {
    const tracker = createEngineOwnershipTracker()
    expect(tracker.current).toBeNull()
  })

  it('claim sets the current owner', () => {
    const tracker = createEngineOwnershipTracker()
    tracker.claim('discover-preview')
    expect(tracker.current).toBe('discover-preview')
  })

  it('a token returned by claim is still owned immediately after', () => {
    const tracker = createEngineOwnershipTracker()
    const token = tracker.claim('discover-preview')
    expect(tracker.stillOwn(token)).toBe(true)
  })

  it('a second claim by a DIFFERENT owner invalidates the first token', () => {
    const tracker = createEngineOwnershipTracker()
    const firstToken = tracker.claim('discover-preview')
    tracker.claim('stem-solo-preview')
    expect(tracker.stillOwn(firstToken)).toBe(false)
    expect(tracker.current).toBe('stem-solo-preview')
  })

  it('a second claim by the SAME owner still invalidates the first token', () => {
    // Two rapid calls from the same component (e.g. two reroll clicks in a
    // row) must not let the FIRST call's late-resolving async work land
    // after the second -- same "superseded, not just unmounted" guard
    // this codebase's own per-component generation refs already enforce
    // locally; claim() enforces it globally.
    const tracker = createEngineOwnershipTracker()
    const firstToken = tracker.claim('discover-preview')
    const secondToken = tracker.claim('discover-preview')
    expect(tracker.stillOwn(firstToken)).toBe(false)
    expect(tracker.stillOwn(secondToken)).toBe(true)
  })

  it('release resets current to null and invalidates the outgoing token', () => {
    const tracker = createEngineOwnershipTracker()
    const token = tracker.claim('stem-solo-preview')
    tracker.release()
    expect(tracker.current).toBeNull()
    expect(tracker.stillOwn(token)).toBe(false)
  })

  it('claim after release still invalidates the pre-release token', () => {
    const tracker = createEngineOwnershipTracker()
    const firstToken = tracker.claim('discover-preview')
    tracker.release()
    const secondToken = tracker.claim('stem-solo-preview')
    expect(tracker.stillOwn(firstToken)).toBe(false)
    expect(tracker.stillOwn(secondToken)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/engineOwnership.test.ts`
Expected: FAIL -- `Cannot find module './engineOwnership'` (the file
doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/shared/engineOwnership.ts

/** Who currently owns what gets sent to the native engine -- 'discover-
 * preview' is DiscoverPanel.tsx's own throwaway single-rifff preview
 * project (docs/superpowers/specs/2026-09-15-discover-native-engine-
 * preview-design.md); 'stem-solo-preview' is useStemPreviewPlayback.ts's
 * own SOLO_STEMS-based preview, shared by both Tidy Up
 * (ClusterStemsBrowser.tsx) and Auto Arrange (AutoArrangeRoleStep.tsx) --
 * those two never run at once (both are full-screen modals, opening one
 * closes the other), so one owner id safely covers both callers. */
export type EngineOwner = 'discover-preview' | 'stem-solo-preview'

export interface EngineOwnershipTracker {
  /** Claims ownership, returning a generation token. The caller must hold
   * onto this token and check it via `stillOwn` after any await, before
   * actually applying a send (calling engineLoadProject) -- if a newer
   * claim (by anyone, including a fresh claim by the SAME owner) has
   * landed since, the token is stale and the result must be discarded. */
  claim(owner: EngineOwner): number
  /** True iff `token` is still the current generation -- nothing has
   * claimed or released since it was issued. */
  stillOwn(token: number): boolean
  /** Releases ownership back to nobody (the real project's own automatic
   * sync is free to run again). Also bumps the generation, so any of the
   * outgoing owner's own still-in-flight sends are invalidated too. */
  release(): void
  /** The current owner, or null when nobody has claimed -- read by
   * StoreContext.tsx's own automatic sync effect to decide whether to
   * skip a send. */
  readonly current: EngineOwner | null
}

/** Real generation-guard logic, factored out as pure/testable rather than
 * inlined into StoreContext.tsx directly -- see docs/superpowers/specs/
 * 2026-09-16-engine-preview-ownership-design.md. Every claim/release bumps
 * a shared counter; stillOwn is a plain equality check against it. This is
 * the SAME pattern this codebase already uses three separate times, per-
 * component (DiscoverPanel.tsx's previewSyncGenerationRef,
 * useStemPreviewPlayback.ts's callGenerationRef, StoreContext.tsx's own
 * pendingEngineSyncRef/dirtyEngineSyncRef pair) -- this is that same idea,
 * shared across all three instead of three separate, mutually-unaware
 * copies. */
export function createEngineOwnershipTracker(): EngineOwnershipTracker {
  let owner: EngineOwner | null = null
  let generation = 0

  return {
    claim(next: EngineOwner): number {
      owner = next
      generation += 1
      return generation
    },
    stillOwn(token: number): boolean {
      return generation === token
    },
    release(): void {
      owner = null
      generation += 1
    },
    get current(): EngineOwner | null {
      return owner
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/engineOwnership.test.ts`
Expected: PASS, 7/7.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/shared/engineOwnership.ts src/shared/engineOwnership.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/engineOwnership.ts src/shared/engineOwnership.test.ts
git commit -m "Add pure engine-ownership tracker (claim/stillOwn/release)"
```

---

### Task 2: Wire the tracker into StoreContext.tsx

**Files:**
- Modify: `src/renderer/src/state/StoreContext.tsx`

This task depends on Task 1's exports. Three changes to one file:

**2a. Instantiate the tracker and expose it via context.**

Find this import block near the top of the file:

```typescript
import { initialState, type AppState } from './store'
```

Add the new import directly below it:

```typescript
import { initialState, type AppState } from './store'
import { createEngineOwnershipTracker, type EngineOwner } from '@shared/engineOwnership'
```

Find this existing context declaration (search for the exact text, since
its own line number may have drifted):

```typescript
// See useFlushEngineSyncNow's own doc comment below for what this is for.
const FlushEngineSyncNowCtx = createContext<(overrides?: Partial<AppState>) => Promise<void>>(() =>
  Promise.resolve()
)
```

Add a new context directly below it:

```typescript
// See useFlushEngineSyncNow's own doc comment below for what this is for.
const FlushEngineSyncNowCtx = createContext<(overrides?: Partial<AppState>) => Promise<void>>(() =>
  Promise.resolve()
)
// See useEngineOwnership's own doc comment below for what this is for.
const EngineOwnershipCtx = createContext<{
  claim: (owner: EngineOwner) => number
  stillOwn: (token: number) => boolean
  release: () => void
}>({
  claim: () => 0,
  stillOwn: () => true,
  release: () => {}
})
```

**2b. Instantiate the tracker inside `StoreProvider`, and derive the stable
claim/stillOwn/release functions the context above will carry.**

Find this existing code inside `StoreProvider` (search for the exact
text):

```typescript
  const flushEngineSyncNow = useCallback(
    async (overrides?: Partial<AppState>): Promise<void> => {
      const project = await buildEngineProject(
        { ...stateRef.current, ...overrides },
        resolveStretchedForPlayback,
        pluginCatalog
      )
      await window.rifffApi.engineLoadProject(project)
    },
    [pluginCatalog]
  )
```

Add the tracker instantiation and its stable wrapper functions directly
below it:

```typescript
  const flushEngineSyncNow = useCallback(
    async (overrides?: Partial<AppState>): Promise<void> => {
      const project = await buildEngineProject(
        { ...stateRef.current, ...overrides },
        resolveStretchedForPlayback,
        pluginCatalog
      )
      await window.rifffApi.engineLoadProject(project)
    },
    [pluginCatalog]
  )

  // Created once -- `createEngineOwnershipTracker()` has no side effects,
  // so re-evaluating it on every render (before useRef discards all but
  // the very first result) is harmless; same "call the constructor
  // directly as the useRef argument" convention LibraryBrowser.tsx's own
  // riffNodeRefs already uses. See src/shared/engineOwnership.ts's own
  // doc comment for what this coordinates and why.
  // `engineOwnershipRef.current` (the tracker instance itself, not a
  // token) is read directly by the automatic sync effect just below, in
  // the SAME closure -- no context indirection needed for that internal
  // read. claim/stillOwn/release are wrapped in stable useCallback
  // identities below so components elsewhere in the app
  // (DiscoverPanel.tsx, useStemPreviewPlayback.ts) can safely list them in
  // their own effect dependency arrays.
  const engineOwnershipRef = useRef(createEngineOwnershipTracker())
  const claimEngineOwnership = useCallback(
    (owner: EngineOwner) => engineOwnershipRef.current.claim(owner),
    []
  )
  const stillOwnEngine = useCallback(
    (token: number) => engineOwnershipRef.current.stillOwn(token),
    []
  )
  const releaseEngineOwnership = useCallback(() => engineOwnershipRef.current.release(), [])
  const engineOwnershipValue = useMemo(
    () => ({ claim: claimEngineOwnership, stillOwn: stillOwnEngine, release: releaseEngineOwnership }),
    [claimEngineOwnership, stillOwnEngine, releaseEngineOwnership]
  )
```

`useMemo` is already imported in this file (see the top import block).

**2c. Gate the automatic coalesced sync effect on ownership.**

Find this existing code (search for the exact text):

```typescript
    function scheduleEngineSync(): void {
      if (pendingEngineSyncRef.current) {
        dirtyEngineSyncRef.current = true
        return
      }
      pendingEngineSyncRef.current = true
      requestAnimationFrame(() => {
        void (async () => {
          try {
            const project = await buildEngineProject(
              stateRef.current,
              resolveStretchedForPlayback,
              pluginCatalog
            )
            await window.rifffApi.engineLoadProject(project)
          } finally {
            // Cleared only once the send actually completes (success or
            // failure) -- not at the start of the rAF callback -- so at
            // most one send is ever pending/in-flight at a time. Without
            // this, a slow send could let a second flush get scheduled and
            // fire while the first is still in flight, reintroducing the
            // exact overlapping-async-calls race the effect's own removed
            // `cancelled` flag used to guard against.
            pendingEngineSyncRef.current = false
            if (dirtyEngineSyncRef.current) {
              dirtyEngineSyncRef.current = false
              scheduleEngineSync()
            }
          }
        })()
      })
    }
```

Replace it with (two new early-returns added, everything else identical):

```typescript
    function scheduleEngineSync(): void {
      if (pendingEngineSyncRef.current) {
        dirtyEngineSyncRef.current = true
        return
      }
      pendingEngineSyncRef.current = true
      requestAnimationFrame(() => {
        void (async () => {
          try {
            // Someone else (Discover's own preview, or a Tidy Up/Auto
            // Arrange stem solo) currently owns what's loaded in the
            // engine -- pushing the real project now would silently stomp
            // whatever they're previewing. Skip this send, but stay dirty
            // so the NEXT animation frame retries -- cheap (a couple of
            // ref reads, no buildEngineProject call) and self-healing even
            // if a future owner type doesn't explicitly restore on its own
            // release. See docs/superpowers/specs/2026-09-16-engine-
            // preview-ownership-design.md.
            if (engineOwnershipRef.current.current !== null) {
              dirtyEngineSyncRef.current = true
              return
            }
            const project = await buildEngineProject(
              stateRef.current,
              resolveStretchedForPlayback,
              pluginCatalog
            )
            // Ownership could have been claimed WHILE the build above was
            // in flight -- re-check right before the actual send.
            if (engineOwnershipRef.current.current !== null) {
              dirtyEngineSyncRef.current = true
              return
            }
            await window.rifffApi.engineLoadProject(project)
          } finally {
            // Cleared only once the send actually completes (success or
            // failure) -- not at the start of the rAF callback -- so at
            // most one send is ever pending/in-flight at a time. Without
            // this, a slow send could let a second flush get scheduled and
            // fire while the first is still in flight, reintroducing the
            // exact overlapping-async-calls race the effect's own removed
            // `cancelled` flag used to guard against.
            pendingEngineSyncRef.current = false
            if (dirtyEngineSyncRef.current) {
              dirtyEngineSyncRef.current = false
              scheduleEngineSync()
            }
          }
        })()
      })
    }
```

**2d. Provide the new context.**

Find this existing JSX (search for the exact text):

```typescript
        <RestoreStateCtx.Provider value={restoreState}>
          <FlushEngineSyncNowCtx.Provider value={flushEngineSyncNow}>
            <PosCtx.Provider value={pos}>
```

Replace it with:

```typescript
        <RestoreStateCtx.Provider value={restoreState}>
          <FlushEngineSyncNowCtx.Provider value={flushEngineSyncNow}>
            <EngineOwnershipCtx.Provider value={engineOwnershipValue}>
              <PosCtx.Provider value={pos}>
```

And find the matching closing tag (search for the exact text):

```typescript
            </PosCtx.Provider>
          </FlushEngineSyncNowCtx.Provider>
        </RestoreStateCtx.Provider>
      </DispatchCtx.Provider>
```

Replace it with:

```typescript
            </PosCtx.Provider>
            </EngineOwnershipCtx.Provider>
          </FlushEngineSyncNowCtx.Provider>
        </RestoreStateCtx.Provider>
      </DispatchCtx.Provider>
```

(Every other provider that was between `<PosCtx.Provider>` and
`</RestoreStateCtx.Provider>` in the original file -- `PlayingCtx`,
`ZoomCtx`, `HistoryCtx`, `MasterChainStatusCtx`, and the rest, all the way
down to `{children}` -- stays exactly where it is, just now one level
deeper inside `EngineOwnershipCtx.Provider`. Only the two lines shown
above actually change; don't touch anything nested between them.)

**2e. Export the hook.**

Find this existing code (search for the exact text):

```typescript
/** See flushEngineSyncNow's own doc comment (in StoreProvider, above) for
 * what this is for and why it exists -- await this before issuing a
 * play/seek command right after a mute/solo-changing dispatch, so the
 * engine is guaranteed to have the corrected state first. */
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useFlushEngineSyncNow(): (overrides?: Partial<AppState>) => Promise<void> {
  return useContext(FlushEngineSyncNowCtx)
}
```

Add a new hook directly below it:

```typescript
/** See flushEngineSyncNow's own doc comment (in StoreProvider, above) for
 * what this is for and why it exists -- await this before issuing a
 * play/seek command right after a mute/solo-changing dispatch, so the
 * engine is guaranteed to have the corrected state first. */
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useFlushEngineSyncNow(): (overrides?: Partial<AppState>) => Promise<void> {
  return useContext(FlushEngineSyncNowCtx)
}

/** Coordinates who currently owns what's loaded in the engine -- claim
 * before sending a throwaway/soloed project so the automatic real-project
 * sync above knows to stay quiet, stillOwn to check a claim hasn't been
 * superseded before actually applying an async send's result, release to
 * hand control back once done (do this BEFORE, or alongside, your own
 * final real-project flush -- see DiscoverPanel.tsx's restorePreviewIfLoaded
 * and useStemPreviewPlayback.ts's unmount cleanup for the two existing
 * callers). See src/shared/engineOwnership.ts and docs/superpowers/specs/
 * 2026-09-16-engine-preview-ownership-design.md. */
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useEngineOwnership(): {
  claim: (owner: EngineOwner) => number
  stillOwn: (token: number) => boolean
  release: () => void
} {
  return useContext(EngineOwnershipCtx)
}
```

- [ ] **Step 1: Make all five edits above (2a-2e)**

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/renderer/src/state/StoreContext.tsx`
Expected: no errors. If the JSX provider nesting from 2d doesn't balance
(a common mistake when adding a new nested provider by hand), typecheck
will fail with a JSX-related error -- recount the opening/closing tags
against the ORIGINAL nesting order (PosCtx, PlayingCtx, ZoomCtx,
HistoryCtx, MasterChainStatusCtx, MasterChainErrorCtx,
ChannelChainStatusCtx, ChannelChainErrorCtx, PluginCatalogCtx,
PluginScanStateCtx, PluginCatalogActionsCtx, RiffFavouritesCtx,
RiffFavouritesActionsCtx) rather than guessing.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: same pass count as before this task (no regressions). This file
has no test that renders the full provider (`StoreContext.test.ts` only
exercises the pure `subscribeToState`/`getStateSnapshot` bridge) -- don't
add one; that's not this codebase's convention for this file.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/state/StoreContext.tsx
git commit -m "StoreContext: gate automatic engine sync on ownership, expose useEngineOwnership"
```

---

### Task 3: Wire useStemPreviewPlayback.ts (Tidy Up + Auto Arrange)

**Files:**
- Modify: `src/renderer/src/state/useStemPreviewPlayback.ts`

Depends on Task 2's `useEngineOwnership` export.

**3a. Import the hook.**

Find this existing import (search for the exact text):

```typescript
import { useAppSelector, useDispatch, useFlushEngineSyncNow, usePlaying } from './StoreContext'
```

Replace it with:

```typescript
import {
  useAppSelector,
  useDispatch,
  useEngineOwnership,
  useFlushEngineSyncNow,
  usePlaying
} from './StoreContext'
```

**3b. Get the claim/stillOwn/release functions.**

Find this existing line (search for the exact text):

```typescript
  const flushEngineSyncNow = useFlushEngineSyncNow()
```

Replace it with:

```typescript
  const flushEngineSyncNow = useFlushEngineSyncNow()
  const { claim: claimEngine, stillOwn: stillOwnEngine, release: releaseEngine } =
    useEngineOwnership()
```

**3c. Release on unmount -- the single most important edit in this task.**

Find this existing code (search for the exact text):

```typescript
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
      dispatch({ type: 'RESTORE_MUTE', mute: muteSnapshot })
      dispatch({ type: 'RESTORE_VOL', vol: volSnapshot })
      dispatch({ type: 'PAUSE' })
    }
  }, [dispatch, muteSnapshot, volSnapshot])
```

Replace it with:

```typescript
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
      // Hands ownership back to the real project's own automatic sync
      // (StoreContext.tsx) BEFORE dispatching the restore below -- this
      // is the detail that matters most in this whole change. This
      // cleanup does NOT itself flush to the engine; it dispatches into
      // the reducer and relies on StoreContext's own automatic sync
      // effect (which watches state.mute/state.vol, both changed by the
      // two dispatches below) to notice and push the correction. Without
      // this release() call, that automatic effect would believe this
      // hook still owns the engine forever after this component
      // unmounts, and would silently stop restoring the real project's
      // mute/vol here on out.
      releaseEngine()
      dispatch({ type: 'RESTORE_MUTE', mute: muteSnapshot })
      dispatch({ type: 'RESTORE_VOL', vol: volSnapshot })
      dispatch({ type: 'PAUSE' })
    }
  }, [dispatch, muteSnapshot, volSnapshot, releaseEngine])
```

**3d. Claim in startPreview, check stillOwn after the flush.**

Find this existing code (search for the exact text):

```typescript
    const myGeneration = ++callGenerationRef.current
    setPreviewingKeys(keys)
```

Replace it with:

```typescript
    const myGeneration = ++callGenerationRef.current
    const engineToken = claimEngine('stem-solo-preview')
    setPreviewingKeys(keys)
```

Find this existing code (search for the exact text):

```typescript
    await flushEngineSyncNow({ mute: soloedMute, vol: soloedVol })
    if (cancelledRef.current) return
    if (callGenerationRef.current !== myGeneration) return
```

Replace it with:

```typescript
    await flushEngineSyncNow({ mute: soloedMute, vol: soloedVol })
    if (cancelledRef.current) return
    if (callGenerationRef.current !== myGeneration) return
    // Additive to the two checks above (this component unmounted /
    // superseded by a later call to THIS SAME hook) -- also bail if some
    // OTHER engine consumer (Discover's own preview) has claimed
    // ownership since this call started.
    if (!stillOwnEngine(engineToken)) return
```

- [ ] **Step 1: Make all four edits above (3a-3d)**

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/renderer/src/state/useStemPreviewPlayback.ts`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: same pass count as before this task.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/state/useStemPreviewPlayback.ts
git commit -m "useStemPreviewPlayback: claim/release engine ownership around solo preview"
```

---

### Task 4: Wire DiscoverPanel.tsx

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

Depends on Task 2's `useEngineOwnership` export.

**4a. Import the hook.**

Find this existing import (search for the exact text):

```typescript
import {
  useAppSelector,
  useDispatch,
  usePlaying,
  usePos,
  useFlushEngineSyncNow,
  usePluginCatalog
} from '../state/StoreContext'
```

Replace it with:

```typescript
import {
  useAppSelector,
  useDispatch,
  useEngineOwnership,
  usePlaying,
  usePos,
  useFlushEngineSyncNow,
  usePluginCatalog
} from '../state/StoreContext'
```

**4b. Get the claim/stillOwn/release functions.**

Find this existing line (search for the exact text):

```typescript
  const flushEngineSyncNow = useFlushEngineSyncNow()
```

Replace it with:

```typescript
  const flushEngineSyncNow = useFlushEngineSyncNow()
  const { claim: claimEngine, stillOwn: stillOwnEngine, release: releaseEngine } =
    useEngineOwnership()
```

**4c. Release in restorePreviewIfLoaded.**

Find this existing code (search for the exact text):

```typescript
  const restorePreviewIfLoaded = useCallback(async (): Promise<void> => {
    if (!previewLoadedRef.current) return
    previewLoadedRef.current = false
    currentPreviewMappingRef.current = null
    void flushEngineSyncNow()
  }, [flushEngineSyncNow])
```

Replace it with:

```typescript
  const restorePreviewIfLoaded = useCallback(async (): Promise<void> => {
    if (!previewLoadedRef.current) return
    previewLoadedRef.current = false
    currentPreviewMappingRef.current = null
    // Hands ownership back to the real project's own automatic sync
    // (StoreContext.tsx) -- unlike useStemPreviewPlayback.ts's own
    // unmount cleanup, this call ALSO explicitly flushes right below, so
    // the real project reaches the engine immediately either way; release()
    // here still matters so the automatic sync effect stops skipping its
    // own sends the moment this preview is gone, rather than only once
    // some UNRELATED real-state field happens to change next.
    releaseEngine()
    void flushEngineSyncNow()
  }, [flushEngineSyncNow, releaseEngine])
```

**4d. Claim in syncPreviewToEngine, check stillOwn after both awaits.**

Find this existing code (search for the exact text):

```typescript
  async function syncPreviewToEngine(ids: Set<string>): Promise<void> {
    if (unmountedRef.current) return
    const myGeneration = previewSyncGenerationRef.current + 1
    previewSyncGenerationRef.current = myGeneration
```

Replace it with:

```typescript
  async function syncPreviewToEngine(ids: Set<string>): Promise<void> {
    if (unmountedRef.current) return
    const myGeneration = previewSyncGenerationRef.current + 1
    previewSyncGenerationRef.current = myGeneration
    const engineToken = claimEngine('discover-preview')
```

Find this existing code (search for the exact text):

```typescript
      const project = await buildEngineProject(
        previewState,
        resolveStretchedForPlayback,
        pluginCatalog
      )
      if (unmountedRef.current || previewSyncGenerationRef.current !== myGeneration) return

      await window.rifffApi.engineLoadProject(project)
      if (unmountedRef.current || previewSyncGenerationRef.current !== myGeneration) return
```

Replace it with:

```typescript
      const project = await buildEngineProject(
        previewState,
        resolveStretchedForPlayback,
        pluginCatalog
      )
      if (unmountedRef.current || previewSyncGenerationRef.current !== myGeneration) return
      if (!stillOwnEngine(engineToken)) return

      await window.rifffApi.engineLoadProject(project)
      if (unmountedRef.current || previewSyncGenerationRef.current !== myGeneration) return
      if (!stillOwnEngine(engineToken)) return
```

- [ ] **Step 1: Make all four edits above (4a-4d)**

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/renderer/src/components/DiscoverPanel.tsx`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: same pass count as before this task.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "DiscoverPanel: claim/release engine ownership around throwaway preview"
```

---

### Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full verification pass**

Run, in order:

```bash
npm run typecheck
npx eslint .
npx vitest run
```

Expected: all clean, full suite passing at the same count as before Task 1
plus the 7 new tests from Task 1 (one pre-existing flaky test in this repo,
`pluginScan.test.ts`'s real-VST3-scan test, is environment-dependent and
unrelated to this change -- if it's the ONLY failure, re-run it in
isolation to confirm, don't treat it as a regression from this work).

- [ ] **Step 2: Review the full diff for this feature**

Tasks 1-4 each end with exactly one commit, so the last 4 commits on this
branch ARE this feature's whole diff:

```bash
git log --oneline -4
git diff HEAD~4..HEAD
```

Confirm the 4 commits are the ones from Tasks 1-4 (matching commit
messages) before diffing -- if this plan was executed non-sequentially or
with extra commits mixed in, adjust the `HEAD~4` count to match instead of
trusting it blindly. Confirm: every `claim`/`release` call added in Tasks 2-4 has a matching
counterpart (every claim eventually followed by a release somewhere on
every code path -- `syncPreviewToEngine`'s own empty-mix path already
routes through `restorePreviewIfLoaded`, which is where Discover's
`release()` lives, so no separate release is needed there). Confirm no
edit strayed into `buildEngineProject.ts`, `engineLoadProject`, PLAY/
PAUSE/SET_POS dispatching, or any `native-engine/` file -- none of those
should appear in this diff at all.

- [ ] **Step 3: Report status, do NOT claim it's confirmed working**

This environment has no way to actually run two panels in sequence and
listen to the result. State plainly in the final summary that this is
implemented and self-verified (typecheck/lint/tests/diff review) as far as
this environment allows -- not that the fix is confirmed working. The
manual walkthrough below needs Elling's own eyes/ears.

- [ ] **Step 4: Manual walkthrough checklist for Elling**

Report this checklist back in the final summary, exactly as follows,
flagged as needing his own confirmation:

1. Open Discover, add a couple of slots so a preview is playing.
2. While it's still playing, close Discover.
3. IMMEDIATELY (as fast as you can) open Tidy Up and click preview on any
   stem.
4. Expected: Tidy Up's solo holds -- you hear just that one stem, not the
   full mix. (Before this fix, the two could race: Tidy Up's solo could
   silently snap back to the full real mix a beat after starting, if
   Discover's own close-triggered restore happened to resolve after Tidy
   Up's own send.)
5. Separately, with Discover previewing again: if you have an Ableton Link
   peer available, connect it and change its tempo while Discover's preview
   is playing. Expected: Discover's preview keeps playing its OWN loop at
   its own tempo, uninterrupted (this specific check only applies if a real
   Link peer is available to test with -- skip it otherwise, the fix covers
   it either way).

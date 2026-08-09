# Merge Endlesss + LORE Library Browsers (Plan 2b-2a of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `EndlesssLibraryBrowser.tsx` and `LoreLibraryBrowser.tsx` (two ~1500/~1300-line
components that exist only because sssketch grew two separate Endlesss integrations) with one
`LibraryBrowser.tsx` that always reads through `loreWarehouse.ts`'s `lore-*` IPC channels — which,
as of the prior two plans, transparently read either sssketch's own self-built warehouse or a
user-configured external OUROVEON folder. Login and sync-triggering (only meaningful against a live
Endlesss account) are preserved from the Endlesss-direct browser; rich SQL-backed filtering,
riff-ID jump, and the folder-picker are preserved from the LORE browser. The client-side ownership
queue (`jamOwnerFractions`) is dropped entirely — `loreWarehouse.ts`'s `listRiffs` already computes
`ownerFraction` server-side via SQL, for both warehouses, which the live-API path could never do.

**Architecture:** New component `src/renderer/src/components/LibraryBrowser.tsx`, plus one
extracted shared sub-component `src/renderer/src/components/RiffCircle.tsx` (currently duplicated
logic, code-owned by `EndlesssLibraryBrowser.tsx` alone). `App.tsx` swaps its two independent modal
booleans for one. **This plan does NOT delete `EndlesssLibraryBrowser.tsx`, `LoreLibraryBrowser.tsx`,
`endlesssSyncIndex.ts`, `endlesssSync.ts`, or any of the now-dead `endlesss-*` browsing/sync IPC
channels** — those become unused once `App.tsx` no longer imports the old components, but are left
on disk. A second, small, low-risk cleanup plan ("2b-2b", not yet written) deletes them once this
plan has proven out. This mirrors the same incremental-risk pattern the rest of this redesign has
used throughout (backend before UI, additive before cutover, cutover before cleanup).

**Tech Stack:** React, TypeScript. No new IPC channels needed — `lore-sync-start-shared-feed`,
`lore-sync-start-jam`, `lore-sync-status`, `onLoreSyncProgress` (built in the original backend plan)
and every `lore-*` LORE-warehouse-read channel (`loreListJams`, `loreListRiffs`, `loreResolveRiff`,
`loreResolveRiffWithContext`, `loreDownloadMissingStems`, `loreWarehouseAvailable`,
`loreWarehouseRoot`, `loreSetWarehouseRoot`) already exist and are already exposed on
`window.rifffApi`. `endlesssLogin`/`endlesssLogout`/`endlesssAuthStatus`/`endlesssListJams` also
stay in active use (login gating sync; live jam-membership discovery, since the warehouse only ever
contains jams someone has explicitly synced at least once — see Data flow below).

**Scope note.** No renderer component in this codebase is unit-tested directly (established
convention — see `CLAUDE.md`'s Testing Conventions); every task in this plan is verified via
typecheck + lint + (where flagged) manual walkthrough, matching how `EndlesssLibraryBrowser.tsx`
and `LoreLibraryBrowser.tsx` were themselves originally built and have been maintained since.

---

## Data flow (read before starting Task 2)

**Jam sidebar** shows the union of two sources, deduplicated by `jamCID`:
- `loreListJams(jamFilter)` — every jam that has ANY data in the currently-active warehouse
  (already synced at least once, or present in a real external LORE folder). Works with no login.
- `endlesssListJams()` — the account's live Endlesss jam memberships, when logged in. Lets someone
  discover and sync a jam they've never synced before, which wouldn't appear in the warehouse yet.
  A synthetic entry `{ jamCID: 'shared:<username>', name: 'Shared Feed', lastRiffTime: 0 }` is
  added to this source's results too, since the live API has no "list my shared feed as a jam"
  concept — the warehouse's own `Jams` table already treats the shared feed as a real row keyed
  this way (see the sync backend's own design), so this makes the sidebar's two sources consistent.

**Per-jam sync status/trigger**: once a jam is selected, `loreSyncStatus(jamCID)` reports whether
it's ever been synced and how many riffs are in the warehouse for it; a "sync" button (visible only
when logged in) calls `loreSyncStartSharedFeed`/`loreSyncStartJam` depending on whether the selected
`jamCID` starts with `shared:`.

**Riff browsing** for the selected jam always goes through `loreListRiffs(jamCID, filters)` /
`loreResolveRiff(riffCID)` / `loreResolveRiffWithContext(riffCID)` / `loreDownloadMissingStems(riffCID)`
— the exact same functions `LoreLibraryBrowser.tsx` already uses, unchanged. This is what makes the
rich filter bar, riff-ID jump, and PolarGlyph inspector "just work" against a synced self-built
warehouse: they were already generic SQL-backed IPC calls, never hardcoded to the external-folder
case despite what `LoreLibraryBrowser.tsx`'s framing implied.

---

### Task 1: Extract `RiffCircle.tsx`

**Files:**
- Create: `src/renderer/src/components/RiffCircle.tsx`
- Modify: `src/renderer/src/components/EndlesssLibraryBrowser.tsx:101-194`

This is a pure move, not a rewrite — `EndlesssLibraryBrowser.tsx`'s existing `RiffCircle` function
(lines 114-194, plus its doc comment starting line 101) already has exactly the props/behavior the
merged browser needs (selection ring, multi-select ring, cached-dashed-border, ownerFraction fill,
favorited override, imported badge, playing pulse). `LoreLibraryBrowser.tsx` renders its own
riff circles inline with equivalent visual logic (verify this by reading its riff-grid section,
roughly lines 1115-1235, before starting) — after this task, both files still render their own way
(this task doesn't touch `LoreLibraryBrowser.tsx` or wire the extracted component into either file
yet); Task 3 is what actually makes `LibraryBrowser.tsx` consume `RiffCircle.tsx`.

- [ ] **Step 1: Create the new file**

Move `EndlesssLibraryBrowser.tsx`'s `RiffCircle` function (lines 114-194) and its doc comment
(lines 101-113) into a new file, changing only the export and adding the two imports it needs:

```typescript
// src/renderer/src/components/RiffCircle.tsx
import { riffCircleColor } from '../theme/riffCircleColor'

/** One riff's preview circle -- shared across every place a riff needs a
 * small clickable/right-clickable preview dot (library browsers,
 * potentially others later). `playing` drives the fade-in/out brightness
 * pulse (reuses RifffBlockRow.tsx's own `ra-rec-pulse` keyframe by name --
 * duplicate `@keyframes` declarations with identical rules are harmless, so
 * callers that need the pulse to actually animate must mount that keyframe
 * themselves via <style>, same as EndlesssLibraryBrowser.tsx's own outer
 * modal already does -- this component doesn't mount it itself, to avoid
 * re-declaring it if multiple instances render on the same page).
 * onClick receives the raw MouseEvent (not just a plain callback) so the
 * CALLER can read shiftKey/metaKey/ctrlKey for shift/cmd-click
 * multi-select. A plain click toggles: selecting the already-selected riff
 * calls onClick with the same riffCID again, and the caller turns that into
 * a deselect. */
export function RiffCircle({
  title,
  selected,
  multiSelected,
  playing,
  fullyCached,
  imported,
  ownerFraction,
  favorited,
  onClick,
  onContextMenu
}: {
  title: string
  selected: boolean
  /** In the batch (shift/cmd-click) selection but NOT the anchor -- gets
   * its own, weaker ring than `selected`'s. See the caller's own
   * handleRiffClick. */
  multiSelected: boolean
  playing: boolean
  fullyCached: boolean
  imported: boolean
  /** 0-1, drives brightness -- see riffCircleColor. */
  ownerFraction: number
  /** Right-click toggled, persisted independently of source (see
   * loreWarehouseWriter.ts's Tags-table favourites) -- overrides the
   * ownerFraction grayscale fill with solid purple when true. */
  favorited: boolean
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  return (
    <div style={{ position: 'relative', width: 18, height: 18 }}>
      <button
        onClick={onClick}
        onContextMenu={onContextMenu}
        title={title}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          // Anchor selection ring, then batch-selection ring, then "not
          // everything's downloaded yet" (dashed), else a plain solid
          // border -- downloadMissingStems is already wired to fetch
          // whatever's missing the moment a riff is selected, so showing
          // the circle before it's fully cached is safe.
          border: selected
            ? '2px solid var(--ra-playhead)'
            : multiSelected
              ? '2px solid var(--ra-stretch-on)'
              : fullyCached
                ? '1px solid var(--ra-border)'
                : '1px dashed var(--ra-text-3)',
          padding: 0,
          background: favorited ? 'var(--ra-recording-live)' : riffCircleColor(ownerFraction),
          cursor: 'pointer',
          animation: playing ? 'ra-rec-pulse 1.4s ease-in-out infinite' : undefined
        }}
      />
      {imported && (
        <span
          title="already imported"
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--ra-stretch-on)',
            border: '1px solid var(--ra-bg-bar)',
            pointerEvents: 'none'
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Remove the now-duplicated definition from `EndlesssLibraryBrowser.tsx`, import instead**

Delete lines 101-194 (the doc comment + `function RiffCircle({...}) {...}` block) from
`EndlesssLibraryBrowser.tsx`. Add an import near its other local-component imports:

```typescript
import { RiffCircle } from './RiffCircle'
```

Every existing `<RiffCircle .../>` usage elsewhere in `EndlesssLibraryBrowser.tsx` needs no changes
— same component name, same props, just imported instead of locally defined.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms `EndlesssLibraryBrowser.tsx`'s existing `<RiffCircle>` call sites
still type-check against the extracted version's identical prop signature)

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/RiffCircle.tsx src/renderer/src/components/EndlesssLibraryBrowser.tsx
git commit -m "$(cat <<'EOF'
Extract RiffCircle into its own file

Pure move, no behavior change -- EndlesssLibraryBrowser.tsx's existing
RiffCircle already has exactly the props/behavior the upcoming merged
library browser needs.
EOF
)"
```

---

### Task 2: `LibraryBrowser.tsx` — state, effects, and handlers (data/logic layer)

**Files:**
- Create: `src/renderer/src/components/LibraryBrowser.tsx`

This task builds the full data and logic layer of the new component with a minimal placeholder
render (`return <div>LibraryBrowser (WIP)</div>`), so it type-checks and compiles standalone before
Task 3 adds the real JSX on top. Read `LoreLibraryBrowser.tsx` and `EndlesssLibraryBrowser.tsx` in
full before starting — this task ports and merges logic from both, and needs their exact current
state, and this plan's own code blocks below are complete but reference helper functions
(`groupRiffsByDateAndTempo`, `classifyStems` usage, `previewLoop` calls) whose exact shape you
should cross-check against the real source files first.

- [ ] **Step 1: Write the file's imports, types, and constants**

```typescript
// src/renderer/src/components/LibraryBrowser.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LoreJam, LoreResolvedRiff, LoreRiffSummary, RiffFilters } from '@shared/loreLibrary'
import { instrumentMaskToSoundType, LORE_USERNAME } from '@shared/loreLibrary'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { sqrtGain } from '@shared/mixGain'
import { getAudioContext } from '../audio/peakCache'
import {
  startPreviewLoop,
  stopPreviewSources,
  registerActivePreview,
  unregisterActivePreview
} from '../audio/previewLoop'
import { classifyStems } from '../audio/classifyStems'
import { buildImportedRifff } from '../audio/importResolvedRiff'
import { usePlaying, useDispatch, useAppState, useRiffFavourites, useRiffFavouritesActions } from '../state/StoreContext'
import { useBusy } from '../state/BusyContext'
import { formatBpm } from '@shared/format'
import { stemKey, type Rifff } from '@shared/types'
import { EndlesssLoginPanel } from './EndlesssLoginPanel'
import { RiffCircle } from './RiffCircle'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'
import { LoadingLoader } from './LoadingLoader'

const LORE_USERNAME_STORAGE_KEY = 'sssketch:loreUsername'

function loadStoredLoreUsername(): string {
  try {
    return localStorage.getItem(LORE_USERNAME_STORAGE_KEY) ?? LORE_USERNAME
  } catch {
    return LORE_USERNAME
  }
}

type AuthStatus =
  { loggedIn: false } | { loggedIn: true; userId: string; username: string; expiresAt: number }

interface RiffTempoGroup {
  bpm: number
  riffs: LoreRiffSummary[]
}

interface RiffDateGroup {
  label: string
  tempoGroups: RiffTempoGroup[]
}

/** Ported verbatim from LoreLibraryBrowser.tsx's own groupRiffsByDateAndTempo
 * (that file's lines ~71-96 as of this plan being written -- read the real
 * current implementation there and copy it exactly, adjusting only the
 * function's own doc comment if it referenced anything LORE-specific that
 * no longer applies now that this grouping serves every riff source). */
function groupRiffsByDateAndTempo(riffs: LoreRiffSummary[]): RiffDateGroup[] {
  // PASTE the real, current body of LoreLibraryBrowser.tsx's
  // groupRiffsByDateAndTempo here verbatim. Do not invent a new
  // implementation -- this must be byte-identical to what's already shipped
  // and already correct.
}

const RIFF_ID_JUMP_WINDOW_SIZE = 20
const SCROLL_LOAD_MORE_THRESHOLD_PX = 200

// How many riffs past the one just selected to warm the local stem cache
// for in the background -- see EndlesssLibraryBrowser.tsx's own PREFETCH_COUNT
// doc comment for the full rationale (unchanged here).
const PREFETCH_COUNT = 3
```

**IMPORTANT — do not skip the "PASTE the real body" instruction above.** Open the actual current
`LoreLibraryBrowser.tsx`, find `groupRiffsByDateAndTempo`, and copy its real, current implementation
verbatim into this file. This plan does not re-derive that function's body because it must be
byte-identical to the already-shipped, already-correct version — re-deriving it from a description
risks introducing a subtle bug in date/tempo bucketing logic that's already been tuned and shipped.

- [ ] **Step 2: Write the component's state**

```typescript
export function LibraryBrowser({
  onClose,
  onImported
}: {
  onClose: () => void
  onImported: (groupIds: string[], rifffs?: Rifff[]) => void
}): React.JSX.Element {
  const riffFavourites = useRiffFavourites()
  const { toggleRiffFavourite } = useRiffFavouritesActions()

  // Auth (gates sync-triggering and live jam-membership discovery)
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ loggedIn: false })

  // Warehouse availability + external folder config (unchanged from LoreLibraryBrowser.tsx)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [warehouseRoot, setWarehouseRootState] = useState<string | null>(null)
  const [changingWarehouseRoot, setChangingWarehouseRoot] = useState(false)

  // Jam sidebar
  const [jamFilter, setJamFilter] = useState('')
  const [syncedJams, setSyncedJams] = useState<LoreJam[]>([])
  const [membershipJams, setMembershipJams] = useState<LoreJam[] | null>(null)
  const [selectedJamCID, setSelectedJamCID] = useState<string | null>(null)

  // Per-jam sync status/trigger
  const [syncStatus, setSyncStatus] = useState<{ riffCount: number; complete: boolean } | null>(null)
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncBaseCount, setSyncBaseCount] = useState(0)

  // Riff list + pagination (single flat list -- no more per-tab duplication)
  const [riffs, setRiffs] = useState<LoreRiffSummary[]>([])
  const riffGroups = useMemo(() => groupRiffsByDateAndTempo(riffs), [riffs])
  const [hasMoreRiffs, setHasMoreRiffs] = useState(false)
  const [loadingMoreRiffs, setLoadingMoreRiffs] = useState(false)
  const nextOffsetRef = useRef(0)
  const gridRef = useRef<HTMLDivElement>(null)

  // Riff-ID jump (unchanged from LoreLibraryBrowser.tsx)
  const [riffIdInput, setRiffIdInput] = useState('')
  const [riffIdNotFound, setRiffIdNotFound] = useState(false)
  const [pendingJump, setPendingJump] = useState<{ offset: number; matchedRiffCID: string } | null>(
    null
  )
  const riffNodeRefs = useRef(new Map<string, HTMLDivElement>())

  // Filters (unchanged from LoreLibraryBrowser.tsx)
  const [bpmFilter, setBpmFilter] = useState('')
  const [userNameFilter, setUserNameFilter] = useState('')
  const [onlyFullyCached, setOnlyFullyCached] = useState(false)
  const [loreUsername, setLoreUsername] = useState(loadStoredLoreUsername)
  const [onlyContainsMe, setOnlyContainsMe] = useState(false)
  const [dateFromFilter, setDateFromFilter] = useState('')
  const [dateToFilter, setDateToFilter] = useState('')
  const [resetForJamCID, setResetForJamCID] = useState<string | null>(null)

  // Selection & preview
  const [selectedRiffCID, setSelectedRiffCID] = useState<string | null>(null)
  const [selectedRiffCIDs, setSelectedRiffCIDs] = useState<Set<string>>(new Set())
  const [resolvedRiff, setResolvedRiff] = useState<LoreResolvedRiff | null>(null)
  const [playingRiffCID, setPlayingRiffCID] = useState<string | null>(null)
  const [importedRiffGroupIds, setImportedRiffGroupIds] = useState<Map<string, string>>(new Map())
  const [downloadingRiffCID, setDownloadingRiffCID] = useState<string | null>(null)
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const previewTokenRef = useRef(0)
  const syncQueueTokenRef = useRef(0)

  const { playing } = usePlaying()
  const dispatch = useDispatch()
  const appState = useAppState()
  const { busy } = useBusy()
```

- [ ] **Step 3: Jam list unification**

```typescript
  useEffect(() => {
    window.rifffApi.loreWarehouseAvailable().then(setAvailable)
  }, [])

  useEffect(() => {
    if (available === null) return
    window.rifffApi.loreWarehouseRoot().then(setWarehouseRootState)
  }, [available])

  useEffect(() => {
    window.rifffApi.loreListJams(jamFilter).then(setSyncedJams)
  }, [jamFilter, available])

  useEffect(() => {
    if (!authStatus.loggedIn) {
      setMembershipJams(null)
      return
    }
    window.rifffApi.endlesssListJams().then((liveJams) => {
      const sharedFeedEntry: LoreJam = {
        jamCID: `shared:${authStatus.username}`,
        name: 'Shared Feed',
        lastRiffTime: 0
      }
      setMembershipJams([sharedFeedEntry, ...liveJams])
    })
  }, [authStatus])

  // Union of both sources, deduplicated by jamCID -- syncedJams entries win
  // on conflict (they carry a real lastRiffTime from the warehouse;
  // membershipJams entries never do, per endlesssListJams' own contract).
  const visibleJams = useMemo(() => {
    const byId = new Map<string, LoreJam>()
    for (const jam of membershipJams ?? []) byId.set(jam.jamCID, jam)
    for (const jam of syncedJams) byId.set(jam.jamCID, jam)
    const merged = [...byId.values()]
    if (jamFilter.trim() === '') return merged
    const needle = jamFilter.trim().toLowerCase()
    return merged.filter((j) => j.name.toLowerCase().includes(needle))
  }, [syncedJams, membershipJams, jamFilter])
```

- [ ] **Step 4: Sync status + trigger**

```typescript
  useEffect(() => {
    if (!selectedJamCID) {
      setSyncStatus(null)
      return
    }
    window.rifffApi.loreSyncStatus(selectedJamCID).then(setSyncStatus)
  }, [selectedJamCID])

  useEffect(() => {
    return window.rifffApi.onLoreSyncProgress((progress) => {
      if (progress.key !== selectedJamCID) return
      setSyncProgress(progress)
      if (progress.done === progress.total) {
        setSyncing(false)
        window.rifffApi.loreSyncStatus(progress.key).then(setSyncStatus)
      }
    })
  }, [selectedJamCID])

  const handleStartSync = useCallback(() => {
    if (!selectedJamCID) return
    setSyncing(true)
    setSyncBaseCount(syncStatus?.riffCount ?? 0)
    setSyncProgress(null)
    const promise = selectedJamCID.startsWith('shared:')
      ? window.rifffApi.loreSyncStartSharedFeed(selectedJamCID.slice('shared:'.length))
      : window.rifffApi.loreSyncStartJam(selectedJamCID, visibleJams.find((j) => j.jamCID === selectedJamCID)?.name ?? selectedJamCID)
    promise.catch((err) => {
      console.error('sync failed:', err)
      setSyncing(false)
    })
  }, [selectedJamCID, syncStatus, visibleJams])
```

- [ ] **Step 5: Riff list fetch (filters + pagination + riff-ID jump)**

Port this section's logic from `LoreLibraryBrowser.tsx`'s own main riff-fetch effect (the one
depending on `selectedJamCID`/filters/`pendingJump`, roughly its lines 648-706 as of this plan being
written) verbatim, with exactly one change: every call site of `window.rifffApi.loreListRiffs(...)`
is unchanged (same function, same channel, same `RiffFilters` shape) — this section needs no actual
behavioral changes from the LORE browser's existing version, since `loreListRiffs`/`RiffFilters`
were already generic. Read the real current file and port it exactly, including the riff-ID-jump
window-centering logic, the `handleLoadMore` function, and the `handleGoToRiffId`/jump-consuming
effect. Do not invent a new implementation of any part of this section.

- [ ] **Step 6: Resolve/preview + prefetch + background sync**

Port verbatim from `LoreLibraryBrowser.tsx`: the resolve/preview effect (calls
`window.rifffApi.loreResolveRiff(riffCID)`, manages `previewSourcesRef`/`previewTokenRef`,
`startPreviewLoop`/`stopPreviewSources`), the `ensureStemsDownloaded`/`backgroundDownload` helpers,
and `runBackgroundSync` (the outward-walk stem-sync). These have no Endlesss-specific concerns at
all — they already operate purely against `loreResolveRiff`/`loreDownloadMissingStems`, which now
transparently work against either warehouse.

- [ ] **Step 7: Selection, import, and favourite handlers**

Port verbatim from `LoreLibraryBrowser.tsx`: `handleRiffClick` (shift/cmd-click multi-select),
`importResolvedRiff` (merge-on-reimport with `classifyStems` on newly-added stem slots),
`handleImportSelected` (batch import over `selectedRiffCIDs`). These already operate purely against
`resolveRiff`/`downloadMissingStems`, no port-time changes needed beyond confirming the function
names match this file's own state variable names from Step 2.

- [ ] **Step 8: Escape-to-close + minimal placeholder render**

```typescript
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return <div>LibraryBrowser (WIP -- full render added in the next task)</div>
}
```

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If any port from Step 5-7 references a helper/import this file doesn't have
yet (e.g. `guessSoundTypeFromPresetName`, `stemKey`), add the missing import — Step 1's import list
above is a starting point based on both source files' own imports, not guaranteed exhaustive; trust
the compiler over the list if they disagree.

- [ ] **Step 10: Lint**

Run: `npm run lint`
Expected: no new errors (an unused-import warning for anything Step 1 imported that Steps 3-8 ended
up not using is expected and fine to leave for now — Task 3's real render will use the rest;
re-check at Task 3's own lint step, not this one)

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/components/LibraryBrowser.tsx
git commit -m "$(cat <<'EOF'
LibraryBrowser.tsx: data/logic layer (state, effects, handlers)

Merges EndlesssLibraryBrowser.tsx's auth/sync-trigger concerns with
LoreLibraryBrowser.tsx's filtering/riff-ID-jump/background-sync concerns,
all now reading through loreWarehouse.ts's lore-* channels regardless of
which warehouse is active. Drops the client-side ownership-queue subsystem
entirely -- loreListRiffs already computes ownerFraction server-side.
Minimal placeholder render; full JSX layout is the next task.
EOF
)"
```

---

### Task 3: `LibraryBrowser.tsx` — full JSX layout

**Files:**
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`

Replace Task 2's placeholder `return <div>...</div>` with the real modal layout: header (no tabs —
just a title and close button, unlike either source file, since there's only one browser now),
`EndlesssLoginPanel`, jam sidebar (filter input + riff-ID-jump input + jam list, each row showing
sync status), main riff panel (filter bar, riff grid, inspector).

- [ ] **Step 1: Header + login panel + outer structure**

```typescript
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <style>{`@keyframes ra-rec-pulse { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.6); } }`}</style>
      <div
        style={{
          width: 900,
          height: 600,
          background: 'var(--ra-bg-panel)',
          border: '1px solid var(--ra-border)',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid var(--ra-border)'
          }}
        >
          <span style={{ textTransform: 'lowercase' }}>library</span>
          <button onClick={onClose}>close</button>
        </div>

        <EndlesssLoginPanel onStatusChange={setAuthStatus} />

        {available === false ? (
          <div style={{ padding: 24 }}>
            <p>library not available at {warehouseRoot}</p>
            <button
              disabled={changingWarehouseRoot}
              onClick={async () => {
                setChangingWarehouseRoot(true)
                const picked = await window.rifffApi.pickFolder()
                if (picked) {
                  await window.rifffApi.loreSetWarehouseRoot(picked)
                  setAvailable(await window.rifffApi.loreWarehouseAvailable())
                }
                setChangingWarehouseRoot(false)
              }}
            >
              choose folder
            </button>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* sidebar and riff panel go here -- Steps 2-4 */}
          </div>
        )}
      </div>
    </div>
  )
}
```

Note: `available === null` (still loading) intentionally falls through to the same branch as
`available === true` below — the sidebar/riff-panel JSX in Steps 2-4 already handles an
empty/loading `visibleJams` list gracefully (same as both source files' own loading states), so no
separate third branch is needed.

- [ ] **Step 2: Jam sidebar**

Port the jam-filter-input + riff-ID-jump-input JSX from `LoreLibraryBrowser.tsx` verbatim (its
lines ~898-958 as of this plan being written) — unchanged, since `jamFilter`/`riffIdInput`/
`handleGoToRiffId` are the same state/handler names from Task 2. Below that, render `visibleJams`
(not the old file's `jams`/`visibleJams`-from-membership-filter — this file's own `visibleJams` from
Task 2 Step 3 is the union):

```typescript
            <div style={{ width: 220, overflowY: 'auto', borderRight: '1px solid var(--ra-border)' }}>
              {/* jamFilter input + riffIdInput/handleGoToRiffId JSX ported here, per the
                  instruction above */}
              {visibleJams.map((jam) => (
                <button
                  key={jam.jamCID}
                  onClick={() => setSelectedJamCID(jam.jamCID)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: selectedJamCID === jam.jamCID ? 'var(--ra-bg-hover)' : 'transparent',
                    padding: '4px 8px'
                  }}
                >
                  {jam.name}
                  {syncedJams.some((s) => s.jamCID === jam.jamCID) ? '' : ' (not synced)'}
                </button>
              ))}
            </div>
```

- [ ] **Step 3: Filter bar + sync trigger**

Port the filter-bar JSX (date-from/date-to/bpm/username/onlyFullyCached/loreUsername/onlyContainsMe
inputs) from `LoreLibraryBrowser.tsx` verbatim (its lines ~991-1113 as of this plan being written) —
unchanged, same state names. Immediately above or alongside it, add the sync-trigger UI (new to this
file, adapted from `EndlesssLibraryBrowser.tsx`'s own sync button, its lines ~1082-1125/~1325-1368
as of this plan being written, but simplified to not need a tab-specific variant since there's only
one riff panel now):

```typescript
              {authStatus.loggedIn && selectedJamCID && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>
                    {syncStatus
                      ? `synced: ${syncStatus.riffCount} riffs${syncStatus.complete ? '' : ' (partial)'}`
                      : 'not synced yet'}
                  </span>
                  <button onClick={handleStartSync} disabled={syncing}>
                    {syncing ? <LoadingLoader /> : 'sync'}
                  </button>
                  {syncing && syncProgress && (
                    <span>
                      synced {syncBaseCount + syncProgress.done} so far
                    </span>
                  )}
                </div>
              )}
```

- [ ] **Step 4: Riff grid + inspector**

Port the riff-grid JSX (date>tempo-grouped, `onScroll` pagination, `riffNodeRefs` callback ref) and
the inspector row JSX (`PolarGlyph`, bpm/stem-count/cached text, "download missing stems" button,
Import button) from `LoreLibraryBrowser.tsx` verbatim (its lines ~1115-1329 as of this plan being
written), with exactly one change: every place that file's own inline riff-circle rendering
appears, replace it with `<RiffCircle .../>` (imported in Task 2 Step 1), passing this file's own
equivalent state (`selectedRiffCID`, `selectedRiffCIDs`, `playingRiffCID`, `importedRiffGroupIds`,
`riffFavourites`) into its props exactly as `EndlesssLibraryBrowser.tsx`'s own `<RiffCircle>` call
sites already do (reference those for the exact prop-wiring pattern, since `LoreLibraryBrowser.tsx`
never used the shared component and computed the same values inline).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors — this is the point where any leftover unused import from Task 2 should now
either be used by this task's JSX or genuinely be dead and worth removing

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/LibraryBrowser.tsx
git commit -m "$(cat <<'EOF'
LibraryBrowser.tsx: full JSX layout

No tabs (single riff panel, jam sidebar shows both synced and
sync-available-but-not-yet-synced jams). Riff circles now render via the
shared RiffCircle component. Filter bar, riff grid, and inspector are
ported unchanged from LoreLibraryBrowser.tsx -- they were already generic
SQL-backed IPC calls with nothing Endlesss-direct-specific about them.
EOF
)"
```

---

### Task 4: Wire into `App.tsx`

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Replace the two modal booleans with one**

Find (near line 998-999, verify against the real current file):

```typescript
const [loreLibraryOpen, setLoreLibraryOpen] = useState(false)
const [endlesssLibraryOpen, setEndlesssLibraryOpen] = useState(false)
```

Replace with:

```typescript
const [libraryOpen, setLibraryOpen] = useState(false)
```

- [ ] **Step 2: Replace the two render calls with one**

Find (near lines 1738-1757, verify against the real current file):

```tsx
{loreLibraryOpen && (
  <LoreLibraryBrowser
    onClose={() => setLoreLibraryOpen(false)}
    onImported={handleLoreImported}
    onSwitchToEndlesss={() => {
      setLoreLibraryOpen(false)
      setEndlesssLibraryOpen(true)
    }}
  />
)}
{endlesssLibraryOpen && (
  <EndlesssLibraryBrowser
    onClose={() => setEndlesssLibraryOpen(false)}
    onImported={handleLoreImported}
    onSwitchToLore={() => {
      setEndlesssLibraryOpen(false)
      setLoreLibraryOpen(true)
    }}
  />
)}
```

Replace with:

```tsx
{libraryOpen && (
  <LibraryBrowser onClose={() => setLibraryOpen(false)} onImported={handleLoreImported} />
)}
```

Update the import at the top of the file (replace both `import { LoreLibraryBrowser } from
'./components/LoreLibraryBrowser'` and `import { EndlesssLibraryBrowser } from
'./components/EndlesssLibraryBrowser'` with a single `import { LibraryBrowser } from
'./components/LibraryBrowser'`).

- [ ] **Step 3: Update every other reference to the two old booleans**

Search the file for every remaining use of `setLoreLibraryOpen`/`setEndlesssLibraryOpen`/
`loreLibraryOpen`/`endlesssLibraryOpen` (there are at least three: `Shelf`'s `onOpenLibrary` prop
around line 1630, `OnboardingModal`'s `onOpenEndlesss` callback around line 1830, and the
`BeatPicker`'s `wasBatchImport` closing side effect around line 1720 — verify exact current line
numbers, these may have drifted) and replace each with the equivalent `setLibraryOpen(true)` /
`setLibraryOpen(false)` / `libraryOpen` call. None of these call sites need any logic change beyond
the variable rename — they were already just "open the library browser" / "close it," and there's
now only one to open/close.

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
Wire LibraryBrowser into App.tsx, replacing both old modal booleans

EndlesssLibraryBrowser.tsx and LoreLibraryBrowser.tsx are no longer
imported anywhere, but are deliberately not deleted by this plan -- see
this plan's own Scope note. A follow-up cleanup plan removes them along
with the now-dead endlesss-* browsing/sync IPC channels.
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
already documented in every prior plan's own verification task (this worktree has no compiled
`native-engine/build`) — this plan touches no `src/main/*.test.ts` files at all, so the passing
count should be identical to before this plan started

- [ ] **Step 4: Confirm the old components are genuinely unreferenced**

Run: `grep -rn "EndlesssLibraryBrowser\|LoreLibraryBrowser" src/renderer/src/App.tsx`
Expected: no output — confirms Task 4 genuinely removed both imports and both render call sites,
not just added the new one alongside them

- [ ] **Step 5: Manual walkthrough — flag explicitly, don't claim it was done**

This is the single highest-value manual check in this whole redesign: open the app for real, open
the library browser, confirm the jam sidebar shows real jams (both already-synced and, if logged
in, not-yet-synced ones), confirm riff browsing/filtering/preview/import/favouriting/riff-ID-jump
all still work, confirm sync-triggering a jam actually populates it and the riff grid picks up the
new data. This needs a real logged-in Endlesss account and cannot be completed by an implementer
subagent solo — say so explicitly rather than claiming it was verified. If anything in this manual
walkthrough turns out broken, that's expected to surface real bugs this plan's own code review
couldn't catch (no automated coverage exists for renderer components in this codebase) — report
findings precisely rather than guessing at fixes.

- [ ] **Step 6: Commit (only if Steps 1-3 required any fixes not already committed)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix verification issues found in full-suite run
EOF
)"
```

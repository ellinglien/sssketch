# bing bong 1: foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three pieces sssketch needs before bing bong, each useful on its own: **locked riffs**
(play and solo, never edited), **Cross opened from any setup** (center pre-filled from one parent,
and one custom button instead of add to shelf / add to timeline), and a **content id for audio
files** in main.

**Spec:** `docs/superpowers/specs/2026-10-10-bing-bong-design.md`, "Prep work in sssketch". This
is plan 1 of 4: 1 foundations (this), 2 core (the folder, turns, taking and receiving a turn),
3 doorbell (email), 4 sssketchy and the menu.

**Architecture:**
- **Locked riffs** are a `locked?: boolean` on `Rifff`. The guard does not list action types: it
  compares the state before and after an action (`editsLockedRiff`), and `historyReducer` refuses
  any action, or whole `BATCH`, that changed a locked riff, with no undo step. The map and
  auto-arrange batches "add new clips, then delete the old ones", so refusing only one child
  would half-apply them. StoreContext's dispatch runs the same check first, only to show a
  notice ("that's a past turn, so it's locked.").
- **Cross:** a pure `prefillCrossCenter` in `src/shared/cross.ts`; an optional `primaryAction`
  prop on `CrossPanel`; `openCrossFromRiffs` in `App.tsx` takes options.
- **Content id:** `src/main/audioContentId.ts`, sha256 of the bytes, cached by path + size + mtime.

**Tech stack:** TypeScript, vitest, React, Electron.

**Repo:** `/Users/nickel/Claudecode/sssketch`. **Base:** `master` at `e06abc32`.

**Branch:** `bing-bong-1-foundations` (`git switch -c bing-bong-1-foundations`).

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GgVLoMfDYXWtBAGJo23dn
```

Commit each task's own files only (`git commit --only <paths>`), never `git add -A`. Other agents
may share this working tree.

**Before you start:**
- `git status --short`. Note other agents' files and leave them alone.
- `npm test` and `npm run typecheck`. The suite is green except the machine-dependent
  engine-spawn tests; without `native-engine/build` those fail with "binary not found".
- `App.tsx`, `CrossPanel.tsx` and `StoreContext.tsx` are large and move under you. Anchor every
  edit on the quoted code, never on line numbers.

## How this plan's code was checked

Every code block below is a file or `git diff` from a scratch copy of `src/` at the base commit,
after `prettier --write`, with `npx vitest run` (the state suite: 27 files, 674 tests, plus the
new tests), `npm run typecheck`-equivalent (`tsc -p tsconfig.web.json` and
`tsconfig.node.json`) and `eslint` passing on every touched file.

## Files

| File | Change |
|---|---|
| `src/shared/types.ts` | `Rifff.locked?: boolean` |
| `src/renderer/src/state/lockedRiffs.ts` | new: `editsLockedRiff`, `actionEditsLockedRiff`, `LOCKED_RIFF_NOTICE` |
| `src/renderer/src/state/lockedRiffs.test.ts` | new |
| `src/renderer/src/state/history.ts` | refuse actions that edit a locked riff |
| `src/renderer/src/state/selectors.ts` | `pasteRifffAction` never copies `locked` |
| `src/renderer/src/state/lockedNotice.ts` | new: the notice's state |
| `src/renderer/src/components/LockedNotice.tsx` | new: the notice |
| `src/renderer/src/state/StoreContext.tsx` | show the notice before a refused edit |
| `src/renderer/src/App.tsx` | mount the notice; `openCrossFromRiffs` options; `crossPrimary` state |
| `src/shared/cross.ts`, `cross.test.ts` | `prefillCrossCenter` |
| `src/renderer/src/components/CrossPanel.tsx` | `primaryAction` prop |
| `src/main/audioContentId.ts`, `.test.ts` | new |

---

### Task 1: Locked riffs

**Files:**
- Modify: `src/shared/types.ts` (the `Rifff` interface)
- Create: `src/renderer/src/state/lockedRiffs.ts`, `src/renderer/src/state/lockedRiffs.test.ts`
- Modify: `src/renderer/src/state/history.ts`, `src/renderer/src/state/selectors.ts`

- [ ] **Step 1: Add the field.** In `src/shared/types.ts`, at the end of `interface Rifff`:

```diff
--- a/src/shared/types.ts
+++ b/src/shared/types.ts
@@ -124,6 +124,10 @@ export interface Rifff {
    * Purely informational (Inspector display); nothing in playback/
    * tiling/stretch reads it. */
   key?: string
+  /** A locked riff plays and solos but can't be moved, resized, edited or deleted (bing bong's
+   * past turns: docs/superpowers/specs/2026-10-10-bing-bong-design.md). Never copied onto a
+   * duplicate. Undefined means unlocked. */
+  locked?: boolean
 }
 
 export function stemKey(groupId: string, slot: number): string {
```

- [ ] **Step 2: Write the failing tests.** Create `src/renderer/src/state/lockedRiffs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createHistoryState, historyReducer, type HistoryState } from './history'
import { editsLockedRiff } from './lockedRiffs'
import { initialState, reducer, type AppState } from './store'
import { pasteRifffAction } from './selectors'
import type { Rifff } from '@shared/types'

function rifff(groupId: string, locked: boolean): Rifff {
  return {
    groupId,
    name: groupId,
    bpm: 120,
    barLength: 8,
    folderPath: '/x',
    stems: [
      { slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 4, barLength: 8 }
    ],
    ...(locked ? { locked: true } : {})
  }
}

function placed(): AppState {
  let s = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: rifff('t1', true) })
  s = reducer(s, { type: 'PLACE_ON_TIMELINE', groupId: 't1', startBar: 0 })
  s = reducer(s, { type: 'ADD_TO_SHELF', rifff: rifff('free', false) })
  s = reducer(s, { type: 'PLACE_ON_TIMELINE', groupId: 'free', startBar: 8 })
  return s
}

describe('editsLockedRiff', () => {
  const s = placed()

  it('allows edits to unlocked riffs', () => {
    expect(
      editsLockedRiff(s, reducer(s, { type: 'SET_VOLUME', stemKey: 'free:1', volume: 0.2 }))
    ).toBe(false)
    expect(editsLockedRiff(s, reducer(s, { type: 'REMOVE_FROM_TIMELINE', groupId: 'free' }))).toBe(
      false
    )
  })

  it('catches moving, resizing, deleting and re-levelling a locked riff', () => {
    expect(
      editsLockedRiff(s, reducer(s, { type: 'PLACE_ON_TIMELINE', groupId: 't1', startBar: 4 }))
    ).toBe(true)
    expect(editsLockedRiff(s, reducer(s, { type: 'SET_PLAYED_BARS', key: 't1', bars: 4 }))).toBe(
      true
    )
    expect(editsLockedRiff(s, reducer(s, { type: 'DELETE_RIFFFS', groupIds: ['t1'] }))).toBe(true)
    expect(
      editsLockedRiff(s, reducer(s, { type: 'SET_VOLUME', stemKey: 't1:1', volume: 0.2 }))
    ).toBe(true)
    expect(editsLockedRiff(s, reducer(s, { type: 'RENAME_RIFFF', groupId: 't1', name: 'x' }))).toBe(
      true
    )
  })

  it('lets a locked riff be soloed', () => {
    expect(editsLockedRiff(s, { ...s, mixerSolo: ['t1:1'] })).toBe(false)
  })
})

describe('historyReducer and locked riffs', () => {
  function history(): HistoryState {
    return createHistoryState(placed())
  }

  it('refuses an edit to a locked riff without an undo step', () => {
    const h = history()
    expect(historyReducer(h, { type: 'REMOVE_FROM_TIMELINE', groupId: 't1' })).toBe(h)
  })

  it('refuses a whole batch when any part of it touches a locked riff', () => {
    const h = history()
    const next = historyReducer(h, {
      type: 'BATCH',
      actions: [
        { type: 'RENAME_RIFFF', groupId: 'free', name: 'renamed' },
        { type: 'DELETE_RIFFFS', groupIds: ['t1'] }
      ]
    })
    expect(next).toBe(h)
    expect(next.present.rifffs.free.name).toBe('free')
  })

  it('still applies ordinary edits', () => {
    const next = historyReducer(history(), { type: 'RENAME_RIFFF', groupId: 'free', name: 'ok' })
    expect(next.present.rifffs.free.name).toBe('ok')
    expect(next.past).toHaveLength(1)
  })
})

describe('pasting a locked riff', () => {
  it('makes an unlocked copy', () => {
    const action = pasteRifffAction(placed(), 't1', 16)
    expect(action?.type).toBe('PASTE_RIFFF')
    if (action?.type !== 'PASTE_RIFFF') return
    expect(action.rifff.locked).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run them to see them fail.**

Run: `npx vitest run src/renderer/src/state/lockedRiffs.test.ts`
Expected: FAIL, `Failed to resolve import "./lockedRiffs"`.

- [ ] **Step 4: Write the guard.** Create `src/renderer/src/state/lockedRiffs.ts`:

```ts
// src/renderer/src/state/lockedRiffs.ts -- a locked riff (Rifff.locked: bing bong's past turns)
// plays and solos, but nothing may move, resize, edit or delete it.
//
// The guard compares the state before and after an action rather than listing action types:
// dozens of actions, and every BATCH the map and auto-arrange build, can touch a riff, and a
// list would go stale the day someone adds one. history.ts refuses the whole action (a BATCH
// included) when this says it changed a locked riff, so "add new clips, then delete the old
// ones" can never half-apply.

import type { AppState } from './store'

/** Maps keyed by groupId. */
const GROUP_KEYED = ['playedBars', 'leftCrop', 'off', 'stretch', 'channelOf'] as const

/** Maps keyed by stemKey (`${groupId}:${slot}`). Temporary mixer mute and solo are deliberately
 * absent: soloing a past turn is listening, not editing. */
const STEM_KEYED = [
  'vol',
  'mute',
  'muteRegions',
  'busOf',
  'stemFilters',
  'stemSends',
  'stemAutomation'
] as const

function lockedGroupIds(state: AppState): string[] {
  return Object.values(state.rifffs)
    .filter((r) => r.locked === true)
    .map((r) => r.groupId)
}

/** True when `after` differs from `before` in anything belonging to a riff that was locked in
 * `before`: the riff itself (including being deleted), its group-keyed settings, or any of its
 * stems' settings. */
export function editsLockedRiff(before: AppState, after: AppState): boolean {
  if (before === after) return false
  for (const groupId of lockedGroupIds(before)) {
    if (after.rifffs[groupId] !== before.rifffs[groupId]) return true
    for (const field of GROUP_KEYED) {
      if (after[field][groupId] !== before[field][groupId]) return true
    }
    const prefix = `${groupId}:`
    for (const field of STEM_KEYED) {
      const a = before[field] as Record<string, unknown>
      const b = after[field] as Record<string, unknown>
      if (a === b) continue
      const keys = new Set([...Object.keys(a), ...Object.keys(b)])
      for (const key of keys) {
        if (key.startsWith(prefix) && a[key] !== b[key]) return true
      }
    }
  }
  return false
}

export const LOCKED_RIFF_NOTICE = "that's a past turn, so it's locked."
```

- [ ] **Step 5: Refuse in history.** In `src/renderer/src/state/history.ts`:

```diff
--- a/src/renderer/src/state/history.ts
+++ b/src/renderer/src/state/history.ts
@@ -1,4 +1,5 @@
 import { reducer, type Action, type AppState } from './store'
+import { editsLockedRiff } from './lockedRiffs'
 
 export type HistoryAction =
   | Action
@@ -293,6 +294,8 @@ export function historyReducer(state: HistoryState, action: HistoryAction): Hist
   if (action.type === 'BATCH') {
     const past = [...state.past, state.present].slice(-MAX_HISTORY)
     const present = action.actions.reduce((s, a) => reducer(s, a), state.present)
+    // Refused whole, so "add new clips, then delete the old ones" can't half-apply.
+    if (editsLockedRiff(state.present, present)) return state
     return { past, present, future: [] }
   }
 
@@ -311,10 +314,13 @@ export function historyReducer(state: HistoryState, action: HistoryAction): Hist
     return unchanged ? state : { past, present, future }
   }
 
+  const present = reducer(state.present, action)
+  if (editsLockedRiff(state.present, present)) return state
+
   if (TRANSIENT_ACTION_TYPES.has(action.type)) {
-    return { ...state, present: reducer(state.present, action) }
+    return { ...state, present }
   }
 
   const past = [...state.past, state.present].slice(-MAX_HISTORY)
-  return { past, present: reducer(state.present, action), future: [] }
+  return { past, present, future: [] }
 }
```

`LOAD_STATE`, `UNDO`, `REDO` and `REPAIR_REONED_PATHS` return before the new check, so they are
never refused. A refused action returns the same `HistoryState` object, so nothing re-renders.

- [ ] **Step 6: A copy is never locked.** In `src/renderer/src/state/selectors.ts`,
`pasteRifffAction`:

```diff
--- a/src/renderer/src/state/selectors.ts
+++ b/src/renderer/src/state/selectors.ts
@@ -605,6 +605,8 @@ export function pasteRifffAction(
     stems,
     startBar
   }
+  // A copy of a locked riff (a past bing bong turn) is the user's own to edit.
+  delete rifff.locked
 
   const vol: Record<string, number> = {}
   const mute: Record<string, boolean> = {}
```

- [ ] **Step 7: Run the tests.**

Run: `npx vitest run src/renderer/src/state`
Expected: PASS, every file (the new 7 tests included).

- [ ] **Step 8: Typecheck and lint.**

Run: `npm run typecheck && npx eslint src/shared/types.ts src/renderer/src/state/lockedRiffs.ts src/renderer/src/state/lockedRiffs.test.ts src/renderer/src/state/history.ts src/renderer/src/state/selectors.ts`
Expected: no output from eslint, typecheck exits 0.

- [ ] **Step 9: Commit.**

```bash
git commit --only src/shared/types.ts src/renderer/src/state/lockedRiffs.ts src/renderer/src/state/lockedRiffs.test.ts src/renderer/src/state/history.ts src/renderer/src/state/selectors.ts -m "$(cat <<'EOF'
state: locked riffs play but can't be edited

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GgVLoMfDYXWtBAGJo23dn
EOF
)"
```

### Task 2: Say why a locked edit did nothing

**Files:**
- Modify: `src/renderer/src/state/lockedRiffs.ts`
- Create: `src/renderer/src/state/lockedNotice.ts`, `src/renderer/src/components/LockedNotice.tsx`
- Modify: `src/renderer/src/state/StoreContext.tsx`, `src/renderer/src/App.tsx`

- [ ] **Step 1: Add the pre-check.** In `src/renderer/src/state/lockedRiffs.ts`:

```diff
--- a/src/renderer/src/state/lockedRiffs.ts
+++ b/src/renderer/src/state/lockedRiffs.ts
@@ -7,7 +7,8 @@
 // included) when this says it changed a locked riff, so "add new clips, then delete the old
 // ones" can never half-apply.
 
-import type { AppState } from './store'
+import type { HistoryAction } from './history'
+import { reducer, type AppState } from './store'
 
 /** Maps keyed by groupId. */
 const GROUP_KEYED = ['playedBars', 'leftCrop', 'off', 'stretch', 'channelOf'] as const
@@ -54,4 +55,15 @@ export function editsLockedRiff(before: AppState, after: AppState): boolean {
   return false
 }
 
+/** Whether history.ts will refuse `action` because it changes a locked riff, for saying why
+ * before it happens (StoreContext's dispatch). Undo, redo and loading a project never count. */
+export function actionEditsLockedRiff(state: AppState, action: HistoryAction): boolean {
+  if (action.type === 'UNDO' || action.type === 'REDO' || action.type === 'LOAD_STATE') return false
+  const after =
+    action.type === 'BATCH'
+      ? action.actions.reduce((s, a) => reducer(s, a), state)
+      : reducer(state, action)
+  return editsLockedRiff(state, after)
+}
+
 export const LOCKED_RIFF_NOTICE = "that's a past turn, so it's locked."
```

The `HistoryAction` import is type-only, so the `history.ts` ↔ `lockedRiffs.ts` cycle has no
runtime edge.

- [ ] **Step 2: The notice's state.** Create `src/renderer/src/state/lockedNotice.ts`, the same
shape as `saveCopyNotice.ts`:

```ts
// The line said when an edit to a locked riff (a past bing bong turn) is refused
// (state/lockedRiffs.ts). Session-only and short-lived, like saveCopyNotice.ts; LockedNotice.tsx
// shows it until it's clicked away or times out.
import { useSyncExternalStore } from 'react'

const SHOW_MS = 4000

let line: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function publish(next: string | null): void {
  line = next
  for (const listener of listeners) listener()
}

export function showLockedNotice(text: string): void {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => dismissLockedNotice(), SHOW_MS)
  publish(text)
}

export function dismissLockedNotice(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  if (line !== null) publish(null)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLockedNotice(): string | null {
  return useSyncExternalStore(subscribe, () => line)
}
```

- [ ] **Step 3: The notice.** Create `src/renderer/src/components/LockedNotice.tsx`, styled like
`SaveCopyNotice.tsx`:

```tsx
import { dismissLockedNotice, useLockedNotice } from '../state/lockedNotice'

/** Says why an edit did nothing: it would have changed a locked riff, a past bing bong turn
 * (state/lockedNotice.ts). Styled like SaveCopyNotice; it goes by itself after a few seconds,
 * or on a click. */
export function LockedNotice(): React.JSX.Element | null {
  const line = useLockedNotice()
  if (line === null) return null
  return (
    <button
      role="status"
      onClick={dismissLockedNotice}
      title="dismiss"
      style={{
        pointerEvents: 'auto',
        maxWidth: 420,
        padding: '5px 10px',
        fontFamily: 'inherit',
        textAlign: 'left',
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border)',
        borderRadius: 0,
        fontSize: 9,
        color: 'var(--ra-text-2)',
        cursor: 'pointer'
      }}
    >
      {line}
    </button>
  )
}
```

- [ ] **Step 4: Check before dispatching.** In `src/renderer/src/state/StoreContext.tsx`:

```diff
--- a/src/renderer/src/state/StoreContext.tsx
+++ b/src/renderer/src/state/StoreContext.tsx
@@ -50,6 +50,8 @@ import {
 import { markPluginsTouched } from './pluginsTouched'
 import { stateWithMixerMute } from './mixerMute'
 import { stopActivePreview } from '../audio/previewLoop'
+import { LOCKED_RIFF_NOTICE, actionEditsLockedRiff } from './lockedRiffs'
+import { showLockedNotice } from './lockedNotice'
 
 /** A slot's status text while its plugin failed to load: the slot keeps the plugin and its saved
  * settings (@shared/pluginSwitch's `failed`), retried after a scan. */
@@ -392,6 +394,12 @@ export function StoreProvider({ children }: { children: ReactNode }): React.JSX.
   // exactly as before. Stable across renders (rawDispatch from useReducer and
   // the setState setters are both React-guaranteed stable), so this never
   // forces the position-update subscription effect below to resubscribe.
+  // The state an edit is checked against for the locked-riff notice (lockedRiffs.ts). Its own ref,
+  // declared before dispatch, because stateRef below is written after dispatch captures it.
+  const lockedCheckRef = useRef(state)
+  useEffect(() => {
+    lockedCheckRef.current = state
+  })
   const dispatch = useCallback((action: DispatchableAction): void => {
     switch (action.type) {
       case 'PLAY':
@@ -424,6 +432,9 @@ export function StoreProvider({ children }: { children: ReactNode }): React.JSX.
         rawDispatch(action)
         return
       default:
+        // history.ts refuses it; say why instead of doing nothing silently.
+        if (actionEditsLockedRiff(lockedCheckRef.current, action))
+          showLockedNotice(LOCKED_RIFF_NOTICE)
         rawDispatch(action)
     }
   }, [])
```

Why a new ref rather than the existing `stateRef`: `stateRef` is declared after `dispatch`, and
reading it inside `dispatch`'s `useCallback` trips `react-hooks/immutability` ("This value cannot
be modified") on its `stateRef.current = state` effect. The ref is written in an effect, one
commit late at worst, which only affects whether the notice shows: `history.ts` is what refuses.

- [ ] **Step 5: Mount it.** In `src/renderer/src/App.tsx`:

```diff
--- a/src/renderer/src/App.tsx
+++ b/src/renderer/src/App.tsx
@@ -104,6 +104,7 @@ import { ReonedCopyMissingNotice } from './components/ReonedCopyMissingNotice'
 import { ReonedCopiesNotice } from './components/ReonedCopiesNotice'
 import { ReoneNotice } from './components/ReoneNotice'
 import { SaveCopyNotice } from './components/SaveCopyNotice'
+import { LockedNotice } from './components/LockedNotice'
 import { TopRightNotices } from './components/TopRightNotices'
 import { showSaveCopyNotice } from './state/saveCopyNotice'
 import { saveAsNewVersion } from './state/saveAsNewVersion'
@@ -3238,6 +3239,7 @@ function Frame(): React.JSX.Element {
         <ReonedCopiesNotice />
         <ReoneNotice />
         <SaveCopyNotice />
+        <LockedNotice />
       </TopRightNotices>
       {/* Mounted here (not inside DiscoverPanel.tsx), same top-level,
        * mount-once-per-app-session pattern as BackgroundFeatureScan just
```

- [ ] **Step 6: Run, typecheck, lint.**

Run: `npx vitest run src/renderer/src/state && npm run typecheck && npx eslint src/renderer/src/state/lockedRiffs.ts src/renderer/src/state/lockedNotice.ts src/renderer/src/components/LockedNotice.tsx src/renderer/src/state/StoreContext.tsx src/renderer/src/App.tsx`
Expected: PASS, exit 0, no eslint output.

- [ ] **Step 7: By hand (Elling).** There is no UI yet that makes a locked riff, so this waits for
plan 2's first turn. Note it in the PR.

- [ ] **Step 8: Commit.**

```bash
git commit --only src/renderer/src/state/lockedRiffs.ts src/renderer/src/state/lockedNotice.ts src/renderer/src/components/LockedNotice.tsx src/renderer/src/state/StoreContext.tsx src/renderer/src/App.tsx -m "$(cat <<'EOF'
state: a notice says why an edit to a locked riff did nothing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GgVLoMfDYXWtBAGJo23dn
EOF
)"
```

### Task 3: Cross can start with its center filled

**Files:**
- Modify: `src/shared/cross.ts`, `src/shared/cross.test.ts`

- [ ] **Step 1: Write the failing tests.** In `src/shared/cross.test.ts`, add `prefillCrossCenter`
to the import from `./cross` and append the describe block:

```diff
--- a/src/shared/cross.test.ts
+++ b/src/shared/cross.test.ts
@@ -15,6 +15,7 @@ import {
   duplicateCrossRow,
   finishCrossGainDrag,
   moveCrossRow,
+  prefillCrossCenter,
   previewCrossGain,
   replaceCrossRowSource,
   redoCross,
@@ -337,3 +338,25 @@ describe('assembleCrossRifff', () => {
     expect(assembleCrossRifff(draft(), 'group-cross')).toBeNull()
   })
 })
+
+describe('prefillCrossCenter', () => {
+  it('starts the center as a copy of one parent, Disabled stems silent', () => {
+    const d = prefillCrossCenter(draft(), 'a', { 'a:2': true })
+    expect(d.center).toEqual([
+      { id: 'a:1', sourceId: 'a:1', gain: 1, audible: true },
+      { id: 'a:2', sourceId: 'a:2', gain: 0.9, audible: false }
+    ])
+    expect(d.past).toEqual([])
+    expect(assembleCrossRifff(d, 'g')?.rifff.stems.map((s) => s.path)).toEqual([
+      '/same.wav',
+      '/a2.wav'
+    ])
+  })
+
+  it('skips sources with no stem and ignores an unknown parent', () => {
+    const base = draft()
+    base.parents[0].sources[1] = { ...base.parents[0].sources[1], stem: null }
+    expect(prefillCrossCenter(base, 'a', {}).center.map((r) => r.id)).toEqual(['a:1'])
+    expect(prefillCrossCenter(base, 'nope', {})).toBe(base)
+  })
+})
```

- [ ] **Step 2: Run to see it fail.**

Run: `npx vitest run src/shared/cross.test.ts`
Expected: FAIL, `prefillCrossCenter is not a function` (or not exported).

- [ ] **Step 3: Implement.** In `src/shared/cross.ts`, just above `addCrossDiscoveredSource`:

```diff
--- a/src/shared/cross.ts
+++ b/src/shared/cross.ts
@@ -254,6 +254,28 @@ export function createCrossDraft(
   }
 }
 
+/** A draft whose center starts as a copy of one parent: every playable source of `parentId`, at
+ * its own gain, Disabled ones (stemKey in `mute`, AppState.mute) not audible. Not an undo step:
+ * it is where the draft begins. Bing bong opens a turn this way, the center being "their riff". */
+export function prefillCrossCenter(
+  draft: CrossDraft,
+  parentId: string,
+  mute: Readonly<Record<string, boolean>>
+): CrossDraft {
+  const parent = draft.parents.find((p) => p.id === parentId)
+  if (!parent) return draft
+  const center = parent.sources
+    .filter((source) => source.stem !== null)
+    .slice(0, MAX_RIFFF_STEM_SLOTS)
+    .map((source) => ({
+      id: source.id,
+      sourceId: source.id,
+      gain: source.gain,
+      audible: mute[source.id] !== true
+    }))
+  return { ...draft, center }
+}
+
 /** Adds a resolved Discover candidate directly to the editable center. */
 export function addCrossDiscoveredSource(
   draft: CrossDraft,
```

A source occurrence's id is `` `${groupId}:${slot}` `` (`crossParentFromRifff`), which is the
same string as `stemKey`, so `mute[source.id]` reads `AppState.mute` directly.

- [ ] **Step 4: Run the tests.**

Run: `npx vitest run src/shared/cross.test.ts`
Expected: PASS (24 tests).

- [ ] **Step 5: Commit.**

```bash
git commit --only src/shared/cross.ts src/shared/cross.test.ts -m "$(cat <<'EOF'
cross: prefillCrossCenter starts the center as a copy of one parent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GgVLoMfDYXWtBAGJo23dn
EOF
)"
```

### Task 4: One custom button in Cross

**Files:**
- Modify: `src/renderer/src/components/CrossPanel.tsx`

- [ ] **Step 1: Add the prop and its commit path.**

```diff
--- a/src/renderer/src/components/CrossPanel.tsx
+++ b/src/renderer/src/components/CrossPanel.tsx
@@ -30,6 +30,7 @@ import {
   toggleCrossAudible,
   toggleCrossSoloedId,
   undoCross,
+  type CrossAssembly,
   type CrossCenterRow,
   type CrossDraft,
   type CrossParent,
@@ -611,12 +612,19 @@ function CenterRow({
   )
 }
 
+export interface CrossPrimaryAction {
+  label: string
+  /** Resolves true when the work is done and Cross should close. */
+  run: (assembly: CrossAssembly) => Promise<boolean>
+}
+
 export function CrossPanel({
   draft,
   setDraft,
   currentProjectKey,
   onSourceLeanCommit,
-  onBack
+  onBack,
+  primaryAction
 }: {
   draft: CrossDraft
   setDraft: Dispatch<SetStateAction<CrossDraft | null>>
@@ -626,6 +634,9 @@ export function CrossPanel({
    * the gesture finishes so reopening Cross does not reset the choice. */
   onSourceLeanCommit: (sourceLean: number) => void
   onBack: () => void
+  /** Replaces "add to shelf" and "add to timeline" with one button (bing bong's "done in cross").
+   * `run` gets the assembled center; Cross closes itself through onBack when it resolves true. */
+  primaryAction?: CrossPrimaryAction
 }): React.JSX.Element {
   const dispatch = useDispatch()
   const rifffs = useAppSelector((state) => state.rifffs)
@@ -636,7 +647,7 @@ export function CrossPanel({
   const [selectedTarget, setSelectedTarget] = useState<CrossTarget>(() =>
     draft.center.length > 0 ? 'center' : 'left'
   )
-  const [committing, setCommitting] = useState<'shelf' | 'timeline' | null>(null)
+  const [committing, setCommitting] = useState<'shelf' | 'timeline' | 'primary' | null>(null)
   const [committed, setCommitted] = useState<'shelf' | 'timeline' | null>(null)
   const [sideMuted, setSideMuted] = useState<Set<string>>(() => new Set())
   const [sideSoloed, setSideSoloed] = useState<Record<string, string>>(() => ({}))
@@ -970,6 +981,22 @@ export function CrossPanel({
     else if (rowId) setDraft((value) => (value ? moveCrossRow(value, rowId, index) : value))
   }
 
+  async function commitPrimary(action: CrossPrimaryAction): Promise<void> {
+    if (committingRef.current) return
+    const assembly = assembleCrossRifff(draft, undefined, activeCenterSoloedId)
+    if (!assembly) return
+    committingRef.current = true
+    setCommitting('primary')
+    let done = false
+    try {
+      done = await action.run(assembly)
+    } finally {
+      committingRef.current = false
+      setCommitting(null)
+    }
+    if (done) onBack()
+  }
+
   async function commit(destination: 'shelf' | 'timeline'): Promise<void> {
     if (committingRef.current) return
     const revision = draft.revision
@@ -1254,32 +1281,44 @@ export function CrossPanel({
         >
           clear
         </button>
-        <button
-          className="ra-cross-button ra-cross-primary"
-          onClick={() => void commit('shelf')}
-          disabled={!!committing || draft.center.length === 0}
-        >
-          {committing === 'shelf' ? (
-            <LoadingLoader size={12} />
-          ) : committed === 'shelf' ? (
-            '✓ added to shelf'
-          ) : (
-            'add to shelf'
-          )}
-        </button>
-        <button
-          className="ra-cross-button ra-cross-primary"
-          onClick={() => void commit('timeline')}
-          disabled={!!committing || draft.center.length === 0}
-        >
-          {committing === 'timeline' ? (
-            <LoadingLoader size={12} />
-          ) : committed === 'timeline' ? (
-            '✓ added to timeline'
-          ) : (
-            'add to timeline'
-          )}
-        </button>
+        {primaryAction ? (
+          <button
+            className="ra-cross-button ra-cross-primary"
+            onClick={() => void commitPrimary(primaryAction)}
+            disabled={!!committing || draft.center.length === 0}
+          >
+            {committing === 'primary' ? <LoadingLoader size={12} /> : primaryAction.label}
+          </button>
+        ) : (
+          <>
+            <button
+              className="ra-cross-button ra-cross-primary"
+              onClick={() => void commit('shelf')}
+              disabled={!!committing || draft.center.length === 0}
+            >
+              {committing === 'shelf' ? (
+                <LoadingLoader size={12} />
+              ) : committed === 'shelf' ? (
+                '✓ added to shelf'
+              ) : (
+                'add to shelf'
+              )}
+            </button>
+            <button
+              className="ra-cross-button ra-cross-primary"
+              onClick={() => void commit('timeline')}
+              disabled={!!committing || draft.center.length === 0}
+            >
+              {committing === 'timeline' ? (
+                <LoadingLoader size={12} />
+              ) : committed === 'timeline' ? (
+                '✓ added to timeline'
+              ) : (
+                'add to timeline'
+              )}
+            </button>
+          </>
+        )}
         <button
           className="ra-cross-button ra-cross-close"
           onClick={onBack}
```

Without `primaryAction`, Cross is exactly what it was. With it, the one button assembles the
center the same way (`assembleCrossRifff` with the center solo) and Cross closes through
`onBack` only when `run` resolves `true`, so a failed run leaves the draft open.

- [ ] **Step 2: Typecheck and lint.**

Run: `npm run typecheck && npx eslint src/renderer/src/components/CrossPanel.tsx`
Expected: exit 0, no eslint output.

- [ ] **Step 3: Commit.**

```bash
git commit --only src/renderer/src/components/CrossPanel.tsx -m "$(cat <<'EOF'
cross: an optional primary action replaces add to shelf and add to timeline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GgVLoMfDYXWtBAGJo23dn
EOF
)"
```

### Task 5: Open Cross with options

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Options on `openCrossFromRiffs`, and the state that carries the button.**

```diff
--- a/src/renderer/src/App.tsx
+++ b/src/renderer/src/App.tsx
@@ -39,7 +39,7 @@ import { useScrollbarInsets } from './components/useScrollbarInsets'
 import { undoRouter, undoShortcutFor } from './state/undoRouting'
 import { ChannelRow } from './components/ChannelRow'
 import { SketchStrip } from './components/SketchStrip'
-import { CrossPanel } from './components/CrossPanel'
+import { CrossPanel, type CrossPrimaryAction } from './components/CrossPanel'
 import { rifffForSketchCross } from './components/crossFromSketch'
 import { Playhead } from './components/Playhead'
 import { RiserExtentGesture } from './components/RiserExtentGesture'
@@ -148,6 +148,7 @@ import type { BusId, Rifff } from '@shared/types'
 import {
   createCrossDraft,
   crossParentFromRifff,
+  prefillCrossCenter,
   crossProjectKey,
   type CrossDraft
 } from '@shared/cross'
@@ -1940,6 +1941,9 @@ function Frame(): React.JSX.Element {
   // draft, so opening another pair never needs a discard confirmation.
   const [crossDraft, setCrossDraft] = useState<CrossDraft | null>(null)
   const [crossOpen, setCrossOpen] = useState(false)
+  // Set only while Cross was opened for something other than the inspector's "cross riffs" (bing
+  // bong's turn): its one button replaces add to shelf / add to timeline.
+  const [crossPrimary, setCrossPrimary] = useState<CrossPrimaryAction | null>(null)
   // The re-oned copies cleanup counts what Cross and Discover hold as in use (reonedInUse.ts).
   // The saved preview level, before the first preview plays (audio/previewOutput.ts).
   useEffect(() => loadSavedPreviewLevel(), [])
@@ -2461,7 +2465,10 @@ function Frame(): React.JSX.Element {
   /** Opens Cross from exactly the two riffs selected in Sketch or Shelf. Cross is a
    * peer music-making workspace to Discover, not a library/import action:
    * its parents are the two project riffs exactly as currently heard. */
-  async function openCrossFromRiffs([left, right]: [Rifff, Rifff]): Promise<void> {
+  async function openCrossFromRiffs(
+    [left, right]: [Rifff, Rifff],
+    options: { prefillFromLeft?: boolean; primaryAction?: CrossPrimaryAction } = {}
+  ): Promise<void> {
     const projectKey = crossProjectKey(currentSketch, state.projectSeed)
     const selectedIds = new Set([left.groupId, right.groupId])
     const existingIds = new Set(crossDraft?.parents.map((parent) => parent.id) ?? [])
@@ -2472,7 +2479,8 @@ function Frame(): React.JSX.Element {
 
     stopActivePreview()
     dispatch({ type: 'PAUSE' })
-    if (samePair) {
+    setCrossPrimary(options.primaryAction ?? null)
+    if (samePair && !options.prefillFromLeft) {
       setCrossOpen(true)
       return
     }
@@ -2489,13 +2497,16 @@ function Frame(): React.JSX.Element {
         window.alert('could not prepare every stem for cross. nothing was changed; try again.')
         return
       }
+      const fresh = createCrossDraft(
+        projectKey,
+        crossParentFromRifff(prepared[0], state.vol),
+        crossParentFromRifff(prepared[1], state.vol),
+        state.bpm
+      )
       setCrossDraft({
-        ...createCrossDraft(
-          projectKey,
-          crossParentFromRifff(prepared[0], state.vol),
-          crossParentFromRifff(prepared[1], state.vol),
-          state.bpm
-        ),
+        ...(options.prefillFromLeft
+          ? prefillCrossCenter(fresh, prepared[0].groupId, state.mute)
+          : fresh),
         // Cross and Discover expose the same source choice (instruments↔recorded). Seed a
         // disposable Cross draft from the persisted setting rather than
         // resetting the knob whenever a new pair is opened.
@@ -3543,7 +3554,9 @@ function Frame(): React.JSX.Element {
                 onBack={() => {
                   setCrossOpen(false)
                   setCrossDraft(null)
+                  setCrossPrimary(null)
                 }}
+                primaryAction={crossPrimary ?? undefined}
               />
             </div>
           )}
```

The inspector's "cross riffs" still calls `openCrossFromRiffs(rifffs)` with no options, which
clears `crossPrimary`, so it always gets the normal two buttons. A pre-filled open never takes
the "same pair, just reopen" shortcut: the caller asked for a fresh center.

- [ ] **Step 2: Typecheck and lint.**

Run: `npm run typecheck && npx eslint src/renderer/src/App.tsx`
Expected: exit 0, no eslint output.

- [ ] **Step 3: By hand (Elling).** Select two riffs, inspector → cross riffs: Cross opens empty
in the middle with add to shelf and add to timeline, exactly as before.

- [ ] **Step 4: Commit.**

```bash
git commit --only src/renderer/src/App.tsx -m "$(cat <<'EOF'
cross: openCrossFromRiffs can pre-fill the center and swap the button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GgVLoMfDYXWtBAGJo23dn
EOF
)"
```

### Task 6: A content id for audio files

**Files:**
- Create: `src/main/audioContentId.ts`, `src/main/audioContentId.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `src/main/audioContentId.test.ts`:

```ts
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { audioExtension, contentIdForFile, resetContentIdCacheForTests } from './audioContentId'

// sha256 of the three bytes "abc".
const ABC = 'sha256-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'content-id-test-'))
  resetContentIdCacheForTests()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('contentIdForFile', () => {
  it('is the sha256 of the bytes, whatever the file is called', async () => {
    writeFileSync(join(dir, 'one.wav'), 'abc')
    writeFileSync(join(dir, 'two.ogg'), 'abc')
    expect(await contentIdForFile(join(dir, 'one.wav'))).toBe(ABC)
    expect(await contentIdForFile(join(dir, 'two.ogg'))).toBe(ABC)
  })

  it('gives a rewritten file its new id', async () => {
    const path = join(dir, 'stem.wav')
    writeFileSync(path, 'abc')
    expect(await contentIdForFile(path)).toBe(ABC)
    writeFileSync(path, 'abcd')
    utimesSync(path, new Date(), new Date(Date.now() + 5000))
    expect(await contentIdForFile(path)).not.toBe(ABC)
  })

  it('rejects for a missing file', async () => {
    await expect(contentIdForFile(join(dir, 'nope.wav'))).rejects.toThrow()
  })
})

describe('audioExtension', () => {
  it('keeps a short lowercase extension', () => {
    expect(audioExtension('/a/b/Stem.WAV')).toBe('wav')
    expect(audioExtension('/a/b/stem.ogg')).toBe('ogg')
  })

  it('falls back to bin', () => {
    expect(audioExtension('/a/b/stem')).toBe('bin')
    expect(audioExtension('/a/b/stem.weirdext')).toBe('bin')
  })
})
```

- [ ] **Step 2: Run to see them fail.**

Run: `npx vitest run src/main/audioContentId.test.ts`
Expected: FAIL, `Failed to resolve import "./audioContentId"`.

- [ ] **Step 3: Implement.** Create `src/main/audioContentId.ts`:

```ts
// src/main/audioContentId.ts -- a content id for an audio file: `sha256-<hex>` of its bytes, the
// same for the same audio on any Mac whatever it's called. Bing bong names shared audio by it,
// so a stem that didn't change between turns is noted, never copied again (spec:
// docs/superpowers/specs/2026-10-10-bing-bong-design.md, "Audio").
//
// Hashing a stem reads the whole file, so results are cached for the session by path, size and
// mtime: an edited or replaced file gets a new id, an untouched one is never read twice.

import { createHash } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'

const cache = new Map<string, string>()

function cacheKey(path: string): string {
  const stat = statSync(path)
  return `${path}\0${stat.size}\0${stat.mtimeMs}`
}

export async function contentIdForFile(path: string): Promise<string> {
  const key = cacheKey(path)
  const cached = cache.get(key)
  if (cached) return cached
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve())
  })
  const id = `sha256-${hash.digest('hex')}`
  cache.set(key, id)
  return id
}

/** The extension a copy of `path` keeps: lowercase, no dot, `bin` when there is none. */
export function audioExtension(path: string): string {
  const ext = extname(path).slice(1).toLowerCase()
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'bin'
}

export function resetContentIdCacheForTests(): void {
  cache.clear()
}
```

It imports nothing from `electron`, so its test needs no mocks and runs in CI.

- [ ] **Step 4: Run, typecheck, lint.**

Run: `npx vitest run src/main/audioContentId.test.ts && npm run typecheck && npx eslint src/main/audioContentId.ts src/main/audioContentId.test.ts`
Expected: PASS (5 tests), exit 0, no eslint output.

- [ ] **Step 5: Commit.**

```bash
git commit --only src/main/audioContentId.ts src/main/audioContentId.test.ts -m "$(cat <<'EOF'
main: a content id (sha256) for audio files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015GgVLoMfDYXWtBAGJo23dn
EOF
)"
```

## Done when

- `npm test` and `npm run typecheck` pass (engine-spawn tests aside), `npm run lint` is clean.
- Cross from the inspector behaves exactly as before.
- Nothing in the app sets `locked` yet; plan 2's turns are the first locked riffs.

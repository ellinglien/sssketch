# DAW Mode (Channels + Independent Clips) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the arranger's fixed "one rifff = one permanent row" model with independent, shared **channels** any clip can be dragged onto, and make "unlink" an immediate, permanent **ungroup** that splits a rifff's stems into independent one-stem clips — the two pieces needed for real DAW-style multi-clip arranging (spec: `docs/superpowers/specs/2026-07-31-daw-mode-design.md`).

**Architecture:** `AppState.trackOrder: string[]` becomes `channelOrder: string[]` (row order) + `channelOf: Record<string,string>` (clip → channel). Every *existing* placement/paste action keeps its exact current shape and auto-assigns a clip its own channel (`channelOf[groupId] = groupId`) by default — zero disruption to ~70 existing test dispatches. One brand-new action, `MOVE_TO_CHANNEL`, handles the new "drag onto a specific different channel" gesture. Ungroup replaces the old `UNLINK`/`RELINK` flag pair entirely, which turns out to retire a surprising amount of code: `resolveOffsetKey`, `stemStartBar`, and `stemGeometry` all become dead once no rifff can ever have per-stem-diverged state again, and `clipGeometry` absorbs `stemGeometry`'s one genuine improvement (respecting a `playedBars` resize) as a real bug fix along the way. This also touches `buildEngineProject.ts` — the code that actually builds what's sent to the native engine for live playback AND export — since it currently reads the old unlink state directly; the native engine's own C++ side needs **zero** changes (confirmed: it only ever received a flat resolved stem list, and `startBarOverride` — the JSON field this feeds — stays in the wire format, just permanently `-1` now).

**Tech Stack:** TypeScript, React, Vitest — renderer-only, no native-engine/C++ changes anywhere in this plan.

**Verification commands used throughout:** `npm run typecheck`, `npm run lint`, `npx vitest run` (native-engine spawn/socket tests occasionally flake on the first run in this project — a single re-run always resolves it, not a regression worth chasing).

---

## Before you start

Read these two files in full — every task below references exact current line numbers from them:
- `src/renderer/src/state/store.ts`
- `src/renderer/src/state/selectors.ts`

And skim the spec: `docs/superpowers/specs/2026-07-31-daw-mode-design.md`.

---

### Task 1: Channel bookkeeping in store.ts, with zero action-shape changes

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts`

This task replaces `trackOrder` with `channelOrder`/`channelOf`, and adds the bookkeeping to the four existing actions that already touch placement (`PLACE_ON_TIMELINE`, `PASTE_RIFFF`, `REMOVE_FROM_TIMELINE`, `DELETE_RIFFFS`) — **without changing any of their action shapes**, so none of the ~70 existing `PLACE_ON_TIMELINE`/`PASTE_RIFFF` dispatches across the test suite or the app need to change. It also adds one brand-new action, `MOVE_TO_CHANNEL`, for the new "drag onto a specific different channel" gesture (wired up to the UI in Task 11).

- [ ] **Step 1: Update `AppState` and `initialState`**

In `store.ts`, replace (around line 37-46):
```ts
  /** Visual top-to-bottom row order for placed rifffs, as groupIds — a rifff
   * joins the end of this list the moment it's placed (from the shelf, or
   * pasted), and drops out again when removed. Without this, row order was
   * just Object.values(state.rifffs)'s own iteration order, i.e. whatever
   * order rifffs were originally imported into the shelf — meaning a rifff
   * placed later could render ABOVE one placed earlier, regardless of drop
   * position. Read via selectors.ts's placedRifffsInOrder, which falls back
   * to object order for any placed rifff missing from this list (keeps old
   * saves, made before this field existed, rendering exactly as before). */
  trackOrder: string[]
```
with:
```ts
  /** Visual top-to-bottom row order, as channel IDs — a fresh channel joins
   * the end of this list the moment a clip first lands on it (placed from
   * the shelf, pasted, or dragged off another channel), and drops out again
   * once nothing references it any more. Multiple clips can share one
   * channel (see channelOf below) — that's the whole point: this is what
   * makes "drag a clip onto another channel" and "two clips on the same
   * line" possible, replacing the old trackOrder, which was always
   * exactly one row per rifff, permanently. Read via selectors.ts's
   * channelsInOrder/placedRifffsInOrder, which fall back to object order
   * for any placed rifff missing a channel assignment (keeps old saves —
   * see serialize.ts's migration step — and any placed rifff that somehow
   * never got a channel, rendering sensibly instead of vanishing). */
  channelOrder: string[]
  /** Which channel a placed rifff currently renders on, keyed by groupId.
   * Set automatically to the rifff's own groupId the moment it's first
   * placed or pasted (so the common "one clip, one row" case needs no
   * explicit choice) — only ever set to something ELSE via MOVE_TO_CHANNEL,
   * dispatched when a clip is deliberately dragged onto a different
   * existing channel or off to a brand new one. Purely a rendering/
   * organizational concern — the native engine (buildEngineProject.ts)
   * never reads this field at all; playback doesn't care which row a clip
   * is drawn on. */
  channelOf: Record<string, string>
```

Replace (around line 87):
```ts
  trackOrder: [],
```
with:
```ts
  channelOrder: [],
  channelOf: {},
```

- [ ] **Step 2: Add the `MOVE_TO_CHANNEL` action and a shared `channelHasAnyClip` helper**

Add to the `Action` union (near `PLACE_ON_TIMELINE`, around line 104):
```ts
  | { type: 'PLACE_ON_TIMELINE'; groupId: string; startBar: number }
  | { type: 'MOVE_TO_CHANNEL'; groupId: string; startBar: number; channelId: string }
```

Add this module-level helper near the top of the file, just below `MIN_PLAYED_BARS` (around line 10-11) — used by `MOVE_TO_CHANNEL`, `REMOVE_FROM_TIMELINE`, and `DELETE_RIFFFS` below, all of which need to decide whether a channel a clip just left still has anything else on it:
```ts
// True if some placed clip still has channelOf pointing at channelId — used
// to decide whether a channel that just lost a clip (moved elsewhere,
// removed, or deleted) still has anything left on it, or should drop out of
// channelOrder entirely. A channel is never a persisted, independently
// "created"/"deleted" thing — it exists exactly as long as something is on
// it (see channelOrder's own doc comment).
function channelHasAnyClip(channelOf: Record<string, string>, channelId: string): boolean {
  return Object.values(channelOf).includes(channelId)
}
```

- [ ] **Step 3: Add a shared `placeOnTimeline` helper, then update `PLACE_ON_TIMELINE`'s reducer case**

`PLACE_ON_TIMELINE` and the new `MOVE_TO_CHANNEL` (next step) both need the exact same "adopt bpm on first placement, always force stretch on, select it" logic — factored out here so it can't drift between the two. Add this module-level helper right below `channelHasAnyClip` (from Step 2):
```ts
// Shared by PLACE_ON_TIMELINE and MOVE_TO_CHANNEL — everything about placing
// a clip in TIME (as opposed to which channel it lands on, which each of
// those two actions decides differently). The very first clip placed on an
// otherwise-empty timeline adopts its own bpm as the project tempo, rather
// than leaving it at the app's arbitrary default — repositioning that same
// clip, or placing a second one alongside it, doesn't retrigger this.
function placeOnTimeline(state: AppState, groupId: string, startBar: number): AppState {
  const rifff = state.rifffs[groupId]
  const isFirstPlacement =
    rifff.startBar === undefined &&
    !Object.values(state.rifffs).some((r) => r.groupId !== groupId && r.startBar !== undefined)
  return {
    ...state,
    rifffs: { ...state.rifffs, [groupId]: { ...rifff, startBar: Math.max(0, startBar) } },
    bpm: isFirstPlacement ? rifff.bpm : state.bpm,
    sel: groupId,
    stretch: { ...state.stretch, [groupId]: true }
  }
}
```

Replace the whole `case 'PLACE_ON_TIMELINE':` block (current lines 173-202) with:
```ts
    case 'PLACE_ON_TIMELINE': {
      // Auto-assigns a clip its own channel (reusing its own groupId as the
      // channel's id) the moment it's first placed — every OTHER dispatcher
      // of this action (existing tests, SketchStrip.tsx) keeps working with
      // zero changes, since this only ever ADDS a channel, never removes
      // one. Repositioning an already-placed clip leaves its channel exactly
      // as it was — moving it to a DIFFERENT channel is MOVE_TO_CHANNEL's
      // job, not this one's.
      const channelId = state.channelOf[action.groupId] ?? action.groupId
      const placed = placeOnTimeline(state, action.groupId, action.startBar)
      return {
        ...placed,
        channelOf: { ...state.channelOf, [action.groupId]: channelId },
        channelOrder: state.channelOrder.includes(channelId)
          ? state.channelOrder
          : [...state.channelOrder, channelId]
      }
    }
```

- [ ] **Step 4: Add the `MOVE_TO_CHANNEL` reducer case**

Add right after the `PLACE_ON_TIMELINE` case:
```ts
    // Dispatched when a clip is dragged onto a SPECIFIC channel — either an
    // existing one (another ChannelRow's own onDrop) or a brand new one (a
    // ghost row, with the caller minting a fresh crypto.randomUUID() before
    // dispatching), or even a first-ever placement landing directly on a
    // specific existing channel — see App.tsx's Timeline (Task 11), which
    // uses this for every drop that has a specific channel target,
    // reserving plain PLACE_ON_TIMELINE for dispatchers that don't care
    // (tests, SketchStrip.tsx). Shares placeOnTimeline's bpm/stretch/select
    // logic with PLACE_ON_TIMELINE — the only difference is this ALWAYS sets
    // channelOf explicitly, and cleans up the channel a clip just left if
    // nothing else is on it any more.
    case 'MOVE_TO_CHANNEL': {
      const previousChannelId = state.channelOf[action.groupId]
      const placed = placeOnTimeline(state, action.groupId, action.startBar)
      const channelOf = { ...state.channelOf, [action.groupId]: action.channelId }
      let channelOrder = state.channelOrder.includes(action.channelId)
        ? state.channelOrder
        : [...state.channelOrder, action.channelId]
      if (
        previousChannelId !== undefined &&
        previousChannelId !== action.channelId &&
        !channelHasAnyClip(channelOf, previousChannelId)
      ) {
        channelOrder = channelOrder.filter((id) => id !== previousChannelId)
      }
      return { ...placed, channelOf, channelOrder }
    }
```

- [ ] **Step 5: Update `PASTE_RIFFF`'s reducer case**

Replace the whole `case 'PASTE_RIFFF':` block (current lines 432-442) with:
```ts
    case 'PASTE_RIFFF':
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.rifff.groupId]: action.rifff },
        vol: { ...state.vol, ...action.vol },
        mute: { ...state.mute, ...action.mute },
        off: { ...state.off, ...action.off },
        stretch: { ...state.stretch, [action.rifff.groupId]: action.stretch },
        sel: action.rifff.groupId,
        // Every pasted/duplicated clip is a fresh groupId that's never had a
        // channel before, so this always ADDS a new one-clip channel — same
        // "own groupId as channel id" default as a first-time PLACE_ON_TIMELINE.
        channelOf: { ...state.channelOf, [action.rifff.groupId]: action.rifff.groupId },
        channelOrder: [...state.channelOrder, action.rifff.groupId]
      }
```

- [ ] **Step 6: Update `REMOVE_FROM_TIMELINE`'s reducer case**

Replace the whole `case 'REMOVE_FROM_TIMELINE':` block (current lines 322-332) with:
```ts
    case 'REMOVE_FROM_TIMELINE': {
      const rifff = state.rifffs[action.groupId]
      const previousChannelId = state.channelOf[action.groupId]
      const channelOf = { ...state.channelOf }
      delete channelOf[action.groupId]
      const channelOrder =
        previousChannelId !== undefined && !channelHasAnyClip(channelOf, previousChannelId)
          ? state.channelOrder.filter((id) => id !== previousChannelId)
          : state.channelOrder
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.groupId]: { ...rifff, startBar: undefined } },
        sel: state.sel === action.groupId ? null : state.sel,
        channelOf,
        channelOrder
      }
    }
```

- [ ] **Step 7: Update `DELETE_RIFFFS`'s reducer case**

Replace the whole `case 'DELETE_RIFFFS':` block (current lines 342-381) with:
```ts
    case 'DELETE_RIFFFS': {
      const ids = new Set(action.groupIds)
      const rifffs = { ...state.rifffs }
      const stemKeysToStrip = new Set<string>()
      for (const groupId of ids) {
        const rifff = rifffs[groupId]
        if (!rifff) continue
        for (const stem of rifff.stems) stemKeysToStrip.add(stemKey(groupId, stem.slot))
        delete rifffs[groupId]
      }
      const omitGroups = <T>(rec: Record<string, T>): Record<string, T> => {
        const next = { ...rec }
        for (const groupId of ids) delete next[groupId]
        return next
      }
      const omitStems = <T>(rec: Record<string, T>): Record<string, T> => {
        const next = { ...rec }
        for (const key of stemKeysToStrip) delete next[key]
        return next
      }
      const channelOf = omitGroups(state.channelOf)
      const channelOrder = state.channelOrder.filter((id) => channelHasAnyClip(channelOf, id))
      return {
        ...state,
        rifffs,
        vol: omitStems(state.vol),
        mute: omitStems(state.mute),
        off: omitGroups(state.off),
        playedBars: omitGroups(state.playedBars),
        stretch: omitGroups(state.stretch),
        fadeIn: omitGroups(state.fadeIn),
        fadeOut: omitGroups(state.fadeOut),
        exp: omitGroups(state.exp),
        channelOf,
        channelOrder,
        sel: state.sel && ids.has(state.sel) ? null : state.sel
      }
    }
```
Note: `off`/`playedBars` used to be scrubbed with BOTH `omitGroups` and `omitStems` (`off: omitGroups(omitStems(state.off))`), because a stem-keyed entry could exist for an unlinked stem. Task 2 removes that whole per-stem-divergence mechanism, so `off`/`playedBars` are now always keyed by bare groupId only — `omitStems` alone is no longer correct for them (it wouldn't strip anything, since these are never stem-keyed any more). Making this change now, in this task, would leave the code briefly inconsistent with `SET_PLAYED_BARS`/`off`'s still-dual-keyed reality until Task 2 lands — that's fine, this task's own tests below only exercise plain groupId keys, so `omitGroups` alone is already correct for what Task 1 tests.

- [ ] **Step 8: Update `store.test.ts`'s `trackOrder` describe block**

Replace the whole `describe('trackOrder', ...)` block (current lines 98-137) with:
```ts
  describe('channels', () => {
    it('a placed rifff gets its own channel, added to the end of channelOrder', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      // r2 was added to the shelf second, but placed on the timeline first —
      // channelOrder should reflect placement order, not shelf-add order.
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
      expect(state.channelOrder).toEqual(['r2', 'r1'])
      expect(state.channelOf).toEqual({ r2: 'r2', r1: 'r1' })
    })

    it('repositioning an already-placed clip (same PLACE_ON_TIMELINE action) leaves its channel untouched', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 8 }) // dragged
      expect(state.channelOrder).toEqual(['r1', 'r2'])
      expect(state.channelOf).toEqual({ r1: 'r1', r2: 'r2' })
    })

    it('removing from the timeline drops its now-empty channel; re-placing gets a fresh one at the bottom', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
      state = reducer(state, { type: 'REMOVE_FROM_TIMELINE', groupId: 'r1' })
      expect(state.channelOrder).toEqual(['r2'])
      expect(state.channelOf.r1).toBeUndefined()
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      expect(state.channelOrder).toEqual(['r2', 'r1'])
    })

    it('MOVE_TO_CHANNEL reassigns to an existing channel and drops the old one once it is empty', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r1',
        startBar: 6,
        channelId: 'r2'
      })
      expect(state.channelOf).toEqual({ r1: 'r2', r2: 'r2' })
      expect(state.channelOrder).toEqual(['r2']) // r1's own now-empty channel is gone
      expect(state.rifffs.r1.startBar).toBe(6)
      expect(state.sel).toBe('r1')
    })

    it('MOVE_TO_CHANNEL onto a brand new channel id creates it', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r1' }) })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r1',
        startBar: 0,
        channelId: 'fresh-channel'
      })
      expect(state.channelOf.r1).toBe('fresh-channel')
      expect(state.channelOrder).toEqual(['fresh-channel']) // r1's own default channel is gone, replaced
    })

    it('MOVE_TO_CHANNEL on a first-ever placement still adopts the clip’s own bpm as project tempo', () => {
      // Regression test: an earlier version of MOVE_TO_CHANNEL didn't share
      // PLACE_ON_TIMELINE's placeOnTimeline() logic and silently dropped
      // this — since Task 11 routes every Timeline drop (including
      // first-ever shelf placements) through MOVE_TO_CHANNEL when a specific
      // channel target is known, this must work here too, not just via
      // PLACE_ON_TIMELINE.
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1', bpm: 150 })
      })
      expect(state.bpm).toBe(80) // untouched default
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r1',
        startBar: 0,
        channelId: 'r1'
      })
      expect(state.bpm).toBe(150)
    })

    it('two clips can share one channel (MOVE_TO_CHANNEL onto an occupied one)', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r1' }) })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r2',
        startBar: 8,
        channelId: 'r1'
      })
      expect(state.channelOf).toEqual({ r1: 'r1', r2: 'r1' })
      expect(state.channelOrder).toEqual(['r1'])
    })
  })
```

- [ ] **Step 9: Update the `DELETE_RIFFFS` test that asserts on `off`/`playedBars` scrubbing**

Replace (current lines 219-229):
```ts
    it('scrubs both linked (group-keyed) and unlinked (stem-keyed) off/playedBars entries', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 2 })
      state = reducer(state, { type: 'UNLINK', groupId: 'r1' }) // leaves the group-level off[] entry in place, unused
      state = reducer(state, { type: 'SET_PLAYED_BARS', key: 'r1:1', bars: 2 })
      state = reducer(state, { type: 'DELETE_RIFFFS', groupIds: ['r1'] })
      expect(state.off.r1).toBeUndefined()
      expect(state.off['r1:1']).toBeUndefined()
      expect(state.playedBars['r1:1']).toBeUndefined()
    })
```
with:
```ts
    it('scrubs off/playedBars entries for the deleted rifff', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 2 })
      state = reducer(state, { type: 'SET_PLAYED_BARS', key: 'r1', bars: 2 })
      state = reducer(state, { type: 'DELETE_RIFFFS', groupIds: ['r1'] })
      expect(state.off.r1).toBeUndefined()
      expect(state.playedBars.r1).toBeUndefined()
    })

    it('drops a deleted rifff’s channel from channelOrder if nothing else is on it', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'DELETE_RIFFFS', groupIds: ['r1'] })
      expect(state.channelOrder).toEqual([])
      expect(state.channelOf.r1).toBeUndefined()
    })
```

- [ ] **Step 10: Update `SEQUENCE_RIFFFS`'s trackOrder assertion (mechanical rename only — the full channel-aware rewrite is Task 3)**

For now, just make this one assertion compile: replace (current line 419)
```ts
      expect(state.trackOrder).toEqual(['r2', 'r1'])
```
with
```ts
      expect(state.channelOrder).toEqual(['r2', 'r1'])
```
This will pass once Task 3 updates `SEQUENCE_RIFFFS` itself — leave a `// TODO` is NOT needed, since Task 3 comes right after this one in the same session and rewrites this reducer case properly; this step just keeps the test file compiling in the meantime if you're running tests after every task.

- [ ] **Step 11: Run the tests**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: still has known failures from `SEQUENCE_RIFFFS` (fixed in Task 3) and from `UNLINK`/`RELINK`/`SET_STEM_START` references (fixed in Task 2) — everything else, including every new/updated test from this task, should pass. Confirm specifically that the new `channels` describe block passes.

- [ ] **Step 12: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "Add channel bookkeeping (channelOrder/channelOf) alongside trackOrder's removal"
```

---

### Task 2: Remove UNLINK/RELINK/SET_STEM_START; add UNGROUP

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts`

`UNLINK`/`RELINK` let a rifff's stems drift to independent positions while staying inside the same row. The design replaces this entirely with a one-way **Ungroup**: split every stem into its own independent one-stem rifff immediately. This task removes the old mechanism and its state fields (`unlinked`, `stemStart`) and the now-pointless `SET_STEM_START` action, and adds `UNGROUP`.

- [ ] **Step 1: Remove `unlinked`/`stemStart` from `AppState` and `initialState`**

Remove these two fields and their doc comments from `AppState` (current lines 21-25):
```ts
  unlinked: Record<string, boolean>
  /** Independent position for an unlinked stem, keyed by stemKey. Only consulted
   * while that stem's group is unlinked — a linked stem always follows its
   * group's own startBar, same as before unlinking existed. */
  stemStart: Record<string, number>
```
And their initial values (current lines 81-82):
```ts
  unlinked: {},
  stemStart: {},
```

- [ ] **Step 2: Replace `UNLINK`/`RELINK`/`SET_STEM_START` in the `Action` union with `UNGROUP`**

Remove (current lines 114, 138-139):
```ts
  | { type: 'SET_STEM_START'; key: string; startBar: number }
```
```ts
  | { type: 'UNLINK'; groupId: string }
  | { type: 'RELINK'; groupId: string }
```
Add:
```ts
  | { type: 'UNGROUP'; groupId: string }
```

- [ ] **Step 3: Remove the `SET_STEM_START` reducer case**

Delete (current lines 265-269):
```ts
    case 'SET_STEM_START':
      return {
        ...state,
        stemStart: { ...state.stemStart, [action.key]: Math.max(0, action.startBar) }
      }
```

- [ ] **Step 4: Simplify `RESIZE_LEFT`'s reducer case**

`RESIZE_LEFT` used to branch on `state.unlinked[action.groupId]` to decide whether to resize just one stem (unlinked) or the whole rifff (linked). That branch is now always "the whole rifff" — a still-multi-stem rifff can never have per-stem divergence any more, and `action.slot` becomes unused. Replace the whole `case 'RESIZE_LEFT':` block (current lines 283-310) with:
```ts
    // Dragging the LEFT resize handle: playedBars and the rifff's own start
    // move together in one atomic edit (one undo step, not two) so the
    // clip's right edge — where the loop currently ends — stays exactly in
    // place while the loop extends backward.
    case 'RESIZE_LEFT': {
      const rifff = state.rifffs[action.groupId]
      return {
        ...state,
        playedBars: {
          ...state.playedBars,
          [action.groupId]: Math.max(MIN_PLAYED_BARS, action.bars)
        },
        rifffs: {
          ...state.rifffs,
          [action.groupId]: { ...rifff, startBar: Math.max(0, action.startBar) }
        }
      }
    }
```
Update the `RESIZE_LEFT` action's own type (current line 116) — drop the now-unused `slot`:
```ts
  | { type: 'RESIZE_LEFT'; groupId: string; bars: number; startBar: number }
```
(Task 6 updates `StemWaveformRow.tsx`/`CollapsedRifffRow.tsx`'s dispatch call sites to drop the `slot` argument they currently pass.)

- [ ] **Step 5: Replace `UNLINK`/`RELINK` with the `UNGROUP` reducer case**

Replace the whole `case 'UNLINK':` and `case 'RELINK':` blocks (current lines 514-556) with:
```ts
    // Splits every stem in a linked, multi-stem rifff into its own
    // independent one-stem rifff, immediately and permanently — matching the
    // user's own "grouping/ungrouping" framing. There's deliberately no
    // reverse action (RELINK doesn't exist any more): once split, each stem
    // is an ordinary placed rifff like any other, with nothing left
    // connecting it back to its old siblings except that they all land on
    // the same channel, at the same startBar, as the parent did — stacked
    // exactly on top of each other (channels already allow overlap; see
    // channelHasAnyClip's own doc comment), so dragging them apart is the
    // very next, obvious thing to do.
    case 'UNGROUP': {
      const rifff = state.rifffs[action.groupId]
      const channelId = state.channelOf[action.groupId]
      const groupOff = state.off[action.groupId] ?? 0
      const groupPlayedBars = state.playedBars[action.groupId] ?? rifff.barLength
      const groupFadeIn = state.fadeIn[action.groupId] ?? 0
      const groupFadeOut = state.fadeOut[action.groupId] ?? 0
      const groupStretch = state.stretch[action.groupId] ?? true

      const rifffs = { ...state.rifffs }
      delete rifffs[action.groupId]
      const vol = { ...state.vol }
      const mute = { ...state.mute }
      const off = { ...state.off }
      const playedBars = { ...state.playedBars }
      const fadeIn = { ...state.fadeIn }
      const fadeOut = { ...state.fadeOut }
      const stretch = { ...state.stretch }
      const channelOf = { ...state.channelOf }
      // The parent's own group-level entries are gone once it's deleted below
      // — nothing left to reference them.
      delete off[action.groupId]
      delete playedBars[action.groupId]
      delete fadeIn[action.groupId]
      delete fadeOut[action.groupId]
      delete stretch[action.groupId]
      delete channelOf[action.groupId]

      const newGroupIds: string[] = []
      for (const stem of rifff.stems) {
        const newGroupId = crypto.randomUUID()
        newGroupIds.push(newGroupId)
        rifffs[newGroupId] = {
          groupId: newGroupId,
          name: stem.name,
          bpm: rifff.bpm,
          // The group's own CURRENT resolved length (reflecting any active
          // resize), not stem.barLength — matches pasteStemAction's own
          // "duplicate it, or a trimmed portion of it" convention.
          barLength: groupPlayedBars,
          folderPath: rifff.folderPath,
          startBar: rifff.startBar,
          stems: [{ ...stem }]
        }
        const oldKey = stemKey(action.groupId, stem.slot)
        const newKey = stemKey(newGroupId, stem.slot)
        if (state.vol[oldKey] !== undefined) vol[newKey] = state.vol[oldKey]
        if (state.mute[oldKey] !== undefined) mute[newKey] = state.mute[oldKey]
        delete vol[oldKey]
        delete mute[oldKey]
        off[newGroupId] = groupOff
        fadeIn[newGroupId] = groupFadeIn
        fadeOut[newGroupId] = groupFadeOut
        stretch[newGroupId] = groupStretch
        channelOf[newGroupId] = channelId
      }

      return {
        ...state,
        rifffs,
        vol,
        mute,
        off,
        playedBars,
        fadeIn,
        fadeOut,
        stretch,
        channelOf,
        sel: newGroupIds[0] ?? null
      }
    }
```
Note `channelOrder` is untouched — the parent's own channel keeps at least the new clips on it, so it's never removed.

- [ ] **Step 6: Delete the old UNLINK/RELINK/SET_STEM_START tests, replace with UNGROUP tests**

Delete these blocks entirely from `store.test.ts` (current lines 447-497 — 5 `it()`s: `'unlink copies the group offset onto each stem key and flags unlinked'`, `'unlink seeds each stem's independent start at the group's current position'`, `'unlink copies a group-level resize (playedBars) onto each stem key...'`, `'unlink does not invent a playedBars override for a stem that was never resized'`, `'relink clears the unlinked flag'`, and `'sets an independent stem start, clamped to 0'`).

Also delete the `'while unlinked, sets playedBars and stemStart on the stem's own keys...'` test inside the `RESIZE_LEFT` describe block (current lines 526-540), and rename the remaining `'while linked, sets playedBars on the group key and moves the rifff's own startBar'` test (current lines 512-524) to drop the now-meaningless "while linked" qualifier — it's the only behavior `RESIZE_LEFT` has now:
```ts
  describe('RESIZE_LEFT', () => {
    it('sets playedBars on the group key and moves the rifff’s own startBar', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, { type: 'RESIZE_LEFT', groupId: 'r1', bars: 10, startBar: 4 })
      expect(state.playedBars.r1).toBe(10)
      expect(state.rifffs.r1.startBar).toBe(4)
    })

    it('clamps playedBars to a minimum of 0.25 and startBar to a minimum of 0', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, { type: 'RESIZE_LEFT', groupId: 'r1', bars: -3, startBar: -2 })
      expect(state.playedBars.r1).toBe(0.25)
      expect(state.rifffs.r1.startBar).toBe(0)
    })
  })
```
(This second test's assertions are unchanged from the original file — only its `RESIZE_LEFT` dispatch drops the now-removed `slot: 1` field, same as the first test above.)

Add a new `describe('UNGROUP', ...)` block, right after the `RESIZE_LEFT` describe block:
```ts
  describe('UNGROUP', () => {
    it('splits every stem into its own independent, selected one-stem rifff', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, { type: 'UNGROUP', groupId: 'r1' })

      expect(state.rifffs.r1).toBeUndefined()
      const newRifffs = Object.values(state.rifffs)
      expect(newRifffs).toHaveLength(2) // makeRifff() has 2 stems
      expect(newRifffs.every((r) => r.stems.length === 1)).toBe(true)
      expect(newRifffs.every((r) => r.startBar === 6)).toBe(true)
      expect(state.sel).toBe(newRifffs[0].groupId)
    })

    it('lands every new clip on the SAME channel the parent was on', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      const parentChannel = state.channelOf.r1
      state = reducer(state, { type: 'UNGROUP', groupId: 'r1' })
      const newGroupIds = Object.keys(state.rifffs)
      expect(newGroupIds).toHaveLength(2)
      for (const groupId of newGroupIds) {
        expect(state.channelOf[groupId]).toBe(parentChannel)
      }
      expect(state.channelOrder).toContain(parentChannel)
    })

    it('carries over each stem’s own volume and mute, keyed to its new groupId', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'SET_VOLUME', stemKey: 'r1:1', volume: 0.4 })
      state = reducer(state, { type: 'TOGGLE_MUTE', stemKey: 'r1:6' })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'UNGROUP', groupId: 'r1' })

      const slot1Rifff = Object.values(state.rifffs).find((r) => r.stems[0].slot === 1)!
      const slot6Rifff = Object.values(state.rifffs).find((r) => r.stems[0].slot === 6)!
      expect(state.vol[`${slot1Rifff.groupId}:1`]).toBe(0.4)
      expect(state.mute[`${slot6Rifff.groupId}:6`]).toBe(true)
      expect(state.vol['r1:1']).toBeUndefined() // old keys scrubbed
      expect(state.mute['r1:6']).toBeUndefined()
    })

    it('copies group-level fade/stretch identically to every new clip', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'SET_FADE_IN', groupId: 'r1', bars: 2 })
      state = reducer(state, { type: 'SET_FADE_OUT', groupId: 'r1', bars: 1 })
      state = reducer(state, { type: 'UNGROUP', groupId: 'r1' })

      for (const groupId of Object.keys(state.rifffs)) {
        expect(state.fadeIn[groupId]).toBe(2)
        expect(state.fadeOut[groupId]).toBe(1)
        expect(state.stretch[groupId]).toBe(true)
      }
    })

    it('uses the group’s current resolved playedBars as each new clip’s own barLength', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() }) // barLength 8
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'SET_PLAYED_BARS', key: 'r1', bars: 3 })
      state = reducer(state, { type: 'UNGROUP', groupId: 'r1' })
      for (const rifff of Object.values(state.rifffs)) {
        expect(rifff.barLength).toBe(3)
      }
    })

    it('deletes the parent rifff’s own now-orphaned per-group state', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'SET_FADE_IN', groupId: 'r1', bars: 2 })
      state = reducer(state, { type: 'UNGROUP', groupId: 'r1' })
      expect(state.fadeIn.r1).toBeUndefined()
      expect(state.off.r1).toBeUndefined()
      expect(state.stretch.r1).toBeUndefined()
      expect(state.channelOf.r1).toBeUndefined()
    })
  })
```

- [ ] **Step 7: Fix a stale comment reference in `dragGrabOffset.ts`**

This file doesn't import or call anything removed in this task, but its own comment names `SET_STEM_START` as an example — replace (current line 18, inside `applyGrabOffset`'s doc comment):
```ts
// SET_STEM_START clamps its own startBar — a clip can't start before the
```
with:
```ts
// PLACE_ON_TIMELINE/MOVE_TO_CHANNEL clamp their own startBar the same way —
```
(the rest of that comment line and the next, "timeline's own beginning.", stay as they are — the underlying point is unchanged, just the example action's name.)

- [ ] **Step 9: Run the tests**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: `UNGROUP`, `RESIZE_LEFT`, and `channels` describe blocks pass. Remaining failures should only be from `SEQUENCE_RIFFFS`'s `trackOrder`-shaped assertion (Task 3) and anywhere else in the repo still compiling against removed types (fixed in later tasks — this file alone should typecheck and its own tests should be green; `npm run typecheck` for the WHOLE project will still fail until Tasks 3-9 land, since `selectors.ts`, `App.tsx`, etc. all still reference removed fields/functions).

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "Replace UNLINK/RELINK/SET_STEM_START with a one-way UNGROUP action"
```

---

### Task 3: SEQUENCE_RIFFFS channel rewrite

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Update `SEQUENCE_RIFFFS`'s reducer case**

Replace (current lines 214-238), the line `return { ...state, rifffs, stretch, trackOrder: action.groupIds }`, with a version that builds one channel per clip, in sequence order (sketch-eligible arrangements are always 1:1 clip:channel already — see `isSketchEligible`):
```ts
    case 'SEQUENCE_RIFFFS': {
      const rifffs = { ...state.rifffs }
      const stretch = { ...state.stretch }
      const channelOf = { ...state.channelOf }
      let cursor = 0
      for (const groupId of action.groupIds) {
        const rifff = rifffs[groupId]
        rifffs[groupId] = { ...rifff, startBar: cursor }
        cursor += state.playedBars[groupId] ?? rifff.barLength
        stretch[groupId] = true
        channelOf[groupId] = groupId
      }
      return { ...state, rifffs, stretch, channelOf, channelOrder: action.groupIds }
    }
```
(Body/comments otherwise unchanged from the original — only the final `return` line and the new `channelOf` bookkeeping are new.)

- [ ] **Step 2: Update the `'replaces trackOrder with the new sequence order'` test**

Rename and update (current lines 412-420):
```ts
    it('replaces channelOrder with the new sequence order, one channel per clip', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'SEQUENCE_RIFFFS', groupIds: ['r2', 'r1'] })
      expect(state.channelOrder).toEqual(['r2', 'r1'])
      expect(state.channelOf).toEqual({ r2: 'r2', r1: 'r1' })
    })
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: all tests in this file pass now.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "SEQUENCE_RIFFFS writes channelOrder/channelOf instead of trackOrder"
```

---

### Task 4: Simplify selectors.ts — retire resolveOffsetKey/stemStartBar/stemGeometry

**Files:**
- Modify: `src/renderer/src/state/selectors.ts`
- Test: `src/renderer/src/state/selectors.test.ts`

With per-stem divergence gone (Task 2), `resolveOffsetKey` always returns the bare `groupId`, making `stemStartBar` and `stemGeometry` (its only real difference from `clipGeometry` — respecting a `playedBars` resize) collapse into `clipGeometry` itself. This task deletes the three dead functions, simplifies `resolvePlayedBars` (drops its now-unused `slot` parameter), and folds `stemGeometry`'s one genuine improvement into `clipGeometry` as a real bug fix (documented already: "`clipGeometry` predates the resize feature and always uses `rifff.barLength`, silently ignoring one").

- [ ] **Step 1: Delete `resolveOffsetKey`**

Delete (current lines 4-6):
```ts
export function resolveOffsetKey(state: AppState, groupId: string, slot: number): string {
  return state.unlinked[groupId] ? stemKey(groupId, slot) : groupId
}
```

- [ ] **Step 2: Simplify `resolvePlayedBars`**

Replace (current lines 72-82):
```ts
/** A stem's own played length, in bars — the tiling loop's bound for this
 * specific stem. Falls back to rifff.barLength (today's implicit behavior)
 * when no override has been set. Same linked/unlinked resolution as `off`
 * (shared per-group while linked, independent per-stem once unlinked) —
 * unlike `vol`/`mute`, which are always keyed per-stem regardless of link
 * state. */
export function resolvePlayedBars(state: AppState, groupId: string, slot: number): number {
  const rifff = state.rifffs[groupId]
  const key = resolveOffsetKey(state, groupId, slot)
  return state.playedBars[key] ?? rifff.barLength
}
```
with:
```ts
/** A clip's own played length, in bars — the tiling loop's bound. Falls
 * back to rifff.barLength (today's implicit behavior) when no resize
 * override has been set. */
export function resolvePlayedBars(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  return state.playedBars[groupId] ?? rifff.barLength
}
```

- [ ] **Step 3: Delete `stemStartBar` and `stemGeometry`; fold the resize-respecting behavior into `clipGeometry`**

Delete (current lines 199-231):
```ts
/** A stem's own position — independent of its group's once unlinked and dragged,
 * falling back to the group's startBar otherwise (before any drag, or while still
 * linked). */
export function stemStartBar(state: AppState, groupId: string, slot: number): number {
  ...
}

/** Same shape as clipGeometry, anchored to the stem's own position instead of its
 * group's ... */
export function stemGeometry(
  state: AppState,
  groupId: string,
  slot: number,
  ppb: number
): ClipGeometry {
  ...
}
```

Replace `clipGeometry` itself (current lines 188-197):
```ts
export function clipGeometry(state: AppState, groupId: string, ppb: number): ClipGeometry {
  const rifff = state.rifffs[groupId]
  const start = rifff.startBar ?? 0
  const offsetSteps = state.off[groupId] ?? 0
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const offsetPx = (offsetSteps * ppb) / snapDiv
  const stretchOn = state.stretch[groupId] ?? true
  const shownBars = stretchOn ? rifff.barLength : rifff.barLength * (rifff.bpm / state.bpm)
  return { leftPx: start * ppb + offsetPx, widthPx: shownBars * ppb }
}
```
with:
```ts
/** A clip's screen position/width. Uses resolvePlayedBars (which reflects
 * an active playedBars resize override) rather than raw rifff.barLength, so
 * a resized clip's rendered width actually matches its resize — this used
 * to only use rifff.barLength unconditionally, a real bug that stemGeometry
 * (now folded in here, since per-stem geometry divergence no longer exists
 * — see UNGROUP) used to work around for the expanded per-stem view only. */
export function clipGeometry(state: AppState, groupId: string, ppb: number): ClipGeometry {
  const rifff = state.rifffs[groupId]
  const start = rifff.startBar ?? 0
  const offsetSteps = state.off[groupId] ?? 0
  const snapDiv = SNAP_DIVS[state.snapIdx]
  const offsetPx = (offsetSteps * ppb) / snapDiv
  const playedBars = resolvePlayedBars(state, groupId)
  const stretchOn = state.stretch[groupId] ?? true
  const shownBars = stretchOn ? playedBars : playedBars * (rifff.bpm / state.bpm)
  return { leftPx: start * ppb + offsetPx, widthPx: shownBars * ppb }
}
```
No reordering needed — `resolvePlayedBars` is already defined earlier in the file than `clipGeometry`, so `clipGeometry` calling it is already valid in the current file order.

- [ ] **Step 4: Update `loopLengthBars`**

The `state.unlinked[rifff.groupId]` branch it used to need no longer applies (an "unlinked stem" scenario can't exist). Replace the whole function (current lines 233-260) with:
```ts
const DEFAULT_LOOP_BARS = 32

/** Loop length auto-fits to whichever placed clip ends latest, falling back to a
 * sensible default when the timeline is empty rather than collapsing to 0. */
export function loopLengthBars(state: AppState): number {
  const ends: number[] = []
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    const playedBars = resolvePlayedBars(state, rifff.groupId)
    ends.push(rifff.startBar + playedBars)
  }
  return ends.length === 0 ? DEFAULT_LOOP_BARS : Math.max(...ends)
}
```

- [ ] **Step 5: Update `isSketchEligible`**

Remove the now-meaningless `unlinked` check. Replace (current lines 141-156)'s body — specifically delete this line from the loop:
```ts
    if (state.unlinked[rifff.groupId]) return false
```
leaving:
```ts
export function isSketchEligible(state: AppState): boolean {
  const placed = placedRifffsInOrder(state)
  for (const rifff of placed) {
    if (state.fadeIn[rifff.groupId]) return false
    if (state.fadeOut[rifff.groupId]) return false
    if ((state.off[rifff.groupId] ?? 0) !== 0) return false
  }
  const sorted = [...placed].sort((a, b) => (a.startBar ?? 0) - (b.startBar ?? 0))
  let expectedStart = 0
  for (const rifff of sorted) {
    if (rifff.startBar !== expectedStart) return false
    expectedStart += state.playedBars[rifff.groupId] ?? rifff.barLength
  }
  return true
}
```
Also update its doc comment (just above) to drop the "not unlinked" bullet from its list of checks.

- [ ] **Step 6: Update `pasteRifffAction` and `pasteStemAction`**

`pasteRifffAction` doesn't reference the removed functions — leave it as-is. `pasteStemAction` does. Replace (current lines 356-393):
```ts
export function pasteStemAction(
  state: AppState,
  sourceGroupId: string,
  slot: number,
  startBar: number
): Action | null {
  const source = state.rifffs[sourceGroupId]
  if (!source) return null
  const stem = source.stems.find((s) => s.slot === slot)
  if (!stem) return null

  const newGroupId = crypto.randomUUID()
  const rifff: Rifff = {
    groupId: newGroupId,
    name: stem.name,
    bpm: source.bpm,
    barLength: resolvePlayedBars(state, sourceGroupId, slot),
    folderPath: source.folderPath,
    startBar,
    stems: [{ ...stem }]
  }

  const oldKey = stemKey(sourceGroupId, slot)
  const newKey = stemKey(newGroupId, slot)
  const vol: Record<string, number> = {}
  const mute: Record<string, boolean> = {}
  if (state.vol[oldKey] !== undefined) vol[newKey] = state.vol[oldKey]
  if (state.mute[oldKey] !== undefined) mute[newKey] = state.mute[oldKey]

  return {
    type: 'PASTE_RIFFF',
    rifff,
    vol,
    mute,
    off: { [newGroupId]: state.off[resolveOffsetKey(state, sourceGroupId, slot)] ?? 0 },
    stretch: state.stretch[sourceGroupId] ?? true
  }
}
```
with (only the `barLength`/`off` lines actually change):
```ts
export function pasteStemAction(
  state: AppState,
  sourceGroupId: string,
  slot: number,
  startBar: number
): Action | null {
  const source = state.rifffs[sourceGroupId]
  if (!source) return null
  const stem = source.stems.find((s) => s.slot === slot)
  if (!stem) return null

  const newGroupId = crypto.randomUUID()
  const rifff: Rifff = {
    groupId: newGroupId,
    name: stem.name,
    bpm: source.bpm,
    barLength: resolvePlayedBars(state, sourceGroupId),
    folderPath: source.folderPath,
    startBar,
    stems: [{ ...stem }]
  }

  const oldKey = stemKey(sourceGroupId, slot)
  const newKey = stemKey(newGroupId, slot)
  const vol: Record<string, number> = {}
  const mute: Record<string, boolean> = {}
  if (state.vol[oldKey] !== undefined) vol[newKey] = state.vol[oldKey]
  if (state.mute[oldKey] !== undefined) mute[newKey] = state.mute[oldKey]

  return {
    type: 'PASTE_RIFFF',
    rifff,
    vol,
    mute,
    off: { [newGroupId]: state.off[sourceGroupId] ?? 0 },
    stretch: state.stretch[sourceGroupId] ?? true
  }
}
```

- [ ] **Step 7: Update `selectors.test.ts` — remove dead-function tests**

Delete the whole `describe('resolveOffsetKey', ...)` block (current lines 35-45).

Delete the whole `describe('stemStartBar / stemGeometry', ...)` block (current lines 167-208) and the whole `describe('stemGeometry width with a playedBars override', ...)` block (current lines 210-219).

Update `describe('resolvePlayedBars', ...)` (current lines 109-130) — drop the `slot` argument from both remaining calls, delete the "uses the per-stem value while unlinked" test:
```ts
describe('resolvePlayedBars', () => {
  it('falls back to rifff.barLength when unset', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    expect(resolvePlayedBars(state, 'r1')).toBe(8)
  })

  it('uses the resize override once one is set', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    const withOverride = { ...state, playedBars: { r1: 16 } }
    expect(resolvePlayedBars(withOverride, 'r1')).toBe(16)
  })
})
```

Add a new test to `describe('clipGeometry', ...)` (current lines 139-165) confirming the bug fix — clipGeometry now respects a playedBars resize:
```ts
  it('reflects a playedBars resize override, not just raw rifff.barLength', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    const withOverride = { ...state, playedBars: { r1: 16 } } // rifff.barLength is 8
    const geo = clipGeometry(withOverride, 'r1', 24)
    expect(geo.widthPx).toBe(16 * 24)
  })
```

In `describe('loopLengthBars', ...)` (current lines 221-250), delete the `'extends to cover an unlinked stem dragged past the group's own span'` test (current lines 243-249).

In `describe('loopLengthBars with a playedBars override', ...)` (current lines 252-267), delete the `'extends the loop for an unlinked stem resized beyond rifff.barLength'` test (current lines 260-266); rename the remaining one to drop "linked":
```ts
describe('loopLengthBars with a playedBars override', () => {
  it('extends the loop for a rifff resized beyond rifff.barLength', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    const withOverride = { ...state, playedBars: { r1: 16 } } // rifff.barLength is 8
    expect(loopLengthBars(withOverride)).toBe(rifff.startBar! + 16)
  })
})
```

In `describe('isSketchEligible', ...)`, delete the `'is false if a rifff is unlinked'` test.

In `describe('pasteStemAction', ...)`, rewrite the two tests that used `UNLINK` purely to make a stem-keyed override take effect — they now just use the plain group-level key directly:
```ts
  it('sets barLength to the CURRENT resolved (possibly resized) length, not the source rifff’s own barLength', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: twoStemRifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    state = reducer(state, { type: 'SET_PLAYED_BARS', key: 'r1', bars: 3 })

    const action = pasteStemAction(state, 'r1', 1, 20)
    if (action?.type !== 'PASTE_RIFFF') throw new Error('expected PASTE_RIFFF')
    expect(action.rifff.barLength).toBe(3) // the resized/trimmed length, not 8
  })

  it('carries over this stem’s own volume, mute, and the group’s offset', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: twoStemRifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    state = reducer(state, { type: 'SET_VOLUME', stemKey: 'r1:1', volume: 0.4 })
    state = reducer(state, { type: 'TOGGLE_MUTE', stemKey: 'r1:1' })
    state = reducer(state, { type: 'SET_OFFSET_STEPS', key: 'r1', steps: 3 })

    const action = pasteStemAction(state, 'r1', 1, 0)
    if (action?.type !== 'PASTE_RIFFF') throw new Error('expected PASTE_RIFFF')
    const newGroupId = action.rifff.groupId
    expect(action.vol[`${newGroupId}:1`]).toBe(0.4)
    expect(action.mute[`${newGroupId}:1`]).toBe(true)
    expect(action.off[newGroupId]).toBe(3)
  })
```
And the `'applying the action creates an independent, single-stem rifff'` test right after it (current line ~694) drops its `UNLINK` dispatch, since it's no longer needed to exercise this path — just remove that one `state = reducer(state, { type: 'UNLINK', groupId: 'r1' })` line, leaving the rest of the test as-is.

Remove `resolveOffsetKey, stemGeometry, stemStartBar,` from the import list at the top of `selectors.test.ts`.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: still failing on `placedRifffsInOrder`'s `trackOrder`-shaped tests (Task 5) — everything else in this file should pass.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/state/selectors.ts src/renderer/src/state/selectors.test.ts
git commit -m "Retire resolveOffsetKey/stemStartBar/stemGeometry; fold resize-fix into clipGeometry"
```

---

### Task 5: channelsInOrder + placedRifffsInOrder rewrite

**Files:**
- Modify: `src/renderer/src/state/selectors.ts`
- Test: `src/renderer/src/state/selectors.test.ts`

- [ ] **Step 1: Add `Channel`/`channelsInOrder`, rewrite `placedRifffsInOrder` in terms of it**

Replace `placedRifffsInOrder` (current lines 94-115) with:
```ts
export interface Channel {
  channelId: string
  rifffs: Rifff[]
}

/** Every channel that currently has at least one placed clip on it, in
 * top-to-bottom row order — the single source of truth Timeline renders
 * from (one ChannelRow per entry). Prefers state.channelOrder, falling back
 * to first-seen order for any channel it doesn't (yet) know about — same
 * defensive fallback placedRifffsInOrder always had for trackOrder, covering
 * a placed rifff that somehow has no channel assignment rather than letting
 * it silently vanish from the arranger. */
export function channelsInOrder(state: AppState): Channel[] {
  const byChannel = new Map<string, Rifff[]>()
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    const channelId = state.channelOf[rifff.groupId]
    if (channelId === undefined) continue
    const list = byChannel.get(channelId)
    if (list) list.push(rifff)
    else byChannel.set(channelId, [rifff])
  }
  const ordered = state.channelOrder.filter((id) => byChannel.has(id))
  const seen = new Set(ordered)
  for (const channelId of byChannel.keys()) {
    if (!seen.has(channelId)) {
      ordered.push(channelId)
      seen.add(channelId)
    }
  }
  return ordered.map((channelId) => ({ channelId, rifffs: byChannel.get(channelId)! }))
}

/** Every placed rifff, flattened out of channelsInOrder — channel by
 * channel, top to bottom, then each channel's own clips in their array
 * order. Every OTHER selector that just wants "all placed rifffs, in
 * render order" (channelMuteLetters, isSketchEligible, loopLengthBars,
 * groupIdAtPosition) keeps working unchanged against this, with no
 * awareness of channels needed at their level at all. */
export function placedRifffsInOrder(state: AppState): Rifff[] {
  return channelsInOrder(state).flatMap((channel) => channel.rifffs)
}
```

- [ ] **Step 2: Update `placedRifffsInOrder`'s tests**

Replace the whole `describe('placedRifffsInOrder', ...)` block (current lines 269-301):
```ts
describe('placedRifffsInOrder', () => {
  const unplaced: Rifff = { ...rifff, startBar: undefined }

  it('orders placed rifffs by channelOrder, not object-insertion order', () => {
    const second: Rifff = { ...unplaced, groupId: 'r2' }
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced }) // r1 added first
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: second })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 0 }) // r2 placed first
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 8 })
    expect(placedRifffsInOrder(state).map((r) => r.groupId)).toEqual(['r2', 'r1'])
  })

  it('falls back to first-seen order for a placed rifff with no channel assignment', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    // Simulates a placed rifff that somehow has no channel entry — channelOf
    // and channelOrder both empty even though r1 is placed.
    const noChannel = { ...state, channelOf: {}, channelOrder: [] }
    expect(placedRifffsInOrder(noChannel).map((r) => r.groupId)).toEqual(['r1'])
  })

  it('excludes unplaced rifffs even if they linger in channelOrder', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'REMOVE_FROM_TIMELINE', groupId: 'r1' })
    expect(placedRifffsInOrder(state)).toEqual([])
  })

  it('multiple clips on one channel all appear, in that channel’s own array order', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced })
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: { ...unplaced, groupId: 'r2' } })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
    state = reducer(state, {
      type: 'MOVE_TO_CHANNEL',
      groupId: 'r2',
      startBar: 4,
      channelId: 'r1'
    })
    expect(placedRifffsInOrder(state).map((r) => r.groupId)).toEqual(['r1', 'r2'])
  })
})

describe('channelsInOrder', () => {
  it('groups clips sharing a channel into one Channel entry', () => {
    const unplaced: Rifff = { ...rifff, startBar: undefined }
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced })
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: { ...unplaced, groupId: 'r2' } })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
    state = reducer(state, {
      type: 'MOVE_TO_CHANNEL',
      groupId: 'r2',
      startBar: 4,
      channelId: 'r1'
    })
    const channels = channelsInOrder(state)
    expect(channels).toHaveLength(1)
    expect(channels[0].channelId).toBe('r1')
    expect(channels[0].rifffs.map((r) => r.groupId)).toEqual(['r1', 'r2'])
  })
})
```

Add `channelsInOrder` to the import list at the top of `selectors.test.ts`.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/renderer/src/state/selectors.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/state/selectors.ts src/renderer/src/state/selectors.test.ts
git commit -m "Add channelsInOrder; rewrite placedRifffsInOrder in terms of it"
```

---

### Task 6: Retire the old unlink model from the real playback-scheduling path

**Files:**
- Modify: `src/shared/buildEngineProject.ts`
- Modify: `src/main/nativeExport.ts`
- Modify: `src/renderer/src/state/StoreContext.tsx`
- Test: none of these three files currently has dedicated unit tests exercising the `unlinked` branch directly — verified via the full suite run in Step 4 below, plus manual playback/export verification in Task 12.

`buildEngineProject.ts` builds what's actually sent to the native engine for BOTH live playback and export — it currently reads `state.unlinked`/`resolveOffsetKey`/`stemStartBar` directly. The native engine's own C++ side needs **no changes**: `EngineStem.startBarOverride` stays in the wire format exactly as before, it just becomes permanently `-1` (no per-stem divergence can exist any more), which is a value the engine already handles today (it's the existing "no override" case).

- [ ] **Step 1: Update `buildEngineProject.ts`**

Replace the import (current lines 3-8):
```ts
import {
  loopLengthBars,
  resolveOffsetKey,
  resolvePlayedBars,
  stemStartBar
} from '../renderer/src/state/selectors'
```
with:
```ts
import { loopLengthBars, resolvePlayedBars } from '../renderer/src/state/selectors'
```

Update the module doc comment (current lines 62-70) — replace:
```ts
/**
 * Projects AppState down to exactly what the native engine needs to schedule
 * and mix playback — resolving stretch (via the caller-supplied resolver, the
 * same IPC round-trip src/main/resolveStretchedForExport.ts and
 * src/renderer/src/audio/resolveStretchedForPlayback.ts already use) and
 * unlinked-stem start positions (via the existing stemStartBar selector, so
 * there's exactly one place that logic lives) ahead of time, so the engine
 * itself never needs to know about stretch ratios or unlink state at all.
 */
```
with:
```ts
/**
 * Projects AppState down to exactly what the native engine needs to schedule
 * and mix playback — resolving stretch (via the caller-supplied resolver, the
 * same IPC round-trip src/main/resolveStretchedForExport.ts and
 * src/renderer/src/audio/resolveStretchedForPlayback.ts already use) ahead of
 * time, so the engine itself never needs to know about stretch ratios at all.
 * EngineStem.startBarOverride stays -1 unconditionally now — it used to
 * carry an unlinked stem's own diverged start position, but a stem can no
 * longer diverge from its rifff (see store.ts's UNGROUP: it becomes a fully
 * independent rifff instead, with its own ordinary startBar). Left in the
 * wire format rather than removed, since the native engine's own parsing
 * doesn't need to change either way and -1 is already its "no override"
 * case.
 */
```

Replace (current lines 118-122):
```ts
      const key = stemKey(rifff.groupId, stem.slot)
      const offsetSteps = state.off[resolveOffsetKey(state, rifff.groupId, stem.slot)] ?? 0
      const override = state.unlinked[rifff.groupId]
        ? stemStartBar(state, rifff.groupId, stem.slot)
        : -1
```
with:
```ts
      const key = stemKey(rifff.groupId, stem.slot)
      const offsetSteps = state.off[rifff.groupId] ?? 0
```

Update the two remaining references in the `EngineStem` push (current lines 136, 138):
```ts
        playedBars: resolvePlayedBars(state, rifff.groupId, stem.slot),
        offsetSteps,
        startBarOverride: override,
```
becomes:
```ts
        playedBars: resolvePlayedBars(state, rifff.groupId),
        offsetSteps,
        startBarOverride: -1,
```

- [ ] **Step 2: Update `nativeExport.ts`'s `loopLengthBarsFor`**

Replace (current lines 5-6, 13-35):
```ts
import { stemStartBar } from '../renderer/src/state/selectors'
```
```ts
// Mirrors src/renderer/src/state/selectors.ts's loopLengthBars (re-implemented here
// rather than imported wholesale, since that module also exports React-adjacent
// selectors that assume renderer context — but stemStartBar itself is plain
// arithmetic over AppState with no React/DOM dependency, so it's imported directly
// rather than duplicated a second time). An unlinked stem dragged out past its
// group's own span must count too, or the native render's duration would be cut
// short and truncate that stem's tail — see loopLengthBars's own comment for the
// same reasoning.
export function loopLengthBarsFor(state: AppState): number {
  const DEFAULT_LOOP_BARS = 32
  const ends: number[] = []
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    if (state.unlinked[rifff.groupId]) {
      for (const stem of rifff.stems) {
        ends.push(stemStartBar(state, rifff.groupId, stem.slot) + rifff.barLength)
      }
    } else {
      ends.push(rifff.startBar + rifff.barLength)
    }
  }
  return ends.length === 0 ? DEFAULT_LOOP_BARS : Math.max(...ends)
}
```
with (drop the `stemStartBar` import entirely; the function now also correctly respects a `playedBars` resize, which it previously didn't — the same class of bug `clipGeometry` had, fixed for the same reason in Task 4):
```ts
// Mirrors src/renderer/src/state/selectors.ts's loopLengthBars (re-implemented
// here rather than imported wholesale, since that module also exports React-
// adjacent selectors that assume renderer context).
export function loopLengthBarsFor(state: AppState): number {
  const DEFAULT_LOOP_BARS = 32
  const ends: number[] = []
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    const playedBars = state.playedBars[rifff.groupId] ?? rifff.barLength
    ends.push(rifff.startBar + playedBars)
  }
  return ends.length === 0 ? DEFAULT_LOOP_BARS : Math.max(...ends)
}
```

- [ ] **Step 3: Update `StoreContext.tsx`'s effect dependency array**

Remove the two now-nonexistent fields from the dependency array (current lines 142-163) — delete these two lines:
```ts
    state.unlinked,
```
```ts
    state.stemStart,
```
Leave every other entry untouched. `channelOf`/`channelOrder` deliberately do NOT need to be added here — channel assignment is purely a rendering concern; `buildEngineProject` never reads it (confirmed in Step 1 above — it iterates `Object.values(state.rifffs)` directly, never through `channelsInOrder`/`placedRifffsInOrder`).

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck passes for these three files specifically (other files may still have errors until later tasks land — check the error output only mentions files not yet touched). Full vitest run — no test in the current suite should newly fail from this task's changes (there's no existing dedicated test for `buildEngineProject.ts`'s `startBarOverride` branch or `loopLengthBarsFor`'s unlinked branch, so nothing to update there; Task 12's manual walkthrough is what actually exercises playback/export end to end).

- [ ] **Step 5: Commit**

```bash
git add src/shared/buildEngineProject.ts src/main/nativeExport.ts src/renderer/src/state/StoreContext.tsx
git commit -m "Retire unlink-state reads from buildEngineProject.ts and nativeExport.ts"
```

---

### Task 7: Simplify StemWaveformRow.tsx, CollapsedRifffRow.tsx, and BeatPicker.tsx

**Files:**
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`
- Modify: `src/renderer/src/components/CollapsedRifffRow.tsx`
- Modify: `src/renderer/src/components/BeatPicker.tsx`

All three currently import/call `resolveOffsetKey` and/or `stemStartBar`/`stemGeometry` (all deleted in Task 4), and `StemWaveformRow.tsx` has an `unlinked`-gated drag payload (`text/rifff-stem-key`) that becomes dead now that a stem can never independently diverge within a still-existing group — dragging always moves the whole rifff (which, after an Ungroup, might just be one stem, but it's still "the whole rifff" as far as this component is concerned).

- [ ] **Step 1: Update `StemWaveformRow.tsx`'s imports and per-stem-key computations**

Replace the import (current lines 7-13):
```ts
import {
  stemGeometry,
  resolveOffsetKey,
  resolvePlayedBars,
  stemStartBar,
  channelMuteLetters
} from '../state/selectors'
```
with:
```ts
import { clipGeometry, resolvePlayedBars, channelMuteLetters } from '../state/selectors'
```

Replace (current line 53):
```ts
  const playedBarsKey = resolveOffsetKey(state, groupId, slot)
```
with:
```ts
  const playedBarsKey = groupId
```

Delete (current line 55):
```ts
  const unlinked = !!state.unlinked[groupId]
```

Replace (current line 93):
```ts
  const resolvedPlayedBars = resolvePlayedBars(state, groupId, slot)
```
with:
```ts
  const resolvedPlayedBars = resolvePlayedBars(state, groupId)
```

Replace (current lines 99-100):
```ts
  const stemGeo = stemGeometry(state, groupId, slot, ppb)
  const baseStartBar = stemStartBar(state, groupId, slot)
```
with:
```ts
  const stemGeo = clipGeometry(state, groupId, ppb)
  const baseStartBar = rifff.startBar ?? 0
```

- [ ] **Step 2: Simplify `handleWaveformDragStart` — drop the unlinked branch**

Replace (current lines 307-319):
```ts
  function handleWaveformDragStart(e: React.DragEvent): void {
    suppressNextSyntheticClick()
    const mouseBar = mouseBarFromDragEvent(e, ppb)
    if (unlinked) {
      e.dataTransfer.setData('text/rifff-stem-key', key)
      if (mouseBar !== null) setGrabOffsetBars(computeGrabOffsetBars(mouseBar, baseStartBar))
    } else {
      e.dataTransfer.setData('text/rifff-group-id', groupId)
      if (mouseBar !== null) {
        setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
      }
    }
  }
```
with:
```ts
  function handleWaveformDragStart(e: React.DragEvent): void {
    suppressNextSyntheticClick()
    e.dataTransfer.setData('text/rifff-group-id', groupId)
    const mouseBar = mouseBarFromDragEvent(e, ppb)
    if (mouseBar !== null) {
      setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
    }
  }
```
Update its own doc comment just above (current lines 299-306) — delete the "same linked/unlinked branching as everywhere else" sentence; it just always moves the whole rifff now.

- [ ] **Step 3: Drop the `unlinked`-conditional title text**

Replace (current lines 339-343):
```ts
          title={
            unlinked
              ? 'right-click to mute · double-click to reset volume · cmd/ctrl-drag to duplicate this stem'
              : 'right-click to mute · double-click to reset volume'
          }
```
with:
```ts
          title="right-click to mute · double-click to reset volume"
```

- [ ] **Step 4: Update `RESIZE_LEFT` dispatch — drop `slot` (Task 2 removed it from the action)**

Replace (current lines 202-208):
```ts
          dispatch({
            type: 'RESIZE_LEFT',
            groupId,
            slot,
            bars: finalPlayedBars,
            startBar: finalStartBar
          })
```
with:
```ts
          dispatch({
            type: 'RESIZE_LEFT',
            groupId,
            bars: finalPlayedBars,
            startBar: finalStartBar
          })
```

- [ ] **Step 5: Update `CollapsedRifffRow.tsx` the same way**

Replace its import (current lines 6-12):
```ts
import {
  stemGeometry,
  resolveOffsetKey,
  resolvePlayedBars,
  stemStartBar,
  channelMuteLetters
} from '../state/selectors'
```
with:
```ts
import { clipGeometry, resolvePlayedBars, channelMuteLetters } from '../state/selectors'
```

Replace (current line 157):
```ts
  const playedBarsKey = resolveOffsetKey(state, groupId, firstStem.slot)
```
with:
```ts
  const playedBarsKey = groupId
```

Replace (current line 158):
```ts
  const resolvedPlayedBars = resolvePlayedBars(state, groupId, firstStem.slot)
```
with:
```ts
  const resolvedPlayedBars = resolvePlayedBars(state, groupId)
```

Replace (current line 160):
```ts
  const baseStartBar = stemStartBar(state, groupId, firstStem.slot)
```
with:
```ts
  const baseStartBar = rifff.startBar ?? 0
```

Replace (current line 162):
```ts
  const geo = stemGeometry(state, groupId, firstStem.slot, PPB)
```
with:
```ts
  const geo = clipGeometry(state, groupId, PPB)
```

Update the `RESIZE_LEFT` dispatch in `handleLeftResizeStart` (current lines 230-236) the same way — drop `slot: firstStem.slot`:
```ts
          dispatch({
            type: 'RESIZE_LEFT',
            groupId,
            bars: finalPlayedBars,
            startBar: finalStartBar
          })
```

Update the doc comment above the `playedBarsKey`/`resolvedPlayedBars` block (current lines 147-156) — it currently explains why `stemGeometry` (not `clipGeometry`) is used "so an active playedBars resize is reflected here too... clipGeometry predates the resize feature". Since `clipGeometry` now handles this itself (Task 4), simplify to:
```ts
  // For a collapsed row, geometry is simply the group's own clipGeometry —
  // there's exactly one shared position/width for the whole rifff to show
  // here, same value every stem's own row would use if expanded instead.
```

- [ ] **Step 6: Update `BeatPicker.tsx`**

This file operates on one identity stem (`stem`) within one rifff (`groupId`) at a time — its three `resolveOffsetKey(state, groupId, stem.slot)` call sites all simplify to the plain `groupId`.

Replace the import (current lines 3-7):
```ts
import {
  resolveOffsetKey,
  offsetStepsForBeatIndex,
  rotationSecondsForStem
} from '../state/selectors'
```
with:
```ts
import { offsetStepsForBeatIndex, rotationSecondsForStem } from '../state/selectors'
```

Update `rebakeRifff`'s doc comment (current lines 86-88) — replace:
```ts
/** Re-bakes whatever downbeat correction a rifff's stems ALREADY have live
 * (state.off, via resolveOffsetKey — handles both a linked rifff's single
 * shared value and an unlinked one's independent per-stem values) without
```
with:
```ts
/** Re-bakes whatever downbeat correction a rifff's stems ALREADY have live
 * (state.off, keyed by groupId) without
```
(leave the rest of that comment block, starting "needing to reopen BeatPicker...", exactly as it is).

Replace (current line 109):
```ts
      const steps = state.off[resolveOffsetKey(state, groupId, s.slot)] ?? 0
```
with:
```ts
      const steps = state.off[groupId] ?? 0
```

Replace (current lines 524-528):
```ts
      dispatch({
        type: 'SET_OFFSET_STEPS',
        key: resolveOffsetKey(state, groupId, stem.slot),
        steps
      })
```
with:
```ts
      dispatch({
        type: 'SET_OFFSET_STEPS',
        key: groupId,
        steps
      })
```

Replace (current line 568):
```ts
  const offsetKey = resolveOffsetKey(state, groupId, stem.slot)
```
with:
```ts
  const offsetKey = groupId
```

- [ ] **Step 7: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: these three files no longer error. `App.tsx`/`Inspector.tsx` still will (Task 8).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx src/renderer/src/components/CollapsedRifffRow.tsx src/renderer/src/components/BeatPicker.tsx
git commit -m "Drop dead unlinked-stem drag/geometry/offset-key code from the arranger and BeatPicker"
```

---

### Task 8: Inspector.tsx and App.tsx — unlink button becomes ungroup, drop dead drop-branch

**Files:**
- Modify: `src/renderer/src/components/Inspector.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Update `Inspector.tsx`'s imports and per-stem offset key**

Replace (current line 3):
```ts
import { resolveOffsetKey, stretchRatio } from '../state/selectors'
```
with:
```ts
import { stretchRatio } from '../state/selectors'
```

Replace (current line 54):
```ts
  const groupOffsetKey = resolveOffsetKey(state, groupId, rifff.stems[0]?.slot ?? 0)
```
with:
```ts
  const groupOffsetKey = groupId
```

Delete (current line 58):
```ts
  const unlinked = !!state.unlinked[groupId]
```

- [ ] **Step 2: Replace the "unlink group"/"relink group" button with "ungroup"**

Replace (current lines 280-310):
```ts
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ra-eyebrow">stems</span>
            <button
              onClick={() => {
                dispatch({ type: unlinked ? 'RELINK' : 'UNLINK', groupId })
                // Unlinking is specifically about dragging/editing each stem
                // independently — expand so they're actually visible to do
                // that with, rather than leaving the collapsed single-row
                // view up with nothing to grab. Only on the unlink
                // direction, and only if not already expanded (never
                // auto-collapses). Same fix as the right-click clip menu's
                // own "unlink" item in App.tsx.
                if (!unlinked && !state.exp[groupId]) {
                  dispatch({ type: 'TOGGLE_EXPAND', groupId })
                }
              }}
              style={{
                height: 20,
                borderRadius: 0,
                padding: '0 6px',
                fontSize: 10,
                background: 'var(--ra-bg-row-active)',
                color: unlinked ? 'var(--ra-text-2)' : 'var(--ra-mute-on)',
                border: `1px solid ${unlinked ? 'var(--ra-border)' : 'color-mix(in srgb, var(--ra-mute-on) 55%, transparent)'}`
              }}
            >
              {unlinked ? 'relink group' : 'unlink group'}
            </button>
          </div>
```
with:
```ts
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="ra-eyebrow">stems</span>
            {/* Meaningless (and hidden) for an already-single-stem rifff —
                there'd be nothing to split apart. One-way: there's no
                "regroup" — see UNGROUP's own doc comment in store.ts. */}
            {rifff.stems.length > 1 && (
              <button
                onClick={() => dispatch({ type: 'UNGROUP', groupId })}
                title="split every stem into its own independent clip — cannot be undone back into a group"
                style={{
                  height: 20,
                  borderRadius: 0,
                  padding: '0 6px',
                  fontSize: 10,
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-mute-on)',
                  border: '1px solid color-mix(in srgb, var(--ra-mute-on) 55%, transparent)'
                }}
              >
                ungroup
              </button>
            )}
          </div>
```

- [ ] **Step 3: Remove the now-dead per-stem "unlinked" nudge UI**

Inside the `rifff.stems.map((stem) => { ... })` callback (current lines 312-316), the per-stem `stemOffsetKey`/`stemOffsetSteps`/`stemLabels` computation is only ever consumed by the conditional block this step deletes — remove all four together. Replace (current lines 312-316):
```ts
            {rifff.stems.map((stem) => {
              const stemOffsetKey = resolveOffsetKey(state, groupId, stem.slot)
              const stemOffsetSteps = state.off[stemOffsetKey] ?? 0
              const stemLabels = offsetLabels(stemOffsetSteps, snapDiv, state.bpm)
              return (
```
with:
```ts
            {rifff.stems.map((stem) => {
              return (
```

Then delete the whole `{unlinked && ( ... )}` block — it rendered per-stem nudge +/-/zero controls only while unlinked, a state that can no longer exist (it's the `<Fragment>`'s second child, immediately following the stem name/author `<div>`, current lines 363-437):
```tsx
                  {unlinked && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginLeft: 13,
                        marginBottom: 2
                      }}
                    >
                      <button
                        onClick={() =>
                          dispatch({
                            type: 'NUDGE_OFFSET',
                            key: stemOffsetKey,
                            delta: -fineNudgeDelta(state.bpm, snapDiv)
                          })
                        }
                        style={{
                          width: 18,
                          height: 16,
                          borderRadius: 0,
                          border: '1px solid var(--ra-border)',
                          background: 'var(--ra-bg-row-active)',
                          color: 'var(--ra-text)',
                          fontSize: 9
                        }}
                      >
                        −
                      </button>
                      <span
                        style={{
                          fontSize: 9,
                          color: stemOffsetSteps ? typeColorVar(stem.type) : 'var(--ra-text-3)',
                          minWidth: 24
                        }}
                      >
                        {stemLabels.ms}
                      </span>
                      <button
                        onClick={() =>
                          dispatch({
                            type: 'NUDGE_OFFSET',
                            key: stemOffsetKey,
                            delta: fineNudgeDelta(state.bpm, snapDiv)
                          })
                        }
                        style={{
                          width: 18,
                          height: 16,
                          borderRadius: 0,
                          border: '1px solid var(--ra-border)',
                          background: 'var(--ra-bg-row-active)',
                          color: 'var(--ra-text)',
                          fontSize: 9
                        }}
                      >
                        +
                      </button>
                      <button
                        onClick={() => dispatch({ type: 'ZERO_OFFSET', key: stemOffsetKey })}
                        style={{
                          height: 16,
                          borderRadius: 0,
                          padding: '0 5px',
                          fontSize: 9,
                          border: '1px solid var(--ra-border)',
                          background: 'var(--ra-bg-row-active)',
                          color: 'var(--ra-text-2)'
                        }}
                      >
                        zero
                      </button>
                    </div>
                  )}
```
Leave everything else in that `<Fragment>` (the stem name/author row above it) untouched.

- [ ] **Step 4: Update `App.tsx`'s context menu**

Replace (current lines 399-436):
```ts
  function openClipMenu(x: number, y: number, groupId: string): void {
    const rifff = state.rifffs[groupId]
    if (!rifff) return
    const unlinked = !!state.unlinked[groupId]
    // A rifff can be left with a live but never-actually-baked downbeat
    // correction — the main case being a LORE-sourced stem picked before
    // bakeOffset.ts could bake those at all (see its own doc comment).
    // Playback already accounts for it correctly (SchedulePlayback wraps
    // the offset), so this is a "clean up, not fix" action — only offered
    // when there's actually something to re-bake.
    const hasUnbakedOffset = rifff.stems.some(
      (s) => (state.off[resolveOffsetKey(state, groupId, s.slot)] ?? 0) !== 0
    )
    setContextMenu({
      x,
      y,
      items: [
        { label: 'copy', onClick: () => setClipboard(groupId) },
        {
          label: 'duplicate',
          onClick: () => {
            const action = pasteRifffAction(state, groupId, (rifff.startBar ?? 0) + rifff.barLength)
            if (action) dispatch(action)
          }
        },
        {
          label: unlinked ? 'relink' : 'unlink',
          onClick: () => {
            dispatch({ type: unlinked ? 'RELINK' : 'UNLINK', groupId })
            // Unlinking is specifically about dragging/editing each stem
            // independently — expand so they're actually visible to do that
            // with, rather than leaving the collapsed single-row view up
            // with nothing to grab. Only on the unlink direction, and only
            // if not already expanded (never auto-collapses).
            if (!unlinked && !state.exp[groupId]) {
              dispatch({ type: 'TOGGLE_EXPAND', groupId })
            }
          }
        },
        ...(hasUnbakedOffset
          ? [
```
with:
```ts
  function openClipMenu(x: number, y: number, groupId: string): void {
    const rifff = state.rifffs[groupId]
    if (!rifff) return
    // A rifff can be left with a live but never-actually-baked downbeat
    // correction — the main case being a LORE-sourced stem picked before
    // bakeOffset.ts could bake those at all (see its own doc comment).
    // Playback already accounts for it correctly (SchedulePlayback wraps
    // the offset), so this is a "clean up, not fix" action — only offered
    // when there's actually something to re-bake.
    const hasUnbakedOffset = (state.off[groupId] ?? 0) !== 0
    setContextMenu({
      x,
      y,
      items: [
        { label: 'copy', onClick: () => setClipboard(groupId) },
        {
          label: 'duplicate',
          onClick: () => {
            const action = pasteRifffAction(state, groupId, (rifff.startBar ?? 0) + rifff.barLength)
            if (action) dispatch(action)
          }
        },
        // Meaningless for an already-single-stem rifff — nothing to split.
        ...(rifff.stems.length > 1
          ? [{ label: 'ungroup', onClick: () => dispatch({ type: 'UNGROUP', groupId }) }]
          : []),
        ...(hasUnbakedOffset
          ? [
```
(`hasUnbakedOffset` simplifies too: it used to check every stem's own possibly-diverged offset key via `resolveOffsetKey`; now every stem in a rifff always shares the single group-level `off[groupId]`, so checking that once is equivalent and simpler.)

Remove `resolveOffsetKey` from `App.tsx`'s import list (current line 31) — check first whether anything else in the file still uses it (it shouldn't, after this step and Task 6's `StoreContext.tsx` change — `App.tsx` itself doesn't touch `StoreContext.tsx`, so just confirm via a search of the file after this edit).

- [ ] **Step 5: Remove the dead `text/rifff-stem-key` drop branch**

This payload was only ever set by `StemWaveformRow.tsx` while a stem was unlinked (Task 7 already removed that). Delete the whole branch from `handleDrop` (current lines 118-139):
```ts
    // Checked first — more specific than a whole-group drag, and the two payloads
    // are never both set on the same drop (StemWaveformRow only sets this one,
    // and only while its stem's group is unlinked).
    const stemDragKey = e.dataTransfer.getData('text/rifff-stem-key')
    if (stemDragKey) {
      // Cmd/Ctrl held at drop = duplicate just this one stem rather than move
      // it — the per-stem equivalent of the whole-rifff duplicate below.
      // stemKey's own format is `${groupId}:${slot}` — split on the LAST ':'
      // since groupId is always a crypto.randomUUID() (never contains one),
      // matching the same split App.tsx's Shift+letter mute handler already
      // uses for the same reason.
      if (e.metaKey || e.ctrlKey) {
        const sepIndex = stemDragKey.lastIndexOf(':')
        const sourceGroupId = stemDragKey.slice(0, sepIndex)
        const slot = Number(stemDragKey.slice(sepIndex + 1))
        const action = pasteStemAction(state, sourceGroupId, slot, startBar)
        if (action) dispatch(action)
        return
      }
      dispatch({ type: 'SET_STEM_START', key: stemDragKey, startBar })
      return
    }

```
`pasteStemAction` (current line 26's import) has exactly one call site in `App.tsx` — inside the branch just deleted above — so it's now fully unused here and must be removed from the import list too (it stays exported from `selectors.ts` for its own direct test coverage; this is only about `App.tsx`'s own import list).

- [ ] **Step 6: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: `Inspector.tsx` and `App.tsx` no longer error on removed types/functions. Task 9-11 still need to land before the whole project typechecks clean (App.tsx's Timeline still uses `placedRifffsInOrder`, which is fine/unchanged, but doesn't yet render multiple clips per channel — that's Tasks 10-11).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/Inspector.tsx src/renderer/src/App.tsx
git commit -m "Replace unlink/relink UI with ungroup; drop dead per-stem drag/nudge code"
```

---

### Task 9: serialize.ts migration for old-shape (trackOrder-only) saves

**Files:**
- Modify: `src/renderer/src/state/serialize.ts`
- Test: `src/renderer/src/state/serialize.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `serialize.test.ts` (needs a new import — add `type LegacyPersistedProject` to the existing `import { serializeProject, deserializeProject } from './serialize'` line, changing it to also bring in the new type from Step 2 below):
```ts
describe('deserializeProject migration from trackOrder', () => {
  it('migrates an old-shape project (trackOrder, no channelOrder/channelOf) into one channel per clip, same order', () => {
    const legacy = {
      rifffs: {
        r1: { ...rifff, startBar: 0 },
        r2: { ...rifff, groupId: 'r2', startBar: 4 }
      },
      trackOrder: ['r1', 'r2']
    } as unknown as LegacyPersistedProject
    const restored = deserializeProject(legacy)
    expect(restored.channelOrder).toEqual(['r1', 'r2'])
    expect(restored.channelOf).toEqual({ r1: 'r1', r2: 'r2' })
    expect(restored.rifffs.r1.startBar).toBe(0)
    expect(restored.rifffs.r2.startBar).toBe(4)
  })

  it('does not re-migrate a project that already has channelOrder', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    const persisted = JSON.parse(serializeProject(state))
    const restored = deserializeProject(persisted)
    expect(restored.channelOrder).toEqual(['r1'])
    expect(restored.channelOf).toEqual({ r1: 'r1' })
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/renderer/src/state/serialize.test.ts`
Expected: FAIL — `LegacyPersistedProject` doesn't exist yet, and the first test's `channelOrder`/`channelOf` assertions fail against un-migrated data.

- [ ] **Step 3: Implement the migration**

Replace the whole file's exported type/function section (current lines 1-27) with:
```ts
import { initialState, type AppState } from './store'
import { isSketchEligible } from './selectors'

/** Everything persisted to a .rifffproj file — the full AppState minus
 * transient UI-mode fields that never make sense to reopen into. Playback
 * position/running state aren't part of AppState at all anymore (they live
 * in StoreContext.tsx's own transport state, outside this reducer — see its
 * module doc comment), so there's nothing to exclude for those here the way
 * there used to be. */
export type PersistedProject = Omit<
  AppState,
  'volumeDragMode' | 'mode' | 'inspectorCollapsed' | 'metronomeEnabled'
>

/** The shape of a .rifffproj saved before channels replaced trackOrder —
 * accepted by deserializeProject's migration step below, so an old save
 * still opens correctly instead of silently losing every placed rifff's row
 * (channelOrder/channelOf would otherwise just be empty). */
export interface LegacyPersistedProject
  extends Omit<PersistedProject, 'channelOrder' | 'channelOf'> {
  trackOrder: string[]
}

export function serializeProject(state: AppState): string {
  // Rest destructure is how we drop the transient UI-mode fields;
  // ignoreRestSiblings isn't enabled project-wide, so the extracted-but-unused
  // bindings need an explicit disable.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { volumeDragMode, mode, inspectorCollapsed, metronomeEnabled, ...rest } = state
  return JSON.stringify(rest, null, 2)
}

// Reuses each old trackOrder entry's own groupId as its channel id, matching
// the same "own groupId as channel id" default a first-time PLACE_ON_TIMELINE
// already uses (see store.ts) — an old trackOrder entry basically WAS "this
// groupId's own solo row" already, so this reproduces the exact same
// rendering, one channel per clip, in the same order, with nothing visibly
// different until the user actually drags something onto a shared channel.
function migrateTrackOrder(trackOrder: string[]): Pick<AppState, 'channelOrder' | 'channelOf'> {
  const channelOrder: string[] = []
  const channelOf: Record<string, string> = {}
  for (const groupId of trackOrder) {
    channelOrder.push(groupId)
    channelOf[groupId] = groupId
  }
  return { channelOrder, channelOf }
}

export function deserializeProject(data: PersistedProject | LegacyPersistedProject): AppState {
  const migrated = 'channelOrder' in data ? {} : migrateTrackOrder(data.trackOrder)
  const state = { ...initialState, ...data, ...migrated }
  return isSketchEligible(state) ? state : { ...state, mode: 'normal' }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/renderer/src/state/serialize.test.ts`
Expected: PASS, including the existing round-trip/mode-fallback tests (unaffected — a project serialized by the CURRENT code always already has `channelOrder`, so the `'channelOrder' in data` check correctly skips migration for it).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/serialize.ts src/renderer/src/state/serialize.test.ts
git commit -m "Migrate old trackOrder-shaped saves to channelOrder/channelOf on load"
```

---

### Task 10: ChannelRow component

**Files:**
- Create: `src/renderer/src/components/ChannelRow.tsx`

Wraps everything a single channel needs to render: every clip currently on it (each still using `RifffBlockRow`'s existing per-clip rendering unchanged), stacked via absolute positioning exactly the way one clip already renders today — the only difference is there can now be more than one.

- [ ] **Step 1: Write the component**

```tsx
import type { Rifff } from '@shared/types'
import { RifffBlockRow } from './RifffBlockRow'

/** One arranger row, hosting every clip currently assigned to this channel
 * (see channelOf in store.ts) — could be exactly one clip (today's default,
 * unchanged visually) or several sharing the row, each still positioned by
 * its own clipGeometry exactly as RifffBlockRow already does; if two
 * overlap in time they'll visually overlap too; z-order (which one's on
 * top) follows plain array order, matching the design spec.
 *
 * This component owns the row's own onDrop, stopping propagation so a drop
 * landing here reassigns the dragged clip's channel to THIS one (see
 * App.tsx's Timeline, which supplies onDropOnChannel) rather than falling
 * through to the Timeline container's own fallback (which always means
 * "give it a brand new channel instead" — see Task 11). */
export function ChannelRow({
  channelId,
  rifffs,
  onOpenContextMenu,
  onDropOnChannel
}: {
  channelId: string
  rifffs: Rifff[]
  onOpenContextMenu: (x: number, y: number, groupId: string) => void
  onDropOnChannel: (e: React.DragEvent<HTMLDivElement>, channelId: string) => void
}): React.JSX.Element {
  return (
    <div
      data-channel-id={channelId}
      onDrop={(e) => onDropOnChannel(e, channelId)}
      style={{ position: 'relative' }}
    >
      {rifffs.map((rifff) => (
        <RifffBlockRow key={rifff.groupId} groupId={rifff.groupId} onOpenContextMenu={onOpenContextMenu} />
      ))}
    </div>
  )
}
```

Note: this deliberately does NOT need its own `onDragOver` — the drag-over visual feedback (the vertical drop-position indicator, `dropBar`) stays entirely on the Timeline container in Task 11, since it's about horizontal position, not which channel; only `onDrop` needs to be intercepted per-row.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: this new file has no errors on its own (it isn't wired into `App.tsx` yet — that's Task 11 — so nothing calls it yet; confirm no import-path/type errors in isolation).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ChannelRow.tsx
git commit -m "Add ChannelRow, hosting every clip sharing one channel"
```

---

### Task 11: Wire channels + per-row drop into App.tsx's Timeline

**Files:**
- Modify: `src/renderer/src/App.tsx`

This is the task that actually makes channels reachable from the UI. `Timeline` switches from rendering one `RifffBlockRow` per placed rifff to one `ChannelRow` per channel (via `channelsInOrder`). Drop handling splits into a per-channel path (`ChannelRow`'s own `onDrop`, reassigning via `MOVE_TO_CHANNEL`) and a container-level fallback (anything not caught by a specific row — ghost rows, or any other background space — always means "give this clip a brand new channel").

- [ ] **Step 1: Update imports**

Replace (current lines 15, 23-32):
```ts
import { RifffBlockRow } from './components/RifffBlockRow'
```
```ts
import {
  loopLengthBars,
  pasteRifffAction,
  pasteStemAction,
  placedRifffsInOrder,
  channelMuteLetters,
  nextArrangerMode,
  groupIdAtPosition,
  resolveOffsetKey
} from './state/selectors'
```
with:
```ts
import { ChannelRow } from './components/ChannelRow'
```
```ts
import {
  loopLengthBars,
  pasteRifffAction,
  channelsInOrder,
  channelMuteLetters,
  nextArrangerMode,
  groupIdAtPosition
} from './state/selectors'
```
(`placedRifffsInOrder` has exactly one other use in `App.tsx` today — the very `Timeline` render line Step 4 below replaces — so it becomes fully unused and is correctly dropped from the import entirely, not kept alongside `channelsInOrder`. `pasteStemAction` and `resolveOffsetKey` were already dropped from this file in Task 8.)

- [ ] **Step 2: Split `handleDrop` into a shared resolver + two entry points**

Replace the whole `handleDrop` function (current lines 110-169) with:
```ts
  // Shared by both drop entry points below — targetChannelId is the specific
  // channel the drop landed on (a real ChannelRow), or undefined (the
  // Timeline container's own fallback: a ghost row, or any other background
  // space) meaning "give this clip its own brand new channel."
  function resolveDrop(e: DragEvent<HTMLDivElement>, targetChannelId: string | undefined): void {
    e.preventDefault()
    e.stopPropagation()
    setDropBar(null)
    const startBar = applyGrabOffset(
      barForClientX(e.clientX, e.currentTarget, ppb),
      getGrabOffsetBars()
    )

    // From the shelf — either the rifff's first-ever placement, or (if it's
    // already placed elsewhere) an independent copy, never a reposition of an
    // existing clip (that's 'text/rifff-group-id', below).
    const shelfSourceId = e.dataTransfer.getData('text/rifff-shelf-source-id')
    if (shelfSourceId) {
      const source = state.rifffs[shelfSourceId]
      if (!source) return
      if (source.startBar === undefined) {
        const channelId = targetChannelId ?? crypto.randomUUID()
        dispatch({ type: 'MOVE_TO_CHANNEL', groupId: shelfSourceId, startBar, channelId })
      } else {
        const action = pasteRifffAction(state, shelfSourceId, startBar)
        if (action) dispatch(action)
      }
      return
    }

    const groupId = e.dataTransfer.getData('text/rifff-group-id')
    if (!groupId) return
    // Cmd/Ctrl held at drop = duplicate rather than move: same
    // pasteRifffAction already used for "drag an already-placed shelf item
    // to a new spot" above, leaving the original exactly where it was and
    // dropping an independent copy at the new position instead.
    if (e.metaKey || e.ctrlKey) {
      const action = pasteRifffAction(state, groupId, startBar)
      if (action) dispatch(action)
      return
    }
    const channelId = targetChannelId ?? state.channelOf[groupId] ?? crypto.randomUUID()
    dispatch({ type: 'MOVE_TO_CHANNEL', groupId, startBar, channelId })
  }

  // The Timeline container's own catch-all — fires for anything a specific
  // ChannelRow's own onDrop (below) didn't already stop propagation for:
  // ghost rows, or any other background space. Always resolves to "give
  // this clip a brand new channel" (targetChannelId undefined).
  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    resolveDrop(e, undefined)
  }

  // Passed to every ChannelRow — a drop that lands there always means
  // "reassign to (or land initially on) THIS channel."
  function handleDropOnChannel(e: DragEvent<HTMLDivElement>, channelId: string): void {
    resolveDrop(e, channelId)
  }
```
Note: `MOVE_TO_CHANNEL` always sets `channelOf[groupId]` explicitly, which correctly covers BOTH "first-ever placement directly onto an existing channel" and "reposition, possibly onto a different channel" in one action — this is a deliberate widening from Task 1's `MOVE_TO_CHANNEL` design (which only anticipated reassignment of an already-placed clip); using it here for first-placement-onto-a-specific-channel too is correct and requires no reducer changes, since `MOVE_TO_CHANNEL`'s reducer case already handles `previousChannelId === undefined` correctly (the `channelHasAnyClip` cleanup branch simply doesn't fire, exactly as intended for a genuinely new placement).

- [ ] **Step 3: Update `handleDragOver`'s stray reference (none expected, but verify)**

`handleDragOver` (current lines 99-108) doesn't reference `handleDrop` internally and needs no changes — leave it as-is.

- [ ] **Step 4: Update the render — one `ChannelRow` per channel, `onDrop` wired per-row**

Replace (current lines 185-198):
```tsx
  return (
    <div
      data-timeline
      onDragOver={handleDragOver}
      onDragLeave={() => setDropBar(null)}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
      onClick={handleBackgroundClick}
      style={{ position: 'relative' }}
    >
      <Ruler bars={loopLengthBars(state) + TRAILING_BLANK_BARS} ppb={ppb} />
      {placedRifffsInOrder(state).map((r) => (
        <RifffBlockRow key={r.groupId} groupId={r.groupId} onOpenContextMenu={onOpenClipMenu} />
      ))}
```
with:
```tsx
  return (
    <div
      data-timeline
      onDragOver={handleDragOver}
      onDragLeave={() => setDropBar(null)}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
      onClick={handleBackgroundClick}
      style={{ position: 'relative' }}
    >
      <Ruler bars={loopLengthBars(state) + TRAILING_BLANK_BARS} ppb={ppb} />
      {channelsInOrder(state).map((channel) => (
        <ChannelRow
          key={channel.channelId}
          channelId={channel.channelId}
          rifffs={channel.rifffs}
          onOpenContextMenu={onOpenClipMenu}
          onDropOnChannel={handleDropOnChannel}
        />
      ))}
```
The rest of the `return` block (ghost rows, `Playhead`, the `dropBar` indicator) is unchanged.

- [ ] **Step 5: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS across the whole project now — this was the last file with dangling references to removed selectors/actions.

- [ ] **Step 6: Manual verification**

This drag-and-drop wiring isn't unit-testable the way the reducer/selector logic is — verify by hand with `npm run dev`:
1. Place two different rifffs from the shelf onto two different rows (unchanged default behavior — confirm nothing regressed).
2. Drag one of them directly onto the OTHER's row. Confirm both now render on the same row, and dragging either one moves it independently in time while staying on that shared row.
3. Drag one of the two clips down onto one of the empty ghost rows below the arrangement. Confirm it gets its own row again, separate from the other.
4. Select a multi-stem rifff, open its right-click menu (or the Inspector), click "ungroup." Confirm the row now shows N single-stem clips stacked at the exact same position, and dragging each one apart works (plain move, same as any other clip). Confirm "ungroup" doesn't appear at all for an already-single-stem clip.
5. Confirm playback still works correctly for a two-clips-on-one-channel arrangement (both play, mixed) — this is the actual audio-scheduling path (`buildEngineProject.ts`, Task 6), not just visual.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Wire ChannelRow into Timeline; per-channel drop reassignment, ghost-row-creates-channel"
```

---

### Task 12: Final full-suite verification + manual walkthrough

**Files:** none (verification only).

- [ ] **Step 1: Full automated verification**

Run, in order:
```bash
npm run typecheck
npm run lint
npx vitest run
```
Expected: all clean. If `npx vitest run` shows a native-engine spawn/socket test flake on the first run, re-run once — a single re-run resolving it is expected/known in this project, not a regression.

- [ ] **Step 2: Production build**

Run: `npx electron-vite build`
Expected: succeeds.

- [ ] **Step 3: Manual walkthrough with `npm run dev`**

Beyond Task 11's drag/ungroup checks, specifically verify:
1. **Old-save migration**: open a `.rifffproj` file saved before this feature (or, if none is available, note this explicitly in your final report rather than skipping it silently) — confirm it opens with every previously-placed rifff on its own distinct row, exactly as before.
2. **Export**: with a two-clips-on-one-channel arrangement (from Task 11's manual check) still in place, export to WAV and confirm both clips are present and mixed correctly in the output — this exercises `nativeExport.ts`'s own `loopLengthBarsFor` (Task 6).
3. **Sketch mode**: confirm a plain, contiguous, single-channel arrangement still toggles into sketch mode correctly (Tab key / TransportBar), and that dragging to reorder tiles there still works (`SEQUENCE_RIFFFS`, Task 3).
4. **Undo/redo**: place a clip, ungroup a multi-stem rifff, drag a clip onto another's channel — confirm Cmd/Ctrl+Z steps back through each of these cleanly, one action at a time.

- [ ] **Step 4: Report**

Summarize: what passed automatically, what was manually verified and how, and anything that couldn't be verified (e.g. no old-format save file was available) so the user knows exactly what's left to check on their own machine.

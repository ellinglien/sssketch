# Discover: Add to Timeline / Add to Shelf, Toolbar Rework, Slot-Row Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Discover's "plunk in arranger" to "add to timeline," add a sibling "add to
shelf" button, give both real stop-the-loop + label-swap confirmation feedback, split
Discover's cluttered single-row toolbar into two rows, rework each Discover slot row into a
CSS grid with a regrouped/relabeled button set, and finish converting Discover's remaining
icon-only buttons to the fast `data-tooltip` mechanism.

**Architecture:** All changes are confined to `src/renderer/src/components/DiscoverPanel.tsx`
(the panel itself + its child `DiscoverSlotRow`) and one small, directly-precedented addition
to the `ADD_TO_SHELF` reducer case in `src/renderer/src/state/store.ts`. No new files, no new
shared components — this codebase's own established convention (see
`docs/superpowers/specs/2026-09-16-unified-ui-consistency-design.md`) is every screen keeps
hand-rolling its own inline `style={{...}}` objects.

**Tech Stack:** React + TypeScript (renderer), a single reducer (`state/store.ts`), Vitest for
the one new reducer test, existing `global.css` `[data-tooltip]` rule (no CSS changes needed).

---

## Before you start

Design spec: `docs/superpowers/specs/2026-09-17-discover-actions-and-toolbar-design.md` — read
it in full before starting Task 2 onward (Task 1 only needs §2's store-level portion, quoted
in full below).

Every task's own verification is `npm run typecheck` + `npx eslint --cache <touched files>`,
except Task 1 (adds a real Vitest test — TDD: write it, watch it fail, implement, watch it
pass) and Task 6 (the final task — full `npm test` + the manual-walkthrough checklist).

**Re-read each file fresh immediately before editing it in each task below.** The line numbers
given throughout this plan were verified fresh against the current code just before this plan
was written, but Tasks 2-5 all touch the same file (`DiscoverPanel.tsx`) in sequence — every
task after Task 2 must re-grep for its own target code rather than trusting this plan's line
numbers blindly, since the prior task in the sequence will have shifted them.

---

### Task 1: `ADD_TO_SHELF` gains an optional per-stem `vol` override

**Files:**
- Modify: `src/renderer/src/state/store.ts` (the `Action` union type, and the `ADD_TO_SHELF`
  reducer case at line 564)
- Test: `src/renderer/src/state/store.test.ts`

This is the one piece of real branching logic in this whole plan, so it gets a real TDD pass,
done first and in isolation — nothing else in this plan depends on it, and it has no
dependency on `DiscoverPanel.tsx` either.

- [ ] **Step 1: Write the failing test**

Add this test right after the existing "re-adding the same rifff…" test (currently ending at
`store.test.ts:56`, i.e. add it as a new `it(...)` block right after that one, inside the same
`describe('reducer', ...)` block):

```ts
  it('an explicit vol entry wins over the computed sqrtGain default, per stem', () => {
    // makeRifff() has 2 stems: slot 1 and slot 6 -> keys 'r1:1' and 'r1:6'.
    // Supplying vol only for 'r1:1' must use that value verbatim for slot 1,
    // while slot 6 (no matching entry) still falls back to sqrtGain(2) --
    // both code paths need to coexist correctly within the SAME dispatch,
    // not just work in isolation.
    const state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: makeRifff(),
      vol: { 'r1:1': 0.42 }
    })
    expect(state.vol['r1:1']).toBe(0.42)
    expect(state.vol['r1:6']).toBeCloseTo(sqrtGain(2), 10)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "explicit vol entry wins"`

Expected: FAIL — TypeScript error (`vol` doesn't exist on the `ADD_TO_SHELF` action type yet),
or if it somehow compiles, a runtime assertion failure on `state.vol['r1:1']` (still equals
`sqrtGain(2)`, not `0.42`).

- [ ] **Step 3: Add the `vol` field to the `ADD_TO_SHELF` action type**

Find the `ADD_TO_SHELF` entry in the `Action` union type (near `PLACE_LOOP_ON_TIMELINE`'s own
`vol?: Record<string, number>` field, which this mirrors exactly). Change:

```ts
  | { type: 'ADD_TO_SHELF'; rifff: Rifff }
```

to:

```ts
  | {
      type: 'ADD_TO_SHELF'
      rifff: Rifff
      /** Each stem's own committed gain (DiscoverPanel's own per-slot volume
       * slider), keyed by stemKey(groupId, slot) -- optional and merged into
       * state.vol the same way PLACE_LOOP_ON_TIMELINE's own vol field is.
       * When a key is present here, it wins over this case's own sqrtGain
       * loudness-compensation default below -- Discover's own per-slot
       * gains are real, user-adjusted values already; silently
       * re-compensating them a second time would reintroduce exactly the
       * "secret hidden" volume behavior that was reverted from Discover
       * earlier (see docs/superpowers/specs/2026-09-16-discover-seed-stems-
       * design.md). Every existing caller (the Inspector's re-import-from-
       * folder flow) omits this field and keeps today's sqrtGain-default
       * behavior exactly unchanged. */
      vol?: Record<string, number>
    }
```

(Run `grep -n "type: 'ADD_TO_SHELF'" src/renderer/src/state/store.ts` first to find its exact
current line in the union type — it's declared once there, separately from the reducer `case`
block at line 564.)

- [ ] **Step 4: Update the reducer case**

In the `case 'ADD_TO_SHELF':` block (`store.ts:564-582` today), change the gain-assignment line
inside the `for` loop from:

```ts
        if (vol[key] === undefined) vol[key] = gain
```

to:

```ts
        if (vol[key] === undefined) vol[key] = action.vol?.[key] ?? gain
```

The rest of the case (the `sqrtGain(action.rifff.stems.length)` computation, the
`{ ...state.vol }` copy, the `rifffs` update) stays exactly as-is.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/state/store.test.ts`

Expected: PASS — all tests in this file, including the new one.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts`

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "$(cat <<'EOF'
ADD_TO_SHELF: accept an optional per-stem vol override

Discover's new "add to shelf" button (next task) needs to seed the
shelf with its own already-real per-slot gains, not the generic
sqrtGain loudness compensation this action applies by default -- that
compensation exists for callers with no gain opinion of their own
(e.g. a plain library import), and re-applying it on top of gains a
user already set in Discover would silently make things quieter than
intended, the same "secret hidden" volume behavior already reverted
from Discover once this session.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 2: Extract `resolveDiscoverRifff()`, rename to `addToTimeline`, add `addToShelf`

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

Re-read `DiscoverPanel.tsx` fresh before starting — specifically: the `placing`/`justPlunked`
state declarations (today around lines 938-947), the `plunkInArranger` function (today lines
1323-1420), the `discover-plunk-pulse` keyframe (today around line 1447-1451), and the plunk
button's own JSX (today around lines 1726-1742). Confirm the line numbers below still match;
if they've drifted, use the grep output to find the real current location instead of guessing.

- [ ] **Step 1: Add `Rifff` and `DiscoverRifffAssembly` to the existing type imports**

`DiscoverPanel.tsx` already imports from `@shared/types` (today: `import { type ProjectRef,
type SoundType, type Stem, stemKey } from '@shared/types'`) and from
`../audio/discoverRifffAssembly` (today: `import { assembleDiscoverRifff } from
'../audio/discoverRifffAssembly'`). Add `Rifff` to the first, and `type
DiscoverRifffAssembly` to the second:

```ts
import { type ProjectRef, type SoundType, type Stem, type Rifff, stemKey } from '@shared/types'
```

```ts
import { assembleDiscoverRifff, type DiscoverRifffAssembly } from '../audio/discoverRifffAssembly'
```

(`Rifff` isn't actually used directly in this task's new code below — `DiscoverRifffAssembly`
already carries it — but add it anyway only if your editor/lint flags an unused import;
otherwise skip the `Rifff` half of this step. Verify with `npx eslint` in Step 6 below rather
than guessing.)

- [ ] **Step 2: Rename the confirmation state, keep the shape doubled for two buttons**

Find today's:

```ts
  const [placing, setPlacing] = useState(false)
  // Direct report, 2026-09-16: "plunk in arranger doesn't have much of a
  // confirmation thing.. can we indicate it works somehow? maybe a subtle
  // microanimation" -- a brief, one-shot ring pulse on the button itself
  // right after a successful placement, matching this session's own
  // established "subtle quick microanimation" preference and reusing the
  // exact pattern ClusterStemsBrowser.tsx's own celebratingRow already
  // uses for the same purpose (a box-shadow ring, 500ms ease-out, cleared
  // by its own timeout rather than an animationend round-trip).
  const [justPlunked, setJustPlunked] = useState(false)
```

Replace with:

```ts
  // In-flight + just-succeeded tracking for BOTH "add to timeline" and "add
  // to shelf" -- independent per button (clicking one doesn't disable or
  // animate the other), same disabled/label-swap convention as
  // rerollingSlotIds above, just two single booleans instead of a per-slot
  // Set since there's only ever one of each button.
  //
  // Direct report, 2026-09-17: "right now the glow isn't enough to
  // convince someone that something has happened, it just feels like a
  // failed process" -- the box-shadow pulse alone (discover-add-pulse,
  // below -- was discover-plunk-pulse) wasn't legible enough on its own.
  // justAddedToTimeline/justAddedToShelf now ALSO swap the button's own
  // label to "✓ added" for the same 500ms window, which is the primary
  // confirmation signal; the pulse stays as a supplementary accent.
  const [addingToTimeline, setAddingToTimeline] = useState(false)
  const [addingToShelf, setAddingToShelf] = useState(false)
  const [justAddedToTimeline, setJustAddedToTimeline] = useState(false)
  const [justAddedToShelf, setJustAddedToShelf] = useState(false)
```

- [ ] **Step 3: Extract `resolveDiscoverRifff()` and add `stopPreviewIfPlaying()`**

Find today's `plunkInArranger` function (starts `async function plunkInArranger(): Promise<void> {`).
Immediately BEFORE it, add two new functions:

```ts
  // Shared by addToTimeline and addToShelf below -- resolves every
  // placeable slot's own candidate down to a real stem and assembles them
  // into one Rifff, exactly the "which slots are ready, what's their real
  // gain" logic both actions need identically. Returns null when there's
  // nothing placeable yet (no slots resolved, or every resolve failed) --
  // callers early-return on null rather than dispatching an empty rifff.
  async function resolveDiscoverRifff(): Promise<DiscoverRifffAssembly | null> {
    // Direct report, 2026-09-16: "when user plunks to the timeline, the
    // volume levels should be copied over pls" -- root cause traced to
    // something bigger than just gain: this filter used to require a real
    // `candidate`, silently excluding every seedStem-only slot
    // (Shelf-sourced, or anything seeded and never since rerolled) -- not
    // placed at all, so naturally its own gain (along with everything else
    // about it) never made it onto the timeline either. A seedStem is
    // already a real, fully resolved `ResolvedCandidateStem` -- no
    // resolveCandidateStem await needed for it, unlike a candidate-based
    // slot.
    const placeable = slots.filter((s) => s.candidate !== null || s.seedStem !== undefined)
    if (placeable.length === 0) return null

    const resolved = await Promise.all(
      placeable.map(
        async ({
          candidate,
          seedStem,
          gain
        }): Promise<{ stem: ResolvedCandidateStem; gain: number } | null> => {
          const stem = candidate ? await resolveCandidateStem(candidate) : (seedStem ?? null)
          return stem ? { stem, gain } : null
        }
      )
    )
    const placed = resolved.filter(
      (r): r is { stem: ResolvedCandidateStem; gain: number } => r !== null
    )
    if (placed.length === 0) return null

    const roles = [...new Set(placeable.map((s) => s.role))]
    return assembleDiscoverRifff(
      `discover: ${roles.join('+')}`,
      placed.map(({ stem, gain }) => ({ stem, gain })),
      bpm
    )
  }

  // Shared by addToTimeline and addToShelf below -- stops the Discover
  // preview loop once an action has actually placed/shelved something, so
  // the confirmation (button label swap, just below) is clearly seen
  // instead of competing with ongoing playback. Direct report, 2026-09-17:
  // "i think to make it seem like it worked, i think the loop needs to
  // stop." Deliberately called AFTER a successful dispatch, not before --
  // a click that resolves to nothing placeable (resolveDiscoverRifff()
  // returned null) shouldn't interrupt playback for no reason.
  function stopPreviewIfPlaying(): void {
    if (playing) dispatch({ type: 'PAUSE' })
  }

```

- [ ] **Step 4: Replace `plunkInArranger` with `addToTimeline`, using the extracted helper**

Replace the whole `plunkInArranger` function body's resolve/assemble half (the part from
`const placeable = slots.filter(...)` down through `const { rifff, vol } = assembly`) with a
call to the new helper, and rename the function itself. The full new function:

```ts
  async function addToTimeline(): Promise<void> {
    setAddingToTimeline(true)
    try {
      const assembly = await resolveDiscoverRifff()
      if (!assembly) return
      const { rifff, vol } = assembly

      // Appends after the furthest-right currently-placed clip, matching
      // "adds alongside, never replaces" from the design spec's own §8.4 --
      // never touches an existing rifff's own startBar.
      const placedEnds = Object.values(rifffsState)
        .filter((r) => r.startBar !== undefined)
        .map((r) => (r.startBar ?? 0) + r.barLength)
      const startBar = placedEnds.length > 0 ? Math.max(...placedEnds) : 0

      dispatch({ type: 'PLACE_LOOP_ON_TIMELINE', stems: [rifff], startBar, vol })
      // Deliberately NOT restorePreviewIfLoaded()/flushEngineSyncNow() here
      // -- the dispatch above already changes state.rifffs, which the
      // existing, separate coalesced engine-sync effect in StoreContext.tsx
      // picks up and re-sends on its own. Just resetting these two refs
      // means the NEXT slot change (if the user keeps building right after
      // placing) correctly starts a fresh preview rather than assuming a
      // still-loaded one that the real sync effect already silently
      // overwrote.
      //
      // releaseEngine() IS still required here, though (added after code
      // review): that automatic coalesced sync effect now SKIPS its own
      // send entirely while something holds engine ownership (see
      // StoreContext.tsx's own scheduleEngineSync gating, added earlier in
      // this same plan) -- without releasing here, this function's own
      // 'discover-preview' claim (from whatever syncPreviewToEngine call
      // last ran) stays held, and the automatic sync's state.rifffs-change
      // pickup described above would silently no-op instead of actually
      // reaching the engine. This also closes the SAME straggling-call
      // race the previewSyncGenerationRef bump just below already guards
      // against, belt-and-suspenders: an in-flight syncPreviewToEngine
      // call that claimed ownership before this function ran will find its
      // own token stale (stillOwnEngine returns false) the moment it
      // resumes after its own await, since release() here bumps the same
      // shared generation.
      releaseEngine()
      previewLoadedRef.current = false
      currentPreviewMappingRef.current = null
      // Real bug, found by review: an already-in-flight syncPreviewToEngine
      // call (e.g. kicked off moments ago by a bpm change or a reroll
      // landing) is still awaiting buildEngineProject/engineLoadProject
      // right now, and its own generation was still valid as of the top of
      // THIS function -- resetting the tracking refs above does nothing to
      // stop it from landing right after PLACE_LOOP_ON_TIMELINE and
      // clobbering the real project we just placed with its now-stale
      // throwaway preview one (plus possibly re-triggering the empty-to-
      // non-empty pause/seek/play sequence and leaving
      // currentPreviewMappingRef pointing at stale data). Bumping the SAME
      // generation ref syncPreviewToEngine itself checks after each of its
      // own awaits makes that straggling call's post-await check fail, so
      // it bails out harmlessly instead.
      previewSyncGenerationRef.current += 1
      stopPreviewIfPlaying()
      setJustAddedToTimeline(true)
      window.setTimeout(() => setJustAddedToTimeline(false), 500)
    } finally {
      setAddingToTimeline(false)
    }
  }

  // Same underlying build as addToTimeline above, but stops after adding
  // the assembled loop to the shelf (ADD_TO_SHELF) instead of placing it on
  // the arranger -- direct request, 2026-09-17: "let's also have a button
  // to Add to Shelf, which just adds it to the shelf and not the
  // arrangement proper." Passes the SAME real per-slot vol map
  // resolveDiscoverRifff() already computed, so ADD_TO_SHELF's own
  // sqrtGain loudness-compensation default (store.ts) never kicks in for
  // these stems -- see that reducer case's own doc comment.
  async function addToShelf(): Promise<void> {
    setAddingToShelf(true)
    try {
      const assembly = await resolveDiscoverRifff()
      if (!assembly) return
      const { rifff, vol } = assembly
      dispatch({ type: 'ADD_TO_SHELF', rifff, vol })
      stopPreviewIfPlaying()
      setJustAddedToShelf(true)
      window.setTimeout(() => setJustAddedToShelf(false), 500)
    } finally {
      setAddingToShelf(false)
    }
  }
```

Delete the old `plunkInArranger` function entirely (everything from `async function
plunkInArranger(): Promise<void> {` through its closing `}`) — it's now fully replaced by
`resolveDiscoverRifff` (Step 3) + `addToTimeline` (above).

- [ ] **Step 5: Rename the keyframe and update the button JSX**

Find the `discover-plunk-pulse` keyframe (inside the `<style>{\`...\`}</style>` block, today
around line 1447):

```css
        @keyframes discover-plunk-pulse {
          0% { box-shadow: 0 0 0 0 var(--ra-stretch-on); }
          35% { box-shadow: 0 0 0 3px var(--ra-stretch-on); }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
```

Rename to `discover-add-pulse` (identical keyframe body, just the name):

```css
        @keyframes discover-add-pulse {
          0% { box-shadow: 0 0 0 0 var(--ra-stretch-on); }
          35% { box-shadow: 0 0 0 3px var(--ra-stretch-on); }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
```

Find today's plunk button JSX (around line 1726-1742):

```tsx
        <button
          onClick={() => void plunkInArranger()}
          disabled={placing}
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            padding: '6px 14px',
            background: 'var(--ra-stretch-on-bg)',
            border: '1px solid var(--ra-stretch-on)',
            color: placing ? 'var(--ra-text-4)' : 'var(--ra-stretch-on)',
            fontWeight: 700,
            cursor: placing ? 'default' : 'pointer',
            animation: justPlunked ? 'discover-plunk-pulse 500ms ease-out' : undefined
          }}
        >
          {placing ? 'placing…' : 'plunk in arranger'}
        </button>
```

Replace with (this becomes the "add to timeline" button — its own placement in the two-row
toolbar happens in Task 3, so for now just get this JSX correct in place, in the same spot):

```tsx
        <button
          onClick={() => void addToTimeline()}
          disabled={addingToTimeline}
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            padding: '6px 14px',
            background: 'var(--ra-stretch-on-bg)',
            border: '1px solid var(--ra-stretch-on)',
            color: addingToTimeline ? 'var(--ra-text-4)' : 'var(--ra-stretch-on)',
            fontWeight: 700,
            cursor: addingToTimeline ? 'default' : 'pointer',
            animation: justAddedToTimeline ? 'discover-add-pulse 500ms ease-out' : undefined
          }}
        >
          {addingToTimeline ? 'adding…' : justAddedToTimeline ? '✓ added' : 'add to timeline'}
        </button>
        <button
          onClick={() => void addToShelf()}
          disabled={addingToShelf}
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            padding: '6px 14px',
            background: 'transparent',
            border: '1px solid var(--ra-border-strong)',
            color: addingToShelf ? 'var(--ra-text-4)' : 'var(--ra-text)',
            fontWeight: 700,
            cursor: addingToShelf ? 'default' : 'pointer',
            animation: justAddedToShelf ? 'discover-add-pulse 500ms ease-out' : undefined
          }}
        >
          {addingToShelf ? 'adding…' : justAddedToShelf ? '✓ added' : 'add to shelf'}
        </button>
```

(Task 3 moves this pair — and reorders which comes first — into the new second toolbar row;
this step only needs the JSX itself to be correct, not yet in its final row/position.)

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/DiscoverPanel.tsx`

Expected: no errors. If eslint flags the `Rifff` import from Step 1 as unused, remove that half
of the import change (keep `DiscoverRifffAssembly`, which IS used).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
Discover: rename plunk-in-arranger to add-to-timeline, add add-to-shelf

Extracts the resolve+assemble logic both actions share
(resolveDiscoverRifff), adds a shared stopPreviewIfPlaying() helper so
the preview loop visibly stops once something is actually placed or
shelved, and gives each button its own busy/just-succeeded state so
the button's own label reads "✓ added" for a beat instead of relying
on the existing box-shadow pulse alone -- direct report: "right now
the glow isn't enough to convince someone that something has
happened, it just feels like a failed process."

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 3: Split the toolbar into two rows

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

Re-read the toolbar's current JSX fresh before starting — after Task 2's edits, grep for
`chaos` or `tight/loose` (`grep -n "tight" src/renderer/src/components/DiscoverPanel.tsx`) to
find the row's real current start, and confirm it still runs through the reroll-all button and
the two new add-to-timeline/add-to-shelf buttons from Task 2, all inside one `<div style={{
display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>`.

- [ ] **Step 1: Close the first row after the checkboxes, open a second row for the rest**

Find the closing `</label>` of the "prefer favourites" checkbox (today's JSX, unchanged by
Task 2):

```tsx
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
            checked={preferFavourites}
            title="favourited stems (star icon on a resolved slot) are weighted more likely to come up on roll/reroll -- never the only ones that can, just more often"
            onChange={(e) => setPreferFavourites(e.target.checked)}
          />
          prefer favourites
        </label>
```

Immediately after this `</label>` and before the undo button's own comment/JSX, close the
outer row `<div>` and open a new one:

```tsx
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
```

- [ ] **Step 2: Move `marginLeft: 'auto'` from the undo button to a new filler, right before the two action buttons**

Find the undo button (today, right after the new row-opening `<div>` from Step 1):

```tsx
        <button
          onClick={undoDiscoverAction}
          disabled={undoStack.length === 0}
          title="undo"
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            padding: 0,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: undoStack.length === 0 ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
            cursor: undoStack.length === 0 ? 'default' : 'pointer'
          }}
        >
          <UndoIcon />
        </button>
```

Remove `marginLeft: 'auto',` from this button's style — with row 1's own content gone (now on
its own row), undo no longer needs to push itself right; it starts this row's own left-aligned
group instead:

```tsx
        <button
          onClick={undoDiscoverAction}
          disabled={undoStack.length === 0}
          title="undo"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            padding: 0,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: undoStack.length === 0 ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
            cursor: undoStack.length === 0 ? 'default' : 'pointer'
          }}
        >
          <UndoIcon />
        </button>
```

Then, immediately after the reroll-all button's closing `</button>` and immediately before the
"add to shelf"/"add to timeline" pair (from Task 2, Step 5), add a filler span carrying the
`marginLeft: 'auto'` instead:

```tsx
        <span style={{ marginLeft: 'auto' }} />
```

- [ ] **Step 3: Reorder so "add to shelf" comes before "add to timeline"**

Task 2's Step 5 placed both buttons in timeline-then-shelf order (matching where the original
single plunk button was). Confirm — and if needed, swap — so the JSX order after the new
filler span is: "add to shelf" button, then "add to timeline" button (secondary action first,
primary action last/rightmost, matching the approved mockup):

```tsx
        <span style={{ marginLeft: 'auto' }} />
        <button
          onClick={() => void addToShelf()}
          disabled={addingToShelf}
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            padding: '6px 14px',
            background: 'transparent',
            border: '1px solid var(--ra-border-strong)',
            color: addingToShelf ? 'var(--ra-text-4)' : 'var(--ra-text)',
            fontWeight: 700,
            cursor: addingToShelf ? 'default' : 'pointer',
            animation: justAddedToShelf ? 'discover-add-pulse 500ms ease-out' : undefined
          }}
        >
          {addingToShelf ? 'adding…' : justAddedToShelf ? '✓ added' : 'add to shelf'}
        </button>
        <button
          onClick={() => void addToTimeline()}
          disabled={addingToTimeline}
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            padding: '6px 14px',
            background: 'var(--ra-stretch-on-bg)',
            border: '1px solid var(--ra-stretch-on)',
            color: addingToTimeline ? 'var(--ra-text-4)' : 'var(--ra-stretch-on)',
            fontWeight: 700,
            cursor: addingToTimeline ? 'default' : 'pointer',
            animation: justAddedToTimeline ? 'discover-add-pulse 500ms ease-out' : undefined
          }}
        >
          {addingToTimeline ? 'adding…' : justAddedToTimeline ? '✓ added' : 'add to timeline'}
        </button>
      </div>
```

(That final `</div>` closes row 2 — it should be immediately followed by whatever came after
the toolbar today, e.g. the `{slots.length === 0 && (...)}` empty-state block.)

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/DiscoverPanel.tsx`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
Discover: split the toolbar into two rows

The single row (chaos slider, tempo controls, two checkboxes,
undo/redo, play/stop, reroll-all, plus now two action buttons) packed
in too many controls for one line -- direct report: "the top area is
cluttered with buttons currently, youll need to rethink it all." Row 1
keeps the filter/settings controls; row 2 keeps undo/redo/play/
reroll-all left-aligned and add-to-shelf/add-to-timeline right-aligned.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 4: Per-slot row CSS grid rework + button regrouping/relabeling

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx` (the `DiscoverSlotRow` function)

This is the largest task in this plan — one component's one render block, but a real
structural change. Re-read `DiscoverSlotRow`'s current return statement fresh before starting:
`grep -n "function DiscoverSlotRow" src/renderer/src/components/DiscoverPanel.tsx` to find its
current start, then read from its `return (` onward. The code quoted below matches what this
plan's own author verified immediately before writing this plan; confirm it still matches
before editing.

- [ ] **Step 1: Replace the outer row `<div>`'s flex styling with a grid**

Find:

```tsx
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 0',
          borderBottom: '1px solid var(--ra-border-soft)'
        }}
      >
```

Replace with:

```tsx
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '18px 18px 64px 14px 18px 18px 18px 14px 1fr 110px 14px auto auto auto',
          alignItems: 'center',
          columnGap: 8,
          padding: '8px 0',
          borderBottom: '1px solid var(--ra-border-soft)'
        }}
      >
```

(14 tracks: delete, lock, role label, gap, mute, solo, favourite, gap, waveform, preset name,
gap, similar, adjacent, random.)

- [ ] **Step 2: Move delete + lock to the front, right after the role label stays where it is relative to them**

Today's row starts with the lock button, then the role label, then the waveform. The new order
puts delete FIRST, then lock, then the role label (delete didn't exist yet at this point in the
row today — it's currently the LAST element in the row). Find today's remove/delete button
(currently near the end of the row, before the `nearbyMenu` popover's own conditional render):

```tsx
        <button
          onClick={onRemove}
          title="remove"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            padding: 0,
            fontFamily: 'inherit',
            fontSize: 10,
            fontWeight: 700,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: 'var(--ra-text-2)',
            cursor: 'pointer'
          }}
        >
          {/* Direct request, 2026-09-15: "an X for remove" -- icon-only, same
            as every other row button now. */}
          X
        </button>
```

Cut this whole button and paste it as the VERY FIRST child inside the grid `<div>` (before
today's lock button). Update its `title` to `data-tooltip` while you're here (this is also
covered by Task 5, but since you're touching this exact JSX now, do it in this task instead of
leaving a stray edit for Task 5 to rediscover):

```tsx
        <button
          onClick={onRemove}
          data-tooltip="remove"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            padding: 0,
            fontFamily: 'inherit',
            fontSize: 10,
            fontWeight: 700,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: 'var(--ra-text-2)',
            cursor: 'pointer'
          }}
        >
          X
        </button>
```

The lock button (today, right after the row's opening `<div>`) stays immediately after it,
just with `title` swapped to `data-tooltip`:

```tsx
        <button
          onClick={onToggleLock}
          data-tooltip={slot.locked ? 'locked -- survives reroll all' : 'unlocked'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            width: 18,
            height: 18,
            padding: 0,
            background: slot.locked ? 'var(--ra-stretch-on-bg)' : 'transparent',
            border: `1px solid ${slot.locked ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
            color: slot.locked ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
            cursor: 'pointer'
          }}
        >
          <LockGlyph locked={slot.locked} />
        </button>
```

(`flexShrink: 0` on this button is a no-op inside a grid track and harmless to leave as-is —
don't spend time removing it.)

The role label span stays immediately after lock, unchanged:

```tsx
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)', width: 64, flexShrink: 0 }}>
          {slot.role}
        </span>
```

- [ ] **Step 3: Insert an empty gap `<div>` after the role label, before mute/solo/favourite**

```tsx
        <div />
```

(This fills the grid's 4th column, the `14px` gap track — matches the "empty spacer div"
option the spec left as an implementer's call.)

- [ ] **Step 4: Move mute, solo, favourite to right after that gap — before the waveform**

Today, mute/solo/favourite live inside a `marginLeft: 'auto'` wrapper `<div>` positioned AFTER
the preset-name span (today's comment there explains it reserves a fixed width during
resolving). That wrapper and its own fixed-width/marginLeft styling are no longer needed — the
grid's own explicit column tracks now do that job. Find:

```tsx
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: 102,
            flexShrink: 0
          }}
        >
          {(resolvedStem !== null || slot.candidate !== null) && (
            <>
              <button
                onClick={onTogglePreview}
                title={
                  previewing ? 'playing in the loop -- click to mute' : 'muted -- click to unmute'
                }
                style={{
                  ...
                }}
              >
                m
              </button>
              <button
                onClick={onToggleSolo}
                title={soloed ? 'soloed -- click to hear everything again' : 'solo this slot'}
                style={{
                  ...
                }}
              >
                s
              </button>
              <button
                onClick={onToggleFavourite}
                title={favourited ? 'favourited -- click to unfavourite' : 'favourite this stem'}
                style={{
                  ...
                }}
              >
                <StarIcon favourited={favourited} />
              </button>
              {nearbyAnchor !== null && (
                <button
                  ref={nearbyButtonRef}
                  onClick={(e) => { ... }}
                  title="explore riffs recorded near this one in the same jam"
                  style={{
                    ...
                  }}
                >
                  <NearbyIcon />
                </button>
              )}
            </>
          )}
        </div>
```

Cut the mute, solo, and favourite `<button>` elements OUT of this wrapper (keep the nearby
button where it is for now — it moves in Step 7 below, to the right-hand text-button group).
Delete the wrapper `<div>` itself entirely (its `marginLeft`/fixed-`width` job is now the
grid's), but keep the `{(resolvedStem !== null || slot.candidate !== null) && (...)}` guard —
it still needs to wrap mute/solo/favourite (a slot with nothing resolved yet has nothing to
mute/solo/favourite). Since each of these three buttons now lives directly in the grid as its
own column, wrap each individually with the SAME guard condition rather than one shared
wrapper element (a grid can't conditionally skip a column's own space the way a flex
`<>...</>` fragment could — an unrendered grid item just leaves that track's content area
empty, which is fine and matches the resolving-placeholder comment's own "always reserve this
space" intent):

Paste this right after Step 3's gap `<div>`, BEFORE the waveform button/placeholder:

```tsx
        {(resolvedStem !== null || slot.candidate !== null) && (
          <button
            onClick={onTogglePreview}
            data-tooltip={
              previewing ? 'playing in the loop -- click to mute' : 'muted -- click to unmute'
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 10,
              fontWeight: 700,
              background: previewing ? 'var(--ra-bg-row-active)' : 'var(--ra-mute-on)',
              border: `1px solid ${previewing ? 'var(--ra-border)' : 'var(--ra-mute-on)'}`,
              color: previewing ? 'var(--ra-text-2)' : 'var(--ra-mute-on-ink)',
              cursor: 'pointer'
            }}
          >
            m
          </button>
        )}
        {(resolvedStem !== null || slot.candidate !== null) && (
          <button
            onClick={onToggleSolo}
            data-tooltip={soloed ? 'soloed -- click to hear everything again' : 'solo this slot'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 10,
              fontWeight: 700,
              background: soloed ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
              border: `1px solid ${soloed ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
              color: soloed ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            s
          </button>
        )}
        {(resolvedStem !== null || slot.candidate !== null) && (
          <button
            onClick={onToggleFavourite}
            data-tooltip={favourited ? 'favourited -- click to unfavourite' : 'favourite this stem'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              padding: 0,
              background: 'var(--ra-bg-row-active)',
              border: `1px solid ${favourited ? 'var(--ra-recording-live)' : 'var(--ra-border)'}`,
              color: favourited ? 'var(--ra-recording-live)' : 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            <StarIcon favourited={favourited} />
          </button>
        )}
        <div />
```

The trailing `<div />` fills the grid's next `14px` gap column (between favourite and the
waveform).

- [ ] **Step 5: Waveform button and resolving/failed placeholder — same content, `title` swapped to `data-tooltip`**

The big waveform `<button>` (when `resolvedStem` exists) and the dashed placeholder `<div>`
(when it doesn't) stay exactly where they are relative to the rest of the row — the grid's 8th
column (`1fr`) is exactly this element, same as it was the flexible `flex: '1 1 auto'` element
before. Only change: swap `title` to `data-tooltip` on both.

Waveform button — find:

```tsx
          <button
            onClick={onTogglePreview}
            onMouseDown={handleGainDragStart}
            title={
              (previewing
                ? 'playing in the loop -- click to remove'
                : 'click to add to the loop preview') +
              ` · drag to adjust volume (${Math.round(slot.gain * 100)}%)`
            }
```

Change `title` to `data-tooltip` (value unchanged):

```tsx
          <button
            onClick={onTogglePreview}
            onMouseDown={handleGainDragStart}
            data-tooltip={
              (previewing
                ? 'playing in the loop -- click to remove'
                : 'click to add to the loop preview') +
              ` · drag to adjust volume (${Math.round(slot.gain * 100)}%)`
            }
```

Placeholder div — find:

```tsx
          <div
            title={
              resolving
                ? 'downloading + analyzing…'
                : resolveFailed
                  ? "couldn't load this stem -- try reroll"
                  : undefined
            }
```

Change to:

```tsx
          <div
            data-tooltip={
              resolving
                ? 'downloading + analyzing…'
                : resolveFailed
                  ? "couldn't load this stem -- try reroll"
                  : undefined
            }
```

(`data-tooltip={undefined}` renders no attribute at all, same as `title={undefined}` did —
this is a safe swap with no behavior change beyond the tooltip mechanism itself.)

Everything else about the waveform button and placeholder (the tiled-waveform rendering logic,
`LoadingLoader`, etc.) is untouched.

- [ ] **Step 6: Preset name span, unchanged, then a gap `<div>`**

The preset name `<span>` (fixed `width: 110`) stays exactly as it is today, immediately after
the waveform/placeholder. Its own comment about reserving a constant width is now partially
redundant (the grid's own `110px` track already guarantees this), but leave the comment as-is
— it's still accurate background even if the grid also enforces it now; don't spend time
editing comments that aren't wrong, just no longer load-bearing on their own.

Immediately after the preset name span, add another gap `<div />` (fills the grid's 11th
column, between the name and the similar/adjacent/random group):

```tsx
        <div />
```

- [ ] **Step 7: Replace reroll (shuffle), nearby, and reroll-random (dice) with three text buttons — "similar" / "adjacent" / "random"**

Find today's reroll button (an icon button using `<ShuffleIcon />`, today positioned after the
button-group wrapper Step 4 already removed):

```tsx
        <button
          onClick={onReroll}
          disabled={rerolling}
          title={
            rerolling
              ? slot.candidate
                ? 'rerolling…'
                : 'rolling…'
              : slot.candidate
                ? 'reroll'
                : 'roll'
          }
          style={{
            marginLeft: resolvedStem ? 0 : 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            padding: 0,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: rerolling ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
            cursor: rerolling ? 'default' : 'pointer'
          }}
        >
          <ShuffleIcon />
        </button>
```

Find today's reroll-random button (`<DiceIcon />`):

```tsx
        <button
          onClick={onRerollRandom}
          disabled={rerolling}
          title="random -- skip role matching, pick any random stem from your own library"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            padding: 0,
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: rerolling ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
            cursor: rerolling ? 'default' : 'pointer'
          }}
        >
          <DiceIcon />
        </button>
```

And the nearby button (`<NearbyIcon />`, cut from Step 4's old wrapper but not yet pasted
anywhere — paste it now as part of this trio):

```tsx
        {nearbyAnchor !== null && (
          <button
            ref={nearbyButtonRef}
            onClick={(e) => {
              if (nearbyMenu) {
                closeNearbyMenu()
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              setNearbyMenu({ x: rect.left, y: rect.bottom + 4 })
            }}
            title="explore riffs recorded near this one in the same jam"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              padding: 0,
              background: nearbyMenu ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
              border: `1px solid ${nearbyMenu ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
              color: nearbyMenu ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            <NearbyIcon />
          </button>
        )}
```

Replace all three of the above with these three plain-text buttons, in this exact order
(similar, adjacent, random — matching the approved mockup), placed right after Step 6's gap
`<div>`, right before the grid `<div>`'s own closing `</div>`:

```tsx
        <button
          onClick={onReroll}
          disabled={rerolling}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'inherit',
            fontSize: 9,
            padding: '3px 7px',
            whiteSpace: 'nowrap',
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: rerolling ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
            cursor: rerolling ? 'default' : 'pointer'
          }}
        >
          {rerolling ? 'similar…' : 'similar'}
        </button>
        {nearbyAnchor !== null && (
          <button
            ref={nearbyButtonRef}
            onClick={(e) => {
              if (nearbyMenu) {
                closeNearbyMenu()
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              setNearbyMenu({ x: rect.left, y: rect.bottom + 4 })
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'inherit',
              fontSize: 9,
              padding: '3px 7px',
              whiteSpace: 'nowrap',
              background: nearbyMenu ? 'var(--ra-stretch-on-bg)' : 'transparent',
              border: `1px solid ${nearbyMenu ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
              color: nearbyMenu ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            adjacent
          </button>
        )}
        <button
          onClick={onRerollRandom}
          disabled={rerolling}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'inherit',
            fontSize: 9,
            padding: '3px 7px',
            whiteSpace: 'nowrap',
            background: 'transparent',
            border: '1px solid var(--ra-border)',
            color: rerolling ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
            cursor: rerolling ? 'default' : 'pointer'
          }}
        >
          random
        </button>
```

Note the removed `marginLeft: resolvedStem ? 0 : 'auto'` from the old reroll button's style —
that existed to push the button right when the row had no fixed trailing columns yet (an empty
slot's row was shorter); the grid's own fixed `auto auto auto` trailing columns make that
unnecessary now, these three buttons always sit in the same place regardless of the row's
other content.

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/DiscoverPanel.tsx`

Expected: no errors. If `ShuffleIcon`/`DiceIcon`/`NearbyIcon` are now unused anywhere else in
this file, eslint's `no-unused-vars` (or similar) will flag their imports/definitions — check
with `grep -n "ShuffleIcon\|DiceIcon\|NearbyIcon" src/renderer/src/components/DiscoverPanel.tsx`
first: `ShuffleIcon` is still used by the toolbar's own reroll-all button (Task 3 didn't touch
it), so its definition stays. If `DiceIcon` and/or `NearbyIcon` have no remaining callers
anywhere in the file, remove their now-dead function definitions (don't leave unused code
behind) — but confirm via grep before deleting either.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
Discover: CSS grid per-slot row, regroup + relabel buttons

Replaces DiscoverSlotRow's flexbox-with-hand-pinned-widths layout
with a real CSS grid (explicit column tracks), so columns line up
row-to-row regardless of content length -- direct request: "use a
grid for the modal.. to make sure things stay in their places."
Regroups delete+lock+role to the left, mute/solo/favourite next, then
the waveform/name, then a right-hand group -- and relabels that
group's three icon-only buttons (shuffle/nearby/dice) as plain text:
"similar" / "adjacent" / "random", settled on after discussing several
alternatives directly ("roll and reroll.. it's not clear what that
means").

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 5: Convert the toolbar's remaining icon-only buttons to `data-tooltip`

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

Task 4 already converted every per-slot-row button (lock, mute, solo, favourite, delete,
waveform, placeholder) as part of moving them — this task is only the three toolbar buttons
that are unaffected by Tasks 3-4's edits.

- [ ] **Step 1: Undo, redo, play/stop**

Find (today, in the toolbar's second row after Task 3):

```tsx
          title="undo"
```

on the undo button, and change to:

```tsx
          data-tooltip="undo"
```

Find:

```tsx
          title="redo"
```

on the redo button, and change to:

```tsx
          data-tooltip="redo"
```

Find:

```tsx
          title={playing ? 'stop the discover preview' : 'play the discover preview'}
```

on the play/stop button, and change to:

```tsx
          data-tooltip={playing ? 'stop the discover preview' : 'play the discover preview'}
```

Leave `aria-label` on all three exactly as it is (unrelated to the visual tooltip mechanism,
same convention as the original 2026-09-16 pass).

**Confirm these are the only remaining conversions needed** by running:

```bash
grep -n "title=" src/renderer/src/components/DiscoverPanel.tsx
```

Expected remaining `title=` hits after this task: only the "match seed (120)" button, the
"only my stems" checkbox's disabled-reason tooltip, and the "prefer favourites" checkbox's
descriptive tooltip — all three explicitly out of scope per the design spec §5 (not icon-only
buttons). If anything else shows up, it means Task 4 missed a conversion — go back and convert
it there instead of here (Task 4's commit should own every per-slot-row change).

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npx eslint --cache src/renderer/src/components/DiscoverPanel.tsx`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "$(cat <<'EOF'
Discover: fast tooltips for undo/redo/play-stop

Finishes converting Discover's icon-only buttons to the fast
data-tooltip mechanism -- direct report: "not all of the buttons have
the fast tooltip, that would be good." Every per-slot-row button was
already covered as part of the grid rework in the previous commit;
this covers the three remaining toolbar buttons.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MRx9ZiTveSQ29tY1LAy7XP
EOF
)"
```

---

### Task 6: Full test suite + manual-walkthrough checklist

**Files:** none (verification only)

This task is NOT a normal code task — there's no diff to review beyond confirming the full
test run actually happened and the checklist text below was actually handed back to Elling.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all tests pass (aside from this session's own known, pre-existing, unrelated flake in
a "live reschedule: load-project while already playing" test — if that's the ONLY failure, re-run
once; a clean pass on re-run confirms it's the known flake, not a regression from this plan).

- [ ] **Step 2: Run a final typecheck + lint sweep over every file this plan touched**

Run:

```bash
npm run typecheck
npx eslint --cache src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
```

Expected: no errors.

- [ ] **Step 3: Report the manual-walkthrough checklist back to Elling**

This environment cannot click through the real Electron app — report back exactly this
checklist, flagged as needing his own hands-on confirmation:

- [ ] Toolbar shows two rows; nothing wrapped/clipped at a normal window width
- [ ] "add to shelf" adds the built loop to the shelf only (not the arranger), with the correct
      real per-slot gains (not re-compensated/quieter than expected)
- [ ] "add to timeline" places the loop on the arranger, same as today's plunk behavior, just
      relabeled
- [ ] Both buttons: preview loop stops on click (if it was playing), button label reads
      "✓ added" briefly, then reverts
- [ ] Per-slot row: delete/lock left, mute/solo/favourite next, waveform, name, then
      similar/adjacent/random on the right — columns line up row to row across slots with very
      different preset-name lengths
- [ ] "similar"/"adjacent"/"random" behave exactly as today's shuffle/nearby/dice buttons did
- [ ] Hover every converted button (toolbar undo/redo/play-stop; per-slot lock/mute/solo/
      favourite/delete/waveform) — tooltip appears instantly, no native-OS delay

No commit for this task (nothing changes).

---

## Self-Review

**1. Spec coverage:**
- §2.1 rename → Task 2. §2.2 shared helper + addToShelf + store change → Task 1 (store) +
  Task 2 (helper/functions). §2.3 confirmation feedback → Task 2. §3 toolbar two rows → Task 3.
  §4 grid rework + regrouping + relabeling → Task 4. §5 tooltip conversions → Task 4 (per-slot,
  bundled into the move) + Task 5 (toolbar). §6 testing → Task 1's TDD step + Task 6's final
  sweep + checklist. Every spec section has a task. No gaps.

**2. Placeholder scan:** no TBD/TODO; every code step shows real, complete code (not
"similar to Task N" — Tasks 2-5 each spell out the full before/after JSX even where it
duplicates surrounding context, since implementers may work out of order).

**3. Type consistency:** `addingToTimeline`/`addingToShelf`/`justAddedToTimeline`/
`justAddedToShelf` (Task 2) are the only new state names, used identically in Task 3's JSX
relocation — no renaming drift. `resolveDiscoverRifff()`'s return type (`DiscoverRifffAssembly
| null`, reusing the existing exported interface from `discoverRifffAssembly.ts` rather than
inventing a new inline shape) is used consistently by both `addToTimeline` and `addToShelf` in
Task 2. The `ADD_TO_SHELF` action's new `vol?: Record<string, number>` field (Task 1) matches
exactly how Task 2's `addToShelf()` dispatches it (`{ type: 'ADD_TO_SHELF', rifff, vol }`).

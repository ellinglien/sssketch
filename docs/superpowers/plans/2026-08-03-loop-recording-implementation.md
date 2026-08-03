# Loop Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dedicated recording channel that captures live audio input (any device the user picks) using a loop-pedal model: a user-defined loop region on the Ruler plays and re-records on every pass while armed, and disarming keeps whichever pass most recently completed, placed as a normal clip on that channel.

**Architecture:** New renderer state (`loopRegion`, `recordingChannelIds`, `armedChannelId`, `availableInputDevices`, `selectedInputDevice`) drives a new "r" arm toggle on `ChannelRow`. The native engine gains real audio input capture for the first time (`Transport`'s audio callback currently ignores input entirely) via a new `LoopRecorder` class, driven by a second, independent instance of the loop-wrap math `Transport::renderLoopAware` already uses for the project's own `loopLengthBars` — pass-boundary detection is fully native/audio-thread, no IPC round-trip. Disarming writes the completed pass to a temp WAV and replies with its path; the renderer imports it through a new `importRecordedTake` sibling to the existing `importOneShot`, then places it via the existing `ADD_TO_SHELF`/`MOVE_TO_CHANNEL` actions — no new transfer format needed.

**Tech Stack:** TypeScript/React (renderer), Node/Electron (main process), C++/JUCE (native engine), Vitest + JUCE `UnitTestRunner`.

Full design context: `docs/superpowers/specs/2026-08-03-loop-recording-design.md`. Read that first if anything below seems to assume context — it has the full rationale for every decision here, including two corrections made after this plan's own research phase re-read the actual `Transport.cpp`/`IpcServer.cpp` more carefully than the first draft did.

**Native engine reminder (see this repo's own CLAUDE.md):** the native engine does NOT hot-reload. After Tasks 7-9 (the ones touching `native-engine/Source/`), rebuild (`cd native-engine && cmake --build build`) and fully quit (Cmd+Q) + relaunch the Electron app before manually testing — a renderer reload alone will not pick up engine changes.

---

### Task 1: Loop region state + reducer action

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/serialize.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write the failing test**

Find the test file's existing `describe` blocks (any one will do as an anchor) and add:

```ts
describe('SET_LOOP_REGION', () => {
  it('sets the loop region', () => {
    const next = reducer(initialState, {
      type: 'SET_LOOP_REGION',
      region: { startBar: 4, endBar: 12 }
    })
    expect(next.loopRegion).toEqual({ startBar: 4, endBar: 12 })
  })

  it('clears the loop region when given null', () => {
    const withRegion = reducer(initialState, {
      type: 'SET_LOOP_REGION',
      region: { startBar: 4, endBar: 12 }
    })
    const cleared = reducer(withRegion, { type: 'SET_LOOP_REGION', region: null })
    expect(cleared.loopRegion).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "SET_LOOP_REGION"`
Expected: FAIL — `loopRegion` isn't part of `AppState`, `SET_LOOP_REGION` isn't a valid `Action`.

- [ ] **Step 3: Add the field to `AppState` and `initialState`**

Find (in `store.ts`, inside `export interface AppState {`):

```ts
  exp: Record<string, boolean>
```

Replace with:

```ts
  exp: Record<string, boolean>
  /** The loop-recording region, in bars — null until the user first drags
   * one out on the Ruler. Independent of loopLengthBars (the whole
   * project's own wrap point, computed from placed clips) -- this can be
   * shorter, longer, or positioned anywhere. See
   * docs/superpowers/specs/2026-08-03-loop-recording-design.md. */
  loopRegion: { startBar: number; endBar: number } | null
```

Find:

```ts
  exp: {},
```

Replace with:

```ts
  exp: {},
  loopRegion: null,
```

- [ ] **Step 4: Add the action type**

Find:

```ts
  | { type: 'LOAD_STATE'; state: AppState }
```

Replace with:

```ts
  | { type: 'SET_LOOP_REGION'; region: { startBar: number; endBar: number } | null }
  | { type: 'LOAD_STATE'; state: AppState }
```

- [ ] **Step 5: Add the reducer case**

Find (the `case 'LOAD_STATE':` case — add the new case immediately before it; if you can't find `LOAD_STATE` easily, any existing `case` block's closing `}` is a fine insertion point immediately before it):

```ts
    case 'LOAD_STATE':
```

Replace with:

```ts
    case 'SET_LOOP_REGION':
      return { ...state, loopRegion: action.region }

    case 'LOAD_STATE':
```

- [ ] **Step 6: Exclude nothing new from persistence — loopRegion IS saved**

No change needed in `serialize.ts` for this field: a loop region is deliberate arrangement content (like a placed clip), not transient UI-mode state, so it belongs in `PersistedProject` by default (anything not explicitly `Omit`-ed is persisted). Confirm this by reading `serialize.ts`'s `PersistedProject` type and `serializeProject`'s destructure — `loopRegion` should NOT appear in either. This step is a verification, not an edit.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "SET_LOOP_REGION"`
Expected: PASS (both tests).

- [ ] **Step 8: Run the full suite, typecheck, and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all succeed.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "Add loopRegion state and SET_LOOP_REGION action"
```

---

### Task 2: Loop region UI on the Ruler

**Files:**
- Modify: `src/renderer/src/components/Ruler.tsx`

No new tests (React components aren't unit-tested directly in this codebase — see Testing conventions in this repo's CLAUDE.md). Verified by typecheck/lint here, manual walkthrough in Task 12.

- [ ] **Step 1: Read the current file in full before editing**

`Ruler.tsx` was last touched this session for the frameScale fix — re-read it now (`Read` tool) to get exact current line numbers before writing Find/Replace blocks, since the exact text below assumes today's post-frameScale-fix version.

- [ ] **Step 2: Add props and imports**

Find:

```ts
import { useDispatch, usePlaying } from '../state/StoreContext'
import { startPointerDrag } from './dragUtils'
import { useFrameScale, toLogicalX } from '../state/FrameScaleContext'
import { markManualSeek } from '../state/manualSeek'
```

Replace with:

```ts
import { useDispatch, usePlaying } from '../state/StoreContext'
import { startPointerDrag } from './dragUtils'
import { useFrameScale, toLogicalX } from '../state/FrameScaleContext'
import { markManualSeek } from '../state/manualSeek'
import type { MouseEvent as ReactMouseEvent } from 'react'
```

Find:

```ts
export function Ruler({
  bars: barCount,
  ppb = PPB
}: {
  bars: number
  ppb?: number
}): React.JSX.Element {
  const dispatch = useDispatch()
  const playing = usePlaying()
  const frameScale = useFrameScale()
  const bars = Array.from({ length: barCount }, (_, i) => i + 1)
```

Replace with:

```ts
export function Ruler({
  bars: barCount,
  ppb = PPB,
  loopRegion,
  onSetLoopRegion
}: {
  bars: number
  ppb?: number
  /** The current loop-recording region, in bars — null if none is set yet.
   * See docs/superpowers/specs/2026-08-03-loop-recording-design.md. */
  loopRegion: { startBar: number; endBar: number } | null
  onSetLoopRegion: (region: { startBar: number; endBar: number } | null) => void
}): React.JSX.Element {
  const dispatch = useDispatch()
  const playing = usePlaying()
  const frameScale = useFrameScale()
  const bars = Array.from({ length: barCount }, (_, i) => i + 1)
```

- [ ] **Step 3: Add the loop-brace drag handlers**

Find (right after `handleScrubStart`'s closing `}`, before the `return (` that starts the JSX):

```ts
  return (
    <div
      onMouseDown={handleScrubStart}
```

Replace with:

```ts
  // Sweeps out a brand new loop region from a plain click-drag on the
  // ruler's own background (not on an existing region's edge handles,
  // which have their own onMouseDown below and stop propagation so this
  // handler never also fires underneath them). Mirrors handleScrubStart's
  // own real-pixel-to-bar conversion exactly, including the frameScale
  // correction -- see its own comment for why that matters.
  function handleLoopDragStart(e: ReactMouseEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const startBar = Math.max(0, toLogicalX(e.clientX - rect.left, frameScale) / ppb)
    let dragEndBar = startBar
    startPointerDrag(e, (deltaX) => {
      dragEndBar = Math.max(0, startBar + toLogicalX(deltaX, frameScale) / ppb)
      const lo = Math.min(startBar, dragEndBar)
      const hi = Math.max(startBar, dragEndBar)
      onSetLoopRegion({ startBar: lo, endBar: hi })
    })
  }

  // Dragging either edge of an already-set region adjusts just that edge --
  // standard DAW loop-brace behavior (Ableton/Logic/Cubase all work this
  // way). `edge`'s own fixed endpoint (the one NOT being dragged) stays
  // put; the dragged edge tracks the cursor, swapping which one is
  // "startBar" vs "endBar" if the user drags one edge past the other.
  function handleLoopEdgeDragStart(e: ReactMouseEvent<HTMLDivElement>, edge: 'start' | 'end'): void {
    e.stopPropagation()
    if (!loopRegion) return
    const fixedBar = edge === 'start' ? loopRegion.endBar : loopRegion.startBar
    const draggedStartBar = edge === 'start' ? loopRegion.startBar : loopRegion.endBar
    startPointerDrag(e, (deltaX) => {
      const draggedBar = Math.max(0, draggedStartBar + toLogicalX(deltaX, frameScale) / ppb)
      const lo = Math.min(fixedBar, draggedBar)
      const hi = Math.max(fixedBar, draggedBar)
      onSetLoopRegion({ startBar: lo, endBar: hi })
    })
  }

  return (
    <div
      onMouseDown={(e) => {
        // Only start a fresh loop-region drag on a plain click (no
        // modifier) -- Cmd is already the hand-pan modifier elsewhere in
        // this app (App.tsx), and this ruler has no pan behavior of its
        // own to conflict with, but keeping the same "plain click only"
        // discipline here avoids ever having to disambiguate the two later.
        if (!e.metaKey) handleLoopDragStart(e)
        handleScrubStart(e)
      }}
```

- [ ] **Step 4: Render the loop brace**

Find (the closing `</div>` right before the final `</div>` that closes the ruler's own root — i.e. right after the `{bars.map(...)}` block's closing):

```ts
      <div style={{ position: 'relative', width: barCount * ppb }}>
        {bars.map((bar) => (
          <div
            key={bar}
            style={{
              position: 'absolute',
              left: (bar - 1) * ppb,
              top: 0,
              bottom: 0,
              borderLeft: `1px solid ${(bar - 1) % 4 === 0 ? 'var(--ra-border)' : 'var(--ra-grid-minor)'}`
            }}
          >
            {(bar - 1) % 8 === 0 && (
              <span style={{ fontSize: 9, color: 'var(--ra-text-3)', paddingLeft: 3 }}>{bar}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

Replace with:

```ts
      <div style={{ position: 'relative', width: barCount * ppb }}>
        {bars.map((bar) => (
          <div
            key={bar}
            style={{
              position: 'absolute',
              left: (bar - 1) * ppb,
              top: 0,
              bottom: 0,
              borderLeft: `1px solid ${(bar - 1) % 4 === 0 ? 'var(--ra-border)' : 'var(--ra-grid-minor)'}`
            }}
          >
            {(bar - 1) % 8 === 0 && (
              <span style={{ fontSize: 9, color: 'var(--ra-text-3)', paddingLeft: 3 }}>{bar}</span>
            )}
          </div>
        ))}
        {/* Loop-recording region bracket -- tinted fill + accent border,
            using the same --ra-type-audio-in red already used for the
            playhead/mute so this reads as "recording/input" without a new
            token (see the design doc's own color rationale). Edge handles
            are small hit zones straddling each boundary (6px wide,
            centered on the edge via left offset), wide enough to grab
            without the same "hit target too small" problem the fade
            dots/resize handles had earlier this session. */}
        {loopRegion && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              height: 24,
              left: loopRegion.startBar * ppb,
              width: (loopRegion.endBar - loopRegion.startBar) * ppb,
              background: 'color-mix(in srgb, var(--ra-type-audio-in) 10%, transparent)',
              borderTop: '2px solid var(--ra-type-audio-in)',
              borderLeft: '2px solid var(--ra-type-audio-in)',
              borderRight: '2px solid var(--ra-type-audio-in)',
              pointerEvents: 'none'
            }}
          >
            <div
              onMouseDown={(e) => handleLoopEdgeDragStart(e, 'start')}
              title="drag to move loop start"
              style={{
                position: 'absolute',
                left: -3,
                top: 0,
                width: 6,
                height: 24,
                cursor: 'ew-resize',
                pointerEvents: 'auto'
              }}
            />
            <div
              onMouseDown={(e) => handleLoopEdgeDragStart(e, 'end')}
              title="drag to move loop end"
              style={{
                position: 'absolute',
                right: -3,
                top: 0,
                width: 6,
                height: 24,
                cursor: 'ew-resize',
                pointerEvents: 'auto'
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Wire the new props at Ruler's own call site**

Find (in `App.tsx`, inside `Timeline`'s JSX — search for `<Ruler`):

```ts
      <Ruler bars={loopLengthBars(state) + TRAILING_BLANK_BARS} ppb={ppb} />
```

Replace with:

```ts
      <Ruler
        bars={loopLengthBars(state) + TRAILING_BLANK_BARS}
        ppb={ppb}
        loopRegion={loopRegion}
        onSetLoopRegion={(region) => dispatch({ type: 'SET_LOOP_REGION', region })}
      />
```

Then add `const loopRegion = useAppSelector((s) => s.loopRegion)` alongside `Timeline`'s other `useAppSelector`/`useZoom` calls near its top (find `const frameScale = useFrameScale()` inside `Timeline` and add the new line directly after it).

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/Ruler.tsx src/renderer/src/App.tsx
git commit -m "Add loop-region drag interaction to the Ruler"
```

---

### Task 3: Recording-channel reducer state + actions

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/serialize.ts`
- Modify: `src/renderer/src/state/history.ts`
- Test: `src/renderer/src/state/store.test.ts`

This is the trickiest reducer task — see the design doc's "Recording channels" section for why `channelHasAnyClip`'s three existing call sites (`REMOVE_FROM_TIMELINE`, `MOVE_TO_CHANNEL`, `DELETE_RIFFFS`) all need one extra condition, or deleting a recording channel's current take would silently delete the channel itself.

- [ ] **Step 1: Write the failing tests**

```ts
describe('ADD_RECORDING_CHANNEL', () => {
  it('creates a new channel id, marked as a recording channel', () => {
    const next = reducer(initialState, { type: 'ADD_RECORDING_CHANNEL', channelId: 'rec-1' })
    expect(next.channelOrder).toContain('rec-1')
    expect(next.recordingChannelIds['rec-1']).toBe(true)
  })
})

describe('REMOVE_RECORDING_CHANNEL', () => {
  it('removes the channel from channelOrder and recordingChannelIds', () => {
    const withChannel = reducer(initialState, { type: 'ADD_RECORDING_CHANNEL', channelId: 'rec-1' })
    const next = reducer(withChannel, { type: 'REMOVE_RECORDING_CHANNEL', channelId: 'rec-1' })
    expect(next.channelOrder).not.toContain('rec-1')
    expect(next.recordingChannelIds['rec-1']).toBeUndefined()
  })

  it('disarms the channel first if it was armed', () => {
    const withChannel = reducer(initialState, { type: 'ADD_RECORDING_CHANNEL', channelId: 'rec-1' })
    const armed = reducer(withChannel, { type: 'ARM_RECORDING_CHANNEL', channelId: 'rec-1' })
    const next = reducer(armed, { type: 'REMOVE_RECORDING_CHANNEL', channelId: 'rec-1' })
    expect(next.armedChannelId).toBeNull()
  })
})

describe('a recording channel survives REMOVE_FROM_TIMELINE emptying it', () => {
  it('does not evict a recording channel from channelOrder just because its last clip left', () => {
    const withChannel = reducer(initialState, { type: 'ADD_RECORDING_CHANNEL', channelId: 'rec-1' })
    const rifff = { ...someTestRifff, groupId: 'g1', startBar: 0 } // see existing test fixtures in this file for the real shape
    const withClip: AppState = {
      ...withChannel,
      rifffs: { g1: rifff },
      channelOf: { g1: 'rec-1' }
    }
    const next = reducer(withClip, { type: 'REMOVE_FROM_TIMELINE', groupId: 'g1' })
    expect(next.channelOrder).toContain('rec-1')
  })
})

describe('ARM_RECORDING_CHANNEL / DISARM_RECORDING_CHANNEL', () => {
  it('arms the given channel', () => {
    const withChannel = reducer(initialState, { type: 'ADD_RECORDING_CHANNEL', channelId: 'rec-1' })
    const next = reducer(withChannel, { type: 'ARM_RECORDING_CHANNEL', channelId: 'rec-1' })
    expect(next.armedChannelId).toBe('rec-1')
  })

  it('disarms back to null', () => {
    const withChannel = reducer(initialState, { type: 'ADD_RECORDING_CHANNEL', channelId: 'rec-1' })
    const armed = reducer(withChannel, { type: 'ARM_RECORDING_CHANNEL', channelId: 'rec-1' })
    const next = reducer(armed, { type: 'DISARM_RECORDING_CHANNEL' })
    expect(next.armedChannelId).toBeNull()
  })
})
```

Check this test file's existing imports/fixtures for a real minimal `Rifff` object to reuse instead of the placeholder `someTestRifff` above — every other `describe` block in this file already constructs one; copy that exact shape rather than inventing a new one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "RECORDING_CHANNEL"`
Expected: FAIL — none of these actions/fields exist yet.

- [ ] **Step 3: Add the new `AppState` fields**

Find:

```ts
  loopRegion: { startBar: number; endBar: number } | null
```

Replace with:

```ts
  loopRegion: { startBar: number; endBar: number } | null
  /** Channels created via "+ rec channel" -- everywhere else, a channel
   * with no entry here is a normal one. Unlike every other channel (which
   * only exists as long as channelOf points a clip at it -- see
   * channelHasAnyClip), a recording channel's lifecycle is independent of
   * clip membership: it can sit empty, waiting to be armed. See
   * docs/superpowers/specs/2026-08-03-loop-recording-design.md. */
  recordingChannelIds: Record<string, true>
  /** Which recording channel, if any, is currently armed and capturing.
   * At most one at a time. Not persisted -- armed state shouldn't survive
   * a save/reload, matching volumeDragMode's own "how I'm currently
   * working" convention. */
  armedChannelId: string | null
```

Find:

```ts
  exp: {},
  loopRegion: null,
```

Replace with:

```ts
  exp: {},
  loopRegion: null,
  recordingChannelIds: {},
  armedChannelId: null,
```

- [ ] **Step 4: Add the action types**

Find:

```ts
  | { type: 'SET_LOOP_REGION'; region: { startBar: number; endBar: number } | null }
  | { type: 'LOAD_STATE'; state: AppState }
```

Replace with:

```ts
  | { type: 'SET_LOOP_REGION'; region: { startBar: number; endBar: number } | null }
  | { type: 'ADD_RECORDING_CHANNEL'; channelId: string }
  | { type: 'REMOVE_RECORDING_CHANNEL'; channelId: string }
  | { type: 'ARM_RECORDING_CHANNEL'; channelId: string }
  | { type: 'DISARM_RECORDING_CHANNEL' }
  | { type: 'LOAD_STATE'; state: AppState }
```

- [ ] **Step 5: Update `channelHasAnyClip`'s three call sites**

Find (in `REMOVE_FROM_TIMELINE`):

```ts
      const channelBecameEmpty =
        previousChannelId !== undefined && !channelHasAnyClip(channelOf, previousChannelId)
```

Replace with:

```ts
      const channelBecameEmpty =
        previousChannelId !== undefined &&
        !channelHasAnyClip(channelOf, previousChannelId) &&
        !state.recordingChannelIds[previousChannelId]
```

Find (in `MOVE_TO_CHANNEL`):

```ts
      if (
        previousChannelId !== undefined &&
        previousChannelId !== action.channelId &&
        !channelHasAnyClip(channelOf, previousChannelId)
      ) {
```

Replace with:

```ts
      if (
        previousChannelId !== undefined &&
        previousChannelId !== action.channelId &&
        !channelHasAnyClip(channelOf, previousChannelId) &&
        !state.recordingChannelIds[previousChannelId]
      ) {
```

Find (in `DELETE_RIFFFS`):

```ts
      const channelOrder = state.channelOrder.filter((id) => channelHasAnyClip(channelOf, id))
```

Replace with:

```ts
      const channelOrder = state.channelOrder.filter(
        (id) => channelHasAnyClip(channelOf, id) || state.recordingChannelIds[id]
      )
```

- [ ] **Step 6: Add the four new reducer cases**

Find:

```ts
    case 'SET_LOOP_REGION':
      return { ...state, loopRegion: action.region }
```

Replace with:

```ts
    case 'SET_LOOP_REGION':
      return { ...state, loopRegion: action.region }

    case 'ADD_RECORDING_CHANNEL':
      return {
        ...state,
        channelOrder: [...state.channelOrder, action.channelId],
        recordingChannelIds: { ...state.recordingChannelIds, [action.channelId]: true }
      }

    case 'REMOVE_RECORDING_CHANNEL': {
      const recordingChannelIds = { ...state.recordingChannelIds }
      delete recordingChannelIds[action.channelId]
      return {
        ...state,
        channelOrder: state.channelOrder.filter((id) => id !== action.channelId),
        recordingChannelIds,
        armedChannelId: state.armedChannelId === action.channelId ? null : state.armedChannelId
      }
    }

    case 'ARM_RECORDING_CHANNEL':
      return { ...state, armedChannelId: action.channelId }

    case 'DISARM_RECORDING_CHANNEL':
      return { ...state, armedChannelId: null }
```

- [ ] **Step 7: Mark arm/disarm as transient (not undo-worthy)**

In `src/renderer/src/state/history.ts`, find:

```ts
const TRANSIENT_ACTION_TYPES = new Set<Action['type']>([
  'TOGGLE_VOLUME_DRAG_MODE',
  'SET_VOLUME_DRAG_MODE',
  'SET_ARRANGER_MODE',
  'TOGGLE_INSPECTOR_COLLAPSED',
  'TOGGLE_METRONOME'
])
```

Replace with:

```ts
const TRANSIENT_ACTION_TYPES = new Set<Action['type']>([
  'TOGGLE_VOLUME_DRAG_MODE',
  'SET_VOLUME_DRAG_MODE',
  'SET_ARRANGER_MODE',
  'TOGGLE_INSPECTOR_COLLAPSED',
  'TOGGLE_METRONOME',
  'ARM_RECORDING_CHANNEL',
  'DISARM_RECORDING_CHANNEL'
])
```

`ADD_RECORDING_CHANNEL`/`REMOVE_RECORDING_CHANNEL`/`SET_LOOP_REGION` are deliberately NOT in this set — creating/removing a recording channel and setting a loop region are real, deliberate arrangement edits worth an undo step, same reasoning as any other structural change.

- [ ] **Step 8: Exclude `armedChannelId` from persistence**

In `src/renderer/src/state/serialize.ts`, find:

```ts
export type PersistedProject = Omit<
  AppState,
  'volumeDragMode' | 'mode' | 'inspectorCollapsed' | 'metronomeEnabled'
>
```

Replace with:

```ts
export type PersistedProject = Omit<
  AppState,
  'volumeDragMode' | 'mode' | 'inspectorCollapsed' | 'metronomeEnabled' | 'armedChannelId'
>
```

Find:

```ts
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { volumeDragMode, mode, inspectorCollapsed, metronomeEnabled, ...rest } = state
```

Replace with:

```ts
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { volumeDragMode, mode, inspectorCollapsed, metronomeEnabled, armedChannelId, ...rest } = state
```

`recordingChannelIds` is deliberately NOT excluded — a recording channel and whatever take is on it are real project content, same as any other channel/clip, and should survive a save/reload. Only the transient "is something armed right now" flag is excluded.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "RECORDING_CHANNEL"`
Expected: PASS (all new tests).

- [ ] **Step 10: Run the full suite, typecheck, and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all succeed — pay particular attention to any other existing test that constructs an `AppState` object literal directly (rather than spreading `initialState`) and would now be missing the two new required fields; add `recordingChannelIds: {}, armedChannelId: null` to any that fail this way.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts src/renderer/src/state/serialize.ts src/renderer/src/state/history.ts
git commit -m "Add recording-channel state and arm/disarm actions"
```

---

### Task 4: "+ rec channel" button + "r" arm toggle in ChannelRow

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/ChannelRow.tsx`

No new tests (React components). Verified by typecheck/lint here, manual walkthrough in Task 12.

- [ ] **Step 1: Add the "+ rec channel" button near Shelf**

Read `App.tsx`'s `Frame` component's JSX where `<Shelf ... />` is rendered (search for `<Shelf`) to find the exact surrounding markup, then add a button immediately after it:

```tsx
        <Shelf onImported={handleImported} onOpenLoreLibrary={() => setLoreLibraryOpen(true)} />
        <button
          onClick={() => dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: crypto.randomUUID() })}
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            color: 'var(--ra-text)',
            background: 'var(--ra-bg-row-active)',
            border: '1px solid var(--ra-border-strong)',
            padding: '5px 10px',
            cursor: 'pointer',
            textTransform: 'lowercase'
          }}
        >
          + rec channel
        </button>
```

(Exact placement/wrapping div may need adjusting once you see the real surrounding layout — the important part is: a new button, dispatching `ADD_RECORDING_CHANNEL` with a fresh `crypto.randomUUID()`, styled consistently with this app's other secondary buttons per `tokens.css`'s own "no rounded corners, monochrome, color only for audio-carrying things" rule — note this button itself does NOT get the audio-in red tint; only the loop brace, the armed "r" toggle, and the capturing waveform do, since this button doesn't itself represent audio content.)

- [ ] **Step 2: Add the "r" button to ChannelRow's m/s/fx stack**

Read `ChannelRow.tsx` in full first (last touched this session for the `React.memo` wrap — confirm current exact line numbers before editing).

Find the import line for `useAppSelector`/`useDispatch` and add:

```ts
import { useAppSelector, useDispatch } from '../state/StoreContext'
```

(no change needed if already present exactly like this — just confirm).

Find where `mute`/`rifffsMap` are read via `useAppSelector` near the top of `ChannelRowImpl` and add two more selectors immediately after:

```ts
  const mute = useAppSelector((s) => s.mute)
  const rifffsMap = useAppSelector((s) => s.rifffs)
  const isRecordingChannel = useAppSelector((s) => !!s.recordingChannelIds[channelId])
  const isArmed = useAppSelector((s) => s.armedChannelId === channelId)
  const selectedInputDevice = useAppSelector((s) => s.selectedInputDevice)
```

(`selectedInputDevice` doesn't exist on `AppState` yet — that's Task 5. This step's edit is correct to write now; it just won't typecheck until Task 5 lands. If executing these tasks out of order for any reason, do Task 5 first.)

Find the m/s/fx button stack's JSX (the `<button>` for "fx", the last one in the stack) and add a fourth button immediately after it, only rendered for a recording channel:

```tsx
          <button
            onClick={(e) => {
              e.stopPropagation()
              setChainPanelOpen(true)
            }}
            aria-label={`channel ${channelId} plugin chain`}
            title="channel plugin chain"
            style={fxButtonStyle}
          >
            fx
          </button>
          {isRecordingChannel && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                dispatch(
                  isArmed
                    ? { type: 'DISARM_RECORDING_CHANNEL' }
                    : { type: 'ARM_RECORDING_CHANNEL', channelId }
                )
              }}
              disabled={!isArmed && !selectedInputDevice}
              aria-label={`arm channel ${channelId} for recording`}
              title={
                selectedInputDevice
                  ? isArmed
                    ? 'disarm recording'
                    : 'arm for recording'
                  : 'select an input device first'
              }
              style={{
                ...baseButtonStyle,
                background: isArmed ? 'var(--ra-mute-on)' : 'var(--ra-bg-row-active)',
                border: `1px solid ${isArmed ? 'var(--ra-mute-on)' : 'var(--ra-border)'}`,
                color: isArmed ? 'var(--ra-mute-on-ink)' : 'var(--ra-text-2)',
                opacity: !isArmed && !selectedInputDevice ? 0.3 : 1,
                cursor: !isArmed && !selectedInputDevice ? 'not-allowed' : 'pointer'
              }}
            >
              r
            </button>
          )}
```

(`--ra-mute-on`/`--ra-mute-on-ink` reused deliberately — same "filled red = active/attention-grabbing state" treatment the mute button already uses, and this codebase's own audio-in accent color. Matches tokens.css's documented disabled convention: 30% opacity + not-allowed cursor.)

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck:web && npm run lint`
Expected: errors referencing `selectedInputDevice`/`s.recordingChannelIds` not existing yet ARE expected at this point if Task 5 hasn't landed — if executing tasks in order (Task 5 comes next), this is fine; re-run after Task 5 to confirm clean. If Task 5 already landed, expect no errors at all.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/ChannelRow.tsx
git commit -m "Add + rec channel button and r arm toggle"
```

---

### Task 5: Input device selection state + `list-input-devices` IPC (renderer + main, engine stub)

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/serialize.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Test: `src/renderer/src/state/store.test.ts`

This task adds the renderer/main/preload plumbing and a temporary always-succeeds engine stub reply, so the renderer side can be built and tested independently of the real native engine work (Tasks 7-9 replace the stub with a real `list-input-devices` handler backed by actual device enumeration).

- [ ] **Step 1: Write the failing test**

```ts
describe('SET_AVAILABLE_INPUT_DEVICES / SET_SELECTED_INPUT_DEVICE', () => {
  it('stores the device list', () => {
    const next = reducer(initialState, {
      type: 'SET_AVAILABLE_INPUT_DEVICES',
      devices: ['BlackHole 2ch', 'MacBook Pro Microphone']
    })
    expect(next.availableInputDevices).toEqual(['BlackHole 2ch', 'MacBook Pro Microphone'])
  })

  it('stores the selected device', () => {
    const next = reducer(initialState, {
      type: 'SET_SELECTED_INPUT_DEVICE',
      device: 'BlackHole 2ch'
    })
    expect(next.selectedInputDevice).toBe('BlackHole 2ch')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "INPUT_DEVICE"`
Expected: FAIL.

- [ ] **Step 3: Add the state fields**

Find:

```ts
  armedChannelId: string | null
```

Replace with:

```ts
  armedChannelId: string | null
  /** Populated once from a list-input-devices IPC round-trip when the
   * input device dropdown first opens -- not fetched proactively on every
   * app launch. Not persisted -- devices can change between sessions. */
  availableInputDevices: string[]
  /** Which of availableInputDevices to record from -- null means "not
   * chosen yet" (arming is disabled until something is selected). Not
   * persisted, same reasoning as availableInputDevices itself. */
  selectedInputDevice: string | null
```

Find:

```ts
  armedChannelId: null,
```

Replace with:

```ts
  armedChannelId: null,
  availableInputDevices: [],
  selectedInputDevice: null,
```

- [ ] **Step 4: Add the action types**

Find:

```ts
  | { type: 'DISARM_RECORDING_CHANNEL' }
```

Replace with:

```ts
  | { type: 'DISARM_RECORDING_CHANNEL' }
  | { type: 'SET_AVAILABLE_INPUT_DEVICES'; devices: string[] }
  | { type: 'SET_SELECTED_INPUT_DEVICE'; device: string | null }
```

- [ ] **Step 5: Add the reducer cases**

Find:

```ts
    case 'DISARM_RECORDING_CHANNEL':
      return { ...state, armedChannelId: null }
```

Replace with:

```ts
    case 'DISARM_RECORDING_CHANNEL':
      return { ...state, armedChannelId: null }

    case 'SET_AVAILABLE_INPUT_DEVICES':
      return { ...state, availableInputDevices: action.devices }

    case 'SET_SELECTED_INPUT_DEVICE':
      return { ...state, selectedInputDevice: action.device }
```

- [ ] **Step 6: Exclude both new fields from persistence**

Find:

```ts
export type PersistedProject = Omit<
  AppState,
  'volumeDragMode' | 'mode' | 'inspectorCollapsed' | 'metronomeEnabled' | 'armedChannelId'
>
```

Replace with:

```ts
export type PersistedProject = Omit<
  AppState,
  | 'volumeDragMode'
  | 'mode'
  | 'inspectorCollapsed'
  | 'metronomeEnabled'
  | 'armedChannelId'
  | 'availableInputDevices'
  | 'selectedInputDevice'
>
```

Find:

```ts
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { volumeDragMode, mode, inspectorCollapsed, metronomeEnabled, armedChannelId, ...rest } = state
```

Replace with:

```ts
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {
    volumeDragMode,
    mode,
    inspectorCollapsed,
    metronomeEnabled,
    armedChannelId,
    availableInputDevices,
    selectedInputDevice,
    ...rest
  } = state
```

- [ ] **Step 7: Add the main-process IPC handler (temporary stub)**

In `src/main/index.ts`, find:

```ts
  ipcMain.handle('engine-set-metronome', (_event, enabled: boolean) => {
    playbackEngine?.client.send('set-metronome', { enabled })
```

Add immediately before this block:

```ts
  // TEMPORARY stub -- returns an empty list until Task 8 wires this to a
  // real "list-input-devices" reply from the native engine. Lets the
  // renderer-side dropdown (Task 6) be built and typechecked against a
  // real IPC round-trip shape now, without depending on the native engine
  // work landing first.
  ipcMain.handle('engine-list-input-devices', async (): Promise<string[]> => {
    if (!playbackEngine) return []
    try {
      const result = (await playbackEngine.client.sendAndAwaitType(
        'list-input-devices',
        undefined,
        'input-devices-list'
      )) as { devices: string[] }
      return result.devices
    } catch (err) {
      console.error('engine-list-input-devices: failed:', err)
      return []
    }
  })

```

(This calls through to the real engine already — it's the ENGINE side that's stubbed/missing until Task 8, not this handler. If Task 8 hasn't landed yet, this will just time out and log an error, returning `[]`, which is a safe/correct temporary behavior, not a crash.)

- [ ] **Step 8: Add the preload bridge**

In `src/preload/index.ts`, find:

```ts
  engineSetMetronome: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('engine-set-metronome', enabled),
```

Add immediately before this line:

```ts
  engineListInputDevices: (): Promise<string[]> =>
    ipcRenderer.invoke('engine-list-input-devices'),
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "INPUT_DEVICE"`
Expected: PASS.

- [ ] **Step 10: Run the full suite, typecheck, and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all succeed.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts src/renderer/src/state/serialize.ts src/main/index.ts src/preload/index.ts
git commit -m "Add input device selection state and list-input-devices IPC bridge (engine side stubbed)"
```

---

### Task 6: Input device dropdown UI

**Files:**
- Modify: `src/renderer/src/App.tsx`

No new tests (React component). Verified by typecheck/lint here, manual walkthrough in Task 12 (against the REAL engine reply, once Task 8 lands).

- [ ] **Step 1: Add the dropdown next to "+ rec channel"**

Find the "+ rec channel" button added in Task 4, Step 1, and wrap it alongside a new `<select>`:

```tsx
        <button
          onClick={() => dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: crypto.randomUUID() })}
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            color: 'var(--ra-text)',
            background: 'var(--ra-bg-row-active)',
            border: '1px solid var(--ra-border-strong)',
            padding: '5px 10px',
            cursor: 'pointer',
            textTransform: 'lowercase'
          }}
        >
          + rec channel
        </button>
        <select
          value={selectedInputDevice ?? ''}
          onFocus={() => {
            if (availableInputDevices.length === 0) {
              void window.rifffApi.engineListInputDevices().then((devices) => {
                dispatch({ type: 'SET_AVAILABLE_INPUT_DEVICES', devices })
              })
            }
          }}
          onChange={(e) =>
            dispatch({ type: 'SET_SELECTED_INPUT_DEVICE', device: e.target.value || null })
          }
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            color: 'var(--ra-text)',
            background: 'var(--ra-bg-row-active)',
            border: '1px solid var(--ra-border)',
            padding: '5px 8px'
          }}
        >
          <option value="">
            {availableInputDevices.length === 0 ? 'no input devices found' : 'select input device...'}
          </option>
          {availableInputDevices.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
```

(Lazy fetch on first focus, not on mount — matches the design doc's own "only relevant once the user actually wants to record" reasoning. The `<option value="">` label already distinguishes "haven't looked yet" from "looked, found nothing" implicitly via `availableInputDevices.length`, satisfying the design doc's "no input devices found" empty-state requirement without extra state.)

Add the two new selectors this needs, alongside `Frame`'s existing ones (find `const setBusy = useBusy()` inside `Frame` and add immediately after):

```ts
  const availableInputDevices = useAppSelector((s) => s.availableInputDevices)
  const selectedInputDevice = useAppSelector((s) => s.selectedInputDevice)
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Add input device dropdown"
```

---

### Task 7: `LoopRecorder` native class + unit tests

**Files:**
- Create: `native-engine/Source/LoopRecorder.h`
- Create: `native-engine/Source/LoopRecorder.cpp`
- Create: `native-engine/Source/LoopRecorderTests.cpp` (or add to whatever single test translation unit this project already links into `--test` mode — check `Main.cpp`'s `--test` dispatch and the CMakeLists.txt source list for the existing convention before deciding new-file vs. append)

- [ ] **Step 1: Read the existing native test convention**

Read `native-engine/CMakeLists.txt` (find where test source files are listed) and any one existing `*Tests.cpp` file in `native-engine/Source/` in full, to match this project's own JUCE `UnitTestRunner` registration pattern exactly (a `class ... : public juce::UnitTest` with a static instance, registered globally — copy the exact idiom used elsewhere rather than inventing a new one).

- [ ] **Step 2: Write `LoopRecorder.h`**

```cpp
// native-engine/Source/LoopRecorder.h
#pragma once
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <memory>

namespace sssketch
{
    /** Captures live input into a single buffer sized to exactly one loop
     * pass, overwritten every pass -- a classic loop-pedal model, not a
     * retrospective/ring buffer. See
     * docs/superpowers/specs/2026-08-03-loop-recording-design.md's
     * "Capture mechanic" section for the full rationale, including why
     * pass-boundary detection lives entirely in Transport's own per-block
     * loop-wrap math rather than anything IPC-driven.
     *
     * Not thread-safe in general, but every method here is only ever
     * called from the audio thread (Transport::audioDeviceIOCallbackWithContext
     * and the renderLoopAware wrap-check it drives) -- there is no
     * message-thread access to an active LoopRecorder instance's mutable
     * state, matching how PlaybackEngine::renderBlock itself is only ever
     * called from that same one thread. */
    class LoopRecorder
    {
    public:
        LoopRecorder(double sampleRate, double loopLengthSeconds);

        /** Feeds one block of live input (mono downmix from however many
         * input channels the device provided -- a recording channel
         * doesn't need stereo capture for v1, matching this feature's own
         * "one pass, one clip" simplicity elsewhere). Writes starting at
         * the current write position, wrapping via onPassBoundary() below
         * rather than internally -- the caller (Transport) already knows
         * exactly when a boundary falls within a block from its own
         * wrap-math, and is what actually calls onPassBoundary at the
         * right sample index. */
        void writeBlock(const float* const* inputChannelData, int numInputChannels, int startSample, int numSamples);

        /** Called by Transport exactly when its own loop-wrap math detects
         * the recording loop boundary was crossed this block -- finalizes
         * whatever's in the buffer as "a completed pass" and resets the
         * write position to 0 for the next one. */
        void onPassBoundary();

        /** True once at least one full pass has completed since
         * construction (or since the buffer was last reset by a prior
         * onPassBoundary() call) -- checked at disarm time to decide
         * whether there's anything to commit. */
        bool hasCompletedPass() const { return completedPass; }

        /** Writes the current buffer contents to a 16-bit mono WAV file at
         * the given path. Returns false (and leaves outputPath untouched)
         * on failure -- mirrors RenderExport.cpp's own
         * WavAudioFormat::createWriterFor error-handling convention (null
         * writer = failure, no exception). Meaningful to call regardless
         * of hasCompletedPass() (the caller is expected to check that
         * first and skip calling this at all if there's nothing to
         * commit -- this method itself doesn't re-check, so it always
         * writes whatever the buffer currently holds if asked). */
        bool writeToWavFile(const juce::String& outputPath) const;

    private:
        double sampleRate;
        juce::AudioBuffer<float> buffer;
        int writePos = 0;
        bool completedPass = false;
    };
}
```

- [ ] **Step 3: Write `LoopRecorder.cpp`**

```cpp
// native-engine/Source/LoopRecorder.cpp
#include "LoopRecorder.h"

namespace sssketch
{
    LoopRecorder::LoopRecorder(double sr, double loopLengthSeconds)
        : sampleRate(sr)
    {
        const int numSamples = std::max(1, (int) std::lround(loopLengthSeconds * sampleRate));
        buffer.setSize(1, numSamples);
        buffer.clear();
    }

    void LoopRecorder::writeBlock(const float* const* inputChannelData, int numInputChannels,
                                   int startSample, int numSamples)
    {
        if (numInputChannels <= 0 || inputChannelData == nullptr) return;
        auto* dest = buffer.getWritePointer(0);
        const int bufferSamples = buffer.getNumSamples();
        for (int i = 0; i < numSamples; ++i)
        {
            const int destIndex = writePos + i;
            if (destIndex >= bufferSamples) break; // shouldn't happen if Transport's own wrap math is correct; defensive, not a silent overwrite past the buffer's own bounds
            // Mono downmix -- average every input channel JUCE gave us.
            // Loopback devices are commonly stereo (2ch), a mic commonly
            // mono (1ch); averaging handles both without a separate path.
            float sample = 0.0f;
            for (int ch = 0; ch < numInputChannels; ++ch)
                sample += inputChannelData[ch][startSample + i];
            sample /= (float) numInputChannels;
            dest[destIndex] = sample;
        }
        writePos = std::min(writePos + numSamples, bufferSamples);
    }

    void LoopRecorder::onPassBoundary()
    {
        completedPass = writePos >= buffer.getNumSamples();
        writePos = 0;
        buffer.clear();
    }

    bool LoopRecorder::writeToWavFile(const juce::String& outputPath) const
    {
        juce::File outFile(outputPath);
        outFile.getParentDirectory().createDirectory();
        outFile.deleteFile();
        std::unique_ptr<juce::FileOutputStream> out(outFile.createOutputStream());
        if (out == nullptr) return false;

        juce::WavAudioFormat wavFormat;
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wavFormat.createWriterFor(out.get(), sampleRate, 1, 16, {}, 0));
        if (writer == nullptr) return false;
        out.release(); // writer now owns the stream, matching RenderExport.cpp's own ownership handoff

        writer->writeFromAudioSampleBuffer(buffer, 0, buffer.getNumSamples());
        return true;
    }
}
```

- [ ] **Step 4: Write the unit tests**

Follow whatever exact `juce::UnitTest` registration idiom Step 1 found in this project's existing test file(s). The test bodies themselves, regardless of exact registration boilerplate:

```cpp
// Synthetic input: a single input channel, numSamples of a known
// non-zero value, so a written/read-back sample can be checked without
// needing a real audio device.
beginTest("writeBlock captures samples into the buffer");
{
    LoopRecorder recorder(48000.0, 0.1); // 4800 samples
    std::vector<float> inputData(4800, 0.5f);
    const float* channels[] = { inputData.data() };
    recorder.writeBlock(channels, 1, 0, 4800);
    expect(!recorder.hasCompletedPass()); // onPassBoundary() hasn't been called yet
}

beginTest("onPassBoundary marks a completed pass only once the buffer is fully written");
{
    LoopRecorder recorder(48000.0, 0.1); // 4800 samples
    std::vector<float> inputData(2000, 0.5f);
    const float* channels[] = { inputData.data() };
    recorder.writeBlock(channels, 1, 0, 2000); // partial -- 2000 of 4800
    recorder.onPassBoundary();
    expect(!recorder.hasCompletedPass());
}

beginTest("onPassBoundary marks a completed pass once the buffer is fully written");
{
    LoopRecorder recorder(48000.0, 0.1); // 4800 samples
    std::vector<float> inputData(4800, 0.5f);
    const float* channels[] = { inputData.data() };
    recorder.writeBlock(channels, 1, 0, 4800); // exactly full
    recorder.onPassBoundary();
    expect(recorder.hasCompletedPass());
}

beginTest("each new pass overwrites the buffer from the start");
{
    LoopRecorder recorder(48000.0, 0.1);
    std::vector<float> firstPass(4800, 0.5f);
    const float* firstChannels[] = { firstPass.data() };
    recorder.writeBlock(firstChannels, 1, 0, 4800);
    recorder.onPassBoundary();

    std::vector<float> secondPass(4800, 0.25f);
    const float* secondChannels[] = { secondPass.data() };
    recorder.writeBlock(secondChannels, 1, 0, 2000); // only partway through the second pass
    // Write the committed WAV NOW (simulating a disarm mid-second-pass)
    // and confirm it reflects the FIRST pass's value, not a mix of both --
    // onPassBoundary's own buffer.clear() must have actually wiped the
    // first pass's data, not left it underneath the second pass's partial
    // overwrite.
    juce::File tmp = juce::File::createTempFile(".wav");
    expect(recorder.writeToWavFile(tmp.getFullPathName()));
    // (Reading the WAV back and checking sample values is the thorough
    // version of this assertion -- use juce::WavAudioFormat's own reader
    // here, matching whatever pattern this project's existing native
    // tests already use to verify written WAV content, e.g. RenderExport's
    // own test suite if one exists; check before duplicating a fresh
    // WAV-reading helper.)
    tmp.deleteFile();
}
```

- [ ] **Step 5: Add the new files to the build**

Add `LoopRecorder.h`/`LoopRecorder.cpp` (and the test file, if it's a new one rather than appended to an existing test translation unit) to `native-engine/CMakeLists.txt`'s source list, matching how every other `Source/*.cpp` is already listed there.

- [ ] **Step 6: Build and run the native tests**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: build succeeds, all `LoopRecorder` tests pass, and every pre-existing native test still passes (no regressions).

- [ ] **Step 7: Commit**

```bash
git add native-engine/Source/LoopRecorder.h native-engine/Source/LoopRecorder.cpp native-engine/CMakeLists.txt
# add the test file too, whatever its final name/location turned out to be
git commit -m "Add LoopRecorder: one-pass capture buffer with WAV commit"
```

---

### Task 8: Wire `LoopRecorder` into `Transport` + new IPC messages (HIGH RISK — audio thread)

**Files:**
- Modify: `native-engine/Source/Transport.h`
- Modify: `native-engine/Source/Transport.cpp`
- Modify: `native-engine/Source/IpcServer.h`
- Modify: `native-engine/Source/IpcServer.cpp`

This is the highest-risk task in this plan — it touches the real-time audio callback. Read `Transport.h`/`Transport.cpp` and `IpcServer.h`/`IpcServer.cpp` in full again immediately before starting (both were read during this plan's own research phase, but re-read now for exact current line numbers, since Tasks 1-7 don't touch these files and they should be unchanged, but never assume).

- [ ] **Step 1: Add recording-loop state and the `LoopRecorder` pointer to `Transport.h`**

Find:

```cpp
        // 0 (the default) disables wrapping entirely — positionBars advances
        // monotonically forever, same as before this existed. Set from
        // load-project's own loopLengthBars field (see EngineProject.h) so
        // the transport can wrap its own clock in-thread, sample-accurately,
        // instead of the renderer having to notice via its position-update
        // poll and round-trip a correcting set-position over IPC. See
        // LoopBoundaryFade.h for the declick fade applied right at the wrap.
        void setLoopLengthBars(double bars) { loopLengthBars.store(bars); }
```

Replace with:

```cpp
        // 0 (the default) disables wrapping entirely — positionBars advances
        // monotonically forever, same as before this existed. Set from
        // load-project's own loopLengthBars field (see EngineProject.h) so
        // the transport can wrap its own clock in-thread, sample-accurately,
        // instead of the renderer having to notice via its position-update
        // poll and round-trip a correcting set-position over IPC. See
        // LoopBoundaryFade.h for the declick fade applied right at the wrap.
        void setLoopLengthBars(double bars) { loopLengthBars.store(bars); }

        // A second, independent loop region -- the recording loop set by
        // arm-recording (IPC), completely separate from the project's own
        // loopLengthBars above (both can be active at once; a short
        // recording loop inside a much longer overall arrangement is the
        // normal case). endBar <= startBar disables it. Message-thread-only
        // call (from IpcConnection::messageReceived), consumed by the audio
        // thread's own renderLoopAware -- both fields are atomics for that
        // handoff, same pattern as loopLengthBars itself.
        void setRecordingLoop(double startBar, double endBar)
        {
            recordingLoopStartBar.store(startBar);
            recordingLoopEndBar.store(endBar);
        }

        // Attaches/detaches the recorder that should receive live input
        // samples and pass-boundary notifications while a recording loop
        // is active. nullptr means "nothing armed" -- the audio thread
        // checks this every block and skips all recording-related work
        // when null, so the unarmed case costs one extra pointer check per
        // block. Message-thread-only call (arm-recording/disarm-recording);
        // the pointer itself is std::atomic for that handoff, matching how
        // every other cross-thread flag in this class already works. The
        // caller (IpcConnection) owns the LoopRecorder instance's actual
        // lifetime -- Transport only ever reads through this pointer, never
        // deletes it.
        void setLoopRecorder(LoopRecorder* recorder) { loopRecorder.store(recorder); }
```

Find:

```cpp
#include "PlaybackEngine.h"
#include "PluginChain.h"
#include "ChannelChainRegistry.h"
#include <juce_audio_devices/juce_audio_devices.h>
#include <atomic>
```

Replace with:

```cpp
#include "PlaybackEngine.h"
#include "PluginChain.h"
#include "ChannelChainRegistry.h"
#include "LoopRecorder.h"
#include <juce_audio_devices/juce_audio_devices.h>
#include <atomic>
```

Find:

```cpp
        std::atomic<double> loopLengthBars { 0.0 }; // 0 = wrapping disabled
```

Replace with:

```cpp
        std::atomic<double> loopLengthBars { 0.0 }; // 0 = wrapping disabled
        std::atomic<double> recordingLoopStartBar { 0.0 };
        std::atomic<double> recordingLoopEndBar { 0.0 }; // <= start = disabled
        std::atomic<LoopRecorder*> loopRecorder { nullptr }; // nullptr = nothing armed
```

- [ ] **Step 2: Open the device with input channels enabled**

Find:

```cpp
    bool Transport::openDefaultDevice()
    {
        auto error = deviceManager.initialiseWithDefaultDevices(0, 2);
        if (error.isNotEmpty())
        {
            juce::Logger::writeToLog("Transport: failed to open audio device: " + error);
            return false;
        }
        deviceManager.addAudioCallback(this);
        return true;
    }
```

Replace with:

```cpp
    bool Transport::openDefaultDevice()
    {
        // Requests 1 input channel now (was 0) -- harmless when nothing is
        // ever armed (the extra channel just goes unread, same cost as
        // before this feature existed), and means an input device is
        // already open and ready the moment arm-recording actually needs
        // one, rather than requiring a device reopen mid-session (which
        // would glitch/interrupt playback on the output side too, since
        // JUCE reopens the whole device, not just the input half, when
        // input channel count changes on an already-open device).
        auto error = deviceManager.initialiseWithDefaultDevices(1, 2);
        if (error.isNotEmpty())
        {
            juce::Logger::writeToLog("Transport: failed to open audio device: " + error);
            return false;
        }
        deviceManager.addAudioCallback(this);
        return true;
    }

    juce::StringArray Transport::availableInputDeviceNames() const
    {
        auto* type = deviceManager.getCurrentDeviceTypeObject();
        if (type == nullptr) return {};
        return type->getDeviceNames(true); // true = input names
    }
```

Add the new method's declaration to `Transport.h`, right after `currentBlockSize()`:

```cpp
        /** Every input device name CoreAudio currently reports for the
         * active device type -- used by the renderer's input-device
         * dropdown (list-input-devices IPC). Empty if no device type is
         * open yet (shouldn't happen once openDefaultDevice() has
         * succeeded, but defensive rather than assuming). */
        juce::StringArray availableInputDeviceNames() const;
```

- [ ] **Step 3: Feed live input to the recorder and detect the recording-loop boundary**

Find:

```cpp
    void Transport::audioDeviceIOCallbackWithContext(
        const float* const* /*inputChannelData*/, int /*numInputChannels*/,
        float* const* outputChannelData, int numOutputChannels,
        int numSamples, const juce::AudioIODeviceCallbackContext&)
    {
```

Replace with:

```cpp
    void Transport::audioDeviceIOCallbackWithContext(
        const float* const* inputChannelData, int numInputChannels,
        float* const* outputChannelData, int numOutputChannels,
        int numSamples, const juce::AudioIODeviceCallbackContext&)
    {
```

Find (right after the existing early-return guards, before `if (playRequested.exchange(false))`):

```cpp
        if (numOutputChannels < 2 || outputChannelData[0] == nullptr || outputChannelData[1] == nullptr)
            return;

        auto* outL = outputChannelData[0];
        auto* outR = outputChannelData[1];
        juce::FloatVectorOperations::clear(outL, numSamples);
        juce::FloatVectorOperations::clear(outR, numSamples);
```

Replace with:

```cpp
        if (numOutputChannels < 2 || outputChannelData[0] == nullptr || outputChannelData[1] == nullptr)
            return;

        auto* outL = outputChannelData[0];
        auto* outR = outputChannelData[1];
        juce::FloatVectorOperations::clear(outL, numSamples);
        juce::FloatVectorOperations::clear(outR, numSamples);

        // Recording capture: independent of play/pause/halt-fade state
        // below entirely -- you can arm and record while transport
        // playback itself is paused/stopped just as validly as while
        // playing (Frame's own ARM_RECORDING_CHANNEL handler in the
        // renderer starts playback automatically when arming, but nothing
        // here should assume that always holds true, e.g. if the user
        // manually pauses mid-take). recordingLoopEndBar > start is the
        // "is a recording loop active" check throughout.
        if (auto* recorder = loopRecorder.load())
        {
            const double recStart = recordingLoopStartBar.load();
            const double recEnd = recordingLoopEndBar.load();
            if (recEnd > recStart && secPerBar > 0.0)
            {
                recorder->writeBlock(inputChannelData, numInputChannels, 0, numSamples);

                // Same distToEnd/blockDurationBars wrap-detection math
                // renderLoopAware uses for loopLengthBars below, applied a
                // second time against the recording loop's own bounds --
                // deliberately not shared/refactored into one helper this
                // pass, to keep this task's diff small and reviewable;
                // worth unifying later if a third independent loop concept
                // ever shows up.
                const double barsPerSample = (1.0 / deviceSampleRate) / secPerBar;
                const double blockDurationBars = numSamples * barsPerSample;
                const double posInLoop = std::fmod(positionBars.load() - recStart, recEnd - recStart);
                const double distToEnd = (recEnd - recStart) - (posInLoop < 0.0 ? posInLoop + (recEnd - recStart) : posInLoop);
                if (distToEnd < blockDurationBars)
                    recorder->onPassBoundary();
            }
        }
```

- [ ] **Step 4: Add `arm-recording`/`disarm-recording`/`list-input-devices` to `IpcServer.h`**

Find:

```cpp
        PlaybackEngine& engine;
        Transport& transport;
        PluginChain& masterChain;
        ChannelChainRegistry& channelChains;
    };

    class IpcServer : public juce::InterprocessConnectionServer
```

Replace with:

```cpp
        PlaybackEngine& engine;
        Transport& transport;
        PluginChain& masterChain;
        ChannelChainRegistry& channelChains;
        // Owns whichever LoopRecorder is currently armed (nullptr = none) --
        // IpcConnection creates/destroys the instance itself in response to
        // arm-recording/disarm-recording, and hands Transport a raw
        // observing pointer via setLoopRecorder (see arm/disarm handling in
        // messageReceived). One at a time, matching this feature's own
        // "at most one armed channel" scope.
        std::unique_ptr<LoopRecorder> armedRecorder;
        juce::String armedChannelId;
    };

    class IpcServer : public juce::InterprocessConnectionServer
```

- [ ] **Step 5: Add `Transport::setRecordingInputDevice` and `currentBpm()`**

In `Transport.h`, find:

```cpp
        void setBpm(double bpm)
        {
            secPerBar = bpm > 0.0 ? (60.0 / bpm) * 4.0 : 0.0;
            masterChain.setBpm(bpm);
        }
```

Replace with:

```cpp
        void setBpm(double bpmValue)
        {
            bpm = bpmValue;
            secPerBar = bpmValue > 0.0 ? (60.0 / bpmValue) * 4.0 : 0.0;
            masterChain.setBpm(bpmValue);
        }

        double currentBpm() const { return bpm; }

        /** Switches the currently-open device's input side to the named
         * device, keeping the existing output device unchanged. Returns
         * an empty string on success, or a human-readable error (e.g. the
         * device no longer exists, or offers no input channels) --
         * mirrors openDefaultDevice()'s own "empty string vs. an error
         * message" convention rather than throwing. */
        juce::String setRecordingInputDevice(const juce::String& deviceName);
```

Find (the private members section):

```cpp
        double secPerBar = 2.0; // updated via setBpm before play(); safe default avoids div-by-zero
```

Replace with:

```cpp
        double bpm = 120.0;
        double secPerBar = 2.0; // updated via setBpm before play(); safe default avoids div-by-zero
```

In `Transport.cpp`, add (right after `availableInputDeviceNames`'s definition from Step 2):

```cpp
    juce::String Transport::setRecordingInputDevice(const juce::String& deviceName)
    {
        auto setup = deviceManager.getAudioDeviceSetup();
        setup.inputDeviceName = deviceName;
        setup.useDefaultInputChannels = false;
        setup.inputChannels = juce::BigInteger();
        setup.inputChannels.setBit(0); // request just channel 0 -- LoopRecorder downmixes whatever it's given, but there's no reason to request more than one channel already
        return deviceManager.setAudioDeviceSetup(setup, true);
    }
```

- [ ] **Step 6: Add the three new message handlers to `IpcServer.cpp`**

Find:

```cpp
        else if (type == "set-position")
        {
            const double pos = payload.isObject() ? (double) payload.getProperty("pos", 0.0) : 0.0;
            transport.setPosition(pos);
        }
```

Replace with:

```cpp
        else if (type == "set-position")
        {
            const double pos = payload.isObject() ? (double) payload.getProperty("pos", 0.0) : 0.0;
            transport.setPosition(pos);
        }
        else if (type == "list-input-devices")
        {
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            juce::Array<juce::var> namesVar;
            for (const auto& name : transport.availableInputDeviceNames())
                namesVar.add(name);
            payloadObj->setProperty("devices", namesVar);
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "input-devices-list");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "arm-recording")
        {
            if (!payload.isObject())
                return;
            const auto channelId = payload.getProperty("channelId", "").toString();
            const auto deviceName = payload.getProperty("deviceName", "").toString();
            const double startBar = (double) payload.getProperty("startBar", 0.0);
            const double endBar = (double) payload.getProperty("endBar", 0.0);

            const auto error = transport.setRecordingInputDevice(deviceName);
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            if (error.isNotEmpty() || endBar <= startBar || transport.currentBpm() <= 0.0)
            {
                payloadObj->setProperty("success", false);
                payloadObj->setProperty(
                    "error", error.isNotEmpty() ? error : juce::String("invalid loop region"));
            }
            else
            {
                const double secPerBarNow = (60.0 / transport.currentBpm()) * 4.0;
                const double loopLengthSeconds = (endBar - startBar) * secPerBarNow;
                armedChannelId = channelId;
                armedRecorder = std::make_unique<LoopRecorder>(transport.currentSampleRate(), loopLengthSeconds);
                transport.setRecordingLoop(startBar, endBar);
                transport.setLoopRecorder(armedRecorder.get());
                payloadObj->setProperty("success", true);
            }
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "arm-recording-result");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "disarm-recording")
        {
            transport.setLoopRecorder(nullptr);
            transport.setRecordingLoop(0.0, 0.0);

            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            if (armedRecorder && armedRecorder->hasCompletedPass())
            {
                const auto outputPath = juce::File::getSpecialLocation(juce::File::tempDirectory)
                    .getChildFile("sssketch-recording-" + juce::Uuid().toString() + ".wav")
                    .getFullPathName();
                if (armedRecorder->writeToWavFile(outputPath))
                {
                    payloadObj->setProperty("committed", true);
                    payloadObj->setProperty("path", outputPath);
                }
                else
                {
                    payloadObj->setProperty("committed", false);
                    payloadObj->setProperty("error", "failed to write recording to disk");
                }
            }
            else
            {
                payloadObj->setProperty("committed", false);
            }
            armedRecorder.reset();
            armedChannelId = {};

            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "disarm-recording-result");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
```

- [ ] **Step 7: Build and run the full native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: builds clean, every native test (including Task 7's `LoopRecorder` tests and every pre-existing test) passes. This step doesn't exercise the real audio-device-switching code path (no automated test can, in this environment) — that's covered by Task 12's manual walkthrough.

- [ ] **Step 8: Commit**

```bash
git add native-engine/Source/Transport.h native-engine/Source/Transport.cpp native-engine/Source/IpcServer.h native-engine/Source/IpcServer.cpp
git commit -m "Wire LoopRecorder into Transport; add arm/disarm/list-input-devices IPC"
```

**Remember the native-engine reminder from the top of this plan:** rebuild and fully quit+relaunch Electron before any manual testing from here on.

---

### Task 9: Main process + preload bridge for arm/disarm; `importRecordedTake`; commit flow

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/importOneShot.ts`
- Test: `src/main/importOneShot.test.ts`
- Modify: `src/renderer/src/components/ChannelRow.tsx` (wire the real arm/disarm IPC calls, replacing the reducer-only dispatch from Task 4)

- [ ] **Step 1: Write the failing test for `importRecordedTake`**

In `src/main/importOneShot.test.ts`, find the existing `describe('importOneShot', ...)` block's test setup (the temp WAV fixture creation) and add a new sibling block using the same fixture-creation helper:

```ts
describe('importRecordedTake', () => {
  it('imports a recorded WAV as a non-one-shot stem at the given bpm/barLength', () => {
    const result = importRecordedTake(testWavPath, 140, 8) // reuse whatever variable name the existing importOneShot tests use for their fixture path
    expect(result).not.toBeNull()
    expect(result!.bpm).toBe(140)
    expect(result!.barLength).toBe(8)
    expect(result!.stems[0].oneShot).toBeUndefined()
    expect(result!.stems[0].barLength).toBe(8)
  })

  it('returns null for a non-wav path', () => {
    expect(importRecordedTake('/tmp/not-a-wav.mp3', 120, 4)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/importOneShot.test.ts -t "importRecordedTake"`
Expected: FAIL — `importRecordedTake` doesn't exist yet.

- [ ] **Step 3: Implement `importRecordedTake`**

In `src/main/importOneShot.ts`, find:

```ts
export function importOneShot(path: string): Rifff | null {
```

Add immediately before this function:

```ts
/**
 * Imports a recorded loop take (see docs/superpowers/specs/2026-08-03-loop-recording-design.md)
 * -- shares importOneShot's file-copy-into-library-folder and
 * WAV-duration-reading internals, but differs in exactly one respect: the
 * resulting stem is NOT oneShot. A loop recording should tile/stretch/loop
 * like any other rifff, at the project's own bpm and the loop region's
 * own bar length, not play once and stop.
 */
export function importRecordedTake(path: string, bpm: number, barLength: number): Rifff | null {
  if (!path.toLowerCase().endsWith('.wav')) return null

  let destDir: string | undefined
  try {
    if (!statSync(path).isFile()) return null

    const durationSec = readWavDurationSeconds(readWavHeaderBytes(path))
    if (durationSec <= 0) return null

    const groupId = randomUUID()
    destDir = join(libraryRoot(), groupId)
    mkdirSync(destDir, { recursive: true })
    const destPath = join(destDir, basename(path))
    copyFileSync(path, destPath)

    const displayName = `recording ${new Date().toLocaleTimeString()}`
    return {
      groupId,
      name: displayName,
      bpm,
      barLength,
      folderPath: path,
      stems: [
        {
          slot: 1,
          author: '',
          name: displayName,
          type: 'audioIn',
          path: destPath,
          durationSec,
          barLength
        }
      ]
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`importRecordedTake: failed to import ${path}: ${message}`)
    if (destDir) {
      try {
        rmSync(destDir, { recursive: true, force: true })
      } catch (cleanupErr) {
        console.error(`importRecordedTake: failed to clean up partial import at ${destDir}:`, cleanupErr)
      }
    }
    return null
  }
}

```

Check `@shared/types`' `SoundType` union for the exact literal used for the "audio in" type (this codebase's tokens.css calls it `--ra-type-audio-in`; confirm the matching TS literal — likely `'audioIn'` as used above, but verify against the real type definition before assuming) and correct the `type: 'audioIn'` line above if it differs.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/importOneShot.test.ts`
Expected: PASS — both new tests, and every pre-existing `importOneShot` test (unchanged, since this only adds a new sibling function).

- [ ] **Step 5: Add the preload bridge for `importRecordedTake`**

In `src/preload/index.ts`, find:

```ts
  importOneShot: (path: string): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-one-shot', path),
```

Replace with:

```ts
  importOneShot: (path: string): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-one-shot', path),
  importRecordedTake: (path: string, bpm: number, barLength: number): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-recorded-take', path, bpm, barLength),
```

Add the main-process handler. In `src/main/index.ts`, find:

```ts
  ipcMain.handle('import-one-shot', (_event, path: string) => {
    return importOneShot(path)
  })
```

Replace with:

```ts
  ipcMain.handle('import-one-shot', (_event, path: string) => {
    return importOneShot(path)
  })

  ipcMain.handle('import-recorded-take', (_event, path: string, bpm: number, barLength: number) => {
    return importRecordedTake(path, bpm, barLength)
  })
```

Add `importRecordedTake` to this file's existing `import { importOneShot } from './importOneShot'`-style import line.

- [ ] **Step 6: Add the arm/disarm/list-input-devices main-process handlers**

Find the Task 5 stub:

```ts
  // TEMPORARY stub -- returns an empty list until Task 8 wires this to a
  // real "list-input-devices" reply from the native engine. ...
  ipcMain.handle('engine-list-input-devices', async (): Promise<string[]> => {
```

Remove the "TEMPORARY stub" comment (the real engine-side handler landed in Task 8; this main-process code was already correct and needs no functional change) — just delete the two comment lines describing it as temporary, leaving the handler body itself untouched.

Add two new handlers immediately after it:

```ts
  ipcMain.handle(
    'engine-arm-recording',
    async (
      _event,
      channelId: string,
      deviceName: string,
      startBar: number,
      endBar: number
    ): Promise<{ success: boolean; error?: string }> => {
      if (!playbackEngine) return { success: false, error: 'engine not running' }
      try {
        return (await playbackEngine.client.sendAndAwaitType(
          'arm-recording',
          { channelId, deviceName, startBar, endBar },
          'arm-recording-result'
        )) as { success: boolean; error?: string }
      } catch (err) {
        console.error('engine-arm-recording: failed:', err)
        return { success: false, error: String(err) }
      }
    }
  )

  ipcMain.handle(
    'engine-disarm-recording',
    async (): Promise<{ committed: boolean; path?: string; error?: string }> => {
      if (!playbackEngine) return { committed: false }
      try {
        return (await playbackEngine.client.sendAndAwaitType(
          'disarm-recording',
          undefined,
          'disarm-recording-result'
        )) as { committed: boolean; path?: string; error?: string }
      } catch (err) {
        console.error('engine-disarm-recording: failed:', err)
        return { committed: false, error: String(err) }
      }
    }
  )
```

- [ ] **Step 7: Add the preload bridge for arm/disarm**

In `src/preload/index.ts`, find the `engineListInputDevices` line added in Task 5 and add immediately after:

```ts
  engineArmRecording: (
    channelId: string,
    deviceName: string,
    startBar: number,
    endBar: number
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('engine-arm-recording', channelId, deviceName, startBar, endBar),
  engineDisarmRecording: (): Promise<{ committed: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('engine-disarm-recording'),
```

- [ ] **Step 8: Wire the real arm/disarm flow into `ChannelRow`'s "r" button**

Replace Task 4's reducer-only `onClick` with the real IPC-backed flow. In `ChannelRow.tsx`, find:

```tsx
          {isRecordingChannel && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                dispatch(
                  isArmed
                    ? { type: 'DISARM_RECORDING_CHANNEL' }
                    : { type: 'ARM_RECORDING_CHANNEL', channelId }
                )
              }}
```

Replace with:

```tsx
          {isRecordingChannel && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void handleToggleArm()
              }}
```

Add `handleToggleArm` inside `ChannelRowImpl`, alongside its other handler functions (needs `loopRegion`, `playing`, `bpm` selectors added if not already present — check what's already selected in this component before re-adding):

```ts
  const loopRegion = useAppSelector((s) => s.loopRegion)
  const playing = usePlaying()

  async function handleToggleArm(): Promise<void> {
    if (isArmed) {
      const result = await window.rifffApi.engineDisarmRecording()
      dispatch({ type: 'DISARM_RECORDING_CHANNEL' })
      if (result.committed && result.path) {
        const rifff = await window.rifffApi.importRecordedTake(
          result.path,
          bpm, // reads the same bpm selector every other component already uses; add `const bpm = useAppSelector((s) => s.bpm)` if not already present in this file
          (loopRegion?.endBar ?? 0) - (loopRegion?.startBar ?? 0)
        )
        if (rifff) {
          dispatch({ type: 'ADD_TO_SHELF', rifff })
          // Replace any previous take on this channel -- see the design
          // doc's own "Retake behavior" section. Find the existing placed
          // rifff (if any) on this channel by scanning rifffsMap/channelOf,
          // already available as this component's own selectors.
          const previousTakeGroupId = Object.keys(rifffsMap).find(
            (id) => rifffsMap[id].startBar !== undefined && channelOfForThisChannel(id) === channelId
          )
          if (previousTakeGroupId) dispatch({ type: 'REMOVE_FROM_TIMELINE', groupId: previousTakeGroupId })
          dispatch({
            type: 'MOVE_TO_CHANNEL',
            groupId: rifff.groupId,
            startBar: loopRegion?.startBar ?? 0,
            channelId
          })
        }
      } else if (result.error) {
        window.alert(`Recording failed: ${result.error}`)
      }
    } else {
      if (!selectedInputDevice || !loopRegion) return
      const result = await window.rifffApi.engineArmRecording(
        channelId,
        selectedInputDevice,
        loopRegion.startBar,
        loopRegion.endBar
      )
      if (result.success) {
        dispatch({ type: 'ARM_RECORDING_CHANNEL', channelId })
        if (!playing) {
          dispatch({ type: 'SET_POS', pos: loopRegion.startBar })
          dispatch({ type: 'PLAY' })
        }
      } else {
        window.alert(`Failed to arm recording: ${result.error ?? 'unknown error'}`)
      }
    }
  }
```

**`channelOfForThisChannel` above is a placeholder for "look up `state.channelOf` reversed" — this component doesn't currently select the whole `channelOf` map.** Add `const channelOf = useAppSelector((s) => s.channelOf)` alongside the other new selectors, and replace `channelOfForThisChannel(id)` with `channelOf[id]` directly.

Confirmed against the one existing "start playback from code" call site in this codebase (`SketchStrip.tsx`'s tile-click handler): `dispatch({ type: 'SET_POS', pos })` followed by `dispatch({ type: 'PLAY' })`, with no direct `window.rifffApi.enginePlay(...)` call alongside it, is the complete, correct pattern — `PLAY`'s own effect elsewhere (`StoreContext.tsx`) reads `pos` fresh at play-start and calls `enginePlay` itself. The code above already matches this exactly; no change needed.

- [ ] **Step 9: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. This step touches both `main` and `web` typecheck configs (main process files changed too) — run the full `npm run typecheck`, not just `typecheck:web`.

- [ ] **Step 10: Run the full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/main/importOneShot.ts src/main/importOneShot.test.ts src/renderer/src/components/ChannelRow.tsx
git commit -m "Wire arm/disarm IPC, importRecordedTake, and the commit-take flow"
```

---

### Task 10: Live capture-level feedback (waveform building up while armed)

**Files:**
- Modify: `native-engine/Source/IpcServer.h`
- Modify: `native-engine/Source/IpcServer.cpp`
- Modify: `src/main/engineClient.ts` (none expected — confirm `on()` already supports an arbitrary new push type with no changes needed; this step is a verification, not an edit, unless something surprises you)
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/components/ChannelRow.tsx`

- [ ] **Step 1: Push `capture-level-update` from the engine's existing 30Hz timer**

In `IpcServer.cpp`, find:

```cpp
    void IpcConnection::timerCallback()
    {
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "position-update");
        juce::DynamicObject::Ptr payload = new juce::DynamicObject();
        payload->setProperty("pos", transport.currentPositionBars());
        obj->setProperty("payload", juce::var(payload.get()));
        sendJson(juce::var(obj.get()));
    }
```

Replace with:

```cpp
    void IpcConnection::timerCallback()
    {
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "position-update");
        juce::DynamicObject::Ptr payload = new juce::DynamicObject();
        payload->setProperty("pos", transport.currentPositionBars());
        obj->setProperty("payload", juce::var(payload.get()));
        sendJson(juce::var(obj.get()));

        if (armedRecorder)
        {
            juce::DynamicObject::Ptr capPayload = new juce::DynamicObject();
            capPayload->setProperty("channelId", armedChannelId);
            juce::Array<juce::var> peaksVar;
            for (float peak : armedRecorder->peaksSoFar(32)) // see Step 2
                peaksVar.add(peak);
            capPayload->setProperty("peaksSoFar", peaksVar);
            juce::DynamicObject::Ptr capObj = new juce::DynamicObject();
            capObj->setProperty("type", "capture-level-update");
            capObj->setProperty("payload", juce::var(capPayload.get()));
            sendJson(juce::var(capObj.get()));
        }
    }
```

- [ ] **Step 2: Add `LoopRecorder::peaksSoFar`**

In `LoopRecorder.h`, add (public section, alongside `hasCompletedPass`):

```cpp
        /** Per-bucket peak amplitude across however much of the buffer has
         * been written so far this pass (0 for buckets past the current
         * write position) -- numBuckets fixed, small (the renderer just
         * needs enough resolution for a coarse "building up" bar graph,
         * not a full waveform). Same "downsample into N buckets" idea as
         * @shared/visuals' peaksFromChannel on the renderer side, kept
         * separately here since this is a live, partially-filled buffer
         * being sampled every 33ms, not a one-shot full-file decode. */
        std::vector<float> peaksSoFar(int numBuckets) const;
```

In `LoopRecorder.cpp`, add:

```cpp
    std::vector<float> LoopRecorder::peaksSoFar(int numBuckets) const
    {
        std::vector<float> result(numBuckets, 0.0f);
        const int totalSamples = buffer.getNumSamples();
        const auto* data = buffer.getReadPointer(0);
        for (int b = 0; b < numBuckets; ++b)
        {
            const int bucketStart = (int) ((double) b / numBuckets * totalSamples);
            const int bucketEnd = (int) ((double) (b + 1) / numBuckets * totalSamples);
            if (bucketStart >= writePos) break; // this bucket and every later one is still unwritten this pass
            float peak = 0.0f;
            for (int i = bucketStart; i < std::min(bucketEnd, writePos); ++i)
                peak = std::max(peak, std::abs(data[i]));
            result[b] = peak;
        }
        return result;
    }
```

- [ ] **Step 3: Build and run native tests**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: builds clean, all tests pass. Consider adding a `peaksSoFar` unit test alongside Task 7's other `LoopRecorder` tests (feed a known buffer, assert buckets past `writePos` are 0 and buckets before it reflect the fed values) — not required by this plan's own testing section below, but cheap and directly exercises new logic; add it if convenient.

- [ ] **Step 4: Bridge the push message through main process + preload**

In `src/main/index.ts`, find where `onEnginePositionUpdate`'s equivalent forwarding lives (search for how `position-update` is forwarded from `playbackEngine.client.on(...)` to the renderer via `webContents.send`) and add an equivalent block for `capture-level-update`, forwarding to a new `'capture-level-update'` renderer-facing channel. Match whatever the existing position-update forwarding code does exactly (likely inside `playbackEngineLifecycle.ts` or right after `startPlaybackEngine()` in `index.ts` — check both).

In `src/preload/index.ts`, find:

```ts
  onEnginePositionUpdate: (callback: (pos: number) => void): (() => void) => {
    const listener = (_event: unknown, payload: { pos: number }): void => callback(payload.pos)
    ipcRenderer.on('engine-position-update', listener)
    return () => ipcRenderer.removeListener('engine-position-update', listener)
  },
```

Add immediately after:

```ts
  onCaptureLevelUpdate: (
    callback: (channelId: string, peaksSoFar: number[]) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: { channelId: string; peaksSoFar: number[] }
    ): void => callback(payload.channelId, payload.peaksSoFar)
    ipcRenderer.on('capture-level-update', listener)
    return () => ipcRenderer.removeListener('capture-level-update', listener)
  },
```

- [ ] **Step 5: Render the building-up waveform in `ChannelRow`**

Add a small local `useState<number[]>([])` in `ChannelRowImpl`, subscribed only while this channel is armed:

```ts
  const [capturePeaks, setCapturePeaks] = useState<number[]>([])
  useEffect(() => {
    if (!isArmed) {
      setCapturePeaks([])
      return
    }
    return window.rifffApi.onCaptureLevelUpdate((updateChannelId, peaks) => {
      if (updateChannelId === channelId) setCapturePeaks(peaks)
    })
  }, [isArmed, channelId])
```

Render it as a simple bar overlay across the loop region's own on-screen span while `isArmed` — reuse the exact same "solid vs. dim bar" idiom already described in the design doc (no glow, per the earlier design feedback). Exact JSX placement depends on how `ChannelRow` computes the loop region's own `leftPx`/`widthPx` in screen space (via `ppb` and `loopRegion`, both need to be read here if not already) — add:

```tsx
{isArmed && loopRegion && (
  <div
    style={{
      position: 'absolute',
      left: loopRegion.startBar * ppb,
      width: (loopRegion.endBar - loopRegion.startBar) * ppb,
      top: 0,
      bottom: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 1,
      padding: '0 2px',
      pointerEvents: 'none'
    }}
  >
    {capturePeaks.map((peak, i) => (
      <div
        key={i}
        style={{
          width: 3,
          height: `${Math.max(4, peak * 100)}%`,
          background: peak > 0 ? 'var(--ra-type-audio-in)' : 'var(--ra-border)'
        }}
      />
    ))}
  </div>
)}
```

(`ppb` needs to come from `useZoom()` if not already imported in this file — check before adding a duplicate.)

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add native-engine/Source/IpcServer.h native-engine/Source/IpcServer.cpp native-engine/Source/LoopRecorder.h native-engine/Source/LoopRecorder.cpp src/main/index.ts src/preload/index.ts src/renderer/src/components/ChannelRow.tsx
git commit -m "Add live capture-level waveform feedback while a channel is armed"
```

---

### Task 11: "Remove recording channel" action + context menu entry

**Files:**
- Modify: `src/renderer/src/components/ChannelRow.tsx` or wherever this app's existing per-channel context menu lives (check `ChannelChainPanel.tsx`'s own trigger, or search for any existing right-click handler scoped to a whole channel rather than a clip — if none exists yet, the simplest addition is a small "x" button next to the "r" toggle, only for a recording channel, rather than inventing a new context-menu surface this codebase doesn't otherwise have at the channel level)

- [ ] **Step 1: Add the remove action's UI trigger**

Given this codebase's context menus are scoped to CLIPS (`onOpenContextMenu`/`ContextMenu.tsx`), not whole channels, the simplest consistent addition is a small extra button — reusing the same button-stack idiom as m/s/fx/r — rather than introducing a new interaction pattern:

```tsx
{isRecordingChannel && (
  <button
    onClick={(e) => {
      e.stopPropagation()
      if (window.confirm('Remove this recording channel?')) {
        dispatch({ type: 'REMOVE_RECORDING_CHANNEL', channelId })
      }
    }}
    aria-label={`remove recording channel ${channelId}`}
    title="remove recording channel"
    style={{ ...baseButtonStyle, color: 'var(--ra-text-2)' }}
  >
    x
  </button>
)}
```

Place this in the same conditional block as the "r" button from Task 4, after it.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck:web && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ChannelRow.tsx
git commit -m "Add remove-recording-channel button"
```

---

### Task 12: Full verification and manual walkthrough

- [ ] **Step 1: Run the full test suite, typecheck, and lint one more time**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all succeed.

- [ ] **Step 2: Run the native test suite one more time**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: all pass.

- [ ] **Step 3: Rebuild and fully relaunch before manual testing**

```bash
cd native-engine && cmake --build build
```
Then fully quit (Cmd+Q) and relaunch the Electron app (`npm run dev`) — per this repo's own CLAUDE.md, a renderer reload alone will not pick up the native engine changes from Tasks 7-10.

- [ ] **Step 4: Manual verification**

Not automatable in this environment (no audio-device access, no GUI interaction tooling):

1. Drag on the Ruler to set a loop region; confirm the brace renders, and dragging either edge afterward adjusts just that edge.
2. Open the input device dropdown; confirm it lists real devices, including a loopback driver (BlackHole or similar, installed and routed in beforehand) and the built-in microphone.
3. Click "+ rec channel"; confirm a new empty channel row appears with an "r" button (disabled/greyed until a device is selected — confirm the disabled state visually matches this app's existing disabled-button treatment).
4. Select the loopback device, then arm the recording channel; confirm playback starts (looping within the loop region) if it wasn't already running.
5. Confirm the live waveform builds up left-to-right across the loop region as a pass progresses, resetting at each loop boundary.
6. Disarm; confirm the committed clip lands on the recording channel at the loop region's start, at the correct length, and plays back in tempo alongside anything else in the project.
7. Arm again, let it record a second take, disarm; confirm the second take REPLACES the first (only one clip on that channel afterward), not stacked alongside it.
8. Arm, disarm before a single pass completes; confirm no clip is created and no error is shown.
9. Switch the selected device to the built-in microphone; confirm a take actually captures mic input (speak/make noise during the pass), not stale loopback audio.
10. Unplug/deselect the loopback device from the OS entirely (or pick a device name that no longer exists, if easily reproducible) and attempt to arm; confirm a visible error rather than a hang or crash.
11. Delete the clip currently on a recording channel via the normal clip-delete flow (not the channel-remove button); confirm the recording channel's own row survives (this is the `channelHasAnyClip` exemption from Task 3 — the most likely place for a regression if that logic has a gap).
12. Use the "x" remove-recording-channel button while armed; confirm it disarms cleanly first (no dangling engine-side recorder, no crash) before removing the row.
13. Confirm undo/redo behaves sensibly across "+ rec channel", loop-region changes, and a committed take landing (arm/disarm themselves are transient/non-undo per Task 3's design, matching volumeDragMode's own convention — confirm THAT specifically, i.e. undo right after disarming should undo the take's placement, not "re-arm").
14. Confirm a normal (non-recording) channel and normal playback are completely unaffected by any of this — no regressions in ordinary arranging/playback.

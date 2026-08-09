# Rifff Recording (Stem-Attach) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let double-clicking a placed rifff (in either normal or sketch mode) target it for
gated recording — a locked-in take becomes a new **stem** on that rifff instead of a new
standalone rifff on its own channel. This is what makes gated recording possible in sketch mode
at all (it has no channel/Ruler concept today).

**Architecture:** A new mutually-exclusive-with-`gatedRecordingChannelId` state field,
`gatedRecordingTargetGroupId`, tracks which rifff (if any) is the current lock-in destination.
The five existing gated-recording control functions currently living as closures inside
`App.tsx` (`enableGatedRecording`, `disableGatedRecording`, `lockInGatedRecording`,
`confirmLockInIfRecording`, `handleStop`) move into a new custom hook,
`useGatedRecordingControls()`, so a new `targetRifffForRecording` function can share them with
`RifffBlockRow.tsx` and `SketchStrip.tsx` without prop-drilling through `ChannelRow.tsx` (which
has nothing to do with this feature) or duplicating the confirm-before-losing-a-take logic.
`lockInGatedRecording` gains a new branch: when a target rifff is pinned, build a `Stem` (via a
new `importRecordedStem`, sibling to the existing `importRecordedTake`) and dispatch a new
`ADD_STEM_TO_RIFFF` action instead of placing a new rifff on a channel.

**Tech Stack:** TypeScript, React, a single-reducer store (`state/store.ts`), Electron
IPC/preload bridge. No native engine changes — the native `GatedLoopRecorder`/`Transport.cpp`
are completely unaware of this distinction; both flows call the same `engineCaptureGatedTake`
IPC and get back the same `{ path, committed, latencyCompensationBars }`.

---

## File Structure

- **Modify `src/renderer/src/state/store.ts`**: new `gatedRecordingTargetGroupId` field,
  `SET_GATED_RECORDING_TARGET` action, `ADD_STEM_TO_RIFFF` action.
- **Modify `src/renderer/src/state/history.ts`**: `SET_GATED_RECORDING_TARGET` added to
  `TRANSIENT_ACTION_TYPES` (not `ADD_STEM_TO_RIFFF` — that's a real, undo-able edit).
- **Modify `src/renderer/src/state/serialize.ts`**: exclude `gatedRecordingTargetGroupId` from
  persisted projects, same treatment as `gatedRecordingChannelId`.
- **Modify `src/main/importOneShot.ts`**: new `importRecordedStem` function.
- **Modify `src/main/index.ts`** and **`src/preload/index.ts`**: new IPC handler/bridge method
  for `importRecordedStem`.
- **Create `src/renderer/src/state/useGatedRecordingControls.ts`**: a new custom hook. Moves
  `enableGatedRecording`, `disableGatedRecording`, `lockInGatedRecording`,
  `confirmLockInIfRecording`, `handleStop` out of `App.tsx` (unchanged logic, just relocated out
  of the App component's closure into hook-internal `useAppState()`/`useDispatch()`/
  `usePlaying()` calls), extends three of them for the new target-group branch, and adds
  `targetRifffForRecording`. This is what lets `RifffBlockRow.tsx`/`SketchStrip.tsx` reach the
  same confirm-before-losing-a-take logic `App.tsx` already built, without threading a callback
  prop through `ChannelRow.tsx`.
- **Modify `src/renderer/src/App.tsx`**: replace the five inline closures with
  `useGatedRecordingControls()` calls (same names, same call sites — `TransportBar`'s props, the
  `\` key handler, the spacebar handler all keep working unchanged).
- **Modify `src/renderer/src/components/RifffBlockRow.tsx`**: `onDoubleClick` calls
  `targetRifffForRecording` instead of dispatching `SET_LOOP_REGION` directly; new purple
  pulsing dot indicator.
- **Modify `src/renderer/src/components/SketchStrip.tsx`**: new `onDoubleClick` handler (none
  exists today) calling `targetRifffForRecording`; new purple pulsing dot indicator.

---

### Task 1: `gatedRecordingTargetGroupId` field + `SET_GATED_RECORDING_TARGET` action

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/src/state/store.test.ts` (anywhere inside the top-level `describe('reducer', ...)` block — put it near the end, after the existing tests):

```typescript
  describe('SET_GATED_RECORDING_TARGET', () => {
    it('sets gatedRecordingTargetGroupId', () => {
      const state = reducer(initialState, {
        type: 'SET_GATED_RECORDING_TARGET',
        groupId: 'r1'
      })
      expect(state.gatedRecordingTargetGroupId).toBe('r1')
    })

    it('clears it back to null', () => {
      let state = reducer(initialState, { type: 'SET_GATED_RECORDING_TARGET', groupId: 'r1' })
      state = reducer(state, { type: 'SET_GATED_RECORDING_TARGET', groupId: null })
      expect(state.gatedRecordingTargetGroupId).toBeNull()
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "SET_GATED_RECORDING_TARGET"`
Expected: FAIL — `Object literal may only specify known properties` / `Property
'gatedRecordingTargetGroupId' does not exist` (the action type and field don't exist yet).

- [ ] **Step 3: Add the field to `AppState`**

In `src/renderer/src/state/store.ts`, find this block (currently the last field before
`rifffs`):

```typescript
  gatedRecordingChannelId: string | null
  rifffs: Record<string, Rifff>
}
```

Replace with:

```typescript
  gatedRecordingChannelId: string | null
  /** Which rifff (by groupId), if any, the NEXT gated-recording lock-in
   * will attach a new STEM to -- set by double-clicking a placed rifff
   * (RifffBlockRow.tsx/SketchStrip.tsx, via useGatedRecordingControls'
   * targetRifffForRecording), mutually exclusive with
   * gatedRecordingChannelId above (enabling recording via either path
   * clears the other -- see targetRifffForRecording's own doc comment).
   * null while nothing is targeted. Not persisted, same "how I'm
   * currently working" convention as gatedRecordingChannelId. See
   * docs/superpowers/specs/2026-08-06-rifff-recording-design.md. */
  gatedRecordingTargetGroupId: string | null
  rifffs: Record<string, Rifff>
}
```

- [ ] **Step 4: Add it to `initialState`**

Find:

```typescript
  gatedRecordingEnabled: false,
  gatedRecordingChannelId: null,
```

Replace with:

```typescript
  gatedRecordingEnabled: false,
  gatedRecordingChannelId: null,
  gatedRecordingTargetGroupId: null,
```

- [ ] **Step 5: Add the action type**

Find:

```typescript
  | { type: 'SET_GATED_RECORDING_CHANNEL'; channelId: string | null }
```

Replace with:

```typescript
  | { type: 'SET_GATED_RECORDING_CHANNEL'; channelId: string | null }
  | { type: 'SET_GATED_RECORDING_TARGET'; groupId: string | null }
```

- [ ] **Step 6: Add the reducer case**

Find:

```typescript
    case 'SET_GATED_RECORDING_CHANNEL':
      return { ...state, gatedRecordingChannelId: action.channelId }
```

Replace with:

```typescript
    case 'SET_GATED_RECORDING_CHANNEL':
      return { ...state, gatedRecordingChannelId: action.channelId }

    case 'SET_GATED_RECORDING_TARGET':
      return { ...state, gatedRecordingTargetGroupId: action.groupId }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "SET_GATED_RECORDING_TARGET"`
Expected: PASS (2 tests)

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms no other file destructures `AppState` exhaustively in a way this
new field would break — it won't, since every existing spread-based reducer case already
carries unknown fields through via `...state`).

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "Add gatedRecordingTargetGroupId + SET_GATED_RECORDING_TARGET action"
```

---

### Task 2: `ADD_STEM_TO_RIFFF` action

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/src/state/store.test.ts`:

```typescript
  describe('ADD_STEM_TO_RIFFF', () => {
    it('appends the stem to the rifff’s own stems array', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      const newStem: Rifff['stems'][number] = {
        slot: 7,
        author: '',
        name: 'groovy sparrow 1:00:00 PM',
        type: 'audioIn',
        path: '/x/take.wav',
        durationSec: 4,
        barLength: 4,
        recordedInApp: true
      }
      state = reducer(state, { type: 'ADD_STEM_TO_RIFFF', groupId: 'r1', stem: newStem })
      expect(state.rifffs.r1.stems).toHaveLength(3)
      expect(state.rifffs.r1.stems[2]).toEqual(newStem)
    })

    it('extends rifff.barLength to the new stem’s barLength when it’s longer', () => {
      // makeRifff()'s own barLength is 8 (from its own stems, slot 1's barLength).
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      const newStem: Rifff['stems'][number] = {
        slot: 7,
        author: '',
        name: 'take',
        type: 'audioIn',
        path: '/x/take.wav',
        durationSec: 40,
        barLength: 16,
        recordedInApp: true
      }
      state = reducer(state, { type: 'ADD_STEM_TO_RIFFF', groupId: 'r1', stem: newStem })
      expect(state.rifffs.r1.barLength).toBe(16)
    })

    it('leaves rifff.barLength unchanged when the new stem is shorter', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      const newStem: Rifff['stems'][number] = {
        slot: 7,
        author: '',
        name: 'take',
        type: 'audioIn',
        path: '/x/take.wav',
        durationSec: 2,
        barLength: 2,
        recordedInApp: true
      }
      state = reducer(state, { type: 'ADD_STEM_TO_RIFFF', groupId: 'r1', stem: newStem })
      expect(state.rifffs.r1.barLength).toBe(8)
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "ADD_STEM_TO_RIFFF"`
Expected: FAIL — `ADD_STEM_TO_RIFFF` isn't a valid action type yet.

- [ ] **Step 3: Add the action type**

In `src/renderer/src/state/store.ts`, find:

```typescript
  | { type: 'SET_GATED_RECORDING_TARGET'; groupId: string | null }
```

Replace with:

```typescript
  | { type: 'SET_GATED_RECORDING_TARGET'; groupId: string | null }
  | { type: 'ADD_STEM_TO_RIFFF'; groupId: string; stem: Rifff['stems'][number] }
```

- [ ] **Step 4: Add the reducer case**

Find:

```typescript
    case 'SET_GATED_RECORDING_TARGET':
      return { ...state, gatedRecordingTargetGroupId: action.groupId }
```

Replace with:

```typescript
    case 'SET_GATED_RECORDING_TARGET':
      return { ...state, gatedRecordingTargetGroupId: action.groupId }

    case 'ADD_STEM_TO_RIFFF': {
      const rifff = state.rifffs[action.groupId]
      return {
        ...state,
        rifffs: {
          ...state.rifffs,
          [action.groupId]: {
            ...rifff,
            stems: [...rifff.stems, action.stem],
            // Mirrors buildRifff.ts's own "a rifff's own barLength is the
            // max across its stems" convention -- only extends, never
            // shrinks (a shorter new stem doesn't truncate its siblings).
            barLength: Math.max(rifff.barLength, action.stem.barLength)
          }
        }
      }
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "ADD_STEM_TO_RIFFF"`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full store test suite**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: all PASS (confirms nothing else broke)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "Add ADD_STEM_TO_RIFFF reducer action"
```

---

### Task 3: `SET_GATED_RECORDING_TARGET` is transient (not undo-tracked)

**Files:**
- Modify: `src/renderer/src/state/history.ts`
- Test: `src/renderer/src/state/history.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/src/state/history.test.ts`, inside the `describe('historyReducer', ...)`
block:

```typescript
  it('does not push history for SET_GATED_RECORDING_TARGET', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    const pastLengthAfterRealEdit = h.past.length
    h = historyReducer(h, { type: 'SET_GATED_RECORDING_TARGET', groupId: 'r1' })
    expect(h.past).toHaveLength(pastLengthAfterRealEdit)
    expect(h.present.gatedRecordingTargetGroupId).toBe('r1')
  })

  it('DOES push history for ADD_STEM_TO_RIFFF -- it is a real, undo-able edit', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    const pastLengthAfterRealEdit = h.past.length
    h = historyReducer(h, {
      type: 'ADD_STEM_TO_RIFFF',
      groupId: 'r1',
      stem: { slot: 7, author: '', name: 'take', type: 'audioIn', path: '/x.wav', durationSec: 4, barLength: 4 }
    })
    expect(h.past.length).toBeGreaterThan(pastLengthAfterRealEdit)
    expect(h.present.rifffs.r1.stems).toHaveLength(2)
    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.rifffs.r1.stems).toHaveLength(1)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/state/history.test.ts -t "SET_GATED_RECORDING_TARGET"`
Expected: FAIL — `h.past` grows by one entry (the action isn't transient yet), so
`toHaveLength(pastLengthAfterRealEdit)` fails.

- [ ] **Step 3: Add it to `TRANSIENT_ACTION_TYPES`**

In `src/renderer/src/state/history.ts`, find:

```typescript
  'SET_GATED_RECORDING_CHANNEL',
```

Replace with:

```typescript
  'SET_GATED_RECORDING_CHANNEL',
  // Same "how I'm currently working" bookkeeping category as
  // SET_GATED_RECORDING_CHANNEL just above -- pinning/clearing which
  // rifff a lock-in will land on isn't itself a user edit worth an undo
  // checkpoint. ADD_STEM_TO_RIFFF (the actual lock-in) is NOT in this
  // set -- that one really is an edit.
  'SET_GATED_RECORDING_TARGET',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/state/history.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/history.ts src/renderer/src/state/history.test.ts
git commit -m "Make SET_GATED_RECORDING_TARGET transient (not undo-tracked)"
```

---

### Task 4: Exclude `gatedRecordingTargetGroupId` from persisted projects

**Files:**
- Modify: `src/renderer/src/state/serialize.ts`
- Test: `src/renderer/src/state/serialize.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/src/state/serialize.test.ts`, inside the `describe('project
serialization', ...)` block:

```typescript
  it('does not persist gatedRecordingTargetGroupId -- always reopens with nothing targeted', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'SET_GATED_RECORDING_TARGET', groupId: 'r1' })
    expect(state.gatedRecordingTargetGroupId).toBe('r1')

    const json = serializeProject(state)
    expect(JSON.parse(json).gatedRecordingTargetGroupId).toBeUndefined()

    const restored = deserializeProject(JSON.parse(json))
    expect(restored.gatedRecordingTargetGroupId).toBeNull()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/state/serialize.test.ts -t "gatedRecordingTargetGroupId"`
Expected: FAIL — `JSON.parse(json).gatedRecordingTargetGroupId` is `'r1'`, not `undefined` (it's
still being serialized).

- [ ] **Step 3: Exclude it from `PersistedProject`**

In `src/renderer/src/state/serialize.ts`, find:

```typescript
  | 'gatedRecordingEnabled'
  | 'gatedRecordingChannelId'
>
```

Replace with:

```typescript
  | 'gatedRecordingEnabled'
  | 'gatedRecordingChannelId'
  | 'gatedRecordingTargetGroupId'
>
```

- [ ] **Step 4: Drop it in `serializeProject`'s destructure**

Find:

```typescript
    gatedRecordingEnabled,
    gatedRecordingChannelId,
    ...rest
```

Replace with:

```typescript
    gatedRecordingEnabled,
    gatedRecordingChannelId,
    gatedRecordingTargetGroupId,
    ...rest
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/state/serialize.test.ts`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/serialize.ts src/renderer/src/state/serialize.test.ts
git commit -m "Exclude gatedRecordingTargetGroupId from persisted projects"
```

---

### Task 5: `importRecordedStem` (main process)

**Files:**
- Modify: `src/main/importOneShot.ts`
- Test: `src/main/importOneShot.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/main/importOneShot.test.ts`. First, add `Stem` to the type import at the top of the
file — find:

```typescript
import { importOneShot, importRecordedTake } from './importOneShot'
```

Replace with:

```typescript
import { importOneShot, importRecordedTake, importRecordedStem } from './importOneShot'
```

Then add a new `describe` block at the end of the file:

```typescript
describe('importRecordedStem', () => {
  it('returns a Stem (not a Rifff) with the compensated barLength when rifff.bpm differs from the live tempo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedstem-test-'))
    try {
      // 4 bars at 120bpm (2s/bar) = 8 real seconds captured.
      const testWavPath = writeTestWav(dir, 'take.wav', 8.0)
      // rifff.bpm=150 (the rifff's own fixed tempo), captured at 4 bars.
      const stem = importRecordedStem(testWavPath, 150, 4)
      expect(stem).not.toBeNull()
      // barLength = durationSec * rifff.bpm / 240 = 8 * 150 / 240 = 5.
      expect(stem!.barLength).toBeCloseTo(5, 5)
      expect(stem!.durationSec).toBeCloseTo(8.0, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is a no-op compensation (barLength === loopBars) when rifff.bpm equals the capture tempo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedstem-test-'))
    try {
      // 4 bars at 120bpm (2s/bar) = 8 real seconds -- captured AT rifff.bpm
      // itself (120), so compensation should reduce to barLength=loopBars.
      const testWavPath = writeTestWav(dir, 'take.wav', 8.0)
      const stem = importRecordedStem(testWavPath, 120, 4)
      expect(stem!.barLength).toBeCloseTo(4, 5)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('assigns a slot one past the highest existing slot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedstem-test-'))
    try {
      const testWavPath = writeTestWav(dir, 'take.wav', 4.0)
      const stem = importRecordedStem(testWavPath, 120, 4, [1, 6, 3])
      expect(stem!.slot).toBe(7)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('assigns slot 0 when the rifff has no existing stems', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedstem-test-'))
    try {
      const testWavPath = writeTestWav(dir, 'take.wav', 4.0)
      const stem = importRecordedStem(testWavPath, 120, 4, [])
      expect(stem!.slot).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('names the stem a random "adjective noun" pair followed by the record time, type audioIn, recordedInApp, no oneShot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedstem-test-'))
    try {
      const testWavPath = writeTestWav(dir, 'take.wav', 4.0)
      const stem = importRecordedStem(testWavPath, 120, 4, [])
      expect(stem!.name).toMatch(/^[a-z]+ [a-z]+ .+$/)
      expect(stem!.type).toBe('audioIn')
      expect(stem!.recordedInApp).toBe(true)
      expect(stem!.oneShot).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a non-wav path', () => {
    expect(importRecordedStem('/tmp/not-a-wav.mp3', 120, 4, [])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/importOneShot.test.ts -t "importRecordedStem"`
Expected: FAIL — `importRecordedStem` doesn't exist yet (TypeScript import error).

- [ ] **Step 3: Implement `importRecordedStem`**

In `src/main/importOneShot.ts`, add `Stem` to the type import at the top:

```typescript
import type { Rifff, Stem } from '@shared/types'
```

Then add the new function at the end of the file, after `importRecordedTake`:

```typescript
/**
 * Imports a gated-recording take as a STEM to attach to an existing rifff
 * (App.tsx's useGatedRecordingControls, the double-click-a-rifff path --
 * see docs/superpowers/specs/2026-08-06-rifff-recording-design.md), rather
 * than a whole new Rifff (that's importRecordedTake's job, unchanged, for
 * the manual-Ruler-drag / standalone-channel path). Shares
 * copyIntoLibrary's own "copy the WAV into the library, measure its real
 * duration" step.
 *
 * barLength is NOT loopBars directly -- a rifff's own stems all stretch
 * together by ONE shared ratio (state.bpm / rifff.bpm), but this stem was
 * captured live at the CURRENT project tempo, not at rifffBpm. Naively
 * using loopBars would double-stretch it whenever rifffBpm differs from
 * the live tempo. Instead, barLength is chosen so this stem's own "native
 * tempo" (durationSec/barLength-derived, see buildAlsXml.ts's
 * nativeBpmFor) resolves to EXACTLY rifffBpm -- the rifff's shared stretch
 * ratio then maps that back to the tempo it was actually captured at,
 * correctly, regardless of how far rifffBpm has drifted from the live
 * project tempo:
 *
 *   durationSec = actual captured duration (loopBars * secPerBar at record time)
 *   barLength   = durationSec * rifffBpm / 240
 *
 * When rifffBpm equals the live capture tempo, this reduces to exactly
 * barLength = loopBars (secPerBar = 240/bpm, so durationSec =
 * loopBars*240/bpm, and durationSec*bpm/240 = loopBars) -- i.e. no
 * observable compensation in the common case where the rifff's own tempo
 * already matches.
 *
 * existingSlots is every OTHER stem's slot already on the target rifff --
 * this stem's own slot is one past the highest of those (or 0 if the
 * rifff has none), just enough to avoid a collision; no attempt to
 * reproduce real Endlesss instrument-slot semantics.
 */
export function importRecordedStem(
  path: string,
  rifffBpm: number,
  loopBars: number,
  existingSlots: number[] = []
): Stem | null {
  const copied = copyIntoLibrary(path, 'importRecordedStem')
  if (!copied) return null
  const { destPath, durationSec } = copied

  const barLength = (durationSec * rifffBpm) / 240
  const slot = existingSlots.length === 0 ? 0 : Math.max(...existingSlots) + 1
  const name = `${randomAdjectiveNoun()} ${new Date().toLocaleTimeString()}`

  return {
    slot,
    author: '',
    name,
    type: 'audioIn',
    path: destPath,
    durationSec,
    barLength,
    recordedInApp: true
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/importOneShot.test.ts`
Expected: all PASS

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/main/importOneShot.ts src/main/importOneShot.test.ts
git commit -m "Add importRecordedStem for the double-click-to-attach recording flow"
```

---

### Task 6: IPC handler + preload bridge for `importRecordedStem`

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

No dedicated test file for this glue (matches `import-recorded-take`'s own precedent, which has
none either) -- verified via typecheck plus the manual walkthrough in the final task.

- [ ] **Step 1: Import it in `src/main/index.ts`**

Find:

```typescript
import { importOneShot, importRecordedTake } from './importOneShot'
```

Replace with:

```typescript
import { importOneShot, importRecordedTake, importRecordedStem } from './importOneShot'
```

- [ ] **Step 2: Add the IPC handler**

Find:

```typescript
  ipcMain.handle('import-recorded-take', (_event, path: string, bpm: number, loopBars?: number) => {
    return importRecordedTake(path, bpm, loopBars)
  })
```

Replace with:

```typescript
  ipcMain.handle('import-recorded-take', (_event, path: string, bpm: number, loopBars?: number) => {
    return importRecordedTake(path, bpm, loopBars)
  })

  ipcMain.handle(
    'import-recorded-stem',
    (_event, path: string, rifffBpm: number, loopBars: number, existingSlots: number[]) => {
      return importRecordedStem(path, rifffBpm, loopBars, existingSlots)
    }
  )
```

- [ ] **Step 3: Add the preload bridge method**

In `src/preload/index.ts`, `Stem` needs to be importable — check the top of the file for the
existing `@shared/types` import and add `Stem` to it. Find:

```typescript
import type { Rifff, ExportedStem } from '@shared/types'
```

Replace with:

```typescript
import type { Rifff, ExportedStem, Stem } from '@shared/types'
```

Then find:

```typescript
  // loopBars, when passed, is a gated-recording take's own loop-region
  // length -- see importRecordedTake's own doc comment for why that makes
  // it tile/loop like any other rifff instead of playing once (the default
  // when omitted, for manual arm/disarm takes).
  importRecordedTake: (path: string, bpm: number, loopBars?: number): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-recorded-take', path, bpm, loopBars),
```

Replace with:

```typescript
  // loopBars, when passed, is a gated-recording take's own loop-region
  // length -- see importRecordedTake's own doc comment for why that makes
  // it tile/loop like any other rifff instead of playing once (the default
  // when omitted, for manual arm/disarm takes).
  importRecordedTake: (path: string, bpm: number, loopBars?: number): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-recorded-take', path, bpm, loopBars),
  // See importRecordedStem's own doc comment (src/main/importOneShot.ts)
  // for the tempo-compensation math -- rifffBpm is the TARGET rifff's own
  // bpm (not the project's live state.bpm), existingSlots is every other
  // stem already on that rifff (for slot-collision avoidance).
  importRecordedStem: (
    path: string,
    rifffBpm: number,
    loopBars: number,
    existingSlots: number[]
  ): Promise<Stem | null> =>
    ipcRenderer.invoke('import-recorded-stem', path, rifffBpm, loopBars, existingSlots),
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Wire importRecordedStem IPC handler + preload bridge"
```

---

### Task 7: `useGatedRecordingControls` hook — move existing functions, no behavior change yet

This task is a pure relocation: move `enableGatedRecording`, `disableGatedRecording`,
`lockInGatedRecording`, `confirmLockInIfRecording`, `handleStop` out of `App.tsx` into a new
hook file, unchanged in behavior. Task 8 extends them for the new target-group branch.

**Files:**
- Create: `src/renderer/src/state/useGatedRecordingControls.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Find the exact current code being moved**

In `src/renderer/src/App.tsx`, locate this whole block (currently roughly lines 1229–1394,
starting at the `// Endlesss-style gated...` comment and ending right after the `\` key
`useEffect`):

```typescript
  // Endlesss-style gated ("always listening") recording -- see
  // GatedLoopRecorder's own doc comment (native-engine) for the full
  // design. Three separate actions (below), not one toggle-everything
  // function: enable (off -> on, \ key or clicking the rec dot while off),
  // lock in (\ key while on -- commits the current pass WITHOUT turning
  // recording mode off, so repeated \ presses grab successive takes across
  // multiple loop passes), and disable (clicking the rec dot while on --
  // stops listening WITHOUT committing whatever's currently captured, a
  // plain cancel/abort). Splitting these out (rather than \-while-on also
  // auto-disabling, an earlier design) was a direct response to real
  // feedback: users need an explicit way to stop without losing the
  // ability to grab multiple takes via \ alone.
  async function enableGatedRecording(): Promise<void> {
    const region = state.loopRegion
    const loopBars = region ? region.endBar - region.startBar : 0
    if (!region || loopBars <= 0 || loopBars > 16) {
      window.alert('select a loop region of 16 bars or less first (drag on the ruler)')
      return
    }
    const result = await window.rifffApi.engineSetGatedRecordingEnabled(
      true,
      region.startBar,
      region.endBar
    )
    if (!result.success) {
      if (result.error) window.alert(`Couldn't enable recording mode: ${result.error}`)
      return
    }
    dispatch({ type: 'SET_GATED_RECORDING_ENABLED', enabled: true })
    // Pins down exactly which recording channel the NEXT lock-in will land
    // on -- reuses an existing EMPTY recording channel if one's sitting
    // around (e.g. the always-present invariant channel from the mount
    // effect above), otherwise mints a fresh one. This is also what
    // ChannelRow.tsx's live waveform overlay binds to (see
    // gatedRecordingChannelId's own doc comment on AppState) -- pinning it
    // HERE, once, rather than re-deriving "the" recording channel by
    // searching channelOrder each render, is what keeps the overlay and the
    // actual lock-in destination from ever disagreeing.
    const placedChannelIds = new Set(Object.values(state.channelOf))
    const emptyRecordingChannelId = state.channelOrder.find(
      (id) => state.recordingChannelIds[id] && !placedChannelIds.has(id)
    )
    const targetChannelId = emptyRecordingChannelId ?? crypto.randomUUID()
    if (!emptyRecordingChannelId) {
      dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: targetChannelId })
    }
    dispatch({ type: 'SET_GATED_RECORDING_CHANNEL', channelId: targetChannelId })
    // Starts playback automatically if it isn't already running -- gated
    // recording only ever captures anything while the transport is
    // actually moving, so without this, arming it and not separately
    // remembering to hit play produced a real reported bug ("didn't seem
    // to record anything"). Deliberately does NOT jump to region.startBar
    // anymore (an earlier version did) -- per direct feedback ("it should
    // just go with the spot you press it at"), enabling recording
    // shouldn't yank the playhead anywhere. Play (or keep playing) from
    // wherever pos already is; Transport.cpp's own renderLoopAware now
    // handles "hasn't reached the loop region yet" by playing straight
    // through unwrapped until it arrives there naturally, then looping.
    if (!playing) {
      dispatch({ type: 'PLAY' })
    }
  }

  // Shared by disableGatedRecording below, handleStop, and the spacebar
  // shortcut's own pause handling further down -- all three would
  // otherwise silently abandon whatever's been captured since the last \
  // lock-in the moment they fire. Per direct feedback: "if the user stops
  // or presses the dot or presses space and it's been recording and hasn't
  // been committed, a tiny popup should ask if they want to commit the
  // most recent loop... i just forget to press the \ key" -- easy to
  // forget, and losing a take silently is much worse than one extra
  // confirm click. Plain window.confirm, matching this app's own existing
  // convention for exactly this kind of lightweight yes/no gate (see
  // ProjectMenu's handleNew). A no-op while recording isn't even enabled.
  async function confirmLockInIfRecording(): Promise<void> {
    if (!state.gatedRecordingEnabled) return
    if (window.confirm('Lock in the most recent recording pass first?')) {
      await lockInGatedRecording()
    }
  }

  async function disableGatedRecording(): Promise<void> {
    await confirmLockInIfRecording()
    await window.rifffApi.engineSetGatedRecordingEnabled(false, 0, 0)
    dispatch({ type: 'SET_GATED_RECORDING_ENABLED', enabled: false })
    dispatch({ type: 'SET_GATED_RECORDING_CHANNEL', channelId: null })
  }

  // The transport Stop button's own handler (TransportBar's onStop prop) --
  // routes through confirmLockInIfRecording first, unlike a bare
  // dispatch({type:'STOP'}) would. See confirmLockInIfRecording's own doc
  // comment.
  async function handleStop(): Promise<void> {
    await confirmLockInIfRecording()
    stopActivePreview()
    dispatch({ type: 'STOP' })
  }

  async function lockInGatedRecording(): Promise<void> {
    const result = await window.rifffApi.engineCaptureGatedTake()
    if (result.committed && result.path) {
      // loopBars is what makes this take tile/loop like any other imported
      // rifff instead of playing once -- see importRecordedTake's own doc
      // comment. Falls back to the take's own captured length via
      // loopRegion if it's somehow gone by the time this resolves (region
      // cleared mid-flight) -- shouldn't happen in practice since gated
      // recording can't even be enabled without one.
      const loopBars = state.loopRegion
        ? state.loopRegion.endBar - state.loopRegion.startBar
        : undefined
      const rifff = await window.rifffApi.importRecordedTake(result.path, state.bpm, loopBars)
      if (rifff) {
        dispatch({ type: 'ADD_TO_SHELF', rifff })
        // Lands on the channel pinned by enableGatedRecording (or the
        // previous lock-in's own rotation below) -- NOT wherever
        // channelOrder happens to find "a" recording channel. Each
        // gated-recording take is now a permanent loop clip (per direct
        // feedback -- "because the rec clips are now loops, they should
        // behave as other imported rifffs"), so repeated \ presses build up
        // a stack of takes across their own channels rather than silently
        // deleting the previous one to make room (an earlier version did
        // that). Falls back to minting one on the spot in the unexpected
        // case this is somehow null (gated recording can't normally be
        // enabled without enableGatedRecording having already set it).
        const targetChannelId = state.gatedRecordingChannelId ?? crypto.randomUUID()
        if (!state.gatedRecordingChannelId) {
          dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: targetChannelId })
        }
        // Same round-trip latency compensation as the manual recording
        // flow -- see ChannelRow.tsx's own handleToggleArm for the
        // identical calculation and reasoning.
        const compensatedStartBar = Math.max(
          0,
          (state.loopRegion?.startBar ?? 0) - (result.latencyCompensationBars ?? 0)
        )
        dispatch({
          type: 'MOVE_TO_CHANNEL',
          groupId: rifff.groupId,
          startBar: compensatedStartBar,
          channelId: targetChannelId
        })
        // Rotates the pin to a BRAND NEW empty channel for whatever the
        // NEXT lock-in (or the live overlay, meanwhile) should target --
        // the channel just used above now has a take on it, so it's no
        // longer a valid destination.
        const nextChannelId = crypto.randomUUID()
        dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: nextChannelId })
        dispatch({ type: 'SET_GATED_RECORDING_CHANNEL', channelId: nextChannelId })
      }
    } else if (result.error) {
      window.alert(`Couldn't lock in recording: ${result.error}`)
    }
  }
```

- [ ] **Step 2: Create the hook file with this code moved in, unchanged**

Create `src/renderer/src/state/useGatedRecordingControls.ts`:

```typescript
import { useAppState, useDispatch, usePlaying } from './StoreContext'
import { stopActivePreview } from '../audio/previewLoop'

/** Endlesss-style gated ("always listening") recording controls -- see
 * GatedLoopRecorder's own doc comment (native-engine) for the capture
 * design, and docs/superpowers/specs/2026-08-06-rifff-recording-design.md
 * for why this lives in its own hook rather than as App.tsx-local
 * closures (the previous shape): RifffBlockRow.tsx/SketchStrip.tsx need
 * the SAME confirm-before-losing-a-take logic App.tsx already built for
 * the transport Stop button / rec dot / spacebar, and threading a
 * callback prop for that through ChannelRow.tsx (which has nothing to do
 * with gated recording) would be worse than just sharing the hook -- every
 * caller already has access to the same underlying StoreContext, so
 * multiple independent useGatedRecordingControls() calls across different
 * components stay in sync for free. */
export function useGatedRecordingControls(): {
  enableGatedRecording: () => Promise<void>
  disableGatedRecording: () => Promise<void>
  lockInGatedRecording: () => Promise<void>
  confirmLockInIfRecording: () => Promise<void>
  handleStop: () => Promise<void>
} {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()

  // Three separate actions (below), not one toggle-everything function:
  // enable (off -> on, \ key or clicking the rec dot while off), lock in
  // (\ key while on -- commits the current pass WITHOUT turning recording
  // mode off, so repeated \ presses grab successive takes across multiple
  // loop passes), and disable (clicking the rec dot while on -- stops
  // listening WITHOUT committing whatever's currently captured, a plain
  // cancel/abort). Splitting these out (rather than \-while-on also
  // auto-disabling, an earlier design) was a direct response to real
  // feedback: users need an explicit way to stop without losing the
  // ability to grab multiple takes via \ alone.
  async function enableGatedRecording(): Promise<void> {
    const region = state.loopRegion
    const loopBars = region ? region.endBar - region.startBar : 0
    if (!region || loopBars <= 0 || loopBars > 16) {
      window.alert('select a loop region of 16 bars or less first (drag on the ruler)')
      return
    }
    const result = await window.rifffApi.engineSetGatedRecordingEnabled(
      true,
      region.startBar,
      region.endBar
    )
    if (!result.success) {
      if (result.error) window.alert(`Couldn't enable recording mode: ${result.error}`)
      return
    }
    dispatch({ type: 'SET_GATED_RECORDING_ENABLED', enabled: true })
    // Pins down exactly which recording channel the NEXT lock-in will land
    // on -- reuses an existing EMPTY recording channel if one's sitting
    // around (e.g. the always-present invariant channel from the mount
    // effect above), otherwise mints a fresh one. This is also what
    // ChannelRow.tsx's live waveform overlay binds to (see
    // gatedRecordingChannelId's own doc comment on AppState) -- pinning it
    // HERE, once, rather than re-deriving "the" recording channel by
    // searching channelOrder each render, is what keeps the overlay and the
    // actual lock-in destination from ever disagreeing.
    //
    // Skipped entirely when a rifff is already targeted (double-click path,
    // see targetRifffForRecording below) -- gatedRecordingChannelId stays
    // null in that case, matching the mutual-exclusivity contract with
    // gatedRecordingTargetGroupId.
    if (!state.gatedRecordingTargetGroupId) {
      const placedChannelIds = new Set(Object.values(state.channelOf))
      const emptyRecordingChannelId = state.channelOrder.find(
        (id) => state.recordingChannelIds[id] && !placedChannelIds.has(id)
      )
      const targetChannelId = emptyRecordingChannelId ?? crypto.randomUUID()
      if (!emptyRecordingChannelId) {
        dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: targetChannelId })
      }
      dispatch({ type: 'SET_GATED_RECORDING_CHANNEL', channelId: targetChannelId })
    }
    // Starts playback automatically if it isn't already running -- gated
    // recording only ever captures anything while the transport is
    // actually moving, so without this, arming it and not separately
    // remembering to hit play produced a real reported bug ("didn't seem
    // to record anything"). Deliberately does NOT jump to region.startBar
    // anymore (an earlier version did) -- per direct feedback ("it should
    // just go with the spot you press it at"), enabling recording
    // shouldn't yank the playhead anywhere. Play (or keep playing) from
    // wherever pos already is; Transport.cpp's own renderLoopAware now
    // handles "hasn't reached the loop region yet" by playing straight
    // through unwrapped until it arrives there naturally, then looping.
    if (!playing) {
      dispatch({ type: 'PLAY' })
    }
  }

  // Shared by disableGatedRecording below, handleStop, the spacebar
  // shortcut's own pause handling (App.tsx), and targetRifffForRecording
  // below -- all would otherwise silently abandon whatever's been captured
  // since the last \ lock-in the moment they fire. Per direct feedback:
  // "if the user stops or presses the dot or presses space and it's been
  // recording and hasn't been committed, a tiny popup should ask if they
  // want to commit the most recent loop... i just forget to press the \
  // key" -- easy to forget, and losing a take silently is much worse than
  // one extra confirm click. Plain window.confirm, matching this app's own
  // existing convention for exactly this kind of lightweight yes/no gate
  // (see ProjectMenu's handleNew). A no-op while recording isn't even
  // enabled.
  async function confirmLockInIfRecording(): Promise<void> {
    if (!state.gatedRecordingEnabled) return
    if (window.confirm('Lock in the most recent recording pass first?')) {
      await lockInGatedRecording()
    }
  }

  async function disableGatedRecording(): Promise<void> {
    await confirmLockInIfRecording()
    await window.rifffApi.engineSetGatedRecordingEnabled(false, 0, 0)
    dispatch({ type: 'SET_GATED_RECORDING_ENABLED', enabled: false })
    dispatch({ type: 'SET_GATED_RECORDING_CHANNEL', channelId: null })
    dispatch({ type: 'SET_GATED_RECORDING_TARGET', groupId: null })
  }

  // The transport Stop button's own handler (TransportBar's onStop prop) --
  // routes through confirmLockInIfRecording first, unlike a bare
  // dispatch({type:'STOP'}) would. See confirmLockInIfRecording's own doc
  // comment.
  async function handleStop(): Promise<void> {
    await confirmLockInIfRecording()
    stopActivePreview()
    dispatch({ type: 'STOP' })
    dispatch({ type: 'SET_GATED_RECORDING_TARGET', groupId: null })
  }

  async function lockInGatedRecording(): Promise<void> {
    const result = await window.rifffApi.engineCaptureGatedTake()
    if (result.committed && result.path) {
      // loopBars is what makes this take tile/loop like any other imported
      // rifff instead of playing once -- see importRecordedTake's own doc
      // comment. Falls back to the take's own captured length via
      // loopRegion if it's somehow gone by the time this resolves (region
      // cleared mid-flight) -- shouldn't happen in practice since gated
      // recording can't even be enabled without one.
      const loopBars = state.loopRegion
        ? state.loopRegion.endBar - state.loopRegion.startBar
        : undefined

      // Targeted-rifff path (double-click a rifff, see
      // targetRifffForRecording) -- build a STEM and attach it to the
      // target rifff, rather than a whole new rifff on a channel. Stays
      // pinned after committing (unlike the channel path's own rotation
      // below) so repeated \ presses keep adding MORE stems to the same
      // rifff -- see the design doc's own "Accumulation" section.
      if (state.gatedRecordingTargetGroupId) {
        const targetRifff = state.rifffs[state.gatedRecordingTargetGroupId]
        if (targetRifff && loopBars !== undefined) {
          const stem = await window.rifffApi.importRecordedStem(
            result.path,
            targetRifff.bpm,
            loopBars,
            targetRifff.stems.map((s) => s.slot)
          )
          if (stem) {
            dispatch({
              type: 'ADD_STEM_TO_RIFFF',
              groupId: state.gatedRecordingTargetGroupId,
              stem
            })
          }
        }
        return
      }

      const rifff = await window.rifffApi.importRecordedTake(result.path, state.bpm, loopBars)
      if (rifff) {
        dispatch({ type: 'ADD_TO_SHELF', rifff })
        // Lands on the channel pinned by enableGatedRecording (or the
        // previous lock-in's own rotation below) -- NOT wherever
        // channelOrder happens to find "a" recording channel. Each
        // gated-recording take is now a permanent loop clip (per direct
        // feedback -- "because the rec clips are now loops, they should
        // behave as other imported rifffs"), so repeated \ presses build up
        // a stack of takes across their own channels rather than silently
        // deleting the previous one to make room (an earlier version did
        // that). Falls back to minting one on the spot in the unexpected
        // case this is somehow null (gated recording can't normally be
        // enabled without enableGatedRecording having already set it).
        const targetChannelId = state.gatedRecordingChannelId ?? crypto.randomUUID()
        if (!state.gatedRecordingChannelId) {
          dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: targetChannelId })
        }
        // Same round-trip latency compensation as the manual recording
        // flow -- see ChannelRow.tsx's own handleToggleArm for the
        // identical calculation and reasoning.
        const compensatedStartBar = Math.max(
          0,
          (state.loopRegion?.startBar ?? 0) - (result.latencyCompensationBars ?? 0)
        )
        dispatch({
          type: 'MOVE_TO_CHANNEL',
          groupId: rifff.groupId,
          startBar: compensatedStartBar,
          channelId: targetChannelId
        })
        // Rotates the pin to a BRAND NEW empty channel for whatever the
        // NEXT lock-in (or the live overlay, meanwhile) should target --
        // the channel just used above now has a take on it, so it's no
        // longer a valid destination.
        const nextChannelId = crypto.randomUUID()
        dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: nextChannelId })
        dispatch({ type: 'SET_GATED_RECORDING_CHANNEL', channelId: nextChannelId })
      }
    } else if (result.error) {
      window.alert(`Couldn't lock in recording: ${result.error}`)
    }
  }

  return {
    enableGatedRecording,
    disableGatedRecording,
    lockInGatedRecording,
    confirmLockInIfRecording,
    handleStop
  }
}
```

(Note: this step already includes Task 8's extensions — the `gatedRecordingTargetGroupId` check
in `enableGatedRecording`, the target-branch in `lockInGatedRecording`, and the
`SET_GATED_RECORDING_TARGET: null` clears in `disableGatedRecording`/`handleStop` — writing them
in the same pass avoids a throwaway intermediate commit that's immediately superseded. Task 8
below adds `targetRifffForRecording` itself and the tests for all of this.)

- [ ] **Step 3: Remove the moved block from `App.tsx`, replace with a hook call**

In `src/renderer/src/App.tsx`, delete the entire block shown in Step 1 above, and replace it
with:

```typescript
  const {
    enableGatedRecording,
    disableGatedRecording,
    lockInGatedRecording,
    confirmLockInIfRecording,
    handleStop
  } = useGatedRecordingControls()
```

Place this where the deleted block used to start (right after the Cmd+0 zoom-reset `useEffect`,
before the `\` key `useEffect` that calls `lockInGatedRecording`/`enableGatedRecording`).

- [ ] **Step 4: Import the hook**

In `src/renderer/src/App.tsx`, find:

```typescript
import { warmStemCaches } from './audio/warmStemCaches'
import { stopActivePreview } from './audio/previewLoop'
import { markManualSeek } from './state/manualSeek'
```

Replace with:

```typescript
import { warmStemCaches } from './audio/warmStemCaches'
import { stopActivePreview } from './audio/previewLoop'
import { markManualSeek } from './state/manualSeek'
import { useGatedRecordingControls } from './state/useGatedRecordingControls'
```

- [ ] **Step 5: Check for now-unused imports in `App.tsx`**

`stopActivePreview` is still used elsewhere in `App.tsx` (the Play/Stop button area and the
background-click handler) — confirm with:

```bash
grep -n "stopActivePreview" src/renderer/src/App.tsx
```

Expected: at least one more call site besides the deleted block (if `stopActivePreview` is now
completely unused in `App.tsx`, remove its import — but it should still be used, since
`App.tsx`'s own JSX has other preview-stopping call sites unrelated to this feature).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. This confirms every call site of `enableGatedRecording`,
`disableGatedRecording`, `lockInGatedRecording`, `confirmLockInIfRecording`, `handleStop` inside
`App.tsx` (the `\` key handler, the spacebar handler, `<TransportBar>`'s props) still resolves
correctly against the destructured hook return values.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: no errors (may show formatting warnings — if so, run `npx eslint --fix
src/renderer/src/App.tsx src/renderer/src/state/useGatedRecordingControls.ts` and re-run lint).

- [ ] **Step 8: Run the full JS test suite**

Run: `npm test`
Expected: all existing tests still pass (this task is a pure relocation plus the two small
additive changes noted in Step 2 — `gatedRecordingTargetGroupId` doesn't exist as a live pin
anywhere yet, since nothing sets it besides Task 1's own reducer tests, so
`enableGatedRecording`'s new `if (!state.gatedRecordingTargetGroupId)` check is always true in
every existing test/usage today, preserving old behavior exactly).

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/state/useGatedRecordingControls.ts
git commit -m "Move gated-recording controls into useGatedRecordingControls hook, extend for stem-attach"
```

---

### Task 8: `targetRifffForRecording` + tests

**Files:**
- Modify: `src/renderer/src/state/useGatedRecordingControls.ts`

- [ ] **Step 1: Add `targetRifffForRecording` to the hook**

In `src/renderer/src/state/useGatedRecordingControls.ts`, add `LoopRegion` to the type import
at the top:

```typescript
import { useAppState, useDispatch, usePlaying } from './StoreContext'
import { stopActivePreview } from '../audio/previewLoop'
import type { LoopRegion } from './store'
```

Add `targetRifffForRecording` to the returned object type and its implementation, right after
`lockInGatedRecording`'s closing brace and before the `return { ... }` statement:

```typescript
  // Called by RifffBlockRow.tsx/SketchStrip.tsx's own onDoubleClick --
  // pins groupId as the gated-recording target and sets the loop region to
  // match it (region is the caller's own current-geometry-derived span,
  // same "reflects however the clip is ACTUALLY sized right now" data
  // both components already compute for their existing double-click
  // behavior). If recording is currently enabled (either the channel path
  // or a previous rifff target), confirms before abandoning whatever's
  // in-progress, then turns recording OFF -- re-targeting mid-session
  // requires an explicit \ press to resume onto the new target, same
  // two-step "set the region/target, then press \ to actually start
  // capturing" flow a fresh double-click already has. This sidesteps
  // having to splice a live loop-region change into an already-running
  // native capture.
  async function targetRifffForRecording(groupId: string, region: LoopRegion): Promise<void> {
    if (!region) return
    if (state.gatedRecordingEnabled) {
      await confirmLockInIfRecording()
      await window.rifffApi.engineSetGatedRecordingEnabled(false, 0, 0)
      dispatch({ type: 'SET_GATED_RECORDING_ENABLED', enabled: false })
    }
    dispatch({ type: 'SET_LOOP_REGION', region })
    dispatch({ type: 'SET_GATED_RECORDING_CHANNEL', channelId: null })
    dispatch({ type: 'SET_GATED_RECORDING_TARGET', groupId })
  }
```

Update the return type and statement:

```typescript
export function useGatedRecordingControls(): {
  enableGatedRecording: () => Promise<void>
  disableGatedRecording: () => Promise<void>
  lockInGatedRecording: () => Promise<void>
  confirmLockInIfRecording: () => Promise<void>
  handleStop: () => Promise<void>
  targetRifffForRecording: (groupId: string, region: LoopRegion) => Promise<void>
} {
```

```typescript
  return {
    enableGatedRecording,
    disableGatedRecording,
    lockInGatedRecording,
    confirmLockInIfRecording,
    handleStop,
    targetRifffForRecording
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/state/useGatedRecordingControls.ts
git commit -m "Add targetRifffForRecording to useGatedRecordingControls"
```

---

### Task 9: `RifffBlockRow.tsx` — double-click targets recording, purple pulsing dot

**Files:**
- Modify: `src/renderer/src/components/RifffBlockRow.tsx`

- [ ] **Step 1: Update imports**

In `src/renderer/src/components/RifffBlockRow.tsx`, find:

```typescript
import { useAppSelector, useDispatch, useZoom } from '../state/StoreContext'
import type { Rifff } from '@shared/types'
import { stemColorVar } from '../theme/typeColor'
import { StemWaveformRow } from './StemWaveformRow'
import { CollapsedRifffRow } from './CollapsedRifffRow'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'
import { clipGeometryFromFields } from '../state/selectors'
import { SNAP_DIVS } from '../state/store'
import { ROW_HEIGHT } from './StemWaveformRow'
import { suppressNextSyntheticClick } from './dragUtils'
```

Replace with:

```typescript
import { useAppSelector, useDispatch, usePlaying, useZoom } from '../state/StoreContext'
import type { Rifff } from '@shared/types'
import { stemColorVar } from '../theme/typeColor'
import { StemWaveformRow } from './StemWaveformRow'
import { CollapsedRifffRow } from './CollapsedRifffRow'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'
import { clipGeometryFromFields } from '../state/selectors'
import { SNAP_DIVS } from '../state/store'
import { ROW_HEIGHT } from './StemWaveformRow'
import { suppressNextSyntheticClick } from './dragUtils'
import { useGatedRecordingControls } from '../state/useGatedRecordingControls'
```

- [ ] **Step 2: Read the target state and hook the new selector**

Find:

```typescript
  const rifff = useAppSelector((s) => s.rifffs[groupId])
  const selected = useAppSelector((s) => s.sel === groupId)
```

Replace with:

```typescript
  const rifff = useAppSelector((s) => s.rifffs[groupId])
  const selected = useAppSelector((s) => s.sel === groupId)
  const isGatedRecordingTarget = useAppSelector((s) => s.gatedRecordingTargetGroupId === groupId)
  const playing = usePlaying()
  const { targetRifffForRecording } = useGatedRecordingControls()
```

- [ ] **Step 3: Replace the `onDoubleClick` handler's dispatch with a call to
      `targetRifffForRecording`**

Find:

```typescript
        onDoubleClick={(e) => {
          // Sets the project's loop region to exactly this clip's CURRENT
          // rendered span -- derived straight from geo's own leftPx/widthPx
          // (converted back to bars via ppb) rather than rifff.startBar/
          // barLength directly, so it reflects however the clip is
          // ACTUALLY sized right now: a playedBars resize, a left-crop
          // trim, stretch on/off -- all already baked into geo by
          // clipGeometryFromFields above. An earlier version used
          // rifff.barLength (the clip's intrinsic one-pass length,
          // ignoring all of that), which per direct feedback was wrong --
          // "it should set it to whatever the length it is currently, not
          // the original." Mirrors Ruler.tsx's own
          // double-click-to-CLEAR-loop-region convention (same gesture,
          // opposite direction depending on where you double-click). The
          // two onClick firings each half of this double-click also
          // triggers (SELECT + TOGGLE_EXPAND, twice) are harmless — they
          // cancel out, leaving expand state unchanged and this clip
          // selected, same as a single click would.
          e.stopPropagation()
          const startBar = geo.leftPx / ppb
          const lengthBars = geo.widthPx / ppb
          dispatch({ type: 'SET_LOOP_REGION', region: { startBar, endBar: startBar + lengthBars } })
        }}
```

Replace with:

```typescript
        onDoubleClick={(e) => {
          // Targets THIS rifff for gated recording -- sets the project's
          // loop region to exactly this clip's CURRENT rendered span
          // (derived straight from geo's own leftPx/widthPx, converted
          // back to bars via ppb, so it reflects however the clip is
          // ACTUALLY sized right now: a playedBars resize, a left-crop
          // trim, stretch on/off -- all already baked into geo by
          // clipGeometryFromFields above) AND pins this rifff as where the
          // NEXT locked-in take attaches as a new stem -- see
          // useGatedRecordingControls' targetRifffForRecording and
          // docs/superpowers/specs/2026-08-06-rifff-recording-design.md.
          // Mirrors Ruler.tsx's own double-click-to-CLEAR-loop-region
          // convention (same gesture, opposite direction depending on
          // where you double-click). The two onClick firings each half of
          // this double-click also triggers (SELECT + TOGGLE_EXPAND,
          // twice) are harmless — they cancel out, leaving expand state
          // unchanged and this clip selected, same as a single click
          // would.
          e.stopPropagation()
          const startBar = geo.leftPx / ppb
          const lengthBars = geo.widthPx / ppb
          void targetRifffForRecording(groupId, { startBar, endBar: startBar + lengthBars })
        }}
```

- [ ] **Step 4: Update the `title` tooltip**

Find:

```typescript
        title={
          (expanded ? 'click to collapse' : 'click to expand') +
          ' · ctrl+right-click to solo · double-click to loop this clip'
        }
```

Replace with:

```typescript
        title={
          (expanded ? 'click to collapse' : 'click to expand') +
          ' · ctrl+right-click to solo · double-click to target this rifff for recording'
        }
```

- [ ] **Step 5: Add the purple pulsing dot indicator**

Find:

```typescript
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {rifff.name}
        </span>
      </div>
```

Replace with:

```typescript
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {rifff.name}
        </span>
        {isGatedRecordingTarget && (
          // Same purple (--ra-recording-live) pulsing dot as TransportBar's
          // own rec indicator and Ruler's loop bracket -- reused rather
          // than reinvented, right down to the keyframe name. Pulses only
          // while actually playing (matching those two), since "actively
          // listening" is only true while the transport is moving through
          // the loop region.
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0 }}>
            <circle
              cx="5"
              cy="5"
              r="5"
              fill="var(--ra-recording-live)"
              style={playing ? { animation: 'ra-rec-pulse 1.4s ease-in-out infinite' } : undefined}
            />
            <style>{`
              @keyframes ra-rec-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.25; }
              }
            `}</style>
          </svg>
        )}
      </div>
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/RifffBlockRow.tsx
git commit -m "RifffBlockRow: double-click targets rifff for recording, purple pulse indicator"
```

---

### Task 10: `SketchStrip.tsx` — new double-click handler, purple pulsing dot

**Files:**
- Modify: `src/renderer/src/components/SketchStrip.tsx`

- [ ] **Step 1: Update imports**

Find:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppState, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { placedRifffsInOrder, pasteRifffAction } from '../state/selectors'
import { PolarGlyph } from './PolarGlyph'
import { stemColorVar } from '../theme/typeColor'
import { startPointerDrag, suppressNextSyntheticClick } from './dragUtils'
import { markManualSeek } from '../state/manualSeek'
import type { Rifff } from '@shared/types'
```

Replace with:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppState, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { placedRifffsInOrder, pasteRifffAction } from '../state/selectors'
import { PolarGlyph } from './PolarGlyph'
import { stemColorVar } from '../theme/typeColor'
import { startPointerDrag, suppressNextSyntheticClick } from './dragUtils'
import { markManualSeek } from '../state/manualSeek'
import { useGatedRecordingControls } from '../state/useGatedRecordingControls'
import type { Rifff } from '@shared/types'
```

- [ ] **Step 2: Grab the hook inside the component**

Find:

```typescript
export function SketchStrip(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const pos = usePos()
```

Replace with:

```typescript
export function SketchStrip(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const pos = usePos()
  const { targetRifffForRecording } = useGatedRecordingControls()
```

- [ ] **Step 3: Add a double-click handler function**

Add this new function right after `handleTileClick` (before `handleScrubDotMouseDown`):

```typescript
  // Targets this tile's rifff for gated recording -- new in this
  // component (no double-click handling existed here before). Sets the
  // loop region to exactly this tile's own CURRENT played span
  // (effectiveBars -- the same value already used for tile layout/glyph
  // sizing, so it reflects a right-click-drag length adjustment just like
  // RifffBlockRow.tsx's own double-click reflects a playedBars resize)
  // and pins the rifff as where the next locked-in take attaches as a new
  // stem -- see useGatedRecordingControls' targetRifffForRecording and
  // docs/superpowers/specs/2026-08-06-rifff-recording-design.md.
  function handleTileDoubleClick(e: React.MouseEvent, rifff: Rifff): void {
    e.stopPropagation()
    const startBar = rifff.startBar ?? 0
    const lengthBars = effectiveBars(rifff)
    void targetRifffForRecording(rifff.groupId, { startBar, endBar: startBar + lengthBars })
  }
```

- [ ] **Step 4: Wire the handler onto the tile, and add the purple pulsing dot**

Find:

```typescript
        return (
          <div
            key={rifff.groupId}
            draggable
            onDragStart={(e) => {
              suppressNextSyntheticClick()
              e.dataTransfer.setData('text/rifff-group-id', rifff.groupId)
            }}
            onClick={(e) => handleTileClick(e, rifff)}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={(e) => handleBarsMouseDown(e, rifff)}
            title={`${rifff.name} — shift/cmd-click to multi-select · right-click and drag to adjust length · ctrl+right-click to solo`}
```

Replace with:

```typescript
        const isGatedRecordingTarget = state.gatedRecordingTargetGroupId === rifff.groupId

        return (
          <div
            key={rifff.groupId}
            draggable
            onDragStart={(e) => {
              suppressNextSyntheticClick()
              e.dataTransfer.setData('text/rifff-group-id', rifff.groupId)
            }}
            onClick={(e) => handleTileClick(e, rifff)}
            onDoubleClick={(e) => handleTileDoubleClick(e, rifff)}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={(e) => handleBarsMouseDown(e, rifff)}
            title={`${rifff.name} — shift/cmd-click to multi-select · right-click and drag to adjust length · ctrl+right-click to solo · double-click to target for recording`}
```

Then find the closing of the tile's `<div>` (right before the tile-mapping function's own
closing `)`):

```typescript
              </svg>
            )}
          </div>
        )
      })}
```

Replace with:

```typescript
              </svg>
            )}
            {isGatedRecordingTarget && (
              // Same purple (--ra-recording-live) pulsing dot as
              // TransportBar's own rec indicator, Ruler's loop bracket, and
              // RifffBlockRow's own equivalent -- reused, right down to the
              // keyframe name. Corner-positioned so it doesn't collide with
              // the centered bar-count label or the orbiting scrub dot.
              // Pulses only while actually playing, matching those.
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                style={{ position: 'absolute', top: 2, right: 2, pointerEvents: 'none' }}
              >
                <circle
                  cx="5"
                  cy="5"
                  r="5"
                  fill="var(--ra-recording-live)"
                  style={
                    playing ? { animation: 'ra-rec-pulse 1.4s ease-in-out infinite' } : undefined
                  }
                />
                <style>{`
                  @keyframes ra-rec-pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.25; }
                  }
                `}</style>
              </svg>
            )}
          </div>
        )
      })}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/SketchStrip.tsx
git commit -m "SketchStrip: new double-click targets rifff for recording, purple pulse indicator"
```

---

### Task 11: Full verification + manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all pass, count higher than the pre-feature baseline (712 tests as of this plan's
own writing — expect roughly +20 from this plan's own new tests across store/history/
serialize/importOneShot).

- [ ] **Step 4: Confirm no native-engine changes were needed**

Run: `git status native-engine/`
Expected: clean (no changes) — this feature is entirely renderer/main-process, per the design
doc's own "What does NOT change" section.

- [ ] **Step 5: Manual walkthrough (this codebase's own convention for React component
      behavior — CLAUDE.md's "Testing conventions": no GUI test tooling, verify by hand)**

Note explicitly to whoever runs this: **no native-engine changes this plan, so no rebuild/
relaunch is required — a normal `npm run dev` reload is enough.**

Walk through, in a real running app:
1. In normal mode: double-click a placed rifff's clip. Confirm the loop region updates on the
   Ruler to match the clip's own current span, and a purple dot appears on the clip's name bar
   (pulsing once you hit play).
2. Press `\` to enable recording, play/sing/make noise through the loop, press `\` again to
   lock in. Confirm a NEW STEM appears on that same rifff (not a new standalone clip/channel),
   plays in sync with the rifff's other stems, and the rifff's own visual span updates if the
   new stem's barLength extended it.
3. Press `\` again for a second take onto the SAME rifff — confirm it adds ANOTHER stem
   (doesn't replace the first).
4. Switch to sketch mode. Double-click a tile — confirm the same purple dot appears on the tile
   (corner-positioned), and repeat steps 2–3 there.
5. While recording is enabled and targeting one rifff, double-click a DIFFERENT rifff/tile —
   confirm the "Lock in the most recent recording pass first?" prompt fires, and either choice
   correctly re-targets afterward (recording is off; press `\` again to resume onto the new
   target).
6. Place two rifffs with different `bpm` values (or manually adjust the project's `state.bpm`
   after placing one), target the one whose `bpm` differs from the live project tempo, record a
   take, and listen — confirm the new stem plays back at the correct pitch/speed (not
   stretched a second time).
7. Confirm the pre-existing manual-Ruler-drag flow (drag on the Ruler in normal mode, `\` to
   enable) still produces a standalone new rifff on a fresh channel, unchanged from before this
   plan.

- [ ] **Step 6: Final commit (only if the walkthrough surfaced fixes)**

If Step 5 found nothing to fix, this plan is complete — no further commit needed. If it did,
fix, re-verify (Steps 1–3), and commit the fix with a message describing what the manual
walkthrough caught.

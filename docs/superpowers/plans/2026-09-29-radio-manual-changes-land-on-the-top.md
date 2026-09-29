# Radio: manual changes land on the loop top — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While radio runs, every manual way of bringing in a stem waits for the next loop top and lands with a transition, together with radio's own change, in one staged swap.

**Architecture:**
- **Pure rules.** Transition assignment and merging radio's held change with the manual queue live in a new pure module, `src/shared/radioManualChanges.ts`, written test-first.
- **Panel side.** Radio's single-row staged swap (`RadioStageRequest`) is generalised to many rows. This is first done as a behaviour-preserving refactor.
- **Manual queue.** A queue is added beside radio's held change. Finally, each manual action routes into the queue when radio is on.
- **Engine.** Nothing changes there. It already swaps whole projects.

**Tech Stack:** TypeScript, React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-radio-manual-changes-land-on-the-top-design.md`

---

## Ground rules

- **Read first:**
  - `CLAUDE.md`
  - §2 of `docs/superpowers/HANDOFF-2026-09-29.md`, "What the whole day was about". The staged-swap reasoning there is load-bearing.
  - The long comments in `DiscoverPanel.tsx` above `radioStageRef`, `stepRadioStage` and the wrap-landing branch. They explain why each ordering exists, and several past bugs came from breaking one.
- **Staging:** stage explicit paths only, never `git add -A`.
- **Line numbers:** `DiscoverPanel.tsx` is about 7,500 lines, and line numbers drift. Anchor on quoted code and use grep.
- **After every task:**
  - `npm run typecheck`, `npx vitest run` and eslint on the changed files must all be clean.
  - Known flakes, which pass alone: `pluginScan.test.ts > … a real installed VST3`, `playbackEngineLifecycle.test.ts`, `stemAutoClassify.test.ts`.
- **Radio off must stay byte-identical in behaviour.** Every new branch is gated on `radioOnRef.current`.
- **The temporary instrumentation stays.** That is the `radioTrace*` calls, `[radio-stage]` and `[radio-gate]`. Keep calling it where the old code did, so Elling's next log still reads.
- **No agent can hear or see the app.** Never claim a UI or audio behaviour was verified.

## File map

| file | change |
|---|---|
| `src/shared/radioManualChanges.ts` | **create**: `drawManualTransitions`, `mergeStageChanges` (Task 1) |
| `src/shared/radioManualChanges.test.ts` | **create** (Task 1) |
| `src/renderer/src/components/DiscoverPanel.tsx` | many-row stage (Task 2); manual queue (Task 3); routing (Task 4) |

---

### Task 1: The pure rules

**Files:**
- Create: `src/shared/radioManualChanges.ts`
- Test: `src/shared/radioManualChanges.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/radioManualChanges.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { drawManualTransitions, mergeStageChanges } from './radioManualChanges'
import type { RadioTransitionKind } from './radioTransition'

/** A pick that returns the given kind for every row. */
const always =
  (kind: RadioTransitionKind) =>
  (): RadioTransitionKind =>
    kind

describe('drawManualTransitions', () => {
  const rows = [
    { slotId: 'a', kinds: ['drums' as const] },
    { slotId: 'b', kinds: ['bass' as const] }
  ]

  it('gives every row an arrival gesture when that is what is drawn', () => {
    const out = drawManualTransitions(rows, {
      pick: always('bloom'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8
    })
    expect(out.get('a')).toEqual({ kind: 'bloom', beats: 4 })
    expect(out.get('b')).toEqual({ kind: 'bloom', beats: 4 })
  })

  it('allows at most one leading gesture, and cuts the rest', () => {
    const out = drawManualTransitions(rows, {
      pick: always('riser'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8
    })
    expect(out.get('a')).toEqual({ kind: 'riser', beats: 8 })
    expect(out.get('b')).toEqual({ kind: 'cut', beats: 4 })
  })

  it('draws no leading gesture when one is already armed this lap', () => {
    const out = drawManualTransitions(rows, {
      pick: always('hole'),
      dropOutBeats: () => 2,
      leadingArmed: true,
      barsToWrap: 8
    })
    expect(out.get('a')?.kind).toBe('cut')
    expect(out.get('b')?.kind).toBe('cut')
  })

  it('draws no leading gesture when there is not room for it before the wrap', () => {
    // A riser is 8 beats = 2 bars; a hole of 4 beats = 1 bar.
    const riser = drawManualTransitions([rows[0]], {
      pick: always('riser'),
      dropOutBeats: () => 4,
      leadingArmed: false,
      barsToWrap: 1.5
    })
    expect(riser.get('a')?.kind).toBe('cut')
    const hole = drawManualTransitions([rows[0]], {
      pick: always('hole'),
      dropOutBeats: () => 4,
      leadingArmed: false,
      barsToWrap: 1.5
    })
    expect(hole.get('a')).toEqual({ kind: 'hole', beats: 4 })
  })

  it('uses the drop-out beats for a hole', () => {
    const out = drawManualTransitions([rows[0]], {
      pick: always('hole'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8
    })
    expect(out.get('a')).toEqual({ kind: 'hole', beats: 2 })
  })

  it('passes a cut straight through', () => {
    const out = drawManualTransitions(rows, {
      pick: always('cut'),
      dropOutBeats: () => 2,
      leadingArmed: false,
      barsToWrap: 8
    })
    expect(out.get('a')).toEqual({ kind: 'cut', beats: 4 })
  })
})

describe('mergeStageChanges', () => {
  const led = { slotId: 'a', stem: 'stem-a', arrival: { kind: 'bloom' as const, beats: 4 } }

  it('carries radio’s held change on its own', () => {
    expect(mergeStageChanges(led, new Map())).toEqual({
      changes: [{ slotId: 'a', stem: 'stem-a' }],
      joining: [],
      arrivals: [{ slotId: 'a', kind: 'bloom', beats: 4 }]
    })
  })

  it('carries manual changes alongside, joining rows listed separately', () => {
    const manual = new Map([
      ['b', { stem: 'stem-b', joining: false, arrival: null }],
      ['c', { stem: 'stem-c', joining: true, arrival: { kind: 'filter in' as const, beats: 4 } }]
    ])
    expect(mergeStageChanges(led, manual)).toEqual({
      changes: [
        { slotId: 'a', stem: 'stem-a' },
        { slotId: 'b', stem: 'stem-b' },
        { slotId: 'c', stem: 'stem-c' }
      ],
      joining: ['c'],
      arrivals: [
        { slotId: 'a', kind: 'bloom', beats: 4 },
        { slotId: 'c', kind: 'filter in', beats: 4 }
      ]
    })
  })

  it('lets a manual change on the same row as radio’s win', () => {
    const manual = new Map([['a', { stem: 'mine', joining: false, arrival: null }]])
    expect(mergeStageChanges(led, manual)).toEqual({
      changes: [{ slotId: 'a', stem: 'mine' }],
      joining: [],
      arrivals: []
    })
  })

  it('works with no radio change at all', () => {
    const manual = new Map([['b', { stem: 'stem-b', joining: false, arrival: null }]])
    expect(mergeStageChanges(null, manual).changes).toEqual([{ slotId: 'b', stem: 'stem-b' }])
  })

  it('carries a cut as no arrival', () => {
    const cut = { slotId: 'a', stem: 's', arrival: undefined }
    expect(mergeStageChanges(cut, new Map()).arrivals).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/shared/radioManualChanges.test.ts`
Expected: FAIL. The module does not exist yet.

- [ ] **Step 3: Implement**

Create `src/shared/radioManualChanges.ts`:

```ts
// src/shared/radioManualChanges.ts
//
// While radio runs, a MANUAL change -- a reroll, a nearby-jam pick, an
// added or duplicated row -- waits for the next loop top and lands with a
// transition, together with radio's own change, in one staged swap
// (docs/superpowers/specs/2026-09-29-radio-manual-changes-land-on-the-top-
// design.md). These are the two rules that decide what that swap carries.

import type { DiscoverSlotKind } from './discoverSlotKind'
import { radioGestureLeadsChange, type RadioTransitionKind } from './radioTransition'

export interface ManualArrival {
  kind: RadioTransitionKind
  beats: number
}

/** How long each gesture takes, in beats -- the table radio's own two
 * decision branches already use: a hole is a drop-out of the drawn length,
 * a riser two bars, everything else one bar. */
function beatsFor(kind: RadioTransitionKind, dropOutBeats: () => number): number {
  if (kind === 'hole') return dropOutBeats()
  if (kind === 'riser') return 8
  return 4
}

/** A transition for every row changing at this wrap.
 *
 * Arrival gestures (filter in, bloom, duck) ride their own stem and may
 * land on several rows at once. A LEADING gesture (hole, riser) plays on
 * the outgoing stem over the bars BEFORE the wrap, so at most one can be
 * live in a lap -- radio's own rule -- and only when there is room for it
 * before the wrap. Any leading gesture that cannot be granted becomes a
 * cut, which is what radio's due branch does when a gesture is already
 * armed. */
export function drawManualTransitions(
  rows: readonly { slotId: string; kinds: readonly DiscoverSlotKind[] }[],
  options: {
    pick: (kinds: readonly DiscoverSlotKind[]) => RadioTransitionKind
    dropOutBeats: () => number
    /** A hole, riser or standalone drop-out is already armed this lap. */
    leadingArmed: boolean
    barsToWrap: number
  }
): Map<string, ManualArrival> {
  const out = new Map<string, ManualArrival>()
  let leadingTaken = options.leadingArmed
  for (const row of rows) {
    let kind = options.pick(row.kinds)
    let beats = beatsFor(kind, options.dropOutBeats)
    if (radioGestureLeadsChange(kind)) {
      if (leadingTaken || beats / 4 > options.barsToWrap) {
        kind = 'cut'
        beats = 4
      } else {
        leadingTaken = true
      }
    }
    out.set(row.slotId, { kind, beats })
  }
  return out
}

/** Radio's held change and the manual queue, as one staged swap.
 *
 * A manual change on the row radio was about to turn over wins: the user
 * pointed at that row, radio only drew it. Generic over the stem type so
 * this stays free of the renderer's own stem shape. */
export function mergeStageChanges<S>(
  radioLed: { slotId: string; stem: S; arrival?: ManualArrival } | null,
  manual: ReadonlyMap<string, { stem: S; joining: boolean; arrival: ManualArrival | null }>
): {
  changes: { slotId: string; stem: S }[]
  joining: string[]
  arrivals: ({ slotId: string } & ManualArrival)[]
} {
  const changes: { slotId: string; stem: S }[] = []
  const joining: string[] = []
  const arrivals: ({ slotId: string } & ManualArrival)[] = []
  if (radioLed !== null && !manual.has(radioLed.slotId)) {
    changes.push({ slotId: radioLed.slotId, stem: radioLed.stem })
    if (radioLed.arrival) arrivals.push({ slotId: radioLed.slotId, ...radioLed.arrival })
  }
  for (const [slotId, change] of manual) {
    changes.push({ slotId, stem: change.stem })
    if (change.joining) joining.push(slotId)
    if (change.arrival !== null && change.arrival.kind !== 'cut') {
      arrivals.push({ slotId, ...change.arrival })
    }
  }
  return { changes, joining, arrivals }
}
```

**Leading gestures in `arrivals`:** `mergeStageChanges` passes on whatever arrival the caller gives it. The panel (Task 3) only ever stores ARRIVAL kinds there. A leading gesture is armed live, on the outgoing stem, through `radioGestureRef`, exactly as radio does today, and is never put in a stage.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/shared/radioManualChanges.test.ts`
Expected: PASS. Then run `npx eslint src/shared/radioManualChanges.ts src/shared/radioManualChanges.test.ts` and `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/radioManualChanges.ts src/shared/radioManualChanges.test.ts
git commit -m "the rules for what a many-row radio swap carries, and which gestures it may draw

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The staged swap carries many rows (behaviour-preserving refactor)

**Files:** Modify `src/renderer/src/components/DiscoverPanel.tsx`

The staged swap stops assuming one row. **Radio's behaviour must be identical after this task**: the only caller still passes exactly one change.

- [ ] **Step 1: Generalise the request type**

Replace `interface RadioStageRequest { ... }` (search `interface RadioStageRequest`) with:

```ts
/** One gesture as radioGestureRef holds it. */
interface RadioGesture {
  kind: 'drop-out' | RadioTransitionKind
  slotId: string
  beats: number
  lapsLeft: number
}

interface RadioStageRequest {
  token: number
  /** Every row whose stem changes at this wrap -- radio's own held change
   * and, from Task 3 of the 2026-09-29 manual-changes plan, every manual
   * one. See mergeStageChanges. */
  changes: { slotId: string; stem: ResolvedCandidateStem }[]
  /** Rows not in the live mix yet (added or duplicated while radio ran),
   * joined into the staged member list. */
  joining: string[]
  /** Arrival curves for the project this stage BECOMES -- one per changing
   * row that drew one. Never a leading gesture: that belongs to the lap
   * before the swap and rides the live project (radioGestureRef). */
  gestures: RadioGesture[]
  atBars?: number
  label: string
  atPos: number
  loopBars: number
}
```

If `radioGestureRef`'s `useRef<{...}>` type is written out inline, change it to `useRef<RadioGesture | null>(null)`, and do the same for any other inline copy of that shape you find.

- [ ] **Step 2: `buildAndPushPreview` reads every change**

In `buildAndPushPreview`:

1. **Members.** Replace:
   ```ts
   const stem = stage && stage.slotId === id ? stage.stem : resolvedStemsRef.current.get(id)
   ```
   with:
   ```ts
   const stem =
     stage?.changes.find((c) => c.slotId === id)?.stem ?? resolvedStemsRef.current.get(id)
   ```
   The `members` list is built from `[...ids]`. For a stage, the ids must also include `stage.joining`. Build a local `const memberIds = stage ? new Set([...ids, ...stage.joining]) : ids` and map over `memberIds` instead. Keep the member ORDER stable: existing ids first, joining ids after, because slot index numbering (`slotIndexById`) comes from that order.
2. **Bar lengths.** Replace `if (stage) stagedBarLengths.set(stage.slotId, stage.stem.barLength)` with:
   ```ts
   if (stage) for (const c of stage.changes) stagedBarLengths.set(c.slotId, c.stem.barLength)
   ```
3. **Gestures.** The block starts `const gesture = stage ? stage.gesture : radioOnRef.current ? radioGestureRef.current : null` and applies ONE gesture. Turn it into a loop:
   ```ts
   const gestureList: RadioGesture[] = stage
     ? stage.gestures
     : radioOnRef.current && radioGestureRef.current !== null
       ? [radioGestureRef.current]
       : []
   ```
   Wrap the existing `if (gesture && maxBarLength !== undefined ...) { ... }` body in `for (const gesture of gestureList) { ... }`, with its condition reduced to `maxBarLength !== undefined && maxBarLength > 0`.
   - **Merge, don't overwrite.** `stemAutomation[key] = { ... }` must merge with anything already on that key: `stemAutomation[key] = { ...stemAutomation[key], volume: ... }`, and the same for `filterCutoff` and `reverbSend`. Two changes can put a bloom on one row and a duck on it from another row's change.
   - **Duck against a duck.** When two ducks apply to the same key, keep the first. Duck curves are identical, so re-scaling them twice would be wrong. Guard the duck branch with `if (!stemAutomation[key]?.volume)`.
   - **Duck skips every changing row.** Each duck skips `m.id !== gesture.slotId` today. It must instead skip EVERY row changing in this stage, so a duck never dips another arriving stem: `const changing = new Set(stage?.changes.map((c) => c.slotId) ?? [gesture.slotId])` and `if (!changing.has(m.id))`.
4. **Other `stage.` reads.** Grep `stage\.` inside `buildAndPushPreview` and `syncPreviewToEngine` and fix any other `stage.slotId` / `stage.stem` / `stage.gesture` read to the new shape. The trace call keeps `stage.token`, `stage.label`, `stage.atPos` and `stage.loopBars`.

- [ ] **Step 3: The one caller builds the new shape**

In `stepRadioStage` step (3), replace the `syncPreviewToEngine(previewingSlotIdsRef.current, { token, slotId: led.slotId, stem: led.stem, gesture: ..., atBars: ..., label: ..., atPos: pos, loopBars })` argument with one built through `mergeStageChanges`:

```ts
    const merged = mergeStageChanges(
      { slotId: led.slotId, stem: led.stem, arrival: led.arrival },
      new Map()
    )
    void syncPreviewToEngine(previewingSlotIdsRef.current, {
      token,
      changes: merged.changes,
      joining: merged.joining,
      gestures: merged.arrivals.map((a) => ({
        kind: a.kind,
        slotId: a.slotId,
        beats: a.beats,
        lapsLeft: 1
      })),
      atBars: led.atBars,
      label: led.arrival ? led.arrival.kind : radioGestureRef.current !== null ? 'led' : 'cut',
      atPos: pos,
      loopBars
    })
```

Import `mergeStageChanges` from `@shared/radioManualChanges`. `radioStageRef` still records `slotId: led.slotId` for now; Task 3 generalises it.

- [ ] **Step 4: Verify nothing changed**

Run `npm run typecheck`, `npx vitest run` and `npx eslint src/renderer/src/components/DiscoverPanel.tsx`: all clean.

Then reason it through and write it into your report:
- With exactly one change and one arrival gesture, the built project is identical to before. Same members in the same order, same bar lengths, same `stemAutomation` keys and values.
- The live (unstaged) path produces the same `gestureList` of zero or one gesture as before.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "a staged radio swap can carry any number of rows, still carrying one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The manual queue — wait, stage together, land together

**Files:** Modify `src/renderer/src/components/DiscoverPanel.tsx`

This task adds the queue and makes the stage and landing branches honour it. Nothing routes into it yet; Task 4 does that. It is therefore behaviour-neutral until Task 4, and must still typecheck and pass.

- [ ] **Step 1: The queue and its render mirror**

Next to `radioLedChangeRef` / `radioHeldSlotId`, add:

```ts
  // MANUAL CHANGES WAITING FOR THE LOOP TOP (2026-09-29). While radio runs,
  // a reroll, a nearby pick, an added or duplicated row does not commit on
  // the spot: it waits here, fully warmed, and lands with radio's own
  // change in one staged swap at the next wrap, with a transition. See
  // docs/superpowers/specs/2026-09-29-radio-manual-changes-land-on-the-top-
  // design.md. A REF because the 30Hz clock effect reads it; the Set
  // below is its renderable half, the same split radioLedChangeRef /
  // radioHeldSlotId use.
  const manualChangesRef = useRef<
    Map<
      string,
      {
        pick: SlotPick
        stem: ResolvedCandidateStem | null
        joining: boolean
        arrival: ManualArrival | null
      }
    >
  >(new Map())
  const [manualWaitingSlotIds, setManualWaitingSlotIds] = useState<ReadonlySet<string>>(
    new Set()
  )
  /** THE ONLY WAY manualChangesRef IS WRITTEN -- same deferral and reason
   * as setRadioLedChange. */
  function setManualChanges(next: typeof manualChangesRef.current): void {
    manualChangesRef.current = next
    const ids = new Set(next.keys())
    void Promise.resolve().then(() => setManualWaitingSlotIds(ids))
  }
```

Import `ManualArrival` (type) and `drawManualTransitions` from `@shared/radioManualChanges`, and `pickDropOutBeats` if not already imported.

- [ ] **Step 2: Warming, factored out of `armRadioPick`**

`armRadioPick` resolves a pick's stem and then warms three things: `warmEngineBuffer` (stretch plus engine preload), and `getPeaks`. Extract that into:

```ts
  /** Resolve a pick's stem and warm everything the swap will ask for --
   * the stretch, the engine's decoded buffer, the waveform peaks -- so the
   * landing reads values instead of asking for them. Shared by radio's own
   * pick (armRadioPick) and every manual change. Resolves to null when the
   * candidate cannot be resolved. */
  async function resolveAndWarmPick(pick: SlotPick): Promise<ResolvedCandidateStem | null> {
    if (pick.candidate === null) return null
    const stem = await resolveCandidateStem(pick.candidate)
    if (stem === null) return null
    void warmEngineBuffer(
      stem,
      bpmRef.current,
      resolveStretchedForPlayback,
      (path, durationSec) => void window.rifffApi.enginePreloadStem(path, durationSec)
    )
    void getPeaks(stem.path).catch(() => {})
    return stem
  }
```

Move the long explanatory comments from `armRadioPick` onto this function, not into a fresh summary; they are the record of four earlier fixes. Then make `armRadioPick` call it. Its `setRadioPending({ ...radioPendingRef.current, incomingBars: stem.barLength, stem })` stays in `armRadioPick`, in the `.then`, with the same guard `radioPendingRef.current?.pick === pick`.

- [ ] **Step 3: `queueManualChange`**

```ts
  /** Queue a manual change for the next loop top. Returns false when the
   * row already has one waiting -- a second click on a waiting row is
   * ignored (Elling, 2026-09-29). `joining` is a row that is not in the
   * mix yet (added or duplicated while radio ran). */
  function queueManualChange(slotId: string, pick: SlotPick, joining: boolean): boolean {
    if (manualChangesRef.current.has(slotId)) return false
    const next = new Map(manualChangesRef.current)
    next.set(slotId, { pick, stem: null, joining, arrival: null })
    setManualChanges(next)
    // Radio's own armed pick for this row is now stale -- the user has
    // spoken for it. Drop it; it is re-armed after the landing.
    if (radioPendingRef.current?.slotId === slotId) setRadioPending(null)
    // A stage already out carries the wrong set now. Withdraw it; step (3)
    // re-stages everything that is waiting on its next tick.
    cancelStagedSwap('manual-change')
    void resolveAndWarmPick(pick).then((stem) => {
      const entry = manualChangesRef.current.get(slotId)
      if (entry === undefined || entry.pick !== pick) return
      if (stem === null) {
        // Unresolvable: drop it. The row keeps what it had -- the same
        // soft degradation every other Discover path takes.
        const dropped = new Map(manualChangesRef.current)
        dropped.delete(slotId)
        setManualChanges(dropped)
        return
      }
      const ready = new Map(manualChangesRef.current)
      ready.set(slotId, { ...entry, stem })
      setManualChanges(ready)
    })
    return true
  }
```

- [ ] **Step 4: Withdraw on remove**

In `removeSlot`, before the existing lines, add:

```ts
    if (manualChangesRef.current.has(id)) {
      const next = new Map(manualChangesRef.current)
      next.delete(id)
      setManualChanges(next)
      cancelStagedSwap('manual-change-removed')
    }
```

When radio switches off (search `cancelStagedSwap('radio-off')`) and when the panel unmounts (search `cancelStagedSwap('panel-closed')`), the waiting changes must still happen. Radio off means "back to instant". So in the radio-off path, COMMIT every waiting manual change immediately:
- non-joining rows: `commitSlotPick(slotId, pick)`;
- joining rows: `commitSlotPick`, and let the row join the mix the way a new row does today;
- then clear the queue.

On unmount, just clear the queue.

- [ ] **Step 5: Stage step (3) takes the manual changes too**

In `stepRadioStage` step (3), the gate currently returns early when `led === null || led.stem === null`. Change the logic so a stage goes out when there is ANYTHING ready:

```ts
    const led = radioLedChangeRef.current
    const ledReady = led !== null && led.stem !== null && led !== radioStageAppliedLedRef.current
    const manual = manualChangesRef.current
    const manualAllReady = [...manual.values()].every((m) => m.stem !== null)
    if (
      radioStageRef.current !== null ||
      (!ledReady && manual.size === 0) ||
      !manualAllReady ||
      !radioOnRef.current ||
      !previewLoadedRef.current ||
      radioCourseChangeRef.current !== null ||
      liveSyncInFlightRef.current > 0 ||
      pendingSyncRafRef.current !== null ||
      syncHoldRef.current.size > 0
    ) {
      return
    }
```

Before building the request, draw transitions for manual changes that do not have one yet. Do this once per change, the first time it is staged, and store it back into the queue:

```ts
    const undrawn = [...manual.entries()].filter(([, m]) => m.arrival === null)
    if (undrawn.length > 0) {
      const drawn = drawManualTransitions(
        undrawn.map(([slotId]) => ({
          slotId,
          kinds: slotsRef.current.find((s) => s.id === slotId)?.kinds ?? []
        })),
        {
          pick: (kinds) => pickTransition(radioSettings.transitions, kinds),
          dropOutBeats: pickDropOutBeats,
          leadingArmed: radioGestureRef.current !== null,
          barsToWrap: loopBars - pos
        }
      )
      const next = new Map(manual)
      let leading: { slotId: string; arrival: ManualArrival } | null = null
      for (const [slotId, arrival] of drawn) {
        const entry = next.get(slotId)
        if (!entry) continue
        if (radioGestureLeadsChange(arrival.kind)) {
          // A leading gesture plays NOW, live, on the outgoing stem (a
          // joining row has none -- it falls back to a cut). It is not
          // part of the stage; the stage carries this row as a cut.
          if (entry.joining) {
            next.set(slotId, { ...entry, arrival: { kind: 'cut', beats: 4 } })
          } else {
            leading = { slotId, arrival }
            next.set(slotId, { ...entry, arrival: { kind: 'cut', beats: 4 } })
          }
        } else {
          next.set(slotId, { ...entry, arrival })
        }
      }
      setManualChanges(next)
      if (leading !== null) {
        radioGestureRef.current = {
          kind: leading.arrival.kind,
          slotId: leading.slotId,
          beats: leading.arrival.beats,
          lapsLeft: 1
        }
        // Same as radio's own leading gesture: it must reach the engine as
        // a live project now, and the stage follows on a later tick
        // (a load-project overtaking a stage drops the stage).
        scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
        return
      }
    }
```

Then build the request with `mergeStageChanges(ledReady ? { slotId: led.slotId, stem: led.stem, arrival: led.arrival } : null, readyManualMap)`. `readyManualMap` maps each manual entry to `{ stem, joining, arrival }`. A `cut` is fine, because `mergeStageChanges` skips cut arrivals. Fix the TypeScript narrowing on `led` with a local.

- **`radioStageRef.current`** becomes `{ token, slotIds: merged.changes.map((c) => c.slotId), sent: false, mapping: null }`. Rename the field from `slotId` to `slotIds` and update every reader:
  - the per-tick eligibility withdraw in step (1) must check only RADIO's own slot. Manual changes ignore padlock and mute. Keep a separate `ledSlotId` field for it, or look it up from `radioLedChangeRef`.
- **`label`:** `'manual'` when there is no `led`, otherwise as before.
- **`atBars`:** always `undefined` (the loop top) when any manual change is included. Otherwise it is `led.atBars` as before.

- [ ] **Step 6: Landing takes the manual changes too**

The wrap-landing branch starts `if ((step.wrapped || crossedHeldBar) && radioLedChangeRef.current !== null) {`. Manual changes land only at the WRAP, never at a held bar:

1. **Widen the condition** to also fire when `step.wrapped && manualChangesRef.current.size > 0`.
   - Inside it, `led` may now be null. Guard every led-specific line: the `led.early` clock restart, `setRadioLedChange(null)`, the eligibility re-check and commit, and the `radioTraceBegin` label.
   - `clearRadioGesture()` still runs, since any leading gesture has fired.
2. **Capture and clear the queue first.** Take `const landing = [...manualChangesRef.current]` at the top of the branch, then call `setManualChanges(new Map())`.
   - Only land entries whose `stem !== null`. An entry still resolving stays queued for the next wrap.
   - Put those unready entries back into the map before clearing, with `setManualChanges(new Map(unready))`.
3. **Commit in the existing microtask**, next to radio's own commit:
   ```ts
   for (const [slotId, change] of landingReady) {
     if (!slotsRef.current.some((s) => s.id === slotId)) continue // removed meanwhile
     commitSlotPick(slotId, change.pick)
     holdSyncUntilResolved(slotId)
     if (change.joining) joinPreviewingMix(slotId)
   }
   ```
   `joinPreviewingMix` is whatever helper adds a slot id to `previewingSlotIds` and `previewingSlotIdsRef`. Grep for the existing add path (`reportSlotResolution`'s auto-join, or `toggleSlotPreview`) and reuse it, don't re-implement it.
   - Arm arrival gestures: at most one live `radioGestureRef` exists, so arm the FIRST non-cut arrival among radio's led and the manual changes. Later arrivals are not re-armed live, because the staged project already carried their curves for the lap. Then set `lapsLeft: 1` as radio does.
   - **Known limit:** after the follow-up push (the commit's own load-project), only the one armed gesture is carried. So a second arrival curve disappears ~0.15 bar after the landing. Resolve this: extend `radioGestureRef` to a list (`RadioGesture[]`) so the live path carries all of them. The Task 2 loop already takes a list, so this is small. Update `clearRadioGesture`, the lap countdown, and `radioGestureRef.current !== null` checks, which become length checks. Keep the "at most one LEADING" rule.
4. **Re-arm radio afterwards.** Call `runAfterEngineSync(() => { if (radioOnRef.current) void armRadioPick() })` when anything committed. It must not be called twice when both radio and manual changes land.
5. **Ineligible slot, swap already made.** Radio's own `engineSwapped` / ineligible fallback stays as is, for the led slot only.

- [ ] **Step 7: The row shows the wait and ignores a second click**

- In the `radioApproachFor({...})` call for each row, a slot in `manualWaitingSlotIds` must read as `held`. Read `radioApproachFor` in `@shared/radioApproach` to see how it maps `heldSlotId`. The simplest correct change is to pass `heldSlotId: manualWaitingSlotIds.has(slot.id) ? slot.id : radioHeldSlotId`. If that signature makes it awkward, add an optional `extraHeld: boolean` parameter instead, test-first in `radioApproach.test.ts`.
- `DiscoverSlotRow` gets a new prop `manualWaiting: boolean`. When it is true:
  - same kind, nearby jam and any stem are disabled, with the same look as `rerolling`;
  - duplicate and remove stay enabled.
- **The phone.** The phone's reroll actions go through the same functions (search `action === 'similar'`). Task 4's routing makes a second action return early, so nothing else is needed here.

- [ ] **Step 8: Verify**

Run `npm run typecheck`, `npx vitest run` and eslint on the file. Nothing routes into the queue yet, so radio's behaviour must be unchanged. Reason that through in your report:
- with an empty queue, step (3), the landing branch and `buildAndPushPreview` behave exactly as after Task 2;
- the only structural change is `radioGestureRef` becoming a list, with at most one entry when nothing is manual.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "manual changes can wait for the loop top beside radio's, and land in the same swap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Route every manual action through the queue while radio runs

**Files:** Modify `src/renderer/src/components/DiscoverPanel.tsx`

Every change here is gated on `radioOnRef.current`. The radio-off path must be left literally as it is.

- [ ] **Step 1: Rerolls (same kind)**

In `rollForSlot`:

```ts
  async function rollForSlot(id: string, kinds: DiscoverSlotKind[]): Promise<void> {
    // A row already waiting ignores a second roll -- checked before the
    // pick, so it costs nothing.
    if (radioOnRef.current && manualChangesRef.current.has(id)) return
    const pick = await pickForSlot(id, kinds)
    if (pick === null) return
    if (radioOnRef.current) {
      const joining = !previewingSlotIdsRef.current.has(id)
      queueManualChange(id, pick, joining)
      return
    }
    commitSlotPick(id, pick)
  }
```

**Every caller of `rollForSlot` must still be correct.** Grep for `rollForSlot(` and list each caller in your report with a line on why it is correct. They include `rerollSlot`, `addSlot` and `rerollAll`.

A brand-new slot from `addSlot` is not previewing, so it queues as `joining`. That is the intended behaviour.

**radio's course change and radio's own picks do NOT go through `rollForSlot`.** They use `pickForSlot` and `commitSlotPick` directly. Confirm this by grep. If any radio path does call `rollForSlot`, stop and report it rather than routing radio's own changes into the manual queue.

- [ ] **Step 2: Any stem**

`rollRandomForSlot` writes `setSlots(... candidate ...)` directly instead of going through `commitSlotPick`. Build a `SlotPick` from its candidate, as `{ candidate, barUsed: null, barRequested: <what it would have been> }`. Read `commitSlotPick` and the `SlotPick` type to see what `barRequested` means, and use the value `commitSlotPick`'s `pickBar` would need.

- When radio is on, `queueManualChange` it, with the same early return for a waiting row.
- When radio is off, keep today's `setSlots` exactly.
- Also keep the `setRolledCount` increment exactly where it is.

- [ ] **Step 3: Nearby jam**

`swapSlotFromNearby(id, candidate)` (the desktop popover pick) and `rollAdjacentForSlot` (the phone's one-tap) both end in `swapSlotFromNearby`. When radio is on, `swapSlotFromNearby` should queue instead:

```ts
  function swapSlotFromNearby(id: string, candidate: DiscoverCandidate): void {
    if (radioOnRef.current) {
      if (manualChangesRef.current.has(id)) return
      queueManualChange(
        id,
        { candidate, barUsed: null, barRequested: /* same rule as Step 2 */ },
        !previewingSlotIdsRef.current.has(id)
      )
      return
    }
    pushUndoSnapshot()
    setSlots(/* unchanged */)
  }
```

- [ ] **Step 4: Duplicate**

When radio is on, `duplicateSlot` creates the new slot with the source's `kinds`, `gain` and `locked`, but `candidate: null`, `seedStem: undefined` and `hasRerolled: false`. It then queues a manual change carrying the SOURCE slot's current candidate as a `SlotPick`, with `joining: true`.

- A seeded source (`slot.seedStem` with no candidate) cannot be expressed as a pick. For that case keep today's immediate duplicate, and note it in a comment.
- When radio is off, leave it unchanged.

- [ ] **Step 5: Add a stem, and + random**

`addSlot` already calls `rollForSlot` or `rollRandomForSlot` for its new slot, so Steps 1 and 2 cover it. The new slot is not previewing, so it queues as `joining`.

Check the new row does NOT auto-join the preview mix before the landing. Its `candidate` stays null until `commitSlotPick`, so `reportSlotResolution`'s auto-join has nothing to fire on. Confirm this by reading `reportSlotResolution`.

- [ ] **Step 6: Reroll-all**

`rerollAll` loops over slots and calls `rollForSlot` for each unlocked one. Step 1 already queues them. Two checks:
- It takes one undo snapshot up front. Keep it, even though the commits happen later, because undo applies to the committed state.
- Rows that already have a waiting change are skipped by `rollForSlot`'s early return. That is correct.

- [ ] **Step 7: Verify**

Run:
- `npm run typecheck`
- `npx vitest run`
- `CI=1 npx vitest run`
- `npx eslint src/renderer/src/components/DiscoverPanel.tsx`
- `npm run lint`: exactly 4 pre-existing warnings

In your report, list every place that now calls `queueManualChange`. Check that with radio off, every one of them takes its old path.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "while radio runs, every way of bringing in a stem waits for the loop top and arrives with a transition

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Manual check (hand to Elling, do not claim)**

With `npm run dev`, Discover and radio on, collect the `[radio-stage]` / `[radio-gate]` lines from DevTools, then check:
1. Click same kind on one row. The row breathes, the old stem plays until the loop top, and the new one lands exactly there with a transition. The log shows `APPLIED via wrap at 0.0000bar`.
2. Click same kind on three rows in one lap. They all land together.
3. Click a waiting row again. Nothing happens.
4. Add a stem. The row appears silent and breathing, then joins at the top.
5. Duplicate a row. The copy joins at the top.
6. Use the nearby-jam pick, and the phone's reroll and nearby buttons.
7. Reroll-all. Every unlocked row lands at one top.
8. Padlock a row after clicking it. It still lands.
9. Remove a waiting row. Nothing lands for it.
10. Turn radio off while changes are waiting. They land at once.
11. Radio off. Everything is instant, exactly as before.
12. Radio's own changes still land on time.

---

### Task 5: Full verification

- [ ] Run `npx vitest run && CI=1 npx vitest run && npm run typecheck && npm run lint`. Everything must pass, and lint must show exactly the 4 pre-existing warnings.
- [ ] Run `git status --short`. It must be clean.
- [ ] Report to Elling: what shipped, the manual checklist above, and that nothing was heard or seen by an agent.

# Radio: manual changes land like radio's own — design

2026-09-29. Agreed with Elling in conversation.

> "any buttons for finding new stems in radio mode.. have the transition behavior be in place, so
> those stems come in similarly to the radio stems"
> — "yes, any stems or reloads." A second click on a waiting row: "be ignored i think".

## The problem

While radio is running, radio's own changes are prepared a lap early and land exactly at the loop
top with a transition. The same staged swap does both: the engine applies it sample-accurately at
the wrap (see the 2026-09-29 handoff §2).

Every *manual* way of getting a stem skips all of that. `rollForSlot` calls `commitSlotPick` the
moment the pick returns, so the new stem cuts in mid-loop, at whatever phase the transport is at,
with no transition.

## Scope

**When radio is on,** every action that brings a new stem into the mix becomes a **manual change**
that waits for the next loop top.

| action | today | with radio on |
|---|---|---|
| same kind / any stem on a row | commits immediately | queued, lands at the top |
| nearby jam popover pick, and the phone's one-tap nearby | swaps immediately | queued |
| duplicate a row | new row plays immediately | new row waits, joins at the top |
| add a stem (the kind chips, + random) | new row plays as soon as it resolves | new row waits, joins at the top |
| toolbar reroll-all | every row commits as it resolves | every eligible row queued, all land together |
| phone rerolls | same as the row buttons | same as the row buttons |

**Cmd-click lands it right away** (Elling, 2026-09-29: "it'd be nice to be able to override and just
have it add it right away as well"). Holding Cmd on any of the clicks above commits immediately,
exactly as it does with radio off -- no wait, no transition. It works on the row buttons (same kind, any
stem, nearby jam, duplicate), the add chips, + random, and the toolbar reroll-all. The phone has no
modifier, so its actions always wait.

This takes Cmd from the add chips, where Cmd-click used to mean "combine kinds". **Combine moves to
Shift-click**, and the hint under the chips changes from `hold cmd to combine` to
`hold shift to combine`. That applies whether radio is on or off.

**When radio is off, nothing changes**, apart from the combine key. Every path above keeps today's behaviour exactly.

Out of scope:
- Importing a sample (`+ sample`).
- Restoring a seed.
- Undo and redo. Undo is an edit to the loop, not a performance, and it stays immediate.

## Behaviour

1. **The pick is made at once** through the existing pick paths. Then it is warmed like radio's own
   pick:
   - resolved,
   - stretched,
   - loaded into the engine's buffer (`preload-stem`),
   - its waveform peaks decoded.
2. **The row waits visibly.** It uses the same `held` breathing the row already has for radio's
   decided change (`radioApproach` state `'held'`). The old stem keeps playing. A newly added row
   appears immediately but silent, and shows the same held breathing.
3. **A second action on a waiting row is ignored.** Its reroll buttons, nearby jam and the phone's
   reroll for that row are disabled until the change lands. Duplicating a waiting row, or removing
   it, still works:
   - remove withdraws the waiting change;
   - duplicate copies the row's *current* stem, and the copy itself waits.
4. **At the loop top, every waiting change lands together as one swap.** That includes radio's own
   held change if it has one. It is one staged project, applied by the engine at the wrap, then
   committed by the panel exactly as radio's single change is today.
5. **Transitions** are drawn with `pickTransition` from the user's transitions setting, per changed
   row, from that row's kinds.
   - **Arrival gestures** (filter in, bloom, duck) may apply to several rows at once. Each lands on
     its own row's stem, and a duck applies to every row not changing.
   - **Leading gestures** (hole, riser) play *before* the top, on the outgoing stem. At most one may
     be armed per lap, as radio's rule already requires. If one is already armed, or a leading
     gesture is drawn for a second change, that change falls back to `cut`.
   - A manual change queued too late in the lap for a leading gesture to play out lands with
     arrival or cut only. A leading gesture is only drawn when at least its own length is left
     before the wrap.
6. **Padlock and mute do not withdraw a manual change.** Radio skips those rows, but a click on one
   is intentional. Only removing the row withdraws its change.
7. **Radio's pacing.**
   - A manual change counts as that row turning over. `commitSlotPick` already records
     `radioChangedAtRef`, so the even-rotation weighting sees it as fresh.
   - It does **not** restart radio's interval clock. Radio's next change comes when it would have.
   - If radio's own pick is armed for a row that the user just queued a manual change on, radio's
     pick for that row is dropped and re-armed after the landing.
8. **Always the loop top.** Even a bare cut waits for the wrap, never a mid-lap bar. One predictable
   moment is easier to read than radio's 2/4-bar cut grid. The cost is up to one lap of waiting.

## How it is built

### The staged swap carries many rows

Today `RadioStageRequest` has one `slotId` + `stem` + `gesture`. It becomes:

```ts
interface RadioStageRequest {
  token: number
  /** Every row whose stem changes at this wrap: radio's own held change,
   * and every manual one. */
  changes: { slotId: string; stem: ResolvedCandidateStem }[]
  /** Rows that do not exist in the live mix yet (added or duplicated
   * while radio ran) -- joined into the staged member list. */
  joining: string[]
  /** Arrival curves, one per changing row that drew one; at most one
   * leading gesture is ever live, and it is not carried here (it belongs
   * to the lap BEFORE the swap, exactly as today). */
  gestures: RadioGesture[]
  atBars?: number
  label: string
  atPos: number
  loopBars: number
}
```

`buildAndPushPreview` changes as follows:
- The member loop reads the incoming stem from `changes` for any slot listed there.
- Joining slots are added to the member ids.
- `stagedBarLengths` takes every change's bar length.
- The gesture block loops over `gestures` instead of reading one.

The live (unstaged) path is unchanged, because it only ever carries one armed gesture.

### The waiting changes

A new ref, `manualChangesRef: Map<slotId, { pick, stem, arrival? }>`, lives beside
`radioLedChangeRef`. The panel keeps a mirrored state set of waiting slot ids for rendering, in the
same pattern as `radioHeldSlotId`.

- **Queue:** every in-scope action, when `radioOnRef.current`, calls a new `queueManualChange(slotId, pick)`
  instead of `commitSlotPick`. For new rows, it adds the slot first, not previewing yet, then queues.
- **Stage:** `stepRadioStage` step (3) currently stages when `radioLedChangeRef` is set. It now
  stages when radio's held change **or** any manual change is waiting and ready (stem resolved).
  - It builds one request from all of them.
  - A change queued *after* a stage went out withdraws that stage (`cancelStagedSwap`) and re-stages
    with the new set on the next tick, so the wrap takes everything that was waiting.
  - If there is not enough time left before the wrap for the rebuild, the late change waits for the
    following wrap. The build uses the same "not sent yet" guard radio's stage already has.
- **Land:** the wrap branch that lands radio's led change today also lands every manual change in
  the same microtask:
  - `commitSlotPick` for each;
  - `holdSyncUntilResolved` for all of them, so one push follows;
  - joining rows added to `previewingSlotIds`;
  - arrival gestures armed.

  If radio had no held change of its own, the branch still runs for the manual ones.
- **Withdraw:** removing a row drops its waiting change and withdraws any stage that carried it.

### The reroll-all case

With radio on, the toolbar reroll-all queues a manual change for every row that is not padlocked.
Padlock still means "not this one" for a deliberate reroll-all, as it does today. They then land
together through the same mechanism. The existing course-change batch is radio's pace-chip path,
and it is left alone.

### Pure logic, tested

Two decisions live in a new pure module, `src/shared/radioManualChanges.ts`, test-first:
- **`drawManualTransitions(changes, settings, leadingAlreadyArmed, barsToWrap, random)`**
  - Assigns a transition to each change.
  - At most one leading gesture per lap, and none when one is already armed.
  - No leading gesture when fewer bars remain than it needs.
  - Otherwise the draw comes from `pickTransition`.
- **`mergeStageChanges(radioLed, manual)`**
  - Combines radio's held change and the manual map into the request's `changes` / `joining` /
    `gestures`.
  - A manual change on the same row as radio's held change wins, and radio's is dropped.

## Verification

- `npx vitest run`, `CI=1 npx vitest run`, `npm run typecheck`, `npm run lint`.
- **Needs Elling:** none of this can be heard or seen by an agent. Check:
  - several rows clicked in one lap all land together at the top;
  - a transition on each;
  - a second click on a waiting row does nothing;
  - an added row joins at the top;
  - radio's own changes still land on time alongside;
  - radio off: everything is instant, as before.
- The `[radio-stage]` / `[radio-gate]` instrumentation is still in the code. A stage with several
  changes should read `via wrap at 0.0000bar`, the same as radio's own.

## Risks

- **The rewrite touches the stage/land code that took all of 2026-09-29 to get right.** Keep the
  reclamation and RT-safety reasoning from the handoff intact. Nothing here touches the engine: it
  already swaps whole projects, whatever they contain.
- **Latency by design.** A click can wait up to a lap, about 30s on a 16-bar loop at the ~130bpm of the 2026-09-29 logs. The
  breathing row is the only feedback. If that feels too slow in practice, the follow-up would be
  letting a bare cut use radio's 2/4-bar grid. That is deliberately not in this version.

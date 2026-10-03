# Radio: turn, a turnaround on demand

**Date:** 2026-10-02
**Scope:** sssketch Discover radio, the phone remote and ell.ing/radio full mode.
**Builds on:** `2026-10-02-radio-turnarounds-design.md` (the planner, the moves, the arm-and-clear
path).

## Why

Turnarounds mark phrase ends on their own. Elling wants to play them as well: hit a move when the
music asks for it, the way a DJ throws one in.

## Decisions (Elling, 2026-10-02)

- **Landing:** a turn lands on the **next loop top**, as manual changes already do.
- **Controls:**
  - `turn` lets the planner choose the move;
  - a row of **move chips** fires one exact move;
  - either way it takes one tap.
- **Surfaces:** sssketch Discover, the phone remote, and web radio full mode. Web simple mode gets
  nothing.

## 1. What it does

- **`turn`:**
  - At the next loop top, the planner rolls a move as usual: by arc direction, within the enabled
    `moves` families, at the set `depth`.
  - It always fires, with no rate roll.
  - If no move can sound, nothing happens and the button flashes `nothing to turn`.
- **Move chips:** `drop`, `low drop`, `stop`, `wash`, `lift`, `dip`, `riser`.
  - A chip fires exactly that move at the next loop top, at the set `depth`.
  - A chip **ignores** the `moves` toggles: picking a move by hand is explicit.
  - A chip that can't sound right now is dimmed, with the tooltip `not now`. For example, `drop`
    with no drums row, or `stop` with no melodic row to keep. The planner's guards decide this.
- **Turnarounds `off`:** turns still work. `off` only stops the automatic phrase-end turnarounds.

## 2. Timing

- **Anchor.** A turn ends on the one of the next loop top and is counted backwards from it, like
  every turnaround (radio controls spec 0A.4).
- **A late press.** The move's length is clamped to the time left before that top:
  - minus the runtime's lead time: sssketch's push latency, the web's `MIN_LEAD_SEC`;
  - never below 1 beat.
  - If less than 1 beat plus the lead is left, the turn waits for the following loop top.
  - The planner's own cap (min(half the loop, 4 bars), or 1 bar at `subtle`) still applies.
- **One waiting turn.**
  - A new tap before it lands replaces the waiting one: last tap wins.
  - **Undo** withdraws a waiting turn, the same way it withdraws waiting manual changes. A turn that
    has started playing is not undone.
- **With automatic turnarounds.**
  - A turn landing on a phrase end **replaces** that phrase end's automatic roll.
  - The diminution memory (`lastPhrase`) is updated only by phrase-end turnarounds, so a manual turn
    never starts or extends a diminution chain.
  - An automatic turnaround already armed for the lap is replaced by the turn: the latest decision
    wins.
- **With layer changes.** It follows the turnaround rule: a change landing on the same top keeps
  only its arrival. Manual changes queued for that top still land.
- **Gestures already playing.** It also follows the turnaround rule. Volume multiplies; a row
  filtering in is skipped by filter moves.

## 3. Where it lives

- **sssketch Discover:**
  - A `turn` button beside the radio controls, shown while radio is on. Its tooltip is
    `turn at the top`.
  - The move chips sit in a small row under it, shown while radio is on.
  - While a turn waits, the button reads `turning` and the waiting move's chip is held. At the top
    both clear.
  - **Shortcut:** `t` turns, outside text inputs. Nothing claims plain `t` today: App's handlers use
    cmd-z, cmd-shift-z, ctrl-y, space, delete and similar. This is checked again in the plan.
- **Phone remote** (`remoteServer.ts` / `remotePage.ts`):
  - a large `turn` button and the chip row, on the radio screen;
  - a `POST /turn` endpoint with an optional `move`;
  - it answers `turning`, `nothing to turn` or `radio off`, and the phone flashes the answer, as
    `keep` does.
- **Web full mode:** `turn` and the chips sit next to the existing turnaround toggles. Simple mode
  is unchanged.

All copy is lowercase, labels are at most two words, and there is no emoji.

## 4. Architecture

- **Shared (`radioTurnaround.ts`, pure, tested in sssketch):**
  - `TurnaroundInput` gains `force?: { move?: TurnaroundMove; maxBeats?: number }`:
    - `force` skips the rate roll, the never-two-in-a-row rule, and diminution;
    - `move` restricts the draw to that move, ignoring `moves`;
    - `maxBeats` clamps the length to the time left.
    - The guards still apply. A forced move that can't sound returns null.
  - `turnaroundMoveCanSound(input, move): boolean` dims the chips. It uses the same guard code.
  - `turnaroundTurnBeats(remainingBeats, leadBeats): number | null` gives the clamp, or null when
    the turn should wait for the next top.
- **sssketch:**
  - `DiscoverPanel` keeps one `pendingTurn` ref (`{ move?: TurnaroundMove } | null`).
  - On each tick it checks whether the coming top can take the turn. On the wrap tick, or as soon
    as the press fits this lap, it rolls with `force` and arms the plan through the existing
    turnaround arm-and-clear path, with the same ordering rules as the phrase-end roll.
  - The phrase-end roll for that wrap stands down.
  - Undo integrates through the existing manual-changes undo.
  - The phone remote's handler calls a panel callback, as `keep` does.
- **ell.ing/radio:**
  - `step.ts` gains a `turn` action carrying an optional `move`. It is consumed at the next top
    through `rollTurnaroundAt` with `force`, and replaces the phrase-end roll there.
  - The controller exposes `turn(move?)`, and full mode calls it.

## 5. Testing

- **Shared:**
  - `force` always fires when a move can sound;
  - a forced `move` ignores `moves` but not the guards;
  - the `maxBeats` clamp works, with the 1-beat floor;
  - `turnaroundTurnBeats` waits when too little time is left;
  - `turnaroundMoveCanSound` matches the guards.
- **Web (`step.test.ts`):**
  - a turn lands at the next top;
  - last tap wins;
  - it replaces the phrase-end roll;
  - a late press is clamped, or waits a lap;
  - diminution memory is untouched.
- **sssketch:**
  - typecheck and lint; the panel glue has no tests, by convention;
  - remote endpoint tests follow `remoteServer.test.ts`.
- **Elling's walkthrough:**
  1. `turn` lands on the next top.
  2. Each chip plays its move, and dimmed chips make sense.
  3. A press late in the lap is shorter, or lands on the following top.
  4. Undo withdraws a waiting turn.
  5. The phone's `turn` works.
  6. `t` works.

## Out of scope

- Landing on the phrase end with a modifier: not chosen.
- Simple mode.
- Per-move parameter knobs.
- Holding a move until release (a "performance hold").

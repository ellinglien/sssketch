# Draw Arrangement — Design

## Goal

A second, direct way to build an arrangement from every stem currently placed on the timeline,
alongside the existing guided/suggestion-based Auto-Arrange: instead of stepping through
weighted candidates, the user draws directly on a grid which stem is active in which section.
Elling's own framing: "in lieu of auto arrange... just a way for the user to draw the categorized
clips on the grid, like in autoarrange."

## Background — what already exists

Auto-Arrange is a 2-step wizard (`AutoArrangeWizard.tsx`): `AutoArrangeRoleStep.tsx` (confirm each
placed stem's `arrangeRole`/`drumSubRole`/`frequency`/`included`, pooling every stem from every
rifff currently placed on the timeline via `usePlacedFlatStems.ts`) → `AutoArrangeBuildStep.tsx`
(the weighted-candidate build step, one 4-bar "section" at a time, `ARRANGE_STEP_BARS` from
`src/shared/autoArrangeApply.ts`). That build step already has a build-progress grid — one row per
included stem, one column per section so far — added specifically so the shape being built has
"visual connection" (Elling's own phrase from that earlier feature). Draw Arrangement reuses that
same visual language as an *editable* surface instead of a read-only progress display.

The whole build produces an `ArrangeMoveRecord[]` (`{stepIndex, stemKey, moveType}`) plus a
`totalSteps` count, handed to `AutoArrangeWizard.tsx`'s `handleBuildComplete`, which calls
`buildArrangeReplaceActions` (`src/renderer/src/state/selectors.ts`) — this function turns that
move list into real `PASTE_RIFFF`/`MOVE_TO_CHANNEL`/`DELETE_RIFFFS` dispatches (an independent
trimmed clip per active window per stem, original touched rifffs deleted). Confirmed by re-reading
its signature: it only ever consumes `moves`/`totalSteps`, with **zero awareness of where they
came from** — Draw Arrangement reuses this function completely unchanged.

## Non-goals

- No phases (intro/build/peak/breakdown/outro) — phases exist to *guide the suggestion engine*
  toward a shape; drawing the shape yourself leaves nothing for a phase system to guide.
- No `fill` (the transient one-bar blip move type) — a cell is either active or not, full stop. A
  brief flourish is already expressible by turning a stem on for just one section.
- No `MIN_STEMS_FOR_FULL_ARC`-style warning — that guard was about whether the *suggestion engine*
  has enough material to build a real arc; moot when the user is drawing exactly what they want.
- No frequency/re-entry weighting — re-entry cooldown is a suggestion-engine-only concept. A user
  who draws a stem on, off, then on again has already decided the re-entry themselves.
- No growable grid — the grid is a fixed 16 columns (64 bars ÷ 4-bar sections, matching
  Auto-Arrange's own trigger-eligibility cap) available from the start, not something extended one
  section at a time.
- No new engine/apply-layer code — `buildArrangeReplaceActions`, `activeRangesForStem`, and every
  reducer case they dispatch to are reused completely unchanged.

## Design

### 1. Entry point

**Prerequisite refactor**: `AUTO_ARRANGE_MAX_BARS` is currently a local `const = 64` inside
`App.tsx`'s own component function, not shared. Move it to `src/shared/autoArrangeApply.ts`
(exported, alongside `ARRANGE_STEP_BARS`) so it has one real source of truth both features derive
from — `App.tsx` imports it instead of redeclaring it locally (pure rename, no behavior change to
today's auto-arrange gating), and `DRAW_ARRANGE_SECTIONS` (below) computes from it directly rather
than hardcoding a second, independently-drifting `16`.

A new `"draw arrangement"` item in the gear menu (`App.tsx`), next to `"auto-arrange"`, gated by
the exact same `AUTO_ARRANGE_MAX_BARS`/`placedTimelineSpanBars` eligibility check and messaging
already computed there for auto-arrange (same 64-bar cap, same "needs at least one rifff placed"/
"only available for short arrangements" disabled-reason text) — this is the same underlying
`placedTimelineSpanBars(state)` value, just also gating a second menu item. A new
`DrawArrangeWizard.tsx` component (structurally mirroring `AutoArrangeWizard.tsx`) orchestrates two
steps: role confirmation, then the grid.

### 2. Role step — extend, don't fork

Rather than duplicating `AutoArrangeRoleStep.tsx`'s whole waveform-preview/role/drumSubRole/
included editing UI, extend its `Props` with two optional fields:

```typescript
interface Props {
  onConfirm: (roles: StemRoleInfo[]) => void
  onCancel: () => void
  // New, both optional -- omitting either preserves today's exact
  // Auto-Arrange behavior unchanged.
  showFrequency?: boolean // default true
  onSkip?: () => void
}
```

- `showFrequency={false}` (Draw Arrangement's own usage) hides the frequency slider row entirely —
  re-entry cooldown/weighting has no meaning outside the suggestion engine. Density labels stay
  visible in both modes (purely informative, not engine-specific).
- `onSkip`, when provided, renders a "skip" button alongside "cancel"/"continue" that calls
  `onConfirm(roles)` immediately using whatever roles are currently resolved (the auto-seeded
  defaults, un-reviewed) — this is what makes the step "skippable" per Elling's own answer. Only
  rendered when `roles` has finished loading (the same `!roles` "analyzing stems..." guard already
  gates the rest of the step's own content).
- Auto-Arrange's own call site passes neither prop, so its existing behavior (frequency shown, no
  skip button) is completely unchanged.

### 3. The grid step — new component, fixed 16-column canvas

A new `DrawArrangeGridStep.tsx`:

```typescript
interface Props {
  stems: Array<{ stemKey: string; label: string; typeColor: string }>
  onApply: (moves: ArrangeMoveRecord[], totalSteps: number) => void
  onCancel: () => void
}

export const DRAW_ARRANGE_SECTIONS = AUTO_ARRANGE_MAX_BARS / ARRANGE_STEP_BARS // 64/4 = 16, fixed, not growable
```

- One row per included stem (using the same disambiguated-label logic — `stemLabelByKey` —
  already built for `AutoArrangeBuildStep.tsx`'s own grid; `DrawArrangeWizard.tsx` computes this
  once from confirmed roles and passes it down as plain `{stemKey, label, typeColor}` data, keeping
  this component's own props free of any engine-shaped types).
- Internal state: `Record<string, boolean[]>` (one fixed-length-16 boolean array per stemKey,
  initialized all-`false`), plus a `mode: 'draw' | 'erase'` toggle (default `'draw'`) sitting above
  the grid as a small two-button switch (same visual language as this app's other on/off toggles —
  e.g. the "tidy view: on/off" gear-menu item).
- **Click or click-and-drag, both governed by the current mode** — a single, consistent rule
  rather than inferring paint-vs-erase from whatever cell a drag happens to start on (which cell a
  drag starts on is often incidental, not a deliberate choice). In `'draw'` mode, clicking or
  dragging over a cell always sets it active; in `'erase'` mode, always sets it inactive. This
  matches a real paint/eraser tool's own mental model — switch tools, then whatever you touch does
  that tool's one job — rather than the cell's own prior state silently deciding what a gesture
  does.
- Implemented via a `pointerdown`/`pointermove`/`pointerup` sequence: `pointerdown` on a cell
  records `{stemKey}` in a ref (not state — this is a transient drag gesture, not something that
  should trigger the render-diffing React state updates would, though the actual toggled cells DO
  need real state updates as the drag proceeds) and immediately applies the current `mode`'s value
  to that first cell; `pointermove` while dragging applies the same current `mode` value to
  whichever cell is now under the pointer (using `document.elementFromPoint` or a cell-index
  calculation from the pointer's position relative to the row, whichever proves simpler in
  implementation); a document-level `pointerup` listener (not just one on the grid itself) ends the
  drag even if the pointer is released outside the grid's own bounds. Switching `mode` mid-drag
  isn't a real scenario (the mode toggle is a separate control, not reachable while a pointer is
  down on the grid) so no special handling is needed for that case.
- **"apply arrangement"** button: disabled while every stem's every cell is `false` (nothing
  drawn) — matches this app's existing disabled-button convention (dim to 30% opacity,
  `not-allowed` cursor). When enabled, converts the grid to moves (below) and calls
  `onApply(moves, DRAW_ARRANGE_SECTIONS)`.
- **"cancel"** button: calls `onCancel()`, no dispatch, nothing touched.
- Design-system compliance: same near-black monochrome, Silkscreen font, sharp corners
  (no `border-radius`), lowercase copy as every other surface built this session. Cell coloring
  reuses `typeColorVar` the same way `AutoArrangeBuildStep.tsx`'s own grid already does — color
  spent only on the audio-carrying information (which stem, active or not), never on chrome.

### 4. Grid → `ArrangeMoveRecord[]`

A new pure function, placed in `src/shared/autoArrangeApply.ts` alongside `activeStemKeysPerStep`
(its natural inverse — that function goes moves→per-step active sets; this one goes the other
way):

```typescript
export function movesFromDrawnGrid(grid: Record<string, boolean[]>): ArrangeMoveRecord[] {
  const moves: ArrangeMoveRecord[] = []
  for (const [stemKey, cells] of Object.entries(grid)) {
    let wasActive = false
    for (let stepIndex = 0; stepIndex < cells.length; stepIndex++) {
      const isActive = cells[stepIndex]
      if (isActive && !wasActive) {
        moves.push({ stepIndex, stemKey, moveType: 'enter' })
      } else if (!isActive && wasActive) {
        moves.push({ stepIndex, stemKey, moveType: 'exit' })
      }
      wasActive = isActive
    }
  }
  return moves
}
```

`DrawArrangeWizard.tsx`'s own `onApply` handler calls this, then dispatches
`buildArrangeReplaceActions(state, moves, DRAW_ARRANGE_SECTIONS)` exactly the way
`AutoArrangeWizard.tsx`'s `handleBuildComplete` already does — same function, same call shape, no
changes to that function itself.

### 5. Testing

`movesFromDrawnGrid` is real `src/shared/` pure logic — gets TDD coverage per this codebase's
convention (empty grid → `[]`; a stem active from section 0 with no exit → one `enter`, no
matching `exit`; on/off/on-again → two `enter`s and one `exit` at the correct indices; multiple
stems' moves interleave correctly in emission order). `DrawArrangeWizard.tsx`/
`DrawArrangeGridStep.tsx`/the `AutoArrangeRoleStep.tsx` prop extension stay typecheck+lint-verified
plus Elling's own manual walkthrough, per this codebase's standing convention for React
components — the drag-paint gesture specifically can only be verified by a human actually
dragging across the grid, not by a coding agent.

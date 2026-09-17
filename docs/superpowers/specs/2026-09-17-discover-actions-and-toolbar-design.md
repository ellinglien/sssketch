# Discover: Add to Timeline / Add to Shelf, toolbar rework, slot-row grid — Design

Approved live, in conversation, across several rounds of direct feedback and two visual-
companion mockups (`toolbar-rethink.html`, `toolbar-and-slotrow.html`). This doc consolidates
those decisions into one spec before implementation.

## 1. Background / problem

Three separate but related complaints about Discover's own top toolbar and per-slot rows,
gathered live from direct testing:

1. **"plunk in arranger doesn't feel like it worked."** The only feedback today is a 500ms
   box-shadow pulse (`discover-plunk-pulse`) on the button itself, plus the preview loop keeps
   playing right through it. Direct quote: *"right now the glow isn't enough to convince
   someone that something has happened, it just feels like a failed process."* Also asked to
   rename "Plunk in Arranger" to "Add to Timeline," and add a sibling "Add to Shelf" button
   that adds the built loop to the shelf without placing it on the arranger.
2. **Toolbar clutter.** Adding a second action button directly to the existing single-row
   toolbar was rejected once actually seen in mockup: *"but the top area is cluttered with
   buttons currently, youll need to rethink it all."* The real row (re-read fresh from
   `DiscoverPanel.tsx:1485-1742`) packs in: a tight/loose chaos slider, a tempo
   stepper+value+"match seed" button, two checkboxes, undo/redo, play/stop, reroll-all, and the
   plunk button — eight-plus distinct controls in one flex row already.
3. **Per-slot row clarity + consistency.** Once shown a two-row toolbar mockup, direct
   follow-up: move delete and lock together on the left, then mute/solo/favourite, then the
   waveform, then the "randomization" controls on the right — as text labels instead of icon
   tooltips — "using a grid for the modal... to make sure things stay in their places." Also
   flagged that most of Discover's own icon-only buttons still use the slow native `title`
   tooltip, not the fast `data-tooltip` mechanism the rest of the app's icon buttons already
   got in the 2026-09-16 UI consistency pass.

All three are scoped to `DiscoverPanel.tsx` (and its child `DiscoverSlotRow`) plus one small,
precedented addition to `state/store.ts`.

## 2. Add to Timeline / Add to Shelf

### 2.1 Rename

"Plunk in Arranger" → **"Add to Timeline"**, everywhere it's user-facing: the button label
("plunk in arranger" → "add to timeline", "placing…" → "adding…"), and the function itself
(`plunkInArranger` → `addToTimeline`). Internal state (`placing`/`justPlunked`) gets renamed to
match the new pair of actions (see 2.3) rather than kept as "plunk"-flavored names that would
now describe the wrong action half the time.

### 2.2 New "Add to Shelf" button

Same underlying build: resolve every placeable slot's stem, assemble a `Rifff` via
`assembleDiscoverRifff` (unchanged), but dispatch `ADD_TO_SHELF` instead of
`PLACE_LOOP_ON_TIMELINE` — no `startBar`/channel placement, so nothing lands on the arranger.

**Shared logic extraction:** `addToTimeline`'s current body (lines ~1323-1373 today) already
splits cleanly into "resolve+assemble" (identical for both new actions) and "dispatch+cleanup"
(different for each). Extract the resolve+assemble half into a shared helper:

```ts
async function resolveDiscoverRifff(): Promise<{ rifff: Rifff; vol: Record<string, number> } | null> {
  const placeable = slots.filter((s) => s.candidate !== null || s.seedStem !== undefined)
  if (placeable.length === 0) return null

  const resolved = await Promise.all(
    placeable.map(
      async ({ candidate, seedStem, gain }): Promise<{ stem: ResolvedCandidateStem; gain: number } | null> => {
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
  return assembleDiscoverRifff(`discover: ${roles.join('+')}`, placed.map(({ stem, gain }) => ({ stem, gain })), bpm)
}
```

`addToTimeline` keeps everything after `const { rifff, vol } = assembly` exactly as today
(startBar math, `PLACE_LOOP_ON_TIMELINE` dispatch, `releaseEngine()`/ref resets — none of that
engine-sync-ownership logic changes).

`addToShelf` is new and much shorter:

```ts
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

`addToTimeline` gains the same `resolveDiscoverRifff()` call at its top, replacing its current
inline resolve block, and the same `stopPreviewIfPlaying()` call alongside its existing
`setJustAddedToTimeline(true)`.

**Store change (`state/store.ts`):** `ADD_TO_SHELF`'s action type gains an optional `vol` field,
same shape/merge semantics as `PLACE_LOOP_ON_TIMELINE`'s own `vol` field (never overwrites an
existing `state.vol` entry — same rule already governing every path into this reducer case):

```ts
| {
    type: 'ADD_TO_SHELF'
    rifff: Rifff
    /** Each stem's own committed gain (DiscoverPanel's own per-slot volume
     * slider), keyed by stemKey(groupId, slot) -- optional and merged into
     * state.vol the same way PLACE_LOOP_ON_TIMELINE's own vol field is.
     * When a key is present here, it wins over this case's own sqrtGain
     * loudness-compensation default below -- Discover's own per-slot gains
     * are real, user-adjusted values already; silently re-compensating them
     * a second time is exactly the "secret hidden" volume behavior that was
     * reverted from Discover earlier (see docs/superpowers/specs -- Discover
     * seed-stems design). Every existing caller (Inspector's re-import flow)
     * omits this field and keeps today's sqrtGain-default behavior exactly
     * unchanged. */
    vol?: Record<string, number>
  }
```

Reducer case (`store.ts:564-582`) changes its per-stem loop to prefer `action.vol[key]` over
the computed `gain` when present:

```ts
case 'ADD_TO_SHELF': {
  const gain = sqrtGain(action.rifff.stems.length)
  const vol = { ...state.vol }
  for (const stem of action.rifff.stems) {
    const key = stemKey(action.rifff.groupId, stem.slot)
    if (vol[key] === undefined) vol[key] = action.vol?.[key] ?? gain
  }
  return {
    ...state,
    rifffs: { ...state.rifffs, [action.rifff.groupId]: action.rifff },
    vol
  }
}
```

Every existing dispatcher of `ADD_TO_SHELF` (grep before implementing to confirm the full
list — at minimum the Inspector's re-import-from-folder flow) omits `vol` and is therefore
unaffected: `action.vol?.[key]` is `undefined`, falling through to the exact same `gain`
default as today.

### 2.3 Confirmation feedback (both buttons)

Per direct feedback ("let's just do the toast for now, not the fly thing") and the visual
mockup choice ("c" — the button's own label becomes the confirmation, no separate toast
element):

- **Stop the loop.** A small shared helper:
  ```ts
  function stopPreviewIfPlaying(): void {
    if (playing) dispatch({ type: 'PAUSE' })
  }
  ```
  Called only once an action has actually succeeded (after the real dispatch, not before) —
  so a click that resolves to nothing placeable (`resolveDiscoverRifff()` returns `null`)
  doesn't interrupt playback for no reason.
- **Button label swap.** Each button gets its own `justAdded*` boolean, mirroring today's
  `justPlunked` 500ms-timeout convention exactly:
  - `addToTimeline`: `justAddedToTimeline` → label reads `"✓ added"` for 500ms, then reverts to
    `"add to timeline"`.
  - `addToShelf`: `justAddedToShelf` → label reads `"✓ added"` for 500ms, then reverts to
    `"add to shelf"`.
- **Keep the existing pulse**, renamed `discover-add-pulse` (was `discover-plunk-pulse`,
  identical box-shadow keyframes), applied to whichever button just fired — it was never the
  actual complaint (the complaint was that the pulse ALONE wasn't legible), so it stays as a
  supplementary accent under the new, primary label-swap confirmation.
- **No separate toast element, no fly animation** — both were explicitly proposed and dropped
  in favor of this cheaper, more direct mechanism.
- **In-flight guarding.** Each button gets its own busy boolean (`addingToTimeline`/
  `addingToShelf`, replacing today's single `placing`), same double-click-guard rationale as
  today's `placing` — each button disables itself and shows `"adding…"` while its own async
  resolve is in flight; the two are independent (clicking one doesn't disable the other).

## 3. Toolbar: two rows

The single row at `DiscoverPanel.tsx:1485-1742` splits into two:

**Row 1 — filters/settings** (unchanged controls, just now alone on their own row): tight/loose
chaos slider, tempo stepper + value + "match seed" button, "only my stems" checkbox, "prefer
favourites" checkbox.

**Row 2 — actions**: undo, redo, play/stop, reroll-all on the left (unchanged styling/order);
`marginLeft: 'auto'` moves from today's undo button to a filler before the two new action
buttons, so undo/redo/play/reroll-all stay left-grouped and "add to shelf" + "add to timeline"
push right:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
  {/* tight/loose slider, tempo controls, both checkboxes -- unchanged */}
</div>
<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
  <button /* undo, unchanged except marginLeft removed */ />
  <button /* redo, unchanged */ />
  <button /* play/stop, unchanged */ />
  <button /* reroll-all, unchanged */ />
  <span style={{ marginLeft: 'auto' }} />
  <button /* add to shelf -- secondary style */ />
  <button /* add to timeline -- primary style, was "plunk in arranger" */ />
</div>
```

"Add to shelf" uses a quieter/secondary treatment (plain border, `--ra-text` color, no fill) —
"add to timeline" keeps today's plunk button's existing primary treatment
(`--ra-stretch-on`/`--ra-stretch-on-bg`) unchanged, just relabeled. This matches the approved
mockup (`toolbar-and-slotrow.html`, toolbar section).

## 4. Per-slot row: CSS Grid rework

`DiscoverSlotRow`'s current row (`DiscoverPanel.tsx:2340-2862`) is a flexbox with several
hand-pinned fixed-width spacer elements (`width: 64` role span, `width: 110` name span,
`width: 102` button-group placeholder) whose entire purpose is keeping columns aligned row to
row despite variable-length content (preset names, role labels). A CSS grid with explicit
column tracks replaces that pattern directly — every column gets a real track instead of a
manually-matched sibling width, so "things stay in their places" (direct request) by
construction rather than by convention.

### 4.1 New grouping (left to right)

1. **delete** (today's "X" remove button, unchanged behavior/style)
2. **lock** (today's `LockGlyph` button, unchanged)
3. — gap —
4. **mute** ("m", today's mute button, unchanged — moved from the right-side cluster)
5. **solo** ("s", today's solo button, unchanged — moved from the right-side cluster)
6. **favourite** (star icon, today's favourite button, unchanged — moved from the right-side
   cluster)
7. — gap —
8. **waveform** (today's big draggable waveform button / resolving-placeholder box, unchanged
   internals — grid column is `1fr`, the only flexible track, so this is still the element that
   grows/shrinks with available row width)
9. **preset name** (today's fixed-width ellipsis span, unchanged)
10. — gap —
11. **similar** (was: icon-only reroll/"shuffle" button — `ShuffleIcon` — now plain text)
12. **adjacent** (was: icon-only "explore nearby" button — `NearbyIcon` — now plain text; moved
    out of the mute/solo/favourite cluster into this right-hand group)
13. **random** (was: icon-only reroll-random/"dice" button — `DiceIcon` — now plain text)

Role label (today's `slot.role` span, `width: 64`) isn't part of the approved mockup's visible
columns — keep it, placed immediately after the lock button (before the mute/solo/favourite
gap), matching its current "identifies this row" position relative to the row's start.

### 4.2 Grid definition

```tsx
<div
  style={{
    display: 'grid',
    gridTemplateColumns:
      '18px 18px 64px 14px 18px 18px 18px 14px 1fr 110px 14px auto auto auto',
    alignItems: 'center',
    columnGap: 8,
    padding: '8px 0',
    borderBottom: '1px solid var(--ra-border-soft)'
  }}
>
```

(14px gap columns render an empty spacer `<div>`, or a 1px `--ra-border-soft` divider matching
the toolbar's own existing `<span style={{ width: 1, alignSelf: 'stretch', ... }} />` divider
convention — implementer's call, matching whichever reads cleaner once actually placed.)

The `nearbyMenu`/`DiscoverNearbyPopover` popover positioning (currently anchored off the nearby
button's own `getBoundingClientRect()`) is unaffected by this — the popover already positions
itself relative to whichever element triggers it, and the "adjacent" text button becomes that
trigger in its new position with no other change needed.

### 4.3 Randomization button relabeling

All three become plain text buttons (no icon, matching the toolbar's existing plain-text
button convention like "match seed (120)"), and **no longer need a tooltip at all** — the label
itself is now the explanation. `onReroll`'s existing empty-slot-vs-filled-slot distinction
("roll" vs. "reroll" in today's tooltip) collapses to one constant label, **"similar,"** in both
states — "similar" already reads correctly as the very first action on an empty slot (find a
stem similar to what this role needs), not only as a follow-up reroll.

| New label | Was | Behavior (unchanged) |
|---|---|---|
| `similar` | icon-only reroll (`ShuffleIcon`), tooltip "roll"/"reroll…" | `onReroll` — new role/embedding-matched candidate |
| `adjacent` | icon-only nearby (`NearbyIcon`), tooltip "explore riffs recorded near this one…" | `onSwapFromNearby` via the existing popover |
| `random` | icon-only dice (`DiceIcon`), tooltip "random — skip role matching…" | `onRerollRandom` — ignores role matching entirely |

`rerolling`'s existing disabled-state handling (dimmed color, `cursor: default`, no motion —
direct follow-up report, 2026-09-16) carries over unchanged to the "similar" button's new text
label; it can additionally render `"similar…"` while `rerolling` is true, mirroring the
toolbar's own reroll-all button's `"rerolling…"` label-swap convention instead of only dimming.

## 5. Tooltip completeness

Direct feedback: *"not all of the buttons have the fast tooltip."* Convert every remaining
icon-only button still on native `title` to the `data-tooltip` mechanism
(`global.css`'s existing `[data-tooltip]` rule, already covering 15 buttons elsewhere in the
app plus this panel's own reroll-all button):

**Toolbar (`DiscoverPanel.tsx`):**
- undo (`title="undo"`, line ~1629)
- redo (`title="redo"`, line ~1649)
- play/stop (`title={playing ? 'stop…' : 'play…'}`, line ~1677)

**Per-slot row (`DiscoverSlotRow`):**
- lock (line ~2351)
- waveform button's own hover hint (line ~2385 — the "click to add to loop / drag to adjust
  volume" text)
- resolving/failed placeholder box (line ~2543 — not a button, but the same slow-native-title
  complaint applies to its hover hint; `[data-tooltip]` works identically on a plain `div`)
- mute (line ~2669)
- solo (line ~2709)
- favourite (line ~2737)
- delete/remove (line ~2841)

**Explicitly out of scope** (not icon-only, matching the original UI-consistency-pass's own
scoping rule — "aria-label"/native title stays where a visible text label already explains the
control): the "match seed (120)" button (line ~1563, has its own visible text), the "only my
stems" checkbox's disabled-reason tooltip (line ~1592), and the "prefer favourites" checkbox's
descriptive tooltip (line ~1613) — both checkboxes, not buttons, and neither was part of the
2026-09-16 pass's own icon-button scope either.

`similar`/`adjacent`/`random` need no tooltip at all post-rename (§4.3) — their old `title`
attributes are removed outright, not converted.

## 6. Testing

Same convention as the 2026-09-16 UI consistency pass and this codebase's own established rule
for React components (CLAUDE.md): `npm run typecheck` + `npx eslint --cache <touched files>`
per task, no new test files for the CSS/JSX styling work (toolbar split, slot-row grid,
tooltip conversions, relabeling).

**Exception:** the `ADD_TO_SHELF` reducer change (§2.2) IS real branching logic and already has
dedicated coverage — `src/renderer/src/state/store.test.ts:39-46` tests today's sqrtGain-only
behavior (`makeRifff()` has 2 stems, asserting `state.vol[...] === sqrtGain(2)`). Add ONE new
test alongside those confirming: when `action.vol` supplies a value for a stem's key, that
value is used verbatim instead of the computed `sqrtGain` default, and a second stem with no
matching `action.vol` entry still falls back to `sqrtGain` in the same dispatch — i.e. the two
code paths coexist correctly within one call, not just in isolation. Follow this codebase's
TDD convention (write the failing test first, watch it fail, then make the reducer change from
§2.2, watch it pass) rather than writing the test after the fact. Final manual-walkthrough checklist
for Elling (this environment cannot click through the real app):

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

# Collapsed/Expanded Rifff View — Design

**Goal:** Bring back the collapsed rifff view (removed earlier this session when per-stem
controls moved onto the arranger), as a per-rifff toggle alongside today's always-expanded
view — and resolve the drag-vs-volume ambiguity on the expanded waveform that prompted the
request in the first place.

**Context:** The pre-session arranger showed each rifff as one combined-waveform block,
collapsible/expandable via a chevron (`state.exp[groupId]`, a `TOGGLE_EXPAND` action, and a
`StemSubRow` component for the expanded per-stem rows). This was deliberately removed
("arranger controls: RifffBlockRow always renders StemWaveformRow, drop combined waveform +
expand toggle") when mute/volume/fade/resize controls moved onto always-visible per-stem rows
— at the time, a separate collapsed summary felt redundant. `state.exp` was kept in `AppState`
only for save-file compatibility; `TOGGLE_EXPAND` itself was deleted.

Live-testing surfaced two connected gaps: (1) the collapsed view is missed as a compact
overview, and (2) repositioning a clip is now only reachable via a small 212px name header —
the per-stem waveform's open body is fully claimed by volume/fade/resize, so "grab the clip
from anywhere" (the pre-session behavior) doesn't work in the expanded view either. Both are
addressed here together.

---

## 1. Collapsed/expanded toggle

Revives the existing (currently unused) `state.exp: Record<string, boolean>` field — no new
`AppState` field needed. A `TOGGLE_EXPAND` action is re-added to `store.ts`'s reducer
(`{ ...state, exp: { ...state.exp, [groupId]: !state.exp[groupId] } }`), and `RifffBlockRow`
renders a chevron button in its header (same spot the old one occupied) dispatching it.
Collapsed is the default appearance for a rifff that has no `exp` entry yet (`!state.exp[groupId]`
reads as collapsed) — this matches "the new default look" without needing a migration or a
different default value, since an absent key and an explicit `false` already mean the same
thing here.

`RifffBlockRow` branches on `state.exp[groupId]`:
- **Falsy (collapsed):** renders the new collapsed summary block (§2) instead of the
  `rifff.stems.map(...) => StemWaveformRow` list.
- **Truthy (expanded):** renders exactly what it renders today — the header, followed by one
  `StemWaveformRow` per stem, unchanged.

## 2. Collapsed view

A single block, replacing the current per-stem row stack entirely while collapsed (not layered
underneath it):

- **Header row** (name, `PolarGlyph`, stem/bar/bpm count) — same content and position as
  today's always-visible 212px header, unchanged.
- **One combined waveform**, tiled the same way `StemWaveformRow` already tiles (repeating at
  the rifff's own `barLength`, not stretched) — rendered from the first stem's `path` for
  visual identity, matching how the pre-session collapsed view and today's `PolarGlyph` both
  already use `rifff.stems[0]` as the representative stem.
- **Fade-edge gradient hint**: a subtle `linear-gradient` overlay at each edge sized to
  `fadeIn`/`fadeOut` in bars (restoring the pre-session look) — read-only in this view, matching
  that the fades themselves are only editable expanded.
- **Mini mute-dot row**: one small dot per stem (same filled/hollow convention as the expanded
  mute button), positioned in a corner of the waveform, each independently clickable —
  dispatches the existing `TOGGLE_MUTE` action per stem, no new state.
- **No volume, fade, or resize controls** — expand to reach those. There's no room for precise
  drag targets on a compact block, and this keeps the collapsed view's own hit-testing simple
  (see §3 — it needs to be draggable from anywhere, which a dense control layout would fight).

**Dragging:** the entire block (outside the small mute dots) is one draggable surface, moving
the clip exactly like `RifffBlockRow`'s header does today — same grab-offset-preserving
mechanism (`dragGrabOffset.ts`, added this session), same linked/unlinked branching as §3 below.

## 3. Expanded view — resolving "grab anywhere"

Today, `StemWaveformRow`'s waveform body has three always-active drag targets (resize handles at
each edge, fade-knee dots) and one broad one (the volume-plateau strip, which — with no fades
set — spans nearly the full width). The broad one is why dragging the open waveform currently
does nothing for repositioning: there's no drag-the-clip behavior registered there at all, only
volume.

**Default behavior:** the waveform body (everywhere except the resize handles and fade dots,
which are unaffected by anything in this section) becomes draggable, moving the clip:
- **Linked:** moves the whole rifff — same as dragging `RifffBlockRow`'s header today
  (`'text/rifff-group-id'`, `PLACE_ON_TIMELINE`).
- **Unlinked:** moves just that stem — same as dragging `StemWaveformRow`'s own left label
  column today (`'text/rifff-stem-key'`, `SET_STEM_START`).

This isn't a new interaction, just the *existing* two behaviors (already implemented, already
grab-offset-correct) exposed on a wider hit target, branching on the same `unlinked` flag that
already governs which one applies. The label column and `RifffBlockRow`'s own header keep
working exactly as they do today — this adds a third, larger surface, it doesn't replace either
existing one.

**Volume mode:** a new global toggle — press **V** to switch into "volume mode," where that same
waveform-body drag adjusts volume instead (today's only behavior there); press **V** again to
switch back to the default (move-the-clip) behavior. Follows this app's existing keyboard-shortcut
pattern (see the Space/Delete/undo handlers in `App.tsx`'s `Frame` component): skipped while
focus is in a text input, otherwise toggles a piece of state.

- **New `AppState` field:** `volumeDragMode: boolean` (default `false`).
- **New action:** `TOGGLE_VOLUME_DRAG_MODE`, reducer: `{ ...state, volumeDragMode: !state.volumeDragMode }`.
- **Transient, not undo-tracked:** added to `history.ts`'s `TRANSIENT_ACTION_TYPES` alongside
  `PLAY`/`PAUSE`/`STOP` — this is an interaction-mode switch, not an arrangement edit, and
  undoing shouldn't flip it back and forth interleaved with real content changes.
- **Persistent indicator:** a toggle button in `TransportBar` (same visual treatment as the
  existing snap-cycle button) reading "volume drag: on/off", so the mode is never only inferred
  from a cursor. The waveform body's own cursor also changes (`grab` when off, matching the
  label column's cursor; `ns-resize` when on, matching the volume strip's current cursor) as a
  secondary, in-place hint.

**Nothing else changes.** Resize handles, fade-knee dots, and mute are unaffected by
`volumeDragMode` — they're already small, dedicated, precise targets, not the thing that was
reported as broken.

---

## Testing

- `TOGGLE_EXPAND` and `TOGGLE_VOLUME_DRAG_MODE` reducer cases: unit tests in `store.test.ts`
  matching this file's existing per-action `describe` blocks (toggle on, toggle off, default
  value when unset).
- Collapsed-view rendering and the mute-dot row: exercised manually (this codebase doesn't unit
  test component rendering, per its existing test suite's shape — `store.test.ts` and
  `selectors.test.ts` cover state/logic, not JSX).
- The linked/unlinked drag branching on the waveform body reuses `dragGrabOffset.ts`'s already-
  tested pure functions (`computeGrabOffsetBars`/`applyGrabOffset`) — no new arithmetic to test,
  just new call sites.
- Manual verification (this session's established pattern for arranger interaction changes):
  collapse a rifff, drag it from the middle of its waveform, confirm it moves correctly and the
  mute dots still toggle; expand it, confirm resize/fade/mute all still work unchanged; toggle
  volume-drag mode on, confirm dragging the waveform now adjusts volume instead of moving the
  clip, and off again reverts; confirm the mode indicator and cursor both reflect the current
  state at every step.

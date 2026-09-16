# Discover Temporal Adjacency Exploration — Design

**Goal:** From any resolved Discover slot, browse the riffs recorded just
before/after that slot's own riff in the same jam's own iteration
sequence, and swap in whichever one's own role-matching stem fits best —
surfacing Elling's own observation that stems recorded close together in
a jam often turn out to be musically related.

**Architecture:** A new per-slot popover, opened from a new button on
`DiscoverSlotRow`. It's a thin UI layer over existing, already-proven
riff-library machinery (`resolveRiffWithContext`, `listRiffs`,
`resolveRiff`/`downloadMissingStems`) — no new query surface, no new
caching layer.

**Tech Stack:** No new dependencies. Reuses the same role-inference chain
(`instrumentMaskToSoundType` → `guessSoundTypeFromPresetName` →
`SOUND_TYPE_TO_ARRANGE_ROLE`) already used for Browse-sourced Discover
seeding.

---

## Background

Endlesss riffs within one jam are successive iterations recorded over a
session — Elling's own framing: "each rifff is just an iteration along a
timeline." His intuition is that a riff's neighbors in that sequence
often carry compatible material for the same instrument role. Today
there's no way to explore that relationship from Discover — a slot's
candidate is either a fresh library-wide roll or (as of the just-shipped
seed-stems feature) a whole riff's own stems dropped in at once. This
adds a third path: from one already-resolved slot, look sideways along
its own riff's timeline.

Scope, per Elling's own answer when asked whether this should be a
browsing UI, an automatic ranking bias during normal rolls, or both:
**browsing first.** The automatic version is real future work — the
existing `discoverRanking.ts` soft-boost pattern (`favouriteStemCIDs`/
`FAVOURITE_BOOST`) is the likely shape for it — but explicitly deferred,
not part of this pass.

## Behavior, confirmed

- **Trigger**: a new small icon button on each *resolved* `DiscoverSlotRow`
  (next to reroll/random), matching this session's own established
  per-slot-action pattern. Not shown on a slot with no `candidate` — a
  slot seeded directly from a Shelf riff (`seedStem`, no `riffCID`) has no
  anchor to explore from, same reasoning the seed-stems feature already
  established for gating other candidate-only affordances.
- **Scope of what's shown**: only the current slot's own `arrangeRole`.
  A nearby riff with no stem in that role is skipped entirely — never
  shown empty. If a jam has no nearby riff at all with a matching-role
  stem in either direction, the popover says so plainly instead of
  showing nothing.
- **Direction**: nearby riffs are split into two sections, "earlier" and
  "later," relative to the current center riff — never one flat list —
  matching Elling's own "iteration along a timeline" mental model. Each
  section shows a fixed default of 4 riffs.
- **Picking one recenters the chain**: clicking any candidate swaps it
  into the slot immediately — same instant, undoable behavior as a
  normal reroll (an undo snapshot is pushed the same way `rollForSlot`
  already does) — and both sections immediately recompute around it as
  the new center. There's no separate "browsing position" distinct from
  the slot's own current candidate: the popover always shows what's
  earlier/later than whatever the slot holds right now. This is
  deliberately the whole feature's richness — clicking outward
  repeatedly chains you further along the jam's own timeline, each step
  a real, reversible action, with no fixed limit besides the jam's own
  data. Direct request, 2026-09-16: "i think i'd like a re-centering
  approach... ideally making for a richer / endlesss clickable feature."
- **Step shortcuts**: a small `<`/`>` button on each section is a
  shortcut equivalent to clicking that section's own nearest candidate —
  swap-and-recenter without having to visually pick a row, for quickly
  stepping through several in a row.
- **Back to start**: the riff the slot held when the popover was first
  opened is remembered for the popover's own lifetime. A small "back to
  start" control jumps straight back to it (itself just another
  swap-and-recenter, onto the remembered riffCID) — without it, a few
  clicks of chaining outward would leave no way back to where you began.
- **Dismissal**: click-outside or Escape closes the popover. It stays
  positioned within the viewport (Discover already runs full-screen, so
  this is a plain anchored-positioning detail, not a new architectural
  concern).

## Backend

No new query surface. The whole lookup is existing `riffLibraryStore.ts`
functions plumbed together, and — since picking a candidate recenters
the chain — it re-runs from scratch against a new `centerRiffCID` every
time the slot's own candidate changes, not just once when the popover
opens:

1. **Locate the center's position**: `resolveRiffWithContext(centerRiffCID)`
   already resolves a riff's own `jamCID` and its rank (offset) in that
   jam's `CreationTime DESC` ordering — built for the existing "jump to a
   pasted riff ID" feature, and exactly the "where does this riff sit in
   its own iteration sequence" fact adjacency needs. If it returns `null`
   (unknown riff, warehouse unavailable), the popover shows its empty
   state. `centerRiffCID` starts as the slot's own candidate when the
   popover opens, and becomes whatever riff was last swapped in after
   that (see Behavior's "picking one recenters the chain," above); "back
   to start" just re-runs this same lookup against the riffCID captured
   at the moment the popover first opened.
2. **Fetch a window around it**: `listRiffs(jamCID, { offset, limit })`
   — already paginates a jam's riffs in iteration order off the existing
   `idx_riffs_owner_created` index. A window sized to comfortably cover 4
   riffs in each direction, centered on the center's own rank (clamped to
   0 the same way `resolveRiffWithContext`'s existing caller already
   does), splits into "newer than center" (earlier list, since the
   ordering is `DESC`) and "older than center" (later list) by comparing
   each row's own `CreationTime`/`RiffCID` against the center's.
3. **Resolve and role-match each nearby riff**: for each candidate riff
   (working outward from the center, stopping once 4 matches are found
   per direction or the window is exhausted), `resolveRiff(riffCID)` —
   the same function Browse's own riff-detail view already calls —
   returns real stems with `presetName`/`instrumentMask`. Each stem is
   checked against the slot's own `arrangeRole` using the existing chain:
   `instrumentMaskToSoundType(stem.instrumentMask) ??
   guessSoundTypeFromPresetName(stem.presetName)`, mapped through
   `SOUND_TYPE_TO_ARRANGE_ROLE`. The first matching stem in a riff is
   used; a riff with none is skipped. `downloadMissingStems` is called
   only for a riff that's actually shown (has a role match), not
   speculatively for the whole window — most of the window will be
   discarded before ever needing its audio.
4. **Resolve concurrency**: candidates resolve progressively rather than
   all at once — a naive implementation could kick off up to 8
   simultaneous downloads the moment the popover opens. Resolve a small
   number in parallel (matching `downloadMissingStems`'s own existing
   per-riff `Promise.all` scope, one riff's ≤8 stems at a time) and queue
   the rest, each popping in as it finishes.

This is exposed as one new IPC handler taking `{ centerRiffCID, role }`
(mirroring the existing `resolve-riff`/similar shape already in
`index.ts`) — exact name and shared-type surface is a plan-level
decision, grounded in the real current `ipcMain.handle` list at plan
time. Because every swap-and-recenter click re-invokes it with a new
`centerRiffCID`, the renderer side should treat it exactly like a normal
per-slot resolve (already-established loading-state handling), not
introduce a second one.

## UI

**Button**: a new icon in `DiscoverSlotRow`'s own action row, next to
reroll/random. This is also the moment to shrink the row's icon family —
already 7 buttons (lock/mute/solo/favourite/reroll/random/remove) before
this addition — from 22×22 to **18×18**, an established smaller size
already used elsewhere in this same file (the tempo stepper buttons),
rather than letting the row keep growing.

**Popover**: anchored to the triggering slot's row. A small header shows
the current center riff (enough to orient — creator/preset context, same
fields already surfaced elsewhere for a riff) plus the "back to start"
control (disabled/hidden once the center IS the start riff again). Below
that, two sections ("earlier" / "later"), each listing up to 4
candidates with a `<`/`>` step button of its own. Each candidate row
shows: a fixed-size waveform thumbnail, the stem's own preset name, and
(while resolving) the same `LoadingLoader` placeholder used everywhere
else in Discover for a per-item resolving state. Clicking a candidate
row, or its section's step button for the nearest one, swaps it into
the slot and re-renders both sections around it (see Behavior above) —
the whole popover stays open and mounted through this, only its content
refreshes. **Every candidate row's preview box is a fixed CSS size** — this is a deliberate
departure from `DiscoverSlotRow`'s own main waveform, which was
intentionally reworked earlier this session to tile *proportionally* to
each stem's real bar length (so a comparison of "how long is this loop"
is visible at a glance in the arrangement). That's the wrong shape for a
short browsing list: a fixed box, identical for every candidate
regardless of its real length or its current loading/loaded state, keeps
the list from visibly jumping around as entries resolve at different
times. The loading placeholder occupies the exact same box a loaded
waveform will — no resize on the load transition.

## Non-Goals (explicitly deferred)

- The automatic ranking-bias version (queued as a natural, smaller
  follow-up once this browsing UI ships and its data plumbing exists —
  Elling's own "both, but browsing first" answer).
- Any change to `LibraryBrowser.tsx`'s own Browse tab — this is entirely
  a per-slot action inside Discover.
- A configurable count of how many nearby riffs to show — fixed at 4 per
  direction for this pass; can become a setting later if wanted.

## Testing

- The role-matching/windowing logic (splitting a `listRiffs` window into
  earlier/later relative to a center rank, walking outward until 4
  matches or the window is exhausted) is pure enough to unit test given a
  fake window of rows — real tests, not description.
- The new IPC handler itself (touches `riffLibraryStore.ts`'s real
  SQLite-backed functions) follows this codebase's existing convention
  for Electron-dependent code: no wholesale mocking, real functions
  exercised directly.
- The popover component and the `DiscoverSlotRow` button are
  typecheck+lint verified only, per this codebase's established
  convention for React component logic.
- Manual walkthrough required before calling this done: open the popover
  on a resolved slot with real nearby riffs (earlier/later sections
  populate, fixed-size boxes, no layout jump as entries resolve); a slot
  whose riff is at the very start/end of a jam (one side's section shows
  its own empty state, not an error); a slot with no nearby role match at
  all (both sections show the empty state); picking a candidate (swaps
  in immediately, both sections recompute around it, undo reverts it);
  chaining several clicks in the same direction (each one recenters
  correctly, keeps finding new matches further out); using a step button
  as a shortcut (identical result to clicking that section's nearest
  candidate); "back to start" after chaining a few steps away (returns
  exactly to the riff the slot held when the popover opened); a seeded
  slot with no `candidate` (the button doesn't render at all).

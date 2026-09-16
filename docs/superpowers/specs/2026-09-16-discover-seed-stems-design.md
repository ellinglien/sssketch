# Discover Seed Stems — Design

**Goal:** Let Discover start from an existing, already-coherent riff instead
of only from scratch — pick a riff from Browse or the Shelf, and its own
stems become Discover's starting slots, fully tinkerable from there exactly
like any other Discover loop.

**Architecture:** One new function, `seedDiscoverFromMembers`, replaces
Discover's current `slots` wholesale with one slot per stem in the chosen
riff (mirroring `assembleDiscoverRifff`'s own "one stem per slot" shape,
just in the opposite direction). Two different data paths feed it,
depending on where the riff came from — Shelf riffs are already fully
resolved local data; Browse riffs still need the same per-stem
download/resolve step a normal roll already uses.

**Tech Stack:** No new dependencies. Reuses `DiscoverCandidate`,
`resolveCandidateStem`, `ArrangeRole`/soundType-guessing helpers, and the
existing discard-guard pattern this app already uses elsewhere for
"about to destroy unsaved work."

---

## Background

Today, every Discover slot starts empty and gets its own independently
rolled candidate. Elling wants a second way in: pick a whole existing riff
(from Browse's own library search, or from the Shelf — riffs already
staged for the current project) and have Discover start pre-loaded with
that riff's own stems, one per slot, still fully reroll/lock/mute-able
individually afterward.

Two riff sources, brainstormed and confirmed:

- **Browse** (`LibraryBrowser.tsx`'s 'browse' tab) — riffs found via the
  riff-library search. A riff here is an *unresolved* reference (a set of
  `DiscoverCandidate`-shaped stem rows out of the riff-library db) — not
  yet downloaded to disk.
- **Shelf** (`Shelf.tsx`, always visible in the main arrangement view,
  outside any modal) — riffs already staged for the current project. A
  riff here is a real, already-resolved `Rifff` (`state.rifffs[groupId]`)
  with real local `Stem` objects (`path`/`durationSec`/`barLength` already
  known, no network involved).

**A live drag from Shelf onto Discover is not possible today, and this
design doesn't change that.** Discover only exists inside `LibraryBrowser`'s
own full-screen modal (`position:fixed;inset:0;zIndex:1000`), which covers
the whole screen including Shelf — confirmed during this session's own
earlier engine-ownership work, where that same full-screen exclusivity is
exactly what makes cross-panel engine collisions structurally unreachable.
Making Discover a non-occluding panel (so Shelf stays visible alongside it)
would undo that assumption and was explicitly ruled out. Instead, seeding
is triggered by an explicit action on the riff itself — a button/context-
menu item on a Shelf tile, and the equivalent on a Browse row — that opens
Discover already seeded, no drag or simultaneous visibility required.

## Behavior, confirmed

- **Replaces Discover's current slots entirely**, not additive. If
  Discover already has real content (any slot with a candidate), show the
  same kind of discard-guard confirmation this app already uses elsewhere
  before destroying unsaved work, before replacing.
- **Seeded slots start unlocked** — immediately behave like any other
  Discover slot (individually rerollable, and reroll-all-able as a whole
  if the user chooses that). No special protection.
- **Tempo follows the seed only when the arranger is empty — applied
  once Discover's own preview has actually loaded, not at seed time.**
  Seeded stems otherwise stretch to Discover's own *current* target BPM,
  same as any other resolved candidate. A same-day 2026-09-16 revision
  tried auto-snapping tempo at SEED time (in LibraryBrowser.tsx, right
  when `discoverSlots` is set) — but `state.bpm` is one of
  StoreContext.tsx's `scheduleEngineSync`'s own listed dependencies, and
  DiscoverPanel's engine-ownership claim doesn't happen until its first
  slot actually resolves (async, seconds away for a Browse-sourced seed).
  Dispatching `SET_TEMPO` in that window reliably raced the automatic
  real-project sync into loading (and playing) the real project right as
  Discover's own preview was also loading — live-reported as duplicate/
  background playback, and root-caused to a SEPARATE, real bug at the
  same time (Browse's own leftover Web Audio preview never being stopped
  on seed — see LibraryBrowser.tsx's own `stopPreview()` fix). With that
  fixed, the tempo-follow itself was reinstated, this time race-free:
  `DiscoverPanel.tsx`'s `syncPreviewToEngine` applies it inside its own
  empty-to-non-empty transition, which only runs once engine ownership is
  ALREADY confirmed held by Discover — so `scheduleEngineSync`'s own
  ownership gate correctly skips the real-project sync when this bpm
  change lands. `discoverSeedBpm` (lifted up in LibraryBrowser.tsx) drives
  both this and DiscoverPanel's own "match seed" button, which stays as a
  manual fallback whenever the current tempo has since drifted away from
  the seed (e.g. after individually rerolling a slot).

## Component changes

**`DiscoverSlot` (in `DiscoverPanel.tsx`) needs a new way to start
pre-resolved.** Today a slot's only path to a real stem is
`candidate: DiscoverCandidate | null`, resolved lazily inside
`DiscoverSlotRow`'s own effect via `resolveCandidateStem`. That fits
Browse-sourced seeding fine (a `DiscoverCandidate` already carries
`arrangeRole` directly, so no role-guessing needed there). It does **not**
fit Shelf-sourced seeding: a real, already-placed `Stem` object carries no
`riffCID`/`stemCID`/`arrangeRole` at all (confirmed by reading
`src/shared/types.ts`'s own `Stem` interface) — there is nothing to
resolve, and nothing to look a role up from except the stem's own
`type`/`name`. `DiscoverSlot` needs a new optional field (something like
`seedStem?: ResolvedCandidateStem`) that `DiscoverSlotRow`'s own resolve
effect checks first — if present, treat the slot as already resolved
(skip `resolveCandidateStem` entirely) instead of waiting on `candidate`.
Exact shape is a plan-level decision; the constraint that matters is: a
slot must be able to start "already resolved," not just "has an unresolved
candidate to go fetch."

**Role inference, two different paths:**
- Browse-sourced stems already carry `arrangeRole` on their own
  `DiscoverCandidate` — no inference needed.
- Shelf-sourced stems carry no role at all — needs guessing from the
  stem's own `type`/`name`, the same general shape of heuristic
  `guessSoundTypeFromPresetName`/`instrumentMaskToSoundType` already use
  elsewhere in this file, adapted to produce an `ArrangeRole` instead of a
  `SoundType` (these are different enums — confirm at plan time whether an
  existing mapping between them already exists, or a new small mapping
  table is needed).

**New shared function**, likely alongside `discoverRifffAssembly.ts`:
`seedDiscoverFromMembers(members: {stem: ResolvedCandidateStem; role:
ArrangeRole}[] | {candidates: DiscoverCandidate[]})` (exact signature is a
plan-level decision) — builds the replacement `DiscoverSlot[]` array,
capped at the same `MAX_STEMS_PER_RIFFF = 8` `assembleDiscoverRifff`
already enforces (a riff can have at most 8 stems anyway, per
`Riffs.StemCID_1..8`, so this is really just matching an existing
invariant, not introducing a new limit).

**UI**: a new action on Shelf tiles (`Shelf.tsx`) and Browse rows
(`LibraryBrowser.tsx`'s 'browse' tab) — "seed Discover with this riff" —
that calls the discard-guard check, then the seed function, then switches
`libraryMode` to `'discover'` (opening the panel already populated).

## Non-Goals (explicitly deferred, discussed and ruled out of this pass)

- A new "top stems" ranked/most-used panel — Elling's own initial framing
  ("the top library"), clarified mid-brainstorm as a loose, uncommitted
  idea ("just a thought! it might not make sense to do it that way") — not
  designed or built here. May come back as its own idea later.
- Live drag-and-drop from Shelf directly onto Discover — blocked by the
  full-screen-modal architecture (see Background above), not attempted.
- Temporal adjacency exploration — the other idea from this same
  conversation, intentionally sequenced after this one, not touched here.

## Testing

- The new `seedDiscoverFromMembers` (or equivalent) function is pure
  enough to unit test for its Browse-sourced path (given N
  `DiscoverCandidate`s, produces N slots with the right role/candidate).
  The Shelf-sourced path's role-guessing heuristic should also get real
  unit tests if it's extracted as a standalone function.
- `DiscoverSlotRow`'s new "starts pre-resolved" branch is typecheck+lint
  verified only, per this codebase's established convention for React
  component logic (no dedicated test file).
- Manual walkthrough required before calling this done, same as every
  other Discover feature this session: seed from a Shelf riff (stems
  should appear instantly, no loading state, tempo unchanged from
  Discover's own current setting), seed from a Browse riff (stems should
  show the normal "downloading + analyzing…" resolving state per slot,
  same as a fresh roll), seed while Discover already has content (discard
  guard should appear), reroll one seeded slot afterward (should behave
  exactly like rerolling a normally-rolled slot).

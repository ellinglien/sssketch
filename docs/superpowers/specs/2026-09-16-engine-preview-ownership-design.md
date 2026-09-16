# Cross-Panel Engine Preview Ownership — Design

**Goal:** Prevent Discover's engine-based preview (shipped 2026-09-15) and
Tidy Up/Auto Arrange's engine-based preview (`useStemPreviewPlayback.ts`)
from silently clobbering each other or the real arrangement's own automatic
engine sync, without changing how any of them actually build or play audio.

**Architecture:** One small, pure ownership-tracking module
(`src/shared/engineOwnership.ts`) plus three narrow, additive call-site
changes — no rewrite of any existing preview mechanism.

**Tech Stack:** No new dependencies. Extends the exact generation-guard
pattern this codebase already uses three separate times
(`previewSyncGenerationRef` in DiscoverPanel.tsx, `callGenerationRef` in
useStemPreviewPlayback.ts, and the rAF-coalescing guard in
StoreContext.tsx's own automatic sync effect), just hoisted into one
shared instance instead of three unaware ones.

---

## Background

Discover's own preview (`docs/superpowers/specs/2026-09-15-discover-native-
engine-preview-design.md`) routes through the real native engine by
building a small throwaway `EngineProject` and sending it via
`window.rifffApi.engineLoadProject` — this fully REPLACES whatever project
the engine currently has loaded (`PlaybackEngine::setProject` has no
concept of "two projects loaded at once"). Tidy Up and Auto Arrange's own
preview (`useStemPreviewPlayback.ts`) instead solos real, already-placed
stems within the REAL project (`SOLO_STEMS` + `flushEngineSyncNow` +
play/seek), with a mute/vol snapshot restored on unmount.

Both already route through the real engine, not Web Audio — but neither
knows the other (or the app's own always-on automatic project sync) exists.
Investigated 2026-09-16, grounded in fresh reads of `useStemPreviewPlayback.
ts`, `StoreContext.tsx`'s sync machinery, `DiscoverPanel.tsx`'s current
preview state, and how Discover/Tidy Up/Auto Arrange are actually mounted
in `App.tsx`. Two concrete risks were found (a third, hypothesized risk —
both panels open and actively fighting the engine at once — turned out to
be unreachable through the UI: `LibraryBrowser` (Discover's host),
`ClusterStemsBrowser` (Tidy Up), and `AutoArrangeWizard`/`DrawArrangeWizard`
are all independent `position:fixed;inset:0` full-screen modals with no
code that closes one when another opens, but *because* they're all
full-screen, you can't click the button to open a second one while the
first is up):

1. **Sequential handoff race.** Closing Discover fires an un-awaited
   `restorePreviewIfLoaded()` → `flushEngineSyncNow()` to push the real
   project back. Immediately opening Tidy Up and starting a preview fires
   its own `flushEngineSyncNow()` call. Both are real async IPC round
   trips (rubberband resolution + `engineLoadProject`); whichever resolves
   LAST wins, not whichever was started last — so Tidy Up's solo could get
   silently overwritten back to the full real mix a beat after it starts.

2. **Passive real-state mutation while Discover's preview is loaded.**
   `StoreContext.tsx` has an always-on effect that automatically re-pushes
   the real project to the engine the instant `state.bpm`/`vol`/`mute`/
   `rifffs`/etc. change, for ANY reason — that's how the real arrangement
   always stays in sync. It has zero awareness that Discover might have
   swapped in its own throwaway project. Concretely: an Ableton Link peer
   changing tempo fires a background-poll dispatch into `state.bpm`
   regardless of what's on screen, which would silently overwrite
   Discover's loop with the real project mid-preview.

## The primitive

A pure, framework-agnostic module — `src/shared/engineOwnership.ts`:

```ts
export type EngineOwner = 'discover-preview' | 'stem-solo-preview'

export interface EngineOwnershipTracker {
  /** Claims ownership of what gets sent to the engine. Returns a
   * generation token the caller must hold onto and check via `stillOwn`
   * after any await, before actually applying a send -- if a newer claim
   * (by anyone, including a fresh claim by the SAME owner) has landed
   * since, the token is stale. */
  claim(owner: EngineOwner): number
  /** True iff `token` is still the current generation -- nothing has
   * claimed or released since it was issued. */
  stillOwn(token: number): boolean
  /** Releases ownership back to nobody (the real project's own automatic
   * sync is free to run again). Also bumps the generation, invalidating
   * any of the outgoing owner's own still-in-flight sends too. */
  release(): void
  /** The current owner, or null when nobody has claimed -- read by
   * StoreContext's own automatic sync effect to decide whether to skip a
   * send. */
  readonly current: EngineOwner | null
}

export function createEngineOwnershipTracker(): EngineOwnershipTracker
```

`null` (nobody claimed) is the default and matches today's behavior
exactly: the automatic sync runs freely until something explicitly claims
ownership.

## Wiring

**`StoreContext.tsx`** instantiates one tracker (`useRef(() =>
createEngineOwnershipTracker())`, created once) and:

- Exposes `claim`/`stillOwn`/`release` to the rest of the app through a new
  `EngineOwnershipCtx` + `useEngineOwnership()` hook, mirroring
  `useFlushEngineSyncNow()`'s existing shape/location exactly (same file,
  same provider, same "thin context wrapping an imperative capability"
  convention).
- Its own automatic coalesced sync effect (`scheduleEngineSync`) reads the
  tracker's `current` directly (same closure, no context indirection
  needed for its own internal use) at the TOP of its rAF callback: if not
  `null`, skip entirely (don't even call `buildEngineProject`) and set
  `dirtyEngineSyncRef.current = true` so it retries once ownership frees
  up. This is defensive insurance on top of each owner's own explicit
  release-then-flush (below) -- keeps the effect self-healing even if a
  future owner type doesn't restore on its own release.

**`useStemPreviewPlayback.ts`** (Tidy Up + Auto Arrange):

- `startPreview` calls `claim('stem-solo-preview')` at the same point it
  already claims its own `callGenerationRef`, and checks `stillOwn(token)`
  after the `flushEngineSyncNow` await -- additive to its existing
  `cancelledRef`/`callGenerationRef` checks, not a replacement.
- The unmount cleanup effect calls `release()` alongside its existing
  `RESTORE_MUTE`/`RESTORE_VOL`/`PAUSE` dispatches. This is the detail that
  matters most: that cleanup doesn't itself flush -- it dispatches into the
  reducer and trusts the automatic sync effect to notice and push the
  correction. Without `release()` here, the automatic effect would believe
  this hook still owns the engine forever and silently stop restoring on
  close.

**`DiscoverPanel.tsx`**:

- `syncPreviewToEngine` calls `claim('discover-preview')` at the same spot
  it already claims `previewSyncGenerationRef`, and checks `stillOwn(token)`
  after each await, alongside its existing `unmountedRef`/
  `previewSyncGenerationRef` checks.
- `restorePreviewIfLoaded` calls `release()` alongside its existing
  `flushEngineSyncNow()` call.

## Non-Goals

- No change to PLAY/PAUSE/SET_POS dispatching, or to Discover's own
  intentional "pause the real transport when a preview starts" behavior --
  this is scoped purely to "whose project content is loaded in the
  engine," not transport state.
- No change to `buildEngineProject`, `engineLoadProject`,
  `flushEngineSyncNow`, or any native-engine (C++) code -- every existing
  send path stays exactly as it is; this only gates WHETHER a send happens
  and marks who's currently responsible for it.
- No UI change, no user-visible indicator of "who owns the engine right
  now" -- purely an internal coordination fix.
- No attempt to make the two full-screen preview modals openable
  simultaneously -- that's a separate, much bigger UI change nobody has
  asked for; this fix only protects against the sequential-race and
  passive-mutation windows that already exist today.

## Testing

- `src/shared/engineOwnership.ts` gets real TDD unit tests: claim returns
  an incrementing generation, `stillOwn` is true for the current token and
  false for a stale one, a second `claim` (same or different owner)
  invalidates a prior token, `release` invalidates the outgoing owner's
  token and resets `current` to null.
- The three call-site changes (`StoreContext.tsx`, `useStemPreviewPlayback.
  ts`, `DiscoverPanel.tsx`) are typecheck+lint verified only, matching this
  codebase's established convention for effect/hook wiring -- none of
  StoreContext.tsx's own existing tests render the full provider either
  (`StoreContext.test.ts` only exercises the pure `subscribeToState`/
  `getStateSnapshot` bridge).
- Manual walkthrough required before calling this done: close Discover
  while its preview is playing, then IMMEDIATELY open Tidy Up and start
  previewing a stem -- the solo should hold, not snap back to the full mix
  a moment later. (The Link-tempo race can't be forced deterministically in
  this environment without a real Link peer; covered by the same
  mechanism, not separately walked through.)

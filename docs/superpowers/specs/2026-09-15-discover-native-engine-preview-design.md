# Discover Preview via Native Engine — Design

**Goal:** Route Discover's live preview through the real native engine instead of
plain Web Audio, so multiple previewed slots stay sample-accurately in sync with
each other over an arbitrarily long preview session, and so master/channel FX
plugins are audible while auditioning — not just after placing.

**Architecture:** Discover keeps its own existing slot-picking/rolling/candidate
logic untouched. Only the *playback backend* changes: instead of decoding stems
and looping them via `AudioBufferSourceNode` in the renderer, Discover now
assembles the current loop into a single, throwaway `EngineProject` and sends it
to the real native engine the same way the real arrangement already does.

**Tech Stack:** No new dependencies. Reuses `buildEngineProject`,
`engineLoadProject`, `scheduleLiveParamSync`, and the `PLAY`/`PAUSE`/`SET_POS`
actions this codebase already has.

---

## Background

Discover's current preview (`previewLoop.ts`'s `startPreviewLoopWithGain`, wired
up in `DiscoverPanel.tsx`) plays entirely in the renderer via plain Web Audio
`AudioBufferSourceNode.loop`. A single source loops itself sample-accurately
forever, but several independently-looping sources of *different* bar lengths
only stay in phase with each other if each one's own loop length is an exact
integer multiple of the shared bar length. In practice it never is exactly —
encoder padding, rubberband stretch rounding, and plain floating-point
durations all introduce a tiny per-loop error. That error is inaudible on one
pass and compounds every repeat, so a multi-slot preview drifts "slightly, then
a lot" the longer it plays. Confirmed live, 2026-09-15.

The real native engine already solves exactly this problem for actual placed
clips, via sample-accurate loop-sewing (`LoopSewing.cpp`) and its own real-time
mixer — Discover's preview bypasses all of that by design (it predates the
engine-preview idea; it was built to be fast and commitment-free). Routing
through the engine instead gets sync correctness, and — as a natural
consequence of going through the engine's own mixer — makes master/channel FX
audible during preview too, since the engine already applies `masterChain` (and
any per-channel plugin chains) to everything it plays. It does *not*, on its
own, add playhead-scrub UI or per-slot plugin editing — those become *possible*
afterward but are their own follow-up work (see Non-Goals).

## How the engine actually works (grounds this design)

Read fresh from `native-engine/Source/PlaybackEngine.h`, `Transport.cpp`, and
`IpcServer.cpp` while designing this:

- `PlaybackEngine::setProject()` always **fully replaces** whatever project was
  previously loaded — there is no notion of "two projects loaded at once." It's
  documented as safe to call at high frequency (used today for live drag
  syncing), publishing a whole new immutable snapshot atomically.
- The engine has **no persistent memory of "the real project"** as something
  distinct from a preview. The renderer is the single source of truth; the
  engine just plays whatever `EngineProject` it was last handed. This means
  "restoring" the real arrangement after a Discover preview is not a special
  engine-side operation — it's just sending the real project again.
- `loopLengthBars` is a per-project field the transport already wraps
  `positionBars` against — a project containing only the Discover loop's own
  rifff naturally loops just that rifff, no engine changes needed.
- Play/pause/position (`PLAY`/`PAUSE`/`SET_POS`, `engineSetPosition`) are
  already separate, general-purpose concerns from `setProject`/
  `engineLoadProject` — the exact same actions the real transport and
  `useStemPreviewPlayback.ts`'s own Tidy Up preview already use.

## Architecture

**One shared "unite into a rifff" helper.** `plunkInArranger` (shipped
2026-09-15) already assembles every currently-placeable Discover slot into a
single multi-stem `Rifff` — one stem per slot, the rifff's own `barLength` set
to the longest included stem's own `barLength` so shorter stems tile/loop to
fill the group via the same machinery every other placed rifff already uses.
This design extracts that assembly logic into one shared function (used by
both `plunkInArranger` and the new preview path) rather than writing a second
copy — the preview's own "rifff" *is* exactly what would get placed if you hit
"plunk in arranger" right now, just not yet committed to `state.rifffs`.

**A separate, minimal preview project — not a modified copy of the real one.**
While previewing, Discover builds and sends a small standalone `EngineProject`
containing *only* the current loop: `{ bpm: state.bpm, rifffs: [that one
united rifff], loopLengthBars: <the rifff's own barLength>, ... }`, built via
the existing `buildEngineProject` (already parallelized for stretch
resolution, 2026-09-15) against a synthetic, throwaway `AppState` rather than
the real one. It never touches or copies `state.rifffs`, `state.vol`,
`state.mute`, etc. — the real arrangement's own state is completely
untouched by a Discover preview.

**Pausing the real arrangement.** The moment a Discover preview starts (the
first slot joins the mix), if the real arrangement is currently playing
(`usePlaying()`), dispatch `PAUSE` first — same convention `TransportBar.tsx`'s
own `stopActivePreview()` already uses for Shelf/LORE previews. Discover does
not auto-resume the real arrangement when its own preview stops; matches how
every other "audition something else" flow in this app already behaves.

**No snapshot to restore.** Unlike `useStemPreviewPlayback.ts` (which has to
capture and restore a real mute/vol snapshot, since it solos ALREADY-PLACED
stems within the real project), Discover's preview never touches real state
at all — there's nothing to undo. "Handing control back" on Discover close
(or on "plunk in arranger") is one explicit call: stop building/sending the
Discover preview project, and call the existing `flushEngineSyncNow()`
(already exported via `useFlushEngineSyncNow()`, the same function
`useStemPreviewPlayback.ts` itself calls) once, with no overrides, so the
real, unmodified project is sent immediately — rather than waiting for some
unrelated real edit to happen to trigger the normal coalesced sync effect.

**Incremental updates while previewing.** A slot joining, leaving, or landing
a new candidate (reroll) rebuilds the SAME shared rifff (via the shared
helper) and resends it through `engineLoadProject`, exactly mirroring the
current `restartMix`'s own "diff what should be playing against what's
already loaded, only touch what changed" philosophy — just with the backend
swapped from managing individual `AudioBufferSourceNode`s to rebuilding one
small project and re-sending it. The existing generation-guard pattern this
file already uses (`rerollGenerationRef`, `stretchGenerationRef`) extends
naturally to guard this rebuild-and-send against a newer change landing
while an older async build (candidate resolve → stretch resolve →
`buildEngineProject` → `engineLoadProject`) is still in flight.

**Live gain dragging.** Once a slot's stem is loaded into the currently
playing preview project, dragging its volume slider calls
`scheduleLiveParamSync('volume', stemKey(groupId, slot), value)` — the exact
same rAF-coalesced, full-reload-bypassing path the real arranger's own volume
sliders already use — instead of a full project rebuild per drag tick. More
responsive than today's Web-Audio gain-node approach, for free.

**Toggling a slot's own mute (in/out of the mix).** A slot leaving the mix is
just: rebuild the rifff without that slot's stem, resend. (A future
refinement could instead mute in place via a live param rather than dropping
the stem from the rifff entirely, avoiding a full stem-buffer reload — noted
as a possible follow-up, not required for this pass; see Non-Goals.)

## Component changes

- **New shared helper**, a new file under `src/renderer/src/audio/` (exact
  name chosen when the implementation plan is written) — extracts the "one
  stem per slot, longest barLength wins, cap at 8" logic
  currently inline in `DiscoverPanel.tsx`'s `plunkInArranger`, given a real
  unit test (pure, no Electron/DOM dependency).
- **`DiscoverPanel.tsx`** — `plunkInArranger` calls the new shared helper
  instead of its own inline version. The whole Web-Audio preview state
  machine (`mixPairsRef`, `mixJoinGenerationRef`, `restartMix`,
  `resolvePreviewAudio`'s stretch-then-join logic, `mixStartTime`,
  `unmountedRef`) is replaced by a smaller engine-based orchestration:
  build/send/play on slot-set change, `flushEngineSyncNow()` on stop/unmount,
  `scheduleLiveParamSync` on gain drag.
- **`previewLoop.ts`** — `startPreviewLoopWithGain`/`PreviewSourceWithGain`
  (added 2026-09-15, only ever used by `DiscoverPanel.tsx`) become dead code
  once this lands and are deleted. The original `startPreviewLoop` is
  untouched — three other callers (`Shelf.tsx`, `LibraryBrowser.tsx`,
  `ProjectLibraryBrowser.tsx`) still use it for their own, unrelated Web Audio
  previews.
- **`buildEngineProject.ts`, `StoreContext.tsx`, native engine** — no changes.
  Everything this design needs already exists.

## Testing

- The new shared "assemble a rifff from slots" helper is pure logic — real
  unit tests (given N resolved stems, produces one rifff with the right
  `barLength`/stem slots/8-stem cap), same TDD convention this session's
  other `src/shared/`-adjacent work has followed.
- `DiscoverPanel.tsx`'s own orchestration changes are typecheck+lint verified
  only, per this codebase's established convention for React components (no
  GUI/audio interaction tooling in this environment).
- Manual walkthrough required before calling this done (flagged explicitly,
  same as every other UI feature this session): a multi-slot preview stays
  phase-locked over an extended (several-minute) play, rerolling/muting/
  removing a slot mid-preview doesn't glitch or desync the others, the real
  arrangement correctly pauses when a preview starts and does *not*
  auto-resume when it stops, "plunk in arranger" while previewing hands off
  cleanly, and master/channel FX are audibly applied during preview.

## Non-Goals (out of scope for this pass)

- Playhead-scrub/drag-to-seek UI on a Discover slot's own waveform — becomes
  possible once this lands (the engine already supports accurate seeking),
  but wiring the actual drag interaction is separate follow-up work.
- Per-slot channel plugin auditioning/editing UI.
- Muting a slot via a live param instead of a full rifff rebuild (noted above
  as a possible future refinement).
- Any change to Tidy Up (`ClusterStemsBrowser.tsx`/`useStemPreviewPlayback.ts`)
  — unrelated, already works correctly through the real engine today.
- Any native-engine (C++) source changes — confirmed everything needed
  already exists on the engine side.

# DAW Mode (Channels + Independent Clips) Design

## Summary

Normal and Compact modes evolve from "one rifff = one permanent row" into a small, real DAW-style arranging surface: rows become **channels** — independent, addressable lanes that any clip can be dragged onto or off of — and any number of clips can share one channel, side by side over time. A clip can be a whole linked rifff (as today) or a single stem promoted to its own independent clip via a new **ungroup** action.

Explicitly framed by the user as still serving this app's core purpose — quick arrangement — not scope for its own sake. This revisits territory that caused a full revert earlier in the project (send-bus plugin hosting: real-time audio plugin hosting was ruled out as "not becoming a DAW"). This feature is different in kind: it's pure renderer-side arrangement bookkeeping, and — confirmed by grep — **the native engine requires zero changes**. `trackOrder`/channels are referenced only in `store.ts`, `selectors.ts`, and `SketchStrip.tsx`; nothing in `src/main/` (the native engine bridge) touches it. The engine already just receives a flat list of positioned stems regardless of which row they're drawn on.

Out of scope for this pass (deliberately, to keep this a "quick arrangement" upgrade and not a DAW rebuild):
- Regrouping split-out stems back into a multi-stem rifff ("okay if they cannot be regrouped... down the road we can allow ways to group again").
- Named/manageable channels (rename a channel, explicitly create/delete an empty one). Channels are implicit — born when a clip lands on them, gone when the last clip leaves.
- Collision avoidance on a shared channel (push/trim neighboring clips, or blocking an overlapping drop). Overlap is simply allowed and mixes, matching how two different rows already play simultaneously today.
- Sketch mode. `isSketchEligible`'s existing "linked, no gaps/overlaps" check already excludes any arrangement using multiple channels or overlapping clips, so sketch mode needs no behavior changes — only the mechanical field rename below.

## Data model

`AppState.trackOrder: string[]` (today: one entry per placed rifff's groupId, doubling as both row order and row ownership, fixed forever once set) is replaced with:

```ts
channelOrder: string[]        // ordered list of channel IDs (crypto.randomUUID()), top-to-bottom row order
channelOf: Record<string, string>   // groupId -> which channel it's currently on
```

Placing a rifff for the first time still auto-creates a fresh channel for it and appends to `channelOrder` — identical to today's default behavior; nothing changes for the common "one clip, one row" case until a clip is deliberately dragged onto an existing row or off to a new one.

**Reassigning a channel** happens as part of the same drag-and-drop gesture that already repositions a clip in time — one action, one undo step (exact action shape is an implementation detail; likely an added `channelId` parameter on the existing placement action rather than a whole new action type).

**Removal** (`REMOVE_FROM_TIMELINE`, `DELETE_RIFFFS`) additionally deletes the groupId's `channelOf` entry, and — if no other clip still references that channel ID — drops it from `channelOrder` too. A channel with nothing on it doesn't persist as an empty row.

## Ungroup (renamed from "unlink")

Today's `UNLINK`/`RELINK` pair (a flag letting stems drift to independent positions while staying inside the same row) is replaced by a single one-way action, **Ungroup**, matching the user's own framing ("it'll be like grouping and ungrouping"):

Given a linked, multi-stem rifff, Ungroup:
1. Creates one new, independent one-stem rifff per stem (fresh groupId each), landing on the **same channel**, at the **same startBar**, as the parent — meaning they start out stacked exactly on top of each other (consistent with "overlap just mixes"), and the user drags them apart from there.
2. Copies per-stem state (`vol`, `mute`, `off`/`stemStart` if already diverged) to each new clip's own keys.
3. Copies group-level state (`fadeIn`, `fadeOut`, `stretch`) identically to every new clip.
4. Deletes the original multi-stem rifff and all its now-orphaned per-group state, same cleanup pattern `DELETE_RIFFFS` already follows.
5. Selects the first new clip.

`RELINK` is removed — there's nothing to relink to once the parent rifff no longer exists. This is a conscious, explicit trade-off, not an oversight (see Out of scope above).

Because a freshly-ungrouped clip is an ordinary one-stem rifff, it automatically gets everything every other placed rifff already has for free — see below.

## Rendering

Timeline currently renders one `RifffBlockRow` per placed rifff (`placedRifffsInOrder(state).map(...)`). It becomes: walk `channelOrder`, and for each channel ID render a new `ChannelRow` holding every rifff whose `channelOf` points at it. Each clip keeps rendering at its own absolutely-positioned time geometry exactly as `RifffBlockRow` does today; if two clips on the same channel overlap in time, they'll visually overlap too — direct, honest feedback that they're sharing a channel, resolved by dragging one aside.

## Drag-and-drop

Each `ChannelRow`'s own DOM node owns its `onDrop` — which channel a clip lands on is just "whichever row's element the cursor is physically over," resolved by normal event targeting, no new hit-test geometry needed. Dropping on an existing channel row reassigns `channelOf` to that channel (plus the usual time-position update from `clientX`). Dropping on one of the existing empty "ghost rows" below the arrangement creates a **new** channel — the same affordance that already exists today for placing a brand new clip, now also usable to pull an existing clip off a shared channel onto its own.

When two clips on a channel overlap in time, z-order (which one visually draws on top) follows plain array order within that channel's clip list — no separate stacking logic. Not load-bearing for playback (both still play; audio doesn't have a "z-order"), only for which one you click.

## Selection, Inspector, remove, rename, duplicate

Unchanged. Confirmed by reading `Inspector.tsx`: it's already keyed purely by `state.sel` (a groupId), doesn't special-case stem count, and already has a working "remove from timeline" button. `pasteRifffAction`/`pasteStemAction` (cmd/ctrl-drag duplicate) already exist and work per-groupId. A split-out one-stem clip, or any clip on a busy shared channel, is indistinguishable from an ordinary placed rifff to all of this — it's the entire reason this design avoids inventing a parallel "clip" abstraction.

## Sketch mode compatibility

`SEQUENCE_RIFFFS`'s reducer case currently writes `trackOrder: action.groupIds` directly; it needs to write the `channelOrder`/`channelOf` equivalent instead (one clip per channel, in sequence order — sketch-eligible arrangements are always 1:1 clip:channel already). No other sketch-mode logic changes: `isSketchEligible`'s existing per-rifff `unlinked`/fade/offset checks plus its contiguity check already reject any arrangement spanning multiple channels or containing overlapping clips.

## Migration

Existing saved projects only have `trackOrder: string[]`. `deserializeProject` needs a migration step: when a loaded project has the old shape (`trackOrder` present, `channelOrder` absent), synthesize `channelOrder`/`channelOf` from it — mint one fresh channel ID per old `trackOrder` entry, in the same order. This reproduces today's exact "one clip per row, in trackOrder's order" rendering for any pre-existing save; nothing changes visually until the user actually drags a clip onto a shared or new channel.

## Testing

Ordinary reducer/selector unit tests throughout (`store.test.ts`, `selectors.test.ts`), following this project's existing heavy-coverage convention for exactly this kind of pure state logic — no native-engine or real-time-audio surface is touched, so none of the native test suite needs to change. A dedicated migration-fixture test loads an old-shape (`trackOrder`-only) saved project through `deserializeProject` and confirms it renders identically to before (each previously-placed rifff getting its own distinct channel, in the original order).

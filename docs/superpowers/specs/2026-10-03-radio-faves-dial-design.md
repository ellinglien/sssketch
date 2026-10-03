# Radio faves dial: from ignore to only favourites

**Date:** 2026-10-03
**Scope:** sssketch Discover and radio, and ell.ing/radio. Queued after the radio readout build.

## Why

Elling: "with the liked and hearted stems, is there a way we could add a switch to just use those?
or a slider to adjust how much to prefer them? from ignore to exclusive".

What exists today:
- **Desktop:** an on/off `prefer faves` modifier (`DiscoverSlotModifier 'preferFaves'`). It favours
  stems starred with 👍.
- **Web:** a "loved" weight (`pick.ts loved`). It merges the visitor's 👍 likes (`likes.ts`) with
  the crowd's ♥ hearts, and is used as `rankCandidates`' favourite boost.

## Decisions (Elling, 2026-10-03)

- **One `faves` dial, 0–100,** shaped like the existing source dial.
- **Favourites:**
  - desktop: 👍-starred stems;
  - web: the visitor's 👍 likes plus ♥ hearted stems.
- **Hearts.** Hearts really belong to groups of stems. Counting a heart's stems one by one is fine
  for now. Playing a hearted group as a group is a later idea.

## 1. Behaviour

The dial is `faves` ∈ [0, 100]. At each pick:

- **The draw.** With probability `faves/100`, the pick is drawn **only from favourites**, using the
  same slot rules as any pick: kind mask, traits, tempo, source dial, clash.
- **Fallback.** If no favourite fits the slot, that pick falls back to a normal pick. The readout
  can then show `no fave fits`.
- **Every other pick** is drawn normally, but its ranking still gives favourites a boost of
  `faves/100 × FAVE_BOOST`, today's `prefer faves` strength. So the dial leans gradually as well.
- **The ends:**
  - `0` is exactly today's behaviour without `prefer faves`;
  - `100` means only favourites, except where none fit.
- **Determinism.** All draws use the picker's injected random source.
- **Defaults:** `0`, so nothing changes until the dial is moved.

## 2. Migration and controls

- **Desktop.** `faves` replaces the `prefer faves` modifier.
  - A saved `preferFaves: on` becomes `faves: 50`; otherwise it starts at 0.
  - The dial goes in the radio menu, and in Discover's roll modifiers where `prefer faves` sat.
- **Web.** The dial goes in full mode, remembered per visitor (`radio.faves`).
- **Copy:** label `faves`, tooltip `how much to stick to liked stems`.

## 3. Architecture

- **Shared.** A pure helper `favesDraw(faves, random): 'only' | 'normal'` plus a boost scale, used
  by both pickers:
  - desktop: `discoverCandidates` / `rankCandidates` options;
  - web: `pick.ts`.
- **The favourites-only pool** is a filter of the normal candidate pool, taken before ranking.
  - When it comes back empty, the pick falls back.
  - The fallback is recorded on the pick (`favesFallback: true`) for the readout.

## 4. Testing

- **Shared:**
  - at 0, ranking is identical to today (checked across many seeds);
  - the draw rate is `faves/100`;
  - at 100, picks are favourites whenever any fit;
  - fallback works when none fit;
  - migration from `preferFaves`.
- **Web:** pick tests, and the prefs.
- **Elling's walkthrough:**
  1. At 100, only liked stems play.
  2. At 0, it plays as before.
  3. Around 50, liked stems clearly come up more often.

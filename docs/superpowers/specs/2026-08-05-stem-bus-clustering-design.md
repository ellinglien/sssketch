# Stem bus clustering + Ableton track reduction — design / handoff

**Date:** 2026-08-05
**Status:** design agreed in conversation, not yet planned or implemented
**Author:** handoff from an exploratory session (no code written)

## The problem

Exporting a real arrangement to Ableton produces an unmixable number of tracks. The user's
words: *"right now it's a mess of millions of channels."* The goal is to land in Ableton with
a **small, fixed number of mix buses** (5, maybe up to ~10 audio tracks total) instead of one
group per channel and one audio track per stem — **without flattening anything**. Every clip
must stay an independently editable clip in Ableton.

The user then mixes and masters in Ableton. sssketch's job is to arrive there tidy.

## Why the obvious approach doesn't work here

The first design attempt assumed stem *type* metadata could drive bus assignment. It can't,
for this user's material:

- **~90% of their audio is `audioIn`** — live mic/instrument input recorded into Endlesss.
- `instrumentMaskToSoundType` (`src/shared/loreLibrary.ts:65`) resolves those to `audioIn`,
  which means "recorded live," not "what instrument this is."
- `guessSoundTypeFromPresetName` (`src/shared/presetNames.ts:274`) is an **exact,
  case-insensitive** match against a curated table of Endlesss pack preset names. For live
  input the name is `"Microphone"` or whatever the user typed. It returns `null`.
- `guessSoundType` (`src/shared/typeGuess.ts:69`) only ever returns `bass` or `drums`, by
  deliberate design.

So the entire existing classification ladder resolves ~90% of this user's stems to a single
uninformative value. **`SoundType` cannot drive bus assignment.** Don't try to extend it —
`SoundType` describes what Endlesss device produced a stem, which is a different axis from
where it belongs in a mix. Add a new dimension; don't overload the existing enum (doing so
would also break `typeColorVar`).

**Therefore: clustering on audio features is the primary mechanism, not a fallback.**

## What already exists (do not rebuild)

Verified by reading the code this session:

| Thing | Location | Note |
|---|---|---|
| Ableton track layout | `src/main/ableton/buildAlsXml.ts:456` | `for (const channelId of state.channelOrder)` → 1 `GroupTrack` per channel; inner loops → 1 `AudioTrack` **per stem**. This is the thing to re-partition. |
| Solo-render-per-target | `src/main/nativeExport.ts:79` (`nativeExportStems`) | Builds a `soloMute` record muting every other stem, calls `buildEngineProject`, then `render-export`. Lines 109–122. Exactly the shape a per-bus render would need. |
| Offline render | `native-engine/Source/RenderExport.h` | `renderProjectToWavFile(project, path, durationBars, err)`. Single implementation, shared by `--render-test` and the IPC path. |
| Stem→channel escape hatch | `src/renderer/src/state/store.ts:870` (`UNGROUP`) | Splits a rifff into independent one-stem rifffs. **Stem-level channels already work** — an earlier assumption that channels were locked to rifff granularity was wrong. |
| Channel assignment | `channelOf: Record<groupId, channelId>` + `MOVE_TO_CHANNEL` | `busOf` should mirror this shape exactly. |
| Per-stem label actions | `store.ts:304-305` (`CYCLE_TYPE`, `SET_STEM_TYPE`) | The UI pattern to copy for bus assignment. |
| Audio features | see next section | Most of the feature vector is already computed and cached. |

### Two findings worth acting on

**1. `buildAlsXml.ts` has no volume or gain handling at all.** Grepping it for
`vol|Volume|gain|Gain` returns only comment matches. `state.vol[stemKey]` never reaches the
`.als` — everything exports at unity. Worth confirming independently, but if it holds:

- It's a **gap in its own right** (sssketch mix levels don't survive export), possibly worth
  its own separate spec.
- It makes this feature *easier*: merging stems onto shared audio tracks costs nothing that
  isn't already lost.

**2. `nativeExportStems` applies the master chain to every individual stem.**
`buildEngineProject` always includes `state.masterChain`, and `renderProjectToWavFile`'s own
doc comment says it processes that chain over each rendered block. So each isolated stem WAV
today has the full master chain applied to it individually — N stems each through the
limiter, which will not sum to the mixdown. For stems intended for external mixing this is
wrong. **Recommend fixing as a small standalone change before building on this path.**

## Design

### 1. `busOf` — a new, thin layer

```ts
type BusId = 'drums' | 'bass' | 'lead' | 'backing' | 'aux'
busOf: Record<string, BusId>   // keyed by stemKey (see types.ts:78)
```

Mirrors `channelOf` in shape. One new reducer action (`ASSIGN_TO_BUS`), one new key persisted
in `projectFile.ts`. Five buses is the recommended starting set — it's the minimum that
mastering tools and stem-mastering workflows assume, and few enough to label by ear quickly.

**This is export-time grouping only.** It does not touch `EngineProject`, the native engine,
or the hand-synced wire-format twin. Live bus processing is explicitly out of scope (see
below).

### 2. `packIntoTracks` — the track-count reducer

An Ableton audio track plays one clip at a time, so two clips that overlap in time cannot
share a track — but non-overlapping ones can. Per bus:

> Sort clips by start bar. For each clip, place it on the first track whose previous clip has
> already ended; otherwise open a new track.

This is interval partitioning (the "meeting rooms" problem). Greedy, `O(n log n)`, and
provably yields the **minimum** number of tracks. The count it produces per bus equals the
maximum number of clips sounding simultaneously in that bus.

Expected outcome: ~5 group tracks containing ~8–15 audio tracks total, versus one group per
channel and one audio track per stem today. Nothing rendered, nothing flattened.

```ts
// src/shared/packIntoTracks.ts
export function packIntoTracks<T>(
  clips: readonly T[],
  startBar: (c: T) => number,
  endBar: (c: T) => number
): T[][]
```

Pure function, `src/shared/`, TDD per repo convention. Derive each clip's interval from
existing helpers (`resolvePlayedBarsFor`, `leftCrop`) rather than re-deriving timing — clip
timing has bitten this codebase before.

### 3. Clustering — how buses get assigned

Unsupervised, because there are no usable labels. The user never needs the app to be *right*
about what an instrument is; they need groups that are *internally consistent*, then they name
them by ear.

Flow: extract features per stem → cluster into ~8–10 → user auditions each cluster → user
names it → every stem in that cluster inherits the bus.

**That's ~8–10 decisions for an entire project, regardless of stem count.**

#### Feature vector

Already available:

| Feature | Source | Separates |
|---|---|---|
| `transientDensity` | `src/shared/typeGuess.ts:44` | drums |
| `bassEnergyRatio` | `src/shared/typeGuess.ts:36` | bass |
| band energy → spectral centroid | `src/shared/bandEnergy.ts:41` | bright vs dark |
| ZCR brightness | `src/renderer/src/audio/peakCache.ts` (`getBrightness`) | noisy vs tonal |
| per-frame `freqHz` | `src/shared/pitchContour.ts:52` | register |

Two additions, both cheap and both high-value:

- **Voiced fraction + pitch variance** — derive from `computePitchContour`'s `freqHz`
  (fraction of frames with a resolved pitch, plus variance of those). ~5 lines. This is the
  single most useful missing feature: it splits pitched material (lead/backing) from
  unpitched (drums/fx). Note `PitchContour` currently returns only `{ numFrames, freqHz }`
  with no confidence field — check how unvoiced frames are represented before assuming `0`.
- **MFCCs** — the standard timbre descriptor, and what makes similar-sounding sources cluster
  without being told what they are. `src/shared/fft.ts` already exists, so this is a mel
  filterbank plus a DCT, ~40 lines.

All pure, all in `src/shared/`, all unit-testable. **No ML model, no download, no network.**

Follow the existing cache convention (`peakCache.ts`, `bandEnergyCache.ts`, `pitchCache.ts`):
key by path, decode once, evict on rejection. `peakCache.ts` computes two derived values from
a single decode — do the same rather than adding another full decode pass.

#### Clustering algorithm

k-means or agglomerative over the normalised feature vector. Agglomerative is probably the
better fit — it doesn't need `k` chosen up front, and a dendrogram cut lets the user slide
"how many groups" interactively, which is a genuinely nice control here. Standardise features
(z-score) before clustering; the raw scales are wildly different.

### 4. Labelling UI

Audio problem → ear-driven interface:

- One row per cluster, sorted by clip count (label the biggest first, ignore the tail)
- **Solo-and-audition on focus** — playback and solo already exist
- **Number keys 1–5** assign a bus; arrow keys move down the list
- Show *why* a suggestion was made as its provenance, not a confidence percentage —
  "from LORE" / "from preset name" / "clustered" / "unknown". Those are trusted differently
  and the distinction is more actionable than a number.

Design system: read `src/renderer/src/styles/tokens.css` first. Lowercase copy, no emoji,
sharp corners, colour only on things carrying audio information.

### 5. Ableton export changes

In `buildAlsXml.ts`: swap the outer loop's key from `channelId` to `BusId`, and use
`packIntoTracks` for the inner allocation instead of one track per stem. Group track name
becomes the bus name rather than `earliestRifff(rifffs).name`.

Everything else in that file — clip placement, id renumbering, `clearSends`, the return-track
removal — is unchanged.

## Open questions — resolve before building

1. **Is `(author, slot)` stable within a jam?** The user gave contradictory answers in the
   same message: *"no it's electronic music so changes all the time"* and *"they are stable, i
   think."* This matters: if a slot holds one instrument for a whole jam, grouping by
   `(author, slot, presetName)` collapses ~240 stems into ~12 label targets essentially for
   free, and clustering becomes a refinement. If slots are re-armed freely, clustering has to
   carry the entire feature.

   **Design so it works either way** — treat slot grouping as an optional prior that improves
   clusters when it holds, never as a correctness requirement. Ask the user directly before
   relying on it.

2. **Five buses, or more?** User said *"five channels.. or whatever, 10 channels to reduce too
   much merging."* Note that `packIntoTracks` already answers the underlying worry — the merge
   never destroys overlapping clips, it opens another track. So five *buses* can still yield
   ~10 *tracks*. Confirm five is the right bus count with that understood.

3. **Is the master-chain-on-stem-export fix in scope here, or its own change?** Recommend its
   own small change, landed first.

## Explicitly out of scope

- **Live bus processing** (plugins on a bus, bus faders in-app). The user ruled this out
  directly: *"no need to do live bus processing."* This is the only part that would touch
  `EngineProject` / the C++ twin — keeping it out is what makes this whole feature
  TypeScript-only.
- **ML audio embeddings (CLAP / YAMNet / PANNs).** Discussed as a possible later tier —
  CLAP's joint text-audio embedding would allow zero-shot scoring against phrases like
  `"drum loop"`, `"bass guitar"`, via `onnxruntime-node`. It's a ~100–200 MB dependency.
  **Build DSP-feature clustering first and see what it actually fails at** before considering
  it. The user agreed with this ordering.
- **LLM-based classification.** Considered and set aside: it was only viable when metadata
  (preset names, instrument masks) carried signal, which for this user's `audioIn` material it
  does not.

## Suggested order

1. Master-chain bypass for stem/bus renders — small, standalone, unblocks correctness.
2. `busOf` + `ASSIGN_TO_BUS` + persistence — pure reducer work, TDD.
3. `packIntoTracks` in `src/shared/` — pure function, known-correct algorithm, TDD.
4. `buildAlsXml` re-partition — swap the loop key, use the packer.
   *At this point the feature is already useful with hand-assigned buses.*
5. Feature extraction: voiced fraction, pitch variance, MFCC — pure, cached, TDD.
6. Clustering + the labelling UI.

Steps 1–4 deliver the actual win (tidy Ableton sessions) and depend on no analysis at all.
Steps 5–6 make assignment fast. Landing 1–4 first means the clustering work can be evaluated
against a working end-to-end path rather than in the abstract.

## Testing notes

Per `CLAUDE.md`: pure logic in `src/shared/` is TDD by convention — failing test first, verify
it fails, implement, verify it passes. `packIntoTracks` and the feature extractors are exactly
that. React components aren't tested directly in this codebase; verify via typecheck + lint +
the underlying pure logic's tests, and **say plainly that UI was not click-tested** rather than
claiming otherwise — this environment has no GUI/audio interaction tooling.

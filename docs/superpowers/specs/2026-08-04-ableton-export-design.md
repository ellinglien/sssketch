# Ableton Live (.als) export — design

## Context

This is the first concrete piece of a broader scope pivot (see project memory
`sssketch-scope-pivot-ableton-export`): sssketch is pulling back from competing with full
DAWs on real-time-audio-editing completeness, and focusing instead on LORE
navigation/import and fast arrangement/sketch mode. This feature is the "graduation path" —
export an arranged sssketch project as an Ableton Live Set so serious mixing/production
continues in a real DAW.

Two existing export features already exist as precedent: `nativeExport.ts`
(`export-mix-native`/`export-stems-native`, rendering audio via the native engine) and
`exportMix.ts` (`export-mix`/`export-stems`, save-dialog + file-write). This feature follows
the same split (pure builder + thin IPC/dialog layer) but needs no native-engine rendering at
all — it reads `AppState` directly and copies existing stem audio files, since the whole
point is to hand off to Ableton's own playback/mixing, not sssketch's.

## Scope (v1)

**In scope**: track/clip placement (per stem, at the right bar, with sssketch's own
crop/extend-handle loop windowing carried over), tempo (Set-level BPM), and key (Set-level
Scale, from LORE-imported `Rifff.key`).

**Explicitly out of scope for v1**:
- Volume, mute, and fade-in/out state. These get re-set by ear once you're in Ableton doing
  real mixing anyway — carrying them over adds real complexity (clip gain/track
  mute/fade-envelope XML) for a "sketch, not final mix" export.
- Master chain / channel plugin chains. No reasonable representation in `.als` XML for
  arbitrary VST3/AU chains sssketch hosts; completely out of scope.
- Ableton Live 11 compatibility. The reference template (see below) was captured from Live
  12.4.3; targeting Live 11's schema is a non-goal unless it turns out to matter later.
- Non-4/4 time signatures. sssketch has no time-signature concept beyond an implicit 4/4
  (bars are always 4 beats); this carries through unchanged.

## Reference template

`.als` is gzip-compressed XML, undocumented officially, well reverse-engineered by the
community — but rather than building the schema from documentation, this design is grounded
in a **real reference file**: the user built a Live 12 Set by hand
(`/Users/nickel/Downloads/Untitled Project/Untitled.als`) containing two ungrouped audio
tracks (one with a partial loop active), a grouped pair of tracks, one clip with a
tempo-mismatched sample (to observe warp-marker encoding), a Set tempo of `123.4`, and a Set
Scale of E Minor. This file was decompressed and inspected directly. Concrete findings,
load-bearing for implementation:

- Root element: `<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live
  12.4.3">` — preserved verbatim from the template, not reconstructed.
- `<LiveSet><Tracks>` holds `<AudioTrack Id="N">` / `<GroupTrack Id="N">` elements directly.
  Each track's `<TrackGroupId Value="17"/>` (or `-1` if ungrouped) points at its parent
  `GroupTrack`'s `Id` — this is the entire grouping mechanism.
  - **Track display names use a nested shape**: `<Name><EffectiveName Value="..."/><UserName
    Value=""/>...</Name>` — NOT the flat `<Name Value="..."/>` clips use. Easy to get backwards.
- A clip lives at `AudioTrack > DeviceChain > MainSequencer > Sample > ArrangerAutomation >
  Events > AudioClip`, with `Time="..."` (arrangement position, in beats) and
  `CurrentStart`/`CurrentEnd` (extent, in beats). `<Name Value="..."/>` here IS the flat form.
  - `<Loop><LoopStart/><LoopEnd/><StartRelative/><LoopOn/><OutMarker/><HiddenLoopStart/>
    <HiddenLoopEnd/></Loop>` — confirmed against the reference's own partial-loop clip
    (`LoopStart=2 LoopEnd=14` for a clip cropped to beats 2–14). This is sssketch's
    `leftCropBars`/`playedBars` windowing in a different unit.
  - `<SampleRef><FileRef><Path Value="..."/><RelativePath Value="..."/>...</FileRef>...
    </SampleRef>` — absolute + relative audio file path.
  - **No literal "Seg. BPM" field exists.** A clip's native/original tempo is encoded
    implicitly as the ratio between the first two `<WarpMarker Id="N" SecTime="..."
    BeatTime="..."/>` entries. Confirmed against the reference's deliberately-mismatched-tempo
    clip: marker spacing worked out to ~166.3 BPM, matching the source file's own filename
    (LORE/Endlesss exports bake native BPM into the filename already, e.g. `"8 - elling -
    Saturator - 166.304BPM - ..."`).
  - `<WarpMode Value="N"/>` — integer enum. The reference's auto-picked clips all came in as
    `4`. The exact enum-to-mode-name mapping (`Beats`/`Tones`/`Texture`/`Re-Pitch`/`Complex`/
    `Complex Pro`) is **not independently verified against a real Ableton install** — it's
    based on commonly-documented community reverse-engineering, treat as best-effort until
    confirmed by actually opening an export and checking the warp mode dropdown.
- Set tempo: `MainTrack > DeviceChain > Mixer > Tempo > Manual Value="123.400002"`.
- Set scale: a top-level `<ScaleInformation><Root Value="4"/><Name Value="1"/></ScaleInformation>`
  (sibling of `<Grid>`/`<GlobalQuantisation>`, not nested under any track) — confirmed as
  E Minor → `Root=4` (semitone offset from C), `Name=1` (scale-type enum index). Per-clip
  `ScaleInformation` blocks also exist (defaulting to `Root=0 Name=0`) but are a different,
  unrelated per-clip field — the Set-level one (this one) is what the design's "key" mapping
  targets.
- Session-view `Scene` elements also carry a `<Tempo Value="120"/>` + `<IsTempoEnabled
  Value="false"/>` pair — these are disabled per-scene tempo overrides, irrelevant to this
  export (sssketch only targets Arrangement View).

A trimmed copy of this reference — stripped of the actual session content (real clips,
extra FX-return tracks, etc.), keeping only the `<LiveSet>` skeleton plus exactly one
canonical `<AudioTrack>` node and one canonical `<GroupTrack>` node as clone sources — is
checked into the repo as the literal template implementation clones from. Everything not
explicitly touched by the mapping below is copied verbatim from this real, Ableton-generated
file, which is what makes the format risk here "did the substitution logic preserve the
untouched parts" rather than "did the whole schema get reconstructed correctly."

## Architecture

Follows the existing export split (pure builder + thin IPC/dialog layer):

- **`src/main/ableton/template.xml`** — the trimmed reference template described above.
- **`src/main/ableton/buildAlsXml.ts`** — pure function: `(state: AppState, resolvedStems:
  ResolvedStemAudio[]) => string` (XML string, not yet gzipped). Parses `template.xml` with
  `fast-xml-parser` (new dependency — needed because this involves duplicating/injecting
  nested nodes programmatically, which raw string templating can't do safely once you're
  cloning whole subtrees), performs the mapping below, serializes back to XML.
- **`src/main/exportAbleton.ts`** — orchestration: resolves each stem's real source audio
  file path (same resolution sssketch already does elsewhere, but explicitly skipping the
  rubberband/stretch resolver — see "Tempo & warp mapping" below), copies those files into
  the output folder's `Samples/Imported/`, calls `buildAlsXml`, gzips the result, writes
  `<ProjectName>.als`.
- **IPC**: `export-als` (`ipcMain.handle` in `src/main/index.ts`) / `exportAls` (preload
  bridge in `src/preload/index.ts`), matching the existing `export-mix-native`/
  `exportMixNative` kebab-case-channel/camelCase-bridge convention.
- **UI**: a third button beside the existing Export Mix / Export Stems button(s), in the same
  panel, triggering a `dialog.showSaveDialog` (matching `exportMixToWav`'s pattern) to choose
  the output location, defaulting to `sssketch-export.als`.

## Track/clip mapping algorithm

For each placed rifff (`state.rifffs` where `startBar !== undefined`), for each stem in
`rifff.stems`:

1. Clone the canonical `<AudioTrack>` node, assign a fresh unique `Id` (a counter starting
   above the template's own IDs), name it `<rifff.name> - <stem.name>` via the nested
   `<Name><EffectiveName Value="..."/></Name>` shape. **After every clone/renumber is done,
   the counter's final value must be written into the Set-level `<NextPointeeId>` element**
   (a sibling of `<Tracks>`, near the top of `<LiveSet>`) — confirmed the hard way (not a
   guess): the very first real Ableton load of an export produced *"The document ... is
   corrupt and cannot be loaded. (NextPointeeId is too low: 22290 must be bigger than
   1001899)"*. Ableton validates this field is `>=` every `Id` actually used anywhere in the
   document before it will open the file at all — it's not just a hint, it's enforced.
   **Every cloned track's own `<Sends>`** (`<AudioTrack>`/`<GroupTrack>` > `DeviceChain` >
   `Mixer` > `Sends`) **is left completely frozen, verbatim, by `renumberIds`** — not
   renumbered, and NOT emptied either (an emptied `<Sends>` was tried and caused a real
   Ableton crash on load — see "Known risks" below for the full history). `<ReturnTrack>`s
   are never cloned, so their own real Sends are untouched regardless.
2. **Bar → beat**: sssketch bars are always 4 beats (implicit 4/4 throughout). `beats = bars *
   4`.
3. **The copied audio file is short — only `stem.barLength` bars long, not `playedBars` bars.**
   This is the single most important fact the whole loop-window mapping hinges on, and it was
   originally missed (caught during implementation review, not during design — see "Known
   risks"). sssketch's own native engine achieves a longer `playedBars`-bar clip by *tiling*
   (repeating) the stem's own short native-length file via its own `LoopSewing.cpp` mechanism;
   this export copies that same short source file verbatim (no re-render), so Ableton has to do
   the equivalent tiling itself, via its ordinary `LoopOn=true` clip-loop mechanism — this is
   standard, everyday Ableton behavior (turning a short loop into a longer repeated pattern),
   not a special case. Concretely, for a **non-one-shot** stem:
   - `<Loop><LoopStart/><LoopEnd/></Loop>` define ONE TILE CYCLE, not the whole played span:
     `LoopStart = wrappedLeftCropBars * 4`, `LoopEnd = stem.barLength * 4`, where
     `wrappedLeftCropBars = ((leftCropBars % stem.barLength) + stem.barLength) % stem.barLength`
     — the crop only shifts the *phase* Ableton starts/loops from within that one tile; it can
     never push `LoopEnd` past the sample's own real, available duration (`stem.barLength * 4`
     beats — see step 4 for why this is exact), which is the one thing that's genuinely
     non-negotiable here (there's no more audio data past that point to loop into).
   - `<HiddenLoopStart>0</HiddenLoopStart><HiddenLoopEnd>` = `stem.barLength * 4` — the
     sample's own real, full extent (in warped-beat terms), independent of any crop.
   - The clip's own **arrangement-visible span** is a *separate* concern from the loop-cycle
     bounds above, and is governed by `Time` (position) and `CurrentEnd` (duration), not
     `LoopEnd`: `Time = (rifff.startBar + leftCropBars) * 4` (the *raw*, unwrapped
     `leftCropBars` — this is a genuine shift of the clip's position on the arrangement
     timeline, confirmed against `selectors.ts`'s own `clipGeometryFromFields`:
     `leftPx: (startBar + leftCropBars) * ppb`, and against `native-engine/Source/
     PlaybackEngineTests.cpp`'s own `"leftCropBars clips the first tile without moving
     startBar..."` test), and `CurrentEnd = (playedBars - leftCropBars) * 4` (`visibleBars` in
     `clipGeometryFromFields`'s own terms). `LoopOn=true` makes Ableton repeat the
     `[LoopStart, LoopEnd)` tile automatically to fill however long `CurrentEnd` says the clip
     should be — exactly mirroring sssketch's own tiling, without this export needing to
     enumerate individual repeats itself.
   - **One-shot stems** (`stem.oneShot`) are unaffected by the tiling logic above — a one-shot's
     own file already contains exactly the audio it should play (no tiling), so `LoopOn=false`
     and `Time = rifff.startBar * 4` (no crop concept applies to one-shots). But they need their
     **own** tempo/warp treatment, entirely separate from step 4's `nativeBpm` — a real, second
     bug found in whole-feature review (after the tile-cycle bug in the same area), not caught
     by the per-task review that added this mapping originally. Every one-shot and recorded-take
     stem is created with a **hardcoded, explicitly-cosmetic `barLength: 1`**
     (`importOneShot.ts`'s own doc comments: *"the native engine ignores bpm/barLength for
     tiling/resampling purposes whenever a stem's oneShot is set"*) — so `nativeBpm` (step 4,
     derived from `durationSec/barLength`) is *meaningless* for a one-shot, and using it anyway
     collapses every one-shot's `CurrentEnd` to exactly one bar (4 beats) regardless of its real
     duration, then relies on `IsWarped=true` (inherited untouched from the template) to force
     Ableton to time-stretch/compress the *entire* sample to fit — directly contradicting
     `Stem.oneShot`'s own documented invariant (`src/shared/types.ts`: *"never auto-resampled to
     match project bpm"*). The fix: one-shots are exported **unwarped**
     (`IsWarped=false`, and no custom `WarpMarkers` written — the template's own default is left
     alone, since it's inert once warp is off), with `LoopStart`/`LoopEnd`/`CurrentEnd`/
     `HiddenLoopEnd` all derived from real seconds via the **project's own current tempo**
     (`state.bpm`), not any per-stem "native" tempo — this is what makes the mapping correct:
     unwarped audio plays at its own true native speed regardless of Set tempo, and simply
     occupies proportionally more or less arrangement-timeline *space* (beats) as the Set tempo
     changes, exactly mirroring how Ableton natively handles an unwarped clip.
     `LoopStart = trimStartSec * (state.bpm/60)`, `LoopEnd = CurrentEnd = HiddenLoopEnd =
     (trimEndSec ?? stem.durationSec) * (state.bpm/60)`. Confirmed against the reference file
     that `LoopStart`/`LoopEnd` still define the played region even with `LoopOn=false` (not
     purely a "repeat" concept). Omitting trim would silently export more audio than intended
     for any trimmed one-shot.
4. **Native tempo → warp markers**: `stemNativeSecPerBar = stem.durationSec / stem.barLength`
   (identical to `buildEngineProject.ts`'s own calculation, no rubberband call) → `nativeBpm =
   (60/stemNativeSecPerBar)*4`. Write exactly two `<WarpMarker>`s: `(SecTime=0, BeatTime=0)`
   and `(SecTime = 60/nativeBpm, BeatTime = 1)` — a clean one-beat span (the reference file's
   own fractional 0.03125-beat spacing was just Ableton's own auto-detection granularity, not
   a requirement). One consequence worth being explicit about: by construction, `stem.barLength
   * 4` beats of warped time always equals exactly `stem.durationSec` real seconds — i.e. the
   file's own full duration maps to precisely one tile cycle, which is what makes step 3's
   `LoopEnd`/`HiddenLoopEnd = stem.barLength * 4` exact rather than approximate.
5. **Warp mode**: from `stem.type` — `drums` → `Beats` mode (preserves transients on
   percussive content), everything else → `Complex Pro` (best general-purpose quality).
   Encoded via whatever integer values correspond to these modes (to be confirmed against a
   real Ableton install during implementation/testing — see "Known risks" below).
6. `<SampleRef><FileRef><Path>` points at the copied file inside `Samples/Imported/`;
   `<RelativePath>` mirrors it relative to the `.als`.

For each channel in `state.channelOrder` **that has at least one placed rifff on it**: clone
the canonical `<GroupTrack>` once, named after the earliest-`startBar` rifff placed on that
channel (channels have no stored display name of their own today). Every stem-track cloned
above whose `channelOf[groupId] ?? groupId` equals that channel gets `<TrackGroupId
Value="<group's new Id>"/>`. A channel with no placed rifffs produces no Group Track at all —
there's nothing to put in it.

**Set-level fields**:
- Tempo: `MainTrack > Mixer > Tempo > Manual Value="<state.bpm>"`.
- Scale: from the earliest-`startBar` placed rifff that has a non-empty `key`. `Rifff.key` is
  a combined display string (e.g. `"E Minor (Aeolian)"`) produced by
  `loreWarehouse.ts`'s `resolveKeyName` — this design reverse-parses it back into root note +
  scale name using tables mirroring `LORE_ROOT_NAMES`/`LORE_SCALE_NAMES`, then maps those onto
  Ableton's `Root`(0–11)/`Name` (scale-type enum) values. If no placed rifff has a key, or the
  string doesn't parse against the known table, `ScaleInformation` is simply omitted — not
  guessed, not defaulted.

## File output layout

Self-contained folder, matching Ableton's own "Collect All and Save" convention:

```
<chosen folder>/<ProjectName>.als
<chosen folder>/Samples/Imported/<copied stem audio files>
```

Stem filenames deduped the same way `nativeExportStems`'s existing `uniqueFileName` already
handles collisions for the WAV-stems export.

## Error handling

Consistent with this codebase's existing "don't fail the whole export over one bad piece"
convention (e.g. `buildEngineProject.ts`'s rubberband-failure fallback):

- A stem whose source file can't be read/copied: skip that stem's clip, log it, continue.
- No rifffs placed: surface a clear "nothing to export" error rather than writing an empty
  `.als`.
- Unparseable `Rifff.key`: omit `ScaleInformation` (see above) — not an error.
- Missing/corrupt checked-in template: fail the export with a clear error (shouldn't happen
  in practice, defensive only).

## Testing

- `buildAlsXml.ts` is pure and gets real unit test coverage (this codebase's convention for
  anything in reach of `src/shared`-style pure logic) — assertions against the *parsed-back*
  XML structure (track count, `TrackGroupId` nesting, clip `Time`/`Loop` values, warp marker
  math, Set tempo/scale values), using `fast-xml-parser` in tests too, not string-matching.
- `exportAbleton.ts` (file-copying/IPC/dialog layer) follows the existing untested-at-that-
  layer convention matching `exportMix.ts` — verified by manual walkthrough.
- **The one thing nothing in this repo can verify automatically**: opening the exported
  `.als` in real Ableton 12 and confirming it loads without errors, tracks/clips land where
  expected, and a couple of different stem types (at least one `drums` stem, one melodic/
  other-typed stem, **and one one-shot/recorded-take stem specifically** — see "Known risks"
  below on the unwarped-clip representation) sound reasonable/correct. This is a manual
  acceptance step, not a gap to "fix" by mocking Ableton.

## Known risks / open uncertainties

- **Warp mode enum values** (`Beats`/`Complex Pro` → integer) are based on commonly-
  documented community knowledge, not independently verified against a real Ableton install.
  If wrong, clips will just show the wrong (but still valid) warp mode in Ableton — not a
  file-corruption risk, easily fixed by hand per-clip.
- **Scale-name table completeness**: `LORE_SCALE_NAMES` and Ableton's own scale-type enum
  need to be manually cross-mapped during implementation; only `Major`/`Minor` are confirmed
  against the reference file (`Name=0`/`Name=1` respectively, inferred from per-clip defaults
  and the Set-level E-Minor test). Modal scales (Dorian, Phrygian, etc. — which LORE/Endlesss
  keys frequently use, e.g. the reference's own "(Aeolian)" suffix) will need their own
  confirmed mapping; unmapped ones fall back to omitting `ScaleInformation` per the error
  handling above, not guessing.
- **Ableton Live 12 only** — confirmed as the user's actual version, not just the test file's
  origin. Live 11 compatibility is untested and out of scope.
- **Id renumbering and the `<Sends>`/`<TrackSendHolder>` substructure took six real, confirmed
  rounds to get right on first real-world use — all now resolved, and the correct scheme is no
  longer a guess, it's confirmed against real Ableton output. The process is worth recording in
  full since it's a good illustration of how empirical this undocumented format's constraints
  are, and because two of the intermediate "fixes" actually made things worse in ways that only
  showed up on load, not at export time.**
  (1) The Set-level `<NextPointeeId>` element must be `>=` every `Id` used anywhere in the
  document, or Ableton refuses to open the file at all (*"document is corrupt... NextPointeeId
  is too low"*) — fixed by writing the renumbering counter's final value into it. This fix
  stood; nothing since has touched it.
  (2) `<TrackSendHolder>`'s own `Id` is a positional index correlating 1:1 with the Set's
  return tracks (its two `Id="0"`/`"1"` instances in the reference template exactly match its
  two `ReturnTrack`s) — renumbering it broke that correlation and produced *"Track has more
  send knobs than set has return tracks."* First attempted fix: exclude only
  `TrackSendHolder`'s own `Id` from renumbering, still recurse into (and renumber) its
  children.
  (3) That fix produced the *exact same* "more send knobs" error, which at the time was
  attributed to the nested `AutomationTarget`/`ModulationTarget` Ids also needing to stay
  frozen. Second attempted fix: freeze `TrackSendHolder`'s entire subtree instead — no
  renumbering, no recursion into it at all. (In hindsight, per round (6) below, this diagnosis
  was wrong — the nested Ids were never the problem; see that round for what the real bug in
  this attempt likely was.)
  (4) Freezing the whole subtree traded one bug for another: every cloned track now shares the
  *identical* nested `AutomationTarget`/`ModulationTarget` Ids, and once that frozen subtree
  gets duplicated across dozens of cloned tracks, Ableton correctly flags it as *"non-unique
  Pointee IDs."* An intermediate fix reasoned "sssketch has no concept of send level to a
  return track at all, so just don't carry this substructure into a clone" and emptied every
  cloned track's own `<Sends>` down to zero `<TrackSendHolder>` children.
  (5) That intermediate fix was WRONG, and worse than (4) — it doesn't just refuse to load with
  a message, it makes Live **crash outright** (confirmed via a real macOS crash report: a
  SIGSEGV null-pointer-style dereference, `far: 0x00000000000000b8`, on Live's main thread
  during its own file-open routine, before the user did anything else). `<Sends>`/
  `<TrackSendHolder>` is not an optional feature sssketch happens not to use — it's core mixer
  plumbing every non-return track has, and Ableton's own mixer layout code evidently assumes
  unconditionally that each track has exactly one `<TrackSendHolder>` per `<ReturnTrack>` in
  the Set. With zero, it indexes off the end of an empty list while laying out the mixer on
  load and crashes. Reverted to (3)'s frozen-whole-subtree approach as the safer of two known-
  bad states — a "document is corrupt, repair?" prompt is recoverable, a crash with no message
  is not.
  (6) But (3)'s frozen-subtree approach ALSO isn't actually safe at real project scale: on the
  user's real ~33-cloned-track project, Ableton's own "repair" flow for the resulting
  "non-unique Pointee IDs" error deduplicated the Ids in a way that broke the send-count
  correlation again, right back to *"Track has more send knobs than set has return tracks"* —
  an unrecoverable dead end (no further repair offered). **Real, empirically-confirmed final
  fix**: rather than keep guessing from error messages alone, the user duplicated a real track
  6 times directly in Ableton itself (unrelated to this export feature) and shared the
  resulting `.als`. Decompiling it gave ground truth: every duplicate's `<TrackSendHolder>`
  Ids stayed `"0"`/`"1"` (confirming (2)'s positional-index finding was always correct), while
  the nested `<AutomationTarget>`/`<ModulationTarget>` Ids were freshly, globally unique on
  *every single duplicate* — not frozen, not paired by any special offset, just unique. This is
  exactly what round (2)'s first attempt already tried (skip only the outer Id, keep
  renumbering everything nested) — which had been assumed broken. Re-implementing that exact
  shape and testing it at the user's real project scale (27 AudioTracks + 9 GroupTracks, a
  throwaway integration test scanning the whole document for duplicate
  `AutomationTarget`/`ModulationTarget` Ids) found zero collisions, confirming this is the
  correct scheme — round (3)'s original diagnosis (that nested Ids also needed freezing) was
  simply wrong, and whatever caused round (2)'s original attempt to fail is not reproducible
  from a clean implementation. `alsXmlHelpers.ts`'s `renumberIds` now has a `SKIP_OWN_ID_TAGS`
  exception (renamed from `FROZEN_SUBTREE_TAGS`, since it now skips only the OWN Id, not the
  whole subtree) for `TrackSendHolder`. `<ReturnTrack>`s are never cloned, so their own real
  Sends are completely unaffected regardless. **The sharper lesson from this whole sequence**:
  when an undocumented binary format's validation logic is involved, an error message's
  apparent cause (round (3)'s "the nested Ids must be the problem too") can be wrong even when
  a fix based on that diagnosis appears to work around the immediate symptom — real ground
  truth from the tool's own output beats reasoning from error messages and trial-and-error
  alone, and is worth getting even if it costs an extra round-trip with the user. Also worth
  weighing: a crash with no error message at all (round (5)) is strictly worse than a
  refusal-to-open with a clear one — that asymmetry should count heavily against any fix that
  merely "sidesteps" a validation error by deleting the thing being validated, rather than
  understanding what the validation actually requires.
- **Loop-cycle wrap approximation for a cropped, tiled stem**: when `leftCropBars` is nonzero,
  the "Track/clip mapping algorithm" section's `LoopStart = wrappedLeftCropBars*4, LoopEnd =
  stem.barLength*4` gives each loop CYCLE a shorter span than a full tile
  (`(stem.barLength - wrappedLeftCropBars)*4` beats) — meaning every repeat past the first uses
  that same shortened cycle, not a full tile. sssketch's own native tiling instead plays only
  the *first* repeat short (truncated at the front) and every subsequent repeat as a full,
  untouched tile (see `tileOffsetsPx`'s own doc comment). This is a genuine, acknowledged
  approximation — not fully resolvable from the single reference file this design is grounded
  in, since it hinges on exactly how Ableton's own loop-region semantics work for a first-play
  vs. steady-state repeat, and the safer, always-valid choice (never asking Ableton to loop
  past the sample's own real available audio) was picked over a closer-but-unverified
  alternative. In practice the audible difference is probably small (a several-bars-long loop
  region shifted by at most one crop's worth of phase), but this is exactly the kind of thing
  the "manual acceptance in real Ableton" testing step should specifically listen for on a
  stem that's actually had its left-crop/extend handle used, not just an unmodified one.
- **Unwarped-clip XML representation, unconfirmed against a real reference example**: the
  one-shot fix above (`IsWarped=false`, `LoopStart`/`LoopEnd`/`CurrentEnd` derived from real
  seconds via `state.bpm`) is a well-reasoned design, not a confirmed one — every clip in the
  reference template happens to have `IsWarped=true`, so there's no real example of exactly how
  Ableton represents an unwarped clip's trim/extent in this XML shape to check against. The
  reasoning (an unwarped clip still uses beat-space `Loop*`/`CurrentEnd` values, mapped to real
  seconds via whatever the Set's *current* tempo is, since there's no per-clip warp curve
  overriding that mapping) is standard, well-understood Ableton behavior, but this is exactly
  the kind of thing that should get first-priority attention in the "manual acceptance in real
  Ableton" testing step — specifically, export a project containing a one-shot/recorded-take
  stem and confirm it plays at its own correct, unstretched, real-world duration/pitch, not
  compressed or stretched to fit some other length.

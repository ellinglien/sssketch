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
   **`<ReturnTrack>`s are dropped from the export entirely** — never cloned, never carried
   over into the output `<Tracks>` list at all — and **every cloned track's own `<Sends>`**
   (`<AudioTrack>`/`<GroupTrack>` > `DeviceChain` > `Mixer` > `Sends`) **is emptied of its
   `<TrackSendHolder>` children**, leaving the `<Sends>` element present but childless. The
   Set-level `<SendsPre>` (tied 1:1 to return-track count) is emptied to match. sssketch has
   no concept of sends/return-track routing in its own data model, and this is the only
   approach that actually loads after 8 real, confirmed failed attempts at every other scheme
   — see "Known risks" below for the full history. The exported project simply opens without
   the 2 default reverb/delay returns pre-configured.
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

- A stem whose source file can't be read/copied/decoded: skip that stem's clip, log it,
  continue. **A LORE-cached stem's source path has no file extension and its actual on-disk
  bytes are Endlesss's own storage codec (FLAC, confirmed empirically)** — a naive
  `copyFileSync` to a `.wav`-named destination produces a file Ableton correctly refuses to
  load (*"does not appear to be a valid WAV file"*, confirmed via a real Ableton load
  attempt). `exportAbleton.ts` splits stems by source extension (mirroring `bakeOffset.ts`'s
  own `isWavPath` convention): a real `.wav` source is a plain `copyFileSync`; anything else is
  routed through the native engine's existing `bake-stem` IPC command (`BakeStem.cpp`, already
  used by `bakeOffset.ts` for the same LORE-non-WAV distinction), which decodes it via JUCE's
  `AudioFormatManager` (FLAC/Ogg/WAV/AIFF all registered) and writes a real WAV to the
  destination. One engine process is spawned and reused for the whole batch of non-WAV stems,
  not one per stem — same spawn-connect-act-teardown shape `bakeOffset.ts`'s own
  `bakeNativeJobs` already uses. A stem that fails to decode is skipped the same way a failed
  copy is.
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
- **Id renumbering and the `<Sends>`/`<TrackSendHolder>` substructure took eight real, confirmed
  rounds across two separate sessions to actually resolve, and the final fix is a scope
  reduction (drop return tracks from the export), not an Id scheme — because the true Id scheme
  Ableton's per-track send-knob validator wants was never determined, despite extensive
  empirical investigation including decompiling real Ableton output twice. The process is worth
  recording in full: it's a good illustration of how undocumented and resistant to reverse-
  engineering this specific corner of the format is, and of when to stop searching for the
  "correct" scheme and change the shape of the problem instead.**
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
  (3) That fix produced the *exact same* "more send knobs" error. Second attempted fix: freeze
  `TrackSendHolder`'s entire subtree instead — no renumbering, no recursion into it at all.
  (4) Freezing the whole subtree traded one bug for another: every cloned track now shares the
  *identical* nested `AutomationTarget`/`ModulationTarget` Ids, and once that frozen subtree
  gets duplicated across dozens of cloned tracks, Ableton correctly flags it as *"non-unique
  Pointee IDs."* An intermediate fix reasoned "sssketch has no concept of send level to a
  return track at all, so just don't carry this substructure into a clone" and emptied every
  cloned track's own `<Sends>` down to zero `<TrackSendHolder>` children.
  (5) That intermediate fix was WRONG, and worse than (4) — it doesn't just refuse to load with
  a message, it makes Live **crash outright** (confirmed via a real macOS crash report: a
  SIGSEGV null-pointer-style dereference, `far: 0x00000000000000b8`, on Live's main thread
  during its own file-open routine, before the user did anything else). At the time this was
  attributed to Ableton's own mixer layout code assuming unconditionally that each track has
  exactly one `<TrackSendHolder>` per `<ReturnTrack>` in the Set (this attribution turned out
  to be incomplete — see (8)). Reverted to (3)'s frozen-whole-subtree approach as the safer of
  two known-bad states — a "document is corrupt, repair?" prompt is recoverable, a crash is not.
  (6) (3)'s frozen-subtree approach ALSO isn't safe at real project scale: on the user's real
  ~33-cloned-track project, Ableton's own "repair" flow for the resulting "non-unique Pointee
  IDs" error deduplicated the Ids in a way that broke the send-count correlation again, right
  back to *"Track has more send knobs than set has return tracks"* — an unrecoverable dead end.
  To get real evidence instead of continuing to guess, the user duplicated a real track 6 times
  directly in Ableton itself (unrelated to this export feature) and shared the resulting
  `.als`. Decompiling it showed every duplicate's `<TrackSendHolder>` Ids staying `"0"`/`"1"`,
  while the nested `<AutomationTarget>`/`<ModulationTarget>` Ids were freshly, globally unique
  on every duplicate — exactly what (2)'s first attempt already tried. Re-implementing that
  exact shape and testing it at the user's real project scale (27 AudioTracks + 9 GroupTracks,
  a throwaway integration test scanning for duplicate Ids) found zero collisions.
  (7) Despite matching real Ableton output byte-for-byte, (6)'s re-implementation STILL failed
  with the identical *"more send knobs"* error on the user's real project — and, critically,
  also failed identically at the smallest possible non-trivial scale (2 tracks, 1 stem each).
  This ruled out project scale as a factor and meant the Id-matching approach itself was
  fundamentally not the fix, despite two rounds of empirical verification suggesting otherwise.
  Further investigation (comparing a freshly-created single-track Ableton file against the
  template's own canonical track and its `ReturnTrack`s, both byte-for-byte identical in
  structure; full document-wide structural diffs finding zero discrepancies anywhere; targeted
  web research turning up no documented validation algorithm and no other open-source tool that
  even attempts to clone a track's `Sends`) found no further leads. The true validation rule
  Ableton's loader applies here remains unknown.
  (8) **Actual final fix — a scope reduction, not an Id scheme**: since sssketch has no concept
  of sends/return-track routing anywhere in its own data model, and every attempt to make a
  cloned track's `<Sends>` agree with Ableton's undocumented validator failed regardless of
  approach, the fix is to remove the entire axis of complexity: `<ReturnTrack>`s are dropped
  from the export outright (never cloned, never included in the output `<Tracks>` list), every
  cloned `<AudioTrack>`/`<GroupTrack>`'s own `<Sends>` is emptied to zero `<TrackSendHolder>`
  children (this time safely, since zero return tracks means zero `TrackSendHolder`s actually
  is the only valid state — see (5)'s incomplete attribution above, which assumed a fixed
  per-return-track count was mandatory regardless of scope), and the Set-level `<SendsPre>`
  (also tied 1:1 to return-track count) is emptied to match. With no return tracks and no send
  targets, there is no longer any Id scheme to get right at all. `alsXmlHelpers.ts`'s
  `renumberIds` is back to its original, fully-unconditional form — no `TrackSendHolder`-
  specific exception of any kind remains in it. The user loses the 2 default reverb/delay
  returns pre-configured in the exported project; they add their own once they start mixing in
  Ableton, which fits sssketch's own stated scope (arrangement speed, not final mix setup).
  **The lessons from this whole 8-round sequence**: first, a crash with no error message (5) is
  strictly worse than a refusal-to-open with a clear one, and that asymmetry should count
  heavily against any fix that "sidesteps" a validation error by deleting the thing being
  validated without understanding why. Second, and more important given how this ultimately
  resolved: when a specific technical scheme resists two independent rounds of empirical
  verification (including matching real tool output byte-for-byte) and still fails, the
  problem may not be a wrong implementation of a right idea — it may be worth questioning
  whether the whole feature axis is worth preserving at all, especially when (as here) the
  calling application has no actual data model need for it. Removing scope beat continuing to
  reverse-engineer an undocumented, evidently non-trivial validator.
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

## Post-ship bugs found via real multi-group project testing (2026-08-05)

Both found and fixed via the Project Library feature's real-world testing, once exports
started routinely containing more than one placed rifff/channel — the single-rifff test
projects used throughout the original build-out never exercised either.

- **`CurrentStart`/`CurrentEnd` were written as relative durations; Ableton reads them as
  absolute arrangement-beat positions.** `buildStemTrack` set `CurrentStart="0"` and
  `CurrentEnd=<relative duration>`, which coincidentally looks correct for a clip at `Time=0`
  (relative and absolute math agree when the offset is zero) but is wrong for every clip placed
  later in the arrangement. Symptom: only the first (Time=0) group's audio showed up on open;
  every later group's tracks existed (correctly grouped/named/routed) but were silently
  empty — no error dialog, no visible failure. Root-caused via Ableton's own `Log.txt`
  (`~/Library/Preferences/Ableton/Live <version>/Log.txt`), which logs its load-time "Repair"
  pass: `Repair Track: '...' Clip: '...' Start: 32 End: 16 Delete clip because its length is
  too small.` — Ableton computed `End` as the raw (relative) `CurrentEnd` value and `Start` as
  `Time`, got a zero-or-negative span for anything past the first group, and silently deleted
  the clip before ever analyzing its audio (confirmed further by `.asd` waveform-cache sidecar
  files existing only for the first group's samples — Ableton never got far enough to analyze
  the rest). Fix: `CurrentStart = Time`, `CurrentEnd = Time + <relative duration>`, both in the
  same absolute coordinate space Ableton actually reads.
- **Leftover tempo automation envelope in `template.xml` silently overrides the `Manual` tempo
  this export sets.** `template.xml` was captured from a real Ableton project that had a tempo
  automation envelope present (`MainTrack > AutomationEnvelopes > Envelopes`, one
  `AutomationEnvelope` whose `EnvelopeTarget > PointeeId` matches the Set-level `Tempo` node's
  own `AutomationTarget` Id), with a single `FloatEvent` at `Time="-63072000"` (effectively "the
  very start of the timeline") pinning tempo to the template's own original value
  (`123.400002`). `buildAlsXml` only ever wrote the `Manual` value; it never touched this
  envelope. Ableton always honors an active automation envelope over a parameter's raw `Manual`
  value wherever the envelope has a breakpoint, so the exported Set displayed the template's
  original tempo regardless of `state.bpm` — symptom reported as "tempo stuck at the previously
  open file's BPM," which was actually this baked-in envelope, not any kind of document-reuse/
  caching issue in Ableton itself. Fix: after setting `Manual`, look up the `Tempo` node's own
  `AutomationTarget` Id and remove the matching `AutomationEnvelope` entry entirely (found by
  Id match, not by position) — matching this doc's own established precedent from the Sends
  saga above (removing what sssketch doesn't model, rather than trying to keep an
  automation curve it has no data for in sync).

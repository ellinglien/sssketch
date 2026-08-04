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
   `<Name><EffectiveName Value="..."/></Name>` shape.
2. **Bar → beat**: sssketch bars are always 4 beats (implicit 4/4 throughout). `beats = bars *
   4`. Clip `Time` (arrangement position) = `rifff.startBar * 4`.
3. **Loop window**: `leftCropBars`/`playedBars` (`state.leftCrop[groupId] ?? 0`,
   `resolvePlayedBars(state, groupId)`) map onto `<Loop>`: `LoopStart = leftCropBars*4`,
   `LoopEnd = (leftCropBars+playedBars)*4`, `LoopOn=true`. One-shot stems (`stem.oneShot`)
   get `LoopOn=false` instead, placed once at natural length — matching their existing
   no-crop/-extend treatment elsewhere in sssketch.
4. **Native tempo → warp markers**: `stemNativeSecPerBar = stem.durationSec / stem.barLength`
   (identical to `buildEngineProject.ts`'s own calculation, no rubberband call) → `nativeBpm =
   (60/stemNativeSecPerBar)*4`. Write exactly two `<WarpMarker>`s: `(SecTime=0, BeatTime=0)`
   and `(SecTime = 60/nativeBpm, BeatTime = 1)` — a clean one-beat span (the reference file's
   own fractional 0.03125-beat spacing was just Ableton's own auto-detection granularity, not
   a requirement).
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
  other-typed stem) sound reasonable on their auto-picked warp mode. This is a manual
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

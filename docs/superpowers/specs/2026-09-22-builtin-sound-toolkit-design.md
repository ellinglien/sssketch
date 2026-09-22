# Built-in sound toolkit: filter, reverb, riser, drawn automation

Date: 2026-09-22
Status: designed in chat (decisions recorded below); awaiting spec review

## Why

sssketch can vary a stem only by presence, gain and mute regions. Arranging a track — and the
sssketchy guided flow (2026-09-22-sssketchy-guided-track-design.md) — needs real movement:
sweeps into drops, washed-out breakdowns, risers into sections. Hosted VST/AU can do this, but
not every user has one, and the guided flow can't rely on that. So the app grows a small,
built-in, always-present toolkit.

Decisions already made (Elling, 2026-09-22): **toolkit first, then sssketchy**; effects live
**per channel and are automatable**; export offers **"bake in" OR "export the automation"**,
with the riser **always rendered to audio**; reverb is **zita-rev1** (GPL, fine: this repo is
GPL-3 — see LICENSE); automation is edited with a **free-draw tool over a limited parameter
set**.

## 1. Engine (native-engine/, JUCE/C++)

Remember: the engine is a separate build and does NOT hot-reload — rebuild
(`cmake --build build`) and fully quit + relaunch the app to pick it up (CLAUDE.md).

- **Per-channel filter.** One state-variable filter per channel (JUCE `dsp::StateVariableTPTFilter`
  — already in JUCE, no new dependency): mode (lowpass | highpass), cutoff (Hz, log-mapped),
  resonance. Bypassed (zero cost) when a channel has no filter automation and cutoff is at its
  neutral end.
- **Per-channel reverb send.** zita-rev1 (Fons Adriaensen's FDN, GPL; the standalone C++ port
  is two files) as ONE shared reverb instance fed by per-channel sends — cheaper and more
  cohesive than an instance per channel. Per channel: send amount (wet). Global (project):
  room size / decay, damping, pre-delay. Vendored under `native-engine/Source/dsp/zita-rev1/`
  with its licence header intact, and credited in the repo's README/licence notes.
- **Noise riser generator.** A placeable element rendered by the engine: white/pink noise
  through a rising bandpass + volume ramp over its own bar length, with optional end "whoosh"
  (short reverse or reverb tail). Parameters: length (bars), start/end cutoff, curve shape,
  level. It's an audio SOURCE clip, not a channel effect.
- **Automation application.** Sample-accurate parameter ramps from the project data below,
  evaluated per block; no zipper noise (smoothed values).
- **Offline render** (export / mixdown / stems) applies filter, reverb and risers identically to
  live playback — the engine's existing offline path must run the same graph.

## 2. Project data (src/shared/, wire-format twin in the engine)

- `ChannelAutomation`: per channel, per parameter (`filterCutoff` | `filterResonance` |
  `reverbSend` | `volume`) a list of breakpoints `{ bar: number; value: number }` in [0,1]
  normalized (the engine maps to real units), with linear interpolation between them and a
  hold before/after the first/last point.
- `ChannelFilterSettings`: mode + neutral defaults per channel.
- `ProjectReverbSettings`: the shared zita-rev1 parameters.
- `RiserClip`: `{ id, channelId, startBar, lengthBars, startCutoff, endCutoff, curve, level }`
  placed like any other clip.
- All of it saves in `.sssketchproj` (versioned, older projects load with empty automation) and
  is mirrored into `buildEngineProject.ts` + `EngineProject` — the hand-synced pair CLAUDE.md
  warns about: change both sides and their tests together.

## 2b. REVISION, 2026-09-22 (after the first live walkthrough): automation is PER CLIP

Elling, seeing the first build: "the automation lane is too tall ... the automation should be
limited to the wave area (don't even allow to draw beyond where the wave is). it should be
fixed to the placement. if the stem is moved, have the envelope go with it." Plus: each
ungrouped stem should get its own lane.

So the toolkit's scope moves from CHANNEL to CLIP (a placed stem), matching the existing
per-stem volume envelope:
- Curves are stored per stem clip, in CLIP-RELATIVE bars (0 = the clip's own start), so moving,
  duplicating or re-ordering a clip carries its automation with it, and a curve can never
  extend past the audio it belongs to.
- Drawing is confined to the clip's waveform rect: the lane IS the waveform area (not the row,
  not the name bar), and input outside it does nothing.
- The engine applies filter / reverb send / volume PER STEM, before stems sum into their
  channel; the reverb send still feeds the one shared bus.
- `volume` fully replaces the old per-clip volume envelope (Elling's choice) rather than
  multiplying with it — one place to draw a level.
- Channel-level filter/send settings from the first pass are dropped; there is no channel
  scope for the toolkit any more.

**Built, 2026-09-22 (same day).** Data + wire, lane, engine: three commits. Notes worth
keeping:
- Curves live in `state.stemAutomation`, keyed by `stemKey(groupId, slot)` -- the same key
  `vol`/`mute`/`muteRegions`/`busOf` use, so cleanup on delete, carry-over on ungroup and
  copy-on-duplicate all reuse machinery that already existed.
- The absolute bar a curve lands on is resolved in exactly one place,
  `buildEngineProject.ts`'s `clipOriginBar` (`startBar + leftCropBars + offsetSteps/snapDiv`
  -- the same three terms `clipGeometryFromFields` uses to DRAW the clip), and sent as
  `EngineStemToolkit.originBar`. The engine subtracts it and never re-derives the geometry.
- An expanded rifff shows one lane per stem; a COLLAPSED one shows a single lane that writes
  the same curve to every stem in the rifff (the whole-rifff treatment `SET_GROUP_VOLUME`/
  `SET_GROUP_MUTE` already give the collapsed view). Curves are stored per stem either way,
  so expanding afterwards lets them diverge.
- The per-clip DSP state in the engine is keyed by stemKey, so a moved/re-channelled/renamed
  clip keeps one continuous filter while a duplicate or re-import starts clean.
- The reported "filter cutoff is audible, reverb send and volume are not" turned out NOT to
  be an engine or wire-format problem. Two offline-render assertions added in the engine's
  own test suite pin that directly -- a volume curve to zero really silences a clip, and a
  full send really leaves a tail past the end of the dry audio -- and both pass. The cause
  was above the wire, in the channel-wide lane's own geometry (see the UI commit), and the
  rescope removes it; worth re-checking by ear in the next walkthrough rather than assuming.
- A `.sssketchproj` saved during the one day the toolkit was per channel has its
  `channelFilters`/`channelSends`/`channelAutomation` DROPPED on load. No honest migration
  exists (a channel's curve belonged to every clip on that row at once, in absolute bars), so
  such a project loads with no automation rather than with wrong automation.

## 2c. REVISION, 2026-09-22 (second walkthrough): resonance is a DIAL, not a lane

Elling: "that's confusing to have it separate from cut though isn't it?" -- a resonance LANE
reads as broken, because resonance is inaudible unless a cutoff curve is moving. So:
- drawable parameters are `filterCutoff` | `reverbSend` | `volume` (picker label for the first is
  just "filter");
- resonance is a small DIAL in the filter lane's corner, stored per clip in `stemFilters`;
- a resonance curve saved before this loads as its bar-weighted average on that dial;
- on EXPORT, resonance is therefore a static device value (Auto Filter Resonance / ReaEQ band Q),
  not an envelope -- section 4's table predates this.

## 2d. BUILT, 2026-09-22: step 4, the noise riser

Notes worth keeping, in the same spirit as 2b's:

- **`curve` is a breakpoint list, not a shape exponent.** Section 2 allowed either, but
  section 3 also wants the sweep DRAWN in a lane -- and once a lane has to express an
  arbitrary hand-drawn slope, an exponent can't hold the answer and would have needed a
  breakpoint list beside it anyway. Using the same `AutomationPoint[]` shape everything else
  uses means the riser's lane IS the lane we already have (`AutomationLaneTarget`'s third
  case), not a parallel one.
- **`startCutoffValue`/`endCutoffValue` survive alongside it** as the riser's declared ends,
  and are what it falls back to when the lane is cleared -- so right-clicking a riser's lane
  plays the plain ramp it was dropped with rather than flattening or silencing it. A new
  riser's curve is seeded with exactly those two points, so its lane opens showing the sweep
  it is actually going to play.
- **White noise, not pink.** Pink tilts -3dB/octave, so a rising bandpass would make the
  riser quieter exactly as it rises, fighting the swell. White also is the only one of the
  two addressable by sample INDEX -- pink is filtered white, and a filter has memory.
- **Determinism is by index, not by seeding a generator.** `riserNoiseAt(seed, index)` is a
  pure hash, and the bandpass's coefficient updates are anchored to the riser's own sample
  index rather than to the render block's start. That is what makes a bounce identical to
  the pass that was listened to, and what makes a loop-boundary block split a non-event.
  Pinned by tests at block sizes 1/64/128/333/1024 and by an offline-vs-live parity test.
- **Real bug found by the tests, not by ear:** JUCE's TPT bandpass output has a peak
  magnitude response of Q, not 1, so a riser at level 0.8 through a Q of 2 reached 1.6 and
  clipped -- surfacing as a 16-bit bounce that no longer matched the float render.
  `kRiserBandpassNormalisation` undoes the passband gain; a test now pins that a riser never
  exceeds the level it was given.
- **Risers are sources on a channel, not effects on one.** They render into the channel's own
  accumulator upstream of its plugin chain, exactly where a stem lands. They do NOT feed the
  shared reverb bus: their data shape has no send, and inventing one would be a parameter
  with nothing to set it. Section 1's optional end "whoosh" is therefore not built either.
- **A riser keeps its own arranger row alive** (`channelHasAnyClip`, `channelsInOrder`) and
  extends `loopLengthBars`, since the transport wraps there and a riser parked past the last
  clip is the likeliest place to put one.
- **The level is a dial on the block**, not a second lane. Section 3's "its level uses the
  volume lane treatment" didn't fall out: a riser's level envelope is the generated swell,
  which is what the element IS, and a second drawable parameter would mean giving the shared
  `AUTOMATION_PARAMS` set a per-target variant for one case.
- Still unverified by ear or by hand -- a coding agent can't do either here. Needs Elling's
  walkthrough: how a default riser actually sounds, whether 4 bars / 0.3->0.95 / level 0.6
  are the right defaults, and whether the hatched block reads as "generated" on screen.

## 3. Automation mode (renderer)

- A new arranger mode alongside the existing ones (SET_ARRANGER_MODE), reached from the
  transport bar: **automation**.
- Each channel row becomes a lane showing the selected parameter's curve over the timeline,
  drawn in the app's monochrome language (thin bright line over the dimmed waveform, sharp
  corners, no fills).
- **Parameter picker per channel** limited to the toolkit set: filter cutoff, filter resonance,
  reverb send, volume. (A deliberately small set — "limited set of tools", Elling.)
- **Free-draw:** click-drag draws the curve freehand (points sampled to a sensible resolution,
  simplified on release); shift-drag draws a straight ramp; double-click a point removes it;
  right-click clears the lane. Snap-to-bar is on by default with a modifier to disable.
- Playback shows the playhead over the lanes; values are audible immediately (live param sync,
  same path plugin params already use).
- **Riser placement:** in automation mode (and the normal arranger), a "+ riser" action drops a
  riser clip at the playhead/click, draggable and resizable like a clip; its sweep shape is
  editable as a curve in its own lane.

## 4. Export (src/main + exporters)

Export dialog gains a choice when a project uses the toolkit:
- **Bake in (default):** stems/mixdown render with filter, reverb and risers applied — the
  exported audio sounds exactly like playback. For Ableton/REAPER the baked audio is what's
  referenced.
- **Export the automation:** audio renders dry (minus risers, which always render to audio —
  Elling's decision), and the automation is written as envelope data in the target project
  format (Ableton: automation lanes on the track; REAPER: track envelopes), so the user can
  attach their own filter/reverb device. Document per-format limits honestly in the dialog.
- The riser always exports as rendered audio in both modes.

### Mapping automation onto the target DAW's own stock devices (Elling, 2026-09-22)

"maybe in ableton we could map them to ableton specific plugins ... so they would load without
any tech headache". The toolkit deliberately mirrors a DAW channel strip, so each parameter has
an obvious stock-device home. "Export the automation" writes these, so the project opens and
plays with no plugin installs:

| toolkit | Ableton (.als) | REAPER (.rpp) |
|---|---|---|
| per-stem gain (the dial) | track **Volume** (mixer) | track **volume** |
| `volume` curve | automation on track Volume | track **volume envelope** |
| `reverbSend` curve | ONE **Return track with a stock Reverb**; per-track **Send A** automation (mirrors our single shared bus exactly) | one **reverb bus track** (stock ReaVerbate) + per-track **send volume envelope** |
| `filterCutoff` / `filterResonance` | stock **Auto Filter** on the track; automation on Frequency / Resonance | stock filter JSFX/ReaEQ band; automation on its cutoff / Q |
| riser | rendered audio clip (always) | rendered audio clip (always) |

Device parameter ids/versions must be verified against a real exported project from the target
DAW version before shipping — a wrong id silently produces a device with a dead envelope.

## 5. Build order

1. Engine: filter + zita-rev1 send + automation evaluation (+ JUCE unit tests via `--test`).
2. Project data + wire format + persistence (TDD in `src/shared/`).
3. Automation mode UI with free-draw (manual walkthrough).
4. Riser generator (engine) + placement UI.
5. Export: bake and automation-export paths.
Then sssketchy's tension pass uses all of it.

## Testing

- Engine: JUCE UnitTests for filter response, reverb wet mapping, automation ramp evaluation,
  riser envelope; manual listening pass (no automated audio-quality test).
- Shared: breakpoint evaluation/simplification/serialization TDD'd.
- Export: existing exporter tests extended for both modes.
- UI: typecheck + lint + manual walkthrough.

## Out of scope

- A full mixer, EQ, compression, sidechain ducking.
- Automating hosted plugin parameters (separate, bigger feature).
- Multiple reverb flavours (MVerb as a second option is a possible follow-up).

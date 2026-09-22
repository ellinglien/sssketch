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

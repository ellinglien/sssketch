# REAPER: where our automation has to land

Captured from a real project Elling made for this purpose (`doop.RPP`, REAPER 7-era `.rpp`, plain
text). Ground truth for the toolkit spec's "export the automation" mode
(2026-09-22-builtin-sound-toolkit-design.md), alongside the Ableton 12 reference beside this file.

## The four targets

| our curve | where it goes in the .rpp | value units |
|---|---|---|
| clip gain (the dial) | the track's `VOLPAN` line | linear gain |
| `volume` | `<VOLENV2 …>` block inside the `<TRACK …>` | linear gain (1 = 0 dB, 1.90998517 ≈ +5.6 dB) |
| `reverbSend` | `<AUXVOLENV …>` — note it sits on the **receiving** (bus) track, right after that track's `AUXRECV` line naming the source track | linear gain |
| `filterCutoff` | `<PARMENV 0:_Freq_Low_Pass_1 0 1 0.5 "Freq-Low Pass 1 / ReaEQ">` inside the track's ReaEQ `<VST …>` block | **normalised 0…1**, not Hz |
| `filterResonance` | same shape, the band's `BW-…` (bandwidth/Q) parameter | normalised 0…1 |

## Point syntax

```
PT <time in SECONDS> <value> <shape> [selected] [1 = the point starts a new segment]
```

- **Time is in seconds**, unlike Ableton's beats — convert from bars via the project tempo.
- `shape` 0 = linear. Two points at the same time make a step.
- Each envelope block also carries `EGUID` (fresh GUID per envelope), `ACT 1 -1` (active),
  `VIS 1 1 1` (visible), `ARM 1`, `DEFSHAPE 0 -1 -1`, and volume envelopes add `VOLTYPE 1`.

## Devices

- Filter: `<VST "VST: ReaEQ (Cockos)" reaeq.vst.dylib 0 "" 1919247729<5653547265657172656165710…> "">`
  followed by base64 state lines. Band 1 must already be Low Pass for `Freq-Low Pass 1` to sweep;
  the base64 blob carries that, so the exporter should emit a captured ReaEQ state rather than
  synthesise one (same approach as Ableton's Auto Filter template).
- Reverb bus: `<VST "VST: ReaVerbate (Cockos)" reaverbate.vst.dylib 0 "" 1920361016<…> "">` on a
  track named `reverb bus`, receiving with `AUXRECV <source track index> …`.
- `PARM_TCP 0:_Freq_Low_Pass_1` makes the parameter visible in the track panel (optional).

## Sanity checks before shipping the exporter

- A parameter envelope whose name/index doesn't match the plugin's actual parameter silently does
  nothing — verify against a file REAPER itself wrote, as here.
- Send envelopes living on the receiving track is easy to get backwards; our single shared reverb
  maps to one bus track holding every `AUXRECV` plus one `AUXVOLENV` per source.

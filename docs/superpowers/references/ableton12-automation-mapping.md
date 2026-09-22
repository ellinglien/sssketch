# Ableton Live 12: where our automation has to land

Captured from a real project Elling made for this purpose (Live **12.4.6**, `.als` header
`MajorVersion="5" MinorVersion="12.0_12402" SchemaChangeCount="5"`), by drawing one envelope per
parameter we need. This is ground truth for the toolkit spec's "export the automation" mode
(2026-09-22-builtin-sound-toolkit-design.md) — a wrong parameter id yields a device whose
envelope silently does nothing, so verify against a real file rather than guessing.

## The four targets

| our curve | element path in the .als | value units |
|---|---|---|
| clip gain (the dial) | `AudioTrack/DeviceChain/Mixer/Volume` | linear gain (1.0 = 0 dB; 0.66 ≈ −3.6 dB) |
| `volume` | same `Mixer/Volume` parameter, automated | linear gain |
| `reverbSend` | `AudioTrack/DeviceChain/Mixer/Sends/TrackSendHolder[n]/Send` — `n` matches return-track order | linear gain, **min 0.0003162277571** (−70 dB), max 1 |
| `filterCutoff` | `AudioTrack/DeviceChain/DeviceChain/Devices/AutoFilter2/Filter_Frequency` | **real Hz**, range 19.9999981 … 19999.9961 |
| `filterResonance` | same device, `Filter_Resonance` | 0 … 1 |

Related device fields worth knowing: `Filter_Type` (0…9, picks lowpass/highpass/etc.) and
`Filter_Circuit_LP_HP`. The captured device element is saved beside this file as
`ableton12-autofilter2-template.xml` (~21 KB) — an Auto Filter is far too big to synthesise by
hand, so the exporter should emit this template with fresh ids rather than build one.

## How an envelope is written

Per track: `AudioTrack/AutomationEnvelopes/Envelopes/AutomationEnvelope`, with

```xml
<AutomationEnvelope Id="0">
  <EnvelopeTarget><PointeeId Value="22230" /></EnvelopeTarget>
  <Automation><Events>
    <FloatEvent Id="0" Time="-63072000" Value="9999.99805" />   <!-- value before the start -->
    <FloatEvent Id="79" Time="0" Value="9999.99805" />
    <FloatEvent Id="77" Time="0" Value="3842.48413" />          <!-- two events at one Time = a step -->
    ...
  </Events></Automation>
</AutomationEnvelope>
```

- **`PointeeId` must equal the `AutomationTarget Id` inside the parameter element** (e.g.
  `Filter_Frequency/AutomationTarget@Id`). That linkage is the whole trick.
- **`Time` is in beats** (4 = one bar at 4/4), not seconds or bars.
- `Time="-63072000"` is Live's "before the timeline" sentinel carrying the starting value.
- Ids must be unique within the set; `LiveSet/NextPointeeId` has to stay above every id used.

## Returns

The captured set has return tracks `A-Reverb`, `B-Delay`, `C-Reverb`. Our single shared reverb
maps to ONE return track holding a stock Reverb, with each track's `TrackSendHolder` for that
return carrying the `reverbSend` curve — the same shape as our engine's one-bus design.

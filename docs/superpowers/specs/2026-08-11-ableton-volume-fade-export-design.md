# Ableton-Matched Volume/Fade Export — Design

**Status:** Drafted through the brainstorming skill with Elling. Started as a broader question
("adapt sssketch's volume system to replicate Ableton's, since Ableton is the ultimate output
goal") and was narrowed live during the conversation once source-tracing showed the gap was much
smaller than it first looked.

## Background

sssketch's Ableton export (`src/main/ableton/buildAlsXml.ts`) currently carries over mute regions
(as real gaps — see `docs/superpowers/plans/*region-mute*`) and bus/color assignment, but nothing
about volume or fades — the exported `.als`'s `SampleVolume` and `Fade`/`FadeInLength`/
`FadeOutLength` fields are left at the template's untouched defaults (`1`, `false`, `0`, `0`).

Investigating what it would take to change that turned up a real, useful fact: sssketch's own
volume and fade **audio math is already Ableton-compatible in units** —
- `stem.volume` (native-engine `EngineProject.h`) is a plain linear multiplier, default `1.0`,
  applied directly to samples with no dB conversion — the exact same units as the `.als`
  template's `SampleVolume Value="1"` field.
- The actual fade shape (`native-engine/Source/FadeGain.cpp`'s `buildFadePoints`) is already a
  straight linear ramp (`isRamp: true` → linear interpolation in `evaluateGainAtTime`) — there is
  no curve in the real audio today.

The one place a curve genuinely exists is cosmetic: `envelope.ts`'s `envelopeCurveD` draws the
on-screen fade shape as a cubic-Bezier S-curve, which has never matched what's actually audible.

Given this, the original "adapt the whole volume system" framing turned out to be mostly already
true under the hood — what's missing is (1) making the on-screen curve honest about what's
already linear, and (2) actually writing the values into the export. No native engine, wire
format (`buildEngineProject.ts` / `EngineProject.h` — the project's own documented "hand-synced
pair, HIGH RISK" boundary per root `CLAUDE.md`), or LiveParam changes are needed.

## Goal

Every stem's exported Ableton clip carries its sssketch volume and fade-in/fade-out as native,
still-editable Ableton clip properties (`SampleVolume`, `Fade`, `FadeInLength`/`FadeOutLength`) —
not baked into the audio — and the on-screen fade shape in sssketch's own UI stops implying a
curve that was never actually there.

## Non-goals

- **No new curve-shaping controls.** Elling explicitly declined exposing Ableton's own
  skew/slope fade parameters as new sssketch UI — a straight fade in sssketch, matching a straight
  fade in Ableton, is the whole point.
- **No native engine or wire-format changes.** Both volume and fade are already stored/computed
  in Ableton-compatible units; this is an export-mapping and rendering-only change.
- **No audio baking.** Volume/fade stay editable Ableton clip properties after export, not
  burned into the exported WAV — consistent with Ableton being described as the "ultimate output
  goal" (implying continued mixing there, not a final frozen render).

## Design

### 1. Straighten the on-screen fade curve

`envelope.ts`'s `envelopeCurveD` currently builds a cubic-Bezier `C...C...` path for the fade
in/out shape. Replace it with a plain two-segment straight-line path between the same knee points
(`envelopeKnees`'s `fiEnd`/`foStart`, unchanged) — `M0,height L{fiEnd},{plateauY}
L{foStart},{plateauY} L{width},{height}`. `envelopeKnees` itself, `buildEnvelopePath`, and
`combinedClipPath` need no changes — only the curve-drawing math inside `envelopeCurveD` changes.
This is the only renderer change; it makes the picture match what `FadeGain.cpp` has always
actually done.

### 2. Export volume: one-line mapping

In `buildAlsXml.ts`'s `buildStemClips`, the generated clip template's `SampleVolume` node
(currently left at the template's default `1`) gets set to the stem's own `volume` value — the
same field already threaded into `EngineProject` for playback. `buildStemClips` needs a new
`volume: number` parameter, threaded from the same place its caller (`buildAlsXml`'s per-stem
loop, `buildAlsXml.ts:627-628`) already reads `state.vol[key]` for other per-stem purposes.

### 3. Export fade: per-stem-clip, first/last segment only

sssketch's fade is defined per-**rifff** (`fadeInBars`/`fadeOutBars` on the group, shared across
every stem in it — confirmed via `buildEngineProject.ts:218-219`), not per-stem. `buildStemClips`
already splits a stem into multiple clip segments when muted regions are present
(`audibleSegments`, `buildAlsXml.ts:367`) — matching `FadeGain.cpp`'s own `isFirstSegment`/
`isLastSegment` gating, fade-in is written only onto the clip for a stem's first audible segment,
and fade-out only onto its last (a middle segment between two mute gaps gets neither).

For each affected clip: set `Fade Value="true"`, set `FadeInLength`/`FadeOutLength` to the
bars-to-[unit] conversion of `fadeInBars`/`fadeOutBars` (see the open question below), and leave
`FadeInCurveSkew`/`FadeInCurveSlope`/`FadeOutCurveSkew`/`FadeOutCurveSlope` at the template's
existing `0` — a straight line, matching both the real audio and the straightened on-screen curve
from Section 1. `buildStemClips` needs two new parameters (`fadeInBars: number`,
`fadeOutBars: number`), threaded from the same per-rifff values `buildEngineProject.ts` already
reads.

### Real open question: `FadeInLength`/`FadeOutLength`'s actual unit — needs real verification

Every other timing field this codebase already writes into the `.als`
(`CurrentStart`/`CurrentEnd`/`Time`/`WarpMarker BeatTime`) is in **arrangement beats**. But
`FadeInLength`/`FadeOutLength` are a known Ableton Live Set XML quirk: in every real `.als` this
kind of field has been documented from, they're stored as an absolute **sample count at the
source file's own sample rate**, not beats or seconds — a different unit convention than the rest
of this same clip's fields. This has NOT been verified against a real Ableton-opened export in
this session (no Ableton available in this environment) — it's stated here as the working
hypothesis to implement against, not asserted with false confidence, matching this session's own
established pattern (the electron-builder `-c` merge-vs-replace assumption and the
`dist/mac-x64` path assumption both turned out to need real verification, not guessing).

If the samples-at-source-rate hypothesis is correct: `readWavHeaderBytes` (already in
`src/main/importRifff.ts`, used elsewhere for stem import) gives the real sample rate to compute
`fadeInBars * secPerBar(projectBpm) * stemSampleRate` (a plain seconds-to-samples conversion once
`secPerBar` is known — `buildAlsXml.ts` already computes bar/beat timing elsewhere in this same
function, so this reuses existing math, not new).

**Verification plan:** after implementation, Elling opens a real exported `.als` in actual
Ableton and confirms (a) the fade handles appear at the correct on-screen length/position for a
known `fadeInBars` value at a known bpm, and (b) the fade audibly matches. If the unit hypothesis
is wrong, the fix is confined to the one conversion computation in `buildStemClips` — nothing
else in this design depends on which unit turns out to be correct.

## Testing

`buildAlsXml.test.ts` (existing suite) gets new cases: a stem with non-default `volume` produces
the expected `SampleVolume` value; a rifff with `fadeInBars`/`fadeOutBars` produces `Fade
Value="true"` with the expected `FadeInLength`/`FadeOutLength` on the first/last segment only
(not on a middle segment, when muted regions split a stem into 3+ segments); a stem/rifff with no
volume or fade override produces the template's untouched defaults (`1`/`false`/`0`) — regression
coverage for existing exports. `envelope.test.ts` (if one doesn't already exist alongside
`envelope.ts`, check first) gets a case confirming `envelopeCurveD`'s output is the new
straight-line path shape. The unit-conversion hypothesis itself is verified manually, per the
Real Open Question section above — no automated test can confirm what a closed-source binary
format actually expects without a real Ableton-opened file to compare against, consistent with
this project's own established testing conventions for exactly this class of unknown.

## Follow-up (not part of this work)

None identified — this is a self-contained, bounded change.

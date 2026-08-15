# Record-Mode VU Meter — Design

**Status:** Approved by Elling, ready for implementation planning.

## Goal

Replace the live-recording waveform overlay in `ChannelRow.tsx` (both manual/armed loop-recording and gated/threshold recording) with a two-line stereo VU meter — a genuine live-level indicator instead of a growing "here's what's been captured" waveform.

## Background

Today, while a channel is recording, `ChannelRow.tsx` renders a live-updating SVG waveform overlay fed by peak data streamed from the native engine at 30Hz (`capture-level-update` for manual/armed recording, `gated-recording-update` for gated recording — see `IpcServer.cpp`'s per-connection timer). This waveform grows left-to-right as buckets of captured audio arrive (manual mode) or redraws a fixed-length buffer wholesale each poll (gated mode). Full investigation of the current mechanism — components, IPC path, geometry, and the original design rationale — is recorded in this session's research; the short version: it was built specifically to give "it's building up" progress feedback, reusing the same peak-bucket → waveform-bar rendering already used for finished clips. No VU-meter/level-display concept exists anywhere else in this codebase today.

Elling wants a true live level meter instead: "the whole record region in the channel can turn into a VU meter until it's committed." Explored via the visual-companion tool; the final direction below was arrived at through several rounds of mockup iteration.

## Visual design

Two thin horizontal bars, stacked directly against each other with no gap (L on top, R below — 5px each, no border/outline), positioned near the bottom of the channel lane (the same `top: NAME_BAR_HEIGHT (18px), height: ROW_HEIGHT (44px)` lane a finished clip's waveform occupies). Each bar fills left-to-right, independently, from its own channel's current input level.

The bars appear at their full final width and position **the instant the channel arms** — not growing over time. This is possible because the record region's bounds are already known at arm time for both modes: manual/armed recording already snapshots `armedLoopRegion` at arm time (unchanged from today), and gated recording already spans the whole selected `loopRegion` for its entire duration (unchanged from today). Only the *fill* is live; the *region* is static once armed.

Color: `var(--ra-recording-live)` (`#8f7dd4`), the existing dedicated "recording" purple already used by the current overlay and by a committed take's waveform afterward — unchanged, no new color introduced, and no clip/near-max color change (stays purple at all levels, matching this app's existing "color only for audio info, no extra warning chrome" design-system rule and its established "no glow/flicker" precedent for this exact overlay).

Applies to **both** recording modes — manual/armed and gated — replacing the live waveform overlay in both of `ChannelRow.tsx`'s existing overlay blocks with this same meter component.

## Level mapping: dB scale, peak-hold + decay

**Scale:** the raw peak values streamed from the engine are linear amplitude (0..~1). Fill width is computed from a log/dB conversion (`20 * log10(peak)`, clamped to a floor around -60dB mapped to 0% width, 0dB mapped to 100% width) rather than linear amplitude directly — linear amplitude compresses normal playing/talking level into a barely-visible sliver near the bottom of the range, which would make the meter look "dead" during ordinary use. This conversion happens in the renderer (`ChannelRow.tsx`), not the native engine — the engine keeps streaming raw linear peaks, unchanged in kind.

**Ballistics:** the bar does not track the raw 30Hz-polled value directly (which would look flickery on percussive/noisy input). Instead, it implements classic VU-meter peak-hold-and-decay: on receiving a new peak reading, if it's louder than the bar's current displayed value, jump to it immediately; otherwise ease the displayed value down toward the new (quieter) reading over roughly 300–500ms rather than snapping down instantly. This is renderer-side state (a small hook or effect in `ChannelRow.tsx`, one displayed-value-plus-last-update-timestamp pair per channel, per L/R), not anything the native engine needs to know about.

## Data: native engine changes required

This is the one piece of native work this feature needs, and it's a genuine simplification of what exists today, not just an addition.

**What's needed:** per-channel (L and R) peak levels instead of the current combined-across-channels single value. `LoopRecorder::peaksFixedWindow(double bucketDurationSec)` and `GatedLoopRecorder::peaks(int count)` both currently do `peak = std::max(peak, std::abs(data[i]))` across **all** channels in the loop `for (int ch = 0; ch < buffer.getNumChannels(); ++ch)` (`LoopRecorder.cpp:77-81, 105-109`) — collapsing stereo into one number. Splitting requires tracking two separate running-max accumulators (one per channel index 0 and 1) instead of one combined accumulator, in both classes.

**What's no longer needed, and can be dropped:** the entire "array of historical buckets" mechanism. Today's `peaksFixedWindow`/`peaks(128)` return a growing/fixed-size *array* because the old overlay needed to redraw a history of bars. The new meter only ever needs the **current** level per channel — a single float pair, not an array — because it doesn't grow or show history at all; it's a live needle, not a strip chart. Concretely:
- New methods replacing the old ones for this purpose: `LoopRecorder::currentPeaks() const` and `GatedLoopRecorder::currentPeaks() const`, each returning the peak-per-channel (`{float l; float r;}`, or two floats) captured since the last time this method was called — the same "windowed since last poll" semantics `peaksFixedWindow`'s most-recent bucket already has, just without accumulating history.
- The IPC payloads shrink correspondingly. `capture-level-update`'s payload becomes `{ channelId, peakL, peakR }` (dropping `peaksSoFar` and `elapsedSeconds` — confirmed via `ChannelRow.tsx` that both fields exist ONLY to size the old overlay's growing width, which the new fixed-size meter doesn't do; `LIVE_CAPTURE_BUCKET_SECONDS` becomes dead code and should be removed). `gated-recording-update`'s payload becomes `{ peakL, peakR }` (dropping the 128-element `peaks` array).
- This is message-thread/timer-polled code (`IpcServer.cpp`'s existing 30Hz `timerCallback`, unchanged in structure), not inside the real-time audio callback — a contained change, not the HIGH RISK category this codebase reserves for actual audio-thread work.

**Renderer/main/preload changes:** `src/main/index.ts`'s existing relay code (`subscribeToCaptureLevelUpdates`/`subscribeToGatedRecordingUpdates`) and `src/preload/index.ts`'s existing `onCaptureLevelUpdate`/`onGatedRecordingUpdate` bridges keep their names and structure, just carry the new smaller payload shape (`{channelId, peakL, peakR}` / `{peakL, peakR}` instead of the array-based ones).

## Component changes

`ChannelRow.tsx`'s two existing overlay blocks (manual/armed around the current `capturePeaks` state, gated around `gatedPeaks`) are replaced by one shared meter-rendering piece (new small component or extracted render function, used from both places) that:
1. Takes the region's static bounds (already computed today — `armedLoopRegion` for manual, `loopRegion` for gated) to position/size the two-bar container once, at arm time.
2. Subscribes to the (now-simplified) `onCaptureLevelUpdate`/`onGatedRecordingUpdate` callbacks, feeding raw `{peakL, peakR}` pairs into the peak-hold-and-decay + dB-conversion logic described above.
3. Renders two `<rect>`s (reusing the existing SVG-overlay approach, `pointerEvents: none`, same z-order-after-clips-in-DOM convention as today) whose widths reflect the two channels' current displayed (post-hold-and-decay) levels.

What's unchanged: arm/disarm flow, the commit transition (disarm → import → shelf → move-to-channel, including the brief "nothing visible" gap between disarm and the finished clip appearing — out of scope for this feature), gated recording's lock-in flow, and both modes' existing region-bounds-at-arm-time logic.

## Testing

Following this codebase's own established convention (root `CLAUDE.md`'s Testing conventions): the native peak-computation changes (`currentPeaks()` on both recorder classes) are unit-testable via JUCE's `--test` flag with a synthetic stereo buffer of known amplitude per channel, verifying the two returned peaks are independent and correctly per-channel (not `std::max`-combined). The dB-conversion and peak-hold-and-decay logic in the renderer, if extracted as a pure function (recommended — e.g. a small `meterBallistics.ts` in `src/renderer/src/audio/` or similar, taking `(currentDisplayValue, newPeak, elapsedMs)` and returning the next displayed value), is real-TDD-testable via `vitest`, matching this codebase's convention that pure logic gets real unit tests. The end-to-end "does the meter actually move correctly against real recorded audio" claim is, per this codebase's own documented convention, a manual-walkthrough item, not something faked with mocks.

## Non-goals (explicitly out of scope for this design)

- No clip/near-max warning color — stays purple throughout, per Elling's explicit choice.
- No change to the post-commit transition gap (disarm → brief empty state → finished clip) — unrelated to this feature.
- No change to arm/disarm interaction, gated recording's threshold/lock-in logic, or either mode's region-bounds-at-arm-time behavior.

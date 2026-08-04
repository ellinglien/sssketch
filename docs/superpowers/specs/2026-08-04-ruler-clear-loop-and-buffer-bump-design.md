# Ruler Double-Click Clears Loop + Buffer Size Bump

**Status:** approved, ready for implementation plan.

Two small, independent fixes, bundled as one "quick wins" pass ahead of larger work
(live-drag-preview, real snap-to-grid, shift-drag mute-region — each getting its own
spec/plan cycle).

## 1. Ruler double-click clears the loop region

**Problem:** `Ruler.tsx` has no `onDoubleClick` handler at all today. A double-click just fires
two independent mousedown/mouseup pairs through the existing single-click handler, which
scrubs the playhead twice — no way to clear an active loop region once one's been drawn.

**Fix:** Add an `onDoubleClick` handler to the Ruler's outer container:

```ts
onDoubleClick={() => {
  if (loopRegion) onSetLoopRegion(null)
}}
```

`loopRegion`'s type (`LoopRegion = { startBar: number; endBar: number } | null`, `store.ts:44`)
already permits `null`, and the reducer's `SET_LOOP_REGION` case already handles it
(`state.ts:903-904` — a plain assignment, no special-casing needed). Nothing else changes:
`Transport.cpp`'s `renderLoopAware` already falls back to looping the whole project
(`loopLengthBars`) whenever `loopRegion`/the recording loop is inactive — clearing the region
is the only lever needed to "return to normal," per its own existing behavior.

The `if (loopRegion)` guard avoids dispatching a no-op `SET_LOOP_REGION` (and the undo-history
entry that would create) when there's nothing to clear.

Double-clicking one of the region's own edge-handle divs also clears it — the click event
bubbles up to the outer container regardless of which inner element it started on (only
`onMouseDown` on those handles stops propagation, not click/dblclick). This is acceptable:
matches the literal ask ("double-clicking anywhere in the top timeline bar").

## 2. Buffer size bump

**Problem:** `Transport::openDefaultDevice()` opens the audio device via
`deviceManager.initialiseWithDefaultDevices(1, 2)` with no explicit `AudioDeviceSetup` — the
buffer size is whatever the OS/driver's own default is, with no override anywhere in the
codebase. User reports crackling, consistent with buffer underruns.

**Fix:** After the device opens, pull the current setup, set an explicit larger `bufferSize`,
and reapply it — the same mechanism `Transport::setRecordingInputDevice` already uses (just
requesting 0/"auto" there instead of a specific value):

```cpp
bool Transport::openDefaultDevice()
{
    auto error = deviceManager.initialiseWithDefaultDevices(1, 2);
    if (error.isNotEmpty())
    {
        juce::Logger::writeToLog("Transport: failed to open audio device: " + error);
        return false;
    }

    auto setup = deviceManager.getAudioDeviceSetup();
    setup.bufferSize = kPreferredBufferSize;
    auto bufferSizeError = deviceManager.setAudioDeviceSetup(setup, true);
    if (bufferSizeError.isNotEmpty())
    {
        juce::Logger::writeToLog(
            "Transport: failed to apply preferred buffer size, using device default: "
            + bufferSizeError);
    }

    deviceManager.addAudioCallback(this);
    return true;
}
```

`kPreferredBufferSize = 1024` (samples), a new `constexpr int` alongside this file's existing
`kLoopSeamFadeSec`/`kHaltFadeSec`/`kRepositionFadeSec` constants in the anonymous namespace at
the top of `Transport.cpp`. ~23ms at 44.1kHz — a standard doubling from the typical ~512
default, a common first mitigation for crackle without pushing latency somewhere that'd feel
laggy for this app's use case (creative arranging/sketching, not tight live-monitoring
tracking).

Per `chooseBestBufferSize`'s documented behavior (already relied on and explained at
`Transport.cpp:78-89` for the sample-rate case), an unsupported exact value is *not* an error —
JUCE picks the nearest size the driver actually supports. `setAudioDeviceSetup`'s returned error
string is reserved for genuine failures (e.g. the device rejecting the setup outright), which is
why this call is non-fatal: a failure here logs a warning and keeps using whatever buffer size
the device already had from `initialiseWithDefaultDevices`, rather than tearing down transport
setup entirely.

**Explicitly out of scope:** a user-adjustable buffer-size setting (IPC channel, CLI flag,
settings UI) — noted separately as deferred follow-up work, not part of this fix.

## Testing

- `Ruler.tsx` has no existing component-level tests (per this codebase's own convention —
  React components are verified via typecheck/lint + manual walkthrough, not unit-tested
  directly). Verified manually.
- Buffer size: no native automated test — `AudioDeviceManager`/real device behavior is
  exactly the kind of thing this codebase's own testing conventions call out as manual-only
  (no headless audio hardware in this environment). Verified by running the app and listening
  for the reported crackling to actually reduce/disappear during normal playback.

#pragma once

namespace ssstitch
{
    /** Gain multiplier in [0,1] for an absolute (unwrapped, monotonically
     * increasing) transport position `posBars`, within a project that repeats
     * every `loopLengthBars` bars — ramps linearly down to 0 right at each
     * loop boundary and back up to 1 within `fadeBars` on either side of it.
     *
     * Transport::audioDeviceIOCallbackWithContext applies this to the whole
     * mixed master output right where it wraps positionBars back toward 0,
     * so that wrap never produces a hard discontinuity — regardless of what
     * individual clip or stem happens to be sounding across the seam. This
     * is deliberately independent of, and complementary to, the two other
     * anti-click treatments already in this codebase: FadeGain.cpp handles a
     * single clip's own placed start/end, and LoopSewing.cpp handles a
     * single stem buffer's own internal tiling repeat — neither one has any
     * way to know about the arrangement's own total loop length, which can
     * fall in the middle of an otherwise-unrelated clip.
     *
     * Returns 1.0 (no-op) when loopLengthBars or fadeBars is non-positive,
     * matching Transport's own "0 bars = wrapping disabled" convention. */
    float loopBoundaryGain(double posBars, double loopLengthBars, double fadeBars);
}

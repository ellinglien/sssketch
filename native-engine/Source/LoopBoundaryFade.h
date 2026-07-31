#pragma once

namespace ssstitch
{
    /** Blend coefficient in [0,1] for pulling a tail sample, `distFromEndBars`
     * bars before the loop's own end, toward a fixed anchor value (the
     * incoming lap's own first sample) — 1.0 exactly at the boundary itself
     * (distance 0, fully replaced by the anchor), ramping down to 0.0 by
     * `fadeBars` bars before it (untouched, the tail's own real value).
     *
     * Equal-power shaped, the same formula LoopSewing.cpp already uses to
     * blend a single stem buffer's own tail toward its own head — ported
     * here to the master-mix level, blending the outgoing lap's tail toward
     * the incoming lap's own first sample VALUE rather than toward silence.
     * Blending toward silence (an earlier version of this fix) reproduces
     * the exact "breath"/loudness-dip artifact LoopSewing was written to
     * avoid in the first place — a sustained tone briefly loses energy right
     * at the seam. Blending toward the real destination value instead keeps
     * loudness constant and, since the anchor IS what plays immediately
     * after, lands the last blended sample exactly where playback continues
     * — zero discontinuity, no separate treatment needed for the incoming
     * side.
     *
     * Returns 0.0 (no-op) when fadeBars is non-positive. */
    float loopSeamBlendCoeff(double distFromEndBars, double fadeBars);
}

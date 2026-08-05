// native-engine/Source/MuteRegionGain.h
#pragma once
#include "EngineProject.h"
#include <vector>

namespace sssketch
{
    /** Gain multiplier in [0,1] for `sampleTimeSec` (absolute transport
     * seconds), given a stem's own mute regions (bars, converted to seconds
     * here via `spb` -- NOT pre-converted by the caller, so this can be
     * called directly against stem.muteRegions every sample with no
     * per-block heap allocation, matching this codebase's existing
     * real-time-safety convention for GainRampPoints -- see FadeGain.h's
     * own doc comment on why THAT avoids heap allocation).
     *
     * 1.0 outside every region. Inside a region, 0.0. At a region's edges,
     * ramps linearly over a short fixed window so a mute boundary doesn't
     * click -- same reasoning as FadeGain.cpp's own kMicroFadeSec, but a
     * separate constant/mechanism: GainRampPoints' fixed 4-point capacity
     * is already fully used by a segment's own fade-in/fade-out (see
     * buildFadePoints), and mute regions are a variable-length, per-stem
     * list, not a fixed-shape per-segment curve.
     *
     * Regions may overlap or be adjacent -- this returns the MINIMUM gain
     * across every region that applies at this instant, so an overlap
     * never accidentally leaks audio through (deliberately not merging
     * regions ahead of time; see the design spec's own "Known risks"
     * section on why overlap isn't merged at the data-model layer). */
    double muteRegionGainAt(
        double sampleTimeSec,
        double spb,
        const std::vector<EngineStem::MuteRegion>& regionsBars);
}

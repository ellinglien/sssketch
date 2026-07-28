// native-engine/Source/FadeGain.h
#pragma once
#include <vector>

namespace ssstitch
{
    struct FadeConfig
    {
        double fadeInBars = 0.0;
        double fadeOutBars = 0.0;
        double secPerBar = 0.0;
    };

    /** One gain automation point, mirroring one call to the Web Audio AudioParam
     * methods fadeGain.ts's applyFade schedules. isRamp=false means
     * setValueAtTime (an instantaneous jump/hold); isRamp=true means
     * linearRampToValueAtTime (ramps linearly from the previous point). Points
     * are always emitted in chronological order. */
    struct GainRampPoint
    {
        double value = 0.0;
        double time = 0.0;
        bool isRamp = false;
    };

    /** Direct port of fadeGain.ts's applyFade, as data instead of side effects on
     * an AudioParam — see that file for the fade-clamping rationale, which
     * applies identically here. `when`/`duration` are absolute transport
     * seconds. Returns an empty vector when there's nothing to schedule (e.g.
     * a middle segment, or zero-length fades). */
    std::vector<GainRampPoint> buildFadePoints(
        double when,
        double duration,
        bool isFirstSegment,
        bool isLastSegment,
        bool isFreshStart,
        const FadeConfig& config);

    /** Given the (possibly empty) points buildFadePoints returned, what's the
     * gain at absolute transport time t? Empty points -> flat 1.0. Before the
     * first point or after the last -> holds that point's value. Between two
     * points where the second isRamp -> linear interpolation; otherwise holds
     * the earlier point's value (matches setValueAtTime's "hold until the next
     * scheduled event" semantics). */
    double evaluateGainAtTime(const std::vector<GainRampPoint>& points, double t);
}

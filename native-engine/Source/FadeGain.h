// native-engine/Source/FadeGain.h
#pragma once
#include <array>
#include <cassert>
#include <cstddef>

namespace sssketch
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

    /** Fixed-capacity stand-in for std::vector<GainRampPoint> — buildFadePoints
     * schedules at most 2 points for a fade-in plus 2 for a fade-out (4 total,
     * when a segment is both first and last), a hard ceiling this exists to
     * encode so the real-time audio callback that calls buildFadePoints on
     * every block (PlaybackEngine::renderBlock) never heap-allocates to do it. */
    class GainRampPoints
    {
    public:
        static constexpr size_t maxPoints = 4;

        void push_back(const GainRampPoint& p)
        {
            assert(count < maxPoints);
            if (count < maxPoints)
                points[count++] = p;
        }

        size_t size() const { return count; }
        bool empty() const { return count == 0; }
        const GainRampPoint& operator[](size_t i) const { return points[i]; }
        const GainRampPoint& front() const { return points[0]; }
        const GainRampPoint& back() const { return points[count - 1]; }

    private:
        std::array<GainRampPoint, maxPoints> points{};
        size_t count = 0;
    };

    /** Direct port of fadeGain.ts's applyFade, as data instead of side effects on
     * an AudioParam — see that file for the fade-clamping rationale, which
     * applies identically here. `when`/`duration` are absolute transport
     * seconds. Returns empty when there's nothing to schedule (e.g. a middle
     * segment, or zero-length fades). */
    GainRampPoints buildFadePoints(
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
    double evaluateGainAtTime(const GainRampPoints& points, double t);
}

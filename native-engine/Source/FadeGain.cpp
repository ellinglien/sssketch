#include "FadeGain.h"
#include <algorithm>

namespace ssstitch
{
    namespace
    {
        // An always-on, user-invisible safety net — independent of whatever
        // fadeInBars/fadeOutBars the user has (or hasn't) set. Starting or
        // stopping a sample stream at a non-zero-crossing sample produces an
        // audible click at that exact edge; 3ms is far too short to read as
        // an intentional fade (nothing like the musical fades fadeInBars/
        // fadeOutBars produce), just enough to smooth the discontinuity.
        // Applied as a floor (via std::max below), so a user's own larger
        // fade is never shortened by this — it only fills in when there'd
        // otherwise be none at all.
        constexpr double kMicroFadeSec = 0.003;
    }

    GainRampPoints buildFadePoints(
        double when,
        double duration,
        bool isFirstSegment,
        bool isLastSegment,
        bool isFreshStart,
        const FadeConfig& config)
    {
        GainRampPoints points;

        if (isFirstSegment && isFreshStart)
        {
            const double halfDuration = duration / 2.0;
            const double fadeInSec = std::max(
                std::min(config.fadeInBars * config.secPerBar, halfDuration),
                std::min(kMicroFadeSec, halfDuration));
            if (fadeInSec > 0.0)
            {
                points.push_back({ 0.0, when, false });
                points.push_back({ 1.0, when + fadeInSec, true });
            }
        }
        if (isLastSegment)
        {
            const double halfDuration = duration / 2.0;
            const double fadeOutSec = std::max(
                std::min(config.fadeOutBars * config.secPerBar, halfDuration),
                std::min(kMicroFadeSec, halfDuration));
            if (fadeOutSec > 0.0)
            {
                const double endTime = when + duration;
                points.push_back({ 1.0, std::max(when, endTime - fadeOutSec), false });
                points.push_back({ 0.0, endTime, true });
            }
        }
        return points;
    }

    double evaluateGainAtTime(const GainRampPoints& points, double t)
    {
        if (points.empty())
            return 1.0;
        if (t <= points.front().time)
            return points.front().value;
        if (t >= points.back().time)
            return points.back().value;

        for (size_t i = 0; i + 1 < points.size(); ++i)
        {
            const auto& a = points[i];
            const auto& b = points[i + 1];
            if (t < a.time || t > b.time)
                continue;
            if (!b.isRamp)
                return a.value; // hold flat until the next scheduled event
            const double span = b.time - a.time;
            if (span <= 0.0)
                return b.value;
            const double frac = (t - a.time) / span;
            return a.value + (b.value - a.value) * frac;
        }
        return points.back().value;
    }
}

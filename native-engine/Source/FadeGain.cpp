#include "FadeGain.h"
#include <algorithm>

namespace ssstitch
{
    std::vector<GainRampPoint> buildFadePoints(
        double when,
        double duration,
        bool isFirstSegment,
        bool isLastSegment,
        bool isFreshStart,
        const FadeConfig& config)
    {
        std::vector<GainRampPoint> points;

        if (isFirstSegment && isFreshStart && config.fadeInBars > 0.0)
        {
            const double fadeInSec = std::min(config.fadeInBars * config.secPerBar, duration / 2.0);
            points.push_back({ 0.0, when, false });
            points.push_back({ 1.0, when + fadeInSec, true });
        }
        if (isLastSegment && config.fadeOutBars > 0.0)
        {
            const double fadeOutSec = std::min(config.fadeOutBars * config.secPerBar, duration / 2.0);
            const double endTime = when + duration;
            points.push_back({ 1.0, std::max(when, endTime - fadeOutSec), false });
            points.push_back({ 0.0, endTime, true });
        }
        return points;
    }

    double evaluateGainAtTime(const std::vector<GainRampPoint>& points, double t)
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

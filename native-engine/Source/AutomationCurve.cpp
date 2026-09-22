// native-engine/Source/AutomationCurve.cpp
#include "AutomationCurve.h"

namespace sssketch
{
    double evaluateAutomation(const std::vector<AutomationPoint>& points, double bar, double fallback)
    {
        if (points.empty())
            return fallback;
        // A NaN/Infinity position (a corrupted project file, or a transport
        // that has gone non-finite) would make every comparison below false
        // and fall through to the last point's value, which is a silently
        // wrong answer rather than an obviously wrong one. Bail to the
        // channel's own static setting instead -- the same defensive posture
        // PlaybackEngine.cpp already takes for a non-finite leftCropBars.
        if (!std::isfinite(bar))
            return fallback;

        if (bar <= points.front().bar)
            return points.front().value; // hold before the first point
        if (bar >= points.back().bar)
            return points.back().value; // hold after the last point

        // `bar >= b.bar` (not `>`) is what makes a vertical step read the way a
        // drawn curve looks: two points stacked on the same bar (a hand-drawn
        // curve's own simplification can produce these, and a hand-edited file
        // certainly can) mean "jump here", and at exactly that bar the NEW
        // value is the right answer. Skipping every segment that ENDS at or
        // before `bar` lands on the first segment that genuinely contains it,
        // so a duplicate bar resolves to the later point automatically rather
        // than needing a special case.
        for (size_t i = 1; i < points.size(); ++i)
        {
            const auto& b = points[i];
            if (bar >= b.bar)
                continue;
            const auto& a = points[i - 1];
            const double span = b.bar - a.bar;
            // Defensive only -- with the skip rule above, a zero-span segment
            // can only be reached from points that aren't sorted ascending
            // (parseEngineProject sorts, so that means a direct construction
            // in a test or future caller). Step rather than divide by zero.
            if (span <= 0.0)
                return b.value;
            const double t = (bar - a.bar) / span;
            return a.value + (b.value - a.value) * t;
        }

        // Unreachable given the >= points.back().bar guard above; here so
        // every path returns a value rather than relying on that proof.
        return points.back().value;
    }
}

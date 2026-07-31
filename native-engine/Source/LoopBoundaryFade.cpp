#include "LoopBoundaryFade.h"
#include <algorithm>
#include <cmath>

namespace ssstitch
{
    float loopBoundaryGain(double posBars, double loopLengthBars, double fadeBarsIn)
    {
        if (loopLengthBars <= 0.0 || fadeBarsIn <= 0.0)
            return 1.0f;

        // Clamped the same way FadeGain.cpp clamps its own fade durations to
        // half the segment length — a degenerate (very short) loop should
        // never leave gain permanently below 1.0 partway through.
        const double fadeBars = std::min(fadeBarsIn, loopLengthBars / 2.0);

        double phase = std::fmod(posBars, loopLengthBars);
        if (phase < 0.0)
            phase += loopLengthBars;

        const double dist = std::min(phase, loopLengthBars - phase);
        if (dist >= fadeBars)
            return 1.0f;
        return (float) (dist / fadeBars);
    }
}

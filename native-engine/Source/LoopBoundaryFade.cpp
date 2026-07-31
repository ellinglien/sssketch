#include "LoopBoundaryFade.h"
#include <cmath>

namespace ssstitch
{
    float loopSeamBlendCoeff(double distFromEndBars, double fadeBars)
    {
        if (fadeBars <= 0.0)
            return 0.0f;
        if (distFromEndBars <= 0.0)
            return 1.0f;
        if (distFromEndBars >= fadeBars)
            return 0.0f;

        // Same parameterization as LoopSewing.cpp's own blend: t sweeps from
        // -1 (right at the boundary, distFromEndBars=0) to +1 (the far edge
        // of the window, distFromEndBars=fadeBars).
        const double t = -1.0 + (distFromEndBars / fadeBars) * 2.0;
        return (float) std::sqrt(0.5 * (1.0 - t));
    }
}

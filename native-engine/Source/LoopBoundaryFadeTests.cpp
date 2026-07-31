#include "LoopBoundaryFade.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    class LoopBoundaryFadeTests : public juce::UnitTest
    {
    public:
        LoopBoundaryFadeTests() : juce::UnitTest("LoopBoundaryFade") {}

        void runTest() override
        {
            beginTest("is 1.0 (no-op) well away from any loop boundary");
            {
                expectWithinAbsoluteError(loopBoundaryGain(4.0, 8.0, 0.01), 1.0f, 1.0e-6f);
            }

            beginTest("is exactly 0.0 right at the loop boundary");
            {
                expectWithinAbsoluteError(loopBoundaryGain(8.0, 8.0, 0.01), 0.0f, 1.0e-6f);
            }

            beginTest("ramps back up to 1.0 within fadeBars just after wrapping to 0");
            {
                expectWithinAbsoluteError(loopBoundaryGain(0.0, 8.0, 0.01), 0.0f, 1.0e-6f);
                expectWithinAbsoluteError(loopBoundaryGain(0.005, 8.0, 0.01), 0.5f, 1.0e-3f);
                expectWithinAbsoluteError(loopBoundaryGain(0.01, 8.0, 0.01), 1.0f, 1.0e-6f);
            }

            beginTest("ramps down toward 0.0 approaching the boundary from before it");
            {
                expectWithinAbsoluteError(loopBoundaryGain(7.995, 8.0, 0.01), 0.5f, 1.0e-3f);
            }

            beginTest("handles a position several laps into the loop the same as the first lap");
            {
                const float first = loopBoundaryGain(0.005, 8.0, 0.01);
                const float later = loopBoundaryGain(8.0 * 37.0 + 0.005, 8.0, 0.01);
                expectWithinAbsoluteError(later, first, 1.0e-6f);
            }

            beginTest("is a no-op when loop length is 0 (wrapping disabled)");
            {
                expectWithinAbsoluteError(loopBoundaryGain(0.0, 0.0, 0.01), 1.0f, 1.0e-6f);
            }

            beginTest("is a no-op when fadeBars is 0");
            {
                expectWithinAbsoluteError(loopBoundaryGain(8.0, 8.0, 0.0), 1.0f, 1.0e-6f);
            }

            beginTest("clamps an oversized fade window to half the loop length");
            {
                // fadeBars (100) far exceeds loopLengthBars/2 (1.0) -- the
                // midpoint of the loop should still reach full gain.
                expectWithinAbsoluteError(loopBoundaryGain(1.0, 2.0, 100.0), 1.0f, 1.0e-6f);
            }
        }
    };

    static LoopBoundaryFadeTests loopBoundaryFadeTests;
}

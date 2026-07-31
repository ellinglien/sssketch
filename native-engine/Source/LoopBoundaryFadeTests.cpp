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
            beginTest("is exactly 1.0 (fully the anchor) right at the boundary");
            {
                expectWithinAbsoluteError(loopSeamBlendCoeff(0.0, 0.01), 1.0f, 1.0e-6f);
            }

            beginTest("is exactly 0.0 (untouched) at the far edge of the window");
            {
                expectWithinAbsoluteError(loopSeamBlendCoeff(0.01, 0.01), 0.0f, 1.0e-6f);
            }

            beginTest("is 0.0 well before the window even starts");
            {
                expectWithinAbsoluteError(loopSeamBlendCoeff(1.0, 0.01), 0.0f, 1.0e-6f);
            }

            beginTest("is partway blended at the midpoint of the window");
            {
                const float mid = loopSeamBlendCoeff(0.005, 0.01);
                expect(mid > 0.0f && mid < 1.0f);
            }

            beginTest("increases monotonically as the sample approaches the boundary");
            {
                const float far = loopSeamBlendCoeff(0.008, 0.01);
                const float near = loopSeamBlendCoeff(0.002, 0.01);
                expect(near > far);
            }

            beginTest("is a no-op (0.0) when fadeBars is non-positive");
            {
                expectWithinAbsoluteError(loopSeamBlendCoeff(0.0, 0.0), 0.0f, 1.0e-6f);
                expectWithinAbsoluteError(loopSeamBlendCoeff(0.005, -1.0), 0.0f, 1.0e-6f);
            }

            beginTest("treats a negative distance the same as zero (fully the anchor)");
            {
                expectWithinAbsoluteError(loopSeamBlendCoeff(-0.001, 0.01), 1.0f, 1.0e-6f);
            }
        }
    };

    static LoopBoundaryFadeTests loopBoundaryFadeTests;
}

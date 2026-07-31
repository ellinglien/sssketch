#include "LoopSewing.h"
#include <juce_core/juce_core.h>
#include <cmath>

namespace ssstitch
{
    class LoopSewingTests : public juce::UnitTest
    {
    public:
        LoopSewingTests() : juce::UnitTest("LoopSewing") {}

        void runTest() override
        {
            beginTest("the very last sample becomes exactly equal to the very first (zero discontinuity at the seam)");
            {
                juce::AudioBuffer<float> buffer(1, 1000);
                for (int i = 0; i < 1000; ++i)
                    buffer.setSample(0, i, (float) i); // a ramp, easy to reason about
                applyLoopSewingBlend(buffer, 128);
                expectWithinAbsoluteError(buffer.getSample(0, 999), buffer.getSample(0, 0), 1.0e-5f);
            }

            beginTest("leaves samples outside the window untouched");
            {
                juce::AudioBuffer<float> buffer(1, 1000);
                for (int i = 0; i < 1000; ++i)
                    buffer.setSample(0, i, (float) i);
                applyLoopSewingBlend(buffer, 128);
                // Sample 999 - 128 = 871 is the first one OUTSIDE the blended
                // window (i would be 128 there, the loop only runs i < 128).
                expectWithinAbsoluteError(buffer.getSample(0, 871), 871.0f, 1.0e-5f);
                expectWithinAbsoluteError(buffer.getSample(0, 0), 0.0f, 1.0e-5f); // start itself never touched
            }

            beginTest("blend tapers smoothly from the original tail toward the start value");
            {
                juce::AudioBuffer<float> buffer(1, 1000);
                for (int i = 0; i < 1000; ++i)
                    buffer.setSample(0, i, 100.0f); // constant, except sample 0
                buffer.setSample(0, 0, 0.0f); // start value distinctly different from the rest
                applyLoopSewingBlend(buffer, 128);
                // Right at the seam: fully blended to the start value (0).
                expectWithinAbsoluteError(buffer.getSample(0, 999), 0.0f, 1.0e-4f);
                // Midway through the window: partially blended (between the
                // two extremes, not equal to either).
                const float mid = buffer.getSample(0, 999 - 64);
                expect(mid > 1.0f && mid < 99.0f);
                // Just outside the window: untouched original value.
                expectWithinAbsoluteError(buffer.getSample(0, 871), 100.0f, 1.0e-4f);
            }

            beginTest("applies identically to every channel");
            {
                juce::AudioBuffer<float> buffer(2, 1000);
                for (int i = 0; i < 1000; ++i)
                {
                    buffer.setSample(0, i, (float) i);
                    buffer.setSample(1, i, (float) i * 2.0f);
                }
                applyLoopSewingBlend(buffer, 128);
                expectWithinAbsoluteError(buffer.getSample(0, 999), buffer.getSample(0, 0), 1.0e-5f);
                expectWithinAbsoluteError(buffer.getSample(1, 999), buffer.getSample(1, 0), 1.0e-5f);
            }

            beginTest("no-ops for a buffer too short to have a clean window (guards against overlap)");
            {
                juce::AudioBuffer<float> buffer(1, 200); // <= 128*2
                for (int i = 0; i < 200; ++i)
                    buffer.setSample(0, i, (float) i);
                applyLoopSewingBlend(buffer, 128);
                for (int i = 0; i < 200; ++i)
                    expectWithinAbsoluteError(buffer.getSample(0, i), (float) i, 1.0e-5f);
            }
        }
    };

    static LoopSewingTests loopSewingTests;
}

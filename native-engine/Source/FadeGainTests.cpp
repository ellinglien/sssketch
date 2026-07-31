#include "FadeGain.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    class FadeGainTests : public juce::UnitTest
    {
    public:
        FadeGainTests() : juce::UnitTest("FadeGain") {}

        void runTest() override
        {
            const FadeConfig config { 1.0, 1.0, 2.0 }; // 2 sec/bar -> 2 sec fades

            beginTest("schedules a fade-in ramp at a fresh first segment");
            {
                auto points = buildFadePoints(10.0, 8.0, true, false, true, config);
                expectEquals((int) points.size(), 2);
                expectEquals(points[0].value, 0.0); expectEquals(points[0].time, 10.0); expect(!points[0].isRamp);
                expectEquals(points[1].value, 1.0); expectEquals(points[1].time, 12.0); expect(points[1].isRamp);
            }

            beginTest("schedules a fade-out ramp at the last segment");
            {
                auto points = buildFadePoints(10.0, 8.0, false, true, true, config);
                expectEquals((int) points.size(), 2);
                expectEquals(points[0].value, 1.0); expectEquals(points[0].time, 16.0); // endTime(18) - 2s
                expectEquals(points[1].value, 0.0); expectEquals(points[1].time, 18.0);
            }

            beginTest("schedules both when a single segment is both first and last");
            {
                auto points = buildFadePoints(0.0, 8.0, true, true, true, config);
                expectEquals((int) points.size(), 4);
            }

            beginTest("does nothing for a middle segment (neither first nor last)");
            {
                auto points = buildFadePoints(10.0, 8.0, false, false, true, config);
                expect(points.empty());
            }

            beginTest("skips fade-in when resuming mid-segment, but still applies fade-out");
            {
                auto points = buildFadePoints(10.0, 8.0, true, true, false, config);
                expectEquals((int) points.size(), 2);
                expectEquals(points[0].value, 1.0); expectEquals(points[0].time, 16.0);
                expectEquals(points[1].value, 0.0); expectEquals(points[1].time, 18.0);
            }

            beginTest("clamps an oversized fade to half the segment duration, never overlapping");
            {
                // fadeInBars/fadeOutBars imply 2s each, but duration is only 2s total ->
                // each fade clamps to 1s (half), landing back-to-back with no overlap.
                auto points = buildFadePoints(0.0, 2.0, true, true, true, config);
                expectEquals((int) points.size(), 4);
                expectEquals(points[0].value, 0.0); expectEquals(points[0].time, 0.0);
                expectEquals(points[1].value, 1.0); expectEquals(points[1].time, 1.0);
                expectEquals(points[2].value, 1.0); expectEquals(points[2].time, 1.0);
                expectEquals(points[3].value, 0.0); expectEquals(points[3].time, 2.0);
            }

            beginTest("still applies a tiny (3ms) anti-click floor even when fade bars are zero");
            {
                const FadeConfig zero { 0.0, 0.0, 2.0 };
                auto points = buildFadePoints(0.0, 8.0, true, true, true, zero);
                expectEquals((int) points.size(), 4);
                expectEquals(points[0].value, 0.0); expectEquals(points[0].time, 0.0);
                expectWithinAbsoluteError(points[1].time, 0.003, 1.0e-9);
                expectEquals(points[1].value, 1.0);
                expectWithinAbsoluteError(points[2].time, 8.0 - 0.003, 1.0e-9);
                expectEquals(points[2].value, 1.0);
                expectEquals(points[3].value, 0.0); expectEquals(points[3].time, 8.0);
            }

            beginTest("the anti-click floor never shortens a user's own larger configured fade");
            {
                // config has 2s fades, far bigger than the 3ms floor -> floor is a no-op here.
                auto points = buildFadePoints(0.0, 8.0, true, true, true, config);
                expectEquals((int) points.size(), 4);
                expectEquals(points[1].time, 2.0);
                expectEquals(points[2].time, 6.0);
            }

            beginTest("the anti-click floor itself still clamps to half the segment for a very short segment");
            {
                const FadeConfig zero { 0.0, 0.0, 2.0 };
                // 2ms segment -> half is 1ms, smaller than the 3ms floor.
                auto points = buildFadePoints(0.0, 0.002, true, true, true, zero);
                expectEquals((int) points.size(), 4);
                expectWithinAbsoluteError(points[1].time, 0.001, 1.0e-9);
                expectWithinAbsoluteError(points[2].time, 0.001, 1.0e-9);
            }

            beginTest("evaluateGainAtTime interpolates and holds correctly");
            {
                auto points = buildFadePoints(10.0, 8.0, true, true, true, config);
                expectWithinAbsoluteError(evaluateGainAtTime(points, 10.0), 0.0, 1.0e-9);   // fade-in start
                expectWithinAbsoluteError(evaluateGainAtTime(points, 11.0), 0.5, 1.0e-9);   // mid fade-in ramp
                expectWithinAbsoluteError(evaluateGainAtTime(points, 14.0), 1.0, 1.0e-9);   // flat middle
                expectWithinAbsoluteError(evaluateGainAtTime(points, 17.0), 0.5, 1.0e-9);   // mid fade-out ramp
                expectWithinAbsoluteError(evaluateGainAtTime(points, 18.0), 0.0, 1.0e-9);   // fade-out end
                expectWithinAbsoluteError(evaluateGainAtTime(points, 100.0), 0.0, 1.0e-9);  // well after
            }
        }
    };

    static FadeGainTests fadeGainTests;
}

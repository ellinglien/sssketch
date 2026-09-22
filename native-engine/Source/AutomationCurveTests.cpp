// native-engine/Source/AutomationCurveTests.cpp
#include "AutomationCurve.h"
#include <juce_core/juce_core.h>
#include <limits>

namespace sssketch
{
    class AutomationCurveTests : public juce::UnitTest
    {
    public:
        AutomationCurveTests() : juce::UnitTest("AutomationCurve") {}

        void runTest() override
        {
            beginTest("an empty curve falls back to the channel's own static value");
            {
                expectEquals(evaluateAutomation({}, 4.0, 0.25), 0.25);
            }

            beginTest("interpolates linearly between two breakpoints");
            {
                const std::vector<AutomationPoint> points { { 0.0, 0.0 }, { 8.0, 1.0 } };
                expectEquals(evaluateAutomation(points, 0.0, -1.0), 0.0);
                expectEquals(evaluateAutomation(points, 4.0, -1.0), 0.5);
                expectEquals(evaluateAutomation(points, 6.0, -1.0), 0.75);
                expectEquals(evaluateAutomation(points, 8.0, -1.0), 1.0);
            }

            beginTest("interpolates within the correct segment of a multi-point curve");
            {
                const std::vector<AutomationPoint> points {
                    { 0.0, 0.0 }, { 4.0, 1.0 }, { 8.0, 0.5 }, { 12.0, 0.5 }
                };
                expectEquals(evaluateAutomation(points, 2.0, -1.0), 0.5);
                expectEquals(evaluateAutomation(points, 6.0, -1.0), 0.75);
                expectEquals(evaluateAutomation(points, 10.0, -1.0), 0.5);
            }

            beginTest("holds flat before the first point and after the last -- never extrapolates");
            {
                const std::vector<AutomationPoint> points { { 4.0, 0.2 }, { 8.0, 0.8 } };
                expectEquals(evaluateAutomation(points, 0.0, -1.0), 0.2);
                expectEquals(evaluateAutomation(points, -100.0, -1.0), 0.2);
                expectEquals(evaluateAutomation(points, 8.0, -1.0), 0.8);
                expectEquals(evaluateAutomation(points, 1000.0, -1.0), 0.8);
            }

            beginTest("a single-point curve is a constant, not a ramp");
            {
                const std::vector<AutomationPoint> points { { 4.0, 0.3 } };
                expectEquals(evaluateAutomation(points, 0.0, -1.0), 0.3);
                expectEquals(evaluateAutomation(points, 4.0, -1.0), 0.3);
                expectEquals(evaluateAutomation(points, 99.0, -1.0), 0.3);
            }

            beginTest("two points on the same bar step rather than dividing by zero");
            {
                const std::vector<AutomationPoint> points { { 0.0, 0.0 }, { 4.0, 0.0 }, { 4.0, 1.0 }, { 8.0, 1.0 } };
                expectEquals(evaluateAutomation(points, 2.0, -1.0), 0.0);
                expectEquals(evaluateAutomation(points, 4.0, -1.0), 1.0);
                expectEquals(evaluateAutomation(points, 6.0, -1.0), 1.0);
            }

            beginTest("a non-finite position falls back instead of silently reading the last point");
            {
                const std::vector<AutomationPoint> points { { 0.0, 0.0 }, { 8.0, 1.0 } };
                expectEquals(evaluateAutomation(points, std::numeric_limits<double>::quiet_NaN(), 0.42), 0.42);
                expectEquals(evaluateAutomation(points, std::numeric_limits<double>::infinity(), 0.42), 0.42);
            }

            beginTest("bar -> sample mapping: a block's samples span exactly the right bars");
            {
                // 60bpm -> 4 sec/bar. 44100 samples = 1 sec = 0.25 bar.
                const double spb = 4.0;
                expectEquals(barAtSample(2.0, 0, 44100.0, spb), 2.0);
                expectWithinAbsoluteError(barAtSample(2.0, 44100, 44100.0, spb), 2.25, 1.0e-12);
                expectWithinAbsoluteError(barAtSample(2.0, 22050, 44100.0, spb), 2.125, 1.0e-12);
                // Degenerate rate/tempo collapses to the block's own start
                // rather than producing inf/NaN on the audio thread.
                expectEquals(barAtSample(2.0, 100, 0.0, spb), 2.0);
                expectEquals(barAtSample(2.0, 100, 44100.0, 0.0), 2.0);
            }

            beginTest("automation evaluated per sample through barAtSample matches the curve");
            {
                // A cutoff sweep from 0 at bar 0 to 1 at bar 1, at 4 sec/bar
                // and 44100Hz -> one bar is 176400 samples.
                const std::vector<AutomationPoint> points { { 0.0, 0.0 }, { 1.0, 1.0 } };
                const double spb = 4.0;
                const double v = evaluateAutomation(points, barAtSample(0.0, 88200, 44100.0, spb), -1.0);
                expectWithinAbsoluteError(v, 0.5, 1.0e-9);
            }

            beginTest("the smoother ramps to a target with no step bigger than a small epsilon");
            {
                ParamSmoother sm;
                sm.reset(44100.0, kAutomationSmoothingSec, 0.0f);
                sm.setTarget(1.0f); // a full-scale jump, the worst case
                float previous = sm.current();
                float biggestStep = 0.0f;
                for (int i = 0; i < 44100; ++i)
                {
                    const float v = sm.next();
                    biggestStep = juce::jmax(biggestStep, std::abs(v - previous));
                    previous = v;
                }
                // 1 - exp(-1/(0.015*44100)) ~= 1.51e-3: a full-scale step is
                // spread over hundreds of samples, which is what "no zipper
                // noise" means concretely.
                expect(biggestStep < 0.002f, "biggest per-sample step was " + juce::String(biggestStep));
                // And it does actually LAND on the target exactly, rather than
                // stalling a hair short of it forever (see next()'s own comment
                // on why a float one-pole otherwise does) -- PlaybackEngine's
                // neutral-means-bypass check depends on this.
                expectEquals(sm.current(), 1.0f);
                expect(sm.isSettled());
            }

            beginTest("the smoother's ramp is sample-rate independent in real time");
            {
                ParamSmoother slow, fast;
                slow.reset(44100.0, kAutomationSmoothingSec, 0.0f);
                fast.reset(96000.0, kAutomationSmoothingSec, 0.0f);
                slow.setTarget(1.0f);
                fast.setTarget(1.0f);
                // One time constant's worth of samples at each rate should
                // land on the same ~63% of the way there.
                slow.advance((int) (kAutomationSmoothingSec * 44100.0));
                fast.advance((int) (kAutomationSmoothingSec * 96000.0));
                expectWithinAbsoluteError(slow.current(), fast.current(), 1.0e-3f);
                expectWithinAbsoluteError(slow.current(), 0.632f, 2.0e-3f);
            }

            beginTest("advance(n) lands exactly where n next() calls would");
            {
                ParamSmoother a, b;
                a.reset(44100.0, kAutomationSmoothingSec, 0.2f);
                b.reset(44100.0, kAutomationSmoothingSec, 0.2f);
                a.setTarget(0.9f);
                b.setTarget(0.9f);
                for (int i = 0; i < 64; ++i) a.next();
                b.advance(64);
                expectWithinAbsoluteError(a.current(), b.current(), 1.0e-5f);
                // advance(0)/advance(-1) are no-ops, not a jump to target.
                const float before = b.current();
                b.advance(0);
                b.advance(-5);
                expectEquals(b.current(), before);
            }

            beginTest("reset() jumps rather than ramping -- a seek isn't an automation move");
            {
                ParamSmoother sm;
                sm.reset(44100.0, kAutomationSmoothingSec, 0.0f);
                sm.setTarget(1.0f);
                sm.advance(100);
                expect(sm.current() > 0.0f && sm.current() < 1.0f);
                sm.reset(44100.0, kAutomationSmoothingSec, 0.75f);
                expectEquals(sm.current(), 0.75f);
                expect(sm.isSettled());
            }
        }
    };

    static AutomationCurveTests automationCurveTests;
}

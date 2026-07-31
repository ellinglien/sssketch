#include "Metronome.h"
#include <juce_core/juce_core.h>
#include <cmath>

namespace ssstitch
{
    class MetronomeTests : public juce::UnitTest
    {
    public:
        MetronomeTests() : juce::UnitTest("Metronome") {}

        void runTest() override
        {
            const double secPerBeat = 0.5; // 120bpm, 4/4

            beginTest("silent well between beats");
            {
                expectWithinAbsoluteError(metronomeSampleAt(0.2, secPerBeat), 0.0f, 1.0e-6f);
                expectWithinAbsoluteError(metronomeSampleAt(0.4, secPerBeat), 0.0f, 1.0e-6f);
            }

            beginTest("nonzero within the click window after a beat boundary");
            {
                // Exactly AT a boundary (timeSinceBeatSec=0) is a sine's own
                // zero-crossing — 0.0 is the mathematically correct value
                // there, not a bug; "nonzero" only holds true a moment into
                // the window, once the oscillation is actually underway.
                expect(std::abs(metronomeSampleAt(0.001, secPerBeat)) > 0.0f);
                expect(std::abs(metronomeSampleAt(0.501, secPerBeat)) > 0.0f);
                expect(std::abs(metronomeSampleAt(0.01, secPerBeat)) > 0.0f);
            }

            beginTest("silent again once the click window has fully elapsed");
            {
                expectWithinAbsoluteError(metronomeSampleAt(0.03, secPerBeat), 0.0f, 1.0e-6f);
                expectWithinAbsoluteError(metronomeSampleAt(0.1, secPerBeat), 0.0f, 1.0e-6f);
            }

            beginTest("envelope decays — a sample right at the beat is louder than one just before the click ends");
            {
                const float atStart = std::abs(metronomeSampleAt(0.001, secPerBeat));
                const float nearEnd = std::abs(metronomeSampleAt(0.028, secPerBeat));
                expect(atStart > nearEnd);
            }

            beginTest("beat 0 of every bar (the downbeat) is pitched higher than the other 3 beats");
            {
                // Compare the two clicks' zero-crossing rate over a fixed short
                // window as a simple, deterministic proxy for "higher pitch" —
                // counting sign changes rather than doing a full FFT for a unit
                // test. secPerBeat=0.5 -> beats land at 0.0 (downbeat), 0.5,
                // 1.0, 1.5 (other beats), 2.0 (downbeat again).
                auto countSignChanges = [secPerBeat](double beatStartSec) {
                    int changes = 0;
                    float prev = metronomeSampleAt(beatStartSec, secPerBeat);
                    for (int i = 1; i < 200; ++i)
                    {
                        const double t = beatStartSec + (double) i * (0.03 / 200.0);
                        const float v = metronomeSampleAt(t, secPerBeat);
                        if ((prev < 0.0f) != (v < 0.0f))
                            ++changes;
                        prev = v;
                    }
                    return changes;
                };
                const int downbeatCrossings = countSignChanges(0.0);
                const int otherBeatCrossings = countSignChanges(0.5);
                expect(downbeatCrossings > otherBeatCrossings);
            }

            beginTest("returns 0 for an invalid tempo (secPerBeat <= 0)");
            {
                expectWithinAbsoluteError(metronomeSampleAt(0.0, 0.0), 0.0f, 1.0e-6f);
                expectWithinAbsoluteError(metronomeSampleAt(0.0, -1.0), 0.0f, 1.0e-6f);
            }

            beginTest("returns 0 for a negative sample time");
            {
                expectWithinAbsoluteError(metronomeSampleAt(-0.1, secPerBeat), 0.0f, 1.0e-6f);
            }

            beginTest("stays phase-locked to the bar-0-relative clock arbitrarily far into a long session");
            {
                // A beat boundary many bars in should click identically to the
                // very first one at the same phase — pure function of absolute
                // time, no drift from accumulated per-block state.
                const double farDownbeat = 1000.0 * kMetronomeBeatsPerBar * secPerBeat; // bar 1000
                expectWithinAbsoluteError(
                    metronomeSampleAt(farDownbeat + 0.001, secPerBeat),
                    metronomeSampleAt(0.001, secPerBeat),
                    1.0e-4f);
            }
        }
    };

    static MetronomeTests metronomeTests;
}

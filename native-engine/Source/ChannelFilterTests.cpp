// native-engine/Source/ChannelFilterTests.cpp
#include "ChannelFilter.h"
#include <juce_core/juce_core.h>
#include <cmath>
#include <limits>
#include <vector>

namespace sssketch
{
    namespace
    {
        constexpr double kTestRate = 44100.0;
        constexpr int kTestBlock = 512;

        /** RMS of a sine at `freqHz` pushed through `filter`, measured only
         * over the SECOND half of the run so the filter's own settling
         * transient (and the smoothers' initial ramp) is excluded -- what's
         * being measured is steady-state attenuation, not startup. */
        double filteredRms(ChannelFilter& filter, double freqHz, int numSamples)
        {
            std::vector<float> l((size_t) numSamples), r((size_t) numSamples);
            for (int i = 0; i < numSamples; ++i)
            {
                const auto s = (float) std::sin(2.0 * juce::MathConstants<double>::pi * freqHz * (double) i / kTestRate);
                l[(size_t) i] = s;
                r[(size_t) i] = s;
            }
            for (int i = 0; i < numSamples; i += kTestBlock)
            {
                const int n = juce::jmin(kTestBlock, numSamples - i);
                filter.process(n, l.data() + i, r.data() + i);
            }
            double sum = 0.0;
            const int from = numSamples / 2;
            for (int i = from; i < numSamples; ++i)
                sum += (double) l[(size_t) i] * (double) l[(size_t) i];
            return std::sqrt(sum / (double) (numSamples - from));
        }

        /** The control value that maps to a given cutoff in Hz -- the inverse
         * of filterCutoffHz, so a test can ask for "a lowpass at 200Hz"
         * without hardcoding a magic 0..1 number that silently becomes wrong
         * if the map's range ever changes. */
        double cutoffValueForHz(double hz)
        {
            return std::log(hz / kFilterCutoffMinHz) / std::log(kFilterCutoffMaxHz / kFilterCutoffMinHz);
        }
    }

    class ChannelFilterTests : public juce::UnitTest
    {
    public:
        ChannelFilterTests() : juce::UnitTest("ChannelFilter") {}

        void runTest() override
        {
            beginTest("the cutoff map is logarithmic across the audible band");
            {
                expectWithinAbsoluteError(filterCutoffHz(0.0), kFilterCutoffMinHz, 1.0e-9);
                expectWithinAbsoluteError(filterCutoffHz(1.0), kFilterCutoffMaxHz, 1.0e-6);
                // Halfway along the control is the GEOMETRIC middle (~632Hz),
                // not the arithmetic one (~10kHz) -- that's what makes the
                // control feel even end to end.
                expectWithinAbsoluteError(filterCutoffHz(0.5), std::sqrt(kFilterCutoffMinHz * kFilterCutoffMaxHz), 1.0e-6);
                // Equal control steps are equal RATIOS, not equal Hz.
                expectWithinAbsoluteError(filterCutoffHz(0.5) / filterCutoffHz(0.25),
                                          filterCutoffHz(0.75) / filterCutoffHz(0.5), 1.0e-6);
            }

            beginTest("out-of-range and non-finite control values clamp rather than blow up");
            {
                expectWithinAbsoluteError(filterCutoffHz(-3.0), kFilterCutoffMinHz, 1.0e-9);
                expectWithinAbsoluteError(filterCutoffHz(9.0), kFilterCutoffMaxHz, 1.0e-6);
                expectWithinAbsoluteError(filterCutoffHz(std::numeric_limits<double>::quiet_NaN()),
                                          kFilterCutoffMinHz, 1.0e-9);
                expect(filterResonanceQ(0.0) < filterResonanceQ(1.0));
                expectWithinAbsoluteError(filterResonanceQ(-1.0), filterResonanceQ(0.0), 1.0e-9);
                expectWithinAbsoluteError(filterResonanceQ(2.0), filterResonanceQ(1.0), 1.0e-9);
            }

            beginTest("a lowpass at a low cutoff attenuates a high sine far more than a low one");
            {
                const float cutoff = (float) cutoffValueForHz(200.0);

                ChannelFilter lowTone;
                lowTone.prepare(kTestRate, kTestBlock);
                lowTone.resetTo(FilterMode::lowpass, cutoff, 0.0f);
                lowTone.setTargets(FilterMode::lowpass, cutoff, 0.0f);
                const double passed = filteredRms(lowTone, 60.0, 44100);

                ChannelFilter highTone;
                highTone.prepare(kTestRate, kTestBlock);
                highTone.resetTo(FilterMode::lowpass, cutoff, 0.0f);
                highTone.setTargets(FilterMode::lowpass, cutoff, 0.0f);
                const double stopped = filteredRms(highTone, 6000.0, 44100);

                // A sine's own RMS is 1/sqrt(2) ~= 0.707. Well below cutoff
                // passes essentially untouched...
                expect(passed > 0.6, "60Hz through a 200Hz lowpass had rms " + juce::String(passed));
                // ...and 5 octaves above it is crushed. A one-pole-equivalent
                // slope would give ~30x; the bar here is deliberately loose
                // (20x) so this tests the SHAPE, not an exact slope.
                expect(stopped * 20.0 < passed,
                       "6kHz rms " + juce::String(stopped) + " vs 60Hz rms " + juce::String(passed));
            }

            beginTest("a highpass at a high cutoff does the opposite");
            {
                const float cutoff = (float) cutoffValueForHz(2000.0);

                ChannelFilter lowTone;
                lowTone.prepare(kTestRate, kTestBlock);
                lowTone.resetTo(FilterMode::highpass, cutoff, 0.0f);
                lowTone.setTargets(FilterMode::highpass, cutoff, 0.0f);
                const double stopped = filteredRms(lowTone, 80.0, 44100);

                ChannelFilter highTone;
                highTone.prepare(kTestRate, kTestBlock);
                highTone.resetTo(FilterMode::highpass, cutoff, 0.0f);
                highTone.setTargets(FilterMode::highpass, cutoff, 0.0f);
                const double passed = filteredRms(highTone, 8000.0, 44100);

                expect(passed > 0.6, "8kHz through a 2kHz highpass had rms " + juce::String(passed));
                expect(stopped * 20.0 < passed,
                       "80Hz rms " + juce::String(stopped) + " vs 8kHz rms " + juce::String(passed));
            }

            beginTest("at its neutral end a filter passes the signal essentially untouched");
            {
                ChannelFilter lp;
                lp.prepare(kTestRate, kTestBlock);
                const auto neutral = (float) neutralCutoffValue(FilterMode::lowpass);
                lp.resetTo(FilterMode::lowpass, neutral, 0.0f);
                lp.setTargets(FilterMode::lowpass, neutral, 0.0f);
                const double rms = filteredRms(lp, 1000.0, 44100);
                expectWithinAbsoluteError(rms, 1.0 / std::sqrt(2.0), 0.02);
            }

            beginTest("resonance raises the level right at the cutoff");
            {
                const float cutoff = (float) cutoffValueForHz(1000.0);

                ChannelFilter flat;
                flat.prepare(kTestRate, kTestBlock);
                flat.resetTo(FilterMode::lowpass, cutoff, 0.0f);
                flat.setTargets(FilterMode::lowpass, cutoff, 0.0f);
                const double flatRms = filteredRms(flat, 1000.0, 44100);

                ChannelFilter peaky;
                peaky.prepare(kTestRate, kTestBlock);
                peaky.resetTo(FilterMode::lowpass, cutoff, 1.0f);
                peaky.setTargets(FilterMode::lowpass, cutoff, 1.0f);
                const double peakyRms = filteredRms(peaky, 1000.0, 44100);

                expect(peakyRms > flatRms * 2.0,
                       "resonant rms " + juce::String(peakyRms) + " vs flat " + juce::String(flatRms));
            }

            beginTest("a swept cutoff produces no per-sample discontinuity");
            {
                ChannelFilter sweeping;
                sweeping.prepare(kTestRate, kTestBlock);
                sweeping.resetTo(FilterMode::lowpass, 1.0f, 0.0f);

                // A steady 200Hz tone while the cutoff is slammed from fully
                // open to nearly closed in one step -- the worst case for
                // zipper noise. The output envelope must change, but it must
                // never JUMP: the smoother is what makes that true.
                const int numSamples = kTestBlock * 8;
                std::vector<float> l((size_t) numSamples), r((size_t) numSamples);
                for (int i = 0; i < numSamples; ++i)
                {
                    const auto s = (float) std::sin(2.0 * juce::MathConstants<double>::pi * 200.0 * (double) i / kTestRate);
                    l[(size_t) i] = s;
                    r[(size_t) i] = s;
                }
                sweeping.setTargets(FilterMode::lowpass, (float) cutoffValueForHz(60.0), 0.0f);
                for (int i = 0; i < numSamples; i += kTestBlock)
                    sweeping.process(kTestBlock, l.data() + i, r.data() + i);

                // A 200Hz sine at 44.1kHz moves at most ~0.03 per sample on
                // its own; anything much beyond that in the OUTPUT is a step
                // introduced by the filter, not by the signal.
                float biggest = 0.0f;
                for (int i = 1; i < numSamples; ++i)
                    biggest = juce::jmax(biggest, std::abs(l[(size_t) i] - l[(size_t) (i - 1)]));
                expect(biggest < 0.05f, "biggest per-sample jump was " + juce::String(biggest));
            }

            beginTest("neutrality: only an untouched, unautomated filter is skippable");
            {
                expect(channelFilterIsNeutral(FilterMode::lowpass, 1.0, false, false));
                expect(channelFilterIsNeutral(FilterMode::highpass, 0.0, false, false));
                // Moved off its neutral end.
                expect(!channelFilterIsNeutral(FilterMode::lowpass, 0.5, false, false));
                expect(!channelFilterIsNeutral(FilterMode::highpass, 0.5, false, false));
                // The OTHER mode's neutral end is not this one's.
                expect(!channelFilterIsNeutral(FilterMode::lowpass, 0.0, false, false));
                expect(!channelFilterIsNeutral(FilterMode::highpass, 1.0, false, false));
                // Any automation at all means the user is using the filter.
                expect(!channelFilterIsNeutral(FilterMode::lowpass, 1.0, true, false));
                expect(!channelFilterIsNeutral(FilterMode::lowpass, 1.0, false, true));
                // A slider parked a hair off its end stop still counts as off.
                expect(channelFilterIsNeutral(FilterMode::lowpass, 1.0 - 1.0e-9, false, false));
                // Corrupted data is never treated as the free path.
                expect(!channelFilterIsNeutral(
                    FilterMode::lowpass, std::numeric_limits<double>::quiet_NaN(), false, false));
            }
        }
    };

    static ChannelFilterTests channelFilterTests;
}

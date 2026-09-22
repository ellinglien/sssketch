// native-engine/Source/ReverbBusTests.cpp
#include "ReverbBus.h"
#include <juce_core/juce_core.h>
#include <cmath>
#include <vector>

namespace sssketch
{
    namespace
    {
        constexpr double kRate = 44100.0;
        constexpr int kBlock = 512;

        double peakOf(const std::vector<float>& v)
        {
            double peak = 0.0;
            for (float s : v) peak = juce::jmax(peak, (double) std::abs(s));
            return peak;
        }

        ParamSmoother settledGain(float value)
        {
            ParamSmoother g;
            g.reset(kRate, kAutomationSmoothingSec, value);
            g.setTarget(value);
            return g;
        }
    }

    class ReverbBusTests : public juce::UnitTest
    {
    public:
        ReverbBusTests() : juce::UnitTest("ReverbBus") {}

        void runTest() override
        {
            beginTest("the settings maps cover their ranges the intended way round");
            {
                expectWithinAbsoluteError(reverbDecaySecondsFor(0.0), 0.5, 1.0e-9);
                expectWithinAbsoluteError(reverbDecaySecondsFor(1.0), 8.0, 1.0e-6);
                expect(reverbDecaySecondsFor(0.25) < reverbDecaySecondsFor(0.75));

                // MORE damping = LOWER corner frequency, not higher.
                expectWithinAbsoluteError(reverbDampingHzFor(0.0), 20000.0, 1.0e-6);
                expectWithinAbsoluteError(reverbDampingHzFor(1.0), 1500.0, 1.0e-6);
                expect(reverbDampingHzFor(0.75) < reverbDampingHzFor(0.25));

                // Pre-delay clamps into the window zita's own input delay
                // line can actually address.
                expectWithinAbsoluteError(reverbPreDelaySecondsFor(0.0), 0.020, 1.0e-9);
                expectWithinAbsoluteError(reverbPreDelaySecondsFor(40.0), 0.060, 1.0e-9);
                expectWithinAbsoluteError(reverbPreDelaySecondsFor(10000.0), 0.115, 1.0e-9);
                expectWithinAbsoluteError(reverbPreDelaySecondsFor(-50.0), 0.020, 1.0e-9);
            }

            beginTest("a zero send leaves the output bit-identical and builds no reverb at all");
            {
                ReverbBus bus;
                bus.prepare(kRate, kBlock);

                std::vector<float> dryL((size_t) kBlock), dryR((size_t) kBlock);
                for (int i = 0; i < kBlock; ++i)
                {
                    dryL[(size_t) i] = (float) std::sin(0.05 * i);
                    dryR[(size_t) i] = (float) std::cos(0.05 * i);
                }
                auto outL = dryL, outR = dryR;
                const auto expectedL = outL, expectedR = outR;

                for (int block = 0; block < 8; ++block)
                {
                    auto gain = settledGain(0.0f);
                    bus.beginBlock(kBlock);
                    bus.addSend(kBlock, dryL.data(), dryR.data(), gain);
                    bus.endBlock(kBlock, outL.data(), outR.data());
                }

                // BIT-identical, not approximately equal: with no send, the
                // reverb stage must not touch a single sample.
                for (int i = 0; i < kBlock; ++i)
                {
                    expectEquals(outL[(size_t) i], expectedL[(size_t) i]);
                    expectEquals(outR[(size_t) i], expectedR[(size_t) i]);
                }
                expect(!bus.hasBeenBuilt(), "a never-fed bus should not have allocated a reverb");
                expect(!bus.isRinging());
            }

            beginTest("a non-zero send produces wet output that decays after the input stops");
            {
                ReverbBus bus;
                bus.prepare(kRate, kBlock);
                ReverbSettings settings;
                settings.roomSize = 0.5;
                settings.damping = 0.3;
                settings.preDelayMs = 0.0;
                bus.setSettings(settings);

                // A short burst of noise, then silence.
                std::vector<float> burstL((size_t) kBlock), burstR((size_t) kBlock);
                juce::Random rng(1234);
                for (int i = 0; i < kBlock; ++i)
                {
                    const auto s = (float) (rng.nextDouble() * 2.0 - 1.0) * 0.5f;
                    burstL[(size_t) i] = s;
                    burstR[(size_t) i] = s;
                }
                const std::vector<float> silence((size_t) kBlock, 0.0f);

                auto sendGain = settledGain(0.8f);
                std::vector<double> blockPeaks;
                for (int block = 0; block < 60; ++block)
                {
                    const auto& inL = block < 4 ? burstL : silence;
                    const auto& inR = block < 4 ? burstR : silence;
                    std::vector<float> outL((size_t) kBlock, 0.0f), outR((size_t) kBlock, 0.0f);
                    bus.beginBlock(kBlock);
                    bus.addSend(kBlock, inL.data(), inR.data(), sendGain);
                    bus.endBlock(kBlock, outL.data(), outR.data());
                    blockPeaks.push_back(peakOf(outL));
                }

                expect(bus.hasBeenBuilt());
                // There IS a tail: blocks well after the input stopped are
                // still producing audio...
                expect(blockPeaks[20] > 1.0e-4, "tail peak at block 20 was " + juce::String(blockPeaks[20]));
                // ...and it is DECAYING, not sustaining or growing.
                expect(blockPeaks[50] < blockPeaks[20],
                       "block 50 peak " + juce::String(blockPeaks[50])
                           + " should be under block 20's " + juce::String(blockPeaks[20]));
                expect(bus.isRinging());
            }

            beginTest("a bigger room rings longer than a small one");
            {
                auto tailPeakFor = [](double roomSize) {
                    ReverbBus bus;
                    bus.prepare(kRate, kBlock);
                    ReverbSettings settings;
                    settings.roomSize = roomSize;
                    settings.damping = 0.2;
                    settings.preDelayMs = 0.0;
                    bus.setSettings(settings);

                    std::vector<float> burst((size_t) kBlock);
                    juce::Random rng(99);
                    for (int i = 0; i < kBlock; ++i)
                        burst[(size_t) i] = (float) (rng.nextDouble() * 2.0 - 1.0) * 0.5f;
                    const std::vector<float> silence((size_t) kBlock, 0.0f);

                    auto gain = settledGain(1.0f);
                    double lastPeak = 0.0;
                    for (int block = 0; block < 80; ++block)
                    {
                        const auto& in = block < 2 ? burst : silence;
                        std::vector<float> outL((size_t) kBlock, 0.0f), outR((size_t) kBlock, 0.0f);
                        bus.beginBlock(kBlock);
                        bus.addSend(kBlock, in.data(), in.data(), gain);
                        bus.endBlock(kBlock, outL.data(), outR.data());
                        lastPeak = peakOf(outL);
                    }
                    return lastPeak;
                };

                const double smallRoom = tailPeakFor(0.0);
                const double bigRoom = tailPeakFor(1.0);
                expect(bigRoom > smallRoom,
                       "big-room tail " + juce::String(bigRoom) + " should outlast small-room "
                           + juce::String(smallRoom));
            }

            beginTest("send amount scales the wet level");
            {
                auto wetEnergyFor = [](float send) {
                    ReverbBus bus;
                    bus.prepare(kRate, kBlock);
                    ReverbSettings settings;
                    settings.preDelayMs = 0.0;
                    bus.setSettings(settings);

                    std::vector<float> tone((size_t) kBlock);
                    for (int i = 0; i < kBlock; ++i)
                        tone[(size_t) i] = (float) std::sin(2.0 * juce::MathConstants<double>::pi * 220.0 * i / kRate);

                    auto gain = settledGain(send);
                    double energy = 0.0;
                    for (int block = 0; block < 20; ++block)
                    {
                        std::vector<float> outL((size_t) kBlock, 0.0f), outR((size_t) kBlock, 0.0f);
                        bus.beginBlock(kBlock);
                        bus.addSend(kBlock, tone.data(), tone.data(), gain);
                        bus.endBlock(kBlock, outL.data(), outR.data());
                        for (float s : outL) energy += (double) s * (double) s;
                    }
                    return energy;
                };

                const double quiet = wetEnergyFor(0.25f);
                const double loud = wetEnergyFor(1.0f);
                expect(loud > quiet * 4.0,
                       "wet energy at send 1.0 (" + juce::String(loud)
                           + ") should be well above send 0.25 (" + juce::String(quiet) + ")");
            }

            beginTest("reset() drops the tail so a seek doesn't drag the old position's reverb along");
            {
                ReverbBus bus;
                bus.prepare(kRate, kBlock);
                bus.setSettings(ReverbSettings {});

                std::vector<float> burst((size_t) kBlock, 0.4f);
                auto gain = settledGain(1.0f);
                std::vector<float> outL((size_t) kBlock, 0.0f), outR((size_t) kBlock, 0.0f);
                bus.beginBlock(kBlock);
                bus.addSend(kBlock, burst.data(), burst.data(), gain);
                bus.endBlock(kBlock, outL.data(), outR.data());
                expect(bus.isRinging());

                bus.reset();
                expect(!bus.isRinging());

                // With nothing newly sent, a reset bus contributes nothing at
                // all -- bit-identical again.
                std::vector<float> after((size_t) kBlock, 0.25f);
                const auto expected = after;
                auto zero = settledGain(0.0f);
                bus.beginBlock(kBlock);
                bus.addSend(kBlock, burst.data(), burst.data(), zero);
                bus.endBlock(kBlock, after.data(), after.data());
                for (int i = 0; i < kBlock; ++i)
                    expectEquals(after[(size_t) i], expected[(size_t) i]);
            }
        }
    };

    static ReverbBusTests reverbBusTests;
}

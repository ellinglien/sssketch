// native-engine/Source/NoiseRiserTests.cpp
#include "NoiseRiser.h"
#include <juce_core/juce_core.h>
#include <cmath>
#include <vector>

namespace sssketch
{
    namespace
    {
        constexpr double kTestRate = 44100.0;
        constexpr double kTestSecPerBar = 2.0; // 120bpm, 4/4

        EngineRiser makeRiser()
        {
            EngineRiser riser;
            riser.id = "riser-1";
            riser.channelId = "ch1";
            riser.startBar = 0.0;
            riser.lengthBars = 2.0; // 4 seconds at kTestSecPerBar
            riser.startCutoffValue = 0.2;
            riser.endCutoffValue = 0.95;
            riser.level = 0.8;
            return riser;
        }

        /** Renders `totalSamples` of one riser from transport time 0, in
         * blocks of `blockSize`, into a freshly-seeded voice -- i.e. exactly
         * what both a fresh live session and RenderExport's own offline
         * instance do. Returns the left channel. */
        std::vector<float> renderRiser(const EngineRiser& riser, int totalSamples, int blockSize)
        {
            RiserVoice voice;
            std::vector<float> out((size_t) totalSamples, 0.0f);
            std::vector<float> scratchR((size_t) blockSize, 0.0f);
            for (int i = 0; i < totalSamples; i += blockSize)
            {
                const int n = juce::jmin(blockSize, totalSamples - i);
                std::fill(scratchR.begin(), scratchR.begin() + n, 0.0f);
                voice.render(
                    riser,
                    (double) i / kTestRate,
                    kTestRate,
                    kTestSecPerBar,
                    n,
                    out.data() + i,
                    scratchR.data());
            }
            return out;
        }

        double rmsOver(const std::vector<float>& samples, int from, int to)
        {
            double sum = 0.0;
            for (int i = from; i < to; ++i)
                sum += (double) samples[(size_t) i] * (double) samples[(size_t) i];
            const int n = to - from;
            return n > 0 ? std::sqrt(sum / (double) n) : 0.0;
        }

        /** A crude "how high is this" measure: zero crossings per second. A
         * bandpass sweeping upward raises the dominant frequency of what
         * comes out, and a zero-crossing count is the cheapest honest way to
         * see that without an FFT. */
        double zeroCrossingRate(const std::vector<float>& samples, int from, int to)
        {
            int crossings = 0;
            for (int i = from + 1; i < to; ++i)
                if ((samples[(size_t) i] >= 0.0f) != (samples[(size_t) (i - 1)] >= 0.0f))
                    ++crossings;
            const int n = to - from;
            return n > 1 ? (double) crossings * kTestRate / (double) n : 0.0;
        }
    }

    class NoiseRiserTests : public juce::UnitTest
    {
    public:
        NoiseRiserTests() : juce::UnitTest("NoiseRiser") {}

        void runTest() override
        {
            beginTest("the swell starts at silence, ends at full, and is never a straight line");
            {
                expectEquals(riserEnvelopeAt(0.0), 0.0);
                expectEquals(riserEnvelopeAt(1.0), 1.0);
                // Below the diagonal everywhere in between -- that is the
                // whole difference between a riser and a fade-in.
                for (const double p : { 0.1, 0.25, 0.5, 0.75, 0.9 })
                    expect(riserEnvelopeAt(p) < p);
                // Monotonic: a riser never dips on its way up.
                double previous = 0.0;
                for (int i = 1; i <= 100; ++i)
                {
                    const double value = riserEnvelopeAt((double) i / 100.0);
                    expect(value >= previous);
                    previous = value;
                }
                // Clamped off both ends and against corrupted data.
                expectEquals(riserEnvelopeAt(-1.0), 0.0);
                expectEquals(riserEnvelopeAt(4.0), 1.0);
                expectEquals(riserEnvelopeAt(std::nan("")), 0.0);
            }

            beginTest("the sweep follows a drawn curve, and the declared ramp without one");
            {
                auto riser = makeRiser();
                // No curve: the plain declared ramp, held flat off both ends.
                expectWithinAbsoluteError(riserCutoffAt(riser, 0.0), 0.2, 1.0e-12);
                expectWithinAbsoluteError(riserCutoffAt(riser, 1.0), 0.575, 1.0e-12);
                expectWithinAbsoluteError(riserCutoffAt(riser, 2.0), 0.95, 1.0e-12);
                expectWithinAbsoluteError(riserCutoffAt(riser, -5.0), 0.2, 1.0e-12);
                expectWithinAbsoluteError(riserCutoffAt(riser, 99.0), 0.95, 1.0e-12);

                // A drawn curve wins outright -- the declared ends are only a
                // fallback for a cleared lane.
                riser.curve = { { 0.0, 0.5 }, { 2.0, 0.6 } };
                expectWithinAbsoluteError(riserCutoffAt(riser, 0.0), 0.5, 1.0e-12);
                expectWithinAbsoluteError(riserCutoffAt(riser, 1.0), 0.55, 1.0e-12);
                expectWithinAbsoluteError(riserCutoffAt(riser, 2.0), 0.6, 1.0e-12);
            }

            beginTest("the noise source is addressed by index, not generated in sequence");
            {
                const auto seed = riserSeedFor("riser-1");
                // Asking out of order gives the same answers as asking in
                // order -- the property that makes a seek, a block split and
                // an offline bounce all produce the identical stream.
                std::vector<float> inOrder;
                for (std::int64_t i = 0; i < 64; ++i)
                    inOrder.push_back(riserNoiseAt(seed, i));
                for (std::int64_t i = 63; i >= 0; --i)
                    expectEquals(riserNoiseAt(seed, i), inOrder[(size_t) i]);

                // In range, and actually noise rather than a constant.
                double sum = 0.0;
                float minValue = 1.0f, maxValue = -1.0f;
                for (std::int64_t i = 0; i < 20000; ++i)
                {
                    const float s = riserNoiseAt(seed, i);
                    expect(s >= -1.0f && s < 1.0f);
                    sum += (double) s;
                    minValue = juce::jmin(minValue, s);
                    maxValue = juce::jmax(maxValue, s);
                }
                expect(std::abs(sum / 20000.0) < 0.02); // centred
                expect(minValue < -0.9f && maxValue > 0.9f); // uses its range

                // A different riser is a different texture.
                const auto otherSeed = riserSeedFor("riser-2");
                expect(otherSeed != seed);
                int same = 0;
                for (std::int64_t i = 0; i < 1000; ++i)
                    if (riserNoiseAt(otherSeed, i) == riserNoiseAt(seed, i))
                        ++same;
                expectEquals(same, 0);

                // ...and the SAME riser is the same texture, every time.
                expect(riserSeedFor("riser-1") == seed);
            }

            beginTest("two fresh renders of one riser are bit-identical (live == offline)");
            {
                const auto riser = makeRiser();
                const int total = (int) (kTestRate * 4.0);
                const auto first = renderRiser(riser, total, 512);
                const auto second = renderRiser(riser, total, 512);
                int differing = 0;
                for (int i = 0; i < total; ++i)
                    if (first[(size_t) i] != second[(size_t) i])
                        ++differing;
                expectEquals(differing, 0);
            }

            beginTest("the block size the host happens to use changes nothing");
            {
                // RenderExport renders in its own block size, and
                // Transport.cpp splits a block at a loop boundary -- so a
                // riser whose output depended on block structure would sound
                // different in a bounce than it did live. The coefficient
                // cadence is anchored to the riser's own sample index for
                // exactly this reason.
                const auto riser = makeRiser();
                const int total = (int) (kTestRate * 4.0);
                const auto reference = renderRiser(riser, total, 512);
                for (const int blockSize : { 1, 64, 128, 333, 1024 })
                {
                    const auto other = renderRiser(riser, total, blockSize);
                    int differing = 0;
                    for (int i = 0; i < total; ++i)
                        if (reference[(size_t) i] != other[(size_t) i])
                            ++differing;
                    expectEquals(differing, 0);
                }
            }

            beginTest("it actually rises -- louder and brighter at the end than the start");
            {
                const auto riser = makeRiser();
                const int total = (int) (kTestRate * 4.0);
                const auto rendered = renderRiser(riser, total, 512);

                const int quarter = total / 4;
                const double early = rmsOver(rendered, 0, quarter);
                const double late = rmsOver(rendered, total - quarter, total);
                expect(early > 0.0);
                expect(late > early * 4.0);

                // Brighter, not just louder: the bandpass climbed.
                const double earlyRate = zeroCrossingRate(rendered, quarter / 2, quarter);
                const double lateRate = zeroCrossingRate(rendered, total - quarter, total - 64);
                expect(lateRate > earlyRate * 2.0);
            }

            beginTest("level means level -- the riser never exceeds it");
            {
                // The bandpass's own passband gain is Q, not 1 (see
                // kRiserBandpassNormalisation), so without correction a riser
                // at 0.8 could reach 1.6 and clip the mix bus. This is the
                // assertion that pins the correction: whatever the sweep is
                // doing, the riser stays inside the level it was given.
                auto riser = makeRiser();
                riser.level = 0.8;
                const int total = (int) (kTestRate * 4.0);
                const auto rendered = renderRiser(riser, total, 512);
                double peak = 0.0;
                for (const auto sample : rendered)
                    peak = juce::jmax(peak, (double) std::abs(sample));
                expect(peak <= riser.level, "peak was " + juce::String(peak));
                // ...and it does get close, rather than being normalised into
                // inaudibility.
                expect(peak > riser.level * 0.2, "peak was " + juce::String(peak));
            }

            beginTest("it starts and ends at silence, so it can't click into a drop");
            {
                const auto riser = makeRiser();
                const int total = (int) (kTestRate * 4.0);
                const auto rendered = renderRiser(riser, total, 512);
                // The squared swell means the opening is essentially nothing.
                expect(std::abs(rendered[0]) < 1.0e-4f);
                // ...and the tail declick (kRiserReleaseSec) takes the riser
                // back down from what is otherwise its peak. Measured as a
                // ratio rather than an absolute threshold: the final sample's
                // value is the peak times however far through the release
                // ramp it lands, and where exactly that falls depends on the
                // riser's length in samples, which is not the thing under
                // test. What IS under test is that the last few milliseconds
                // are markedly quieter than the moment just before them,
                // which for a swell-to-the-end envelope can only be the
                // release doing it.
                const int releaseSamples = (int) std::lround(kRiserReleaseSec * kTestRate);
                const double tailRms = rmsOver(rendered, total - releaseSamples / 4, total);
                const double beforeReleaseRms =
                    rmsOver(rendered, total - releaseSamples * 4, total - releaseSamples);
                expect(beforeReleaseRms > 0.0);
                expect(tailRms < beforeReleaseRms * 0.5);
                // The peak itself lives in the last tenth, not at the end.
                const int lastTenth = total - total / 10;
                expect(rmsOver(rendered, lastTenth, total) > rmsOver(rendered, 0, lastTenth));
            }

            beginTest("a riser adds nothing at all to blocks it does not overlap");
            {
                EngineRiser riser = makeRiser();
                riser.startBar = 8.0;
                RiserVoice voice;
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                voice.render(riser, 0.0, kTestRate, kTestSecPerBar, 512, l.data(), r.data());
                for (int i = 0; i < 512; ++i)
                {
                    expectEquals(l[(size_t) i], 0.0f);
                    expectEquals(r[(size_t) i], 0.0f);
                }
            }

            beginTest("a zero level is silence, and corrupted geometry renders nothing");
            {
                auto riser = makeRiser();
                riser.level = 0.0;
                const auto silent = renderRiser(riser, 4096, 512);
                for (const auto sample : silent)
                    expectEquals(sample, 0.0f);

                // A length the parser would have rejected anyway, defended
                // again here: this is a divisor in a per-sample loop.
                EngineRiser broken = makeRiser();
                broken.lengthBars = 0.0;
                RiserVoice voice;
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                voice.render(broken, 0.0, kTestRate, kTestSecPerBar, 512, l.data(), r.data());
                for (int i = 0; i < 512; ++i)
                    expectEquals(l[(size_t) i], 0.0f);
            }

            beginTest("two channels, one riser -- decorrelated, not a doubled mono signal");
            {
                const auto riser = makeRiser();
                RiserVoice voice;
                const int total = 8192;
                std::vector<float> l((size_t) total, 0.0f), r((size_t) total, 0.0f);
                for (int i = 0; i < total; i += 512)
                    voice.render(
                        riser,
                        (double) i / kTestRate,
                        kTestRate,
                        kTestSecPerBar,
                        512,
                        l.data() + i,
                        r.data() + i);
                int identical = 0;
                for (int i = 0; i < total; ++i)
                    if (l[(size_t) i] == r[(size_t) i])
                        ++identical;
                // A handful of coincidental matches near silence is fine; a
                // mono riser would match on every single sample.
                expect(identical < total / 10);
            }
        }
    };

    static NoiseRiserTests noiseRiserTests;
}

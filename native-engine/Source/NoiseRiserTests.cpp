// native-engine/Source/NoiseRiserTests.cpp
#include "NoiseRiser.h"
#include "ChannelChainRegistry.h"
#include "PlaybackEngine.h"
#include "RenderExport.h"
#include "StemBufferCache.h"
#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>
#include <chrono>
#include <cmath>
#include <random>
#include <utility>
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

        /** Samples in the riser's tail at kTestSecPerBar -- the stretch past
         * its end bar that kRiserTailBars adds. */
        int tailSamples()
        {
            return (int) std::lround(kRiserTailBars * kTestSecPerBar * kTestRate);
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

        struct StereoRender
        {
            std::vector<float> l, r;
            unsigned long long warmUps = 0;
        };

        /** renderRiser, both channels, from transport time `fromSample`, in
         * blocks from `nextBlock` -- into one fresh voice. */
        template <typename NextBlock>
        StereoRender renderRiserStereo(
            const EngineRiser& riser, int fromSample, int totalSamples, NextBlock nextBlock, double rate = kTestRate)
        {
            RiserVoice voice;
            StereoRender out { std::vector<float>((size_t) totalSamples, 0.0f),
                               std::vector<float>((size_t) totalSamples, 0.0f) };
            for (int i = 0; i < totalSamples;)
            {
                const int n = juce::jmin(nextBlock(), totalSamples - i);
                voice.render(
                    riser,
                    (double) (fromSample + i) / rate,
                    rate,
                    kTestSecPerBar,
                    n,
                    out.l.data() + i,
                    out.r.data() + i);
                i += n;
            }
            out.warmUps = voice.pinkWarmUpCount();
            return out;
        }

        bool sameBits(const std::vector<float>& a, const std::vector<float>& b)
        {
            if (a.size() != b.size())
                return false;
            for (size_t i = 0; i < a.size(); ++i)
                if (a[i] != b[i])
                    return false;
            return true;
        }

        /** A riser held at one cutoff value: a two-point curve, flat. */
        EngineRiser flatRiser(double cutoffValue, double q, bool pink)
        {
            auto riser = makeRiser();
            riser.curve = { { 0.0, cutoffValue }, { riser.lengthBars, cutoffValue } };
            riser.q = q;
            riser.pink = pink;
            return riser;
        }

        double dB(double ratio) { return 20.0 * std::log10(ratio); }

        /** A riser-only project at 240 bpm (a bar is a second), one riser of
         * two bars on its own channel. */
        EngineProject riserProject(double send, ReverbRoom room)
        {
            EngineProject project;
            project.bpm = 240.0;
            project.snapDiv = 16.0;
            EngineRiser riser;
            riser.id = "radio-riser-g";
            riser.channelId = "g";
            riser.startBar = 0.5;
            riser.lengthBars = 2.0;
            riser.startCutoffValue = 0.2;
            riser.endCutoffValue = 0.95;
            riser.level = 0.5;
            riser.q = 3.0;
            riser.pink = true;
            riser.send = send;
            project.risers.push_back(riser);
            project.sound.room = room;
            return project;
        }

        /** renderBlock from bar 0 in blocks from `nextBlock`, from a fresh engine told the
         * rate first (as Transport and RenderExport do). */
        template <typename NextBlock>
        StereoRender renderEngine(const EngineProject& project, int total, NextBlock nextBlock, PlaybackEngine* keep = nullptr)
        {
            StemBufferCache cache;
            PlaybackEngine local(cache);
            PlaybackEngine& engine = keep != nullptr ? *keep : local;
            ChannelChainRegistry chains;
            engine.prepareMaster(kTestRate);
            engine.setProject(project);
            StereoRender out { std::vector<float>((size_t) total, 0.0f), std::vector<float>((size_t) total, 0.0f) };
            const double secPerBar = (60.0 / project.bpm) * 4.0;
            for (int at = 0; at < total;)
            {
                const int n = juce::jmin(nextBlock(), total - at);
                engine.renderBlock(((double) at / kTestRate) / secPerBar, kTestRate, n, out.l.data() + at, out.r.data() + at, chains);
                at += n;
            }
            return out;
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

            beginTest("the tail is an exponential decay that actually reaches zero");
            {
                // Full level where the riser ends, so the tail joins the peak
                // without a step...
                expectEquals(riserTailGainAt(0.0), 1.0);
                // ...and EXACTLY nothing where it finishes. A plain e^-k
                // would stop a thousandth above this, which is the same click
                // the tail exists to remove, only quieter.
                expectEquals(riserTailGainAt(1.0), 0.0);

                // Monotonically down, and BELOW the straight line the whole
                // way -- that is the difference between a decay and a fader
                // move.
                double previous = 1.0;
                for (int i = 1; i <= 100; ++i)
                {
                    const double x = (double) i / 100.0;
                    const double value = riserTailGainAt(x);
                    expect(value <= previous);
                    if (i < 100)
                        expect(value < 1.0 - x);
                    previous = value;
                }

                // 60dB (RT60's own convention) spent across the tail: half
                // way through it is already 30dB down.
                expectWithinAbsoluteError(riserTailGainAt(0.5), 0.0316, 0.002);

                // Off both ends, and against corrupted data -- this is a
                // multiplier inside a per-sample loop on the audio thread.
                expectEquals(riserTailGainAt(-1.0), 1.0);
                expectEquals(riserTailGainAt(4.0), 0.0);
                expectEquals(riserTailGainAt(std::nan("")), 0.0);
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
                // Rendered THROUGH the tail, not just up to the end bar: the
                // tail holds the swell at full while it decays, so if
                // anything in it could exceed the level this is where it
                // would show.
                const int body = (int) (kTestRate * 4.0);
                const auto rendered = renderRiser(riser, body + tailSamples(), 512);
                double peak = 0.0;
                for (const auto sample : rendered)
                    peak = juce::jmax(peak, (double) std::abs(sample));
                expect(peak <= riser.level, "peak was " + juce::String(peak));
                // ...and it does get close, rather than being normalised into
                // inaudibility.
                expect(peak > riser.level * 0.2, "peak was " + juce::String(peak));
            }

            beginTest("the peak is on the end bar, where the drop is -- the tail does not move it");
            {
                // The one thing the tail was not allowed to cost. A release
                // carved out of the riser's own length would pull the loudest
                // moment earlier and leave the riser deflating into the drop;
                // ringing PAST the end instead means the swell is still at
                // full when the end bar arrives.
                const auto riser = makeRiser();
                const int body = (int) (kTestRate * 4.0);
                const auto rendered = renderRiser(riser, body + tailSamples(), 512);

                int loudestIndex = 0;
                double peak = 0.0;
                for (int i = 0; i < (int) rendered.size(); ++i)
                {
                    const double magnitude = std::abs((double) rendered[(size_t) i]);
                    if (magnitude > peak)
                    {
                        peak = magnitude;
                        loudestIndex = i;
                    }
                }
                expect(loudestIndex < body,
                       "the loudest sample landed in the tail, at " + juce::String(loudestIndex));

                // And the riser's last milliseconds are as loud as the ones
                // before them, rather than being shaved by a release: this is
                // what the old 4ms in-riser declick used to fail.
                const int fourMs = (int) std::lround(0.004 * kTestRate);
                const double atTheEnd = rmsOver(rendered, body - fourMs, body);
                const double justBefore = rmsOver(rendered, body - fourMs * 4, body - fourMs);
                expect(justBefore > 0.0);
                expect(atTheEnd > justBefore * 0.9,
                       "the riser is quieter at its end than just before it");
            }

            beginTest("it rings past its end and decays to silence there, not at a hard cut");
            {
                const auto riser = makeRiser();
                const int body = (int) (kTestRate * 4.0);
                const int tail = tailSamples();
                // Rendered well past the tail, so "nothing after it" is a
                // real assertion rather than the end of the buffer.
                const auto rendered = renderRiser(riser, body + tail * 2, 512);

                // The squared swell means the opening is essentially nothing.
                expect(std::abs(rendered[0]) < 1.0e-4f);

                // There IS audio past the end bar -- the point of the whole
                // change.
                expect(rmsOver(rendered, body, body + tail / 4) > 0.0);

                // ...and it decays, quarter by quarter, rather than holding.
                double previous = rmsOver(rendered, body, body + tail / 4);
                for (int quarter = 1; quarter < 4; ++quarter)
                {
                    const double now =
                        rmsOver(rendered, body + tail * quarter / 4, body + tail * (quarter + 1) / 4);
                    expect(now < previous * 0.5,
                           "tail quarter " + juce::String(quarter) + " did not decay");
                    previous = now;
                }

                // By the end of the tail it is (near) nothing: a thousandth
                // of the riser's own peak or better, which is what lets it
                // stop without a click.
                double peak = 0.0;
                for (const auto sample : rendered)
                    peak = juce::jmax(peak, (double) std::abs(sample));
                const int lastMs = (int) std::lround(0.001 * kTestRate);
                for (int i = body + tail - lastMs; i < body + tail; ++i)
                    expect(std::abs((double) rendered[(size_t) i]) < peak * 1.0e-3);

                // And then it is EXACTLY nothing -- the tail has a real end,
                // so a riser cannot go on costing samples forever.
                for (int i = body + tail; i < body + tail * 2; ++i)
                    expectEquals(rendered[(size_t) i], 0.0f);
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

            // ---- riser variety (native radio sound plan, Task 6) ----------------------------
            // Everything above runs with the character fields absent (EngineRiser's defaults:
            // Q 2, white, wide, no send) and is unchanged: that is "absent is today's riser".

            beginTest("variety: the gain normalisation is today's at Q 2, exactly, and a power match elsewhere");
            {
                expectEquals(riserGainNormalisation(2.0), kRiserBandpassNormalisation);
                expectEquals(riserGainNormalisation(kRiserDefaultQ), 0.5);
                expectWithinAbsoluteError(riserGainNormalisation(6.0), std::sqrt(3.0) / 6.0, 1.0e-15);
                expectWithinAbsoluteError(riserGainNormalisation(1.0), std::sqrt(0.5), 1.0e-15);
                // Out of range or corrupt: clamped, or today's.
                expectEquals(riserGainNormalisation(40.0), riserGainNormalisation(6.0));
                expectEquals(riserGainNormalisation(0.0), riserGainNormalisation(1.0));
                expectEquals(riserGainNormalisation(std::nan("")), 0.5);

                // And the explicit defaults render exactly what absent fields do.
                auto explicitToday = makeRiser();
                explicitToday.q = 2.0;
                explicitToday.pink = false;
                explicitToday.mono = false;
                explicitToday.send = 0.0;
                const int total = (int) (kTestRate * 4.25);
                const auto a = renderRiserStereo(makeRiser(), 0, total, [] { return 512; });
                const auto b = renderRiserStereo(explicitToday, 0, total, [] { return 512; });
                expect(sameBits(a.l, b.l) && sameBits(a.r, b.r));
                expectEquals((int) a.warmUps, 0); // white never warms up
            }

            beginTest("variety: the RMS is within 0.5 dB across Q 1, 2, 4 and 6");
            {
                // A flat sweep, so the band sits still and only Q changes; the second half of the
                // riser (the same swell for every Q). Three places in the band, ~320 Hz to ~2.5 kHz;
                // higher, the TPT bandpass's own warping toward Nyquist pulls the widest band (Q 1)
                // down a little (-0.57 dB at ~5 kHz at 44.1 kHz), logged below, not asserted.
                const int total = (int) (kTestRate * 4.0);
                for (const double cutoff : { 0.8, 0.9 })
                {
                    const auto reference = renderRiserStereo(flatRiser(cutoff, 2.0, false), 0, total, [] { return 512; });
                    const auto wide = renderRiserStereo(flatRiser(cutoff, 1.0, false), 0, total, [] { return 512; });
                    const auto narrow = renderRiserStereo(flatRiser(cutoff, 6.0, false), 0, total, [] { return 512; });
                    const double refRms = rmsOver(reference.l, total / 2, total);
                    logMessage("at cutoff " + juce::String(cutoff) + ": Q 1 " + juce::String(dB(rmsOver(wide.l, total / 2, total) / refRms), 2)
                               + " dB, Q 6 " + juce::String(dB(rmsOver(narrow.l, total / 2, total) / refRms), 2) + " dB off Q 2");
                }
                for (const double cutoff : { 0.4, 0.6, 0.7 })
                {
                    const auto reference = renderRiserStereo(flatRiser(cutoff, 2.0, false), 0, total, [] { return 512; });
                    const double refRms = rmsOver(reference.l, total / 2, total);
                    for (const double q : { 1.0, 4.0, 6.0 })
                    {
                        const auto other = renderRiserStereo(flatRiser(cutoff, q, false), 0, total, [] { return 512; });
                        const double diff = dB(rmsOver(other.l, total / 2, total) / refRms);
                        expect(std::abs(diff) < 0.5,
                               "Q " + juce::String(q) + " at " + juce::String(cutoff) + " is " + juce::String(diff, 2) + " dB off Q 2");
                    }
                }
            }

            beginTest("variety: what level means above Q 2 (a power match; the limiter is the backstop)");
            {
                // Not a bound the riser promises -- the plan's documented risk -- but measured,
                // so the comment on riserGainNormalisation stays honest. A whole default sweep.
                const int total = (int) (kTestRate * 4.0) + tailSamples();
                for (const bool pink : { false, true })
                    for (const double q : { 1.0, 2.0, 4.0, 6.0 })
                    {
                        auto riser = makeRiser();
                        riser.q = q;
                        riser.pink = pink;
                        const auto out = renderRiserStereo(riser, 0, total, [] { return 512; });
                        double peak = 0.0;
                        for (size_t i = 0; i < out.l.size(); ++i)
                            peak = std::max({ peak, (double) std::abs(out.l[i]), (double) std::abs(out.r[i]) });
                        logMessage(juce::String(pink ? "pink" : "white") + " Q " + juce::String(q)
                                   + ": peak / level " + juce::String(peak / riser.level, 3));
                        if (q <= 2.0)
                            expect(peak <= riser.level, "Q " + juce::String(q) + " peaked at " + juce::String(peak));
                        expect(peak <= riser.level * 1.5, "Q " + juce::String(q) + " peaked at " + juce::String(peak));
                    }
            }

            beginTest("variety: pink's match constant is the web's measured one, and the riser keeps its level at 6 kHz");
            {
                // The web's rmsAtMatch(white) / rmsAtMatch(pink) (riserVoice.ts), measured by
                // running its code in node: 0.511394 at 44.1 kHz, 0.489843 at 48 kHz.
                expect(std::abs(dB(riserPinkMatchGain(44100.0) / 0.511394)) < 0.15,
                       "44.1 kHz: " + juce::String(riserPinkMatchGain(44100.0), 6));
                expect(std::abs(dB(riserPinkMatchGain(48000.0) / 0.489843)) < 0.15,
                       "48 kHz: " + juce::String(riserPinkMatchGain(48000.0), 6));

                // A riser held at 6 kHz (filterCutoffHz: 20 * 1000^v) is as loud pink as white.
                const double at6k = std::log10(kRiserPinkMatchHz / 20.0) / 3.0;
                const int total = (int) (kTestRate * 4.0);
                const auto white = renderRiserStereo(flatRiser(at6k, 2.0, false), 0, total, [] { return 512; });
                const auto pink = renderRiserStereo(flatRiser(at6k, 2.0, true), 0, total, [] { return 512; });
                const double diff = dB(rmsOver(pink.l, total / 2, total) / rmsOver(white.l, total / 2, total));
                expect(std::abs(diff) < 0.5, "pink is " + juce::String(diff, 2) + " dB off white at 6 kHz");
                // ...and has more below: at ~300 Hz pink is well up on white.
                const auto whiteLow = renderRiserStereo(flatRiser(0.4, 2.0, false), 0, total, [] { return 512; });
                const auto pinkLow = renderRiserStereo(flatRiser(0.4, 2.0, true), 0, total, [] { return 512; });
                expect(dB(rmsOver(pinkLow.l, total / 2, total) / rmsOver(whiteLow.l, total / 2, total)) > 10.0);
            }

            beginTest("variety: pink slopes -3 dB/octave (+-1) from 200 Hz to 8 kHz");
            {
                // The pink source itself (before the bandpass), by Welch's method: Hann-windowed
                // 4096-point power spectra averaged over 2^19 samples.
                constexpr int order = 12, size = 1 << order, hop = size / 2;
                const int total = 1 << 19;
                RiserPinkFilter pink;
                const auto seed = riserSeedFor("riser-1");
                pink.warmTo(seed, 0);
                std::vector<float> source((size_t) total);
                for (int i = 0; i < total; ++i)
                    source[(size_t) i] = (float) (pink.process((double) riserNoiseAt(seed, i)) * riserPinkMatchGain(kTestRate));

                juce::dsp::FFT fft(order);
                std::vector<double> power((size_t) size / 2 + 1, 0.0);
                std::vector<float> frame((size_t) size * 2);
                for (int start = 0; start + size <= total; start += hop)
                {
                    std::fill(frame.begin(), frame.end(), 0.0f);
                    for (int i = 0; i < size; ++i)
                    {
                        const double w = 0.5 - 0.5 * std::cos(2.0 * juce::MathConstants<double>::pi * i / size);
                        frame[(size_t) i] = (float) (source[(size_t) (start + i)] * w);
                    }
                    fft.performFrequencyOnlyForwardTransform(frame.data());
                    for (size_t k = 0; k < power.size(); ++k)
                        power[k] += (double) frame[k] * (double) frame[k];
                }
                // Mean power density over a third of an octave around each centre.
                const auto bandDb = [&](double hz) {
                    const double binHz = kTestRate / size;
                    const int lo = (int) std::ceil(hz * std::pow(2.0, -1.0 / 6.0) / binHz);
                    const int hi = (int) std::floor(hz * std::pow(2.0, 1.0 / 6.0) / binHz);
                    double sum = 0.0;
                    for (int k = lo; k <= hi; ++k)
                        sum += power[(size_t) k];
                    return 10.0 * std::log10(sum / (hi - lo + 1));
                };
                const std::vector<double> centres { 200.0, 400.0, 800.0, 1600.0, 3200.0, 6400.0, 8000.0 };
                std::vector<double> x, y;
                for (const double hz : centres)
                {
                    x.push_back(std::log2(hz));
                    y.push_back(bandDb(hz));
                }
                double mx = 0.0, my = 0.0;
                for (size_t i = 0; i < x.size(); ++i) { mx += x[i]; my += y[i]; }
                mx /= (double) x.size();
                my /= (double) y.size();
                double sxy = 0.0, sxx = 0.0;
                for (size_t i = 0; i < x.size(); ++i) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); }
                const double slope = sxy / sxx;
                logMessage("pink slope " + juce::String(slope, 3) + " dB/octave");
                expect(std::abs(slope + 3.0) < 1.0, "slope " + juce::String(slope, 3));
                // Octave by octave too, not just on average.
                for (size_t i = 0; i + 2 < centres.size(); ++i)
                {
                    const double step = y[i + 1] - y[i];
                    expect(std::abs(step + 3.0) < 1.0,
                           juce::String(centres[i]) + " Hz to " + juce::String(centres[i + 1]) + " Hz: " + juce::String(step, 2));
                }
            }

            beginTest("variety: a pink seek lands on the continuous render (1e-6); fresh renders and block sizes are bit-identical");
            {
                // The filter alone: warmed at an index vs run there from 0.
                const auto seed = riserSeedFor("riser-1");
                RiserPinkFilter continuous, sought;
                continuous.warmTo(seed, 0);
                constexpr std::int64_t at = 100000;
                for (std::int64_t i = 0; i < at; ++i)
                    continuous.process((double) riserNoiseAt(seed, i));
                sought.warmTo(seed, at);
                double worst = 0.0;
                for (std::int64_t i = at; i < at + 4096; ++i)
                {
                    const double w = (double) riserNoiseAt(seed, i);
                    worst = std::max(worst, std::abs(continuous.process(w) - sought.process(w)));
                }
                expect(worst < 1.0e-12, "filter differs by " + juce::String(worst));

                // The voice: a fresh voice starting mid-riser (a seek) against one that played
                // from the start, wide and mono. The seek lands on a coefficient-update boundary
                // (64 x 1378) so only the pink state can differ, and the comparison starts after
                // the bandpass's own reset transient (which white has too, as today).
                auto riser = makeRiser();
                riser.pink = true;
                riser.q = 3.5;
                const int total = (int) (kTestRate * 4.0) + tailSamples();
                const int seekAt = 64 * 1378;
                const int settle = (int) (kTestRate * 0.25);
                for (const bool mono : { false, true })
                {
                    riser.mono = mono;
                    const auto whole = renderRiserStereo(riser, 0, total, [] { return 512; });
                    const auto fromSeek = renderRiserStereo(riser, seekAt, total - seekAt, [] { return 512; });
                    double diff = 0.0;
                    for (int i = seekAt + settle; i < total; ++i)
                        diff = std::max({ diff,
                                          (double) std::abs(whole.l[(size_t) i] - fromSeek.l[(size_t) (i - seekAt)]),
                                          (double) std::abs(whole.r[(size_t) i] - fromSeek.r[(size_t) (i - seekAt)]) });
                    expect(diff < 1.0e-6, juce::String(mono ? "mono" : "wide") + " seek differs by " + juce::String(diff));
                    expectEquals((int) fromSeek.warmUps, 1);

                    // Two fresh renders, and every block size (random ones too): to the bit, with
                    // exactly one warm-up each -- a block boundary is never a discontinuity.
                    const auto again = renderRiserStereo(riser, 0, total, [] { return 512; });
                    expect(sameBits(whole.l, again.l) && sameBits(whole.r, again.r), "two fresh renders differ");
                    expectEquals((int) whole.warmUps, 1);
                    for (const int size : { 1, 64, 333, 4096 })
                    {
                        const auto other = renderRiserStereo(riser, 0, total, [size] { return size; });
                        expect(sameBits(whole.l, other.l) && sameBits(whole.r, other.r), "blocks of " + juce::String(size));
                        expectEquals((int) other.warmUps, 1);
                    }
                    // Random sizes, growing as well as shrinking: a voice no longer re-prepares (and
                    // resets) when a block is bigger than any before it (RiserVoice::prepare).
                    std::mt19937 rng(6);
                    std::uniform_int_distribution<int> sizes(1, 2000);
                    const auto random = renderRiserStereo(riser, 0, total, [&] { return sizes(rng); });
                    expect(sameBits(whole.l, random.l) && sameBits(whole.r, random.r), "random blocks");
                    expectEquals((int) random.warmUps, 1);
                }
            }

            beginTest("variety: a pink riser that starts again (a loop wrap) warms up once per start, and costs this much");
            {
                auto riser = makeRiser();
                riser.pink = true;
                RiserVoice voice;
                std::vector<float> l(512), r(512);
                // The same block twice: the second is a jump back (a wrap), so it warms again.
                voice.render(riser, 1.0, kTestRate, kTestSecPerBar, 512, l.data(), r.data());
                voice.render(riser, 1.0 + 512.0 / kTestRate, kTestRate, kTestSecPerBar, 512, l.data(), r.data());
                expectEquals((int) voice.pinkWarmUpCount(), 1);
                voice.render(riser, 1.0, kTestRate, kTestSecPerBar, 512, l.data(), r.data());
                expectEquals((int) voice.pinkWarmUpCount(), 2);

                // The cost of one warm-up (both sides), logged not asserted: it runs on the
                // audio thread, once per riser start or seek.
                RiserPinkFilter a, b;
                constexpr int runs = 50;
                const auto t0 = std::chrono::steady_clock::now();
                for (int k = 0; k < runs; ++k)
                {
                    a.warmTo(riserSeedFor("x"), 1000 + k);
                    b.warmTo(riserSeedFor("y"), 1000 + k);
                }
                const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count() / runs;
                logMessage("one pink warm-up (two sides, 16384 samples each): " + juce::String(ms, 3) + " ms");
            }

            beginTest("variety: mono is one noise in both sides, white and pink");
            {
                const int total = (int) (kTestRate * 4.0) + tailSamples();
                for (const bool pink : { false, true })
                {
                    auto riser = makeRiser();
                    riser.pink = pink;
                    riser.mono = true;
                    const auto out = renderRiserStereo(riser, 0, total, [] { return 300; });
                    expect(sameBits(out.l, out.r), pink ? "pink" : "white");
                    expect(rmsOver(out.l, 0, total) > 0.01);
                    // ...and the left side is the wide riser's left side: mono only changes the right.
                    riser.mono = false;
                    const auto wide = renderRiserStereo(riser, 0, total, [] { return 300; });
                    expect(sameBits(out.l, wide.l));
                    int identical = 0;
                    for (size_t i = 0; i < wide.l.size(); ++i)
                        identical += wide.l[i] == wide.r[i] ? 1 : 0;
                    expect(identical < total / 10, "wide pink is decorrelated");
                }
            }

            beginTest("variety: a riser's send rings the reverb, in both rooms, scaled by the send");
            {
                // Two bars at 240 bpm from bar 0.5, plus its tail (an eighth of a bar), then 2 s.
                const int total = (int) (kTestRate * 4.75);
                const int soundingEnd = (int) std::lround(kTestRate * (2.5 + kRiserTailBars));
                for (const auto room : { ReverbRoom::cavern, ReverbRoom::zita })
                {
                    const juce::String name = room == ReverbRoom::cavern ? "cavern" : "zita";
                    const auto dry = renderEngine(riserProject(0.0, room), total, [] { return 512; });
                    const auto wet = renderEngine(riserProject(0.4, room), total, [] { return 512; });
                    const auto half = renderEngine(riserProject(0.2, room), total, [] { return 512; });
                    for (int i = soundingEnd; i < total; ++i)
                        expectEquals(dry.l[(size_t) i], 0.0f);
                    expect(rmsOver(wet.l, soundingEnd, soundingEnd + (int) kTestRate) > 1.0e-3,
                           name + ": no tail after the riser");
                    // The send is post-level and linear: half the send, half the wet.
                    double worst = 0.0, wetPeak = 0.0;
                    for (int i = 0; i < total; ++i)
                    {
                        const double w = (double) wet.l[(size_t) i] - dry.l[(size_t) i];
                        wetPeak = std::max(wetPeak, std::abs(w));
                        worst = std::max(worst, std::abs(((double) half.l[(size_t) i] - dry.l[(size_t) i]) - 0.5 * w));
                    }
                    expect(wetPeak > 1.0e-2 && worst < 1.0e-5,
                           name + ": wet peak " + juce::String(wetPeak) + ", error " + juce::String(worst));
                }
                // The cavern's dry part is the riser itself, untouched: nothing of the room before
                // its 30 ms pre-delay.
                const auto dry = renderEngine(riserProject(0.0, ReverbRoom::cavern), total, [] { return 512; });
                const auto wet = renderEngine(riserProject(0.4, ReverbRoom::cavern), total, [] { return 512; });
                // (The partitioned convolver's FFT round-off is ~1e-13 where the impulse is zero.)
                const int start = (int) std::lround(kTestRate * 0.5);
                const int onset = start + (int) std::lround(kTestRate * 0.03);
                double before = 0.0;
                for (int i = 0; i < onset; ++i)
                    before = std::max(before, (double) std::abs(dry.l[(size_t) i] - wet.l[(size_t) i]));
                expect(sameBits(std::vector<float>(dry.l.begin(), dry.l.begin() + start),
                                std::vector<float>(wet.l.begin(), wet.l.begin() + start)));
                expect(before < 1.0e-9, "the room before its pre-delay: " + juce::String(before));
                double after = 0.0;
                for (int i = onset; i < onset + 4410; ++i)
                    after = std::max(after, (double) std::abs(dry.l[(size_t) i] - wet.l[(size_t) i]));
                expect(after > 1.0e-6, "the room after its pre-delay: " + juce::String(after));
            }

            beginTest("variety: a riser with send 0 builds nothing and is today's, to the bit");
            {
                const int total = (int) (kTestRate * 3.0);
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                const auto noSend = renderEngine(riserProject(0.0, ReverbRoom::cavern), total, [] { return 512; }, &engine);
                expectEquals(engine.cavernReverbPreparedRate(), 0.0);
                expect(!engine.zitaReverbBuilt());
                // The same riser with no sound block at all (zita, today's) is the same audio.
                auto today = riserProject(0.0, ReverbRoom::cavern);
                today.sound = SoundSettings {};
                const auto todayOut = renderEngine(today, total, [] { return 512; });
                expect(sameBits(noSend.l, todayOut.l) && sameBits(noSend.r, todayOut.r));

                // A send builds the room it sends to.
                StemBufferCache cache2;
                PlaybackEngine sending(cache2);
                renderEngine(riserProject(0.3, ReverbRoom::cavern), 4096, [] { return 512; }, &sending);
                expectEquals(sending.cavernReverbPreparedRate(), kTestRate);
                StemBufferCache cache3;
                PlaybackEngine sendingZita(cache3);
                renderEngine(riserProject(0.3, ReverbRoom::zita), (int) (kTestRate * 1.0), [] { return 512; }, &sendingZita);
                expect(sendingZita.zitaReverbBuilt());
            }

            beginTest("variety: a re-sync mid-riser (a new project, the riser on a new channel, the same id) carries the voice through");
            {
                // Discover rebuilds the project with a fresh groupId -- so a new channel -- on every
                // sync; with the arming's key in the id (buildTransitionRiser's armId) the riser keeps
                // its id, so the engine keeps its voice: the pink filter, the bandpass and the noise
                // continue as if nothing happened, and the room keeps ringing.
                const auto project = riserProject(0.35, ReverbRoom::cavern);
                auto resynced = project;
                resynced.risers[0].channelId = "g2";
                auto renamed = resynced;
                renamed.risers[0].id = "radio-riser-other";
                const int total = (int) (kTestRate * 3.0);
                const int swapAt = (int) (kTestRate * 1.5) + 7; // mid-riser, mid-block
                const auto continuous = renderEngine(project, total, [] { return 512; });
                for (const bool sameId : { true, false })
                {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    ChannelChainRegistry chains;
                    engine.prepareMaster(kTestRate);
                    engine.setProject(project);
                    std::vector<float> l((size_t) total, 0.0f), r((size_t) total, 0.0f);
                    bool swapped = false;
                    for (int at = 0; at < total;)
                    {
                        if (!swapped && at >= swapAt)
                        {
                            engine.setProject(sameId ? resynced : renamed);
                            swapped = true;
                        }
                        const int n = juce::jmin(at < swapAt ? swapAt - at : 512, total - at);
                        engine.renderBlock(((double) at / kTestRate) / 1.0, kTestRate, n, l.data() + at, r.data() + at, chains);
                        at += n;
                    }
                    if (sameId)
                        expect(sameBits(l, continuous.l) && sameBits(r, continuous.r), "a re-sync changed the riser");
                    else
                        expect(!sameBits(l, continuous.l), "a new id is a new voice (the old behaviour)");
                }
            }

            beginTest("variety: a sending riser is block-size invariant, and the export is the same audio");
            {
                const auto project = riserProject(0.35, ReverbRoom::cavern);
                const int total = (int) (kTestRate * 4.0);
                juce::AudioBuffer<float> exported;
                juce::String error;
                expect(renderProjectToBuffer(project, (double) total / kTestRate / 1.0, kTestRate, 512, exported, error), error);
                const std::vector<float> refL(exported.getReadPointer(0), exported.getReadPointer(0) + total);
                const std::vector<float> refR(exported.getReadPointer(1), exported.getReadPointer(1) + total);
                for (const int size : { 1, 64, 512, 4096 })
                {
                    const auto out = renderEngine(project, total, [size] { return size; });
                    expect(sameBits(out.l, refL) && sameBits(out.r, refR), "blocks of " + juce::String(size));
                }
                std::mt19937 rng(11);
                std::uniform_int_distribution<int> sizes(1, 3000);
                const auto random = renderEngine(project, total, [&] { return sizes(rng); });
                expect(sameBits(random.l, refL) && sameBits(random.r, refR), "random blocks");
            }
        }
    };

    static NoiseRiserTests noiseRiserTests;
}

// native-engine/Source/MasterStageTests.cpp
//
// The master stage (headroom trim -> true-peak limiter), docs/superpowers/plans/
// 2026-10-01-native-radio-sound.md Task 3. The live-equals-export check through Transport and
// RenderExport is in TransportTests.
#include "MasterStage.h"
#include "StressTest.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <thread>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <random>
#include <vector>

namespace sssketch
{
    namespace
    {
        constexpr double kPi = 3.14159265358979323846;

        struct Stereo
        {
            std::vector<float> l, r;
            explicit Stereo(size_t n = 0) : l(n, 0.0f), r(n, 0.0f) {}
            size_t size() const { return l.size(); }
            bool operator==(const Stereo& o) const
            {
                return l.size() == o.l.size() && std::memcmp(l.data(), o.l.data(), l.size() * sizeof(float)) == 0
                    && std::memcmp(r.data(), o.r.data(), r.size() * sizeof(float)) == 0;
            }
        };

        Stereo sine(double sampleRate, int frames, double freq, double amp, double phase = 0.0)
        {
            Stereo s((size_t) frames);
            for (int i = 0; i < frames; ++i)
            {
                const float v = (float) (amp * std::sin(2.0 * kPi * freq * i / sampleRate + phase));
                s.l[(size_t) i] = v;
                s.r[(size_t) i] = v;
            }
            return s;
        }

        /** A loud, busy programme: two detuned sines and seeded noise, peaking well over 0 dBFS. */
        Stereo hotProgramme(double sampleRate, int frames)
        {
            Stereo s((size_t) frames);
            std::mt19937 rng(1234);
            std::uniform_real_distribution<float> noise(-0.5f, 0.5f);
            for (int i = 0; i < frames; ++i)
            {
                const double t = i / sampleRate;
                s.l[(size_t) i] = (float) (1.2 * std::sin(2.0 * kPi * 110.0 * t) + 0.6 * std::sin(2.0 * kPi * 3150.0 * t)) + noise(rng);
                s.r[(size_t) i] = (float) (1.1 * std::sin(2.0 * kPi * 165.0 * t) + 0.7 * std::sin(2.0 * kPi * 7000.0 * t)) + noise(rng);
            }
            return s;
        }

        /** The input through `stage` in blocks from `nextBlock`, with `settings` throughout. */
        template <typename NextBlock>
        Stereo run(MasterStage& stage, const SoundSettings::Mastering* settings, double sampleRate, Stereo in, NextBlock nextBlock)
        {
            const int frames = (int) in.size();
            for (int at = 0; at < frames;)
            {
                const int n = juce::jmin(juce::jmax(1, nextBlock()), frames - at);
                stage.process(settings, sampleRate, n, in.l.data() + at, in.r.data() + at);
                at += n;
            }
            return in;
        }

        Stereo runFresh(const SoundSettings::Mastering* settings, double sampleRate, const Stereo& in, int block)
        {
            MasterStage stage;
            stage.prepare(sampleRate);
            return run(stage, settings, sampleRate, in, [block] { return block; });
        }

        /** The test's own true-peak meter: every sample, plus 7 points between each pair by a
         * 64-tap Hann-windowed sinc (8x oversampling). Independent of truepeak.dsp's 24-tap 4x
         * detector. Peak in dBTP over [from, size - 32). */
        double truePeakDb(const std::vector<float>& x, size_t from)
        {
            constexpr int kHalf = 32;
            double peak = 0.0;
            for (size_t n = std::max(from, (size_t) kHalf); n + kHalf < x.size(); ++n)
            {
                peak = std::max(peak, (double) std::abs(x[n]));
                for (int k = 1; k < 8; ++k)
                {
                    const double f = k / 8.0;
                    double sum = 0.0;
                    for (int m = -kHalf + 1; m <= kHalf; ++m)
                    {
                        const double t = f - m;
                        const double sinc = std::sin(kPi * t) / (kPi * t);
                        const double w = 0.5 * (1.0 + std::cos(kPi * t / (kHalf + 0.5)));
                        sum += x[n + (size_t) m] * sinc * w;
                    }
                    peak = std::max(peak, std::abs(sum));
                }
            }
            return 20.0 * std::log10(std::max(peak, 1e-12));
        }

        float dbToGain(double db) { return (float) std::pow(10.0, db / 20.0); }

        constexpr int kGoldenFrames = 96000;

        /** $SSSKETCH_GOLDEN_DIR, else the first ancestor of the binary holding
         * test/golden/manifest.json (as FaustStageTests finds it). */
        juce::File goldenDir()
        {
            if (const char* env = std::getenv("SSSKETCH_GOLDEN_DIR")) return juce::File(env);
            auto dir = juce::File::getSpecialLocation(juce::File::currentExecutableFile).getParentDirectory();
            for (int up = 0; up < 12 && dir.exists(); ++up, dir = dir.getParentDirectory())
            {
                auto candidate = dir.getChildFile("test").getChildFile("golden");
                if (candidate.getChildFile("manifest.json").existsAsFile()) return candidate;
                if (dir.isRoot()) break;
            }
            return {};
        }

        bool loadGolden(const juce::String& name, Stereo& out)
        {
            juce::MemoryBlock data;
            if (! goldenDir().getChildFile(name).loadFileAsData(data)) return false;
            if (data.getSize() != 2 * kGoldenFrames * sizeof(float)) return false;
            auto* f = static_cast<const float*>(data.getData());
            out.l.assign(f, f + kGoldenFrames);
            out.r.assign(f + kGoldenFrames, f + 2 * kGoldenFrames);
            return true;
        }
    }

    class MasterStageTests : public juce::UnitTest
    {
    public:
        MasterStageTests() : juce::UnitTest("MasterStage", "MasterStage") {}

        void runTest() override
        {
            const SoundSettings::Mastering defaults {}; // -4 dB headroom, -1 dBTP

            beginTest("off: no settings leaves the buffers bit-identical, prepared or not");
            {
                const auto in = hotProgramme(48000.0, 20000);
                MasterStage unprepared;
                expect(run(unprepared, nullptr, 48000.0, in, [] { return 512; }) == in);
                expect(runFresh(nullptr, 48000.0, in, 512) == in);
                expect(runFresh(nullptr, 48000.0, in, 1) == in);
            }

            beginTest("on but never prepared, or prepared at another rate: passed through untouched, and counted");
            {
                const auto in = hotProgramme(48000.0, 4096);
                MasterStage unprepared;
                expect(run(unprepared, &defaults, 48000.0, in, [] { return 512; }) == in);
                expect(unprepared.rateMismatchCount() == 8);

                MasterStage wrongRate;
                wrongRate.prepare(44100.0);
                expect(run(wrongRate, &defaults, 48000.0, in, [] { return 1024; }) == in);
                expect(wrongRate.rateMismatchCount() == 4);
            }

            beginTest("transparent below the ceiling: the trim, delayed exactly 75 samples, at every rate");
            for (double rate : { 44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0 })
            {
                const int frames = 8192;
                const auto in = sine(rate, frames, 997.0, std::pow(10.0, -20.0 / 20.0));
                const auto out = runFresh(&defaults, rate, in, 512);
                const float g = dbToGain(defaults.headroomDb);
                bool exact = true;
                for (int i = 0; i < frames && exact; ++i)
                {
                    const float wantL = i < MasterStage::kLatencySamples ? 0.0f : in.l[(size_t) (i - MasterStage::kLatencySamples)] * g;
                    const float wantR = i < MasterStage::kLatencySamples ? 0.0f : in.r[(size_t) (i - MasterStage::kLatencySamples)] * g;
                    exact = out.l[(size_t) i] == wantL && out.r[(size_t) i] == wantR;
                    if (! exact)
                        expect(false, "rate " + juce::String(rate) + ": sample " + juce::String(i) + " is "
                                          + juce::String(out.l[(size_t) i], 9) + ", want " + juce::String(wantL, 9));
                }
                expect(exact);
            }

            beginTest("true peak: a +6 dBFS sine at fs/4, 45 degrees, comes out at or under the ceiling (+0.1 dB)");
            for (double rate : { 44100.0, 48000.0, 96000.0, 192000.0 })
            {
                for (double ceiling : { -1.0, -3.0, -0.3 })
                {
                    // At fs/4 and 45 degrees every sample sits at amp/sqrt(2): the sample peak is
                    // 3 dB under the true peak, which falls exactly between samples.
                    const int frames = (int) (rate * 0.5);
                    const auto in = sine(rate, frames, rate / 4.0, 2.0, kPi / 4.0);
                    const SoundSettings::Mastering m { -4.0, ceiling };
                    const auto out = runFresh(&m, rate, in, 512);
                    const double tp = juce::jmax(truePeakDb(out.l, 0), truePeakDb(out.r, 0));
                    expect(tp <= ceiling + 0.1, "rate " + juce::String(rate) + ", ceiling " + juce::String(ceiling)
                                                   + ": true peak " + juce::String(tp, 3) + " dBTP");
                    // and it is limiting, not just passing a quiet signal
                    expect(tp > ceiling - 1.0, "true peak " + juce::String(tp, 3) + " dBTP is far under the ceiling");
                }
            }

            beginTest("true peak holds on a hot, tonal programme: chords and a bass, 10 dB over, no headroom");
            for (double rate : { 44100.0, 48000.0, 96000.0 })
            {
                const int frames = (int) rate;
                Stereo in((size_t) frames);
                const double partials[] = { 55.0, 110.0, 220.0, 277.18, 329.63, 440.0, 659.26, 1318.5, 2637.0, 5274.0 };
                for (int i = 0; i < frames; ++i)
                {
                    double l = 0.0, r = 0.0;
                    for (int k = 0; k < 10; ++k)
                    {
                        const double ph = 2.0 * kPi * partials[k] * i / rate;
                        l += 0.45 * std::sin(ph + k);
                        r += 0.45 * std::sin(ph * 1.003 + 2 * k);
                    }
                    in.l[(size_t) i] = (float) l;
                    in.r[(size_t) i] = (float) r;
                }
                const SoundSettings::Mastering m { 0.0, -1.0 };
                const auto out = runFresh(&m, rate, in, 256);
                const double inTp = truePeakDb(in.l, 0);
                const double tp = juce::jmax(truePeakDb(out.l, 0), truePeakDb(out.r, 0));
                logMessage("rate " + juce::String(rate) + ": in " + juce::String(inTp, 2) + " dBTP, out " + juce::String(tp, 3) + " dBTP");
                expect(inTp > 8.0, "the input is not hot: " + juce::String(inTp, 2));
                expect(tp <= -1.0 + 0.1, "rate " + juce::String(rate) + ": true peak " + juce::String(tp, 3) + " dBTP");
            }

            beginTest("full-band noise driven 8-11 dB into the limiter overshoots by at most 0.4 dB (the web's truepeak.dsp, measured)");
            {
                // truepeak.dsp's header records -0.86 dBTP for full-band noise. Driven this hard,
                // the per-sample gain itself modulates the signal and its 4x detector misses
                // some near-Nyquist peaks: 2026-10-01, -0.67 dBTP at 48 kHz. This is the web's
                // DSP to the bit (the golden test below), so it is pinned here, not changed: a
                // regression bound, not the target.
                for (double rate : { 44100.0, 48000.0 })
                {
                    const auto in = hotProgramme(rate, (int) rate);
                    const SoundSettings::Mastering m { 0.0, -1.0 };
                    const auto out = runFresh(&m, rate, in, 256);
                    const double tp = juce::jmax(truePeakDb(out.l, 0), truePeakDb(out.r, 0));
                    logMessage("rate " + juce::String(rate) + ": out " + juce::String(tp, 3) + " dBTP");
                    expect(tp <= -1.0 + 0.4, "rate " + juce::String(rate) + ": true peak " + juce::String(tp, 3) + " dBTP");
                }
            }

            beginTest("the limiter is the web's: with 0 dB of headroom the stage reproduces truepeak.out.f32 to the bit");
            {
                Stereo programme, golden;
                const bool haveProgramme = loadGolden("programme.f32", programme);
                const bool haveGolden = loadGolden("truepeak.out.f32", golden);
                expect(haveProgramme && haveGolden,
                       "golden vectors not found under " + goldenDir().getFullPathName()
                           + " (set SSSKETCH_GOLDEN_DIR for an out-of-tree build)");
                if (haveProgramme && haveGolden)
                {
                    const SoundSettings::Mastering m { 0.0, -1.0 }; // truepeak.dsp's defaults: what the web rendered
                    expect(runFresh(&m, 48000.0, programme, 128) == golden, "128-sample blocks differ from the web");
                    MasterStage stage;
                    stage.prepare(48000.0);
                    std::mt19937 rng(7);
                    std::uniform_int_distribution<int> size(1, 3000);
                    expect(run(stage, &m, 48000.0, programme, [&] { return size(rng); }) == golden,
                           "random blocks differ from the web");
                }
            }

            beginTest("block-size invariant to the bit");
            {
                const auto in = hotProgramme(48000.0, 30000);
                const auto reference = runFresh(&defaults, 48000.0, in, 512);
                for (int block : { 1, 64, 441, 513, 2048, 8192 })
                    expect(runFresh(&defaults, 48000.0, in, block) == reference, "block " + juce::String(block));
                MasterStage stage;
                stage.prepare(48000.0);
                std::mt19937 rng(99);
                std::uniform_int_distribution<int> size(1, 1500);
                expect(run(stage, &defaults, 48000.0, in, [&] { return size(rng); }) == reference, "random blocks");
            }

            beginTest("switching off fades to the dry signal, then leaves it bit-identical");
            {
                const double rate = 48000.0;
                const auto in = hotProgramme(rate, 20000);
                MasterStage stage;
                stage.prepare(rate);
                auto out = in;
                stage.process(&defaults, rate, 8000, out.l.data(), out.r.data());
                stage.process(nullptr, rate, 12000, out.l.data() + 8000, out.r.data() + 8000);
                const int fade = (int) std::lround(MasterStage::kFadeSec * rate);
                bool dryAfter = true;
                for (int i = 8000 + fade; i < 20000; ++i)
                    dryAfter = dryAfter && out.l[(size_t) i] == in.l[(size_t) i] && out.r[(size_t) i] == in.r[(size_t) i];
                expect(dryAfter, "not dry after the fade");
                // during the fade it is neither: a blend
                expect(out.l[8000 + (size_t) fade / 2] != in.l[8000 + (size_t) fade / 2]);

                // ...and once off, another off block is untouched from its first sample
                auto again = in;
                stage.process(nullptr, rate, 512, again.l.data(), again.r.data());
                expect(std::memcmp(again.l.data(), in.l.data(), 512 * sizeof(float)) == 0);
            }

            beginTest("switching on mid-play fades in, with no step, and ends limited");
            {
                const double rate = 48000.0;
                // a steady sine just under 0 dBFS: dry and trimmed differ by 4 dB
                const auto in = sine(rate, 20000, 220.0, 0.5);
                MasterStage stage;
                stage.prepare(rate);
                auto out = in;
                stage.process(nullptr, rate, 4000, out.l.data(), out.r.data()); // seeds nothing
                // a first engage after an off block that touched nothing is still the stage's
                // first: immediate. Engage, switch off, then on again to get a real fade-in.
                stage.process(&defaults, rate, 4000, out.l.data() + 4000, out.r.data() + 4000);
                stage.process(nullptr, rate, 4000, out.l.data() + 8000, out.r.data() + 8000);
                stage.process(&defaults, rate, 8000, out.l.data() + 12000, out.r.data() + 12000);
                float maxStep = 0.0f;
                for (int i = 12001; i < 20000; ++i)
                    maxStep = std::max(maxStep, std::abs(out.l[(size_t) i] - out.l[(size_t) i - 1]));
                // the sine itself moves at most 2*pi*220/48000*0.5 = 0.0144 a sample
                expect(maxStep < 0.02f, "a step of " + juce::String(maxStep));
                // after the fade: the trimmed sine, 75 samples late
                const float g = dbToGain(defaults.headroomDb);
                bool limited = true;
                for (int i = 12000 + (int) (MasterStage::kFadeSec * rate) + 1; i < 20000; ++i)
                    limited = limited && out.l[(size_t) i] == in.l[(size_t) (i - MasterStage::kLatencySamples)] * g;
                expect(limited, "not the trimmed, delayed signal after the fade-in");
            }

            beginTest("a headroom change ramps over the fade time rather than stepping");
            {
                const double rate = 48000.0;
                Stereo dc(20000);
                std::fill(dc.l.begin(), dc.l.end(), 0.25f);
                std::fill(dc.r.begin(), dc.r.end(), 0.25f);
                MasterStage stage;
                stage.prepare(rate);
                const SoundSettings::Mastering quieter { -8.0, -1.0 };
                auto out = dc;
                stage.process(&defaults, rate, 10000, out.l.data(), out.r.data());
                stage.process(&quieter, rate, 10000, out.l.data() + 10000, out.r.data() + 10000);
                const float g1 = 0.25f * dbToGain(-4.0), g2 = 0.25f * dbToGain(-8.0);
                const int at = 10000 + MasterStage::kLatencySamples; // the change, out of the delay
                expect(out.l[(size_t) at - 1] == g1);
                const int ramp = (int) std::lround(MasterStage::kFadeSec * rate);
                bool monotone = true;
                for (int i = at; i < at + ramp; ++i)
                    monotone = monotone && out.l[(size_t) i] <= out.l[(size_t) i - 1] && out.l[(size_t) i] > g2 - 1e-6f;
                expect(monotone);
                expect(out.l[(size_t) at + (size_t) ramp / 2] < g1 && out.l[(size_t) at + (size_t) ramp / 2] > g2);
                expect(std::abs(out.l[(size_t) at + (size_t) ramp + 10] - g2) < 1e-6f);
            }

            beginTest("reset() forgets the lookahead and the envelope: the next block is a fresh stage's");
            {
                const double rate = 44100.0;
                const auto first = hotProgramme(rate, 5000);
                const auto second = sine(rate, 5000, 440.0, 0.9);
                MasterStage stage;
                stage.prepare(rate);
                run(stage, &defaults, rate, first, [] { return 512; });
                stage.reset();
                expect(run(stage, &defaults, rate, second, [] { return 512; }) == runFresh(&defaults, rate, second, 512));
            }

            beginTest("a rate change swaps the instance in at the next block, and the old one is freed by drainRetired");
            {
                MasterStage stage;
                stage.prepare(44100.0);
                expect(stage.preparedRate() == 44100.0);
                const auto in = sine(48000.0, 4096, 997.0, 0.1);
                run(stage, &defaults, 44100.0, in, [] { return 512; });
                stage.prepare(44100.0); // same rate: nothing built
                stage.prepare(48000.0);
                expect(stage.preparedRate() == 48000.0);
                const auto before = stage.rateMismatchCount();
                expect(run(stage, &defaults, 48000.0, in, [] { return 512; }) == runFresh(&defaults, 48000.0, in, 512));
                expect(stage.rateMismatchCount() == before);
                stage.drainRetired();
                // with the retirement collected, a second swap goes through too
                stage.prepare(44100.0);
                const auto in44 = sine(44100.0, 4096, 997.0, 0.1);
                expect(run(stage, &defaults, 44100.0, in44, [] { return 512; }) == runFresh(&defaults, 44100.0, in44, 512));
                stage.drainRetired();
            }

            beginTest("a swap waits while the previous retirement is uncollected, and the stage keeps running on what it has");
            {
                MasterStage stage;
                stage.prepare(44100.0);
                const auto in44 = sine(44100.0, 1024, 997.0, 0.1);
                run(stage, &defaults, 44100.0, in44, [] { return 512; }); // promotes the first: nothing retired
                stage.prepare(48000.0);
                const auto in48 = sine(48000.0, 1024, 997.0, 0.1);
                run(stage, &defaults, 48000.0, in48, [] { return 512; }); // promotes, retires the 44.1k one
                stage.prepare(44100.0);                                   // retired still occupied
                const auto before = stage.rateMismatchCount();
                expect(run(stage, &defaults, 44100.0, in44, [] { return 512; }) == in44); // deferred: still 48k
                expect(stage.rateMismatchCount() == before + 2);
                stage.drainRetired();
                expect(!(run(stage, &defaults, 44100.0, in44, [] { return 512; }) == in44)); // now swapped
                stage.drainRetired();
            }

            beginTest("stress: rate changes prepared and drained on one thread while another processes -- "
                      "nothing freed under the audio thread, nothing leaked");
            {
                MasterStage stage;
                stage.prepare(44100.0);
                std::atomic<bool> stop { false };
                std::atomic<double> rate { 44100.0 };
                std::thread audio([&] {
                    std::vector<float> l(256), r(256);
                    float phase = 0.0f;
                    while (! stop.load())
                    {
                        for (int i = 0; i < 256; ++i, phase += 0.07f)
                            l[(size_t) i] = r[(size_t) i] = 1.5f * std::sin(phase);
                        const SoundSettings::Mastering m {};
                        stage.process(&m, rate.load(), 256, l.data(), r.data());
                    }
                });
                for (int i = 0; i < stress::kWriterIterations; ++i)
                {
                    const double next = (i % 2) ? 48000.0 : 44100.0;
                    stage.prepare(next);
                    rate.store(next);
                    stage.drainRetired();
                    std::this_thread::sleep_for(std::chrono::microseconds(100));
                    stage.drainRetired();
                }
                stop.store(true);
                audio.join();
                stage.drainRetired();
                expect(true);
            }
        }
    };

    static MasterStageTests masterStageTests;
}

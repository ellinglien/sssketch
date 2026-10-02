// native-engine/Source/MasterSaturationTests.cpp
//
// The master stage's tape saturation (docs/superpowers/plans/2026-10-01-native-radio-sound.md,
// Task 8): headroom -> HP 25 -> saturate.dsp -> glue -> width -> shelves -> limiter. The .dsp
// itself against the web's wasm, to the bit, is FaustStageTests' saturate golden; this file is
// the stage in the chain and the measured claims. The live-equals-export and seek checks with
// the saturation on are in TransportTests.
#include "MasterStage.h"
#include "MasterStageTestUtil.h"
#include <juce_core/juce_core.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <random>
#include <vector>

namespace sssketch
{
    using namespace mastertest;

    namespace
    {
        /** saturate.dsp's makeup at a drive, in dB: +0.5 dB x (drive / 1.8)^2 (radioSound.ts's
         * saturationMakeupDb). */
        double makeupDb(double drive) { return 0.5 * (drive / 1.8) * (drive / 1.8); }

        /** saturate.dsp alone, fresh, at a drive, in 128-sample blocks (the web's quantum). */
        std::vector<float> saturateMono(double rate, double drive, const std::vector<float>& x)
        {
            FaustStage s(FaustDspKind::saturate);
            s.prepare(rate, 512);
            s.setParam("/saturate/drive", (float) drive);
            std::vector<float> y(x.size()), yr(x.size());
            for (size_t at = 0; at < x.size(); at += 128)
            {
                const int n = (int) std::min<size_t>(128, x.size() - at);
                const float* ins[2] = { x.data() + at, x.data() + at };
                float* outs[2] = { y.data() + at, yr.data() + at };
                s.process(ins, 2, outs, n);
            }
            return y;
        }

        std::vector<float> sineMono(double rate, int frames, double freq, double amp)
        {
            std::vector<float> x((size_t) frames);
            for (int i = 0; i < frames; ++i) x[(size_t) i] = (float) (amp * std::sin(2.0 * kPi * freq * i / rate));
            return x;
        }

        /** THD the way the web measured it (radio spike/engine-check check.ts `thd`): a 997 Hz
         * sine, 2 s at 48 kHz; a Hann-windowed 65536-point spectrum from 0.5 s on; each
         * harmonic's magnitude the largest bin within +-3 of it; harmonics 2-10 over the
         * fundamental. In percent. */
        double thdPercent(const std::vector<float>& y, double rate)
        {
            constexpr int N = 65536;
            const size_t from = (size_t) (rate / 2);
            std::vector<double> w((size_t) N);
            for (int i = 0; i < N; ++i)
                w[(size_t) i] = y[from + (size_t) i] * (0.5 - 0.5 * std::cos(2.0 * kPi * i / N));
            auto bin = [&](int k) {
                double re = 0.0, im = 0.0;
                for (int i = 0; i < N; ++i)
                {
                    const double ph = -2.0 * kPi * (double) k * i / N;
                    re += w[(size_t) i] * std::cos(ph);
                    im += w[(size_t) i] * std::sin(ph);
                }
                return std::hypot(re, im);
            };
            auto mag = [&](double hz) {
                const int k = (int) std::lround(hz * N / rate);
                double m = 0.0;
                for (int j = k - 3; j <= k + 3; ++j) m = std::max(m, bin(j));
                return m;
            };
            const double f = mag(997.0);
            double h = 0.0;
            for (int n = 2; n <= 10; ++n) h += std::pow(mag(997.0 * n), 2.0);
            return 100.0 * std::sqrt(h) / f;
        }

        double rmsDb(const std::vector<float>& x, size_t from, size_t to)
        {
            double s = 0.0;
            for (size_t i = from; i < to; ++i) s += (double) x[i] * x[i];
            return 10.0 * std::log10(s / (double) (to - from));
        }

        float maxStep(const std::vector<float>& x, size_t from, size_t to)
        {
            float worst = 0.0f;
            for (size_t i = from + 1; i < to; ++i) worst = std::max(worst, std::abs(x[i] - x[i - 1]));
            return worst;
        }
    }

    class MasterSaturationTests : public juce::UnitTest
    {
    public:
        MasterSaturationTests() : juce::UnitTest("MasterSaturation", "MasterStage") {}

        void runTest() override
        {
            using Settings = MasterStage::Settings;
            using Sat = SoundSettings::Saturation;
            const SoundSettings::Mastering mastering {}; // -4 dB, -1 dBTP
            const SoundSettings::Glue glue {};
            const SoundSettings::Tone tone {};
            const Sat sat {}; // drive 0.9: saturationDrive(0.5), the web's default
            const Settings allOn { mastering, glue, tone, sat };
            const Settings chainNoSat { mastering, glue, tone, std::nullopt };
            constexpr int L = MasterStage::kLatencySamples;
            constexpr double rate = 48000.0;
            const int fade48 = (int) std::lround(MasterStage::kFadeSec * rate);

            beginTest("the whole stage with the saturation is the web's: programme.f32 through the web's master chain "
                      "with its Faust saturate at drive 0.9 in Chrome (master-chain-saturate.out.f32) within 1e-5");
            {
                Stereo programme, golden, goldenNoSat;
                const bool ok = loadGolden("programme.f32", 96000, programme)
                             && loadGolden("master-chain-saturate.out.f32", 96000, golden)
                             && loadGolden("master-chain.out.f32", 96000, goldenNoSat);
                expect(ok, "golden vectors not found under " + goldenDir().getFullPathName()
                               + " (set SSSKETCH_GOLDEN_DIR for an out-of-tree build)");
                if (ok)
                {
                    const auto out = runFresh(&allOn, rate, programme, 128);
                    const float err = maxAbsDiff(out, golden);
                    logMessage("max abs error against the web: " + juce::String(err, 10));
                    expect(err <= 1e-5f, "max abs error " + juce::String(err, 10));
                    // and the saturation did work on it, on the web as here
                    const float bySat = maxAbsDiff(golden, goldenNoSat);
                    logMessage("the saturation's own effect on the web's output: up to " + juce::String(bySat, 6));
                    expect(bySat > 1e-3f);
                    expect(maxAbsDiff(out, runFresh(&chainNoSat, rate, programme, 128)) > 1e-3f);
                }
            }

            beginTest("THD of a -14 dBFS 997 Hz sine, measured as the web did: 0.83% +- 0.2 at drive 0.9 (the default), "
                      "1.8% +- 0.3 at drive 1.8 (amount 1); drive 0 none");
            {
                const auto x = sineMono(rate, (int) (2 * rate), 997.0, std::pow(10.0, -14.0 / 20.0));
                const double atDefault = thdPercent(saturateMono(rate, 0.9, x), rate);
                const double atFull = thdPercent(saturateMono(rate, 1.8, x), rate);
                const auto y0 = saturateMono(rate, 0.0, x);
                const double atZero = thdPercent(y0, rate);
                logMessage("THD: drive 0.9 " + juce::String(atDefault, 3) + "%, drive 1.8 " + juce::String(atFull, 3)
                           + "%, drive 0 " + juce::String(atZero, 5) + "%");
                expect(std::abs(atDefault - 0.83) <= 0.2, juce::String(atDefault, 3) + "% at drive 0.9");
                expect(std::abs(atFull - 1.8) <= 0.3, juce::String(atFull, 3) + "% at drive 1.8");
                expect(atZero < 0.01);
                expect(y0 == x, "drive 0 is not an exact pass-through");
            }

            beginTest("a -40 dBFS sine passes at unity, plus saturate.dsp's makeup (+0.125 dB at 0.9, +0.5 at 1.8), +- 0.01 dB");
            {
                // The plan said "unity +- 0.01 dB"; the .dsp's makeup lifts everything, small
                // signals included, by 0.5 x (drive / 1.8)^2 dB, so that is what comes out.
                const auto x = sineMono(rate, (int) rate, 997.0, 0.01);
                for (double drive : { 0.45, 0.9, 1.8 })
                {
                    const auto y = saturateMono(rate, drive, x);
                    const double gainDb = rmsDb(y, x.size() / 2, x.size()) - rmsDb(x, x.size() / 2, x.size());
                    logMessage("drive " + juce::String(drive) + ": " + juce::String(gainDb, 4) + " dB (makeup "
                               + juce::String(makeupDb(drive), 4) + ")");
                    expect(std::abs(gainDb - makeupDb(drive)) <= 0.01, "drive " + juce::String(drive) + ": "
                                                                          + juce::String(gainDb, 4) + " dB");
                }
            }

            beginTest("drive 0 is bit-identical to the saturation switched off, latency included");
            {
                const auto in = denseMix(rate, 40000);
                const Sat zero { 0.0 };
                const Settings mOnly { mastering, std::nullopt, std::nullopt, std::nullopt };
                const Settings mZero { mastering, std::nullopt, std::nullopt, zero };
                const Settings chainZero { mastering, glue, tone, zero };
                for (const auto& [with, without] : { std::pair { &mZero, &mOnly }, std::pair { &chainZero, &chainNoSat } })
                {
                    for (int block : { 512, 1, 333 })
                        expect(runFresh(with, rate, in, block) == runFresh(without, rate, in, block), "block " + juce::String(block));
                    MasterStage a, b;
                    a.prepare(rate);
                    b.prepare(rate);
                    run(a, with, rate, in, [] { return 256; });
                    run(b, without, rate, in, [] { return 256; });
                    expectEquals(a.currentLatencySamples(), b.currentLatencySamples());
                    expectEquals(a.currentLatencySamples(), L);
                }
                // switched on at drive 0 mid-play (the crossfade mixes the input with itself)
                // and off again: still the stage without it, to the bit
                auto withSwitch = in, plain = in;
                {
                    MasterStage a, b;
                    a.prepare(rate);
                    b.prepare(rate);
                    a.process(&chainNoSat, rate, 10000, withSwitch.l.data(), withSwitch.r.data());
                    a.process(&chainZero, rate, 15000, withSwitch.l.data() + 10000, withSwitch.r.data() + 10000);
                    a.process(&chainNoSat, rate, 15000, withSwitch.l.data() + 25000, withSwitch.r.data() + 25000);
                    b.process(&chainNoSat, rate, 40000, plain.l.data(), plain.r.data());
                }
                expect(withSwitch == plain, "switching on at drive 0 moved a sample");
                // a drive taken down to 0 mid-play glides there in the .dsp, then passes exactly
                {
                    FaustStage s(FaustDspKind::saturate);
                    s.prepare(rate, 512);
                    s.setParam("/saturate/drive", 0.9f);
                    const auto x = denseMix(rate, (int) rate);
                    Stereo y(x.size());
                    const float* ins[2] = { x.l.data(), x.r.data() };
                    float* outs[2] = { y.l.data(), y.r.data() };
                    s.process(ins, 2, outs, 12000);
                    s.setParam("/saturate/drive", 0.0f);
                    const float* ins2[2] = { x.l.data() + 12000, x.r.data() + 12000 };
                    float* outs2[2] = { y.l.data() + 12000, y.r.data() + 12000 };
                    s.process(ins2, 2, outs2, (int) x.size() - 12000);
                    // the glide: under 0.001 after ln(900) x 20 ms = 136 ms
                    const size_t settled = 12000 + (size_t) (0.2 * rate);
                    expect(std::memcmp(y.l.data() + settled, x.l.data() + settled, (x.size() - settled) * sizeof(float)) == 0
                               && std::memcmp(y.r.data() + settled, x.r.data() + settled, (x.size() - settled) * sizeof(float)) == 0,
                           "not an exact pass-through 200 ms after the drive went to 0");
                    expect(y.l[12010] != x.l[12010], "the drive should glide, not cut to 0");
                }
            }

            beginTest("no DC: the asymmetric curve's offset is taken out by the .dsp's 5 Hz blocker");
            {
                // a hot 100 Hz sine at the full drive: the bias's asymmetry makes a real offset
                const double amp = std::pow(10.0, -3.0 / 20.0), drive = 1.8, bias = 0.1;
                const auto x = sineMono(rate, (int) (3 * rate), 100.0, amp);
                const auto y = saturateMono(rate, drive, x);
                const size_t from = (size_t) rate, to = x.size(); // 2 s: 200 whole cycles
                double meanOut = 0.0, meanCurve = 0.0, peak = 0.0;
                const double slope = drive * (1.0 - std::tanh(bias) * std::tanh(bias));
                const double makeup = std::pow(10.0, makeupDb(drive) / 20.0);
                for (size_t i = from; i < to; ++i)
                {
                    meanOut += y[i];
                    meanCurve += (std::tanh(drive * x[i] + bias) - std::tanh(bias)) / slope * makeup;
                    peak = std::max(peak, (double) std::abs(y[i]));
                }
                meanOut /= (double) (to - from);
                meanCurve /= (double) (to - from);
                logMessage("mean: the bare curve " + juce::String(meanCurve, 6) + ", the stage " + juce::String(meanOut, 9)
                           + " (peak " + juce::String(peak, 4) + ")");
                expect(std::abs(meanCurve) > 1e-2, "the curve should have had an offset to remove");
                expect(std::abs(meanOut) < 1e-5, "DC left: " + juce::String(meanOut, 9));
            }

            beginTest("a dense mix level-matches within 0.3 dB (RMS, after the headroom trim, at drives 0.9 and 1.8)");
            {
                const auto mix = denseMix(rate, (int) (3 * rate));
                const float trim = (float) std::pow(10.0, mastering.headroomDb / 20.0);
                std::vector<float> l(mix.l);
                for (auto& v : l) v *= trim;
                for (double drive : { 0.9, 1.8 })
                {
                    const auto y = saturateMono(rate, drive, l);
                    const double diff = rmsDb(y, (size_t) rate, l.size()) - rmsDb(l, (size_t) rate, l.size());
                    float peakIn = 0.0f, peakOut = 0.0f;
                    for (size_t i = (size_t) rate; i < l.size(); ++i)
                    {
                        peakIn = std::max(peakIn, std::abs(l[i]));
                        peakOut = std::max(peakOut, std::abs(y[i]));
                    }
                    logMessage("drive " + juce::String(drive) + ": RMS " + juce::String(diff, 3) + " dB, peak "
                               + juce::String(20.0 * std::log10(peakOut / peakIn), 3) + " dB");
                    expect(std::abs(diff) <= 0.3, "drive " + juce::String(drive) + ": " + juce::String(diff, 3) + " dB");
                }
            }

            beginTest("switched off, the stage is absent: every combination equals its parts run by hand, to the bit");
            for (double r : { 44100.0, 48000.0 })
            {
                const auto in = denseMix(r, 40000);
                const Settings satOnly { mastering, std::nullopt, std::nullopt, sat };
                const Settings satGlue { mastering, glue, std::nullopt, sat };
                const Settings satTone { mastering, std::nullopt, tone, Sat { 1.8 } };
                const Settings mOnly { mastering, std::nullopt, std::nullopt, std::nullopt };
                for (const auto* s : { &allOn, &satOnly, &satGlue, &satTone, &chainNoSat, &mOnly })
                    expect(runFresh(s, r, in, 512) == byHand(*s, r, in),
                           "rate " + juce::String(r) + ", glue " + juce::String((int) s->glue.has_value()) + ", tone "
                               + juce::String((int) s->tone.has_value()) + ", saturation "
                               + juce::String((int) s->saturation.has_value()));
                expect(! (runFresh(&allOn, r, in, 512) == runFresh(&chainNoSat, r, in, 512)));
            }

            // As MasterGlueToneTests: no headroom, a signal under the ceiling, so the limiter is a
            // pure 75-sample delay and the saturation's own output can be checked exactly.
            const auto steady = [&] {
                auto s = denseMix(rate, 36000, 77);
                for (size_t i = 0; i < s.size(); ++i)
                {
                    s.l[i] *= 0.6f;
                    s.r[i] *= 0.6f;
                }
                return s;
            }();
            const SoundSettings::Mastering flat { 0.0, -1.0 };
            const Settings flatSat { flat, std::nullopt, std::nullopt, sat };
            const Settings flatNone { flat, std::nullopt, std::nullopt, std::nullopt };
            auto saturated = [&](size_t from, double drive) {
                Stereo x(steady.size() - from), y(steady.size() - from);
                std::copy(steady.l.begin() + (long) from, steady.l.end(), x.l.begin());
                std::copy(steady.r.begin() + (long) from, steady.r.end(), x.r.begin());
                FaustStage s(FaustDspKind::saturate);
                s.prepare(rate, 512);
                s.setParam("/saturate/drive", (float) drive);
                const float* ins[2] = { x.l.data(), x.r.data() };
                float* outs[2] = { y.l.data(), y.r.data() };
                s.process(ins, 2, outs, (int) x.size());
                return y;
            };

            beginTest("saturation switched on mid-play fades in from a cleared state; switched off it fades back to exactly "
                      "the dry stage, with no step either way");
            {
                const size_t on = 12000, off = 26000;
                MasterStage stage;
                stage.prepare(rate);
                auto out = steady;
                stage.process(&flatNone, rate, (int) on, out.l.data(), out.r.data());
                stage.process(&flatSat, rate, (int) (off - on), out.l.data() + on, out.r.data() + on);
                stage.process(&flatNone, rate, (int) (steady.size() - off), out.l.data() + off, out.r.data() + off);

                const auto wet = saturated(on, sat.drive); // started clean at the switch, run on through the fade-out
                bool before = true, asWet = true, after = true;
                for (size_t i = L; i < on + L; ++i)
                    before = before && out.l[i] == steady.l[i - L] && out.r[i] == steady.r[i - L];
                for (size_t i = on + (size_t) fade48 + L; i < off + L; ++i)
                    asWet = asWet && out.l[i] == wet.l[i - L - on] && out.r[i] == wet.r[i - L - on];
                for (size_t i = off + (size_t) fade48 + L; i < steady.size(); ++i)
                    after = after && out.l[i] == steady.l[i - L] && out.r[i] == steady.r[i - L];
                expect(before, "not the plain delay before the switch");
                expect(asWet, "not the saturation's output after the fade-in");
                expect(after, "not dry after the fade-out");
                // no step: across each fade the output moves no more, sample to sample, than the
                // louder of the two signals it fades between (5% to spare)
                for (size_t at : { on, off })
                {
                    const size_t from = at + L - 10, to = at + L + (size_t) fade48 + 10;
                    const float stepOut = maxStep(out.l, from, to);
                    const float stepDry = maxStep(steady.l, from - L, to - L);
                    const float stepWet = maxStep(wet.l, from - L - on, to - L - on);
                    expect(stepOut <= 1.05f * std::max(stepDry, stepWet), "a step of " + juce::String(stepOut) + " at "
                                                                              + juce::String((int) at));
                }
            }

            beginTest("a drive change is set on the .dsp at once and glides inside it (the web's way): the same samples "
                      "as saturate.dsp told at the same sample");
            {
                const size_t at = 15000;
                const Settings harder { flat, std::nullopt, std::nullopt, Sat { 1.8 } };
                MasterStage stage;
                stage.prepare(rate);
                auto out = steady;
                stage.process(&flatSat, rate, (int) at, out.l.data(), out.r.data());
                stage.process(&harder, rate, (int) (steady.size() - at), out.l.data() + at, out.r.data() + at);

                FaustStage s(FaustDspKind::saturate);
                s.prepare(rate, 512);
                s.setParam("/saturate/drive", 0.9f);
                Stereo want(steady.size());
                const float* ins[2] = { steady.l.data(), steady.r.data() };
                float* outs[2] = { want.l.data(), want.r.data() };
                s.process(ins, 2, outs, (int) at);
                s.setParam("/saturate/drive", 1.8f);
                const float* ins2[2] = { steady.l.data() + at, steady.r.data() + at };
                float* outs2[2] = { want.l.data() + at, want.r.data() + at };
                s.process(ins2, 2, outs2, (int) (steady.size() - at));
                bool same = true;
                for (size_t i = L; i < steady.size() && same; ++i)
                    same = out.l[i] == want.l[i - L] && out.r[i] == want.r[i - L];
                expect(same);
                // and no jump: across the change the output moves no more than the input does
                // times the steepest the curve gets at the full drive (its makeup, +0.5 dB, and 1% for the bias), plus spare
                const float stepOut = maxStep(out.l, at + L - 50, at + L + 2000);
                const float stepIn = maxStep(steady.l, at - 50, at + 2000);
                expect(stepOut <= 1.05f * (float) std::pow(10.0, makeupDb(1.8) / 20.0) * stepIn,
                       "a step of " + juce::String(stepOut) + " (the input's " + juce::String(stepIn) + ")");
            }

            beginTest("clearDynamics clears the saturation too: from there the stage is a fresh one's, to the bit");
            {
                const size_t at = 20000;
                const Settings s { flat, glue, tone, Sat { 1.8 } };
                MasterStage stage;
                stage.prepare(rate);
                auto out = steady;
                stage.process(&s, rate, (int) at, out.l.data(), out.r.data());
                stage.clearDynamics();
                stage.process(&s, rate, (int) (steady.size() - at), out.l.data() + at, out.r.data() + at);
                Stereo rest(steady.size() - at);
                std::copy(steady.l.begin() + (long) at, steady.l.end(), rest.l.begin());
                std::copy(steady.r.begin() + (long) at, steady.r.end(), rest.r.begin());
                const auto fresh = runFresh(&s, rate, rest, 512);
                expect(std::memcmp(out.l.data() + at, fresh.l.data(), fresh.size() * sizeof(float)) == 0
                       && std::memcmp(out.r.data() + at, fresh.r.data(), fresh.size() * sizeof(float)) == 0);
            }

            beginTest("switches, drives and fades with the saturation are block-size invariant to the bit");
            {
                const double r = 44100.0;
                const Settings satOnly { mastering, std::nullopt, std::nullopt, sat };
                const Settings hot { mastering, glue, tone, Sat { 1.8 } };
                const Settings zero { mastering, glue, tone, Sat { 0.0 } };
                // (first sample, settings): saturation on, off, back on mid-fade, its drive up,
                // to 0 and back, mastering off and on with it inside
                const std::vector<std::pair<int, const Settings*>> schedule {
                    { 0, &allOn }, { 2500, &chainNoSat }, { 2800, &allOn }, { 5000, &hot }, { 9000, &zero },
                    { 14000, &allOn }, { 16000, &satOnly }, { 19000, nullptr }, { 19400, &allOn }, { 23000, nullptr },
                    { 26000, &hot },
                };
                const auto in = denseMix(r, 32000);
                auto runSplit = [&](auto nextBlock) {
                    MasterStage stage;
                    stage.prepare(r);
                    auto out = in;
                    size_t seg = 0;
                    for (int at = 0; at < (int) out.size();)
                    {
                        while (seg + 1 < schedule.size() && schedule[seg + 1].first <= at) ++seg;
                        const int segEnd = seg + 1 < schedule.size() ? schedule[seg + 1].first : (int) out.size();
                        if (at == 14000) stage.clearDynamics(); // a seek, between blocks
                        const int n = juce::jmin(juce::jmax(1, nextBlock()), segEnd - at, at < 14000 ? 14000 - at : segEnd - at);
                        stage.process(schedule[seg].second, r, n, out.l.data() + at, out.r.data() + at);
                        at += n;
                    }
                    return out;
                };
                const auto reference = runSplit([] { return 512; });
                for (int block : { 1, 77, 300, 4096 })
                    expect(runSplit([block] { return block; }) == reference, "block " + juce::String(block));
                std::mt19937 rng(17);
                std::uniform_int_distribution<int> size(1, 1300);
                expect(runSplit([&] { return size(rng); }) == reference, "random blocks");
            }
        }
    };

    static MasterSaturationTests masterSaturationTests;
}

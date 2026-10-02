// native-engine/Source/MasterGlueToneTests.cpp
//
// The master stage's glue and tone (docs/superpowers/plans/2026-10-01-native-radio-sound.md,
// Task 7): headroom -> HP 25 -> [saturation: MasterSaturationTests] -> glue -> width -> low shelf
// -> high shelf -> limiter. MasterStageTests covers the headroom, the limiter and mastering's own
// fades; the live-equals-export check with glue and tone on is in TransportTests. The signals and
// the by-hand stage are in MasterStageTestUtil.h.
#include "MasterStage.h"
#include "MasterStageTestUtil.h"
#include "MasterTone.h"
#include <juce_core/juce_core.h>
#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdlib>
#include <cstring>
#include <random>
#include <vector>

namespace sssketch
{
    using namespace mastertest;

    namespace
    {
        /** The RBJ cookbook's magnitude, written out independently of MasterTone.cpp: a
         * high-pass at linear Q, or a shelf at slope 1 (Q = 1/sqrt 2), at `freq`. */
        double rbjMagnitudeDb(const char* type, double rate, double f0, double param, double freq)
        {
            const double w0 = 2.0 * kPi * f0 / rate;
            const double cw = std::cos(w0), sw = std::sin(w0);
            double b0, b1, b2, a0, a1, a2;
            if (std::strcmp(type, "highpass") == 0)
            {
                const double alpha = sw / (2.0 * param); // param: linear Q
                b0 = (1 + cw) / 2;
                b1 = -(1 + cw);
                b2 = (1 + cw) / 2;
                a0 = 1 + alpha;
                a1 = -2 * cw;
                a2 = 1 - alpha;
            }
            else
            {
                const double A = std::pow(10.0, param / 40.0); // param: gain dB
                const double alpha = sw / (2.0 * std::sqrt(0.5));
                const double sa = 2 * std::sqrt(A) * alpha;
                if (std::strcmp(type, "lowshelf") == 0)
                {
                    b0 = A * ((A + 1) - (A - 1) * cw + sa);
                    b1 = 2 * A * ((A - 1) - (A + 1) * cw);
                    b2 = A * ((A + 1) - (A - 1) * cw - sa);
                    a0 = (A + 1) + (A - 1) * cw + sa;
                    a1 = -2 * ((A - 1) + (A + 1) * cw);
                    a2 = (A + 1) + (A - 1) * cw - sa;
                }
                else
                {
                    b0 = A * ((A + 1) + (A - 1) * cw + sa);
                    b1 = -2 * A * ((A - 1) + (A + 1) * cw);
                    b2 = A * ((A + 1) + (A - 1) * cw - sa);
                    a0 = (A + 1) - (A - 1) * cw + sa;
                    a1 = 2 * ((A - 1) - (A + 1) * cw);
                    a2 = (A + 1) - (A - 1) * cw - sa;
                }
            }
            const std::complex<double> z1 = std::polar(1.0, -2.0 * kPi * freq / rate);
            const auto h = (b0 + b1 * z1 + b2 * z1 * z1) / (a0 + a1 * z1 + a2 * z1 * z1);
            return 20.0 * std::log10(std::abs(h));
        }

        /** A sine's gain through `process` (mono), in dB, by least squares over its last half:
         * the output's projection onto the input sine and its quadrature. */
        template <typename Process>
        double measuredGainDb(double rate, double freq, Process&& process)
        {
            const int frames = (int) std::max(rate, 40.0 * rate / freq); // at least 1 s, 40 cycles
            std::vector<float> x((size_t) frames);
            for (int i = 0; i < frames; ++i) x[(size_t) i] = (float) (0.25 * std::sin(2.0 * kPi * freq * i / rate));
            auto y = x;
            process(frames, y.data());
            double sc = 0.0, ss = 0.0, cc = 0.0, sy = 0.0, cy = 0.0;
            for (int i = frames / 2; i < frames; ++i)
            {
                const double s = std::sin(2.0 * kPi * freq * i / rate), c = std::cos(2.0 * kPi * freq * i / rate);
                ss += s * s;
                cc += c * c;
                sc += s * c;
                sy += s * y[(size_t) i];
                cy += c * y[(size_t) i];
            }
            // solve [ss sc; sc cc] [a b] = [sy cy]
            const double det = ss * cc - sc * sc;
            const double a = (sy * cc - cy * sc) / det, b = (cy * ss - sy * sc) / det;
            return 20.0 * std::log10(std::sqrt(a * a + b * b) / 0.25);
        }
    }

    class MasterGlueToneTests : public juce::UnitTest
    {
    public:
        MasterGlueToneTests() : juce::UnitTest("MasterGlueTone", "MasterStage") {}

        void runTest() override
        {
            using Settings = MasterStage::Settings;
            const SoundSettings::Mastering mastering {};    // -4 dB, -1 dBTP
            const SoundSettings::Glue glue {};               // -14 dB, 2:1, knee 6: glue.dsp's defaults
            const SoundSettings::Tone tone {};               // +1 / +1 dB: the web's
            const Settings allOn { mastering, glue, tone };
            const Settings glueOnly { mastering, glue, std::nullopt };
            const Settings toneOnly { mastering, std::nullopt, tone };
            const Settings neither { mastering, std::nullopt, std::nullopt };
            const int fade48 = (int) std::lround(MasterStage::kFadeSec * 48000.0);
            constexpr int L = MasterStage::kLatencySamples;

            beginTest("the whole stage is the web's: programme.f32 through the web's master chain in Chrome "
                      "(master-chain.out.f32) within 1e-5");
            {
                Stereo programme, golden;
                const bool ok = loadGolden("programme.f32", 96000, programme) && loadGolden("master-chain.out.f32", 96000, golden);
                expect(ok, "golden vectors not found under " + goldenDir().getFullPathName()
                               + " (set SSSKETCH_GOLDEN_DIR for an out-of-tree build)");
                if (ok)
                {
                    const auto out = runFresh(&allOn, 48000.0, programme, 128); // the web's render quantum
                    const float err = maxAbsDiff(out, golden);
                    logMessage("max abs error against the web: " + juce::String(err, 10));
                    expect(err <= 1e-5f, "max abs error " + juce::String(err, 10));
                    // and the chain did work on it: the glue and the limiter both bit
                    expect(maxAbsDiff(out, runFresh(&neither, 48000.0, programme, 128)) > 1e-2f);
                }
            }

            beginTest("each switch removes exactly its stage: the stage equals its parts run by hand, to the bit");
            for (double rate : { 44100.0, 48000.0 })
            {
                const auto in = denseMix(rate, 40000);
                for (const auto* s : { &allOn, &glueOnly, &toneOnly, &neither })
                    expect(runFresh(s, rate, in, 512) == byHand(*s, rate, in),
                           "rate " + juce::String(rate) + ", glue " + juce::String((int) s->glue.has_value())
                               + ", tone " + juce::String((int) s->tone.has_value()));
                // glue and tone off is Task 3's stage, to the bit
                MasterStage task3;
                task3.prepare(rate);
                auto viaMastering = in;
                for (int at = 0; at < (int) in.size(); at += 512)
                {
                    const int n = juce::jmin(512, (int) in.size() - at);
                    task3.process(&mastering, rate, n, viaMastering.l.data() + at, viaMastering.r.data() + at);
                }
                expect(runFresh(&neither, rate, in, 512) == viaMastering);
                // and the latency is the limiter's alone
                MasterStage stage;
                stage.prepare(rate);
                run(stage, &allOn, rate, in, [] { return 256; });
                expectEquals(stage.currentLatencySamples(), L);
            }

            beginTest("glue: unity below the knee; 10 dB over the threshold comes out about 5 dB over (2:1)");
            {
                const double rate = 48000.0;
                // A square wave: its level (glue.dsp's detector, the louder side's |x|) is constant.
                // No headroom, tone off; the limiter is transparent this far under its ceiling.
                auto square = [&](double amp) {
                    Stereo s((size_t) (3.0 * rate));
                    for (size_t i = 0; i < s.size(); ++i)
                        s.l[i] = s.r[i] = (float) ((i / 240) % 2 ? amp : -amp); // 100 Hz
                    return s;
                };
                const Settings g { { 0.0, -1.0 }, glue, std::nullopt };
                const Settings off { { 0.0, -1.0 }, std::nullopt, std::nullopt };
                // below the knee (threshold - knee/2 = -17 dB): exactly the glue-off stage
                const auto quiet = square(std::pow(10.0, -20.0 / 20.0));
                expect(runFresh(&g, rate, quiet, 512) == runFresh(&off, rate, quiet, 512), "the glue touched a -20 dBFS signal");

                const auto loud = square(std::pow(10.0, (glue.thresholdDb + 10.0) / 20.0)); // -4 dBFS
                const auto out = runFresh(&g, rate, loud, 512);
                float peak = 0.0f;
                for (size_t i = (size_t) (2.5 * rate); i < out.size(); ++i) peak = std::max(peak, std::abs(out.l[i]));
                const double overDb = 20.0 * std::log10(peak) - glue.thresholdDb;
                logMessage("+10 dB over the threshold comes out " + juce::String(overDb, 3) + " dB over");
                expect(std::abs(overDb - 5.0) < 0.25, juce::String(overDb, 3) + " dB over");
            }

            beginTest("width leaves L + R unchanged (to 1e-6) and widens the side above 250 Hz");
            for (double rate : { 44100.0, 48000.0, 96000.0 })
            {
                const auto in = denseMix(rate, (int) rate);
                auto out = in;
                WebBiquad side;
                side.setHighShelf(rate, MasterTone::kSideShelfHz, MasterTone::kSideShelfDb);
                MasterTone::width(side, (int) out.size(), out.l.data(), out.r.data());
                double worst = 0.0, sideIn = 0.0, sideOut = 0.0;
                for (size_t i = 0; i < in.size(); ++i)
                {
                    worst = std::max(worst, std::abs(((double) out.l[i] + out.r[i]) - ((double) in.l[i] + in.r[i])));
                    sideIn += std::pow((double) in.l[i] - in.r[i], 2.0);
                    sideOut += std::pow((double) out.l[i] - out.r[i], 2.0);
                }
                expect(worst <= 1e-6, "rate " + juce::String(rate) + ": L + R moved by " + juce::String(worst, 10));
                // the side is mostly the 3-7 kHz partials and the noise: close to the full +2 dB
                const double gainDb = 10.0 * std::log10(sideOut / sideIn);
                expect(gainDb > 1.0 && gainDb < 2.05, "side gain " + juce::String(gainDb, 3) + " dB");
                // a mono input stays exactly mono, at exactly its level
                auto mono = sine(rate, 4096, 1000.0, 0.5);
                auto monoOut = mono;
                WebBiquad side2;
                side2.setHighShelf(rate, MasterTone::kSideShelfHz, MasterTone::kSideShelfDb);
                MasterTone::width(side2, 4096, monoOut.l.data(), monoOut.r.data());
                expect(monoOut == mono, "a mono input changed");
            }

            beginTest("the filters are within 0.1 dB of the RBJ formulas, at the web's frequencies, gains and Q");
            for (double rate : { 44100.0, 48000.0, 96000.0 })
            {
                double worst = 0.0;
                for (double f : { 15.0, 25.0, 50.0, 100.0, 200.0, 250.0, 500.0, 1000.0, 4000.0, 10000.0, 15000.0, 20000.0 })
                {
                    auto check = [&](const char* type, double f0, double param, double measured) {
                        const double want = rbjMagnitudeDb(type, rate, f0, param, f);
                        worst = std::max(worst, std::abs(measured - want));
                        expect(std::abs(measured - want) <= 0.1, juce::String(type) + " " + juce::String(f0) + " Hz, "
                                                                   + juce::String(param) + " at " + juce::String(f) + " Hz, rate "
                                                                   + juce::String(rate) + ": " + juce::String(measured, 4)
                                                                   + " dB, the formula " + juce::String(want, 4));
                    };
                    {
                        WebBiquad hp;
                        hp.setHighpass(rate, MasterTone::kHighpassHz, MasterTone::kHighpassQDb);
                        check("highpass", 25.0, std::sqrt(0.5), measuredGainDb(rate, f, [&](int n, float* x) { hp.process(n, x); }));
                    }
                    {
                        WebBiquad s;
                        s.setHighShelf(rate, MasterTone::kSideShelfHz, MasterTone::kSideShelfDb);
                        check("highshelf", 250.0, 2.0, measuredGainDb(rate, f, [&](int n, float* x) { s.process(n, x); }));
                    }
                    // the shelves at the default and across the tone amount's tilt (toneShelvesDb:
                    // low 1 - 1.5a, high 1 + 1.5a, a in -1..1), through MasterTone itself (a mono
                    // input, so the width is a no-op)
                    for (double a : { -1.0, 0.0, 0.5, 1.0 })
                    {
                        const float low = (float) (1.0 - 1.5 * a), high = (float) (1.0 + 1.5 * a);
                        MasterTone t;
                        t.prepare(rate);
                        t.setShelves(low, high, 0);
                        const double measured = measuredGainDb(rate, f, [&](int n, float* x) {
                            std::vector<float> r(x, x + n);
                            t.widthAndShelves(n, x, r.data(), nullptr);
                        });
                        const double want = rbjMagnitudeDb("lowshelf", rate, 100.0, low, f) + rbjMagnitudeDb("highshelf", rate, 10000.0, high, f);
                        worst = std::max(worst, std::abs(measured - want));
                        expect(std::abs(measured - want) <= 0.1, "shelves " + juce::String(low) + "/" + juce::String(high) + " at "
                                                                     + juce::String(f) + " Hz: " + juce::String(measured, 4)
                                                                     + " dB, the formula " + juce::String(want, 4));
                    }
                }
                logMessage("rate " + juce::String(rate) + ": worst " + juce::String(worst, 5) + " dB from the formulas");
            }

            beginTest("the HP's Q is the web's biquadQ(0): -3.01 dB, i.e. -3 dB at 25 Hz (Butterworth)");
            {
                WebBiquad hp;
                hp.setHighpass(48000.0, MasterTone::kHighpassHz, MasterTone::kHighpassQDb);
                const double at = measuredGainDb(48000.0, 25.0, [&](int n, float* x) { hp.process(n, x); });
                expect(std::abs(at + 3.01) < 0.02, juce::String(at, 4) + " dB at 25 Hz");
                expect(std::abs(std::pow(10.0, MasterTone::kHighpassQDb / 20.0) - std::sqrt(0.5)) < 1e-5);
            }

            beginTest("the tone's filters go to exact zero after the input stops (Chromium's subnormal guard), "
                      "rather than ringing on in subnormals");
            {
                const double rate = 48000.0;
                auto x = denseMix(rate, (int) (2.5 * rate));
                std::fill(x.l.begin() + (long) (0.5 * rate), x.l.end(), 0.0f);
                std::fill(x.r.begin() + (long) (0.5 * rate), x.r.end(), 0.0f);
                MasterTone t;
                t.prepare(rate);
                t.setShelves(1.0f, 1.0f, 0);
                t.highpass((int) x.size(), x.l.data(), x.r.data(), nullptr);
                t.widthAndShelves((int) x.size(), x.l.data(), x.r.data(), nullptr);
                bool zero = true;
                for (size_t i = (size_t) (2.0 * rate); i < x.size(); ++i)
                    zero = zero && x.l[i] == 0.0f && x.r[i] == 0.0f;
                expect(zero, "still ringing 1.5 s after the input stopped");
                bool tailWasThere = false; // and it did ring for a while first
                for (size_t i = (size_t) (0.5 * rate); i < (size_t) (0.6 * rate); ++i)
                    tailWasThere = tailWasThere || x.l[i] != 0.0f;
                expect(tailWasThere);
            }

            beginTest("block-size invariant to the bit, all on");
            {
                const auto in = denseMix(48000.0, 30000);
                const auto reference = runFresh(&allOn, 48000.0, in, 512);
                for (int block : { 1, 64, 128, 441, 513, 4096 })
                    expect(runFresh(&allOn, 48000.0, in, block) == reference, "block " + juce::String(block));
                MasterStage stage;
                stage.prepare(48000.0);
                std::mt19937 rng(5);
                std::uniform_int_distribution<int> size(1, 1500);
                expect(run(stage, &allOn, 48000.0, in, [&] { return size(rng); }) == reference, "random blocks");
            }

            beginTest("switches, amounts and fades are block-size invariant: the same schedule at the same samples, any split");
            {
                const double rate = 44100.0;
                const Settings warmer { mastering, glue, SoundSettings::Tone { 2.5, -0.5 } };
                const Settings harder { mastering, SoundSettings::Glue { -20.0, 2.0, 6.0 }, tone };
                // (first sample, settings): glue off and on, tone off and on (and back mid-fade),
                // a tone tilt, a glue amount, mastering off and on with both inside
                const std::vector<std::pair<int, const Settings*>> schedule {
                    { 0, &allOn }, { 2000, &toneOnly }, { 3000, &allOn }, { 3300, &glueOnly }, { 3500, &allOn },
                    { 6000, &warmer }, { 6400, &allOn }, { 9000, &harder }, { 12000, &neither }, { 15000, nullptr },
                    { 15500, &allOn }, { 19000, nullptr }, { 23000, &toneOnly }, { 26000, &allOn },
                };
                const auto in = denseMix(rate, 30000);
                auto runSplit = [&](auto nextBlock) {
                    MasterStage stage;
                    stage.prepare(rate);
                    auto out = in;
                    size_t seg = 0;
                    for (int at = 0; at < (int) out.size();)
                    {
                        while (seg + 1 < schedule.size() && schedule[seg + 1].first <= at) ++seg;
                        const int segEnd = seg + 1 < schedule.size() ? schedule[seg + 1].first : (int) out.size();
                        const int n = juce::jmin(juce::jmax(1, nextBlock()), segEnd - at);
                        stage.process(schedule[seg].second, rate, n, out.l.data() + at, out.r.data() + at);
                        at += n;
                    }
                    return out;
                };
                const auto reference = runSplit([] { return 512; });
                for (int block : { 1, 77, 300, 4096 })
                    expect(runSplit([block] { return block; }) == reference, "block " + juce::String(block));
                std::mt19937 rng(11);
                std::uniform_int_distribution<int> size(1, 1300);
                expect(runSplit([&] { return size(rng); }) == reference, "random blocks");
            }

            // The switch tests run with no headroom on a signal under the ceiling, so the limiter
            // is a pure 75-sample delay and each stage's own output can be checked exactly.
            const double rate = 48000.0;
            const auto steady = [&] {
                auto s = denseMix(rate, 36000, 77);
                for (size_t i = 0; i < s.size(); ++i) // peaks about -5 dBFS: the glue works, the limiter idles
                {
                    s.l[i] *= 0.6f;
                    s.r[i] *= 0.6f;
                }
                return s;
            }();
            const SoundSettings::Mastering flat { 0.0, -1.0 };
            const Settings flatGlue { flat, glue, std::nullopt }, flatTone { flat, std::nullopt, tone }, flatNeither { flat, std::nullopt, std::nullopt };
            auto maxStep = [](const std::vector<float>& x, size_t from, size_t to) {
                float worst = 0.0f;
                for (size_t i = from + 1; i < to; ++i) worst = std::max(worst, std::abs(x[i] - x[i - 1]));
                return worst;
            };
            auto delayedEquals = [&](const Stereo& out, const Stereo& want, size_t from, size_t to) {
                for (size_t i = from; i < to; ++i)
                    if (out.l[i] != want.l[i - L] || out.r[i] != want.r[i - L]) return false;
                return true;
            };
            /** `out` over [from, to) moves no more from sample to sample than either signal it
             * fades between (each 75 samples late, `b` starting at `bFrom` in out's time) -- no
             * step from the switch -- with 5% to spare. */
            auto noStep = [&](const Stereo& out, const Stereo& a, const Stereo& b, size_t bFrom, size_t from, size_t to) {
                expect(from >= L + bFrom);
                for (int ch = 0; ch < 2; ++ch)
                {
                    const auto& av = ch == 0 ? a.l : a.r;
                    const auto& bv = ch == 0 ? b.l : b.r;
                    const auto& ov = ch == 0 ? out.l : out.r;
                    const float stepA = maxStep(av, from - L, to - L);
                    const float stepB = maxStep(bv, from - L - bFrom, to - L - bFrom);
                    const float stepOut = maxStep(ov, from, to);
                    const bool ok = stepOut <= 1.05f * std::max(stepA, stepB);
                    expect(ok, juce::String(ch == 0 ? "L" : "R") + ": a step of " + juce::String(stepOut)
                                   + " (the two sides move " + juce::String(stepA) + ", " + juce::String(stepB) + ")");
                }
            };
            auto segment = [](const Stereo& s, size_t from, size_t to) {
                Stereo out(to - from);
                std::copy(s.l.begin() + (long) from, s.l.begin() + (long) to, out.l.begin());
                std::copy(s.r.begin() + (long) from, s.r.begin() + (long) to, out.r.begin());
                return out;
            };

            beginTest("glue switched on mid-play fades in from a cleared state; switched off it fades back to exactly the dry stage");
            {
                const size_t on = 20000, off = 30000; // a swell at 24000
                MasterStage stage;
                stage.prepare(rate);
                auto out = steady;
                stage.process(&flatNeither, rate, (int) on, out.l.data(), out.r.data());
                stage.process(&flatGlue, rate, (int) (off - on), out.l.data() + on, out.r.data() + on);
                stage.process(&flatNeither, rate, (int) (steady.size() - off), out.l.data() + off, out.r.data() + off);

                expect(delayedEquals(out, steady, L, on + L), "not the plain delay before the switch");
                // after the fade-in: the glue, started clean at the switch, exactly
                // the glue run from the switch to the end: it keeps running through the fade-out
                const auto dry = segment(steady, on, steady.size());
                Stereo glued(steady.size() - on);
                {
                    FaustStage g(FaustDspKind::glue);
                    g.prepare(rate, 512);
                    const float* ins[2] = { dry.l.data(), dry.r.data() };
                    float* outs[2] = { glued.l.data(), glued.r.data() };
                    g.process(ins, 2, outs, (int) glued.size());
                }
                bool asGlued = true;
                for (size_t i = on + (size_t) fade48 + L; i < off + L && asGlued; ++i)
                    asGlued = out.l[i] == glued.l[i - L - on] && out.r[i] == glued.r[i - L - on];
                expect(asGlued, "not the glue's output after the fade-in");
                const float reductionDb = (float) (20.0 * std::log10(maxAbsDiff(glued, Stereo(glued.size())) / maxAbsDiff(dry, Stereo(dry.size()))));
                logMessage("the glue's peak, against the input's: " + juce::String(reductionDb, 2) + " dB");
                expect(reductionDb < -0.3f, "the glue hardly worked: " + juce::String(reductionDb, 2) + " dB");
                // after the fade-out: the dry stage again, exactly
                expect(delayedEquals(out, steady, off + (size_t) fade48 + L, steady.size()), "not dry after the fade-out");
                noStep(out, steady, glued, on, on + L, on + L + (size_t) fade48 + 10);
                noStep(out, steady, glued, on, off + L - 10, off + L + (size_t) fade48 + 10);
            }

            beginTest("tone switched on mid-play fades in from a cleared state, then settles onto the tone; switched off it "
                      "fades back to exactly the dry stage");
            {
                const size_t on = 5000, off = 25000;
                MasterStage stage;
                stage.prepare(rate);
                auto out = steady;
                stage.process(&flatNeither, rate, (int) on, out.l.data(), out.r.data());
                stage.process(&flatTone, rate, (int) (off - on), out.l.data() + on, out.r.data() + on);
                stage.process(&flatNeither, rate, (int) (steady.size() - off), out.l.data() + off, out.r.data() + off);

                auto toned = segment(steady, on, steady.size()); // the tone runs on through the fade-out
                {
                    MasterTone t;
                    t.prepare(rate);
                    t.setShelves((float) tone.lowShelfDb, (float) tone.highShelfDb, 0);
                    t.highpass((int) toned.size(), toned.l.data(), toned.r.data(), nullptr);
                    t.widthAndShelves((int) toned.size(), toned.l.data(), toned.r.data(), nullptr);
                }
                // The tone sits in two places (the HP before the glue, the rest after it), so
                // during the fade the shelves hear the HP's half-faded output and remember it a
                // little while: after the fade the output is the tone's within a hair, then
                // converges on it (the HP's and the shelves' tails, a few ms).
                float justAfter = 0.0f, later = 0.0f;
                for (size_t i = on + (size_t) fade48 + L; i < off + L; ++i)
                {
                    const float d = std::max(std::abs(out.l[i] - toned.l[i - L - on]), std::abs(out.r[i] - toned.r[i - L - on]));
                    (i < on + (size_t) fade48 + L + 4800 ? justAfter : later) = std::max(i < on + (size_t) fade48 + L + 4800 ? justAfter : later, d);
                }
                logMessage("after the fade-in, the tone within " + juce::String(justAfter, 8) + "; 100 ms on, within " + juce::String(later, 10));
                expect(justAfter < 2e-3f && later < 1e-6f, juce::String(justAfter, 8) + ", " + juce::String(later, 10));
                expect(delayedEquals(out, steady, off + (size_t) fade48 + L, steady.size()), "not dry after the fade-out");
                noStep(out, steady, toned, on, on + L, on + L + (size_t) fade48 + 10);
                noStep(out, steady, toned, on, off + L - 10, off + L + (size_t) fade48 + 10);
            }

            beginTest("a tone tilt glides the shelves over the fade time rather than stepping");
            {
                // a 60 Hz sine, under the low shelf: +1 dB at 100 Hz, then +5.5 dB (beyond the
                // tone amount's tilt, -0.5..2.5 dB, but inside the wire's -6..6: a big jump, to
                // see the glide)
                const auto low = sine(rate, 30000, 60.0, 0.1);
                const Settings before { flat, std::nullopt, SoundSettings::Tone { 1.0, 1.0 } };
                const Settings after { flat, std::nullopt, SoundSettings::Tone { 5.5, 1.0 } };
                MasterStage stage;
                stage.prepare(rate);
                auto out = low;
                const size_t at = 20000;
                stage.process(&before, rate, (int) at, out.l.data(), out.r.data());
                stage.process(&after, rate, (int) (low.size() - at), out.l.data() + at, out.r.data() + at);
                // the level, by the peak of each 60 Hz cycle (800 samples), against the formulas
                auto cyclePeak = [&](size_t from) {
                    float p = 0.0f;
                    for (size_t i = from; i < from + 800; ++i) p = std::max(p, std::abs(out.l[i]));
                    return 20.0 * std::log10(p / 0.1);
                };
                auto formula = [&](double lowDb) {
                    return rbjMagnitudeDb("highpass", rate, 25.0, std::sqrt(0.5), 60.0) + rbjMagnitudeDb("lowshelf", rate, 100.0, lowDb, 60.0)
                         + rbjMagnitudeDb("highshelf", rate, 10000.0, 1.0, 60.0);
                };
                const double was = cyclePeak(at + L - 1600), now = cyclePeak(at + L + 4000);
                logMessage("60 Hz: " + juce::String(was, 3) + " dB (formula " + juce::String(formula(1.0), 3) + "), then "
                           + juce::String(now, 3) + " dB (formula " + juce::String(formula(5.5), 3) + ")");
                expect(std::abs(was - formula(1.0)) < 0.05 && std::abs(now - formula(5.5)) < 0.05);
                // across the glide (960 samples) the sine moves no more than the louder one would
                const float loudStep = (float) (2.0 * kPi * 60.0 / rate * 0.1 * std::pow(10.0, (formula(5.5) + 0.05) / 20.0));
                expect(maxStep(out.l, at + L - 100, at + L + (size_t) fade48 + 100) <= loudStep,
                       "a step of " + juce::String(maxStep(out.l, at + L - 100, at + L + (size_t) fade48 + 100)));
                // and a glide, not a step: half way through it, the cycle's peak is between the two
                const double mid = cyclePeak(at + L + (size_t) fade48 / 2 - 400);
                expect(mid > was + 0.5 && mid < now - 0.5, "half way: " + juce::String(mid, 3) + " dB");
            }

            beginTest("glue and tone start with mastering: off -> on mid-play is mastering's one crossfade; off is today");
            {
                const size_t at = 4000;
                MasterStage stage;
                stage.prepare(rate);
                auto out = steady;
                stage.process(nullptr, rate, (int) at, out.l.data(), out.r.data());
                expect(std::memcmp(out.l.data(), steady.l.data(), at * sizeof(float)) == 0, "an off block touched a sample");
                stage.process(&allOn, rate, (int) (steady.size() - at), out.l.data() + at, out.r.data() + at);
                // once mastering's fade is done the stage is the fresh one's (glue, tone and the
                // limiter all started clean at the switch), exactly -- by hand from the switch on
                const auto want = byHand(allOn, rate, segment(steady, at, steady.size()));
                bool same = true;
                for (size_t i = (size_t) fade48; i < want.size() && same; ++i)
                    same = out.l[at + i] == want.l[i] && out.r[at + i] == want.r[i];
                expect(same, "not the fresh stage's output after the fade");
                // mastering's fade is between the dry input and that (no 75-sample delay here)
                const float stepOut = maxStep(out.l, at - 10, at + (size_t) fade48 + 10);
                const float stepDry = maxStep(steady.l, at - 10, at + (size_t) fade48 + 10);
                const float stepWet = maxStep(want.l, 0, (size_t) fade48 + 10);
                expect(stepOut <= 1.05f * std::max(stepDry, stepWet), "a step of " + juce::String(stepOut));
            }

            beginTest("the gain reduction meters (Task 13's dev readouts): 0 while off, the glue's and the "
                      "limiter's reduction when driven, 0 for a stage switched off and after a reset");
            {
                const double r48 = 48000.0;
                const int frames = (int) r48; // 1 s
                const auto hot = sine(r48, frames, 1000.0, 2.0); // +6 dBFS: well over both
                MasterStage stage;
                stage.prepare(r48);
                expectEquals(stage.glueGainReductionDb(), 0.0f);
                expectEquals(stage.limiterGainReductionDb(), 0.0f);

                auto x = hot;
                stage.process(nullptr, r48, frames, x.l.data(), x.r.data());
                expectEquals(stage.glueGainReductionDb(), 0.0f, "mastering off");
                expectEquals(stage.limiterGainReductionDb(), 0.0f, "mastering off");

                const Settings noHeadroomAllOn { { 0.0, -1.0 }, glue, tone };
                x = hot;
                stage.process(&noHeadroomAllOn, r48, frames, x.l.data(), x.r.data());
                const float glueGr = stage.glueGainReductionDb(), limGr = stage.limiterGainReductionDb();
                logMessage("+6 dBFS: glue " + juce::String(glueGr, 2) + " dB, limiter " + juce::String(limGr, 2) + " dB");
                expect(glueGr < -3.0f && glueGr >= -24.0f, "glue " + juce::String(glueGr));
                // the glue (2:1) has brought it to about -4 dBFS: under the limiter's ceiling
                expect(limGr <= 0.0f && limGr >= -24.0f, "limiter " + juce::String(limGr));

                const Settings noHeadroomNoGlue { { 0.0, -1.0 }, std::nullopt, tone };
                MasterStage plain;
                plain.prepare(r48);
                x = hot;
                plain.process(&noHeadroomNoGlue, r48, frames, x.l.data(), x.r.data());
                expectEquals(plain.glueGainReductionDb(), 0.0f, "glue off");
                // without the glue the +6 dBFS sine reaches the limiter: about 7 dB to lose
                const float plainGr = plain.limiterGainReductionDb();
                expect(plainGr < -5.0f && plainGr >= -24.0f, "limiter " + juce::String(plainGr));

                stage.reset();
                expectEquals(stage.glueGainReductionDb(), 0.0f, "after a reset");
                expectEquals(stage.limiterGainReductionDb(), 0.0f, "after a reset");
            }
        }
    };

    static MasterGlueToneTests masterGlueToneTests;
}

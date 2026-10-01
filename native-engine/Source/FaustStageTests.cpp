// native-engine/Source/FaustStageTests.cpp
//
// The Faust DSPs compiled to C++ against the web's own output: native-engine/test/golden/ holds
// a seeded 2 s input and what each committed .wasm in ell.ing/radio made of it at 48 kHz in
// 128-sample quanta (its scripts/golden-vectors.mjs, through its faustProcessor.js). Both
// compilers are Faust 2.88.0 (FAUST_VERSION; the web's @grame/faustwasm 0.18.4), and the C++ is
// generated to compute as the wasm does (-fp keeps Faust's order of addition; -fm arch routes the
// math functions through double precision, as the wasm's JS Math imports do). On 2026-10-01
// saturate, glue, pump and truepeak matched bit for bit, reverb within 2.4e-7 (its sin: Apple's
// libm against V8's).
#include "FaustStage.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <random>
#include <vector>

namespace sssketch
{
    namespace
    {
        constexpr double kRate = 48000.0;
        constexpr int kFrames = 96000;
        /** How far each DSP may sit from the web's output. Bit-identical (memcmp) for all but
         * reverb, whose per-sample sin (Apple's libm here, V8's in the web) left it 2.4e-7 off on
         * 2026-10-01. */
        constexpr double kReverbTolerance = 5.0e-7;

        /** $SSSKETCH_GOLDEN_DIR, else found from the executable: the first ancestor of the
         * binary (native-engine/build/.../sssketch-engine.app/Contents/MacOS/) holding
         * test/golden/manifest.json. No source path is compiled into the binary. */
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

        /** A planar little-endian float32 file: channel 0's frames, then channel 1's, ... */
        std::vector<std::vector<float>> loadPlanar(const juce::String& name, int channels)
        {
            juce::MemoryBlock data;
            std::vector<std::vector<float>> out;
            if (! goldenDir().getChildFile(name).loadFileAsData(data)) return out;
            if (data.getSize() != (size_t) channels * kFrames * sizeof(float)) return out;
            auto* f = static_cast<const float*>(data.getData());
            for (int c = 0; c < channels; ++c) out.emplace_back(f + (size_t) c * kFrames, f + (size_t) (c + 1) * kFrames);
            return out;
        }

        using Channels = std::vector<std::vector<float>>;

        /** The stage's output for `in`, in blocks whose sizes come from `nextBlock`. */
        template <typename NextBlock>
        Channels render(FaustDspKind kind, const Channels& in, NextBlock nextBlock, int maxBlock = 512)
        {
            FaustStage stage(kind);
            stage.prepare(kRate, maxBlock);
            Channels out((size_t) stage.numOutputs(), std::vector<float>(kFrames, 0.0f));
            std::vector<const float*> ip(in.size());
            std::vector<float*> op(out.size());
            for (int at = 0; at < kFrames;)
            {
                const int n = juce::jmin(nextBlock(), kFrames - at);
                for (size_t c = 0; c < in.size(); ++c) ip[c] = in[c].data() + at;
                for (size_t c = 0; c < out.size(); ++c) op[c] = out[c].data() + at;
                stage.process(ip.data(), (int) ip.size(), op.data(), n);
                at += n;
            }
            return out;
        }

        Channels renderFixed(FaustDspKind kind, const Channels& in, int block)
        {
            return render(kind, in, [block] { return block; }, juce::jmax(block, 1));
        }

        /** The same, under the audio thread's flush-to-zero/denormals-are-zero (as Transport and
         * RenderExport run). -ftz 2 already flushes Faust's recursions, so nothing may change. */
        Channels renderNoDenormals(FaustDspKind kind, const Channels& in, int block)
        {
            juce::ScopedNoDenormals noDenormals;
            return renderFixed(kind, in, block);
        }

        double maxAbsDiff(const Channels& a, const Channels& b)
        {
            if (a.size() != b.size()) return 1.0e9;
            double m = 0.0;
            for (size_t c = 0; c < a.size(); ++c)
            {
                if (a[c].size() != b[c].size()) return 1.0e9;
                for (size_t i = 0; i < a[c].size(); ++i) m = juce::jmax(m, (double) std::abs(a[c][i] - b[c][i]));
            }
            return m;
        }

        bool bitIdentical(const Channels& a, const Channels& b)
        {
            if (a.size() != b.size()) return false;
            for (size_t c = 0; c < a.size(); ++c)
                if (a[c].size() != b[c].size() || std::memcmp(a[c].data(), b[c].data(), a[c].size() * sizeof(float)) != 0) return false;
            return true;
        }
    }

    class FaustStageTests : public juce::UnitTest
    {
    public:
        FaustStageTests() : juce::UnitTest("FaustStage") {}

        void runTest() override
        {
            const auto programme = loadPlanar("programme.f32", 2);
            const auto key = loadPlanar("key.f32", 2);

            beginTest("the golden vectors are there");
            expect(goldenDir().isDirectory(), "no golden dir: " + goldenDir().getFullPathName());
            expectEquals((int) programme.size(), 2);
            expectEquals((int) key.size(), 2);
            if (programme.size() != 2 || key.size() != 2) return;

            const FaustDspKind kinds[] = { FaustDspKind::saturate, FaustDspKind::glue, FaustDspKind::pump, FaustDspKind::truepeak, FaustDspKind::reverb };
            for (auto kind : kinds)
            {
                const juce::String name = faustDspName(kind);
                // pump: program L R, key L R
                Channels in = programme;
                if (kind == FaustDspKind::pump) in.insert(in.end(), key.begin(), key.end());
                const auto golden = loadPlanar(name + ".out.f32", 2);

                const bool exact = kind != FaustDspKind::reverb;
                beginTest(name + (exact ? ": bit-identical to the web's wasm" : ": within 5e-7 of the web's wasm")
                          + " (128-sample quanta, as the worklet runs)");
                const auto at128 = renderFixed(kind, in, 128);
                expectEquals((int) golden.size(), 2);
                const double err = maxAbsDiff(at128, golden);
                if (exact)
                    expect(bitIdentical(at128, golden), name + ": max abs error " + juce::String(err, 10));
                else
                    expect(err <= kReverbTolerance, name + ": max abs error " + juce::String(err, 10));
                logMessage("  " + name + " max abs error vs the web: " + juce::String(err, 10));

                beginTest(name + ": under ScopedNoDenormals, the same to the bit");
                expect(bitIdentical(renderNoDenormals(kind, in, 128), at128), name + ": ScopedNoDenormals");

                beginTest(name + ": blocks of 1, 64, 512 and a random split are bit-identical");
                expect(bitIdentical(renderFixed(kind, in, 1), at128), name + ": block 1");
                expect(bitIdentical(renderFixed(kind, in, 64), at128), name + ": block 64");
                expect(bitIdentical(renderFixed(kind, in, 512), at128), name + ": block 512");
                std::mt19937 rng(1234);
                std::uniform_int_distribution<int> size(1, 700);
                // maxBlock 256 below the random sizes' top, so process() also splits internally
                expect(bitIdentical(render(kind, in, [&] { return size(rng); }, 256), at128), name + ": random split");
            }

            beginTest("latencySamples() reads each DSP's latency_samples");
            {
                const std::pair<FaustDspKind, int> want[] = {
                    { FaustDspKind::saturate, 0 }, { FaustDspKind::glue, 0 }, { FaustDspKind::pump, 0 }, { FaustDspKind::truepeak, 75 }, { FaustDspKind::reverb, 0 }
                };
                for (auto [kind, latency] : want)
                {
                    FaustStage s(kind);
                    s.prepare(kRate, 512);
                    expectEquals(s.latencySamples(), latency, faustDspName(kind));
                }
            }

            beginTest("the addresses are the web's (its .json)");
            {
                auto addressesOf = [](FaustDspKind kind) {
                    FaustStage s(kind);
                    s.prepare(kRate, 64);
                    auto a = s.addresses();
                    std::sort(a.begin(), a.end());
                    a.erase(std::unique(a.begin(), a.end()), a.end());
                    return a;
                };
                using V = std::vector<std::string>;
                expect(addressesOf(FaustDspKind::glue) == V { "/glue/gr", "/glue/knee", "/glue/ratio", "/glue/threshold" });
                expect(addressesOf(FaustDspKind::pump) == V { "/pump/depth", "/pump/duck", "/pump/release" });
                expect(addressesOf(FaustDspKind::saturate) == V { "/saturate/drive" });
                expect(addressesOf(FaustDspKind::truepeak) == V { "/truepeak/ceiling", "/truepeak/gr", "/truepeak/release" });
                expect(addressesOf(FaustDspKind::reverb) == V { "/reverb/diffusion", "/reverb/hf_ratio", "/reverb/level", "/reverb/mod_depth", "/reverb/size", "/reverb/t60" });
            }

            beginTest("setParam reaches its zone: /truepeak/ceiling -3 holds a hot programme under -3 dBFS");
            {
                FaustStage s(FaustDspKind::truepeak);
                s.prepare(kRate, 512);
                expectEquals(*s.getParam("/truepeak/ceiling"), -1.0f);
                expect(s.setParam("/truepeak/ceiling", -3.0f));
                expectEquals(*s.getParam("/truepeak/ceiling"), -3.0f);
                expect(! s.setParam("/truepeak/nope", 1.0f), "an unknown address");
                expect(! s.setParam("/truepeak/gr", 1.0f), "a meter is not settable");
                expect(! s.getParam("/nope").has_value());

                Channels out(2, std::vector<float>(kFrames));
                const float* ip[] = { programme[0].data(), programme[1].data() };
                float* op[] = { out[0].data(), out[1].data() };
                s.process(ip, 2, op, kFrames);
                float peak = 0.0f, inPeak = 0.0f;
                for (int c = 0; c < 2; ++c)
                    for (int i = 0; i < kFrames; ++i)
                    {
                        peak = juce::jmax(peak, std::abs(out[(size_t) c][(size_t) i]));
                        inPeak = juce::jmax(inPeak, std::abs(programme[(size_t) c][(size_t) i]));
                    }
                expect(inPeak > 1.0f, "the programme is hot");
                expect(peak <= std::pow(10.0f, -3.0f / 20.0f) + 1.0e-6f, "peak " + juce::String(peak));
                expect(*s.meter("/truepeak/gr") < 0.0f, "the limiter's meter moved");
                expect(! s.meter("/truepeak/ceiling").has_value(), "a slider is not a meter");
            }

            beginTest("the meters can be read: /glue/gr, /pump/duck, /truepeak/gr");
            {
                auto meterAfter = [&](FaustDspKind kind, const char* address) {
                    FaustStage s(kind);
                    s.prepare(kRate, 512);
                    Channels in = programme;
                    if (kind == FaustDspKind::pump) in.insert(in.end(), key.begin(), key.end());
                    std::vector<const float*> ip;
                    for (auto& c : in) ip.push_back(c.data());
                    Channels out(2, std::vector<float>((size_t) kFrames));
                    float* op[] = { out[0].data(), out[1].data() };
                    // stop mid-burst (0.47 s), where every stage is working
                    s.process(ip.data(), (int) ip.size(), op, 22560);
                    return s.meter(address);
                };
                auto g = meterAfter(FaustDspKind::glue, "/glue/gr");
                auto d = meterAfter(FaustDspKind::pump, "/pump/duck");
                auto t = meterAfter(FaustDspKind::truepeak, "/truepeak/gr");
                expect(g.has_value() && d.has_value() && t.has_value());
                if (g && d && t)
                {
                    logMessage("  meters at 0.47 s: glue " + juce::String(*g) + " dB, pump " + juce::String(*d) + " dB, truepeak " + juce::String(*t) + " dB");
                    expect(*g <= 0.0f && *g > -24.0f);
                    expect(*d <= 0.0f && *d >= -12.0f);
                    expect(*t <= 0.0f);
                }
            }

            beginTest("reset() clears the state: a reset stage renders as a fresh one");
            {
                FaustStage s(FaustDspKind::glue);
                s.prepare(kRate, 512);
                Channels a(2, std::vector<float>((size_t) kFrames)), b = a;
                const float* ip[] = { programme[0].data(), programme[1].data() };
                float* pa[] = { a[0].data(), a[1].data() };
                float* pb[] = { b[0].data(), b[1].data() };
                s.process(ip, 2, pa, kFrames);
                s.reset();
                s.process(ip, 2, pb, kFrames);
                expect(bitIdentical(a, b));
            }
        }
    };

    static FaustStageTests faustStageTests;
}

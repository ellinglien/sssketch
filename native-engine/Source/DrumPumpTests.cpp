// native-engine/Source/DrumPumpTests.cpp
//
// The drum-keyed pump (native radio sound plan, Task 9): DrumPump against the web's own pump.dsp
// output (test/golden/pump.out.f32, written by the radio's scripts/golden-vectors.mjs), and the
// routing in PlaybackEngine::renderBlock -- the key from the drums rows, project-wide; the pumped
// rows ducked after their send and before their channel's plugin chain; drums and bass untouched;
// absent, off and keyless all exactly today's.
#include "DrumPump.h"
#include "PlaybackEngine.h"
#include "RenderExport.h"
#include "Transport.h"
#include "PluginChain.h"
#include "ChannelChainRegistry.h"
#include "StemBufferCache.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>
#include <cmath>
#include <cstring>
#include <functional>
#include <random>
#include <vector>

namespace sssketch
{
    namespace
    {
        constexpr double kGoldenRate = 48000.0;
        constexpr int kGoldenFrames = 96000;

        /** $SSSKETCH_GOLDEN_DIR, else the first ancestor of the binary holding
         * test/golden/manifest.json (FaustStageTests' rule). */
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

        std::vector<std::vector<float>> loadPlanar(const juce::String& name)
        {
            juce::MemoryBlock data;
            std::vector<std::vector<float>> out;
            if (! goldenDir().getChildFile(name).loadFileAsData(data)) return out;
            if (data.getSize() != 2 * (size_t) kGoldenFrames * sizeof(float)) return out;
            auto* f = static_cast<const float*>(data.getData());
            for (int c = 0; c < 2; ++c)
                out.emplace_back(f + (size_t) c * kGoldenFrames, f + (size_t) (c + 1) * kGoldenFrames);
            return out;
        }

        /** Runs a DrumPump over the golden programme keyed by the golden key, in blocks from
         * `nextBlock`, adding into zeroed outputs. */
        std::vector<std::vector<float>> pumpGolden(const std::vector<std::vector<float>>& prog,
                                                   const std::vector<std::vector<float>>& key,
                                                   const std::function<int()>& nextBlock, double depthDb = 4.0)
        {
            DrumPump pump;
            pump.prepare(kGoldenRate);
            std::vector<std::vector<float>> out(2, std::vector<float>((size_t) kGoldenFrames, 0.0f));
            for (int at = 0; at < kGoldenFrames;)
            {
                const int n = juce::jmin(nextBlock(), kGoldenFrames - at);
                const DrumPump::Target target { prog[0].data() + at, prog[1].data() + at, out[0].data() + at,
                                                out[1].data() + at };
                pump.process(kGoldenRate, depthDb, n, key[0].data() + at, key[1].data() + at, &target, 1);
                at += n;
            }
            pump.drainRetired();
            return out;
        }

        int mismatches(const std::vector<float>& a, const std::vector<float>& b)
        {
            if (a.size() != b.size()) return -1;
            int n = 0;
            for (size_t i = 0; i < a.size(); ++i)
                if (a[i] != b[i]) ++n;
            return n;
        }

        bool sameBits(const std::vector<float>& a, const std::vector<float>& b)
        {
            return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
        }

        /** A 32-bit float WAV (so the test signals are exact), mono, from `sample(i)`. */
        juce::File writeFloatWav(const juce::String& name, int numSamples, double rate,
                                 const std::function<float(int)>& sample)
        {
            auto file = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile(name);
            file.deleteFile();
            juce::WavAudioFormat wavFormat;
            std::unique_ptr<juce::FileOutputStream> out(file.createOutputStream());
            std::unique_ptr<juce::AudioFormatWriter> writer(wavFormat.createWriterFor(out.get(), rate, 1, 32, {}, 0));
            out.release();
            juce::AudioBuffer<float> source(1, numSamples);
            for (int i = 0; i < numSamples; ++i)
                source.setSample(0, i, sample(i));
            writer->writeFromAudioSampleBuffer(source, 0, numSamples);
            return file;
        }

        double toDb(double g) { return 20.0 * std::log10(g); }
    }

    class DrumPumpTests : public juce::UnitTest
    {
    public:
        DrumPumpTests() : juce::UnitTest("DrumPump", "DrumPump") {}

        void runTest() override
        {
            unitTests();
            engineTests();
            transportTests();
        }

    private:
        void unitTests()
        {
            const auto programme = loadPlanar("programme.f32");
            const auto key = loadPlanar("key.f32");
            const auto golden = loadPlanar("pump.out.f32");

            beginTest("the golden: DrumPump over the web's programme, keyed by its key, is pump.out.f32 to the bit");
            {
                expect(programme.size() == 2 && key.size() == 2 && golden.size() == 2,
                       "golden vectors missing under " + goldenDir().getFullPathName());
                if (golden.size() != 2) return;
                const auto at128 = pumpGolden(programme, key, [] { return 128; });
                expectEquals(mismatches(at128[0], golden[0]), 0);
                expectEquals(mismatches(at128[1], golden[1]), 0);
                // and it ducks: somewhere the output is well under the programme
                double deepest = 0.0;
                for (int i = 0; i < kGoldenFrames; ++i)
                    if (std::abs(programme[0][(size_t) i]) > 0.05f)
                        deepest = juce::jmin(deepest, toDb(std::abs(golden[0][(size_t) i] / programme[0][(size_t) i])));
                expect(deepest < -2.0, "the golden barely ducks: " + juce::String(deepest));
            }

            beginTest("DrumPump is block-size invariant, to the bit");
            {
                if (golden.size() != 2) return;
                for (const int size : { 1, 64, 512, 513, 4096 })
                {
                    const auto out = pumpGolden(programme, key, [size] { return size; });
                    expectEquals(mismatches(out[0], golden[0]), 0, "blocks of " + juce::String(size));
                    expectEquals(mismatches(out[1], golden[1]), 0, "blocks of " + juce::String(size));
                }
                std::mt19937 rng(9);
                std::uniform_int_distribution<int> size(1, 1500);
                const auto out = pumpGolden(programme, key, [&] { return size(rng); });
                expectEquals(mismatches(out[0], golden[0]), 0, "random blocks");
            }

            beginTest("DrumPump: several targets each get the same duck; depth 0 is the input exactly");
            {
                if (golden.size() != 2) return;
                // three targets in one call: the programme, the programme halved, and ones (whose
                // output is the gain itself). Each is its own input times the one gain, to the bit.
                DrumPump pump;
                pump.prepare(kGoldenRate);
                std::vector<float> half0(programme[0]), half1(programme[1]), ones((size_t) kGoldenFrames, 1.0f);
                for (auto& v : half0) v *= 0.5f;
                for (auto& v : half1) v *= 0.5f;
                std::vector<std::vector<float>> a(2, std::vector<float>((size_t) kGoldenFrames)),
                    b(2, std::vector<float>((size_t) kGoldenFrames)), g(2, std::vector<float>((size_t) kGoldenFrames));
                for (int at = 0; at < kGoldenFrames; at += 300)
                {
                    const int n = juce::jmin(300, kGoldenFrames - at);
                    const DrumPump::Target targets[3] = {
                        { programme[0].data() + at, programme[1].data() + at, a[0].data() + at, a[1].data() + at },
                        { half0.data() + at, half1.data() + at, b[0].data() + at, b[1].data() + at },
                        { ones.data() + at, ones.data() + at, g[0].data() + at, g[1].data() + at }
                    };
                    pump.process(kGoldenRate, 4.0, n, key[0].data() + at, key[1].data() + at, targets, 3);
                }
                expectEquals(mismatches(a[0], golden[0]), 0);
                expectEquals(mismatches(a[1], golden[1]), 0);
                int wrong = 0;
                for (int i = 0; i < kGoldenFrames; ++i)
                {
                    wrong += a[0][(size_t) i] != programme[0][(size_t) i] * g[0][(size_t) i] ? 1 : 0;
                    wrong += b[0][(size_t) i] != half0[(size_t) i] * g[0][(size_t) i] ? 1 : 0;
                    wrong += b[1][(size_t) i] != half1[(size_t) i] * g[1][(size_t) i] ? 1 : 0;
                }
                expectEquals(wrong, 0);
                expect(mismatches(g[0], g[1]) == 0, "one gain for both sides");

                const auto flat = pumpGolden(programme, key, [] { return 128; }, 0.0);
                expectEquals(mismatches(flat[0], programme[0]), 0);
                expectEquals(mismatches(flat[1], programme[1]), 0);
                const auto deep = pumpGolden(programme, key, [] { return 128; }, 8.0);
                expect(mismatches(deep[0], golden[0]) > 0, "the depth reached the DSP");
            }

            beginTest("DrumPump: clear() and idle() start the envelope over, as a fresh pump");
            {
                if (golden.size() != 2) return;
                // run the first second, clear, run the second second: equals a fresh pump fed only
                // the second second
                const int half = kGoldenFrames / 2;
                const auto runFrom = [&](DrumPump& pump, int from, std::vector<float>& outL, std::vector<float>& outR) {
                    outL.assign((size_t) (kGoldenFrames - from), 0.0f);
                    outR.assign((size_t) (kGoldenFrames - from), 0.0f);
                    for (int at = from; at < kGoldenFrames; at += 256)
                    {
                        const int n = juce::jmin(256, kGoldenFrames - at);
                        const DrumPump::Target t { programme[0].data() + at, programme[1].data() + at,
                                                   outL.data() + (at - from), outR.data() + (at - from) };
                        pump.process(kGoldenRate, 4.0, n, key[0].data() + at, key[1].data() + at, &t, 1);
                    }
                };
                std::vector<float> freshL, freshR, firstL, firstR, clearedL, clearedR, idledL, idledR, keptL, keptR;
                {
                    DrumPump fresh;
                    fresh.prepare(kGoldenRate);
                    runFrom(fresh, half, freshL, freshR);
                }
                {
                    DrumPump pump;
                    pump.prepare(kGoldenRate);
                    std::vector<float> scratchL((size_t) half, 0.0f), scratchR((size_t) half, 0.0f);
                    const DrumPump::Target t { programme[0].data(), programme[1].data(), scratchL.data(), scratchR.data() };
                    pump.process(kGoldenRate, 4.0, half, key[0].data(), key[1].data(), &t, 1);
                    expect(pump.currentDuckDb() < 0.0f, "the pump is ducking at the half: " + juce::String(pump.currentDuckDb()));
                    pump.clear();
                    runFrom(pump, half, clearedL, clearedR);
                }
                {
                    DrumPump pump;
                    pump.prepare(kGoldenRate);
                    std::vector<float> scratchL((size_t) half, 0.0f), scratchR((size_t) half, 0.0f);
                    const DrumPump::Target t { programme[0].data(), programme[1].data(), scratchL.data(), scratchR.data() };
                    pump.process(kGoldenRate, 4.0, half, key[0].data(), key[1].data(), &t, 1);
                    pump.idle();
                    runFrom(pump, half, idledL, idledR);
                }
                {
                    DrumPump pump;
                    pump.prepare(kGoldenRate);
                    std::vector<float> scratchL((size_t) half, 0.0f), scratchR((size_t) half, 0.0f);
                    const DrumPump::Target t { programme[0].data(), programme[1].data(), scratchL.data(), scratchR.data() };
                    pump.process(kGoldenRate, 4.0, half, key[0].data(), key[1].data(), &t, 1);
                    runFrom(pump, half, keptL, keptR);
                }
                expect(sameBits(clearedL, freshL) && sameBits(clearedR, freshR), "clear() is not a fresh pump");
                expect(sameBits(idledL, freshL) && sameBits(idledR, freshR), "idle() then process() is not a fresh pump");
                expect(! sameBits(keptL, freshL), "without either the envelope carries on (the test can tell)");
            }

            costLog(programme, key);

            beginTest("DrumPump: no instance at the block's rate passes the input through unducked, counted");
            {
                if (golden.size() != 2) return;
                DrumPump pump;
                std::vector<float> outL(512, 0.0f), outR(512, 0.0f);
                const DrumPump::Target t { programme[0].data(), programme[1].data(), outL.data(), outR.data() };
                pump.process(kGoldenRate, 4.0, 512, key[0].data(), key[1].data(), &t, 1); // nothing prepared
                pump.prepare(44100.0);
                pump.process(kGoldenRate, 4.0, 512, key[0].data(), key[1].data(), &t, 1); // the wrong rate
                expectEquals((int) pump.rateMismatchCount(), 2);
                bool through = true;
                for (int i = 0; i < 512; ++i)
                    through = through && outL[(size_t) i] == 2.0f * programme[0][(size_t) i];
                expect(through);
                pump.prepare(kGoldenRate);
                expectEquals(pump.preparedRate(), kGoldenRate);
                pump.process(kGoldenRate, 4.0, 512, key[0].data(), key[1].data(), &t, 1);
                expectEquals((int) pump.rateMismatchCount(), 2);
                pump.drainRetired();
            }
        }

        /** Logged, not asserted (the CavernReverbTests way): the pump's cost per second of audio. */
        void costLog(const std::vector<std::vector<float>>& programme, const std::vector<std::vector<float>>& key)
        {
            beginTest("DrumPump: cost (logged)");
            if (programme.size() != 2 || key.size() != 2) return;
            DrumPump pump;
            pump.prepare(kGoldenRate);
            std::vector<float> outL((size_t) kGoldenFrames), outR((size_t) kGoldenFrames);
            // eight channels' pumped buffers, one duck
            std::vector<DrumPump::Target> targets(8, { programme[0].data(), programme[1].data(), outL.data(), outR.data() });
            const auto start = juce::Time::getHighResolutionTicks();
            for (int at = 0; at < kGoldenFrames; at += 512)
            {
                const int n = juce::jmin(512, kGoldenFrames - at);
                for (auto& t : targets)
                    t = { programme[0].data() + at, programme[1].data() + at, outL.data() + at, outR.data() + at };
                pump.process(kGoldenRate, 4.0, n, key[0].data() + at, key[1].data() + at, targets.data(), targets.size());
            }
            const double sec = juce::Time::highResolutionTicksToSeconds(juce::Time::getHighResolutionTicks() - start);
            logMessage("the pump over 2 s at 48 kHz, eight pumped channels: " + juce::String(sec * 1000.0, 2)
                       + " ms (" + juce::String(100.0 * sec / 2.0, 3) + "% of a core)");
            expect(true);
        }

        // ---- the routing in renderBlock ----
        static constexpr double kRate = 44100.0;
        static constexpr double kBpm = 120.0; // 2 s a bar
        static constexpr int kBarSamples = 88200;

        using Role = EngineStem::PumpRole;
        struct Row
        {
            Row(juce::File f, Role r = Role::none, juce::String ch = {}, bool m = false, double s = 0.0)
                : file(std::move(f)), role(r), channel(std::move(ch)), muted(m), send(s)
            {
            }
            juce::File file;
            Role role;
            juce::String channel;
            bool muted;
            double send;
        };

        static EngineProject makeProject(const std::vector<Row>& rows, std::optional<double> depthDb)
        {
            EngineProject project;
            project.bpm = kBpm;
            project.snapDiv = 16.0;
            int n = 0;
            for (const auto& row : rows)
            {
                EngineRifff rifff;
                rifff.groupId = "g" + juce::String(++n);
                rifff.channelId = row.channel.isNotEmpty() ? row.channel : "c" + juce::String(n);
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.stemKey = rifff.groupId + ":1";
                stem.resolvedPath = row.file.getFullPathName();
                stem.durationSec = 2.0;
                stem.barLength = 1;
                stem.playedBars = 1.0;
                stem.pumpRole = row.role;
                stem.muted = row.muted;
                if (row.send > 0.0)
                {
                    stem.hasToolkit = true;
                    stem.toolkit.reverbSend = row.send;
                }
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);
            }
            if (depthDb) project.sound.pump = SoundSettings::Pump { *depthDb };
            return project;
        }

        /** renderBlock from bar 0, in blocks cycled from `sizes`, `total` samples. */
        static std::pair<std::vector<float>, std::vector<float>> render(const EngineProject& project, int total,
                                                                       const std::vector<int>& sizes = { 512 })
        {
            StemBufferCache cache;
            PlaybackEngine engine(cache);
            ChannelChainRegistry chains;
            engine.prepareMaster(kRate);
            engine.setProject(project);
            std::vector<float> l((size_t) total, 0.0f), r((size_t) total, 0.0f);
            size_t which = 0;
            for (int at = 0; at < total;)
            {
                const int n = juce::jmin(total - at, sizes[which++ % sizes.size()]);
                engine.renderBlock((double) at / (double) kBarSamples, kRate, n, l.data() + at, r.data() + at, chains);
                at += n;
            }
            engine.drainRetiredProject();
            return { l, r };
        }

        void engineTests()
        {
            const int kickStart = (int) (0.25 * kRate), kickEnd = (int) (0.40 * kRate);
            const auto burst = [&](double freq, double dbfs) {
                const double amp = std::pow(10.0, dbfs / 20.0);
                return [=](int i) {
                    if (i < kickStart || i >= kickEnd) return 0.0f;
                    return (float) (amp * std::sin(2.0 * juce::MathConstants<double>::pi * freq * (i - kickStart) / kRate));
                };
            };
            auto kick = writeFloatWav("sssketch_pump_kick.wav", kBarSamples, kRate, burst(60.0, -10.0));
            auto hotKick = writeFloatWav("sssketch_pump_kick_hot.wav", kBarSamples, kRate, burst(60.0, -7.0));
            auto hats = writeFloatWav("sssketch_pump_hats.wav", kBarSamples, kRate, burst(8000.0, -10.0));
            auto pad = writeFloatWav("sssketch_pump_pad.wav", kBarSamples, kRate, [](int) { return 0.25f; });
            auto bass = writeFloatWav("sssketch_pump_bass.wav", kBarSamples, kRate, [](int i) {
                return 0.3f * (float) std::sin(2.0 * juce::MathConstants<double>::pi * 55.0 * i / kRate);
            });
            auto silence = writeFloatWav("sssketch_pump_silence.wav", kBarSamples, kRate, [](int) { return 0.0f; });
            const int total = kBarSamples;
            // The stems' own anti-click fades take the pad to 0 at its very start and end; the duck
            // is read between them.
            const int from = (int) (0.1 * kRate), measured = kBarSamples - (int) (0.1 * kRate);

            // The pad's gain, sample by sample: (the mix - the mix without the pad's level) / 0.25.
            const auto padGain = [&](const std::pair<std::vector<float>, std::vector<float>>& mix,
                                     const std::pair<std::vector<float>, std::vector<float>>& withoutPad) {
                std::vector<double> g((size_t) total);
                for (int i = 0; i < total; ++i)
                    g[(size_t) i] = ((double) mix.first[(size_t) i] - withoutPad.first[(size_t) i]) / 0.25;
                return g;
            };
            const auto deepestDuckDb = [&](const std::vector<double>& g) {
                double deepest = 0.0;
                for (int i = from; i < measured; ++i)
                    deepest = juce::jmax(deepest, -toDb(g[(size_t) i]));
                return deepest;
            };

            beginTest("pump off, absent or keyless: renderBlock is exactly today's");
            {
                const auto today = render(makeProject({ { kick }, { pad }, { bass } }, std::nullopt), total);
                // roles on the wire but no pump in the sound block
                const auto rolesNoPump =
                    render(makeProject({ { kick, Role::key }, { pad, Role::pumped }, { bass } }, std::nullopt), total);
                // the pump on but no key stem
                const auto noKey = render(makeProject({ { kick }, { pad, Role::pumped }, { bass } }, 4.0), total);
                // the pump on, a key, but nothing pumped
                const auto noPumped = render(makeProject({ { kick, Role::key }, { pad }, { bass } }, 4.0), total);
                for (const auto* other : { &rolesNoPump, &noKey, &noPumped })
                    expect(sameBits(other->first, today.first) && sameBits(other->second, today.second));
            }

            beginTest("a 60 Hz kick ducks a pad by the depth, 3 ms in, 200 ms back; drums and bass untouched");
            {
                for (const double depth : { 4.0, 8.0, 2.0 })
                {
                    for (const auto* key : { &kick, &hotKick })
                    {
                        const bool hot = key == &hotKick;
                        const auto mix = render(makeProject({ { *key, Role::key }, { pad, Role::pumped }, { bass } }, depth), total);
                        // the same project with the pad silent: the kick and the bass alone, keyed --
                        // which must be today's kick and bass to the bit
                        const auto noPad =
                            render(makeProject({ { *key, Role::key }, { silence, Role::pumped }, { bass } }, depth), total);
                        const auto todayKickBass = render(makeProject({ { *key }, { bass } }, std::nullopt), total);
                        expect(sameBits(noPad.first, todayKickBass.first) && sameBits(noPad.second, todayKickBass.second),
                               "the kick and the bass are not today's");

                        const auto g = padGain(mix, noPad);
                        expectWithinAbsoluteError(g[(size_t) kickStart - 1], 1.0, 1.0e-6, "no duck before the kick");
                        const double duckDb = deepestDuckDb(g);
                        // 90% of the deepest duck (in dB), from the kick's start
                        int at90 = kickStart;
                        while (at90 < measured && -toDb(g[(size_t) at90]) < 0.9 * duckDb) ++at90;
                        const double attackMs = 1000.0 * (at90 - kickStart) / kRate;
                        // how much of the duck has come back 200 ms after the kick ends
                        const double at200 = -toDb(g[(size_t) (kickEnd + (int) (0.2 * kRate))]);
                        const double duckAtEnd = -toDb(g[(size_t) kickEnd]);
                        const double recovered = 1.0 - at200 / duckAtEnd;
                        logMessage(juce::String(hot ? "-7" : "-10") + " dBFS kick, depth " + juce::String(depth)
                                   + " dB: duck " + juce::String(duckDb, 3) + " dB, 90% in " + juce::String(attackMs, 2)
                                   + " ms, " + juce::String(100.0 * recovered, 1) + "% back 200 ms after the kick");
                        // pump.dsp's own numbers (the web's, to the bit -- the golden above), measured
                        // 2026-10-02 and pinned here; the plan's "depth +- 0.3 at -10 dBFS, ~7 ms, ~63%"
                        // was the .dsp's parameters read alone. The key is low-passed at 150 Hz twice
                        // (a 60 Hz kick loses 1.3 dB) and followed 1 ms up / 30 ms down (rippling
                        // 2.4 dB at 60 Hz), so a -10 dBFS kick keys at about -12 dB: 92% of the depth
                        // (3.68 of 4 dB). A kick 3 dB hotter reaches the full depth. The duck's 3 ms
                        // attack comes after the key's own rise (the sine's first quarter cycle, the
                        // two low-passes, the 1 ms follower): 90% in 10-11 ms. Its 200 ms release
                        // starts only as the key falls through -30 dB (its 30 ms follower), so 200 ms
                        // after the kick ~55% is back, not 63%.
                        expectWithinAbsoluteError(duckDb, hot ? depth : 0.92 * depth, 0.3);
                        expect(attackMs > 8.0 && attackMs < 13.0, "attack " + juce::String(attackMs) + " ms");
                        expect(recovered > 0.50 && recovered < 0.62, "recovered " + juce::String(recovered));
                        // nearly all the way back by the bar's end (1.4 s later)
                        expect(-toDb(g[(size_t) measured - 1]) < 0.01, "still ducked at the end");
                    }
                }
            }

            beginTest("8 kHz hats at -10 dBFS duck the pad by under 0.5 dB");
            {
                const auto mix = render(makeProject({ { hats, Role::key }, { pad, Role::pumped } }, 4.0), total);
                const auto noPad = render(makeProject({ { hats, Role::key }, { silence, Role::pumped } }, 4.0), total);
                const auto g = padGain(mix, noPad);
                const double deepest = deepestDuckDb(g);
                logMessage("hats duck the pad by " + juce::String(deepest, 4) + " dB");
                expect(deepest < 0.5, "hats duck " + juce::String(deepest) + " dB");
            }

            beginTest("the key is project-wide: a kick on a later channel ducks a pad on an earlier one, and a muted kick keys nothing");
            {
                // channel ids sort "a" before "z": the pad's channel is summed before the kick is rendered
                const auto apart = render(
                    makeProject({ { pad, Role::pumped, "a" }, { hotKick, Role::key, "z" } }, 4.0), total);
                const auto together = render(
                    makeProject({ { hotKick, Role::key, "a" }, { pad, Role::pumped, "a" } }, 4.0), total);
                const auto noPad = render(makeProject({ { hotKick, Role::key, "z" } }, std::nullopt), total);
                const auto g = padGain(apart, noPad);
                const auto g2 = padGain(together, noPad);
                double deepest = 0.0, worst = 0.0;
                for (int i = from; i < measured; ++i)
                {
                    deepest = juce::jmax(deepest, -toDb(g[(size_t) i]));
                    worst = juce::jmax(worst, std::abs(g[(size_t) i] - g2[(size_t) i]));
                }
                expectWithinAbsoluteError(deepest, 4.0, 0.3);
                expect(worst < 1.0e-6, "one channel or two: " + juce::String(worst));

                // a muted key: the pad comes through untouched (x * 1), the mix is the pad alone's
                const auto muted = render(
                    makeProject({ { kick, Role::key, "a", true }, { pad, Role::pumped, "b" } }, 4.0), total);
                const auto padAlone = render(makeProject({ { kick, Role::none, "a", true }, { pad, Role::none, "b" } },
                                                         std::nullopt),
                                             total);
                expect(sameBits(muted.first, padAlone.first) && sameBits(muted.second, padAlone.second));
            }

            beginTest("a muted key with two pumped rows on one channel: the mix is the unpumped one, rounding-close");
            {
                // Two pumped rows sum in their pumped buffer, are multiplied by exactly 1, and join
                // the channel after its other rows: the same samples, added in another order.
                auto tone = writeFloatWav("sssketch_pump_tone.wav", kBarSamples, kRate, [](int i) {
                    return 0.2f * (float) std::sin(2.0 * juce::MathConstants<double>::pi * 330.0 * i / kRate);
                });
                const auto muted = render(makeProject({ { kick, Role::key, "a", true },
                                                        { pad, Role::pumped, "b" },
                                                        { bass, Role::none, "b" },
                                                        { tone, Role::pumped, "b" } },
                                                      4.0),
                                          total);
                const auto unpumped = render(
                    makeProject({ { kick, Role::none, "a", true }, { pad, Role::none, "b" }, { bass, Role::none, "b" },
                                  { tone, Role::none, "b" } },
                                std::nullopt),
                    total);
                float worst = 0.0f;
                for (int i = 0; i < total; ++i)
                    worst = juce::jmax(worst, std::abs(muted.first[(size_t) i] - unpumped.first[(size_t) i]),
                                       std::abs(muted.second[(size_t) i] - unpumped.second[(size_t) i]));
                expect(worst <= 1.0e-7f, "worst " + juce::String(worst, 10));
                tone.deleteFile();
            }

            beginTest("switching the pump off mid-duck releases through the .dsp's 200 ms release, with no step, "
                      "and afterwards is exactly the unpumped render");
            {
                // 4 bars (8 s): the kick at 0.25 s of every bar, the pad throughout.
                const auto longProject = [&](bool on, bool keyed) {
                    auto p = makeProject({ { hotKick, keyed ? Role::key : Role::none }, { pad, Role::pumped } },
                                         on ? std::optional<double>(4.0) : std::nullopt);
                    for (auto& rifff : p.rifffs)
                        rifff.stems[0].playedBars = 4.0;
                    return p;
                };
                const int longTotal = 4 * kBarSamples;
                const int switchAt = (int) (0.35 * kRate) / 512 * 512; // mid-kick, well ducked
                // the reference: the same rows, never pumped
                auto noRoles = longProject(false, false);
                for (auto& rifff : noRoles.rifffs)
                    rifff.stems[0].pumpRole = Role::none;
                const auto today = render(noRoles, longTotal);
                auto kickOnly = noRoles;
                kickOnly.rifffs.pop_back();
                const auto kickAlone = render(kickOnly, longTotal);

                // off with roles kept (the TS wire's rule), and on with the key gone
                for (const bool keyGone : { false, true })
                {
                    const auto onProject = longProject(true, true);
                    const auto offProject = keyGone ? longProject(true, false) : longProject(false, true);
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    ChannelChainRegistry chains;
                    engine.prepareMaster(kRate);
                    engine.setProject(onProject);
                    std::vector<float> l((size_t) longTotal, 0.0f), r((size_t) longTotal, 0.0f);
                    float duckAtSwitch = 0.0f;
                    for (int at = 0; at < longTotal; at += 512)
                    {
                        if (at == switchAt)
                        {
                            duckAtSwitch = engine.pumpDuckDb();
                            engine.setProject(offProject);
                        }
                        const int n = juce::jmin(512, longTotal - at);
                        engine.renderBlock((double) at / (double) kBarSamples, kRate, n, l.data() + at, r.data() + at, chains);
                    }
                    engine.drainRetiredProject();
                    expect(duckAtSwitch < -3.0f, "ducked at the switch: " + juce::String(duckAtSwitch));

                    // the pad's gain: rises smoothly, never jumps, never dips again
                    double worstStep = 0.0, prev = 0.0;
                    bool monotone = true;
                    int unity = -1;
                    for (int i = switchAt - 512; i < longTotal - (int) (0.1 * kRate); ++i)
                    {
                        const double g = ((double) l[(size_t) i] - kickAlone.first[(size_t) i]) / 0.25;
                        if (i > switchAt - 512)
                        {
                            worstStep = juce::jmax(worstStep, std::abs(g - prev));
                            monotone = monotone && (i < switchAt || g >= prev - 1.0e-6);
                        }
                        if (unity < 0 && i > switchAt && std::abs(g - 1.0) < 1.0e-6) unity = i;
                        prev = g;
                    }
                    // a 4 dB step would be 0.37; the glide's largest step is the release's slope
                    expect(worstStep < 1.0e-3, "largest per-sample change of the pad's gain " + juce::String(worstStep, 8));
                    expect(monotone, "the gain dipped again during the release");
                    // half of the duck (in dB) back after about 200 ms x ln 2
                    const auto gAt = [&](int i) { return ((double) l[(size_t) i] - kickAlone.first[(size_t) i]) / 0.25; };
                    const double halfDb = -toDb(gAt(switchAt + (int) (0.139 * kRate)));
                    logMessage(juce::String(keyGone ? "key gone" : "pump off") + ": duck " + juce::String(-duckAtSwitch, 3)
                               + " dB at the switch, " + juce::String(halfDb, 3) + " dB 139 ms later; unity after "
                               + juce::String(1000.0 * (unity - switchAt) / kRate, 0) + " ms; largest step "
                               + juce::String(worstStep, 8));
                    expect(halfDb > 0.3 * -duckAtSwitch && halfDb < 0.7 * -duckAtSwitch, "half-way " + juce::String(halfDb));

                    // after the ring-out, the very samples of the never-pumped render
                    int sameFrom = longTotal;
                    while (sameFrom > 0 && l[(size_t) sameFrom - 1] == today.first[(size_t) sameFrom - 1]
                           && r[(size_t) sameFrom - 1] == today.second[(size_t) sameFrom - 1])
                        --sameFrom;
                    logMessage("  identical to the unpumped render from " + juce::String(1000.0 * sameFrom / kRate, 0) + " ms");
                    expect(sameFrom < switchAt + (int) (5.0 * kRate), "never rejoined the unpumped render: "
                                                                          + juce::String(sameFrom));
                    expect(sameFrom > switchAt, "it released at once");
                    expectEquals(engine.pumpDuckDb(), 0.0f);
                }
            }

            beginTest("a fresh render of a project whose pump is off never pumps, even with roles on the wire");
            {
                // what every per-stem export and audition sends (the pump off, roles kept): a fresh
                // engine has no duck to release, so not a sample is routed through the pump
                const auto offWithRoles =
                    render(makeProject({ { hotKick, Role::key }, { pad, Role::pumped }, { bass } }, std::nullopt), total,
                           { 300 });
                const auto noRoles = render(makeProject({ { hotKick }, { pad }, { bass } }, std::nullopt), total, { 300 });
                expect(sameBits(offWithRoles.first, noRoles.first) && sameBits(offWithRoles.second, noRoles.second));
            }

            beginTest("the reverb send is not pumped: once the dry rows end, the room is the same with the pump on and off");
            {
                const int longer = 2 * kBarSamples;
                auto on = makeProject({ { kick, Role::key }, { pad, Role::pumped, "", false, 1.0 } }, 4.0);
                auto off = makeProject({ { kick }, { pad, Role::none, "", false, 1.0 } }, std::nullopt);
                on.reverb.preDelayMs = 20.0;
                off.reverb.preDelayMs = 20.0;
                const auto a = render(on, longer);
                const auto b = render(off, longer);
                // the dry pad is pumped (they differ while it plays) ...
                expect(std::abs(a.first[(size_t) kickStart + 2000] - b.first[(size_t) kickStart + 2000]) > 0.01f);
                // ... its room is not: after the pad ends, only the room sounds, and it is the same
                const std::vector<float> tailA(a.first.begin() + kBarSamples + 64, a.first.end());
                const std::vector<float> tailB(b.first.begin() + kBarSamples + 64, b.first.end());
                float tailPeak = 0.0f;
                for (float v : tailA) tailPeak = juce::jmax(tailPeak, std::abs(v));
                expect(tailPeak > 1.0e-3f, "there is a tail: " + juce::String(tailPeak));
                expect(sameBits(tailA, tailB), "the room heard the pump");
            }

            beginTest("the pump is block-split invariant, to the bit");
            {
                // The pad sends to the cavern room (block-size invariant itself, Task 5). Zita is
                // left out: a zita send is not split-invariant with the pump off either (measured
                // here 2026-10-02, 0.04 apart between 512 and mixed blocks, pump on or off alike).
                auto project = makeProject(
                    { { kick, Role::key }, { pad, Role::pumped, "", false, 0.5 }, { bass, Role::none, "c1" } }, 4.0);
                project.sound.room = ReverbRoom::cavern;
                const auto a = render(project, total, { 512 });
                // Each split starts on its largest block: a toolkit clip's filter (the pad's send
                // runs one) resets when a block is bigger than any before it -- pre-existing
                // (ChannelFilter::prepare; Task 5's notes), not the pump's.
                const auto b = render(project, total, { 4096, 1, 64, 300, 7, 129 });
                std::mt19937 rng(17);
                std::uniform_int_distribution<int> size(1, 1500);
                std::vector<int> sizes { 1500 };
                for (int i = 0; i < 80; ++i) sizes.push_back(size(rng));
                const auto c = render(project, total, sizes);
                expect(sameBits(a.first, b.first) && sameBits(a.second, b.second));
                expect(sameBits(a.first, c.first) && sameBits(a.second, c.second));
            }

            beginTest("a re-sync (setProject of the same project mid-play) keeps the pump's envelope");
            {
                const auto project = makeProject({ { kick, Role::key }, { pad, Role::pumped } }, 4.0);
                const auto straight = render(project, total);
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry chains;
                engine.prepareMaster(kRate);
                engine.setProject(project);
                std::vector<float> l((size_t) total, 0.0f), r((size_t) total, 0.0f);
                for (int at = 0; at < total; at += 512)
                {
                    if (at == kickEnd - 512 * 4 || at == kickEnd + 512 * 8) // mid-duck, and in its release
                        engine.setProject(project);
                    const int n = juce::jmin(512, total - at);
                    engine.renderBlock((double) at / (double) kBarSamples, kRate, n, l.data() + at, r.data() + at, chains);
                }
                engine.drainRetiredProject();
                expect(sameBits(l, straight.first) && sameBits(r, straight.second));
            }

            beginTest("the pump's instance is built at the engine's rate, and only for a project that pumps");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.setProject(makeProject({ { kick }, { pad, Role::pumped } }, 4.0)); // no key
                expectEquals(engine.pumpPreparedRate(), 0.0);
                engine.prepareMaster(48000.0);
                expectEquals(engine.pumpPreparedRate(), 0.0);
                engine.setProject(makeProject({ { kick, Role::key }, { pad, Role::pumped } }, 4.0));
                expectEquals(engine.pumpPreparedRate(), 48000.0);
                engine.prepareMaster(44100.0);
                expectEquals(engine.pumpPreparedRate(), 44100.0);
                engine.drainRetiredProject();
            }

            kick.deleteFile();
            hotKick.deleteFile();
            hats.deleteFile();
            pad.deleteFile();
            bass.deleteFile();
            silence.deleteFile();
        }

        // ---- live == export, a seek and a stop (Transport) ----
        void transportTests()
        {
            // a kick every half second, a pad throughout: 2 bars
            const int frames = kBarSamples;
            const double kickAmp = std::pow(10.0, -6.0 / 20.0);
            auto kicks = writeFloatWav("sssketch_pump_tr_kicks.wav", frames, kRate, [&](int i) {
                const int inBeat = i % (int) (0.5 * kRate);
                if (inBeat >= (int) (0.12 * kRate)) return 0.0f;
                return (float) (kickAmp * std::sin(2.0 * juce::MathConstants<double>::pi * 55.0 * inBeat / kRate));
            });
            auto pad = writeFloatWav("sssketch_pump_tr_pad.wav", frames, kRate, [](int i) {
                return 0.3f * (float) std::sin(2.0 * juce::MathConstants<double>::pi * 440.0 * i / kRate);
            });
            auto project = makeProject({ { kicks, Role::key }, { pad, Role::pumped } }, 4.0);
            for (auto& rifff : project.rifffs)
                for (auto& stem : rifff.stems)
                    stem.playedBars = 2.0;
            for (auto& rifff : project.rifffs)
                rifff.barLength = 2;
            constexpr double kBars = 2.0;
            const int kTotal = 2 * frames;

            struct Rig
            {
                StemBufferCache cache;
                PlaybackEngine engine { cache };
                PluginChain masterChain { kNumMasterChainSlots };
                ChannelChainRegistry channelChains;
                Transport transport { engine, masterChain, channelChains };
            };
            const auto makeRig = [&](Rig& rig, const EngineProject& p) {
                rig.engine.prepareMaster(kRate);
                rig.engine.setProject(p);
                rig.transport.setBpm(kBpm);
            };
            const auto run = [](Rig& rig, int count, int block) {
                std::vector<float> l((size_t) (count * block)), r((size_t) (count * block));
                for (int b = 0; b < count; ++b)
                {
                    float* channels[2] = { l.data() + b * block, r.data() + b * block };
                    rig.transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, block, {});
                }
                return std::make_pair(l, r);
            };

            beginTest("the pump: live playback and export give the same samples, to the bit");
            {
                juce::AudioBuffer<float> out;
                juce::String error;
                expect(renderProjectToBuffer(project, kBars, kRate, 512, out, error), "export failed: " + error);
                const std::vector<float> expL(out.getReadPointer(0), out.getReadPointer(0) + out.getNumSamples());
                const std::vector<float> expR(out.getReadPointer(1), out.getReadPointer(1) + out.getNumSamples());
                expectEquals((int) expL.size(), kTotal);

                for (const int seed : { 0, 5 })
                {
                    Rig rig;
                    makeRig(rig, project);
                    rig.transport.play(0.0);
                    std::mt19937 rng((unsigned) seed);
                    std::uniform_int_distribution<int> size(1, 1100);
                    std::vector<float> l((size_t) kTotal), r((size_t) kTotal);
                    for (int at = 0; at < kTotal;)
                    {
                        const int n = juce::jmin(seed == 0 ? 300 : size(rng), kTotal - at);
                        float* channels[2] = { l.data() + at, r.data() + at };
                        rig.transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, n, {});
                        at += n;
                    }
                    rig.engine.drainRetiredProject();
                    expect(sameBits(l, expL) && sameBits(r, expR), "live differs from the export, seed " + juce::String(seed));
                }

                // and the export really pumps
                auto unpumped = project;
                unpumped.sound.pump.reset();
                juce::AudioBuffer<float> flat;
                expect(renderProjectToBuffer(unpumped, kBars, kRate, 512, flat, error));
                const std::vector<float> flatL(flat.getReadPointer(0), flat.getReadPointer(0) + flat.getNumSamples());
                expect(! sameBits(flatL, expL), "the pump changed nothing in the export");
            }

            beginTest("the pump: a seek clears the duck, so the new bar sounds as a fresh play from there");
            {
                constexpr int kBlock = 64;
                Rig seeked;
                makeRig(seeked, project);
                seeked.transport.play(0.0);
                // into the first kick (0.05 s), well ducked
                run(seeked, 35, kBlock);
                expect(seeked.engine.pumpDuckDb() < -1.0f, "ducked before the seek: " + juce::String(seeked.engine.pumpDuckDb()));
                // to the middle of a gap between kicks (0.3 s past a beat), where an uncleared
                // release would still be ducking
                const double target = 1.3 / 2.0; // bars (2 s a bar): 1.3 s
                seeked.transport.setPosition(target);
                const auto after = run(seeked, 400, kBlock);
                const int fadeSamples = (int) std::ceil(0.012 * kRate);
                const int jumpAt = ((fadeSamples + kBlock - 1) / kBlock) * kBlock;

                Rig fresh;
                makeRig(fresh, project);
                fresh.transport.play(target);
                const auto fromThere = run(fresh, 400, kBlock);

                const int settled = jumpAt + fadeSamples + kBlock;
                bool same = true;
                float worst = 0.0f;
                for (int i = settled; i + jumpAt < (int) fromThere.first.size(); ++i)
                {
                    worst = juce::jmax(worst, std::abs(after.first[(size_t) i] - fromThere.first[(size_t) (i - jumpAt)]));
                    same = same && after.first[(size_t) i] == fromThere.first[(size_t) (i - jumpAt)]
                        && after.second[(size_t) i] == fromThere.second[(size_t) (i - jumpAt)];
                }
                expect(same, "after the seek it differs from a fresh play from there by up to " + juce::String(worst, 8));
                seeked.engine.drainRetiredProject();
                fresh.engine.drainRetiredProject();
            }

            beginTest("the pump: a stop clears the duck, so playing again from the top renders the first pass again");
            {
                constexpr int kBlock = 128;
                Rig rig;
                makeRig(rig, project);
                rig.transport.play(0.0);
                const auto first = run(rig, 40, kBlock);
                // into a kick, then stop (fades out over a few blocks), then play from the top
                rig.transport.stop();
                run(rig, 40, kBlock);
                expect(! rig.transport.isPlaying(), "stopped");
                rig.transport.play(0.0);
                const auto again = run(rig, 40, kBlock);
                expect(sameBits(first.first, again.first) && sameBits(first.second, again.second));
                rig.engine.drainRetiredProject();
            }

            kicks.deleteFile();
            pad.deleteFile();
        }
    };

    static DrumPumpTests drumPumpTests;
}

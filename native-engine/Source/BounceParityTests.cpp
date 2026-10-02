// native-engine/Source/BounceParityTests.cpp
//
// Every bounce follows the project's sound (native radio sound plan, Task 14). The mixdown
// (nativeExport.ts -> RenderExport) and live playback (Transport -> renderLoopAware ->
// processMaster) are one engine, so they must give the same samples for every stage. Each
// stage's own task already pinned live == export for that stage in its own fixture; these tests
// take ONE project with every per-stem and master feature in it -- a key, a bass, a pumped pad
// sending to the room, a pumped lead with a planned throw, a riser, two channels -- and switch
// the radio sound's stages on one at a time, then all together, as buildEngineProject sends them
// (the JSON wire, parsed). For each: the stage changed the render, and live equals the export to
// the bit -- at the export's own 512-sample device blocks in the project as it is (zita unless the
// stage is the room), and at 512-sample, 300-sample and random device blocks with the cavern as
// the room. Zita and a clip's drawn toolkit curves follow the device's blocks (pre-plan; the
// "known limits" test), which is why the zita cases are held to 512 only.
//
// The CPU and cavern-callback measurements Task 14 asked for live here too, behind
// SSSKETCH_BENCH=1 (logged, never asserted: they depend on the machine and the build type).
#include "PlaybackEngine.h"
#include "RenderExport.h"
#include "Transport.h"
#include "PluginChain.h"
#include "ChannelChainRegistry.h"
#include "StemBufferCache.h"
#include "EngineProject.h"
#include "CavernReverb.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <random>
#include <set>
#include <vector>

namespace sssketch
{
    namespace
    {
        juce::File writeMonoFloatWav(const juce::String& name, int numSamples, double rate,
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

        bool sameBits(const std::vector<float>& a, const std::vector<float>& b)
        {
            return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
        }

        size_t firstDifference(const std::vector<float>& a, const std::vector<float>& b)
        {
            size_t i = 0;
            while (i < std::min(a.size(), b.size()) && std::memcmp(&a[i], &b[i], sizeof(float)) == 0)
                ++i;
            return i;
        }

        struct Stereo
        {
            std::vector<float> l, r;
        };

        /** The radio sound's stages, as the settings panel switches them. Glue, tone and
         * saturation only ever reach the wire with mastering (buildEngineSound), so "glue alone"
         * is mastering + glue. */
        enum class Stage
        {
            mastering,
            glue,
            tone,
            saturation,
            cavern,
            reverbAmount,
            panning,
            pump,
            throws,
            riserVariety
        };

        const char* stageName(Stage s)
        {
            switch (s)
            {
                case Stage::mastering: return "mastering";
                case Stage::glue: return "glue (with mastering)";
                case Stage::tone: return "tone (with mastering)";
                case Stage::saturation: return "saturation (with mastering)";
                case Stage::cavern: return "the cavern room";
                case Stage::reverbAmount: return "the reverb amount";
                case Stage::panning: return "panning";
                case Stage::pump: return "the pump";
                case Stage::throws: return "throws";
                case Stage::riserVariety: return "riser variety";
            }
            return "?";
        }

        const std::vector<Stage> kAllStages { Stage::mastering, Stage::glue, Stage::tone, Stage::saturation,
                                              Stage::cavern, Stage::reverbAmount, Stage::panning, Stage::pump,
                                              Stage::throws, Stage::riserVariety };

        /** The smallest real device: just what Transport::audioDeviceAboutToStart reads (its
         * rate and buffer size), so the live rig is told its rate as the app's device does. */
        struct StubDevice : juce::AudioIODevice
        {
            StubDevice(double r, int b) : juce::AudioIODevice("stub", "stub"), rate(r), block(b) {}
            double rate;
            int block;
            juce::StringArray getOutputChannelNames() override { return { "l", "r" }; }
            juce::StringArray getInputChannelNames() override { return {}; }
            juce::Array<double> getAvailableSampleRates() override { return { rate }; }
            juce::Array<int> getAvailableBufferSizes() override { return { block }; }
            int getDefaultBufferSize() override { return block; }
            juce::String open(const juce::BigInteger&, const juce::BigInteger&, double, int) override { return {}; }
            void close() override {}
            bool isOpen() override { return true; }
            void start(juce::AudioIODeviceCallback*) override {}
            void stop() override {}
            bool isPlaying() override { return false; }
            juce::String getLastError() override { return {}; }
            int getCurrentBufferSizeSamples() override { return block; }
            double getCurrentSampleRate() override { return rate; }
            int getCurrentBitDepth() override { return 32; }
            juce::BigInteger getActiveOutputChannels() const override { return 3; }
            juce::BigInteger getActiveInputChannels() const override { return 0; }
            int getOutputLatencyInSamples() override { return 0; }
            int getInputLatencyInSamples() override { return 0; }
        };

        struct Options
        {
            bool withSoundBlock = true;
            bool rolesWhileOff = false;
            /** The room is the cavern whatever the stages say (zita is not split-invariant: see
             * the "known limits" test). */
            bool cavernBase = false;
            /** A drawn volume curve on the lead (a toolkit curve is evaluated once per block:
             * see the "known limits" test). */
            bool volumeCurve = false;
        };
    }

    class BounceParityTests : public juce::UnitTest
    {
    public:
        BounceParityTests() : juce::UnitTest("BounceParity", "Engine") {}

        static constexpr double kRate = 44100.0;
        static constexpr double kBpm = 240.0; // 1 s a bar
        static constexpr int kBarSamples = 44100;
        static constexpr double kBars = 3.0;
        static constexpr int kTotal = 3 * kBarSamples;

        struct Files
        {
            juce::File kick, bass, pad, lead;
        };

        /** One stem as buildEngineProject sends it: a 1-bar file tiled over 3 bars. */
        static juce::String stem(const juce::String& key, const juce::File& file, const juce::String& extra)
        {
            return R"({"stemKey":")" + key + R"(","resolvedPath":")" + file.getFullPathName()
                 + R"(","durationSec":1,"barLength":1,"playedBars":3,"leftCropBars":0,"offsetSteps":0,)"
                 + R"("startBarOverride":-1,"volume":0.9,"muted":false,"muteRegions":[],"oneShot":false,)"
                 + R"("trimStartSec":0,"trimEndSec":-1)" + extra + "}";
        }

        /** The project with `stages` on, as buildEngineProject sends it. With none on, the `sound`
         * block says only `room: zita` (`withSoundBlock`) or is absent: both are a project with
         * every stage off. `rolesWhileOff` sends the pump roles with the pump off, as
         * buildEngineProject does whenever it sends a `sound` block (Task 9's review). The pad's
         * reverb send, its filter, the lead's volume curve and the riser are pre-plan toolkit
         * features, present in every case. */

        static juce::String wire(const Files& f, const std::set<Stage>& stages, Options o = {})
        {
            const auto on = [&](Stage s) { return stages.count(s) > 0; };
            const bool mastering = on(Stage::mastering) || on(Stage::glue) || on(Stage::tone) || on(Stage::saturation);

            juce::StringArray sound;
            if (mastering) sound.add(R"("mastering":{"headroomDb":-4,"ceilingDb":-1})");
            if (on(Stage::glue)) sound.add(R"("glue":{"thresholdDb":-14,"ratio":2,"kneeDb":6})");
            if (on(Stage::tone)) sound.add(R"("tone":{"lowShelfDb":1,"highShelfDb":1})");
            if (on(Stage::saturation)) sound.add(R"("saturation":{"drive":0.9})");
            sound.add(on(Stage::cavern) || o.cavernBase ? R"("room":"cavern")" : R"("room":"zita")");
            if (on(Stage::reverbAmount)) sound.add(R"("reverbReturn":1.6)");
            if (on(Stage::pump)) sound.add(R"("pump":{"depthDb":4})");
            if (on(Stage::throws)) sound.add(R"("dub":{"delayBeats":0.75,"feedback":0.55})");
            const bool soundBlock = o.withSoundBlock || o.cavernBase || ! stages.empty();

            const bool roles = on(Stage::pump) || (o.rolesWhileOff && soundBlock);
            const auto role = [&](const char* r) { return roles ? juce::String(R"(,"pumpRole":")") + r + "\"" : juce::String(); };
            const auto pan = [&](double p) { return on(Stage::panning) ? R"(,"pan":)" + juce::String(p) : juce::String(); };

            const juce::String padToolkit =
                R"(,"toolkit":{"filterMode":"lowpass","filterCutoff":0.8,"filterResonance":0.2,"reverbSend":0.4,)"
                R"("volume":1,"originBar":0,"automation":{"filterCutoff":[],"filterResonance":[],"reverbSend":[],"volume":[]}})";
            const juce::String dubSend = on(Stage::throws)
                ? juce::String(R"(,"dubSend":[{"bar":1,"value":0},{"bar":1.005,"value":1},{"bar":1.495,"value":1},{"bar":1.5,"value":0}])")
                : juce::String();
            const juce::String leadToolkit =
                R"(,"toolkit":{"filterMode":"lowpass","filterCutoff":1,"filterResonance":0.2,"reverbSend":0,)"
                R"("volume":1,"originBar":0,"automation":{"filterCutoff":[],"filterResonance":[],"reverbSend":[],)"
                + juce::String(o.volumeCurve ? R"("volume":[{"bar":0,"value":0.6},{"bar":3,"value":1}])" : R"("volume":[])")
                + dubSend + "}}";

            const juce::String variety = on(Stage::riserVariety) ? R"(,"q":4,"colour":"pink","stereo":"mono","send":0.3)" : juce::String();
            const juce::String riser = R"({"id":"riser-1","channelId":"b","startBar":1.5,"lengthBars":1,)"
                                       R"("startCutoffValue":0.2,"endCutoffValue":0.9,"level":0.35,"curve":[])" + variety + "}";

            return R"({"bpm":240,"snapDiv":16,"loopLengthBars":3,"masterChain":[],"channelChains":[],)"
                   R"("reverb":{"roomSize":0.5,"damping":0.5,"preDelayMs":20},"risers":[)" + riser + "]"
                 + (soundBlock ? ",\"sound\":{" + sound.joinIntoString(",") + "}" : juce::String())
                 + R"(,"rifffs":[{"groupId":"a","channelId":"a","startBar":0,"barLength":1,"stems":[)"
                 + stem("a:1", f.kick, role("key") + pan(0)) + "," + stem("a:2", f.bass, pan(0))
                 + R"(]},{"groupId":"b","channelId":"b","startBar":0,"barLength":1,"stems":[)"
                 + stem("b:3", f.pad, role("pumped") + pan(-0.25) + padToolkit) + ","
                 + stem("b:4", f.lead, role("pumped") + pan(0.25) + leadToolkit) + "]}]}";
        }

        EngineProject parse(const juce::String& json)
        {
            EngineProject project;
            juce::String error;
            expect(parseEngineProject(json, project, error), "parse: " + error);
            return project;
        }

        Stereo exportOf(const EngineProject& project)
        {
            juce::AudioBuffer<float> out;
            juce::String error;
            expect(renderProjectToBuffer(project, kBars, kRate, 512, out, error), "export failed: " + error);
            return { std::vector<float>(out.getReadPointer(0), out.getReadPointer(0) + out.getNumSamples()),
                     std::vector<float>(out.getReadPointer(1), out.getReadPointer(1) + out.getNumSamples()) };
        }

        /** Live, as the device callback runs it: Transport -> renderLoopAware -> masterChain ->
         * processMaster, from a fresh engine, in device blocks of nextBlock() samples. */
        static Stereo liveOf(const EngineProject& project, const std::function<int()>& nextBlock,
                             double rate = kRate, int total = kTotal, double bpm = kBpm,
                             std::vector<double>* callbackMs = nullptr, int maxBlock = 0,
                             const std::function<void(PlaybackEngine&)>& inspect = {})
        {
            StemBufferCache cache;
            PlaybackEngine engine(cache);
            PluginChain masterChain(kNumMasterChainSlots);
            ChannelChainRegistry channelChains;
            Transport transport(engine, masterChain, channelChains);
            // the device starts (prepareMaster at its rate and buffer), then the project loads
            StubDevice device(rate, maxBlock > 0 ? maxBlock : 512);
            transport.audioDeviceAboutToStart(&device);
            engine.setProject(project);
            transport.setBpm(bpm);
            transport.play(0.0);
            Stereo out { std::vector<float>((size_t) total), std::vector<float>((size_t) total) };
            int calls = 0;
            for (int at = 0; at < total;)
            {
                const int n = juce::jmin(nextBlock(), total - at);
                float* channels[2] = { out.l.data() + at, out.r.data() + at };
                const auto t0 = std::chrono::steady_clock::now();
                transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, n, {});
                const double ms = 1000.0 * std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
                if (callbackMs != nullptr) callbackMs->push_back(ms);
                at += n;
                // The message thread's housekeeping, as IpcServer does between messages.
                if (++calls % 64 == 0) engine.drainRetiredProject();
            }
            engine.drainRetiredProject();
            if (inspect) inspect(engine);
            return out;
        }

        /** Live against the export, to the bit: at 512-sample device blocks (the export's own block
         * size) always, and at 300-sample and random blocks when `everySplit`. */
        void checkLiveEqualsExport(const EngineProject& project, const Stereo& exported, const juce::String& what,
                                   unsigned seed, bool everySplit = true)
        {
            const auto check = [&](const Stereo& live, const juce::String& blocks) {
                expect(sameBits(live.l, exported.l) && sameBits(live.r, exported.r),
                       what + ": live (" + blocks + ") differs from the export from sample "
                           + juce::String((int) std::min(firstDifference(live.l, exported.l), firstDifference(live.r, exported.r))));
            };
            check(liveOf(project, [] { return 512; }), "512-sample blocks");
            if (! everySplit) return;
            check(liveOf(project, [] { return 300; }), "300-sample blocks");
            std::mt19937 rng(seed);
            std::uniform_int_distribution<int> size(1, 1100);
            check(liveOf(project, [&] { return size(rng); }), "random blocks");
        }

        static double maxAbsDiff(const Stereo& a, const Stereo& b)
        {
            double worst = 0.0;
            for (size_t i = 0; i < std::min(a.l.size(), b.l.size()); ++i)
                worst = std::max({ worst, (double) std::abs(a.l[i] - b.l[i]), (double) std::abs(a.r[i] - b.r[i]) });
            return worst;
        }

        Files writeFiles()
        {
            std::mt19937 rng(14);
            std::uniform_real_distribution<float> noise(-1.0f, 1.0f);
            std::vector<float> leadNoise((size_t) kBarSamples);
            for (auto& v : leadNoise)
                v = noise(rng);
            const double twoPi = 2.0 * juce::MathConstants<double>::pi;
            Files f;
            // A 60 Hz kick on every beat: a decaying sine, hot enough to key the pump fully.
            f.kick = writeMonoFloatWav("sssketch_bounce_kick.wav", kBarSamples, kRate, [&](int i) {
                const int t = i % (kBarSamples / 4);
                return 0.6f * (float) (std::exp(-t / (0.06 * kRate)) * std::sin(twoPi * 60.0 * t / kRate));
            });
            f.bass = writeMonoFloatWav("sssketch_bounce_bass.wav", kBarSamples, kRate, [&](int i) {
                return 0.35f * (float) std::sin(twoPi * 55.0 * i / kRate);
            });
            f.pad = writeMonoFloatWav("sssketch_bounce_pad.wav", kBarSamples, kRate, [&](int i) {
                return 0.25f * (float) (std::sin(twoPi * 330.0 * i / kRate) + 0.5 * std::sin(twoPi * 495.0 * i / kRate));
            });
            // Bright bursts (a phrase over the throw's half bar too), so the echo has something to send.
            f.lead = writeMonoFloatWav("sssketch_bounce_lead.wav", kBarSamples, kRate, [&](int i) {
                const bool on = (i % (kBarSamples / 8)) < kBarSamples / 16;
                return on ? 0.3f * leadNoise[(size_t) i] : 0.0f;
            });
            return f;
        }

        void runTest() override
        {
            const auto files = writeFiles();
            const auto differs = [](const Stereo& a, const Stereo& b) {
                return ! (sameBits(a.l, b.l) && sameBits(a.r, b.r));
            };

            beginTest("every stage off: the sound block, its absence and the pump's roles while off render the same, to the bit");
            const auto allOff = parse(wire(files, {}));
            const auto offExport = exportOf(allOff);
            {
                expect(allOff.sound.isNeutral(), "an all-off block parsed as something");
                Options noBlock;
                noBlock.withSoundBlock = false;
                Options roles;
                roles.rolesWhileOff = true;
                expect(! differs(exportOf(parse(wire(files, {}, noBlock))), offExport), "no sound block differs");
                expect(! differs(exportOf(parse(wire(files, {}, roles))), offExport), "roles with the pump off differ");
                // zita's room (the pad sends to it): to the bit at the export's block size only (see
                // the known limits below)
                checkLiveEqualsExport(allOff, offExport, "every stage off", 1, false);
            }

            // Each stage alone, twice: in the project as it is (zita, unless the stage is the room),
            // live == export at the export's block size; and with the cavern as the room, where
            // nothing in the render depends on the device's blocks, at every split.
            Options cavern;
            cavern.cavernBase = true;
            const auto cavernOnly = exportOf(parse(wire(files, {}, cavern)));
            unsigned seed = 100;
            for (const auto stage : kAllStages)
            {
                beginTest(juce::String("the mixdown with ") + stageName(stage)
                          + " alone: live (renderLoopAware + processMaster) equals RenderExport, to the bit");
                const auto project = parse(wire(files, { stage }));
                const auto exported = exportOf(project);
                expect(differs(exported, offExport), juce::String(stageName(stage)) + " changed nothing");
                checkLiveEqualsExport(project, exported, stageName(stage), ++seed, stage == Stage::cavern);
                if (stage == Stage::cavern) continue; // the cavern alone is the cavern base

                const auto onCavern = parse(wire(files, { stage }, cavern));
                const auto onCavernExport = exportOf(onCavern);
                expect(differs(onCavernExport, cavernOnly), juce::String(stageName(stage)) + " (cavern) changed nothing");
                checkLiveEqualsExport(onCavern, onCavernExport, juce::String(stageName(stage)) + " (cavern)", ++seed);
            }

            beginTest("the mixdown with every stage on: live equals RenderExport at every split, to the bit, and the limiter holds");
            {
                const std::set<Stage> everything(kAllStages.begin(), kAllStages.end());
                const auto project = parse(wire(files, everything));
                expect(project.sound.mastering && project.sound.glue && project.sound.tone && project.sound.saturation
                       && project.sound.pump && project.sound.dub && project.sound.room == ReverbRoom::cavern);
                const auto exported = exportOf(project);
                expect(differs(exported, cavernOnly));
                checkLiveEqualsExport(project, exported, "every stage on", 7);
                float peak = 0.0f;
                for (size_t i = 0; i < exported.l.size(); ++i)
                    peak = std::max({ peak, std::abs(exported.l[i]), std::abs(exported.r[i]) });
                // the -1 dBTP ceiling: the sample peak under it (0.891), within the true-peak
                // detector's measured overshoot (Task 3: +0.4 dB at worst on full-band noise)
                expect(peak < 0.94f && peak > 0.05f, "peak " + juce::String(peak));
            }

            beginTest("known limits (pre-plan, not the radio sound): zita and a drawn toolkit curve follow the device's blocks");
            {
                // Both are today's behaviour, unchanged by this plan (changing them would move the
                // mixdown of every existing project): zita-rev1 ramps its gains over the first block
                // it runs (Reverb::prepare(nfram)), and a clip's toolkit curves (volume, cutoff,
                // send) are evaluated once per block and smoothed to that target. So live equals
                // the export to the bit at the export's 512-sample blocks, and at other device
                // blocks differs by a little. Logged here; the cavern, the master stages, the pan,
                // the pump and the dub echo carry no such dependence (above).
                Options curve;
                curve.volumeCurve = true;
                curve.cavernBase = true;
                const auto curved = parse(wire(files, {}, curve));
                const auto curvedExport = exportOf(curved);
                checkLiveEqualsExport(curved, curvedExport, "a drawn volume curve", 2, false);
                const double zitaGap = maxAbsDiff(liveOf(allOff, [] { return 300; }), offExport);
                const double curveGap = maxAbsDiff(liveOf(curved, [] { return 300; }), curvedExport);
                logMessage("zita at 300-sample device blocks: max abs difference from the export "
                           + juce::String(zitaGap, 8) + "; a drawn volume curve: " + juce::String(curveGap, 8));
                // Loose bounds (measured 3.7e-7 and 2.0e-4 for this gentle ramp; the curve's gap grows
                // with its slope x the block size), so a regression past "a hair" is caught.
                expectLessThan(zitaGap, 1.0e-3);
                expectLessThan(curveGap, 1.0e-3);
            }

            if (juce::SystemStats::getEnvironmentVariable("SSSKETCH_BENCH", {}) == "1")
                runBench(files);
        }

        /** Task 14's CPU numbers. Logged, never asserted. */
        void runBench(const Files& files)
        {
            beginTest("bench: a dense mix (8 rows, every stage on) at 48 kHz / 256-sample callbacks (SSSKETCH_BENCH=1)");
            {
                // Eight rows on four channels: two keys, a bass, five pumped rows panned out, two of
                // them sending to the cavern, three throwing over the whole render (the worst case:
                // the echo and the room never idle), and a pink, sending riser.
                const juce::String sound = R"("sound":{"mastering":{"headroomDb":-4,"ceilingDb":-1},)"
                                           R"("glue":{"thresholdDb":-14,"ratio":2,"kneeDb":6},"tone":{"lowShelfDb":1,"highShelfDb":1},)"
                                           R"("saturation":{"drive":0.9},"room":"cavern","pump":{"depthDb":4},)"
                                           R"("dub":{"delayBeats":0.75,"feedback":0.55}})";
                const auto toolkit = [](double send, bool throwing) {
                    const juce::String dub = throwing ? R"(,"dubSend":[{"bar":0,"value":0},{"bar":0.01,"value":0.5},{"bar":40,"value":0.5}])" : "";
                    return R"(,"toolkit":{"filterMode":"lowpass","filterCutoff":0.9,"filterResonance":0.2,"reverbSend":)"
                         + juce::String(send) + R"(,"volume":1,"originBar":0,"automation":{"filterCutoff":[],)"
                         + R"("filterResonance":[],"reverbSend":[],"volume":[])" + dub + "}}";
                };
                const auto row = [&](const juce::String& key, const juce::File& file, const juce::String& role, double pan,
                                     double send, bool throwing) {
                    const juce::String r = role.isEmpty() ? juce::String() : R"(,"pumpRole":")" + role + "\"";
                    const juce::String p = pan == 0.0 ? juce::String() : R"(,"pan":)" + juce::String(pan);
                    const juce::String t = (send > 0.0 || throwing) ? toolkit(send, throwing) : juce::String();
                    return R"({"stemKey":")" + key + R"(","resolvedPath":")" + file.getFullPathName()
                         + R"(","durationSec":1,"barLength":1,"playedBars":40,"leftCropBars":0,"offsetSteps":0,)"
                         + R"("startBarOverride":-1,"volume":0.5,"muted":false,"muteRegions":[],"oneShot":false,)"
                         + R"("trimStartSec":0,"trimEndSec":-1)" + r + p + t + "}";
                };
                const auto rifff = [](const juce::String& id, const juce::String& stems) {
                    return R"({"groupId":")" + id + R"(","channelId":")" + id + R"(","startBar":0,"barLength":1,"stems":[)" + stems + "]}";
                };
                const juce::String riser = R"({"id":"bench-riser","channelId":"c","startBar":4,"lengthBars":16,)"
                                           R"("startCutoffValue":0.2,"endCutoffValue":0.9,"level":0.35,"curve":[],)"
                                           R"("q":4,"colour":"pink","send":0.3})";
                const juce::String json =
                    R"({"bpm":240,"snapDiv":16,"loopLengthBars":40,"masterChain":[],"channelChains":[],)"
                    R"("reverb":{"roomSize":0.5,"damping":0.5,"preDelayMs":20},"risers":[)" + riser + "]," + sound
                    + R"(,"rifffs":[)"
                    + rifff("a", row("a:1", files.kick, "key", 0, 0, false) + "," + row("a:2", files.bass, "", 0, 0, false)) + ","
                    + rifff("b", row("b:3", files.pad, "pumped", -0.25, 0.4, false) + "," + row("b:4", files.lead, "pumped", 0.25, 0, true)) + ","
                    + rifff("c", row("c:5", files.pad, "pumped", 0.25, 0.3, true) + "," + row("c:6", files.lead, "pumped", -0.25, 0, true)) + ","
                    + rifff("d", row("d:7", files.kick, "key", 0, 0, false) + "," + row("d:8", files.pad, "pumped", -0.25, 0, false))
                    + "]}";
                auto dense = parse(json);
                auto off = dense;
                off.sound = SoundSettings {};
                for (auto& rf : off.rifffs)
                    for (auto& s : rf.stems)
                    {
                        s.pan = 0.0;
                        s.pumpRole = EngineStem::PumpRole::none;
                        s.toolkit.automation.dubSend.clear();
                    }
                off.risers[0].q = kRiserDefaultQ;
                off.risers[0].pink = false;
                off.risers[0].send = 0.0;

                // 48 kHz / 256 is the plan's question; 96 and 192 kHz at 64 samples, the dense mix's
                // worst callbacks where the cavern costs most (offline: there is no audio interface
                // here, so these are the engine's own time per callback on this machine).
                struct Setting { double rate; int block; int seconds; };
                for (const Setting setting : { Setting { 48000.0, 256, 30 }, Setting { 96000.0, 64, 10 }, Setting { 192000.0, 64, 10 } })
                {
                    const int total = setting.seconds * (int) setting.rate;
                    for (const auto* which : { &off, &dense })
                    {
                        const int block = setting.block;
                        unsigned long long mismatches = 0;
                        std::vector<double> ms;
                        ms.reserve((size_t) (total / block + 1));
                        liveOf(*which, [block] { return block; }, setting.rate, total, kBpm, &ms, block,
                               [&](PlaybackEngine& e) {
                                   mismatches = e.cavernRateMismatchCount() + e.masterRateMismatchCount()
                                              + e.pumpRateMismatchCount() + e.dubRateMismatchCount();
                               });
                        expectEquals((int) mismatches, 0, "a stage was not built at the bench's rate");
                        double sum = 0.0;
                        for (double v : ms)
                            sum += v;
                        std::sort(ms.begin(), ms.end());
                        const double budgetMs = 1000.0 * block / setting.rate;
                        const double p99 = ms[(size_t) (0.99 * (double) (ms.size() - 1))], p999 = ms[(size_t) (0.999 * (double) (ms.size() - 1))];
                        logMessage(juce::String(setting.rate / 1000.0, 0) + " kHz / " + juce::String(block) + ", "
                                   + (which == &dense ? "every stage on" : "every stage off") + ": "
                                   + juce::String(setting.seconds) + " s of audio in " + juce::String(sum / 1000.0, 3) + " s ("
                                   + juce::String(100.0 * sum / (1000.0 * setting.seconds), 2) + "% of one core); per callback: mean "
                                   + juce::String(sum / (double) ms.size(), 4) + " ms, 99th percentile " + juce::String(p99, 4) + " ms ("
                                   + juce::String(100.0 * p99 / budgetMs, 1) + "% of the " + juce::String(budgetMs, 3) + " ms buffer), 99.9th "
                                   + juce::String(p999, 4) + " ms (" + juce::String(100.0 * p999 / budgetMs, 1) + "%), worst "
                                   + juce::String(ms.back(), 4) + " ms (not a realtime thread: a worst far above the 99.9th is the OS)");
                    }
                }
            }

            beginTest("bench: the cavern's worst callback at 96 and 192 kHz, 64- and 128-sample buffers (SSSKETCH_BENCH=1)");
            {
                for (double rate : { 48000.0, 96000.0, 192000.0 })
                {
                    CavernConvolver conv(cavernIrFor(rate));
                    const int P = conv.impulse().numPartitions;
                    std::vector<float> in(CavernIr::kBlock), outL(CavernIr::kBlock), outR(CavernIr::kBlock);
                    juce::Random noise(1);
                    for (auto& v : in)
                        v = noise.nextFloat() - 0.5f;
                    // every partition sounding
                    for (int f = 0; f < P + 2; ++f)
                        conv.process(CavernIr::kBlock, in.data(), in.data(), outL.data(), outR.data(), 1.0f);
                    for (int buffer : { 64, 128 })
                    {
                        constexpr int kFrames = 200;
                        std::vector<double> times;
                        for (int call = 0; call < kFrames * (CavernIr::kBlock / buffer); ++call)
                        {
                            const auto c0 = std::chrono::steady_clock::now();
                            conv.process(buffer, in.data(), in.data(), outL.data(), outR.data(), 1.0f);
                            times.push_back(1000.0 * std::chrono::duration<double>(std::chrono::steady_clock::now() - c0).count());
                        }
                        std::sort(times.begin(), times.end());
                        const double budget = 1000.0 * buffer / rate;
                        const double worst = times.back(), p99 = times[(size_t) (0.99 * (double) (times.size() - 1))];
                        logMessage(juce::String(rate / 1000.0, 0) + " kHz, " + juce::String(buffer) + "-sample callbacks ("
                                   + juce::String(P) + " partitions a side): worst " + juce::String(worst, 4) + " ms ("
                                   + juce::String(100.0 * worst / budget, 1) + "% of the " + juce::String(budget, 3)
                                   + " ms buffer), 99th percentile " + juce::String(p99, 4) + " ms ("
                                   + juce::String(100.0 * p99 / budget, 1) + "%)");
                    }
                }
            }
        }
    };

    static BounceParityTests bounceParityTests;
}

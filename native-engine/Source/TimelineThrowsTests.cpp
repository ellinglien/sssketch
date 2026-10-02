// native-engine/Source/TimelineThrowsTests.cpp
//
// The timeline's planned dub throws (native radio sound plan, Task 12). The plan itself is pure
// TypeScript (src/shared/timelineThrows.ts, vitest); what reaches the engine is an ordinary
// project: a dubSend curve in CLIP-RELATIVE bars on a stem's toolkit (bar 0 is the clip's left
// edge, the toolkit's originBar) and one `sound.dub`. These tests take that project as
// buildEngineProject sends it, for a clip that starts mid-arrangement AND is left-cropped, and
// check that live playback and RenderExport hear the same throw, to the bit, and that the throw
// lands where the clip-relative convention puts it in the arrangement.
#include "PlaybackEngine.h"
#include "RenderExport.h"
#include "Transport.h"
#include "PluginChain.h"
#include "ChannelChainRegistry.h"
#include "StemBufferCache.h"
#include "EngineProject.h"
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

        bool sameBits(const std::vector<float>& a, const std::vector<float>& b, size_t from = 0, size_t to = SIZE_MAX)
        {
            to = std::min({ to, a.size(), b.size() });
            if (a.size() != b.size() || from > to) return false;
            return std::memcmp(a.data() + from, b.data() + from, (to - from) * sizeof(float)) == 0;
        }

        double maxAbsDiff(const std::vector<float>& a, const std::vector<float>& b, size_t from, size_t to)
        {
            double worst = 0.0;
            for (size_t i = from; i < std::min({ a.size(), b.size(), to }); ++i)
                worst = std::max(worst, (double) std::abs(a[i] - b[i]));
            return worst;
        }
    }

    class TimelineThrowsTests : public juce::UnitTest
    {
    public:
        TimelineThrowsTests() : juce::UnitTest("TimelineThrows", "Engine") {}

        static constexpr double kRate = 44100.0;
        static constexpr double kBpm = 240.0; // 1 s a bar
        static constexpr int kBarSamples = 44100;
        static constexpr double kBars = 8.0;
        static constexpr int kTotal = 8 * kBarSamples;

        /** The project as buildEngineProject sends a timeline throw: a rifff placed at bar 2, its first
         * bar cropped (so its lane starts at bar 3: originBar), playing to bar 8, a second row with no
         * throw, and the planned throw -- clip-relative bars 1.5..2.0 with 5 ms ramps, i.e. bars
         * 4.5..5.0 of the arrangement -- on the first row, in a do-nothing toolkit, with the project's
         * one echo. `withThrow` false is the same project without the throw (and so without
         * `sound.dub`): what buildEngineProject sends with throws off. */
        static juce::String wire(const juce::File& lead, const juce::File& pad, bool withThrow)
        {
            const juce::String dub = withThrow
                ? juce::String(R"(,"dubSend":[{"bar":1.5,"value":0},{"bar":1.505,"value":1},)"
                               R"({"bar":1.995,"value":1},{"bar":2,"value":0}])")
                : juce::String();
            const juce::String toolkit = withThrow
                ? R"(,"toolkit":{"filterMode":"lowpass","filterCutoff":1,"filterResonance":0.2,"reverbSend":0,)"
                  R"("volume":1,"originBar":3,"automation":{"filterCutoff":[],"filterResonance":[],)"
                  R"("reverbSend":[],"volume":[])" + dub + "}}"
                : juce::String();
            const juce::String sound = withThrow ? R"({"room":"cavern","dub":{"delayBeats":0.75,"feedback":0.55}})"
                                                 : R"({"room":"cavern"})";
            const auto stem = [](const juce::String& key, const juce::File& file, const juce::String& extra, double pan) {
                return R"({"stemKey":")" + key + R"(","resolvedPath":")" + file.getFullPathName()
                    + R"(","durationSec":1,"barLength":1,"playedBars":6,"leftCropBars":1,"offsetSteps":0,)"
                    + R"("startBarOverride":-1,"volume":1,"muted":false,"muteRegions":[],"oneShot":false,)"
                    + R"("trimStartSec":0,"trimEndSec":-1,"pan":)" + juce::String(pan) + extra + "}";
            };
            return R"({"bpm":240,"snapDiv":16,"loopLengthBars":8,"masterChain":[],"channelChains":[],)"
                   R"("reverb":{"roomSize":0.5,"damping":0.5,"preDelayMs":20},"risers":[],"sound":)"
                + sound + R"(,"rifffs":[{"groupId":"g","channelId":"g","startBar":2,"barLength":1,"stems":[)"
                + stem("g:3", lead, toolkit, 0.25) + "," + stem("g:4", pad, {}, -0.25) + "]}]}";
        }

        static std::vector<float> channel(const juce::AudioBuffer<float>& b, int ch)
        {
            return std::vector<float>(b.getReadPointer(ch), b.getReadPointer(ch) + b.getNumSamples());
        }

        void runTest() override
        {
            // A noisy phrase over 0..0.3 s of each 1-bar tile and again over 0.5..0.7 s (so the
            // throw at bar 4.5 has something to send), and a quieter sine pad (a quarter period
            // in, so it is loud at both ends of the tile) over the whole tile.
            //
            // Both are LOUD at each tile's first and last sample, on purpose: where a tile seam or
            // a clip edge falls on a live block's first sample, live must read the same sample as
            // the export. It once did not (Task 12): Transport summed block lengths in bars where
            // RenderExport converts its sample count, and the last bits differed. Transport now
            // keeps an integer sample clock (see Transport.h's anchorBars), and this fixture pins it.
            std::mt19937 rng(23);
            std::uniform_real_distribution<float> noise(-0.3f, 0.3f);
            std::vector<float> phrase((size_t) kBarSamples, 0.0f);
            for (int i = 0; i < (int) (0.3 * kRate); ++i)
                phrase[(size_t) i] = noise(rng);
            for (int i = (int) (0.5 * kRate); i < (int) (0.7 * kRate); ++i)
                phrase[(size_t) i] = noise(rng);
            phrase[0] = 0.3f;
            phrase[(size_t) kBarSamples - 1] = -0.3f;
            const auto lead = writeFloatWav("sssketch_tl_throw_lead.wav", kBarSamples, kRate, [&](int i) { return phrase[(size_t) i]; });
            const auto pad = writeFloatWav("sssketch_tl_throw_pad.wav", kBarSamples, kRate, [](int i) {
                return 0.1f * (float) std::cos(2.0 * juce::MathConstants<double>::pi * 220.0 * i / kRate);
            });

            beginTest("the wire: a dubSend in clip-relative bars on a toolkit at the lane's origin, and one echo");
            EngineProject project, dry;
            juce::String error;
            const bool parsed = parseEngineProject(wire(lead, pad, true), project, error)
                             && parseEngineProject(wire(lead, pad, false), dry, error);
            expect(parsed, "parse: " + error);
            if (! parsed || project.rifffs.size() != 1 || project.rifffs[0].stems.size() != 2)
            {
                expect(false, "the project did not parse as sent");
                return;
            }
            expect(project.sound.dub.has_value());
            expectEquals(project.rifffs[0].stems[0].toolkit.originBar, 3.0);
            expectEquals((int) project.rifffs[0].stems[0].toolkit.automation.dubSend.size(), 4);
            expect(! dry.sound.dub.has_value());

            juce::AudioBuffer<float> exported, flat;
            expect(renderProjectToBuffer(project, kBars, kRate, 512, exported, error), "export failed: " + error);
            expect(renderProjectToBuffer(dry, kBars, kRate, 512, flat, error), "export failed: " + error);
            const auto expL = channel(exported, 0), expR = channel(exported, 1);
            const auto flatL = channel(flat, 0), flatR = channel(flat, 1);
            expectEquals((int) expL.size(), kTotal);

            beginTest("a planned throw on a mid-arrangement, left-cropped clip: live equals the export, to the bit");
            {
                struct Rig
                {
                    StemBufferCache cache;
                    PlaybackEngine engine { cache };
                    PluginChain masterChain { kNumMasterChainSlots };
                    ChannelChainRegistry channelChains;
                    Transport transport { engine, masterChain, channelChains };
                };
                // the throwing project, and (as a control) the same project with throws off
                for (const bool throwing : { true, false })
                {
                    for (const int seed : { 0, 9 })
                    {
                        Rig rig;
                        rig.engine.prepareMaster(kRate);
                        rig.engine.setProject(throwing ? project : dry);
                        rig.transport.setBpm(kBpm);
                        rig.transport.play(0.0);
                        std::mt19937 sizes((unsigned) seed);
                        std::uniform_int_distribution<int> size(1, 1100);
                        std::vector<float> l((size_t) kTotal), r((size_t) kTotal);
                        for (int at = 0; at < kTotal;)
                        {
                            const int n = juce::jmin(seed == 0 ? 300 : size(sizes), kTotal - at);
                            float* channels[2] = { l.data() + at, r.data() + at };
                            rig.transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, n, {});
                            at += n;
                        }
                        rig.engine.drainRetiredProject();
                        const auto& wantL = throwing ? expL : flatL;
                        const auto& wantR = throwing ? expR : flatR;
                        size_t first = 0;
                        while (first < l.size() && l[first] == wantL[first] && r[first] == wantR[first])
                            ++first;
                        expect(sameBits(l, wantL) && sameBits(r, wantR),
                               juce::String(throwing ? "throwing" : "throws off") + ": live differs from the export, seed "
                                   + juce::String(seed) + ", from sample " + juce::String((int) first));
                    }
                }
            }

            beginTest("the throw lands at the clip's origin + its clip-relative bar (3 + 1.5), and echoes");
            {
                // up to the throw's first sample (bar 4.5) the render is the throw-less project's, to
                // the bit: the clip-relative curve was not read against bar 0 or the rifff's startBar
                const size_t throwAt = (size_t) (4.5 * kBarSamples);
                expect(sameBits(expL, flatL, 0, throwAt) && sameBits(expR, flatR, 0, throwAt),
                       "something changed before the throw");
                // after it: the echo (its first repeat 0.1875 s on; the throw closes at bar 5)
                const double echo = maxAbsDiff(expL, flatL, (size_t) (5.0 * kBarSamples), (size_t) (6.0 * kBarSamples))
                                  + maxAbsDiff(expR, flatR, (size_t) (5.0 * kBarSamples), (size_t) (6.0 * kBarSamples));
                expectGreaterThan(echo, 1e-3);
            }
        }
    };

    static TimelineThrowsTests timelineThrowsTests;
}

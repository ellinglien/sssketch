#include "Transport.h"
#include "EngineProject.h"
#include "PlaybackEngine.h"
#include "StemBufferCache.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>
#include <algorithm>
#include <vector>

namespace sssketch
{
    namespace
    {
        juce::File writeConstantToneWav(const juce::String& name, int numSamples, double sampleRate = 44100.0)
        {
            auto file = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile(name);
            file.deleteFile();
            juce::WavAudioFormat wavFormat;
            std::unique_ptr<juce::FileOutputStream> out(file.createOutputStream());
            std::unique_ptr<juce::AudioFormatWriter> writer(
                wavFormat.createWriterFor(out.get(), sampleRate, 1, 16, {}, 0));
            out.release();
            juce::AudioBuffer<float> source(1, numSamples);
            for (int i = 0; i < numSamples; ++i)
                source.setSample(0, i, 0.8f);
            writer->writeFromAudioSampleBuffer(source, 0, numSamples);
            writer.reset();
            return file;
        }
    }

    class TransportTests : public juce::UnitTest
    {
    public:
        TransportTests() : juce::UnitTest("Transport") {}

        void runTest() override
        {
            beginTest("stop() eventually reaches true silence and isPlaying() becomes false -- "
                      "regression test for a deadlock where an unconditional `if (playing.load())` "
                      "check reset the halt fade every single callback before it was ever examined, "
                      "so a requested Stop silently did nothing, forever");
            {
                auto tone = writeConstantToneWav("sssketch_transport_tone.wav", 44100);

                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.resolvedPath = tone.getFullPathName();
                stem.durationSec = 1.0;
                stem.barLength = 1;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.setProject(project);

                PluginChain masterChain(kNumMasterChainSlots);
                ChannelChainRegistry channelChains;
                Transport transport(engine, masterChain, channelChains);
                transport.setBpm(60.0);
                transport.play(0.0);

                const int numSamples = 512;
                std::vector<float> l((size_t) numSamples), r((size_t) numSamples);
                float* channels[2] = { l.data(), r.data() };

                // A handful of callbacks of real playback first, confirming
                // isPlaying() is genuinely true before Stop is ever requested.
                for (int i = 0; i < 5; ++i)
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});
                expect(transport.isPlaying());

                transport.stop();

                // Comfortably more callbacks than needed to exceed the halt
                // fade's own ~15ms duration many times over, if it's ever
                // going to complete at all -- pre-fix, this loop ran to
                // completion with isPlaying() still stuck true throughout.
                bool reachedSilence = false;
                for (int i = 0; i < 200 && !reachedSilence; ++i)
                {
                    std::fill(l.begin(), l.end(), 1.0f);
                    std::fill(r.begin(), r.end(), 1.0f);
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});
                    if (!transport.isPlaying())
                        reachedSilence = true;
                }

                expect(reachedSilence);
                expect(!transport.isPlaying());

                tone.deleteFile();
            }

            beginTest("a fresh play() cancels an in-flight stop fade instead of getting stuck fading out forever");
            {
                auto tone = writeConstantToneWav("sssketch_transport_tone2.wav", 44100);

                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.resolvedPath = tone.getFullPathName();
                stem.durationSec = 1.0;
                stem.barLength = 1;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.setProject(project);

                PluginChain masterChain(kNumMasterChainSlots);
                ChannelChainRegistry channelChains;
                Transport transport(engine, masterChain, channelChains);
                transport.setBpm(60.0);
                transport.play(0.0);

                const int numSamples = 64; // short block, well inside the ~15ms halt fade window
                std::vector<float> l((size_t) numSamples), r((size_t) numSamples);
                float* channels[2] = { l.data(), r.data() };

                transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});
                transport.stop();
                transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});
                expect(transport.isPlaying()); // still true -- fade only just started

                transport.play(0.0);
                for (int i = 0; i < 50; ++i)
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});

                // Resumed and stayed playing -- didn't get stuck finishing the
                // stale fade-out and silencing itself despite the later Play.
                expect(transport.isPlaying());

                tone.deleteFile();
            }

            beginTest("playback wraps within the recording loop's own bounds while one is "
                      "active, independent of (and even with no) project loopLengthBars -- "
                      "regression test for a real bug found during manual testing: "
                      "renderLoopAware only ever wrapped around loopLengthBars, so setting a "
                      "recording loop via setRecordingLoop never actually looped playback at "
                      "all -- position just ran straight past recordingLoopEndBar forever");
            {
                auto tone = writeConstantToneWav("sssketch_transport_recloop.wav", 44100);

                EngineProject project;
                project.bpm = 120.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.resolvedPath = tone.getFullPathName();
                stem.durationSec = 1.0;
                stem.barLength = 1;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.setProject(project);

                PluginChain masterChain(kNumMasterChainSlots);
                ChannelChainRegistry channelChains;
                Transport transport(engine, masterChain, channelChains);
                transport.setBpm(120.0); // secPerBar = 2.0
                // Deliberately NOT calling setLoopLengthBars -- project-level
                // wrapping stays disabled throughout, isolating that any
                // wrap seen below comes from the recording loop alone.
                transport.setRecordingLoop(0.0, 1.0); // one 2-second bar
                transport.play(0.0);

                const int numSamples = 512;
                std::vector<float> l((size_t) numSamples), r((size_t) numSamples);
                float* channels[2] = { l.data(), r.data() };

                double maxPosSeen = 0.0;
                double previousPos = 0.0;
                bool sawAWrap = false;
                // 700 callbacks * 512 samples ≈ 8.1s of audio at 44.1kHz --
                // comfortably more than two full 2-second recording-loop
                // passes, so a genuinely looping transport must wrap at
                // least twice in this window.
                for (int i = 0; i < 700; ++i)
                {
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});
                    const double pos = transport.currentPositionBars();
                    maxPosSeen = std::max(maxPosSeen, pos);
                    if (pos < previousPos - 0.1) sawAWrap = true;
                    previousPos = pos;
                }

                // The actual regression: pre-fix, position ran straight past
                // 1.0 bar and kept climbing for the whole 8+ seconds. Some
                // small overshoot past exactly 1.0 is expected (position is
                // only corrected at block boundaries, not every sample).
                expect(maxPosSeen <= 1.05);
                expect(sawAWrap);

                tone.deleteFile();
            }

            beginTest("project loopLengthBars wrapping is unaffected when no recording loop "
                      "is active -- regression check alongside the fix above");
            {
                auto tone = writeConstantToneWav("sssketch_transport_projloop.wav", 44100);

                EngineProject project;
                project.bpm = 120.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.resolvedPath = tone.getFullPathName();
                stem.durationSec = 1.0;
                stem.barLength = 1;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.setProject(project);

                PluginChain masterChain(kNumMasterChainSlots);
                ChannelChainRegistry channelChains;
                Transport transport(engine, masterChain, channelChains);
                transport.setBpm(120.0); // secPerBar = 2.0
                transport.setLoopLengthBars(1.0); // one 2-second bar
                // setRecordingLoop deliberately never called here -- endBar
                // <= startBar (the default, 0/0) means it stays disabled.
                transport.play(0.0);

                const int numSamples = 512;
                std::vector<float> l((size_t) numSamples), r((size_t) numSamples);
                float* channels[2] = { l.data(), r.data() };

                double maxPosSeen = 0.0;
                double previousPos = 0.0;
                bool sawAWrap = false;
                for (int i = 0; i < 700; ++i)
                {
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});
                    const double pos = transport.currentPositionBars();
                    maxPosSeen = std::max(maxPosSeen, pos);
                    if (pos < previousPos - 0.1) sawAWrap = true;
                    previousPos = pos;
                }

                expect(maxPosSeen <= 1.05);
                expect(sawAWrap);

                tone.deleteFile();
            }
        }
    };

    static TransportTests transportTests;
}

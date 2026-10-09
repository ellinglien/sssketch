#include "Transport.h"
#include "EngineProject.h"
#include "PlaybackEngine.h"
#include "RenderExport.h"
#include "PluginChain.h"
#include "ChannelChainRegistry.h"
#include "StemBufferCache.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <random>
#include <atomic>
#include <chrono>
#include <thread>
#include <vector>

namespace sssketch
{
    namespace
    {
        /** A mono 16-bit sine, `amp` peak. */
        juce::File writeSineWav(const juce::String& name, int numSamples, double freq, float amp, double sampleRate = 44100.0)
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
                source.setSample(0, i, amp * (float) std::sin(2.0 * 3.14159265358979323846 * freq * i / sampleRate));
            writer->writeFromAudioSampleBuffer(source, 0, numSamples);
            writer.reset();
            return file;
        }

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

                // Stop is idempotent once halted: it must not queue a new
                // fade that renders project audio from an idle transport on
                // the next device callback.
                transport.stop();
                std::fill(l.begin(), l.end(), 1.0f);
                std::fill(r.begin(), r.end(), 1.0f);
                transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});
                expect(!transport.isPlaying());
                expect(std::all_of(l.begin(), l.end(), [](float sample) { return sample == 0.0f; }));
                expect(std::all_of(r.begin(), r.end(), [](float sample) { return sample == 0.0f; }));

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

                // Same precedence when Play arrives before the audio thread
                // has consumed Stop at all: the queued halt must be cleared,
                // not applied as though it came after this newer Play.
                transport.stop();
                transport.play(0.0);
                for (int i = 0; i < 50; ++i)
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});
                expect(transport.isPlaying());

                // Deterministically deliver Play after this callback has
                // already consumed its command flags but immediately before
                // the older stop fade finalizes. The old callback must not
                // overwrite either the newer playing=true or its position.
                struct RaceContext
                {
                    Transport* transport;
                    bool fired = false;
                } race { &transport };
                transport.stop();
                transport.setHaltFinalizationHookForTest(
                    [](void* raw)
                    {
                        auto& context = *static_cast<RaceContext*>(raw);
                        context.fired = true;
                        context.transport->play(2.0);
                    },
                    &race);
                for (int i = 0; i < 50 && !race.fired; ++i)
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});
                expect(race.fired);
                expect(transport.isPlaying());
                expectWithinAbsoluteError(transport.currentPositionBars(), 2.0, 1.0e-12);
                transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});
                expect(transport.isPlaying());
                expect(transport.currentPositionBars() > 2.0);

                // A still-newer Stop must win over that same late Play. This
                // is the exact interleaving that a Play-only generation
                // repair lost: the old halt briefly published false, Stop
                // mistook it for idle, then Play recovery resumed anyway.
                struct PlayThenStopRaceContext
                {
                    Transport* transport;
                    unsigned long long stopGeneration = 0;
                    bool fired = false;
                } playThenStop { &transport };
                transport.stop();
                transport.setHaltFinalizationHookForTest(
                    [](void* raw)
                    {
                        auto& context = *static_cast<PlayThenStopRaceContext*>(raw);
                        context.fired = true;
                        context.transport->play(3.0);
                        context.stopGeneration = context.transport->stop();
                    },
                    &playThenStop);
                for (int i = 0; i < 50 && !playThenStop.fired; ++i)
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});
                expect(playThenStop.fired);
                expect(!transport.isPlaying());
                expectWithinAbsoluteError(transport.currentPositionBars(), 0.0, 1.0e-12);
                expect(transport.completedHaltGeneration() >= playThenStop.stopGeneration);

                tone.deleteFile();
            }

            beginTest("Play's requested position reaches gated capture in the same first callback as backing audio");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                PluginChain masterChain(kNumMasterChainSlots);
                ChannelChainRegistry channelChains;
                Transport transport(engine, masterChain, channelChains);
                transport.setBpm(60.0);
                transport.setRecordingLoop(2.0, 4.0);
                GatedLoopRecorder recorder(44100.0, 2.0, 1.0);
                transport.setGatedRecorder(&recorder);

                constexpr int numSamples = 64;
                std::vector<float> input((size_t) numSamples, 0.8f);
                std::vector<float> l((size_t) numSamples), r((size_t) numSamples);
                const float* inputs[1] = { input.data() };
                float* outputs[2] = { l.data(), r.data() };

                // Before ordered command application moved ahead of capture,
                // gated capture still saw the old bar 0 here and skipped the
                // block, even though output in this callback began at bar 2.
                transport.play(2.0);
                transport.audioDeviceIOCallbackWithContext(
                    inputs, 1, outputs, 2, numSamples, {});

                expect(recorder.isGateOpen());
                expect(transport.currentPositionBars() > 2.0);
                transport.setGatedRecorder(nullptr);
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

            beginTest("playback plays straight through unwrapped when position starts BEHIND "
                      "the recording loop (hasn't reached it yet), only starting to loop once "
                      "it naturally arrives -- but still snaps immediately when position starts "
                      "PAST the loop's own end, since there's no 'keep playing forward and "
                      "arrive' story for a region already behind a forward-only playhead. "
                      "Per direct feedback: setting/moving a loop region (e.g. double-clicking "
                      "a clip, or pressing the rec dot) should never yank the playhead there --"
                      " an earlier version of this same test asserted the OPPOSITE for the "
                      "'starts before loopStart' case (immediate snap), which is what direct "
                      "feedback asked to change; the 'starts past loopEnd' case's own snap "
                      "expectation is unchanged from that same original regression test.");
            {
                auto tone = writeConstantToneWav("sssketch_transport_snap.wav", 44100);

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

                const int numSamples = 512;
                std::vector<float> l((size_t) numSamples), r((size_t) numSamples);
                float* channels[2] = { l.data(), r.data() };

                // Case 1: position starts BEFORE loopStart -- plays straight
                // through, unwrapped, rather than jumping.
                {
                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(120.0); // secPerBar = 2.0
                    transport.setRecordingLoop(2.0, 3.0); // loop is bars [2, 3)
                    transport.play(0.0); // well before loopStart

                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});
                    const double posAfterFirstBlock = transport.currentPositionBars();
                    // NOT snapped to loopStart(2.0) -- just advanced by one
                    // ordinary block's worth of unwrapped playback, same as
                    // if no recording loop were active at all.
                    expect(posAfterFirstBlock > 0.0);
                    expect(posAfterFirstBlock < 0.1);

                    // Keep feeding blocks until position actually arrives at
                    // the loop -- confirms playback naturally reaches it (and
                    // starts looping from there) rather than running past it
                    // forever unwrapped. 2000 blocks is a generous ceiling
                    // (well under 12 bars' worth at this bpm/sample rate,
                    // comfortably more than the 2.0 bars actually needed).
                    for (int i = 0; i < 2000 && transport.currentPositionBars() < 2.0; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2,
                                                                    numSamples, {});
                    expect(transport.currentPositionBars() >= 2.0);
                    expect(transport.currentPositionBars() < 3.0);
                }

                // Case 2: position starts AFTER loopEnd.
                {
                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(120.0);
                    transport.setRecordingLoop(2.0, 3.0);
                    transport.play(10.0); // well past loopEnd

                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, numSamples, {});
                    const double posAfterFirstBlock = transport.currentPositionBars();
                    expect(posAfterFirstBlock >= 2.0);
                    expect(posAfterFirstBlock < 3.0);
                }

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

            beginTest("latencySamplesToBars converts a device round-trip latency (input + "
                      "output samples) into a bar offset from bpm/sampleRate alone -- pure "
                      "conversion, no Transport instance or open device needed, so this is "
                      "testable in a headless CI environment with no real audio hardware");
            {
                // 120 bpm -> secPerBar = 2.0s. At 44100 samples/sec, 4410 samples = 0.1s =
                // 0.05 bars.
                expectWithinAbsoluteError(
                    Transport::latencySamplesToBars(4410, 44100.0, 120.0), 0.05, 1.0e-9);

                // Zero bpm or zero sample rate must not divide by zero -- degrades to 0 bars
                // of compensation instead of NaN/inf poisoning the placed take's startBar.
                expect(Transport::latencySamplesToBars(4410, 0.0, 120.0) == 0.0);
                expect(Transport::latencySamplesToBars(4410, 44100.0, 0.0) == 0.0);

                // Zero latency samples -> zero bars regardless of tempo.
                expect(Transport::latencySamplesToBars(0, 44100.0, 120.0) == 0.0);
            }

            // ---- scheduled project swap, from the transport's side ----
            //
            // PlaybackEngine's own tests cover staging, replacement,
            // cancellation and retirement. These cover the part only the
            // transport knows: WHEN the swap happens. Radio's whole problem
            // was that a change could only start being worked on at the loop
            // top and therefore always landed after it (0.020-0.222 bar
            // measured); the contract here is that a project handed over
            // early becomes audible AT the top, not after it.
            {
                // 240bpm -> secPerBar = 1.0s exactly, so a bar is a second
                // and the arithmetic below is readable. A 0.25-bar loop is
                // 0.25s, which at 512 samples per callback (0.011610 bar)
                // wraps partway through the 22nd block -- far enough in to
                // watch nothing happen first.
                constexpr double kBpm = 240.0;
                constexpr double kLoopBars = 0.25;
                constexpr int kBlock = 512;
                const double blockBars = (double) kBlock / 44100.0; // secPerBar == 1.0

                auto tone = writeConstantToneWav("sssketch_transport_stage.wav", 44100);
                auto makeProject = [&tone](double loopLengthBars) {
                    EngineProject project;
                    project.bpm = kBpm;
                    project.snapDiv = 16.0;
                    project.loopLengthBars = loopLengthBars;
                    EngineRifff rifff;
                    rifff.groupId = "r1";
                    rifff.channelId = "c1";
                    rifff.startBar = 0.0;
                    rifff.barLength = 1;
                    EngineStem stem;
                    stem.stemKey = "r1:1";
                    stem.resolvedPath = tone.getFullPathName();
                    stem.durationSec = 1.0;
                    stem.barLength = 1;
                    rifff.stems.push_back(stem);
                    project.rifffs.push_back(rifff);
                    return project;
                };

                beginTest("a staged project is swapped in AT the loop top -- not when it was handed over, "
                          "and not a block later");
                {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    engine.setProject(makeProject(kLoopBars));

                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);
                    transport.setLoopLengthBars(kLoopBars);
                    transport.play(0.0);

                    std::vector<float> l((size_t) kBlock), r((size_t) kBlock);
                    float* channels[2] = { l.data(), r.data() };

                    // Three laps-worth of nothing first: an idle transport
                    // must never swap anything, and the counter proves it.
                    for (int i = 0; i < 3; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    expect(engine.stagedApplyCount() == 0);

                    // Handed over EARLY -- mid-lap, the whole point.
                    engine.stageProject(makeProject(kLoopBars));
                    const double posAtStage = transport.currentPositionBars();
                    expect(posAtStage > 0.0 && posAtStage < kLoopBars);

                    double posBeforeSwapBlock = -1.0;
                    int blocksRun = 0;
                    for (; blocksRun < 200 && engine.stagedApplyCount() == 0; ++blocksRun)
                    {
                        posBeforeSwapBlock = transport.currentPositionBars();
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    }

                    expect(engine.stagedApplyCount() == 1);
                    // The swap happened in the one block the loop end falls
                    // inside -- not in any of the blocks before it (those
                    // ran with the counter still at zero, which is what the
                    // loop condition above asserts), and not after it.
                    expect(posBeforeSwapBlock < kLoopBars);
                    expect(posBeforeSwapBlock + blockBars >= kLoopBars);
                    // And it landed at the top of the loop itself, to the
                    // sample -- not somewhere inside the block.
                    expectWithinAbsoluteError(transport.lastStagedApplyPositionBars(), 0.0, 1.0e-12);

                    engine.drainRetiredProject();
                    tone.deleteFile();
                }

                beginTest("a loop top that arrives with nothing staged passes by untouched, and a project "
                          "staged just after it waits for the NEXT one");
                {
                    auto tone2 = writeConstantToneWav("sssketch_transport_stage2.wav", 44100);
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    EngineProject base;
                    {
                        base = makeProject(kLoopBars);
                        base.rifffs[0].stems[0].resolvedPath = tone2.getFullPathName();
                    }
                    engine.setProject(base);

                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);
                    transport.setLoopLengthBars(kLoopBars);
                    transport.play(0.0);

                    std::vector<float> l((size_t) kBlock), r((size_t) kBlock);
                    float* channels[2] = { l.data(), r.data() };

                    // Straight through a whole lap with nothing staged.
                    int blocks = 0;
                    while (blocks < 200 && transport.currentPositionBars() + blockBars < kLoopBars)
                    {
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                        ++blocks;
                    }
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {}); // the wrapping block
                    expect(transport.currentPositionBars() < blockBars); // genuinely wrapped
                    expect(engine.stagedApplyCount() == 0);

                    // This is the renderer being LATE -- staging just after
                    // the top it was aiming at. The engine does not invent a
                    // swap here; it waits for a real loop top. Getting the
                    // change out sooner than that is the message thread's
                    // deadline, not this path's job.
                    engine.stageProject(base);
                    for (int i = 0; i < 5; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    expect(engine.stagedApplyCount() == 0);
                    expect(engine.hasStagedProject()); // waiting, not dropped

                    for (int i = 0; i < 200 && engine.stagedApplyCount() == 0; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    expect(engine.stagedApplyCount() == 1);

                    engine.drainRetiredProject();
                    tone2.deleteFile();
                }

                beginTest("a swap deferred because the retirement was not collected retries on the next "
                          "block, rather than waiting out another whole lap");
                {
                    auto tone3 = writeConstantToneWav("sssketch_transport_stage3.wav", 44100);
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    EngineProject base = makeProject(kLoopBars);
                    base.rifffs[0].stems[0].resolvedPath = tone3.getFullPathName();
                    engine.setProject(base);

                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);
                    transport.setLoopLengthBars(kLoopBars);
                    transport.play(0.0);

                    std::vector<float> l((size_t) kBlock), r((size_t) kBlock);
                    float* channels[2] = { l.data(), r.data() };

                    engine.stageProject(base);
                    for (int i = 0; i < 200 && engine.stagedApplyCount() == 0; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    expect(engine.stagedApplyCount() == 1);

                    // Deliberately NOT drained: this is the message thread
                    // being starved for a whole loop, which is the only way
                    // the retirement slot is still occupied at the next top.
                    engine.stageProject(base);
                    for (int i = 0; i < 200 && engine.stagedDeferralCount() == 0; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    expect(engine.stagedDeferralCount() >= 1);
                    expect(engine.stagedApplyCount() == 1); // no swap happened
                    expect(engine.hasStagedProject());      // and nothing was dropped

                    // The message thread catches up. The retry is on the very
                    // next block, mid-lap -- late by a block or two, which
                    // beats late by a lap, which beats never.
                    engine.drainRetiredProject();
                    const double posBeforeRetry = transport.currentPositionBars();
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    expect(engine.stagedApplyCount() == 2);
                    expect(transport.lastStagedApplyPositionBars() >= posBeforeRetry);

                    engine.drainRetiredProject();
                    tone3.deleteFile();
                }

                beginTest("the staged project's own loop length is adopted in the same breath as the "
                          "project, never before -- an early change would move the very wrap it waits for");
                {
                    auto tone4 = writeConstantToneWav("sssketch_transport_stage4.wav", 44100);
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    EngineProject base = makeProject(kLoopBars);
                    base.rifffs[0].stems[0].resolvedPath = tone4.getFullPathName();
                    engine.setProject(base);

                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);
                    transport.setLoopLengthBars(kLoopBars);
                    transport.play(0.0);

                    std::vector<float> l((size_t) kBlock), r((size_t) kBlock);
                    float* channels[2] = { l.data(), r.data() };

                    EngineProject longer = base;
                    longer.loopLengthBars = kLoopBars * 2.0;
                    engine.stageProject(longer);
                    transport.setStagedLoopLengthBars(longer.loopLengthBars);

                    for (int i = 0; i < 3; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    expectWithinAbsoluteError(transport.currentLoopLengthBars(), kLoopBars, 1.0e-12);

                    for (int i = 0; i < 200 && engine.stagedApplyCount() == 0; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    expect(engine.stagedApplyCount() == 1);
                    expectWithinAbsoluteError(transport.currentLoopLengthBars(), kLoopBars * 2.0, 1.0e-12);

                    engine.drainRetiredProject();
                    tone4.deleteFile();
                }

                // Radio fold mode (CycleTable.h): the lap clock runs on across loop tops, and a
                // cycle table staged for "the next top" goes live in the wrapping block, between
                // the outgoing lap's last sample and the incoming lap's first.
                beginTest("the lap clock adds each lap at its wrap, a move starts a new one, and cycles "
                          "staged for the top go live exactly there");
                {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    engine.setProject(makeProject(kLoopBars));
                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);
                    transport.setLoopLengthBars(kLoopBars);
                    transport.play(0.0);

                    std::vector<float> l((size_t) kBlock), r((size_t) kBlock);
                    float* channels[2] = { l.data(), r.data() };
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    const LapClock first = transport.lapClockForTest();
                    expectWithinAbsoluteError(first.baseBars, 0.0, 1.0e-12);

                    CycleRow row;
                    row.rowKey = cycleKeyOf("perc");
                    row.idKey = cycleKeyOf("perc~1");
                    row.bars = 0.1;
                    engine.stageCycles({ row }, false);

                    double posBeforeApplyBlock = -1.0;
                    for (int i = 0; i < 200 && engine.cycleApplyCount() == 0; ++i)
                    {
                        posBeforeApplyBlock = transport.currentPositionBars();
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    }
                    expect(engine.cycleApplyCount() == 1);
                    // in the block the loop end falls inside, not before it
                    expect(posBeforeApplyBlock < kLoopBars);
                    expect(posBeforeApplyBlock + blockBars >= kLoopBars);
                    expectWithinAbsoluteError(transport.lapClockForTest().baseBars, kLoopBars, 1.0e-9);
                    expect(transport.lapClockForTest().epoch == first.epoch);

                    // another lap (21.5 blocks of 512): one more loop on the clock
                    for (int i = 0; i < 25; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    expectWithinAbsoluteError(transport.lapClockForTest().baseBars, 2.0 * kLoopBars, 1.0e-9);

                    // a seek is a move: a new lap clock
                    transport.setPosition(0.1);
                    for (int i = 0; i < 40; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    expect(transport.lapClockForTest().epoch > first.epoch);
                }

                beginTest("barsUntilNextWrap answers with the loop the audio thread actually wraps at, "
                          "and says -1 when nothing wraps at all");
                {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);

                    // No loop set: waiting for a loop top would wait forever,
                    // and the deadline on the message thread has to know that.
                    expect(transport.barsUntilNextWrap() < 0.0);

                    transport.setLoopLengthBars(4.0);
                    transport.setPosition(1.5);
                    // setPosition is asynchronous (it arms a fade), so read
                    // against the position the transport actually reports
                    // rather than the one just requested.
                    expectWithinAbsoluteError(
                        transport.barsUntilNextWrap(), 4.0 - transport.currentPositionBars(), 1.0e-12);

                    // A recording loop takes over the wrap window entirely,
                    // exactly as renderLoopAware treats it.
                    transport.setRecordingLoop(1.0, 2.0);
                    expectWithinAbsoluteError(
                        transport.barsUntilNextWrap(), 2.0 - transport.currentPositionBars(), 1.0e-12);
                }

                // THE ARBITRARY-BAR SWAP (2026-09-29). Everything above
                // lands at a loop top, which is where all but about one
                // radio change in twenty lands. The rest are bare `cut`s
                // on a layer of DEFAULT_RADIO_LOOP_END_BARS or fewer,
                // turning over on their own 2- or 4-bar boundary
                // (radioGridBars) -- mid-lap, where there is no wrap to
                // wait for. See Transport::setStagedApplyAtBars.
                //
                // A one-bar loop at 240bpm is one second, so the target
                // below sits 22050 samples in: ~43 blocks of watching
                // nothing happen, then the block that contains it.
                constexpr double kBarLoopBars = 1.0;
                constexpr double kTargetBar = 0.5;

                beginTest("a staged project aimed at a BAR lands at that bar to the sample -- not at "
                          "the loop top, and not at the top of whichever block the bar fell inside");
                {
                    auto tone5 = writeConstantToneWav("sssketch_transport_stage_bar.wav", 44100);
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    EngineProject base = makeProject(kBarLoopBars);
                    base.rifffs[0].stems[0].resolvedPath = tone5.getFullPathName();
                    engine.setProject(base);

                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);
                    transport.setLoopLengthBars(kBarLoopBars);
                    transport.play(0.0);

                    std::vector<float> l((size_t) kBlock), r((size_t) kBlock);
                    float* channels[2] = { l.data(), r.data() };

                    // Handed over EARLY and mid-lap, well before the bar
                    // it names -- the whole premise of a staged swap.
                    for (int i = 0; i < 3; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    expect(transport.currentPositionBars() < kTargetBar);
                    expectWithinAbsoluteError(
                        transport.barsUntilBar(kTargetBar),
                        kTargetBar - transport.currentPositionBars(), 1.0e-12);

                    engine.stageProject(base);
                    transport.setStagedApplyAtBars(kTargetBar);

                    double posBeforeSwapBlock = -1.0;
                    for (int i = 0; i < 400 && engine.stagedApplyCount() == 0; ++i)
                    {
                        posBeforeSwapBlock = transport.currentPositionBars();
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    }

                    expect(engine.stagedApplyCount() == 1);
                    // It happened in the one block the target falls inside,
                    // and in none of the ones before it (the loop condition
                    // above is what asserts that half).
                    expect(posBeforeSwapBlock < kTargetBar);
                    expect(posBeforeSwapBlock + blockBars >= kTargetBar);
                    // WHERE IT LANDED, which is the point of this test: at
                    // the requested bar itself, not at the top of the block
                    // that contained it (posBeforeSwapBlock, up to ~23ms
                    // early at the shipping buffer size) and not at the
                    // loop top. Block granularity is a visible fraction of
                    // a 16th note; the split renderLoopAware makes at the
                    // bar is what buys the difference.
                    expectWithinAbsoluteError(
                        transport.lastStagedApplyPositionBars(), kTargetBar, 1.0e-12);
                    expect(transport.lastStagedApplyWasAtRequestedBar());
                    // And the lap has NOT turned over -- this whole swap
                    // happened inside one pass of the loop, which is the
                    // thing the loop-top-only mechanism could not do.
                    expect(transport.currentPositionBars() < kBarLoopBars);
                    expect(transport.currentPositionBars() > kTargetBar);

                    engine.drainRetiredProject();
                    tone5.deleteFile();
                }

                beginTest("a requested bar the playhead has already gone past is served at the top of "
                          "the very next block, never a whole lap later");
                {
                    auto tone6 = writeConstantToneWav("sssketch_transport_stage_bar2.wav", 44100);
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    EngineProject base = makeProject(kBarLoopBars);
                    base.rifffs[0].stems[0].resolvedPath = tone6.getFullPathName();
                    engine.setProject(base);

                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);
                    transport.setLoopLengthBars(kBarLoopBars);
                    transport.play(0.0);

                    std::vector<float> l((size_t) kBlock), r((size_t) kBlock);
                    float* channels[2] = { l.data(), r.data() };

                    // Straight past the target with nothing staged. This is
                    // the bar going by in a block that was already in
                    // flight when the message thread named it.
                    while (transport.currentPositionBars() <= kTargetBar)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                    const double posBefore = transport.currentPositionBars();
                    expect(posBefore > kTargetBar);
                    // The message thread's own refusal, which is what stops
                    // this being read as "the same bar, one lap later."
                    expect(transport.barsUntilBar(kTargetBar) < 0.0);

                    engine.stageProject(base);
                    transport.setStagedApplyAtBars(kTargetBar);
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});

                    expect(engine.stagedApplyCount() == 1);
                    expectWithinAbsoluteError(
                        transport.lastStagedApplyPositionBars(), posBefore, 1.0e-12);
                    // Still the same lap: late by one block, not by a loop.
                    expect(transport.currentPositionBars() < kBarLoopBars);

                    engine.drainRetiredProject();
                    tone6.deleteFile();
                }

                beginTest("barsUntilBar answers only for a bar genuinely ahead of the playhead inside "
                          "the lap the audio thread is actually wrapping at");
                {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);

                    // Nothing wraps at all -- there is no lap for a bar to
                    // be inside, same answer barsUntilNextWrap gives.
                    expect(transport.barsUntilBar(2.0) < 0.0);

                    transport.setLoopLengthBars(4.0);
                    const double pos = transport.currentPositionBars();
                    expectWithinAbsoluteError(transport.barsUntilBar(2.0), 2.0 - pos, 1.0e-12);
                    // The top itself is the WRAP, not a bar within the lap
                    // -- renderLoopAware already lands that one exactly,
                    // and answering for it here would give the same swap
                    // two landing sites.
                    expect(transport.barsUntilBar(0.0) < 0.0);
                    expect(transport.barsUntilBar(4.0) < 0.0);
                    expect(transport.barsUntilBar(9.0) < 0.0);

                    // A recording loop takes over the window entirely,
                    // exactly as renderLoopAware and barsUntilNextWrap
                    // both treat it: bar 3 is inside the PROJECT loop and
                    // outside the one actually being wrapped.
                    transport.setRecordingLoop(0.0, 2.0);
                    expectWithinAbsoluteError(transport.barsUntilBar(1.0), 1.0 - pos, 1.0e-12);
                    expect(transport.barsUntilBar(3.0) < 0.0);
                }

                beginTest("sustained bar-aimed staging against a running audio callback -- the split "
                          "at an arbitrary bar is the same safe point the wrap split is");
                {
                    auto tone7 = writeConstantToneWav("sssketch_transport_stage_bar3.wav", 44100);
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    EngineProject base = makeProject(kBarLoopBars);
                    base.rifffs[0].stems[0].resolvedPath = tone7.getFullPathName();
                    engine.setProject(base);

                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);
                    transport.setLoopLengthBars(kBarLoopBars);
                    transport.play(0.0);

                    std::atomic<bool> stop { false };

                    // The real audio callback, in a tight loop -- so the
                    // swap is taken inside renderLoopAware's own bar split
                    // rather than at a hand-placed call site, which is the
                    // difference between this and PlaybackEngineTests'
                    // version of the same stress.
                    std::thread audio([&]() {
                        std::vector<float> l((size_t) kBlock), r((size_t) kBlock);
                        float* channels[2] = { l.data(), r.data() };
                        while (!stop.load())
                            transport.audioDeviceIOCallbackWithContext(
                                nullptr, 0, channels, 2, kBlock, {});
                    });

                    for (int i = 0; i < 400; ++i)
                    {
                        // Re-aimed every time, all over the lap: the
                        // message thread naming a bar the audio thread may
                        // be standing on, about to split at, or already
                        // past.
                        transport.setStagedApplyAtBars(0.1 + 0.1 * (double) (i % 8));
                        engine.stageProject(base);
                        engine.drainRetiredProject();
                        std::this_thread::sleep_for(std::chrono::microseconds(200));
                    }

                    stop.store(true);
                    audio.join();
                    engine.drainRetiredProject();
                    // Not an exact count -- a stage can legitimately be
                    // superseded before it is ever taken. What matters is
                    // that swaps really happened under contention, and
                    // that nothing crashed or freed a snapshot on the
                    // audio thread doing it.
                    expect(engine.stagedApplyCount() > 0);

                    tone7.deleteFile();
                }
            }

            // ---- the master stage (radio sound plan, Task 3): one processMaster for live and export
            {
                constexpr double kRate = 44100.0;
                constexpr double kBpm = 120.0; // 2 s a bar
                constexpr double kBars = 1.0;
                const int kTotal = (int) std::ceil(kBars * 2.0 * kRate);
                auto hot = writeSineWav("sssketch_transport_master_hot.wav", (int) (2.0 * kRate), 220.0, 0.9f);
                auto hot2 = writeSineWav("sssketch_transport_master_hot2.wav", (int) (2.0 * kRate), 331.0, 0.9f);

                // Three loud sines summed: peaks near +7 dBFS, so the limiter really works.
                auto makeProject = [&](std::optional<SoundSettings::Mastering> mastering) {
                    EngineProject project;
                    project.bpm = kBpm;
                    project.snapDiv = 16.0;
                    int n = 0;
                    for (const auto* file : { &hot, &hot2, &hot })
                    {
                        EngineRifff rifff;
                        rifff.groupId = "m" + juce::String(++n);
                        rifff.channelId = "c" + juce::String(n);
                        rifff.startBar = 0.0;
                        rifff.barLength = 1;
                        EngineStem stem;
                        stem.stemKey = rifff.groupId + ":1";
                        stem.resolvedPath = file->getFullPathName();
                        stem.durationSec = 2.0;
                        stem.barLength = 1;
                        rifff.stems.push_back(stem);
                        project.rifffs.push_back(rifff);
                    }
                    project.sound.mastering = mastering;
                    return project;
                };

                // The live path, as the device callback runs it: Transport ->
                // renderLoopAware -> masterChain -> processMaster, in device blocks of
                // `nextBlock()` samples, from a fresh engine.
                auto renderLive = [&](const EngineProject& project, auto nextBlock, int totalSamples) {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    engine.prepareMaster(kRate);
                    engine.setProject(project);
                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);
                    transport.play(0.0);
                    std::vector<float> l((size_t) totalSamples), r((size_t) totalSamples);
                    for (int at = 0; at < totalSamples;)
                    {
                        const int n = juce::jmin(nextBlock(), totalSamples - at);
                        float* channels[2] = { l.data() + at, r.data() + at };
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, n, {});
                        at += n;
                    }
                    engine.drainRetiredProject();
                    return std::make_pair(l, r);
                };

                auto renderExport = [&](const EngineProject& project) {
                    juce::AudioBuffer<float> out;
                    juce::String error;
                    expect(renderProjectToBuffer(project, kBars, kRate, 512, out, error), "export failed: " + error);
                    std::vector<float> l(out.getReadPointer(0), out.getReadPointer(0) + out.getNumSamples());
                    std::vector<float> r(out.getReadPointer(1), out.getReadPointer(1) + out.getNumSamples());
                    return std::make_pair(l, r);
                };

                auto same = [](const std::vector<float>& a, const std::vector<float>& b) {
                    return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
                };

                beginTest("master stage: live playback and export give the same samples, to the bit");
                {
                    const auto project = makeProject(SoundSettings::Mastering {});
                    const auto exported = renderExport(project);
                    expectEquals((int) exported.first.size(), kTotal);
                    const auto live300 = renderLive(project, [] { return 300; }, kTotal);
                    expect(same(live300.first, exported.first) && same(live300.second, exported.second),
                           "live (300-sample blocks) differs from the export");
                    std::mt19937 rng(42);
                    std::uniform_int_distribution<int> size(1, 1100);
                    const auto liveRandom = renderLive(project, [&] { return size(rng); }, kTotal);
                    expect(same(liveRandom.first, exported.first) && same(liveRandom.second, exported.second),
                           "live (random blocks) differs from the export");

                    // and the stage really ran: the sum peaks near +7 dBFS, the output under 0.9
                    float peak = 0.0f;
                    for (float v : exported.first) peak = std::max(peak, std::abs(v));
                    expect(peak < 0.9f && peak > 0.7f, "peak " + juce::String(peak));
                }

                beginTest("master stage with glue and tone (Task 7): live playback and export give the same samples, to the bit");
                {
                    auto project = makeProject(SoundSettings::Mastering {});
                    const auto masteringOnly = renderExport(project);
                    project.sound.glue = SoundSettings::Glue {};
                    project.sound.tone = SoundSettings::Tone { 2.5, -0.5 };
                    const auto exported = renderExport(project);
                    const auto live300 = renderLive(project, [] { return 300; }, kTotal);
                    expect(same(live300.first, exported.first) && same(live300.second, exported.second),
                           "live (300-sample blocks) differs from the export");
                    std::mt19937 rng(43);
                    std::uniform_int_distribution<int> size(1, 1100);
                    const auto liveRandom = renderLive(project, [&] { return size(rng); }, kTotal);
                    expect(same(liveRandom.first, exported.first) && same(liveRandom.second, exported.second),
                           "live (random blocks) differs from the export");
                    // the glue and tone reached the stage through the snapshot
                    expect(! same(exported.first, masteringOnly.first), "glue and tone changed nothing");
                }

                beginTest("master stage with the saturation (Task 8): live playback and export give the same samples, to the bit");
                {
                    auto project = makeProject(SoundSettings::Mastering {});
                    project.sound.glue = SoundSettings::Glue {};
                    project.sound.tone = SoundSettings::Tone {};
                    const auto withoutSat = renderExport(project);
                    project.sound.saturation = SoundSettings::Saturation {};
                    const auto exported = renderExport(project);
                    const auto live300 = renderLive(project, [] { return 300; }, kTotal);
                    expect(same(live300.first, exported.first) && same(live300.second, exported.second),
                           "live (300-sample blocks) differs from the export");
                    std::mt19937 rng(44);
                    std::uniform_int_distribution<int> size(1, 1100);
                    const auto liveRandom = renderLive(project, [&] { return size(rng); }, kTotal);
                    expect(same(liveRandom.first, exported.first) && same(liveRandom.second, exported.second),
                           "live (random blocks) differs from the export");
                    // the saturation reached the stage through the snapshot
                    expect(! same(exported.first, withoutSat.first), "the saturation changed nothing");
                    // and at drive 0 it is the stage without it, to the bit
                    project.sound.saturation = SoundSettings::Saturation { 0.0 };
                    const auto atZero = renderExport(project);
                    expect(same(atZero.first, withoutSat.first) && same(atZero.second, withoutSat.second),
                           "drive 0 differs from the saturation off");
                }

                beginTest("master stage OFF: with no sound block, or no mastering, live and export are exactly today's");
                {
                    // Today's output: the bare renderBlock sum, which is all the transport and the
                    // export did before this stage existed (no plugins in either chain).
                    auto today = [&](const EngineProject& project) {
                        StemBufferCache cache;
                        PlaybackEngine engine(cache);
                        engine.setProject(project);
                        ChannelChainRegistry channelChains;
                        std::vector<float> l((size_t) kTotal, 0.0f), r((size_t) kTotal, 0.0f);
                        for (int at = 0; at < kTotal; at += 512)
                        {
                            const int n = juce::jmin(512, kTotal - at);
                            engine.renderBlock((at / kRate) / 2.0, kRate, n, l.data() + at, r.data() + at, channelChains);
                        }
                        return std::make_pair(l, r);
                    };

                    auto noSound = makeProject(std::nullopt);
                    // glue/tone/saturation sent without mastering: the parser drops them, and
                    // the master stage is still off
                    const auto parsed = parseSoundSettings(juce::JSON::parse(
                        R"({"glue":{"thresholdDb":-14,"ratio":2,"kneeDb":6},"saturation":{"drive":0.9},"room":"zita"})"));
                    expect(! parsed.mastering.has_value() && ! parsed.glue.has_value());
                    auto noMastering = noSound;
                    noMastering.sound = parsed;

                    for (const auto* project : { &noSound, &noMastering })
                    {
                        const auto reference = today(*project);
                        const auto exported = renderExport(*project);
                        const auto live = renderLive(*project, [] { return 300; }, kTotal);
                        expect(same(exported.first, reference.first) && same(exported.second, reference.second),
                               "export differs from today's");
                        expect(same(live.first, reference.first) && same(live.second, reference.second),
                               "live differs from today's");
                    }
                }

                beginTest("master stage: a stop resets it, so playing again from the top renders the first pass again");
                {
                    const auto project = makeProject(SoundSettings::Mastering {});
                    const auto exported = renderExport(project);
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    engine.prepareMaster(kRate);
                    engine.setProject(project);
                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);
                    std::vector<float> l(512), r(512);
                    float* channels[2] = { l.data(), r.data() };
                    transport.play(0.0);
                    for (int i = 0; i < 20; ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                    transport.stop();
                    for (int i = 0; i < 400 && transport.isPlaying(); ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                    expect(! transport.isPlaying());
                    transport.play(0.0);
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                    expect(std::memcmp(l.data(), exported.first.data(), 512 * sizeof(float)) == 0,
                           "the first block after a stop is not the first block of the export");
                }

                beginTest("master stage with glue and tone: a stop resets them too, so playing again renders the first pass again");
                {
                    auto project = makeProject(SoundSettings::Mastering {});
                    project.sound.glue = SoundSettings::Glue {};
                    project.sound.tone = SoundSettings::Tone {};
                    const auto exported = renderExport(project);
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    engine.prepareMaster(kRate);
                    engine.setProject(project);
                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);
                    std::vector<float> l(512), r(512);
                    float* channels[2] = { l.data(), r.data() };
                    transport.play(0.0);
                    for (int i = 0; i < 60; ++i) // 0.7 s of a hot mix: the glue's slow envelope well down
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                    transport.stop();
                    for (int i = 0; i < 400 && transport.isPlaying(); ++i)
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                    expect(! transport.isPlaying());
                    transport.play(0.0);
                    std::vector<float> again(4096);
                    for (int b = 0; b < 8; ++b)
                    {
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                        std::copy(l.begin(), l.end(), again.begin() + b * 512);
                    }
                    expect(std::memcmp(again.data(), exported.first.data(), again.size() * sizeof(float)) == 0,
                           "the first blocks after a stop are not the export's");
                }

                beginTest("master stage: a device (re)start (audioDeviceAboutToStart) resets it -- the limiter's line "
                          "and the glue start empty, so the next play renders the export's first block");
                {
                    // The smallest real device: just what audioDeviceAboutToStart reads.
                    struct StubDevice : juce::AudioIODevice
                    {
                        StubDevice() : juce::AudioIODevice("stub", "stub") {}
                        juce::StringArray getOutputChannelNames() override { return { "l", "r" }; }
                        juce::StringArray getInputChannelNames() override { return {}; }
                        juce::Array<double> getAvailableSampleRates() override { return { kRate }; }
                        juce::Array<int> getAvailableBufferSizes() override { return { 512 }; }
                        int getDefaultBufferSize() override { return 512; }
                        juce::String open(const juce::BigInteger&, const juce::BigInteger&, double, int) override { return {}; }
                        void close() override {}
                        bool isOpen() override { return true; }
                        void start(juce::AudioIODeviceCallback*) override {}
                        void stop() override {}
                        bool isPlaying() override { return false; }
                        juce::String getLastError() override { return {}; }
                        int getCurrentBufferSizeSamples() override { return 512; }
                        double getCurrentSampleRate() override { return kRate; }
                        int getCurrentBitDepth() override { return 32; }
                        juce::BigInteger getActiveOutputChannels() const override { return 3; }
                        juce::BigInteger getActiveInputChannels() const override { return 0; }
                        int getOutputLatencyInSamples() override { return 0; }
                        int getInputLatencyInSamples() override { return 0; }
                    } stub;

                    auto project = makeProject(SoundSettings::Mastering {});
                    project.sound.glue = SoundSettings::Glue {};
                    const auto exported = renderExport(project);
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.audioDeviceAboutToStart(&stub); // the first start: prepares at the rate
                    engine.setProject(project);
                    transport.setBpm(kBpm);
                    std::vector<float> l(512), r(512);
                    float* channels[2] = { l.data(), r.data() };
                    transport.play(0.0);
                    for (int i = 0; i < 60; ++i) // a hot mix mid-play: the line full, the glue down
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                    // A restart (a buffer-size change, a device switch) with no stop: the stage
                    // must not replay the last 75 samples, nor carry the glue's reduction.
                    transport.audioDeviceAboutToStart(&stub);
                    transport.play(0.0);
                    std::vector<float> again(2048);
                    for (int b = 0; b < 4; ++b)
                    {
                        transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                        std::copy(l.begin(), l.end(), again.begin() + b * 512);
                    }
                    expect(std::memcmp(again.data(), exported.first.data(), again.size() * sizeof(float)) == 0,
                           "after a device restart the first blocks are not the export's");
                    expect(again[(size_t) MasterStage::kLatencySamples - 1] == 0.0f, "the limiter's line was not empty");
                    engine.drainRetiredProject();
                }

                beginTest("master stage: the device's rate reaches it (prepareMaster), and a mismatched block passes through");
                {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    engine.setProject(makeProject(SoundSettings::Mastering {}));
                    // setProject with mastering builds at the engine's rate (44.1 kHz until told)
                    ChannelChainRegistry channelChains;
                    std::vector<float> l(1024, 0.0f), r(1024, 0.0f);
                    engine.renderBlock(0.0, 48000.0, 1024, l.data(), r.data(), channelChains);
                    const auto dry = l;
                    engine.processMaster(48000.0, 1024, l.data(), r.data());
                    expect(l == dry, "a 48 kHz block went through a 44.1 kHz limiter");
                    expect(engine.masterRateMismatchCount() == 1);

                    // as Transport::audioDeviceAboutToStart does: the reset makes the new
                    // instance's first block a fresh stage's (immediate), not a crossfade from
                    // the dry block that went through above
                    engine.resetMaster();
                    engine.prepareMaster(48000.0);
                    std::fill(l.begin(), l.end(), 0.0f);
                    std::fill(r.begin(), r.end(), 0.0f);
                    engine.renderBlock(0.0, 48000.0, 1024, l.data(), r.data(), channelChains);
                    engine.processMaster(48000.0, 1024, l.data(), r.data());
                    expect(engine.masterRateMismatchCount() == 1);
                    expect(l[74] == 0.0f, "the limiter's 75-sample line should start empty");
                    float peak = 0.0f;
                    for (float v : l) peak = std::max(peak, std::abs(v));
                    expect(peak > 0.1f && peak < 0.9f, "peak " + juce::String(peak));
                    engine.drainRetiredProject();
                }

                beginTest("master stage: a seek lands under silence -- the limiter's line never plays the old "
                          "position's audio at a nonzero gain, and the new audio fades in from 0");
                {
                    // A loud sine for the first half bar, silence for the second.
                    const int frames = (int) (2.0 * kRate), loud = frames / 2;
                    auto halfFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                                        .getChildFile("sssketch_transport_master_half.wav");
                    halfFile.deleteFile();
                    {
                        juce::WavAudioFormat wavFormat;
                        std::unique_ptr<juce::FileOutputStream> out(halfFile.createOutputStream());
                        std::unique_ptr<juce::AudioFormatWriter> writer(
                            wavFormat.createWriterFor(out.get(), kRate, 1, 16, {}, 0));
                        out.release();
                        juce::AudioBuffer<float> source(1, frames);
                        source.clear();
                        for (int i = 0; i < loud; ++i)
                            source.setSample(0, i, 0.9f * (float) std::sin(2.0 * 3.14159265358979323846 * 220.0 * i / kRate));
                        writer->writeFromAudioSampleBuffer(source, 0, frames);
                    }
                    EngineProject project;
                    project.bpm = kBpm;
                    project.snapDiv = 16.0;
                    EngineRifff rifff;
                    rifff.groupId = "half";
                    rifff.channelId = "c1";
                    rifff.startBar = 0.0;
                    rifff.barLength = 1;
                    EngineStem stem;
                    stem.stemKey = "half:1";
                    stem.resolvedPath = halfFile.getFullPathName();
                    stem.durationSec = 2.0;
                    stem.barLength = 1;
                    rifff.stems.push_back(stem);
                    project.rifffs.push_back(rifff);
                    project.sound.mastering = SoundSettings::Mastering {};

                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    engine.prepareMaster(kRate);
                    engine.setProject(project);
                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    transport.setBpm(kBpm);

                    constexpr int kBlock = 64;
                    auto runBlocks = [&](int count) {
                        std::vector<float> l((size_t) (count * kBlock)), r((size_t) (count * kBlock));
                        for (int b = 0; b < count; ++b)
                        {
                            float* channels[2] = { l.data() + b * kBlock, r.data() + b * kBlock };
                            transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                        }
                        return l;
                    };
                    // The fade-out completes at the end of the block that reaches 12 ms: 9 blocks.
                    const int fadeSamples = (int) std::ceil(0.012 * kRate);
                    const int jumpAt = ((fadeSamples + kBlock - 1) / kBlock) * kBlock;

                    transport.play(0.0);
                    const auto before = runBlocks(40); // in the loud half
                    float peakBefore = 0.0f;
                    for (float v : before) peakBefore = std::max(peakBefore, std::abs(v));
                    expect(peakBefore > 0.3f, "not playing before the seek: peak " + juce::String(peakBefore));

                    // loud -> silent: once faded out, nothing at all -- not the 75 old samples
                    // still in the limiter's line
                    transport.setPosition(0.75);
                    const auto toSilent = runBlocks(100);
                    float leak = 0.0f;
                    for (size_t i = (size_t) jumpAt; i < toSilent.size(); ++i)
                        leak = std::max(leak, std::abs(toSilent[i]));
                    expect(leak == 0.0f, "old-position audio after the jump: " + juce::String(leak));

                    // silent -> loud: the new audio comes out of the line 75 samples after the
                    // jump, and the fade-in starts from 0 exactly there
                    transport.setPosition(0.1);
                    const auto toLoud = runBlocks(100);
                    const int arrives = jumpAt + MasterStage::kLatencySamples;
                    bool silentUntil = true;
                    for (int i = 0; i < arrives; ++i)
                        silentUntil = silentUntil && toLoud[(size_t) i] == 0.0f;
                    expect(silentUntil, "sound before the new audio could have arrived");
                    float worst = 0.0f; // how far over the fade-in's own gain envelope
                    for (int k = 0; k < fadeSamples; ++k)
                        worst = std::max(worst, std::abs(toLoud[(size_t) (arrives + k)]) - (float) (k + 1) / (float) (0.012 * kRate));
                    expect(worst <= 1.0e-3f, "the new audio lands mid fade-in: " + juce::String(worst) + " over");
                    float peakAfter = 0.0f;
                    for (size_t i = (size_t) (arrives + fadeSamples); i < toLoud.size(); ++i)
                        peakAfter = std::max(peakAfter, std::abs(toLoud[i]));
                    expect(peakAfter > 0.3f, "not playing after the seek: peak " + juce::String(peakAfter));

                    engine.drainRetiredProject();
                    halfFile.deleteFile();
                }

                beginTest("master stage: a seek clears the saturation, the glue, the tone and the limiter -- after a seek from a loud "
                          "passage into a quiet one, the quiet one sounds as a fresh play from there does");
                {
                    // A loud sine for the first half bar (the glue well into its slow release),
                    // a quiet one (-20 dBFS, under the glue's knee) for the second.
                    const int frames = (int) (2.0 * kRate), loud = frames / 2;
                    auto file = juce::File::getSpecialLocation(juce::File::tempDirectory)
                                    .getChildFile("sssketch_transport_master_loudquiet.wav");
                    file.deleteFile();
                    {
                        juce::WavAudioFormat wavFormat;
                        std::unique_ptr<juce::FileOutputStream> out(file.createOutputStream());
                        std::unique_ptr<juce::AudioFormatWriter> writer(
                            wavFormat.createWriterFor(out.get(), kRate, 1, 24, {}, 0));
                        out.release();
                        juce::AudioBuffer<float> source(1, frames);
                        for (int i = 0; i < frames; ++i)
                            source.setSample(0, i, (i < loud ? 0.9f : 0.1f)
                                                       * (float) std::sin(2.0 * 3.14159265358979323846 * 220.0 * i / kRate));
                        writer->writeFromAudioSampleBuffer(source, 0, frames);
                    }
                    EngineProject project;
                    project.bpm = kBpm;
                    project.snapDiv = 16.0;
                    EngineRifff rifff;
                    rifff.groupId = "lq";
                    rifff.channelId = "c1";
                    rifff.startBar = 0.0;
                    rifff.barLength = 1;
                    EngineStem stem;
                    stem.stemKey = "lq:1";
                    stem.resolvedPath = file.getFullPathName();
                    stem.durationSec = 2.0;
                    stem.barLength = 1;
                    rifff.stems.push_back(stem);
                    project.rifffs.push_back(rifff);
                    project.sound.mastering = SoundSettings::Mastering {};
                    project.sound.glue = SoundSettings::Glue {};
                    project.sound.tone = SoundSettings::Tone {};
                    // at the full drive: its DC blocker and drive glide are state too (Task 8)
                    project.sound.saturation = SoundSettings::Saturation { 1.8 };

                    constexpr int kBlock = 64;
                    struct Rig
                    {
                        StemBufferCache cache;
                        PlaybackEngine engine { cache };
                        PluginChain masterChain { kNumMasterChainSlots };
                        ChannelChainRegistry channelChains;
                        Transport transport { engine, masterChain, channelChains };
                    };
                    auto runBlocks = [&](Rig& rig, int count) {
                        std::vector<float> l((size_t) (count * kBlock)), r((size_t) (count * kBlock));
                        for (int b = 0; b < count; ++b)
                        {
                            float* channels[2] = { l.data() + b * kBlock, r.data() + b * kBlock };
                            rig.transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                        }
                        return std::make_pair(l, r);
                    };
                    auto makeRig = [&](Rig& rig) {
                        rig.engine.prepareMaster(kRate);
                        rig.engine.setProject(project);
                        rig.transport.setBpm(kBpm);
                    };

                    // played from the top, then seeked into the quiet half
                    Rig seeked;
                    makeRig(seeked);
                    seeked.transport.play(0.0);
                    runBlocks(seeked, 400); // 0.58 s of the loud half
                    seeked.transport.setPosition(0.75);
                    const auto after = runBlocks(seeked, 400);
                    const int fadeSamples = (int) std::ceil(0.012 * kRate);
                    const int jumpAt = ((fadeSamples + kBlock - 1) / kBlock) * kBlock;

                    // a fresh play from the same bar
                    Rig fresh;
                    makeRig(fresh);
                    fresh.transport.play(0.75);
                    const auto fromThere = runBlocks(fresh, 400);

                    // once the seek's hold and fade-in are done, the two are the same samples
                    const int settled = jumpAt + MasterStage::kLatencySamples + fadeSamples + kBlock;
                    bool same = true;
                    float worst = 0.0f;
                    for (int i = settled; i + jumpAt < (int) fromThere.first.size(); ++i)
                    {
                        worst = std::max(worst, std::abs(after.first[(size_t) i] - fromThere.first[(size_t) (i - jumpAt)]));
                        same = same && after.first[(size_t) i] == fromThere.first[(size_t) (i - jumpAt)]
                            && after.second[(size_t) i] == fromThere.second[(size_t) (i - jumpAt)];
                    }
                    expect(same, "after the seek the quiet half differs from a fresh play from there by up to "
                                     + juce::String(worst, 8));

                    seeked.engine.drainRetiredProject();
                    fresh.engine.drainRetiredProject();
                    file.deleteFile();
                }

                beginTest("the sample clock: every lap of a looping project is the export's lap to the bit, "
                          "at random device blocks (the position is counted in samples from the loop top, never summed in bars)");
                {
                    // Two half-bar tiles of a cosine (loud at each tile's first and last sample), so
                    // a seam read one sample off shows.
                    const int half = (int) kRate; // half a bar at 120 bpm
                    auto cosFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                                       .getChildFile("sssketch_transport_clock_cos.wav");
                    cosFile.deleteFile();
                    {
                        juce::WavAudioFormat wavFormat;
                        std::unique_ptr<juce::FileOutputStream> out(cosFile.createOutputStream());
                        std::unique_ptr<juce::AudioFormatWriter> writer(
                            wavFormat.createWriterFor(out.get(), kRate, 1, 32, {}, 0));
                        out.release();
                        juce::AudioBuffer<float> source(1, half);
                        for (int i = 0; i < half; ++i)
                            source.setSample(0, i, 0.5f * (float) std::cos(2.0 * 3.14159265358979323846 * 330.0 * i / kRate));
                        writer->writeFromAudioSampleBuffer(source, 0, half);
                    }
                    EngineProject project;
                    project.bpm = kBpm;
                    project.snapDiv = 16.0;
                    EngineRifff rifff;
                    rifff.groupId = "cos";
                    rifff.channelId = "c1";
                    rifff.startBar = 0.0;
                    rifff.barLength = 1;
                    EngineStem stem;
                    stem.stemKey = "cos:1";
                    stem.resolvedPath = cosFile.getFullPathName();
                    stem.durationSec = 1.0;
                    stem.barLength = 0.5;
                    rifff.stems.push_back(stem);
                    project.rifffs.push_back(rifff);

                    const auto exported = renderExport(project);
                    for (const unsigned seed : { 5u, 6u, 7u })
                    {
                        StemBufferCache cache;
                        PlaybackEngine engine(cache);
                        engine.setProject(project);
                        PluginChain masterChain(kNumMasterChainSlots);
                        ChannelChainRegistry channelChains;
                        Transport transport(engine, masterChain, channelChains);
                        transport.setBpm(kBpm);
                        transport.setLoopLengthBars(kBars);
                        transport.play(0.0);
                        std::mt19937 rng(seed);
                        std::uniform_int_distribution<int> size(1, 1100);
                        const int laps = 3;
                        std::vector<float> l((size_t) (laps * kTotal)), r((size_t) (laps * kTotal));
                        for (int at = 0; at < laps * kTotal;)
                        {
                            const int n = juce::jmin(size(rng), laps * kTotal - at);
                            float* channels[2] = { l.data() + at, r.data() + at };
                            transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, n, {});
                            at += n;
                        }
                        engine.drainRetiredProject();
                        // The loop seam's own declick pulls each lap's last 3 ms toward the next
                        // lap's first sample (the export, one pass, has none): compare up to it.
                        const int seam = (int) std::ceil(0.003 * kRate) + 1;
                        for (int lap = 0; lap < laps; ++lap)
                        {
                            int firstDiff = -1;
                            for (int i = 0; i < kTotal - seam && firstDiff < 0; ++i)
                                if (l[(size_t) (lap * kTotal + i)] != exported.first[(size_t) i]
                                    || r[(size_t) (lap * kTotal + i)] != exported.second[(size_t) i])
                                    firstDiff = i;
                            expect(firstDiff < 0, "seed " + juce::String(seed) + ", lap " + juce::String(lap)
                                                      + " differs from the export from sample " + juce::String(firstDiff));
                        }
                    }
                    cosFile.deleteFile();
                }

                beginTest("a seek that arrives while the previous seek is holding or fading in fades out from the "
                          "gain it has reached -- no jump (a scrub drag sends one every ~16 ms)");
                {
                    // A constant 0.8 throughout: any gain step shows as a sample step.
                    auto dc = writeConstantToneWav("sssketch_transport_scrub_dc.wav", (int) (2.0 * kRate));
                    EngineProject project;
                    project.bpm = kBpm;
                    project.snapDiv = 16.0;
                    EngineRifff rifff;
                    rifff.groupId = "dc";
                    rifff.channelId = "c1";
                    rifff.startBar = 0.0;
                    rifff.barLength = 1;
                    EngineStem stem;
                    stem.stemKey = "dc:1";
                    stem.resolvedPath = dc.getFullPathName();
                    stem.durationSec = 2.0;
                    stem.barLength = 1;
                    rifff.stems.push_back(stem);
                    project.rifffs.push_back(rifff);

                    constexpr int kBlock = 64;
                    const int fadeOutBlocks = ((int) std::ceil(0.012 * kRate) + kBlock - 1) / kBlock; // 9
                    // `blocksIntoFadeIn` blocks after the first seek's jump, a second seek. With the
                    // mastering on, the fade-in first holds 75 samples at silence: 1 block lands the
                    // second seek in that hold (gain 0), 2 blocks 53 samples into the fade-in (~0.1).
                    auto worstStep = [&](bool mastering, int blocksIntoFadeIn) {
                        auto p = project;
                        if (mastering)
                            p.sound.mastering = SoundSettings::Mastering {};
                        StemBufferCache cache;
                        PlaybackEngine engine(cache);
                        engine.prepareMaster(kRate);
                        engine.setProject(p);
                        PluginChain masterChain(kNumMasterChainSlots);
                        ChannelChainRegistry channelChains;
                        Transport transport(engine, masterChain, channelChains);
                        transport.setBpm(kBpm);
                        transport.play(0.05);
                        const int total = 20 + fadeOutBlocks + blocksIntoFadeIn + 60;
                        std::vector<float> l((size_t) (total * kBlock)), r((size_t) (total * kBlock));
                        for (int b = 0; b < total; ++b)
                        {
                            if (b == 20)
                                transport.setPosition(0.3);
                            if (b == 20 + fadeOutBlocks + blocksIntoFadeIn)
                                transport.setPosition(0.6);
                            float* channels[2] = { l.data() + b * kBlock, r.data() + b * kBlock };
                            transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
                        }
                        engine.drainRetiredProject();
                        // from the first seek on (a play starts with a step of its own: the DC)
                        float worst = 0.0f, peak = 0.0f;
                        for (size_t i = (size_t) (20 * kBlock); i < l.size(); ++i)
                        {
                            worst = std::max(worst, std::abs(l[i] - l[i - 1]));
                            peak = std::max(peak, std::abs(l[i]));
                        }
                        expect(peak > 0.3f, "not playing: peak " + juce::String(peak));
                        return worst;
                    };

                    // A linear 12 ms fade of ~0.8 moves ~0.0015 a sample; a jump is ~0.5 or more.
                    const float duringHold = worstStep(true, 1);
                    expect(duringHold < 0.01f, "a seek during the hold jumps by " + juce::String(duringHold));
                    const float duringFadeInMastered = worstStep(true, 2);
                    expect(duringFadeInMastered < 0.01f,
                           "a seek during the fade-in (mastering on) jumps by " + juce::String(duringFadeInMastered));
                    const float duringFadeIn = worstStep(false, 2);
                    expect(duringFadeIn < 0.01f, "a seek during the fade-in jumps by " + juce::String(duringFadeIn));
                    dc.deleteFile();
                }

                hot.deleteFile();
                hot2.deleteFile();
            }
        }
    };

    static TransportTests transportTests;
}

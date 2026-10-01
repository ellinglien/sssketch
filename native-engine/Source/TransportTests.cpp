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

                hot.deleteFile();
                hot2.deleteFile();
            }
        }
    };

    static TransportTests transportTests;
}

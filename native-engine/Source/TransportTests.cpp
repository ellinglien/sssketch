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
            }
        }
    };

    static TransportTests transportTests;
}

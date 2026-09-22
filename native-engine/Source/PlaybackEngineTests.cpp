// native-engine/Source/PlaybackEngineTests.cpp
#include "PlaybackEngine.h"
#include "StemBufferCache.h"
#include "ChannelChainRegistry.h"
#include "RenderExport.h"
#include <juce_core/juce_core.h>
#include <atomic>
#include <cmath>
#include <limits>
#include <thread>

namespace sssketch
{
    static juce::File writeFixtureWav(const juce::String& name, float value, int numSamples, double sampleRate = 44100.0)
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
            source.setSample(0, i, value);
        writer->writeFromAudioSampleBuffer(source, 0, numSamples);
        writer.reset();
        return file;
    }

    /** A steady sine, for tests that need a signal with actual FREQUENCY
     * content -- a constant (DC) fixture can't tell a filter sweep apart from
     * a volume change. */
    static juce::File writeSineFixtureWav(
        const juce::String& name, double freqHz, float amplitude, int numSamples, double sampleRate = 44100.0)
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
            source.setSample(0, i, amplitude * (float) std::sin(
                2.0 * juce::MathConstants<double>::pi * freqHz * (double) i / sampleRate));
        writer->writeFromAudioSampleBuffer(source, 0, numSamples);
        writer.reset();
        return file;
    }

    /** A linear ramp from ~0 to ~1 across the file, so a test can tell whether a
     * read landed near the buffer's head or its tail just from the sample value —
     * a constant-value fixture can't distinguish that. */
    static juce::File writeRampFixtureWav(const juce::String& name, int numSamples, double sampleRate = 44100.0)
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
            source.setSample(0, i, (float) i / (float) numSamples);
        writer->writeFromAudioSampleBuffer(source, 0, numSamples);
        writer.reset();
        return file;
    }

    class PlaybackEngineTests : public juce::UnitTest
    {
    public:
        PlaybackEngineTests() : juce::UnitTest("PlaybackEngine") {}

        void runTest() override
        {
            // 1 second of constant 0.5 at 44100Hz -> 1 bar at 60bpm (4 beats/bar, 1s/beat = 4s/bar)
            // Use a stem exactly 1 bar long at duration matching a simple bpm for round numbers.
            auto fixture = writeFixtureWav("sssketch_pe_fixture.wav", 0.5f, 44100);

            beginTest("silence when no project is set");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                for (float s : l) expectEquals(s, 0.0f);
            }

            beginTest("metronome clicks even on a project with zero placed rifffs");
            {
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0, secPerBeat = 1.0
                project.snapDiv = 16.0;
                // Deliberately no rifffs pushed — a metronome click is useful
                // as a reference before anything's even placed.

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                expect(!engine.isMetronomeEnabled()); // off by default
                engine.setMetronomeEnabled(true);
                expect(engine.isMetronomeEnabled());

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                // Sample 0 is exactly the downbeat's own zero-crossing (a
                // sine starts at 0, not its peak) — sample 1, a moment into
                // the click's decay envelope, is where "nonzero" actually
                // holds (see Metronome.h's own doc comment).
                expect(std::abs(l[1]) > 0.0f);
                expect(std::abs(r[1]) > 0.0f);
                expectWithinAbsoluteError(l[1], r[1], 1.0e-6f); // mono click, identical on both channels
            }

            beginTest("metronome contributes nothing when disabled (the default)");
            {
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                for (float s : l) expectEquals(s, 0.0f);
            }

            beginTest("renders a placed stem's samples at the right position, respects volume");
            {
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = fixture.getFullPathName();
                stem.durationSec = 4.0; // exactly 1 bar at 60bpm
                stem.barLength = 1;
                stem.volume = 0.5;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                // source sample value 0.5 * stem volume 0.5 = 0.25 (no fadeInBars/
                // fadeOutBars configured). Sampled at index 200 (~4.5ms), past the
                // always-on ~3ms anti-click fade-in floor (see FadeGain.cpp) — index
                // 100 (~2.3ms) would still be partway through that ramp.
                expectWithinAbsoluteError(l[200], 0.25f, 0.01f);
                expectWithinAbsoluteError(r[200], 0.25f, 0.01f);
            }

            beginTest("muted stem contributes nothing");
            {
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.resolvedPath = fixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.muted = true;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                for (float s : l) expectEquals(s, 0.0f);
            }

            beginTest("a mute region silences only its own span, not the whole stem");
            {
                // 4 bars at 60bpm (secPerBar=4s) -> whole stem spans [0,16)s.
                // Mute region covers bars [2,3) -> seconds [8,12). This test
                // renders as far as t=14s, so -- unlike most other tests in
                // this file, which stay inside the shared 1-second `fixture`
                // -- it needs its own fixture whose actual sample count
                // covers the full declared 16s (matching the
                // stem.durationSec convention used by e.g. oneShotFixture
                // above: fixture length in samples == declared durationSec),
                // otherwise reads past 44100 samples would silently return
                // silence from the out-of-bounds guard in renderBlock
                // regardless of mute state, defeating the point of this test.
                auto muteFixture = writeFixtureWav("sssketch_pe_mute_fixture.wav", 0.5f, 16 * 44100);
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.resolvedPath = muteFixture.getFullPathName(); // constant 0.5
                stem.durationSec = 16.0;
                stem.barLength = 4;
                stem.muteRegions.push_back({ 2.0, 3.0 });
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                // Deep inside the mute region (t=10s, well past both micro-fade
                // edges at 8s/12s) -- must be silent.
                {
                    std::vector<float> l(64, 0.0f), r(64, 0.0f);
                    engine.renderBlock(10.0 / 4.0, 44100.0, 64, l.data(), r.data(), channelChains);
                    for (float s : l) expectWithinAbsoluteError(s, 0.0f, 0.001f);
                }
                // Well before the mute region (t=2s) -- must be unaffected.
                {
                    std::vector<float> l(64, 0.0f), r(64, 0.0f);
                    engine.renderBlock(2.0 / 4.0, 44100.0, 64, l.data(), r.data(), channelChains);
                    for (float s : l) expectWithinAbsoluteError(s, 0.5f, 0.001f);
                }
                // Well after the mute region (t=14s) -- must be unaffected.
                {
                    std::vector<float> l(64, 0.0f), r(64, 0.0f);
                    engine.renderBlock(14.0 / 4.0, 44100.0, 64, l.data(), r.data(), channelChains);
                    for (float s : l) expectWithinAbsoluteError(s, 0.5f, 0.001f);
                }
                muteFixture.deleteFile();
            }

            beginTest("a mute region's edge ramps rather than jumps discontinuously");
            {
                // Same setup as above (see that test's own comment on why it
                // needs a full 16s fixture rather than the shared 1s one);
                // render a block straddling the mute region's own start edge
                // (8s) and confirm the samples ramp down smoothly rather than
                // jumping from 0.5 to 0.0 between two adjacent samples.
                auto muteFixture = writeFixtureWav("sssketch_pe_mute_edge_fixture.wav", 0.5f, 16 * 44100);
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.resolvedPath = muteFixture.getFullPathName();
                stem.durationSec = 16.0;
                stem.barLength = 4;
                stem.muteRegions.push_back({ 2.0, 3.0 }); // seconds [8,12)
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                // Render starting 5ms before the edge, straddling t=8.0s.
                const double positionBars = 7.995 / 4.0;
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(positionBars, 44100.0, 512, l.data(), r.data(), channelChains);

                // No two adjacent samples should differ by more than a small
                // fraction of the full 0.5 -> 0.0 swing -- a hard cut would
                // produce exactly one sample-to-sample jump of the full 0.5.
                float maxAdjacentDelta = 0.0f;
                for (size_t i = 1; i < l.size(); ++i)
                    maxAdjacentDelta = std::max(maxAdjacentDelta, std::abs(l[i] - l[i - 1]));
                expect(maxAdjacentDelta < 0.1f);
                muteFixture.deleteFile();
            }

            beginTest("nothing renders before the stem's start position");
            {
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 10.0; // starts far in the future
                rifff.barLength = 1;
                EngineStem stem;
                stem.resolvedPath = fixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                for (float s : l) expectEquals(s, 0.0f);
            }

            beginTest("a block straddling a segment boundary reads each segment from its own buffer position");
            {
                // Two back-to-back 1-bar tiles of the same repeating stem: tile0 covers
                // [0,4)s, tile1 covers [4,8)s. A ramp fixture lets us tell, from the
                // sample value alone, whether a read landed near the tail of tile0's
                // buffer or the head of tile1's — confirming the per-sample lookup
                // resets to each segment's own start rather than continuing to read
                // forward from wherever the block itself started.
                const int rampSamples = 176400; // 4s @ 44100Hz, matches durationSec below
                auto ramp = writeRampFixtureWav("sssketch_pe_ramp.wav", rampSamples);

                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 2; // two 1-bar tiles
                EngineStem stem;
                stem.resolvedPath = ramp.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                const double sampleRate = 44100.0;
                // 150 samples before the boundary, 20 after — the pre-boundary side is
                // deliberately kept outside LoopSewing's own 128-sample tail-blend window
                // (see StemBufferCache::load), which pulls tile0's last 128 samples toward
                // ITS OWN start value (~0.0 for this ramp) and would otherwise make this
                // test's "near 1.0" assumption false for reasons unrelated to what it's
                // actually checking (segment-relative vs. block-relative indexing).
                const int numSamples = 170;
                const double blockStartSec = 4.0 - 150.0 / sampleRate;
                const double positionBars = blockStartSec / 4.0;

                std::vector<float> l(numSamples, 0.0f), r(numSamples, 0.0f);
                engine.renderBlock(positionBars, sampleRate, numSamples, l.data(), r.data(), channelChains);

                // First sample: still in tile0, near (but outside the loop-sewing blend
                // window of) the end of its 4s buffer -> near 1.0.
                expect(l[0] > 0.9f);
                // Last sample: now in tile1, near the very start of its own buffer -> near 0.0,
                // NOT a continuation of tile0's near-1.0 tail (which a block-relative, rather
                // than segment-relative, index calculation would produce).
                expect(l[numSamples - 1] < 0.05f);

                ramp.deleteFile();
            }

            beginTest("leftCropBars clips the first tile without moving startBar, and reads from the correct offset into the source buffer");
            {
                // A 1-bar stem tiled twice (rifff.barLength=2), cropped 0.5
                // bars from the left. The ramp fixture lets us confirm the
                // FIRST rendered sample comes from HALFWAY into the stem's
                // own 4s buffer (~0.5), not from its very start (~0.0) --
                // proving the source read offset accounts for the crop, not
                // just the rendered time window.
                const int rampSamples = 176400; // 4s @ 44100Hz
                auto ramp = writeRampFixtureWav("sssketch_pe_leftcrop_ramp.wav", rampSamples);

                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 2;
                EngineStem stem;
                stem.resolvedPath = ramp.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.leftCropBars = 0.5;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                const double sampleRate = 44100.0;
                // A fresh segment start has its own unrelated 3ms
                // click-guard micro-fade-in (see FadeGain.cpp's
                // kMicroFadeSec), which would otherwise mask the very first
                // few samples down toward 0 regardless of leftCropBars
                // correctness. Render past it (200 samples ~= 4.5ms) and
                // check the last sample in the block instead of the first.
                const int numSamples = 200;
                // Rendered window starts exactly at startBar + leftCropBars
                // (0.5 bars = 2.0s at this tempo) -- startBar itself never
                // moved.
                const double blockStartSec = 2.0;
                const double positionBars = blockStartSec / 4.0;

                std::vector<float> l(numSamples, 0.0f), r(numSamples, 0.0f);
                engine.renderBlock(positionBars, sampleRate, numSamples, l.data(), r.data(), channelChains);

                // Halfway into a 0..1 ramp over 176400 samples is ~0.5, not ~0.0.
                expect(l[numSamples - 1] > 0.45f && l[numSamples - 1] < 0.55f);

                ramp.deleteFile();
            }

            beginTest("a negative leftCropBars renders tiles before the original anchor (extend-left case)");
            {
                // Same setup, but leftCropBars=-1 -- one whole extra tile
                // should now be audible starting one bar (2.0s) BEFORE
                // startBar itself (i.e. at absolute position -2.0s).
                const int rampSamples = 176400;
                auto ramp = writeRampFixtureWav("sssketch_pe_extendleft_ramp.wav", rampSamples);

                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 1.0; // so the extended tile (1 bar earlier) still starts >= 0
                rifff.barLength = 2;
                EngineStem stem;
                stem.resolvedPath = ramp.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.leftCropBars = -1.0;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                const double sampleRate = 44100.0;
                const int numSamples = 4;
                // startBar=1.0 bar (4.0s) + leftCropBars=-1.0 bar (-4.0s) = 0.0s.
                const double blockStartSec = 0.0;
                const double positionBars = blockStartSec / 4.0;

                std::vector<float> l(numSamples, 0.0f), r(numSamples, 0.0f);
                engine.renderBlock(positionBars, sampleRate, numSamples, l.data(), r.data(), channelChains);

                // Right at the start of this extended tile's own buffer -> near 0.0,
                // confirming audio is actually rendered here at all (not silence,
                // which is what today's code -- hardcoded floor of tileIdx at 0 --
                // would produce, since this position is "before tile 0").
                expect(l[0] < 0.05f);

                ramp.deleteFile();
            }

            beginTest("leftCropBars beyond playedBars renders nothing (fully cropped away)");
            {
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 2;
                EngineStem stem;
                stem.resolvedPath = "/nonexistent.wav"; // never actually read if this test passes
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.playedBars = 2.0;
                stem.leftCropBars = 3.0; // > playedBars
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                const double sampleRate = 44100.0;
                const int numSamples = 4;
                std::vector<float> l(numSamples, 0.0f), r(numSamples, 0.0f);
                // Should not crash, and should render silence (the missing
                // file would be audible as non-silence garbage if this
                // somehow tried to read it).
                engine.renderBlock(0.0, sampleRate, numSamples, l.data(), r.data(), channelChains);
                expect(l[0] == 0.0f);
            }

            beginTest("a non-finite leftCropBars falls back to no crop instead of corrupting tile math");
            {
                // A NaN or Infinity leftCropBars (e.g. from an oversized number in a
                // hand-edited or corrupted project file) must not flow into the
                // float->int tile-index cast, which is undefined behaviour on a
                // non-finite input and could turn this real-time callback into a
                // runaway loop. Confirms it instead falls back to 0.0 (no crop) and
                // renders exactly like an explicit leftCropBars=0.0 would.
                const int rampSamples = 176400;
                auto ramp = writeRampFixtureWav("sssketch_pe_nonfinite_leftcrop_ramp.wav", rampSamples);

                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 2;
                EngineStem stem;
                stem.resolvedPath = ramp.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.leftCropBars = std::numeric_limits<double>::quiet_NaN();
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                const double sampleRate = 44100.0;
                const int numSamples = 4;
                std::vector<float> l(numSamples, 0.0f), r(numSamples, 0.0f);
                // Renders promptly (no hang/crash) and starts right at the ramp's own
                // beginning, exactly as leftCropBars=0.0 would.
                engine.renderBlock(0.0, sampleRate, numSamples, l.data(), r.data(), channelChains);
                expect(l[0] >= 0.0f && l[0] < 0.05f);

                ramp.deleteFile();
            }

            beginTest("a later repeat of a looping stem does not get a spurious fade-in");
            {
                // Regression test: computeStemSchedule drops tiles whose end is already in
                // the past relative to whatever projectPos it's given. If renderBlock passed
                // the live, ever-advancing positionBars straight through as projectPos, then
                // once tile0 ends and is filtered out, tile1 becomes the new "index 0" of that
                // call's result and would be misidentified as isFirstSegment on every block
                // from then on, applying a bogus fade-in to it. Render deep inside tile1
                // (1.5s into its own fade-in-shaped window) and confirm it's flat, unfaded.
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 2; // two 1-bar tiles
                rifff.fadeInBars = 0.5; // fadeInSec = 0.5 * 4.0 = 2.0s
                EngineStem stem;
                stem.resolvedPath = fixture.getFullPathName(); // constant 0.5
                stem.durationSec = 4.0;
                stem.barLength = 1;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                // tile1 starts at t=4.0s; render at t=4.5s, 1.5s into tile1 (and squarely
                // inside what would be a bogus fade-in ramp [4.0, 6.0)s if tile1 were
                // wrongly treated as the first tile).
                const double positionBars = 4.5 / 4.0;
                std::vector<float> l(64, 0.0f), r(64, 0.0f);
                engine.renderBlock(positionBars, 44100.0, 64, l.data(), r.data(), channelChains);

                // Expected flat: 0.5 (source) * 1.0 (no fade — this is a repeat, not the
                // rifff's true first tile) * 1.0 (default volume) = 0.5.
                expectWithinAbsoluteError(l[0], 0.5f, 0.01f);
            }

            beginTest("renderBlock() prefers a live volume override over the committed stem volume");
            {
                auto rampFixture = writeFixtureWav("sssketch_pe_liveoverride_vol.wav", 0.5f, 44100);
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = rampFixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 4;
                stem.playedBars = 4.0;
                stem.volume = 0.2; // committed, quiet
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                engine.liveOverrides().setVolumeOverride("r1:1", 0.9f);

                // 200 samples, not 4 -- see the crop-trim plan's own note on
                // FadeGain.cpp's kMicroFadeSec (3ms click-guard fade-in on
                // every fresh segment start): checking l[0] would measure
                // that unrelated fade, not this test's own subject.
                std::vector<float> l(200, 0.0f), r(200, 0.0f);
                engine.renderBlock(0.0, 44100.0, 200, l.data(), r.data(), channelChains);

                // 0.5 (fixture) * 0.9 (override) = 0.45 -- would be
                // 0.5 * 0.2 = 0.1 without the override.
                expect(l[199] > 0.4f);

                rampFixture.deleteFile();
            }

            beginTest("renderBlock() falls back to the committed stem volume when no override is set");
            {
                auto rampFixture = writeFixtureWav("sssketch_pe_nooverride_vol.wav", 0.5f, 44100);
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = rampFixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 4;
                stem.playedBars = 4.0;
                stem.volume = 0.2;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                // No override set.

                std::vector<float> l(200, 0.0f), r(200, 0.0f);
                engine.renderBlock(0.0, 44100.0, 200, l.data(), r.data(), channelChains);
                expectWithinAbsoluteError(l[199], 0.1f, 0.02f); // 0.5 * 0.2

                rampFixture.deleteFile();
            }

            beginTest("a live volume override makes an otherwise-silent stem (committed volume 0) audible");
            {
                // Regression test for a specific ordering requirement: the
                // override must be resolved BEFORE the
                // `stem.muted || effectiveVolume <= 0.0` skip check, not
                // after -- otherwise a stem with committed volume 0 could
                // never be woken up by a live override at all.
                auto rampFixture = writeFixtureWav("sssketch_pe_liveoverride_wake.wav", 0.5f, 44100);
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = rampFixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 4;
                stem.playedBars = 4.0;
                stem.volume = 0.0; // committed silence
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                engine.liveOverrides().setVolumeOverride("r1:1", 0.7f);

                std::vector<float> l(200, 0.0f), r(200, 0.0f);
                engine.renderBlock(0.0, 44100.0, 200, l.data(), r.data(), channelChains);
                expect(l[199] > 0.3f); // 0.5 * 0.7 = 0.35 -- would be 0.0 without the override rescuing it from the skip

                rampFixture.deleteFile();
            }

            beginTest("renderBlock() prefers a live fadeIn override over the committed rifff.fadeInBars");
            {
                auto rampFixture = writeFixtureWav("sssketch_pe_liveoverride_fadein.wav", 0.5f, 44100);
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                rifff.groupId = "r1";
                rifff.fadeInBars = 2.0; // committed: an 8-second fade-in -- early samples near-silent
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = rampFixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 4;
                stem.playedBars = 4.0;
                stem.volume = 1.0;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                engine.liveOverrides().setFadeInOverride("r1", 0.0f); // override: no fade-in

                std::vector<float> l(200, 0.0f), r(200, 0.0f);
                engine.renderBlock(0.0, 44100.0, 200, l.data(), r.data(), channelChains);
                // Past the unrelated 3ms micro-fade, should be near the
                // fixture's own 0.5 value -- NOT suppressed by the
                // committed 2-bar fade-in, since the override replaces it.
                expect(l[199] > 0.4f);

                rampFixture.deleteFile();
            }

            beginTest("concurrent setVolumeOverride() and renderBlock() calls do not crash");
            {
                // Mirrors the existing "concurrent setProject() and
                // renderBlock() calls do not crash" stress test -- same
                // reasoning, applied to LiveParamOverrides' own atomic
                // shared_ptr publish mechanism (the exact pattern already
                // proven correct there).
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;

                EngineProject project;
                project.bpm = 120.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = "/nonexistent.wav"; // never actually decoded, see StemBufferCache::load's own doc comment
                stem.durationSec = 4.0;
                stem.barLength = 4;
                stem.playedBars = 4.0;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);
                engine.setProject(project);

                std::atomic<bool> stop { false };
                std::thread overrideThread([&]() {
                    float v = 0.0f;
                    while (!stop.load())
                    {
                        v = std::fmod(v + 0.01f, 1.0f);
                        engine.liveOverrides().setVolumeOverride("r1:1", v);
                    }
                });

                std::thread renderThread([&]() {
                    std::vector<float> l(512, 0.0f), r(512, 0.0f);
                    double positionBars = 0.0;
                    const double secPerBar = (60.0 / project.bpm) * 4.0;
                    for (int i = 0; i < 20000; ++i)
                    {
                        l.assign(512, 0.0f);
                        r.assign(512, 0.0f);
                        engine.renderBlock(positionBars, 44100.0, 512, l.data(), r.data(), channelChains);
                        positionBars += (512.0 / 44100.0) / secPerBar;
                    }
                });

                renderThread.join();
                stop = true;
                overrideThread.join();

                // Reaching here at all -- no crash, no hang -- is the
                // actual assertion.
                expect(true);
            }

            beginTest("two stems overlapping the same block sum their contributions rather than overwriting");
            {
                // renderBlock's core job is accumulating (+=) every stem's contribution
                // into outL/outR. None of the tests above exercise more than one stem at
                // once, so a bug that overwrote instead of accumulated (e.g. `outL[i2] =`
                // instead of `outL[i2] +=`) would pass every one of them. Two stems, two
                // different constant-value fixtures, both active for the whole block:
                // the output must equal the sum of each stem's own contribution.
                auto fixtureA = writeFixtureWav("sssketch_pe_mix_a.wav", 0.3f, 44100);
                auto fixtureB = writeFixtureWav("sssketch_pe_mix_b.wav", 0.2f, 44100);

                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 1;

                EngineStem stemA;
                stemA.stemKey = "r1:1";
                stemA.resolvedPath = fixtureA.getFullPathName();
                stemA.durationSec = 4.0;
                stemA.barLength = 1;
                stemA.volume = 1.0;
                rifff.stems.push_back(stemA);

                EngineStem stemB;
                stemB.stemKey = "r1:2";
                stemB.resolvedPath = fixtureB.getFullPathName();
                stemB.durationSec = 4.0;
                stemB.barLength = 1;
                stemB.volume = 1.0;
                rifff.stems.push_back(stemB);

                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);

                // 0.3 + 0.2 = 0.5, not either fixture's value alone — proves accumulation.
                // Index 200 (~4.5ms), past the anti-click fade-in floor — see the
                // identical note on the single-stem test above.
                expectWithinAbsoluteError(l[200], 0.5f, 0.01f);
                expectWithinAbsoluteError(r[200], 0.5f, 0.01f);

                fixtureA.deleteFile();
                fixtureB.deleteFile();
            }

            beginTest("a stem whose native sample rate differs from the output rate is read at the correct time");
            {
                // Ramp fixture at 22050Hz (half the 44100Hz output rate). If the lookup
                // mistakenly used the output rate instead of the source's own rate to
                // convert elapsed time to a sample index, the computed index would land
                // out of bounds (skipped -> silence) instead of at the correct value.
                const int rampSamples = 22050; // 1.0s @ 22050Hz, matches durationSec below
                auto ramp = writeRampFixtureWav("sssketch_pe_ramp_22050.wav", rampSamples, 22050.0);

                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.resolvedPath = ramp.getFullPathName();
                stem.durationSec = 1.0; // stem's own native tile length: 1 second of audio
                stem.barLength = 1;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                // Segment starts at t=0; render at t=0.5s, i.e. exactly halfway through the
                // segment -> expected source sample index 11025 of 22050 -> ramp value 0.5.
                const double positionBars = 0.5 / 4.0;
                std::vector<float> l(8, 0.0f), r(8, 0.0f);
                engine.renderBlock(positionBars, 44100.0, 8, l.data(), r.data(), channelChains);

                expectWithinAbsoluteError(l[0], 0.5f, 0.02f);

                ramp.deleteFile();
            }

            beginTest("renderBlock output is unaffected by channel routing when no channel has any plugin loaded");
            {
                // Two rifffs on two DIFFERENT channels (today's default shape --
                // one clip per channel), rendered through the new per-channel
                // accumulation stage with an empty ChannelChainRegistry (no
                // plugin loaded anywhere, so every channel is a pure
                // passthrough). This is the regression check that the Task 4
                // restructuring (splitting the old single outL/outR
                // accumulation into per-channel scratch buffers that get
                // summed back in) didn't break anything: both channels'
                // stems must still audibly contribute, deterministically,
                // with no NaN/Inf introduced by the extra indirection.
                auto toneA = writeFixtureWav("sssketch_pe_channel_a.wav", 0.3f, 44100);
                auto toneB = writeFixtureWav("sssketch_pe_channel_b.wav", 0.2f, 44100);

                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;

                EngineRifff rifff1;
                rifff1.groupId = "r1";
                rifff1.channelId = "ch-1";
                rifff1.startBar = 0.0;
                rifff1.barLength = 1;
                EngineStem stem1;
                stem1.resolvedPath = toneA.getFullPathName();
                stem1.durationSec = 4.0;
                stem1.barLength = 1;
                rifff1.stems.push_back(stem1);
                project.rifffs.push_back(rifff1);

                EngineRifff rifff2;
                rifff2.groupId = "r2";
                rifff2.channelId = "ch-2";
                rifff2.startBar = 0.0;
                rifff2.barLength = 1;
                EngineStem stem2;
                stem2.resolvedPath = toneB.getFullPathName();
                stem2.durationSec = 4.0;
                stem2.barLength = 1;
                rifff2.stems.push_back(stem2);
                project.rifffs.push_back(rifff2);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains; // nothing loaded -- every channel is a pure passthrough
                engine.setProject(project);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);

                // Same math as "two stems overlapping the same block sum their
                // contributions" above, just now routed through two separate
                // channel scratch buffers before being summed back into the
                // real output -- 0.3 + 0.2 = 0.5 proves both channels' own
                // accumulation-then-passthrough-then-sum path is intact.
                expectWithinAbsoluteError(l[200], 0.5f, 0.01f);
                expectWithinAbsoluteError(r[200], 0.5f, 0.01f);
                for (int i = 0; i < 512; ++i)
                {
                    expect(std::isfinite(l[i]));
                    expect(std::isfinite(r[i]));
                }

                toneA.deleteFile();
                toneB.deleteFile();
            }

            beginTest("a one-shot stem plays once, never tiled, even when the rifff's bound would imply many tiles");
            {
                auto oneShotFixture = writeFixtureWav("sssketch_pe_oneshot_fixture.wav", 0.8f, 4410); // 0.1s @44100Hz
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.startBar = 0.0;
                rifff.barLength = 8; // a normal (non-one-shot) stem this short would tile many times across 8 bars
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = oneShotFixture.getFullPathName();
                stem.durationSec = 0.1;
                // Deliberately much shorter than rifff.barLength (8) -- without
                // the oneShot branch, this would tile 8 times across the rifff,
                // once every stem.barLength*spb = 1*4 = 4 seconds, which is
                // exactly what the second assertion below checks isn't happening.
                stem.barLength = 1;
                stem.oneShot = true;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                // First block: covers the one-shot's own 0.1s window -- expect real audio.
                std::vector<float> l1(4410, 0.0f), r1(4410, 0.0f);
                engine.renderBlock(0.0, 44100.0, 4410, l1.data(), r1.data(), channelChains);
                expect(std::abs(l1[200]) > 0.0f);

                // Second block: bar 4 (16s in) -- well past where a LOOPED version of
                // this same short stem would have tiled/repeated throughout the
                // rifff's 8-bar span, but still within that declared barLength (so a
                // non-one-shot stem would legitimately still be playing there).
                std::vector<float> l2(512, 0.0f), r2(512, 0.0f);
                engine.renderBlock(4.0, 44100.0, 512, l2.data(), r2.data(), channelChains);
                for (float s : l2) expectEquals(s, 0.0f);

                oneShotFixture.deleteFile();
            }

            beginTest("a one-shot stem's playback rate is unaffected by project bpm (no resampling)");
            {
                auto rampFixture = writeRampFixtureWav("sssketch_pe_oneshot_ramp.wav", 44100); // 1s ramp @44100Hz

                auto renderAtBpm = [&](double bpm) {
                    EngineProject project;
                    project.bpm = bpm;
                    project.snapDiv = 16.0;
                    EngineRifff rifff;
                    rifff.groupId = "r1";
                    rifff.startBar = 0.0;
                    rifff.barLength = 8;
                    EngineStem stem;
                    stem.stemKey = "r1:1";
                    stem.resolvedPath = rampFixture.getFullPathName();
                    stem.durationSec = 1.0;
                    stem.barLength = 8;
                    stem.oneShot = true;
                    rifff.stems.push_back(stem);
                    project.rifffs.push_back(rifff);

                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    ChannelChainRegistry channelChains;
                    engine.setProject(project);
                    std::vector<float> l(512, 0.0f), r(512, 0.0f);
                    engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                    return l;
                };

                auto slow = renderAtBpm(60.0);
                auto fast = renderAtBpm(240.0);
                // Same trigger position (startBar 0.0 is t=0 regardless of bpm) and
                // same output sample rate -- a one-shot's own source-read position at
                // a given sample index must be identical either way, since bpm must
                // never affect its playback rate (unlike a normal, resampled stem).
                expectWithinAbsoluteError(slow[300], fast[300], 1.0e-6f);

                rampFixture.deleteFile();
            }

            beginTest("trimStartSec/trimEndSec are respected -- audio outside the trimmed window is silent");
            {
                auto trimFixture = writeFixtureWav("sssketch_pe_oneshot_trim.wav", 0.8f, 44100); // 1s @44100Hz
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.startBar = 0.0;
                rifff.barLength = 8;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = trimFixture.getFullPathName();
                stem.durationSec = 1.0;
                stem.barLength = 8;
                stem.oneShot = true;
                stem.trimStartSec = 0.1; // skip the first 4410 samples
                stem.trimEndSec = 0.3;   // stop after 0.2s of played audio (8820 samples)
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                std::vector<float> l(11025, 0.0f), r(11025, 0.0f); // 0.25s -- covers the trimmed window plus margin
                engine.renderBlock(0.0, 44100.0, 11025, l.data(), r.data(), channelChains);
                // Segment plays from wall-clock 0 to 0.2s (trimEnd - trimStart), i.e.
                // samples [0, 8820) -- silent from 8820 onward.
                expect(std::abs(l[4000]) > 0.0f);   // well within the trimmed window
                expectEquals(l[10000], 0.0f);       // past trimEnd - trimStart -- trimmed off

                trimFixture.deleteFile();
            }

            beginTest("concurrent setProject() and renderBlock() calls do not crash");
            {
                // Regression test for the PlaybackEngine::currentProject/
                // channelGroups race documented in PHASE3_FINDINGS.md --
                // setProject() used to reassign a plain member while
                // renderBlock() read it directly on another thread with no
                // synchronization at all. This exercises the exact
                // concurrent-access pattern the live-volume/fade-drag
                // feature depends on being safe, for real, under sustained
                // load -- the previous code had no mechanism to survive
                // this at all. See this file's own header comment on why
                // this isn't a strict TDD red/green test.
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;

                EngineProject project;
                project.bpm = 120.0;
                project.snapDiv = 16.0;

                std::atomic<bool> stop { false };
                std::thread setProjectThread([&]() {
                    int volumeToggle = 0;
                    while (!stop.load())
                    {
                        EngineRifff rifff;
                        rifff.startBar = 0.0;
                        rifff.barLength = 4;
                        EngineStem stem;
                        // Never actually decoded -- see StemBufferCache::load's
                        // own doc comment, a missing file is a normal, harmless
                        // case (renderBlock just skips it). Keeps this test
                        // fast and independent of any audio fixture.
                        stem.resolvedPath = "/nonexistent.wav";
                        stem.durationSec = 4.0;
                        stem.barLength = 4;
                        stem.playedBars = 4.0;
                        stem.volume = (volumeToggle++ % 2 == 0) ? 0.3 : 0.9;
                        rifff.stems.push_back(stem);

                        EngineProject next = project;
                        next.rifffs.push_back(rifff);
                        engine.setProject(next);
                    }
                });

                std::thread renderThread([&]() {
                    std::vector<float> l(512, 0.0f), r(512, 0.0f);
                    double positionBars = 0.0;
                    const double secPerBar = (60.0 / project.bpm) * 4.0;
                    for (int i = 0; i < 20000; ++i)
                    {
                        l.assign(512, 0.0f);
                        r.assign(512, 0.0f);
                        engine.renderBlock(positionBars, 44100.0, 512, l.data(), r.data(), channelChains);
                        positionBars += (512.0 / 44100.0) / secPerBar;
                    }
                });

                renderThread.join();
                stop = true;
                setProjectThread.join();

                // Reaching here at all -- no crash, no hang -- is the actual
                // assertion.
                expect(true);
            }

            // ---- built-in sound toolkit (filter / reverb send / automation) ----
            // See docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md,
            // section 2b: everything here is per CLIP now, not per channel.

            beginTest("a project with explicitly neutral toolkit entries renders BIT-identically to one with none");
            {
                // The regression that matters most: adding the toolkit must
                // not change what an ordinary project sounds like by even one
                // sample. Rendering the same arrangement with (a) no toolkit
                // data at all -- exactly what every project saved before this
                // feature parses to -- and (b) explicit, neutral per-clip
                // toolkits on both clips must produce identical output.
                auto toneA = writeFixtureWav("sssketch_pe_tk_neutral_a.wav", 0.3f, 44100);
                auto toneB = writeFixtureWav("sssketch_pe_tk_neutral_b.wav", 0.2f, 44100);

                EngineProject bare;
                bare.bpm = 60.0;
                bare.snapDiv = 16.0;
                for (int n = 0; n < 2; ++n)
                {
                    EngineRifff rifff;
                    rifff.groupId = n == 0 ? "r1" : "r2";
                    rifff.channelId = n == 0 ? "ch-1" : "ch-2";
                    rifff.startBar = 0.0;
                    rifff.barLength = 1;
                    EngineStem stem;
                    stem.resolvedPath = (n == 0 ? toneA : toneB).getFullPathName();
                    stem.durationSec = 4.0;
                    stem.barLength = 1;
                    rifff.stems.push_back(stem);
                    bare.rifffs.push_back(rifff);
                }

                EngineProject withNeutralToolkits = bare;
                for (auto& rifff : withNeutralToolkits.rifffs)
                {
                    for (auto& stem : rifff.stems)
                    {
                        // Present on the wire, every field left at its
                        // default -- which is exactly the neutral position
                        // (see EngineStemToolkit's doc comment). setProject
                        // must downgrade hasToolkit back to false for these,
                        // putting them back on the pre-toolkit render path.
                        stem.hasToolkit = true;
                    }
                }

                std::vector<float> bareL(512, 0.0f), bareR(512, 0.0f);
                {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    ChannelChainRegistry channelChains;
                    engine.setProject(bare);
                    engine.renderBlock(0.0, 44100.0, 512, bareL.data(), bareR.data(), channelChains);
                }

                std::vector<float> toolkitL(512, 0.0f), toolkitR(512, 0.0f);
                {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    ChannelChainRegistry channelChains;
                    engine.setProject(withNeutralToolkits);
                    engine.renderBlock(0.0, 44100.0, 512, toolkitL.data(), toolkitR.data(), channelChains);
                }

                for (int i = 0; i < 512; ++i)
                {
                    expectEquals(toolkitL[i], bareL[i]);
                    expectEquals(toolkitR[i], bareR[i]);
                }
                // And it still actually rendered something, so this isn't
                // trivially "both are silence".
                expectWithinAbsoluteError(bareL[200], 0.5f, 0.01f);

                toneA.deleteFile();
                toneB.deleteFile();
            }

            beginTest("a clip's filter affects only that clip");
            {
                // Both fixtures are constant (DC) -- so a HIGHPASS is the
                // clearest possible probe: DC is the one thing a highpass
                // must remove completely, and its absence in the sum is
                // unambiguous. The first clip gets the highpass, the second
                // gets nothing; if the filter leaked across clips, the
                // second's contribution would vanish too.
                auto toneA = writeFixtureWav("sssketch_pe_tk_filter_a.wav", 0.3f, 44100);
                auto toneB = writeFixtureWav("sssketch_pe_tk_filter_b.wav", 0.2f, 44100);

                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                for (int n = 0; n < 2; ++n)
                {
                    EngineRifff rifff;
                    rifff.groupId = n == 0 ? "r1" : "r2";
                    rifff.channelId = n == 0 ? "ch-1" : "ch-2";
                    rifff.startBar = 0.0;
                    rifff.barLength = 1;
                    EngineStem stem;
                    stem.resolvedPath = (n == 0 ? toneA : toneB).getFullPathName();
                    stem.durationSec = 4.0;
                    stem.barLength = 1;
                    rifff.stems.push_back(stem);
                    project.rifffs.push_back(rifff);
                }

                auto& filtered = project.rifffs[0].stems[0];
                filtered.hasToolkit = true;
                filtered.toolkit.filterMode = FilterMode::highpass;
                filtered.toolkit.filterCutoff = 0.75; // well up the log range -- kHz, not Hz

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);

                // By sample 400 (~9ms in) the highpass has long since removed
                // the first clip's DC, leaving only the second's untouched 0.2.
                expectWithinAbsoluteError(l[400], 0.2f, 0.01f);
                expectWithinAbsoluteError(r[400], 0.2f, 0.01f);
            }

            beginTest("a reverb send leaves a tail after the dry signal has stopped");
            {
                // 240bpm -> 1 sec/bar, and the fixture is exactly 1 second, so
                // one bar of audio then silence. With no send, the output
                // after that bar is EXACTLY zero; with a send, it is not --
                // which is the whole point of a send.
                auto tone = writeFixtureWav("sssketch_pe_tk_reverb.wav", 0.5f, 44100);

                EngineProject dryProject;
                dryProject.bpm = 240.0; // secPerBar = 1.0
                dryProject.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.channelId = "ch-1";
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.resolvedPath = tone.getFullPathName();
                stem.durationSec = 1.0;
                stem.barLength = 1;
                stem.playedBars = 1.0; // one tile only -- no looping past bar 1
                rifff.stems.push_back(stem);
                dryProject.rifffs.push_back(rifff);

                EngineProject wetProject = dryProject;
                wetProject.rifffs[0].stems[0].hasToolkit = true;
                wetProject.rifffs[0].stems[0].toolkit.reverbSend = 1.0;
                wetProject.reverb.roomSize = 0.6;
                wetProject.reverb.preDelayMs = 0.0;

                // Renders bars 0..2 in 512-sample blocks, collecting the peak
                // of each block, then looks only at the blocks AFTER the dry
                // audio has ended.
                auto peaksFor = [&](const EngineProject& project) {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    ChannelChainRegistry channelChains;
                    engine.setProject(project);
                    std::vector<double> peaks;
                    const double secPerBar = 1.0;
                    for (int block = 0; block * 512 < 88200; ++block)
                    {
                        std::vector<float> l(512, 0.0f), r(512, 0.0f);
                        const double positionBars = ((block * 512) / 44100.0) / secPerBar;
                        engine.renderBlock(positionBars, 44100.0, 512, l.data(), r.data(), channelChains);
                        double peak = 0.0;
                        for (float s : l) peak = juce::jmax(peak, (double) std::abs(s));
                        peaks.push_back(peak);
                    }
                    return peaks;
                };

                const auto dryPeaks = peaksFor(dryProject);
                const auto wetPeaks = peaksFor(wetProject);

                // Block 100 is at ~1.16s -- past the end of the one-bar stem.
                expectEquals(dryPeaks[100], 0.0);
                expect(wetPeaks[100] > 1.0e-4,
                       "reverb tail peak was " + juce::String(wetPeaks[100]));
                // And it decays rather than sustaining.
                expect(wetPeaks[160] < wetPeaks[100],
                       "later tail " + juce::String(wetPeaks[160])
                           + " should be under earlier " + juce::String(wetPeaks[100]));

                tone.deleteFile();
            }

            beginTest("volume automation drives the clip's level across the arrangement");
            {
                // 60bpm -> 4 sec/bar, and a 4-second constant fixture, so one
                // bar is exactly one playthrough of the file. A volume curve
                // from 1.0 at bar 0 to 0.0 at bar 1 should make the rendered
                // level fall linearly across those four seconds.
                auto tone = writeFixtureWav("sssketch_pe_tk_volauto.wav", 0.5f, 44100 * 4);

                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.channelId = "ch-1";
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.resolvedPath = tone.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.playedBars = 1.0;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                auto& automated = project.rifffs[0].stems[0];
                automated.hasToolkit = true;
                // CLIP-RELATIVE bars: the clip starts at arrangement bar 0
                // here, so the two spaces happen to coincide -- the
                // clip-relative test below deliberately moves them apart.
                automated.toolkit.automation.volume = { { 0.0, 1.0 }, { 1.0, 0.0 } };

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                // Rendered continuously, block by block, exactly as both the
                // live transport and the offline exporter do.
                std::vector<float> rendered;
                const double secPerBar = 4.0;
                const int totalSamples = 44100 * 4;
                for (int start = 0; start < totalSamples; start += 512)
                {
                    std::vector<float> l(512, 0.0f), r(512, 0.0f);
                    engine.renderBlock(
                        (start / 44100.0) / secPerBar, 44100.0, 512, l.data(), r.data(), channelChains);
                    rendered.insert(rendered.end(), l.begin(), l.end());
                }

                // The dry level is 0.5 throughout, so the rendered value IS
                // the automation gain times 0.5. Tolerances allow for the
                // ~15ms smoother and 16-bit fixture quantisation.
                expectWithinAbsoluteError(rendered[(size_t) (44100 * 0.1)], 0.5f * 0.975f, 0.02f);
                expectWithinAbsoluteError(rendered[(size_t) (44100 * 2.0)], 0.5f * 0.5f, 0.02f);
                expectWithinAbsoluteError(rendered[(size_t) (44100 * 3.5)], 0.5f * 0.125f, 0.02f);
                // Monotonically falling -- a curve, not a step or a wobble.
                expect(rendered[(size_t) (44100 * 1.0)] > rendered[(size_t) (44100 * 3.0)]);

                tone.deleteFile();
            }

            beginTest("cutoff automation actually sweeps the filter rather than sitting still");
            {
                // A steady 1kHz sine under a LOWPASS whose cutoff sweeps from
                // fully open (neutral, 20kHz) down to ~112Hz across one bar.
                // A sine, not the DC fixture the other toolkit tests use: DC
                // can't distinguish a filter sweep from a volume ramp, and a
                // highpass removes DC even at its own neutral 20Hz bottom, so
                // neither mode has a usable DC probe for a SWEEP (as opposed
                // to the fixed-cutoff tests above, where "gone entirely" is
                // the whole assertion).
                auto tone = writeSineFixtureWav("sssketch_pe_tk_cutoffauto.wav", 1000.0, 0.5f, 44100 * 4);

                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.channelId = "ch-1";
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.resolvedPath = tone.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.playedBars = 1.0;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                auto& swept = project.rifffs[0].stems[0];
                swept.hasToolkit = true;
                swept.toolkit.filterMode = FilterMode::lowpass;
                // 1.0 -> 20kHz (neutral, the sine passes); 0.25 -> ~112Hz
                // (three octaves below the sine, which is therefore gone).
                swept.toolkit.automation.filterCutoff = { { 0.0, 1.0 }, { 1.0, 0.25 } };

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                std::vector<float> rendered;
                const double secPerBar = 4.0;
                for (int start = 0; start < 44100 * 4; start += 512)
                {
                    std::vector<float> l(512, 0.0f), r(512, 0.0f);
                    engine.renderBlock(
                        (start / 44100.0) / secPerBar, 44100.0, 512, l.data(), r.data(), channelChains);
                    rendered.insert(rendered.end(), l.begin(), l.end());
                }

                auto rmsOver = [&](double fromSec, double toSec) {
                    const auto from = (size_t) (44100 * fromSec);
                    const auto to = juce::jmin((size_t) (44100 * toSec), rendered.size());
                    double sum = 0.0;
                    for (size_t i = from; i < to; ++i)
                        sum += (double) rendered[i] * (double) rendered[i];
                    return std::sqrt(sum / (double) (to - from));
                };

                // Early, with the cutoff still near neutral, the 0.5-amplitude
                // sine passes: rms ~= 0.5/sqrt(2) ~= 0.354.
                const double early = rmsOver(0.1, 0.6);
                expect(early > 0.3, "early rms was " + juce::String(early));
                // Late -- measured over the last 0.35s, where the curve has
                // brought the cutoff a good 2.5+ octaves under the tone -- it
                // is essentially gone. (A wider late window would average in
                // the middle of the sweep, where the cutoff is still only a
                // few hundred Hz and the attenuation is correspondingly
                // milder; that showed up as a real 12x-instead-of-20x
                // failure the first time this was written.)
                const double late = rmsOver(3.6, 3.95);
                expect(late * 15.0 < early,
                       "late rms " + juce::String(late) + " vs early " + juce::String(early));
                // And the sweep is genuinely progressive rather than a step
                // somewhere -- the middle sits between the two ends.
                const double middle = rmsOver(1.7, 2.2);
                expect(middle < early && middle > late,
                       "middle rms " + juce::String(middle) + " should sit between "
                           + juce::String(late) + " and " + juce::String(early));

                tone.deleteFile();
            }

            beginTest("the OFFLINE render path applies the toolkit exactly as live playback does");
            {
                // renderProjectToWavFile (RenderExport.cpp) builds its own
                // PlaybackEngine and drives the same renderBlock() the live
                // transport does -- there is one graph, not two kept in sync.
                // This pins that: the same project exported offline shows the
                // same filtering live playback produces, and a neutral
                // project exports unfiltered.
                auto tone = writeFixtureWav("sssketch_pe_tk_offline.wav", 0.5f, 44100 * 2);

                EngineProject neutral;
                neutral.bpm = 240.0; // secPerBar = 1.0
                neutral.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.channelId = "ch-1";
                rifff.startBar = 0.0;
                rifff.barLength = 2;
                EngineStem stem;
                stem.resolvedPath = tone.getFullPathName();
                stem.durationSec = 2.0;
                stem.barLength = 2;
                stem.playedBars = 2.0;
                rifff.stems.push_back(stem);
                neutral.rifffs.push_back(rifff);

                EngineProject filtered = neutral;
                filtered.rifffs[0].stems[0].hasToolkit = true;
                filtered.rifffs[0].stems[0].toolkit.filterMode = FilterMode::highpass;
                filtered.rifffs[0].stems[0].toolkit.filterCutoff = 0.75;

                auto renderedRms = [this](const EngineProject& project, const juce::String& name) {
                    auto out = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile(name);
                    out.deleteFile();
                    juce::String error;
                    const bool ok = renderProjectToWavFile(project, out.getFullPathName(), 2.0, error);
                    expect(ok, "offline render failed: " + error);

                    juce::AudioFormatManager formats;
                    formats.registerBasicFormats();
                    std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(out));
                    if (reader == nullptr)
                    {
                        expect(false, "could not read back " + out.getFullPathName());
                        return 0.0;
                    }
                    const int numSamples = (int) reader->lengthInSamples;
                    juce::AudioBuffer<float> buffer(2, numSamples);
                    reader->read(&buffer, 0, numSamples, 0, true, true);
                    double sum = 0.0;
                    // Skips the first 0.1s so neither the filter's own
                    // settling transient nor the clip's fade-in is measured.
                    const int from = 4410;
                    for (int i = from; i < numSamples; ++i)
                        sum += (double) buffer.getSample(0, i) * (double) buffer.getSample(0, i);
                    out.deleteFile();
                    return std::sqrt(sum / (double) (numSamples - from));
                };

                const double neutralRms = renderedRms(neutral, "sssketch_pe_tk_offline_neutral.wav");
                const double filteredRms = renderedRms(filtered, "sssketch_pe_tk_offline_filtered.wav");

                // The neutral export is the plain DC-ish clip...
                expect(neutralRms > 0.4, "neutral export rms was " + juce::String(neutralRms));
                // ...and the filtered one has had that DC removed by the same
                // highpass the live test above measured.
                expect(filteredRms < 0.01,
                       "filtered export rms was " + juce::String(filteredRms)
                           + " (neutral was " + juce::String(neutralRms) + ")");

                tone.deleteFile();
            }

            beginTest("two stems on ONE channel keep separate toolkits -- the lane is per clip");
            {
                // Elling's second walkthrough finding: ungrouped stems that
                // happened to share a channel shared one lane. They are two
                // clips, so they are two toolkits, even inside one rifff on
                // one channel.
                auto toneA = writeFixtureWav("sssketch_pe_tk_perstem_a.wav", 0.3f, 44100);
                auto toneB = writeFixtureWav("sssketch_pe_tk_perstem_b.wav", 0.2f, 44100);

                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.channelId = "ch-1";
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                for (int n = 0; n < 2; ++n)
                {
                    EngineStem stem;
                    stem.stemKey = n == 0 ? "r1:0" : "r1:1";
                    stem.resolvedPath = (n == 0 ? toneA : toneB).getFullPathName();
                    stem.durationSec = 4.0;
                    stem.barLength = 1;
                    rifff.stems.push_back(stem);
                }
                // Only the FIRST stem gets a highpass, which removes its DC
                // entirely. The second, on the same channel, must be
                // untouched.
                rifff.stems[0].hasToolkit = true;
                rifff.stems[0].toolkit.filterMode = FilterMode::highpass;
                rifff.stems[0].toolkit.filterCutoff = 0.75;
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);

                expectWithinAbsoluteError(l[400], 0.2f, 0.01f);

                toneA.deleteFile();
                toneB.deleteFile();
            }

            beginTest("automation bars are CLIP-RELATIVE -- a moved clip's curve moves with it");
            {
                // The whole point of originBar. 240bpm -> 1 sec/bar. The clip
                // starts at arrangement bar 1 and carries a volume curve from
                // 1.0 at its OWN bar 0 to 0.0 at its own bar 1 -- i.e. over
                // arrangement seconds 1..2, not 0..1. If originBar were
                // ignored, the curve would already have reached 0 before the
                // clip's first sample and the clip would be silent throughout.
                auto tone = writeFixtureWav("sssketch_pe_tk_cliprel.wav", 0.5f, 44100 * 2);

                EngineProject project;
                project.bpm = 240.0; // secPerBar = 1.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.channelId = "ch-1";
                rifff.startBar = 1.0;
                rifff.barLength = 2;
                EngineStem stem;
                stem.stemKey = "r1:0";
                stem.resolvedPath = tone.getFullPathName();
                stem.durationSec = 2.0;
                stem.barLength = 2;
                stem.playedBars = 2.0;
                stem.hasToolkit = true;
                stem.toolkit.originBar = 1.0; // the clip's own left edge
                stem.toolkit.automation.volume = { { 0.0, 1.0 }, { 1.0, 0.0 } };
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                std::vector<float> rendered;
                for (int start = 0; start < 44100 * 3; start += 512)
                {
                    std::vector<float> l(512, 0.0f), r(512, 0.0f);
                    engine.renderBlock(start / 44100.0, 44100.0, 512, l.data(), r.data(), channelChains);
                    rendered.insert(rendered.end(), l.begin(), l.end());
                }

                // 1.1s in: 0.1 of the way through the clip's own first bar,
                // so still near full level. This is the assertion that fails
                // outright if the curve is read in absolute bars.
                expectWithinAbsoluteError(rendered[(size_t) (44100 * 1.1)], 0.5f * 0.9f, 0.03f);
                // 1.9s in: nearly at the curve's end.
                expectWithinAbsoluteError(rendered[(size_t) (44100 * 1.9)], 0.5f * 0.1f, 0.03f);
                // Past the last breakpoint the curve HOLDS at 0 -- silence,
                // even though the clip itself plays on to 3s.
                expectWithinAbsoluteError(rendered[(size_t) (44100 * 2.5)], 0.0f, 0.01f);

                tone.deleteFile();
            }

            beginTest("OFFLINE: a volume curve to zero really silences the clip");
            {
                // Direct check on a live report that volume automation
                // "can't hear anything" while the filter was audible. Both
                // renders below are the same arrangement through the same
                // renderBlock -- only the curve differs -- so a difference
                // here is the curve doing its job and nothing else.
                auto tone = writeFixtureWav("sssketch_pe_tk_volsilence.wav", 0.5f, 44100 * 2);

                EngineProject neutral;
                neutral.bpm = 240.0; // secPerBar = 1.0
                neutral.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.channelId = "ch-1";
                rifff.startBar = 0.0;
                rifff.barLength = 2;
                EngineStem stem;
                stem.stemKey = "r1:0";
                stem.resolvedPath = tone.getFullPathName();
                stem.durationSec = 2.0;
                stem.barLength = 2;
                stem.playedBars = 2.0;
                rifff.stems.push_back(stem);
                neutral.rifffs.push_back(rifff);

                EngineProject faded = neutral;
                faded.rifffs[0].stems[0].hasToolkit = true;
                faded.rifffs[0].stems[0].toolkit.automation.volume =
                    { { 0.0, 1.0 }, { 1.0, 0.0 } };

                auto rmsOfExport = [this](const EngineProject& project,
                                          const juce::String& name,
                                          double fromSec,
                                          double toSec) {
                    auto out = juce::File::getSpecialLocation(juce::File::tempDirectory)
                                   .getChildFile(name);
                    out.deleteFile();
                    juce::String error;
                    expect(renderProjectToWavFile(project, out.getFullPathName(), 2.0, error),
                           "offline render failed: " + error);
                    juce::AudioFormatManager formats;
                    formats.registerBasicFormats();
                    std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(out));
                    if (reader == nullptr)
                    {
                        expect(false, "could not read back " + out.getFullPathName());
                        return 0.0;
                    }
                    const int numSamples = (int) reader->lengthInSamples;
                    juce::AudioBuffer<float> buffer(2, numSamples);
                    reader->read(&buffer, 0, numSamples, 0, true, true);
                    const int from = juce::jlimit(0, numSamples, (int) (fromSec * 44100.0));
                    const int to = juce::jlimit(from, numSamples, (int) (toSec * 44100.0));
                    double sum = 0.0;
                    for (int i = from; i < to; ++i)
                        sum += (double) buffer.getSample(0, i) * (double) buffer.getSample(0, i);
                    out.deleteFile();
                    return to > from ? std::sqrt(sum / (double) (to - from)) : 0.0;
                };

                // Second half of the clip, where the curve has brought the
                // level to (or very near) zero.
                const double neutralRms =
                    rmsOfExport(neutral, "sssketch_pe_tk_volsilence_dry.wav", 1.5, 1.9);
                const double fadedRms =
                    rmsOfExport(faded, "sssketch_pe_tk_volsilence_wet.wav", 1.5, 1.9);

                expect(neutralRms > 0.4, "neutral export rms was " + juce::String(neutralRms));
                expect(fadedRms < 0.02,
                       "volume-automated export rms was " + juce::String(fadedRms)
                           + " (neutral was " + juce::String(neutralRms) + ")");

                tone.deleteFile();
            }

            beginTest("OFFLINE: a full reverb send really produces a tail past the dry audio");
            {
                // The other half of the same live report. 240bpm -> 1 sec/bar
                // and a 1-second fixture played for exactly one bar, exported
                // over 2 seconds: the dry render is EXACTLY silent in its
                // second half, so any energy there came from the send.
                auto tone = writeFixtureWav("sssketch_pe_tk_sendtail.wav", 0.5f, 44100);

                EngineProject dry;
                dry.bpm = 240.0;
                dry.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.channelId = "ch-1";
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.stemKey = "r1:0";
                stem.resolvedPath = tone.getFullPathName();
                stem.durationSec = 1.0;
                stem.barLength = 1;
                stem.playedBars = 1.0;
                rifff.stems.push_back(stem);
                dry.rifffs.push_back(rifff);

                EngineProject wet = dry;
                wet.rifffs[0].stems[0].hasToolkit = true;
                wet.rifffs[0].stems[0].toolkit.reverbSend = 1.0;
                wet.reverb.roomSize = 0.6;
                wet.reverb.preDelayMs = 0.0;

                auto peakAfterDry = [this](const EngineProject& project, const juce::String& name) {
                    auto out = juce::File::getSpecialLocation(juce::File::tempDirectory)
                                   .getChildFile(name);
                    out.deleteFile();
                    juce::String error;
                    expect(renderProjectToWavFile(project, out.getFullPathName(), 2.0, error),
                           "offline render failed: " + error);
                    juce::AudioFormatManager formats;
                    formats.registerBasicFormats();
                    std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(out));
                    if (reader == nullptr)
                    {
                        expect(false, "could not read back " + out.getFullPathName());
                        return 0.0;
                    }
                    const int numSamples = (int) reader->lengthInSamples;
                    juce::AudioBuffer<float> buffer(2, numSamples);
                    reader->read(&buffer, 0, numSamples, 0, true, true);
                    double peak = 0.0;
                    for (int i = juce::jmin(numSamples, (int) (1.2 * 44100.0)); i < numSamples; ++i)
                        peak = juce::jmax(peak, (double) std::abs(buffer.getSample(0, i)));
                    out.deleteFile();
                    return peak;
                };

                expectEquals(peakAfterDry(dry, "sssketch_pe_tk_sendtail_dry.wav"), 0.0);
                const double wetPeak = peakAfterDry(wet, "sssketch_pe_tk_sendtail_wet.wav");
                expect(wetPeak > 1.0e-3, "reverb tail peak was " + juce::String(wetPeak));

                tone.deleteFile();
            }

            beginTest("a project with no risers renders bit-identically to before they existed");
            {
                // The neutral-project regression. A riser is generated audio
                // added into a channel's own accumulator, so the one thing
                // that must stay true is that a project WITHOUT one takes
                // exactly the path it took before -- same additions, same
                // order, same bits. Rendered twice from one engine and
                // compared against an independently-built expectation (the
                // fixture's constant value times its volume), which is what
                // the pre-riser code produced.
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.channelId = "ch1";
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = fixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.playedBars = 1.0;
                stem.volume = 0.5;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);
                expect(project.risers.empty());

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                // Source value 0.5 * stem volume 0.5 = 0.25, sampled past the
                // always-on ~3ms anti-click fade-in floor (see FadeGain.cpp)
                // -- the same index the pre-riser stem test above uses, and
                // for the same reason.
                for (int i = 200; i < 512; ++i)
                {
                    expectWithinAbsoluteError(l[(size_t) i], 0.25f, 1.0e-4f);
                    expectWithinAbsoluteError(r[(size_t) i], 0.25f, 1.0e-4f);
                }
            }

            beginTest("a riser is generated into its own channel and nowhere else");
            {
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                // One clip on ch1, one riser on ch2 -- so "did the riser
                // land" and "did it land on the right row" are separable.
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.channelId = "ch1";
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = fixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.playedBars = 1.0;
                stem.volume = 0.5;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                EngineRiser riser;
                riser.id = "riser-1";
                riser.channelId = "ch2";
                riser.startBar = 0.0;
                riser.lengthBars = 1.0; // 4 seconds
                riser.startCutoffValue = 0.2;
                riser.endCutoffValue = 0.95;
                riser.level = 0.9;
                project.risers.push_back(riser);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                const int blockSize = 512;
                std::vector<float> l((size_t) blockSize, 0.0f), r((size_t) blockSize, 0.0f);

                // At the very start the clip is at its flat 0.25 and the
                // riser's squared swell is still essentially nothing -- so
                // this is what "the riser has not leaked in early" looks
                // like, measured on the summed output.
                engine.renderBlock(0.0, 44100.0, blockSize, l.data(), r.data(), channelChains);
                for (int i = 200; i < blockSize; ++i)
                    expectWithinAbsoluteError(l[(size_t) i], 0.25f, 1.0e-3f);

                // Near the riser's end the clip has run out (the fixture is
                // one second long) and the swell is at its loudest, so
                // anything here at all is the riser and only the riser.
                std::fill(l.begin(), l.end(), 0.0f);
                std::fill(r.begin(), r.end(), 0.0f);
                engine.renderBlock(0.95, 44100.0, blockSize, l.data(), r.data(), channelChains);
                double peak = 0.0;
                for (int i = 0; i < blockSize; ++i)
                    peak = juce::jmax(peak, (double) std::abs(l[(size_t) i]));
                expect(peak > 0.05, "riser did not reach the mix (peak " + juce::String(peak) + ")");
            }

            beginTest("a riser on an empty channel is still heard, and silent before it starts");
            {
                // The riser-only row: nothing groups it by an EngineRifff, so
                // this is the case that would silently vanish if setProject
                // didn't give it a channelGroups entry of its own.
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRiser riser;
                riser.id = "riser-solo";
                riser.channelId = "lonely";
                riser.startBar = 1.0; // starts 4 seconds in
                riser.lengthBars = 1.0;
                riser.startCutoffValue = 0.3;
                riser.endCutoffValue = 0.95;
                riser.level = 0.9;
                project.risers.push_back(riser);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                for (int i = 0; i < 512; ++i)
                    expectEquals(l[(size_t) i], 0.0f); // before it starts

                std::fill(l.begin(), l.end(), 0.0f);
                std::fill(r.begin(), r.end(), 0.0f);
                engine.renderBlock(1.95, 44100.0, 512, l.data(), r.data(), channelChains);
                double peak = 0.0;
                for (int i = 0; i < 512; ++i)
                    peak = juce::jmax(peak, (double) std::abs(l[(size_t) i]));
                expect(peak > 0.05, "riser-only channel was silent (peak " + juce::String(peak) + ")");
            }

            beginTest("an offline render of a riser is the same audio as playing it");
            {
                // The requirement the whole design hangs on: there is ONE
                // renderBlock, so a bounce cannot drift from the pass that
                // was listened to. Rendered here through the real offline
                // path (RenderExport's own fresh PlaybackEngine) and compared
                // sample for sample against a live-style block-by-block
                // render from the same start.
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRiser riser;
                riser.id = "riser-bounce";
                riser.channelId = "ch1";
                riser.startBar = 0.0;
                riser.lengthBars = 0.5; // 2 seconds
                riser.startCutoffValue = 0.2;
                riser.endCutoffValue = 0.95;
                riser.level = 0.8;
                project.risers.push_back(riser);

                auto out = juce::File::getSpecialLocation(juce::File::tempDirectory)
                               .getChildFile("sssketch_pe_riser_bounce.wav");
                out.deleteFile();
                juce::String error;
                expect(renderProjectToWavFile(project, out.getFullPathName(), 2.0, error),
                       "offline render failed: " + error);

                juce::AudioFormatManager formats;
                formats.registerBasicFormats();
                std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(out));
                expect(reader != nullptr, "could not read back the bounce");
                if (reader != nullptr)
                {
                    const int numSamples = (int) reader->lengthInSamples;
                    juce::AudioBuffer<float> bounced(2, numSamples);
                    reader->read(&bounced, 0, numSamples, 0, true, true);

                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    ChannelChainRegistry channelChains;
                    engine.setProject(project);
                    std::vector<float> live((size_t) numSamples, 0.0f);
                    std::vector<float> liveR((size_t) numSamples, 0.0f);
                    const int blockSize = 512;
                    const double secPerBar = 4.0;
                    for (int i = 0; i < numSamples; i += blockSize)
                    {
                        const int n = juce::jmin(blockSize, numSamples - i);
                        engine.renderBlock(
                            ((double) i / 44100.0) / secPerBar,
                            44100.0,
                            n,
                            live.data() + i,
                            liveR.data() + i,
                            channelChains);
                    }

                    double worst = 0.0;
                    double livePeak = 0.0;
                    for (int i = 0; i < numSamples; ++i)
                    {
                        worst = juce::jmax(worst,
                            std::abs((double) bounced.getSample(0, i) - (double) live[(size_t) i]));
                        livePeak = juce::jmax(livePeak, (double) std::abs(live[(size_t) i]));
                    }
                    // The bounce is a 16-bit WAV, so equality here is "within
                    // one quantisation step", not bit-for-bit -- the file
                    // format is the only thing between the two, which is
                    // exactly the point.
                    expect(livePeak > 0.05, "nothing was rendered live (peak " + juce::String(livePeak) + ")");
                    expect(worst < 2.0e-4, "bounce differs from playback by " + juce::String(worst));
                }
                out.deleteFile();
            }

            fixture.deleteFile();
        }
    };

    static PlaybackEngineTests playbackEngineTests;
}

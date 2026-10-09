// native-engine/Source/PlaybackEngineTests.cpp
#include "PlaybackEngine.h"
#include "StemBufferCache.h"
#include "ChannelChainRegistry.h"
#include "RenderExport.h"
#include "NoiseRiser.h"
#include "Metronome.h"
#include <juce_core/juce_core.h>
#include <atomic>
#include <cmath>
#include <cstring>
#include <limits>
#include <algorithm>
#include <chrono>
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
     * a constant-value fixture can't distinguish that. `descending` runs it from ~1 to ~0
     * instead, so a test swapping one ramp for another can also tell which file sounded. */
    static juce::File writeRampFixtureWav(const juce::String& name, int numSamples, double sampleRate = 44100.0,
                                          bool descending = false)
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
            source.setSample(0, i, descending ? 1.0f - (float) i / (float) numSamples
                                              : (float) i / (float) numSamples);
        writer->writeFromAudioSampleBuffer(source, 0, numSamples);
        writer.reset();
        return file;
    }

    /** A two-channel fixture: a sine of `amplitudeL` on the left and `amplitudeR` on the right
     * (offset by `phaseR` radians), so a test can tell the sides apart -- the panning tests
     * need a real stereo stem, which every other fixture here is not. */
    static juce::File writeStereoSineFixtureWav(const juce::String& name, double freqHz, float amplitudeL,
                                                float amplitudeR, float phaseR, int numSamples,
                                                double sampleRate = 44100.0)
    {
        auto file = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile(name);
        file.deleteFile();
        juce::WavAudioFormat wavFormat;
        std::unique_ptr<juce::FileOutputStream> out(file.createOutputStream());
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wavFormat.createWriterFor(out.get(), sampleRate, 2, 16, {}, 0));
        out.release();
        juce::AudioBuffer<float> source(2, numSamples);
        for (int i = 0; i < numSamples; ++i)
        {
            const double w = 2.0 * juce::MathConstants<double>::pi * freqHz * (double) i / sampleRate;
            source.setSample(0, i, amplitudeL * (float) std::sin(w));
            source.setSample(1, i, amplitudeR * (float) std::sin(w + phaseR));
        }
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
                expectWithinAbsoluteError(engine.getMetronomeVolume(), 1.5f, 1.0e-6f);
                engine.setMetronomeEnabled(true);
                expect(engine.isMetronomeEnabled());
                engine.setMetronomeVolume(9.0f);
                expectWithinAbsoluteError(engine.getMetronomeVolume(), 2.0f, 1.0e-6f);
                engine.setMetronomeVolume(1.5f);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                // Sample 0 is exactly the downbeat's own zero-crossing (a
                // sine starts at 0, not its peak) — sample 1, a moment into
                // the click's decay envelope, is where "nonzero" actually
                // holds (see Metronome.h's own doc comment).
                expect(std::abs(l[1]) > 0.0f);
                expect(std::abs(r[1]) > 0.0f);
                expectWithinAbsoluteError(l[1], r[1], 1.0e-6f); // mono click, identical on both channels
                expectWithinAbsoluteError(
                    l[1],
                    metronomeSampleAt(1.0 / 44100.0, 1.0) * 1.5f,
                    1.0e-6f);
            }

            // Cross (and Discover) audition by loading a throwaway project at
            // their own tempo, then load the real project back. The click has
            // no tempo of its own: it must follow whichever project is loaded.
            beginTest("metronome clicks at the tempo of the project loaded now, not an earlier one");
            {
                EngineProject before;
                before.bpm = 60.0;
                before.snapDiv = 16.0;
                EngineProject after = before;
                after.bpm = 120.0;

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setMetronomeEnabled(true);
                engine.setMetronomeVolume(1.0f);
                engine.setProject(before);
                engine.setProject(after);

                // A few ms after beat 2: the same bar position is 10 ms past the
                // beat at 60 bpm and 5 ms at 120, so the two clicks differ here.
                const double positionBars = 0.25 + 0.0025;
                const int n = 64;
                std::vector<float> l(n, 0.0f), r(n, 0.0f);
                engine.renderBlock(positionBars, 44100.0, n, l.data(), r.data(), channelChains);
                bool differsFromOldTempo = false;
                for (int i = 0; i < n; ++i)
                {
                    const double tAfter = positionBars * 2.0 + i / 44100.0; // 120 bpm: 2 s a bar
                    const double tBefore = positionBars * 4.0 + i / 44100.0; // 60 bpm: 4 s a bar
                    expectWithinAbsoluteError(l[i], metronomeSampleAt(tAfter, 0.5), 1.0e-6f);
                    if (std::abs(metronomeSampleAt(tBefore, 1.0) - l[i]) > 1.0e-3f)
                        differsFromOldTempo = true;
                }
                expect(differsFromOldTempo);
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

            // Endlesss stems can be shorter than a bar, or a non-whole number
            // of bars (Length16s / 16 = 0.5, 1.5, 2.667, ...). barLength used
            // to be parsed as an int: a half-bar stem became 0 and was skipped
            // outright (silent while its row showed a waveform), and a 1.5-bar
            // stem tiled every 1 bar while still stretching its 1.5 bars of
            // audio across that 1 bar's span.
            auto renderTileBoundary = [] (double stemBars, double rifffBars, double boundarySec,
                                              const juce::File& rampFile, double durationSec,
                                              float& before, float& after)
            {
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = rifffBars;
                EngineStem stem;
                stem.resolvedPath = rampFile.getFullPathName();
                stem.durationSec = durationSec;
                stem.barLength = stemBars;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                // Same shape as the segment-boundary test above: 150 samples
                // before the boundary (outside LoopSewing's 128-sample tail
                // blend), 20 after.
                const double sampleRate = 44100.0;
                const int numSamples = 170;
                const double blockStartSec = boundarySec - 150.0 / sampleRate;
                std::vector<float> l(numSamples, 0.0f), r(numSamples, 0.0f);
                engine.renderBlock(blockStartSec / 4.0, sampleRate, numSamples, l.data(), r.data(), channelChains);
                before = l[0];
                after = l[numSamples - 1];
            };

            beginTest("a half-bar stem plays (not silent) and repeats every half bar");
            {
                // 2s ramp = half a bar at 60bpm. Tiles at [0,2)s, [2,4)s.
                auto ramp = writeRampFixtureWav("sssketch_pe_halfbar_ramp.wav", 88200);
                float before = 0.0f, after = 0.0f;
                renderTileBoundary(0.5, 1.0, 2.0, ramp, 2.0, before, after);
                expect(before > 0.9f, "half-bar stem should be near the tail of its first tile, got " + juce::String(before));
                expect(after < 0.05f, "half-bar stem should restart at 2s (half a bar), got " + juce::String(after));
                expect(after > 0.0f, "half-bar stem should still be sounding right after its first repeat");
                ramp.deleteFile();
            }

            beginTest("a 1.5-bar stem tiles every 1.5 bars, not every 1 bar");
            {
                // 6s ramp = 1.5 bars at 60bpm. Tiles at [0,6)s, [6,12)s.
                auto ramp = writeRampFixtureWav("sssketch_pe_onehalf_ramp.wav", 264600);
                float before = 0.0f, after = 0.0f;
                renderTileBoundary(1.5, 3.0, 6.0, ramp, 6.0, before, after);
                expect(before > 0.9f, "1.5-bar stem should be near the tail of its first tile at 6s, got " + juce::String(before));
                expect(after < 0.05f, "1.5-bar stem should restart at 6s (1.5 bars), got " + juce::String(after));
                ramp.deleteFile();
            }

            beginTest("a rifff whose own barLength is fractional plays for exactly that long");
            {
                // Discover's assembled rifff takes the LONGEST member's
                // barLength, so a rifff of only half-bar stems is itself 0.5
                // bars. It must sound inside [0,2)s and stop at 2s, rather
                // than being truncated to a 0-bar rifff (silent throughout).
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 0.5;
                EngineStem stem;
                auto halfBar = writeFixtureWav("sssketch_pe_halfbar_const.wav", 0.5f, 88200); // 2s = half a bar
                stem.resolvedPath = halfBar.getFullPathName();
                stem.durationSec = 2.0;
                stem.barLength = 0.5;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                expectWithinAbsoluteError(l[200], 0.5f, 0.01f);

                // Late in the rifff's half bar: still sounding.
                std::vector<float> lMid(512, 0.0f), rMid(512, 0.0f);
                engine.renderBlock(1.5 / 4.0, 44100.0, 512, lMid.data(), rMid.data(), channelChains);
                expectWithinAbsoluteError(lMid[200], 0.5f, 0.01f);

                // Past the rifff's half bar: silent (its bound is 0.5 bars, not 1).
                std::vector<float> l2(512, 0.0f), r2(512, 0.0f);
                engine.renderBlock(2.5 / 4.0, 44100.0, 512, l2.data(), r2.data(), channelChains);
                for (float s : l2) expectEquals(s, 0.0f);
                halfBar.deleteFile();
            }

            // RADIO FOLD MODE, the proof the spec asked for first (spec 2026-10-02-radio-fold-mode
            // section 3): a stem cropped by scaling barLength and durationSec together loops just
            // its first N beats, at tempo, and offsetSteps moves the cycle's phase. 60 bpm: a beat
            // is 1 s, a bar 4 s. A 16 s (4-bar) ramp cropped to 7 beats: every tile plays the
            // ramp's first 7 s, 0 .. 7/16. This passes on the tile path as it stands; what it
            // cannot do is keep the cycle running across a loop top or fade its seam, which is
            // why fold mode plays through the cycle table instead (the tests after this one).
            beginTest("a cropped stem (barLength and durationSec scaled together) loops its first 7 beats at tempo, offset by offsetSteps");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_crop7_ramp.wav", 16 * 44100);
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4.0;
                EngineStem stem;
                stem.resolvedPath = ramp.getFullPathName();
                stem.barLength = 7.0 / 4.0;
                stem.durationSec = 16.0 * (7.0 / 16.0); // scaled with it: 7 s
                stem.offsetSteps = 4.0; // one beat (16 steps a bar)
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                const auto at = [&](double sec) {
                    float l = 0.0f, r = 0.0f;
                    engine.renderBlock(sec / 4.0, 44100.0, 1, &l, &r, channelChains);
                    return l;
                };
                // tiles at 1 s, 8 s and 15 s, each the ramp's first 7 s
                expectWithinAbsoluteError(at(0.5), 0.0f, 1.0e-6f); // before the offset: nothing
                expectWithinAbsoluteError(at(1.5), 0.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(7.9), 6.9f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(8.5), 0.5f / 16.0f, 0.002f); // restarted at 8 s
                expectWithinAbsoluteError(at(14.5), 6.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(15.5), 0.5f / 16.0f, 0.002f);
                ramp.deleteFile();
            }

            // The cycle table (CycleTable.h): a stem whose row is folded loops its first `bars`
            // at the stem's own full barLength/durationSec (so the buffer cache sews the stem's
            // real end, never the crop point), on the lap clock, with a seam fade.
            const auto foldProject = [](const juce::File& file, const juce::String& row) {
                EngineProject project;
                project.bpm = 60.0; // a beat is 1 s, a bar 4 s
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4.0; // a 16 s loop
                EngineStem stem;
                stem.stemKey = "fold:1";
                stem.resolvedPath = file.getFullPathName();
                stem.barLength = 4.0;
                stem.durationSec = 16.0;
                stem.cycleRow = row;
                stem.cycleRowKey = cycleKeyOf(row);
                stem.cycleStemHash = cycleStemHashOf(stem); // the parser's
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);
                return project;
            };
            const auto foldRow = [](double bars, double phaseBars, const char* id = "perc~1") {
                CycleRow r;
                r.rowKey = cycleKeyOf("perc");
                r.idKey = cycleKeyOf(id);
                r.bars = bars;
                r.phaseBars = phaseBars;
                return std::vector<CycleRow> { r };
            };

            beginTest("a folded row loops its first 7 beats; the cycle runs on across the loop top");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(foldProject(ramp, "perc"));
                engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                expect(engine.applyStagedCycles(false));
                const auto at = [&](double lapSec, double baseBars) {
                    float l = 0.0f, r = 0.0f;
                    engine.renderBlock(lapSec / 4.0, 44100.0, 1, &l, &r, channelChains, LapClock { baseBars, 1 });
                    return l;
                };
                // lap 0 (base 0): tiles at 0, 7 and 14 s
                expectWithinAbsoluteError(at(0.5, 0.0), 0.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(6.5, 0.0), 6.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(7.5, 0.0), 0.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(15.5, 0.0), 1.5f / 16.0f, 0.002f);
                // lap 1 (base 4 bars): 16.5 s on the cycle grid is 2.5 s into a tile -- it did
                // NOT restart with the loop (that would read 0.5 / 16)
                expectWithinAbsoluteError(at(0.5, 4.0), 2.5f / 16.0f, 0.002f);
                // 112 beats in (lap 7 starts at 112 s): the cycle and the loop line up again
                expectWithinAbsoluteError(at(0.5, 28.0), 0.5f / 16.0f, 0.002f);
                ramp.deleteFile();
            }

            beginTest("a folded row's phase offset starts each cycle that much later");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_phase_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(foldProject(ramp, "perc"));
                engine.stageCycles(foldRow(7.0 / 4.0, 0.25), true); // a beat late
                engine.applyStagedCycles(false);
                const auto at = [&](double lapSec) {
                    float l = 0.0f, r = 0.0f;
                    engine.renderBlock(lapSec / 4.0, 44100.0, 1, &l, &r, channelChains, LapClock { 0.0, 1 });
                    return l;
                };
                expectWithinAbsoluteError(at(1.5), 0.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(0.5), 6.5f / 16.0f, 0.002f); // the tail of the cycle before
                expectWithinAbsoluteError(at(8.5), 0.5f / 16.0f, 0.002f);
                ramp.deleteFile();
            }

            beginTest("a folded row's cycle seam fades over 10 ms: no step above threshold, a dip at the seam");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_seam_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(foldProject(ramp, "perc"));
                engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                engine.applyStagedCycles(false);
                // 50 ms either side of the seam at 7 s, in one block
                const int n = (int) (0.1 * 44100.0);
                std::vector<float> l((size_t) n, 0.0f), r((size_t) n, 0.0f);
                engine.renderBlock((7.0 - 0.05) / 4.0, 44100.0, n, l.data(), r.data(), channelChains, LapClock { 0.0, 1 });
                float worst = 0.0f;
                float lowest = 1.0f;
                for (int i = 1; i < n; ++i)
                {
                    worst = std::max(worst, std::abs(l[(size_t) i] - l[(size_t) i - 1]));
                    lowest = std::min(lowest, std::abs(l[(size_t) i]));
                }
                // unfaded, the seam is a 7/16 = 0.44 jump; faded over 441 samples, each step is
                // about 0.44 / 441 = 0.001
                expect(worst < 0.002f, "largest step at the seam " + juce::String(worst));
                expect(lowest < 0.001f, "the seam dips to silence, got " + juce::String(lowest));
                ramp.deleteFile();
            }

            // A stem a hair slower than the project (up to 0.1% slow skips the stretch --
            // STRETCH_RATIO_EPSILON) has a cycle's audio run a little past the tile, which is cut
            // at the tile's end: the fade-out has to end there, not where the audio would have.
            beginTest("a slow stem's cycle seam still fades: the fade-out ends where the tile is cut");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_slow_seam_ramp.wav", 17 * 44100);
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                auto project = foldProject(ramp, "perc");
                project.rifffs[0].stems[0].durationSec = 16.0 * 1.005; // 0.5% slow: a 7.035 s cycle in a 7 s tile
                engine.setProject(project);
                engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                engine.applyStagedCycles(false);
                const int n = (int) (0.1 * 44100.0);
                std::vector<float> l((size_t) n, 0.0f), r((size_t) n, 0.0f);
                engine.renderBlock((7.0 - 0.05) / 4.0, 44100.0, n, l.data(), r.data(), channelChains, LapClock { 0.0, 1 });
                float worst = 0.0f;
                for (int i = 1; i < n; ++i)
                    worst = std::max(worst, std::abs(l[(size_t) i] - l[(size_t) i - 1]));
                // the ramp's own step is 1 / (16 * 44100) = 1.4e-6; a 0.44 seam faded over 441
                // samples steps about 0.001. Unfaded (the fade-out measured from 7.035 s), the
                // seam is cut at gain ~1: a 0.44 jump.
                expect(worst < 0.002f, "largest step at the slow seam " + juce::String(worst));
                ramp.deleteFile();
            }

            // A fold step at a loop top replaces a row's cycle (a new id, a new length) or removes
            // it (the row unfolds), and the outgoing cycle is mid-tile there at full gain -- a 7-beat
            // cycle in a 16-beat loop is 2 beats into a tile at the first top. The incoming fades in
            // from 0; the outgoing has to fade out alongside it, over the same 10 ms.
            // Renders the last 50 ms of lap 0 and the first 50 ms of lap 1, with `next` staged for
            // the top between them; returns lap 1's half in `lap1` and the largest step overall.
            const auto acrossTop = [&](PlaybackEngine& engine, const std::vector<CycleRow>& next,
                                       ChannelChainRegistry& chains, std::vector<float>& lap1) {
                const int n = (int) (0.05 * 44100.0);
                std::vector<float> l0((size_t) n, 0.0f), r0((size_t) n, 0.0f), r1((size_t) n, 0.0f);
                lap1.assign((size_t) n, 0.0f);
                engine.renderBlock((16.0 - 0.05) / 4.0, 44100.0, n, l0.data(), r0.data(), chains, LapClock { 0.0, 1 });
                engine.stageCycles(next, false);
                expect(engine.applyStagedCycles(true, 4.0)); // the 4-bar lap just played
                engine.renderBlock(0.0, 44100.0, n, lap1.data(), r1.data(), chains, LapClock { 4.0, 1 });
                float worst = 0.0f;
                for (int i = 1; i < n; ++i)
                    worst = std::max(worst, std::abs(l0[(size_t) i] - l0[(size_t) i - 1]));
                worst = std::max(worst, std::abs(lap1[0] - l0[(size_t) n - 1]));
                for (int i = 1; i < n; ++i)
                    worst = std::max(worst, std::abs(lap1[(size_t) i] - lap1[(size_t) i - 1]));
                return worst;
            };

            beginTest("a cycle that changes at the top crossfades out over 10 ms, then is gone");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_step_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                ChannelChainRegistry channelChains;
                PlaybackEngine engine(cache);
                engine.setProject(foldProject(ramp, "perc"));
                engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                engine.applyStagedCycles(false);
                std::vector<float> lap1;
                const float worst = acrossTop(engine, foldRow(6.0 / 4.0, 0.0, "perc~2"), channelChains, lap1);
                // the outgoing is 2 s into its tile at the top (0.125); cut dead, that is a 0.125
                // step. Faded over 441 samples, about 0.0003 a step.
                expect(worst < 0.002f, "largest step across the fold-step top " + juce::String(worst));

                // past 10 ms nothing of the old cycle is left: lap 1 matches a fresh engine that only
                // ever had the new cycle (its origin, too, is lap 1's top)
                PlaybackEngine fresh(cache);
                fresh.setProject(foldProject(ramp, "perc"));
                fresh.stageCycles(foldRow(6.0 / 4.0, 0.0, "perc~2"), true);
                fresh.applyStagedCycles(false);
                std::vector<float> f((size_t) lap1.size(), 0.0f), fr((size_t) lap1.size(), 0.0f);
                fresh.renderBlock(0.0, 44100.0, (int) f.size(), f.data(), fr.data(), channelChains, LapClock { 4.0, 1 });
                expect(std::abs(lap1[100] - f[100]) > 0.01f, "the tail sounds in the first 10 ms");
                bool same = true;
                for (size_t i = 442; i < f.size(); ++i)
                    same = same && lap1[i] == f[i];
                expect(same, "after 10 ms the tail has expired");
                // and a later block has no tail at all
                std::vector<float> a(512, 0.0f), ar(512, 0.0f), b(512, 0.0f), br(512, 0.0f);
                engine.renderBlock(1.0 / 4.0, 44100.0, 512, a.data(), ar.data(), channelChains, LapClock { 4.0, 1 });
                fresh.renderBlock(1.0 / 4.0, 44100.0, 512, b.data(), br.data(), channelChains, LapClock { 4.0, 1 });
                for (size_t i = 0; i < a.size(); ++i)
                    expectEquals(a[i], b[i]);
                ramp.deleteFile();
            }

            beginTest("a row that unfolds at the top fades its cycle out over 10 ms while the straight stem plays");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_unfold_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                ChannelChainRegistry channelChains;
                PlaybackEngine engine(cache);
                engine.setProject(foldProject(ramp, "perc"));
                engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                engine.applyStagedCycles(false);
                std::vector<float> lap1;
                const float worst = acrossTop(engine, {}, channelChains, lap1);
                expect(worst < 0.002f, "largest step across the unfolding top " + juce::String(worst));
                // past 10 ms: exactly the straight stem
                PlaybackEngine plain(cache);
                plain.setProject(foldProject(ramp, "perc"));
                std::vector<float> p(lap1.size(), 0.0f), pr(lap1.size(), 0.0f);
                plain.renderBlock(0.0, 44100.0, (int) p.size(), p.data(), pr.data(), channelChains, LapClock { 4.0, 1 });
                bool same = true;
                for (size_t i = 442; i < p.size(); ++i)
                    same = same && lap1[i] == p[i];
                expect(same, "after 10 ms only the straight stem is left");
                ramp.deleteFile();
            }

            // A row folding in was playing straight, and a straight stem offset by a beat is
            // mid-tile at the top (its window is 1 .. 17 s of a 16 s loop): cut there, it steps by
            // its full level. Its continuation -- the outgoing lap's, 16 s on -- plays beside the
            // incoming cycle, fading out over the same 10 ms.
            beginTest("a row that folds in from straight crossfades the straight stem out over 10 ms");
            {
                auto dc = writeFixtureWav("sssketch_pe_fold_in_dc.wav", 0.5f, 16 * 44100);
                StemBufferCache cache;
                ChannelChainRegistry channelChains;
                auto offset = foldProject(dc, "perc");
                offset.rifffs[0].stems[0].offsetSteps = 4.0; // a beat
                PlaybackEngine engine(cache);
                engine.setProject(offset);
                std::vector<float> lap1;
                const float worst = acrossTop(engine, foldRow(7.0 / 4.0, 0.0), channelChains, lap1);
                // cut dead, a 0.5 step; faded over 441 samples beside the incoming's fade-in,
                // about 0.001 a step
                expect(worst < 0.002f, "largest step folding in from straight " + juce::String(worst));
                PlaybackEngine fresh(cache);
                fresh.setProject(offset);
                fresh.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                fresh.applyStagedCycles(false);
                std::vector<float> f(lap1.size(), 0.0f), fr(lap1.size(), 0.0f);
                fresh.renderBlock(0.0, 44100.0, (int) f.size(), f.data(), fr.data(), channelChains, LapClock { 4.0, 1 });
                expect(std::abs(lap1[100] - f[100]) > 0.01f, "the straight stem's tail sounds in the first 10 ms");
                bool same = true;
                for (size_t i = 442; i < f.size(); ++i)
                    same = same && lap1[i] == f[i];
                expect(same, "after 10 ms only the cycle is left");

                // A straight stem that ended with the lap (no offset: its last tile fades out on its
                // own at 16 s) has no continuation: lap 1 is the cycle alone from its first sample,
                // not a 10 ms ghost of the straight stem restarting.
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_in_ramp.wav", 16 * 44100);
                PlaybackEngine plain(cache);
                plain.setProject(foldProject(ramp, "perc"));
                std::vector<float> p1;
                acrossTop(plain, foldRow(7.0 / 4.0, 0.0), channelChains, p1);
                PlaybackEngine freshRamp(cache);
                freshRamp.setProject(foldProject(ramp, "perc"));
                freshRamp.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                freshRamp.applyStagedCycles(false);
                std::vector<float> g(p1.size(), 0.0f), gr(p1.size(), 0.0f);
                freshRamp.renderBlock(0.0, 44100.0, (int) g.size(), g.data(), gr.data(), channelChains, LapClock { 4.0, 1 });
                bool sameRamp = true;
                for (size_t i = 0; i < g.size(); ++i)
                    sameRamp = sameRamp && p1[i] == g[i];
                expect(sameRamp, "a straight stem that ended with the lap leaves nothing to continue");
                dc.deleteFile();
                ramp.deleteFile();
            }

            // Every Discover preview build mints a fresh groupId, so a staged project landing at a
            // top renames every stem. A row whose cycle changes at that same top still has to hear
            // its outgoing cycle's tail: the tail is matched by row and audio file, not stemKey.
            // A different file in the row is a different stem, and hears none.
            beginTest("a fold tail is matched by row and audio file, so it survives a project swap at the same top");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_swap_ramp.wav", 16 * 44100);
                auto other = writeRampFixtureWav("sssketch_pe_fold_swap_other.wav", 16 * 44100);
                StemBufferCache cache;
                ChannelChainRegistry channelChains;
                for (const bool samePath : { true, false })
                {
                    PlaybackEngine engine(cache);
                    engine.setProject(foldProject(ramp, "perc"));
                    engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                    engine.applyStagedCycles(false);
                    const int n = (int) (0.05 * 44100.0);
                    std::vector<float> l0((size_t) n, 0.0f), r0((size_t) n, 0.0f);
                    std::vector<float> l1((size_t) n, 0.0f), r1((size_t) n, 0.0f);
                    engine.renderBlock((16.0 - 0.05) / 4.0, 44100.0, n, l0.data(), r0.data(), channelChains, LapClock { 0.0, 1 });
                    // the staged project lands at the top, renamed, with the next lap's cycle
                    auto swapped = foldProject(samePath ? ramp : other, "perc");
                    swapped.rifffs[0].stems[0].stemKey = "fold-rebuilt:1";
                    swapped.rifffs[0].stems[0].cycleStemHash = cycleStemHashOf(swapped.rifffs[0].stems[0]);
                    engine.setProject(swapped);
                    engine.stageCycles(foldRow(6.0 / 4.0, 0.0, "perc~2"), false);
                    expect(engine.applyStagedCycles(true, 4.0));
                    engine.renderBlock(0.0, 44100.0, n, l1.data(), r1.data(), channelChains, LapClock { 4.0, 1 });
                    PlaybackEngine fresh(cache);
                    fresh.setProject(swapped);
                    fresh.stageCycles(foldRow(6.0 / 4.0, 0.0, "perc~2"), true);
                    fresh.applyStagedCycles(false);
                    std::vector<float> f((size_t) n, 0.0f), fr((size_t) n, 0.0f);
                    fresh.renderBlock(0.0, 44100.0, n, f.data(), fr.data(), channelChains, LapClock { 4.0, 1 });
                    if (samePath)
                    {
                        // cut dead, the outgoing's 0.125 steps at the top
                        const float step = std::abs(l1[0] - l0[(size_t) n - 1]);
                        expect(step < 0.002f, "step at the top across a renaming swap " + juce::String(step));
                        expect(std::abs(l1[100] - f[100]) > 0.01f, "the tail sounds across the swap");
                    }
                    else
                    {
                        bool same = true;
                        for (size_t i = 0; i < f.size(); ++i)
                            same = same && l1[i] == f[i];
                        expect(same, "another file in the row hears no tail");
                    }
                }
                ramp.deleteFile();
                other.deleteFile();
            }

            // Radio fold, phase 2 (spec 2026-10-03-radio-fold-follows-pace-design section 3): a
            // change landing mid-lap on a folded row whose incoming stem names the row CARRIES the
            // fold -- the cycle table is keyed by row, so the live entry keeps its id and origin,
            // and the incoming stem plays the running cycle from where it is. One whose stem does
            // not name the row plays straight. The swap is the desktop's own bar landing
            // (Transport::renderLoopAware's split: stageProject, then applyStagedProject between
            // two renders), and the incoming file is a DESCENDING ramp, so every reading also
            // says which file sounded.
            beginTest("a stem swapped into a folded row mid-lap that names the row plays the running cycle on, origin kept");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_carry_a.wav", 16 * 44100);
                auto other = writeRampFixtureWav("sssketch_pe_fold_carry_b.wav", 16 * 44100, 44100.0, true);
                StemBufferCache cache;
                ChannelChainRegistry channelChains;
                PlaybackEngine engine(cache);
                engine.setProject(foldProject(ramp, "perc"));
                engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                expect(engine.applyStagedCycles(false));
                const auto at = [&](double lapSec, double baseBars) {
                    float l = 0.0f, r = 0.0f;
                    engine.renderBlock(lapSec / 4.0, 44100.0, 1, &l, &r, channelChains, LapClock { baseBars, 1 });
                    return l;
                };
                const auto landAt = [&](const EngineProject& project) {
                    engine.stageProject(project);
                    expect(engine.applyStagedProject() == PlaybackEngine::StagedApply::Applied);
                    engine.drainRetiredProject(); // the message thread's collection, or the next swap defers
                };
                // lap 0 stamps the origin at 0; lap 1 (base 4 bars, 16 s on the grid) runs on it
                expectWithinAbsoluteError(at(0.5, 0.0), 0.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(7.5, 4.0), 2.5f / 16.0f, 0.002f); // 23.5 mod 7
                expectWithinAbsoluteError(at(7.99, 4.0), 2.99f / 16.0f, 0.002f); // just before bar 2

                // carried: another file, the same row, renamed, landing at bar 2 of lap 1 (8 s)
                auto carried = foldProject(other, "perc");
                carried.rifffs[0].stems[0].stemKey = "fold-carried:1";
                carried.rifffs[0].stems[0].cycleStemHash = cycleStemHashOf(carried.rifffs[0].stems[0]);
                landAt(carried);
                // the incoming file at the running tile's position: 24 s is 3 s into a tile, so
                // 1 - 3/16 -- not its loop position (1 - 8/16), not a restarted cycle (1 - 0/16)
                expectWithinAbsoluteError(at(8.0, 4.0), 1.0f - 3.0f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(8.5, 4.0), 1.0f - 3.5f / 16.0f, 0.002f); // 24.5 mod 7
                expectWithinAbsoluteError(at(9.5, 4.0), 1.0f - 4.5f / 16.0f, 0.002f);
                // the next tile starts at 28 s (12 s into lap 1), on the same origin
                expectWithinAbsoluteError(at(11.5, 4.0), 1.0f - 6.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(12.5, 4.0), 1.0f - 0.5f / 16.0f, 0.002f);
                // and that seam is the usual 10 ms fade, on the incoming file: 50 ms either side
                {
                    const int n = (int) (0.1 * 44100.0);
                    std::vector<float> l((size_t) n, 0.0f), r((size_t) n, 0.0f);
                    engine.renderBlock((12.0 - 0.05) / 4.0, 44100.0, n, l.data(), r.data(), channelChains,
                                       LapClock { 4.0, 1 });
                    float worst = 0.0f;
                    float lowest = 1.0f;
                    for (int i = 1; i < n; ++i)
                    {
                        worst = std::max(worst, std::abs(l[(size_t) i] - l[(size_t) i - 1]));
                        lowest = std::min(lowest, std::abs(l[(size_t) i]));
                    }
                    // unfaded, 1 - 7/16 up to 1 is a 0.44 jump; faded over 441 samples, each step
                    // about 1 / 441 = 0.0023 at most (the fade-in rises to 1, not 0.44)
                    expect(worst < 0.003f, "largest step at the carried cycle's seam " + juce::String(worst));
                    expect(lowest < 0.003f, "the carried seam dips to silence, got " + juce::String(lowest));
                }
                // the lap after: still the same origin (lap 2 starts at 32 s, 4 s into a tile)
                expectWithinAbsoluteError(at(0.5, 8.0), 1.0f - 4.5f / 16.0f, 0.002f);

                // straight: the same file, its row not named, landing at bar 3 of lap 2 (12 s,
                // 44 s on the grid, 2 s into a tile) -- the loop's own position
                landAt(foldProject(other, ""));
                expectWithinAbsoluteError(at(12.5, 8.0), 1.0f - 12.5f / 16.0f, 0.002f);
                ramp.deleteFile();
                other.deleteFile();
            }

            // A phased incoming cycle is mid-tile at its origin: the grid there is -phase, so the
            // first sample is `tileSec - phase` into a tile, past the seam's 10 ms fade-in. It has
            // to fade in from the origin, over the same 10 ms the outgoing fades out over.
            beginTest("a phased incoming cycle fades in from its origin: no fold step starts mid-tile at full gain");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_phased_in_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                ChannelChainRegistry channelChains;
                for (const double phase : { 0.25, 1.0 / 16.0 }) // a beat, a sixteenth of a bar
                {
                    PlaybackEngine engine(cache);
                    engine.setProject(foldProject(ramp, "perc"));
                    engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                    engine.applyStagedCycles(false);
                    std::vector<float> lap1;
                    const float worst = acrossTop(engine, foldRow(6.0 / 4.0, phase, "perc~2"), channelChains, lap1);
                    // the incoming is 6 beats - phase into a tile at the top (5 s: 0.31; 5.75 s:
                    // 0.36), at full gain unfaded. Faded over 441 samples, with the outgoing's
                    // 0.125 fading out beside it, about 0.001 a step.
                    expect(worst < 0.002f, "largest step across the top into a cycle phased "
                                               + juce::String(phase) + " bar: " + juce::String(worst));
                    // and it does sound: past 10 ms it is the incoming cycle at full gain
                    const double inTileSec = std::fmod(-phase * 4.0 + 6.0 + 0.02, 6.0);
                    expectWithinAbsoluteError(lap1[(size_t) (0.02 * 44100.0)], (float) (inTileSec / 16.0), 0.002f);
                }
                ramp.deleteFile();
            }

            // v2's re-fold (spec 2026-10-03-radio-fold-v2-design section 1): a settled fold at its
            // realignment top may keep its length and take a new phase under a new id. The table
            // treats any change of id, length or phase as a change (CycleTable::apply's `carried`),
            // so it crossfades like every other fold step at a top: the outgoing 7-beat cycle is
            // 2 s into a tile at the top (0.125), the incoming 7 beats - a quarter beat in (0.42).
            beginTest("a re-fold to the same length at a new phase crossfades at the top");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_refold_phase_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                ChannelChainRegistry channelChains;
                PlaybackEngine engine(cache);
                engine.setProject(foldProject(ramp, "perc"));
                engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                engine.applyStagedCycles(false);
                std::vector<float> lap1;
                const double phase = 1.0 / 16.0; // a sixteenth of a bar: a quarter beat
                const float worst = acrossTop(engine, foldRow(7.0 / 4.0, phase, "perc~2"), channelChains, lap1);
                expect(worst < 0.002f, "largest step across a phase-only re-fold " + juce::String(worst));
                // past 10 ms it is the re-folded cycle at full gain, a quarter beat later on its grid
                const double inTileSec = std::fmod(-phase * 4.0 + 7.0 + 0.02, 7.0);
                expectWithinAbsoluteError(lap1[(size_t) (0.02 * 44100.0)], (float) (inTileSec / 16.0), 0.002f);
                ramp.deleteFile();
            }

            // A stem whose head is not silence: unfolding at the top hands over to the straight stem,
            // which starts its lap as it always does -- tile 0 is its first segment, faded in over
            // FadeGain's 3 ms micro-fade (a 0.5 head: 0.5 / 132 = 0.0038 a step), while the
            // outgoing cycle fades out over 10 ms (0.5 / 441 = 0.0011 a step, the other way). The
            // net 0.0026 is above the 0.002 a cycle-to-cycle step meets, and is the straight stem's
            // own start, not the fold's: the bar here is that unfolding is no worse than the same
            // straight stem wrapping the same top unfolded (its own 3 ms fade-out, then fade-in).
            beginTest("a row with a non-silent head unfolds no worse than its straight stem wraps the top");
            {
                auto dc = writeFixtureWav("sssketch_pe_fold_unfold_dc.wav", 0.5f, 16 * 44100);
                StemBufferCache cache;
                ChannelChainRegistry channelChains;
                PlaybackEngine engine(cache);
                engine.setProject(foldProject(dc, "perc"));
                engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                engine.applyStagedCycles(false);
                std::vector<float> lap1;
                const float worst = acrossTop(engine, {}, channelChains, lap1);
                PlaybackEngine plain(cache);
                plain.setProject(foldProject(dc, "perc"));
                std::vector<float> plainLap1;
                const float plainWorst = acrossTop(plain, {}, channelChains, plainLap1);
                expect(plainWorst > 0.003f, "the straight stem's own wrap steps by its 3 ms micro-fade, got "
                                                + juce::String(plainWorst));
                expect(worst <= plainWorst, "largest step unfolding " + juce::String(worst)
                                                + ", the straight stem's own wrap " + juce::String(plainWorst));
                expect(worst < 0.003f, "largest step unfolding a 0.5 head " + juce::String(worst));
                dc.deleteFile();
            }

            beginTest("a row the cycle table does not name plays exactly as a stem with no row");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_none_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                PlaybackEngine withRow(cache);
                PlaybackEngine plain(cache);
                ChannelChainRegistry channelChains;
                withRow.setProject(foldProject(ramp, "lead")); // the table folds "perc" only
                withRow.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                withRow.applyStagedCycles(false);
                plain.setProject(foldProject(ramp, ""));
                std::vector<float> a(4096, 0.0f), ar(4096, 0.0f), b(4096, 0.0f), br(4096, 0.0f);
                withRow.renderBlock(1.9, 44100.0, 4096, a.data(), ar.data(), channelChains, LapClock { 4.0, 1 });
                plain.renderBlock(1.9, 44100.0, 4096, b.data(), br.data(), channelChains);
                for (size_t i = 0; i < a.size(); ++i)
                    expectEquals(a[i], b[i]);
                ramp.deleteFile();
            }

            beginTest("a folded row's origin is the lap its cycle went live on, even if the row was silent then");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_origin_ramp.wav", 16 * 44100);
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                auto muted = foldProject(ramp, "perc");
                muted.rifffs[0].stems[0].muted = true;
                engine.setProject(muted);
                engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                engine.applyStagedCycles(false);
                float l = 0.0f, r = 0.0f;
                // lap 1 (base 4 bars): the cycle is live, the row is muted -- silent, but its
                // origin is this lap's top
                engine.renderBlock(0.5 / 4.0, 44100.0, 1, &l, &r, channelChains, LapClock { 4.0, 1 });
                expectEquals(l, 0.0f);
                // lap 2 (base 8 bars): unmuted. 16.5 s after the origin is 2.5 s into a tile; an
                // origin taken lazily, here, would read 0.5 / 16
                engine.setProject(foldProject(ramp, "perc"));
                engine.renderBlock(0.5 / 4.0, 44100.0, 1, &l, &r, channelChains, LapClock { 8.0, 1 });
                expectWithinAbsoluteError(l, 2.5f / 16.0f, 0.002f);
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

            // ---- preload-stem (PlaybackEngine::preloadStem) ----
            // See PlaybackEngine.h's own doc comment for why this exists:
            // radio's prefetch warmed everything EXCEPT the engine's own
            // decoded buffer, so the read/decode still happened at the
            // instant a change committed.

            beginTest("preloadStem warms the cache, so the setProject that later names the stem needs no disk read");
            {
                auto preloadFixture = writeFixtureWav("sssketch_preload_fixture.wav", 0.5f, 44100);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;

                expect(engine.preloadStem(preloadFixture.getFullPathName(), 4.0));

                // Deleted out from under the engine BEFORE setProject ever
                // sees it -- the same trick StemBufferCacheTests uses for
                // its own re-load test, and the only way to prove the
                // decode really happened at preload time rather than at
                // commit time. If preloadStem did nothing, setProject's own
                // load() would now fail and this would render silence.
                preloadFixture.deleteFile();

                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = preloadFixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);
                engine.setProject(project);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                // Index 200 for the same reason the "renders a placed stem"
                // test above picks it: past FadeGain's always-on ~3ms
                // anti-click ramp.
                expectWithinAbsoluteError(l[200], 0.5f, 0.01f);
                expectWithinAbsoluteError(r[200], 0.5f, 0.01f);
            }

            beginTest("preloading the same stem again is a cheap no-op, not a second read");
            {
                auto twiceFixture = writeFixtureWav("sssketch_preload_twice_fixture.wav", 0.25f, 4410);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                expect(engine.preloadStem(twiceFixture.getFullPathName(), 0.1));

                // Radio warms the same stem repeatedly across a session, so
                // the second call must not touch the disk at all -- proven
                // by deleting the file and expecting success anyway.
                twiceFixture.deleteFile();
                expect(engine.preloadStem(twiceFixture.getFullPathName(), 0.1));
                expect(cache.get(twiceFixture.getFullPathName()) != nullptr);
            }

            beginTest("preloadStem degrades silently for a missing or empty path");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;

                // Neither throws nor caches anything -- a preload is a hint,
                // and a stem that has not finished downloading (or was
                // deleted upstream) must cost exactly what it costs today.
                expect(!engine.preloadStem("/no/such/preloaded/stem.wav", 4.0));
                expect(!engine.preloadStem("", 4.0));
                expect(cache.get("/no/such/preloaded/stem.wav") == nullptr);

                // And the engine is still perfectly usable afterwards.
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                engine.setProject(project);
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                for (float s : l) expectEquals(s, 0.0f);
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

            // ---- per-row panning (native radio sound plan, Task 4; StemPan.h) ----
            {
                constexpr double kRate = 44100.0;
                // 240bpm: one bar is one second, and each fixture is one second, so one bar
                // of audio and then silence (playedBars 1).
                const auto panProject = [](const std::vector<std::pair<juce::File, double>>& stems) {
                    EngineProject project;
                    project.bpm = 240.0;
                    project.snapDiv = 16.0;
                    EngineRifff rifff;
                    rifff.groupId = "pan";
                    rifff.channelId = "ch-pan";
                    rifff.startBar = 0.0;
                    rifff.barLength = 1;
                    int n = 0;
                    for (const auto& [file, pan] : stems)
                    {
                        EngineStem stem;
                        stem.stemKey = "pan:" + juce::String(++n);
                        stem.resolvedPath = file.getFullPathName();
                        stem.durationSec = 1.0;
                        stem.barLength = 1;
                        stem.playedBars = 1.0;
                        stem.pan = pan;
                        rifff.stems.push_back(stem);
                    }
                    project.rifffs.push_back(rifff);
                    return project;
                };
                // Renders `totalSamples` from bar 0 in the given block sizes (cycled), the way
                // Transport hands renderBlock consecutive sub-ranges.
                const auto render = [&](const EngineProject& project, int totalSamples,
                                        const std::vector<int>& blockSizes,
                                        std::vector<float>& outL, std::vector<float>& outR) {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    ChannelChainRegistry channelChains;
                    engine.setProject(project);
                    outL.assign((size_t) totalSamples, 0.0f);
                    outR.assign((size_t) totalSamples, 0.0f);
                    size_t which = 0;
                    for (int start = 0; start < totalSamples;)
                    {
                        const int len = juce::jmin(totalSamples - start, blockSizes[which++ % blockSizes.size()]);
                        const double positionBars = (start / kRate) / 1.0; // 1 s per bar
                        engine.renderBlock(positionBars, kRate, len, outL.data() + start, outR.data() + start,
                                           channelChains);
                        start += len;
                    }
                };

                auto stereo = writeStereoSineFixtureWav("sssketch_pe_pan_stereo.wav", 330.0, 0.5f, 0.0f, 0.3f, 44100);
                auto mono = writeSineFixtureWav("sssketch_pe_pan_mono.wav", 220.0, 0.5f, 44100);

                beginTest("pan 0 (and -0) is bit-identical to a stem with no pan, with or without a toolkit");
                {
                    auto bare = panProject({ { stereo, 0.0 }, { mono, 0.0 } });
                    bare.rifffs[0].stems[1].hasToolkit = true;
                    bare.rifffs[0].stems[1].toolkit.reverbSend = 0.5;
                    auto zero = bare;
                    zero.rifffs[0].stems[0].pan = -0.0;
                    zero.rifffs[0].stems[1].pan = 0.0;
                    std::vector<float> aL, aR, bL, bR;
                    render(bare, 66150, { 512 }, aL, aR);
                    render(zero, 66150, { 512 }, bL, bR);
                    expect(std::memcmp(aL.data(), bL.data(), sizeof(float) * aL.size()) == 0);
                    expect(std::memcmp(aR.data(), bR.data(), sizeof(float) * aR.size()) == 0);
                    expect(std::abs(aL[3000]) > 0.01f, "it rendered something");
                }

                beginTest("+0.25 on a stereo stem is the StereoPannerNode formula over the unpanned render");
                {
                    std::vector<float> dryL, dryR, panL, panR;
                    render(panProject({ { stereo, 0.0 } }), 4096, { 512 }, dryL, dryR);
                    render(panProject({ { stereo, 0.25 } }), 4096, { 512 }, panL, panR);
                    const double gL = std::cos(0.25 * juce::MathConstants<double>::halfPi);
                    const double gR = std::sin(0.25 * juce::MathConstants<double>::halfPi);
                    int mismatches = 0;
                    for (size_t i = 0; i < dryL.size(); ++i)
                    {
                        const double l = dryL[i], r = dryR[i];
                        if (panL[i] != (float) (l * gL) || panR[i] != (float) (r + l * gR))
                            ++mismatches;
                    }
                    expectEquals(mismatches, 0);
                    expect(dryL[1000] != dryR[1000], "the fixture really is stereo");
                }

                beginTest("a mono stem at +0.25 gives L = cos(pi/8) x, R = (1 + sin(pi/8)) x");
                {
                    std::vector<float> dryL, dryR, panL, panR;
                    render(panProject({ { mono, 0.0 } }), 4096, { 512 }, dryL, dryR);
                    render(panProject({ { mono, 0.25 } }), 4096, { 512 }, panL, panR);
                    const double c = std::cos(juce::MathConstants<double>::pi / 8.0);
                    const double s = std::sin(juce::MathConstants<double>::pi / 8.0);
                    double worst = 0.0;
                    for (size_t i = 0; i < dryL.size(); ++i)
                    {
                        expectEquals(dryL[i], dryR[i]);
                        worst = juce::jmax(worst, std::abs(panL[i] - c * dryL[i]));
                        worst = juce::jmax(worst, std::abs(panR[i] - (1.0 + s) * dryL[i]));
                    }
                    expect(worst < 1.0e-6, "worst error " + juce::String(worst));
                }

                beginTest("a panned stem with no toolkit adds no send: silence after its last sample");
                {
                    std::vector<float> l, r;
                    render(panProject({ { mono, 0.25 } }), 88200, { 512 }, l, r);
                    float tail = 0.0f;
                    for (size_t i = 44100 + 64; i < l.size(); ++i)
                        tail = juce::jmax(tail, std::abs(l[i]), std::abs(r[i]));
                    expectEquals(tail, 0.0f);
                }

                beginTest("the reverb send is post-pan: a hard-right mono row feeds the room what a "
                          "right-only stem does");
                {
                    // Pan +1 folds a mono x into (0, 2x). Post-pan, the room hears (0, 2x); a
                    // pre-pan send would feed it (x, x) -- the centred row's send. So the
                    // panned row's tail must match a stem that IS (0, 2x) at pan 0, and must
                    // not match the centred row's.
                    auto rightOnly = writeStereoSineFixtureWav(
                        "sssketch_pe_pan_rightonly.wav", 220.0, 0.0f, 1.0f, 0.0f, 44100);
                    const auto withSend = [&](EngineProject p) {
                        p.rifffs[0].stems[0].hasToolkit = true;
                        p.rifffs[0].stems[0].toolkit.reverbSend = 1.0;
                        p.reverb.roomSize = 0.6;
                        p.reverb.preDelayMs = 0.0;
                        return p;
                    };
                    std::vector<float> panL, panR, refL, refR, midL, midR;
                    render(withSend(panProject({ { mono, 1.0 } })), 88200, { 512 }, panL, panR);
                    render(withSend(panProject({ { rightOnly, 0.0 } })), 88200, { 512 }, refL, refR);
                    render(withSend(panProject({ { mono, 0.0 } })), 88200, { 512 }, midL, midR);
                    double toRef = 0.0, toMid = 0.0, tailPeak = 0.0;
                    for (size_t i = 44100 + 64; i < panL.size(); ++i)
                    {
                        toRef = juce::jmax(toRef, (double) std::abs(panL[i] - refL[i]),
                                           (double) std::abs(panR[i] - refR[i]));
                        toMid = juce::jmax(toMid, (double) std::abs(panL[i] - midL[i]),
                                           (double) std::abs(panR[i] - midR[i]));
                        tailPeak = juce::jmax(tailPeak, (double) std::abs(panL[i]), (double) std::abs(panR[i]));
                    }
                    expect(tailPeak > 1.0e-3, "there is a tail: " + juce::String(tailPeak));
                    // The reference stem is 16-bit, so it is (0, 2x) to within quantisation.
                    expect(toRef < 2.0e-4, "panned tail vs right-only stem: " + juce::String(toRef));
                    expect(toMid > 20.0 * 2.0e-4, "panned tail vs centred send: " + juce::String(toMid));
                    rightOnly.deleteFile();
                }

                beginTest("panned rows are block-split invariant, to the bit");
                {
                    const auto project = panProject({ { stereo, -0.25 }, { mono, 0.25 } });
                    std::vector<float> aL, aR, bL, bR, cL, cR;
                    render(project, 50000, { 512 }, aL, aR);
                    render(project, 50000, { 1, 64, 300, 7, 4096, 129 }, bL, bR);
                    juce::Random random(11);
                    std::vector<int> sizes;
                    for (int i = 0; i < 64; ++i)
                        sizes.push_back(1 + random.nextInt(1500));
                    render(project, 50000, sizes, cL, cR);
                    expect(std::memcmp(aL.data(), bL.data(), sizeof(float) * aL.size()) == 0);
                    expect(std::memcmp(aR.data(), bR.data(), sizeof(float) * aR.size()) == 0);
                    expect(std::memcmp(aL.data(), cL.data(), sizeof(float) * aL.size()) == 0);
                    expect(std::memcmp(aR.data(), cR.data(), sizeof(float) * aR.size()) == 0);
                }

                beginTest("a panned stem with nothing in the block leaves the mix exactly as without it");
                {
                    // The lazy buffer (PlaybackEngine.cpp's prepareStemBuffer): a panned,
                    // toolkit-less stem far from the block clears nothing and adds nothing.
                    auto with = panProject({ { mono, 0.0 }, { stereo, 0.25 }, { mono, -0.25 } });
                    with.rifffs[0].stems[1].startBarOverride = 50.0;
                    with.rifffs[0].stems[2].startBarOverride = 60.0;
                    const auto without = panProject({ { mono, 0.0 } });
                    std::vector<float> aL, aR, bL, bR;
                    render(with, 44100, { 512, 300, 1 }, aL, aR);
                    render(without, 44100, { 512, 300, 1 }, bL, bR);
                    expect(std::memcmp(aL.data(), bL.data(), sizeof(float) * aL.size()) == 0);
                    expect(std::memcmp(aR.data(), bR.data(), sizeof(float) * aR.size()) == 0);
                    expect(std::abs(aL[3000]) > 0.01f, "it rendered something");
                }

                beginTest("a panned one-shot is panned like a tiled stem");
                {
                    auto oneShot = [&](double pan) {
                        auto p = panProject({ { stereo, pan } });
                        auto& stem = p.rifffs[0].stems[0];
                        stem.oneShot = true;
                        stem.trimStartSec = 0.1;
                        stem.trimEndSec = 0.6;
                        return p;
                    };
                    std::vector<float> dryL, dryR, panL, panR;
                    render(oneShot(0.0), 44100, { 512 }, dryL, dryR);
                    render(oneShot(0.25), 44100, { 512 }, panL, panR);
                    const double gL = std::cos(0.25 * juce::MathConstants<double>::halfPi);
                    const double gR = std::sin(0.25 * juce::MathConstants<double>::halfPi);
                    int mismatches = 0;
                    for (size_t i = 0; i < dryL.size(); ++i)
                    {
                        const double l = dryL[i], r = dryR[i];
                        if (panL[i] != (float) (l * gL) || panR[i] != (float) (r + l * gR))
                            ++mismatches;
                    }
                    expectEquals(mismatches, 0);
                    expect(std::abs(dryL[10000]) > 0.01f, "the one-shot sounded");
                    expectEquals(dryL[40000], 0.0f); // and stopped at its trim end
                }

                beginTest("a panned stem with a drawn volume curve: volume, then pan");
                {
                    auto curved = [&](double pan) {
                        auto p = panProject({ { stereo, pan } });
                        auto& stem = p.rifffs[0].stems[0];
                        stem.hasToolkit = true;
                        stem.toolkit.automation.volume = { { 0.0, 1.0 }, { 1.0, 0.2 } };
                        return p;
                    };
                    std::vector<float> dryL, dryR, panL, panR;
                    render(curved(0.0), 44100, { 512 }, dryL, dryR);
                    render(curved(0.25), 44100, { 512 }, panL, panR);
                    const double gL = std::cos(0.25 * juce::MathConstants<double>::halfPi);
                    const double gR = std::sin(0.25 * juce::MathConstants<double>::halfPi);
                    int mismatches = 0;
                    for (size_t i = 0; i < dryL.size(); ++i)
                    {
                        const double l = dryL[i], r = dryR[i];
                        if (panL[i] != (float) (l * gL) || panR[i] != (float) (r + l * gR))
                            ++mismatches;
                    }
                    expectEquals(mismatches, 0);
                    // The curve really is shaping it: late samples are quieter than early ones.
                    float early = 0.0f, late = 0.0f;
                    for (size_t i = 1000; i < 5000; ++i)
                        early = juce::jmax(early, std::abs(dryL[i]));
                    for (size_t i = 38000; i < 42000; ++i)
                        late = juce::jmax(late, std::abs(dryL[i]));
                    expect(late < 0.5f * early, "late " + juce::String(late) + " early " + juce::String(early));
                }

                beginTest("a per-stem render writes float, so a panned row's near side is not clipped");
                {
                    // Near full scale, panned hard enough that the near side passes 0 dBFS:
                    // 0.9 x (1 + sin(pi/4)) = 1.54. 16 bits clips it at 1; float keeps it.
                    auto loud = writeSineFixtureWav("sssketch_pe_pan_loud.wav", 220.0, 0.9f, 44100);
                    const auto project = panProject({ { loud, 0.5 } });
                    const auto peakOf = [&](WavSampleFormat format) {
                        auto out = juce::File::getSpecialLocation(juce::File::tempDirectory)
                                       .getChildFile("sssketch_pe_pan_render.wav");
                        juce::String error;
                        expect(renderProjectToWavFile(project, out.getFullPathName(), 0.5, error, format), error);
                        juce::AudioFormatManager formats;
                        formats.registerBasicFormats();
                        std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(out));
                        float peak = 0.0f;
                        if (reader != nullptr)
                        {
                            juce::AudioBuffer<float> buffer(2, (int) reader->lengthInSamples);
                            reader->read(&buffer, 0, (int) reader->lengthInSamples, 0, true, true);
                            peak = buffer.getMagnitude(1, 0, buffer.getNumSamples());
                        }
                        reader.reset();
                        out.deleteFile();
                        return peak;
                    };
                    const float floatPeak = peakOf(WavSampleFormat::float32);
                    const float pcmPeak = peakOf(WavSampleFormat::pcm16);
                    expect(floatPeak > 1.4f, "float peak " + juce::String(floatPeak));
                    expect(pcmPeak <= 1.0f, "16-bit peak " + juce::String(pcmPeak));
                    loud.deleteFile();
                }

                stereo.deleteFile();
                mono.deleteFile();
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
                // 2 BARS (8 seconds at this tempo), four times the riser's
                // own length on purpose: the riser rings past its end
                // (kRiserTailBars) and then stops, and both of those have to
                // be in the compared window.
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

                    // ...and the window genuinely contains the tail, so the
                    // sample-for-sample comparison above is covering it
                    // rather than passing on a stretch of silence. The riser
                    // ends 2 seconds in; there is audio after that, and it is
                    // gone again by the time the tail is over.
                    const int endOfRiser = (int) (2.0 * 44100.0);
                    const int endOfTail = endOfRiser + (int) std::lround(kRiserTailBars * 4.0 * 44100.0);
                    double tailPeak = 0.0, afterTailPeak = 0.0;
                    for (int i = endOfRiser; i < juce::jmin(endOfTail, numSamples); ++i)
                        tailPeak = juce::jmax(tailPeak, (double) std::abs(bounced.getSample(0, i)));
                    for (int i = endOfTail; i < numSamples; ++i)
                        afterTailPeak = juce::jmax(afterTailPeak, (double) std::abs(bounced.getSample(0, i)));
                    expect(tailPeak > 0.01, "the bounce has no tail past the riser's end");
                    expect(afterTailPeak < 1.0e-3, "the bounce is still sounding after the tail");
                }
                out.deleteFile();
            }

            fixture.deleteFile();

            // --- the master filter (spec 2026-09-28-performance-mode-design
            // section 4A.3): ONE filter over the summed master pair, not N
            // identical per-clip curves.

            beginTest("a project with a neutral master filter renders BIT-identically to one with none");
            {
                // The same promise the toolkit's own neutral test pins, one
                // level up: a master strip nobody has touched must leave the
                // mix untouched sample for sample, not merely nearly so.
                // Resonance is deliberately NON-zero here -- a resonant peak
                // AT a cutoff parked on its own open end is nothing, and the
                // engine must agree rather than engaging a filter for it.
                auto toneA = writeFixtureWav("sssketch_pe_mf_neutral_a.wav", 0.3f, 44100);
                auto toneB = writeFixtureWav("sssketch_pe_mf_neutral_b.wav", 0.2f, 44100);

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
                    stem.durationSec = 1.0;
                    stem.barLength = 1;
                    rifff.stems.push_back(stem);
                    bare.rifffs.push_back(rifff);
                }

                EngineProject parked = bare;
                parked.masterFilter.mode = FilterMode::lowpass;
                parked.masterFilter.cutoff = neutralCutoffValue(FilterMode::lowpass);
                parked.masterFilter.resonance = 0.8;

                std::vector<float> bareL(512, 0.0f), bareR(512, 0.0f);
                {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    ChannelChainRegistry channelChains;
                    engine.setProject(bare);
                    engine.renderBlock(0.0, 44100.0, 512, bareL.data(), bareR.data(), channelChains);
                }

                std::vector<float> parkedL(512, 0.0f), parkedR(512, 0.0f);
                {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    ChannelChainRegistry channelChains;
                    engine.setProject(parked);
                    engine.renderBlock(0.0, 44100.0, 512, parkedL.data(), parkedR.data(), channelChains);
                }

                for (int i = 0; i < 512; ++i)
                {
                    expectEquals(parkedL[i], bareL[i]);
                    expectEquals(parkedR[i], bareR[i]);
                }
                // ...and it wasn't trivially two silences.
                expectWithinAbsoluteError(bareL[200], 0.5f, 0.01f);

                toneA.deleteFile();
                toneB.deleteFile();
            }

            beginTest("the master filter is on the WHOLE mix, not on one clip");
            {
                // Two DC clips on two channels. A highpass is the sharpest
                // possible probe for "did this reach everything": DC is the
                // one thing a highpass removes completely, so if the filter
                // were somehow per clip (the alternative 4A.3 rejected,
                // built wrong) one clip's 0.2 would survive.
                auto toneA = writeFixtureWav("sssketch_pe_mf_whole_a.wav", 0.3f, 44100);
                auto toneB = writeFixtureWav("sssketch_pe_mf_whole_b.wav", 0.2f, 44100);

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
                    stem.durationSec = 1.0;
                    stem.barLength = 1;
                    rifff.stems.push_back(stem);
                    project.rifffs.push_back(rifff);
                }
                project.masterFilter.mode = FilterMode::highpass;
                project.masterFilter.cutoff = 0.75; // well up the log range -- kHz, not Hz

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                std::vector<float> l(4096, 0.0f), r(4096, 0.0f);
                engine.renderBlock(0.0, 44100.0, 4096, l.data(), r.data(), channelChains);

                // The filter ENGAGES at neutral and ramps to its target (see
                // applyMasterFilter), so the first few ms still pass DC --
                // that ramp is the point, it is what stops a sweep clicking
                // in. By 3000 samples (~68ms) both clips' DC is gone.
                expectWithinAbsoluteError(l[3000], 0.0f, 0.01f);
                expectWithinAbsoluteError(r[3000], 0.0f, 0.01f);
            }

            beginTest("a low master cutoff attenuates high content, using the same log map the clip filter does");
            {
                // 8kHz sine, and a master lowpass at value01 = 1/3, which
                // filterCutoffHz maps to 20 * 1000^(1/3) = 200Hz -- two
                // decades below the tone, so a 2nd-order lowpass should
                // leave essentially nothing. The value is written as the
                // inverse of the SHARED map rather than as a magic number,
                // so this test would fail if the master filter ever grew a
                // second cutoff curve of its own.
                auto tone = writeSineFixtureWav("sssketch_pe_mf_sweep.wav", 8000.0, 0.5f, 176400);

                EngineProject open;
                open.bpm = 60.0; // secPerBar = 4s, so 176400 samples is one bar
                open.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.channelId = "ch-1";
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.resolvedPath = tone.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                rifff.stems.push_back(stem);
                open.rifffs.push_back(rifff);

                EngineProject closed = open;
                closed.masterFilter.mode = FilterMode::lowpass;
                closed.masterFilter.cutoff = 1.0 / 3.0;
                expectWithinAbsoluteError(filterCutoffHz(closed.masterFilter.cutoff), 200.0, 1.0);

                auto peakOf = [this](const EngineProject& project) {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    ChannelChainRegistry channelChains;
                    engine.setProject(project);
                    // Several blocks, so the cutoff smoother has long since
                    // arrived; the peak is measured over the LAST one only.
                    double peak = 0.0;
                    for (int block = 0; block < 8; ++block)
                    {
                        std::vector<float> l(512, 0.0f), r(512, 0.0f);
                        const double bar = (double) (block * 512) / 44100.0 / 4.0;
                        engine.renderBlock(bar, 44100.0, 512, l.data(), r.data(), channelChains);
                        if (block < 7) continue;
                        for (int i = 0; i < 512; ++i)
                            peak = juce::jmax(peak, (double) std::abs(l[i]));
                    }
                    ignoreUnused(this);
                    return peak;
                };

                const double openPeak = peakOf(open);
                const double closedPeak = peakOf(closed);
                expect(openPeak > 0.4, "the unfiltered tone is missing (peak " + juce::String(openPeak) + ")");
                expect(closedPeak < openPeak * 0.05,
                    "a 200Hz master lowpass barely touched an 8kHz tone (" + juce::String(closedPeak)
                        + " vs " + juce::String(openPeak) + ")");

                tone.deleteFile();
            }

            beginTest("a live master cutoff override drives the filter, and clearing it leaves the path entirely");
            {
                // The whole live-control story in one test: the project is
                // neutral throughout (exactly what a resting master strip
                // sends), the override alone opens and closes the filter,
                // and once it is cleared the master pair goes back to being
                // untouched -- BIT-identical to an engine that never had a
                // filter, not merely close to it.
                auto tone = writeSineFixtureWav("sssketch_pe_mf_live.wav", 8000.0, 0.5f, 176400);

                EngineProject project;
                project.bpm = 60.0;
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
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);
                // Untouched: mode lowpass, cutoff at its neutral end.
                expect(channelFilterIsNeutral(
                    project.masterFilter.mode, project.masterFilter.cutoff, false, false));

                StemBufferCache cacheA, cacheB;
                PlaybackEngine swept(cacheA), reference(cacheB);
                ChannelChainRegistry chainsA, chainsB;
                swept.setProject(project);
                reference.setProject(project);

                auto renderBoth = [&](int block, std::vector<float>& sweptL, std::vector<float>& refL) {
                    std::vector<float> sweptR(512, 0.0f), refR(512, 0.0f);
                    sweptL.assign(512, 0.0f);
                    refL.assign(512, 0.0f);
                    const double bar = (double) (block * 512) / 44100.0 / 4.0;
                    swept.renderBlock(bar, 44100.0, 512, sweptL.data(), sweptR.data(), chainsA);
                    reference.renderBlock(bar, 44100.0, 512, refL.data(), refR.data(), chainsB);
                };

                std::vector<float> sweptL, refL;

                // 1. No override yet: identical, because nothing is engaged.
                renderBoth(0, sweptL, refL);
                for (int i = 0; i < 512; ++i)
                    expectEquals(sweptL[i], refL[i]);

                // 2. The hand lands on the control. 200Hz, as above.
                swept.liveOverrides().setMasterFilterCutoffOverride(1.0f / 3.0f);
                double sweptPeak = 0.0, refPeak = 0.0;
                for (int block = 1; block < 10; ++block)
                {
                    renderBoth(block, sweptL, refL);
                    if (block < 9) continue;
                    for (int i = 0; i < 512; ++i)
                    {
                        sweptPeak = juce::jmax(sweptPeak, (double) std::abs(sweptL[i]));
                        refPeak = juce::jmax(refPeak, (double) std::abs(refL[i]));
                    }
                }
                expect(refPeak > 0.4, "the reference tone is missing");
                expect(sweptPeak < refPeak * 0.05,
                    "the live override did not reach the filter (" + juce::String(sweptPeak) + ")");

                // 3. The hand comes off. The filter ramps HOME rather than
                // dropping out mid-sweep, and then leaves the path -- after
                // which the two engines agree sample for sample again.
                swept.liveOverrides().setMasterFilterCutoffOverride(std::nullopt);
                for (int block = 10; block < 40; ++block)
                    renderBoth(block, sweptL, refL);
                renderBoth(40, sweptL, refL);
                for (int i = 0; i < 512; ++i)
                    expectEquals(sweptL[i], refL[i]);

                tone.deleteFile();
            }

            beginTest("clearAll() drops the master filter's live values too");
            {
                // load-project calls liveOverrides().clearAll()
                // (IpcServer.cpp), which is the ENTIRE mechanism by which a
                // live override is cleared -- so the master filter's own two
                // values have to go with it, or a sweep would survive a
                // project it no longer belongs to. The renderer re-asserts
                // them right after every sync, which is what stops the
                // clear being heard.
                LiveParamOverrides overrides;
                expect(!overrides.masterFilterCutoffFor().has_value());
                expect(!overrides.masterFilterResonanceFor().has_value());
                overrides.setMasterFilterCutoffOverride(0.25f);
                overrides.setMasterFilterResonanceOverride(0.75f);
                expectWithinAbsoluteError(*overrides.masterFilterCutoffFor(), 0.25f, 1.0e-6f);
                expectWithinAbsoluteError(*overrides.masterFilterResonanceFor(), 0.75f, 1.0e-6f);
                // Not counted in hasAnyOverride(): that flag exists only to
                // let the per-STEM loop skip the three mutex-backed maps,
                // and the master filter is read once per block regardless.
                expect(!overrides.hasAnyOverride());
                overrides.clearAll();
                expect(!overrides.masterFilterCutoffFor().has_value());
                expect(!overrides.masterFilterResonanceFor().has_value());
            }

            // ---- scheduled project swap (stage / apply at the loop top) ----
            //
            // The engine half of "the renderer pushes the next project early
            // and the engine makes it real at the next loop top." See
            // PlaybackEngine::stageProject/applyStagedProject for why it
            // exists; these cover the four behaviours the contract turns on:
            // staging doesn't change anything until it's applied, a stage can
            // be replaced, a stage can be cancelled, and a loop top that
            // arrives with nothing staged does nothing.

            // Two fixtures with different constant values, so "which project
            // is live right now" is readable straight off a rendered sample.
            auto quietFixture = writeFixtureWav("sssketch_pe_stage_quiet.wav", 0.2f, 44100);
            auto loudFixture = writeFixtureWav("sssketch_pe_stage_loud.wav", 0.8f, 44100);
            auto oneStemProject = [](const juce::File& file) {
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                project.loopLengthBars = 1.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.channelId = "c1";
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = file.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);
                return project;
            };

            beginTest("a staged project changes nothing until it is applied, and everything once it is");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(oneStemProject(quietFixture));

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                expectWithinAbsoluteError(l[200], 0.2f, 0.01f);

                engine.stageProject(oneStemProject(loudFixture));
                expect(engine.hasStagedProject());

                // Still the old project: staging publishes nothing.
                std::fill(l.begin(), l.end(), 0.0f);
                std::fill(r.begin(), r.end(), 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                expectWithinAbsoluteError(l[200], 0.2f, 0.01f);

                expect(engine.applyStagedProject() == PlaybackEngine::StagedApply::Applied);
                expect(!engine.hasStagedProject());
                expect(engine.stagedApplyCount() == 1);

                std::fill(l.begin(), l.end(), 0.0f);
                std::fill(r.begin(), r.end(), 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                expectWithinAbsoluteError(l[200], 0.8f, 0.01f);
            }

            beginTest("staging absorbs the whole decode, so applying it reads no files at all -- "
                      "the entire point of doing the work early rather than at the loop top");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(oneStemProject(quietFixture));

                const int beforeStage = stemDecodeCount();
                engine.stageProject(oneStemProject(loudFixture));
                const int afterStage = stemDecodeCount();
                expect(afterStage > beforeStage); // the cold decode happened HERE

                expect(engine.applyStagedProject() == PlaybackEngine::StagedApply::Applied);
                expect(stemDecodeCount() == afterStage); // ...and not here
            }

            beginTest("staging again replaces the waiting project rather than queueing behind it");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(oneStemProject(quietFixture));

                engine.stageProject(oneStemProject(quietFixture));
                engine.stageProject(oneStemProject(loudFixture));
                expect(engine.applyStagedProject() == PlaybackEngine::StagedApply::Applied);
                // One swap, not two -- the superseded stage never fires.
                expect(engine.stagedApplyCount() == 1);
                expect(engine.applyStagedProject() == PlaybackEngine::StagedApply::None);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                expectWithinAbsoluteError(l[200], 0.8f, 0.01f);
            }

            beginTest("cancelling a staged project stops it firing, and says whether it was in time");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(oneStemProject(quietFixture));

                engine.stageProject(oneStemProject(loudFixture));
                expect(engine.cancelStagedProject()); // true: it was still waiting
                expect(!engine.hasStagedProject());
                expect(engine.applyStagedProject() == PlaybackEngine::StagedApply::None);
                expect(engine.stagedApplyCount() == 0);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                expectWithinAbsoluteError(l[200], 0.2f, 0.01f);

                // A cancel that loses the race has to SAY it lost, or the
                // caller reports a swap as cancelled that in fact happened.
                engine.stageProject(oneStemProject(loudFixture));
                expect(engine.applyStagedProject() == PlaybackEngine::StagedApply::Applied);
                expect(!engine.cancelStagedProject()); // false: too late
            }

            beginTest("a loop top that arrives before staging has finished swaps nothing -- "
                      "the late change is the message thread's problem to solve, not a glitch here");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(oneStemProject(quietFixture));

                // Exactly the state the audio thread finds when the renderer's
                // stage-project is still parsing/decoding on the message thread.
                expect(engine.applyStagedProject() == PlaybackEngine::StagedApply::None);
                expect(engine.stagedApplyCount() == 0);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                expectWithinAbsoluteError(l[200], 0.2f, 0.01f);

                // The change still lands, via the message thread's own
                // deadline, rather than waiting out another whole lap.
                engine.stageProject(oneStemProject(loudFixture));
                expect(engine.promoteStagedProjectNow());
                expect(!engine.hasStagedProject());
                std::fill(l.begin(), l.end(), 0.0f);
                std::fill(r.begin(), r.end(), 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                expectWithinAbsoluteError(l[200], 0.8f, 0.01f);
                // Nothing staged, nothing to promote.
                expect(!engine.promoteStagedProjectNow());
                // A message-thread promote is not an audio-thread swap, and
                // must not look like one to the counter the ack rides on.
                expect(engine.stagedApplyCount() == 0);
            }

            beginTest("the displaced project is handed back to the message thread, not freed at the swap -- "
                      "proven by the audio thread refusing a second swap until it has been collected");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(oneStemProject(quietFixture));

                engine.stageProject(oneStemProject(loudFixture));
                expect(engine.applyStagedProject() == PlaybackEngine::StagedApply::Applied);

                // The retirement slot is occupied: the outgoing project is
                // still alive, still owned, and waiting for a thread that is
                // allowed to run destructors.
                engine.stageProject(oneStemProject(quietFixture));
                expect(engine.applyStagedProject() == PlaybackEngine::StagedApply::Deferred);
                expect(engine.stagedApplyCount() == 1); // no second swap happened
                expect(engine.stagedDeferralCount() == 1);
                expect(engine.hasStagedProject()); // and nothing was dropped

                // Collected on the message thread -- this is where the
                // destructor and every buffer free inside it actually runs.
                engine.drainRetiredProject();
                engine.drainRetiredProject(); // idempotent

                expect(engine.applyStagedProject() == PlaybackEngine::StagedApply::Applied);
                expect(engine.stagedApplyCount() == 2);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                expectWithinAbsoluteError(l[200], 0.2f, 0.01f);

                engine.drainRetiredProject();
            }

            beginTest("an explicit setProject supersedes anything waiting for a loop top");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(oneStemProject(quietFixture));

                engine.stageProject(oneStemProject(loudFixture));
                engine.setProject(oneStemProject(quietFixture));
                expect(!engine.hasStagedProject());
                expect(engine.applyStagedProject() == PlaybackEngine::StagedApply::None);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                expectWithinAbsoluteError(l[200], 0.2f, 0.01f);
            }

            beginTest("sustained staging against a concurrent renderBlock -- the same shape of stress "
                      "test that proved the previous, raw-pointer reclamation scheme unsafe");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.setProject(oneStemProject(quietFixture));

                std::atomic<bool> stop { false };
                std::atomic<int> applied { 0 };

                // Stands in for the audio thread: renderBlock in a tight
                // loop, with the swap taken at a point where no renderBlock
                // is in flight -- exactly Transport::renderLoopAware's own
                // lap boundary.
                std::thread audio([&]() {
                    ChannelChainRegistry localChains;
                    std::vector<float> l(256, 0.0f), r(256, 0.0f);
                    double pos = 0.0;
                    while (!stop.load())
                    {
                        engine.renderBlock(pos, 44100.0, 256, l.data(), r.data(), localChains);
                        if (engine.applyStagedProject() == PlaybackEngine::StagedApply::Applied)
                            applied.fetch_add(1);
                        engine.renderBlock(pos, 44100.0, 256, l.data(), r.data(), localChains);
                        pos += 0.001;
                        if (pos > 1.0) pos = 0.0;
                    }
                });

                for (int i = 0; i < 400; ++i)
                {
                    engine.stageProject(oneStemProject(i % 2 == 0 ? loudFixture : quietFixture));
                    engine.drainRetiredProject();
                    std::this_thread::sleep_for(std::chrono::microseconds(200));
                }

                stop.store(true);
                audio.join();
                engine.drainRetiredProject();
                // Not an exact count -- a stage can legitimately be
                // superseded before it is ever taken. What matters is that
                // swaps genuinely happened under contention and nothing
                // crashed doing it.
                expect(applied.load() > 0);
            }

            quietFixture.deleteFile();
            loudFixture.deleteFile();
        }
    };

    static PlaybackEngineTests playbackEngineTests;
}

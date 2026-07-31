// native-engine/Source/PlaybackEngineTests.cpp
#include "PlaybackEngine.h"
#include "StemBufferCache.h"
#include <juce_core/juce_core.h>
#include <cmath>

namespace ssstitch
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
            auto fixture = writeFixtureWav("ssstitch_pe_fixture.wav", 0.5f, 44100);

            beginTest("silence when no project is set");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data());
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
                engine.setProject(project);
                expect(!engine.isMetronomeEnabled()); // off by default
                engine.setMetronomeEnabled(true);
                expect(engine.isMetronomeEnabled());

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data());
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
                engine.setProject(project);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data());
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
                engine.setProject(project);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data());
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
                engine.setProject(project);
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data());
                for (float s : l) expectEquals(s, 0.0f);
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
                engine.setProject(project);
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data());
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
                auto ramp = writeRampFixtureWav("ssstitch_pe_ramp.wav", rampSamples);

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
                engine.renderBlock(positionBars, sampleRate, numSamples, l.data(), r.data());

                // First sample: still in tile0, near (but outside the loop-sewing blend
                // window of) the end of its 4s buffer -> near 1.0.
                expect(l[0] > 0.9f);
                // Last sample: now in tile1, near the very start of its own buffer -> near 0.0,
                // NOT a continuation of tile0's near-1.0 tail (which a block-relative, rather
                // than segment-relative, index calculation would produce).
                expect(l[numSamples - 1] < 0.05f);

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
                engine.setProject(project);

                // tile1 starts at t=4.0s; render at t=4.5s, 1.5s into tile1 (and squarely
                // inside what would be a bogus fade-in ramp [4.0, 6.0)s if tile1 were
                // wrongly treated as the first tile).
                const double positionBars = 4.5 / 4.0;
                std::vector<float> l(64, 0.0f), r(64, 0.0f);
                engine.renderBlock(positionBars, 44100.0, 64, l.data(), r.data());

                // Expected flat: 0.5 (source) * 1.0 (no fade — this is a repeat, not the
                // rifff's true first tile) * 1.0 (default volume) = 0.5.
                expectWithinAbsoluteError(l[0], 0.5f, 0.01f);
            }

            beginTest("two stems overlapping the same block sum their contributions rather than overwriting");
            {
                // renderBlock's core job is accumulating (+=) every stem's contribution
                // into outL/outR. None of the tests above exercise more than one stem at
                // once, so a bug that overwrote instead of accumulated (e.g. `outL[i2] =`
                // instead of `outL[i2] +=`) would pass every one of them. Two stems, two
                // different constant-value fixtures, both active for the whole block:
                // the output must equal the sum of each stem's own contribution.
                auto fixtureA = writeFixtureWav("ssstitch_pe_mix_a.wav", 0.3f, 44100);
                auto fixtureB = writeFixtureWav("ssstitch_pe_mix_b.wav", 0.2f, 44100);

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
                engine.setProject(project);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data());

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
                auto ramp = writeRampFixtureWav("ssstitch_pe_ramp_22050.wav", rampSamples, 22050.0);

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
                engine.setProject(project);

                // Segment starts at t=0; render at t=0.5s, i.e. exactly halfway through the
                // segment -> expected source sample index 11025 of 22050 -> ramp value 0.5.
                const double positionBars = 0.5 / 4.0;
                std::vector<float> l(8, 0.0f), r(8, 0.0f);
                engine.renderBlock(positionBars, 44100.0, 8, l.data(), r.data());

                expectWithinAbsoluteError(l[0], 0.5f, 0.02f);

                ramp.deleteFile();
            }

            fixture.deleteFile();
        }
    };

    static PlaybackEngineTests playbackEngineTests;
}

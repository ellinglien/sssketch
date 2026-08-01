// native-engine/Source/BakeStemTests.cpp
#include "BakeStem.h"
#include "StemBufferCache.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>

namespace sssketch
{
    /** A linear ramp from ~0 to ~1 across the file, so a test can tell whether
     * a read landed near the buffer's head or its tail just from the sample
     * value — mirrors PlaybackEngineTests.cpp's identical helper (each test
     * file keeps its own copy rather than sharing one, matching this
     * codebase's existing convention). */
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

    class BakeStemTests : public juce::UnitTest
    {
    public:
        BakeStemTests() : juce::UnitTest("BakeStem") {}

        void runTest() override
        {
            beginTest("rotates so the sample at rotationSec lands at the start of the output");
            {
                // 1 second at 1000Hz, ramp 0..~1 -> sample N has value N/1000.
                // Rotating by 0.25s (sample 250) should make the output's very
                // first sample equal the source's sample 250 (~0.25).
                auto source = writeRampFixtureWav("sssketch_bake_ramp.wav", 1000, 1000.0);
                auto outFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                                   .getChildFile("sssketch_bake_out.wav");
                outFile.deleteFile();

                juce::String error;
                double durationSec = 0.0;
                const bool ok = bakeStemToWav(source.getFullPathName(), 0.25, outFile.getFullPathName(), durationSec, error);
                expect(ok, error);
                expect(outFile.existsAsFile());
                // 1000 samples at 1000Hz = 1 real second — must be measured
                // from the actual decoded/written audio, not assumed, since
                // the caller relies on this to keep the native engine's own
                // tile-boundary scheduling in sync with the real file.
                expectWithinAbsoluteError(durationSec, 1.0, 0.001);

                StemBufferCache cache;
                expect(cache.load(outFile.getFullPathName()));
                auto entry = cache.getEntry(outFile.getFullPathName());
                expect(entry.buffer != nullptr);
                expectEquals(entry.buffer->getNumSamples(), 1000);
                expectWithinAbsoluteError(entry.buffer->getSample(0, 0), 0.25f, 0.002f);
                // The tail should wrap around to what used to be the start.
                expectWithinAbsoluteError(entry.buffer->getSample(0, 999), 0.249f, 0.002f);
            }

            beginTest("wraps a rotation larger than the buffer's own length");
            {
                auto source = writeRampFixtureWav("sssketch_bake_ramp2.wav", 1000, 1000.0);
                auto outFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                                   .getChildFile("sssketch_bake_out2.wav");
                outFile.deleteFile();

                // 1.25s on a 1s-long buffer wraps to the same 0.25s rotation as
                // the test above.
                juce::String error;
                double durationSec = 0.0;
                const bool ok = bakeStemToWav(source.getFullPathName(), 1.25, outFile.getFullPathName(), durationSec, error);
                expect(ok, error);

                StemBufferCache cache;
                cache.load(outFile.getFullPathName());
                auto entry = cache.getEntry(outFile.getFullPathName());
                expectWithinAbsoluteError(entry.buffer->getSample(0, 0), 0.25f, 0.002f);
            }

            beginTest("wraps a negative rotation into the positive range");
            {
                auto source = writeRampFixtureWav("sssketch_bake_ramp3.wav", 1000, 1000.0);
                auto outFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                                   .getChildFile("sssketch_bake_out3.wav");
                outFile.deleteFile();

                // -0.25s on a 1s buffer wraps to 0.75s.
                juce::String error;
                double durationSec = 0.0;
                const bool ok = bakeStemToWav(source.getFullPathName(), -0.25, outFile.getFullPathName(), durationSec, error);
                expect(ok, error);

                StemBufferCache cache;
                cache.load(outFile.getFullPathName());
                auto entry = cache.getEntry(outFile.getFullPathName());
                expectWithinAbsoluteError(entry.buffer->getSample(0, 0), 0.75f, 0.002f);
            }

            beginTest("returns false for a nonexistent source path, without throwing");
            {
                auto outFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                                   .getChildFile("sssketch_bake_should_not_exist.wav");
                outFile.deleteFile();
                juce::String error;
                double durationSec = 0.0;
                const bool ok = bakeStemToWav("/no/such/file/at/all.wav", 0.0, outFile.getFullPathName(), durationSec, error);
                expect(!ok);
                expect(error.isNotEmpty());
                expect(!outFile.existsAsFile());
            }

            beginTest("creates missing parent directories for the output path");
            {
                auto source = writeRampFixtureWav("sssketch_bake_ramp4.wav", 100, 1000.0);
                auto outFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                                   .getChildFile("sssketch_bake_nested_dir")
                                   .getChildFile("deeper")
                                   .getChildFile("out.wav");
                outFile.getParentDirectory().deleteRecursively();

                juce::String error;
                double durationSec = 0.0;
                const bool ok = bakeStemToWav(source.getFullPathName(), 0.0, outFile.getFullPathName(), durationSec, error);
                expect(ok, error);
                expect(outFile.existsAsFile());
                outFile.getParentDirectory().getParentDirectory().deleteRecursively();
            }
        }
    };

    static BakeStemTests bakeStemTests;
}

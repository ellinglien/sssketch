// native-engine/Source/StemBufferCacheTests.cpp
#include "StemBufferCache.h"
#include <juce_core/juce_core.h>
#include <cmath>

namespace sssketch
{
    class StemBufferCacheTests : public juce::UnitTest
    {
    public:
        StemBufferCacheTests() : juce::UnitTest("StemBufferCache") {}

        void runTest() override
        {
            auto tempFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                .getChildFile("sssketch_test_fixture.wav");

            beginTest("loads a real WAV file and reports its sample data");
            {
                // Write a 0.1s, 44100Hz, mono, known-value fixture.
                juce::WavAudioFormat wavFormat;
                std::unique_ptr<juce::FileOutputStream> out(tempFile.createOutputStream());
                expect(out != nullptr);
                std::unique_ptr<juce::AudioFormatWriter> writer(
                    wavFormat.createWriterFor(out.get(), 44100.0, 1, 16, {}, 0));
                expect(writer != nullptr);
                out.release(); // writer now owns the stream

                const int numSamples = 4410;
                juce::AudioBuffer<float> source(1, numSamples);
                for (int i = 0; i < numSamples; ++i)
                    source.setSample(0, i, 0.5f);
                writer->writeFromAudioSampleBuffer(source, 0, numSamples);
                writer.reset(); // flush + close

                StemBufferCache cache;
                expect(cache.load(tempFile.getFullPathName()));
                auto* buffer = cache.get(tempFile.getFullPathName());
                expect(buffer != nullptr);
                expectEquals(buffer->getNumChannels(), 1);
                expectEquals(buffer->getNumSamples(), numSamples);
                expectWithinAbsoluteError(buffer->getSample(0, 100), 0.5f, 0.01f);
                expectWithinAbsoluteError(cache.sampleRateFor(tempFile.getFullPathName()), 44100.0, 1.0e-6);
            }

            beginTest("returns false for a nonexistent file, leaving the cache untouched");
            {
                StemBufferCache cache;
                expect(!cache.load("/no/such/file.wav"));
                expect(cache.get("/no/such/file.wav") == nullptr);
            }

            beginTest("a second load() for an already-cached path succeeds from cache, without re-reading the file");
            {
                auto recacheFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                    .getChildFile("sssketch_test_fixture_recache.wav");

                juce::WavAudioFormat wavFormat;
                std::unique_ptr<juce::FileOutputStream> out(recacheFile.createOutputStream());
                expect(out != nullptr);
                std::unique_ptr<juce::AudioFormatWriter> writer(
                    wavFormat.createWriterFor(out.get(), 44100.0, 1, 16, {}, 0));
                expect(writer != nullptr);
                out.release();

                const int numSamples = 100;
                juce::AudioBuffer<float> source(1, numSamples);
                for (int i = 0; i < numSamples; ++i)
                    source.setSample(0, i, 0.25f);
                writer->writeFromAudioSampleBuffer(source, 0, numSamples);
                writer.reset();

                StemBufferCache cache;
                expect(cache.load(recacheFile.getFullPathName()));

                // Delete the file out from under the cache: if a second load() actually
                // re-read from disk instead of returning the cached entry, this would
                // fail (createReaderFor would return nullptr for a missing file).
                recacheFile.deleteFile();

                expect(cache.load(recacheFile.getFullPathName()));
                auto* buffer = cache.get(recacheFile.getFullPathName());
                expect(buffer != nullptr);
                expectEquals(buffer->getNumSamples(), numSamples);
            }

            beginTest("loads a real Ogg Vorbis file and reports its sample data");
            {
                auto oggFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                    .getChildFile("sssketch_test_fixture.ogg");

                juce::OggVorbisAudioFormat oggFormat;
                std::unique_ptr<juce::FileOutputStream> out(oggFile.createOutputStream());
                expect(out != nullptr);
                std::unique_ptr<juce::AudioFormatWriter> writer(
                    oggFormat.createWriterFor(out.get(), 44100.0, 1, 0, {}, 6));
                expect(writer != nullptr);
                out.release(); // writer now owns the stream

                const int numSamples = 4410;
                juce::AudioBuffer<float> source(1, numSamples);
                for (int i = 0; i < numSamples; ++i)
                    source.setSample(0, i, 0.5f);
                writer->writeFromAudioSampleBuffer(source, 0, numSamples);
                writer.reset(); // flush + close

                StemBufferCache cache;
                expect(cache.load(oggFile.getFullPathName()));
                auto* buffer = cache.get(oggFile.getFullPathName());
                expect(buffer != nullptr);
                expectEquals(buffer->getNumChannels(), 1);
                // Lossy compression means the sample count and exact values won't be
                // bit-identical to the source — assert it's in the right ballpark and
                // the known-constant value survived recognizably, not an exact match.
                expect(std::abs(buffer->getNumSamples() - numSamples) < 100);
                expectWithinAbsoluteError(buffer->getSample(0, 100), 0.5f, 0.05f);

                oggFile.deleteFile();
            }

            beginTest("loads a real audio file with no file extension at all");
            {
                // Regression test for a real bug: LORE-cached stems (see the LORE
                // library browser feature) live at paths with no extension at all —
                // just the raw StemCID, e.g. ".../stem_v2/<jam>/<hex>/<stemCID>".
                // StemBufferCache::load() used to go through
                // AudioFormatManager::createReaderFor(const File&), which checks the
                // file's extension against each registered format's known
                // extensions BEFORE ever trying to decode it — so this always failed
                // silently for LORE stems even though the content was perfectly
                // valid, readable Ogg Vorbis. Arranged LORE riffs played back with
                // Web Audio previews (which sniff content, not extensions) but were
                // silent in the actual native-engine-driven arranger. Fixed by
                // switching to the stream-based createReaderFor() overload, which
                // sniffs content directly and never looks at the filename.
                auto noExtFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                    .getChildFile("sssketch_test_fixture_no_extension");

                juce::OggVorbisAudioFormat oggFormat;
                std::unique_ptr<juce::FileOutputStream> out(noExtFile.createOutputStream());
                expect(out != nullptr);
                std::unique_ptr<juce::AudioFormatWriter> writer(
                    oggFormat.createWriterFor(out.get(), 44100.0, 1, 0, {}, 6));
                expect(writer != nullptr);
                out.release();

                const int numSamples = 4410;
                juce::AudioBuffer<float> source(1, numSamples);
                for (int i = 0; i < numSamples; ++i)
                    source.setSample(0, i, 0.5f);
                writer->writeFromAudioSampleBuffer(source, 0, numSamples);
                writer.reset();

                expect(!noExtFile.getFileExtension().isNotEmpty()); // sanity: genuinely no extension

                StemBufferCache cache;
                expect(cache.load(noExtFile.getFullPathName()));
                auto* buffer = cache.get(noExtFile.getFullPathName());
                expect(buffer != nullptr);
                expectEquals(buffer->getNumChannels(), 1);
                expectWithinAbsoluteError(buffer->getSample(0, 100), 0.5f, 0.05f);

                noExtFile.deleteFile();
            }

            tempFile.deleteFile();
        }
    };

    static StemBufferCacheTests stemBufferCacheTests;
}

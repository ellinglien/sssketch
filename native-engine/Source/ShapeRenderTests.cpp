#include "ShapeRender.h"
#include "StemBufferCache.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>

namespace sssketch
{
    static juce::File writeShapeFixture(const juce::String& name, float offset = 0.0f)
    {
        auto file = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile(name);
        file.deleteFile();
        juce::WavAudioFormat wav;
        std::unique_ptr<juce::FileOutputStream> stream(file.createOutputStream());
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wav.createWriterFor(stream.get(), 1000.0, 1, 32, {}, 0));
        stream.release();
        juce::AudioBuffer<float> buffer(1, 2000);
        for (int i = 0; i < 2000; ++i)
            buffer.setSample(0, i, offset + (1.0f - offset) * (float) i / 2000.0f);
        writer->writeFromAudioSampleBuffer(buffer, 0, 2000);
        writer.reset();
        return file;
    }

    class ShapeRenderTests : public juce::UnitTest
    {
    public:
        ShapeRenderTests() : juce::UnitTest("ShapeRender") {}

        void runTest() override
        {
            beginTest("renders an identity segment to the exact requested duration");
            {
                auto source = writeShapeFixture("sssketch_shape_source.wav");
                auto output = source.getSiblingFile("sssketch_shape_identity.shape.wav");
                output.deleteFile();
                ShapeRenderInfo info;
                juce::String error;
                const bool ok = renderShapeStemToWav(
                    source.getFullPathName(), 2.0, 1.0, 120.0, 1.0,
                    { { 0.0, 1.0, 0.0 } }, output.getFullPathName(), info, error);
                expect(ok, error);
                expectEquals((int) info.frames, 2000);
                expectWithinAbsoluteError(info.durationSec, 2.0, 0.001);
                expect(output.existsAsFile());
                juce::AudioBuffer<float> decoded;
                double rate = 0.0;
                expect(decodeRawAudioFile(output.getFullPathName(), decoded, rate));
                expectWithinAbsoluteError(decoded.getSample(0, 0), 0.0f, 0.0001f);
                expectWithinAbsoluteError(decoded.getSample(0, 15), 0.0075f, 0.0001f);
                expectWithinAbsoluteError(decoded.getSample(0, 1000), 0.5f, 0.001f);
                expectWithinAbsoluteError(decoded.getSample(0, 1999), 0.0f, 0.0001f);

                StemBufferCache sourceCache;
                expect(sourceCache.load(source.getFullPathName(), 2.0));
                auto expected = sourceCache.getEntry(source.getFullPathName());
                expect(expected.buffer != nullptr);
                for (int i = 0; i < decoded.getNumSamples(); ++i)
                    expectWithinAbsoluteError(
                        decoded.getSample(0, i), expected.buffer->getSample(0, i), 0.000001f);

                // Shape's private suffix tells the ordinary playback cache
                // that this file already owns its seam. Re-loading it must
                // not apply a second, destructive blend.
                StemBufferCache replayCache;
                expect(replayCache.load(output.getFullPathName(), 2.0));
                auto replay = replayCache.getEntry(output.getFullPathName());
                expect(replay.buffer != nullptr);
                for (int i = 0; i < decoded.getNumSamples(); ++i)
                    expectWithinAbsoluteError(
                        replay.buffer->getSample(0, i), decoded.getSample(0, i), 0.000001f);
            }

            beginTest("maps a moved source interval to its destination");
            {
                auto source = writeShapeFixture("sssketch_shape_move_source.wav");
                auto output = source.getSiblingFile("sssketch_shape_move.wav");
                output.deleteFile();
                ShapeRenderInfo info;
                juce::String error;
                const bool ok = renderShapeStemToWav(
                    source.getFullPathName(), 2.0, 1.0, 120.0, 1.0,
                    { { 0.5, 0.75, 0.0 } }, output.getFullPathName(), info, error);
                expect(ok, error);
                juce::AudioBuffer<float> decoded;
                double rate = 0.0;
                expect(decodeRawAudioFile(output.getFullPathName(), decoded, rate));
                // Past the 3ms declick edge, destination time ~0.01s reads
                // from source bar ~0.505, i.e. source sample/value ~0.505.
                expectWithinAbsoluteError(decoded.getSample(0, 10), 0.505f, 0.003f);
                expectWithinAbsoluteError(decoded.getSample(0, 700), 0.0f, 0.0001f);
            }

            beginTest("renders a reversed clip from the end of its source interval");
            {
                auto source = writeShapeFixture("sssketch_shape_reverse_source.wav");
                auto output = source.getSiblingFile("sssketch_shape_reverse.shape.wav");
                output.deleteFile();
                ShapeRenderInfo info;
                juce::String error;
                const bool ok = renderShapeStemToWav(
                    source.getFullPathName(), 2.0, 1.0, 120.0, 1.0,
                    { { 0.0, 1.0, 0.0, true } }, output.getFullPathName(), info, error);
                expect(ok, error);
                juce::AudioBuffer<float> decoded;
                double rate = 0.0;
                expect(decodeRawAudioFile(output.getFullPathName(), decoded, rate));
                expectWithinAbsoluteError(decoded.getSample(0, 10), 0.994f, 0.003f);
                expectWithinAbsoluteError(decoded.getSample(0, 1000), 0.499f, 0.003f);
            }

            beginTest("heals every natural repeat boundary while rendering in reverse");
            {
                auto source = writeShapeFixture("sssketch_shape_reverse_repeats_source.wav");
                auto output = source.getSiblingFile("sssketch_shape_reverse_repeats.shape.wav");
                output.deleteFile();
                ShapeRenderInfo info;
                juce::String error;
                const bool ok = renderShapeStemToWav(
                    source.getFullPathName(), 2.0, 1.0, 120.0, 4.0,
                    { { 0.0, 4.0, 0.0, true } }, output.getFullPathName(), info, error);
                expect(ok, error);
                juce::AudioBuffer<float> decoded;
                double rate = 0.0;
                expect(decodeRawAudioFile(output.getFullPathName(), decoded, rate));
                expectEquals(decoded.getNumSamples(), 8000);
                for (const int boundary : { 2000, 4000, 6000 })
                {
                    const float jump = std::abs(
                        decoded.getSample(0, boundary) - decoded.getSample(0, boundary - 1));
                    expect(jump < 0.35f, "reverse repeat seam was not healed");
                }
            }

            beginTest("repeating an already-sewn Shape source is sample-identical");
            {
                auto raw = writeShapeFixture("sssketch_shape_once_raw.wav");
                auto sewn = raw.getSiblingFile("sssketch_shape_once.shape.wav");
                auto repeated = raw.getSiblingFile("sssketch_shape_repeated.shape.wav");
                sewn.deleteFile();
                repeated.deleteFile();
                ShapeRenderInfo info;
                juce::String error;
                expect(renderShapeStemToWav(
                    raw.getFullPathName(), 2.0, 1.0, 120.0, 1.0,
                    { { 0.0, 1.0, 0.0 } }, sewn.getFullPathName(), info, error), error);
                error.clear();
                expect(renderShapeStemToWav(
                    sewn.getFullPathName(), 2.0, 1.0, 120.0, 4.0,
                    { { 0.0, 4.0, 0.0 } }, repeated.getFullPathName(), info, error), error);

                juce::AudioBuffer<float> once, fourTimes;
                double onceRate = 0.0, repeatedRate = 0.0;
                expect(decodeRawAudioFile(sewn.getFullPathName(), once, onceRate));
                expect(decodeRawAudioFile(repeated.getFullPathName(), fourTimes, repeatedRate));
                expectEquals(fourTimes.getNumSamples(), once.getNumSamples() * 4);
                for (int i = 0; i < fourTimes.getNumSamples(); ++i)
                    expectWithinAbsoluteError(
                        fourTimes.getSample(0, i),
                        once.getSample(0, i % once.getNumSamples()),
                        0.000001f);
            }

            beginTest("rejects missing and overlapping source material");
            {
                auto output = juce::File::getSpecialLocation(juce::File::tempDirectory)
                                  .getChildFile("sssketch_shape_invalid.wav");
                ShapeRenderInfo info;
                juce::String error;
                expect(!renderShapeStemToWav(
                    "/missing/source.wav", 2.0, 1.0, 120.0, 1.0,
                    { { 0.0, 1.0, 0.0 } }, output.getFullPathName(), info, error));

                auto source = writeShapeFixture("sssketch_shape_overlap_source.wav");
                error.clear();
                expect(!renderShapeStemToWav(
                    source.getFullPathName(), 4.0, 1.0, 120.0, 1.0,
                    { { 0.0, 1.0, 0.0 } }, output.getFullPathName(), info, error));

                error.clear();
                expect(!renderShapeStemToWav(
                    source.getFullPathName(), 2.0, 1.0, 120.0, 1.0,
                    { { 0.0, 0.75, 0.0 }, { 0.0, 0.5, 0.5 } },
                    output.getFullPathName(), info, error));
            }

            beginTest("a fractional source wrap never heals backward into a destination gap");
            {
                auto source = writeShapeFixture("sssketch_shape_fractional_wrap_source.wav", 0.25f);
                auto output = source.getSiblingFile("sssketch_shape_fractional_wrap.wav");
                output.deleteFile();
                ShapeRenderInfo info;
                juce::String error;
                const bool ok = renderShapeStemToWav(
                    source.getFullPathName(), 2.0, 1.0, 120.0, 2.0,
                    { { 0.99, 1.01, 1.0 } }, output.getFullPathName(), info, error);
                expect(ok, error);
                juce::AudioBuffer<float> decoded;
                double rate = 0.0;
                expect(decodeRawAudioFile(output.getFullPathName(), decoded, rate));
                expectWithinAbsoluteError(decoded.getSample(0, 1999), 0.0f, 0.0001f);
                expectWithinAbsoluteError(decoded.getSample(0, 2100), 0.0f, 0.0001f);
            }

            beginTest("nearest-sample rounding wraps the musical endpoint to sample zero");
            {
                auto source = writeShapeFixture("sssketch_shape_endpoint_source.wav");
                auto output = source.getSiblingFile("sssketch_shape_endpoint.wav");
                output.deleteFile();
                ShapeRenderInfo info;
                juce::String error;
                const bool ok = renderShapeStemToWav(
                    source.getFullPathName(), 2.0, 1.0, 120.0, 2.0,
                    { { 0.0004, 1.5, 0.0 } }, output.getFullPathName(), info, error);
                expect(ok, error);
                expect(output.existsAsFile());
                expectEquals((int) info.frames, 4000);
            }

            beginTest("fractional output length never heals an outer seam backward into a gap");
            {
                auto source = writeShapeFixture("sssketch_shape_fractional_output_source.wav", 0.25f);
                auto output = source.getSiblingFile("sssketch_shape_fractional_output.shape.wav");
                output.deleteFile();
                ShapeRenderInfo info;
                juce::String error;
                const bool ok = renderShapeStemToWav(
                    source.getFullPathName(), 2.0, 1.0, 123.0, 2.0,
                    { { 0.0, 0.02, 0.0 }, { 0.0, 0.02, 1.98 } },
                    output.getFullPathName(), info, error);
                expect(ok, error);
                juce::AudioBuffer<float> decoded;
                double rate = 0.0;
                expect(decodeRawAudioFile(output.getFullPathName(), decoded, rate));
                expectEquals(decoded.getNumSamples(), 3903);
                for (int i = 3775; i <= 3862; ++i)
                    expectWithinAbsoluteError(decoded.getSample(0, i), 0.0f, 0.000001f);
            }
        }
    };

    static ShapeRenderTests shapeRenderTests;
}

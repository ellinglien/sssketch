#include "ShapeRender.h"
#include "StemBufferCache.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>
#include <tuple>

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
            beginTest("Raw resampling skips and repeats exact source samples without interpolation");
            {
                auto source = writeShapeFixture("sssketch_shape_raw_source.wav");
                auto fast = source.getSiblingFile("sssketch_shape_raw_fast.wav");
                auto slow = source.getSiblingFile("sssketch_shape_raw_slow.wav");
                ShapeRenderInfo info;
                juce::String error;
                expect(renderShapeRawSourceToWav(
                    source.getFullPathName(), 2.0, fast.getFullPathName(), info, error), error);
                expectEquals((int) info.frames, 1000);
                juce::AudioBuffer<float> fastAudio;
                double sampleRate = 0.0;
                expect(decodeRawAudioFile(fast.getFullPathName(), fastAudio, sampleRate));
                expectWithinAbsoluteError(fastAudio.getSample(0, 250), 0.25f, 0.0001f);

                error.clear();
                expect(renderShapeRawSourceToWav(
                    source.getFullPathName(), 0.5, slow.getFullPathName(), info, error), error);
                expectEquals((int) info.frames, 4000);
                juce::AudioBuffer<float> slowAudio;
                expect(decodeRawAudioFile(slow.getFullPathName(), slowAudio, sampleRate));
                expectWithinAbsoluteError(slowAudio.getSample(0, 0), slowAudio.getSample(0, 1), 0.000001f);
                expect(slowAudio.getSample(0, 2) > slowAudio.getSample(0, 1));
            }

            beginTest("Wavefold keeps duration and folds driven samples with a dry-wet blend");
            {
                auto source = writeShapeFixture("sssketch_shape_wavefold_source.wav");
                auto output = source.getSiblingFile("sssketch_shape_wavefold.wav");
                ShapeRenderInfo info;
                juce::String error;
                expect(renderShapeProcessSourceToWav(
                    source.getFullPathName(), "wavefold", 3.0, 0.0, 0.0, 0.5,
                    output.getFullPathName(), info, error), error);
                expectEquals((int) info.frames, 2000);
                juce::AudioBuffer<float> audio;
                double sampleRate = 0.0;
                expect(decodeRawAudioFile(output.getFullPathName(), audio, sampleRate));
                expectWithinAbsoluteError(audio.getSample(0, 500), 0.5f, 0.002f);
                expectWithinAbsoluteError(audio.getSample(0, 1500), 0.25f, 0.002f);
            }

            beginTest("every Shape treatment renders deterministically at the source duration");
            {
                auto source = writeShapeFixture("sssketch_shape_process_source.wav", -0.5f);
                const std::vector<std::tuple<juce::String, double, double, double, juce::String>> cases {
                    { "saturation", 4.0, 0.25, 0.0, "sat" },
                    { "hard-clip", 0.5, -0.4, 0.0, "clip" },
                    { "rectify", 1.0, 2.0, 0.0, "rect" },
                    { "bit-crush", 6.0, 0.5, 0.0, "bits" },
                    { "rate-crush", 8.0, 0.5, 0.0, "rate" },
                    { "ring-mod", 37.0, 0.5, 0.0, "ring" },
                    { "comb", 12.0, 0.5, 0.6, "comb" },
                    { "smear", 80.0, 0.5, 0.0, "smear" }
                };
                for (const auto& [type, primary, secondary, tertiary, suffix] : cases)
                {
                    auto output = source.getSiblingFile("sssketch_shape_process_" + suffix + ".wav");
                    ShapeRenderInfo info;
                    juce::String error;
                    expect(renderShapeProcessSourceToWav(
                        source.getFullPathName(), type, primary, secondary, tertiary, 1.0,
                        output.getFullPathName(), info, error), type + ": " + error);
                    expectEquals((int) info.frames, 2000, type);
                    juce::AudioBuffer<float> audio;
                    double sampleRate = 0.0;
                    expect(decodeRawAudioFile(output.getFullPathName(), audio, sampleRate), type);
                    expect(audio.getNumSamples() == 2000, type);
                    bool changed = false;
                    juce::AudioBuffer<float> original;
                    expect(decodeRawAudioFile(source.getFullPathName(), original, sampleRate), type);
                    for (int frame = 0; frame < audio.getNumSamples(); frame += 17)
                        changed = changed || std::abs(
                            audio.getSample(0, frame) - original.getSample(0, frame)) > 0.0001f;
                    expect(changed, type + " should alter the source");
                }
            }

            beginTest("Saturation output trim follows decibels");
            {
                auto source = writeShapeFixture("sssketch_shape_saturation_output_source.wav", -0.5f);
                auto unityOutput = source.getSiblingFile("sssketch_shape_saturation_output_unity.wav");
                auto quietOutput = source.getSiblingFile("sssketch_shape_saturation_output_quiet.wav");
                ShapeRenderInfo info;
                juce::String error;
                expect(renderShapeProcessSourceToWav(
                    source.getFullPathName(), "saturation", 4.0, 0.0, 0.0, 1.0,
                    unityOutput.getFullPathName(), info, error), error);
                error.clear();
                expect(renderShapeProcessSourceToWav(
                    source.getFullPathName(), "saturation", 4.0, 0.0, -6.0, 1.0,
                    quietOutput.getFullPathName(), info, error), error);
                juce::AudioBuffer<float> unityAudio;
                juce::AudioBuffer<float> quietAudio;
                double sampleRate = 0.0;
                expect(decodeRawAudioFile(unityOutput.getFullPathName(), unityAudio, sampleRate));
                expect(decodeRawAudioFile(quietOutput.getFullPathName(), quietAudio, sampleRate));
                const float unitySample = unityAudio.getSample(0, 250);
                const float quietSample = quietAudio.getSample(0, 250);
                expect(std::abs(unitySample) > 0.01f);
                expectWithinAbsoluteError(
                    quietSample / unitySample,
                    (float) std::pow(10.0, -6.0 / 20.0),
                    0.002f);
            }

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

            beginTest("routes each clip to its selected processed source");
            {
                auto dry = writeShapeFixture("sssketch_shape_multi_dry.wav");
                auto pitched = writeShapeFixture("sssketch_shape_multi_pitched.wav", 0.75f);
                auto output = dry.getSiblingFile("sssketch_shape_multi.shape.wav");
                output.deleteFile();
                ShapeRenderInfo info;
                juce::String error;
                const bool ok = renderShapeStemToWav(
                    {
                        { dry.getFullPathName(), 2.0 },
                        { pitched.getFullPathName(), 2.0 }
                    },
                    1.0, 120.0, 1.0,
                    {
                        { 0.0, 0.5, 0.0, false, 0 },
                        { 0.0, 0.5, 0.5, false, 1 }
                    },
                    output.getFullPathName(), info, error);
                expect(ok, error);
                juce::AudioBuffer<float> decoded;
                double rate = 0.0;
                expect(decodeRawAudioFile(output.getFullPathName(), decoded, rate));
                expectWithinAbsoluteError(decoded.getSample(0, 500), 0.25f, 0.003f);
                expectWithinAbsoluteError(decoded.getSample(0, 1500), 0.8125f, 0.003f);
            }

            beginTest("uses each processed source's transformed musical length");
            {
                auto source = writeShapeFixture("sssketch_shape_rate_source.wav");
                auto output = source.getSiblingFile("sssketch_shape_rate.shape.wav");
                output.deleteFile();
                ShapeRenderInfo info;
                juce::String error;
                const bool ok = renderShapeStemToWav(
                    { { source.getFullPathName(), 2.0, 0.5 } },
                    1.0, 120.0, 1.0,
                    { { 0.0, 0.5, 0.0, false, 0 } },
                    output.getFullPathName(), info, error);
                expect(ok, error);
                juce::AudioBuffer<float> decoded;
                double rate = 0.0;
                expect(decodeRawAudioFile(output.getFullPathName(), decoded, rate));
                // 0.25 transformed bars is halfway through this source's
                // 0.5-bar musical tile, i.e. halfway through its WAV.
                expectWithinAbsoluteError(decoded.getSample(0, 500), 0.5f, 0.003f);
                expectWithinAbsoluteError(decoded.getSample(0, 1500), 0.0f, 0.0001f);
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

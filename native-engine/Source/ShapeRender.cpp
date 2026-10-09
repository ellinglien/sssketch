#include "ShapeRender.h"
#include "StemBufferCache.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <algorithm>
#include <cmath>
#include <limits>

namespace sssketch
{
    static constexpr double kEdgeFadeSec = 0.003;
    static constexpr double kEps = 1.0e-9;

    static bool finitePositive(double value)
    {
        return std::isfinite(value) && value > 0.0;
    }

    static void healShapeSeam(
        juce::AudioBuffer<float>& buffer,
        int boundaryFrame,
        int targetFrame,
        int availableTailFrames,
        int preferredWindowSize = 128)
    {
        if (availableTailFrames <= preferredWindowSize * 2)
            return;
        const int windowSize = preferredWindowSize;
        if (boundaryFrame < windowSize || targetFrame < 0
            || targetFrame >= buffer.getNumSamples() || boundaryFrame > buffer.getNumSamples())
            return;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            auto* data = buffer.getWritePointer(ch);
            const float target = data[targetFrame];
            for (int i = 0; i < windowSize; ++i)
            {
                const int tailIndex = boundaryFrame - 1 - i;
                const double t = -1.0 + ((double) i / (double) windowSize) * 2.0;
                const float coefficient = (float) std::sqrt(0.5 * (1.0 - t));
                data[tailIndex] += (target - data[tailIndex]) * coefficient;
            }
        }
    }

    bool renderShapeStemToWav(
        const juce::String& sourcePath,
        double sourceDurationSec,
        double sourceBarLength,
        double targetBpm,
        double loopBars,
        const std::vector<ShapeRenderSegment>& segments,
        const juce::String& outputPath,
        ShapeRenderInfo& infoOut,
        juce::String& errorOut)
    {
        if (!finitePositive(sourceDurationSec) || !finitePositive(sourceBarLength)
            || !finitePositive(targetBpm) || !finitePositive(loopBars))
        {
            errorOut = "invalid Shape timing metadata";
            return false;
        }

        juce::AudioBuffer<float> source;
        double sampleRate = 0.0;
        if (!decodeRawAudioFile(sourcePath, source, sampleRate))
        {
            errorOut = "failed to decode Shape source: " + sourcePath;
            return false;
        }
        if (!finitePositive(sampleRate) || source.getNumSamples() <= 0 || source.getNumChannels() <= 0)
        {
            errorOut = "Shape source decoded to an empty buffer: " + sourcePath;
            return false;
        }
        const double decodedDurationSec = (double) source.getNumSamples() / sampleRate;
        const double durationToleranceSec = std::max(0.05, sourceDurationSec * 0.02);
        if (std::abs(decodedDurationSec - sourceDurationSec) > durationToleranceSec)
        {
            errorOut = "Shape source duration does not match decoded audio";
            return false;
        }
        const int musicalSourceFrames = (int) std::llround(sourceDurationSec * sampleRate);
        if (musicalSourceFrames <= 0 || musicalSourceFrames > source.getNumSamples())
        {
            errorOut = "Shape musical source length exceeds decoded audio";
            return false;
        }

        const double secPerBar = 240.0 / targetBpm;
        const double exactFrames = loopBars * secPerBar * sampleRate;
        if (!std::isfinite(exactFrames) || exactFrames <= 0.0
            || exactFrames > (double) std::numeric_limits<int>::max())
        {
            errorOut = "invalid Shape output length";
            return false;
        }
        const int frames = (int) std::ceil(exactFrames);
        const int channels = source.getNumChannels();
        const bool sourceAlreadySewn =
            sourcePath.endsWithIgnoreCase(".shape.wav")
            || sourcePath.endsWithIgnoreCase(".shape-preview.wav");
        juce::AudioBuffer<float> output(channels, frames);
        output.clear();
        std::vector<std::pair<int, int>> tiledSourceSeams;
        int outputTailStartFrame = 0;
        const bool hasAudioAtLoopStart =
            !segments.empty() && std::abs(segments.front().destStartBars) <= kEps;
        const bool hasAudioAtLoopEnd = !segments.empty()
            && std::abs(
                segments.back().destStartBars
                + segments.back().sourceEndBars
                - segments.back().sourceStartBars
                - loopBars) <= kEps;

        double previousEnd = -1.0;
        for (const auto& segment : segments)
        {
            if (!std::isfinite(segment.sourceStartBars)
                || !std::isfinite(segment.sourceEndBars)
                || !std::isfinite(segment.destStartBars)
                || segment.sourceStartBars < 0.0
                || segment.sourceEndBars <= segment.sourceStartBars + kEps
                || segment.sourceEndBars > loopBars + kEps
                || segment.destStartBars < 0.0)
            {
                errorOut = "invalid Shape fragment coordinates";
                return false;
            }
            const double lengthBars = segment.sourceEndBars - segment.sourceStartBars;
            const double destEndBars = segment.destStartBars + lengthBars;
            if (destEndBars > loopBars + kEps || segment.destStartBars < previousEnd - kEps)
            {
                errorOut = "overlapping or out-of-range Shape fragments";
                return false;
            }
            previousEnd = destEndBars;

            const int destStart = std::max(0, (int) std::llround(segment.destStartBars * secPerBar * sampleRate));
            const bool reachesOutputEnd = std::abs(destEndBars - loopBars) <= kEps;
            // The buffer is ceil-sized so fractional musical durations have
            // room for their final sample. A fragment that reaches the
            // musical loop edge owns that final frame even when round(exact)
            // is one smaller than ceil(exact).
            const int destEnd = reachesOutputEnd
                ? frames
                : std::min(frames, (int) std::llround(destEndBars * secPerBar * sampleRate));
            const int segmentFrames = destEnd - destStart;
            if (segmentFrames <= 0)
            {
                errorOut = "Shape fragment is shorter than one output sample";
                return false;
            }
            const int fadeFrames = std::min(
                segmentFrames / 2,
                std::max(1, (int) std::llround(kEdgeFadeSec * sampleRate)));
            // Preserve an untouched lane sample-for-sample. The playback
            // engine already sews the outer loop boundary; Shape only adds
            // a declick fade at a newly-created INTERNAL discontinuity.
            const bool fadeIn = segment.destStartBars > kEps || !hasAudioAtLoopEnd;
            const bool fadeOut = destEndBars < loopBars - kEps || !hasAudioAtLoopStart;

            // Ordinary playback loop-sews every source tile once. Record
            // the same internal wrap points here so a short source repeated
            // inside a longer Shape lane cannot acquire new clicks.
            int sourceTileStartFrame = destStart;
            double sourceWrap = segment.reversed
                ? std::floor((segment.sourceEndBars - kEps) / sourceBarLength) * sourceBarLength
                : (std::floor(segment.sourceStartBars / sourceBarLength) + 1.0) * sourceBarLength;
            const auto hasAnotherWrap = [&]() {
                return segment.reversed
                    ? sourceWrap > segment.sourceStartBars + kEps
                    : sourceWrap < segment.sourceEndBars - kEps;
            };
            while (hasAnotherWrap())
            {
                const double wrapDestBars = segment.reversed
                    ? segment.destStartBars + segment.sourceEndBars - sourceWrap
                    : segment.destStartBars + sourceWrap - segment.sourceStartBars;
                const int wrapFrame =
                    (int) std::llround(wrapDestBars * secPerBar * sampleRate);
                if (wrapFrame > destStart && wrapFrame < destEnd)
                {
                    if (!sourceAlreadySewn)
                        tiledSourceSeams.push_back({ wrapFrame, wrapFrame - sourceTileStartFrame });
                    sourceTileStartFrame = wrapFrame;
                }
                sourceWrap += segment.reversed ? -sourceBarLength : sourceBarLength;
            }
            if (reachesOutputEnd)
                outputTailStartFrame = sourceTileStartFrame;

            for (int i = 0; i < segmentFrames; ++i)
            {
                const double localBars = (double) i / (sampleRate * secPerBar);
                const double sampleBars = 1.0 / (sampleRate * secPerBar);
                const double sourcePosition = segment.reversed
                    ? segment.sourceEndBars - sampleBars - localBars
                    : segment.sourceStartBars + localBars;
                double sourceBar = std::fmod(sourcePosition, sourceBarLength);
                if (sourceBar < 0.0)
                    sourceBar += sourceBarLength;
                // Match PlaybackEngine's nearest-sample policy exactly.
                // sourceDurationSec is the app's true musical tile length;
                // decoded files may contain a small codec-padding tail that
                // ordinary playback intentionally never schedules.
                const double sourceTimeSec = sourceBar * (sourceDurationSec / sourceBarLength);
                int sourceSample = (int) std::llround(sourceTimeSec * sampleRate);
                if (sourceSample == musicalSourceFrames)
                    sourceSample = 0;
                if (sourceSample < 0 || sourceSample >= musicalSourceFrames)
                {
                    errorOut = "Shape fragment reads outside decoded source audio";
                    return false;
                }

                float gain = 1.0f;
                if (fadeIn && i < fadeFrames)
                    gain *= (float) i / (float) fadeFrames;
                const int fromEnd = segmentFrames - 1 - i;
                if (fadeOut && fromEnd < fadeFrames)
                    gain *= (float) fromEnd / (float) fadeFrames;
                for (int ch = 0; ch < channels; ++ch)
                    output.setSample(ch, destStart + i, source.getSample(ch, sourceSample) * gain);
            }
        }

        for (const auto& seam : tiledSourceSeams)
            healShapeSeam(output, seam.first, seam.first, seam.second);
        // The materialized file is marked as already sewn (StemBufferCache
        // recognizes Shape's private suffixes), so heal its outer loop once
        // here as well. This keeps preview and committed playback identical.
        bool outerBoundaryAlreadySewn = false;
        if (sourceAlreadySewn && hasAudioAtLoopStart && hasAudioAtLoopEnd)
        {
            const auto& first = segments.front();
            const auto& last = segments.back();
            const double firstBoundary = first.reversed ? first.sourceEndBars : first.sourceStartBars;
            const double lastBoundary = last.reversed ? last.sourceStartBars : last.sourceEndBars;
            double phaseDifference = std::fmod(lastBoundary - firstBoundary, sourceBarLength);
            if (phaseDifference < 0.0)
                phaseDifference += sourceBarLength;
            outerBoundaryAlreadySewn = phaseDifference <= kEps
                || std::abs(phaseDifference - sourceBarLength) <= kEps;
        }
        if (hasAudioAtLoopStart && hasAudioAtLoopEnd && !outerBoundaryAlreadySewn)
        {
            healShapeSeam(output, frames, 0, frames - outputTailStartFrame);
        }

        auto file = juce::File(outputPath);
        if (!file.getParentDirectory().createDirectory() && !file.getParentDirectory().isDirectory())
        {
            errorOut = "failed to create Shape output directory";
            return false;
        }
        file.deleteFile();
        juce::WavAudioFormat wav;
        std::unique_ptr<juce::FileOutputStream> stream(file.createOutputStream());
        if (stream == nullptr)
        {
            errorOut = "failed to open Shape output: " + outputPath;
            return false;
        }
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wav.createWriterFor(stream.get(), sampleRate, (unsigned int) channels, 32, {}, 0));
        if (writer == nullptr)
        {
            errorOut = "failed to create Shape float WAV writer";
            return false;
        }
        stream.release();
        if (!writer->writeFromAudioSampleBuffer(output, 0, frames))
        {
            writer.reset();
            file.deleteFile();
            errorOut = "failed while writing Shape output";
            return false;
        }
        writer.reset();

        infoOut.durationSec = (double) frames / sampleRate;
        infoOut.sampleRate = sampleRate;
        infoOut.frames = frames;
        infoOut.channels = channels;
        return true;
    }
}

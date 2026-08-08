// native-engine/Source/LoopRecorder.cpp
#include "LoopRecorder.h"
#include <algorithm>
#include <cmath>

namespace sssketch
{
    namespace
    {
        // Generous ceiling for a single take, independent of the recording
        // loop region's own length now that capture isn't tied to
        // completing a loop pass at all -- see this class's own doc
        // comment. 10 minutes at typical sample rates is comfortably more
        // than any realistic "jam a take, disarm" session, while still
        // keeping the upfront allocation modest (stereo float32 at 48kHz:
        // 2 * 10 * 60 * 48000 * 4 bytes =~ 230MB).
        constexpr double kMaxRecordingSeconds = 600.0;

        // Number of channels this recorder's own buffer/WAV output always
        // has, regardless of how many the input device actually provides --
        // see writeBlock's own doc comment on how fewer (mono) or more
        // input channels get mapped onto this.
        constexpr int kOutputChannels = 2;
    }

    LoopRecorder::LoopRecorder(double sr)
        : sampleRate(sr)
    {
        const int numSamples = std::max(1, (int) std::lround(kMaxRecordingSeconds * sampleRate));
        buffer.setSize(kOutputChannels, numSamples);
        buffer.clear();
    }

    void LoopRecorder::writeBlock(const float* const* inputChannelData, int numInputChannels,
                                   int startSample, int numSamples)
    {
        if (numInputChannels <= 0 || inputChannelData == nullptr) return;
        const int bufferSamples = buffer.getNumSamples();
        const int startPos = writePos.load(std::memory_order_relaxed);
        for (int destCh = 0; destCh < kOutputChannels; ++destCh)
        {
            // A mono (single-channel) device has its one channel duplicated
            // onto both output channels; a device with 2+ channels maps its
            // first two straight across -- see this method's own doc
            // comment.
            const int srcCh = std::min(destCh, numInputChannels - 1);
            auto* dest = buffer.getWritePointer(destCh);
            const auto* src = inputChannelData[srcCh];
            for (int i = 0; i < numSamples; ++i)
            {
                const int destIndex = startPos + i;
                if (destIndex >= bufferSamples) break; // hit the generous ceiling -- stop capturing rather than overflow; not expected in normal use
                dest[destIndex] = src[startSample + i];
            }
        }
        // Release store: publishes both the samples just written above AND
        // this new index in one handoff, so peaksSoFar's acquire load on
        // the message thread (below) can never observe the advanced index
        // without also observing the sample data that goes with it.
        writePos.store(std::min(startPos + numSamples, bufferSamples), std::memory_order_release);
    }

    std::vector<float> LoopRecorder::peaksSoFar(int numBuckets) const
    {
        std::vector<float> result(numBuckets, 0.0f);
        // Acquire load, paired with writeBlock's release store above.
        const int currentWritePos = writePos.load(std::memory_order_acquire);
        if (currentWritePos <= 0) return result;
        for (int b = 0; b < numBuckets; ++b)
        {
            const int bucketStart = (int) ((double) b / numBuckets * currentWritePos);
            const int bucketEnd = (int) ((double) (b + 1) / numBuckets * currentWritePos);
            float peak = 0.0f;
            // Peak across BOTH channels -- this is just a coarse live
            // overview bar, not a true stereo waveform, so the louder of
            // the two channels per bucket is enough.
            for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
            {
                const auto* data = buffer.getReadPointer(ch);
                for (int i = bucketStart; i < bucketEnd; ++i)
                    peak = std::max(peak, std::abs(data[i]));
            }
            result[b] = peak;
        }
        return result;
    }

    std::vector<float> LoopRecorder::peaksFixedWindow(double bucketDurationSec) const
    {
        std::vector<float> result;
        // Acquire load, paired with writeBlock's release store, same as
        // peaksSoFar above.
        const int currentWritePos = writePos.load(std::memory_order_acquire);
        if (currentWritePos <= 0 || bucketDurationSec <= 0.0) return result;

        const int samplesPerBucket = std::max(1, (int) std::lround(bucketDurationSec * sampleRate));
        const int numBuckets = currentWritePos / samplesPerBucket; // whole buckets only -- see this method's own doc comment on excluding the trailing partial one
        result.reserve((size_t) numBuckets);
        for (int b = 0; b < numBuckets; ++b)
        {
            const int start = b * samplesPerBucket;
            const int end = start + samplesPerBucket;
            float peak = 0.0f;
            // Peak across both channels -- same reasoning as peaksSoFar above.
            for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
            {
                const auto* data = buffer.getReadPointer(ch);
                for (int i = start; i < end; ++i)
                    peak = std::max(peak, std::abs(data[i]));
            }
            result.push_back(peak);
        }
        return result;
    }

    bool LoopRecorder::writeToWavFile(const juce::String& outputPath) const
    {
        juce::File outFile(outputPath);
        outFile.getParentDirectory().createDirectory();
        outFile.deleteFile();
        std::unique_ptr<juce::FileOutputStream> out(outFile.createOutputStream());
        if (out == nullptr) return false;

        juce::WavAudioFormat wavFormat;
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wavFormat.createWriterFor(out.get(), sampleRate, buffer.getNumChannels(), 16, {}, 0));
        if (writer == nullptr) return false;
        out.release(); // writer now owns the stream, matching RenderExport.cpp's own ownership handoff

        // Only what's actually been captured (writePos samples), not the
        // full pre-allocated ceiling -- the whole point of this class's
        // redesign is that a take's own real duration is whatever was
        // actually recorded, not some fixed length.
        const int samplesToWrite = writePos.load(std::memory_order_acquire);
        writer->writeFromAudioSampleBuffer(buffer, 0, samplesToWrite);
        return true;
    }
}

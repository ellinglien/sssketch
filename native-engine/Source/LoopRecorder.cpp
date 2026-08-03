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
        // keeping the upfront allocation modest (mono float32 at 48kHz:
        // 10 * 60 * 48000 * 4 bytes =~ 115MB).
        constexpr double kMaxRecordingSeconds = 600.0;
    }

    LoopRecorder::LoopRecorder(double sr)
        : sampleRate(sr)
    {
        const int numSamples = std::max(1, (int) std::lround(kMaxRecordingSeconds * sampleRate));
        buffer.setSize(1, numSamples);
        buffer.clear();
    }

    void LoopRecorder::writeBlock(const float* const* inputChannelData, int numInputChannels,
                                   int startSample, int numSamples)
    {
        if (numInputChannels <= 0 || inputChannelData == nullptr) return;
        auto* dest = buffer.getWritePointer(0);
        const int bufferSamples = buffer.getNumSamples();
        const int startPos = writePos.load(std::memory_order_relaxed);
        for (int i = 0; i < numSamples; ++i)
        {
            const int destIndex = startPos + i;
            if (destIndex >= bufferSamples) break; // hit the generous ceiling -- stop capturing rather than overflow; not expected in normal use
            // Mono downmix -- average every input channel JUCE gave us.
            // Loopback devices are commonly stereo (2ch), a mic commonly
            // mono (1ch); averaging handles both without a separate path.
            float sample = 0.0f;
            for (int ch = 0; ch < numInputChannels; ++ch)
                sample += inputChannelData[ch][startSample + i];
            sample /= (float) numInputChannels;
            dest[destIndex] = sample;
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
        const auto* data = buffer.getReadPointer(0);
        // Acquire load, paired with writeBlock's release store above.
        const int currentWritePos = writePos.load(std::memory_order_acquire);
        if (currentWritePos <= 0) return result;
        for (int b = 0; b < numBuckets; ++b)
        {
            const int bucketStart = (int) ((double) b / numBuckets * currentWritePos);
            const int bucketEnd = (int) ((double) (b + 1) / numBuckets * currentWritePos);
            float peak = 0.0f;
            for (int i = bucketStart; i < bucketEnd; ++i)
                peak = std::max(peak, std::abs(data[i]));
            result[b] = peak;
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
            wavFormat.createWriterFor(out.get(), sampleRate, 1, 16, {}, 0));
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

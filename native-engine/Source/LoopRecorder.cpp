// native-engine/Source/LoopRecorder.cpp
#include "LoopRecorder.h"
#include <algorithm>
#include <cmath>

namespace sssketch
{
    LoopRecorder::LoopRecorder(double sr, double loopLengthSeconds)
        : sampleRate(sr)
    {
        const int numSamples = std::max(1, (int) std::lround(loopLengthSeconds * sampleRate));
        buffer.setSize(1, numSamples);
        buffer.clear();
    }

    void LoopRecorder::writeBlock(const float* const* inputChannelData, int numInputChannels,
                                   int startSample, int numSamples)
    {
        if (numInputChannels <= 0 || inputChannelData == nullptr) return;
        auto* dest = buffer.getWritePointer(0);
        const int bufferSamples = buffer.getNumSamples();
        for (int i = 0; i < numSamples; ++i)
        {
            const int destIndex = writePos + i;
            if (destIndex >= bufferSamples) break; // shouldn't happen if Transport's own wrap math is correct; defensive, not a silent overwrite past the buffer's own bounds
            // Mono downmix -- average every input channel JUCE gave us.
            // Loopback devices are commonly stereo (2ch), a mic commonly
            // mono (1ch); averaging handles both without a separate path.
            float sample = 0.0f;
            for (int ch = 0; ch < numInputChannels; ++ch)
                sample += inputChannelData[ch][startSample + i];
            sample /= (float) numInputChannels;
            dest[destIndex] = sample;
        }
        writePos = std::min(writePos + numSamples, bufferSamples);
    }

    void LoopRecorder::onPassBoundary()
    {
        completedPass = writePos >= buffer.getNumSamples();
        writePos = 0;
        buffer.clear();
    }

    std::vector<float> LoopRecorder::peaksSoFar(int numBuckets) const
    {
        std::vector<float> result(numBuckets, 0.0f);
        const int totalSamples = buffer.getNumSamples();
        const auto* data = buffer.getReadPointer(0);
        for (int b = 0; b < numBuckets; ++b)
        {
            const int bucketStart = (int) ((double) b / numBuckets * totalSamples);
            const int bucketEnd = (int) ((double) (b + 1) / numBuckets * totalSamples);
            if (bucketStart >= writePos) break; // this bucket and every later one is still unwritten this pass
            float peak = 0.0f;
            for (int i = bucketStart; i < std::min(bucketEnd, writePos); ++i)
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

        writer->writeFromAudioSampleBuffer(buffer, 0, buffer.getNumSamples());
        return true;
    }
}

// native-engine/Source/BakeStem.cpp
#include "BakeStem.h"
#include "StemBufferCache.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <cmath>
#include <cstring>

namespace ssstitch
{
    bool bakeStemToWav(
        const juce::String& sourcePath,
        double rotationSec,
        const juce::String& outputPath,
        double& durationSecOut,
        juce::String& errorOut)
    {
        StemBufferCache cache;
        if (!cache.load(sourcePath))
        {
            errorOut = "failed to decode source: " + sourcePath;
            return false;
        }
        const auto entry = cache.getEntry(sourcePath);
        if (entry.buffer == nullptr)
        {
            errorOut = "no buffer for: " + sourcePath;
            return false;
        }

        const auto& source = *entry.buffer;
        const int numSamples = source.getNumSamples();
        const int numChannels = source.getNumChannels();
        if (numSamples <= 0 || numChannels <= 0)
        {
            errorOut = "source decoded to an empty buffer: " + sourcePath;
            return false;
        }

        // Wrapped into [0, numSamples) — a rotation exactly one full buffer
        // (or a negative one) must still land in range rather than reading
        // out of bounds; std::fmod alone can return a negative result for a
        // negative input, hence the second wrap.
        double rotationSamplesD = std::fmod(rotationSec * entry.sampleRate, (double) numSamples);
        if (rotationSamplesD < 0.0)
            rotationSamplesD += (double) numSamples;
        const int rotationSamples = (int) std::round(rotationSamplesD) % numSamples;

        // Circular shift: the sample at `rotationSamples` becomes sample 0.
        // Same semantics as the renderer's own rotateBuffer (BeatPicker.tsx),
        // just performed here so it can run on Ogg Vorbis source content the
        // Node-side rotateWav.ts (raw WAV byte manipulation) can't touch.
        juce::AudioBuffer<float> rotated(numChannels, numSamples);
        const int tailLength = numSamples - rotationSamples;
        for (int ch = 0; ch < numChannels; ++ch)
        {
            const float* src = source.getReadPointer(ch);
            float* dst = rotated.getWritePointer(ch);
            if (tailLength > 0)
                std::memcpy(dst, src + rotationSamples, (size_t) tailLength * sizeof(float));
            if (rotationSamples > 0)
                std::memcpy(dst + tailLength, src, (size_t) rotationSamples * sizeof(float));
        }

        juce::WavAudioFormat wavFormat;
        auto outFile = juce::File(outputPath);
        outFile.getParentDirectory().createDirectory();
        outFile.deleteFile();
        std::unique_ptr<juce::FileOutputStream> out(outFile.createOutputStream());
        if (out == nullptr)
        {
            errorOut = "failed to open output path for writing: " + outputPath;
            return false;
        }
        std::unique_ptr<juce::AudioFormatWriter> writer(wavFormat.createWriterFor(
            out.get(), entry.sampleRate, (unsigned int) numChannels, 16, {}, 0));
        if (writer == nullptr)
        {
            errorOut = "failed to create WAV writer for: " + outputPath;
            return false;
        }
        out.release();
        writer->writeFromAudioSampleBuffer(rotated, 0, numSamples);
        writer.reset();
        durationSecOut = (double) numSamples / entry.sampleRate;
        return true;
    }
}

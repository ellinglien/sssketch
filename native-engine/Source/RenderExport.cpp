// native-engine/Source/RenderExport.cpp
#include "RenderExport.h"
#include "PlaybackEngine.h"
#include "StemBufferCache.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <cmath>

namespace ssstitch
{
    bool renderProjectToWavFile(
        const EngineProject& project,
        const juce::String& outputPath,
        double durationBars,
        juce::String& errorOut)
    {
        StemBufferCache bufferCache;
        SendBus sendBus;
        PlaybackEngine engine(bufferCache, sendBus);
        engine.setProject(project);

        const double sampleRate = 44100.0;
        const double secPerBar = project.bpm > 0.0 ? (60.0 / project.bpm) * 4.0 : 0.0;
        if (secPerBar <= 0.0)
        {
            errorOut = "project has an invalid bpm";
            return false;
        }
        const int totalSamples = (int) std::ceil(durationBars * secPerBar * sampleRate);
        const int blockSize = 512;

        juce::AudioBuffer<float> output(2, juce::jmax(1, totalSamples));
        output.clear();

        for (int startSample = 0; startSample < totalSamples; startSample += blockSize)
        {
            const int numSamples = juce::jmin(blockSize, totalSamples - startSample);
            const double positionBars = (startSample / sampleRate) / secPerBar;
            engine.renderBlock(
                positionBars, sampleRate, numSamples,
                output.getWritePointer(0, startSample),
                output.getWritePointer(1, startSample));
        }

        juce::WavAudioFormat wavFormat;
        auto outFile = juce::File(outputPath);
        outFile.deleteFile();
        std::unique_ptr<juce::FileOutputStream> out(outFile.createOutputStream());
        if (out == nullptr)
        {
            errorOut = "failed to open output path for writing: " + outputPath;
            return false;
        }
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wavFormat.createWriterFor(out.get(), sampleRate, 2, 16, {}, 0));
        if (writer == nullptr)
        {
            errorOut = "failed to create WAV writer for: " + outputPath;
            return false;
        }
        out.release();
        writer->writeFromAudioSampleBuffer(output, 0, totalSamples);
        writer.reset();
        return true;
    }
}

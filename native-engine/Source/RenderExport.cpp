// native-engine/Source/RenderExport.cpp
#include "RenderExport.h"
#include "PlaybackEngine.h"
#include "StemBufferCache.h"
#include "PluginChain.h"
#include "ChannelChainRegistry.h"
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
        PlaybackEngine engine(bufferCache);
        engine.setProject(project);

        const double sampleRate = 44100.0;
        const int blockSize = 512;

        // Export has no real-time deadline, so plugins are loaded directly
        // and synchronously here rather than via PluginChain::requestLoad's
        // async hand-off (that machinery exists for live playback, where
        // blocking the audio thread on plugin instantiation would cause an
        // audible dropout).
        PluginChain masterChain(kNumMasterChainSlots);
        masterChain.setBpm(project.bpm);
        for (int slot = 0; slot < kNumMasterChainSlots; ++slot)
        {
            const auto& path = project.masterChain[(size_t) slot].path;
            juce::String slotError;
            if (!masterChain.loadPluginSync(slot, path, sampleRate, blockSize, slotError))
            {
                errorOut = "master chain slot " + juce::String(slot) + " failed to load: " + slotError;
                return false;
            }
        }

        // Same reasoning as the master chain above -- export builds its own
        // throwaway per-channel chains synchronously, no ChannelChainRegistry
        // atomic-swap machinery needed since there's no concurrent audio
        // thread to protect against during a one-shot offline render.
        ChannelChainRegistry::ChannelChainMap exportChannelChains;
        for (const auto& chainEntry : project.channelChains)
        {
            auto chain = std::make_shared<PluginChain>(kNumChannelChainSlots);
            chain->setBpm(project.bpm);
            for (int slot = 0; slot < kNumChannelChainSlots; ++slot)
            {
                const auto& path = chainEntry.slots[(size_t) slot].path;
                juce::String slotError;
                if (!chain->loadPluginSync(slot, path, sampleRate, blockSize, slotError))
                {
                    errorOut = "channel \"" + chainEntry.channelId + "\" slot " + juce::String(slot)
                        + " failed to load: " + slotError;
                    return false;
                }
            }
            exportChannelChains[chainEntry.channelId] = std::move(chain);
        }
        ChannelChainRegistry channelChainRegistry;
        channelChainRegistry.installForExport(std::move(exportChannelChains));

        const double secPerBar = project.bpm > 0.0 ? (60.0 / project.bpm) * 4.0 : 0.0;
        if (secPerBar <= 0.0)
        {
            errorOut = "project has an invalid bpm";
            return false;
        }
        const int totalSamples = (int) std::ceil(durationBars * secPerBar * sampleRate);

        juce::AudioBuffer<float> output(2, juce::jmax(1, totalSamples));
        output.clear();

        for (int startSample = 0; startSample < totalSamples; startSample += blockSize)
        {
            const int numSamples = juce::jmin(blockSize, totalSamples - startSample);
            const double positionBars = (startSample / sampleRate) / secPerBar;
            auto* l = output.getWritePointer(0, startSample);
            auto* r = output.getWritePointer(1, startSample);
            engine.renderBlock(positionBars, sampleRate, numSamples, l, r, channelChainRegistry);
            masterChain.process(numSamples, l, r);
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

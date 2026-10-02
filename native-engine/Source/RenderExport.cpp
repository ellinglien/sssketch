// native-engine/Source/RenderExport.cpp
#include "RenderExport.h"
#include "PlaybackEngine.h"
#include "StemBufferCache.h"
#include "PluginChain.h"
#include "ChannelChainRegistry.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <cmath>

namespace sssketch
{
    bool renderProjectToBuffer(
        const EngineProject& project,
        double durationBars,
        double sampleRate,
        int blockSize,
        juce::AudioBuffer<float>& output,
        juce::String& errorOut)
    {
        StemBufferCache bufferCache;
        PlaybackEngine engine(bufferCache);
        // Before setProject, so the master stage is built once, at this rate.
        engine.prepareMaster(sampleRate);
        engine.setProject(project);

        // Export has no real-time deadline, so plugins are loaded directly
        // and synchronously here rather than via PluginChain::requestLoad's
        // async hand-off (that machinery exists for live playback, where
        // blocking the audio thread on plugin instantiation would cause an
        // audible dropout).
        PluginChain masterChain(kNumMasterChainSlots);
        masterChain.setBpm(project.bpm);
        for (int slot = 0; slot < kNumMasterChainSlots; ++slot)
        {
            const auto& masterSlot = project.masterChain[(size_t) slot];
            juce::String slotError;
            if (!masterChain.loadPluginSync(
                    slot, masterSlot.path, sampleRate, blockSize, slotError, masterSlot.stateBase64))
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
                const auto& channelSlot = chainEntry.slots[(size_t) slot];
                juce::String slotError;
                if (!chain->loadPluginSync(
                        slot, channelSlot.path, sampleRate, blockSize, slotError, channelSlot.stateBase64))
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

        output.setSize(2, juce::jmax(0, totalSamples));
        output.clear();

        for (int startSample = 0; startSample < totalSamples; startSample += blockSize)
        {
            const int numSamples = juce::jmin(blockSize, totalSamples - startSample);
            const double positionBars = (startSample / sampleRate) / secPerBar;
            auto* l = output.getWritePointer(0, startSample);
            auto* r = output.getWritePointer(1, startSample);
            engine.renderBlock(positionBars, sampleRate, numSamples, l, r, channelChainRegistry);
            masterChain.setPosition(positionBars);
            masterChain.process(numSamples, l, r);
            // The radio sound's master stage, last -- after the user's plugins, exactly where
            // Transport runs it (PlaybackEngine::processMaster).
            engine.processMaster(sampleRate, numSamples, l, r);
        }
        return true;
    }

    bool renderProjectToWavFile(
        const EngineProject& project,
        const juce::String& outputPath,
        double durationBars,
        juce::String& errorOut,
        WavSampleFormat format)
    {
        const double sampleRate = 44100.0;
        juce::AudioBuffer<float> output;
        if (! renderProjectToBuffer(project, durationBars, sampleRate, 512, output, errorOut))
            return false;
        const int totalSamples = output.getNumSamples();

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
            // 32 bits is IEEE float in JUCE's WAV writer: written as is, no clamp.
            wavFormat.createWriterFor(out.get(), sampleRate, 2, format == WavSampleFormat::float32 ? 32 : 16, {}, 0));
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

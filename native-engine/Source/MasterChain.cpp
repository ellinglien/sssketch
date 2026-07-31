// native-engine/Source/MasterChain.cpp
#include "MasterChain.h"
#include "MasterChainAllowlist.h"
#include <algorithm>
#include <cmath>
#include <thread>

namespace ssstitch
{
    MasterChain::MasterChain(Instantiator inst) : instantiator(std::move(inst)) {}

    MasterChain::~MasterChain()
    {
        // Any pending instance that never got promoted is still owned here.
        // A background load still in flight at destruction time only holds
        // this object's `slots` array by reference and a plain juce::String
        // copy of the plugin id — it finishes harmlessly into a Slot that's
        // about to go away, or the process exits first. Not a concern for
        // this app's actual lifecycle (a short-lived engine process killed
        // by the parent Electron process on quit).
        for (auto& slot : slots)
            delete slot.pending.exchange(nullptr);
    }

    void MasterChain::applyPendingSwaps()
    {
        for (auto& slot : slots)
        {
            if (!slot.pendingReady.exchange(false))
                continue;
            auto* newInstance = slot.pending.exchange(nullptr);
            if (newInstance == nullptr)
                continue; // defensive: shouldn't happen if pendingReady was true
            auto old = std::move(slot.active);
            slot.active.reset(newInstance);
            slot.processChannels = std::max(
                { 2, slot.active->getTotalNumInputChannels(), slot.active->getTotalNumOutputChannels() });
            if (old != nullptr)
            {
                auto* toDelete = old.release();
                std::thread([toDelete]() { delete toDelete; }).detach();
            }
        }
    }

    void MasterChain::process(int numSamples, float* outL, float* outR)
    {
        juce::MidiBuffer midi;
        for (auto& slot : slots)
        {
            if (slot.active == nullptr)
                continue; // empty slot = passthrough, not a break in the chain

            if (slot.scratch.getNumSamples() != numSamples || slot.scratch.getNumChannels() != slot.processChannels)
                slot.scratch.setSize(slot.processChannels, numSamples, false, false, true);
            slot.scratch.clear();
            for (int i = 0; i < numSamples; ++i)
            {
                slot.scratch.setSample(0, i, outL[i]);
                slot.scratch.setSample(1, i, outR[i]);
            }

            slot.active->processBlock(slot.scratch, midi);
            midi.clear();

            for (int i = 0; i < numSamples; ++i)
            {
                // Feeds the NEXT slot in the chain — a misbehaving plugin
                // (e.g. one loaded with a sample rate/block size that
                // doesn't match what it actually receives) can produce
                // NaN/Inf. Since this is a serial chain, letting one
                // through would corrupt every downstream slot AND the
                // device output. Treat it as silence instead.
                const float l = slot.scratch.getSample(0, i);
                const float r = slot.scratch.getSample(1, i);
                outL[i] = std::isfinite(l) ? l : 0.0f;
                outR[i] = std::isfinite(r) ? r : 0.0f;
            }
        }
    }

    static std::unique_ptr<juce::AudioProcessor> instantiateFromAllowlist(
        const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)
    {
        if (pluginId.isEmpty())
        {
            errorOut = {};
            return nullptr; // "no plugin" is a valid, silent/passthrough state -- not an error
        }

        const auto* entry = findMasterChainPlugin(pluginId);
        if (entry == nullptr)
        {
            errorOut = "unknown plugin id: " + pluginId;
            return nullptr;
        }

        juce::AudioPluginFormatManager formatManager;
        formatManager.addDefaultFormats();

        juce::Array<juce::PluginDescription> found;
        for (auto* format : formatManager.getFormats())
        {
            if (!format->fileMightContainThisPluginType(entry->path))
                continue;
            juce::KnownPluginList knownPlugins;
            juce::OwnedArray<juce::PluginDescription> typesFound;
            knownPlugins.scanAndAddFile(entry->path, false, typesFound, *format);
            for (auto* desc : typesFound)
                found.add(*desc);
        }
        if (found.isEmpty())
        {
            errorOut = "plugin not found at expected path: " + juce::String(entry->path);
            return nullptr;
        }

        auto instance = formatManager.createPluginInstance(found.getReference(0), sampleRate, blockSize, errorOut);
        if (instance == nullptr)
            return nullptr;
        instance->prepareToPlay(sampleRate, blockSize);
        return instance; // AudioPluginInstance IS-A AudioProcessor
    }

    std::unique_ptr<juce::AudioProcessor> MasterChain::defaultInstantiate(
        const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)
    {
        return instantiateFromAllowlist(pluginId, sampleRate, blockSize, errorOut);
    }

    bool MasterChain::loadPluginSync(
        int slotIndex, const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)
    {
        auto instance = instantiator(pluginId, sampleRate, blockSize, errorOut);
        if (!errorOut.isEmpty())
            return false;
        auto& slot = slots[(size_t) slotIndex];
        slot.active = std::move(instance); // nullptr (empty pluginId) is a valid "no plugin" state
        slot.processChannels = slot.active != nullptr
            ? std::max({ 2, slot.active->getTotalNumInputChannels(), slot.active->getTotalNumOutputChannels() })
            : 2;
        return true;
    }

    void MasterChain::requestLoad(
        int slotIndex,
        const juce::String& pluginId,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded)
    {
        auto& slot = slots[(size_t) slotIndex];
        std::thread([this, &slot, pluginId, sampleRate, blockSize, onLoaded]()
        {
            juce::String error;
            auto instance = instantiator(pluginId, sampleRate, blockSize, error);
            const bool success = error.isEmpty();

            if (success)
            {
                auto* raw = instance.release();
                delete slot.pending.exchange(raw);
                slot.pendingReady.store(true);
            }

            if (onLoaded)
                onLoaded(success, error);
        }).detach();
    }
}

// native-engine/Source/SendBus.cpp
#include "SendBus.h"
#include "SendPluginAllowlist.h"
#include <algorithm>
#include <thread>

namespace ssstitch
{
    SendBus::SendBus(Instantiator inst) : instantiator(std::move(inst)) {}

    SendBus::~SendBus()
    {
        // Any pending instance that never got promoted is still owned here.
        // A background load still in flight at destruction time only holds
        // this object's `slots` array by reference and a plain juce::String
        // copy of the plugin id — it finishes harmlessly into a Slot that's
        // about to go away, or the process exits first. Not a concern for
        // this app's actual lifecycle (a short-lived console engine process
        // killed by the parent Electron process on quit).
        for (auto& slot : slots)
            delete slot.pending.exchange(nullptr);
    }

    void SendBus::applyPendingSwaps()
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
                // Deleting a plugin instance can do real work (its own
                // destructor tearing down resources) — never on the audio
                // thread.
                auto* toDelete = old.release();
                std::thread([toDelete]() { delete toDelete; }).detach();
            }
        }
    }

    void SendBus::beginBlock(int numSamples)
    {
        for (auto& slot : slots)
        {
            if (slot.active == nullptr)
                continue;
            if (slot.scratch.getNumSamples() != numSamples || slot.scratch.getNumChannels() != slot.processChannels)
                slot.scratch.setSize(slot.processChannels, numSamples, false, false, true);
            slot.scratch.clear();
        }
    }

    bool SendBus::hasPlugin(int busIndex) const
    {
        return slots[(size_t) busIndex].active != nullptr;
    }

    void SendBus::addSample(int busIndex, int sampleIndex, float l, float r, float sendLevel)
    {
        auto& slot = slots[(size_t) busIndex];
        if (slot.active == nullptr || sendLevel <= 0.0f)
            return;
        slot.scratch.addSample(0, sampleIndex, l * sendLevel);
        slot.scratch.addSample(1, sampleIndex, r * sendLevel);
    }

    void SendBus::mixBackInto(int numSamples, float* outL, float* outR)
    {
        juce::MidiBuffer midi;
        for (auto& slot : slots)
        {
            if (slot.active == nullptr)
                continue;
            slot.active->processBlock(slot.scratch, midi);
            midi.clear();
            for (int i = 0; i < numSamples; ++i)
            {
                outL[i] += slot.scratch.getSample(0, i);
                outR[i] += slot.scratch.getSample(1, i);
            }
        }
    }

    static std::unique_ptr<juce::AudioProcessor> instantiateFromAllowlist(
        const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)
    {
        if (pluginId.isEmpty())
        {
            errorOut = {};
            return nullptr; // "no plugin" is a valid, silent state -- not an error
        }

        const auto* entry = findSendPlugin(pluginId);
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

    std::unique_ptr<juce::AudioProcessor> SendBus::defaultInstantiate(
        const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)
    {
        return instantiateFromAllowlist(pluginId, sampleRate, blockSize, errorOut);
    }

    bool SendBus::loadPluginSync(
        int busIndex, const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)
    {
        auto instance = instantiator(pluginId, sampleRate, blockSize, errorOut);
        if (!errorOut.isEmpty())
            return false;
        auto& slot = slots[(size_t) busIndex];
        slot.active = std::move(instance); // nullptr (empty pluginId) is a valid "no plugin" state
        slot.processChannels = slot.active != nullptr
            ? std::max({ 2, slot.active->getTotalNumInputChannels(), slot.active->getTotalNumOutputChannels() })
            : 2;
        return true;
    }

    void SendBus::requestLoad(
        int busIndex,
        const juce::String& pluginId,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded)
    {
        auto& slot = slots[(size_t) busIndex];
        // A load already in flight for this bus is superseded, not queued —
        // only the newest request's result matters. The superseded thread
        // still runs to completion (a background juce::Thread can't safely
        // be cancelled mid-instantiation), but whichever publish into
        // `pending` happens last is what applyPendingSwaps() finds — the
        // atomic exchange below both publishes this thread's result and
        // safely discards whatever an in-between one left behind.
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

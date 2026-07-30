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

    // --- load/swap: implemented in Task 4 ---

    std::unique_ptr<juce::AudioProcessor> SendBus::defaultInstantiate(
        const juce::String&, double, int, juce::String& errorOut)
    {
        errorOut = "not implemented until Task 4";
        return nullptr;
    }

    void SendBus::requestLoad(int, const juce::String&, double, int, std::function<void(bool, const juce::String&)>)
    {
        // implemented in Task 4
    }

    bool SendBus::loadPluginSync(int, const juce::String&, double, int, juce::String& errorOut)
    {
        errorOut = "not implemented until Task 4";
        return false;
    }
}

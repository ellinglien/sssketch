// native-engine/Source/PluginChain.cpp
#include "PluginChain.h"
#include "PluginArchitecture.h"
#include <algorithm>
#include <cmath>
#include <thread>

namespace sssketch
{
    PluginChain::PluginChain(int numSlots, Instantiator inst, BridgeClient* bc)
        : slots(numSlots), instantiator(std::move(inst)), bridgeClient(bc) {}

    PluginChain::~PluginChain()
    {
        // Any pending load still in flight at destruction time only holds
        // this object's `slots` array by reference and a plain juce::String
        // copy of the plugin id — it finishes harmlessly into a Slot that's
        // about to go away, or the process exits first. Not a concern for
        // this app's actual lifecycle (a short-lived engine process killed
        // by the parent Electron process on quit).
        for (auto& slot : slots)
            delete slot.pending.exchange(nullptr); // PendingLoad's own dtor cleans up localInstance if set
    }

    void PluginChain::setBpm(double bpm) { playHead.setBpm(bpm); }
    void PluginChain::setPosition(double positionBars) { playHead.setPosition(positionBars); }

    void PluginChain::applyPendingSwaps()
    {
        for (auto& slot : slots)
        {
            if (!slot.pendingReady.exchange(false))
                continue;
            auto* newPending = slot.pending.exchange(nullptr);
            if (newPending == nullptr)
                continue; // defensive: shouldn't happen if pendingReady was true

            auto oldActive = std::move(slot.active);
            slot.active.reset(newPending->localInstance);
            newPending->localInstance = nullptr; // ownership moved into slot.active -- don't let PendingLoad's dtor double-delete it
            slot.bridgeSlotId = newPending->bridgeSlotId;
            delete newPending;

            if (slot.active != nullptr)
            {
                slot.active->setPlayHead(&playHead);
                slot.processChannels = std::max(
                    { 2, slot.active->getTotalNumInputChannels(), slot.active->getTotalNumOutputChannels() });
            }
            else
            {
                slot.processChannels = 2;
            }

            if (oldActive != nullptr)
            {
                auto* toDelete = oldActive.release();
                std::thread([toDelete]() { delete toDelete; }).detach();
            }
        }
    }

    void PluginChain::process(int numSamples, float* outL, float* outR)
    {
        juce::MidiBuffer midi;
        for (auto& slot : slots)
        {
            const bool isBridged = !slot.bridgeSlotId.isEmpty();
            if (slot.active == nullptr && !isBridged)
                continue; // empty slot = passthrough, not a break in the chain

            if (isBridged)
            {
                auto* channel = bridgeClient != nullptr && bridgeClient->isHealthy()
                    ? bridgeClient->channelFor(slot.bridgeSlotId)
                    : nullptr;
                if (channel == nullptr)
                {
                    // Bridge unavailable or this slot's channel is gone --
                    // see design spec's Error Handling, "bridge process
                    // dies mid-session": silence this slot's contribution,
                    // not a passthrough bypass.
                    std::fill(outL, outL + numSamples, 0.0f);
                    std::fill(outR, outR + numSamples, 0.0f);
                    continue;
                }

                if ((int) slot.bridgeInputScratch.size() != numSamples * 2)
                {
                    slot.bridgeInputScratch.resize((size_t) numSamples * 2);
                    slot.bridgeOutputScratch.resize((size_t) numSamples * 2);
                }
                for (int i = 0; i < numSamples; ++i)
                {
                    slot.bridgeInputScratch[(size_t) i * 2] = outL[i];
                    slot.bridgeInputScratch[(size_t) i * 2 + 1] = outR[i];
                }
                channel->writeInputAndSignal(slot.bridgeInputScratch.data(), (uint32_t) numSamples);

                std::fill(slot.bridgeOutputScratch.begin(), slot.bridgeOutputScratch.end(), 0.0f);
                // 5ms timeout -- a starting value from the design spec, not
                // derived from profiling. At a typical 512-sample block
                // (~11.6ms at 44.1kHz) this leaves roughly half the
                // block's period for the rest of this callback's work.
                const uint32_t got = channel->waitAndReadOutput(
                    slot.bridgeOutputScratch.data(), (uint32_t) numSamples, 5);
                if (got < (uint32_t) numSamples)
                {
                    // Timed out or got a short block -- silence for this
                    // block only, per design spec. Self-healing: the next
                    // block tries again independently, no state changes
                    // here.
                    std::fill(outL, outL + numSamples, 0.0f);
                    std::fill(outR, outR + numSamples, 0.0f);
                    continue;
                }

                for (int i = 0; i < numSamples; ++i)
                {
                    const float l = slot.bridgeOutputScratch[(size_t) i * 2];
                    const float r = slot.bridgeOutputScratch[(size_t) i * 2 + 1];
                    outL[i] = std::isfinite(l) ? l : 0.0f;
                    outR[i] = std::isfinite(r) ? r : 0.0f;
                }
                continue;
            }

            // Existing in-process path, unchanged from before this task:
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

    // No allowlist lookup anymore -- `path` is a real file path the renderer
    // already resolved from the scanned catalog (native-engine has no
    // access to pluginCatalog.json itself). Loads directly from that path.
    static std::unique_ptr<juce::AudioProcessor> instantiateFromPath(
        const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut)
    {
        if (path.isEmpty())
        {
            errorOut = {};
            return nullptr; // "no plugin" is a valid, silent/passthrough state -- not an error
        }

        juce::AudioPluginFormatManager formatManager;
        formatManager.addDefaultFormats();

        juce::Array<juce::PluginDescription> found;
        for (auto* format : formatManager.getFormats())
        {
            if (!format->fileMightContainThisPluginType(path))
                continue;
            juce::KnownPluginList knownPlugins;
            juce::OwnedArray<juce::PluginDescription> typesFound;
            knownPlugins.scanAndAddFile(path, false, typesFound, *format);
            for (auto* desc : typesFound)
                found.add(*desc);
        }
        if (found.isEmpty())
        {
            errorOut = "plugin not found at expected path: " + path;
            return nullptr;
        }

        auto instance = formatManager.createPluginInstance(found.getReference(0), sampleRate, blockSize, errorOut);
        if (instance == nullptr)
            return nullptr;
        instance->prepareToPlay(sampleRate, blockSize);
        return instance; // AudioPluginInstance IS-A AudioProcessor
    }

    std::unique_ptr<juce::AudioProcessor> PluginChain::defaultInstantiate(
        const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut)
    {
        return instantiateFromPath(path, sampleRate, blockSize, errorOut);
    }

    bool PluginChain::loadPluginSync(
        int slotIndex, const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut,
        const juce::String& stateBase64)
    {
        auto instance = instantiator(path, sampleRate, blockSize, errorOut);
        if (!errorOut.isEmpty())
            return false;
        if (instance != nullptr)
            applyStateBase64(*instance, stateBase64);
        auto& slot = slots[(size_t) slotIndex];
        slot.active = std::move(instance); // nullptr (empty pluginId) is a valid "no plugin" state
        if (slot.active != nullptr)
            slot.active->setPlayHead(&playHead);
        slot.processChannels = slot.active != nullptr
            ? std::max({ 2, slot.active->getTotalNumInputChannels(), slot.active->getTotalNumOutputChannels() })
            : 2;
        return true;
    }

    juce::String PluginChain::captureStateBase64(int slotIndex) const
    {
        const auto& slot = slots[(size_t) slotIndex];
        if (slot.active == nullptr)
            return {};
        juce::MemoryBlock block;
        slot.active->getStateInformation(block);
        return block.toBase64Encoding();
    }

    void PluginChain::applyStateBase64(juce::AudioProcessor& instance, const juce::String& stateBase64)
    {
        if (stateBase64.isEmpty())
            return;
        juce::MemoryBlock block;
        if (block.fromBase64Encoding(stateBase64))
            instance.setStateInformation(block.getData(), (int) block.getSize());
    }

    bool PluginChain::openEditorWindow(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= (int) slots.size())
            return false;
        auto& slot = slots[(size_t) slotIndex];

        if (!slot.bridgeSlotId.isEmpty())
        {
            // Bridged slot -- the actual editor window lives in the bridge
            // process (see BridgeSlot::openEditor), not here. `active` is
            // always null for a bridged slot, so without this branch the
            // no-op check below would silently swallow the request.
            if (bridgeClient != nullptr)
                bridgeClient->openEditor(slot.bridgeSlotId);
            return true;
        }

        if (slot.editorWindow != nullptr)
        {
            // Already open -- bring it to the front instead of silently doing
            // nothing, so re-clicking "edit" on a plugin whose window is
            // sitting behind others (or just lost focus) actually surfaces
            // it, matching how every other "open/focus this thing" action in
            // this app behaves. Reordering alone is sufficient here (unlike
            // an earlier version of this code, which also tried activating
            // this whole background process -- see EditorWindow's own
            // setAlwaysOnTop(true) doc comment for why that turned out to be
            // both unnecessary and unreliable): the window already stays
            // pinned above Electron's own window regardless of app
            // activation state, so this only needs to matter when several
            // always-on-top editor windows are open at once.
            slot.editorWindow->toFront(true);
            return true;
        }
        if (slot.active == nullptr || !slot.active->hasEditor())
            return true; // no-op: nothing to open

        auto* editor = slot.active->createEditorIfNeeded();
        if (editor == nullptr)
            return true;

        slot.editorWindow = std::make_unique<PluginEditorWindow>(
            slot.active->getName(), editor, [this, slotIndex]() { closeEditorWindow(slotIndex); });
        return true;
    }

    void PluginChain::closeEditorWindow(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= (int) slots.size())
            return;
        auto& slot = slots[(size_t) slotIndex];
        if (!slot.bridgeSlotId.isEmpty())
        {
            if (bridgeClient != nullptr)
                bridgeClient->closeEditor(slot.bridgeSlotId);
            return;
        }
        slot.editorWindow.reset();
    }

    void PluginChain::requestLoad(
        int slotIndex,
        const juce::String& path,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded,
        const juce::String& stateBase64)
    {
        if (bridgeClient != nullptr && !path.isEmpty() && detectPluginArchitecture(path) == "x86_64")
        {
            // Bridge-hosted plugin state capture/restore is out of scope
            // for this feature (see the design doc's own non-goals) --
            // stateBase64 is silently ignored on this branch, same as an
            // empty one would be.
            static std::atomic<int> bridgeSlotCounter { 0 };
            const auto newBridgeSlotId = "bridge-slot-" + juce::String(bridgeSlotCounter.fetch_add(1));
            bridgeClient->loadPlugin(newBridgeSlotId, path, sampleRate, blockSize,
                [this, slotIndex, newBridgeSlotId, onLoaded](bool success, const juce::String& error)
                {
                    // Runs on the message thread (BridgeClient's own
                    // callback contract, mirroring the callAsync path
                    // below) -- safe to touch `slots` directly.
                    if (success)
                    {
                        auto& slot = slots[(size_t) slotIndex];
                        auto* newPending = new PendingLoad { nullptr, newBridgeSlotId };
                        delete slot.pending.exchange(newPending);
                        slot.pendingReady.store(true);
                    }
                    if (onLoaded)
                        onLoaded(success, error);
                });
            return;
        }

        // Deliberately NOT a raw background std::thread (an earlier version
        // of this function used one, mirroring the reverted SendBus design
        // it was ported from). A real crash was found doing exactly that:
        // Solid Bus Comp's own instantiation touches macOS's HIToolbox/TSM
        // input-source APIs during init, which assert (dispatch_assert_queue)
        // that they're running on the main thread -- calling them from an
        // arbitrary background thread aborts the whole process
        // (EXC_BREAKPOINT/SIGTRAP). Not every plugin does this, but nothing
        // in this codebase can predict which ones will, so instantiation
        // must happen on the message thread. callAsync still keeps this
        // asynchronous relative to the caller (the IPC handler that
        // dispatched this returns immediately; the actual load runs on a
        // later message-loop iteration) -- it's off the audio thread, which
        // is the property that actually matters for real-time safety here,
        // just no longer off the message thread too.
        juce::MessageManager::callAsync([this, slotIndex, path, sampleRate, blockSize, onLoaded, stateBase64]()
        {
            auto& slot = slots[(size_t) slotIndex];
            juce::String error;
            auto instance = instantiator(path, sampleRate, blockSize, error);
            const bool success = error.isEmpty();

            if (success)
            {
                // Applied here, strictly before the instance is published
                // via slot.pending/pendingReady below -- the audio thread's
                // own applyPendingSwaps() is the ONLY place slot.active
                // (and therefore audio-thread visibility) ever gets set, so
                // an instance that hasn't reached that exchange yet is
                // provably not being concurrently processed. See this
                // method's own .h doc comment.
                if (instance != nullptr)
                    applyStateBase64(*instance, stateBase64);
                auto* newPending = new PendingLoad { instance.release(), {} };
                delete slot.pending.exchange(newPending);
                slot.pendingReady.store(true);
            }

            if (onLoaded)
                onLoaded(success, error);
        });
    }
}

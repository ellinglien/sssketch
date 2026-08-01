// native-engine/Source/PluginChain.cpp
#include "PluginChain.h"
#include <algorithm>
#include <cmath>
#include <thread>

namespace sssketch
{
    PluginChain::PluginChain(int numSlots, Instantiator inst) : slots(numSlots), instantiator(std::move(inst)) {}

    PluginChain::~PluginChain()
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

    void PluginChain::setBpm(double bpm) { playHead.setBpm(bpm); }

    void PluginChain::applyPendingSwaps()
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
            slot.active->setPlayHead(&playHead);
            slot.processChannels = std::max(
                { 2, slot.active->getTotalNumInputChannels(), slot.active->getTotalNumOutputChannels() });
            if (old != nullptr)
            {
                auto* toDelete = old.release();
                std::thread([toDelete]() { delete toDelete; }).detach();
            }
        }
    }

    void PluginChain::process(int numSamples, float* outL, float* outR)
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
        int slotIndex, const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut)
    {
        auto instance = instantiator(path, sampleRate, blockSize, errorOut);
        if (!errorOut.isEmpty())
            return false;
        auto& slot = slots[(size_t) slotIndex];
        slot.active = std::move(instance); // nullptr (empty pluginId) is a valid "no plugin" state
        if (slot.active != nullptr)
            slot.active->setPlayHead(&playHead);
        slot.processChannels = slot.active != nullptr
            ? std::max({ 2, slot.active->getTotalNumInputChannels(), slot.active->getTotalNumOutputChannels() })
            : 2;
        return true;
    }

    bool PluginChain::openEditorWindow(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= (int) slots.size())
            return false;
        auto& slot = slots[(size_t) slotIndex];
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

        slot.editorWindow = std::make_unique<EditorWindow>(
            slot.active->getName(), editor, [this, slotIndex]() { closeEditorWindow(slotIndex); });
        return true;
    }

    void PluginChain::closeEditorWindow(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= (int) slots.size())
            return;
        slots[(size_t) slotIndex].editorWindow.reset();
    }

    void PluginChain::requestLoad(
        int slotIndex,
        const juce::String& path,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded)
    {
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
        juce::MessageManager::callAsync([this, slotIndex, path, sampleRate, blockSize, onLoaded]()
        {
            auto& slot = slots[(size_t) slotIndex];
            juce::String error;
            auto instance = instantiator(path, sampleRate, blockSize, error);
            const bool success = error.isEmpty();

            if (success)
            {
                auto* raw = instance.release();
                delete slot.pending.exchange(raw);
                slot.pendingReady.store(true);
            }

            if (onLoaded)
                onLoaded(success, error);
        });
    }
}

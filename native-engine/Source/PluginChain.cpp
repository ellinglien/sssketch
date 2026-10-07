// native-engine/Source/PluginChain.cpp
#include "PluginChain.h"
#include "PluginArchitecture.h"
#include <algorithm>
#include <optional>
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
        //
        // Editor windows go first: JUCE requires an editor be deleted
        // before its processor.
        for (auto& slot : slots)
        {
            unwatchEdits(slot);
            slot.editorWindow.reset();
            delete slot.pending.exchange(nullptr);
            delete slot.retired.exchange(nullptr);
            delete slot.state.exchange(nullptr);
        }
    }

    void PluginChain::setBpm(double bpm) { playHead.setBpm(bpm); }
    void PluginChain::setPosition(double positionBars) { playHead.setPosition(positionBars); }

    std::unique_ptr<PluginChain::SlotState> PluginChain::makeLocalState(std::unique_ptr<juce::AudioProcessor> instance)
    {
        auto state = std::make_unique<SlotState>();
        if (instance != nullptr)
        {
            // Done here, before the audio thread can see the instance --
            // this used to happen inside applyPendingSwaps, on the audio
            // thread.
            instance->setPlayHead(&playHead);
            state->processChannels = std::max(
                { 2, instance->getTotalNumInputChannels(), instance->getTotalNumOutputChannels() });
            // Registered once, now, for the plugin's whole life (removed by
            // ~SlotState): not watching until its editor opens.
            state->editWatch = std::make_unique<EditWatch>(edited, instance->getParameters().size());
            instance->addListener(state->editWatch.get());
        }
        state->instance = std::move(instance);
        return state;
    }

    PluginChain::EditWatch::EditWatch(std::atomic<bool>& editedFlag, int numParameters)
        : edited(editedFlag),
          numParams(std::max(0, numParameters)),
          gestureUntil(std::make_unique<std::atomic<juce::uint32>[]>((size_t) std::max(1, numParameters)))
    {
        for (int i = 0; i < std::max(1, numParams); ++i)
            gestureUntil[(size_t) i].store(0);
    }

    std::atomic<juce::uint32>& PluginChain::EditWatch::gestureSlot(int index)
    {
        return index >= 0 && index < numParams ? gestureUntil[(size_t) index] : anyGestureUntil;
    }

    bool PluginChain::EditWatch::before(juce::uint32 now, juce::uint32 until)
    {
        // Wrap-safe (the counter wraps every ~49 days); 0 is "never".
        return until != 0 && (juce::int32) (until - now) > 0;
    }

    void PluginChain::EditWatch::audioProcessorParameterChangeGestureBegin(juce::AudioProcessor*, int index)
    {
        seenGesture.store(true);
        const auto until = juce::Time::getMillisecondCounter() + kLongestGestureMs;
        gestureSlot(index).store(until == 0 ? 1 : until);
    }

    void PluginChain::EditWatch::audioProcessorParameterChangeGestureEnd(juce::AudioProcessor*, int index)
    {
        const auto until = juce::Time::getMillisecondCounter() + kAfterGestureMs;
        gestureSlot(index).store(until == 0 ? 1 : until);
    }

    void PluginChain::EditWatch::audioProcessorParameterChanged(juce::AudioProcessor* processor, int index, float)
    {
        if (!watching.load())
            return;
        // Part of a gesture (a knob being turned, or just let go of): an edit.
        if (before(juce::Time::getMillisecondCounter(), gestureSlot(index).load()))
        {
            edited.store(true);
            return;
        }
        // A plugin that marks its edits with gestures: a change without one is
        // its own (a meter, its own modulation).
        if (seenGesture.load())
            return;
        // One that never does: a click in its editor lands on the message
        // thread; a change from anywhere else is the plugin's own (a VST3
        // output parameter, set from process()).
        if (!juce::MessageManager::existsAndIsCurrentThread() || processor == nullptr)
            return;
        const auto* parameter = processor->getParameters()[index];
        if (parameter == nullptr || !parameter->isAutomatable() || parameter->isMetaParameter())
            return;
        switch (parameter->getCategory())
        {
            case juce::AudioProcessorParameter::inputMeter:
            case juce::AudioProcessorParameter::outputMeter:
            case juce::AudioProcessorParameter::compressorLimiterGainReductionMeter:
            case juce::AudioProcessorParameter::expanderGateGainReductionMeter:
            case juce::AudioProcessorParameter::analysisMeter:
            case juce::AudioProcessorParameter::otherMeter:
                return;
            default:
                break;
        }
        edited.store(true);
    }

    void PluginChain::EditWatch::audioProcessorChanged(juce::AudioProcessor*, const ChangeDetails& details)
    {
        // Not latency or parameter-name changes: those are the plugin's, not an edit.
        if (watching.load() && (details.programChanged || details.nonParameterStateChanged))
            edited.store(true);
    }

    void PluginChain::applyPendingSwaps()
    {
        for (auto& slot : slots)
        {
            // The previous swap's outgoing state hasn't been collected yet:
            // with nowhere to park another one, leave this swap pending and
            // try again next block. drainRetired() empties the cell from the
            // message thread at ~30Hz, so a deferral lasts a few blocks at
            // most -- and only when two swaps land on one slot that close
            // together.
            if (slot.retired.load(std::memory_order_acquire) != nullptr)
                continue;

            auto* next = slot.pending.exchange(nullptr, std::memory_order_acq_rel);
            if (next == nullptr)
                continue;

            auto* previous = slot.state.exchange(next, std::memory_order_acq_rel);
            if (previous != nullptr)
                slot.retired.store(previous, std::memory_order_release);
        }
    }

    void PluginChain::drainRetired()
    {
        jassert(juce::MessageManager::existsAndIsCurrentThread());
        for (auto& slot : slots)
        {
            auto* retired = slot.retired.load(std::memory_order_acquire);
            if (retired == nullptr)
                continue;
            if (slot.editorFor == retired)
            {
                slot.editorWindow.reset(); // the editor must go before its processor
                slot.editorFor = nullptr;
            }
            if (slot.watchedFor == retired)
                unwatchEdits(slot);
            delete retired;
            // Only now, after the delete: the audio thread treats an
            // occupied cell as "defer", so it never parks a second state
            // here while this one is being destroyed.
            slot.retired.store(nullptr, std::memory_order_release);
        }
    }

    void PluginChain::process(int numSamples, float* outL, float* outR)
    {
        juce::MidiBuffer midi;
        for (auto& slot : slots)
        {
            const auto* state = slot.state.load(std::memory_order_acquire);
            if (state == nullptr)
                continue; // never loaded = passthrough
            const bool isBridged = state->bridgeSlotId.isNotEmpty();
            if (state->instance == nullptr && !isBridged)
                continue; // empty slot = passthrough, not a break in the chain

            if (isBridged)
            {
                // Held for the rest of this slot, not just the lookup: the
                // channel is written to and waited on below, and a
                // concurrent unloadPlugin/connectionLost would otherwise
                // destroy it mid-use. See BridgeClient::ReadScope.
                std::optional<BridgeClient::ReadScope> bridgeScope;
                if (bridgeClient != nullptr)
                    bridgeScope.emplace(*bridgeClient);
                auto* channel = bridgeClient != nullptr && bridgeClient->isHealthy()
                    ? bridgeClient->channelFor(state->bridgeSlotId)
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
            if (slot.scratch.getNumSamples() != numSamples || slot.scratch.getNumChannels() != state->processChannels)
                slot.scratch.setSize(state->processChannels, numSamples, false, false, true);
            slot.scratch.clear();
            for (int i = 0; i < numSamples; ++i)
            {
                slot.scratch.setSample(0, i, outL[i]);
                slot.scratch.setSample(1, i, outR[i]);
            }

            state->instance->processBlock(slot.scratch, midi);
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
        // nullptr (empty pluginId) is a valid "no plugin" state. Export is
        // single-threaded -- nothing else is reading this slot -- so the
        // previous state can be deleted right here.
        delete slot.state.exchange(makeLocalState(std::move(instance)).release(), std::memory_order_acq_rel);
        return true;
    }

    juce::String PluginChain::captureStateBase64(int slotIndex) const
    {
        // ONE load, then everything through it: the audio thread may swap
        // the slot at any moment, but the state loaded here can't be freed
        // until drainRetired() runs -- on this same (message) thread.
        //
        // A load the audio thread hasn't swapped in yet (slot.pending) is
        // what the slot is about to hold, and its onLoaded has already told
        // the renderer it succeeded -- which is when the renderer drops that
        // slot's saved settings. So it wins over slot.state: a capture in
        // that window (the advanced features switch going off) must not
        // read the outgoing plugin, or nothing at all. Equally safe: only
        // this (message) thread frees a pending SlotState (a newer
        // requestLoad replacing it); the audio thread only moves it into
        // slot.state.
        const auto& slot = slots[(size_t) slotIndex];
        const auto* pending = slot.pending.load(std::memory_order_acquire);
        const auto* state = pending != nullptr ? pending : slot.state.load(std::memory_order_acquire);
        if (state == nullptr || state->instance == nullptr)
            return {};
        juce::MemoryBlock block;
        state->instance->getStateInformation(block);
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
        // One load, read through for the rest of this call -- see
        // captureStateBase64 for why that is safe on the message thread.
        const auto* state = slot.state.load(std::memory_order_acquire);

        if (state != nullptr && state->bridgeSlotId.isNotEmpty())
        {
            // Bridged slot -- the actual editor window lives in the bridge
            // process (see BridgeSlot::openEditor), not here. `active` is
            // always null for a bridged slot, so without this branch the
            // no-op check below would silently swallow the request.
            if (bridgeClient != nullptr)
                bridgeClient->openEditor(state->bridgeSlotId);
            return true;
        }

        if (slot.editorWindow != nullptr && slot.editorFor != state)
        {
            // Still showing the editor of a plugin this slot has since
            // swapped away from (drainRetired would close it on its next
            // pass anyway) -- close it now and open the current one's.
            unwatchEdits(slot);
            slot.editorWindow.reset();
            slot.editorFor = nullptr;
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
        if (state == nullptr || state->instance == nullptr || !state->instance->hasEditor())
            return true; // no-op: nothing to open

        auto* editor = state->instance->createEditorIfNeeded();
        if (editor == nullptr)
            return true;

        slot.editorWindow = std::make_unique<PluginEditorWindow>(
            state->instance->getName(), editor, [this, slotIndex]() { closeEditorWindow(slotIndex); });
        slot.editorFor = state;
        watchEdits(slotIndex);
        return true;
    }

    void PluginChain::closeEditorWindow(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= (int) slots.size())
            return;
        auto& slot = slots[(size_t) slotIndex];
        const auto* state = slot.state.load(std::memory_order_acquire);
        if (state != nullptr && state->bridgeSlotId.isNotEmpty())
        {
            if (bridgeClient != nullptr)
                bridgeClient->closeEditor(state->bridgeSlotId);
            return;
        }
        unwatchEdits(slot);
        slot.editorWindow.reset();
        slot.editorFor = nullptr;
    }

    void PluginChain::watchEdits(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= (int) slots.size())
            return;
        auto& slot = slots[(size_t) slotIndex];
        const auto* state = slot.state.load(std::memory_order_acquire);
        if (slot.watchedFor == state)
            return;
        unwatchEdits(slot);
        if (state == nullptr || state->editWatch == nullptr)
            return;
        // Only a flag: the EditWatch has been registered with the plugin
        // since before it was published (makeLocalState).
        state->editWatch->watching.store(true);
        slot.watchedFor = state;
    }

    void PluginChain::unwatchEdits(Slot& slot)
    {
        if (slot.watchedFor != nullptr && slot.watchedFor->editWatch != nullptr)
            slot.watchedFor->editWatch->watching.store(false);
        slot.watchedFor = nullptr;
    }

    bool PluginChain::takeEdited()
    {
        return edited.exchange(false);
    }

    void PluginChain::requestLoad(
        int slotIndex,
        const juce::String& path,
        double sampleRate,
        int blockSize,
        LoadCallback onLoaded,
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
                    const auto previousState = captureStateBase64(slotIndex);
                    if (success)
                    {
                        auto& slot = slots[(size_t) slotIndex];
                        auto next = std::make_unique<SlotState>();
                        next->bridgeSlotId = newBridgeSlotId;
                        delete slot.pending.exchange(next.release(), std::memory_order_acq_rel);
                    }
                    if (onLoaded)
                        onLoaded(success, error, previousState);
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
            // What this load replaces, read now (not when it was requested):
            // an earlier load still in flight has landed by this point.
            const auto previousState = captureStateBase64(slotIndex);
            juce::String error;
            auto instance = instantiator(path, sampleRate, blockSize, error);
            const bool success = error.isEmpty();

            if (success)
            {
                // Applied here, strictly before the instance is published
                // via slot.pending below -- the audio thread's own
                // applyPendingSwaps() is the ONLY place slot.state (and
                // therefore audio-thread visibility) ever changes, so an
                // instance that hasn't reached that exchange yet is
                // provably not being concurrently processed. See this
                // method's own .h doc comment. A newer load replacing one
                // the audio thread hasn't taken yet deletes the older one,
                // here on the message thread.
                if (instance != nullptr)
                    applyStateBase64(*instance, stateBase64);
                delete slot.pending.exchange(makeLocalState(std::move(instance)).release(), std::memory_order_acq_rel);
            }

            if (onLoaded)
                onLoaded(success, error, previousState);
        });
    }
}

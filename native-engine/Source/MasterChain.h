// native-engine/Source/MasterChain.h
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <array>
#include <atomic>
#include <functional>
#include <memory>

namespace ssstitch
{
    static constexpr int kNumMasterChainSlots = 4;

    /** Owns up to kNumMasterChainSlots live plugin instances, processed IN
     * SERIES (slot 0 -> 1 -> 2 -> 3) over the final mixed master output. See
     * docs/superpowers/specs/2026-07-31-master-plugin-chain-design.md for
     * the full rationale — this is the master-insert-chain equivalent of
     * the reverted SendBus's parallel-send design, reusing its real-time-
     * safe load/swap pattern unchanged.
     *
     * Real-time (audio-thread) API: applyPendingSwaps(), process() — called
     * once per block, in that order, from Transport.cpp (live) or
     * RenderExport.cpp (offline, via loadPluginSync() instead of
     * requestLoad() since export has no real-time deadline).
     *
     * Off-thread API: requestLoad() (message thread, hands the actual work
     * to a background thread) and loadPluginSync() (any thread, blocking —
     * export path only, where nothing concurrently reads a slot from an
     * audio callback). */
    class MasterChain
    {
    public:
        /** A plugin id -> live processor instance factory. Production code
         * uses the default (the real allowlist + AudioPluginFormatManager,
         * see .cpp); tests inject a fake to exercise the swap/processing
         * logic without depending on a real installed plugin. An empty
         * `pluginId` must return nullptr with `errorOut` left empty (not an
         * error — "no plugin" is a valid, silent/passthrough state). */
        using Instantiator = std::function<std::unique_ptr<juce::AudioProcessor>(
            const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)>;

        explicit MasterChain(Instantiator instantiator = &MasterChain::defaultInstantiate);
        ~MasterChain();

        MasterChain(const MasterChain&) = delete;
        MasterChain& operator=(const MasterChain&) = delete;

        /** Message-thread API: kicks off loading `pluginId` (an allowlist
         * id, or an empty string for "no plugin") onto `slotIndex` on a
         * background thread. Safe to call again before a previous load for
         * the same slot finishes — whichever completes last wins (see
         * .cpp). `onLoaded` runs on that background thread once the load
         * finishes or fails; callers needing the message thread (e.g. to
         * send an IPC reply) must hop back to it themselves. */
        void requestLoad(
            int slotIndex,
            const juce::String& pluginId,
            double sampleRate,
            int blockSize,
            std::function<void(bool success, const juce::String& error)> onLoaded);

        /** Synchronous, blocking load — offline export only, where nothing
         * concurrently reads this slot from an audio thread. Returns false
         * (errorOut set) on failure, leaving the slot unchanged. */
        bool loadPluginSync(
            int slotIndex, const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut);

        /** Audio-thread API: promotes any slot with a ready pending swap to
         * active; the instance it replaces is handed to a background
         * cleanup thread rather than deleted here (a plugin's destructor
         * can do real work). Call once per block, before process(). */
        void applyPendingSwaps();

        /** Audio-thread API: runs outL/outR through every loaded slot's
         * plugin in series (slot 0 first), dropping any non-finite
         * (NaN/Inf) sample after each slot so one misbehaving plugin can't
         * corrupt the rest of the chain or the device output. An empty
         * slot is skipped (pure passthrough). Call once per device
         * callback, on the FINAL mixed output buffer for that callback —
         * not per PlaybackEngine::renderBlock call, since a callback can
         * split across multiple renderBlock calls at a loop boundary. */
        void process(int numSamples, float* outL, float* outR);

        /** Message-thread API: opens a DocumentWindow hosting slotIndex's
         * plugin's own AudioProcessorEditor, if that slot has a plugin
         * loaded and doesn't already have an open window. No-op (not an
         * error) if the slot is empty, already has a window open, or the
         * plugin reports no editor -- mirrors this app's existing
         * "silently do nothing" convention for a redundant UI action (e.g.
         * re-clicking an already-selected rifff). Returns false only if
         * slotIndex is out of range. */
        bool openEditorWindow(int slotIndex);

        /** Message-thread API: closes slotIndex's editor window if one is
         * open. The underlying plugin instance keeps loaded and processing
         * either way -- closing the editor is purely a UI action. No-op if
         * no window is open for that slot. */
        void closeEditorWindow(int slotIndex);

    private:
        static std::unique_ptr<juce::AudioProcessor> defaultInstantiate(
            const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut);

        // Mirrors the concrete DocumentWindow-hosting-an-AudioProcessorEditor
        // pattern used by JUCE's own AudioPluginHost example (see
        // extras/AudioPluginHost/Source/UI/PluginWindow.h), simplified to
        // this app's actual needs (no resizable-editor constrainer, no
        // per-window-type variants -- always the plugin's own "normal"
        // editor, never the generic parameter-list fallback).
        class EditorWindow : public juce::DocumentWindow
        {
        public:
            EditorWindow(const juce::String& name, juce::AudioProcessorEditor* editor, std::function<void()> onClosed)
                : juce::DocumentWindow(name, juce::Colours::darkgrey, juce::DocumentWindow::closeButton),
                  onClosedCallback(std::move(onClosed))
            {
                setUsingNativeTitleBar(true);
                setContentOwned(editor, true);
                setResizable(editor->isResizable(), false);
                centreWithSize(getWidth(), getHeight());
                setVisible(true);
            }
            void closeButtonPressed() override
            {
                if (onClosedCallback)
                    onClosedCallback();
            }

        private:
            std::function<void()> onClosedCallback;
        };

        struct Slot
        {
            std::unique_ptr<juce::AudioProcessor> active;
            int processChannels = 2; // max(active's total input, total output) once a plugin is loaded
            std::atomic<juce::AudioProcessor*> pending { nullptr };
            std::atomic<bool> pendingReady { false };
            juce::AudioBuffer<float> scratch;
            std::unique_ptr<EditorWindow> editorWindow;
        };

        std::array<Slot, kNumMasterChainSlots> slots;
        Instantiator instantiator;
    };
}

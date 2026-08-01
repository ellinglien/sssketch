// native-engine/Source/PluginChain.h
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <atomic>
#include <functional>
#include <memory>
#include <vector>

namespace ssstitch
{
    static constexpr int kNumMasterChainSlots = 4;
    static constexpr int kNumChannelChainSlots = 2;

    /** Owns N live plugin instances (N set at construction), processed IN
     * SERIES (slot 0 -> 1 -> ...) over whatever buffer process() is given.
     * Used both for the fixed-4-slot master bus chain and for per-channel
     * 2-slot chains (see ChannelChainRegistry) -- the class itself has no
     * "master" or "channel" semantics baked in, just "an ordered plugin
     * chain." See docs/superpowers/specs/2026-07-31-master-plugin-chain-design.md
     * and docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md.
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
    class PluginChain
    {
    public:
        /** A plugin file path -> live processor instance factory. Production
         * code uses the default (real AudioPluginFormatManager loading, see
         * .cpp); tests inject a fake to exercise the swap/processing logic
         * without depending on a real installed plugin. An empty `path`
         * must return nullptr with `errorOut` left empty (not an error —
         * "no plugin" is a valid, silent/passthrough state). There is no
         * longer a hardcoded allowlist to resolve an id through — the
         * renderer resolves a scanned catalog id to a real path itself
         * (native-engine has no access to pluginCatalog.json) and sends the
         * path directly. */
        using Instantiator = std::function<std::unique_ptr<juce::AudioProcessor>(
            const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut)>;

        explicit PluginChain(int numSlots, Instantiator instantiator = &PluginChain::defaultInstantiate);
        ~PluginChain();

        PluginChain(const PluginChain&) = delete;
        PluginChain& operator=(const PluginChain&) = delete;

        /** Message-thread API: kicks off loading the plugin at `path` (or an
         * empty string for "no plugin") onto `slotIndex`. Safe to call again
         * before a previous load for the same slot finishes — whichever
         * completes last wins (see .cpp). `onLoaded` runs on the message
         * thread once the load finishes or fails (see requestLoad's own
         * .cpp doc comment for why instantiation happens there and not on a
         * raw background thread). */
        void requestLoad(
            int slotIndex,
            const juce::String& path,
            double sampleRate,
            int blockSize,
            std::function<void(bool success, const juce::String& error)> onLoaded);

        /** Synchronous, blocking load — offline export only, where nothing
         * concurrently reads this slot from an audio thread. Returns false
         * (errorOut set) on failure, leaving the slot unchanged. */
        bool loadPluginSync(
            int slotIndex, const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut);

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
            const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut);

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

        std::vector<Slot> slots;
        Instantiator instantiator;
    };
}

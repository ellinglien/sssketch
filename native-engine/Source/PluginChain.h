// native-engine/Source/PluginChain.h
#pragma once
#include "PluginEditorWindow.h"
#include "BridgeClient.h"
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <atomic>
#include <functional>
#include <memory>
#include <vector>

namespace sssketch
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

        explicit PluginChain(int numSlots, Instantiator instantiator = &PluginChain::defaultInstantiate, BridgeClient* bridgeClient = nullptr);
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
            std::function<void(bool success, const juce::String& error)> onLoaded,
            const juce::String& stateBase64 = {});

        /** Synchronous, blocking load — offline export only, where nothing
         * concurrently reads this slot from an audio thread. Returns false
         * (errorOut set) on failure, leaving the slot unchanged. */
        bool loadPluginSync(
            int slotIndex, const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut,
            const juce::String& stateBase64 = {});

        /** Message-thread API: captures slotIndex's currently active
         * plugin's own parameter state via getStateInformation(),
         * base64-encoded. Empty string if the slot has no plugin loaded
         * (including a bridged slot -- bridge-hosted plugin state capture
         * is out of scope for this feature, see the design doc's non-goals).
         *
         * Reads `active` without additional synchronization -- the SAME
         * accepted-risk pattern openEditorWindow already uses just below
         * (a plain pointer read racing the audio thread's own
         * applyPendingSwaps() write is not new risk this method
         * introduces; worst case is observing a briefly-stale but still
         * valid pointer, never a torn read, on every real target
         * platform). getStateInformation() itself is safe to call from the
         * message thread while this SAME instance concurrently processes
         * audio on another thread -- this is JUCE/VST3/AU's own
         * established host-plugin threading contract (real DAWs capture
         * plugin state for autosave during playback routinely); unlike
         * requestLoad's own macOS-UI-toolkit-during-INSTANTIATION hazard
         * (see requestLoad's own doc comment in the .cpp), this is not a
         * case this codebase has found to be unsafe in practice. */
        juce::String captureStateBase64(int slotIndex) const;

        /** Any-thread API, but ONLY ever safe to call at a point where
         * `instance` is not yet visible to the audio thread -- i.e. from
         * loadPluginSync's own synchronous, single-threaded export context
         * before it assigns slot.active, or from requestLoad's
         * message-thread callAsync lambda before the loaded instance is
         * published via slot.pending/pendingReady. Never call this on an
         * already-live slot.active. No-op if stateBase64 is empty or fails
         * to decode. */
        static void applyStateBase64(juce::AudioProcessor& instance, const juce::String& stateBase64);

        /** Any thread: updates the project tempo every plugin in this chain
         * sees via its own AudioPlayHead::getPosition() query — e.g. a
         * tempo-synced delay's note-division times, or a modulation effect's
         * synced rate. BPM-only: this does NOT track real transport position
         * or play/pause state (isPlaying is reported unconditionally true,
         * since process() is only ever called while audio is actually being
         * rendered, live or export) — see the design spec's "tempo input"
         * addendum for why that scope was chosen over full playhead sync. */
        void setBpm(double bpm);

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

        // Public (not just used as this constructor's own default
        // argument value) so callers who need to pass a LATER constructor
        // argument explicitly (e.g. ChannelChainRegistry passing
        // bridgeClient) can still name the same default instantiator
        // behavior for this one, rather than needing their own duplicate
        // implementation.
        static std::unique_ptr<juce::AudioProcessor> defaultInstantiate(
            const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut);

    private:
        // One shared playhead per chain (not per slot) -- tempo is a
        // chain-wide, not per-plugin, concept. setBpm() writes the atomic;
        // getPosition() reads it -- called by a hosted plugin from inside
        // its own processBlock(), i.e. potentially the audio thread, so this
        // must stay lock-free.
        class BpmPlayHead : public juce::AudioPlayHead
        {
        public:
            void setBpm(double newBpm) { bpm.store(newBpm); }

            juce::Optional<PositionInfo> getPosition() const override
            {
                PositionInfo info;
                info.setBpm(bpm.load());
                info.setIsPlaying(true);
                return info;
            }

        private:
            std::atomic<double> bpm { 120.0 };
        };

        // Bundles what a completed background load hands off to the audio
        // thread via applyPendingSwaps() -- EITHER a local instance
        // (bridgeSlotId empty) OR a bridge slot id (localInstance nullptr),
        // never both. Deleting a PendingLoad that was never applied (e.g.
        // PluginChain destroyed mid-load) also deletes localInstance if
        // present -- mirrors the original design's "harmless" in-flight
        // teardown reasoning (see PluginChain::~PluginChain), just one
        // level deeper now that there are two kinds of pending state
        // instead of one.
        struct PendingLoad
        {
            juce::AudioProcessor* localInstance = nullptr;
            juce::String bridgeSlotId;
            ~PendingLoad() { delete localInstance; }
        };

        struct Slot
        {
            std::unique_ptr<juce::AudioProcessor> active;
            int processChannels = 2; // max(active's total input, total output) once a plugin is loaded
            std::atomic<PendingLoad*> pending { nullptr };
            std::atomic<bool> pendingReady { false };
            juce::AudioBuffer<float> scratch;
            std::unique_ptr<PluginEditorWindow> editorWindow;
            // Non-empty when this slot's plugin is running on the x86_64
            // bridge instead of in-process -- see
            // docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md.
            // `active` stays nullptr for a bridged slot. Only ever written
            // by applyPendingSwaps() (audio thread), matching how `active`
            // itself is only ever written there too.
            juce::String bridgeSlotId;
            // Reused interleaved-stereo scratch for the bridged path,
            // resized only when numSamples changes -- mirrors `scratch`
            // above's own resize-only-if-changed pattern, for the exact
            // same reason: no heap allocation on the audio thread once
            // warmed up (numSamples is constant for the life of a session
            // in practice).
            std::vector<float> bridgeInputScratch;
            std::vector<float> bridgeOutputScratch;
        };

        std::vector<Slot> slots;
        Instantiator instantiator;
        BpmPlayHead playHead;
        BridgeClient* bridgeClient;
    };
}

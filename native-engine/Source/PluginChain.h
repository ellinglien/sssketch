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

        /** requestLoad's completion: success, the error (on failure), and the
         * settings of what the slot held when this request was carried out
         * (captureStateBase64 of the outgoing plugin, read just before the new
         * one is instantiated -- so with several loads in flight each reports
         * the one it replaced). Empty when the slot held nothing (or a bridged
         * plugin). The renderer keeps them so undoing a removal brings the
         * plugin back as it was. */
        using LoadCallback = std::function<void(bool success, const juce::String& error, const juce::String& previousState)>;

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
            LoadCallback onLoaded,
            const juce::String& stateBase64 = {});

        /** Synchronous, blocking load — offline export only, where nothing
         * concurrently reads this slot from an audio thread. Returns false
         * (errorOut set) on failure, leaving the slot unchanged. */
        bool loadPluginSync(
            int slotIndex, const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut,
            const juce::String& stateBase64 = {});

        /** Message-thread API: captures slotIndex's currently active
         * plugin's own parameter state via getStateInformation(),
         * base64-encoded -- or, when a finished load is still waiting for
         * the audio thread's swap, that incoming plugin's (it is what the
         * slot is about to hold; see the .cpp). Empty string if the slot has no plugin loaded
         * (including a bridged slot -- bridge-hosted plugin state capture
         * is out of scope for this feature, see the design doc's non-goals).
         *
         * Safe against a concurrent swap: it reads the slot's current
         * SlotState through an atomic, and a SlotState the audio thread
         * swaps out is only ever freed by drainRetired() -- on the message
         * thread, i.e. never while this (message-thread) call is using it.
         * It used to read a plain unique_ptr the audio thread was moving
         * from, with the outgoing instance deleted on a detached thread:
         * both a null dereference and a heap-use-after-free, reproduced by
         * PluginChainTests' "stress:" test. getStateInformation() itself is
         * safe to call from the
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

        /** Any thread: updates the transport position every plugin in this
         * chain sees via its own AudioPlayHead::getPosition() query, so a
         * tempo-synced delay/arpeggiator/gated effect/synced LFO can lock
         * onto the beat, not just match tempo (see setBpm just above -- this
         * is the position half of that same playhead). Time-signature-
         * agnostic: always reports PPQ as positionBars * 4.0 (a fixed
         * 4-beats-per-bar assumption) -- this app doesn't track a real time
         * signature today, and most plugins default sensibly to 4/4 without
         * one; per the design spec's own explicit decision to skip time
         * signature for this feature. Same real-time-safety story as
         * setBpm: a plain lock-free atomic store, safe to call from the
         * audio thread (and in practice always IS called from there, once
         * per renderBlock -- see PlaybackEngine::renderBlock and
         * Transport.cpp's own call sites). */
        void setPosition(double positionBars);

        /** Audio-thread API: promotes any slot with a ready pending load to
         * current. Real-time safe: per slot, at most two atomic pointer
         * exchanges and an atomic store -- no allocation, no free, no
         * string copies, no thread creation. The SlotState it replaces is
         * parked in the slot's single `retired` cell for drainRetired() to
         * destroy on the message thread. While that cell is still occupied
         * the slot's swap is DEFERRED -- left pending, retried next block --
         * rather than dropping or overwriting anything. Call once per
         * block, before process(). */
        void applyPendingSwaps();

        /** Message-thread API: destroys whatever applyPendingSwaps() has
         * retired (closing its editor window first, if one is open), which
         * also unblocks that slot's next swap. Cheap when there's nothing
         * to do: one atomic load per slot. IpcConnection calls it on every
         * timer tick and inbound message, next to drainRetiredProject().
         * Plugins are therefore always destroyed on the message thread,
         * which is where AU/VST3 instances expect it. */
        void drainRetired();

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
         * open, and stops watching its edits (watchEdits). The underlying
         * plugin instance keeps loaded and processing either way -- closing
         * the editor is purely a UI action. No-op if no window is open for
         * that slot. */
        void closeEditorWindow(int slotIndex);

        /** Message-thread API: from now on, an edit of slotIndex's current
         * plugin is reported by takeEdited() -- until closeEditorWindow, or
         * that plugin is swapped out. openEditorWindow calls it: a knob is
         * only reachable in the editor, so this is the user editing the
         * plugin, not its own restore at load time. An edit is a parameter
         * change made with a gesture (begin/end, as a knob turn is, or just
         * after one), or a program / state change the plugin reports; from a
         * plugin that never sends gestures, a change of an automatable,
         * non-meter parameter on the message thread. Not a plugin's own
         * changes: meters, self-modulation, VST3 output parameters set from
         * process(). See EditWatch. A bridged plugin is not watched. */
        void watchEdits(int slotIndex);

        /** Any thread: whether a watched plugin was edited since the last
         * call. Consumes it. IpcConnection polls it to push 'plugin-edited'
         * (the project has unsaved plugin settings). */
        bool takeEdited();

        // Public (not just used as this constructor's own default
        // argument value) so callers who need to pass a LATER constructor
        // argument explicitly (e.g. ChannelChainRegistry passing
        // bridgeClient) can still name the same default instantiator
        // behavior for this one, rather than needing their own duplicate
        // implementation.
        static std::unique_ptr<juce::AudioProcessor> defaultInstantiate(
            const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut);

    private:
        // One per loaded plugin (its SlotState's): registered with the plugin
        // once, on the message thread, before the audio thread can see it,
        // and removed only after it has retired (~SlotState) -- so the
        // plugin's listener list is never changed while the audio thread may
        // be walking it. Whether it counts anything is `watching` (the
        // editor is open), an atomic the callbacks check. Callbacks can come
        // from any thread (an output parameter set from process(), say):
        // atomics only, no allocation, no lock.
        class EditWatch : public juce::AudioProcessorListener
        {
        public:
            EditWatch(std::atomic<bool>& editedFlag, int numParameters);

            void audioProcessorParameterChanged(juce::AudioProcessor*, int index, float) override;
            void audioProcessorParameterChangeGestureBegin(juce::AudioProcessor*, int index) override;
            void audioProcessorParameterChangeGestureEnd(juce::AudioProcessor*, int index) override;
            void audioProcessorChanged(juce::AudioProcessor*, const ChangeDetails& details) override;

            std::atomic<bool> watching { false };

            // How long a change still counts after its gesture ended (some
            // plugins send the final value after endEdit), and the longest a
            // gesture counts as held (one whose end never comes).
            static constexpr juce::uint32 kAfterGestureMs = 250;
            static constexpr juce::uint32 kLongestGestureMs = 30000;

        private:
            // Until when (Time::getMillisecondCounter, 0: never) a change of
            // that parameter is part of a gesture. Sized when attached; a
            // parameter past it (added later) uses `anyGestureUntil`.
            std::atomic<juce::uint32>& gestureSlot(int index);
            static bool before(juce::uint32 now, juce::uint32 until);

            std::atomic<bool>& edited;
            std::atomic<bool> seenGesture { false };
            const int numParams;
            std::unique_ptr<std::atomic<juce::uint32>[]> gestureUntil;
            std::atomic<juce::uint32> anyGestureUntil { 0 };
        };

        // Declared before `slots`: outlives every EditWatch that sets it.
        std::atomic<bool> edited { false };

        // One shared playhead per chain (not per slot) -- tempo is a
        // chain-wide, not per-plugin, concept. setBpm() writes the atomic;
        // getPosition() reads it -- called by a hosted plugin from inside
        // its own processBlock(), i.e. potentially the audio thread, so this
        // must stay lock-free.
        class BpmPlayHead : public juce::AudioPlayHead
        {
        public:
            void setBpm(double newBpm) { bpm.store(newBpm); }
            void setPosition(double newPositionBars) { positionBars.store(newPositionBars); }

            juce::Optional<PositionInfo> getPosition() const override
            {
                PositionInfo info;
                info.setBpm(bpm.load());
                info.setIsPlaying(true);
                info.setPpqPosition(positionBars.load() * 4.0);
                return info;
            }

        private:
            std::atomic<double> bpm { 120.0 };
            std::atomic<double> positionBars { 0.0 };
        };

        // Everything that describes what one slot is running, as ONE
        // immutable-once-published record: EITHER a local instance
        // (bridgeSlotId empty) OR a bridge slot id (instance nullptr), or
        // neither (an explicitly empty slot). Built completely on the
        // message thread -- playhead attached, processChannels worked out --
        // before the audio thread can see it, and never modified after, so
        // a swap is a pointer exchange: nothing on the audio thread ever
        // assigns, copies or frees a String or a plugin. Destroying a
        // SlotState destroys its instance; that only ever happens on the
        // message thread (drainRetired, the destructor) or in single-
        // threaded export (loadPluginSync).
        struct SlotState
        {
            // Declared before `instance`, so destroyed after it: a callback
            // already under way on one of the plugin's own threads as it is
            // removed still finds a live object.
            std::unique_ptr<EditWatch> editWatch;
            std::unique_ptr<juce::AudioProcessor> instance;
            // Non-empty when this slot's plugin is running on the x86_64
            // bridge instead of in-process -- see
            // docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md.
            juce::String bridgeSlotId;
            int processChannels = 2; // max(instance's total input, total output)

            SlotState() = default;
            SlotState(const SlotState&) = delete;
            SlotState& operator=(const SlotState&) = delete;
            // Unregisters editWatch -- only ever on the message thread (or in
            // single-threaded export), once the audio thread can no longer see
            // this state -- before the plugin goes.
            ~SlotState()
            {
                if (instance != nullptr && editWatch != nullptr)
                    instance->removeListener(editWatch.get());
            }
        };

        // A fully-built SlotState for `instance` (may be null: empty slot),
        // playhead attached. Message thread / export only.
        std::unique_ptr<SlotState> makeLocalState(std::unique_ptr<juce::AudioProcessor> instance);

        struct Slot
        {
            // What the audio thread is running. Written only by
            // applyPendingSwaps() (and by single-threaded export's
            // loadPluginSync); read by process() and, on the message
            // thread, by captureStateBase64/openEditorWindow -- safe there
            // because only the message thread ever frees a SlotState.
            std::atomic<SlotState*> state { nullptr };
            // Message thread -> audio thread: the next SlotState to run. A
            // newer load replacing one the audio thread hasn't taken yet
            // deletes the older one (exchange makes that unambiguous).
            std::atomic<SlotState*> pending { nullptr };
            // Audio thread -> message thread: the SlotState a swap
            // replaced, for drainRetired() to destroy. One cell; while it's
            // occupied, this slot's next swap waits (see applyPendingSwaps).
            std::atomic<SlotState*> retired { nullptr };
            juce::AudioBuffer<float> scratch;
            std::unique_ptr<PluginEditorWindow> editorWindow;
            // Message thread only: the SlotState editorWindow's editor
            // belongs to, so drainRetired() can close it before destroying
            // that state's plugin (JUCE requires the editor go first).
            const SlotState* editorFor = nullptr;
            // Message thread only: the SlotState whose editWatch is watching
            // (watchEdits), so it stops before that plugin goes.
            const SlotState* watchedFor = nullptr;
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

        // Message thread: stops the slot's watched plugin's EditWatch, if any.
        void unwatchEdits(Slot& slot);
        Instantiator instantiator;
        BpmPlayHead playHead;
        BridgeClient* bridgeClient;
    };
}

// native-engine/Source/SendBus.h
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <array>
#include <atomic>
#include <functional>
#include <memory>

namespace ssstitch
{
    static constexpr int kNumSendBuses = 4;

    /** Owns up to kNumSendBuses live plugin instances and the per-block
     * accumulation buffer each one processes. See
     * docs/superpowers/specs/2026-07-29-send-bus-plugin-hosting-design.md
     * for the full rationale — this class implements its "Real-time-safe
     * plugin load/swap" and signal-flow sections.
     *
     * Real-time (audio-thread) API: applyPendingSwaps(), beginBlock(),
     * addSample(), mixBackInto() — called from PlaybackEngine::renderBlock,
     * in that order, once per block.
     *
     * Off-thread API: requestLoad() (message thread, hands the actual work
     * to a background thread) and loadPluginSync() (any thread, blocking —
     * for the offline export path only, where nothing is concurrently
     * reading this bus from an audio callback). */
    class SendBus
    {
    public:
        /** A plugin id -> live processor instance factory. Production code
         * uses the default (the real allowlist + AudioPluginFormatManager,
         * see .cpp); tests inject a fake to exercise the swap/accumulation
         * logic without depending on a real installed plugin. An empty
         * `pluginId` must return nullptr with `errorOut` left empty (not an
         * error — "no plugin" is a valid, silent state, not a failure). */
        using Instantiator = std::function<std::unique_ptr<juce::AudioProcessor>(
            const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)>;

        explicit SendBus(Instantiator instantiator = &SendBus::defaultInstantiate);
        ~SendBus();

        SendBus(const SendBus&) = delete;
        SendBus& operator=(const SendBus&) = delete;

        /** Message-thread API: kicks off loading `pluginId` (an allowlist id,
         * or an empty string for "no plugin") onto `busIndex` on a
         * background thread. Safe to call again before a previous load for
         * the same bus finishes — whichever completes last wins (see .cpp).
         * `onLoaded` runs on that background thread once the load finishes
         * or fails; callers needing the message thread (e.g. to send an IPC
         * reply) must hop back to it themselves. */
        void requestLoad(
            int busIndex,
            const juce::String& pluginId,
            double sampleRate,
            int blockSize,
            std::function<void(bool success, const juce::String& error)> onLoaded);

        /** Synchronous, blocking load — offline export only, where nothing
         * concurrently reads this bus from an audio thread. Returns false
         * (errorOut set) on failure, leaving the bus unchanged. */
        bool loadPluginSync(
            int busIndex, const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut);

        /** Audio-thread API: promotes any bus with a ready pending swap to
         * active; the instance it replaces is handed to a background
         * cleanup thread rather than deleted here (a plugin's destructor
         * can do real work). Call once per block, before beginBlock(). */
        void applyPendingSwaps();

        /** Audio-thread API: sizes/clears every loaded bus's scratch buffer
         * for a block of `numSamples`. Call once per block, before any
         * addSample() calls. */
        void beginBlock(int numSamples);

        /** Audio-thread API: true if bus `busIndex` currently has a plugin
         * loaded (and is therefore worth sending to at all). */
        bool hasPlugin(int busIndex) const;

        /** Audio-thread API: adds gain-adjusted `l`/`r` (already scaled by
         * this one stem's own gain/volume/fade) into bus `busIndex`'s
         * scratch buffer at `sampleIndex`, further scaled by `sendLevel`.
         * No-op if the bus has no plugin loaded or sendLevel <= 0. */
        void addSample(int busIndex, int sampleIndex, float l, float r, float sendLevel);

        /** Audio-thread API: runs every loaded bus's plugin over its own
         * scratch buffer and adds the result into outL/outR — the send's
         * "return." A bus with no plugin loaded contributes nothing (never
         * an unprocessed dry duplicate). Call once per block, after every
         * stem's addSample() calls for that block. Only reads back the
         * plugin's own channels 0/1 (its main stereo output) even if its
         * scratch buffer is wider to satisfy a larger input requirement —
         * see the design spec's note on Solid Bus Comp's 4-in/2-out
         * layout. */
        void mixBackInto(int numSamples, float* outL, float* outR);

    private:
        static std::unique_ptr<juce::AudioProcessor> defaultInstantiate(
            const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut);

        struct Slot
        {
            std::unique_ptr<juce::AudioProcessor> active;
            int processChannels = 2; // max(active's total input, total output) once a plugin is loaded
            std::atomic<juce::AudioProcessor*> pending { nullptr };
            std::atomic<bool> pendingReady { false };
            juce::AudioBuffer<float> scratch;
        };

        std::array<Slot, kNumSendBuses> slots;
        Instantiator instantiator;
    };
}

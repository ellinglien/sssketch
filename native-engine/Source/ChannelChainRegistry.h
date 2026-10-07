// native-engine/Source/ChannelChainRegistry.h
#pragma once
#include "GracePeriod.h"
#include "PluginChain.h"
#include <atomic>
#include <functional>
#include <mutex>
#include <unordered_map>
#include <vector>

namespace sssketch
{
    /** Owns a dynamically-sized collection of 2-slot PluginChain instances,
     * one per currently-known channel ID. Channels are created/destroyed by
     * ordinary arranging (see docs/superpowers/specs/2026-08-01-channel-
     * plugin-inserts-design.md's "Channel lifecycle" section) -- unlike the
     * master chain's fixed 4 slots, this collection itself resizes, which
     * the audio thread must never observe mid-resize. updateChannelSet
     * (message thread only) builds a COMPLETE new map -- reusing each
     * still-present channel's existing PluginChain (and whatever it has
     * loaded), constructing a fresh one only for genuinely new channel IDs
     * -- then publishes it via one atomic pointer exchange. The audio
     * thread only ever reads whatever's currently published and never
     * mutates it.
     *
     * Reclamation (2026-10-01): the old map used to go straight to a
     * detached deleter thread, so a reader that had loaded the old pointer
     * just before the exchange could still be inside map->find() -- or
     * inside process() on a dropped channel's PluginChain -- when it was
     * freed. A real heap-use-after-free on the audio thread, reproduced by
     * the "stress:" tests under AddressSanitizer. Every read now happens
     * inside a ReadScope (see below), and updateChannelSet waits for a
     * grace period -- every reader that could still hold the old map has
     * left its scope -- and then deletes the old map itself, on the
     * message thread. The reader side is two atomic increments and one
     * atomic load: it never blocks, allocates or frees. Only the writer
     * (message thread) ever waits, for at most the longest reader scope
     * already in progress: one renderBlock call, which includes every
     * channel plugin's own process() and any bridged slot's wait on the
     * bridge. That wait has a deadline (see GracePeriod.h): past it, a
     * stuck reader (a hung plugin) gets the old map LEAKED rather than
     * freed under it, and the message thread carries on.
     *
     * Map values are shared_ptr, not unique_ptr, deliberately: reusing an
     * existing channel's chain across an updateChannelSet call means
     * copying its entry from the old (possibly still-published, possibly
     * still being concurrently read by the audio thread) map into the new
     * one. A shared_ptr copy only reads the source and does an atomic
     * refcount bump; it never writes to the source object itself. A
     * unique_ptr move, by contrast, zeroes out the source's internal
     * pointer as an unavoidable side effect -- a real, found-by-its-own-
     * test data race against a concurrent reader's chainFor() calling
     * .get() on that same entry mid-move. */
    class ChannelChainRegistry
    {
    public:
        explicit ChannelChainRegistry(PluginChain::Instantiator instantiator = nullptr, BridgeClient* bridgeClient = nullptr);
        ~ChannelChainRegistry();

        ChannelChainRegistry(const ChannelChainRegistry&) = delete;
        ChannelChainRegistry& operator=(const ChannelChainRegistry&) = delete;

        /** Marks the calling thread as a reader for as long as it lives.
         * chainFor, setPosition, applyPendingSwaps, setBpm and
         * knownChannelIds each take one internally, which covers their own
         * walk of the map. A caller that USES the PluginChain* chainFor
         * returns after chainFor has returned -- renderBlock calling
         * process() on it -- must hold its own ReadScope across both the
         * lookup and the use, or a concurrent updateChannelSet that drops
         * that channel can destroy the chain mid-process(). Scopes nest.
         *
         * Real-time safe: entering is one atomic load plus one atomic
         * increment, leaving is one atomic decrement. Never blocks.
         *
         * Never call updateChannelSet while holding a ReadScope on the same
         * thread: it waits for every scope to end, including that one. */
        class ReadScope
        {
        public:
            explicit ReadScope(const ChannelChainRegistry& registry) noexcept : scope(registry.grace) {}

        private:
            GracePeriod::ReadScope scope;
        };

        /** Message-thread API. See class doc comment. Blocks for the grace
         * period (at most one in-flight renderBlock, plugin process() and
         * bridge waits included) before deleting the old map inline, so
         * must never be called from the audio thread. */
        void updateChannelSet(const std::vector<juce::String>& channelIds);

        /** Message-thread API: forwards the project tempo to every currently
         * published channel's chain (see PluginChain::setBpm), and remembers
         * it so a channel created later by updateChannelSet starts with the
         * current tempo too, instead of defaulting to something stale until
         * the next explicit setBpm call. */
        void setBpm(double bpm);

        /** Audio-thread API (unlike setBpm just above) -- called once per
         * block from PlaybackEngine::renderBlock (see PluginChain::
         * setPosition's own doc comment for why this is safe there).
         * Forwards the current transport position to every currently
         * published channel's chain, and remembers it so a channel created
         * later by updateChannelSet starts already synced to the current
         * position, instead of defaulting to bar 0 until the next block.
         * Same lock-free load-then-iterate pattern as setBpm. */
        void setPosition(double positionBars);

        /** Message-thread API: forwards to channelId's own chain. A no-op
         * (onLoaded called with success=false) if channelId isn't currently
         * known -- updateChannelSet should normally have already been
         * called with it first; this is defensive, not the expected path. */
        void requestLoad(
            const juce::String& channelId,
            int slotIndex,
            const juce::String& path,
            double sampleRate,
            int blockSize,
            PluginChain::LoadCallback onLoaded,
            const juce::String& stateBase64 = {});

        /** Message-thread API: no-op (returns false) if channelId isn't
         * currently known. */
        bool openEditorWindow(const juce::String& channelId, int slotIndex);
        void closeEditorWindow(const juce::String& channelId, int slotIndex);

        /** Message-thread API: PluginChain::takeEdited() across every channel's
         * chain (each consumed). */
        bool takeEdited();

        /** Audio-thread API: promotes pending swaps across every currently
         * published channel's chain. Call once per block, before any
         * chainFor()-based process() calls. */
        void applyPendingSwaps();

        /** Message-thread API: PluginChain::drainRetired() on every
         * currently published channel's chain -- destroys plugins the audio
         * thread swapped out, on the message thread, and unblocks those
         * slots' next swaps. A dropped channel's chain drains in its own
         * destructor instead. */
        void drainRetired();

        /** Audio-thread API: the channel's chain if one is currently
         * published, or nullptr (treat as passthrough) otherwise. Never
         * blocks, never allocates -- one atomic pointer load plus an
         * unordered_map lookup into an already-fully-built map. */
        PluginChain* chainFor(const juce::String& channelId);

        /** Message-thread API: every channel ID currently known (i.e.
         * present in the last-published map from updateChannelSet), in no
         * particular order. Used by the get-plugin-states IPC handler to
         * enumerate what to capture -- nothing else in this class exposes
         * enumeration today, only single-channel lookup via chainFor. */
        std::vector<juce::String> knownChannelIds() const;

        using ChannelChainMap = std::unordered_map<juce::String, std::shared_ptr<PluginChain>>;

        /** Export-only: installs `chains` as the published map directly, no
         * reuse/diffing logic (export never calls this more than once, and
         * has no previous state to reuse). Not for use from IpcServer's
         * live-project path -- use updateChannelSet there. */
        void installForExport(ChannelChainMap chains);

    private:
        std::atomic<const ChannelChainMap*> published;

        // See GracePeriod.h.
        GracePeriod grace;
        // Serializes writers (updateChannelSet, installForExport) so two
        // grace periods never interleave their phase flips. Writer-only:
        // the audio thread never touches it.
        std::mutex writerMutex;
        // Retired maps whose grace period timed out -- see GracePeriod.h.
        // Freed after the next grace period that completes. Writer-only.
        std::vector<const ChannelChainMap*> stuckRetired;
        PluginChain::Instantiator instantiator;
        BridgeClient* bridgeClient;
        std::atomic<double> currentBpm { 120.0 };
        std::atomic<double> currentPositionBars { 0.0 };
    };
}

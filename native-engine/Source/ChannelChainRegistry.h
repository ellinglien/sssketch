// native-engine/Source/ChannelChainRegistry.h
#pragma once
#include "PluginChain.h"
#include <atomic>
#include <functional>
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
     * -- then publishes it via one atomic pointer exchange; the old map is
     * handed to a background thread for deletion, exactly mirroring how
     * PluginChain's own applyPendingSwaps() already hands off a superseded
     * plugin instance. The audio thread only ever reads whatever's
     * currently published, once per block, and never mutates it.
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

        /** Message-thread API. See class doc comment. */
        void updateChannelSet(const std::vector<juce::String>& channelIds);

        /** Message-thread API: forwards the project tempo to every currently
         * published channel's chain (see PluginChain::setBpm), and remembers
         * it so a channel created later by updateChannelSet starts with the
         * current tempo too, instead of defaulting to something stale until
         * the next explicit setBpm call. */
        void setBpm(double bpm);

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
            std::function<void(bool success, const juce::String& error)> onLoaded,
            const juce::String& stateBase64 = {});

        /** Message-thread API: no-op (returns false) if channelId isn't
         * currently known. */
        bool openEditorWindow(const juce::String& channelId, int slotIndex);
        void closeEditorWindow(const juce::String& channelId, int slotIndex);

        /** Audio-thread API: promotes pending swaps across every currently
         * published channel's chain. Call once per block, before any
         * chainFor()-based process() calls. */
        void applyPendingSwaps();

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
        PluginChain::Instantiator instantiator;
        BridgeClient* bridgeClient;
        std::atomic<double> currentBpm { 120.0 };
    };
}

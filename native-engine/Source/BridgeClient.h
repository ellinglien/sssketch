// native-engine/Source/BridgeClient.h
#pragma once
#include "SharedAudioChannel.h"
#include <juce_events/juce_events.h>
#include <atomic>
#include <functional>
#include <memory>
#include <unordered_map>

namespace sssketch
{
    /** The main engine's connection to the x86_64 bridge helper process --
     * one shared instance for the whole app session (see design spec's
     * Lifecycle section), used by every PluginChain slot that loads an
     * x86_64 plugin, across the master chain and every channel's chain.
     * Owns spawning the bridge (lazily, on first use), connecting to its
     * control socket, and the per-slot load/editor/unload API PluginChain
     * calls into.
     *
     * Message-thread API: ensureRunning(), loadPlugin(), openEditor(),
     * closeEditor(), unloadPlugin(). Audio-thread API: channelFor() and
     * isHealthy() only -- the actual per-block audio read/write calls are
     * methods on the SharedAudioChannel channelFor() returns, not on
     * BridgeClient itself, so the audio thread's hot path never touches
     * BridgeClient's own control-plane bookkeeping. */
    class BridgeClient : public juce::InterprocessConnection
    {
    public:
        /** `bridgeBinaryPath` is resolved by Electron (dev vs packaged,
         * mirroring how the main engine's own binary path is resolved --
         * see engineProcess.ts) and passed down via a CLI arg -- see
         * Main.cpp. An empty path means bridging is unavailable this
         * session (e.g. the bridge hasn't been built in dev mode yet) --
         * every method below degrades gracefully to "load failed" rather
         * than crashing. */
        explicit BridgeClient(juce::String bridgeBinaryPath);
        ~BridgeClient() override;

        void connectionMade() override;
        void connectionLost() override;
        void messageReceived(const juce::MemoryBlock& message) override;

        /** Message-thread API: spawns the bridge (if not already running)
         * and connects to it (if not already connected), retrying the
         * connect for a few seconds to absorb the process's own startup
         * time. Returns false if spawning or connecting fails outright.
         * loadPlugin() calls this internally -- most callers don't need to
         * call it directly. */
        bool ensureRunning();

        /** Message-thread API: creates a fresh SharedAudioChannel (owner
         * side) for `slotId`, sends a load-bridge-plugin control message,
         * and calls onLoaded once the bridge replies. `slotId` must be
         * unique across every currently-loaded bridged slot in the whole
         * session (master and every channel combined). */
        void loadPlugin(
            const juce::String& slotId,
            const juce::String& path,
            double sampleRate,
            int blockSize,
            std::function<void(bool success, const juce::String& error)> onLoaded);

        void unloadPlugin(const juce::String& slotId);
        void openEditor(const juce::String& slotId);
        void closeEditor(const juce::String& slotId);

        /** Audio-thread API: the slot's own SharedAudioChannel, or nullptr
         * if that slot isn't currently loaded on the bridge (never loaded,
         * failed to load, or the bridge crashed and it was torn down).
         * Never blocks, never allocates -- one map lookup into state only
         * ever mutated on the message thread, published via the same
         * atomic-whole-map-swap pattern ChannelChainRegistry already uses
         * (see its own doc comment) -- read with acquire semantics, never
         * mutated in place once published. */
        SharedAudioChannel* channelFor(const juce::String& slotId);

        /** Audio-thread API: true if the bridge connection is currently
         * considered healthy (connected). PluginChain checks this
         * alongside channelFor() -- see design spec's Error Handling
         * section, "bridge process dies mid-session." */
        bool isHealthy() const { return connected.load(); }

    private:
        void sendJson(const juce::var& payload);
        void publishChannels(std::function<void(std::unordered_map<juce::String, std::unique_ptr<SharedAudioChannel>>&)> mutator);

        juce::String bridgeBinaryPath;
        std::unique_ptr<juce::ChildProcess> bridgeProcess;
        std::atomic<bool> connected { false };

        using ChannelMap = std::unordered_map<juce::String, std::unique_ptr<SharedAudioChannel>>;
        std::atomic<const ChannelMap*> publishedChannels;

        std::unordered_map<juce::String, std::function<void(bool, const juce::String&)>> pendingLoads;
    };
}

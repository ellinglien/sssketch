// native-engine/Source/ChannelChainRegistry.cpp
#include "ChannelChainRegistry.h"

namespace sssketch
{
    ChannelChainRegistry::ChannelChainRegistry(PluginChain::Instantiator inst, BridgeClient* bc)
        : published(new ChannelChainMap()), instantiator(std::move(inst)), bridgeClient(bc)
    {
    }

    ChannelChainRegistry::~ChannelChainRegistry()
    {
        delete published.load();
    }

    void ChannelChainRegistry::updateChannelSet(const std::vector<juce::String>& channelIds)
    {
        const std::lock_guard<std::mutex> writerLock(writerMutex);
        const auto* current = published.load();
        auto* next = new ChannelChainMap();

        for (const auto& channelId : channelIds)
        {
            auto existing = current->find(channelId);
            if (existing != current->end())
            {
                // Reuse the existing chain (and whatever it has loaded) via
                // a plain shared_ptr COPY -- see the class doc comment on
                // why this must never be a unique_ptr move: `current` may
                // still be the live published map a reader thread is
                // concurrently dereferencing, and a copy only reads the
                // source and bumps an atomic refcount, never writing to
                // the source object itself.
                (*next)[channelId] = existing->second;
            }
            else
            {
                (*next)[channelId] = instantiator
                    ? std::make_shared<PluginChain>(kNumChannelChainSlots, instantiator, bridgeClient)
                    : std::make_shared<PluginChain>(kNumChannelChainSlots, &PluginChain::defaultInstantiate, bridgeClient);
                (*next)[channelId]->setBpm(currentBpm.load());
                (*next)[channelId]->setPosition(currentPositionBars.load());
            }
        }

        const auto* old = published.exchange(next);
        // Nothing can load `old` any more, but a reader that loaded it just
        // before the exchange may still be walking it, or running process()
        // on one of its chains under a ReadScope. Wait those out here, on
        // the message thread, before anything frees it -- see the class doc
        // comment. Bounded by the longest reader scope already in progress:
        // one renderBlock call, which includes every channel plugin's own
        // process() and any bridged slot's wait on the bridge.
        grace.waitForReaders();
        // Any channel from `current` NOT reused above still has its
        // shared_ptr held only by `old` (never copied into `next`) -- once
        // `old` itself is deleted, that's the last reference, so its
        // PluginChain destructs normally. A reused channel's PluginChain
        // stays alive regardless, since `next` now holds its own copy of
        // the shared_ptr (refcount >= 1 independent of `old`). The actual
        // PluginChain destructors may do real work (closing editor windows,
        // tearing down plugin instances). That work used to go to a
        // detached thread; now that the grace period has passed and no
        // reader can reach `old`, it runs right here instead, on the
        // message thread -- where editor windows have to be torn down
        // anyway, and never on the audio thread.
        delete old;
    }

    void ChannelChainRegistry::setBpm(double bpm)
    {
        currentBpm.store(bpm);
        const ReadScope scope(*this);
        const auto* map = published.load();
        for (auto& [channelId, chain] : *map)
            chain->setBpm(bpm);
    }

    void ChannelChainRegistry::setPosition(double positionBars)
    {
        currentPositionBars.store(positionBars);
        const ReadScope scope(*this);
        const auto* map = published.load();
        for (auto& [channelId, chain] : *map)
            chain->setPosition(positionBars);
    }

    void ChannelChainRegistry::requestLoad(
        const juce::String& channelId,
        int slotIndex,
        const juce::String& path,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded,
        const juce::String& stateBase64)
    {
        auto* chain = chainFor(channelId);
        if (chain == nullptr)
        {
            if (onLoaded)
                onLoaded(false, "unknown channel: " + channelId);
            return;
        }
        chain->requestLoad(slotIndex, path, sampleRate, blockSize, std::move(onLoaded), stateBase64);
    }

    bool ChannelChainRegistry::openEditorWindow(const juce::String& channelId, int slotIndex)
    {
        auto* chain = chainFor(channelId);
        return chain != nullptr && chain->openEditorWindow(slotIndex);
    }

    void ChannelChainRegistry::closeEditorWindow(const juce::String& channelId, int slotIndex)
    {
        auto* chain = chainFor(channelId);
        if (chain != nullptr)
            chain->closeEditorWindow(slotIndex);
    }

    void ChannelChainRegistry::applyPendingSwaps()
    {
        const ReadScope scope(*this);
        const auto* map = published.load();
        for (auto& [channelId, chain] : *map)
            chain->applyPendingSwaps();
    }

    PluginChain* ChannelChainRegistry::chainFor(const juce::String& channelId)
    {
        // Covers the lookup only. The returned chain stays valid only while
        // the CALLER holds a ReadScope of its own -- see ReadScope's doc
        // comment. The message-thread callers (requestLoad, the editor-window
        // calls, get-plugin-states) don't need one: they
        // run on the same thread as updateChannelSet, so no swap can land
        // between their lookup and their use.
        const ReadScope scope(*this);
        const auto* map = published.load();
        auto it = map->find(channelId);
        return it == map->end() ? nullptr : it->second.get();
    }

    std::vector<juce::String> ChannelChainRegistry::knownChannelIds() const
    {
        std::vector<juce::String> ids;
        const ReadScope scope(*this);
        const auto* map = published.load();
        ids.reserve(map->size());
        for (const auto& [channelId, chain] : *map)
            ids.push_back(channelId);
        return ids;
    }

    void ChannelChainRegistry::installForExport(ChannelChainMap chains)
    {
        const std::lock_guard<std::mutex> writerLock(writerMutex);
        auto* next = new ChannelChainMap(std::move(chains));
        // Export is single-threaded (no audio thread concurrently reading
        // `published`), so it's safe to delete the previous map inline here
        // rather than handing it to a background thread.
        delete published.exchange(next);
    }
}

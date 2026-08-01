// native-engine/Source/ChannelChainRegistry.cpp
#include "ChannelChainRegistry.h"
#include <thread>

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
            }
        }

        const auto* old = published.exchange(next);
        // Any channel from `current` NOT reused above still has its
        // shared_ptr held only by `old` (never copied into `next`) -- once
        // `old` itself is deleted, that's the last reference, so its
        // PluginChain destructs normally. A reused channel's PluginChain
        // stays alive regardless, since `next` now holds its own copy of
        // the shared_ptr (refcount >= 1 independent of `old`). The actual
        // PluginChain destructors may do real work (closing editor windows,
        // tearing down plugin instances), so hand the whole map off to a
        // background thread regardless, matching this codebase's
        // established convention of never doing that work inline on a
        // thread that could be the audio thread.
        std::thread([old]() { delete old; }).detach();
    }

    void ChannelChainRegistry::setBpm(double bpm)
    {
        currentBpm.store(bpm);
        const auto* map = published.load();
        for (auto& [channelId, chain] : *map)
            chain->setBpm(bpm);
    }

    void ChannelChainRegistry::requestLoad(
        const juce::String& channelId,
        int slotIndex,
        const juce::String& path,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded)
    {
        auto* chain = chainFor(channelId);
        if (chain == nullptr)
        {
            if (onLoaded)
                onLoaded(false, "unknown channel: " + channelId);
            return;
        }
        chain->requestLoad(slotIndex, path, sampleRate, blockSize, std::move(onLoaded));
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
        const auto* map = published.load();
        for (auto& [channelId, chain] : *map)
            chain->applyPendingSwaps();
    }

    PluginChain* ChannelChainRegistry::chainFor(const juce::String& channelId)
    {
        const auto* map = published.load();
        auto it = map->find(channelId);
        return it == map->end() ? nullptr : it->second.get();
    }

    void ChannelChainRegistry::installForExport(ChannelChainMap chains)
    {
        auto* next = new ChannelChainMap(std::move(chains));
        // Export is single-threaded (no audio thread concurrently reading
        // `published`), so it's safe to delete the previous map inline here
        // rather than handing it to a background thread.
        delete published.exchange(next);
    }
}

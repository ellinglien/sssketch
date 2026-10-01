// native-engine/Source/BridgeClientTests.cpp
#include "BridgeClient.h"
#include <juce_core/juce_core.h>
#include <thread>
#include <vector>

namespace sssketch
{
    // Not in an anonymous namespace: BridgeClient befriends this class by
    // name so the tests can publish channels directly through
    // publishChannels(), without spawning a real bridge process.
    class BridgeClientTests : public juce::UnitTest
    {
    public:
        BridgeClientTests() : juce::UnitTest("BridgeClient", "BridgeClient") {}

        static void publish(BridgeClient& client, const juce::String& slotId)
        {
            auto channel = SharedAudioChannel::create(SharedAudioChannel::makeUniqueName(), 64);
            client.publishChannels([&](BridgeClient::ChannelMap& map) { map[slotId] = std::move(channel); });
        }

        void runTest() override
        {
            // publishChannels used to build the next map by MOVING every entry out of the
            // live one, so a reader inside channelFor could find a present slot's entry
            // already emptied (nullptr) or walk a map the detached deleter had just freed.
            // A bridged slot that's loaded must never read as gone: PluginChain renders
            // silence for it. ASan reports the freed-map read as a heap-use-after-free.
            beginTest("stress: channelFor never loses a published slot or reads a freed map while channels churn");
            {
                BridgeClient client({});
                std::vector<juce::String> stable;
                for (int i = 0; i < 24; ++i)
                {
                    stable.push_back("slot-" + juce::String(i));
                    publish(client, stable.back());
                }

                std::atomic<bool> stop { false };
                std::atomic<int> missing { 0 };
                std::vector<std::thread> readers;
                for (int r = 0; r < 4; ++r)
                {
                    readers.emplace_back([&, r]()
                    {
                        int i = r;
                        while (!stop.load())
                            if (client.channelFor(stable[(size_t) (i++ % (int) stable.size())]) == nullptr)
                                missing.fetch_add(1);
                    });
                }

                for (int i = 0; i < 500; ++i)
                {
                    publish(client, "churn");
                    client.unloadPlugin("churn");
                }

                stop.store(true);
                for (auto& t : readers)
                    t.join();
                expectEquals(missing.load(), 0);
            }

            // The channel channelFor hands back has to outlive the lookup too:
            // PluginChain::process writes to it and waits on its output after
            // channelFor has returned, and unloadPlugin destroys it along with the
            // old map. Holding a ReadScope across lookup-and-use, as process() does,
            // keeps it alive until the scope ends.
            beginTest("stress: a channel used inside a ReadScope is not destroyed by a concurrent unloadPlugin");
            {
                BridgeClient client({});
                std::atomic<bool> stop { false };
                std::atomic<int> used { 0 };

                std::thread audio([&]()
                {
                    float in[2 * 16] {};
                    float out[2 * 16] {};
                    while (!stop.load())
                    {
                        BridgeClient::ReadScope scope(client);
                        if (auto* channel = client.channelFor("churn"))
                        {
                            channel->writeInputAndSignal(in, 16);
                            channel->waitAndReadOutput(out, 16, 0);
                            used.fetch_add(1);
                        }
                    }
                });

                for (int i = 0; i < 500; ++i)
                {
                    publish(client, "churn");
                    client.unloadPlugin("churn");
                }

                stop.store(true);
                audio.join();
                expect(client.channelFor("churn") == nullptr);
                logMessage("channels used while churning: " + juce::String(used.load()));
            }
        }
    };

    static BridgeClientTests bridgeClientTests;
}

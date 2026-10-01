// native-engine/Source/BridgeClientTests.cpp
#include "BridgeClient.h"
#include "StressTest.h"
#include <juce_core/juce_core.h>
#include <chrono>
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
                for (int r = 0; r < stress::readerThreads(); ++r)
                {
                    readers.emplace_back([&, r]()
                    {
                        int i = r;
                        while (!stop.load())
                            if (client.channelFor(stable[(size_t) (i++ % (int) stable.size())]) == nullptr)
                                missing.fetch_add(1);
                    });
                }

                for (int i = 0; i < stress::kWriterIterations; ++i)
                {
                    publish(client, "churn");
                    client.unloadPlugin("churn");
                }

                stop.store(true);
                for (auto& t : readers)
                    t.join();
                expectEquals(missing.load(), 0);
            }

            // A bridged slot stuck past the deadline (the reader doesn't leave its scope)
            // must not hang unloadPlugin: it returns at the deadline, the slot is gone
            // from the published map, and the old map -- with the channel in it -- is
            // leaked rather than freed under the reader, until a later grace period
            // completes.
            beginTest("unloadPlugin returns at the deadline and leaks the old map while a reader is stuck");
            {
                BridgeClient client({});
                publish(client, "stuck");
                std::weak_ptr<SharedAudioChannel> channel = client.publishedChannels.load()->at("stuck");

                std::atomic<bool> entered { false };
                std::atomic<bool> release { false };
                std::thread hungAudioThread([&]()
                {
                    BridgeClient::ReadScope scope(client);
                    entered.store(true);
                    while (!release.load())
                        std::this_thread::sleep_for(std::chrono::milliseconds(1));
                });
                while (!entered.load())
                    std::this_thread::yield();

                const auto start = std::chrono::steady_clock::now();
                client.unloadPlugin("stuck");
                const double waitedMs =
                    std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();

                expectGreaterOrEqual(waitedMs, (double) GracePeriod::kDefaultTimeout.count() - 50.0);
                expectLessThan(waitedMs, (double) GracePeriod::kDefaultTimeout.count() + 3000.0);
                expect(client.channelFor("stuck") == nullptr);
                expect(!channel.expired()); // leaked with the old map, not freed

                release.store(true);
                hungAudioThread.join();
                expect(!channel.expired());

                publish(client, "next");    // a grace period that completes...
                expect(channel.expired());  // ...reclaims the parked map
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
                            // Several round trips per lookup: the bug is a channel freed
                            // between lookup and use, so the longer the use, the more
                            // reliably a regression shows up at CI-sized iteration counts.
                            // One thread only -- the channel's rings are single-producer,
                            // single-consumer.
                            for (int k = 0; k < 8; ++k)
                            {
                                channel->writeInputAndSignal(in, 16);
                                channel->waitAndReadOutput(out, 16, 0);
                            }
                            used.fetch_add(1);
                        }
                    }
                });

                for (int i = 0; i < stress::kWriterIterations; ++i)
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

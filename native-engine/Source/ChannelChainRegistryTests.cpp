// native-engine/Source/ChannelChainRegistryTests.cpp
#include "ChannelChainRegistry.h"
#include <juce_core/juce_core.h>
#include <thread>

namespace sssketch
{
    namespace
    {
        class GainTestPlugin : public juce::AudioProcessor
        {
        public:
            explicit GainTestPlugin(float g) : gain(g) {}
            const juce::String getName() const override { return "GainTestPlugin"; }
            void prepareToPlay(double, int) override {}
            void releaseResources() override {}
            void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override { buffer.applyGain(gain); }
            double getTailLengthSeconds() const override { return 0.0; }
            bool acceptsMidi() const override { return false; }
            bool producesMidi() const override { return false; }
            juce::AudioProcessorEditor* createEditor() override { return nullptr; }
            bool hasEditor() const override { return false; }
            int getNumPrograms() override { return 1; }
            int getCurrentProgram() override { return 0; }
            void setCurrentProgram(int) override {}
            const juce::String getProgramName(int) override { return {}; }
            void changeProgramName(int, const juce::String&) override {}
            void getStateInformation(juce::MemoryBlock&) override {}
            void setStateInformation(const void*, int) override {}

        private:
            float gain;
        };

        PluginChain::Instantiator fakeInstantiator()
        {
            return [](const juce::String& path, double, int, juce::String& errorOut) -> std::unique_ptr<juce::AudioProcessor>
            {
                errorOut = {};
                if (path.isEmpty())
                    return nullptr;
                return std::make_unique<GainTestPlugin>(0.5f);
            };
        }

        class ChannelChainRegistryTests : public juce::UnitTest
        {
        public:
            ChannelChainRegistryTests() : juce::UnitTest("ChannelChainRegistry", "ChannelChainRegistry") {}

            void runTest() override
            {
                beginTest("chainFor returns nullptr for an unknown channel");
                {
                    ChannelChainRegistry registry(fakeInstantiator());
                    expect(registry.chainFor("ch-1") == nullptr);
                }

                beginTest("updateChannelSet creates a chain for a new channel id");
                {
                    ChannelChainRegistry registry(fakeInstantiator());
                    registry.updateChannelSet({ "ch-1" });
                    expect(registry.chainFor("ch-1") != nullptr);
                }

                beginTest("a loaded plugin survives an updateChannelSet call that keeps the channel");
                {
                    ChannelChainRegistry registry(fakeInstantiator());
                    registry.updateChannelSet({ "ch-1" });
                    juce::String err;
                    expect(registry.chainFor("ch-1")->loadPluginSync(0, "some-plugin", 44100.0, 512, err));

                    // Same channel id present again -- the chain (and its loaded plugin) must be
                    // the SAME instance, not a fresh empty one, proven by processing actually
                    // applying the gain the loaded fake plugin was constructed with.
                    registry.updateChannelSet({ "ch-1", "ch-2" });
                    auto* chain = registry.chainFor("ch-1");
                    expect(chain != nullptr);
                    float l[1] = { 10.0f };
                    float r[1] = { 10.0f };
                    chain->process(1, l, r);
                    expectWithinAbsoluteError(l[0], 5.0f, 0.0001f); // 10 * 0.5 gain from the loaded fake plugin
                }

                beginTest("a channel dropped from updateChannelSet is no longer found");
                {
                    ChannelChainRegistry registry(fakeInstantiator());
                    registry.updateChannelSet({ "ch-1", "ch-2" });
                    expect(registry.chainFor("ch-1") != nullptr);
                    registry.updateChannelSet({ "ch-2" });
                    expect(registry.chainFor("ch-1") == nullptr);
                    expect(registry.chainFor("ch-2") != nullptr);
                }

                beginTest("concurrent chainFor reads never see a torn map while updateChannelSet runs repeatedly");
                {
                    ChannelChainRegistry registry(fakeInstantiator());
                    std::atomic<bool> stop { false };
                    std::atomic<bool> sawNullDuringSteadyState { false };

                    // "Audio thread": once ch-1 has been added the first time, it should
                    // NEVER observe chainFor("ch-1") == nullptr again, no matter how many
                    // times updateChannelSet runs concurrently with other channel ids
                    // being added/removed around it.
                    registry.updateChannelSet({ "ch-1" });
                    std::thread reader([&]()
                    {
                        while (!stop.load())
                        {
                            if (registry.chainFor("ch-1") == nullptr)
                                sawNullDuringSteadyState.store(true);
                        }
                    });

                    for (int i = 0; i < 200; ++i)
                        registry.updateChannelSet({ "ch-1", "extra-" + juce::String(i) });

                    stop.store(true);
                    reader.join();
                    expect(!sawNullDuringSteadyState.load());
                }

                // The map a reader is inside must not be freed under it. updateChannelSet used
                // to swap in a new map and hand the old one straight to a deleter thread, so a
                // reader that had loaded the old pointer just before the swap could still be
                // walking its buckets when it was freed. A wide map, several readers and a lot
                // of swaps make that window easy to hit; AddressSanitizer reports it as a
                // heap-use-after-free, and MallocScribble=1 turns it into a crash without ASan.
                beginTest("stress: chainFor never reads a map that updateChannelSet has freed");
                {
                    ChannelChainRegistry registry(fakeInstantiator());
                    std::vector<juce::String> stable;
                    for (int i = 0; i < 48; ++i)
                        stable.push_back("ch-" + juce::String(i));
                    registry.updateChannelSet(stable);

                    std::atomic<bool> stop { false };
                    std::atomic<int> missing { 0 };
                    std::vector<std::thread> readers;
                    for (int r = 0; r < 4; ++r)
                    {
                        readers.emplace_back([&, r]()
                        {
                            int i = r;
                            while (!stop.load())
                            {
                                if (registry.chainFor(stable[(size_t) (i++ % (int) stable.size())]) == nullptr)
                                    missing.fetch_add(1);
                            }
                        });
                    }

                    for (int i = 0; i < 2000; ++i)
                    {
                        auto ids = stable;
                        ids.push_back("extra-" + juce::String(i));
                        registry.updateChannelSet(ids);
                    }

                    stop.store(true);
                    for (auto& t : readers)
                        t.join();
                    expectEquals(missing.load(), 0);
                }

                // The chain chainFor hands back has to outlive the lookup too: renderBlock calls
                // process() on it after chainFor has returned, and a channel dropped by a
                // concurrent updateChannelSet has its PluginChain destroyed along with the old
                // map. Holding a ReadScope across lookup-and-use, as renderBlock does, keeps it
                // alive until the scope ends.
                beginTest("stress: a chain used inside a ReadScope is not destroyed by a concurrent updateChannelSet");
                {
                    ChannelChainRegistry registry(fakeInstantiator());
                    std::atomic<bool> stop { false };
                    std::atomic<int> processed { 0 };

                    std::thread audio([&]()
                    {
                        float l[64] {};
                        float r[64] {};
                        while (!stop.load())
                        {
                            registry.applyPendingSwaps();
                            ChannelChainRegistry::ReadScope scope(registry);
                            registry.setPosition(1.0);
                            if (auto* chain = registry.chainFor("churn"))
                            {
                                chain->process(64, l, r);
                                processed.fetch_add(1);
                            }
                        }
                    });

                    for (int i = 0; i < 2000; ++i)
                        registry.updateChannelSet(i % 2 == 0 ? std::vector<juce::String> { "keep", "churn" }
                                                             : std::vector<juce::String> { "keep" });

                    stop.store(true);
                    audio.join();
                    expect(registry.chainFor("keep") != nullptr);
                    expect(registry.chainFor("churn") == nullptr);
                    logMessage("chains processed while churning: " + juce::String(processed.load()));
                }
            }
        };

        static ChannelChainRegistryTests channelChainRegistryTests;
    }
}

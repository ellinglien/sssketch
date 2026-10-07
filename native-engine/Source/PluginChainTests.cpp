// native-engine/Source/PluginChainTests.cpp
#include "PluginChain.h"
#include "StressTest.h"
#include <juce_audio_processors/juce_audio_processors.h>
#include <atomic>
#include <chrono>
#include <map>
#include <thread>

namespace sssketch
{
    namespace
    {
        /** A trivial test plugin: multiplies every sample by `gain`. Used to
         * prove slots run IN SERIES (order matters) rather than in parallel. */
        class GainTestPlugin : public juce::AudioProcessor
        {
        public:
            explicit GainTestPlugin(float g) : gain(g) {}
            const juce::String getName() const override { return "GainTestPlugin"; }
            void prepareToPlay(double, int) override {}
            void releaseResources() override {}
            void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
            {
                buffer.applyGain(gain);
            }
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

        /** Writes a constant NaN into every sample it processes — proves
         * process() drops non-finite output before it reaches outL/outR. */
        class NanTestPlugin : public juce::AudioProcessor
        {
        public:
            const juce::String getName() const override { return "NanTestPlugin"; }
            void prepareToPlay(double, int) override {}
            void releaseResources() override {}
            void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
            {
                for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
                {
                    buffer.clear(ch, 0, buffer.getNumSamples());
                    buffer.addSample(ch, 0, std::nanf(""));
                }
            }
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
        };

        /** Captures whatever bpm its own playhead reports during processBlock,
         * so tests can verify PluginChain::setBpm() actually reaches a loaded
         * plugin, and that it stays live (queried fresh each block, not
         * snapshotted once at load time). */
        class BpmCapturingTestPlugin : public juce::AudioProcessor
        {
        public:
            const juce::String getName() const override { return "BpmCapturingTestPlugin"; }
            void prepareToPlay(double, int) override {}
            void releaseResources() override {}
            void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override
            {
                auto* ph = getPlayHead();
                if (ph == nullptr)
                    return;
                auto position = ph->getPosition();
                if (position.hasValue() && position->getBpm().hasValue())
                    lastSeenBpm = *position->getBpm();
                if (position.hasValue() && position->getPpqPosition().hasValue())
                    lastSeenPpq = *position->getPpqPosition();
            }
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

            double lastSeenBpm = 0.0;
            double lastSeenPpq = 0.0;
        };

        // outPlugin is set to the constructed instance's raw pointer, so the
        // test can inspect lastSeenBpm after ownership moves into the chain.
        PluginChain::Instantiator bpmCaptureInstantiator(BpmCapturingTestPlugin*& outPlugin)
        {
            return [&outPlugin](
                       const juce::String& pluginId, double, int, juce::String& errorOut) -> std::unique_ptr<juce::AudioProcessor>
            {
                errorOut = {};
                if (pluginId.isEmpty())
                    return nullptr;
                auto plugin = std::make_unique<BpmCapturingTestPlugin>();
                outPlugin = plugin.get();
                return plugin;
            };
        }

        /** Records whatever bytes setStateInformation was last called with,
         * and returns a fixed, known blob from getStateInformation -- lets
         * tests verify the full capture/apply round trip without needing a
         * real plugin binary. */
        class StateCapturingTestPlugin : public juce::AudioProcessor
        {
        public:
            const juce::String getName() const override { return "StateCapturingTestPlugin"; }
            void prepareToPlay(double, int) override {}
            void releaseResources() override {}
            void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override {}
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
            void getStateInformation(juce::MemoryBlock& block) override
            {
                block.append(fixedState, sizeof(fixedState));
            }
            void setStateInformation(const void* data, int size) override
            {
                lastAppliedState.assign((const char*) data, (const char*) data + size);
            }

            static constexpr char fixedState[4] = { 1, 2, 3, 4 };
            std::vector<char> lastAppliedState;
        };

        PluginChain::Instantiator stateCaptureInstantiator(StateCapturingTestPlugin*& outPlugin)
        {
            return [&outPlugin](
                       const juce::String& pluginId, double, int, juce::String& errorOut) -> std::unique_ptr<juce::AudioProcessor>
            {
                errorOut = {};
                if (pluginId.isEmpty())
                    return nullptr;
                auto plugin = std::make_unique<StateCapturingTestPlugin>();
                outPlugin = plugin.get();
                return plugin;
            };
        }

        /** Shared bookkeeping for TrackedTestPlugin: how many were destroyed,
         * and whether every destruction happened on the message thread. */
        struct DestructionTracker
        {
            std::atomic<int> destroyed { 0 };
            std::atomic<int> destroyedOffMessageThread { 0 };
        };

        /** Owns real heap state that both processBlock and
         * getStateInformation read, so touching a destroyed instance is a
         * heap-use-after-free AddressSanitizer reports. Applies `gain`, so a
         * test can tell which instance is live. */
        class TrackedTestPlugin : public juce::AudioProcessor
        {
        public:
            TrackedTestPlugin(DestructionTracker& t, float g) : tracker(t), gain(g), payload(256, (char) 7) {}
            ~TrackedTestPlugin() override
            {
                if (!juce::MessageManager::existsAndIsCurrentThread())
                    tracker.destroyedOffMessageThread.fetch_add(1);
                tracker.destroyed.fetch_add(1);
            }
            const juce::String getName() const override { return "TrackedTestPlugin"; }
            void prepareToPlay(double, int) override {}
            void releaseResources() override {}
            void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
            {
                buffer.applyGain(gain * (float) payload[0] / 7.0f);
            }
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
            void getStateInformation(juce::MemoryBlock& block) override
            {
                // Slow on purpose, BEFORE touching our own heap state: a capture that
                // started on an instance the audio thread is swapping out is then still
                // in here when that instance is destroyed, and the read below is a
                // heap-use-after-free ASan reports -- instead of a race too narrow to
                // ever be seen. (Real plugins' state capture can take far longer.)
                std::this_thread::sleep_for(std::chrono::microseconds(200));
                block.append(payload.data(), payload.size());
            }
            void setStateInformation(const void*, int) override {}

        private:
            DestructionTracker& tracker;
            const float gain;
            const std::vector<char> payload;
        };

        /** pluginId "gain:<g>" -> a TrackedTestPlugin applying gain g. */
        PluginChain::Instantiator trackedInstantiator(DestructionTracker& tracker)
        {
            return [&tracker](const juce::String& pluginId, double, int, juce::String& errorOut) -> std::unique_ptr<juce::AudioProcessor>
            {
                errorOut = {};
                if (pluginId.isEmpty())
                    return nullptr;
                return std::make_unique<TrackedTestPlugin>(
                    tracker, pluginId.fromFirstOccurrenceOf(":", false, false).getFloatValue());
            };
        }

        /** requestLoad() instantiates via MessageManager::callAsync, so pump
         * the message loop (the tests run on the message thread) until its
         * onLoaded fires. */
        bool requestLoadAndWait(PluginChain& chain, int slot, const juce::String& pluginId)
        {
            bool done = false;
            bool ok = false;
            chain.requestLoad(slot, pluginId, 44100.0, 64, [&](bool success, const juce::String&)
            {
                ok = success;
                done = true;
            });
            for (int i = 0; i < 2000 && !done; ++i)
                juce::MessageManager::getInstance()->runDispatchLoopUntil(1);
            return done && ok;
        }

        PluginChain::Instantiator fakeInstantiator(std::map<int, float> gainsBySlot)
        {
            // Captured by value into the returned std::function; slotIndex isn't
            // known at instantiation time (only pluginId is), so tests instead
            // encode "which slot" into the pluginId itself (e.g. "gain:0").
            return [gainsBySlot](
                       const juce::String& pluginId, double, int, juce::String& errorOut) -> std::unique_ptr<juce::AudioProcessor>
            {
                errorOut = {};
                if (pluginId.isEmpty())
                    return nullptr;
                if (pluginId == "nan-plugin")
                    return std::make_unique<NanTestPlugin>();
                if (pluginId.startsWith("gain:"))
                {
                    const int slot = pluginId.fromFirstOccurrenceOf(":", false, false).getIntValue();
                    return std::make_unique<GainTestPlugin>(gainsBySlot.at(slot));
                }
                errorOut = "unknown test plugin id";
                return nullptr;
            };
        }

        class PluginChainTests : public juce::UnitTest
        {
        public:
            PluginChainTests() : juce::UnitTest("PluginChain", "PluginChain") {}

            void runTest() override
            {
                beginTest("empty chain is a no-op passthrough");
                {
                    PluginChain chain(4);
                    chain.applyPendingSwaps();
                    float l[4] = { 1.0f, 2.0f, 3.0f, 4.0f };
                    float r[4] = { 1.0f, 2.0f, 3.0f, 4.0f };
                    chain.process(4, l, r);
                    expectEquals(l[0], 1.0f);
                    expectEquals(r[3], 4.0f);
                }

                beginTest("two slots process in series, order matters");
                {
                    // Slot 0 halves, slot 1 halves again -> net *0.25, not *0.5 as
                    // parallel accumulation would produce.
                    PluginChain chain(4, fakeInstantiator({ { 0, 0.5f }, { 1, 0.5f } }));
                    juce::String err;
                    expect(chain.loadPluginSync(0, "gain:0", 44100.0, 512, err));
                    expect(chain.loadPluginSync(1, "gain:1", 44100.0, 512, err));

                    float l[2] = { 8.0f, 4.0f };
                    float r[2] = { 8.0f, 4.0f };
                    chain.process(2, l, r);
                    expectWithinAbsoluteError(l[0], 2.0f, 0.0001f); // 8 * 0.5 * 0.5
                    expectWithinAbsoluteError(r[1], 1.0f, 0.0001f); // 4 * 0.5 * 0.5
                }

                beginTest("a non-finite sample from one slot is dropped, not propagated");
                {
                    PluginChain chain(4, fakeInstantiator({}));
                    juce::String err;
                    expect(chain.loadPluginSync(0, "nan-plugin", 44100.0, 512, err));

                    float l[1] = { 5.0f };
                    float r[1] = { 5.0f };
                    chain.process(1, l, r);
                    expect(std::isfinite(l[0]));
                    expect(std::isfinite(r[0]));
                }

                beginTest("setBpm reaches a loaded plugin's own playhead, live on every block");
                {
                    BpmCapturingTestPlugin* raw = nullptr;
                    PluginChain chain(4, bpmCaptureInstantiator(raw));
                    chain.setBpm(140.0);
                    juce::String err;
                    expect(chain.loadPluginSync(0, "any-id", 44100.0, 512, err));
                    expect(raw != nullptr);

                    float l[1] = { 0.0f };
                    float r[1] = { 0.0f };
                    chain.process(1, l, r);
                    expectWithinAbsoluteError(raw->lastSeenBpm, 140.0, 0.0001);

                    // Changing bpm after load must be reflected on the NEXT
                    // process() call too -- the playhead is queried live by
                    // the plugin each block, not snapshotted once at load
                    // time.
                    chain.setBpm(90.0);
                    chain.process(1, l, r);
                    expectWithinAbsoluteError(raw->lastSeenBpm, 90.0, 0.0001);
                }

                beginTest("setPosition reaches a loaded plugin's own playhead as PPQ "
                          "(positionBars * 4.0), live on every block");
                {
                    BpmCapturingTestPlugin* raw = nullptr;
                    PluginChain chain(4, bpmCaptureInstantiator(raw));
                    juce::String err;
                    expect(chain.loadPluginSync(0, "any-id", 44100.0, 512, err));
                    expect(raw != nullptr);

                    chain.setPosition(2.5); // 2.5 bars -> 10.0 PPQ (4 beats/bar, this app's fixed assumption)
                    float l[1] = { 0.0f };
                    float r[1] = { 0.0f };
                    chain.process(1, l, r);
                    expectWithinAbsoluteError(raw->lastSeenPpq, 10.0, 0.0001);

                    chain.setPosition(1.0);
                    chain.process(1, l, r);
                    expectWithinAbsoluteError(raw->lastSeenPpq, 4.0, 0.0001);
                }

                beginTest("captureStateBase64 round-trips through applyStateBase64 via loadPluginSync");
                {
                    StateCapturingTestPlugin* raw = nullptr;
                    PluginChain chain(4, stateCaptureInstantiator(raw));
                    juce::String err;
                    expect(chain.loadPluginSync(0, "any-id", 44100.0, 512, err));
                    expect(raw != nullptr);

                    const auto captured = chain.captureStateBase64(0);
                    expect(captured.isNotEmpty());

                    // A second slot, loaded WITH the captured state passed straight through.
                    StateCapturingTestPlugin* raw2 = nullptr;
                    PluginChain chain2(4, stateCaptureInstantiator(raw2));
                    juce::String err2;
                    expect(chain2.loadPluginSync(0, "any-id", 44100.0, 512, err2, captured));
                    expect(raw2 != nullptr);
                    expect(raw2->lastAppliedState.size() == 4);
                    expectEquals((int) raw2->lastAppliedState[0], 1);
                    expectEquals((int) raw2->lastAppliedState[1], 2);
                    expectEquals((int) raw2->lastAppliedState[2], 3);
                    expectEquals((int) raw2->lastAppliedState[3], 4);
                }

                beginTest("captureStateBase64 returns empty for an empty slot");
                {
                    PluginChain chain(4, fakeInstantiator({}));
                    expect(chain.captureStateBase64(0).isEmpty());
                }

                // The renderer drops a slot's saved settings once its load reports success;
                // a capture between that reply and the audio thread's swap must still see
                // the loaded plugin, or the settings are gone (advanced features switch off).
                beginTest("captureStateBase64 sees a loaded plugin the audio thread hasn't swapped in yet");
                {
                    StateCapturingTestPlugin* raw = nullptr;
                    PluginChain chain(4, stateCaptureInstantiator(raw));
                    bool done = false;
                    chain.requestLoad(0, "any-id", 44100.0, 64, [&](bool, const juce::String&) { done = true; });
                    for (int i = 0; i < 2000 && !done; ++i)
                        juce::MessageManager::getInstance()->runDispatchLoopUntil(1);
                    expect(done);
                    // No applyPendingSwaps: the load is still pending.
                    juce::MemoryBlock expected(StateCapturingTestPlugin::fixedState, sizeof(StateCapturingTestPlugin::fixedState));
                    expectEquals(chain.captureStateBase64(0), expected.toBase64Encoding());
                }

                beginTest("captureStateBase64 returns empty for a slot whose pending swap is an unload");
                {
                    StateCapturingTestPlugin* raw = nullptr;
                    PluginChain chain(4, stateCaptureInstantiator(raw));
                    juce::String err;
                    expect(chain.loadPluginSync(0, "any-id", 44100.0, 512, err));
                    expect(chain.captureStateBase64(0).isNotEmpty());
                    bool done = false;
                    chain.requestLoad(0, "", 44100.0, 64, [&](bool, const juce::String&) { done = true; });
                    for (int i = 0; i < 2000 && !done; ++i)
                        juce::MessageManager::getInstance()->runDispatchLoopUntil(1);
                    expect(done);
                    expect(chain.captureStateBase64(0).isEmpty());
                    chain.applyPendingSwaps();
                    chain.drainRetired();
                }

                // applyPendingSwaps (audio thread) used to hand the instance it replaced
                // to a detached thread for deletion, while captureStateBase64 (message
                // thread, the get-plugin-states IPC handler) read slot.active with no
                // synchronisation at all -- so a capture racing a swap could run
                // getStateInformation on an instance being destroyed on a third thread.
                beginTest("stress: captureStateBase64 during swaps never touches a destroyed plugin");
                {
                    DestructionTracker tracker;
                    {
                        PluginChain chain(2, trackedInstantiator(tracker));
                        std::atomic<bool> stop { false };
                        std::thread audio([&]()
                        {
                            float l[64] {};
                            float r[64] {};
                            while (!stop.load())
                            {
                                chain.applyPendingSwaps();
                                chain.process(64, l, r);
                                // A real device callback comes round every few ms, not
                                // back to back; leaving gaps is what lets a capture start
                                // on the outgoing instance before the swap lands.
                                std::this_thread::sleep_for(std::chrono::microseconds(50));
                            }
                        });

                        int loaded = 0;
                        for (int i = 0; i < stress::kWriterIterations; ++i)
                        {
                            if (requestLoadAndWait(chain, 0, "gain:" + juce::String(0.5 + 0.001 * i)))
                                ++loaded;
                            for (int k = 0; k < 4; ++k)
                                chain.captureStateBase64(0);
                            // What IpcConnection's timer does between messages.
                            chain.drainRetired();
                        }

                        stop.store(true);
                        audio.join();
                        expectEquals(loaded, stress::kWriterIterations);
                    }
                    expectEquals(tracker.destroyed.load(), stress::kWriterIterations);
                    expectEquals(tracker.destroyedOffMessageThread.load(), 0);
                }

                beginTest("a swap is deferred while the slot's retired cell is occupied, and lands on the next block after a drain");
                {
                    DestructionTracker tracker;
                    PluginChain chain(2, trackedInstantiator(tracker));
                    auto gainNow = [&]()
                    {
                        float l[1] = { 1.0f };
                        float r[1] = { 1.0f };
                        chain.process(1, l, r);
                        return l[0];
                    };

                    expect(requestLoadAndWait(chain, 0, "gain:0.5"));
                    chain.applyPendingSwaps(); // empty slot -> A, nothing retired
                    expectWithinAbsoluteError(gainNow(), 0.5f, 0.0001f);

                    expect(requestLoadAndWait(chain, 0, "gain:0.25"));
                    chain.applyPendingSwaps(); // A -> B, A parked in the retired cell
                    expectWithinAbsoluteError(gainNow(), 0.25f, 0.0001f);
                    expectEquals(tracker.destroyed.load(), 0); // nothing freed on the "audio thread"

                    expect(requestLoadAndWait(chain, 0, "gain:2"));
                    chain.applyPendingSwaps(); // cell occupied: C must wait
                    chain.applyPendingSwaps();
                    expectWithinAbsoluteError(gainNow(), 0.25f, 0.0001f); // still B

                    chain.drainRetired();      // destroys A, frees the cell
                    expectEquals(tracker.destroyed.load(), 1);
                    expectWithinAbsoluteError(gainNow(), 0.25f, 0.0001f); // nothing swaps until the next block...
                    chain.applyPendingSwaps();                              // ...which takes C
                    expectWithinAbsoluteError(gainNow(), 2.0f, 0.0001f);

                    chain.drainRetired();
                    expectEquals(tracker.destroyed.load(), 2);             // B
                }

                beginTest("swapped-out plugins are destroyed on the message thread, never the audio thread");
                {
                    DestructionTracker tracker;
                    {
                        PluginChain chain(2, trackedInstantiator(tracker));
                        for (int i = 0; i < 5; ++i)
                        {
                            expect(requestLoadAndWait(chain, 0, "gain:1"));
                            std::thread audio([&]() { chain.applyPendingSwaps(); }); // a real other thread
                            audio.join();
                            expectEquals(tracker.destroyed.load(), i == 0 ? 0 : i - 1); // the swap itself frees nothing
                            chain.drainRetired();
                            expectEquals(tracker.destroyed.load(), i);
                        }
                        // The current plugin is destroyed with the chain -- here, on the
                        // message thread, too.
                    }
                    expectEquals(tracker.destroyed.load(), 5);
                    expectEquals(tracker.destroyedOffMessageThread.load(), 0);
                }

                beginTest("a newer load replacing one the audio thread never took is destroyed on the message thread");
                {
                    DestructionTracker tracker;
                    PluginChain chain(2, trackedInstantiator(tracker));
                    expect(requestLoadAndWait(chain, 0, "gain:0.5"));
                    expect(requestLoadAndWait(chain, 0, "gain:0.25")); // replaces the untaken pending one
                    expectEquals(tracker.destroyed.load(), 1);
                    expectEquals(tracker.destroyedOffMessageThread.load(), 0);
                    chain.applyPendingSwaps();
                    float l[1] = { 1.0f };
                    float r[1] = { 1.0f };
                    chain.process(1, l, r);
                    expectWithinAbsoluteError(l[0], 0.25f, 0.0001f);
                }
            }
        };

        static PluginChainTests pluginChainTests;
    }
}

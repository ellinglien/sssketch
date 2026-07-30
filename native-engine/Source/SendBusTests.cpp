// native-engine/Source/SendBusTests.cpp
#include "SendBus.h"
#include <juce_core/juce_core.h>
#include <thread>
#include <atomic>

namespace ssstitch
{
    /** Minimal AudioProcessor stand-in for tests: doubles every input
     * sample. Implements only the pure virtuals SendBus actually calls
     * (prepareToPlay/processBlock/channel counts) plus the handful
     * AudioProcessor itself requires a concrete override for. */
    class GainDoublingProcessor : public juce::AudioProcessor
    {
    public:
        GainDoublingProcessor()
            : juce::AudioProcessor(BusesProperties()
                .withInput("Input", juce::AudioChannelSet::stereo())
                .withOutput("Output", juce::AudioChannelSet::stereo()))
        {}

        void prepareToPlay(double, int) override {}
        void releaseResources() override {}
        void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
        {
            buffer.applyGain(2.0f);
        }

        const juce::String getName() const override { return "GainDoublingProcessor"; }
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

    class SendBusTests : public juce::UnitTest
    {
    public:
        SendBusTests() : juce::UnitTest("SendBus") {}

        void runTest() override
        {
            beginTest("a bus with no plugin loaded contributes nothing");
            {
                SendBus bus;
                std::vector<float> l(8, 0.0f), r(8, 0.0f);
                bus.applyPendingSwaps();
                bus.beginBlock(8);
                for (int i = 0; i < 8; ++i)
                    bus.addSample(0, i, 1.0f, 1.0f, 1.0f); // hasPlugin() is false -> no-op
                bus.mixBackInto(8, l.data(), r.data());
                for (float s : l) expectEquals(s, 0.0f);
                for (float s : r) expectEquals(s, 0.0f);
            }

            beginTest("hasPlugin is false for every bus when nothing is loaded");
            {
                SendBus bus;
                for (int i = 0; i < kNumSendBuses; ++i)
                    expect(!bus.hasPlugin(i));
            }

            beginTest("loadPluginSync loads a fake processor and it becomes active");
            {
                bool created = false;
                SendBus bus([&](const juce::String& id, double, int, juce::String& err) -> std::unique_ptr<juce::AudioProcessor>
                {
                    if (id.isEmpty()) { return nullptr; }
                    created = true;
                    err = {};
                    return std::make_unique<GainDoublingProcessor>();
                });
                juce::String error;
                expect(bus.loadPluginSync(0, "fake-plugin", 44100.0, 512, error));
                expect(error.isEmpty());
                expect(created);
                expect(bus.hasPlugin(0));
                expect(!bus.hasPlugin(1)); // untouched buses stay empty
            }

            beginTest("a loaded bus doubles gain (proves mixBackInto actually runs processBlock)");
            {
                SendBus bus([](const juce::String&, double, int, juce::String& err) -> std::unique_ptr<juce::AudioProcessor>
                {
                    err = {};
                    return std::make_unique<GainDoublingProcessor>();
                });
                juce::String error;
                bus.loadPluginSync(0, "fake-plugin", 44100.0, 512, error);

                std::vector<float> l(4, 0.0f), r(4, 0.0f);
                bus.applyPendingSwaps();
                bus.beginBlock(4);
                bus.addSample(0, 0, 0.5f, 0.5f, 1.0f); // sendLevel 1.0 -> 0.5 into the bus -> doubled to 1.0
                bus.mixBackInto(4, l.data(), r.data());
                expectWithinAbsoluteError(l[0], 1.0f, 1.0e-6f);
                expectWithinAbsoluteError(r[0], 1.0f, 1.0e-6f);
            }

            beginTest("sendLevel scales what reaches a loaded bus");
            {
                SendBus bus([](const juce::String&, double, int, juce::String& err) -> std::unique_ptr<juce::AudioProcessor>
                {
                    err = {};
                    return std::make_unique<GainDoublingProcessor>();
                });
                juce::String error;
                bus.loadPluginSync(0, "fake-plugin", 44100.0, 512, error);

                std::vector<float> l(4, 0.0f), r(4, 0.0f);
                bus.applyPendingSwaps();
                bus.beginBlock(4);
                bus.addSample(0, 0, 1.0f, 1.0f, 0.25f); // 0.25 into the bus -> doubled to 0.5
                bus.mixBackInto(4, l.data(), r.data());
                expectWithinAbsoluteError(l[0], 0.5f, 1.0e-6f);
            }

            beginTest("addSample with sendLevel 0 does not contribute even on a loaded bus");
            {
                SendBus bus([](const juce::String&, double, int, juce::String& err) -> std::unique_ptr<juce::AudioProcessor>
                {
                    err = {};
                    return std::make_unique<GainDoublingProcessor>();
                });
                juce::String error;
                bus.loadPluginSync(0, "fake-plugin", 44100.0, 512, error);

                std::vector<float> l(4, 0.0f), r(4, 0.0f);
                bus.applyPendingSwaps();
                bus.beginBlock(4);
                bus.addSample(0, 0, 1.0f, 1.0f, 0.0f);
                bus.mixBackInto(4, l.data(), r.data());
                expectEquals(l[0], 0.0f);
            }

            beginTest("requestLoad instantiates on a background thread and applyPendingSwaps promotes it");
            {
                std::atomic<bool> instantiateRanOffAudioThread { false };
                const auto testThreadId = std::this_thread::get_id();
                SendBus bus([&](const juce::String&, double, int, juce::String& err) -> std::unique_ptr<juce::AudioProcessor>
                {
                    if (std::this_thread::get_id() != testThreadId)
                        instantiateRanOffAudioThread.store(true);
                    err = {};
                    return std::make_unique<GainDoublingProcessor>();
                });

                std::atomic<bool> loadedCallbackFired { false };
                bus.requestLoad(0, "fake-plugin", 44100.0, 512, [&](bool success, const juce::String&)
                {
                    loadedCallbackFired.store(success);
                });

                // requestLoad is async — poll briefly for the background
                // thread to finish, matching how the real IPC round trip
                // (Task 7) will also wait on a callback rather than a fixed
                // delay in production code; a bounded poll is fine in a test.
                for (int i = 0; i < 100 && !loadedCallbackFired.load(); ++i)
                    juce::Thread::sleep(10);

                expect(loadedCallbackFired.load());
                expect(instantiateRanOffAudioThread.load());
                expect(!bus.hasPlugin(0)); // not yet promoted -- applyPendingSwaps hasn't run
                bus.applyPendingSwaps();
                expect(bus.hasPlugin(0));
            }

            beginTest("loading an empty pluginId clears a bus back to no-plugin");
            {
                SendBus bus([](const juce::String& id, double, int, juce::String& err) -> std::unique_ptr<juce::AudioProcessor>
                {
                    err = {};
                    if (id.isEmpty()) return nullptr;
                    return std::make_unique<GainDoublingProcessor>();
                });
                juce::String error;
                bus.loadPluginSync(0, "fake-plugin", 44100.0, 512, error);
                expect(bus.hasPlugin(0));
                bus.loadPluginSync(0, "", 44100.0, 512, error);
                expect(error.isEmpty());
                expect(!bus.hasPlugin(0));
            }
        }
    };

    static SendBusTests sendBusTests;
}

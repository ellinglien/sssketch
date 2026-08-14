// native-engine/Source/PluginChainTests.cpp
#include "PluginChain.h"
#include <juce_audio_processors/juce_audio_processors.h>
#include <map>

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
                    expectEquals((int) raw2->lastAppliedState[3], 4);
                }

                beginTest("captureStateBase64 returns empty for an empty slot");
                {
                    PluginChain chain(4, fakeInstantiator({}));
                    expect(chain.captureStateBase64(0).isEmpty());
                }
            }
        };

        static PluginChainTests pluginChainTests;
    }
}

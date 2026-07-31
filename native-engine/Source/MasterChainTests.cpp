// native-engine/Source/MasterChainTests.cpp
#include "MasterChain.h"
#include <juce_audio_processors/juce_audio_processors.h>
#include <map>

namespace ssstitch
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

        MasterChain::Instantiator fakeInstantiator(std::map<int, float> gainsBySlot)
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

        class MasterChainTests : public juce::UnitTest
        {
        public:
            MasterChainTests() : juce::UnitTest("MasterChain", "MasterChain") {}

            void runTest() override
            {
                beginTest("empty chain is a no-op passthrough");
                {
                    MasterChain chain;
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
                    MasterChain chain(fakeInstantiator({ { 0, 0.5f }, { 1, 0.5f } }));
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
                    MasterChain chain(fakeInstantiator({}));
                    juce::String err;
                    expect(chain.loadPluginSync(0, "nan-plugin", 44100.0, 512, err));

                    float l[1] = { 5.0f };
                    float r[1] = { 5.0f };
                    chain.process(1, l, r);
                    expect(std::isfinite(l[0]));
                    expect(std::isfinite(r[0]));
                }
            }
        };

        static MasterChainTests masterChainTests;
    }
}

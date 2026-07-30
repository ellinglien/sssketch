// native-engine/Source/TestFixtures.h
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>

namespace ssstitch
{
    /** Minimal AudioProcessor stand-in for tests: doubles every input
     * sample. Implements only the pure virtuals SendBus actually calls
     * (prepareToPlay/processBlock/channel counts) plus the handful
     * AudioProcessor itself requires a concrete override for. Shared
     * between SendBusTests.cpp and PlaybackEngineTests.cpp. */
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
}

// native-engine/Source/Transport.cpp
#include "Transport.h"

namespace ssstitch
{
    Transport::Transport(PlaybackEngine& e) : engine(e) {}
    Transport::~Transport() { closeDevice(); }

    bool Transport::openDefaultDevice()
    {
        auto error = deviceManager.initialiseWithDefaultDevices(0, 2);
        if (error.isNotEmpty())
        {
            juce::Logger::writeToLog("Transport: failed to open audio device: " + error);
            return false;
        }
        deviceManager.addAudioCallback(this);
        return true;
    }

    void Transport::closeDevice()
    {
        deviceManager.removeAudioCallback(this);
        deviceManager.closeAudioDevice();
    }

    void Transport::play(double fromPositionBars)
    {
        positionBars.store(fromPositionBars);
        playing.store(true);
    }

    void Transport::pause() { playing.store(false); }

    void Transport::stop()
    {
        playing.store(false);
        positionBars.store(0.0);
    }

    void Transport::setPosition(double bars) { positionBars.store(bars); }

    void Transport::audioDeviceIOCallbackWithContext(
        const float* const* /*inputChannelData*/, int /*numInputChannels*/,
        float* const* outputChannelData, int numOutputChannels,
        int numSamples, const juce::AudioIODeviceCallbackContext&)
    {
        if (numOutputChannels < 2 || outputChannelData[0] == nullptr || outputChannelData[1] == nullptr)
            return;

        auto* outL = outputChannelData[0];
        auto* outR = outputChannelData[1];
        juce::FloatVectorOperations::clear(outL, numSamples);
        juce::FloatVectorOperations::clear(outR, numSamples);

        if (!playing.load() || secPerBar <= 0.0)
            return;

        const double pos = positionBars.load();
        engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR);
        positionBars.store(pos + (numSamples / deviceSampleRate) / secPerBar);
    }

    void Transport::audioDeviceAboutToStart(juce::AudioIODevice* device)
    {
        deviceSampleRate = device->getCurrentSampleRate();
    }

    void Transport::audioDeviceStopped() {}
}

// native-engine/Source/Transport.cpp
#include "Transport.h"
#include "LoopBoundaryFade.h"
#include <cmath>

namespace ssstitch
{
    namespace
    {
        // Matches FadeGain.cpp's own kMicroFadeSec: short enough to be
        // inaudible as an intentional fade, just enough to remove the
        // discontinuity a hard position jump would otherwise produce.
        constexpr double kLoopSeamFadeSec = 0.003;
    }
}

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

        const double loopBars = loopLengthBars.load();
        if (loopBars > 0.0)
        {
            // Declicks the wrap this block is about to perform below (or is
            // approaching, if the wrap itself falls in a later block) — a
            // fixed-duration fade converted to bars at the current tempo, so
            // it stays a constant ~3ms regardless of bpm.
            const double fadeBars = kLoopSeamFadeSec / secPerBar;
            const double barsPerSample = (1.0 / deviceSampleRate) / secPerBar;
            for (int i = 0; i < numSamples; ++i)
            {
                const double samplePosBars = pos + (double) i * barsPerSample;
                const float gain = loopBoundaryGain(samplePosBars, loopBars, fadeBars);
                outL[i] *= gain;
                outR[i] *= gain;
            }
        }

        double newPos = pos + (numSamples / deviceSampleRate) / secPerBar;
        if (loopBars > 0.0)
            newPos = std::fmod(newPos, loopBars);
        positionBars.store(newPos);
    }

    void Transport::audioDeviceAboutToStart(juce::AudioIODevice* device)
    {
        deviceSampleRate = device->getCurrentSampleRate();
    }

    void Transport::audioDeviceStopped() {}
}

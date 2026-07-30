// native-engine/Source/Transport.h
#pragma once
#include "PlaybackEngine.h"
#include <juce_audio_devices/juce_audio_devices.h>
#include <atomic>

namespace ssstitch
{
    /** Owns a real AudioDeviceManager and drives PlaybackEngine::renderBlock
     * from its callback — the transport's position clock IS the audio device's
     * own clock, advanced by exactly numSamples/sampleRate each callback, same
     * as Web Audio's ctx.currentTime advancing via the hardware clock. */
    class Transport : public juce::AudioIODeviceCallback
    {
    public:
        explicit Transport(PlaybackEngine& engine);
        ~Transport() override;

        bool openDefaultDevice(); // returns false if no output device is available
        void closeDevice();

        void play(double fromPositionBars);
        void pause();
        void stop();
        void setPosition(double positionBars);
        double currentPositionBars() const { return positionBars.load(); }
        bool isPlaying() const { return playing.load(); }

        /** The real audio device's own sample rate / callback block size —
         * used when loading a send-bus plugin live, so prepareToPlay() is
         * told the truth instead of an arbitrary hardcoded guess. A plugin
         * prepared for the wrong block size can be called with a
         * processBlock() buffer larger than it allocated internal storage
         * for (undefined behaviour, often a crash); a plugin prepared for
         * the wrong sample rate mistunes any rate-dependent internal
         * coefficients (envelope followers, filters). Defaults (44100Hz /
         * 512 samples) only apply before the device has ever started. */
        double currentSampleRate() const { return deviceSampleRate; }
        int currentBlockSize() const { return deviceBlockSize; }

        void setBpm(double bpm) { secPerBar = bpm > 0.0 ? (60.0 / bpm) * 4.0 : 0.0; }

        // juce::AudioIODeviceCallback
        void audioDeviceIOCallbackWithContext(
            const float* const* inputChannelData, int numInputChannels,
            float* const* outputChannelData, int numOutputChannels,
            int numSamples, const juce::AudioIODeviceCallbackContext& context) override;
        void audioDeviceAboutToStart(juce::AudioIODevice* device) override;
        void audioDeviceStopped() override;

    private:
        PlaybackEngine& engine;
        juce::AudioDeviceManager deviceManager;
        std::atomic<bool> playing { false };
        std::atomic<double> positionBars { 0.0 };
        double secPerBar = 2.0; // updated via setBpm before play(); safe default avoids div-by-zero
        double deviceSampleRate = 44100.0;
        int deviceBlockSize = 512;
    };
}

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

        void setBpm(double bpm) { secPerBar = bpm > 0.0 ? (60.0 / bpm) * 4.0 : 0.0; }

        // 0 (the default) disables wrapping entirely — positionBars advances
        // monotonically forever, same as before this existed. Set from
        // load-project's own loopLengthBars field (see EngineProject.h) so
        // the transport can wrap its own clock in-thread, sample-accurately,
        // instead of the renderer having to notice via its position-update
        // poll and round-trip a correcting set-position over IPC. See
        // LoopBoundaryFade.h for the declick fade applied right at the wrap.
        void setLoopLengthBars(double bars) { loopLengthBars.store(bars); }

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
        std::atomic<double> loopLengthBars { 0.0 }; // 0 = wrapping disabled
        double secPerBar = 2.0; // updated via setBpm before play(); safe default avoids div-by-zero
        double deviceSampleRate = 44100.0;
    };
}

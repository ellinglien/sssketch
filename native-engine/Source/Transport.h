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
    /** Pause and Stop don't cut to silence synchronously — see HaltKind
     * below. */
    enum class HaltKind { None, Pause, Stop };

    class Transport : public juce::AudioIODeviceCallback
    {
    public:
        explicit Transport(PlaybackEngine& engine);
        ~Transport() override;

        bool openDefaultDevice(); // returns false if no output device is available
        void closeDevice();

        void play(double fromPositionBars);
        // Both arm a short fade-out that the audio callback applies to the
        // next block(s) of real content before actually going silent —
        // rather than cutting straight to zero at whatever amplitude the
        // waveform happened to be at, a previously unnoticed click every
        // time either was pressed mid-tone. Pause leaves position where
        // playback had reached once the fade completes; Stop resets it to 0,
        // matching each one's existing pre-fade behavior.
        void pause();
        void stop();
        // Doesn't jump synchronously — a raw position jump mid-waveform is
        // exactly the same class of click as an unfaded pause/stop, just
        // landing on unrelated new content instead of silence. Arms a
        // reposition that the audio callback applies as a quick fade-out at
        // the old position followed by a fade-in at the new one. Repeated
        // calls in quick succession (an active scrub drag calls this on
        // every pointer move) extend the fade-out/hold-at-silence phase
        // rather than each restarting their own fade-in, so a fast drag
        // mutes smoothly instead of clicking or stuttering through every
        // intermediate position — audio only fades back in once the drag
        // settles on wherever it last landed.
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
        // Renders numSamples starting at `pos`, transparently splitting the
        // render and declicking across a loop-boundary crossing if one falls
        // within this block (see LoopBoundaryFade.h) — shared by the normal
        // playback path and both halves of a reposition fade below, so the
        // loop-seam treatment applies uniformly no matter which of those is
        // currently rendering. Returns the new (already wrapped, if
        // applicable) position after this block; doesn't store it —
        // callers decide when/whether to commit it to positionBars.
        double renderLoopAware(double pos, int numSamples, float* outL, float* outR) const;


        PlaybackEngine& engine;
        juce::AudioDeviceManager deviceManager;
        std::atomic<bool> playing { false };
        std::atomic<double> positionBars { 0.0 };
        std::atomic<double> loopLengthBars { 0.0 }; // 0 = wrapping disabled
        std::atomic<HaltKind> pendingHalt { HaltKind::None }; // set by pause()/stop(), consumed once by the audio thread
        std::atomic<bool> repositionRequested { false }; // set by setPosition(), consumed by the audio thread
        std::atomic<double> repositionTarget { 0.0 }; // always the latest requested position
        // All audio-thread-only (never touched off that thread) — no atomics needed.
        bool fadingOut = false;
        HaltKind activeHaltKind = HaltKind::None;
        double haltFadeElapsedSec = 0.0;
        bool repositioning = false;
        bool repositionFadingIn = false;
        double repositionElapsedSec = 0.0;
        double secPerBar = 2.0; // updated via setBpm before play(); safe default avoids div-by-zero
        double deviceSampleRate = 44100.0;
    };
}

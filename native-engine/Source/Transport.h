// native-engine/Source/Transport.h
#pragma once
#include "PlaybackEngine.h"
#include "PluginChain.h"
#include "ChannelChainRegistry.h"
#include "LoopRecorder.h"
#include <juce_audio_devices/juce_audio_devices.h>
#include <atomic>

namespace sssketch
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
        explicit Transport(PlaybackEngine& engine, PluginChain& masterChain, ChannelChainRegistry& channelChains);
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

        /** The real audio device's own sample rate / callback block size —
         * used when loading a master-chain plugin live, so prepareToPlay()
         * is told the truth instead of an arbitrary hardcoded guess. A
         * plugin prepared for the wrong block size can be called with a
         * processBlock() buffer larger than it allocated internal storage
         * for (undefined behaviour, often a crash); a plugin prepared for
         * the wrong sample rate mistunes any rate-dependent internal
         * coefficients (envelope followers, filters). Defaults (44100Hz /
         * 512 samples) only apply before the device has ever started. */
        double currentSampleRate() const { return deviceSampleRate; }
        int currentBlockSize() const { return deviceBlockSize; }

        /** Every input device name CoreAudio currently reports for the
         * active device type -- used by the renderer's input-device
         * dropdown (list-input-devices IPC). Empty if no device type is
         * open yet (shouldn't happen once openDefaultDevice() has
         * succeeded, but defensive rather than assuming). */
        juce::StringArray availableInputDeviceNames() const;

        void setBpm(double bpmValue)
        {
            bpm = bpmValue;
            secPerBar = bpmValue > 0.0 ? (60.0 / bpmValue) * 4.0 : 0.0;
            masterChain.setBpm(bpmValue);
        }

        double currentBpm() const { return bpm; }

        /** Switches the currently-open device's input side to the named
         * device, keeping the existing output device unchanged. Returns
         * an empty string on success, or a human-readable error (e.g. the
         * device no longer exists, or offers no input channels) --
         * mirrors openDefaultDevice()'s own "empty string vs. an error
         * message" convention rather than throwing. */
        juce::String setRecordingInputDevice(const juce::String& deviceName);

        // 0 (the default) disables wrapping entirely — positionBars advances
        // monotonically forever, same as before this existed. Set from
        // load-project's own loopLengthBars field (see EngineProject.h) so
        // the transport can wrap its own clock in-thread, sample-accurately,
        // instead of the renderer having to notice via its position-update
        // poll and round-trip a correcting set-position over IPC. See
        // LoopBoundaryFade.h for the declick fade applied right at the wrap.
        void setLoopLengthBars(double bars) { loopLengthBars.store(bars); }

        // A second, independent loop region -- the recording loop set by
        // arm-recording (IPC), completely separate from the project's own
        // loopLengthBars above (both can be active at once; a short
        // recording loop inside a much longer overall arrangement is the
        // normal case). endBar <= startBar disables it. Message-thread-only
        // call (from IpcConnection::messageReceived), consumed by the audio
        // thread's own renderLoopAware -- both fields are atomics for that
        // handoff, same pattern as loopLengthBars itself.
        void setRecordingLoop(double startBar, double endBar)
        {
            recordingLoopStartBar.store(startBar);
            recordingLoopEndBar.store(endBar);
        }

        // Attaches/detaches the recorder that should receive live input
        // samples and pass-boundary notifications while a recording loop
        // is active. nullptr means "nothing armed" -- the audio thread
        // checks this every block and skips all recording-related work
        // when null, so the unarmed case costs one extra pointer check per
        // block. Message-thread-only call (arm-recording/disarm-recording);
        // the pointer itself is std::atomic for that handoff, matching how
        // every other cross-thread flag in this class already works. The
        // caller (IpcConnection) owns the LoopRecorder instance's actual
        // lifetime -- Transport only ever reads through this pointer, never
        // deletes it.
        void setLoopRecorder(LoopRecorder* recorder) { loopRecorder.store(recorder); }

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
        PluginChain& masterChain;
        ChannelChainRegistry& channelChains;
        juce::AudioDeviceManager deviceManager;
        std::atomic<bool> playing { false };
        std::atomic<double> positionBars { 0.0 };
        std::atomic<double> loopLengthBars { 0.0 }; // 0 = wrapping disabled
        std::atomic<double> recordingLoopStartBar { 0.0 };
        std::atomic<double> recordingLoopEndBar { 0.0 }; // <= start = disabled
        std::atomic<LoopRecorder*> loopRecorder { nullptr }; // nullptr = nothing armed
        std::atomic<HaltKind> pendingHalt { HaltKind::None }; // set by pause()/stop(), consumed once by the audio thread
        // `playing` stays true for the entire duration of a halt fade (only
        // finalization, once the fade completes, sets it false) — so it
        // can't itself be used to detect "Play was just (re)pressed," the
        // signal needed to cancel a fade already in progress. This is that
        // signal, set by play(), consumed once by the audio thread.
        std::atomic<bool> playRequested { false };
        std::atomic<bool> repositionRequested { false }; // set by setPosition(), consumed by the audio thread
        std::atomic<double> repositionTarget { 0.0 }; // always the latest requested position
        // All audio-thread-only (never touched off that thread) — no atomics needed.
        bool fadingOut = false;
        HaltKind activeHaltKind = HaltKind::None;
        double haltFadeElapsedSec = 0.0;
        bool repositioning = false;
        bool repositionFadingIn = false;
        double repositionElapsedSec = 0.0;
        double bpm = 120.0;
        double secPerBar = 2.0; // updated via setBpm before play(); safe default avoids div-by-zero
        double deviceSampleRate = 44100.0;
        int deviceBlockSize = 512;

        // The device name that setRecordingInputDevice() last SUCCESSFULLY
        // applied its full recording configuration to (explicit input
        // channels 0+1, useDefaultInputChannels=false, sampleRate/bufferSize
        // forced to 0/0 for auto-choose -- see that function's own comments
        // for why each of those matters). Deliberately NOT the same thing as
        // "whatever inputDeviceName deviceManager.getAudioDeviceSetup()
        // currently reports" -- see setRecordingInputDevice()'s short-circuit
        // comment for why that distinction is safety-critical. Starts empty,
        // so the first call after openDefaultDevice() (which opens SOME
        // default input device via initialiseWithDefaultDevices, but never
        // applies this function's own explicit recording setup) can never
        // short-circuit just because the OS-default device's name happens to
        // match what's requested.
        juce::String lastConfiguredRecordingInputDevice;
    };
}

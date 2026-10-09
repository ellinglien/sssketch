// native-engine/Source/Transport.h
#pragma once
#include "PlaybackEngine.h"
#include "PluginChain.h"
#include "ChannelChainRegistry.h"
#include "LoopRecorder.h"
#include "GatedLoopRecorder.h"
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
    enum class TransportCommandKind : unsigned long long { None, Play, Pause, Stop };

    class Transport : public juce::AudioIODeviceCallback
    {
    public:
        explicit Transport(PlaybackEngine& engine, PluginChain& masterChain, ChannelChainRegistry& channelChains);
        ~Transport() override;

        // returns false if no output device is available. openInput=false opens output only:
        // opening an input is what asks macOS for the microphone, so the app's advanced
        // features switch keeps it closed while recording is off (Main.cpp's
        // --no-audio-input). Arming still works afterwards: setRecordingInputDevice() names
        // the device and its channels and opens the input then.
        bool openDefaultDevice(bool openInput = true);
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
        /** Returns the ordered command generation that becomes complete only
         * after the audio thread has reached silence. */
        unsigned long long stop();
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

        /** The audio thread's lap clock, for tests that drive the callback themselves (read it
         * between callbacks, never while one runs). */
        LapClock lapClockForTest() const { return lapClock(); }
        bool isPlaying() const { return playing.load(); }
        unsigned long long completedHaltGeneration() const
        {
            return completedHaltCommandGeneration.load();
        }
        /** Deterministic regression seam for the cross-thread Play-during-
         * halt-finalization race. Tests install a no-allocation function
         * pointer before driving the callback; production never sets it. */
        using HaltFinalizationHookForTest = void (*)(void*);
        void setHaltFinalizationHookForTest(HaltFinalizationHookForTest hook, void* context)
        {
            haltFinalizationHookForTest = hook;
            haltFinalizationHookContextForTest = context;
        }

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
        int currentCallbackBlockSize() const { return callbackBlockSize.load(); }

        /** CoreAudio/JUCE's native missed-callback counter and the device
         * manager's smoothed callback load. Read from the message thread for
         * diagnostics; neither value adds work to the real-time callback. */
        int currentXRunCount() const noexcept { return deviceManager.getXRunCount(); }
        double currentCpuUsage() const { return deviceManager.getCpuUsage(); }

        /** Every input device name CoreAudio currently reports for the
         * active device type -- used by the renderer's input-device
         * dropdown (list-input-devices IPC). Empty if no device type is
         * open yet (shouldn't happen once openDefaultDevice() has
         * succeeded, but defensive rather than assuming). Not const: also
         * detects a real device-list change against the last scan and
         * clears the recording-input/output short-circuit caches when one
         * happened -- see lastKnownInputDeviceNames's own doc comment for
         * why this replaced a juce::AudioIODeviceType::Listener. */
        juce::StringArray availableInputDeviceNames();

        /** Same as availableInputDeviceNames(), for output devices --
         * used by the settings menu's output-device dropdown. */
        juce::StringArray availableOutputDeviceNames();

        void setBpm(double bpmValue)
        {
            bpm = bpmValue;
            // Relaxed: the audio thread reads it ONCE per callback (see secPerBar) and runs the
            // whole block, clock included, at that value.
            secPerBar.store(bpmValue > 0.0 ? (60.0 / bpmValue) * 4.0 : 0.0, std::memory_order_relaxed);
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

        /** Switches the currently-open device's output side to the named
         * device, keeping the existing input device unchanged -- the exact
         * mirror of setRecordingInputDevice() above, same short-circuit and
         * same 0/0 sampleRate/bufferSize auto-choose reasoning (see that
         * function's own comments; not repeated here). Doesn't force
         * specific output channels the way setRecordingInputDevice forces
         * input channels 0+1 -- there's no fixed-channel-count requirement
         * on the output side, so this leaves useDefaultOutputChannels/
         * outputChannels exactly as openDefaultDevice()'s own initial
         * initialiseWithDefaultDevices call already set them (JUCE's normal
         * "give me however many channels this device offers, up to stereo"
         * default). Returns an empty string on success, or a human-readable
         * error, same convention as setRecordingInputDevice(). */
        juce::String setOutputDevice(const juce::String& deviceName);

        /** Switches the currently-open device's buffer size, leaving the
         * input/output device selection and sample rate untouched --
         * unlike setRecordingInputDevice/setOutputDevice, this never
         * changes WHICH device is open, just how it's configured, so
         * there's nothing to auto-choose: the requested size is applied
         * directly. JUCE's own chooseBestBufferSize() picks the nearest
         * size the driver actually supports if the exact value isn't
         * offered, same "ask for what you want, let JUCE round to what's
         * real" reasoning openDefaultDevice()'s own kPreferredBufferSize
         * already relies on. Short-circuits on an exact match against the
         * live device's current block size (refreshed every
         * audioDeviceAboutToStart callback) rather than a separate
         * lastConfigured cache -- there's no first-call false-positive
         * hazard here the way device-name matching has (see
         * setRecordingInputDevice's own doc comment for that), since a
         * numeric size actually matching IS actually already configured.
         * Returns an empty string on success, or a human-readable error,
         * same convention as setRecordingInputDevice()/setOutputDevice(). */
        juce::String setBufferSize(int bufferSizeSamples);

        /** Round-trip audio I/O latency (input + output) in samples, as
         * reported by the currently-open device -- captured audio is
         * delayed by roughly this much relative to when the performer
         * actually played it, since neither the record path nor the
         * committed take's timeline placement compensates for it
         * otherwise (see IpcServer's disarm-recording handler, the only
         * caller). Falls back to twice the callback block size (one
         * buffer's worth each direction) when the device reports zero for
         * both -- some CoreAudio devices do that despite a real round
         * trip still existing, and 0 bars of compensation would be worse
         * than an estimate. */
        int roundTripLatencySamples() const;

        /** Pure unit conversion, deliberately static and free of device/
         * transport state so it's unit-testable head-less (no open audio
         * device needed) -- see roundTripLatencySamples() for where the
         * sample count itself comes from. Returns 0.0 rather than NaN/inf
         * if sampleRate or bpmValue is non-positive. */
        static double latencySamplesToBars(int latencySamples, double sampleRate, double bpmValue);

        // 0 (the default) disables wrapping entirely — positionBars advances
        // monotonically forever, same as before this existed. Set from
        // load-project's own loopLengthBars field (see EngineProject.h) so
        // the transport can wrap its own clock in-thread, sample-accurately,
        // instead of the renderer having to notice via its position-update
        // poll and round-trip a correcting set-position over IPC. See
        // LoopBoundaryFade.h for the declick fade applied right at the wrap.
        void setLoopLengthBars(double bars) { loopLengthBars.store(bars); }
        double currentLoopLengthBars() const { return loopLengthBars.load(); }

        /** Message-thread API: how far, in bars, the playhead is from the
         * next loop top -- the number the scheduled-swap deadline is built
         * out of (see IpcServer's stage-project handler). Picks the same
         * wrap window renderLoopAware itself uses (a recording loop, when
         * active, takes over from the project's own loopLengthBars), so a
         * deadline can never be computed against a loop the audio thread
         * isn't actually wrapping at. Returns -1.0 when nothing wraps at
         * all, which the caller must read as "waiting for a loop top would
         * wait forever."
         *
         * A snapshot of a moving value, deliberately: it decides how long
         * to WAIT, nothing sample-accurate. */
        double barsUntilNextWrap() const;

        /** Message-thread API: how far, in bars, the playhead is from
         * `targetBar` WITHIN THE LAP IT IS CURRENTLY IN -- the same
         * question barsUntilNextWrap answers, for a boundary that is not
         * the wrap.
         *
         * Returns -1.0, with the same "waiting for this would wait
         * forever" meaning, whenever the bar is not genuinely ahead of
         * the playhead inside the current lap: nothing wraps at all, the
         * bar sits outside the wrap window, the playhead is outside it,
         * or the bar is already behind. That last case is the one worth
         * naming -- a target the renderer aimed at and the transport has
         * already passed must NOT be read as "the same bar, one lap
         * later," which would land a whole loop early. The caller treats
         * -1.0 from a bar that was genuinely requested as "too late to
         * schedule, do it now," which is exactly what load-project
         * already does.
         *
         * A target AT loopStart is the wrap, not a bar within the lap, so
         * it is excluded here and left to barsUntilNextWrap. */
        double barsUntilBar(double targetBar) const;

        /** Message-thread API: the loop length belonging to a project
         * currently staged in PlaybackEngine, to be adopted at the same
         * instant the staged snapshot is -- not before, or the very wrap
         * the swap is waiting for would move. Negative parks it (nothing
         * pending), which is also what the audio thread leaves behind once
         * it has consumed one.
         *
         * This is the ONLY part of the load-project handler's work that
         * happens on the audio thread instead of alongside the swap on the
         * message thread, and only because it is a single atomic store of
         * a double. Tempo, the Link push, the live-override clear and the
         * channel-chain set are all message-thread work and stay there --
         * see IpcServer's own stage-project handler for what that costs. */
        void setStagedLoopLengthBars(double bars) { stagedLoopLengthBars.store(bars); }

        /** WHICH boundary the staged swap is waiting for. Negative (the
         * default, and what the audio thread leaves behind once it has
         * consumed one) means the loop top, which is the only answer
         * b876204 had.
         *
         * A bar strictly inside the wrap window instead makes the swap
         * land there. It exists for the one population the loop-top-only
         * swap could not reach: radio's bare `cut`s, where a layer of
         * DEFAULT_RADIO_LOOP_END_BARS or fewer turns over on its own 2- or
         * 4-bar boundary (radioGridBars). About one change in twenty, and
         * the only ones still falling back to load-project's 20-65ms of
         * lateness.
         *
         * SAMPLE-ACCURATE, NOT BLOCK-ACCURATE, and that is the whole
         * design question. The loop-top swap is exact because
         * renderLoopAware ALREADY splits its block at the wrap, so there
         * is a point in the call where no renderBlock is in flight -- the
         * precondition PlaybackEngine::applyStagedProject is built on. An
         * arbitrary bar has no such split, and at kPreferredBufferSize
         * (1024, ~23ms) a block-granular swap would be a visible fraction
         * of a 16th note. So renderLoopAware splits at the target bar too,
         * in exactly the same shape as the wrap split, and the reclamation
         * argument carries over unchanged: same gap, same four
         * reference-count adjustments, same retirement slot, no
         * allocation and no free on this thread.
         *
         * Message-thread-only call, consumed by the audio thread, same
         * handoff as every other atomic in this class. The caller must
         * have checked with barsUntilBar() that the bar really is ahead
         * of the playhead in this lap; see that function for what happens
         * when it is not. */
        void setStagedApplyAtBars(double bars) { stagedApplyAtBars.store(bars); }

        /** The transport position at which the audio thread last promoted a
         * staged project, or -1.0 if it never has. For the renderer's own
         * ack and the engine log: it is how "the swap landed at 0.000 bar"
         * gets measured on the one clock that matters. */
        double lastStagedApplyPositionBars() const { return stagedApplyPositionBars.load(); }

        /** Whether that last promotion happened at a requested bar rather
         * than at a loop top. Purely so the ack and the `[radio-stage]`
         * line can say which -- `via wrap at 0.000bar` and `via bar at
         * 4.000bar` are different events and a log that called both
         * "wrap" would be lying about the second. */
        bool lastStagedApplyWasAtRequestedBar() const { return stagedApplyAtRequestedBar.load(); }

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

        // Same attach/detach contract as setLoopRecorder above, for the
        // Endlesss-style threshold-gated recording feature (see
        // GatedLoopRecorder's own doc comment) -- independent of
        // loopRecorder above; both can coexist attached at once (each just
        // writes into its own buffer), though the renderer's own UI is not
        // expected to ever arm both at the same time. Reuses the SAME
        // recordingLoopStartBar/EndBar fields above as "the currently
        // selected loop region" -- conceptually one active recording-loop
        // region regardless of which recording mechanism is using it.
        void setGatedRecorder(GatedLoopRecorder* recorder) { gatedRecorder.store(recorder); }

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
        //
        // No longer const: this is where a scheduled project swap actually
        // happens (see applyStagedProjectAtWrap just below), because this
        // is the function that knows the exact sample the lap turns over
        // at.
        //
        // `spb` is the callback's one read of secPerBar: the tempo the whole block -- the wrap
        // window, the seam fade and the sample clock -- runs at. A setBpm landing mid-block
        // takes effect at the next block's re-anchor, never inside this one.
        double renderLoopAware(double pos, int numSamples, float* outL, float* outR, double spb);

        /** AUDIO THREAD. Promotes a project the message thread staged
         * earlier, at the instant the lap turns over -- or, when the
         * message thread asked for one (setStagedApplyAtBars), at the
         * instant the playhead crosses that bar. Called from
         * renderLoopAware at the points where a lap genuinely ends: the
         * split between an outgoing block's tail and the incoming lap's
         * head, and the snap back to loopStart from beyond a loop's end --
         * plus, since the arbitrary-bar swap landed, the split
         * renderLoopAware makes at the requested bar, which exists for
         * exactly this call and no other reason.
         *
         * All of them are points at which no renderBlock() call is in flight --
         * the split's first render has returned and its second has not
         * begun -- which is the whole precondition
         * PlaybackEngine::applyStagedProject() is built on. Read its doc
         * comment before moving this call anywhere else; "somewhere around
         * the wrap" is not the requirement, "no outstanding audio-thread
         * reference to the outgoing snapshot" is.
         *
         * `atBars` is the loop-relative position the new project's first
         * sample will be rendered from -- reported back to the renderer as
         * the position the swap landed at. `atRequestedBar` is only for
         * that report; see lastStagedApplyWasAtRequestedBar. */
        void applyStagedProjectAtWrap(double atBars, bool atRequestedBar = false);

        /** AUDIO THREAD. Restarts the sample clock (anchorBars): block sample
         * `-samplesIntoBlock` of the current block is at `atBars`. */
        void reanchor(double atBars, int64_t samplesIntoBlock, double spb);
        /** AUDIO THREAD. Moves the sample clock past this block and returns the position
         * of the next block's first sample, which renderLoopAware returns. */
        double advanceClock(int numSamples);
        unsigned long long publishTransportCommand(TransportCommandKind kind);


        PlaybackEngine& engine;
        PluginChain& masterChain;
        ChannelChainRegistry& channelChains;
        juce::AudioDeviceManager deviceManager;
        std::atomic<bool> playing { false };
        std::atomic<double> positionBars { 0.0 };
        std::atomic<double> loopLengthBars { 0.0 }; // 0 = wrapping disabled
        std::atomic<double> stagedLoopLengthBars { -1.0 }; // < 0 = none pending, see setStagedLoopLengthBars
        std::atomic<double> stagedApplyPositionBars { -1.0 }; // -1 = no staged swap has ever landed
        // < 0 = the swap waits for the loop top, which is the only answer
        // b876204 had. See setStagedApplyAtBars.
        std::atomic<double> stagedApplyAtBars { -1.0 };
        std::atomic<bool> stagedApplyAtRequestedBar { false };
        std::atomic<double> recordingLoopStartBar { 0.0 };
        std::atomic<double> recordingLoopEndBar { 0.0 }; // <= start = disabled
        std::atomic<LoopRecorder*> loopRecorder { nullptr }; // nullptr = nothing armed
        std::atomic<GatedLoopRecorder*> gatedRecorder { nullptr }; // nullptr = gated recording mode off
        // One atomically-published, totally ordered desired transport
        // command. Low two bits are TransportCommandKind; the upper bits are
        // its monotonically increasing generation. A single word prevents
        // Play/Stop/Pause from observing and repairing one another out of
        // order across the message and audio threads.
        std::atomic<unsigned long long> nextTransportCommandGeneration { 0 };
        std::atomic<unsigned long long> desiredTransportCommand { 0 };
        std::atomic<unsigned long long> completedHaltCommandGeneration { 0 };
        std::atomic<double> requestedPlayPosition { 0.0 };
        std::atomic<bool> repositionRequested { false }; // set by setPosition(), consumed by the audio thread
        std::atomic<double> repositionTarget { 0.0 }; // always the latest requested position
        // All audio-thread-only (never touched off that thread) — no atomics needed.
        bool fadingOut = false;
        HaltKind activeHaltKind = HaltKind::None;
        unsigned long long activeHaltCommandGeneration = 0;
        unsigned long long appliedTransportCommand = 0;
        double haltFadeElapsedSec = 0.0;
        bool repositioning = false;
        // Audio-thread-only. True only in the should-never-happen case
        // where applyStagedProjectAtWrap found the retirement slot still
        // occupied (see PlaybackEngine::applyStagedProject) and gave up on
        // that lap top rather than free anything here. renderLoopAware
        // retries at the top of the next block, so the swap is late by a
        // block rather than by a whole lap -- a late change beats a
        // dropped one, the same rule the deadline on the message thread
        // encodes.
        bool stagedApplyRetryDue = false;
        bool repositionFadingIn = false;
        double repositionElapsedSec = 0.0;
        HaltFinalizationHookForTest haltFinalizationHookForTest = nullptr;
        void* haltFinalizationHookContextForTest = nullptr;

        // The playback clock, audio-thread-only: the position is anchorBars plus an INTEGER
        // count of samples since the anchor, converted the way RenderExport converts its own
        // sample count ((n / rate) / secPerBar), never a running sum of block lengths in bars.
        // A sum drifts in the last bits, and at a tile seam or clip edge that falls on a block's
        // first sample live could then read the neighbouring sample where the export does not.
        // From an anchor at bar 0 (a play from the top, a loop top at bar 0) every block starts
        // at exactly the position the export computes for the same sample.
        //
        // Re-anchored (anchorSamples = 0) wherever the position is set rather than advanced: a
        // play() or seek landing (positionBars no longer holds what renderLoopAware last
        // returned), a loop wrap or snap (anchored at loopStart, on the sample the lap turns
        // over), and a tempo or device-rate change (the conversion itself changes).
        //
        // The conversion uses the ANCHOR's tempo and rate, never the live ones: setBpm writes
        // secPerBar from the message thread at any moment, and converting every sample since the
        // anchor at a tempo that arrived mid-block would jump the playhead (bar 64, 120 -> 125
        // bpm: ~2.7 bars) -- permanently, since the next block re-anchors where it landed.
        double anchorBars = 0.0;
        int64_t anchorSamples = 0;
        double anchorSecPerBar = 0.0;
        double anchorSampleRate = 0.0;
        double lastReturnedPositionBars = -1.0; // what renderLoopAware last returned
        bool anchorValid = false;

        // The lap clock (CycleTable.h's LapClock): the bars of the laps completed since the last
        // play, seek or snap, and which of those it was. Audio thread only; passed to every
        // renderBlock in renderLoopAware, where only a folded stem reads it.
        double lapBaseBars = 0.0;
        uint32_t lapEpoch = 0;
        LapClock lapClock() const { return { lapBaseBars, lapEpoch }; }
        double barsAtSample(int64_t samplesIntoBlock) const
        {
            return anchorBars + ((double) (anchorSamples + samplesIntoBlock) / anchorSampleRate) / anchorSecPerBar;
        }
        // How long the fade-in holds at silence first: the master stage's latency when it is
        // in (so the jump lands under silence), else 0. Set when the fade-out completes.
        double repositionHoldSec = 0.0;
        double bpm = 120.0;
        // Written by setBpm (message thread), read once per callback by the audio thread
        // (audioDeviceIOCallbackWithContext), which passes that value down. Atomic, relaxed:
        // a single value, nothing else ordered by it. Safe default avoids div-by-zero.
        std::atomic<double> secPerBar { 2.0 };
        double deviceSampleRate = 44100.0;
        int deviceBlockSize = 512;
        std::atomic<int> callbackBlockSize { 0 };

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

        // Mirror of lastConfiguredRecordingInputDevice above, for
        // setOutputDevice() -- same "not just whatever the live setup
        // reports" safety reasoning.
        juce::String lastConfiguredOutputDevice;

        // Device-list snapshots from the last availableInputDeviceNames()/
        // availableOutputDeviceNames() call -- see those functions' own doc
        // comments for why this replaced a juce::AudioIODeviceType::Listener
        // registration (issue #187's original approach, which caused a real
        // regression: recording captured silence, root-caused 2026-08-13 to
        // registering that listener at all, most likely because
        // scanForDevices() below -- called on every list-devices IPC
        // request -- fires listener callbacks even without a genuine
        // hotplug). Empty until the first scan.
        juce::StringArray lastKnownInputDeviceNames;
        juce::StringArray lastKnownOutputDeviceNames;
    };
}

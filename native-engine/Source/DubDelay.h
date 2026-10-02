// native-engine/Source/DubDelay.h
#pragma once
#include "AutomationCurve.h"
#include "MasterTone.h"
#include "SoundSettings.h"
#include <array>
#include <atomic>
#include <optional>
#include <vector>

namespace sssketch
{
    // The web's numbers (DUB_* in src/shared/radioSound.ts; DubDelayBusTests pins them).
    constexpr float kDubHighpassHz = 200.0f;
    constexpr float kDubLowpassHz = 3500.0f;
    /** The echo's feed into the reverb, so its repeats sit in the room. */
    constexpr float kDubToReverb = 0.15f;
    constexpr double kDubMaxDelaySec = 2.0;
    /** The web's clamp (dubDelay.ts set()); see kDubStableFeedback for the one native adds. */
    constexpr double kDubMaxFeedback = 0.95;

    /** WEB QUIRK, MATCHED ON PURPOSE. dubDelay.ts gives both loop filters `Q: Math.SQRT1_2`, but
     * a Web Audio lowpass/highpass takes its Q in DECIBELS: 0.7071 dB is a linear Q of 1.085, not
     * Butterworth's 0.7071. Each filter peaks +1.74 dB near its corner (the lowpass x1.222 at
     * 2.65 kHz), so the repeats do not simply darken: they narrow onto ~2.65 kHz. Matched because
     * it is what Elling heard; a candidate fix on the web is `Q: biquadQ(0)` (-3.01 dB). */
    constexpr float kDubFilterQDb = 0.70710678118654752f;

    /** The loop's largest gain per pass at feedback 1: the highpass x lowpass response at its peak
     * (1.2265 at 48 kHz, measured from Chrome's own nodes and from WebBiquad; DubDelayBusTests
     * checks it at every rate from 22.05 to 192 kHz), rounded up. */
    constexpr double kDubLoopPeakGain = 1.23;

    /** NATIVE-ONLY GUARD. Because of the Q quirk, the web's own clamp (0.95) does not stop a
     * runaway: at feedback 0.95 the loop gains 0.95 x 1.2265 = 1.165 a pass around 2.65 kHz,
     * and Chrome's render of dubDelay.ts at 0.95 grows by ~70 dB in 25 s (measured, 2026-10-02).
     * Anything above ~0.815 runs away. So the native bus also caps the feedback here, where the
     * loop's peak gain is 0.77 x 1.23 = 0.947: the 0.95 the web meant as its ceiling. The
     * throws draw 0.45..0.6 (THROW_FEEDBACK), untouched by this. */
    constexpr double kDubStableFeedback = 0.77;

    /** Web Audio's render quantum. In Chrome a cycle (this ping-pong) is broken at one node,
     * which then reads its input's PREVIOUS quantum: here the left delay's output as it enters
     * the left -> right feedback path. So each round trip L -> R -> L is 2d + 128 samples, not
     * 2d (measured: an impulse into L echoes on L at d, on R at 2d + 128, on L at 3d + 128, on
     * R at 4d + 256...). Matched: DubDelayCore holds the left output 128 samples before its
     * feedback filters. Per sample, not per block, so block-size invariant. */
    constexpr int kDubWebQuantum = 128;

    /** How quiet the loop gets (re: full scale) before the bus calls itself silent and zeroes its
     * state: -140 dB. */
    constexpr double kDubSilence = 1.0e-7;

    /** The echo time for a beat fraction at a tempo, as the web computes it (throwDelaySec:
     * delayBeats x (60 / bpm)), then clamped as dubDelay.ts set() clamps it, to
     * [1 / sampleRate, 2 s]. A non-finite or non-positive bpm or delayBeats gives 0.5 s. */
    double dubDelaySecFor(double delayBeats, double bpm, double sampleRate);
    /** A delay time clamped as dubDelay.ts set() clamps it (non-finite: 0.5 s). */
    double dubClampDelaySec(double delaySec, double sampleRate);

    /** The feedback gain the loop runs: the web's clamp to [0, 0.95], then the native guard
     * (kDubStableFeedback), as the float the web's GainNode holds. Non-finite is 0. */
    float dubFeedbackFor(double feedback);

    /** The web's dub echo (ell.ing/radio src/audio/dubDelay.ts), sample for sample:
     *
     *   in L -> delay L -> out L          delay L -> [128] -> HP 200 -> LP 3500 -> x fb -> delay R
     *   in R -> delay R -> out R          delay R ->          HP 200 -> LP 3500 -> x fb -> delay L
     *
     * A stereo ping-pong: the input is NOT summed to mono (dubDelay.ts splits its 2-channel
     * input), the first repeat of each side is on that side at d, undarkened, at full level (the
     * output is the delays' own outputs, merged); every later repeat crosses over, through the
     * filters once more and x feedback, so an impulse into L gives L at d, R at 2d + 128 (one
     * pass darker, x fb), L at 3d + 128 (two passes, x fb^2)... The filters are Web Audio's
     * biquads as Chromium runs them (WebBiquad), at the web's decibel Q (kDubFilterQDb). The
     * delays are Chromium's DelayNode as Chrome 154 runs it (fitted to its output, the golden):
     * Chromium's buffer for a 2 s maximum (1 + 2 s + 128 frames), the read position worked out
     * IN FLOAT from the write index (so the interpolation's fraction is rounded to the float
     * spacing there and drifts with the index), then out = s1 + f (s2 - s1) in float, the
     * delay in frames being the float delay time x the rate, rounded to float.
     *
     * The write index starts at 0 when built or cleared; on the web it is wherever the node's
     * clock is, so the fraction's rounding (under a hundredth of a sample at 44.1-48 kHz, a
     * thirtieth at 192 kHz) falls differently from one throw to the next there too -- matched in
     * kind, not in phase.
     * DubDelayBus starts a silent core at its first non-zero input sample, so the phase does
     * not depend on the host's blocks.
     *
     * Allocates in the constructor only: build it on the message thread. */
    class DubDelayCore
    {
    public:
        explicit DubDelayCore(double sampleRate);

        double sampleRate() const { return rate; }

        /** The echo time and feedback, as dubDelay.ts set() takes them (clamped the same way,
         * plus kDubStableFeedback). From the next sample processed on, as an AudioParam's
         * setValueAtTime at that sample: a ringing line is re-read from the new position, as the
         * web's is. */
        void set(double delaySec, double feedback);

        /** The values set() left, as the web's AudioParams hold them. */
        float delaySec() const { return delayParam; }
        float feedback() const { return fbGain; }

        /** Silence: the lines, the 128-sample hold and the filters zeroed. */
        void clear();

        /** One sample in, one out. Defined in DubDelay.cpp (-ffp-contract=off), so every caller
         * gets the same float arithmetic. */
        void processSample(float inL, float inR, float& outL, float& outR);

        /** numSamples of input to output (writes, does not add). */
        void process(int numSamples, const float* inL, const float* inR, float* outL, float* outR);

        /** How long, after the last non-zero input sample, until everything in the loop is below
         * kDubSilence (taking each pass at its peak gain, kDubLoopPeakGain): the repeats
         * (passes x the delay, plus the 128-sample hold every other pass) and 50 ms for the
         * filters to ring out. In samples, at the current settings. */
        int ringSamples() const { return ring; }

    private:
        int computeRingSamples() const;

        double rate;
        std::vector<float> lineL, lineR;
        int lineLength = 0;
        int writeIndex = 0;
        std::array<float, kDubWebQuantum> heldL {};
        int heldIndex = 0;
        WebBiquad hpL, lpL, hpR, lpR;

        float delayParam = 0.0f; // the AudioParam's value, seconds
        float fbGain = 0.0f;
        float delayFrames = 2.0f; // the delay in frames, as a float
        int ring = 0;            // ringSamples() at the current settings
    };

    /** The dub echo bus (native radio sound plan, Task 10): ONE echo for the whole mix, shaped
     * like ReverbBus -- fed by per-stem, post-pan `dubSend` curves (EngineStemAutomation), its
     * wet signal added into the master sum, and kDubToReverb (0.15) of it fed into the reverb bus
     * in the same block (PlaybackEngine::renderBlock runs it before reverbBus.endBlock).
     *
     * SETTINGS (sound.dub: delayBeats, feedback; the time is delayBeats x 60 / bpm). The web sets
     * them per throw, at the throw's start, while the last throw's tail may still be ringing
     * below -60 dB (dubDelay.ts: "nothing is retimed under a ringing tail" because throws keep
     * apart). So: a change is taken when the bus is silent (at once, at that sample), or else
     * at the next throw's start -- the first sample at which any stem's dubSend curve rises from
     * 0 (markOpen) -- and never in the middle of a ringing tail with no throw. Per sample, so
     * block-size invariant.
     *
     * SEND SLEW. Within one project snapshot, played on without a jump, a stem's send gain is
     * its curve, sample for sample. A curve can step at a break, though -- throws switched off or
     * their level moved while one is open, a staged project landing, a seek or a loop's wrap into
     * an open throw -- and a send stepping 1 -> 0 in one sample clicks into the echo. So after a
     * break, a stem whose gain would step by more than a 5 ms ramp's worth slews to its curve
     * at that rate instead (linear, full scale in kSendSlewSec), then follows the curve exactly.
     * A stem whose curve has gone stays a tap with an empty curve (PlaybackEngine keeps it one
     * snapshot on) and ramps out to 0. Never engaged by a continuous curve, so a play with no
     * break -- every export -- is exactly the curve.
     *
     * SILENCE. The bus rings for DubDelayCore::ringSamples() after the last non-zero input
     * sample, then zeroes its state (everything in it is below -140 dB by then) and is idle:
     * an idle block with no input is skipped, which is exactly what processing it would give.
     *
     * THREADING (MasterStage's / the cavern's pattern). prepare() builds a core at a rate on the
     * message thread and parks it in `pending`; process() promotes it (the new one starts
     * silent), parking the one it displaces in `retired`, which drainRetired() frees. A block at
     * a rate with no core gives no echo (counted in rateMismatchCount) and asks for one
     * (takeWantedRate). PlaybackEngine prepares one only once a project with sound.dub has a
     * stem with a non-zero dubSend curve: with no send, nothing is built.
     *
     * Usage per render block: beginBlock(...), markOpen(...) per stem with a send, addSendCurve(...)
     * per sending stem with audio, process(...),
     * then read wetLeft()/wetRight(). Single rendering thread, except the MESSAGE THREAD
     * methods. */
    class DubDelayBus
    {
    public:
        DubDelayBus() = default;
        ~DubDelayBus();
        DubDelayBus(const DubDelayBus&) = delete;
        DubDelayBus& operator=(const DubDelayBus&) = delete;

        /** MESSAGE THREAD. Builds a core at this rate (~2 s of line a side) and parks it for the
         * audio thread, unless the last one built is at this rate. Allocates. */
        void prepare(double sampleRate);
        /** MESSAGE THREAD. The rate of the last core prepare() built, 0 if none. */
        double preparedRate() const { return builtRate; }
        /** MESSAGE THREAD. Frees a core the audio thread swapped out. */
        void drainRetired();
        /** MESSAGE THREAD. A rate a block found no core for, then cleared; 0 if none. */
        double takeWantedRate() { return wantedRate.exchange(0.0); }

        /** For tests: the rate of the core the audio thread runs (0 if none), and whether a
         * swapped-out one waits for drainRetired. */
        double liveRate() const;
        bool hasRetired() const { return retired.load() != nullptr; }
        unsigned long long rateMismatchCount() const { return rateMismatches.load(std::memory_order_relaxed); }

        /** AUDIO THREAD. Clears the input for a block of numSamples (sizing the scratch the first
         * time a block is this long, as the reverb bus does), and notes whether this block follows
         * the last one without a break: the same project snapshot (`generation`) and the next
         * sample (k0 = round(positionBars x secPerBar x sampleRate)). A swap (setProject, a staged
         * project landing) or a jump (a seek, a loop's wrap) is a break: see SEND SLEW. The first
         * block after construction or dropTail() is never a break. */
        void beginBlock(int numSamples, double positionBars, double secPerBar, double sampleRate,
                        unsigned long long generation);

        /** AUDIO THREAD. Called once per block for EVERY stem with a send in this snapshot (`id`
         * its stemKey's hash), sounding or not (muted, out of its clip, nothing in the block):
         * works out the stem's send gain for the block -- its curve, or, after a break, a slew
         * from where the gain was (SEND SLEW) -- and marks where it is above 0: a throw is open
         * there, so a throw's start (where a change of settings is taken while the echo rings)
         * comes from the gains alone, never from where the host's blocks hold the stem's audio.
         * An empty curve is 0 throughout (a stem whose curve has gone, ramping out). Returns the
         * slot addSendCurve takes, -1 if every slot is in use (then no slew: the curve as is). */
        int markOpen(unsigned long long id, int numSamples, const std::vector<AutomationPoint>& curve,
                     double originBar, double positionBars, double secPerBar, double sampleRate);

        /** AUDIO THREAD. Adds one stem's post-pan signal, scaled per sample by the gain markOpen
         * worked out for its `slot` this block: its dubSend curve (clip-relative bars from
         * `originBar`, values 0..1, linear gain as the web's send GainNode), slewed after a break.
         * Each sample's bar comes from a whole sample count, k0 + i, so the gains do not depend on
         * how the host splits its blocks. A gain of 0 over the whole block adds nothing. */
        void addSendCurve(int slot, int numSamples, const float* left, const float* right,
                          const std::vector<AutomationPoint>& curve, double originBar, double positionBars,
                          double secPerBar, double sampleRate);

        /** AUDIO THREAD. A block the bus does not run: every stem's send is forgotten (none is
         * sending), so one that sends again later starts from 0 at that break. */
        void idleSends()
        {
            if (! holdsGain && ! anySlotUsed())
                return;
            for (auto& slot : sendSlots)
                slot = SendSlot {};
            holdsGain = false;
            gainsSettled.store(true, std::memory_order_relaxed);
        }

        /** AUDIO THREAD. Whether some stem's send gain is not yet settled at 0 (a ramp out after
         * its curve went is still to run). PlaybackEngine keeps the bus running for it. */
        bool holdsSendGain() const { return holdsGain; }

        /** Any thread: false while some stem's send gain is held above 0 or slewing, as of the last
         * block the bus ran (true before any). buildSnapshot keeps a stem whose curve has gone as
         * a ramp-out tap only while this is false. */
        bool sendGainsSettled() const { return gainsSettled.load(std::memory_order_relaxed); }

        /** AUDIO THREAD. Runs the echo over the block's input into the wet buffers. `wanted` is
         * the project's sound.dub (none: keep what is set), at `bpm`. */
        void process(double sampleRate, const std::optional<SoundSettings::Dub>& wanted, double bpm, int numSamples);

        /** The last process()'s output (numSamples each). */
        const float* wetLeft() const { return wetL.data(); }
        const float* wetRight() const { return wetR.data(); }

        /** Being fed or still ringing. */
        bool isRinging() const { return ringRemaining > 0; }

        /** AUDIO THREAD (or with no process in flight). Forgets the tail: the next process()
         * starts from silence. O(1). Transport calls it (PlaybackEngine::dropReverbTail) where a
         * stop or pause has faded out and at a device start, as the cavern's tail. */
        void dropTail()
        {
            dropRequested = true;
            ringRemaining = 0;
            forgetSends();
        }

        /** For tests: the settings the running core has taken (0 if none). */
        float currentDelaySec() const;
        float currentFeedback() const;

        /** SEND SLEW: how fast a stem's send gain may move after a break -- full scale in 5 ms,
         * the web's own throw ramps (Engine.throwDelay), so a curve's ramp never engages it. */
        static constexpr double kSendSlewSec = 0.005;
        static constexpr int kMaxSendSlots = 64;

    private:
        void promotePending();
        void forgetSends();
        bool anySlotUsed() const
        {
            for (const auto& slot : sendSlots)
                if (slot.used) return true;
            return false;
        }

        /** One stem's send gain across blocks (SEND SLEW). */
        struct SendSlot
        {
            unsigned long long id = 0;
            bool used = false;
            bool seen = false;       // by markOpen this block
            float gain = 0.0f;       // the last sample's gain
            bool slewing = false;
            float startGain = 0.0f;  // as this block began, for addSendCurve's replay
            bool startSlewing = false;
        };

        std::vector<float> inL, inR, wetL, wetR;
        std::vector<unsigned char> open; // any send's gain > 0 at that sample
        bool fed = false;                // any open sample this block
        bool wasOpen = false;
        int ringRemaining = 0;
        bool dropRequested = false;

        std::array<SendSlot, kMaxSendSlots> sendSlots {};
        bool fresh = true;           // no block since construction or dropTail()
        bool blockBreaks = false;    // this block follows a swap or a jump
        long long nextK0 = 0;
        unsigned long long lastGeneration = 0;
        float slewStep = 0.0f;       // per sample
        bool holdsGain = false;
        std::atomic<bool> gainsSettled { true };

        double builtRate = 0.0; // message thread only
        std::atomic<DubDelayCore*> current { nullptr };
        std::atomic<DubDelayCore*> pending { nullptr };
        std::atomic<DubDelayCore*> retired { nullptr };
        std::atomic<double> wantedRate { 0.0 };
        std::atomic<unsigned long long> rateMismatches { 0 };
    };
}

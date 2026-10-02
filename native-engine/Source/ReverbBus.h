// native-engine/Source/ReverbBus.h
#pragma once
#include "AutomationCurve.h"
#include "SoundSettings.h"
#include <atomic>
#include <memory>
#include <vector>

namespace sssketch
{
    /** The project-level (NOT per-channel) reverb controls, normalised the
     * same way everything else in the toolkit is -- see
     * docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md.
     * Mirrored field-for-field by ProjectReverbSettings in src/shared/
     * toolkit.ts; that pair is hand-synced, like EngineProject and
     * buildEngineProject.ts (CLAUDE.md). */
    struct ReverbSettings
    {
        /** Room size / decay length. 0 = a small tight room, 1 = a long hall. */
        double roomSize = 0.5;
        /** High-frequency absorption. 0 = bright and glassy, 1 = dark. */
        double damping = 0.5;
        /** Gap before the reverb starts, in milliseconds. Not normalised:
         * pre-delay is one of the few reverb controls people genuinely think
         * about in real units, and a UI showing "40 ms" beats one showing
         * "0.4". Clamped into what zita's own input delay line can hold. */
        double preDelayMs = 20.0;
    };

    /** How the normalised settings land on zita-rev1's own setters -- exposed
     * (rather than buried in the .cpp) so they can be unit-tested directly
     * without instantiating a reverb, and so a future UI can show the real
     * value under the control. */
    double reverbDecaySecondsFor(double roomSize01);
    double reverbDampingHzFor(double damping01);
    /** zita's own input delay line is 100ms and its prepare() subtracts a
     * fixed 20ms, so the usable pre-delay window is [20ms, ~115ms] of
     * `_ipdel`; this returns the clamped SECONDS value to hand set_delay(). */
    double reverbPreDelaySecondsFor(double preDelayMs);

    class CavernConvolver;

    /** ONE shared reverb for the whole mix, fed by per-channel sends -- cheaper
     * and more cohesive than an instance per channel, per the design doc.
     *
     * TWO ROOMS (native radio sound plan, Task 5). `zita` is zita-rev1, the
     * room this bus has always run, exactly as before (bit for bit at today's
     * return). `cavern` is the web radio's convolver room (CavernReverb.h).
     * setRoom() picks one per block; the sends feed the current room only, and
     * the other one, if still ringing, rings out on silence -- so switching
     * rooms mid-play hands over instead of cutting. A return gain (the sound
     * settings' reverb amount, 1 = today's level) scales the wet output of
     * either room; at 1 the samples are added untouched.
     *
     * The cavern is built OFF the audio thread (its impulse and state are
     * ~8 MB): prepareCavern() on the message thread builds a convolver at a
     * rate and parks it; endBlock() promotes it on the audio thread, parking
     * the one it displaces for drainRetiredCavern() to free -- MasterStage's
     * pattern. PlaybackEngine prepares one whenever a project in the cavern
     * room has a send, so with no send nothing is built. A cavern block at a
     * rate no convolver has been built for adds no wet signal (silent for that
     * block, counted in cavernRateMismatchCount) and asks the message thread to
     * build one (takeWantedCavernRate).
     *
     * Lifetimes: the per-rate impulse cache (cavernIrFor) lives as long as the
     * process, and the live convolver as long as this bus, even once nothing
     * sends to the cavern any more. Both are bounded by the number of sample
     * rates used (~8 MB a rate), so neither is freed early.
     *
     * The return gain is applied as a plain multiply, not smoothed: a change of
     * the reverb amount steps the wet level at the block where the new project
     * lands, as zita's sends-only control always has.
     *
     * Usage per render block: beginBlock(n), then addSend(...) once per
     * channel that has a non-zero send, then endBlock(n, outL, outR) to run
     * the reverb and add its (fully wet) output into the mix. The dry signal
     * never passes through here -- it stays on the channel path, which is
     * what makes a send a send.
     *
     * Costs nothing when nothing is sent: with no send in a block and no tail
     * still ringing, endBlock() returns immediately, and the underlying
     * reverb is not even CONSTRUCTED until the first block that actually
     * feeds it (its delay lines are a ~100ms-per-channel allocation). A
     * project that never touches reverb therefore pays zero -- no allocation,
     * no per-sample work, and bit-identical output to the pre-toolkit path.
     *
     * Not thread-safe, same single-renderer invariant as ChannelFilter --
     * except the methods marked MESSAGE THREAD, which touch only the cavern's
     * hand-over cells and message-thread bookkeeping. */
    class ReverbBus
    {
    public:
        ReverbBus();
        ~ReverbBus();
        ReverbBus(const ReverbBus&) = delete;
        ReverbBus& operator=(const ReverbBus&) = delete;

        /** Records the rate/size the next render will use. Cheap and safe to
         * call every block; a change re-initialises the reverb only if one
         * has actually been built yet. */
        void prepare(double sampleRate, int maxBlockSize);

        void setSettings(const ReverbSettings& settings);

        /** Which room runs, and the return's gain relative to today's level
         * (SoundSettings::reverbReturn). Cheap; the render path calls it every
         * block with the snapshot's values. */
        void setRoom(ReverbRoom room, double returnGain);

        /** Clears the send accumulator for a block of `numSamples`. */
        void beginBlock(int numSamples);

        /** Mixes one channel's signal into the send accumulator, scaled by
         * `gain` advanced ONE SAMPLE AT A TIME -- so a reverbSend automation
         * ramp crossfades into the tail instead of stepping at block
         * boundaries. Passing a smoother whose value and target are both zero
         * adds nothing and, crucially, does not mark the bus as fed. */
        void addSend(int numSamples, const float* left, const float* right, ParamSmoother& gain);

        /** addSend at a constant gain (no smoother): the same per-sample multiply-add as a
         * settled smoother at `gain` gives, to the bit. A gain of 0 or less adds nothing and does
         * not mark the bus fed. */
        void addSendConstant(int numSamples, const float* left, const float* right, float gain);

        /** Runs the reverb over whatever was accumulated and ADDS the wet
         * result into outL/outR. A no-op (leaving the output bit-identical)
         * when nothing was sent this block and no tail remains. */
        void endBlock(int numSamples, float* outL, float* outR);

        /** Drops the tail -- for a transport stop/seek, where letting the
         * previous position's reverb ring on into the new one is an artifact
         * of the seek. */
        void reset();

        /** Forgets the cavern's tail: its next block starts from silence
         * (runCavern clears the convolver's state then). O(1), allocates
         * nothing. AUDIO THREAD, or with no endBlock in flight. Transport calls
         * it (through PlaybackEngine::dropReverbTail) when a stop or pause has
         * faded out and when the device (re)starts, so the next play starts as
         * an export does instead of under the old decay.
         *
         * Zita's tail is NOT dropped there: zita has no state-only clear, and
         * its init() (what reset() uses) allocates its delay lines. So after a
         * stop zita rings on from where it froze, as it always has. */
        void dropCavernTail() { cavernTailRemaining = 0; }

        /** True while either room is being fed or still ringing out.
         * Exposed for tests and for a future "is the toolkit doing anything"
         * indicator; the render path uses it internally. */
        bool isRinging() const { return tailSamplesRemaining > 0 || cavernTailRemaining > 0; }

        /** Whether zita has actually been constructed yet -- i.e. whether
         * this project has ever sent to it. Tests assert on this to pin the
         * "neutral allocates nothing" promise (the cavern's equivalent is
         * cavernPreparedRate). */
        bool hasBeenBuilt() const { return impl != nullptr; }

        /** MESSAGE THREAD. Builds a cavern convolver at this rate (its impulse
         * comes from cavernIrFor's per-rate cache) and parks it for the audio
         * thread, unless the last one built is already at this rate.
         * Allocates. */
        void prepareCavern(double sampleRate);

        /** MESSAGE THREAD. The rate of the last cavern prepareCavern built, or
         * 0 if none has been: "with no send, nothing is built". */
        double cavernPreparedRate() const { return cavernBuiltRate; }

        /** MESSAGE THREAD. Frees a convolver the audio thread swapped out. One
         * atomic load when there is none. */
        void drainRetiredCavern();

        /** MESSAGE THREAD. A rate a cavern block found no convolver for, then
         * cleared; 0 if none. The caller builds one (prepareCavern). */
        double takeWantedCavernRate() { return cavernWantedRate.exchange(0.0); }

        /** For tests: whether a swapped-out convolver is waiting for
         * drainRetiredCavern, and the rate of the one the audio thread is
         * running (0 if none). */
        bool hasRetiredCavern() const { return cavernRetired.load() != nullptr; }
        double liveCavernRate() const;

        /** Cavern blocks that went without wet signal because no convolver at
         * their rate was ready. */
        unsigned long long cavernRateMismatchCount() const
        {
            return cavernRateMismatches.load(std::memory_order_relaxed);
        }

    private:
        struct Impl; // hides the vendored zita-rev1 header (and its
                     // global-namespace `Reverb`/`Pareq`/`Delay` class names)
                     // from everything that includes this header -- see
                     // Source/dsp/zita-rev1/VENDORED.md.
        std::unique_ptr<Impl> impl;

        void ensureBuilt();

        double sampleRate = 0.0;
        int maxBlockSize = 0;
        ReverbSettings settings;
        bool settingsDirty = true;

        std::vector<float> sendL, sendR;
        std::vector<float> wetL, wetR;
        // zita's process() reads out[2]/out[3] unconditionally (they're only
        // USED in ambisonic mode, but the pointers are loaded either way), so
        // it is handed four real buffers rather than two -- reading past the
        // end of a two-element array would be undefined behaviour even though
        // the values would go unused.
        std::vector<float> spareC, spareD;

        bool fedThisBlock = false;
        int tailSamplesRemaining = 0; // zita's

        ReverbRoom room = ReverbRoom::zita;
        float returnGain = 1.0f;
        std::vector<float> silence; // a ringing room that is not the current one is fed this

        /** The audio thread's convolver; pending/retired are the hand-over cells. */
        std::atomic<CavernConvolver*> cavern { nullptr };
        std::atomic<CavernConvolver*> cavernPending { nullptr };
        std::atomic<CavernConvolver*> cavernRetired { nullptr };
        double cavernBuiltRate = 0.0; // message thread only
        int cavernTailRemaining = 0;
        std::atomic<double> cavernWantedRate { 0.0 };
        std::atomic<unsigned long long> cavernRateMismatches { 0 };

        void runZita(int numSamples, bool fed, const float* inL, const float* inR, float* outL, float* outR);
        void runCavern(int numSamples, bool fed, const float* inL, const float* inR, float* outL, float* outR);
    };
}

// native-engine/Source/DrumPump.h
#pragma once
#include "FaustStage.h"
#include <array>
#include <atomic>
#include <memory>

namespace sssketch
{
    /** The radio sound's drum-keyed pump (native radio sound plan, Task 9): Faust `pump`
     * (dsp/faust/pump.dsp, the web radio's own DSP) run over the pumped rows, keyed by the drums
     * rows. PlaybackEngine::renderBlock does the routing -- each pumped stem's dry signal (after
     * its filter, volume, pan and send, so the send is not pumped) into its channel's pumped
     * buffer, each key stem's dry signal into one project-wide key buffer as well as its
     * channel -- and, after the channel loop and before the channel plugin chains, hands the
     * buffers here.
     *
     * ONE DUCK FOR THE WHOLE PROJECT. pump.dsp's gain is a function of the key alone
     * (`process(pl, pr, kl, kr) = pl * g, pr * g`, g from kl/kr only), and the key is
     * project-wide, so every channel's pump would compute the same g. So one Faust instance runs
     * per block with its program inputs held at exactly 1.0f: its outputs are then g itself
     * (1.0f * g == g), and each channel's pumped buffer is multiplied by it here, in a TU
     * compiled -ffp-contract=off, which is the very float multiply the generated code does
     * (`input * fTemp10`). The result is pump.dsp run over each channel's buffer, to the bit
     * (DrumPumpTests checks it against FaustStage fed the real program), for one instance's
     * cost whatever the channel count, and one envelope to carry across project swaps.
     *
     * STATE. The envelope lives here, not in the project snapshot, so a re-sync (setProject at
     * live-drag rate, Discover's staged swaps, a depth change) carries it on. It is cleared:
     * when the pump engages after a block without it (process() after idle()), so switching it
     * on starts as a fresh pump would; and by clear(), which Transport calls where it clears the
     * master stage (a seek's jump, a stop's end, a device start), so a play from anywhere starts
     * as an export from there does.
     *
     * THREADING. MasterStage's pattern: prepare() builds an Instance (the Faust object and fixed
     * 512-sample scratch) on the message thread and parks it in `pending`; process() promotes
     * it, parking the one it displaces in `retired` (deferring while `retired` is occupied);
     * drainRetired() frees that. The audio thread never allocates, frees or locks. A block at a
     * rate with no instance passes the pumped buffers through unducked and is counted
     * (rateMismatchCount). */
    class DrumPump
    {
    public:
        /** pump.dsp's own defaults, which the web runs: a 3 ms attack (fixed in the .dsp) and
         * this release. */
        static constexpr float kReleaseSec = 0.2f;

        /** One channel's pumped buffer and where its ducked signal goes. */
        struct Target
        {
            const float* inL = nullptr;
            const float* inR = nullptr;
            float* outL = nullptr;
            float* outR = nullptr;
        };

        DrumPump();
        ~DrumPump();
        DrumPump(const DrumPump&) = delete;
        DrumPump& operator=(const DrumPump&) = delete;

        /** MESSAGE THREAD. Builds an instance at this rate and parks it for the audio thread,
         * unless the last one built is already at it. Allocates. */
        void prepare(double sampleRate);
        /** MESSAGE THREAD. The rate of the last instance prepare() built, or 0 if none. */
        double preparedRate() const { return builtRate; }
        /** MESSAGE THREAD. Frees an instance the audio thread swapped out. */
        void drainRetired();

        /** AUDIO THREAD (one rendering thread). One block of the pump: the duck from keyL/keyR
         * (numSamples each) at `depthDb`, applied to every target's input and ADDED into its
         * output. Runs every block the project's pump is on, targets or not, so the envelope
         * follows the key continuously (block-size invariant to the bit). Any numSamples. */
        void process(double sampleRate, double depthDb, int numSamples, const float* keyL, const float* keyR,
                     const Target* targets, size_t numTargets);

        /** AUDIO THREAD. A block without the pump: the next process() starts from a cleared
         * envelope. Nothing else. */
        void idle() { engaged = false; }

        /** AUDIO THREAD with no process() in flight (or the message thread with no callback
         * running). Clears the envelope and filters; the depth stays. */
        void clear();

        /** For tests and meters: the duck's current value, dB (<= 0), 0 with no instance. */
        float currentDuckDb() const;

        unsigned long long rateMismatchCount() const { return rateMismatches.load(std::memory_order_relaxed); }

    private:
        static constexpr int kChunk = 512;

        struct Instance
        {
            explicit Instance(double sampleRate);
            double sampleRate;
            FaustStage pump { FaustDspKind::pump };
            float depthSet = -1.0f;
            std::array<float, kChunk> ones {};
            std::array<float, kChunk> gainL {}, gainR {};
        };

        void promotePending();

        double builtRate = 0.0;
        bool engaged = false;
        std::atomic<Instance*> current { nullptr };
        std::atomic<Instance*> pending { nullptr };
        std::atomic<Instance*> retired { nullptr };
        std::atomic<unsigned long long> rateMismatches { 0 };
    };
}

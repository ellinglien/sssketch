// native-engine/Source/MasterStage.h
#pragma once
#include "FaustStage.h"
#include "SoundSettings.h"
#include <array>
#include <atomic>
#include <memory>
#include <vector>

namespace sssketch
{
    /** The radio sound's master stage (docs/superpowers/plans/2026-10-01-native-radio-sound.md,
     * Task 3): the headroom trim, then the true-peak limiter (truepeak.dsp, ceiling -1 dBTP by
     * default, release 0.1 s, lookahead 64). Glue, tone and saturation (Tasks 7-8) slot in
     * between the two later.
     *
     * Runs AFTER the user's master plugin slots, as the last thing before the device or the WAV:
     * a plugin after a limiter would undo the ceiling. PlaybackEngine owns the one instance and
     * both callers -- Transport (live) and RenderExport (bounce) -- reach it through
     * PlaybackEngine::processMaster, so the two paths run the same code on the same settings.
     *
     * OFF IS TODAY. With no mastering settings (sound absent, or mastering switched off) and no
     * fade-out still running, process() returns without touching a sample.
     *
     * LATENCY. The limiter delays the audio by its lookahead plus the detector's centring: 75
     * samples (truepeak.dsp's latency_samples; 1.6 ms at 48 kHz, 1.7 ms at 44.1 kHz). It is NOT
     * compensated against the playhead or the meters -- under 2 ms, below what anyone can place
     * by ear against a moving playhead. An export is 75 samples later than a mastering-off one
     * of the same project; its length is unchanged, so the last 75 samples stay in the line.
     *
     * Switching mastering on or off while sounding crossfades between the dry signal and the
     * limited one over kFadeSec, rather than stepping by the trim and jumping 75 samples.
     * "Sounding" is the stage's own: any process() call since construction or the last reset()
     * counts, mastering on or off (an off block only sets a flag; its samples stay untouched).
     * So switching on in the middle of a play that started with mastering off fades in, as does
     * switching back on. Only the very first process() after construction or a reset() engages
     * at once, with no fade: an export starts there, and so does live playback from a stop --
     * which is what keeps the two identical. During a crossfade the ceiling is not guaranteed
     * (the dry part is unlimited).
     *
     * THREADING. Two sides, the house pattern (PluginChain's slots): the message thread builds a
     * whole Instance for a sample rate (prepare(): the Faust object, its scratch) and parks it in
     * `pending`; the audio thread promotes it at the top of its next process() call, parking the
     * one it displaces in `retired`; the message thread frees that in drainRetired(). The audio
     * thread never allocates, frees or locks: with `retired` still occupied it leaves the new
     * instance pending and tries again next block. Those deferred blocks run on the old
     * instance, at the old rate -- so after a SECOND rate change before the first's retirement
     * is collected, blocks at the new rate pass through unlimited (counted in
     * rateMismatchCount) until the drain. PlaybackEngine::drainRetiredProject collects it: the
     * IPC connection calls that on every message it receives, ~30 times a second while playing,
     * and every 750 ms regardless, so the window is one message-thread tick, tens of ms. */
    class MasterStage
    {
    public:
        /** The crossfade when mastering is switched on or off mid-play, and the ramp when the
         * headroom changes. */
        static constexpr double kFadeSec = 0.02;
        /** truepeak.dsp's latency_samples. */
        static constexpr int kLatencySamples = 75;

        MasterStage();
        ~MasterStage();
        MasterStage(const MasterStage&) = delete;
        MasterStage& operator=(const MasterStage&) = delete;

        /** MESSAGE THREAD. Builds an instance at this rate and parks it for the audio thread,
         * unless the last one built is already at it. Allocates. */
        void prepare(double sampleRate);

        /** MESSAGE THREAD. The rate of the last instance prepare() built, or 0 if none. */
        double preparedRate() const { return builtRate; }

        /** MESSAGE THREAD. Frees an instance the audio thread swapped out. Cheap when there is
         * none: one atomic load. */
        void drainRetired();

        /** AUDIO THREAD. Runs the stage in place over one block. `settings` null means off.
         * Passes the block through untouched (and counts it, rateMismatchCount) when no
         * instance has been prepared at `sampleRate` yet. Any numSamples; block-size invariant
         * to the bit for a given sequence of settings. */
        void process(const SoundSettings::Mastering* settings, double sampleRate, int numSamples, float* l, float* r);

        /** AUDIO THREAD (or with no process() in flight). Clears the limiter's lookahead and
         * envelope, and forgets that the stage has sounded: the next process() is a fresh
         * stage's, engaging at once if it has mastering on. Transport calls it once a stop or
         * pause has faded out, so the next play does not start with the last 75 samples of the
         * previous one, and when the device (re)starts. */
        void reset();

        /** AUDIO THREAD. How late the stage's output is right now: kLatencySamples while the
         * limited signal is in it (fully or partly, during a crossfade), else 0. Transport's
         * seek holds at silence this much longer, so the jump lands under silence. */
        int currentLatencySamples() const;

        /** How many blocks were passed through because the instance's rate did not match. */
        unsigned long long rateMismatchCount() const { return rateMismatches.load(std::memory_order_relaxed); }

    private:
        static constexpr int kChunk = 512;

        struct Instance
        {
            explicit Instance(double sampleRate);

            FaustStage limiter { FaustDspKind::truepeak };
            const double sampleRate;
            const int fadeSamples;

            std::array<std::vector<float>, 4> scratch; // in L/R, out L/R, kChunk each

            float lastCeilingDb = 0.0f;
            bool ceilingSet = false;
            float gain = 1.0f;       // the trim now
            float gainTarget = 1.0f; // where it is ramping to
            float gainStep = 0.0f;
            int gainRampLeft = 0;

            bool engaged = false; // the limited signal is (at least partly) in the output
            int fadeLeft = 0;     // samples of crossfade still to run
            bool fadingIn = true;
            SoundSettings::Mastering held {}; // the settings a fade-out keeps running on

            void reset();
            /** `fadeOnEngage`: the stage has sounded since it was built or reset, so an engage
             * here crossfades in; otherwise it is immediate. */
            void process(const SoundSettings::Mastering* settings, bool fadeOnEngage, int numSamples, float* l, float* r);
            void processChunk(const SoundSettings::Mastering& m, int n, float* l, float* r);
        };

        std::atomic<Instance*> current { nullptr };
        std::atomic<Instance*> pending { nullptr };
        std::atomic<Instance*> retired { nullptr };
        double builtRate = 0.0; // message thread only
        bool sounded = false;   // audio thread only: a process() call since construction or reset()
        std::atomic<unsigned long long> rateMismatches { 0 };
    };
}

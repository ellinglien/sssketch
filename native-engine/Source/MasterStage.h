// native-engine/Source/MasterStage.h
#pragma once
#include "FaustStage.h"
#include "MasterTone.h"
#include "SoundSettings.h"
#include <array>
#include <atomic>
#include <cstddef>
#include <memory>
#include <optional>
#include <type_traits>
#include <vector>

namespace sssketch
{
    /** The radio sound's master stage (docs/superpowers/plans/2026-10-01-native-radio-sound.md,
     * Tasks 3, 7 and 8), in the web radio's order (masterChain.ts, its Faust path):
     *
     *   headroom trim -> HP 25 Hz (tone) -> saturation (saturate.dsp) -> glue (glue.dsp)
     *   -> width (tone) -> low shelf 100 Hz (tone) -> high shelf 10 kHz (tone)
     *   -> true-peak limiter (truepeak.dsp, ceiling -1 dBTP by default, release 0.1 s, lookahead 64)
     *
     * Glue, tone and saturation each have their own switch (Settings::glue, ::tone,
     * ::saturation), and run only inside mastering (the wire and the parser drop them without
     * it). The tone stages are MasterTone (Web Audio's BiquadFilterNode, as Chromium runs it).
     * None of them adds latency (saturate.dsp and glue.dsp declare 0).
     *
     * SATURATION (Task 8) is saturate.dsp as the web runs it, not oversampled: the drive comes
     * from the wire (saturationDrive(amount), 0.9 by default); the bias (0.1), the makeup
     * (+0.5 dB x (drive / 1.8)^2, so +0.125 dB at 0.9: small signals come out that much louder,
     * not at unity) and the ~5 Hz DC blocker are inside the .dsp. The .dsp glides its drive
     * over ~20 ms itself (a one-pole from 0 when the DSP is fresh or cleared -- here at every
     * stop, seek and device start; the web's worklet glides from 0 only when it is created), so
     * a drive change is just set; while the glided drive is under 0.001 a
     * channel is passed through exactly (DC blocker bypassed), so drive 0 is the stage
     * switched off, to the bit.
     *
     * Runs AFTER the user's master plugin slots, as the last thing before the device or the WAV:
     * a plugin after a limiter would undo the ceiling. PlaybackEngine owns the one instance and
     * both callers -- Transport (live) and RenderExport (bounce) -- reach it through
     * PlaybackEngine::processMaster, so the two paths run the same code on the same settings.
     *
     * OFF IS TODAY. With no mastering settings (sound absent, or mastering switched off) and no
     * fade-out still running, process() returns without touching a sample. With glue, tone and
     * saturation all off (and settled), the stage is Task 3's, to the bit: none is run at all.
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
     * GLUE, TONE AND SATURATION SWITCHES. While mastering is on, switching glue, tone or
     * saturation on or off crossfades that stage alone over kFadeSec (its input against its
     * output; tone's HP and its width-and-shelves section on the same weights), starting it from
     * a cleared state when it comes on (for the saturation that includes its drive glide, which
     * starts again from 0). When mastering itself engages, the stages engage with it at once, inside
     * mastering's own fade. A tone amount change glides the shelves' gains in dB over kFadeSec,
     * sample by sample. A glue amount change is set at once: glue.dsp's reduction runs through
     * its own attack/release one-poles (30 ms at the fastest), so the gain cannot step.
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

        /** What one block runs on: mastering, and the stages that run inside it. */
        struct Settings
        {
            SoundSettings::Mastering mastering;
            std::optional<SoundSettings::Glue> glue;
            std::optional<SoundSettings::Tone> tone;
            std::optional<SoundSettings::Saturation> saturation {}; // off unless given (Task 7's three-field initialisers stay valid)
        };

        static_assert(std::is_trivially_copyable_v<Settings>, "copied on the audio thread every block");

        /** The settings a project's sound asks for, or nothing when mastering is off. */
        static std::optional<Settings> settingsFor(const SoundSettings& sound);

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
        void process(const Settings* settings, double sampleRate, int numSamples, float* l, float* r);
        /** Mastering alone (glue, tone and saturation off): Task 3's stage. */
        void process(const SoundSettings::Mastering* mastering, double sampleRate, int numSamples, float* l, float* r);
        /** Off (either overload's null). */
        void process(std::nullptr_t, double sampleRate, int numSamples, float* l, float* r)
        {
            process(static_cast<const Settings*>(nullptr), sampleRate, numSamples, l, r);
        }

        /** AUDIO THREAD (or with no process() in flight). Clears the limiter's lookahead and
         * envelope, and forgets that the stage has sounded: the next process() is a fresh
         * stage's, engaging at once if it has mastering on. Transport calls it once a stop or
         * pause has faded out, so the next play does not start with the last 75 samples of the
         * previous one, and when the device (re)starts. */
        void reset();

        /** AUDIO THREAD (or with no process() in flight). Clears the DSP state only -- the
         * limiter's line and envelope, the glue's envelopes, the tone's filters, the
         * saturation's DC blocker and drive glide (which then rises from 0 again over ~20 ms,
         * as at a fresh play: so a seek's new position equals a fresh play from there) -- and keeps
         * everything else: the switches, their fades, the trim, and whether the stage has
         * sounded. Transport calls it at a seek's jump, under the reposition fade's silence, so
         * the new position starts as a fresh stage would (no glue reduction carried over from
         * a loud passage, no old audio in the line) while a later switch still crossfades.
         * Allocates nothing (Faust's instanceClear, zeroed biquads). Never called by an export. */
        void clearDynamics();

        /** AUDIO THREAD. How late the stage's output is right now: kLatencySamples while the
         * limited signal is in it (fully or partly, during a crossfade), else 0. Transport's
         * seek holds at silence this much longer, so the jump lands under silence. */
        int currentLatencySamples() const;

        /** How many blocks were passed through because the instance's rate did not match. */
        unsigned long long rateMismatchCount() const { return rateMismatches.load(std::memory_order_relaxed); }

        /** Any thread, for the dev readouts (Task 13) and tests: the glue's and the limiter's gain
         * reduction at the end of the last block, dB (<= 0), from their Faust meters (glue.dsp's
         * and truepeak.dsp's `gr` bargraphs). 0 while that stage is not running (mastering off, the
         * glue switched off, a block passed through). Written once per process() call by the
         * rendering thread; relaxed, a meter. */
        float glueGainReductionDb() const { return glueGrMeter.load(std::memory_order_relaxed); }
        float limiterGainReductionDb() const { return limiterGrMeter.load(std::memory_order_relaxed); }

    private:
        static constexpr int kChunk = 512;

        /** One switchable stage's crossfade (glue, tone, saturation): see the SWITCHES above. */
        struct StageFade
        {
            bool engaged = false; // the stage runs (its output is at least partly in the signal)
            bool fadingIn = true;
            int fadeLeft = 0;

            /** Once per process() call. `fade`: crossfade an engage (else immediate). Returns
             * true when the stage engages from nothing: the caller clears its state. */
            bool update(bool want, bool fade, int fadeSamples);
            /** The wet weights of the next n samples into w; false (w untouched) when they are
             * all 1, i.e. no fade is running. */
            bool weights(int n, int fadeSamples, float* w);
            /** After a chunk: a finished fade-out leaves the stage off. */
            void settle();
        };

        struct Instance
        {
            explicit Instance(double sampleRate);

            FaustStage limiter { FaustDspKind::truepeak };
            FaustStage glue { FaustDspKind::glue };
            FaustStage saturate { FaustDspKind::saturate };
            MasterTone tone;
            StageFade glueFade, toneFade, saturateFade;
            SoundSettings::Glue glueSet {}; // the glue parameters last set on the DSP
            bool glueParamsSet = false;
            float driveSet = 0.0f; // the saturation drive last set on the DSP
            bool driveParamSet = false;
            const double sampleRate;
            const int fadeSamples;

            std::array<std::vector<float>, 7> scratch; // in L/R, out L/R, glue, tone and saturation weights; kChunk each

            float lastCeilingDb = 0.0f;
            bool ceilingSet = false;
            float gain = 1.0f;       // the trim now
            float gainTarget = 1.0f; // where it is ramping to
            float gainStep = 0.0f;
            int gainRampLeft = 0;

            bool engaged = false; // the limited signal is (at least partly) in the output
            int fadeLeft = 0;     // samples of crossfade still to run
            bool fadingIn = true;
            Settings held {}; // the settings a fade-out keeps running on

            void reset();
            void clearDynamics();
            /** `fadeOnEngage`: the stage has sounded since it was built or reset, so an engage
             * here crossfades in; otherwise it is immediate. */
            void process(const Settings* settings, bool fadeOnEngage, int numSamples, float* l, float* r);
            /** Glue, tone and saturation follow `s` (on, off, their parameters); `fade`
             * crossfades a switch. */
            void updateStages(const Settings& s, bool fade);
            void processChunk(const Settings& s, int n, float* l, float* r);
        };

        std::atomic<Instance*> current { nullptr };
        std::atomic<Instance*> pending { nullptr };
        std::atomic<Instance*> retired { nullptr };
        double builtRate = 0.0; // message thread only
        bool sounded = false;   // audio thread only: a process() call since construction or reset()
        std::atomic<unsigned long long> rateMismatches { 0 };
        std::atomic<float> glueGrMeter { 0.0f };
        std::atomic<float> limiterGrMeter { 0.0f };
        /** AUDIO THREAD. The meters after a block: `inst` null (or not engaged) reads 0. */
        void updateMeters(const Instance* inst);
    };
}

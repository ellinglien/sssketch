// native-engine/Source/ReverbBus.h
#pragma once
#include "AutomationCurve.h"
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

    /** ONE shared zita-rev1 instance for the whole mix, fed by per-channel
     * sends -- cheaper and more cohesive than an instance per channel, per
     * the design doc.
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
     * Not thread-safe, same single-renderer invariant as ChannelFilter. */
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

        /** Clears the send accumulator for a block of `numSamples`. */
        void beginBlock(int numSamples);

        /** Mixes one channel's signal into the send accumulator, scaled by
         * `gain` advanced ONE SAMPLE AT A TIME -- so a reverbSend automation
         * ramp crossfades into the tail instead of stepping at block
         * boundaries. Passing a smoother whose value and target are both zero
         * adds nothing and, crucially, does not mark the bus as fed. */
        void addSend(int numSamples, const float* left, const float* right, ParamSmoother& gain);

        /** Runs the reverb over whatever was accumulated and ADDS the wet
         * result into outL/outR. A no-op (leaving the output bit-identical)
         * when nothing was sent this block and no tail remains. */
        void endBlock(int numSamples, float* outL, float* outR);

        /** Drops the tail -- for a transport stop/seek, where letting the
         * previous position's reverb ring on into the new one is an artifact
         * of the seek. */
        void reset();

        /** True while the reverb is either being fed or still ringing out.
         * Exposed for tests and for a future "is the toolkit doing anything"
         * indicator; the render path uses it internally. */
        bool isRinging() const { return tailSamplesRemaining > 0; }

        /** Whether a reverb has actually been constructed yet -- i.e. whether
         * this project has ever used a non-zero send. Tests assert on this to
         * pin the "neutral allocates nothing" promise. */
        bool hasBeenBuilt() const { return impl != nullptr; }

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
        int tailSamplesRemaining = 0;
    };
}

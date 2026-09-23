// native-engine/Source/NoiseRiser.h
#pragma once
#include "ChannelFilter.h"
#include "EngineProject.h"
#include <juce_dsp/juce_dsp.h>
#include <cstdint>

namespace sssketch
{
    /** The riser's noise is WHITE, not pink.
     *
     * Pink noise is the usual instinct for anything "musical", but it is the
     * wrong source here for a concrete reason: pink tilts -3dB per octave, so
     * feeding it to a bandpass that climbs through the spectrum makes the
     * riser get QUIETER exactly as it rises -- fighting the swell the element
     * exists to produce, and forcing the level ramp to work twice as hard to
     * compensate.
     *
     * White noise has constant energy per Hz, so a constant-Q bandpass (whose
     * bandwidth grows in proportion to its centre frequency) passes MORE
     * energy the higher it goes. The build is therefore partly in the sweep
     * itself, not only in the gain ramp, which is what makes it read as
     * tension rather than as a fade-in with a filter on it.
     *
     * White is also the only one of the two that can be addressed by sample
     * INDEX (see riserNoiseAt). Pink noise is made by filtering white, and a
     * filter has memory -- which would mean the riser's source depended on
     * where playback started, and a bounced export would no longer be the
     * same audio as the pass you listened to. */

    /** The bandpass's Q. One fixed value rather than a control: the riser's
     * data shape has no room for one (see EngineRiser), and a riser is a
     * texture rather than a resonator. 2.0 is roughly a half-octave band --
     * narrow enough to be clearly a SWEEP rather than a general brightening,
     * wide enough not to whistle. */
    constexpr double kRiserBandwidthQ = 2.0;

    /** Undoes the bandpass's own passband gain, so `level` means a level.
     *
     * juce::dsp::StateVariableTPTFilter's bandpass output has a peak
     * magnitude response of Q, not 1 (at resonance the transfer function
     * reduces to 1/R2, and R2 is 1/Q). Left uncorrected, a riser at level 0.8
     * through a Q of 2 can reach 1.6 -- which is not a subtle mistake: it
     * clips the mix bus, and it clipped hard enough that a bounce and the
     * live pass it came from stopped matching, because the 16-bit file
     * couldn't hold what the float render produced. Found exactly that way,
     * by the offline-render parity test in PlaybackEngineTests.
     *
     * Multiplying by 1/Q normalises the passband to unity, after which the
     * riser's peak is bounded by its own level, which is what the control
     * claims and what the tests now pin. */
    constexpr double kRiserBandpassNormalisation = 1.0 / kRiserBandwidthQ;

    /** How long the riser rings on AFTER its end, as a fraction of a bar.
     *
     * The swell reaches full level exactly at the riser's last sample
     * (riserEnvelopeAt(1) == 1), which is musically right -- the peak is
     * where the drop lands -- and electrically a click, since the signal went
     * from full scale to nothing in one sample. What used to be here was a
     * 4ms linear declick INSIDE the riser, which solved the click and nothing
     * else: the riser still stopped dead at its own edge.
     *
     * A riser into a drop does not stop dead on a record; it decays away
     * underneath the first bar of the drop, like a short reverb on the moment
     * of impact. So the tail now lives PAST the riser's end rather than
     * inside it (see riserTailGainAt), which is the only arrangement that
     * leaves the peak exactly on the end bar -- a tail carved out of the
     * riser's own length would pull the peak earlier and make the riser
     * deflate just before the drop, the opposite of what it is for.
     *
     * Measured in BARS, not seconds, for two reasons. Musically, a tail that
     * rings over the downbeat should be a note value (this is an eighth note
     * in 4/4 -- 250ms at 120bpm, 172ms at 174bpm), so it stays in time with
     * the drop it is ringing over instead of smearing a fixed number of
     * milliseconds across every tempo. Practically, bars is the one unit
     * every layer here can already express: the shared TS twin
     * (src/shared/riser.ts's RISER_TAIL_BARS) needs this number to give the
     * Ableton/REAPER exporters a riser clip long enough to contain its own
     * tail, and that layer has no sample rate -- which is exactly why the old
     * 4ms declick could NOT be mirrored there. */
    constexpr double kRiserTailBars = 0.125;

    /** The tail's decay constant: ln(1000), i.e. 60dB of decay across the
     * tail. Exponential rather than linear because that is what a decaying
     * space actually does and what the ear reads as a tail rather than as
     * someone pulling a fader down; RT60 is the convention for how long "a
     * reverb" lasts, so borrowing its 60dB is the defensible amount of decay
     * to spend the tail on. */
    constexpr double kRiserTailDecay = 6.907755278982137;

    /** How often the bandpass's coefficients are recomputed, in samples --
     * the same reasoning as ChannelFilter's own kCoefficientUpdateSamples (a
     * TPT filter's coefficients cost a tan(), far more than the filter step
     * itself, and ~1.4ms apart at 44.1kHz is finer than any audible sweep
     * granularity).
     *
     * The important difference: this cadence is anchored to the RISER's own
     * sample index, not to the start of the render block. That is what makes
     * the riser's output independent of how the host happens to carve up
     * time -- a block split at a loop boundary (Transport.cpp renders more
     * than one sub-range per callback) updates coefficients at exactly the
     * same sample positions as an unsplit one would. */
    constexpr int kRiserCoefficientUpdateSamples = 64;

    /** A stable 32-bit seed for a riser id. Two risers with different ids get
     * different noise; the SAME riser gets the same noise in every session,
     * in a bounce, and on every machine -- which is the whole point (a riser
     * whose texture changed between the pass you approved and the file you
     * exported would be a bug you could only find by listening). */
    std::uint32_t riserSeedFor(const juce::String& id);

    /** The riser's source sample at a given index, in [-1, 1).
     *
     * Counter-based, NOT a stateful generator: the value is a pure hash of
     * (seed, index), so asking for sample 40000 gives the same answer whether
     * you got there by rendering 40000 samples or by seeking straight to it.
     * That is what makes an offline export bit-identical to live playback
     * even though the two arrive at the same instant by different routes, and
     * it is also why nothing here has to be reset, carried between blocks, or
     * protected from a block-size change. */
    float riserNoiseAt(std::uint32_t seed, std::int64_t sampleIndex);

    /** The riser's volume swell as a gain in [0,1], at a fraction of the way
     * through it. Squared -- see riserEnvelopeAt in src/shared/riser.ts, the
     * mirrored twin, for why a riser is not a fade-in. */
    double riserEnvelopeAt(double progress01);

    /** The tail's gain in [0,1], at a fraction of the way through the tail --
     * 0 being the riser's end bar (where the tail starts, at full level, so
     * it joins the peak without a step) and 1 the end of the tail.
     *
     * An exponential decay, shifted so it arrives at EXACTLY zero instead of
     * merely near it: e^-k never reaches 0, and a tail that stopped at
     * e^-6.9 of full level would reintroduce, 0.1% quieter, the very click
     * this exists to remove. Subtracting the endpoint and renormalising costs
     * that 0.1% of the shape and buys a tail that genuinely ends.
     *
     * Values at or below 0 give 1 (the riser proper, untouched -- this is
     * what keeps the peak where it was), values at or above 1 give 0. */
    double riserTailGainAt(double tailProgress01);

    /** The riser's bandpass centre, as a normalised [0,1] cutoff value, at a
     * CLIP-RELATIVE bar. Follows the drawn curve where there is one, and the
     * declared startCutoffValue -> endCutoffValue ramp where there isn't.
     * Mirrored by riserCutoffAt in src/shared/riser.ts, which is what the
     * arranger draws the block's slope from. */
    double riserCutoffAt(const EngineRiser& riser, double clipBar);

    /** ONE riser's live DSP -- which is only the bandpass, because the source
     * is index-addressed (riserNoiseAt) and the envelope is a pure function
     * of position. Owned by PlaybackEngine, keyed by riser id, created
     * lazily: a project with no risers never constructs one.
     *
     * Not thread-safe and not meant to be, exactly like ChannelFilter and for
     * the same reason: one thread ever renders a given engine instance (the
     * live audio callback, or RenderExport's own offline instance -- never
     * both). */
    class RiserVoice
    {
    public:
        /** Renders one block of this riser and ADDS it into outL/outR (which
         * the caller has already filled with whatever else is on the
         * channel). A no-op, touching nothing, for a block the riser does not
         * overlap -- so a riser costs only a time comparison on every block
         * it isn't sounding in. "Overlap" includes the tail
         * (kRiserTailBars): a riser sounds past its own end bar, and the
         * block it rings into is usually the first block of the drop.
         *
         * `blockStartSec` is the absolute transport time of outL[0], the same
         * number PlaybackEngine::renderBlock derives from positionBars, so a
         * riser lands on the same instant live and offline. */
        void render(
            const EngineRiser& riser,
            double blockStartSec,
            double sampleRate,
            double secPerBar,
            int numSamples,
            float* outL,
            float* outR);

    private:
        void prepare(double sampleRate, int maxBlockSize);

        juce::dsp::StateVariableTPTFilter<float> filter;
        double preparedSampleRate = 0.0;
        int preparedBlockSize = 0;

        std::uint32_t seedL = 0;
        std::uint32_t seedR = 0;
        bool seeded = false;

        // The riser-local sample index this voice expects NEXT. A mismatch
        // means playback jumped (a seek, a fresh transport start, the first
        // block this riser is heard in), and the bandpass's state belongs to
        // a stretch of time we are no longer in -- so it is dropped rather
        // than dragged across the discontinuity. -1 = nothing rendered yet.
        std::int64_t nextSampleIndex = -1;
        // Riser-local index the coefficients were last computed at, so the
        // update cadence is anchored to the riser rather than to the block.
        std::int64_t lastCoefficientIndex = -1;
    };
}

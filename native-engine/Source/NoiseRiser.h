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
     * same audio as the pass you listened to.
     *
     * (2026-10-02, native radio sound plan Task 6: radio's transition risers
     * may now ask for pink -- EngineRiser::pink, drawn by the web's riser
     * character for "more body under the sweep". It is level-matched to white
     * where a riser is loudest (kRiserPinkMatchHz), so the swell above is not
     * lost, and it keeps index addressing by a warm-up rather than by being
     * stateless: see RiserPinkFilter. White stays the default and the only
     * colour a hand-drawn riser has.) */

    /** The bandpass's Q when the riser does not ask for another
     * (EngineRiser::q, from radio's riser character). 2.0 is roughly a
     * half-octave band -- narrow enough to be clearly a SWEEP rather than a
     * general brightening, wide enough not to whistle. A hand-drawn riser
     * always has this. */
    constexpr double kRiserBandwidthQ = kRiserDefaultQ;

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

    /** The riser's gain normalisation at any Q: today's peak normalisation
     * (1/Q, see above) times the web's POWER match to Q 2, sqrt(Q/2)
     * (riserVoice.ts's "Q trim"). A bandpass passes white noise power in
     * proportion to its bandwidth, centre/Q, so without the second factor a
     * resonant Q-6 riser would be ~5 dB quieter than a Q-1 one; with it, every
     * Q has the RMS of today's Q-2 riser. At Q 2 this is exactly 0.5 ==
     * kRiserBandpassNormalisation (1/2 and sqrt(1) are exact), so a riser
     * without a Q renders bit for bit as before.
     *
     * The cost, accepted by the plan (Task 6's risk): above Q 2, "level means
     * level" becomes a level of POWER, not of peak: the narrow band's
     * passband gain is sqrt(Q/2) over today's, so its peak can pass `level`.
     * Measured over a whole default sweep (NoiseRiserTests): white peaks at
     * 0.71 / 0.88 / 1.03 / 1.11 x level at Q 1 / 2 / 4 / 6, pink at 0.54 /
     * 0.64 / 0.80 / 0.86. Radio's draw keeps the level at 0.35 x (+1..+5 dB),
     * at most 0.62, and the master stage's true-peak limiter (Task 3) is the
     * backstop. At Q 2 and below the old bound (peak <= level) still holds. */
    double riserGainNormalisation(double q);

    /** Paul Kellet's "economy" pink filter: three one-poles plus a direct
     * term, about -3 dB/octave across the audio band. The coefficients are
     * the web's (ell.ing/radio src/audio/riserVoice.ts, pinkNoise), so the
     * same white gives the same pink. */
    constexpr double kKelletPole0 = 0.99765, kKelletGain0 = 0.099046;
    constexpr double kKelletPole1 = 0.963, kKelletGain1 = 0.2965164;
    constexpr double kKelletPole2 = 0.57, kKelletGain2 = 1.0526913;
    constexpr double kKelletDirect = 0.1848;

    /** Where pink is level-matched to white (riserVoice.ts's MATCH_HZ): a
     * riser is loudest near the top of its sweep (the swell is squared), so
     * matched here pink keeps the riser's level and adds body below. */
    constexpr double kRiserPinkMatchHz = 6000.0;

    /** How far back a pink riser re-runs its filter on a discontinuity (a
     * seek, a transport start, the first block a riser sounds in). The
     * slowest pole is kKelletPole0, and 0.99765^16384 ~ e^-38.5 ~ 2e-17: what
     * came before the warm-up is gone to well below a float's resolution, so a
     * seek lands on the same pink a continuous render has there (to ~1e-16;
     * pinned at 1e-6). */
    constexpr int kRiserPinkWarmupSamples = 16384;

    /** The constant that level-matches pink to white at kRiserPinkMatchHz at
     * this sample rate: 1 / |H(e^jw)| of the Kellet filter at that frequency
     * (white's own magnitude being 1). Analytic, so it is the same everywhere
     * and costs nothing to compute; the web MEASURES it instead (rmsAtMatch:
     * white and pink through a Q-2 bandpass at 6 kHz over 2 s), giving
     * 0.5114 at 44.1 kHz and 0.4898 at 48 kHz -- this is within 0.05 and
     * 0.12 dB of those (the web's band averages a little of the slope), which
     * NoiseRiserTests pins. */
    double riserPinkMatchGain(double sampleRate);

    /** The Kellet filter's state for one channel of a pink riser. The source
     * stays riserNoiseAt -- index-addressed white -- and this filters it. A
     * filter has memory, which is why white was the riser's only colour (see
     * the top of this file): addressing is kept by WARM-UP instead. On a
     * discontinuity, warmTo re-runs the filter from silence over the
     * kRiserPinkWarmupSamples white samples before the index, which leaves it
     * where a continuous render would be to ~1e-16. Continuous playback
     * (every block boundary, every block size) never warms up: only the
     * voice's own "the index I expected next is not this one" test does. */
    class RiserPinkFilter
    {
    public:
        void reset() { b0 = b1 = b2 = 0.0; }

        /** Filters one white sample; returns the pink one (not yet matched). */
        double process(double white)
        {
            b0 = kKelletPole0 * b0 + white * kKelletGain0;
            b1 = kKelletPole1 * b1 + white * kKelletGain1;
            b2 = kKelletPole2 * b2 + white * kKelletGain2;
            return b0 + b1 + b2 + white * kKelletDirect;
        }

        /** Resets, then runs over riserNoiseAt(seed, index - kRiserPinkWarmupSamples)
         * .. (seed, index - 1), so the next process() is sample `index`. Negative
         * indices are fine: riserNoiseAt hashes any int64. Bounded: always exactly
         * kRiserPinkWarmupSamples hashes and filter steps, no allocation. */
        void warmTo(std::uint32_t seed, std::int64_t index);

    private:
        double b0 = 0.0, b1 = 0.0, b2 = 0.0;
    };

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
         * riser lands on the same instant live and offline.
         *
         * Returns whether any sample of this block was in the riser (tail
         * included) -- PlaybackEngine uses it to feed the riser's reverb send
         * only on blocks that have something to send. */
        bool render(
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

        std::uint32_t seedL = 0;
        std::uint32_t seedR = 0;
        bool seeded = false;

        // The Q the filter is set to (prepare() sets kRiserBandwidthQ); changed
        // only when a riser asks for another, so a riser without one calls
        // exactly what it always did.
        double filterQ = kRiserBandwidthQ;

        // Pink (EngineRiser::pink). `pinkReady` is false until the filters
        // are warmed for the stream they are on, and goes false again when
        // the colour or the stereo changes under a live voice, so the next
        // sample warms up rather than continuing from the wrong stream.
        RiserPinkFilter pinkL, pinkR;
        double pinkMatch = 1.0; // riserPinkMatchGain at preparedSampleRate
        bool pinkReady = false;
        bool pinkReadyMono = false;
        unsigned long long pinkWarmUps = 0;

    public:
        /** For tests: how many times this voice has warmed its pink filters
         * up, so a test can pin that continuous playback, at any block size,
         * warms up exactly once. */
        unsigned long long pinkWarmUpCount() const { return pinkWarmUps; }

    private:

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

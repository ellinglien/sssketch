// native-engine/Source/ChannelFilter.h
#pragma once
#include "AutomationCurve.h"
#include <juce_dsp/juce_dsp.h>

namespace sssketch
{
    enum class FilterMode
    {
        lowpass,
        highpass
    };

    /** The filter's usable cutoff range. 20Hz..20kHz is the audible band's own
     * bounds, deliberately: it makes the two ends of the control genuinely
     * neutral -- a lowpass at 20kHz and a highpass at 20Hz both pass the whole
     * audible signal -- which is what lets the neutral end double as the
     * "nothing is happening here" position the bypass check keys off. */
    constexpr double kFilterCutoffMinHz = 20.0;
    constexpr double kFilterCutoffMaxHz = 20000.0;

    /** Maps the normalised [0,1] control value (what a drawn automation curve
     * carries, see AutomationCurve.h) onto Hz LOGARITHMICALLY -- an octave per
     * equal step of the control, so dragging a curve feels the same at the
     * bottom of the range as at the top. A linear map would spend 90% of the
     * control's travel above 2kHz, where almost nothing musically interesting
     * happens for a filter sweep. Values outside [0,1] clamp. */
    double filterCutoffHz(double value01);

    /** Maps [0,1] onto filter Q, 0.7071 (Butterworth, no resonant peak) up to
     * 8.0 (a pronounced, but not self-oscillating, peak). Exponential for the
     * same reason the cutoff map is. Values outside [0,1] clamp. */
    double filterResonanceQ(double value01);

    /** The control value at which a given mode does nothing: fully open for a
     * lowpass (1.0 -> 20kHz), fully down for a highpass (0.0 -> 20Hz). */
    constexpr double neutralCutoffValue(FilterMode mode)
    {
        return mode == FilterMode::lowpass ? 1.0 : 0.0;
    }

    /** Whether this channel's filter can be skipped ENTIRELY -- no state, no
     * per-sample work, not even an allocation for it.
     *
     * Two conditions, per the design doc: nothing is automating the filter,
     * AND its static cutoff sits at its mode's own neutral end. A channel with
     * a cutoff automation curve is never bypassed even where the curve happens
     * to sit at neutral -- ducking in and out of a filter mid-curve would drop
     * its state and click, and the curve is the user's declaration that this
     * channel HAS a filter. Resonance alone can't un-neutralise a filter whose
     * cutoff is parked at the end of its range (there's nothing there to
     * resonate), but automating it is still treated as "the user is using the
     * filter", same as cutoff.
     *
     * A non-finite cutoff (corrupted project file) counts as NOT neutral so it
     * flows into the clamping maps above rather than into bypassed arithmetic. */
    bool channelFilterIsNeutral(
        FilterMode mode,
        double cutoffValue,
        bool hasCutoffAutomation,
        bool hasResonanceAutomation);

    /** One channel's filter: a juce::dsp::StateVariableTPTFilter plus the two
     * smoothers that keep its coefficients from stepping between blocks.
     *
     * Owned by PlaybackEngine per channel and created LAZILY, only for a
     * channel that actually fails channelFilterIsNeutral -- so an ordinary
     * project (the overwhelmingly common case) never constructs one of these
     * at all, which is the concrete meaning of "neutral costs nothing".
     *
     * Not thread-safe and not meant to be: exactly one thread ever renders a
     * given engine instance (the live audio callback, or RenderExport's own
     * single-threaded offline instance -- never both), the same invariant
     * PlaybackEngine's scratch buffers already rely on. */
    class ChannelFilter
    {
    public:
        /** Safe to call every block; only does real work when the sample rate
         * or block size actually changed. */
        void prepare(double sampleRate, int maxBlockSize);

        /** Drops filter state and jumps both smoothers straight to the given
         * control values -- for a transport start/seek, where ramping from
         * wherever the last render left off would be an artifact of the seek. */
        void resetTo(FilterMode mode, float cutoff01, float resonance01);

        /** Per-block: where the parameters should be heading. The smoothers do
         * the actual travelling, inside process(). */
        void setTargets(FilterMode mode, float cutoff01, float resonance01);

        /** Filters numSamples of interleaved-by-pointer stereo IN PLACE.
         * Coefficients are recomputed every kCoefficientUpdateSamples rather
         * than every sample: recomputing a TPT filter's coefficients involves
         * a tan() and is far more expensive than the filter step itself, while
         * updating them ~1.4ms apart (at 44.1kHz) is finer than any audible
         * sweep granularity. The smoothed values themselves still advance per
         * sample, so the sub-block boundaries never see a big jump. */
        void process(int numSamples, float* left, float* right);

        float currentCutoff01() const { return cutoffSmoother.current(); }
        float currentResonance01() const { return resonanceSmoother.current(); }

    private:
        static constexpr int kCoefficientUpdateSamples = 64;

        void applyCoefficients();

        juce::dsp::StateVariableTPTFilter<float> filter;
        ParamSmoother cutoffSmoother, resonanceSmoother;
        FilterMode currentMode = FilterMode::lowpass;
        double preparedSampleRate = 0.0;
        int preparedBlockSize = 0;
    };
}

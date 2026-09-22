// native-engine/Source/AutomationCurve.h
#pragma once
#include <cmath>
#include <vector>

namespace sssketch
{
    /** One drawn automation breakpoint: a value in [0,1] at an absolute
     * arrangement bar -- the same coordinate space EngineRifff::startBar and
     * EngineStem::MuteRegion already live in, deliberately NOT pre-converted
     * to seconds, so a bpm change re-times a curve for free (identically to
     * how every other bar-keyed field in EngineProject behaves).
     *
     * The value stays NORMALISED here; mapping 0..1 onto real units (Hz, Q,
     * send gain) is each consumer's own job -- ChannelFilter.h owns the
     * cutoff/resonance maps, ReverbBus.h the send one. See
     * docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md. */
    struct AutomationPoint
    {
        double bar = 0.0;
        double value = 0.0;
    };

    /** Value of a breakpoint curve at `bar`: linear interpolation between the
     * two surrounding points, HOLD (flat, no extrapolation) before the first
     * and after the last, and `fallback` for an empty curve -- so "this
     * parameter has no automation" and "this parameter's curve hasn't started
     * yet" are cleanly different things: the first uses the channel's own
     * static setting, the second uses the curve's own first value.
     *
     * `points` must be sorted ascending by bar -- parseEngineProject sorts on
     * the way in (see EngineProject.cpp), which is the only place these are
     * built from untrusted data. A non-finite `bar` (a corrupted project file
     * reaching the audio thread) returns `fallback` rather than walking the
     * list with NaN comparisons that are all false.
     *
     * Deliberately a linear scan, not std::lower_bound: automation curves in
     * this app are drawn by hand over a handful of bars, so they are tens of
     * points, not thousands, and a scan over a contiguous vector beats a
     * binary search's branchiness at that size. Revisit only with a real
     * measurement of a real project. */
    double evaluateAutomation(const std::vector<AutomationPoint>& points, double bar, double fallback);

    /** The absolute arrangement bar a given sample within a render block falls
     * on. Exists as its own named function (rather than inline arithmetic at
     * each call site) because it is exactly the live/offline shared mapping the
     * spec requires: PlaybackEngine::renderBlock is the ONE place both live
     * playback (Transport.cpp) and offline export (RenderExport.cpp) go
     * through, and both hand it the same (positionBars, sampleRate,
     * secPerBar) triple, so automation lands on identical bars in an export as
     * it does live. Unit-tested directly for that reason. */
    inline double barAtSample(double blockStartBar, int sampleIndex, double sampleRate, double secPerBar)
    {
        if (sampleRate <= 0.0 || secPerBar <= 0.0)
            return blockStartBar;
        return blockStartBar + ((double) sampleIndex / sampleRate) / secPerBar;
    }

    /** A one-pole exponential smoother -- what keeps a stepwise-evaluated
     * automation target from producing zipper noise when it lands on the
     * signal as a gain multiply or a filter coefficient update.
     *
     * Per-SAMPLE (advance()/next()) rather than per-block: a block-rate jump
     * is exactly the discontinuity this exists to remove. The time constant
     * is a real-time constant in seconds, so behaviour is sample-rate
     * independent -- a 44.1k live session and a 44.1k offline export ramp
     * identically, and a future device-rate change doesn't silently change
     * how fast a sweep moves.
     *
     * Not real-time-hostile: no allocation, no locks, no branches in next(). */
    class ParamSmoother
    {
    public:
        /** Sets the sample rate and time constant and JUMPS straight to
         * `initial` (no ramp) -- the right behaviour at a transport
         * start/seek, where ramping up from a stale value would be an
         * audible artifact of the seek rather than of the automation. */
        void reset(double sampleRate, double timeConstantSec, float initial)
        {
            value = initial;
            target = initial;
            // 1 - exp(-1/(tau*fs)): the standard one-pole coefficient, i.e.
            // reach ~63% of a step in timeConstantSec. Clamped into (0,1] so
            // a degenerate rate/tau can never produce a coefficient that
            // oscillates or freezes.
            const double denom = timeConstantSec * sampleRate;
            coeff = denom > 0.0 ? (float) (1.0 - std::exp(-1.0 / denom)) : 1.0f;
            if (!(coeff > 0.0f)) coeff = 1.0f;
            if (coeff > 1.0f) coeff = 1.0f;
        }

        void setTarget(float t) { target = t; }

        /** Advances one sample and returns the NEW value. */
        float next()
        {
            const float remaining = target - value;
            // A one-pole approaches its target asymptotically and, in float,
            // STALLS short of it: once (target-value)*coeff drops below half
            // an ULP of `value`, the addition stops changing anything --
            // measured at roughly 4e-5 away from a target of 1.0 at this
            // class's own coefficient. Left alone, a "cutoff back to fully
            // open" move would therefore never quite land ON neutral, and
            // PlaybackEngine's own neutral-means-bypass check would stay
            // false forever, permanently costing a filter pass per block on
            // a channel the user has returned to untouched. Snapping the
            // last <=1e-4 closes that, at the cost of one step of at most
            // 1e-4 -- four orders of magnitude under anything audible, and
            // well inside the per-sample step ceiling this class is tested
            // against.
            if (std::abs(remaining) <= kSnapEpsilon)
            {
                value = target;
                return value;
            }
            value += remaining * coeff;
            return value;
        }

        /** Advances `n` samples at once and returns the value after them --
         * for a consumer that only needs the smoothed value at sub-block
         * boundaries (ChannelFilter's coefficient updates) rather than per
         * sample. Uses the closed form of n one-pole steps, so it lands on
         * exactly the same value a loop of next() would, without the loop. */
        float advance(int n)
        {
            if (n <= 0) return value;
            const float remaining = target - value;
            if (std::abs(remaining) <= kSnapEpsilon) // see next()
            {
                value = target;
                return value;
            }
            const float decay = std::pow(1.0f - coeff, (float) n);
            value = target - remaining * decay;
            return value;
        }

        float current() const { return value; }

        /** True once the ramp has effectively landed -- lets a caller drop
         * back to a cheaper path (e.g. skip a bypassed filter entirely)
         * only when doing so can't introduce a step. */
        bool isSettled(float epsilon = 1.0e-5f) const
        {
            return std::abs(target - value) <= epsilon;
        }

    private:
        // How close counts as "there" -- see next()'s own comment for why a
        // float one-pole needs this at all.
        static constexpr float kSnapEpsilon = 1.0e-4f;

        float value = 0.0f;
        float target = 0.0f;
        float coeff = 1.0f;
    };

    /** The smoothing time constant every toolkit parameter uses. ~15ms: long
     * enough that a full-scale step lands under ~1.5e-3 per sample at 44.1kHz
     * (inaudible as a step, see AutomationCurveTests), short enough that a
     * deliberately fast hand-drawn sweep still feels immediate rather than
     * laggy. One shared constant rather than per-parameter tuning, on
     * purpose: four parameters moving at visibly different speeds under one
     * drawn curve would read as a bug, not as a feature. */
    constexpr double kAutomationSmoothingSec = 0.015;
}

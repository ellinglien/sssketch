// native-engine/Source/ChannelFilter.cpp
#include "ChannelFilter.h"
#include <algorithm>
#include <cmath>

namespace sssketch
{
    namespace
    {
        double clamp01(double v)
        {
            if (!std::isfinite(v)) return 0.0;
            return std::clamp(v, 0.0, 1.0);
        }

        constexpr double kMinQ = 0.7071067811865476; // Butterworth -- no resonant peak
        constexpr double kMaxQ = 8.0;
    }

    double filterCutoffHz(double value01)
    {
        const double v = clamp01(value01);
        return kFilterCutoffMinHz * std::pow(kFilterCutoffMaxHz / kFilterCutoffMinHz, v);
    }

    double filterResonanceQ(double value01)
    {
        const double v = clamp01(value01);
        return kMinQ * std::pow(kMaxQ / kMinQ, v);
    }

    bool channelFilterIsNeutral(
        FilterMode mode,
        double cutoffValue,
        bool hasCutoffAutomation,
        bool hasResonanceAutomation)
    {
        if (hasCutoffAutomation || hasResonanceAutomation)
            return false;
        if (!std::isfinite(cutoffValue))
            return false;
        // An exact compare would be wrong here: the value arrives as JSON
        // round-tripped through a double, and a UI slider parked at its end
        // stop can land a hair off 1.0/0.0. A tolerance this small (1e-6 of
        // the control's full travel) can't hide a cutoff a user actually
        // moved -- it's about a thousandth of a cent of pitch.
        return std::abs(cutoffValue - neutralCutoffValue(mode)) <= 1.0e-6;
    }

    void ChannelFilter::prepare(double sampleRate, int maxBlockSize)
    {
        if (sampleRate <= 0.0 || maxBlockSize <= 0)
            return;
        if (sampleRate == preparedSampleRate && maxBlockSize <= preparedBlockSize)
            return;

        juce::dsp::ProcessSpec spec {};
        spec.sampleRate = sampleRate;
        spec.maximumBlockSize = (juce::uint32) maxBlockSize;
        spec.numChannels = 2;
        filter.prepare(spec);
        preparedSampleRate = sampleRate;
        preparedBlockSize = std::max(preparedBlockSize, maxBlockSize);

        // prepare() wipes the filter's state, so the smoothers have to be
        // re-seeded against the new rate too -- their coefficient is derived
        // from it (see ParamSmoother::reset).
        cutoffSmoother.reset(sampleRate, kAutomationSmoothingSec, cutoffSmoother.current());
        resonanceSmoother.reset(sampleRate, kAutomationSmoothingSec, resonanceSmoother.current());
        applyCoefficients();
    }

    void ChannelFilter::resetTo(FilterMode mode, float cutoff01, float resonance01)
    {
        currentMode = mode;
        filter.reset();
        if (preparedSampleRate > 0.0)
        {
            cutoffSmoother.reset(preparedSampleRate, kAutomationSmoothingSec, cutoff01);
            resonanceSmoother.reset(preparedSampleRate, kAutomationSmoothingSec, resonance01);
        }
        applyCoefficients();
    }

    void ChannelFilter::setTargets(FilterMode mode, float cutoff01, float resonance01)
    {
        // A mode flip is a different filter, not a parameter move -- there is
        // no meaningful ramp between a lowpass and a highpass, and carrying
        // the old topology's state into the new one rings. Clear and re-seed
        // instead; the mode only ever changes when the user changes it, so
        // this costs nothing during normal playback.
        if (mode != currentMode)
        {
            currentMode = mode;
            filter.reset();
        }
        cutoffSmoother.setTarget(cutoff01);
        resonanceSmoother.setTarget(resonance01);
    }

    void ChannelFilter::applyCoefficients()
    {
        filter.setType(currentMode == FilterMode::lowpass
            ? juce::dsp::StateVariableTPTFilterType::lowpass
            : juce::dsp::StateVariableTPTFilterType::highpass);
        // Clamped under Nyquist as well as under kFilterCutoffMaxHz: at a
        // 32kHz device rate, 20kHz is above Nyquist and the TPT coefficient's
        // own tan() would blow up. jmin rather than a hard assert -- a device
        // rate is not something a project file controls.
        const double nyquistLimit = preparedSampleRate > 0.0 ? preparedSampleRate * 0.49 : kFilterCutoffMaxHz;
        const double hz = std::min(filterCutoffHz(cutoffSmoother.current()), nyquistLimit);
        filter.setCutoffFrequency((float) std::max(hz, kFilterCutoffMinHz));
        filter.setResonance((float) filterResonanceQ(resonanceSmoother.current()));
    }

    void ChannelFilter::process(int numSamples, float* left, float* right)
    {
        if (numSamples <= 0 || left == nullptr || right == nullptr || preparedSampleRate <= 0.0)
            return;

        int i = 0;
        while (i < numSamples)
        {
            const int chunk = std::min(kCoefficientUpdateSamples, numSamples - i);
            // Advance the smoothed values across this sub-block first, then
            // set coefficients once from where they landed -- so the
            // coefficients track the ramp's own position in real time rather
            // than lagging a sub-block behind it.
            cutoffSmoother.advance(chunk);
            resonanceSmoother.advance(chunk);
            applyCoefficients();

            for (int n = 0; n < chunk; ++n)
            {
                left[i + n] = filter.processSample(0, left[i + n]);
                right[i + n] = filter.processSample(1, right[i + n]);
            }
            i += chunk;
        }

        // Flushes denormals out of the filter's state once per block. A
        // channel that has gone silent under a resonant filter otherwise
        // leaves denormal residue circulating in the state variables, which
        // on some CPUs costs orders of magnitude more per sample than normal
        // arithmetic -- the classic "silence is expensive" real-time trap.
        filter.snapToZero();
    }
}

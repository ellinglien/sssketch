// native-engine/Source/LoopSewing.cpp
#include "LoopSewing.h"
#include <algorithm>
#include <cmath>

namespace ssstitch
{
    void applyLoopSewingBlend(juce::AudioBuffer<float>& buffer, int windowSize)
    {
        const int numSamples = buffer.getNumSamples();
        if (numSamples <= windowSize * 2)
            return;

        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            auto* data = buffer.getWritePointer(ch);
            const float startSample = data[0];
            for (int i = 0; i < windowSize; ++i)
            {
                const int endIndex = (numSamples - 1) - i;
                // Equal-power crossfade coefficient: 1.0 at the seam itself
                // (i=0, blends fully to startSample) down toward 0.0 as i
                // approaches windowSize (leaves the original tail content
                // untouched further from the seam). t ranges -1..1 across
                // the window — see LoopSewing.h's own doc comment for the
                // source this is ported from.
                const double t = -1.0 + ((double) i / (double) windowSize) * 2.0;
                const float coeff = (float) std::sqrt(0.5 * (1.0 - t));
                data[endIndex] = data[endIndex] + (startSample - data[endIndex]) * coeff;
            }
        }
    }

    int adaptiveLoopSewingWindow(
        const juce::AudioBuffer<float>& buffer, int minWindow, int maxWindow, double sampleRate)
    {
        if (buffer.getNumChannels() == 0 || sampleRate <= 0.0)
            return minWindow;

        const int numSamples = buffer.getNumSamples();
        const int analysisWindow = std::min(maxWindow, numSamples);
        if (analysisWindow < 2)
            return minWindow;

        const auto* data = buffer.getReadPointer(0);
        const int startIndex = numSamples - analysisWindow;
        int crossings = 0;
        for (int i = startIndex + 1; i < numSamples; ++i)
        {
            if ((data[i - 1] < 0.0f) != (data[i] < 0.0f))
                ++crossings;
        }

        const double windowDurationSec = (double) analysisWindow / sampleRate;
        const double estimatedFreqHz = (crossings / 2.0) / windowDurationSec;

        constexpr double kBassyFreqHz = 150.0;
        constexpr double kBrightFreqHz = 1000.0;
        if (estimatedFreqHz <= kBassyFreqHz)
            return maxWindow;
        if (estimatedFreqHz >= kBrightFreqHz)
            return minWindow;

        const double logLow = std::log(kBassyFreqHz);
        const double logHigh = std::log(kBrightFreqHz);
        const double t = (std::log(estimatedFreqHz) - logLow) / (logHigh - logLow);
        return (int) std::lround(maxWindow + t * (minWindow - maxWindow));
    }
}

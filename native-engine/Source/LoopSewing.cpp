// native-engine/Source/LoopSewing.cpp
#include "LoopSewing.h"
#include <algorithm>
#include <cmath>

namespace sssketch
{
    void applyLoopSewingBlend(juce::AudioBuffer<float>& buffer, int loopEndSample, int windowSize)
    {
        const int clampedLoopEnd = std::clamp(loopEndSample, 0, buffer.getNumSamples());
        if (clampedLoopEnd <= windowSize * 2)
            return;

        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            auto* data = buffer.getWritePointer(ch);
            const float startSample = data[0];
            for (int i = 0; i < windowSize; ++i)
            {
                const int endIndex = (clampedLoopEnd - 1) - i;
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
}

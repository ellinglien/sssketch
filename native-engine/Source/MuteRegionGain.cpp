// native-engine/Source/MuteRegionGain.cpp
#include "MuteRegionGain.h"
#include <algorithm>

namespace sssketch
{
    namespace
    {
        // Same 3ms rationale as FadeGain.cpp's own kMicroFadeSec -- short
        // enough to never read as an intentional/musical fade, just enough
        // to smooth the discontinuity a hard gain jump would otherwise
        // produce at a mute region's edge.
        constexpr double kMuteMicroFadeSec = 0.003;
    }

    double muteRegionGainAt(
        double sampleTimeSec,
        double spb,
        const std::vector<EngineStem::MuteRegion>& regionsBars)
    {
        double gain = 1.0;
        for (const auto& region : regionsBars)
        {
            const double startSec = region.startBar * spb;
            const double endSec = region.endBar * spb;

            double regionGain;
            if (sampleTimeSec < startSec - kMuteMicroFadeSec || sampleTimeSec >= endSec + kMuteMicroFadeSec)
            {
                regionGain = 1.0;
            }
            else if (sampleTimeSec < startSec)
            {
                const double frac = (sampleTimeSec - (startSec - kMuteMicroFadeSec)) / kMuteMicroFadeSec;
                regionGain = 1.0 - frac;
            }
            else if (sampleTimeSec < endSec)
            {
                regionGain = 0.0;
            }
            else
            {
                const double frac = (sampleTimeSec - endSec) / kMuteMicroFadeSec;
                regionGain = frac;
            }
            gain = std::min(gain, regionGain);
        }
        return gain;
    }
}

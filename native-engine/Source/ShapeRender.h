#pragma once
#include <juce_core/juce_core.h>
#include <vector>

namespace sssketch
{
    struct ShapeRenderSegment
    {
        double sourceStartBars = 0.0;
        double sourceEndBars = 0.0;
        double destStartBars = 0.0;
        bool reversed = false;
    };

    struct ShapeRenderInfo
    {
        double durationSec = 0.0;
        double sampleRate = 0.0;
        int64_t frames = 0;
        int channels = 0;
    };

    /** Strict, dry fragment renderer for Shape Riff. The source must already
     * be tempo-resolved by the caller. Every malformed coordinate, decode
     * failure, or write failure aborts rather than producing a plausible-
     * length silent file. */
    bool renderShapeStemToWav(
        const juce::String& sourcePath,
        double sourceDurationSec,
        double sourceBarLength,
        double targetBpm,
        double loopBars,
        const std::vector<ShapeRenderSegment>& segments,
        const juce::String& outputPath,
        ShapeRenderInfo& infoOut,
        juce::String& errorOut);
}

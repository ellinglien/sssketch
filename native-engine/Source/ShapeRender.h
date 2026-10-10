#pragma once
#include <juce_core/juce_core.h>
#include <vector>

namespace sssketch
{
    struct ShapeRenderSource
    {
        juce::String path;
        double durationSec = 0.0;
        double barLength = 0.0;
    };

    struct ShapeRenderSegment
    {
        double sourceStartBars = 0.0;
        double sourceEndBars = 0.0;
        double destStartBars = 0.0;
        bool reversed = false;
        int sourceIndex = 0;
    };

    struct ShapeRenderInfo
    {
        double durationSec = 0.0;
        double sampleRate = 0.0;
        int64_t frames = 0;
        int channels = 0;
    };

    /** Intentionally crude tracker-style resampling. Output stays at the
     * source sample rate but reads with nearest-neighbour stepping, so skipped
     * or repeated samples remain audible instead of being anti-aliased. */
    bool renderShapeRawSourceToWav(
        const juce::String& sourcePath,
        double rate,
        const juce::String& outputPath,
        ShapeRenderInfo& infoOut,
        juce::String& errorOut);

    /** Offline, deterministic treatment used by Shape's single Process Clip
     * slot. The three generic parameters are interpreted by processType;
     * mix is always a dry/wet blend. */
    bool renderShapeProcessSourceToWav(
        const juce::String& sourcePath,
        const juce::String& processType,
        double primary,
        double secondary,
        double tertiary,
        double mix,
        const juce::String& outputPath,
        ShapeRenderInfo& infoOut,
        juce::String& errorOut);

    /** Strict, dry fragment renderer for Shape Riff. The source must already
     * be tempo-resolved by the caller. Every malformed coordinate, decode
     * failure, or write failure aborts rather than producing a plausible-
     * length silent file. */
    bool renderShapeStemToWav(
        const std::vector<ShapeRenderSource>& sources,
        double sourceBarLength,
        double targetBpm,
        double loopBars,
        const std::vector<ShapeRenderSegment>& segments,
        const juce::String& outputPath,
        ShapeRenderInfo& infoOut,
        juce::String& errorOut);

    /** Compatibility overload for callers rendering one untransformed
     * source. Inspector renders use the multi-source form above. */
    inline bool renderShapeStemToWav(
        const juce::String& sourcePath,
        double sourceDurationSec,
        double sourceBarLength,
        double targetBpm,
        double loopBars,
        const std::vector<ShapeRenderSegment>& segments,
        const juce::String& outputPath,
        ShapeRenderInfo& infoOut,
        juce::String& errorOut)
    {
        return renderShapeStemToWav(
            { { sourcePath, sourceDurationSec, sourceBarLength } }, sourceBarLength, targetBpm,
            loopBars, segments, outputPath, infoOut, errorOut);
    }
}

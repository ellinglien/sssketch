#include "SchedulePlayback.h"
#include <algorithm>
#include <cmath>

namespace sssketch
{
    std::vector<PlaybackSegment> computeStemSchedule(
        const RifffInfo& rifff,
        const StemInfo& stem,
        const ScheduleOptions& opts)
    {
        // barLength may be fractional (0.5, 1.5, ...) but must be positive
        // and finite -- otherwise the tile loop below never advances.
        if (!std::isfinite(stem.barLength) || stem.barLength <= 0.0)
            return {};
        const double start = opts.startBarOverride >= 0.0 ? opts.startBarOverride : rifff.startBar;
        // Wrapped into [0, stem.barLength) rather than used as a raw additive
        // shift — see src/shared/schedulePlayback.ts's identical fix (kept in
        // sync by hand, per this file's own header comment) for the full
        // reasoning: a manual nudge is always small and unaffected either
        // way, but BeatPicker's downbeat pick can be many bars for a
        // LORE-sourced stem that's never actually baked/rewritten, which
        // otherwise left a permanent silence gap before the clip's audio
        // ever started. Wrapping is exact for a tiling/repeating stem, since
        // shifting every tile by a whole multiple of its own loop length
        // doesn't change the audible pattern at all.
        const double rawOffsetBars = opts.offsetSteps / opts.snapDiv;
        double offsetBars = std::fmod(rawOffsetBars, stem.barLength);
        if (offsetBars < 0.0)
            offsetBars += stem.barLength;
        const double secPerBarNative = stem.durationSec / stem.barLength;
        const double bound = opts.playedBars >= 0.0 ? opts.playedBars : rifff.barLength;

        std::vector<PlaybackSegment> segments;
        for (double barOffset = 0.0; barOffset < bound; barOffset += stem.barLength)
        {
            const double segmentBarLength = std::min(stem.barLength, bound - barOffset);
            const double startBarInTimeline = start + offsetBars + barOffset;
            const double endBarInTimeline = startBarInTimeline + segmentBarLength;
            if (endBarInTimeline <= opts.projectPos)
                continue;
            segments.push_back(PlaybackSegment {
                startBarInTimeline,
                segmentBarLength,
                0.0,
                segmentBarLength * secPerBarNative
            });
        }
        return segments;
    }
}

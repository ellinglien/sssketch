#include "SchedulePlayback.h"
#include <algorithm>

namespace ssstitch
{
    std::vector<PlaybackSegment> computeStemSchedule(
        const RifffInfo& rifff,
        const StemInfo& stem,
        const ScheduleOptions& opts)
    {
        const double start = opts.startBarOverride >= 0.0 ? opts.startBarOverride : rifff.startBar;
        const double offsetBars = opts.offsetSteps / opts.snapDiv;
        const double secPerBarNative = stem.durationSec / (double) stem.barLength;

        std::vector<PlaybackSegment> segments;
        for (double barOffset = 0.0; barOffset < (double) rifff.barLength; barOffset += (double) stem.barLength)
        {
            const double segmentBarLength = std::min((double) stem.barLength, (double) rifff.barLength - barOffset);
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

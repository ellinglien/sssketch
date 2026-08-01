#pragma once
#include <vector>

namespace sssketch
{
    /** The fields computeStemSchedule needs from a Rifff — see src/shared/schedulePlayback.ts. */
    struct RifffInfo
    {
        double startBar = 0.0;
        int barLength = 0;
    };

    /** The fields computeStemSchedule needs from a Stem. */
    struct StemInfo
    {
        double durationSec = 0.0;
        int barLength = 0;
    };

    struct ScheduleOptions
    {
        double offsetSteps = 0.0;
        double snapDiv = 16.0;
        double projectPos = 0.0;
        double projectBpm = 0.0;
        /** -1.0 means "no override — use rifff.startBar", matching TS's
         * `startBarOverride?: number` optional field. */
        double startBarOverride = -1.0;
        /** Overrides rifff.barLength as this stem's own tiling bound. -1.0 means
         * "no override — use rifff.barLength", matching startBarOverride's own
         * sentinel convention above. */
        double playedBars = -1.0;
    };

    struct PlaybackSegment
    {
        double startBarInTimeline = 0.0;
        double barLength = 0.0;
        double bufferOffsetSec = 0.0;
        double durationSec = 0.0;
    };

    /** Direct C++ port of src/shared/schedulePlayback.ts's computeStemSchedule.
     * Keep these in sync by hand — see that file's own comments for the tiling/
     * clipping rationale, which applies identically here. */
    std::vector<PlaybackSegment> computeStemSchedule(
        const RifffInfo& rifff,
        const StemInfo& stem,
        const ScheduleOptions& opts);
}

#include "SchedulePlayback.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    class SchedulePlaybackTests : public juce::UnitTest
    {
    public:
        SchedulePlaybackTests() : juce::UnitTest("SchedulePlayback") {}

        void runTest() override
        {
            const RifffInfo rifff { 4.0, 8 };
            const StemInfo stemA { 12.8, 8 };
            const StemInfo stemB { 3.2, 2 };

            beginTest("schedules one segment for a stem whose loop matches the rifff length");
            {
                auto segments = computeStemSchedule(rifff, stemA, { 0.0, 16.0, 0.0, 150.0, -1.0 });
                expectEquals((int) segments.size(), 1);
                expectEquals(segments[0].startBarInTimeline, 4.0);
                expectWithinAbsoluteError(segments[0].durationSec, 12.8, 1.0e-5);
                expectEquals(segments[0].bufferOffsetSec, 0.0);
            }

            beginTest("schedules one segment per repetition for a shorter loop");
            {
                auto segments = computeStemSchedule(rifff, stemB, { 0.0, 16.0, 0.0, 150.0, -1.0 });
                expectEquals((int) segments.size(), 4); // 8-bar rifff / 2-bar stem
                expectEquals(segments[0].startBarInTimeline, 4.0);
                expectEquals(segments[1].startBarInTimeline, 6.0);
                expectEquals(segments[3].startBarInTimeline, 10.0);
            }

            beginTest("uses startBarOverride instead of the rifff's own startBar when given");
            {
                auto segments = computeStemSchedule(rifff, stemA, { 0.0, 16.0, 0.0, 150.0, 20.0 });
                expectEquals(segments[0].startBarInTimeline, 20.0);
            }

            beginTest("shifts segments by the grid-step offset, in bars");
            {
                auto segments = computeStemSchedule(rifff, stemA, { 4.0, 16.0, 0.0, 150.0, -1.0 }); // +4/16 = +0.25 bar
                expectEquals(segments[0].startBarInTimeline, 4.25);
            }

            beginTest("drops segments that have already fully played before the current position");
            {
                auto segments = computeStemSchedule(rifff, stemB, { 0.0, 16.0, 8.0, 150.0, -1.0 });
                expectEquals((int) segments.size(), 2);
                expectEquals(segments[0].startBarInTimeline, 8.0);
                expectEquals(segments[1].startBarInTimeline, 10.0);
                for (auto& s : segments)
                    expect(s.startBarInTimeline + s.barLength > 8.0);
            }

            beginTest("clips the final repetition when the stem length does not evenly divide the rifff length");
            {
                const StemInfo threeBarStem { 4.8, 3 }; // 3 bars at 150bpm = 1.6s/bar
                auto segments = computeStemSchedule(rifff, threeBarStem, { 0.0, 16.0, 0.0, 150.0, -1.0 });
                expectEquals((int) segments.size(), 3);
                expectEquals(segments[0].startBarInTimeline, 4.0);
                expectEquals(segments[0].barLength, 3.0);
                expectEquals(segments[1].startBarInTimeline, 7.0);
                expectEquals(segments[1].barLength, 3.0);
                expectEquals(segments[2].startBarInTimeline, 10.0);
                expectEquals(segments[2].barLength, 2.0);
                const double rifffEnd = rifff.startBar + (double) rifff.barLength;
                for (auto& s : segments)
                    expect(s.startBarInTimeline + s.barLength <= rifffEnd + 1.0e-9);
                expectWithinAbsoluteError(segments[2].durationSec, (2.0 / 3.0) * 4.8, 1.0e-5);
            }
        }
    };

    static SchedulePlaybackTests scheduleTests;
}

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

            beginTest("wraps an offset larger than the stem's own loop length, rather than shifting the clip's start by that much real time");
            {
                // Real bug this fixed: BeatPicker's downbeat pick can land many
                // bars into a stem's own loop — for a LORE-sourced stem, which
                // is never baked/rewritten, that large offset stuck around
                // permanently and showed up as a real silence gap before the
                // clip ever played. stemA's barLength is 8; 160/16 = 10 bars of
                // raw offset wraps to 10 % 8 = 2.
                auto segments = computeStemSchedule(rifff, stemA, { 160.0, 16.0, 0.0, 150.0, -1.0 });
                expectEquals(segments[0].startBarInTimeline, 6.0); // 4 (rifff start) + (10 % 8)
            }

            beginTest("wraps a negative offset into the positive [0, barLength) range, not left negative");
            {
                auto segments = computeStemSchedule(rifff, stemA, { -16.0, 16.0, 0.0, 150.0, -1.0 }); // -16/16 = -1 bar
                // -1 wrapped into [0, 8) is 7, landing at 4 + 7 = 11, not 4 - 1 = 3.
                expectEquals(segments[0].startBarInTimeline, 11.0);
            }

            beginTest("is a no-op for an offset that is an exact multiple of the loop length");
            {
                auto segments = computeStemSchedule(rifff, stemA, { 128.0, 16.0, 0.0, 150.0, -1.0 }); // 128/16 = 8 bars, exactly one full loop
                expectEquals(segments[0].startBarInTimeline, 4.0); // wraps to exactly 0
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

            beginTest("tiles the stem twice when playedBars exceeds rifff.barLength by one full stem length");
            {
                auto segments = computeStemSchedule(rifff, stemB, { 0.0, 16.0, 0.0, 150.0, -1.0, (double) stemB.barLength * 2.0 });
                expectEquals((int) segments.size(), 2);
                expectEquals(segments[0].bufferOffsetSec, 0.0);
                expectEquals(segments[1].bufferOffsetSec, 0.0); // second tile restarts from the stem's own beginning
                expectEquals(segments[1].startBarInTimeline, segments[0].startBarInTimeline + (double) stemB.barLength);
            }

            beginTest("truncates to one shorter segment when playedBars is less than the stem barLength");
            {
                auto segments = computeStemSchedule(rifff, stemA, { 0.0, 16.0, 0.0, 150.0, -1.0, (double) stemA.barLength / 2.0 });
                expectEquals((int) segments.size(), 1);
                expectEquals(segments[0].barLength, (double) stemA.barLength / 2.0);
            }

            beginTest("defaults to rifff.barLength when playedBars is omitted (unchanged existing behavior)");
            {
                auto withOverride = computeStemSchedule(rifff, stemA, { 0.0, 16.0, 0.0, 150.0, -1.0, (double) rifff.barLength });
                auto withoutOverride = computeStemSchedule(rifff, stemA, { 0.0, 16.0, 0.0, 150.0, -1.0 });
                expectEquals((int) withOverride.size(), (int) withoutOverride.size());
                for (size_t i = 0; i < withOverride.size(); ++i)
                {
                    expectEquals(withOverride[i].startBarInTimeline, withoutOverride[i].startBarInTimeline);
                    expectEquals(withOverride[i].barLength, withoutOverride[i].barLength);
                    expectEquals(withOverride[i].bufferOffsetSec, withoutOverride[i].bufferOffsetSec);
                    expectEquals(withOverride[i].durationSec, withoutOverride[i].durationSec);
                }
            }

            beginTest("clips the final repetition against a playedBars bound, same as it does against rifff.barLength");
            {
                // Mirrors the "clips the final repetition when the stem length does not
                // evenly divide the rifff length" test above, but with the bound coming
                // from playedBars instead of rifff.barLength — the more interesting case
                // than the exact-multiple/exact-half cases the other playedBars tests
                // cover, since it proves the truncation logic itself was actually
                // repointed at `bound`, not just the loop's outer stopping condition.
                auto segments = computeStemSchedule(rifff, stemB, { 0.0, 16.0, 0.0, 150.0, -1.0, 5.0 }); // 2-bar stem tiling across a 5-bar bound: [0,2) [2,4) [4,5)
                expectEquals((int) segments.size(), 3);
                expectEquals(segments[0].startBarInTimeline, 4.0);
                expectEquals(segments[0].barLength, 2.0);
                expectEquals(segments[1].startBarInTimeline, 6.0);
                expectEquals(segments[1].barLength, 2.0);
                expectEquals(segments[2].startBarInTimeline, 8.0);
                expectEquals(segments[2].barLength, 1.0);
            }
        }
    };

    static SchedulePlaybackTests scheduleTests;
}

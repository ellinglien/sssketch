// native-engine/Source/CycleTableTests.cpp
#include "CycleTable.h"
#include <juce_core/juce_core.h>
#include <limits>

namespace sssketch
{
    class CycleTableTests : public juce::UnitTest
    {
    public:
        CycleTableTests() : juce::UnitTest("CycleTable") {}

        void runTest() override
        {
            const auto row = [](const char* rowId, const char* cycleId, double bars, double phase = 0.0) {
                CycleRow r;
                r.rowKey = cycleKeyOf(rowId);
                r.idKey = cycleKeyOf(cycleId);
                r.bars = bars;
                r.phaseBars = phase;
                return r;
            };

            beginTest("an empty id is no key; any other id is a key, never 0");
            {
                expect(cycleKeyOf("") == 0);
                expect(cycleKeyOf("slot-3") != 0);
                expect(cycleKeyOf("slot-3") == cycleKeyOf(juce::String("slot-3")));
                expect(cycleKeyOf("slot-3") != cycleKeyOf("slot-4"));
            }

            beginTest("a staged table waits for the loop top, then is live");
            {
                CycleTable t;
                t.stage({ row("perc", "perc~1", 1.75) }, false);
                expect(! t.apply(false));
                expect(t.find(cycleKeyOf("perc")) == nullptr);
                expect(t.apply(true));
                auto* live = t.find(cycleKeyOf("perc"));
                expect(live != nullptr);
                expectWithinAbsoluteError(live->row.bars, 1.75, 1e-12);
                expect(t.applyCount() == 1);
                expect(! t.apply(true)); // nothing waiting any more
            }

            beginTest("a `now` stage applies at the next block, loop top or not");
            {
                CycleTable t;
                t.stage({ row("perc", "perc~1", 1.75) }, false);
                expect(t.apply(true));
                t.stage({}, true);
                expect(t.apply(false));
                expect(t.liveCount() == 0);
            }

            beginTest("rows with no key, or no positive finite length, are dropped; at most eight");
            {
                CycleTable t;
                std::vector<CycleRow> rows { row("", "x", 1.0), row("a", "a~1", 0.0), row("b", "b~1", -1.0),
                                             row("c", "c~1", std::numeric_limits<double>::quiet_NaN()) };
                for (int i = 0; i < 12; ++i)
                    rows.push_back(row(juce::String("r" + juce::String(i)).toRawUTF8(), "id", 1.0));
                t.stage(rows, true);
                expect(t.apply(false));
                expect(t.liveCount() == kMaxCycleRows);
                expect(t.find(cycleKeyOf("a")) == nullptr);
            }

            beginTest("the origin is the base of the lap first rendered, and survives a re-stage of the same cycle");
            {
                CycleTable t;
                t.stage({ row("perc", "perc~1", 1.75) }, true);
                t.apply(false);
                auto* live = t.find(cycleKeyOf("perc"));
                expectWithinAbsoluteError(CycleTable::originFor(*live, { 8.0, 3 }), 8.0, 1e-12);
                expectWithinAbsoluteError(CycleTable::originFor(*live, { 12.0, 3 }), 8.0, 1e-12);

                // the same row and cycle id staged again (every lap does this): the origin stays
                t.stage({ row("perc", "perc~1", 1.75) }, false);
                t.apply(true);
                live = t.find(cycleKeyOf("perc"));
                expectWithinAbsoluteError(CycleTable::originFor(*live, { 16.0, 3 }), 8.0, 1e-12);

                // a new cycle id is a new origin: the top of the lap it is first rendered in
                t.stage({ row("perc", "perc~2", 1.5) }, false);
                t.apply(true);
                live = t.find(cycleKeyOf("perc"));
                expectWithinAbsoluteError(CycleTable::originFor(*live, { 20.0, 3 }), 20.0, 1e-12);
            }

            beginTest("a new epoch (a seek, a play) restarts the origin");
            {
                CycleTable t;
                t.stage({ row("perc", "perc~1", 1.75) }, true);
                t.apply(false);
                auto* live = t.find(cycleKeyOf("perc"));
                CycleTable::originFor(*live, { 40.0, 1 });
                expectWithinAbsoluteError(CycleTable::originFor(*live, { 0.0, 2 }), 0.0, 1e-12);
            }

            beginTest("an apply that cannot take the lock retries at the next block");
            {
                CycleTable t;
                t.stage({ row("perc", "perc~1", 1.75) }, false);
                // the message thread is mid-stage at the loop top
                {
                    juce::SpinLock::ScopedLockType hold(t.stagedLockForTest());
                    expect(! t.apply(true));
                }
                expect(t.apply(false)); // the retry, a block later
            }

            // A cycle replaced or removed at the top was mid-tile at full gain: it leaves a tail,
            // its continuation for kCycleSeamFadeSec, so the change crossfades instead of
            // stopping dead (PlaybackEngine::renderBlock renders it).
            beginTest("a replaced cycle leaves a tail from the next block, for 10 ms, for the stem that played it");
            {
                CycleTable t;
                const auto perc = cycleKeyOf("perc");
                t.stage({ row("perc", "perc~1", 1.75, 0.25) }, true);
                t.apply(false);
                auto* live = t.find(perc);
                CycleTable::originFor(*live, { 0.0, 1 });
                live->stemHash = 77;
                t.stage({ row("perc", "perc~2", 1.5) }, false);
                expect(t.apply(true));
                expect(t.tailCount() == 1);
                // 60 bpm: a bar is 4 s. The first block of lap 1 starts the tail.
                t.beginBlock({ 4.0, 1 }, 0.0, 4.0);
                const auto* tail = t.findTail(perc, 77);
                expect(tail != nullptr);
                expect(t.findTail(perc, 78) == nullptr); // another stem in the row (a swap) has none
                if (tail != nullptr)
                {
                    expectWithinAbsoluteError(tail->row.bars, 1.75, 1e-12);
                    expectWithinAbsoluteError(tail->row.phaseBars, 0.25, 1e-12);
                    expectWithinAbsoluteError(tail->originBars, 0.0, 1e-12);
                    expectWithinAbsoluteError(tail->startBars, 4.0, 1e-12);
                }
                t.beginBlock({ 4.0, 1 }, 0.009 / 4.0, 4.0);
                expect(t.tailCount() == 1);
                t.beginBlock({ 4.0, 1 }, 0.0101 / 4.0, 4.0);
                expect(t.tailCount() == 0);
                expect(t.findTail(perc, 77) == nullptr);
            }

            beginTest("a row removed (unfolded) leaves a tail; the same cycle re-staged, or one never heard, does not");
            {
                CycleTable t;
                t.stage({ row("perc", "perc~1", 1.75), row("bass", "bass~1", 1.25) }, true);
                t.apply(false);
                CycleTable::originFor(*t.find(cycleKeyOf("perc")), { 0.0, 1 }); // bass never rendered
                t.stage({ row("perc", "perc~1", 1.75), row("bass", "bass~2", 1.5) }, false);
                t.apply(true);
                expect(t.tailCount() == 0);
                t.stage({}, false);
                t.apply(true);
                expect(t.tailCount() == 1);
                t.beginBlock({ 4.0, 1 }, 0.0, 4.0);
                expect(t.findTail(cycleKeyOf("perc"), 0) != nullptr);
            }

            // A row that folds in was playing straight, possibly mid-tile at full gain at the top:
            // it leaves a straight tail, the straight stem's continuation for kCycleSeamFadeSec,
            // carrying the lap length so the continuation is the outgoing lap's.
            beginTest("a row that folds in from straight leaves a straight tail, for the stem heard straight just now");
            {
                CycleTable t;
                const auto perc = cycleKeyOf("perc");
                t.beginBlock({ 0.0, 1 }, 3.9, 4.0);
                t.noteStraight(perc, 77, 1);
                t.noteStraight(cycleKeyOf("bass"), 55, 1);
                t.stage({ row("perc", "perc~1", 1.75) }, false);
                expect(t.apply(true, 4.0));
                expect(t.tailCount() == 1); // bass did not fold: no tail
                t.beginBlock({ 4.0, 1 }, 0.0, 4.0);
                const auto* tail = t.findTail(perc, 77);
                expect(tail != nullptr);
                expect(t.findTail(perc, 78) == nullptr); // another stem in the row has none
                if (tail != nullptr)
                {
                    expect(tail->kind == CycleTable::TailKind::straight);
                    expectWithinAbsoluteError(tail->continueOffsetBars, 4.0, 1e-12);
                    expectWithinAbsoluteError(tail->startBars, 4.0, 1e-12);
                }
                t.beginBlock({ 4.0, 1 }, 0.0101 / 4.0, 4.0);
                expect(t.tailCount() == 0);

                // a mid-lap apply (a `now` stage, a retry) continues the straight stem where it is
                CycleTable m;
                m.beginBlock({ 0.0, 1 }, 1.0, 4.0);
                m.noteStraight(perc, 77, 1);
                m.stage({ row("perc", "perc~1", 1.75) }, true);
                expect(m.apply(false));
                m.beginBlock({ 0.0, 1 }, 1.01, 4.0);
                const auto* mid = m.findTail(perc, 77);
                expect(mid != nullptr && mid->continueOffsetBars == 0.0);

                // a row already folded is not "from straight"; nor is one not heard straight in
                // the last block (its stem was not playing at the top)
                CycleTable c;
                c.stage({ row("perc", "perc~1", 1.75) }, true);
                c.apply(false);
                c.beginBlock({ 0.0, 1 }, 1.0, 4.0);
                c.noteStraight(perc, 77, 1); // even if something stamped it
                c.stage({ row("perc", "perc~1", 1.75) }, false);
                c.apply(true, 4.0);
                expect(c.tailCount() == 0);
                CycleTable stale;
                stale.beginBlock({ 0.0, 1 }, 1.0, 4.0);
                stale.noteStraight(perc, 77, 1);
                stale.beginBlock({ 0.0, 1 }, 2.0, 4.0);
                stale.beginBlock({ 0.0, 1 }, 3.0, 4.0);
                stale.stage({ row("perc", "perc~1", 1.75) }, false);
                stale.apply(true, 4.0);
                expect(stale.tailCount() == 0);
            }

            beginTest("straight stamps are fixed capacity: the least recently heard row gives way");
            {
                CycleTable t;
                t.beginBlock({ 0.0, 1 }, 0.0, 4.0);
                for (int i = 0; i < kMaxCycleRows; ++i)
                    t.noteStraight(cycleKeyOf("row" + juce::String(i)), (uint64_t) i + 1, 1);
                t.beginBlock({ 0.0, 1 }, 0.1, 4.0);
                for (int i = 1; i < kMaxCycleRows; ++i) // row0 is not heard this block
                    t.noteStraight(cycleKeyOf("row" + juce::String(i)), (uint64_t) i + 1, 1);
                t.noteStraight(cycleKeyOf("new"), 99, 1); // takes row0's slot
                t.stage({ row("new", "new~1", 1.0), row("row1", "row1~1", 1.0) }, false);
                t.apply(true, 4.0);
                expect(t.tailCount() == 2);
                t.beginBlock({ 4.0, 1 }, 0.0, 4.0);
                expect(t.findTail(cycleKeyOf("new"), 99) != nullptr);
                expect(t.findTail(cycleKeyOf("row1"), 2) != nullptr);
            }

            beginTest("a tail from another epoch (a seek, a play) is dropped, not played");
            {
                CycleTable t;
                t.stage({ row("perc", "perc~1", 1.75) }, true);
                t.apply(false);
                CycleTable::originFor(*t.find(cycleKeyOf("perc")), { 0.0, 1 });
                t.stage({}, true);
                t.apply(false);
                expect(t.tailCount() == 1);
                t.beginBlock({ 0.0, 2 }, 1.0, 4.0);
                expect(t.tailCount() == 0);
            }
        }
    };

    static CycleTableTests cycleTableTests;
}

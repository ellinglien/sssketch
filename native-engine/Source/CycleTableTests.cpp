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
        }
    };

    static CycleTableTests cycleTableTests;
}

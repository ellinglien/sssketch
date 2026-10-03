// native-engine/Source/CycleTable.cpp
#include "CycleTable.h"
#include <cmath>

namespace sssketch
{
    uint64_t cycleKeyOf(const juce::String& text)
    {
        if (text.isEmpty())
            return 0;
        const auto h = (uint64_t) text.hashCode64();
        return h == 0 ? 1 : h;
    }

    void CycleTable::stage(const std::vector<CycleRow>& rows, bool now)
    {
        const juce::SpinLock::ScopedLockType lock(stagedLock);
        numStaged = 0;
        for (const auto& r : rows)
        {
            if (numStaged >= kMaxCycleRows)
                break;
            if (r.rowKey == 0 || !std::isfinite(r.bars) || !(r.bars > 0.0) || !std::isfinite(r.phaseBars))
                continue;
            staged[(size_t) numStaged++] = r;
        }
        pending.store(now ? 2 : 1, std::memory_order_release);
    }

    bool CycleTable::apply(bool atWrap)
    {
        const int want = pending.load(std::memory_order_acquire);
        if (want == 0)
        {
            retryDue = false;
            return false;
        }
        if (want == 1 && ! atWrap && ! retryDue)
            return false;
        const juce::SpinLock::ScopedTryLockType lock(stagedLock);
        if (! lock.isLocked())
        {
            retryDue = true;
            return false;
        }
        std::array<Live, kMaxCycleRows> next {};
        int n = 0;
        for (int i = 0; i < numStaged; ++i)
        {
            Live l;
            l.row = staged[(size_t) i];
            for (int j = 0; j < numLive; ++j)
            {
                const auto& was = live[(size_t) j];
                if (was.row.rowKey == l.row.rowKey && was.row.idKey == l.row.idKey)
                {
                    l.originBars = was.originBars;
                    l.originEpoch = was.originEpoch;
                    l.hasOrigin = was.hasOrigin;
                    break;
                }
            }
            next[(size_t) n++] = l;
        }
        live = next;
        numLive = n;
        pending.store(0, std::memory_order_release);
        retryDue = false;
        applies.fetch_add(1, std::memory_order_acq_rel);
        return true;
    }

    CycleTable::Live* CycleTable::find(uint64_t rowKey)
    {
        if (rowKey == 0)
            return nullptr;
        for (int i = 0; i < numLive; ++i)
            if (live[(size_t) i].row.rowKey == rowKey)
                return &live[(size_t) i];
        return nullptr;
    }

    double CycleTable::originFor(Live& l, const LapClock& clock)
    {
        if (! l.hasOrigin || l.originEpoch != clock.epoch)
        {
            l.originBars = clock.baseBars;
            l.originEpoch = clock.epoch;
            l.hasOrigin = true;
        }
        return l.originBars;
    }
}

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

    bool CycleTable::apply(bool atWrap, double lapBars)
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
        // A live cycle that was heard and is not carried on unchanged (same id, length and
        // phase) leaves a tail. A row's newer tail replaces its older one; with at most
        // kMaxCycleRows rows there is always room.
        for (int j = 0; j < numLive; ++j)
        {
            const auto& was = live[(size_t) j];
            if (! was.hasOrigin)
                continue;
            bool carried = false;
            for (int i = 0; i < n && ! carried; ++i)
            {
                const auto& now = next[(size_t) i].row;
                carried = now.rowKey == was.row.rowKey && now.idKey == was.row.idKey
                          && now.bars == was.row.bars && now.phaseBars == was.row.phaseBars;
            }
            if (carried)
                continue;
            int slot = 0;
            while (slot < numTails && tails[(size_t) slot].row.rowKey != was.row.rowKey)
                ++slot;
            if (slot == numTails)
            {
                if (numTails >= kMaxCycleRows)
                    continue;
                ++numTails;
            }
            Tail t;
            t.row = was.row;
            t.originBars = was.originBars;
            t.epoch = was.originEpoch;
            t.stemHash = was.stemHash;
            tails[(size_t) slot] = t;
        }
        // A row that folds in from straight leaves a straight tail, if its stem played it straight
        // just now: in this block (an apply between two renders) or the last (one at a block top).
        for (int i = 0; i < n; ++i)
        {
            const auto rowKey = next[(size_t) i].row.rowKey;
            bool wasLive = false;
            for (int j = 0; j < numLive && ! wasLive; ++j)
                wasLive = live[(size_t) j].row.rowKey == rowKey;
            if (wasLive)
                continue;
            const StraightStamp* heard = nullptr;
            for (int k = 0; k < numStraights && heard == nullptr; ++k)
            {
                const auto& st = straights[(size_t) k];
                if (st.rowKey == rowKey && blockCount - st.block <= 1)
                    heard = &st;
            }
            if (heard == nullptr)
                continue;
            int slot = 0;
            while (slot < numTails && tails[(size_t) slot].row.rowKey != rowKey)
                ++slot;
            if (slot == numTails)
            {
                if (numTails >= kMaxCycleRows)
                    continue;
                ++numTails;
            }
            Tail t;
            t.row = next[(size_t) i].row;
            t.epoch = heard->epoch;
            t.stemHash = heard->stemHash;
            t.kind = TailKind::straight;
            t.continueOffsetBars = atWrap && std::isfinite(lapBars) && lapBars > 0.0 ? lapBars : 0.0;
            tails[(size_t) slot] = t;
        }
        for (int i = 0; i < n; ++i)
            for (int j = 0; j < numLive; ++j)
                if (live[(size_t) j].row.rowKey == next[(size_t) i].row.rowKey)
                    next[(size_t) i].stemHash = live[(size_t) j].stemHash;
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

    void CycleTable::noteStraight(uint64_t rowKey, uint64_t stemHash, uint32_t epoch)
    {
        if (rowKey == 0)
            return;
        int slot = 0;
        while (slot < numStraights && straights[(size_t) slot].rowKey != rowKey)
            ++slot;
        if (slot == numStraights)
        {
            if (numStraights < kMaxCycleRows)
                ++numStraights;
            else
            {
                slot = 0;
                for (int k = 1; k < numStraights; ++k)
                    if (straights[(size_t) k].block < straights[(size_t) slot].block)
                        slot = k;
            }
        }
        straights[(size_t) slot] = { rowKey, stemHash, epoch, blockCount };
    }

    void CycleTable::beginBlock(const LapClock& clock, double positionBars, double secPerBar)
    {
        ++blockCount;
        const double nowBars = clock.baseBars + positionBars;
        int kept = 0;
        for (int i = 0; i < numTails; ++i)
        {
            auto t = tails[(size_t) i];
            if (t.epoch != clock.epoch)
                continue;
            if (! t.started)
            {
                t.startBars = nowBars;
                t.started = true;
            }
            const double elapsedSec = (nowBars - t.startBars) * secPerBar;
            if (! (elapsedSec >= 0.0 && elapsedSec < kCycleSeamFadeSec))
                continue;
            tails[(size_t) kept++] = t;
        }
        numTails = kept;
    }

    const CycleTable::Tail* CycleTable::findTail(uint64_t rowKey, uint64_t stemHash) const
    {
        if (rowKey == 0)
            return nullptr;
        for (int i = 0; i < numTails; ++i)
        {
            const auto& t = tails[(size_t) i];
            if (t.started && t.row.rowKey == rowKey && t.stemHash == stemHash)
                return &t;
        }
        return nullptr;
    }
}

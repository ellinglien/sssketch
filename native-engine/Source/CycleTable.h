// native-engine/Source/CycleTable.h
#pragma once
#include <juce_core/juce_core.h>
#include <array>
#include <atomic>
#include <cstdint>
#include <vector>

namespace sssketch
{
    /** The transport's lap clock: how many bars the completed laps since the last reposition
     * add up to, and which reposition that was. renderBlock's `positionBars` restarts at every
     * loop top; `baseBars + positionBars` does not, so a stem can keep a cycle running across the
     * top (radio fold mode, CycleTable below). Transport adds the lap's length at each wrap and
     * starts a new epoch (base 0) on every play, seek or snap. An export or a test that passes
     * nothing gets {0, 0}: one lap, epoch 0. */
    struct LapClock
    {
        double baseBars = 0.0;
        uint32_t epoch = 0;
    };

    /** The micro-fade at both ends of every cycle of a folded stem (radio fold mode, spec
     * 2026-10-02-radio-fold-mode-design.md section 1): a cropped loop's seam is a jump in the
     * audio, so each cycle fades in and out over this long. */
    constexpr double kCycleSeamFadeSec = 0.010;

    /** At most this many rows fold at once. Radio folds two; the rest is headroom. */
    constexpr int kMaxCycleRows = 8;

    /** A row or cycle id from the wire, as the audio thread compares it: a 64-bit hash, 0 for an
     * empty id (a stem with no `cycleRow`), and never 0 otherwise. */
    uint64_t cycleKeyOf(const juce::String& text);

    /** One folded row: which row (EngineStem::cycleRow), which cycle (the renderer's id: the
     * same id keeps its phase origin, a new one starts on the next top), its length and its
     * phase offset, both in bars. */
    struct CycleRow
    {
        uint64_t rowKey = 0;
        uint64_t idKey = 0;
        double bars = 0.0;
        double phaseBars = 0.0;
    };

    /** Radio fold mode's per-row cycle lengths, held apart from the project so a fold can change
     * EXACTLY on a loop top without a staged project swap: the renderer stages the next lap's
     * table a lap ahead (`stage-cycles`), and the audio thread takes it at the wrap, the way
     * Transport takes a staged loop length. A stem whose `cycleRow` names a row in the live table
     * loops only the first `bars` of its content, on the lap clock, from the cycle's origin (see
     * PlaybackEngine::renderBlock). A row not in the table plays exactly as before.
     *
     * Fixed capacity and no allocation: `stage` writes under a spin lock on the message thread,
     * and `apply` only TRIES that lock on the audio thread -- if the message thread holds it,
     * the apply is retried at the next block top (late by a block rather than a lap, as
     * Transport's staged-project retry). The live table and its origins belong to the audio
     * thread alone. */
    class CycleTable
    {
    public:
        struct Live
        {
            CycleRow row;
            double originBars = 0.0;
            uint32_t originEpoch = 0;
            bool hasOrigin = false;
        };

        /** MESSAGE THREAD. Replaces whatever is staged: applied at the next loop top, or at the
         * next block when `now` (radio stopping, the mode going off). Rows with no row key or no
         * positive, finite length are dropped, and only the first kMaxCycleRows are kept. */
        void stage(const std::vector<CycleRow>& rows, bool now);

        /** AUDIO THREAD, from a point with no renderBlock in flight: takes the staged table if
         * there is one and it is due -- at a loop top (`atWrap`), or anywhere for a `now` stage or
         * a retry. A row whose row key and cycle id were live before keeps its origin. Returns
         * whether it applied. */
        bool apply(bool atWrap);

        /** AUDIO THREAD. The live entry for a row, or null. */
        Live* find(uint64_t rowKey);

        /** AUDIO THREAD. The cycle's origin on the lap clock: the first time it is asked in an
         * epoch, the base of the lap being rendered -- the top of the lap it was applied on. */
        static double originFor(Live& live, const LapClock& clock);

        /** Any thread: how many times `apply` has applied. */
        unsigned long long applyCount() const { return applies.load(std::memory_order_acquire); }

        /** AUDIO THREAD (or a test with none running): how many rows are live. */
        int liveCount() const { return numLive; }

        /** For tests: the lock `stage` holds, so a test can hold it across an `apply`. */
        juce::SpinLock& stagedLockForTest() { return stagedLock; }

    private:
        juce::SpinLock stagedLock;
        std::array<CycleRow, kMaxCycleRows> staged {};
        int numStaged = 0;
        // 0: nothing waiting; 1: at the next loop top; 2: at the next block.
        std::atomic<int> pending { 0 };
        bool retryDue = false;
        std::array<Live, kMaxCycleRows> live {};
        int numLive = 0;
        std::atomic<unsigned long long> applies { 0 };
    };
}

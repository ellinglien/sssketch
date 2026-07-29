// native-engine/Source/PlaybackEngine.cpp
#include "PlaybackEngine.h"
#include "FadeGain.h"
#include <algorithm>
#include <cmath>

namespace ssstitch
{
    PlaybackEngine::PlaybackEngine(StemBufferCache& cache) : bufferCache(cache) {}

    void PlaybackEngine::setProject(const EngineProject& project)
    {
        currentProject = project;
        for (auto& rifff : currentProject.rifffs)
            for (auto& stem : rifff.stems)
                bufferCache.load(stem.resolvedPath); // failure is fine — renderBlock skips missing buffers
    }

    void PlaybackEngine::renderBlock(
        double positionBars,
        double sampleRate,
        int numSamples,
        float* outL,
        float* outR) const
    {
        const double spb = secPerBar();
        if (spb <= 0.0 || currentProject.rifffs.empty())
            return;

        const double blockStartSec = positionBars * spb;
        const double blockDurationSec = numSamples / sampleRate;

        const double blockEndSec = blockStartSec + blockDurationSec;

        for (const auto& rifff : currentProject.rifffs)
        {
            const FadeConfig fadeConfig { rifff.fadeInBars, rifff.fadeOutBars, spb };

            for (const auto& stem : rifff.stems)
            {
                if (stem.muted || stem.volume <= 0.0)
                    continue;
                auto* buffer = bufferCache.get(stem.resolvedPath);
                if (buffer == nullptr)
                    continue;
                if (stem.barLength <= 0)
                    continue;

                // Which tile(s) of this stem's repeating pattern overlap this
                // block's time window — bounded to just those, rather than
                // (as a previous version of this function did, via
                // computeStemSchedule with an unbounded search) walking every
                // tile of the stem across the *whole* rifff on every single
                // block. That was unbounded work — and a heap allocation —
                // scaling with rifff length, not block size, and on a
                // real-time audio callback (Transport.cpp) that's exactly
                // the kind of per-block cost that shows up as coreaudiod CPU
                // spikes on longer or tile-dense arrangements.
                //
                // isFirstSegment/isLastSegment are computed from each tile's
                // own fixed index (0, and totalTiles - 1) rather than
                // position within a filtered list — the same fix
                // computeStemSchedule's own -infinity/projectPos trick was
                // working around (a shrinking filtered list changing which
                // "index" counts as first) can't reappear here, since we
                // never build a list at all.
                const double start = stem.startBarOverride >= 0.0 ? stem.startBarOverride : rifff.startBar;
                const double offsetBars = stem.offsetSteps / currentProject.snapDiv;
                const double bound = stem.playedBars >= 0.0 ? stem.playedBars : (double) rifff.barLength;
                if (bound <= 0.0)
                    continue;
                const double secPerBarNative = stem.durationSec / (double) stem.barLength;

                const int totalTiles = (int) std::ceil(bound / (double) stem.barLength);
                const double tileDurationSec = (double) stem.barLength * spb;
                const double firstTileStartSec = (start + offsetBars) * spb;

                // One tile of slack behind the naive floor absorbs floating-
                // point drift at a tile boundary (positionBars accumulates by
                // repeated addition in Transport.cpp) — worst case the extra
                // tile checked here is immediately skipped by the per-tile
                // overlap test below, at negligible cost.
                int tileIdx = std::max(
                    0,
                    (int) std::floor((blockStartSec - firstTileStartSec) / tileDurationSec) - 1);

                for (; tileIdx < totalTiles; ++tileIdx)
                {
                    const double barOffset = (double) tileIdx * (double) stem.barLength;
                    const double segmentBarLength = std::min((double) stem.barLength, bound - barOffset);
                    const double segStartSec = (start + offsetBars + barOffset) * spb;
                    const double segEndSec = segStartSec + segmentBarLength * secPerBarNative;

                    // Tiles only get later from here on — nothing further in
                    // this loop can overlap the block once one starts after it.
                    if (segStartSec >= blockEndSec)
                        break;
                    // Reached via the one-tile slack margin above; this
                    // particular tile turned out to end before the block starts.
                    if (segEndSec <= blockStartSec)
                        continue;

                    const bool isFirstSegment = tileIdx == 0;
                    const bool isLastSegment = tileIdx == totalTiles - 1;

                    auto fadePoints = buildFadePoints(
                        segStartSec, segEndSec - segStartSec,
                        isFirstSegment, isLastSegment,
                        true, // renderBlock's fade points are anchored at each segment's
                              // own absolute start time (segStartSec), not at "now" the
                              // way AudioEngine.ts's Web Audio automation is (there,
                              // `when` gets clamped to the resume moment for a segment
                              // resumed mid-way, and isFreshStart=false suppresses the
                              // fade-in ramp so it doesn't restart from silence at that
                              // clamped time). evaluateGainAtTime here is a pure function
                              // of absolute time queried fresh every block — whichever
                              // block first renders a given segment's samples, the curve
                              // it evaluates against is identical, so there's no separate
                              // "resumed mid-way" case that needs a different curve: the
                              // gain at any sampleTimeSec is already correct regardless of
                              // when we started asking for it.
                        fadeConfig);

                    const double srcSampleRate = bufferCache.sampleRateFor(stem.resolvedPath);
                    for (int i2 = 0; i2 < numSamples; ++i2)
                    {
                        const double sampleTimeSec = blockStartSec + (double) i2 / sampleRate;
                        if (sampleTimeSec < segStartSec || sampleTimeSec >= segEndSec)
                            continue;
                        const double posInSegSec = sampleTimeSec - segStartSec;
                        // Kept as double until this final conversion so a source sample
                        // rate that doesn't evenly match the output rate (e.g. 22050Hz
                        // source under a 44100Hz device) still maps time to a source
                        // sample index correctly — this is nearest-sample lookup (no
                        // interpolation), which is exact when rates match and merely
                        // lower quality (not wrong-speed/wrong-pitch) when they don't.
                        //
                        // Rounded to the nearest sample, NOT truncated. An earlier version
                        // truncated (plain `(int)` cast) on the reasoning that the operand
                        // is always >= 0 so truncation == floor == "the sample at or before
                        // this time", which is mathematically fine in real-number terms.
                        // But native-engine/test/parity/render-parity.test.ts's parity
                        // test (Task 10) caught this failing in practice, even when
                        // srcSampleRate and sampleRate hold the exact same 44100.0 bit
                        // pattern: sampleTimeSec is built by dividing i2 by sampleRate and
                        // adding it to blockStartSec, then this line subtracts segStartSec
                        // and multiplies by srcSampleRate again — a divide-then-add/subtract-
                        // then-multiply round trip that is not guaranteed to exactly invert
                        // in binary floating point, regardless of whether the two rate
                        // values are the same double or different ones. That non-
                        // associativity occasionally lands the product a hair below the
                        // intended whole number (e.g. 14.999999999999998 instead of 15.0).
                        // Truncating that silently re-reads the previous sample instead of
                        // advancing, producing an audible repeated-sample glitch roughly
                        // once every few dozen samples even when the source and output
                        // rates match exactly. Rounding to nearest absorbs that sub-ULP
                        // drift without changing behaviour for genuinely mismatched rates
                        // (still nearest-sample, just correctly nearest instead of
                        // always-floor).
                        const int srcSample = (int) std::llround(posInSegSec * srcSampleRate);
                        if (srcSample < 0 || srcSample >= buffer->getNumSamples())
                            continue;

                        const double gain = evaluateGainAtTime(fadePoints, sampleTimeSec) * stem.volume;
                        const int numCh = buffer->getNumChannels();
                        const float l = buffer->getSample(0, srcSample);
                        const float r = numCh > 1 ? buffer->getSample(1, srcSample) : l;
                        outL[i2] += (float) (l * gain);
                        outR[i2] += (float) (r * gain);
                    }
                }
            }
        }
    }
}

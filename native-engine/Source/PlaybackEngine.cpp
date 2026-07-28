// native-engine/Source/PlaybackEngine.cpp
#include "PlaybackEngine.h"
#include "SchedulePlayback.h"
#include "FadeGain.h"
#include <algorithm>
#include <cmath>
#include <limits>

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

        for (const auto& rifff : currentProject.rifffs)
        {
            const RifffInfo rifffInfo { rifff.startBar, rifff.barLength };
            const FadeConfig fadeConfig { rifff.fadeInBars, rifff.fadeOutBars, spb };

            for (const auto& stem : rifff.stems)
            {
                if (stem.muted || stem.volume <= 0.0)
                    continue;
                auto* buffer = bufferCache.get(stem.resolvedPath);
                if (buffer == nullptr)
                    continue;

                const StemInfo stemInfo { stem.durationSec, stem.barLength };

                // projectPos is deliberately NOT positionBars here — pass a value that
                // never satisfies computeStemSchedule's "already fully in the past"
                // filter (endBarInTimeline <= projectPos), so it always returns every
                // tile of the stem's repeating pattern across the whole rifff, in
                // stable order.
                //
                // Why: AudioEngine.ts calls computeStemSchedule ONCE per play(), with
                // projectPos = the position at the moment play() was pressed. The
                // returned (filtered) array is then fixed for the life of that
                // playback session, so "index 0" stays pinned to whichever tile was
                // current at that moment — exactly one tile per session ever gets
                // isFirstSegment/fade-in treatment.
                //
                // renderBlock has no session — it calls computeStemSchedule fresh on
                // *every* block with an ever-advancing positionBars. If positionBars
                // were passed straight through as projectPos, then every time a tile
                // finishes and gets filtered out, the *next* tile becomes the new
                // "index 0" of that call's array and would be misidentified as
                // isFirstSegment — applying a bogus fade-in to every repeat of a
                // looping stem, not just the true first tile (fade-out is unaffected:
                // computeStemSchedule never drops from the tail, so the last array
                // entry is always the true final tile). Disabling the filter here
                // keeps isFirstSegment/isLastSegment anchored to each tile's real,
                // fixed position in the schedule regardless of which block asks.
                // Skipping tiles that don't overlap *this* block is instead done
                // below, directly from each segment's own absolute start/end time —
                // computeStemSchedule's per-call cost doesn't change either way, since
                // its loop always walks every bar-offset regardless of what it filters.
                //
                // TODO(Task 6): this does mean every block call heap-allocates a
                // segments vector covering *every* tile of the stem across the whole
                // rifff (e.g. a 1-bar tile in a 1000-bar rifff returns ~1000 entries,
                // every block) — fine for this task's offline/non-realtime-wired
                // mixer, but a real-time audio callback built on top of renderBlock
                // should not inherit a per-callback heap allocation of unbounded size.
                // Worth revisiting then (e.g. bound the search to tiles near
                // positionBars, or cache/reuse the vector across calls).
                const ScheduleOptions opts {
                    stem.offsetSteps, currentProject.snapDiv,
                    -std::numeric_limits<double>::infinity(),
                    currentProject.bpm, stem.startBarOverride
                };
                auto segments = computeStemSchedule(rifffInfo, stemInfo, opts);

                for (size_t i = 0; i < segments.size(); ++i)
                {
                    const auto& seg = segments[i];
                    const double segStartSec = seg.startBarInTimeline * spb;
                    const double segEndSec = segStartSec + seg.durationSec;
                    // Does this segment overlap the current block's time window at all?
                    if (segEndSec <= blockStartSec || segStartSec >= blockStartSec + blockDurationSec)
                        continue;

                    auto fadePoints = buildFadePoints(
                        segStartSec, seg.durationSec,
                        i == 0, i == segments.size() - 1,
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
                        // test (Task 10) caught this failing in practice: sampleTimeSec is
                        // built from `blockStartSec + i2 / sampleRate`, and srcSampleRate
                        // here is a *cached* double (StemBufferCache::sampleRateFor) that
                        // is not bit-identical to `sampleRate` even when both represent
                        // 44100.0, so `posInSegSec * srcSampleRate` does not exactly invert
                        // the earlier division by `sampleRate` — occasionally landing a
                        // hair below the intended whole number (e.g. 14.999999999999998
                        // instead of 15.0). Truncating that silently re-reads the previous
                        // sample instead of advancing, producing an audible repeated-sample
                        // glitch roughly once every few dozen samples even when the source
                        // and output rates match exactly. Rounding to nearest absorbs that
                        // sub-ULP drift without changing behaviour for genuinely
                        // mismatched rates (still nearest-sample, just correctly nearest
                        // instead of always-floor).
                        const int srcSample = (int) std::llround((seg.bufferOffsetSec + posInSegSec) * srcSampleRate);
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

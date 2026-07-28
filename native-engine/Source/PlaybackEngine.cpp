// native-engine/Source/PlaybackEngine.cpp
#include "PlaybackEngine.h"
#include "SchedulePlayback.h"
#include "FadeGain.h"
#include <algorithm>
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
                        // Kept as double until this final truncation so a source sample
                        // rate that doesn't evenly match the output rate (e.g. 22050Hz
                        // source under a 44100Hz device) still maps time to a source
                        // sample index correctly — this is nearest/floor sample lookup
                        // (no interpolation), which is exact when rates match and merely
                        // lower quality (not wrong-speed/wrong-pitch) when they don't.
                        const int srcSample = (int) ((seg.bufferOffsetSec + posInSegSec) * srcSampleRate);
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

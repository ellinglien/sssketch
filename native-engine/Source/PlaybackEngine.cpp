// native-engine/Source/PlaybackEngine.cpp
#include "PlaybackEngine.h"
#include "FadeGain.h"
#include "Metronome.h"
#include "MuteRegionGain.h"
#include <algorithm>
#include <cmath>

namespace sssketch
{
    namespace
    {
        // Shared by secPerBar() and renderBlock() so the bpm->secPerBar
        // formula only exists once -- renderBlock() still can't call
        // secPerBar() itself (that would be a second, independent atomic
        // load of `published`, risking a different snapshot than the one
        // already loaded at the top of the call -- see renderBlock's own
        // comment), so this free function is what both instead call against
        // whichever project.bpm they've each already loaded.
        double secPerBarFor(double bpm) { return bpm > 0.0 ? (60.0 / bpm) * 4.0 : 0.0; }
    }

    PlaybackEngine::PlaybackEngine(StemBufferCache& cache)
        : bufferCache(cache), published(std::make_shared<const ProjectSnapshot>())
    {
        // Published to a freshly-constructed, empty snapshot immediately --
        // renderBlock()/currentProjectForExport() must never see a null
        // pointer, including before setProject() is ever called (see the
        // "silence when no project is set" test, which relies on exactly
        // this: an empty project.rifffs, not a null snapshot). No
        // user-declared destructor needed any more -- published is a plain
        // std::shared_ptr now, so its own destructor (releasing whatever
        // snapshot is currently held, freeing it if this was the last
        // reference) already does exactly the right thing.
    }

    double PlaybackEngine::secPerBar() const
    {
        const auto snap = std::atomic_load_explicit(&published, std::memory_order_acquire);
        return secPerBarFor(snap->project.bpm);
    }

    void PlaybackEngine::setProject(const EngineProject& project)
    {
        auto next = std::make_shared<ProjectSnapshot>();
        next->project = project;
        for (auto& rifff : next->project.rifffs)
            for (auto& stem : rifff.stems)
                // stem.durationSec: see StemBufferCache::load's own doc
                // comment on why the loop-sewing blend needs this (not just
                // the raw decoded buffer length) to land on the same point
                // renderBlock's own tiling math actually wraps at, below.
                // Failure is fine either way — renderBlock skips missing
                // buffers.
                bufferCache.load(stem.resolvedPath, stem.durationSec);

        for (const auto& rifff : next->project.rifffs)
            next->channelGroups[rifff.channelId].push_back(&rifff);

        // Scratch space for the new channel set -- off the real-time thread
        // (see renderBlock's own comment on why this lives here, not
        // there). Inner per-numSamples buffers are left empty; renderBlock
        // sizes those lazily on first use.
        next->scratchChannelL.assign(next->channelGroups.size(), {});
        next->scratchChannelR.assign(next->channelGroups.size(), {});
        next->scratchChannelIds.reserve(next->channelGroups.size());
        for (const auto& [channelId, rifffPtrs] : next->channelGroups)
            next->scratchChannelIds.push_back(channelId);

        // Publishes the new snapshot and releases this function's own
        // reference to the old one in a single atomic operation. Whatever
        // OTHER references to the old snapshot still exist -- most notably,
        // whatever std::shared_ptr copy renderBlock() might currently be
        // holding as its own local `snap`, mid-call, on the real-time audio
        // thread -- keep it alive exactly as long as they need it; it's
        // only actually freed once every last reference is released,
        // wherever and whenever that happens to be. This replaced an
        // earlier raw atomic<T*> + detached-thread-delete scheme (see git
        // history) that instead relied on a scheduling heuristic ("the
        // audio thread has certainly moved on by the time the detached
        // thread runs") -- a concurrent setProject()/renderBlock() stress
        // test (PlaybackEngineTests.cpp) proved that heuristic false under
        // sustained load, reliably reproducing a real use-after-free.
        std::atomic_store_explicit(&published, std::shared_ptr<const ProjectSnapshot>(std::move(next)), std::memory_order_release);
    }

    void PlaybackEngine::renderBlock(
        double positionBars,
        double sampleRate,
        int numSamples,
        float* outL,
        float* outR,
        ChannelChainRegistry& channelChains) const
    {
        // Loaded ONCE, here, as this thread's own reference-counted copy,
        // and read through for the rest of this call -- not via secPerBar()
        // (which does its own independent load) or any other second load,
        // which could observe a DIFFERENT snapshot than this one if a
        // setProject() call landed in between the two loads. Holding this
        // shared_ptr for the duration of the call is also what makes this
        // safe against setProject() concurrently replacing (and, once
        // nothing else references it, freeing) `published` on another
        // thread arbitrarily many times while this call is still running --
        // see published's own doc comment in PlaybackEngine.h.
        const auto snap = std::atomic_load_explicit(&published, std::memory_order_acquire);
        if (snap == nullptr)
            return;

        // Pushed once per renderBlock call, covering every channel chain at
        // once -- both live playback (Transport.cpp's several
        // engine.renderBlock() call sites inside renderLoopAware, e.g. a
        // loop-wrap split render) and offline export (RenderExport.cpp's
        // own call) already funnel through this one function, so this is
        // the single place a hosted channel-chain plugin's playhead
        // position needs to be kept in sync -- see
        // ChannelChainRegistry::setPosition's own doc comment for why it's
        // safe to call this from a real-time thread every block.
        channelChains.setPosition(positionBars);

        // Single, genuinely lock-free check -- see hasAnyOverride()'s own
        // doc comment -- letting the two call sites below skip
        // liveParamOverrides.fadeInFor()/fadeOutFor()/volumeFor() (each of
        // which carries a small but real mutex-based cost, see
        // LiveParamOverrides.h's own doc comment) entirely during ordinary
        // playback, when nothing is actively being dragged. Read ONCE per
        // block, not per-rifff or per-stem, since it can't change mid-block
        // (this is the only thread that ever calls renderBlock() at a
        // time, and no other code on this same thread could race a write
        // in between).
        const bool hasLiveOverrides = liveParamOverrides.hasAnyOverride();

        const double spb = secPerBarFor(snap->project.bpm);
        if (spb <= 0.0)
            return;

        const double blockStartSec = positionBars * spb;
        const double blockDurationSec = numSamples / sampleRate;

        const double blockEndSec = blockStartSec + blockDurationSec;

        // Rendered before the empty-project early-return below (and outside
        // the per-rifff loop entirely) — the click should tick on a totally
        // empty arrangement too, same as a real metronome doesn't need
        // anything else playing to be useful. metronomeSampleAt is a pure
        // function of absolute time (see its own doc comment), so it's
        // already correctly phase-locked through any seek/scrub with no
        // extra state needed here.
        if (metronomeEnabled)
        {
            const double secPerBeat = spb / (double) kMetronomeBeatsPerBar;
            for (int i2 = 0; i2 < numSamples; ++i2)
            {
                const double sampleTimeSec = blockStartSec + (double) i2 / sampleRate;
                const float click = metronomeSampleAt(sampleTimeSec, secPerBeat);
                outL[i2] += click;
                outR[i2] += click;
            }
        }

        if (snap->project.rifffs.empty())
            return;

        // Per-channel accumulation: each channel's stems sum into their own
        // scratch buffer first (rebuilt fresh every call, not persisted
        // across blocks, since numSamples/the exact sub-range varies per
        // call -- Transport.cpp's own loop-boundary splitting can call
        // renderBlock more than once per device callback, each into a
        // different numSamples-sized sub-range of the same outer buffer),
        // runs through that channel's own plugin chain, then joins the
        // running master-mix total below -- see
        // docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md.
        // A channel with no chain published is a pure passthrough, so this
        // is byte-identical to the pre-this-feature direct-sum behaviour
        // whenever no channel has any plugin loaded (the common case).
        // Reused across calls (see the scratchChannelL/R/Ids member doc
        // comment) -- only reallocates when numSamples itself changes from
        // the previous call, which is rare; the common case is a fixed-size
        // resize() no-op followed by a plain zero-fill, no heap traffic at
        // all on this real-time callback.
        auto& channelL = snap->scratchChannelL;
        auto& channelR = snap->scratchChannelR;
        auto& channelIds = snap->scratchChannelIds;
        for (size_t i = 0; i < channelL.size(); ++i)
        {
            if (channelL[i].size() != (size_t) numSamples)
            {
                channelL[i].resize((size_t) numSamples);
                channelR[i].resize((size_t) numSamples);
            }
            std::fill(channelL[i].begin(), channelL[i].end(), 0.0f);
            std::fill(channelR[i].begin(), channelR[i].end(), 0.0f);
        }

        size_t channelIdx = 0;
        for (const auto& [channelId, rifffPtrs] : snap->channelGroups)
        {
            float* chOutL = channelL[channelIdx].data();
            float* chOutR = channelR[channelIdx].data();
            ++channelIdx;

            for (const auto* rifffPtr : rifffPtrs)
            {
            const auto& rifff = *rifffPtr;
            // Prefers a live drag-override over the committed
            // fadeInBars/fadeOutBars, exactly like effectiveVolume below
            // does for stem.volume -- see LiveParamOverrides.h's own doc
            // comment. Falls back to the committed value when no drag is
            // currently touching this rifff's own fades.
            const FadeConfig fadeConfig {
                hasLiveOverrides
                    ? liveParamOverrides.fadeInFor(rifff.groupId).value_or(rifff.fadeInBars)
                    : rifff.fadeInBars,
                hasLiveOverrides
                    ? liveParamOverrides.fadeOutFor(rifff.groupId).value_or(rifff.fadeOutBars)
                    : rifff.fadeOutBars,
                spb
            };

            for (const auto& stem : rifff.stems)
            {
                // Prefers a live volume-drag override over the committed
                // stem.volume -- see LiveParamOverrides.h's own doc
                // comment. Read once per stem, used for both the mute/
                // silence check below and every gain multiplication in
                // this stem's own one-shot/tile-loop branch, so a live
                // override can both silence an audible stem AND make a
                // fully-silent one (committed volume 0) audible again --
                // this MUST be resolved before the skip check below, not
                // after.
                const double effectiveVolume = hasLiveOverrides
                    ? liveParamOverrides.volumeFor(stem.stemKey).value_or(stem.volume)
                    : stem.volume;
                if (stem.muted || effectiveVolume <= 0.0)
                    continue;
                // Single combined lookup — get() + sampleRateFor() separately
                // would hash the same path twice (and allocate a std::string
                // for it twice) every block; the sample rate doesn't vary
                // per-tile, so it's fetched once here rather than inside the
                // tile loop below.
                const auto entry = bufferCache.getEntry(stem.resolvedPath);
                if (entry.buffer == nullptr)
                    continue;

                if (stem.oneShot)
                {
                    // Never tiled, never resampled to project tempo -- see
                    // docs/superpowers/specs/2026-08-02-one-shot-sample-import-design.md.
                    // The trigger TIME is still bar-locked (fires in sync with
                    // the rest of the arrangement, re-times itself if project
                    // bpm later changes) -- only the sample-read RATE is fixed
                    // at 1:1 against wall-clock time, unlike the resampled tile
                    // loop below.
                    const double start = stem.startBarOverride >= 0.0 ? stem.startBarOverride : rifff.startBar;
                    const double triggerSec = start * spb;
                    const double trimStart = std::max(0.0, stem.trimStartSec);
                    const double trimEnd = stem.trimEndSec >= 0.0
                        ? std::min(stem.trimEndSec, stem.durationSec)
                        : stem.durationSec;
                    if (trimEnd <= trimStart)
                        continue;
                    const double segStartSec = triggerSec;
                    const double segEndSec = triggerSec + (trimEnd - trimStart);
                    if (segEndSec <= blockStartSec || segStartSec >= blockEndSec)
                        continue;

                    // fadeConfig is already in scope from this rifff's own
                    // declaration above the stem loop -- a one-shot is always
                    // exactly one segment, so isFirstSegment/isLastSegment are
                    // both unconditionally true here.
                    auto fadePoints = buildFadePoints(
                        segStartSec, segEndSec - segStartSec, true, true, true, fadeConfig);

                    for (int i2 = 0; i2 < numSamples; ++i2)
                    {
                        const double sampleTimeSec = blockStartSec + (double) i2 / sampleRate;
                        if (sampleTimeSec < segStartSec || sampleTimeSec >= segEndSec)
                            continue;
                        const double sourceTimeSec = trimStart + (sampleTimeSec - segStartSec);
                        const int srcSample = (int) std::llround(sourceTimeSec * entry.sampleRate);
                        if (srcSample < 0 || srcSample >= entry.buffer->getNumSamples())
                            continue;
                        const double gain = evaluateGainAtTime(fadePoints, sampleTimeSec) * effectiveVolume
                            * muteRegionGainAt(sampleTimeSec, spb, stem.muteRegions);
                        const int numCh = entry.buffer->getNumChannels();
                        const float l = entry.buffer->getSample(0, srcSample);
                        const float r = numCh > 1 ? entry.buffer->getSample(1, srcSample) : l;
                        chOutL[i2] += (float) (l * gain);
                        chOutR[i2] += (float) (r * gain);
                    }
                    continue; // handled -- skip the tile-loop path below entirely
                }

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
                // Wrapped into [0, stem.barLength) — kept in sync by hand with
                // SchedulePlayback.cpp's identical fix/reasoning (this function
                // is a hand-optimized reimplementation of the same algorithm
                // for the real-time callback, not a caller of
                // computeStemSchedule — see the comment above this loop).
                const double rawOffsetBars = stem.offsetSteps / snap->project.snapDiv;
                double offsetBars = std::fmod(rawOffsetBars, (double) stem.barLength);
                if (offsetBars < 0.0)
                    offsetBars += (double) stem.barLength;
                // lowerBound/upperBound together define the visible/audible
                // window as [lowerBound, upperBound) bars, relative to
                // start+offsetBars -- NEITHER start NOR offsetBars moves for
                // a crop (see docs/superpowers/specs/
                // 2026-08-04-tiled-clip-crop-trim-design.md); leftCropBars
                // can be negative (extend-left, revealing tiles before the
                // original anchor) just as playedBars can already exceed
                // rifff.barLength (extend-right).
                // Falls back to 0.0 (no crop) for a non-finite value (NaN/Infinity --
                // e.g. an oversized number in a hand-edited or corrupted project file)
                // rather than flowing straight into the tile-index arithmetic below,
                // where a float->int cast on a non-finite double is undefined behaviour
                // and could turn this real-time audio callback into a runaway loop.
                // upperBound already gets the same protection for free via its `>= 0.0`
                // ternary (NaN/-Infinity both fail that comparison and fall through to
                // the already-bounded rifff.barLength).
                const double lowerBound = std::isfinite(stem.leftCropBars) ? stem.leftCropBars : 0.0;
                const double upperBound = stem.playedBars >= 0.0 ? stem.playedBars : (double) rifff.barLength;
                if (upperBound <= lowerBound)
                    continue;
                const double secPerBarNative = stem.durationSec / (double) stem.barLength;

                const int firstTileIdx = (int) std::floor(lowerBound / (double) stem.barLength);
                const int totalTiles = (int) std::ceil(upperBound / (double) stem.barLength);
                const double tileDurationSec = (double) stem.barLength * spb;
                // The first AUDIBLE tile's own start (not tile 0's start,
                // unless lowerBound is itself 0) -- this is what the
                // one-tile-slack skip-ahead below measures forward from.
                const double firstTileStartSec = (start + offsetBars + lowerBound) * spb;

                // One tile of slack behind the naive floor absorbs floating-
                // point drift at a tile boundary (positionBars accumulates by
                // repeated addition in Transport.cpp) — worst case the extra
                // tile checked here is immediately skipped by the per-tile
                // overlap test below, at negligible cost. Floored at
                // firstTileIdx now, not a hardcoded 0 -- firstTileIdx can be
                // negative (extend-left case).
                int tileIdx = firstTileIdx + std::max(
                    0,
                    (int) std::floor((blockStartSec - firstTileStartSec) / tileDurationSec) - 1);

                for (; tileIdx < totalTiles; ++tileIdx)
                {
                    const double barOffset = (double) tileIdx * (double) stem.barLength;
                    // Clip THIS tile against both bounds symmetrically -- the
                    // first audible tile gets clipped from the left when
                    // lowerBound falls inside it (barOffset < lowerBound <
                    // barOffset+barLength), the last gets clipped from the
                    // right exactly as it always did.
                    const double tileStart = std::max(barOffset, lowerBound);
                    const double tileEnd = std::min(barOffset + (double) stem.barLength, upperBound);
                    if (tileEnd <= tileStart)
                        continue; // shouldn't normally happen given firstTileIdx/totalTiles above; defensive
                    const double segmentBarLength = tileEnd - tileStart;
                    const double segStartSec = (start + offsetBars + tileStart) * spb;
                    const double segEndSec = segStartSec + segmentBarLength * secPerBarNative;
                    // How far into THIS tile's own native content segStartSec
                    // actually begins -- zero for every tile except one
                    // clipped from the left by lowerBound, where it's however
                    // far past that tile's own natural start the crop point
                    // falls. Without this, a left-clipped tile would read
                    // from ITS OWN sample 0 at segStartSec instead of from
                    // partway through -- the exact same "restarts instead of
                    // continuing" bug this whole feature exists to fix, just
                    // one layer deeper (source-buffer read position, not
                    // just the rendered time window).
                    const double sourceOffsetSec = (tileStart - barOffset) * secPerBarNative;

                    // Tiles only get later from here on — nothing further in
                    // this loop can overlap the block once one starts after it.
                    if (segStartSec >= blockEndSec)
                        break;
                    // Reached via the one-tile slack margin above; this
                    // particular tile turned out to end before the block starts.
                    if (segEndSec <= blockStartSec)
                        continue;

                    const bool isFirstSegment = tileIdx == firstTileIdx;
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
                        const int srcSample = (int) std::llround((posInSegSec + sourceOffsetSec) * entry.sampleRate);
                        if (srcSample < 0 || srcSample >= entry.buffer->getNumSamples())
                            continue;

                        const double gain = evaluateGainAtTime(fadePoints, sampleTimeSec) * effectiveVolume
                            * muteRegionGainAt(sampleTimeSec, spb, stem.muteRegions);
                        const int numCh = entry.buffer->getNumChannels();
                        const float l = entry.buffer->getSample(0, srcSample);
                        const float r = numCh > 1 ? entry.buffer->getSample(1, srcSample) : l;
                        chOutL[i2] += (float) (l * gain);
                        chOutR[i2] += (float) (r * gain);
                    }
                }
            }
            }
        }

        // Run each channel's own chain, then add its (now processed) result
        // into the real output -- a channel with no chain published is a
        // pure passthrough.
        for (size_t i = 0; i < channelIds.size(); ++i)
        {
            auto* chain = channelChains.chainFor(channelIds[i]);
            if (chain != nullptr)
                chain->process(numSamples, channelL[i].data(), channelR[i].data());
            for (int i2 = 0; i2 < numSamples; ++i2)
            {
                outL[i2] += channelL[i][i2];
                outR[i2] += channelR[i][i2];
            }
        }
    }
}

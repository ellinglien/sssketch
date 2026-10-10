// native-engine/Source/PlaybackEngine.cpp
#include "PlaybackEngine.h"
#include "FadeGain.h"
#include "Metronome.h"
#include "MuteRegionGain.h"
#include "StemPan.h"
#include <algorithm>
#include <cmath>

namespace sssketch
{
    namespace
    {
        /** Runs `f` when it goes out of scope: no allocation, so fine on the audio thread. */
        template <typename F>
        struct OnScopeExit
        {
            F f;
            ~OnScopeExit() { f(); }
        };
        template <typename F>
        OnScopeExit<F> onScopeExit(F f)
        {
            return { std::move(f) };
        }

        // Shared by secPerBar() and renderBlock() so the bpm->secPerBar
        // formula only exists once -- renderBlock() still can't call
        // secPerBar() itself (that would be a second, independent atomic
        // load of `published`, risking a different snapshot than the one
        // already loaded at the top of the call -- see renderBlock's own
        // comment), so this free function is what both instead call against
        // whichever project.bpm they've each already loaded.
        double secPerBarFor(double bpm) { return bpm > 0.0 ? (60.0 / bpm) * 4.0 : 0.0; }

        /** Shortest stem loop renderBlock will tile, in bars. Endlesss's own
         * grain is a sixteenth (1/16 bar); this sits well below that, and
         * only exists so a corrupt tiny barLength can't explode the tile
         * count. */
        constexpr double kMinStemBarLength = 1.0 / 256.0;

        /** A floored/ceiled tile index as an int, clamped to +/-1e9 first
         * (NaN -> 0). A double->int cast out of range is undefined
         * behaviour; +/-1e9 also leaves room for the one addition renderBlock
         * does on top of it without overflowing. */
        int tileIndexFromDouble(double v)
        {
            if (std::isnan(v)) return 0;
            return (int) std::clamp(v, -1.0e9, 1.0e9);
        }

        /** Whether a clip's toolkit sends to the reverb at all: a raised static send, or a send
         * curve (which may rise from 0). */
        bool stemSendsToReverb(const EngineStemToolkit& toolkit)
        {
            return toolkit.reverbSend > 0.0 || ! toolkit.automation.reverbSend.empty();
        }

        /** Whether a clip's toolkit entry does nothing at all -- the test
         * that decides, once per setProject() rather than per block, whether
         * renderBlock can skip this clip's toolkit stage entirely.
         *
         * "Nothing at all" means all four of: a filter parked at its mode's
         * own neutral end with nothing automating it (channelFilterIsNeutral
         * owns that rule), no reverb send and nothing automating one, unity
         * volume with nothing automating it. Any single one of those failing
         * makes the whole clip non-neutral -- the stage is one pass over the
         * clip's buffer, so splitting it finer would buy nothing.
         *
         * Mirrored by isStemToolkitNeutral() in src/shared/toolkit.ts; the two
         * are checked against each other by intent, not by code sharing. */
        bool stemToolkitIsNeutral(const EngineStemToolkit& toolkit)
        {
            const auto& automation = toolkit.automation;
            if (!channelFilterIsNeutral(
                    toolkit.filterMode,
                    toolkit.filterCutoff,
                    !automation.filterCutoff.empty(),
                    !automation.filterResonance.empty()))
                return false;
            if (stemSendsToReverb(toolkit))
                return false;
            if (toolkit.volume != 1.0 || !automation.volume.empty())
                return false;
            return true;
        }
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

    bool PlaybackEngine::preloadStem(const juce::String& path, double durationSec)
    {
        // An empty path would reach juce::File's own constructor and assert
        // in a debug build; it is also never something worth a disk probe.
        if (path.isEmpty())
            return false;
        // Deliberately the SAME call, with the same durationSec meaning, that
        // setProject makes below -- if these two ever diverge the preload
        // warms a differently-blended entry than playback wants, and the
        // whole point is lost.
        return bufferCache.load(path, durationSec);
    }

    std::shared_ptr<PlaybackEngine::ProjectSnapshot> PlaybackEngine::buildSnapshot(const EngineProject& project)
    {
        auto next = std::make_shared<ProjectSnapshot>();
        next->project = project;
        next->generation = ++snapshotGeneration;
        for (auto& rifff : next->project.rifffs)
            for (auto& stem : rifff.stems)
                // stem.durationSec: see StemBufferCache::load's own doc
                // comment on why the loop-sewing blend needs this (not just
                // the raw decoded buffer length) to land on the same point
                // renderBlock's own tiling math actually wraps at, below.
                // Failure is fine either way — renderBlock skips missing
                // buffers.
                if (bufferCache.load(stem.resolvedPath, stem.durationSec))
                {
                    const auto entry = bufferCache.getEntry(stem.resolvedPath);
                    if (entry.owner != nullptr)
                        next->stemBuffers.emplace(stem.resolvedPath.toStdString(), entry.owner);
                }

        for (const auto& rifff : next->project.rifffs)
            next->channelGroups[rifff.channelId].push_back(&rifff);

        // Risers, grouped the same way -- and, crucially, given an entry in
        // channelGroups too (operator[] default-constructs an empty vector),
        // since that map is what decides both the channel set renderBlock
        // walks and how much scratch space is sized just below. A channel
        // whose only content is a riser has no EngineRifff to be grouped by,
        // so without this it would be silently missing from the mix.
        for (const auto& riser : next->project.risers)
        {
            // The riser's voice, from the message-thread pool: the same id
            // keeps the same voice (and so its state) across project swaps; a
            // new id gets a new voice, created and prepared HERE so that
            // nothing is allocated for it on the audio thread.
            auto& pooled = riserVoicePool[riser.id];
            if (pooled == nullptr)
            {
                pooled = std::make_shared<RiserVoice>();
                pooled->prepare(riser, masterRate.load());
            }
            next->riserVoiceRefs.push_back(pooled);
            next->riserGroups[riser.channelId].push_back({ &riser, pooled.get() });
            next->channelGroups[riser.channelId];
        }
        next->anyRisers = !next->project.risers.empty();
        // A riser with a reverb send (radio's riser character, Task 6) needs the bus opened
        // every block, exactly as a sending clip does -- and only then: a riser without one
        // leaves the bus on today's path, so nothing is built for it.
        for (const auto& riser : next->project.risers)
            if (riser.send > 0.0)
                next->anyToolkitActive = true;

        // Scratch space for the new channel set -- off the real-time thread
        // (see renderBlock's own comment on why this lives here, not
        // there). The inner per-numSamples buffers are RESERVED to the
        // longest block prepareMaster was told of, so renderBlock's per-block
        // resize stays within capacity and a re-sync allocates nothing on the
        // audio thread; untold (0), they are left empty and renderBlock sizes
        // them on first use, as it always did.
        const auto reserved = (size_t) reservedBlock.load();
        const auto reserveEach = [reserved](std::vector<std::vector<float>>& buffers) {
            for (auto& b : buffers)
                b.reserve(reserved);
        };
        next->scratchChannelL.assign(next->channelGroups.size(), {});
        next->scratchChannelR.assign(next->channelGroups.size(), {});
        reserveEach(next->scratchChannelL);
        reserveEach(next->scratchChannelR);
        next->scratchStemL.reserve(reserved);
        next->scratchStemR.reserve(reserved);
        next->scratchChannelIds.reserve(next->channelGroups.size());
        for (const auto& [channelId, rifffPtrs] : next->channelGroups)
            next->scratchChannelIds.push_back(channelId);

        // Decide once, here, off the real-time thread, which clips actually
        // have a toolkit doing something -- the neutrality test is a pure
        // function of the project, so doing it per project change instead of
        // per stem per block keeps renderBlock's toolkit cost at one bool
        // test for the overwhelmingly common all-neutral case. A `toolkit`
        // that IS present on the wire but does nothing is downgraded back to
        // hasToolkit == false right here, so a stem that arrives with, say, a
        // cleared lane still takes the pre-toolkit path.
        for (auto& rifff : next->project.rifffs)
        {
            for (auto& stem : rifff.stems)
            {
                if (!stem.hasToolkit)
                    continue;
                if (stemToolkitIsNeutral(stem.toolkit))
                {
                    stem.hasToolkit = false;
                    continue;
                }
                next->anyToolkitActive = true;
            }
        }

        // The drum-keyed pump (DrumPump.h): on only with the project's pump AND a key stem AND a
        // pumped stem. "No key stem means no pump" -- and with no pumped stem there is nothing
        // to duck. With pumped stems but not pumping, the roles stay for a release (below).
        // Otherwise every role is narrowed to none here, so renderBlock routes every stem
        // exactly as it did before the pump existed (no own buffer for the role, no key buffer,
        // no post-loop pass): bit-identical. Muted stems count: a mute re-sends the
        // project, and the routing should not hinge on it (a muted key simply keys nothing).
        {
            bool anyKey = false, anyPumped = false;
            for (const auto& rifff : next->project.rifffs)
                for (const auto& stem : rifff.stems)
                {
                    anyKey = anyKey || stem.pumpRole == EngineStem::PumpRole::key;
                    anyPumped = anyPumped || stem.pumpRole == EngineStem::PumpRole::pumped;
                }
            next->pumpActive = next->project.sound.pump.has_value() && anyKey && anyPumped;
            // Not pumping, but with pumped stems: keep the roles for a release (see
            // ProjectSnapshot::pumpReleasing). It only ever routes while DrumPump is ducking,
            // which a fresh engine (every export) never is.
            next->pumpReleasing = !next->pumpActive && anyPumped;
            if (next->pumpActive || next->pumpReleasing)
            {
                next->pumpDepthDb = next->pumpActive ? next->project.sound.pump->depthDb : 0.0;
                next->scratchPumpL.assign(next->channelGroups.size(), {});
                next->scratchPumpR.assign(next->channelGroups.size(), {});
                reserveEach(next->scratchPumpL);
                reserveEach(next->scratchPumpR);
                next->scratchKeyL.reserve(reserved);
                next->scratchKeyR.reserve(reserved);
                next->pumpTargets.reserve(next->channelGroups.size());
                // Its Faust instance, on this (message) thread; a no-op once one is built at the
                // current rate. A releasing project needs none: with no instance nothing ducks.
                if (next->pumpActive)
                    drumPump.prepare(masterRate.load());
            }
            else
            {
                for (auto& rifff : next->project.rifffs)
                    for (auto& stem : rifff.stems)
                        stem.pumpRole = EngineStem::PumpRole::none;
            }
        }

        // The dub echo (DubDelay.h): on only with the project's sound.dub AND a stem whose dubSend
        // curve is not 0 throughout. Otherwise every dubSend is cleared here (this snapshot's own
        // copy of the project), so renderBlock never taps a stem for the echo, and nothing is
        // built: with no send, the bus does not exist. Muted stems count (a mute re-sends the
        // project, and the routing should not hinge on it; a muted stem sends nothing).
        {
            const auto sends = [](const std::vector<AutomationPoint>& curve) {
                return std::any_of(curve.begin(), curve.end(), [](const AutomationPoint& p) { return p.value > 0.0; });
            };
            bool anyDubSend = false;
            for (const auto& rifff : next->project.rifffs)
                for (const auto& stem : rifff.stems)
                    anyDubSend = anyDubSend || sends(stem.toolkit.automation.dubSend);
            next->dubActive = next->project.sound.dub.has_value() && anyDubSend;
            // The snapshot this one follows (a staged one first: it lands before this does), for
            // the stems whose send has to ramp out rather than step to nothing (SEND SLEW).
            auto before = std::atomic_load_explicit(&staged, std::memory_order_acquire);
            if (before == nullptr)
                before = std::atomic_load_explicit(&published, std::memory_order_acquire);
            const auto tappedBefore = [&](const juce::String& key) {
                // 0 not tapped, 1 a curve, 2 a ramp out
                if (before == nullptr)
                    return 0;
                for (const auto& tap : before->dubTaps)
                    if (tap.stem->stemKey == key)
                        return tap.rampOut ? 2 : 1;
                return 0;
            };
            const bool settled = dubBus.sendGainsSettled();
            for (auto& rifff : next->project.rifffs)
                for (auto& stem : rifff.stems)
                {
                    if (! next->dubActive || ! sends(stem.toolkit.automation.dubSend))
                        stem.toolkit.automation.dubSend.clear();
                    const bool curve = ! stem.toolkit.automation.dubSend.empty();
                    // A stem that sent in the snapshot before ramps out from wherever its gain is;
                    // one that was already ramping out keeps at it while any gain is held.
                    const int was = curve ? 0 : tappedBefore(stem.stemKey);
                    const bool rampOut = was == 1 || (was == 2 && ! settled);
                    if (! curve && ! rampOut)
                        continue;
                    stem.dubTap = (int) next->dubTaps.size();
                    next->dubTaps.push_back({ &stem, (unsigned long long) stem.stemKey.hashCode64(), rampOut });
                    next->anyDubRampOut = next->anyDubRampOut || rampOut;
                }
            next->dubTapSlots.assign(next->dubTaps.size(), -1);
            // Its core (2 s of line a side), on this (message) thread; only the first build
            // happens here, at masterRate -- after that the rate is prepareMaster's or
            // drainRetiredProject's, as the cavern's.
            if (next->dubActive && dubBus.preparedRate() == 0.0)
                dubBus.prepare(masterRate.load());
        }

        // The master stage's limiter and glue are Faust objects: built here, on the message thread,
        // before a snapshot that asks for it can reach the audio thread (a no-op once one is
        // built at the current rate).
        if (project.sound.mastering)
            masterStage.prepare(masterRate.load());

        // The cavern room's convolver likewise (CavernReverb.h: an impulse cached per rate,
        // plus ~4 MB of state), but only once something actually sends to it -- with no send
        // nothing is built, the same promise zita's lazy build keeps. A no-op once one is built
        // at the current rate.
        //
        // Only the FIRST build happens here, at masterRate. After that the rate is prepareMaster's
        // business (a device or export rate change) or drainRetiredProject's (a block at a rate
        // nothing was built for): rebuilding at masterRate on every project load would undo the
        // latter whenever the two differ, and ping-pong.
        if (project.sound.room == ReverbRoom::cavern && reverbBus.cavernPreparedRate() == 0.0)
        {
            bool anyReverbSend = false;
            for (const auto& rifff : next->project.rifffs)
                for (const auto& stem : rifff.stems)
                    anyReverbSend = anyReverbSend || (stem.hasToolkit && stemSendsToReverb(stem.toolkit));
            for (const auto& riser : next->project.risers)
                anyReverbSend = anyReverbSend || riser.send > 0.0;
            // The dub echo feeds the room too (kDubToReverb).
            anyReverbSend = anyReverbSend || next->dubActive;
            if (anyReverbSend)
                reverbBus.prepareCavern(masterRate.load());
        }

        return next;
    }

    void PlaybackEngine::setProject(const EngineProject& project)
    {
        auto next = buildSnapshot(project);

        // An explicit, immediate project load supersedes anything that was
        // waiting for a loop top -- otherwise a staged swap parked before
        // this call would fire at the next wrap and quietly undo it. Done
        // BEFORE the publish below, so the window in which the audio thread
        // could still take the staged one and then have it immediately
        // overwritten is as short as the two adjacent stores; and done here
        // rather than only in IpcServer's own handler so that no future
        // caller of setProject() can forget it.
        cancelStagedProject();

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
        bufferCache.pruneUnusedShapePreviews();
    }

    void PlaybackEngine::stageProject(const EngineProject& project)
    {
        // Every expensive thing -- the file reads, the Ogg/WAV decodes, the
        // loop-sewing blend, the allocation of the snapshot and all its
        // derived structure -- happens right here, on the message thread,
        // however long before the loop top the caller managed to get to it.
        // What reaches the audio thread afterwards is a finished object and
        // a pointer.
        auto next = buildSnapshot(project);
        std::atomic_store_explicit(
            &staged, std::shared_ptr<const ProjectSnapshot>(std::move(next)), std::memory_order_release);
        bufferCache.pruneUnusedShapePreviews();
    }

    bool PlaybackEngine::cancelStagedProject()
    {
        // The exchange, not a load-then-store: the audio thread may be
        // taking the staged snapshot at this exact moment, and "did I
        // actually stop it?" has to be answered by the same operation that
        // tried to, or the caller will tell its client a swap was cancelled
        // that in fact went ahead.
        auto previous = std::atomic_exchange_explicit(
            &staged, std::shared_ptr<const ProjectSnapshot>(), std::memory_order_acq_rel);
        return previous != nullptr;
    }

    bool PlaybackEngine::promoteStagedProjectNow()
    {
        auto taken = std::atomic_exchange_explicit(
            &staged, std::shared_ptr<const ProjectSnapshot>(), std::memory_order_acq_rel);
        if (taken == nullptr)
            return false;
        std::atomic_store_explicit(&published, taken, std::memory_order_release);
        return true;
    }

    PlaybackEngine::StagedApply PlaybackEngine::applyStagedProject()
    {
        // "Is there anything to do at all?" comes first: the overwhelmingly
        // common case is a lap top with nothing staged, and that has to cost
        // one load and nothing else -- in particular it must not be counted
        // as a deferral just because the previous swap's retirement hasn't
        // been collected yet.
        auto incoming = std::atomic_load_explicit(&staged, std::memory_order_acquire);
        if (incoming == nullptr)
            return StagedApply::None;

        // With the retirement slot occupied there is nowhere to put the
        // outgoing snapshot that doesn't risk freeing something here. See
        // this function's own doc comment (.h) -- this is the one branch
        // that gives up rather than take that risk, and the caller's
        // contract is to ask again next block rather than to wait another
        // whole lap.
        if (retiredOccupied.load(std::memory_order_acquire))
        {
            stagedDeferrals.fetch_add(1, std::memory_order_relaxed);
            return StagedApply::Deferred;
        }

        // Hold the outgoing snapshot on the stack, THEN park it, THEN
        // displace it. Any other order lets `published`'s store be the
        // release that takes the count to zero.
        auto outgoing = std::atomic_load_explicit(&published, std::memory_order_acquire);
        std::atomic_store_explicit(&retired, outgoing, std::memory_order_release);
        retiredOccupied.store(true, std::memory_order_release);

        std::atomic_store_explicit(&published, incoming, std::memory_order_release);

        // Compare-exchange, not a plain clear: if the message thread staged
        // a NEWER project in the microseconds since the load above, that
        // one must stay staged and get its own loop top. A plain store of
        // nullptr here would silently drop it, and a dropped change is the
        // one outcome this whole feature is not allowed to produce.
        auto expected = incoming;
        std::atomic_compare_exchange_strong_explicit(
            &staged, &expected, std::shared_ptr<const ProjectSnapshot>(),
            std::memory_order_acq_rel, std::memory_order_acquire);

        stagedApplies.fetch_add(1, std::memory_order_release);
        return StagedApply::Applied;

        // Every local dies here, and none of them is the last owner:
        // `incoming` is held by `published`; `outgoing` is held by
        // `retired`; `expected` is held by either `staged` (the CAS failed,
        // so it is the newer snapshot, still staged) or `published` (the
        // CAS succeeded, so it is still `incoming`).
    }

    void PlaybackEngine::drainRetiredProject()
    {
        masterStage.drainRetired();
        drumPump.drainRetired();
        reverbBus.drainRetiredCavern();
        dubBus.drainRetired();
        // A dub block found no core at its rate (DubDelayBus::process gave no echo): build one,
        // as for the cavern below. Expected never in practice (prepareMaster comes first).
        if (const double wanted = dubBus.takeWantedRate(); wanted > 0.0 && wanted != dubBus.preparedRate())
        {
            juce::Logger::writeToLog("PlaybackEngine: the dub echo had no core at " + juce::String(wanted)
                                     + " Hz; building one");
            dubBus.prepare(wanted);
        }
        // A cavern block found no convolver at its rate (ReverbBus::runCavern went silent for
        // it): build one now. Expected never in practice -- prepareMaster tells the engine the
        // device's and the export's rate before either renders -- so it is logged.
        if (const double wanted = reverbBus.takeWantedCavernRate(); wanted > 0.0
            && wanted != reverbBus.cavernPreparedRate())
        {
            juce::Logger::writeToLog("PlaybackEngine: the cavern reverb had no convolver at "
                                     + juce::String(wanted) + " Hz; building one");
            reverbBus.prepareCavern(wanted);
        }
        pruneRiserVoices();
        if (!retiredOccupied.load(std::memory_order_acquire))
            return;
        // Clear the slot first, flag second -- the exact mirror of the
        // audio thread's park-then-flag order above, which is what lets
        // each side trust the flag about the slot. The destructor, and
        // every buffer free inside it, runs on THIS thread.
        std::atomic_store_explicit(
            &retired, std::shared_ptr<const ProjectSnapshot>(), std::memory_order_release);
        retiredOccupied.store(false, std::memory_order_release);
    }

    void PlaybackEngine::pruneRiserVoices()
    {
        if (riserVoicePool.empty())
            return;
        // An id is kept while the published or the staged snapshot has a
        // riser with it (a staged project's voices must survive until its
        // loop top). Anything else goes from the pool; dropping the pool's
        // reference never frees a voice a live snapshot still holds (see
        // ProjectSnapshot::riserVoiceRefs), it only stops the id carrying its
        // state into a later project -- a riser that comes back after leaving
        // both starts from a fresh voice, as after a seek.
        // `staged` BEFORE `published`, and the order matters. The audio thread can promote the
        // staged snapshot (applyStagedProject: publish it, then clear `staged`) between the two
        // loads. Published first would let it slip between them -- the old published loaded,
        // then a null staged -- and a newly armed riser's id, in the promoted snapshot only,
        // would be pruned: memory-safe (that snapshot holds the voice), but the next re-sync
        // would build a fresh voice mid-riser (a bandpass reset and a pink warm-up), the very
        // thing the riser's armId is there to prevent. Staged first: if it is a snapshot, its
        // ids are covered whether or not it is promoted meanwhile; if it is null, nothing can be
        // promoted behind our back, since only this (message) thread stages.
        const auto next = std::atomic_load_explicit(&staged, std::memory_order_acquire);
        const auto live = std::atomic_load_explicit(&published, std::memory_order_acquire);
        const auto inUse = [&](const juce::String& id) {
            for (const auto* snap : { live.get(), next.get() })
                if (snap != nullptr)
                    for (const auto& riser : snap->project.risers)
                        if (riser.id == id)
                            return true;
            return false;
        };
        for (auto it = riserVoicePool.begin(); it != riserVoicePool.end();)
            it = inUse(it->first) ? std::next(it) : riserVoicePool.erase(it);
    }

    void PlaybackEngine::sizeScratch(std::vector<float>& v, size_t n) const
    {
        if (v.size() == n)
            return;
        if (n > v.capacity())
            scratchGrowths.fetch_add(1, std::memory_order_relaxed);
        v.resize(n);
    }

    void PlaybackEngine::prepareMaster(double sampleRate, int maxBlockSize)
    {
        masterRate.store(sampleRate);
        if (maxBlockSize > 0)
        {
            const int block = std::min(maxBlockSize, kMaxReservedBlock);
            reservedBlock.store(block);
            // The buses' block scratch is theirs (not a snapshot's), and both callers are moments
            // with no block in flight (see the declaration), so it is sized right here.
            reverbBus.reserveScratch(block);
            dubBus.reserveScratch(block);
        }
        if (masterStage.preparedRate() != 0.0)
            masterStage.prepare(sampleRate);
        // The pump's instance likewise.
        if (drumPump.preparedRate() != 0.0)
            drumPump.prepare(sampleRate);
        // The cavern room's convolver follows the same rate, rebuilt only if one exists.
        if (reverbBus.cavernPreparedRate() != 0.0)
            reverbBus.prepareCavern(sampleRate);
        // And the dub echo's core.
        if (dubBus.preparedRate() != 0.0)
            dubBus.prepare(sampleRate);
    }

    void PlaybackEngine::processMaster(double sampleRate, int numSamples, float* outL, float* outR)
    {
        masterStage.process(masterSettingsSeen ? &*masterSettingsSeen : nullptr, sampleRate, numSamples, outL, outR);
    }

    bool PlaybackEngine::hasStagedProject() const
    {
        return std::atomic_load_explicit(&staged, std::memory_order_acquire) != nullptr;
    }

    void PlaybackEngine::renderBlock(
        double positionBars,
        double sampleRate,
        int numSamples,
        float* outL,
        float* outR,
        ChannelChainRegistry& channelChains,
        const LapClock& lapClock) const
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
        {
            masterSettingsSeen.reset();
            drumPump.idle();
            return;
        }
        renderedSnapshotGeneration.store(snap->generation, std::memory_order_relaxed);
        // For processMaster, which runs after this block's render(s): the settings travel
        // with the snapshot, so a staged swap's mastering starts with its project.
        masterSettingsSeen = MasterStage::settingsFor(snap->project.sound);

        // Pushed once per renderBlock call, covering every channel chain at
        // once -- both live playback (Transport.cpp's several
        // engine.renderBlock() call sites inside renderLoopAware, e.g. a
        // loop-wrap split render) and offline export (RenderExport.cpp's
        // own call) already funnel through this one function, so this is
        // the single place a hosted channel-chain plugin's playhead
        // position needs to be kept in sync -- see
        // ChannelChainRegistry::setPosition's own doc comment for why it's
        // safe to call this from a real-time thread every block.
        //
        // The ReadScope is held for the rest of this call, not just the
        // lookups: the channel loop below calls process() on the chains
        // chainFor returns, and a concurrent updateChannelSet that drops a
        // channel would otherwise destroy its chain mid-process(). See
        // ChannelChainRegistry::ReadScope. Lock-free; never blocks.
        const ChannelChainRegistry::ReadScope channelChainsScope(channelChains);
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
        {
            drumPump.idle(); // a block without the pump (DrumPump: the next engage clears)
            return;
        }

        // Radio fold mode: start the tails of cycles replaced at this top, and drop the ones
        // whose 10 ms are over (CycleTable::Tail). Every block, whatever renders below.
        cycleTable.beginBlock(lapClock, positionBars, spb);

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
        if (metronomeEnabled.load())
        {
            const double secPerBeat = spb / (double) kMetronomeBeatsPerBar;
            const float clickGain = metronomeVolume.load();
            for (int i2 = 0; i2 < numSamples; ++i2)
            {
                const double sampleTimeSec = blockStartSec + (double) i2 / sampleRate;
                const float click = metronomeSampleAt(sampleTimeSec, secPerBeat) * clickGain;
                outL[i2] += click;
                outR[i2] += click;
            }
        }

        // Risers count as content: a project consisting of nothing but a
        // riser still has to be heard, so this can't test rifffs alone.
        if (snap->project.rifffs.empty() && snap->project.risers.empty())
        {
            drumPump.idle();
            return;
        }

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
            sizeScratch(channelL[i], (size_t) numSamples);
            sizeScratch(channelR[i], (size_t) numSamples);
            std::fill(channelL[i].begin(), channelL[i].end(), 0.0f);
            std::fill(channelR[i].begin(), channelR[i].end(), 0.0f);
        }

        // The built-in toolkit's shared reverb bus (ReverbBus.h). Opened
        // BEFORE the per-stem render loop below -- the send is tapped per
        // CLIP now (spec section 2b), so every clip's send has to land in
        // the same accumulator before the one reverb pass runs at the end of
        // the block. Skipped entirely -- not even a beginBlock() buffer clear
        // -- when no clip has a non-neutral toolkit AND no tail is still
        // ringing from one that did. That second half matters: a user
        // dragging a send back to zero (or deleting the only sending clip)
        // must still hear the tail out rather than have it cut on the next
        // block.
        // The dub echo bus (DubDelay.h): opened while the project has a dub send, or while the
        // echo still rings after it has gone. It feeds the reverb (kDubToReverb), so it opens the
        // reverb bus with it. With neither, nothing below touches it: today's path.
        // A send still ramping out (its curve gone with the last swap) keeps it running too.
        const bool runDub = snap->dubActive || dubBus.isRinging() || (snap->anyDubRampOut && dubBus.holdsSendGain());
        if (runDub)
        {
            dubBus.beginBlock(numSamples, positionBars, spb, sampleRate, snap->generation);
            // Each tapped stem's send gain for the block, and where its throw is open, from the
            // curves (and a slew after a break) alone (DubDelayBus::markOpen).
            for (size_t t = 0; t < snap->dubTaps.size(); ++t)
            {
                const auto* stem = snap->dubTaps[t].stem;
                snap->dubTapSlots[t] = dubBus.markOpen(snap->dubTaps[t].id, numSamples, stem->toolkit.automation.dubSend,
                                                       stem->toolkit.originBar, positionBars, spb, sampleRate);
            }
        }
        else
            dubBus.idleSends();
        const bool runReverbBus = snap->anyToolkitActive || reverbBus.isRinging() || runDub;
        if (runReverbBus)
        {
            reverbBus.prepare(sampleRate, numSamples);
            reverbBus.setSettings(snap->project.reverb);
            reverbBus.setRoom(snap->project.sound.room, snap->project.sound.reverbReturn);
            reverbBus.beginBlock(numSamples);
        }

        // The drum-keyed pump's routing (DrumPump.h). The key buffer collects every key stem's
        // dry signal, project-wide, cleared once per block; each channel's pumped buffer is
        // cleared lazily by its first pumped stem that has samples in the block
        // (pumpedReady), and only such channels are ducked and added in after the loop.
        //
        // A releasing project (the pump switched off mid-duck) routes the same way, at depth 0,
        // only while DrumPump is still ducking: the duck lets go through pump.dsp's own release
        // instead of stepping. Decided once per block; once the gain is back to exactly 1.0f
        // the next block routes as with no pump at all.
        const bool pumpActive = snap->pumpActive;
        const bool routePump = pumpActive || (snap->pumpReleasing && drumPump.isDucking());
        const auto roleOf = [routePump](const EngineStem& stem) {
            return routePump ? stem.pumpRole : EngineStem::PumpRole::none;
        };
        if (routePump)
        {
            auto& kL = snap->scratchKeyL;
            auto& kR = snap->scratchKeyR;
            sizeScratch(kL, (size_t) numSamples);
            sizeScratch(kR, (size_t) numSamples);
            std::fill(kL.begin(), kL.end(), 0.0f);
            std::fill(kR.begin(), kR.end(), 0.0f);
            snap->pumpTargets.clear();
        }

        size_t channelIdx = 0;
        for (const auto& [channelId, rifffPtrs] : snap->channelGroups)
        {
            float* chOutL = channelL[channelIdx].data();
            float* chOutR = channelR[channelIdx].data();
            const size_t thisChannel = channelIdx;
            ++channelIdx;
            // This channel's pumped buffer, once a pumped stem has written to it this block.
            bool pumpedReady = false;

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
                // A folded row's cycle origin is the top of the lap its cycle went live on, so
                // it is stamped here, every block, before any skip below (muted, silent, buffer
                // not loaded yet, out of range): a row that comes in later in the lap -- an
                // unmute, a late load -- still runs on the grid it was given, rather than one
                // started from whichever lap it first sounded in. originFor only writes once per
                // cycle and epoch; the cycle path below reads the same value. At most
                // kMaxCycleRows entries to scan, no allocation, no lock.
                // The stem is stamped on its cycle too, so a tail (CycleTable::Tail) plays only
                // for the stem that was playing the cycle, never one swapped into the row -- and
                // on a row it plays straight, so a row that folds in has a straight tail for it.
                // The stem's hash is the parser's (EngineStem::cycleStemHash: its audio file, so a
                // project swap that renames every stemKey at the same top keeps the tail).
                const uint64_t cycleStemHash = stem.cycleStemHash;
                if (stem.cycleRowKey != 0)
                {
                    if (auto* live = cycleTable.find(stem.cycleRowKey))
                    {
                        CycleTable::originFor(*live, lapClock);
                        live->stemHash = cycleStemHash;
                    }
                    else
                        cycleTable.noteStraight(stem.cycleRowKey, cycleStemHash, lapClock.epoch);
                }

                // A drawn `volume` curve REPLACES this clip's own static
                // level rather than multiplying with it -- Elling's explicit
                // choice (spec section 2b: "one place to draw a level"). So
                // when the curve exists, the sample loop below runs at unity
                // and applyStemToolkit's smoothed curve value IS the clip's
                // gain. Resolved here rather than in buildEngineProject so
                // the wire stays honest about both numbers and the rule lives
                // on the side that actually applies it.
                const bool volumeAutomated =
                    stem.hasToolkit && !stem.toolkit.automation.volume.empty();
                // Otherwise: prefers a live volume-drag override over the
                // committed stem.volume -- see LiveParamOverrides.h's own doc
                // comment. Read once per stem, used for both the mute/
                // silence check below and every gain multiplication in
                // this stem's own one-shot/tile-loop branch, so a live
                // override can both silence an audible stem AND make a
                // fully-silent one (committed volume 0) audible again --
                // this MUST be resolved before the skip check below, not
                // after.
                const double effectiveVolume = volumeAutomated
                    ? 1.0
                    : (hasLiveOverrides
                           ? liveParamOverrides.volumeFor(stem.stemKey).value_or(stem.volume)
                           : stem.volume);
                if (stem.muted || effectiveVolume <= 0.0)
                    continue;
                // The immutable snapshot pins this buffer. Never consult the
                // mutable message-thread cache from the audio callback.
                const auto bufferIt = snap->stemBuffers.find(stem.resolvedPath.toStdString());
                if (bufferIt == snap->stemBuffers.end() || bufferIt->second == nullptr)
                    continue;
                const auto& pinnedBuffer = *bufferIt->second;
                const StemBufferEntry entry {
                    &pinnedBuffer.buffer, pinnedBuffer.sampleRate, {}
                };

                // A clip with a toolkit renders into its OWN buffer first, so
                // its filter/volume/send apply to just that clip before it
                // joins the rest of the channel. So does a panned row (the
                // radio sound's per-row panning, StemPan.h): a pan has to
                // act on this stem alone. A neutral, centred clip writes
                // straight into the channel accumulator exactly as it always
                // did -- same pointers, same order of additions, so an
                // ordinary project's output stays bit-identical.
                //
                // A stem with a pump role (only ever set while the pump is active) takes its own
                // buffer too: a pumped stem's dry signal goes to its channel's pumped buffer
                // instead of the channel, and a key stem's to the key buffer as well.
                const auto pumpRole = roleOf(stem);
                // And a stem with a dub throw (its dubSend curve, kept only while the project's
                // echo is on -- buildSnapshot): the echo is tapped from this stem alone.
                const auto& dubSend = stem.toolkit.automation.dubSend;
                const bool ownBuffer = stem.hasToolkit || stem.pan != 0.0
                    || pumpRole != EngineStem::PumpRole::none || stem.dubTap >= 0;
                float* stemOutL = chOutL;
                float* stemOutR = chOutR;
                // The own buffer is cleared LAZILY, by the first segment that
                // actually overlaps this block -- not up front. With the radio
                // sound's panning on by default most stems are panned, and a
                // long arrangement has hundreds of them out of range of any
                // given block: clearing (and later summing) a buffer for each
                // of those every block would be pure audio-thread waste. A
                // stem with nothing in range and no toolkit never touches the
                // scratch or its channel at all (finishStem).
                bool stemBufferReady = !ownBuffer; // the channel needs no preparing
                const auto prepareStemBuffer = [&]() {
                    if (stemBufferReady)
                        return;
                    auto& sL = snap->scratchStemL;
                    auto& sR = snap->scratchStemR;
                    sizeScratch(sL, (size_t) numSamples);
                    sizeScratch(sR, (size_t) numSamples);
                    std::fill(sL.begin(), sL.end(), 0.0f);
                    std::fill(sR.begin(), sR.end(), 0.0f);
                    stemOutL = sL.data();
                    stemOutR = sR.data();
                    stemBufferReady = true;
                };

                // Runs this clip's toolkit stage over whatever it just
                // rendered and folds the result into the channel. Called on
                // every path that actually produced samples -- the one-shot
                // branch (which leaves the stem body early) and the tile
                // loop -- rather than restructuring both into one exit, which
                // would mean reindenting the whole tile path for nothing. A
                // no-op, and not even a copy, for a clip with no toolkit and
                // no pan: stemOut* ARE chOut* in that case, so the samples
                // are already exactly where they belong.
                //
                // Order: filter -> volume -> pan -> send -> channel, the
                // web's (its rows pan before the reverb send). A panned
                // clip with no toolkit is panned and summed and that is
                // all: it adds no send, so it neither opens the reverb bus
                // nor feeds it, exactly like a centred clip without one.
                bool stemFinished = false;
                const auto finishStem = [&]() {
                    stemFinished = true;
                    if (!ownBuffer)
                        return;
                    if (!stemBufferReady)
                    {
                        // Nothing of this stem fell in the block. A pan of
                        // silence is silence, so a toolkit-less stem is done.
                        // A toolkit still runs every block (its smoothers
                        // advance and its filter rings out), over silence,
                        // exactly as before the buffer was cleared lazily.
                        if (!stem.hasToolkit)
                            return;
                        prepareStemBuffer();
                    }
                    if (stem.hasToolkit)
                        applyStemToolkit(
                            stem.toolkit,
                            stem.stemKey,
                            stem.pan,
                            positionBars,
                            spb,
                            sampleRate,
                            numSamples,
                            stemOutL,
                            stemOutR);
                    else
                        applyStemPan(stem.pan, numSamples, stemOutL, stemOutR);
                    // The dub throw's send: post-volume, post-pan, beside the reverb send and,
                    // like it, before the pump (the web's rows feed their delaySend from the
                    // pan, ahead of the pump bus).
                    if (runDub && stem.dubTap >= 0)
                        dubBus.addSendCurve(snap->dubTapSlots[(size_t) stem.dubTap], numSamples, stemOutL, stemOutR,
                                            dubSend, stem.toolkit.originBar, positionBars, spb, sampleRate);
                    // The sends have been tapped by now (applyStemToolkit, the dub), so they are not pumped.
                    if (routeToPumped(*snap, pumpRole, thisChannel, pumpedReady, numSamples, stemOutL, stemOutR,
                                      chOutL, chOutR))
                        return;
                    for (int i2 = 0; i2 < numSamples; ++i2)
                    {
                        chOutL[i2] += stemOutL[i2];
                        chOutR[i2] += stemOutR[i2];
                    }
                    addToKey(*snap, pumpRole, numSamples, stemOutL, stemOutR);
                };

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
                    prepareStemBuffer();
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
                        stemOutL[i2] += (float) (l * gain);
                        stemOutR[i2] += (float) (r * gain);
                    }
                    finishStem();
                    continue; // handled -- skip the tile-loop path below entirely
                }

                // RADIO FOLD MODE (CycleTable.h): a row the live cycle table names loops only the
                // first `bars` of its content, on the LAP clock -- positionBars restarts at every
                // loop top, lapClock.baseBars + positionBars does not -- so a 7-beat cycle in a
                // 16-beat loop drifts against the top and realigns every 112 beats, instead of
                // restarting with the loop. Tile k starts at origin + phase + k * bars; each tile
                // reads the stem's first `bars` of audio at its native rate (durationSec /
                // barLength, the same rate the tile path below uses, so a stretched stem plays at
                // tempo), and fades in and out over kCycleSeamFadeSec, because the cut is a jump
                // in the audio that nothing else smooths (the buffer cache sews only the stem's
                // own end). The rifff's window and fades do not apply: a folded row plays the
                // whole lap, every lap. Everything after -- gain, mute regions, toolkit, pan,
                // sends, pump -- is the same as for any stem.
                //
                // addCycle adds one cycle of this stem: tiles of `rowBars` from originBars + phaseBars on
                // the lap clock, each its first `rowBars` of audio with the seam fade. With
                // tailStartBars >= 0 it is an outgoing cycle's tail (CycleTable::Tail), and fades
                // out linearly over kCycleSeamFadeSec from there on top. Returns whether it could
                // play at all (a degenerate stem or cycle cannot).
                const auto addCycle = [&](double rowBars, double phaseBars, double originBars,
                                          double tailStartBars) {
                    if (! std::isfinite(stem.barLength) || stem.barLength < kMinStemBarLength
                        || ! (stem.durationSec > 0.0))
                        return false;
                    const double cycleBars = std::min(rowBars, stem.barLength);
                    if (! (cycleBars >= kMinStemBarLength))
                        return false;
                    const double secPerBarNative = stem.durationSec / stem.barLength;
                    const double contentSec = cycleBars * secPerBarNative;
                    const double tileSec = cycleBars * spb;
                    // The tile is cut at tileSec, whatever the audio's own length: a stem a hair
                    // slow (up to 0.1% skips the stretch, STRETCH_RATIO_EPSILON) runs past it, so
                    // the fade-out has to end where the tile ends, not where the audio would
                    // have -- otherwise every seam is cut at nearly full gain.
                    const double endSec = std::min(contentSec, tileSec);
                    const double fadeSec = std::min(kCycleSeamFadeSec, endSec / 2.0);
                    const double lapNowBars = lapClock.baseBars + positionBars;
                    // seconds into the cycle grid at this block's first sample
                    const double gridStartSec = (lapNowBars - originBars - phaseBars) * spb;
                    const bool isTail = tailStartBars >= 0.0;
                    const double tailElapsedSec = isTail ? (lapNowBars - tailStartBars) * spb : 0.0;
                    // An incoming cycle fades in from its origin over kCycleSeamFadeSec too: with a
                    // phase, the grid there is -phaseBars, so the first sample is mid-tile
                    // (tileSec - phase in), past the seam's own fade-in. With no phase it is the
                    // seam's fade-in (the lower of the two applies, not their product), and both
                    // are over 10 ms after the origin.
                    const double originElapsedSec = isTail ? 0.0 : (lapNowBars - originBars) * spb;
                    const int numCh = entry.buffer->getNumChannels();
                    const int bufferSamples = entry.buffer->getNumSamples();
                    prepareStemBuffer();
                    for (int i2 = 0; i2 < numSamples; ++i2)
                    {
                        double out = 1.0;
                        double fadeIn = 1.0;
                        if (isTail)
                        {
                            out = 1.0 - (tailElapsedSec + (double) i2 / sampleRate) / kCycleSeamFadeSec;
                            if (out <= 0.0)
                                break; // the tail is over; CycleTable drops it next block
                        }
                        else
                        {
                            const double sinceOrigin = originElapsedSec + (double) i2 / sampleRate;
                            if (sinceOrigin < kCycleSeamFadeSec)
                                fadeIn = std::max(0.0, sinceOrigin / kCycleSeamFadeSec);
                        }
                        double inTile = std::fmod(gridStartSec + (double) i2 / sampleRate, tileSec);
                        if (inTile < 0.0)
                            inTile += tileSec;
                        if (inTile >= endSec)
                            continue; // a stem faster than the project leaves a gap, as a tile does
                        const int srcSample = (int) std::llround(inTile * entry.sampleRate);
                        if (srcSample < 0 || srcSample >= bufferSamples)
                            continue;
                        const double seam = fadeSec > 0.0
                            ? std::min({ fadeIn, inTile / fadeSec, (endSec - inTile) / fadeSec })
                            : fadeIn;
                        const double sampleTimeSec = blockStartSec + (double) i2 / sampleRate;
                        const double gain = seam * out * effectiveVolume
                            * muteRegionGainAt(sampleTimeSec, spb, stem.muteRegions);
                        const float l = entry.buffer->getSample(0, srcSample);
                        const float r = numCh > 1 ? entry.buffer->getSample(1, srcSample) : l;
                        stemOutL[i2] += (float) (l * gain);
                        stemOutR[i2] += (float) (r * gain);
                    }
                    return true;
                };

                // The straight path: the stem's tiles across the rifff's window. As a lambda so a
                // straight tail (CycleTable::Tail, a row folding in) can play the outgoing lap's
                // continuation of it -- `continueOffsetBars` on from this block, fading out over
                // kCycleSeamFadeSec from `tailStartBars` -- with the very same code. With
                // tailStartBars < 0 it is the stem's own straight playback, unshifted (the block
                // window plus 0.0, and no fade: exactly as before). Returns false where the stem
                // cannot play at all.
                const auto addStraight = [&](double continueOffsetBars, double tailStartBars) {
                    const bool isTail = tailStartBars >= 0.0;
                    const double tailElapsedSec =
                        isTail ? (lapClock.baseBars + positionBars - tailStartBars) * spb : 0.0;
                    const double bStartSec = blockStartSec + continueOffsetBars * spb;
                    const double bEndSec = blockEndSec + continueOffsetBars * spb;

                    // barLength is in bars and may be fractional (a half-bar
                    // Endlesss stem is 0.5, a 24-sixteenths one is 1.5). It used
                    // to be an int, which made a half-bar stem 0 -- skipped here,
                    // silent -- and tiled a 1.5-bar stem every 1 bar. As a double
                    // it can now also be NaN (which `<= 0` lets through) or a
                    // pathologically tiny value whose tile count would overflow
                    // the int tile indices below, so both are rejected. The floor
                    // (1/256 bar) is far below Endlesss's own 1/16-bar grain, and
                    // keeps the per-block tile walk to a couple of tiles at most.
                    if (!std::isfinite(stem.barLength) || stem.barLength < kMinStemBarLength)
                        return false;

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
                    double offsetBars = std::fmod(rawOffsetBars, stem.barLength);
                    if (offsetBars < 0.0)
                        offsetBars += stem.barLength;
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
                    const double upperBound = stem.playedBars >= 0.0 ? stem.playedBars : rifff.barLength;
                    if (upperBound <= lowerBound)
                        return false;
                    const double secPerBarNative = stem.durationSec / stem.barLength;

                    // Clamped in double space before the int cast: with a
                    // fractional (smaller) divisor, an oversized or +Infinity
                    // playedBars/leftCropBars from a corrupted file would
                    // otherwise overflow int -- undefined behaviour on the
                    // real-time thread.
                    const int firstTileIdx = tileIndexFromDouble(std::floor(lowerBound / stem.barLength));
                    const int totalTiles = tileIndexFromDouble(std::ceil(upperBound / stem.barLength));
                    const double tileDurationSec = stem.barLength * spb;
                    // The first AUDIBLE tile's own start (not tile 0's start,
                    // unless lowerBound is itself 0) -- this is what the
                    // one-tile-slack skip-ahead below measures forward from.
                    const double firstTileStartSec = (start + offsetBars + lowerBound) * spb;

                    // One tile of slack behind the naive floor absorbs floating-
                    // point rounding at a tile boundary (positionBars is a bar
                    // position converted from a sample count, and a seek can land
                    // anywhere) — worst case the extra
                    // tile checked here is immediately skipped by the per-tile
                    // overlap test below, at negligible cost. Floored at
                    // firstTileIdx now, not a hardcoded 0 -- firstTileIdx can be
                    // negative (extend-left case).
                    int tileIdx = firstTileIdx + std::max(
                        0,
                        tileIndexFromDouble(std::floor((bStartSec - firstTileStartSec) / tileDurationSec)) - 1);

                    for (; tileIdx < totalTiles; ++tileIdx)
                    {
                        const double barOffset = (double) tileIdx * stem.barLength;
                        // Clip THIS tile against both bounds symmetrically -- the
                        // first audible tile gets clipped from the left when
                        // lowerBound falls inside it (barOffset < lowerBound <
                        // barOffset+barLength), the last gets clipped from the
                        // right exactly as it always did.
                        const double tileStart = std::max(barOffset, lowerBound);
                        const double tileEnd = std::min(barOffset + stem.barLength, upperBound);
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
                        if (segStartSec >= bEndSec)
                            break;
                        // Reached via the one-tile slack margin above; this
                        // particular tile turned out to end before the block starts.
                        if (segEndSec <= bStartSec)
                            continue;

                        const bool isFirstSegment = tileIdx == firstTileIdx;
                        const bool isLastSegment = tileIdx == totalTiles - 1;

                        prepareStemBuffer();
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
                            const double sampleTimeSec = bStartSec + (double) i2 / sampleRate;
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
                            // adding it to bStartSec, then this line subtracts segStartSec
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

                            double gain = evaluateGainAtTime(fadePoints, sampleTimeSec) * effectiveVolume
                                * muteRegionGainAt(sampleTimeSec, spb, stem.muteRegions);
                            if (isTail)
                            {
                                const double out =
                                    1.0 - (tailElapsedSec + (double) i2 / sampleRate) / kCycleSeamFadeSec;
                                if (out <= 0.0)
                                    break; // the tail is over; CycleTable drops it next block
                                gain *= out;
                            }
                            const int numCh = entry.buffer->getNumChannels();
                            const float l = entry.buffer->getSample(0, srcSample);
                            const float r = numCh > 1 ? entry.buffer->getSample(1, srcSample) : l;
                            stemOutL[i2] += (float) (l * gain);
                            stemOutR[i2] += (float) (r * gain);
                        }
                    }

                    return true;
                };

                // A cycle replaced or removed at the top (a fold step, the row unfolding, a `now`
                // stage) was mid-tile at full gain there: its tail plays on beside whatever
                // follows -- the incoming cycle, which fades in from its origin over the same
                // 10 ms (addCycle: even a phased one, mid-tile there), or the straight stem below
                // -- so the change is a 10 ms crossfade, not a cut. A row folding in from
                // straight is the same the other way: the straight stem may be mid-tile at the
                // top, and its continuation (addStraight, the outgoing lap's) fades out beside the
                // incoming cycle; only while the row is folded, so the straight stem never plays
                // twice. The tail is in this stem's buffer before either path adds to it, and the
                // guard folds it into the channel even if neither path gets as far as finishStem.
                bool tailPlayed = false;
                const auto tailGuard = onScopeExit([&] {
                    if (tailPlayed && ! stemFinished)
                        finishStem();
                });
                if (stem.cycleRowKey != 0)
                    if (const auto* tail = cycleTable.findTail(stem.cycleRowKey, cycleStemHash))
                    {
                        if (tail->kind == CycleTable::TailKind::cycle)
                            tailPlayed = addCycle(tail->row.bars, tail->row.phaseBars, tail->originBars,
                                                  tail->startBars);
                        else if (cycleTable.find(stem.cycleRowKey) != nullptr)
                            tailPlayed = addStraight(tail->continueOffsetBars, tail->startBars);
                    }

                if (stem.cycleRowKey != 0)
                {
                    if (auto* cycle = cycleTable.find(stem.cycleRowKey))
                    {
                        const double originBars = CycleTable::originFor(*cycle, lapClock);
                        if (! addCycle(cycle->row.bars, cycle->row.phaseBars, originBars, -1.0))
                            continue;
                        finishStem();
                        continue;
                    }
                }

                if (! addStraight(0.0, -1.0))
                    continue;
                finishStem();
            }
            }

            // This channel's risers, generated straight into the channel's
            // own accumulator -- so they join the mix at exactly the point a
            // stem does, UPSTREAM of the channel's plugin chain (and so of
            // the master chain), which is what "the riser is a source on this
            // channel, not an effect on it" actually means in the signal
            // path. Because it happens here, inside the one renderBlock both
            // live playback (Transport.cpp) and offline export
            // (RenderExport.cpp) call, a bounce contains the riser for free
            // and contains exactly the riser that was heard.
            //
            // A riser feeds the shared reverb bus only when it carries a send
            // (EngineRiser::send, from radio's riser character -- Task 6; a
            // hand-drawn riser has none). Such a riser renders into the stem
            // scratch first (the one stem at a time is done by now), which is
            // then added into the channel and sent, post-level, at a fixed
            // gain. A riser without a send renders straight into the channel
            // exactly as before. A reverb reached through this channel's
            // plugin chain still applies to both.
            //
            // Skipped on one bool test for a project with no risers, and
            // inside that, on one map lookup for a channel with none -- so
            // the ordinary case adds nothing measurable to the callback.
            if (snap->anyRisers)
            {
                const auto risersHere = snap->riserGroups.find(channelId);
                if (risersHere != snap->riserGroups.end())
                {
                    for (const auto& placed : risersHere->second)
                    {
                        if (placed.riser->send > 0.0 && runReverbBus)
                            renderSendingRiser(*snap, *placed.riser, *placed.voice, blockStartSec, sampleRate, spb,
                                               numSamples, chOutL, chOutR);
                        else
                            placed.voice->render(
                                *placed.riser, blockStartSec, sampleRate, spb, numSamples, chOutL, chOutR);
                    }
                }
            }
        }

        // The drum-keyed pump: every key stem has been rendered by now, whatever channel it is
        // on, so the key is complete. One pass ducks each channel's pumped buffer and adds it
        // into that channel, BEFORE the channel plugin chains below (the pumped rows are dry
        // signal, like the rest of the channel). pump.dsp works sample by sample with no
        // look-ahead, so this block's key is exactly the key for this block. Run every block the
        // pump is on, pumped samples or not, so its envelope follows the key continuously.
        // A releasing block runs at depth 0 (pumpDepthDb is 0 for such a snapshot).
        if (routePump)
            drumPump.process(sampleRate, snap->pumpDepthDb, numSamples, snap->scratchKeyL.data(),
                             snap->scratchKeyR.data(), snap->pumpTargets.data(), snap->pumpTargets.size());
        else
            drumPump.idle();

        // Run each channel's own chain, then add the result into the real
        // output -- a channel with no chain published is a pure passthrough,
        // so this stays byte-identical to the pre-toolkit direct sum for an
        // ordinary project. The toolkit is NOT here any more: it now runs per
        // clip, upstream of this, before a clip's samples ever reach its
        // channel (spec section 2b). One consequence worth naming: a clip's
        // reverb send is tapped BEFORE the channel's plugin chain now, where
        // it used to be tapped after -- the built-in toolkit is a per-clip
        // strip feeding the channel, not a channel strip.
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

        // The dub echo, BEFORE the reverb's end, so its 0.15 into the room (kDubToReverb, the
        // web's toReverb) is in this block's reverb input; its wet signal joins the master sum
        // here, beside the reverb's, as the web's dub output joins the master input. The room is
        // fed every block the echo runs, silence included, as a sending riser's is: the cavern's
        // convolver frames its input from the first block it is fed, so starting the feed only
        // where the echo first sounds would hang the room's framing on the host's block split.
        if (runDub)
            processDubEcho(*snap, sampleRate, numSamples, outL, outR);

        // Adds the wet reverb on top of the summed dry mix. A no-op leaving
        // outL/outR bit-identical if nothing was actually sent this block.
        if (runReverbBus)
            reverbBus.endBlock(numSamples, outL, outR);

        // ...and LAST, one filter over the whole mix (spec 4A.3).
        //
        // Deliberately AFTER the reverb's wet add rather than between the
        // channel sum and endBlock, which is the one place this departs from
        // the spec's own sketch of where to put it. A master filter that
        // left the reverb tail unfiltered would sweep the mix down and leave
        // a bright wash sitting on top of nothing, which is not what "over
        // the whole mix" means to anyone performing with it; here, closing
        // the filter closes the room with it.
        //
        // One wart, named rather than hidden: an ENABLED metronome click is
        // added into this same pair near the top of this function, so it is
        // filtered too. Separating it would need a second accumulator for
        // the whole mix, and the metronome is off in Discover/radio, which
        // is the only surface this control has. (On the no-content early
        // return above, the click is not filtered at all -- there is no mix
        // there to filter.)
        applyMasterFilter(snap->project.masterFilter, sampleRate, numSamples, outL, outR);
    }

    void PlaybackEngine::processDubEcho(const ProjectSnapshot& snap, double sampleRate, int numSamples,
                                        float* outL, float* outR) const
    {
        dubBus.process(sampleRate, snap.project.sound.dub, snap.project.bpm, numSamples);
        const float* wetL = dubBus.wetLeft();
        const float* wetR = dubBus.wetRight();
        for (int i = 0; i < numSamples; ++i)
        {
            outL[i] += wetL[i];
            outR[i] += wetR[i];
        }
        // The web's toReverb GainNode: a constant float multiply.
        reverbBus.addSendConstant(numSamples, wetL, wetR, kDubToReverb);
    }

    bool PlaybackEngine::routeToPumped(const ProjectSnapshot& snap, EngineStem::PumpRole role, size_t channel,
                                       bool& pumpedReady, int numSamples, const float* stemL, const float* stemR,
                                       float* chOutL, float* chOutR) const
    {
        if (role != EngineStem::PumpRole::pumped)
            return false;
        auto& pL = snap.scratchPumpL[channel];
        auto& pR = snap.scratchPumpR[channel];
        if (!pumpedReady)
        {
            sizeScratch(pL, (size_t) numSamples);
            sizeScratch(pR, (size_t) numSamples);
            std::fill(pL.begin(), pL.end(), 0.0f);
            std::fill(pR.begin(), pR.end(), 0.0f);
            pumpedReady = true;
            snap.pumpTargets.push_back({ pL.data(), pR.data(), chOutL, chOutR });
        }
        for (int i = 0; i < numSamples; ++i)
        {
            pL[(size_t) i] += stemL[i];
            pR[(size_t) i] += stemR[i];
        }
        return true;
    }

    void PlaybackEngine::addToKey(const ProjectSnapshot& snap, EngineStem::PumpRole role, int numSamples,
                                  const float* stemL, const float* stemR)
    {
        if (role != EngineStem::PumpRole::key)
            return;
        float* kL = snap.scratchKeyL.data();
        float* kR = snap.scratchKeyR.data();
        for (int i = 0; i < numSamples; ++i)
        {
            kL[i] += stemL[i];
            kR[i] += stemR[i];
        }
    }

    void PlaybackEngine::applyMasterFilter(
        const EngineProject::MasterFilterSettings& settings,
        double sampleRate,
        int numSamples,
        float* outL,
        float* outR) const
    {
        // The committed project value, overridden by whatever set-live-param
        // last pushed. That override is how a DRAGGED sweep reaches the audio
        // thread without a whole load-project per frame -- the established
        // rule is that a curve is for a gesture that must land on a beat and
        // a live-param is for a hand on a control, and this is a hand on a
        // control. The mode has no override on purpose: flipping a topology
        // is a click, not a drag, so it rides the next project reload.
        const auto mode = settings.mode;
        const float neutral = (float) neutralCutoffValue(mode);
        float cutoff01 = (float) settings.cutoff;
        float resonance01 = (float) settings.resonance;
        if (const auto ov = liveParamOverrides.masterFilterCutoffFor())
            cutoff01 = *ov;
        if (const auto ov = liveParamOverrides.masterFilterResonanceFor())
            resonance01 = *ov;

        // The SAME neutrality rule the per-clip filter uses, called on the
        // same function -- no automation here, so both automation flags are
        // false and the test reduces to "is the cutoff at this mode's own
        // open end". Resonance alone can never un-neutralise it, for the
        // reason channelFilterIsNeutral's own comment gives.
        const bool wantFilter = !channelFilterIsNeutral(mode, cutoff01, false, false);

        if (!wantFilter && !masterFilterEngaged)
            return; // the resting case: the master pair is not touched at all

        if (!masterFilterEngaged)
        {
            masterFilterEngaged = true;
            masterFilter.prepare(sampleRate, numSamples);
            // Engage AT neutral and let the smoother travel to the target,
            // so the first block of a sweep ramps in instead of stepping.
            masterFilter.resetTo(mode, neutral, resonance01);
        }

        masterFilter.prepare(sampleRate, numSamples);
        masterFilter.setTargets(mode, wantFilter ? cutoff01 : neutral, resonance01);
        masterFilter.process(numSamples, outL, outR);

        // Leaving the path is a ramp home, not a drop: only once the cutoff
        // smoother has actually ARRIVED at neutral does the filter come out,
        // and from the next block on the master pair is untouched again --
        // bit-identical to a project that never had a master filter. The
        // tolerance is the smoother's own arrival threshold, not the wire's:
        // a one-pole ramp approaches asymptotically and would otherwise
        // never compare exactly equal.
        if (!wantFilter && std::abs(masterFilter.currentCutoff01() - neutral) <= 1.0e-4f)
        {
            masterFilterEngaged = false;
            masterFilter.resetTo(mode, neutral, resonance01);
        }
    }

    void PlaybackEngine::renderSendingRiser(
        const ProjectSnapshot& snap,
        const EngineRiser& riser,
        RiserVoice& voice,
        double blockStartSec,
        double sampleRate,
        double secPerBar,
        int numSamples,
        float* chOutL,
        float* chOutR) const
    {
        // The scratch is sized the way a stem's own buffer is (prepareStemBuffer); every stem
        // of this channel is done by now, so it is free.
        auto& sL = snap.scratchStemL;
        auto& sR = snap.scratchStemR;
        sizeScratch(sL, (size_t) numSamples);
        sizeScratch(sR, (size_t) numSamples);
        std::fill(sL.begin(), sL.end(), 0.0f);
        std::fill(sR.begin(), sR.end(), 0.0f);
        if (voice.render(riser, blockStartSec, sampleRate, secPerBar, numSamples, sL.data(), sR.data()))
        {
            for (int i = 0; i < numSamples; ++i)
            {
                chOutL[i] += sL[(size_t) i];
                chOutR[i] += sR[(size_t) i];
            }
        }
        // Sent EVERY block, silence included, exactly as a sending clip's toolkit is (it runs
        // over silence too): the cavern's convolver frames its input from the first block it is
        // fed, so feeding only the blocks the riser sounds in would frame it from a block that
        // depends on the host's split, and the room would differ by a few ULPs between live and
        // an export. Fed from playback's first block, it is split-invariant to the bit
        // (NoiseRiserTests).
        //
        // The ParamSmoother is a stack local, rebuilt every block, deliberately: the send is a
        // constant, so reset() leaves it settled at `send` and every next() returns exactly
        // `send` (a settled smoother snaps to its target). It holds no state worth carrying
        // between blocks, costs one exp() per block, and allocates nothing.
        ParamSmoother sendGain;
        sendGain.reset(sampleRate, kAutomationSmoothingSec, (float) riser.send);
        reverbBus.addSend(numSamples, sL.data(), sR.data(), sendGain);
    }

    void PlaybackEngine::applyStemToolkit(
        const EngineStemToolkit& toolkit,
        const juce::String& stemKey,
        double pan,
        double positionBars,
        double secPerBar,
        double sampleRate,
        int numSamples,
        float* stemL,
        float* stemR) const
    {
        // Every parameter is evaluated once per block, at the bar this block
        // ENDS on (barAtSample with the block's own length), and the
        // smoothers travel toward it across the block. Aiming at the end
        // rather than the start is what removes a systematic one-block lag:
        // the smoother spends the block heading where the curve is going,
        // not where it has already been. Evaluating once per block rather
        // than per sample is what makes this affordable; the smoothing
        // (ParamSmoother, ~15ms) is what makes it inaudible that we did --
        // a block is ~12ms at 512/44.1k, so the ramp and the block rate are
        // the same order and the parameter never steps.
        //
        // The bar is made CLIP-RELATIVE first (minus originBar), because that
        // is the space the curve was drawn in: the lane sits on the clip's
        // own waveform, so bar 0 of the curve IS the clip's left edge. Moving
        // the clip moves originBar and nothing else, which is exactly why a
        // moved clip carries its automation unchanged.
        //
        // This is also the ONLY place automation is evaluated, and
        // renderBlock is the one function both live playback (Transport.cpp)
        // and offline export (RenderExport.cpp) call -- which is exactly how
        // the design doc's "offline render applies the toolkit identically to
        // live playback" requirement is met: not by two paths kept in sync,
        // but by there being one path.
        const double blockEndBar = barAtSample(positionBars, numSamples, sampleRate, secPerBar);
        const double targetBar = blockEndBar - toolkit.originBar;
        const auto evaluate = [&](const std::vector<AutomationPoint>& curve, double staticValue) {
            return (float) evaluateAutomation(curve, targetBar, staticValue);
        };
        const float cutoffTarget = evaluate(toolkit.automation.filterCutoff, toolkit.filterCutoff);
        const float resonanceTarget = evaluate(toolkit.automation.filterResonance, toolkit.filterResonance);
        const float sendTarget = evaluate(toolkit.automation.reverbSend, toolkit.reverbSend);
        const float volumeTarget = evaluate(toolkit.automation.volume, toolkit.volume);

        // Keyed by the CLIP's own identity, so a moved, re-channelled or
        // renamed clip keeps its filter running continuously while a
        // genuinely different clip (a duplicate, a re-import) starts clean
        // rather than inheriting a stale tail -- see stemDsp's doc comment.
        auto& entry = stemDsp[stemKey];
        if (entry == nullptr)
            entry = std::make_unique<StemDspState>();
        auto& dsp = *entry;

        dsp.filter.prepare(sampleRate, numSamples);
        if (!dsp.seeded)
        {
            // First block for this clip: jump to the evaluated values
            // rather than ramping up from a default, so a clip doesn't
            // audibly fade in or sweep open the first time it's heard. This
            // is also what makes an offline export bit-comparable to live
            // playback from the same start point -- RenderExport builds a
            // fresh PlaybackEngine, so it takes this same first-block branch
            // at bar 0 exactly as a fresh live session does.
            // Seeded from the block's START bar, not the end bar the ongoing
            // targets use: this is "where the curve is right now", the value
            // the very first sample should already be at.
            const double seedBar = positionBars - toolkit.originBar;
            const auto seed = [&](const std::vector<AutomationPoint>& curve, double staticValue) {
                return (float) evaluateAutomation(curve, seedBar, staticValue);
            };
            dsp.filter.resetTo(
                toolkit.filterMode,
                seed(toolkit.automation.filterCutoff, toolkit.filterCutoff),
                seed(toolkit.automation.filterResonance, toolkit.filterResonance));
            dsp.sendSmoother.reset(
                sampleRate, kAutomationSmoothingSec, seed(toolkit.automation.reverbSend, toolkit.reverbSend));
            dsp.volumeSmoother.reset(
                sampleRate, kAutomationSmoothingSec, seed(toolkit.automation.volume, toolkit.volume));
            dsp.seeded = true;
        }

        dsp.filter.setTargets(toolkit.filterMode, cutoffTarget, resonanceTarget);
        dsp.sendSmoother.setTarget(sendTarget);
        dsp.volumeSmoother.setTarget(volumeTarget);

        dsp.filter.process(numSamples, stemL, stemR);

        // Volume before the send tap: a post-fader send, so turning a clip
        // down turns its reverb down with it (the behaviour every mixer has,
        // and the one that makes a volume automation dip actually sound like
        // the clip receding rather than like its reverb suddenly
        // dominating).
        if (!(dsp.volumeSmoother.current() == 1.0f && dsp.volumeSmoother.isSettled()))
        {
            for (int i = 0; i < numSamples; ++i)
            {
                const float g = dsp.volumeSmoother.next();
                stemL[i] *= g;
                stemR[i] *= g;
            }
        }
        else
        {
            dsp.volumeSmoother.advance(numSamples);
        }

        // The row's pan, after the volume and BEFORE the send tap: the web
        // pans its rows ahead of their reverb send, so a row panned right
        // sends more to the room's right input. 0 touches nothing.
        applyStemPan(pan, numSamples, stemL, stemR);

        reverbBus.addSend(numSamples, stemL, stemR, dsp.sendSmoother);
    }
}

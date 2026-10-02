// native-engine/Source/PlaybackEngine.h
#pragma once
#include "EngineProject.h"
#include "NoiseRiser.h"
#include "StemBufferCache.h"
#include "ChannelChainRegistry.h"
#include "LiveParamOverrides.h"
#include "MasterStage.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>
#include <map>
#include <memory>

namespace sssketch
{
    class PlaybackEngine
    {
    public:
        explicit PlaybackEngine(StemBufferCache& bufferCache);

        PlaybackEngine(const PlaybackEngine&) = delete;
        PlaybackEngine& operator=(const PlaybackEngine&) = delete;

        /** Replaces the current project. Loads every stem's audio into
         * bufferCache up front (mirrors AudioEngine.ts loading buffers before
         * scheduling) — a stem whose file fails to load is silently skipped
         * during rendering, not fatal to the whole project, matching
         * AudioEngine.ts's per-stem try/catch. Builds a brand-new
         * ProjectSnapshot and publishes it via std::atomic_store_explicit --
         * see ProjectSnapshot's own doc comment for why. Safe to call at
         * high frequency (e.g. live volume dragging during playback, see
         * docs/superpowers/specs/2026-08-04-live-drag-preview-design.md) --
         * this used to be a plain, unsynchronized member reassignment racing
         * against the real-time audio thread's own concurrent read, flagged
         * but never fixed in native-engine/PHASE3_FINDINGS.md. A first
         * attempt at fixing it (raw atomic<T*> + a detached thread deleting
         * the superseded snapshot, mirroring ChannelChainRegistry's own
         * pattern) turned out to still be unsafe under sustained load --
         * see published's own doc comment for why shared_ptr replaced it. */
        void setProject(const EngineProject& project);

        /** What applyStagedProject() actually did -- three outcomes, not two,
         * because "nothing was waiting" and "something was waiting but this
         * was not a safe moment to take it" need different treatment by the
         * caller: the first means stop asking until the next loop top, the
         * second means ask again next block. */
        enum class StagedApply
        {
            None,     // nothing staged
            Applied,  // the staged snapshot is now the published one
            Deferred  // staged, but the previous retirement hasn't been collected yet
        };

        /** MESSAGE THREAD. Does everything setProject() does -- decodes every
         * stem into StemBufferCache, builds the whole ProjectSnapshot with
         * its derived channel/riser groups and scratch space -- and then
         * PARKS it instead of publishing it. The audio thread promotes it
         * later, at a moment of its own choosing, via applyStagedProject().
         *
         * Why (2026-09-29): Discover radio swaps one layer of a live loop,
         * and every part of that change except the moment itself had already
         * been made fast (prefetch, preloadStem, one decode per stem). The
         * change still landed audibly late because the renderer can only
         * begin the work at the loop top -- commit, React render, stretch
         * resolve, rAF, socket write all happen AFTER the instant the new
         * stem should already have been sounding. Measured: load-project
         * arrived 0.020-0.222 bar past the loop top, every single time,
         * never before it. No amount of further renderer optimisation fixes
         * that, because the clock starts at zero-hour. The fix is to let the
         * renderer do all of it EARLY and hand the engine a finished project
         * with "apply this at the next loop top" attached.
         *
         * Replaces whatever was staged before (the caller is expected to
         * have told its own client about the supersession first). Does NOT
         * touch the published snapshot, the transport, the live overrides or
         * the channel chains -- those all stay the caller's job, exactly as
         * they are for setProject(). */
        void stageProject(const EngineProject& project);

        /** MESSAGE THREAD. Drops a staged project that hasn't been applied
         * yet. Returns true if one was actually still waiting -- false means
         * the audio thread got there first and the swap has already
         * happened, which the caller must report as "applied", not
         * "cancelled". Radio re-checks a pick's eligibility late and can
         * drop it; this is how a stale staged swap is stopped from firing. */
        bool cancelStagedProject();

        /** MESSAGE THREAD. Publishes the staged snapshot right now, without
         * waiting for a loop top, and returns true if there was one to
         * publish. The escape hatch for every case where waiting would mean
         * the change never lands at all (transport stopped, no loop set) or
         * lands absurdly late (the deadline expired because the loop top
         * went by while staging was still decoding). A missing change is
         * worse than a late one.
         *
         * Carries exactly setProject()'s own reclamation characteristics,
         * NOT applyStagedProject()'s: the snapshot this displaces may still
         * be referenced by an in-flight renderBlock() on the audio thread,
         * in which case that thread does the free. That is the status quo
         * for every load-project ever sent, and this is the rare fallback
         * path rather than the per-change one, so it is not worth a second
         * retirement mechanism. */
        bool promoteStagedProjectNow();

        /** AUDIO THREAD, and ONLY from a point with NO renderBlock() call in
         * flight -- in practice, Transport::renderLoopAware's lap boundary,
         * between the outgoing lap's render and the incoming lap's.
         *
         * That precondition is the whole safety argument, not a style
         * preference. renderBlock() holds its own reference-counted copy of
         * the published snapshot for exactly the duration of one call and
         * releases it before returning (see its own doc comment). So at a
         * point where none is running there is provably no audio-thread
         * reference to the outgoing snapshot outstanding, and none can
         * appear afterwards because it is no longer reachable through
         * `published`. Which means this function can hand the outgoing
         * snapshot to the message thread as the SOLE remaining owner, and
         * the message thread's drainRetiredProject() is then genuinely the
         * last release -- the destructor, and every buffer free inside it,
         * runs there and never on the audio callback.
         *
         * Nothing here allocates, frees, or waits on anything the message
         * thread could be holding for an unbounded time. It is four
         * reference-count adjustments through the same std::atomic_*
         * shared_ptr free functions renderBlock() already uses once per
         * block, and every one of them provably leaves the object it
         * touches with at least one other owner. Walk it: the outgoing
         * snapshot is displaced from `published` only after `retired`
         * already holds it; the incoming one is cleared from `staged` only
         * after `published` already holds it; and both function-locals die
         * with the other owner still standing.
         *
         * Returns Deferred, changing nothing, if the previous retirement
         * hasn't been collected yet -- writing a second snapshot into an
         * occupied retirement slot would drop the first one's last
         * reference HERE, which is exactly what this whole mechanism
         * exists to prevent. The message thread collects on its 30Hz
         * position timer, on its 750ms Link timer and on every inbound IPC
         * message, so an occupied slot at a loop top means the message
         * thread has been starved for an entire loop; the swap then lands
         * on the following block instead (the caller keeps asking), not
         * never. */
        [[nodiscard]]
        StagedApply applyStagedProject();

        /** MESSAGE THREAD. Releases whatever applyStagedProject() handed
         * back, destroying it here. Cheap and safe to call unconditionally
         * at any cadence -- one relaxed bool load when there is nothing to
         * collect. */
        void drainRetiredProject();

        /** MESSAGE THREAD. Whether a staged project is currently waiting. */
        bool hasStagedProject() const;

        /** How many times applyStagedProject() has actually swapped, since
         * process start. The message thread watches this for the edge that
         * means "the swap landed" -- there is no callback out of the audio
         * thread and there shouldn't be. */
        unsigned long long stagedApplyCount() const
        {
            return stagedApplies.load(std::memory_order_acquire);
        }

        /** How many times applyStagedProject() returned Deferred. Expected
         * to stay 0 forever; a non-zero value means the message thread went
         * unresponsive for a whole loop and is worth surfacing rather than
         * hiding. */
        unsigned long long stagedDeferralCount() const
        {
            return stagedDeferrals.load(std::memory_order_relaxed);
        }

        /** Decodes one stem into the shared StemBufferCache ahead of the
         * setProject() that will eventually name it -- the ONLY thing this
         * does, deliberately: exactly the bufferCache.load(path,
         * durationSec) call setProject already makes per stem, just earlier,
         * and nothing else. No snapshot is republished, no project state is
         * touched, nothing reaches the audio thread.
         *
         * Why it exists (2026-09-28): Discover radio's own prefetch already
         * warmed the download and the rubberband stretch a whole interval
         * before a change lands, and the change STILL audibly arrived late.
         * The last cold thing was this cache -- the engine had no way to
         * hear about a stem before being handed a whole project containing
         * it, so the read/decode/loop-sew of the incoming file happened at
         * the instant the change committed, on the message thread, inside
         * setProject.
         *
         * Message thread only, same as setProject -- StemBufferCache is
         * explicitly not safe for concurrent load()s (see its own doc
         * comment), and IpcConnection delivers every message on that one
         * thread, so preload-stem and load-project can never overlap.
         *
         * Returns whatever StemBufferCache::load returned: true if the stem
         * is now cached (including the already-cached case, which is a
         * cheap map lookup and no I/O at all), false if the path was empty,
         * missing or undecodable. A false is a normal, silent outcome, not
         * an error to report -- it simply leaves things exactly as they
         * were before this method existed, with setProject paying the read
         * later or renderBlock skipping the stem. */
        bool preloadStem(const juce::String& path, double durationSec);

        /** Renders numSamples of stereo output starting at absolute transport
         * position positionBars, into outL/outR (each numSamples long, must be
         * pre-zeroed by the caller — this function adds into them).
         * channelChains provides each channel's own 2-slot plugin chain (see
         * docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md)
         * -- a channel with no chain currently published (chainFor returns
         * nullptr) is a pure passthrough, identical to the pre-this-feature
         * direct-sum behaviour.
         *
         * Pure/deterministic for a project that uses no built-in toolkit
         * (no clip filter, no reverb send, no automation): nothing is
         * carried between calls on PlaybackEngine's own side, so it stays
         * safe to call repeatedly out of order (as the parity test does).
         * A project that DOES use the toolkit necessarily carries state
         * between calls — a filter has memory and a reverb has a tail; you
         * cannot have either without it — held in stemDsp/reverbBus
         * below. Those are only ever touched from the single rendering
         * thread (see their own doc comment), and a neutral project never
         * touches them at all, which is what keeps the out-of-order
         * guarantee true exactly where it was true before. */
        void renderBlock(
            double positionBars,
            double sampleRate,
            int numSamples,
            float* outL,
            float* outR,
            ChannelChainRegistry& channelChains) const;

        double secPerBar() const;

        /** The radio sound's master stage (MasterStage.h): headroom trim, then the true-peak
         * limiter. The ONE call both outputs make, after the user's master plugin slots and
         * before anything else touches the block -- Transport's device callback and
         * RenderExport's offline loop -- so live playback and a bounce cannot run different
         * mastering.
         *
         * AUDIO THREAD (or export's own thread), after the block's renderBlock call(s). Applies
         * the mastering settings of the snapshot the most recent renderBlock rendered: a staged
         * project swapped in mid-block brings its settings with it, and nothing here loads
         * `published` a second time. With no mastering in that snapshot it touches nothing
         * (today's output, bit for bit). */
        void processMaster(double sampleRate, int numSamples, float* outL, float* outR);

        /** MESSAGE THREAD (Transport::audioDeviceAboutToStart, RenderExport before setProject).
         * The rate processMaster will be called at. Rebuilds the master stage's instance for it
         * if one has been built already; otherwise only remembered, and setProject/stageProject
         * build one at it when a project first asks for mastering. Until told, 44.1 kHz -- the
         * transport's own default rate and the export's. */
        void prepareMaster(double sampleRate);

        /** AUDIO THREAD, with no processMaster in flight. See MasterStage::reset: Transport
         * calls it when a stop or pause has finished fading out, and when the device (re)starts
         * (audioDeviceAboutToStart, before any callback). */
        void resetMaster() { masterStage.reset(); }

        /** AUDIO THREAD. See MasterStage::currentLatencySamples: 75 while the master stage's
         * limiter is in the output, else 0. Transport's seek holds at silence this much longer. */
        int masterLatencySamples() const { return masterStage.currentLatencySamples(); }

        /** Blocks processMaster passed through because no instance at their rate was ready. */
        unsigned long long masterRateMismatchCount() const { return masterStage.rateMismatchCount(); }

        /** A copy of the project most recently passed to setProject(), for
         * the render-export IPC handler to render "whatever was last
         * loaded" without inventing a second way to pass project data.
         * Deliberately returned BY VALUE, not by reference into the
         * published snapshot -- render-export (RenderExport.cpp) holds onto
         * this across a long, synchronous operation (plugin loading + a
         * full offline render), unlike renderBlock()'s own single load-and-
         * read-within-one-call pattern. A reference would only be safe for
         * as long as no other setProject() call republishes (and eventually
         * frees) the snapshot it points into -- true today only by the
         * accidental, undocumented invariant that this connection's message
         * handling is single-threaded and synchronous, so a live-drag
         * volume push can never actually interleave with an in-progress
         * export. Returning a copy removes the dependency on that invariant
         * entirely, at the cost of one non-real-time-thread copy per export
         * request (cheap -- this is metadata, not audio; stem audio lives
         * in StemBufferCache, not inside EngineProject itself). */
        EngineProject currentProjectForExport() const
        {
            return std::atomic_load_explicit(&published, std::memory_order_acquire)->project;
        }

        /** Toggled by the 'set-metronome' IPC message — off by default, so a
         * freshly-constructed engine (including RenderExport's own, offline)
         * never includes the click unless explicitly turned on. Live
         * playback and offline export share this same renderBlock, but
         * export always uses its own fresh PlaybackEngine instance (see
         * RenderExport.cpp), so this defaulting to false there is automatic
         * — the metronome is a practice aid, not part of the actual mix. */
        void setMetronomeEnabled(bool enabled) { metronomeEnabled = enabled; }
        bool isMetronomeEnabled() const { return metronomeEnabled; }

        /** Message-thread API: called by IpcServer's set-live-param handler
         * to push a new live volume/fade value, and by its load-project
         * handler to clear all overrides once a fresh project has been
         * published -- see LiveParamOverrides's own doc comment. */
        LiveParamOverrides& liveOverrides() { return liveParamOverrides; }

        /** Audio-thread API: renderBlock() reads through this const
         * overload. */
        const LiveParamOverrides& liveOverrides() const { return liveParamOverrides; }

    private:
        /** Bundles the project together with every derived structure that
         * points INTO it (channelGroups) or is sized FROM it
         * (scratchChannelL/R/Ids) into one immutable-once-published unit --
         * these can't be independently atomic-swapped without reintroducing
         * a race between the two swaps landing at different times. Mirrors
         * ChannelChainRegistry's own published-map pattern in spirit
         * (setProject() builds a whole new ProjectSnapshot on the heap and
         * publishes it in one atomic operation; renderBlock() loads the
         * current snapshot once, at the top of the call, and reads
         * everything through it for the rest of that one call -- never
         * touches a shared mutable field directly) but NOT in reclamation
         * mechanism -- see published's own doc comment below for why. */
        struct ProjectSnapshot
        {
            EngineProject project;

            // Groups project.rifffs by channelId. Pointers into THIS
            // snapshot's OWN project.rifffs vector -- never the previous
            // snapshot's -- so they stay valid for exactly this
            // snapshot's own lifetime.
            //
            // A channel carrying ONLY risers gets an entry here too, with an
            // empty vector: this map is what decides the channel set the
            // render loop walks and the scratch buffers are sized for, so a
            // riser-only row would otherwise be silently dropped (it has no
            // EngineRifff to be grouped by). Same reason selectors.ts's
            // channelsInOrder includes riser channels on the renderer side.
            std::map<juce::String, std::vector<const EngineRifff*>> channelGroups;

            // Groups project.risers by channelId, same lifetime and same
            // pointers-into-this-snapshot rule as channelGroups above. A
            // channelId absent from here simply has no risers on it.
            std::map<juce::String, std::vector<const EngineRiser*>> riserGroups;

            // Per-channel accumulation scratch for renderBlock() -- one
            // entry per channelGroups entry, in the same order. `mutable`:
            // renderBlock() reads a ProjectSnapshot through a const
            // pointer but still needs to write into this reused scratch
            // space every block -- same "logically const, physically
            // caching" reasoning this class used before this refactor,
            // just relocated. Still race-free: only one thread (the live
            // audio callback, or RenderExport's own single-threaded
            // offline instance -- never both, see renderBlock's own doc
            // comment) ever touches a GIVEN published snapshot's scratch
            // space, for as long as it stays published.
            mutable std::vector<std::vector<float>> scratchChannelL, scratchChannelR;
            mutable std::vector<juce::String> scratchChannelIds;

            // Per-stem scratch for one clip's own toolkit stage: the clip
            // renders into this, gets filtered/faded/tapped for send, and is
            // then added into its channel's buffer. ONE pair for the whole
            // snapshot, not one per stem -- a single rendering thread
            // processes exactly one stem at a time (see renderBlock's own doc
            // comment), so there is never a second live user. Untouched, and
            // never even sized, by a project with no toolkit usage.
            // `mutable` for the same reason the channel scratch above is.
            mutable std::vector<float> scratchStemL, scratchStemR;

            // True if ANY stem in the project has a non-neutral toolkit --
            // decided once here, in setProject, off the real-time thread (the
            // neutrality test is a pure function of the project). Lets
            // renderBlock skip the whole reverb-bus begin/end bracket with
            // one bool test, and is what keeps an ordinary project on exactly
            // the render path it was on before this feature existed. Each
            // stem's own EngineStem::hasToolkit is narrowed in the same pass,
            // so the per-stem check in the render loop is also one bool.
            bool anyToolkitActive = false;

            // True if this project has any riser at all -- decided once here,
            // off the real-time thread, so renderBlock's per-channel riser
            // cost for the overwhelmingly common no-riser case is one bool
            // test rather than a map lookup per channel per block. Exactly
            // the same shape (and the same purpose) as anyToolkitActive.
            bool anyRisers = false;
        };

        /** Per-CLIP toolkit DSP state: a filter has memory, a send has a
         * smoothed level. Deliberately NOT part of ProjectSnapshot, unlike
         * every other derived structure here: setProject() republishes a
         * whole new snapshot on every live volume-drag frame, and rebuilding
         * filter state at that rate would click on every mouse move.
         *
         * Keyed by stemKey (groupId:slot), which is the identity of the clip
         * itself -- so it survives republishing, moving the clip in time,
         * dragging it to another channel, renaming the rifff, or reordering
         * rows, and a DIFFERENT clip (a duplicate, a re-import, a stem
         * ungrouped onto a fresh groupId) gets its own fresh entry rather
         * than inheriting a stale filter tail from whatever used to be
         * there. That last part is the reason this is keyed by stemKey and
         * not, say, by resolvedPath: two clips of the same audio file are two
         * clips, with two filters.
         *
         * Only ever created, read or written by the single rendering thread
         * (the live audio callback, or RenderExport's own offline instance
         * -- never both, see renderBlock's doc comment), which is the same
         * invariant the scratch buffers rely on; setProject() never touches
         * this map, so there is nothing for it to race with.
         *
         * Entries are created lazily, on the first block a given channel
         * actually needs one -- so a project with no toolkit usage never
         * allocates a single one of these. That first creation does allocate
         * on the audio thread; accepted for the same reason the scratch
         * buffers' own first-use resize() is, and it is genuinely one-off
         * per channel rather than per block. Stale entries for channels that
         * no longer exist are left in place rather than pruned: pruning
         * would mean erasing from this map, and the only thread allowed to
         * do that is the one we least want doing bookkeeping. Channel counts
         * here are tens, not thousands. */
        struct StemDspState
        {
            ChannelFilter filter;
            ParamSmoother sendSmoother;
            ParamSmoother volumeSmoother;
            // False until the first block that renders this clip, which
            // JUMPS the smoothers to their evaluated values instead of
            // ramping up from zero -- otherwise every clip would fade in
            // over the smoothing time the first time it was heard.
            bool seeded = false;
        };

        /** One CLIP's toolkit stage, applied IN PLACE to the scratch buffer
         * that clip just rendered into, BEFORE it is summed into its channel:
         * evaluate the four automatable parameters at this block's bar
         * (clip-relative, via the toolkit's own originBar), filter, apply the
         * clip volume, pan it by the row's `pan` (StemPan.h; 0 touches
         * nothing), then tap a post-fader, post-pan send into the shared
         * reverb bus. Only ever called for a clip whose toolkit is
         * non-neutral (a panned clip without one is panned in renderBlock
         * and sends nothing). `const` for the same reason renderBlock is --
         * see stemDsp. */
        /** The master strip's filter, applied IN PLACE to the fully summed
         * master pair as the very last thing renderBlock does. Returns
         * immediately, touching nothing, whenever the filter is at rest and
         * has finished ramping there -- see masterFilterEngaged. `const` for
         * the same reason renderBlock and applyStemToolkit are. */
        void applyMasterFilter(
            const EngineProject::MasterFilterSettings& settings,
            double sampleRate,
            int numSamples,
            float* outL,
            float* outR) const;

        void applyStemToolkit(
            const EngineStemToolkit& toolkit,
            const juce::String& stemKey,
            double pan,
            double positionBars,
            double secPerBar,
            double sampleRate,
            int numSamples,
            float* stemL,
            float* stemR) const;

        StemBufferCache& bufferCache;

        // Owning, reference-counted pointer to the currently-live snapshot --
        // NOT std::atomic<const ProjectSnapshot*> (an earlier version of this
        // class used exactly that, paired with a detached std::thread doing
        // `delete old` on whatever the exchange returned). That scheme
        // relied on a scheduling heuristic ("the audio thread has certainly
        // moved on by the time the detached thread actually runs") that a
        // concurrent setProject()/renderBlock() stress test
        // (PlaybackEngineTests.cpp) proved FALSE under sustained load --
        // reliably reproducible EXC_BAD_ACCESS, the delete thread winning
        // the race against a renderBlock() call still reading the snapshot
        // being freed. A plain std::shared_ptr, accessed only via the
        // std::atomic_load_explicit/atomic_store_explicit free functions
        // (C++11; NOT std::atomic<std::shared_ptr<T>>, the C++20 built-in
        // atomic specialization -- unavailable in this project's libc++,
        // confirmed by a direct compile check: it requires the held type to
        // be trivially copyable, which shared_ptr never is), is genuinely
        // correct regardless of timing: std::atomic_load_explicit hands the
        // calling thread its OWN reference-counted copy, so the object
        // physically cannot be freed while renderBlock() (or anything else)
        // still holds that copy, no matter how many times or how fast
        // setProject() replaces `published` on another thread meanwhile.
        //
        // Known, deliberately-accepted tradeoff: unlike ChannelChainRegistry's
        // own std::atomic<const T*>::load() (genuinely lock-free -- confirmed
        // via atomic_is_lock_free), this project's actual libc++ implements
        // atomic_load_explicit/atomic_store_explicit for shared_ptr via a
        // real mutex from a small hashed pool (verified directly against
        // this toolchain's headers and by disassembly, not assumed) --
        // meaning renderBlock() takes a brief lock once per audio block,
        // contending against setProject() at whatever frequency it's called
        // (up to live-drag frequency). Accepted rather than hand-rolling a
        // lock-free reclamation scheme (e.g. hazard pointers) because: (1)
        // the critical section is a single pointer-pair swap plus a refcount
        // adjustment -- microseconds at most, several orders of magnitude
        // under a single audio block's own ~10ms budget even in the
        // contended case; (2) unlike the raw-pointer scheme this replaced,
        // there is no CONCRETE evidence of harm yet (that scheme's flaw was
        // proven by an actual crashing stress test; this one is a verified
        // mechanism, not a verified problem); and (3) building lock-free
        // reclamation by hand is real, easy-to-get-subtly-wrong systems code
        // that this project's own conventions discourage writing
        // preemptively, without concrete evidence it's actually needed (see
        // CLAUDE.md). If a manual listening test (see this feature's own
        // plan's Task 8) or a future report of glitching under sustained
        // live-dragging while playing DOES surface a real problem, that's
        // the trigger to revisit this with a genuinely lock-free scheme
        // (e.g. a single hazard-pointer slot, since renderBlock() is the
        // only ever-concurrent reader of a given instance -- see its own
        // doc comment) -- not before.
        std::shared_ptr<const ProjectSnapshot> published;

        /** Everything setProject() and stageProject() have in common: the
         * per-stem decode, the channel/riser grouping, the scratch sizing
         * and the toolkit-neutrality narrowing. Message thread only (it
         * writes into StemBufferCache, which is explicitly not safe for
         * concurrent load()s). Publishing is deliberately NOT part of it --
         * that is the one thing the two callers do differently. */
        std::shared_ptr<ProjectSnapshot> buildSnapshot(const EngineProject& project);

        /** MESSAGE THREAD -> AUDIO THREAD. A fully built, fully decoded
         * snapshot waiting for the next loop top. Written by
         * stageProject()/cancelStagedProject()/promoteStagedProjectNow() on
         * the message thread, taken by applyStagedProject() on the audio
         * thread. Empty means nothing is staged, which is the normal
         * resting state. Accessed only through the std::atomic_* shared_ptr
         * free functions, same as `published` above and for the same
         * reason. */
        std::shared_ptr<const ProjectSnapshot> staged;

        /** AUDIO THREAD -> MESSAGE THREAD. Whatever applyStagedProject()
         * displaced, parked here so that the message thread's
         * drainRetiredProject() is the last release and therefore the
         * thread that runs the destructor. See applyStagedProject()'s own
         * doc comment for why this is airtight rather than merely likely,
         * and why the audio thread refuses to swap at all while this is
         * occupied. */
        std::shared_ptr<const ProjectSnapshot> retired;

        /** Whether `retired` currently holds something. A plain bool flag
         * rather than testing `retired` itself, so the audio thread's
         * "is this a safe moment?" check is a genuinely lock-free atomic
         * load instead of a shared_ptr copy through libc++'s hashed mutex
         * pool (see published's own doc comment on that). Set true by the
         * audio thread only after it has stored into `retired`; set false
         * by the message thread only after it has cleared it. Those two
         * orderings, paired with acquire/release, are what make the flag
         * and the slot agree from both sides. */
        std::atomic<bool> retiredOccupied { false };

        std::atomic<unsigned long long> stagedApplies { 0 };
        std::atomic<unsigned long long> stagedDeferrals { 0 };

        bool metronomeEnabled = false;

        // See StemDspState's own doc comment for the threading and
        // lifetime rules these two live under. `mutable` for the same
        // "logically const, physically stateful" reason the scratch buffers
        // are: renderBlock() reads the engine through a const pointer but
        // real DSP cannot be stateless.
        mutable std::map<juce::String, std::unique_ptr<StemDspState>> stemDsp;

        /** Per-RISER live DSP -- only a bandpass, since a riser's source is
         * index-addressed and its envelope is a pure function of position
         * (see NoiseRiser.h). Keyed by the riser's own id, and living under
         * exactly the same threading, lifetime and lazy-creation rules as
         * stemDsp above: created on the first block a given riser actually
         * sounds in, never pruned, only ever touched by the single rendering
         * thread, and never constructed at all by a project with no risers. */
        mutable std::map<juce::String, std::unique_ptr<RiserVoice>> riserVoices;

        mutable ReverbBus reverbBus;

        /** ONE filter over the whole summed master pair -- the master strip's
         * swept filter (spec 2026-09-28-performance-mode-design.md §4A.3).
         * The same ChannelFilter class every clip's filter uses, so the
         * cutoff map, the resonance map, the smoothing time, the per-64-sample
         * coefficient recompute and the denormal flush are all literally the
         * same code rather than a parallel implementation.
         *
         * Held by VALUE, like reverbBus beside it: a default-constructed
         * ChannelFilter's juce::dsp::StateVariableTPTFilter has empty state
         * vectors and allocates nothing until prepare() is called, and
         * prepare() is only ever called on a block that actually engages the
         * filter. So a project that never touches the master filter pays no
         * allocation and no per-sample work -- the same "neutral costs
         * nothing" promise the toolkit already makes.
         *
         * `mutable` for the same "logically const, physically stateful"
         * reason reverbBus and stemDsp are, and under the same
         * single-rendering-thread invariant. */
        mutable ChannelFilter masterFilter;

        /** Whether the master filter is currently in the signal path.
         *
         * Not simply "is the cutoff non-neutral": releasing a sweep back to
         * its resting position has to RAMP home and only then leave the path,
         * or dropping a filter whose state still holds the sweep would click.
         * So this latches true the moment the cutoff leaves neutral and
         * latches false only once the smoother has actually arrived back at
         * neutral -- exactly the shape of `runReverbBus = anyToolkitActive ||
         * reverbBus.isRinging()`. While it is false the master pair is not
         * touched at all, which is what makes "resting" bit-identical rather
         * than nearly so. */
        mutable bool masterFilterEngaged = false;

        LiveParamOverrides liveParamOverrides;

        /** See processMaster. Its instance is built on the message thread (setProject,
         * stageProject, prepareMaster) and swapped in on the audio thread; drainRetiredProject
         * frees a swapped-out one. */
        MasterStage masterStage;
        std::atomic<double> masterRate { 44100.0 };

        /** The mastering settings of the snapshot the latest renderBlock call rendered, for
         * processMaster. Written and read only by the single rendering thread (the same
         * invariant as stemDsp); trivially copyable, so the write allocates nothing. */
        mutable std::optional<SoundSettings::Mastering> masterSettingsSeen;
    };
}

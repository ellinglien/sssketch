// native-engine/Source/PlaybackEngine.h
#pragma once
#include "EngineProject.h"
#include "StemBufferCache.h"
#include "ChannelChainRegistry.h"
#include "LiveParamOverrides.h"
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
         * (no channel filter, no reverb send, no automation): nothing is
         * carried between calls on PlaybackEngine's own side, so it stays
         * safe to call repeatedly out of order (as the parity test does).
         * A project that DOES use the toolkit necessarily carries state
         * between calls — a filter has memory and a reverb has a tail; you
         * cannot have either without it — held in channelDsp/reverbBus
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
            std::map<juce::String, std::vector<const EngineRifff*>> channelGroups;

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

            // Parallel to scratchChannelIds: this channel's own toolkit
            // settings, or nullptr when the channel is neutral (no filter
            // off its mode's open end, no send, unity volume, no curves).
            // Resolved HERE, in setProject, rather than per block in
            // renderBlock: the neutrality test and the channelId lookup are
            // both pure functions of the project, so doing them once per
            // project change instead of once per channel per block keeps
            // renderBlock's toolkit cost at a single pointer check for the
            // overwhelmingly common all-neutral case. Points into THIS
            // snapshot's own project.channelToolkits, same lifetime rule as
            // channelGroups above.
            std::vector<const EngineProject::EngineChannelToolkit*> channelToolkits;

            // True if any entry above is non-null -- lets renderBlock skip
            // the whole reverb-bus begin/end bracket with one bool test.
            bool anyToolkitActive = false;
        };

        /** Per-channel toolkit DSP state: a filter has memory, a send has a
         * smoothed level. Deliberately NOT part of ProjectSnapshot, unlike
         * every other per-channel derived structure here: setProject()
         * republishes a whole new snapshot on every live volume-drag frame,
         * and rebuilding filter state at that rate would click on every
         * mouse move. Keyed by channelId so it survives republishing,
         * rechannelling and reordering.
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
        struct ChannelDspState
        {
            ChannelFilter filter;
            ParamSmoother sendSmoother;
            ParamSmoother volumeSmoother;
            // False until the first block that renders this channel, which
            // JUMPS the smoothers to their evaluated values instead of
            // ramping up from zero -- otherwise every channel would fade in
            // over the smoothing time the first time it was heard.
            bool seeded = false;
        };

        /** One channel's toolkit stage, applied IN PLACE to its already-summed
         * (and already-plugin-chained) scratch buffer: evaluate the four
         * automatable parameters at this block's start bar, filter, apply the
         * channel volume, then tap a post-fader send into the shared reverb
         * bus. Only ever called for a channel whose toolkit is non-neutral.
         * `const` for the same reason renderBlock is -- see channelDsp. */
        void applyChannelToolkit(
            const EngineProject::EngineChannelToolkit& toolkit,
            const juce::String& channelId,
            double positionBars,
            double secPerBar,
            double sampleRate,
            int numSamples,
            float* chL,
            float* chR) const;

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

        bool metronomeEnabled = false;

        // See ChannelDspState's own doc comment for the threading and
        // lifetime rules these two live under. `mutable` for the same
        // "logically const, physically stateful" reason the scratch buffers
        // are: renderBlock() reads the engine through a const pointer but
        // real DSP cannot be stateless.
        mutable std::map<juce::String, std::unique_ptr<ChannelDspState>> channelDsp;
        mutable ReverbBus reverbBus;

        LiveParamOverrides liveParamOverrides;
    };
}

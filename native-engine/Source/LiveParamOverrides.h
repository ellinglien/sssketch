// native-engine/Source/LiveParamOverrides.h
#pragma once
#include <atomic>
#include <juce_core/juce_core.h>
#include <memory>
#include <optional>
#include <unordered_map>

namespace sssketch
{
    /** Holds in-progress "live" parameter values for an active volume/fade
     * drag, entirely separate from EngineProject/PlaybackEngine's own
     * published ProjectSnapshot -- see docs/superpowers/specs/
     * 2026-08-04-live-param-fast-path-design.md. Exists because pushing a
     * live value through a full setProject() reload (rebuilding the whole
     * project's scheduling state from scratch) at drag frequency (up to
     * ~60Hz) turned out to cause real, audible glitching -- confirmed by
     * manual testing, not theoretical. This class lets the message thread
     * update just one value at a time, cheaply, while the audio thread
     * checks for an override alongside its normal (committed) reads.
     *
     * Three independently-published maps -- volume keyed by stemKey
     * (EngineStem::stemKey), fadeIn/fadeOut each keyed by groupId
     * (EngineRifff::groupId) -- publishing each one the same way
     * PlaybackEngine's own `published` field does: a plain
     * std::shared_ptr<const std::unordered_map<...>>, accessed only via
     * std::atomic_load_explicit/atomic_store_explicit (NOT
     * std::atomic<std::shared_ptr<T>>, the C++20 built-in specialization --
     * confirmed unavailable in this project's libc++ during the
     * live-drag-preview work, since it requires the held type to be
     * trivially copyable). Each setter rebuilds a small new map (1-8
     * entries typically, matching however many stems are in the dragged
     * rifff -- an Endlesss rifff caps at 8 stem slots) and publishes it --
     * still dramatically cheaper than a full project reload, since nothing
     * about the rest of the project is touched.
     *
     * NOT an exact mirror of PlaybackEngine's pattern, though -- one real
     * difference: setOverride() (see the .cpp) does a read-modify-write
     * (load the current map, copy it, mutate the copy, publish it), unlike
     * PlaybackEngine::setProject(), which only ever WRITES, never reads its
     * own prior `published` value first. A read-modify-write is only safe
     * under a SINGLE-WRITER invariant -- two threads calling
     * setVolumeOverride() concurrently could race and lose one of the two
     * updates (memory_order_acquire/release only orders individual
     * load/store operations relative to each other; it does not make the
     * load+mutate+store sequence atomic as a whole). This class currently
     * relies entirely on its callers for that invariant -- satisfied today
     * by IpcServer.cpp's set-live-param/load-project handlers (see
     * docs/superpowers/plans/2026-08-04-live-param-fast-path-implementation.md's
     * Task 3, landed), since juce::InterprocessConnection's
     * `callbacksOnMessageThread` defaults to true, funneling every
     * connection's messageReceived() through the single global
     * MessageManager queue, processed strictly one at a time, so those
     * handlers can never call a setter concurrently with each other. If a
     * future caller ever writes from a genuinely different thread instead,
     * this read-modify-write would need a compare-and-swap retry loop.
     *
     * clearAll() is meant to be called by IpcServer's own load-project
     * handler, right after every setProject() call (see
     * docs/superpowers/plans/2026-08-04-live-param-fast-path-implementation.md's
     * Task 3) -- that's the ENTIRE intended mechanism by which a live
     * override eventually gets cleared. No explicit "clear" call from the
     * renderer's own drag handlers is needed or sent: the override holds
     * the exact final dragged value for as long as it takes the drag's own
     * commit dispatch to trigger a full reload (already guaranteed, since
     * the committed fields are already in that effect's dependency array),
     * and since the override and the eventual reload always agree on the
     * value by construction, the handoff between them is inaudible. */
    class LiveParamOverrides
    {
    public:
        LiveParamOverrides();

        LiveParamOverrides(const LiveParamOverrides&) = delete;
        LiveParamOverrides& operator=(const LiveParamOverrides&) = delete;

        /** Message-thread API. value == std::nullopt clears that one key
         * (kept for symmetry/testability -- the renderer's own drag
         * handlers never need to call with std::nullopt, see this class's
         * own doc comment on clearAll() above). */
        void setVolumeOverride(const juce::String& stemKey, std::optional<float> value);
        void setFadeInOverride(const juce::String& groupId, std::optional<float> value);
        void setFadeOutOverride(const juce::String& groupId, std::optional<float> value);

        /** Message-thread API: clears all three maps at once. */
        void clearAll();

        /** Audio-thread API: std::nullopt means "no override, use the
         * committed value." One atomic load + one hash lookup each, never
         * allocates. NOT lock-free, though, despite the "atomic" name --
         * this project's actual libc++ implements
         * atomic_load_explicit/atomic_store_explicit for shared_ptr via a
         * real (if very short) mutex from a small hashed pool, confirmed
         * directly against the shipped headers, not assumed
         * (atomic_is_lock_free<shared_ptr<T>> is hardcoded false there).
         * renderBlock() only calls these when hasAnyOverride() (below) is
         * true -- i.e. only once per stem, twice per rifff, while
         * something is ACTIVELY being dragged, not on every block for the
         * entire lifetime of playback the way an earlier version of this
         * comment described (that was true before hasAnyOverride() existed
         * to gate these calls -- see its own doc comment). The mutex-based
         * cost is accepted for the same reason PlaybackEngine's own
         * `published` field's identical tradeoff was: the critical section
         * is a single pointer-pair swap plus a refcount adjustment --
         * microseconds at most, several orders of magnitude under a single
         * audio block's own ~10ms budget even when genuinely contended.
         * See PlaybackEngine.h's own `published` field doc comment for the
         * fuller reasoning and what to reconsider if this ever proves to
         * matter in practice. Note this class's own fast-exit doesn't
         * cover PlaybackEngine's own `published` snapshot load, which
         * still uses the identical mechanism unconditionally on EVERY
         * block regardless of dragging (there's no override to gate it on
         * -- a fresh snapshot is always needed) -- if glitching persists
         * independent of active dragging, that's the next place to look,
         * not here. */
        std::optional<float> volumeFor(const juce::String& stemKey) const;
        std::optional<float> fadeInFor(const juce::String& groupId) const;
        std::optional<float> fadeOutFor(const juce::String& groupId) const;

        /** Audio-thread API: a single, genuinely lock-free check for whether ANY
         * override is currently set, across all three fields. Intended to let
         * renderBlock() skip volumeFor()/fadeInFor()/fadeOutFor() -- and their
         * mutex-based cost -- entirely when nothing is being dragged. */
        bool hasAnyOverride() const { return overrideCount.load(std::memory_order_acquire) > 0; }

    private:
        using OverrideMap = std::unordered_map<juce::String, float>;

        static void setOverride(
            std::shared_ptr<const OverrideMap>& published,
            std::atomic<int>& overrideCount,
            const juce::String& key,
            std::optional<float> value);
        static std::optional<float> overrideFor(
            const std::shared_ptr<const OverrideMap>& published,
            const juce::String& key);

        std::shared_ptr<const OverrideMap> volumeOverrides;
        std::shared_ptr<const OverrideMap> fadeInOverrides;
        std::shared_ptr<const OverrideMap> fadeOutOverrides;

        // Genuinely lock-free (plain std::atomic<int>, NOT the shared_ptr-based
        // maps above) running count of how many keys are currently overridden,
        // summed across all three maps -- incremented/decremented by setOverride()
        // whenever a key transitions into/out of existence, reset to 0 by
        // clearAll(). Lets hasAnyOverride() answer "is anything overridden right
        // now" with a single, cheap, non-blocking load, so renderBlock() can skip
        // volumeFor()/fadeInFor()/fadeOutFor() -- and the mutex-based cost each
        // one carries, see their own doc comment -- entirely during ordinary
        // playback, when nothing is actively being dragged (the overwhelming
        // majority of the time).
        std::atomic<int> overrideCount { 0 };
    };
}

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
     * relies entirely on its callers for that invariant: every writer
     * (IpcServer.cpp's set-live-param/load-project handlers) runs on the
     * same message thread, since juce::InterprocessConnection's
     * `callbacksOnMessageThread` defaults to true and funnels every
     * connection's messageReceived() through the single global
     * MessageManager queue, processed strictly one at a time -- so
     * concurrent WRITERS genuinely cannot happen today. If that ever
     * changes (e.g. a future caller writes from a different thread), this
     * read-modify-write would need a compare-and-swap retry loop instead.
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
         * blocks (mirrors PlaybackEngine's own atomic_load_explicit
         * usage), never allocates. */
        std::optional<float> volumeFor(const juce::String& stemKey) const;
        std::optional<float> fadeInFor(const juce::String& groupId) const;
        std::optional<float> fadeOutFor(const juce::String& groupId) const;

    private:
        using OverrideMap = std::unordered_map<juce::String, float>;

        static void setOverride(
            std::shared_ptr<const OverrideMap>& published,
            const juce::String& key,
            std::optional<float> value);
        static std::optional<float> overrideFor(
            const std::shared_ptr<const OverrideMap>& published,
            const juce::String& key);

        std::shared_ptr<const OverrideMap> volumeOverrides;
        std::shared_ptr<const OverrideMap> fadeInOverrides;
        std::shared_ptr<const OverrideMap> fadeOutOverrides;
    };
}

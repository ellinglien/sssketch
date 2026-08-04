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
     * (EngineRifff::groupId) -- mirroring PlaybackEngine's own `published`
     * field pattern exactly: a plain std::shared_ptr<const
     * std::unordered_map<...>>, accessed only via
     * std::atomic_load_explicit/atomic_store_explicit (NOT
     * std::atomic<std::shared_ptr<T>>, the C++20 built-in specialization --
     * confirmed unavailable in this project's libc++ during the
     * live-drag-preview work, since it requires the held type to be
     * trivially copyable). Each setter rebuilds a small new map (1-8
     * entries typically, matching however many stems are in the dragged
     * rifff) and publishes it -- still dramatically cheaper than a full
     * project reload, since nothing about the rest of the project is
     * touched.
     *
     * clearAll() is called by IpcServer's own load-project handler, right
     * after every setProject() call -- that's the ENTIRE mechanism by
     * which a live override eventually gets cleared. No explicit "clear"
     * call from the renderer's own drag handlers is needed or sent: the
     * override holds the exact final dragged value for as long as it
     * takes the drag's own commit dispatch to trigger a full reload
     * (already guaranteed, since the committed fields are already in that
     * effect's dependency array), and since the override and the eventual
     * reload always agree on the value by construction, the handoff
     * between them is inaudible. */
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

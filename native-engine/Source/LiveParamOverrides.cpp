// native-engine/Source/LiveParamOverrides.cpp
#include "LiveParamOverrides.h"

namespace sssketch
{
    LiveParamOverrides::LiveParamOverrides()
        : volumeOverrides(std::make_shared<const OverrideMap>()),
          fadeInOverrides(std::make_shared<const OverrideMap>()),
          fadeOutOverrides(std::make_shared<const OverrideMap>())
    {
        // Plain (non-atomic) initialization is safe here -- no other thread
        // can possibly observe `this` until construction completes and a
        // reference is handed out, matching PlaybackEngine's own
        // constructor's identical reasoning for its `published` field.
    }

    void LiveParamOverrides::setOverride(
        std::shared_ptr<const OverrideMap>& published,
        const juce::String& key,
        std::optional<float> value)
    {
        const auto current = std::atomic_load_explicit(&published, std::memory_order_acquire);
        auto next = std::make_shared<OverrideMap>(*current);
        if (value.has_value())
            (*next)[key] = *value;
        else
            next->erase(key);
        std::atomic_store_explicit(
            &published, std::shared_ptr<const OverrideMap>(std::move(next)), std::memory_order_release);
    }

    std::optional<float> LiveParamOverrides::overrideFor(
        const std::shared_ptr<const OverrideMap>& published,
        const juce::String& key)
    {
        const auto current = std::atomic_load_explicit(&published, std::memory_order_acquire);
        const auto it = current->find(key);
        if (it == current->end())
            return std::nullopt;
        return it->second;
    }

    void LiveParamOverrides::setVolumeOverride(const juce::String& stemKey, std::optional<float> value)
    {
        setOverride(volumeOverrides, stemKey, value);
    }

    void LiveParamOverrides::setFadeInOverride(const juce::String& groupId, std::optional<float> value)
    {
        setOverride(fadeInOverrides, groupId, value);
    }

    void LiveParamOverrides::setFadeOutOverride(const juce::String& groupId, std::optional<float> value)
    {
        setOverride(fadeOutOverrides, groupId, value);
    }

    void LiveParamOverrides::clearAll()
    {
        // Every one of these three assignments MUST go through
        // atomic_store_explicit, not a plain `=` -- the audio thread may be
        // concurrently reading any of them via atomic_load_explicit at any
        // time. A plain assignment here would be exactly the class of bug
        // PlaybackEngine's own project-handoff hardening (see
        // docs/superpowers/plans/2026-08-04-live-drag-preview-implementation.md's
        // Task 4/5 correction) fixed -- don't reintroduce it here.
        std::atomic_store_explicit(
            &volumeOverrides, std::make_shared<const OverrideMap>(), std::memory_order_release);
        std::atomic_store_explicit(
            &fadeInOverrides, std::make_shared<const OverrideMap>(), std::memory_order_release);
        std::atomic_store_explicit(
            &fadeOutOverrides, std::make_shared<const OverrideMap>(), std::memory_order_release);
    }

    std::optional<float> LiveParamOverrides::volumeFor(const juce::String& stemKey) const
    {
        return overrideFor(volumeOverrides, stemKey);
    }

    std::optional<float> LiveParamOverrides::fadeInFor(const juce::String& groupId) const
    {
        return overrideFor(fadeInOverrides, groupId);
    }

    std::optional<float> LiveParamOverrides::fadeOutFor(const juce::String& groupId) const
    {
        return overrideFor(fadeOutOverrides, groupId);
    }
}

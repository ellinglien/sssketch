// native-engine/Source/SendPluginAllowlist.h
#pragma once
#include <juce_core/juce_core.h>
#include <array>

namespace ssstitch
{
    /** A curated, hardcoded set of plugins available on send buses — see
     * docs/superpowers/specs/2026-07-29-send-bus-plugin-hosting-design.md's
     * "Curated allowlist" section for why this isn't a live directory scan
     * (PHASE0_FINDINGS.md documents real scanning hazards: an AU-scanner
     * infinite-assertion-loop bug against certain system bundles, and
     * several installed plugins with no arm64 slice). All VST3 — matches
     * the format already proven end-to-end in the offline POC
     * (Main.cpp's runPluginProcess) and sidesteps AU's extra threading
     * constraints. Paths are hardcoded to this machine, matching this
     * app's single-user scope; a missing plugin at its expected path
     * surfaces as a load error, not a crash — see SendBus.h.
     *
     * Kept in sync by hand with src/shared/sendPlugins.ts — the id field
     * is the contract between the two; changing one without the other
     * will make the renderer's picker and the engine's loader disagree
     * about what a given id refers to. */
    struct SendPluginAllowlistEntry
    {
        const char* id;
        const char* displayName;
        const char* path;
    };

    inline const std::array<SendPluginAllowlistEntry, 5>& sendPluginAllowlist()
    {
        static const std::array<SendPluginAllowlistEntry, 5> table {{
            { "solid-bus-comp", "Solid Bus Comp", "/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3" },
            { "pro-q-3", "FabFilter Pro-Q 3", "/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3" },
            { "soothe2", "soothe2", "/Library/Audio/Plug-Ins/VST3/soothe2.vst3" },
            { "sausage-fattener", "Sausage Fattener", "/Library/Audio/Plug-Ins/VST3/SausageFattener.vst3" },
            { "sunset-sound-reverb", "Sunset Sound Studio Reverb", "/Library/Audio/Plug-Ins/VST3/TR5 Sunset Sound Studio Reverb.vst3" }
        }};
        return table;
    }

    /** Returns nullptr if `id` isn't in the allowlist. */
    inline const SendPluginAllowlistEntry* findSendPlugin(const juce::String& id)
    {
        for (const auto& entry : sendPluginAllowlist())
            if (id == entry.id)
                return &entry;
        return nullptr;
    }
}

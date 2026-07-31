// native-engine/Source/MasterChainAllowlist.h
#pragma once
#include <juce_core/juce_core.h>
#include <array>

namespace ssstitch
{
    /** Curated, hardcoded VST3 allowlist for the master plugin chain — NOT a
     * directory scan (see docs/superpowers/specs/2026-07-31-master-plugin-chain-design.md
     * for why: JUCE's AU scanner has real bugs against some installed
     * bundles, per native-engine/PHASE0_FINDINGS.md). Kept in sync by hand
     * with the renderer twin, src/shared/masterChainAllowlist.ts — same
     * convention as this codebase's SchedulePlayback.cpp/schedulePlayback.ts
     * pair. Paths are hardcoded to this machine, matching the single-user
     * scope of this app. */
    struct MasterChainAllowlistEntry
    {
        const char* id;
        const char* path;
    };

    static constexpr std::array<MasterChainAllowlistEntry, 5> kMasterChainAllowlist { {
        { "solid-bus-comp", "/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3" },
        { "pro-q-3", "/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3" },
        { "soothe2", "/Library/Audio/Plug-Ins/VST3/soothe2.vst3" },
        { "sausage-fattener", "/Library/Audio/Plug-Ins/VST3/SausageFattener.vst3" },
        { "sunset-sound-reverb", "/Library/Audio/Plug-Ins/VST3/TR5 Sunset Sound Studio Reverb.vst3" }
    } };

    inline const MasterChainAllowlistEntry* findMasterChainPlugin(const juce::String& id)
    {
        for (const auto& entry : kMasterChainAllowlist)
            if (id == entry.id)
                return &entry;
        return nullptr;
    }
}

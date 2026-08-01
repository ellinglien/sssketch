#pragma once
#include "PluginChain.h"
#include <juce_core/juce_core.h>
#include <array>
#include <vector>

namespace ssstitch
{
    struct EngineStem
    {
        juce::String stemKey;
        juce::String resolvedPath;
        double durationSec = 0.0;
        int barLength = 0;
        // -1.0 = unset (use the rifff's own barLength), matching startBarOverride's
        // own sentinel convention below. In practice parseEngineProject() always
        // assigns a concrete resolved value at parse time (falling back to the
        // rifff's barLength itself if the wire payload omits it), so this default
        // is only ever observed by code that constructs an EngineStem directly
        // without going through JSON parsing (e.g. unit tests).
        double playedBars = -1.0; // this stem's own tiling bound
        double offsetSteps = 0.0;
        double startBarOverride = -1.0; // -1.0 = use the rifff's own startBar
        double volume = 1.0;
        bool muted = false;
    };

    struct EngineRifff
    {
        juce::String groupId;
        double startBar = 0.0;
        int barLength = 0;
        double fadeInBars = 0.0;
        double fadeOutBars = 0.0;
        std::vector<EngineStem> stems;
    };

    struct EngineProject
    {
        double bpm = 120.0;
        double snapDiv = 16.0;
        // 0.0 = no wrap (unbounded playback) — the default a payload without
        // this field parses to, matching Transport's own disabled-by-default
        // semantics for setLoopLengthBars.
        double loopLengthBars = 0.0;
        std::vector<EngineRifff> rifffs;
        // pluginId is "" (empty) for an empty slot. path is only meaningful
        // when pluginId is non-empty -- the renderer resolves a scanned
        // catalog id to its real file path (native-engine has no access to
        // pluginCatalog.json itself, a main-process/renderer concept) and
        // sends both, since actually loading a plugin needs a real path.
        // Always exactly kNumMasterChainSlots entries; parseEngineProject
        // fills missing/short wire-format arrays with empty slots rather
        // than failing, matching this file's existing lenient-parse
        // convention for other fields.
        struct MasterChainSlot
        {
            juce::String pluginId;
            juce::String path;
        };
        std::array<MasterChainSlot, kNumMasterChainSlots> masterChain {};
    };

    /** Parses the wire-format JSON documented in Task 3 of the Phase 1 plan.
     * Returns false on failure (never throws); on failure, `errorOut` is set
     * and `projectOut` is left in an unspecified state. */
    bool parseEngineProject(const juce::String& json, EngineProject& projectOut, juce::String& errorOut);
}

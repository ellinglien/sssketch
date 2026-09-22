#pragma once
#include "AutomationCurve.h"
#include "ChannelFilter.h"
#include "PluginChain.h"
#include "ReverbBus.h"
#include <juce_core/juce_core.h>
#include <array>
#include <vector>

namespace sssketch
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
        double leftCropBars = 0.0; // bars cropped from this stem's own LEFT edge; 0 = no crop
        double offsetSteps = 0.0;
        double startBarOverride = -1.0; // -1.0 = use the rifff's own startBar
        double volume = 1.0;
        bool muted = false;
        /** A muted span, in bars -- the same absolute arrangement-bar
         * coordinate space startBarOverride/rifff.startBar already use.
         * Kept in bars (not pre-converted to seconds) so PlaybackEngine.cpp
         * can apply muteRegionGainAt() directly with no per-block
         * conversion or heap allocation -- see MuteRegionGain.h. */
        struct MuteRegion
        {
            double startBar = 0.0;
            double endBar = 0.0;
        };
        std::vector<MuteRegion> muteRegions;
        // See docs/superpowers/specs/2026-08-02-one-shot-sample-import-design.md.
        // When true, PlaybackEngine::renderBlock's one-shot branch is used
        // instead of the normal tile/resample path -- trimStartSec/trimEndSec
        // are only meaningful in that branch.
        bool oneShot = false;
        double trimStartSec = 0.0;
        // -1.0 = unset (play to the stem's own natural durationSec) -- same
        // sentinel convention as startBarOverride above.
        double trimEndSec = -1.0;
    };

    struct EngineRifff
    {
        juce::String groupId;
        juce::String channelId; // which channel this rifff's clip is on
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
            // "" (default) = nothing to restore for this slot -- either no
            // captured state exists, or (for a fresh load with no matching
            // captured pluginId) restoration deliberately doesn't apply.
            // Only ever read by RenderExport.cpp's offline plugin-load loop
            // -- the live engine's own load-master-plugin/load-channel-plugin
            // IPC handlers (IpcServer.cpp) restore state via a completely
            // separate path (their own payload's own stateBase64 field, not
            // this one), since live plugin loading never goes through
            // EngineProject/setProject() at all. See docs/superpowers/specs/
            // 2026-08-14-plugin-state-persistence-design.md.
            juce::String stateBase64;
        };
        std::array<MasterChainSlot, kNumMasterChainSlots> masterChain {};

        // One entry per channel that has at least one non-empty slot; a
        // channelId absent from this vector is treated identically to one
        // present with two empty slots (pure passthrough) -- see
        // docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md.
        struct EngineChannelChain
        {
            juce::String channelId;
            std::array<MasterChainSlot, kNumChannelChainSlots> slots {};
        };
        std::vector<EngineChannelChain> channelChains;

        /** The built-in sound toolkit's per-channel settings: a filter, a
         * reverb send, a channel volume, and a drawn automation curve for
         * any of them. Wire-format twin of ChannelFilterSettings +
         * ChannelAutomation in src/shared/toolkit.ts -- a hand-synced pair,
         * like everything else in this file (CLAUDE.md). See
         * docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md.
         *
         * A channelId ABSENT from EngineProject::channelToolkits behaves
         * exactly like one present with these defaults, which are in turn
         * exactly neutral: filter parked at its mode's open end, no send, no
         * gain change, no curves. That's what makes an old project (which
         * has no such field at all) load and sound bit-identical to before
         * this feature existed -- the neutral path in PlaybackEngine skips
         * every bit of this. */
        struct EngineChannelAutomation
        {
            // Empty = "this parameter isn't automated", which is different
            // from "automated, but currently sitting at its default": the
            // former uses the channel's own static value below, the latter
            // the curve. Points are sorted ascending by bar and clamped into
            // [0,1] at parse time, so evaluateAutomation's own precondition
            // holds by construction for anything that came off the wire.
            std::vector<AutomationPoint> filterCutoff;
            std::vector<AutomationPoint> filterResonance;
            std::vector<AutomationPoint> reverbSend;
            std::vector<AutomationPoint> volume;

            bool isEmpty() const
            {
                return filterCutoff.empty() && filterResonance.empty()
                    && reverbSend.empty() && volume.empty();
            }
        };

        struct EngineChannelToolkit
        {
            juce::String channelId;
            FilterMode filterMode = FilterMode::lowpass;
            // Normalised [0,1]; the engine owns the map to Hz/Q (see
            // ChannelFilter.h). Defaults are each mode's own neutral end --
            // note that flipping filterMode to highpass without also moving
            // filterCutoff leaves a NON-neutral filter (1.0 on a highpass is
            // 20kHz, i.e. everything gone), which is correct: choosing a
            // highpass and leaving the cutoff at the top is a real, audible
            // choice, not an accident the engine should second-guess.
            double filterCutoff = 1.0;
            double filterResonance = 0.0;
            /** How much of this channel goes to the shared reverb, post-filter
             * and post-volume (a post-fader send: turning the channel down
             * turns its reverb down with it). 0 = none. */
            double reverbSend = 0.0;
            /** A channel-level gain on top of each stem's own volume -- the
             * fourth automatable parameter in the toolkit's set. 1.0 = unity. */
            double volume = 1.0;
            EngineChannelAutomation automation;
        };

        std::vector<EngineChannelToolkit> channelToolkits;

        /** The one shared reverb's own settings -- project-level, not per
         * channel (see ReverbBus.h). Defaults are ReverbSettings's own; they
         * only ever matter once some channel actually sends to it. */
        ReverbSettings reverb;
    };

    /** Parses the wire-format JSON documented in Task 3 of the Phase 1 plan.
     * Returns false on failure (never throws); on failure, `errorOut` is set
     * and `projectOut` is left in an unspecified state. */
    bool parseEngineProject(const juce::String& json, EngineProject& projectOut, juce::String& errorOut);
}

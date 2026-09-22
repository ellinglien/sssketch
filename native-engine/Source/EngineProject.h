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
    /** The built-in sound toolkit on ONE placed stem clip: a filter, a reverb
     * send, a clip volume, and a drawn automation curve for any of them.
     * Wire-format twin of EngineStemToolkit in src/shared/buildEngineProject.ts
     * (and of StemFilterSettings/StemAutomation in src/shared/toolkit.ts) -- a
     * hand-synced pair, like everything else in this file (CLAUDE.md). See
     * docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md,
     * especially section 2b: the toolkit was per CHANNEL for exactly one build
     * and moved to per clip after the first live walkthrough.
     *
     * A stem whose wire payload has NO `toolkit` key at all behaves exactly
     * like one present with these defaults, which are in turn exactly neutral:
     * filter parked at its mode's open end, no send, no gain change, no
     * curves. That's what makes an old project (which has no such field) load
     * and sound bit-identical to before this feature existed -- the neutral
     * path in PlaybackEngine skips every bit of this. */
    struct EngineStemAutomation
    {
        // Empty = "this parameter isn't automated", which is different from
        // "automated, but currently sitting at its default": the former uses
        // the clip's own static value below, the latter the curve. Points are
        // sorted ascending by bar and clamped into [0,1] at parse time, so
        // evaluateAutomation's own precondition holds by construction for
        // anything that came off the wire. Bars are CLIP-RELATIVE -- see
        // EngineStemToolkit::originBar.
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

    struct EngineStemToolkit
    {
        FilterMode filterMode = FilterMode::lowpass;
        // Normalised [0,1]; the engine owns the map to Hz/Q (see
        // ChannelFilter.h). Defaults are each mode's own neutral end -- note
        // that flipping filterMode to highpass without also moving
        // filterCutoff leaves a NON-neutral filter (1.0 on a highpass is
        // 20kHz, i.e. everything gone), which is correct: choosing a highpass
        // and leaving the cutoff at the top is a real, audible choice, not an
        // accident the engine should second-guess.
        double filterCutoff = 1.0;
        double filterResonance = 0.0;
        /** How much of this clip goes to the shared reverb, post-filter and
         * post-volume (a post-fader send: turning the clip down turns its
         * reverb down with it). 0 = none. */
        double reverbSend = 0.0;
        /** The static level the `volume` curve sits under -- 1.0 unless some
         * future per-clip toolkit fader moves it. NOT the same number as
         * EngineStem::volume (the per-stem gain the app's own envelope drag
         * writes): when automation.volume is non-empty the CURVE is the clip's
         * level and EngineStem::volume is ignored entirely, per the spec's
         * "volume fully replaces the old per-clip volume envelope ... rather
         * than multiplying with it". */
        double volume = 1.0;
        /** The ABSOLUTE arrangement bar that clip-relative bar 0 sits on --
         * i.e. this clip's own left edge, including its left crop and its
         * re-one offset. The renderer computes it (buildEngineProject.ts's
         * clipOriginBar) from the same three terms it uses to DRAW the clip,
         * so the drawn lane and what is heard cannot disagree; the engine just
         * subtracts it before evaluating. Deliberately not re-derived here
         * from startBar/leftCropBars/offsetSteps: the renderer's own version
         * also has to account for tempo scaling on a stretch-off clip, which
         * nothing on this side models. */
        double originBar = 0.0;
        EngineStemAutomation automation;
    };

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

        /** This clip's built-in toolkit. `hasToolkit` is false for a stem
         * whose wire payload carried no `toolkit` key at all, which is every
         * stem in a project nobody has drawn on -- and is what lets
         * renderBlock() take its pre-toolkit path for those. Set by
         * parseEngineProject, then narrowed further by PlaybackEngine's own
         * stemToolkitIsNeutral() in setProject (a toolkit that IS present but
         * does nothing is downgraded back to false there, off the real-time
         * thread, so renderBlock's per-stem cost stays one bool test). */
        bool hasToolkit = false;
        EngineStemToolkit toolkit;
    };

    /** One placed noise riser -- a GENERATED audio source on a channel, not
     * an effect on one. Wire-format twin of EngineRiser in
     * src/shared/buildEngineProject.ts (and of RiserClip in
     * src/shared/riser.ts): a hand-synced trio, like everything else in this
     * file (CLAUDE.md). See step 4 of
     * docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md.
     *
     * Unlike EngineStemToolkit, there is no originBar here. A riser has no
     * left crop and no re-one offset -- its left edge simply IS startBar --
     * so the renderer has no geometry to resolve on its behalf and the engine
     * subtracts startBar itself.
     *
     * A project with no risers sends an EMPTY array, and PlaybackEngine skips
     * the whole riser stage on one bool test in that case, so an ordinary
     * project's render stays bit-identical to its pre-riser self. */
    struct EngineRiser
    {
        juce::String id;
        juce::String channelId;
        double startBar = 0.0;
        double lengthBars = 1.0;
        /** Normalised [0,1] bandpass centres at the two ends of the sweep.
         * The engine owns the map to Hz (ChannelFilter.h's filterCutoffHz),
         * the same rule every other toolkit control follows. */
        double startCutoffValue = 0.0;
        double endCutoffValue = 1.0;
        /** Normalised [0,1] peak level the swell reaches at the very end. */
        double level = 0.0;
        /** The drawn sweep, in CLIP-RELATIVE bars. Sorted ascending and
         * clamped into [0,1] at parse time, so evaluateAutomation's own
         * precondition holds by construction. EMPTY means "use the plain
         * startCutoffValue -> endCutoffValue ramp" -- riserCutoffAt
         * (NoiseRiser.h) owns that rule for both sides. */
        std::vector<AutomationPoint> curve;
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
        /** Placed noise risers, in the order the renderer sent them (earliest
         * first -- see buildEngineRisers). Empty for every project saved
         * before they existed, and empty is the fast path. */
        std::vector<EngineRiser> risers;
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

        /** The one shared reverb's own settings -- project-level, not per
         * clip (see ReverbBus.h). Defaults are ReverbSettings's own; they only
         * ever matter once some clip actually sends to it. */
        ReverbSettings reverb;
    };

    /** Parses the wire-format JSON documented in Task 3 of the Phase 1 plan.
     * Returns false on failure (never throws); on failure, `errorOut` is set
     * and `projectOut` is left in an unspecified state. */
    bool parseEngineProject(const juce::String& json, EngineProject& projectOut, juce::String& errorOut);
}

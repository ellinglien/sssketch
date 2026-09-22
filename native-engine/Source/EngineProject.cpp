#include "EngineProject.h"
#include <algorithm>
#include <cmath>

namespace sssketch
{
    static double getDouble(const juce::var& v, const char* key, double fallback)
    {
        if (!v.hasProperty(key)) return fallback;
        return (double) v.getProperty(key, fallback);
    }

    static bool getBool(const juce::var& v, const char* key, bool fallback)
    {
        if (!v.hasProperty(key)) return fallback;
        return (bool) v.getProperty(key, fallback);
    }

    /** True if `v` was explicitly present in the parsed JSON as `null`/absent-of-value
     * (as opposed to genuinely present with some concrete type). Used so that a key
     * present but null degrades gracefully like an absent key, while a key present
     * with the wrong concrete type (e.g. an object or string where an array was
     * expected) is treated as a real parse error. */
    static bool isNullish(const juce::var& v)
    {
        return v.isVoid() || v.isUndefined();
    }

    /** Reads one drawn automation curve off the wire into the shape
     * evaluateAutomation() requires: sorted ascending by bar, values clamped
     * into [0,1], non-finite entries dropped entirely.
     *
     * All three of those are done HERE, once, at parse time, rather than
     * defensively on every block in the audio callback -- this is the only
     * place curve data crosses from untrusted JSON into the engine, so it's
     * the only place that has to care. std::stable_sort so two points sharing
     * a bar keep the order the renderer drew them in, which is what makes a
     * vertical step read as "jump to the later value" (see
     * evaluateAutomation's own segment-selection comment). A missing or
     * non-array value leaves the curve empty, i.e. "not automated" -- the
     * same lenient-parse convention the rest of this file uses. */
    static std::vector<AutomationPoint> parseAutomationCurve(const juce::var& container, const char* key)
    {
        std::vector<AutomationPoint> points;
        auto curveVar = container.getProperty(key, juce::var());
        auto* array = curveVar.getArray();
        if (array == nullptr)
            return points;
        points.reserve((size_t) array->size());
        for (auto& pointVar : *array)
        {
            if (pointVar.getDynamicObject() == nullptr)
                continue;
            AutomationPoint point;
            point.bar = getDouble(pointVar, "bar", 0.0);
            point.value = getDouble(pointVar, "value", 0.0);
            if (!std::isfinite(point.bar) || !std::isfinite(point.value))
                continue;
            point.value = std::clamp(point.value, 0.0, 1.0);
            points.push_back(point);
        }
        std::stable_sort(points.begin(), points.end(),
            [](const AutomationPoint& a, const AutomationPoint& b) { return a.bar < b.bar; });
        return points;
    }

    /** Clamps a normalised wire value into [0,1], falling back for a missing
     * or non-finite one. Every toolkit control is normalised (see
     * EngineStemToolkit), so this is the single place that rule is enforced
     * on the way in. */
    static double getNormalised(const juce::var& v, const char* key, double fallback)
    {
        const double raw = getDouble(v, key, fallback);
        if (!std::isfinite(raw))
            return fallback;
        return std::clamp(raw, 0.0, 1.0);
    }

    bool parseEngineProject(const juce::String& json, EngineProject& projectOut, juce::String& errorOut)
    {
        auto parsed = juce::JSON::parse(json);
        // Note: var::isObject() is true for JSON arrays too (in JUCE 8, the Array
        // var type sets isObject=true alongside isArray=true), so it can't be used
        // on its own to reject a top-level array. getDynamicObject() is non-null
        // only for genuine `{...}` objects, which is what we actually require here.
        if (parsed.getDynamicObject() == nullptr)
        {
            errorOut = "top-level JSON is not an object";
            return false;
        }

        EngineProject project;
        project.bpm = getDouble(parsed, "bpm", 120.0);
        project.snapDiv = getDouble(parsed, "snapDiv", 16.0);
        project.loopLengthBars = getDouble(parsed, "loopLengthBars", 0.0);

        auto masterChainVar = parsed.getProperty("masterChain", juce::var());
        if (auto* masterChainArray = masterChainVar.getArray())
        {
            for (int i = 0; i < kNumMasterChainSlots; ++i)
            {
                if (i >= masterChainArray->size()) continue;
                const auto& slotVar = (*masterChainArray)[i];
                project.masterChain[(size_t) i].pluginId = slotVar.getProperty("pluginId", "").toString();
                project.masterChain[(size_t) i].path = slotVar.getProperty("path", "").toString();
                project.masterChain[(size_t) i].stateBase64 = slotVar.getProperty("stateBase64", "").toString();
            }
        }
        // else: leave the default-constructed all-empty masterChain as-is
        // (missing/absent masterChain is not a parse error, matching this
        // function's existing lenient-parse convention for other fields).

        auto channelChainsVar = parsed.getProperty("channelChains", juce::var());
        if (auto* channelChainsArray = channelChainsVar.getArray())
        {
            for (auto& entryVar : *channelChainsArray)
            {
                EngineProject::EngineChannelChain chain;
                chain.channelId = entryVar.getProperty("channelId", "").toString();
                auto slotsVar = entryVar.getProperty("slots", juce::var());
                if (auto* slotsArray = slotsVar.getArray())
                {
                    for (int i = 0; i < kNumChannelChainSlots; ++i)
                    {
                        if (i >= slotsArray->size()) continue;
                        const auto& slotVar = (*slotsArray)[i];
                        chain.slots[(size_t) i].pluginId = slotVar.getProperty("pluginId", "").toString();
                        chain.slots[(size_t) i].path = slotVar.getProperty("path", "").toString();
                        chain.slots[(size_t) i].stateBase64 = slotVar.getProperty("stateBase64", "").toString();
                    }
                }
                project.channelChains.push_back(std::move(chain));
            }
        }
        // else: leave channelChains empty (missing/absent is not a parse
        // error, matching this function's existing lenient-parse
        // convention).

        // The built-in sound toolkit's project-level half: the one shared
        // reverb. Its per-CLIP half rides on each stem (see EngineStemToolkit
        // and the stem loop below). Absent from every project saved before
        // the feature existed, and absent means exactly neutral, so an old
        // project parses to a project the render path skips entirely --
        // bit-identical to its pre-toolkit self. Same lenient-parse
        // convention as masterChain/channelChains above: a missing or
        // wrong-typed value is a default, not an error.
        auto reverbVar = parsed.getProperty("reverb", juce::var());
        if (reverbVar.getDynamicObject() != nullptr)
        {
            project.reverb.roomSize = getNormalised(reverbVar, "roomSize", project.reverb.roomSize);
            project.reverb.damping = getNormalised(reverbVar, "damping", project.reverb.damping);
            // NOT normalised -- pre-delay is in real milliseconds (see
            // ReverbSettings). ReverbBus clamps it into the window zita can
            // actually address, so no range check is needed here.
            const double preDelay = getDouble(reverbVar, "preDelayMs", project.reverb.preDelayMs);
            if (std::isfinite(preDelay))
                project.reverb.preDelayMs = preDelay;
        }

        auto rifffsVar = parsed.getProperty("rifffs", juce::var());
        if (auto* rifffsArray = rifffsVar.getArray())
        {
            for (auto& rifffVar : *rifffsArray)
            {
                if (rifffVar.getDynamicObject() == nullptr)
                {
                    errorOut = "rifff entry is not an object";
                    return false;
                }
                EngineRifff rifff;
                rifff.groupId = rifffVar.getProperty("groupId", "").toString();
                rifff.channelId = rifffVar.getProperty("channelId", "").toString();
                rifff.startBar = getDouble(rifffVar, "startBar", 0.0);
                rifff.barLength = (int) getDouble(rifffVar, "barLength", 0.0);
                rifff.fadeInBars = getDouble(rifffVar, "fadeInBars", 0.0);
                rifff.fadeOutBars = getDouble(rifffVar, "fadeOutBars", 0.0);

                auto stemsVar = rifffVar.getProperty("stems", juce::var());
                if (auto* stemsArray = stemsVar.getArray())
                {
                    for (auto& stemVar : *stemsArray)
                    {
                        if (stemVar.getDynamicObject() == nullptr)
                        {
                            errorOut = "stem entry is not an object";
                            return false;
                        }
                        EngineStem stem;
                        stem.stemKey = stemVar.getProperty("stemKey", "").toString();
                        stem.resolvedPath = stemVar.getProperty("resolvedPath", "").toString();
                        stem.durationSec = getDouble(stemVar, "durationSec", 0.0);
                        stem.barLength = (int) getDouble(stemVar, "barLength", 0.0);
                        stem.playedBars = getDouble(stemVar, "playedBars", (double) rifff.barLength);
                        stem.leftCropBars = getDouble(stemVar, "leftCropBars", 0.0);
                        stem.offsetSteps = getDouble(stemVar, "offsetSteps", 0.0);
                        stem.startBarOverride = getDouble(stemVar, "startBarOverride", -1.0);
                        stem.volume = getDouble(stemVar, "volume", 1.0);
                        stem.muted = getBool(stemVar, "muted", false);
                        stem.oneShot = getBool(stemVar, "oneShot", false);
                        stem.trimStartSec = getDouble(stemVar, "trimStartSec", 0.0);
                        stem.trimEndSec = getDouble(stemVar, "trimEndSec", -1.0);

                        // The built-in toolkit, per CLIP (spec section 2b).
                        // An ABSENT `toolkit` key leaves hasToolkit false,
                        // which is the whole neutral fast path -- that is what
                        // every stem in a project nobody has drawn on sends.
                        auto toolkitVar = stemVar.getProperty("toolkit", juce::var());
                        if (toolkitVar.getDynamicObject() != nullptr)
                        {
                            stem.hasToolkit = true;
                            auto& toolkit = stem.toolkit;
                            toolkit.filterMode =
                                toolkitVar.getProperty("filterMode", "lowpass").toString() == "highpass"
                                    ? FilterMode::highpass
                                    : FilterMode::lowpass;
                            // Note the default: each mode's own neutral end,
                            // so a payload that names a mode but omits the
                            // cutoff stays neutral rather than silently
                            // landing on a lowpass's 20Hz.
                            toolkit.filterCutoff = getNormalised(
                                toolkitVar, "filterCutoff", neutralCutoffValue(toolkit.filterMode));
                            toolkit.filterResonance = getNormalised(toolkitVar, "filterResonance", 0.0);
                            toolkit.reverbSend = getNormalised(toolkitVar, "reverbSend", 0.0);
                            toolkit.volume = getNormalised(toolkitVar, "volume", 1.0);
                            // NOT normalised: this is an absolute arrangement
                            // bar, not a [0,1] control. A non-finite one falls
                            // back to 0 rather than reaching the audio thread,
                            // where it would make every curve evaluate at NaN.
                            const double origin = getDouble(toolkitVar, "originBar", 0.0);
                            toolkit.originBar = std::isfinite(origin) ? origin : 0.0;

                            auto automationVar = toolkitVar.getProperty("automation", juce::var());
                            if (automationVar.getDynamicObject() != nullptr)
                            {
                                toolkit.automation.filterCutoff =
                                    parseAutomationCurve(automationVar, "filterCutoff");
                                toolkit.automation.filterResonance =
                                    parseAutomationCurve(automationVar, "filterResonance");
                                toolkit.automation.reverbSend =
                                    parseAutomationCurve(automationVar, "reverbSend");
                                toolkit.automation.volume =
                                    parseAutomationCurve(automationVar, "volume");
                            }
                        }

                        auto muteRegionsVar = stemVar.getProperty("muteRegions", juce::var());
                        if (auto* muteRegionsArray = muteRegionsVar.getArray())
                        {
                            for (auto& regionVar : *muteRegionsArray)
                            {
                                if (regionVar.getDynamicObject() == nullptr)
                                {
                                    errorOut = "muteRegions entry is not an object (stemKey: " + stem.stemKey + ")";
                                    return false;
                                }
                                EngineStem::MuteRegion region;
                                region.startBar = getDouble(regionVar, "startBar", 0.0);
                                region.endBar = getDouble(regionVar, "endBar", 0.0);
                                stem.muteRegions.push_back(region);
                            }
                        }
                        else if (stemVar.hasProperty("muteRegions") && !isNullish(muteRegionsVar))
                        {
                            errorOut = "muteRegions is present but not an array (stemKey: " + stem.stemKey + ")";
                            return false;
                        }

                        rifff.stems.push_back(std::move(stem));
                    }
                }
                else if (rifffVar.hasProperty("stems") && !isNullish(stemsVar))
                {
                    errorOut = "stems is present but not an array (groupId: " + rifff.groupId + ")";
                    return false;
                }
                project.rifffs.push_back(std::move(rifff));
            }
        }
        else if (parsed.hasProperty("rifffs") && !isNullish(rifffsVar))
        {
            errorOut = "rifffs is present but not an array";
            return false;
        }

        projectOut = std::move(project);
        return true;
    }
}

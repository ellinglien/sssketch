#include "EngineProject.h"

namespace ssstitch
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
                        stem.offsetSteps = getDouble(stemVar, "offsetSteps", 0.0);
                        stem.startBarOverride = getDouble(stemVar, "startBarOverride", -1.0);
                        stem.volume = getDouble(stemVar, "volume", 1.0);
                        stem.muted = getBool(stemVar, "muted", false);
                        rifff.stems.push_back(std::move(stem));
                    }
                }
                project.rifffs.push_back(std::move(rifff));
            }
        }

        projectOut = std::move(project);
        return true;
    }
}

#include "PluginScanner.h"

namespace ssstitch
{
    bool isPluginCandidate(const juce::String& filename)
    {
        return filename.endsWithIgnoreCase(".vst3") || filename.endsWithIgnoreCase(".component");
    }

    juce::Array<juce::PluginDescription> scanForPlugins(
        juce::AudioPluginFormatManager& formatManager,
        const juce::Array<juce::File>& searchPaths)
    {
        juce::Array<juce::PluginDescription> found;
        juce::KnownPluginList knownPlugins;

        for (auto* format : formatManager.getFormats())
        {
            for (const auto& searchPath : searchPaths)
            {
                juce::FileSearchPath path(searchPath.getFullPathName());
                auto candidates = format->searchPathsForPlugins(path, true, true);

                for (const auto& candidate : candidates)
                {
                    juce::OwnedArray<juce::PluginDescription> typesFound;
                    knownPlugins.scanAndAddFile(candidate, false, typesFound, *format);
                    for (auto* desc : typesFound)
                        found.add(*desc);
                }
            }
        }
        return found;
    }
}

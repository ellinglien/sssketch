// native-engine/Source/PluginScanning.cpp
#include "PluginScanning.h"

namespace sssketch
{
    void scanOneFileInto(
        juce::AudioPluginFormatManager& formatManager,
        const juce::String& path,
        juce::Array<juce::PluginDescription>& found)
    {
        for (auto* format : formatManager.getFormats())
        {
            if (!format->fileMightContainThisPluginType(path))
                continue;

            juce::KnownPluginList knownPlugins;
            juce::OwnedArray<juce::PluginDescription> typesFound;
            knownPlugins.scanAndAddFile(path, false, typesFound, *format);
            for (auto* desc : typesFound)
                found.add(*desc);
        }
    }
}

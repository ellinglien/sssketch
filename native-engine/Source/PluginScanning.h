// native-engine/Source/PluginScanning.h
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>

namespace sssketch
{
    /** Scans a single plugin bundle path for every PluginDescription it
     * contains (a VST3/AU bundle can describe more than one plugin type),
     * appending to `found`. Shared between the main engine (--scan-one-json,
     * --scan-one, --scan) and the x86_64 bridge (its own --scan-one-json
     * mode, and load-bridge-plugin's own type-discovery step) -- compiled
     * into both targets from this one source file. A no-op (found
     * unchanged) if the format manager can't even identify the file as a
     * candidate, or if scanning finds nothing loadable there (e.g. wrong
     * architecture for this process). */
    void scanOneFileInto(
        juce::AudioPluginFormatManager& formatManager,
        const juce::String& path,
        juce::Array<juce::PluginDescription>& found);
}

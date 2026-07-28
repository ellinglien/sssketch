#pragma once
#include <juce_audio_processors/juce_audio_processors.h>

namespace ssstitch
{
    /** True for files/bundles JUCE's plugin formats actually care about — filters an
     * arbitrary directory listing down to plausible plugin candidates before handing
     * them to the (much more expensive, not-unit-testable) real format scanners. */
    bool isPluginCandidate(const juce::String& filename);

    /** Full directory scan using JUCE's own KnownPluginList + AudioPluginFormatManager
     * machinery. Not unit tested directly (depends on what's actually installed on the
     * machine) — exercised via Main.cpp's own printed report instead. */
    juce::Array<juce::PluginDescription> scanForPlugins(
        juce::AudioPluginFormatManager& formatManager,
        const juce::Array<juce::File>& searchPaths);
}

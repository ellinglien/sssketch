// native-engine/Source/PluginArchitecture.h
#pragma once
#include <juce_core/juce_core.h>

namespace sssketch
{
    /** Shells out to the system `file` command against a plugin bundle's
     * inner Mach-O binary to determine its architecture -- "arm64",
     * "x86_64", "universal", or "unknown" (bundle missing/unreadable).
     * Used both by the plugin scanner (--scan-one-json, see Main.cpp) and
     * by PluginChain at load time to decide whether to load a plugin
     * in-process or delegate to the x86_64 bridge (see
     * docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md). */
    juce::String detectPluginArchitecture(const juce::String& bundlePath);
}

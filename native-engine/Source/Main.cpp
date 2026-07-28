#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginScanner.h"

static int runUnitTests()
{
    juce::UnitTestRunner runner;
    runner.runAllTests();

    for (int i = 0; i < runner.getNumResults(); ++i)
    {
        auto* result = runner.getResult(i);
        if (result->failures > 0)
        {
            juce::Logger::writeToLog("FAIL: " + result->unitTestName);
            return 1;
        }
    }
    juce::Logger::writeToLog("All unit tests passed.");
    return 0;
}

static void scanOneFileInto(
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

// A curated allowlist, not a directory sweep. See PHASE0_FINDINGS.md: scanning
// entire /Library/Audio/Plug-Ins/{VST3,Components} directories via
// KnownPluginList::scanAndAddFile hits at least one real bug (an infinite
// assertion loop in JUCE's AU scanner against Apple's own multi-type system
// component bundles, e.g. AudioCodecs.component) plus multiple installed
// plugins with no arm64 slice, which fail cleanly but add noise. A real
// plugin-hosting product needs per-plugin timeout/sandboxing (as commercial
// DAWs do); out of scope for a toolchain spike, which only needs to confirm
// VST3 + AU loading works at all against known-good real-world plugins.
static int runScanReport()
{
    juce::AudioPluginFormatManager formatManager;
    formatManager.addDefaultFormats(); // registers VST3 + AU given the build flags set

    const juce::StringArray knownGoodPaths {
        "/Library/Audio/Plug-Ins/VST3/Neutron 4.vst3",
        "/Library/Audio/Plug-Ins/VST3/RX 10 De-click.vst3",
        "/Library/Audio/Plug-Ins/Components/Vital.component",
        "/Library/Audio/Plug-Ins/Components/Youlean Loudness Meter 2.component"
    };

    juce::Array<juce::PluginDescription> found;
    for (const auto& path : knownGoodPaths)
        scanOneFileInto(formatManager, path, found);

    juce::Logger::writeToLog("Found " + juce::String(found.size()) + " plugin(s):");
    for (const auto& desc : found)
        juce::Logger::writeToLog("  [" + desc.pluginFormatName + "] " + desc.name
            + " (" + desc.manufacturerName + ")");

    return found.isEmpty() ? 1 : 0;
}

// Diagnostic-only: probe a single plugin file/bundle by exact path, for bisecting
// which specific installed plugin hangs a full-catalog scan (some plugins block on
// a first-run license/authorization dialog, or on JUCE scanner bugs against
// non-effect AU bundles — see PHASE0_FINDINGS.md).
static int runScanOne(const juce::String& path)
{
    juce::AudioPluginFormatManager formatManager;
    formatManager.addDefaultFormats();

    juce::File target(path);
    juce::Logger::writeToLog("Probing: " + target.getFullPathName());

    juce::Array<juce::PluginDescription> found;
    scanOneFileInto(formatManager, path, found);
    for (const auto& desc : found)
        juce::Logger::writeToLog("  [" + desc.pluginFormatName + "] " + desc.name
            + " (" + desc.manufacturerName + ")");

    juce::Logger::writeToLog("Probe complete.");
    return 0;
}

int main(int argc, char* argv[])
{
    // AudioUnit hosting (and some VST3s) rely on a running CFRunLoop / message
    // thread even for headless scanning and processing — without this, AU
    // component instantiation hangs indefinitely instead of failing.
    const juce::ScopedJuceInitialiser_GUI juceInit;

    if (argc > 1 && juce::String(argv[1]) == "--test")
        return runUnitTests();

    if (argc > 1 && juce::String(argv[1]) == "--scan")
        return runScanReport();

    if (argc > 2 && juce::String(argv[1]) == "--scan-one")
        return runScanOne(juce::String(argv[2]));

    juce::Logger::writeToLog("ssstitch-engine Phase 0 spike: JUCE core linked OK.");
    return 0;
}

// native-engine-bridge/Source/Main.cpp
#include "BridgeIpcServer.h"
#include "PluginScanning.h"
#include "PluginArchitecture.h"
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include <iostream>

using namespace sssketch;

// Identical in shape to the main engine's own runScanOneJson (Main.cpp) --
// same scanOneFileInto/detectPluginArchitecture calls, same JSON output
// format, deliberately kept as near-duplicate code rather than a further
// shared abstraction, since the two functions differ in exactly one
// respect that matters: this one runs as a genuinely x86_64 process, so it
// can dlopen (and therefore identify/scan) an x86_64-only plugin the main
// engine's own arm64 process cannot. See pluginScan.ts's scanOneCandidate,
// which retries via this binary specifically when the main engine's own
// scan fails with arch === 'x86_64'.
static int runScanOneJson(const juce::String& path)
{
    juce::AudioPluginFormatManager formatManager;
    formatManager.addDefaultFormats();

    juce::Array<juce::PluginDescription> found;
    scanOneFileInto(formatManager, path, found);

    juce::var result;
    if (found.isEmpty())
    {
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("success", false);
        obj->setProperty("error", "no plugin type found at this path");
        obj->setProperty("arch", detectPluginArchitecture(path));
        result = juce::var(obj.get());
    }
    else
    {
        const auto arch = detectPluginArchitecture(path);
        juce::Array<juce::var> plugins;
        for (const auto& desc : found)
        {
            juce::DynamicObject::Ptr p = new juce::DynamicObject();
            p->setProperty("name", desc.name);
            p->setProperty("manufacturer", desc.manufacturerName);
            p->setProperty("identifierString", desc.createIdentifierString());
            p->setProperty("arch", arch);
            p->setProperty("isInstrument", desc.isInstrument);
            plugins.add(juce::var(p.get()));
        }
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("success", true);
        obj->setProperty("plugins", plugins);
        result = juce::var(obj.get());
    }

    // Plain stdout, not juce::Logger -- see the main engine's own
    // runScanOneJson for why (JUCE routes Logger to stderr on macOS).
    std::cout << juce::JSON::toString(result, true) << std::endl;
    return 0;
}

static int runServeBridge(int port)
{
    juce::ScopedJuceInitialiser_GUI juceInit;
    sssketch::BridgeIpcServer server;
    if (!server.beginWaitingForSocket(port, "127.0.0.1"))
    {
        juce::Logger::writeToLog("runServeBridge: failed to bind to port " + juce::String(port));
        return 1;
    }
    juce::Logger::writeToLog("sssketch-bridge: serving on 127.0.0.1:" + juce::String(port));

    // Same polling-dispatch-loop reasoning as the main engine's own
    // Main.cpp runServe() -- see that function's comment for why
    // runDispatchLoop()/[NSApp run] isn't used here either. This loop
    // exits only via process termination (the main engine kills this
    // process on app quit, or the OS if the parent dies) -- there's no
    // in-process "clean exit" path other than the "shutdown" message
    // calling JUCEApplicationBase::quit(), which this loop doesn't
    // currently observe.
    while (true)
        juce::MessageManager::getInstance()->runDispatchLoopUntil(50);
}

int main(int argc, char* argv[])
{
    if (argc > 2 && juce::String(argv[1]) == "--serve-bridge")
        return runServeBridge(juce::String(argv[2]).getIntValue());

    if (argc > 2 && juce::String(argv[1]) == "--scan-one-json")
        return runScanOneJson(juce::String(argv[2]));

    juce::Logger::writeToLog(
        "sssketch-bridge: no valid mode given (expected --serve-bridge <port> or --scan-one-json <path>)");
    return 1;
}

// native-engine-bridge/Source/Main.cpp
#include "BridgeIpcServer.h"
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>

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

    juce::Logger::writeToLog("sssketch-bridge: no valid mode given (expected --serve-bridge <port>)");
    return 1;
}

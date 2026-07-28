#include <juce_core/juce_core.h>
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

int main(int argc, char* argv[])
{
    if (argc > 1 && juce::String(argv[1]) == "--test")
        return runUnitTests();

    juce::Logger::writeToLog("ssstitch-engine Phase 0 spike: JUCE core linked OK.");
    return 0;
}

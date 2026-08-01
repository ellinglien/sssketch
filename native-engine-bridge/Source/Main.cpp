// native-engine-bridge/Source/Main.cpp
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>

int main(int, char*[])
{
    juce::ScopedJuceInitialiser_GUI juceInit;
    juce::Logger::writeToLog("sssketch-bridge: started (skeleton, no real logic yet)");
    return 0;
}

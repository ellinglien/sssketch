// native-engine/Source/PluginArchitecture.cpp
#include "PluginArchitecture.h"

namespace sssketch
{
    juce::String detectPluginArchitecture(const juce::String& bundlePath)
    {
        juce::File bundle(bundlePath);
        auto macOSDir = bundle.getChildFile("Contents").getChildFile("MacOS");
        auto binaries = macOSDir.findChildFiles(juce::File::findFiles, false);
        if (binaries.isEmpty())
            return "unknown";

        juce::ChildProcess fileProc;
        if (!fileProc.start(juce::StringArray { "file", binaries[0].getFullPathName() }))
            return "unknown";
        const auto output = fileProc.readAllProcessOutput();
        fileProc.waitForProcessToFinish(5000);

        const bool hasArm64 = output.containsIgnoreCase("arm64");
        const bool hasX86 = output.containsIgnoreCase("x86_64");
        if (hasArm64 && hasX86) return "universal";
        if (hasArm64) return "arm64";
        if (hasX86) return "x86_64";
        return "unknown";
    }
}

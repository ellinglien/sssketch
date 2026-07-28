#include "PluginScanner.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    class PluginScannerTests : public juce::UnitTest
    {
    public:
        PluginScannerTests() : juce::UnitTest("PluginScanner") {}

        void runTest() override
        {
            beginTest("isPluginCandidate accepts .vst3 and .component, case-insensitively");
            expect(isPluginCandidate("Foo.vst3"));
            expect(isPluginCandidate("Foo.VST3"));
            expect(isPluginCandidate("Bar.component"));
            expect(isPluginCandidate("Bar.COMPONENT"));

            beginTest("isPluginCandidate rejects everything else");
            expect(!isPluginCandidate("readme.txt"));
            expect(!isPluginCandidate("Foo.vst"));   // VST2, deliberately not supported
            expect(!isPluginCandidate(".DS_Store"));
        }
    };

    static PluginScannerTests pluginScannerTests;
}

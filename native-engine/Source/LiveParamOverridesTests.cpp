// native-engine/Source/LiveParamOverridesTests.cpp
#include "LiveParamOverrides.h"
#include <juce_core/juce_core.h>

namespace sssketch
{
    class LiveParamOverridesTests : public juce::UnitTest
    {
    public:
        LiveParamOverridesTests() : juce::UnitTest("LiveParamOverrides") {}

        void runTest() override
        {
            beginTest("volumeFor returns nullopt when no override is set");
            {
                LiveParamOverrides overrides;
                expect(!overrides.volumeFor("r1:1").has_value());
            }

            beginTest("setVolumeOverride then volumeFor returns the set value");
            {
                LiveParamOverrides overrides;
                overrides.setVolumeOverride("r1:1", 0.3f);
                const auto value = overrides.volumeFor("r1:1");
                expect(value.has_value());
                expectWithinAbsoluteError(*value, 0.3f, 0.0001f);
            }

            beginTest("setVolumeOverride with nullopt clears the override");
            {
                LiveParamOverrides overrides;
                overrides.setVolumeOverride("r1:1", 0.3f);
                overrides.setVolumeOverride("r1:1", std::nullopt);
                expect(!overrides.volumeFor("r1:1").has_value());
            }

            beginTest("fadeIn/fadeOut overrides are independent of volume and each other");
            {
                LiveParamOverrides overrides;
                overrides.setFadeInOverride("r1", 1.5f);
                overrides.setFadeOutOverride("r1", 0.5f);
                expect(!overrides.volumeFor("r1").has_value());
                const auto fadeIn = overrides.fadeInFor("r1");
                const auto fadeOut = overrides.fadeOutFor("r1");
                expect(fadeIn.has_value());
                expect(fadeOut.has_value());
                expectWithinAbsoluteError(*fadeIn, 1.5f, 0.0001f);
                expectWithinAbsoluteError(*fadeOut, 0.5f, 0.0001f);
            }

            beginTest("different keys don't affect each other");
            {
                LiveParamOverrides overrides;
                overrides.setVolumeOverride("r1:1", 0.3f);
                overrides.setVolumeOverride("r2:1", 0.9f);
                expectWithinAbsoluteError(*overrides.volumeFor("r1:1"), 0.3f, 0.0001f);
                expectWithinAbsoluteError(*overrides.volumeFor("r2:1"), 0.9f, 0.0001f);
            }

            beginTest("clearAll empties every map at once");
            {
                LiveParamOverrides overrides;
                overrides.setVolumeOverride("r1:1", 0.3f);
                overrides.setFadeInOverride("r1", 1.5f);
                overrides.setFadeOutOverride("r1", 0.5f);
                overrides.clearAll();
                expect(!overrides.volumeFor("r1:1").has_value());
                expect(!overrides.fadeInFor("r1").has_value());
                expect(!overrides.fadeOutFor("r1").has_value());
            }

            beginTest("hasAnyOverride is false on a freshly-constructed instance");
            {
                LiveParamOverrides overrides;
                expect(!overrides.hasAnyOverride());
            }

            beginTest("hasAnyOverride becomes true after any setter, regardless of which field");
            {
                LiveParamOverrides overrides;
                overrides.setVolumeOverride("r1:1", 0.3f);
                expect(overrides.hasAnyOverride());
            }

            beginTest("hasAnyOverride returns to false once the only override is cleared");
            {
                LiveParamOverrides overrides;
                overrides.setFadeInOverride("r1", 1.5f);
                expect(overrides.hasAnyOverride());
                overrides.setFadeInOverride("r1", std::nullopt);
                expect(!overrides.hasAnyOverride());
            }

            beginTest("hasAnyOverride stays true while at least one of several overrides remains");
            {
                LiveParamOverrides overrides;
                overrides.setVolumeOverride("r1:1", 0.3f);
                overrides.setFadeOutOverride("r1", 0.5f);
                overrides.setVolumeOverride("r1:1", std::nullopt);
                expect(overrides.hasAnyOverride()); // fadeOut override is still set
                overrides.setFadeOutOverride("r1", std::nullopt);
                expect(!overrides.hasAnyOverride()); // now genuinely empty
            }

            beginTest("hasAnyOverride is false after clearAll, even with several overrides set");
            {
                LiveParamOverrides overrides;
                overrides.setVolumeOverride("r1:1", 0.3f);
                overrides.setFadeInOverride("r1", 1.5f);
                overrides.setFadeOutOverride("r1", 0.5f);
                expect(overrides.hasAnyOverride());
                overrides.clearAll();
                expect(!overrides.hasAnyOverride());
            }

            beginTest("updating an already-overridden key's value doesn't double-count");
            {
                LiveParamOverrides overrides;
                overrides.setVolumeOverride("r1:1", 0.3f);
                overrides.setVolumeOverride("r1:1", 0.7f); // same key, new value -- not a new override
                overrides.setVolumeOverride("r1:1", std::nullopt); // one clear should be enough
                expect(!overrides.hasAnyOverride());
            }
        }
    };

    static LiveParamOverridesTests liveParamOverridesTests;
}

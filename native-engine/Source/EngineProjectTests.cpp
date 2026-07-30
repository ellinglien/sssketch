#include "EngineProject.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    class EngineProjectTests : public juce::UnitTest
    {
    public:
        EngineProjectTests() : juce::UnitTest("EngineProject") {}

        void runTest() override
        {
            beginTest("parses a full project with one rifff and one stem");
            {
                const juce::String json = R"(
                {
                  "bpm": 120.0,
                  "snapDiv": 16.0,
                  "sendBuses": [{"pluginId": "solid-bus-comp"}, {"pluginId": ""}, {"pluginId": ""}, {"pluginId": ""}],
                  "rifffs": [
                    {
                      "groupId": "r1",
                      "startBar": 4.0,
                      "barLength": 8,
                      "fadeInBars": 1.0,
                      "fadeOutBars": 0.0,
                      "stems": [
                        {
                          "stemKey": "r1:1",
                          "resolvedPath": "/tmp/a.wav",
                          "durationSec": 12.8,
                          "barLength": 8,
                          "offsetSteps": 0.0,
                          "startBarOverride": -1.0,
                          "volume": 0.9,
                          "muted": false,
                          "sendLevels": [0.5, 0.0, 0.0, 0.0]
                        }
                      ]
                    }
                  ]
                }
                )";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expectEquals(project.bpm, 120.0);
                expectEquals((int) project.rifffs.size(), 1);
                expectEquals(project.rifffs[0].groupId, juce::String("r1"));
                expectEquals((int) project.rifffs[0].stems.size(), 1);
                expectEquals(project.rifffs[0].stems[0].resolvedPath, juce::String("/tmp/a.wav"));
                expectWithinAbsoluteError(project.rifffs[0].stems[0].volume, 0.9, 1.0e-9);
                expectEquals(project.sendBuses[0].pluginId, juce::String("solid-bus-comp"));
                expectEquals(project.sendBuses[1].pluginId, juce::String(""));
                expectEquals(project.rifffs[0].stems[0].sendLevels[0], 0.5);
                expectEquals(project.rifffs[0].stems[0].sendLevels[1], 0.0);
            }

            beginTest("defaults sendBuses to 4 empty slots and sendLevels to all-zero when omitted");
            {
                const juce::String json = R"({
                    "bpm": 120,
                    "snapDiv": 16,
                    "rifffs": [{
                        "groupId": "r1",
                        "startBar": 0,
                        "barLength": 4,
                        "stems": [{"stemKey": "r1:1", "resolvedPath": "/x.wav", "durationSec": 1, "barLength": 4}]
                    }]
                })";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                for (const auto& bus : project.sendBuses)
                    expect(bus.pluginId.isEmpty());
                for (double level : project.rifffs[0].stems[0].sendLevels)
                    expectEquals(level, 0.0);
            }

            beginTest("parses an empty project (no rifffs placed yet)");
            {
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(R"({"bpm": 100.0, "snapDiv": 16.0, "rifffs": []})", project, error));
                expectEquals((int) project.rifffs.size(), 0);
            }

            beginTest("fails cleanly on non-object top-level JSON");
            {
                EngineProject project;
                juce::String error;
                expect(!parseEngineProject("[1,2,3]", project, error));
                expect(error.isNotEmpty());
            }

            beginTest("fails cleanly when rifffs is present but not an array");
            {
                EngineProject project;
                juce::String error;
                expect(!parseEngineProject(R"({"bpm": 120.0, "snapDiv": 16.0, "rifffs": {}})", project, error));
                expect(error.isNotEmpty());
            }

            beginTest("fails cleanly when stems is present but not an array");
            {
                const juce::String json = R"(
                {
                  "bpm": 120.0,
                  "snapDiv": 16.0,
                  "rifffs": [
                    {
                      "groupId": "r1",
                      "startBar": 4.0,
                      "barLength": 8,
                      "fadeInBars": 0.0,
                      "fadeOutBars": 0.0,
                      "stems": "oops"
                    }
                  ]
                }
                )";
                EngineProject project;
                juce::String error;
                expect(!parseEngineProject(json, project, error));
                expect(error.isNotEmpty());
            }
        }
    };

    static EngineProjectTests engineProjectTests;
}

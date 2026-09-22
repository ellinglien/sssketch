#include "EngineProject.h"
#include <juce_core/juce_core.h>

namespace sssketch
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
                          "muted": false
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
            }

            beginTest("parses a one-shot stem's oneShot/trim fields");
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
                      "stems": [
                        {
                          "stemKey": "r1:1",
                          "resolvedPath": "/tmp/kick.wav",
                          "durationSec": 0.6,
                          "barLength": 8,
                          "offsetSteps": 0.0,
                          "startBarOverride": -1.0,
                          "volume": 1.0,
                          "muted": false,
                          "oneShot": true,
                          "trimStartSec": 0.1,
                          "trimEndSec": 0.5
                        }
                      ]
                    }
                  ]
                }
                )";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expect(project.rifffs[0].stems[0].oneShot);
                expectWithinAbsoluteError(project.rifffs[0].stems[0].trimStartSec, 0.1, 1.0e-9);
                expectWithinAbsoluteError(project.rifffs[0].stems[0].trimEndSec, 0.5, 1.0e-9);
            }

            beginTest("defaults oneShot to false and trimEndSec to -1 when omitted");
            {
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(
                    R"({"bpm": 120.0, "snapDiv": 16.0, "rifffs": [{"groupId": "r1", "startBar": 0.0,
                       "barLength": 8, "fadeInBars": 0.0, "fadeOutBars": 0.0, "stems": [
                       {"stemKey": "r1:1", "resolvedPath": "/tmp/a.wav", "durationSec": 1.0,
                        "barLength": 8, "offsetSteps": 0.0, "startBarOverride": -1.0,
                        "volume": 1.0, "muted": false}]}]})",
                    project, error));
                expect(!project.rifffs[0].stems[0].oneShot);
                expectWithinAbsoluteError(project.rifffs[0].stems[0].trimEndSec, -1.0, 1.0e-9);
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

            beginTest("parses masterChain from the wire payload");
            {
                const auto json = R"({
                    "bpm": 120, "snapDiv": 16, "rifffs": [],
                    "masterChain": [
                        { "pluginId": "VST3-pro-q-3-abc", "path": "/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3" },
                        { "pluginId": "", "path": "" },
                        { "pluginId": "VST3-soothe2-def", "path": "/Library/Audio/Plug-Ins/VST3/soothe2.vst3" },
                        { "pluginId": "", "path": "" }
                    ]
                })";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expectEquals(project.masterChain[0].pluginId, juce::String("VST3-pro-q-3-abc"));
                expectEquals(project.masterChain[0].path, juce::String("/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3"));
                expectEquals(project.masterChain[1].pluginId, juce::String(""));
                expectEquals(project.masterChain[2].pluginId, juce::String("VST3-soothe2-def"));
                expectEquals(project.masterChain[2].path, juce::String("/Library/Audio/Plug-Ins/VST3/soothe2.vst3"));
                expectEquals(project.masterChain[3].pluginId, juce::String(""));
            }

            beginTest("missing masterChain defaults to all-empty slots");
            {
                const auto json = R"({"bpm": 120, "snapDiv": 16, "rifffs": []})";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                for (const auto& slot : project.masterChain)
                {
                    expectEquals(slot.pluginId, juce::String(""));
                    expectEquals(slot.path, juce::String(""));
                }
            }

            beginTest("parses channelId on a rifff");
            {
                const auto json = R"({
                    "bpm": 120, "snapDiv": 16,
                    "rifffs": [
                        { "groupId": "r1", "channelId": "ch-1", "startBar": 0, "barLength": 8, "fadeInBars": 0, "fadeOutBars": 0, "stems": [] }
                    ]
                })";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expectEquals((int) project.rifffs.size(), 1);
                expectEquals(project.rifffs[0].channelId, juce::String("ch-1"));
            }

            beginTest("missing channelId on a rifff defaults to empty");
            {
                const auto json = R"({
                    "bpm": 120, "snapDiv": 16,
                    "rifffs": [
                        { "groupId": "r1", "startBar": 0, "barLength": 8, "fadeInBars": 0, "fadeOutBars": 0, "stems": [] }
                    ]
                })";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expectEquals(project.rifffs[0].channelId, juce::String(""));
            }

            beginTest("parses channelChains from the wire payload");
            {
                const auto json = R"({
                    "bpm": 120, "snapDiv": 16, "rifffs": [],
                    "channelChains": [
                        {
                            "channelId": "ch-1",
                            "slots": [
                                { "pluginId": "id-a", "path": "/a.vst3" },
                                { "pluginId": "", "path": "" }
                            ]
                        }
                    ]
                })";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expectEquals((int) project.channelChains.size(), 1);
                expectEquals(project.channelChains[0].channelId, juce::String("ch-1"));
                expectEquals(project.channelChains[0].slots[0].pluginId, juce::String("id-a"));
                expectEquals(project.channelChains[0].slots[0].path, juce::String("/a.vst3"));
                expectEquals(project.channelChains[0].slots[1].pluginId, juce::String(""));
            }

            beginTest("missing channelChains defaults to empty");
            {
                const auto json = R"({"bpm": 120, "snapDiv": 16, "rifffs": []})";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expect(project.channelChains.empty());
            }

            beginTest("masterChain slot parses stateBase64, defaulting to empty when absent");
            {
                EngineProject project;
                juce::String error;
                const bool ok = parseEngineProject(
                    R"({"masterChain":[{"pluginId":"reverb","path":"/plugins/reverb.vst3","stateBase64":"AQIDBA=="},{"pluginId":"","path":""},{"pluginId":"","path":""},{"pluginId":"","path":""}]})",
                    project, error);
                expect(ok);
                expectEquals(project.masterChain[0].stateBase64, juce::String("AQIDBA=="));
                expectEquals(project.masterChain[1].stateBase64, juce::String());
            }

            beginTest("channelChains slot parses stateBase64 the same way");
            {
                EngineProject project;
                juce::String error;
                const bool ok = parseEngineProject(
                    R"({"channelChains":[{"channelId":"kick","slots":[{"pluginId":"comp","path":"/plugins/comp.vst3","stateBase64":"Q0FUUw=="},{"pluginId":"","path":""}]}]})",
                    project, error);
                expect(ok);
                expect(project.channelChains.size() == 1);
                expectEquals(project.channelChains[0].slots[0].stateBase64, juce::String("Q0FUUw=="));
            }

            beginTest("parses leftCropBars from the wire format, defaulting to 0.0 when omitted");
            {
                const juce::String json = R"({
                    "bpm": 120.0,
                    "snapDiv": 16.0,
                    "rifffs": [{
                        "groupId": "r1",
                        "channelId": "c1",
                        "startBar": 0.0,
                        "barLength": 4,
                        "stems": [
                            { "stemKey": "s1", "resolvedPath": "/a.wav", "durationSec": 8.0,
                              "barLength": 4, "leftCropBars": 1.5 },
                            { "stemKey": "s2", "resolvedPath": "/b.wav", "durationSec": 8.0,
                              "barLength": 4 }
                        ]
                    }]
                })";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expectWithinAbsoluteError(project.rifffs[0].stems[0].leftCropBars, 1.5, 0.0001);
                expectWithinAbsoluteError(project.rifffs[0].stems[1].leftCropBars, 0.0, 0.0001);
            }

            beginTest("parses muteRegions on a stem");
            {
                EngineProject project;
                juce::String error;
                bool ok = parseEngineProject(
                    R"({"rifffs":[{"groupId":"g1","stems":[{"stemKey":"g1:0","muteRegions":[{"startBar":4,"endBar":8},{"startBar":12,"endBar":16}]}]}]})",
                    project, error);
                expect(ok);
                expectEquals(project.rifffs.size(), (size_t) 1);
                expectEquals(project.rifffs[0].stems.size(), (size_t) 1);
                const auto& regions = project.rifffs[0].stems[0].muteRegions;
                expectEquals(regions.size(), (size_t) 2);
                expectEquals(regions[0].startBar, 4.0);
                expectEquals(regions[0].endBar, 8.0);
                expectEquals(regions[1].startBar, 12.0);
                expectEquals(regions[1].endBar, 16.0);
            }

            beginTest("defaults to empty muteRegions when absent");
            {
                EngineProject project;
                juce::String error;
                bool ok = parseEngineProject(
                    R"({"rifffs":[{"groupId":"g1","stems":[{"stemKey":"g1:0"}]}]})",
                    project, error);
                expect(ok);
                expect(project.rifffs[0].stems[0].muteRegions.empty());
            }

            // ---- built-in sound toolkit wire format ----
            // See docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md.

            beginTest("a project with no toolkit fields parses to exactly neutral defaults");
            {
                // This is what EVERY project saved before the toolkit existed
                // looks like on the wire. It must parse without complaint and
                // land on values PlaybackEngine's own neutrality test skips.
                EngineProject project;
                juce::String error;
                bool ok = parseEngineProject(
                    R"({"bpm":120.0,"rifffs":[{"groupId":"g1","stems":[{"stemKey":"g1:0"}]}]})",
                    project, error);
                expect(ok, error);
                expect(project.channelToolkits.empty());
                expectEquals(project.reverb.roomSize, 0.5);
                expectEquals(project.reverb.damping, 0.5);
                expectEquals(project.reverb.preDelayMs, 20.0);
            }

            beginTest("parses per-channel filter, send, volume and automation curves");
            {
                const juce::String json = R"(
                {
                  "bpm": 120.0,
                  "reverb": { "roomSize": 0.8, "damping": 0.2, "preDelayMs": 45.0 },
                  "channelToolkits": [
                    {
                      "channelId": "ch-1",
                      "filterMode": "highpass",
                      "filterCutoff": 0.4,
                      "filterResonance": 0.6,
                      "reverbSend": 0.35,
                      "volume": 0.9,
                      "automation": {
                        "filterCutoff": [
                          { "bar": 0.0, "value": 0.1 },
                          { "bar": 8.0, "value": 0.9 }
                        ],
                        "reverbSend": [ { "bar": 4.0, "value": 1.0 } ]
                      }
                    }
                  ],
                  "rifffs": []
                })";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error), error);

                expectEquals((int) project.channelToolkits.size(), 1);
                const auto& toolkit = project.channelToolkits[0];
                expect(toolkit.channelId == "ch-1");
                expect(toolkit.filterMode == FilterMode::highpass);
                expectEquals(toolkit.filterCutoff, 0.4);
                expectEquals(toolkit.filterResonance, 0.6);
                expectEquals(toolkit.reverbSend, 0.35);
                expectEquals(toolkit.volume, 0.9);

                expectEquals((int) toolkit.automation.filterCutoff.size(), 2);
                expectEquals(toolkit.automation.filterCutoff[0].bar, 0.0);
                expectEquals(toolkit.automation.filterCutoff[1].value, 0.9);
                expectEquals((int) toolkit.automation.reverbSend.size(), 1);
                // Curves not mentioned in the payload stay empty, i.e. "not
                // automated" -- distinct from "automated but flat".
                expect(toolkit.automation.filterResonance.empty());
                expect(toolkit.automation.volume.empty());

                expectEquals(project.reverb.roomSize, 0.8);
                expectEquals(project.reverb.damping, 0.2);
                expectEquals(project.reverb.preDelayMs, 45.0);
            }

            beginTest("a toolkit entry naming a mode but no cutoff stays neutral for THAT mode");
            {
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(
                    R"({"channelToolkits":[{"channelId":"ch-1","filterMode":"highpass"}],"rifffs":[]})",
                    project, error), error);
                expectEquals(project.channelToolkits[0].filterCutoff, neutralCutoffValue(FilterMode::highpass));

                EngineProject lowpassProject;
                expect(parseEngineProject(
                    R"({"channelToolkits":[{"channelId":"ch-2"}],"rifffs":[]})",
                    lowpassProject, error), error);
                expect(lowpassProject.channelToolkits[0].filterMode == FilterMode::lowpass);
                expectEquals(lowpassProject.channelToolkits[0].filterCutoff, neutralCutoffValue(FilterMode::lowpass));
            }

            beginTest("automation points are sorted, clamped and cleaned at parse time");
            {
                // evaluateAutomation assumes sorted, in-range points; this is
                // the one boundary where untrusted data gets in, so it is the
                // one place that has to enforce it.
                const juce::String json = R"(
                {
                  "channelToolkits": [
                    {
                      "channelId": "ch-1",
                      "automation": {
                        "volume": [
                          { "bar": 8.0, "value": 3.0 },
                          { "bar": 2.0, "value": -1.0 },
                          { "bar": 4.0, "value": 0.5 },
                          "not an object"
                        ]
                      }
                    }
                  ],
                  "rifffs": []
                })";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error), error);

                const auto& curve = project.channelToolkits[0].automation.volume;
                expectEquals((int) curve.size(), 3); // the non-object entry is dropped
                expectEquals(curve[0].bar, 2.0);
                expectEquals(curve[1].bar, 4.0);
                expectEquals(curve[2].bar, 8.0);
                expectEquals(curve[0].value, 0.0); // -1 clamped up
                expectEquals(curve[2].value, 1.0); // 3 clamped down
            }

            beginTest("out-of-range and wrong-typed toolkit values degrade instead of failing the parse");
            {
                // Same lenient-parse convention the rest of this file uses --
                // a malformed toolkit must never cost the user their whole
                // project.
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(
                    R"({"channelToolkits":"nope","reverb":42,"rifffs":[]})", project, error), error);
                expect(project.channelToolkits.empty());
                expectEquals(project.reverb.roomSize, 0.5);

                EngineProject clamped;
                expect(parseEngineProject(
                    R"({"channelToolkits":[{"channelId":"c","filterCutoff":9.0,"reverbSend":-2.0,"volume":5.0}],"rifffs":[]})",
                    clamped, error), error);
                expectEquals(clamped.channelToolkits[0].filterCutoff, 1.0);
                expectEquals(clamped.channelToolkits[0].reverbSend, 0.0);
                expectEquals(clamped.channelToolkits[0].volume, 1.0);
            }
        }
    };

    static EngineProjectTests engineProjectTests;
}

// native-engine/Source/SoundSettingsTests.cpp
//
// The wire's `sound` block (native radio sound plan, Task 2): the C++ twin of EngineSound in
// src/shared/buildEngineProject.ts. Parsed, and nothing else yet: each stage is performed by its
// own later task. An absent block, an absent stage and junk are all OFF -- today's sound.
#include "EngineProject.h"
#include <juce_core/juce_core.h>

namespace sssketch
{
    namespace
    {
        EngineProject parse(const juce::String& json, bool& ok)
        {
            EngineProject project;
            juce::String error;
            ok = parseEngineProject(json, project, error);
            return project;
        }

        EngineProject parseSound(const juce::String& soundJson, bool& ok)
        {
            return parse(R"({"bpm":120.0,"rifffs":[],"sound":)" + soundJson + "}", ok);
        }
    }

    class SoundSettingsTests : public juce::UnitTest
    {
    public:
        SoundSettingsTests() : juce::UnitTest("SoundSettings") {}

        void expectAllOff(const SoundSettings& s, const juce::String& what)
        {
            expect(! s.mastering.has_value(), what + ": mastering");
            expect(! s.glue.has_value(), what + ": glue");
            expect(! s.tone.has_value(), what + ": tone");
            expect(! s.saturation.has_value(), what + ": saturation");
            expect(! s.pump.has_value(), what + ": pump");
            expect(s.room == ReverbRoom::zita, what + ": room");
            expectEquals(s.reverbReturn, 1.0, what + ": reverbReturn");
            expect(s.isNeutral(), what + ": isNeutral");
        }

        void runTest() override
        {
            beginTest("no `sound` block: every stage off, zita at today's return");
            {
                bool ok = false;
                auto p = parse(R"({"bpm":120.0,"rifffs":[]})", ok);
                expect(ok);
                expectAllOff(p.sound, "absent");
                expectAllOff(SoundSettings {}, "default-constructed");
            }

            beginTest("each field parses (the defaults' wire, as buildEngineSound sends it)");
            {
                bool ok = false;
                auto p = parseSound(R"({
                    "mastering": { "headroomDb": -4, "ceilingDb": -1 },
                    "glue": { "thresholdDb": -14, "ratio": 2, "kneeDb": 6 },
                    "tone": { "lowShelfDb": 1, "highShelfDb": 1.5 },
                    "saturation": { "drive": 0.9 },
                    "room": "cavern",
                    "reverbReturn": 0.5,
                    "pump": { "depthDb": 4 }
                })", ok);
                expect(ok);
                const auto& s = p.sound;
                expect(s.mastering.has_value() && s.glue.has_value() && s.tone.has_value()
                       && s.saturation.has_value() && s.pump.has_value());
                if (! (s.mastering && s.glue && s.tone && s.saturation && s.pump)) return;
                expectEquals(s.mastering->headroomDb, -4.0);
                expectEquals(s.mastering->ceilingDb, -1.0);
                expectEquals(s.glue->thresholdDb, -14.0);
                expectEquals(s.glue->ratio, 2.0);
                expectEquals(s.glue->kneeDb, 6.0);
                expectEquals(s.tone->lowShelfDb, 1.0);
                expectEquals(s.tone->highShelfDb, 1.5);
                expectEquals(s.saturation->drive, 0.9);
                expect(s.room == ReverbRoom::cavern);
                expectEquals(s.reverbReturn, 0.5);
                expectEquals(s.pump->depthDb, 4.0);
                expect(! s.isNeutral());
            }

            beginTest("an absent stage is off; the rest still parse");
            {
                bool ok = false;
                auto p = parseSound(R"({ "room": "cavern", "pump": { "depthDb": 2 } })", ok);
                expect(ok);
                expect(! p.sound.mastering.has_value() && ! p.sound.glue.has_value());
                expect(p.sound.pump.has_value() && p.sound.pump->depthDb == 2.0);
                expect(p.sound.room == ReverbRoom::cavern);
                expectEquals(p.sound.reverbReturn, 1.0);
            }

            beginTest("junk degrades to off, never a parse failure");
            {
                bool ok = false;
                auto whole = parseSound(R"("loud")", ok);
                expect(ok, "a non-object block still parses the project");
                expectAllOff(whole.sound, "a string block");

                auto p = parseSound(R"({
                    "mastering": { "headroomDb": "lots", "ceilingDb": -1 },
                    "glue": [1, 2, 3],
                    "tone": { "lowShelfDb": 1 },
                    "saturation": null,
                    "room": "hall",
                    "reverbReturn": "x",
                    "pump": { "depthDb": true }
                })", ok);
                expect(ok);
                expectAllOff(p.sound, "junk stages");
            }

            beginTest("values are held to the stages' ranges");
            {
                bool ok = false;
                auto p = parseSound(R"({
                    "mastering": { "headroomDb": -50, "ceilingDb": 6 },
                    "glue": { "thresholdDb": -99, "ratio": 0.2, "kneeDb": 99 },
                    "tone": { "lowShelfDb": 40, "highShelfDb": -40 },
                    "saturation": { "drive": 9 },
                    "room": "zita",
                    "reverbReturn": 9,
                    "pump": { "depthDb": -3 }
                })", ok);
                expect(ok);
                const auto& s = p.sound;
                if (! (s.mastering && s.glue && s.tone && s.saturation && s.pump))
                {
                    expect(false, "every stage present");
                    return;
                }
                expectEquals(s.mastering->headroomDb, -8.0);
                expectEquals(s.mastering->ceilingDb, -0.3);
                expectEquals(s.glue->thresholdDb, -40.0);
                expectEquals(s.glue->ratio, 1.0);
                expectEquals(s.glue->kneeDb, 24.0);
                expectEquals(s.tone->lowShelfDb, 6.0);
                expectEquals(s.tone->highShelfDb, -6.0);
                expectEquals(s.saturation->drive, 1.8);
                expectEquals(s.reverbReturn, 2.0);
                expectEquals(s.pump->depthDb, 0.0);
            }

            beginTest("the room alone, zita at today's return, is neutral; the cavern is not");
            {
                SoundSettings s;
                expect(s.isNeutral());
                s.room = ReverbRoom::cavern;
                expect(! s.isNeutral());
                s = {};
                s.reverbReturn = 0.5;
                expect(! s.isNeutral());
            }
        }
    };

    static SoundSettingsTests soundSettingsTests;
}

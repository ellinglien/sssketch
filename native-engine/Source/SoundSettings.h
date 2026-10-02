// native-engine/Source/SoundSettings.h
#pragma once
#include <juce_core/juce_core.h>
#include <optional>

namespace sssketch
{
    enum class ReverbRoom
    {
        /** zita-rev1, the ReverbBus as it was before the radio sound: today's room. */
        zita,
        /** The web radio's convolver room (CavernReverb.h, run by ReverbBus since Task 5). */
        cavern
    };

    /** The project's radio sound settings as the wire carries them: RESOLVED parameters, never
     * the UI's amounts. Twin of EngineSound in src/shared/buildEngineProject.ts -- the
     * hand-synced pair CLAUDE.md warns about (see docs/superpowers/plans/
     * 2026-10-01-native-radio-sound.md, Task 2).
     *
     * EVERY STAGE IS OPTIONAL, and absent means off. A payload with no `sound` key, an absent
     * stage, and a stage the parser could not read are all the same thing: that stage is not
     * there, which is today's sound, bit for bit. A default-constructed SoundSettings is
     * exactly that (isNeutral()).
     *
     * Each stage is performed by its own task: mastering (headroom and the true-peak limiter)
     * since Task 3, glue and tone inside it since Task 7 and saturation since Task 8, by
     * MasterStage through PlaybackEngine::processMaster; the room and its return since Task 5,
     * by ReverbBus (zita or CavernReverb); the pump since Task 9, by DrumPump through
     * PlaybackEngine::renderBlock, keyed and routed by each stem's EngineStem::pumpRole; the dub
     * echo since Task 10, by DubDelayBus, fed by each stem's dubSend curve. */
    struct SoundSettings
    {
        /** The headroom trim and the true-peak limiter. */
        struct Mastering
        {
            double headroomDb = -4.0;  // -8..0
            double ceilingDb = -1.0;   // -3..-0.3 dBTP
        };
        /** Faust glue (glue.dsp); only ever present with mastering. */
        struct Glue
        {
            double thresholdDb = -14.0; // -40..0
            double ratio = 2.0;         // 1..10
            double kneeDb = 6.0;        // 0..24
        };
        /** HP 25 Hz, width and the two shelves; only ever present with mastering. */
        struct Tone
        {
            double lowShelfDb = 1.0;  // at 100 Hz, -6..6
            double highShelfDb = 1.0; // at 10 kHz, -6..6
        };
        /** Faust saturate (saturate.dsp); only ever present with mastering. */
        struct Saturation
        {
            double drive = 0.9; // 0..1.8
        };
        /** The drum-keyed pump (pump.dsp; DrumPump.h). Its depth only: the release (200 ms) and
         * the 3 ms attack are the .dsp's own, as the web runs them. */
        struct Pump
        {
            double depthDb = 4.0; // 0..8
        };
        /** The dub echo (DubDelay.h; Task 10): the echo time in beats (0.75 = a dotted eighth,
         * 1 = a quarter; the web's ThrowTiming) and the feedback, as the current throw sets them.
         * The time is delayBeats x 60 / bpm, clamped to 2 s; the feedback 0..0.95 (the web's
         * clamp; DubDelayCore caps it again at kDubStableFeedback). Fed by each stem's dubSend
         * curve, so present with no curve it builds and does nothing. */
        struct Dub
        {
            double delayBeats = 0.75; // 1/16..4
            double feedback = 0.5;    // 0..0.95
        };

        std::optional<Mastering> mastering;
        std::optional<Glue> glue;
        std::optional<Tone> tone;
        std::optional<Saturation> saturation;
        ReverbRoom room = ReverbRoom::zita;
        /** The reverb return relative to the room's own level today: 1 is today's, 0..2. Scales
         * either room's wet output (ReverbBus::setRoom); at 1 the wet samples are added untouched. */
        double reverbReturn = 1.0;
        std::optional<Pump> pump;
        std::optional<Dub> dub;

        /** True when this says nothing beyond today's behaviour: every stage off, zita, at
         * today's return. */
        bool isNeutral() const
        {
            return ! mastering && ! glue && ! tone && ! saturation && ! pump && ! dub && room == ReverbRoom::zita
                && reverbReturn == 1.0;
        }
    };

    /** The wire's `sound` value (any var) to a SoundSettings. Lenient, like the rest of
     * parseEngineProject: a non-object block is all off; a stage that is not an object, or has a
     * missing or non-finite number, is off; glue, tone and saturation are off without
     * mastering; a room other than "cavern" is zita; a non-finite reverbReturn is 1. Present
     * values are clamped to the ranges above. Never fails. */
    SoundSettings parseSoundSettings(const juce::var& sound);
}

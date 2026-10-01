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
        /** The web radio's convolver room (CavernReverb, a later task). */
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
     * Parsed only, so far: each stage is performed by its own later task (mastering and the
     * limiter Task 3, the cavern Task 5, glue and tone Task 7, saturation Task 8, the pump
     * Task 9). Until then the engine reads none of it. */
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
        /** The drum-keyed pump (pump.dsp). */
        struct Pump
        {
            double depthDb = 4.0; // 0..8
        };

        std::optional<Mastering> mastering;
        std::optional<Glue> glue;
        std::optional<Tone> tone;
        std::optional<Saturation> saturation;
        ReverbRoom room = ReverbRoom::zita;
        /** The reverb return relative to the room's own level today: 1 is today's, 0..2. */
        double reverbReturn = 1.0;
        std::optional<Pump> pump;

        /** True when this says nothing beyond today's behaviour: every stage off, zita, at
         * today's return. */
        bool isNeutral() const
        {
            return ! mastering && ! glue && ! tone && ! saturation && ! pump && room == ReverbRoom::zita
                && reverbReturn == 1.0;
        }
    };

    /** The wire's `sound` value (any var) to a SoundSettings. Lenient, like the rest of
     * parseEngineProject: a non-object block is all off; a stage that is not an object, or has a
     * missing or non-finite number, is off; a room other than "cavern" is zita; a non-finite
     * reverbReturn is 1. Present values are clamped to the ranges above. Never fails. */
    SoundSettings parseSoundSettings(const juce::var& sound);
}

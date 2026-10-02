// native-engine/Source/SoundSettings.cpp
#include "SoundSettings.h"
#include <algorithm>
#include <cmath>
#include <array>

namespace sssketch
{
    namespace
    {
        /** A finite number at `key`, or nothing (absent, null, a string, a bool, NaN...). */
        std::optional<double> finiteNumber(const juce::var& v, const char* key)
        {
            if (! v.hasProperty(key)) return std::nullopt;
            const auto x = v.getProperty(key, juce::var());
            if (! (x.isDouble() || x.isInt() || x.isInt64())) return std::nullopt;
            const double d = (double) x;
            if (! std::isfinite(d)) return std::nullopt;
            return d;
        }

        /** The stage object at `key` when it is an object whose every named field is a finite
         * number: those numbers, in order. Otherwise nothing -- the stage is off. */
        template <size_t N>
        std::optional<std::array<double, N>> stage(const juce::var& sound, const char* key, const std::array<const char*, N>& fields)
        {
            const auto s = sound.getProperty(key, juce::var());
            if (s.getDynamicObject() == nullptr) return std::nullopt;
            std::array<double, N> out {};
            for (size_t i = 0; i < N; ++i)
            {
                const auto x = finiteNumber(s, fields[i]);
                if (! x) return std::nullopt;
                out[i] = *x;
            }
            return out;
        }
    }

    SoundSettings parseSoundSettings(const juce::var& sound)
    {
        SoundSettings out;
        if (sound.getDynamicObject() == nullptr) return out;

        if (auto v = stage<2>(sound, "mastering", { "headroomDb", "ceilingDb" }))
            out.mastering = SoundSettings::Mastering { std::clamp((*v)[0], -8.0, 0.0), std::clamp((*v)[1], -3.0, -0.3) };
        if (auto v = stage<3>(sound, "glue", { "thresholdDb", "ratio", "kneeDb" }))
            out.glue = SoundSettings::Glue { std::clamp((*v)[0], -40.0, 0.0), std::clamp((*v)[1], 1.0, 10.0), std::clamp((*v)[2], 0.0, 24.0) };
        if (auto v = stage<2>(sound, "tone", { "lowShelfDb", "highShelfDb" }))
            out.tone = SoundSettings::Tone { std::clamp((*v)[0], -6.0, 6.0), std::clamp((*v)[1], -6.0, 6.0) };
        if (auto v = stage<1>(sound, "saturation", { "drive" }))
            out.saturation = SoundSettings::Saturation { std::clamp((*v)[0], 0.0, 1.8) };
        if (auto v = stage<1>(sound, "pump", { "depthDb" }))
            out.pump = SoundSettings::Pump { std::clamp((*v)[0], 0.0, 8.0) };
        if (auto v = stage<2>(sound, "dub", { "delayBeats", "feedback" }); v && (*v)[0] > 0.0)
            out.dub = SoundSettings::Dub { std::clamp((*v)[0], 0.0625, 4.0), std::clamp((*v)[1], 0.0, 0.95) };

        // Glue, tone and saturation are master stages that run only between the headroom trim
        // and the true-peak limiter: without mastering they are dropped, so no wire can build a
        // compressing, saturating chain with no limiter after it (buildEngineSound never sends
        // one; this holds for any payload).
        if (! out.mastering)
        {
            out.glue.reset();
            out.tone.reset();
            out.saturation.reset();
        }

        out.room = sound.getProperty("room", juce::var()).toString() == "cavern" ? ReverbRoom::cavern : ReverbRoom::zita;
        if (auto r = finiteNumber(sound, "reverbReturn"))
            out.reverbReturn = std::clamp(*r, 0.0, 2.0);
        return out;
    }
}

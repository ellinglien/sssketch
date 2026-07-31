// native-engine/Source/Metronome.cpp
#include "Metronome.h"
#include <cmath>

namespace ssstitch
{
    namespace
    {
        constexpr double kPi = 3.14159265358979323846;
        // A short, percussive "tick" rather than a lingering tone — long
        // enough to read as a distinct pitch, short enough to never blur
        // into the actual music playing alongside it.
        constexpr double kClickDurationSec = 0.03;
        constexpr double kDownbeatFreqHz = 1600.0;
        constexpr double kOtherBeatFreqHz = 900.0;
        constexpr float kClickAmplitude = 0.35f;
        // Exponential decay rate tuned so the envelope has dropped to
        // roughly 1% of its peak by kClickDurationSec.
        constexpr double kDecayRate = 150.0;
    }

    float metronomeSampleAt(double sampleTimeSec, double secPerBeat)
    {
        if (secPerBeat <= 0.0 || sampleTimeSec < 0.0)
            return 0.0f;

        const double beatIndexFloat = sampleTimeSec / secPerBeat;
        const long long beatIndex = (long long) std::floor(beatIndexFloat);
        const double timeSinceBeatSec = sampleTimeSec - (double) beatIndex * secPerBeat;

        if (timeSinceBeatSec >= kClickDurationSec)
            return 0.0f;

        const bool isDownbeat = (beatIndex % kMetronomeBeatsPerBar) == 0;
        const double freq = isDownbeat ? kDownbeatFreqHz : kOtherBeatFreqHz;
        const double envelope = std::exp(-timeSinceBeatSec * kDecayRate);
        return (float) (kClickAmplitude * envelope
            * std::sin(2.0 * kPi * freq * timeSinceBeatSec));
    }
}

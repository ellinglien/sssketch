// native-engine/Source/Metronome.h
#pragma once

namespace sssketch
{
    /** This app only supports 4/4 — same convention as BeatPicker's own
     * totalBeats = barLength*4. */
    static constexpr int kMetronomeBeatsPerBar = 4;

    /** Pure function of absolute transport time: what should the metronome
     * contribute at exactly `sampleTimeSec`? A short, decaying click tone at
     * every beat boundary (secPerBeat apart), pitched higher on beat 0 of
     * each bar ("the 1") than the other 3. Being a pure function of
     * absolute time — not tracking any state across calls — means it's
     * already correctly phase-locked to the project's own bar-0-relative
     * clock through any seek/scrub, the same way FadeGain.cpp's
     * evaluateGainAtTime is; no separate "resync on seek" logic needed.
     * Returns 0 for an invalid tempo (secPerBeat <= 0) or between clicks. */
    float metronomeSampleAt(double sampleTimeSec, double secPerBeat);
}

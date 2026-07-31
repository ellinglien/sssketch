// native-engine/Source/LoopSewing.h
#pragma once
#include <juce_audio_basics/juce_audio_basics.h>

namespace ssstitch
{
    /** Blends the last `windowSize` samples of `buffer` toward its own first
     * sample, per channel, using an equal-power (constant-power) crossfade —
     * so a buffer that gets looped (its tail immediately followed by its own
     * head again, as every tiled stem repeat in this app's playback is) has
     * NO discontinuity at the seam: the very last sample becomes exactly
     * equal to the very first, tapering back to the original tail content
     * `windowSize` samples earlier. Equal-power (not a linear fade to
     * silence) keeps the perceived loudness constant through the blend
     * instead of dipping — audible as a "breath" on a sustained tone
     * otherwise, which a linear silence-dip fade doesn't avoid.
     *
     * Ported from OUROVEON's Stem::applyLoopSewingBlend
     * (src/r3.endlesss/endlesss/live.stem.cpp, github.com/OUROcorp/OUROVEON)
     * — a real, shipping Endlesss client already solving this exact problem
     * for the same class of content ("as best we can tell Endlesss also
     * does something like this," per that project's own comment). Applied
     * ONCE, when a buffer is decoded and cached (see StemBufferCache) — not
     * per-block in the real-time render path — since every stem in this app
     * is always loop-eligible content, unlike a general-purpose audio
     * engine where this would need to be conditional on whether a given
     * playback instance actually loops.
     *
     * No-op if the buffer is too short to have a clean, non-overlapping
     * window (mirrors OUROVEON's own guard). `windowSize` defaults to 128
     * samples (~2.9ms at 44.1kHz) — OUROVEON's own tuned value. */
    void applyLoopSewingBlend(juce::AudioBuffer<float>& buffer, int windowSize = 128);
}

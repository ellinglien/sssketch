// native-engine/Source/LoopSewing.h
#pragma once
#include <juce_audio_basics/juce_audio_basics.h>

namespace ssstitch
{
    /** Blends the `windowSize` samples right before `loopEndSample` toward
     * `buffer`'s own first sample, per channel, using an equal-power
     * (constant-power) crossfade — so a buffer that gets looped (its content
     * up to loopEndSample immediately followed by its own head again, as
     * every tiled stem repeat in this app's playback is) has NO
     * discontinuity at the seam: sample `loopEndSample - 1` becomes exactly
     * equal to sample 0, tapering back to the original content `windowSize`
     * samples earlier. Equal-power (not a linear fade to silence) keeps the
     * perceived loudness constant through the blend instead of dipping —
     * audible as a "breath" on a sustained tone otherwise, which a linear
     * silence-dip fade doesn't avoid.
     *
     * `loopEndSample` is deliberately NOT always `buffer.getNumSamples()` —
     * PlaybackEngine::renderBlock wraps each tile at a sample index derived
     * from the STEM's own metadata durationSec, not the buffer's raw decoded
     * length, and for LORE-sourced (Ogg Vorbis) content that duration is
     * itself metadata-derived (bars × tempo) rather than measured from the
     * real audio — the two routinely differ by more than this blend's own
     * window. Blending at the wrong point declicks a seam that's never
     * actually read during playback, leaving the real, played seam
     * completely untouched. Clamped into [0, buffer.getNumSamples()].
     *
     * Ported from OUROVEON's Stem::applyLoopSewingBlend
     * (src/r3.endlesss/endlesss/live.stem.cpp, github.com/OUROcorp/OUROVEON),
     * matching its own tuning exactly (`windowSize` defaults to its literal
     * 128 samples, ~2.9ms at 44.1kHz) — earlier attempts to widen this
     * window (up to 4096 samples) and adapt it per-stem chased a real
     * symptom (still-audible artifacts) but with the wrong knob: forcibly
     * holding an OSCILLATING waveform close to one fixed anchor value for a
     * long stretch suppresses its natural amplitude swing, which reads as a
     * loudness dip, not a click — a different, self-inflicted problem, not
     * a fix. OUROVEON's own comment on this function is blunt about its
     * limits: "a fairly basic edit... to avoid trivial clicks... A better
     * version of this would be to mirror (say) Audacity's sample healing
     * tool." Matching their exact, proven-in-a-real-shipping-client value
     * is the correct baseline to build any further improvement from, not a
     * bigger window.
     *
     * No-op if the buffer is too short to have a clean, non-overlapping
     * window (mirrors OUROVEON's own guard). */
    void applyLoopSewingBlend(
        juce::AudioBuffer<float>& buffer, int loopEndSample, int windowSize = 128);
}

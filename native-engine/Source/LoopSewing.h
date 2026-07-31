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
     * window (mirrors OUROVEON's own guard). `windowSize` defaults to 512
     * samples (~11.6ms at 44.1kHz) — widened from OUROVEON's own 128-sample
     * value after real-world testing in this app found low-frequency
     * sustained tones still audibly clicking: 128 samples is a large
     * fraction of one whole cycle for a low tone, so blending toward the
     * head's fixed value within that short a window has to bend the
     * waveform's own phase to get there, which itself reads as a tick/warble
     * rather than a true click. A wider window gives the blend more room to
     * land smoothly even for low tones, at the cost of shaping slightly more
     * of the tail — a tradeoff toward this app's actual content over
     * OUROVEON's own tuning. */
    void applyLoopSewingBlend(juce::AudioBuffer<float>& buffer, int windowSize = 512);

    /** Chooses a loop-sewing blend window, in samples, from how "bassy" the
     * buffer's own tail content is — estimated via zero-crossing rate over
     * the last `maxWindow` samples of channel 0 (or the whole buffer, if
     * shorter), a cheap FFT-free proxy for dominant frequency: fewer
     * crossings per second means a lower tone. A low tone doesn't complete
     * even one full cycle within a short fixed window, forcing the blend to
     * bend its own phase to land on the head's value — audible as a tick/
     * warble (see applyLoopSewingBlend's own doc comment on why the default
     * window was already widened once for this same reason). A bassy seam
     * gets a wider window still, giving the blend more room to land
     * smoothly; a bright/percussive one keeps closer to the narrower
     * default, since a wide window there would needlessly smear a
     * transient sitting close to the loop point.
     *
     * Returns `maxWindow` at or below 150Hz, `minWindow` at or above
     * 1000Hz, interpolated in log-frequency space (matching how pitch
     * itself is perceived) in between. Falls back to `minWindow` for an
     * empty buffer, invalid sample rate, or a tail quiet enough to read as
     * silence (near-silence has almost no zero crossings too, but for a
     * different reason than genuine bass — there's no phase to preserve, so
     * a wide window there would just ramp audible silence up into whatever
     * the head sounds like, e.g. a downbeat's own onset for a re-one'd
     * loop). */
    int adaptiveLoopSewingWindow(
        const juce::AudioBuffer<float>& buffer, int minWindow, int maxWindow, double sampleRate);
}

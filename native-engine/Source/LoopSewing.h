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
    void applyLoopSewingBlend(
        juce::AudioBuffer<float>& buffer, int loopEndSample, int windowSize = 512);

    /** Chooses a loop-sewing blend window, in samples, from how "bassy" the
     * content right before `loopEndSample` is — estimated via zero-crossing
     * rate over the last `maxWindow` samples of channel 0 before
     * `loopEndSample` (or fewer, if the loop is shorter), a cheap FFT-free
     * proxy for dominant frequency: fewer crossings per second means a
     * lower tone. A low tone doesn't complete even one full cycle within a
     * short fixed window, forcing the blend to bend its own phase to land
     * on the head's value — audible as a tick/warble (see
     * applyLoopSewingBlend's own doc comment on why the default window was
     * already widened once for this same reason). A bassy seam gets a
     * wider window still, giving the blend more room to land smoothly; a
     * bright/percussive one keeps closer to the narrower default, since a
     * wide window there would needlessly smear a transient sitting close
     * to the loop point.
     *
     * Returns `maxWindow` at or below 150Hz, `minWindow` at or above
     * 1000Hz, interpolated in log-frequency space (matching how pitch
     * itself is perceived) in between. Falls back to `minWindow` for an
     * empty buffer, invalid sample rate, or content quiet enough to read as
     * silence (near-silence has almost no zero crossings too, but for a
     * different reason than genuine bass — there's no phase to preserve, so
     * a wide window there would just ramp audible silence up into whatever
     * the head sounds like, e.g. a downbeat's own onset for a re-one'd
     * loop). */
    int adaptiveLoopSewingWindow(const juce::AudioBuffer<float>& buffer, int loopEndSample,
        int minWindow, int maxWindow, double sampleRate);
}

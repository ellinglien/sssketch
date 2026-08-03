// native-engine/Source/LoopRecorder.h
#pragma once
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <memory>
#include <vector>

namespace sssketch
{
    /** Captures live input into a single buffer sized to exactly one loop
     * pass, overwritten every pass -- a classic loop-pedal model, not a
     * retrospective/ring buffer. See
     * docs/superpowers/specs/2026-08-03-loop-recording-design.md's
     * "Capture mechanic" section for the full rationale, including why
     * pass-boundary detection lives entirely in Transport's own per-block
     * loop-wrap math rather than anything IPC-driven.
     *
     * Not thread-safe in general, but every method here is only ever
     * called from the audio thread (Transport::audioDeviceIOCallbackWithContext
     * and the renderLoopAware wrap-check it drives) -- there is no
     * message-thread access to an active LoopRecorder instance's mutable
     * state, matching how PlaybackEngine::renderBlock itself is only ever
     * called from that same one thread. */
    class LoopRecorder
    {
    public:
        LoopRecorder(double sampleRate, double loopLengthSeconds);

        /** Feeds one block of live input (mono downmix from however many
         * input channels the device provided -- a recording channel
         * doesn't need stereo capture for v1, matching this feature's own
         * "one pass, one clip" simplicity elsewhere). Writes starting at
         * the current write position, wrapping via onPassBoundary() below
         * rather than internally -- the caller (Transport) already knows
         * exactly when a boundary falls within a block from its own
         * wrap-math, and is what actually calls onPassBoundary at the
         * right sample index. */
        void writeBlock(const float* const* inputChannelData, int numInputChannels, int startSample, int numSamples);

        /** Called by Transport exactly when its own loop-wrap math detects
         * the recording loop boundary was crossed this block -- finalizes
         * whatever's in the buffer as "a completed pass" and resets the
         * write position to 0 for the next one. */
        void onPassBoundary();

        /** True once writeBlock() calls have filled the buffer completely
         * since the last onPassBoundary() reset -- purely a count of
         * samples actually written, independent of the transport's own
         * position clock. Transport calls onPassBoundary() based on this,
         * not on its own bars/position math: recording capture runs
         * "independent of play/pause" (see Transport.cpp's own comment at
         * the call site), so positionBars can sit frozen indefinitely
         * while paused -- deriving the boundary from position rather than
         * from actual accumulated write count would fire repeatedly, once
         * per callback, for as long as a pause happened to land inside the
         * trigger window, corrupting the capture instead of completing one
         * pass. Sample count only ever advances via real writeBlock()
         * calls, which happen every callback regardless of play state, so
         * this can only ever cross the threshold once per bufferful. */
        bool isFull() const { return writePos >= buffer.getNumSamples(); }

        /** True once at least one full pass has completed since
         * construction (or since the buffer was last reset by a prior
         * onPassBoundary() call) -- checked at disarm time to decide
         * whether there's anything to commit. */
        bool hasCompletedPass() const { return completedPass; }

        /** Per-bucket peak amplitude across however much of the buffer has
         * been written so far this pass (0 for buckets past the current
         * write position) -- numBuckets fixed, small (the renderer just
         * needs enough resolution for a coarse "building up" bar graph,
         * not a full waveform). Same "downsample into N buckets" idea as
         * @shared/visuals' peaksFromChannel on the renderer side, kept
         * separately here since this is a live, partially-filled buffer
         * being sampled every 33ms, not a one-shot full-file decode. */
        std::vector<float> peaksSoFar(int numBuckets) const;

        /** Writes the current buffer contents to a 16-bit mono WAV file at
         * the given path. Returns false (and leaves outputPath untouched)
         * on failure -- mirrors RenderExport.cpp's own
         * WavAudioFormat::createWriterFor error-handling convention (null
         * writer = failure, no exception). Meaningful to call regardless
         * of hasCompletedPass() (the caller is expected to check that
         * first and skip calling this at all if there's nothing to
         * commit -- this method itself doesn't re-check, so it always
         * writes whatever the buffer currently holds if asked). */
        bool writeToWavFile(const juce::String& outputPath) const;

    private:
        double sampleRate;
        juce::AudioBuffer<float> buffer;
        int writePos = 0;
        bool completedPass = false;
    };
}

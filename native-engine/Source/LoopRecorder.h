// native-engine/Source/LoopRecorder.h
#pragma once
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>
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
     * Not thread-safe in general -- writeBlock/onPassBoundary/isFull are
     * only ever called from the audio thread
     * (Transport::audioDeviceIOCallbackWithContext and the renderLoopAware
     * wrap-check it drives); writeToWavFile is only ever called from the
     * message thread after the recorder has already been detached from
     * Transport (see IpcServer.cpp's disarm-recording handler). The
     * deliberate exceptions are hasCompletedPass()/peaksSoFar(), which ARE
     * called from the message thread (IpcConnection::timerCallback)
     * concurrently with the audio thread still actively writing -- that's
     * the entire point of live capture-level feedback while armed.
     * writePos and completedPass are both std::atomic specifically to
     * make those cross-thread reads safe, same handoff pattern Transport
     * itself uses for every other field that crosses this boundary (see
     * Transport.h): the audio thread publishes writePos (release) only
     * after the samples up to that index are written, so peaksSoFar's
     * acquire-load never reads buffer past what's actually been written;
     * it publishes completedPass (release) only after lastCompletedBuffer
     * has been fully copied in onPassBoundary(), so peaksSoFar's
     * acquire-load of hasCompletedPass() never reads lastCompletedBuffer
     * before THAT copy is complete -- eliminates the first-observation
     * race outright. What it does NOT close: if a LATER onPassBoundary()
     * call (a second completed pass) lands on the audio thread while
     * peaksSoFar()'s own read loop is still iterating over
     * lastCompletedBuffer from the FIRST one, that later call's
     * `lastCompletedBuffer = buffer` is a plain, non-atomic overwrite
     * racing the read -- same category of accepted risk as the
     * buffer.clear() note below, just a narrower window (peaksSoFar's own
     * loop, not a whole callback) and needing two full passes to complete
     * back-to-back inside one ~33ms poll interval to even be reachable.
     * buffer's and lastCompletedBuffer's underlying storage are both
     * fixed-size for the object's whole lifetime (allocated once in the
     * constructor, never resized), so there's no reallocation race on top
     * of either index/flag one. During writeBlock() the buffer read is
     * airtight. During onPassBoundary()'s buffer.clear(), it's
     * deliberately narrowed rather than eliminated (see that method's own
     * doc comment) -- a fully rigorous fix for either of these residual
     * windows would need a generation counter or double-buffering, more
     * machinery than a cosmetic live meter warrants; the accepted
     * residual risk in both cases is a vanishingly narrow, real-hardware-
     * only window, not the deterministic every-pass race that existed
     * before this class's own history of fixes. */
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
         * the recording loop boundary was crossed this block -- snapshots
         * the just-finished pass into lastCompletedBuffer (see its own doc
         * comment for why a separate copy is needed, not just a flag),
         * then resets the write position to 0 and clears buffer for the
         * next one. */
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
        bool isFull() const { return writePos.load() >= buffer.getNumSamples(); }

        /** True once at least one full pass has ever completed since
         * construction -- once true, stays true for the rest of this
         * object's lifetime (there's always SOME completed pass sitting in
         * lastCompletedBuffer from that point on, even while a newer,
         * still-in-progress pass is busy overwriting buffer). Checked at
         * disarm time to decide whether there's anything to commit, and
         * (as of peaksSoFar()'s own live-preview fallback below) also read
         * from the message thread WHILE still armed -- acquire/release
         * paired with onPassBoundary()'s store, same handoff pattern as
         * writePos below. */
        bool hasCompletedPass() const { return completedPass.load(std::memory_order_acquire); }

        /** Per-bucket peak amplitude reflecting what would actually get
         * committed if disarmed RIGHT NOW: buckets already re-recorded
         * this pass (bucketStart < current write position) read from the
         * live `buffer`; buckets not yet reached this pass fall back to
         * lastCompletedBuffer -- the previous pass, which is genuinely
         * what commit would use for that portion (see writeToWavFile) --
         * rather than reporting 0/silence for content that hasn't
         * actually been overwritten yet. Only falls back once
         * hasCompletedPass() is true; with no previous pass at all, those
         * buckets stay 0 (nothing to show). This is what makes looping
         * read as "the new pass smoothly replaces the old one, left to
         * right" instead of "the waveform blanks out and rebuilds from
         * nothing every lap" -- requested during manual testing.
         * numBuckets fixed, small (the renderer just needs enough
         * resolution for a coarse "building up" bar graph, not a full
         * waveform). Same "downsample into N buckets" idea as
         * @shared/visuals' peaksFromChannel on the renderer side, kept
         * separately here since this is live, partially-filled data being
         * sampled every 33ms, not a one-shot full-file decode. */
        std::vector<float> peaksSoFar(int numBuckets) const;

        /** Writes lastCompletedBuffer -- the most recently COMPLETED pass,
         * not whatever buffer currently holds -- to a 16-bit mono WAV file
         * at the given path. Returns false (and leaves outputPath
         * untouched) on failure -- mirrors RenderExport.cpp's own
         * WavAudioFormat::createWriterFor error-handling convention (null
         * writer = failure, no exception). Meaningful to call regardless
         * of hasCompletedPass() (the caller is expected to check that
         * first and skip calling this at all if there's nothing to commit
         * -- this method itself doesn't re-check; if no pass has ever
         * completed, lastCompletedBuffer is still just silence from the
         * constructor, so calling this anyway isn't unsafe, just
         * pointless). */
        bool writeToWavFile(const juce::String& outputPath) const;

    private:
        double sampleRate;
        juce::AudioBuffer<float> buffer;
        // Snapshot of the most recently COMPLETED pass, decoupled from
        // `buffer` (which keeps getting overwritten by whatever pass is
        // CURRENTLY in progress) -- see onPassBoundary()'s own comment for
        // why this exists. Pre-sized identically to `buffer` in the
        // constructor so the copy assignment in onPassBoundary() is always
        // same-size-to-same-size and never reallocates on the audio thread.
        juce::AudioBuffer<float> lastCompletedBuffer;
        std::atomic<int> writePos { 0 };
        std::atomic<bool> completedPass { false };
    };
}

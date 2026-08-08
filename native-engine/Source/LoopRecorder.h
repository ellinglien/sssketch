// native-engine/Source/LoopRecorder.h
#pragma once
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>
#include <memory>
#include <vector>

namespace sssketch
{
    /** Captures live input from arm to disarm, whatever length that turns
     * out to be -- NOT tied to the recording loop region's own length.
     * Earlier versions of this class required completing one full loop
     * pass before anything could commit (a classic loop-pedal model); per
     * feedback during manual testing ("it shouldn't have to record a full
     * loop before recording, it should start where it starts and stop
     * where it stops"), that constraint is gone. The loop region still
     * drives PLAYBACK looping the whole time (see Transport::
     * renderLoopAware/setRecordingLoop) -- a musician can keep jamming
     * along to a repeating bar or two -- but the CAPTURED clip's own
     * duration is simply however long the channel was actually armed for,
     * independent of how many loop passes went by during that window.
     *
     * Backed by one buffer, pre-sized generously upfront (see
     * kMaxRecordingSeconds in LoopRecorder.cpp) so writeBlock() never
     * needs to reallocate on the audio thread -- not a genuinely unbounded/
     * growable buffer (that would need real-time-unsafe reallocation, or
     * a chunked/segmented structure this feature doesn't need), just a
     * fixed ceiling generous enough that hitting it in normal use is not
     * expected. Past that ceiling, writeBlock() defensively stops writing
     * rather than overflowing (silent truncation, not a crash).
     *
     * Not thread-safe in general -- writeBlock() is only ever called from
     * the audio thread (Transport::audioDeviceIOCallbackWithContext);
     * writeToWavFile() is only ever called from the message thread after
     * the recorder has already been detached from Transport (see
     * IpcServer.cpp's disarm-recording handler). The deliberate exceptions
     * are hasAnyAudio()/peaksSoFar(), which ARE called from the message
     * thread (IpcConnection::timerCallback) concurrently with the audio
     * thread still actively writing -- that's the entire point of live
     * capture-level feedback while armed. writePos is std::atomic
     * specifically to make that cross-thread read safe, same handoff
     * pattern Transport itself uses for every other field that crosses
     * this boundary (see Transport.h): the audio thread publishes it
     * (release) only after the samples up to that index are written, so
     * peaksSoFar's acquire-load never reads buffer past what's actually
     * been written. buffer's underlying storage is fixed-size for the
     * object's whole lifetime (allocated once in the constructor, never
     * resized), so there's no reallocation race to worry about on top of
     * the index one. */
    class LoopRecorder
    {
    public:
        LoopRecorder(double sampleRate);

        /** Feeds one block of live input, captured as real stereo -- the
         * first two input channels JUCE gives us are written straight to
         * this recorder's own left/right channels; a mono (single-channel)
         * device instead has that one channel duplicated to both, so a
         * mono mic still produces a valid, non-silent stereo file rather
         * than one channel of the take going empty. (v1 of this feature
         * downmixed everything to mono -- per direct feedback ("is it
         * recording in stereo? it seems like mono"), that's gone.) Appends
         * starting at the current write position; stops (silently
         * truncating, not overflowing) once the pre-allocated ceiling is
         * reached. */
        void writeBlock(const float* const* inputChannelData, int numInputChannels, int startSample, int numSamples);

        /** True once writeBlock() has captured at least one real sample --
         * checked at disarm time to decide whether there's anything to
         * commit at all (arming and immediately disarming with no audio
         * in between should produce no clip, but any amount of real
         * capture, however short, now does -- no minimum-length
         * requirement). */
        bool hasAnyAudio() const { return writePos.load(std::memory_order_acquire) > 0; }

        /** How much real time has been captured so far, in seconds --
         * lets the renderer size the live overlay to match how long the
         * take has actually grown to (see IpcServer.cpp's
         * capture-level-update push), rather than the recording loop
         * region's own fixed bounds, which no longer constrain capture
         * length at all (see this class's own doc comment). */
        double elapsedSeconds() const
        {
            return (double) writePos.load(std::memory_order_acquire) / sampleRate;
        }

        /** Per-bucket peak amplitude across whatever's been captured so
         * far this session (0 buckets/empty result if nothing's been
         * written yet) -- numBuckets fixed, small (the renderer just
         * needs enough resolution for a coarse "building up" bar graph,
         * not a full waveform). Rescales continuously as more gets
         * captured (bucket boundaries are fractions of the CURRENT write
         * position, not of the fixed backing buffer's full ceiling), so
         * the live view reads as one steadily growing recording rather
         * than a fixed-width bar that fills up and resets. Same
         * "downsample into N buckets" idea as @shared/visuals'
         * peaksFromChannel on the renderer side, kept separately here
         * since this is live, partially-filled data being sampled every
         * 33ms, not a one-shot full-file decode. */
        std::vector<float> peaksSoFar(int numBuckets) const;

        /** Fixed-width bucketing, unlike peaksSoFar's fixed-COUNT rescaling
         * above -- one bucket per full bucketDurationSec of audio actually
         * captured so far, growing in LENGTH as more gets captured but
         * never recomputing a bucket already returned by an earlier call (a
         * bucket's own sample range, once it exists, never changes). Built
         * for the renderer's live capture overlay (see ChannelRow.tsx):
         * peaksSoFar's rescaling made that overlay visibly reshape its
         * already-drawn portion on every poll, since EVERY bucket's
         * boundaries (including bucket 0's) widened each time more got
         * captured -- not the "write once and leave it" look that's
         * actually wanted for something meant to be watched growing in
         * real time. Trade-off: the most recent partial bucket (up to
         * almost bucketDurationSec of audio) is never included -- a
         * bucket's value is only ever computed once, over its complete
         * range, so an incomplete one can't be returned without later
         * being recomputed differently once it does complete, recreating
         * the exact problem this method exists to avoid. */
        std::vector<float> peaksFixedWindow(double bucketDurationSec) const;

        /** Writes whatever's been captured so far (writePos samples, not
         * the full pre-allocated buffer) to a 16-bit stereo WAV file at the
         * given path. Returns false (and leaves outputPath untouched) on
         * failure -- mirrors RenderExport.cpp's own
         * WavAudioFormat::createWriterFor error-handling convention (null
         * writer = failure, no exception). Meaningful to call regardless
         * of hasAnyAudio() (the caller is expected to check that first and
         * skip calling this at all if there's nothing to commit -- this
         * method itself doesn't re-check; with writePos == 0 it just
         * writes a zero-length WAV, not unsafe, just pointless). */
        bool writeToWavFile(const juce::String& outputPath) const;

    private:
        double sampleRate;
        juce::AudioBuffer<float> buffer;
        std::atomic<int> writePos { 0 };
    };
}

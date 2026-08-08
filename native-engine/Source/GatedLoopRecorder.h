// native-engine/Source/GatedLoopRecorder.h
#pragma once
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>
#include <atomic>
#include <vector>

namespace sssketch
{
    /** Endlesss-style threshold-gated recording, bounded to exactly one
     * loop pass -- unlike LoopRecorder (arm-to-disarm, unbounded,
     * monotonically growing, see its own doc comment), this class:
     *   - has a FIXED buffer sized to one loop pass (loopLengthBars at the
     *     project's own tempo), silence-initialized and never resized
     *   - only actually writes samples while the input level is above a
     *     fixed (deliberately non-configurable, per product decision)
     *     RMS threshold, or within kReleaseHangoverSeconds of last being
     *     above it -- "always listening" once enabled, not armed/disarmed
     *     by the user for each take
     *   - is NEVER cleared between laps -- each loop-relative position
     *     just keeps getting overwritten every time the gate is open
     *     there, lap after lap, so "lock in" always reflects a FULL loop:
     *     fresh audio wherever the current pass has reached, naturally
     *     falling back to whatever an EARLIER pass captured at any
     *     position the current one hasn't reached (or re-recorded) yet.
     *     (An earlier version of this class cleared the buffer at the
     *     start of every new lap -- that was wrong, per direct feedback:
     *     locking in produced a half-loop missing everything past
     *     wherever you happened to press the key, instead of a complete
     *     loop built up across takes.)
     *   - can be read out (writeToWavFile) at any time WITHOUT stopping
     *     capture -- locking in a take doesn't interrupt playback or the
     *     recorder itself, which just keeps listening for the next lap.
     *     The exported copy also gets its own loop-point seam blended
     *     (see writeToWavFile's own doc comment) so the take tiles
     *     seamlessly once placed, matching Transport.cpp's own
     *     "blend the outgoing tail toward the incoming head's value"
     *     declick technique used for the master output's own loop wrap.
     *
     * Buffer access is guarded by a short CriticalSection, not lock-free
     * like LoopRecorder's writePos/acquire-release handoff -- a deliberate
     * trade-off: this buffer is repeatedly OVERWRITTEN at arbitrary
     * positions (not just monotonically appended to), so there's no single
     * "how far is it safe to read" index to publish atomically the way
     * LoopRecorder does. The lock is only ever held for a bounded,
     * memcpy-sized copy (see writeBlock's own inner critical section and
     * writeToWavFile's snapshot-then-release pattern below) -- never for
     * file I/O or any unbounded work -- so contention/priority-inversion
     * risk on the audio thread stays negligible in practice, the same
     * trade-off real-world audio engines commonly make for infrequent
     * cross-thread commit actions like this one (locking in a take is a
     * rare, user-paced action, not a per-block operation). */
    class GatedLoopRecorder
    {
    public:
        GatedLoopRecorder(double sampleRate, double loopLengthBars, double secPerBar);

        /** Called every audio callback while gated recording is enabled.
         * loopRelativeStartBar is this block's own start position, already
         * wrapped into [0, loopLengthBars) by the caller
         * (Transport::renderLoopAware already computes exactly this for
         * output audio) -- this class trusts it rather than re-deriving
         * it, and uses it only to find where in its own fixed buffer to
         * write. Never clears anything -- see this class's own doc
         * comment on why the buffer persists across laps by design.
         * Captures real stereo -- the first two input channels are written
         * straight to this recorder's own left/right channels; a mono
         * (single-channel) device has that one channel duplicated to both,
         * matching LoopRecorder's own convention (see its writeBlock's own
         * doc comment) -- both recording paths downmixed to mono in v1,
         * which is gone now per direct feedback. */
        void writeBlock(const float* const* inputChannelData, int numInputChannels, int startSample,
                         int numSamples, double loopRelativeStartBar);

        /** True while currently above the gate threshold, or still within
         * the release hangover after last being above it -- i.e.
         * "actively capturing right now," for UI feedback. */
        bool isGateOpen() const { return gateOpen.load(std::memory_order_relaxed); }

        /** Writes the buffer's current full contents (silence only where
         * NO lap has ever recorded anything at that position -- see this
         * class's own doc comment) to a 16-bit stereo WAV file. Applies an
         * equal-power crossfade right at the loop point first, across
         * EVERY channel (the exported copy's own last kSeamFadeSeconds
         * blended toward its first kSeamFadeSeconds' values -- see
         * blendLoopSeam's own comment in the .cpp for why this uses a
         * sin/cos-based equal-power curve rather than a plain linear
         * blend), so the take tiles/loops seamlessly once placed rather
         * than clicking (or, per direct feedback, audibly dipping toward
         * silence) at the seam -- this only touches the SNAPSHOT being
         * written out, never the live buffer, so it can't affect ongoing
         * capture. Safe to call at any time without stopping capture --
         * see this class's own doc comment on locking. Returns false (and
         * leaves outputPath untouched) on failure, same convention as
         * LoopRecorder::writeToWavFile/RenderExport.cpp. */
        bool writeToWavFile(const juce::String& outputPath) const;

        /** Peak amplitude across the WHOLE fixed buffer, split into
         * numBuckets evenly-sized buckets -- unlike LoopRecorder's own
         * peaksSoFar/peaksFixedWindow (both designed around a
         * monotonically-growing, append-only buffer), this buffer is a
         * fixed length for its entire lifetime (see this class's own doc
         * comment), so there's no "how much has been written so far" to
         * track. Called on the same 30Hz poll as writeToWavFile's own use
         * case (see IpcServer.cpp's timerCallback), for a live "building
         * up" waveform preview while gated recording is enabled -- see
         * ChannelRow.tsx's own overlay for the LoopRecorder equivalent
         * this mirrors.
         *
         * Incrementally cached, NOT a full rescan every call -- an earlier
         * version rescanned the entire buffer (up to several million
         * stereo samples for a long loop region) from scratch on every one
         * of these 30Hz polls, which meant holding bufferLock -- the SAME
         * lock writeBlock needs on every real-time audio callback -- for a
         * genuinely long stretch, repeatedly, for the whole time gated
         * recording was armed. Confirmed as the likely cause of real
         * reported glitching/stuttering while recording: a slow poll
         * blocking the audio thread's own lock acquisition is a textbook
         * dropout. Now only the kPeaksBucketCount buckets actually
         * touched by writeBlock since the LAST peaks() call get
         * recomputed (see markBucketsDirty/dirtyBuckets below); everything
         * else returns the still-valid cached value from last time -- the
         * lock is still taken, but only ever held for a handful of small,
         * bounded bucket scans instead of the whole buffer.
         *
         * numBuckets is expected to always be kPeaksBucketCount in
         * practice (IpcServer.cpp's only caller always asks for exactly
         * that) -- passing anything else still works, just falls back to
         * an uncached full recompute at that resolution rather than trying
         * to reconcile two different bucket granularities in one cache. */
        std::vector<float> peaks(int numBuckets) const;

    private:
        double sampleRate;
        double loopLengthBars;
        int bufferLengthSamples;
        juce::AudioBuffer<float> buffer;
        mutable juce::CriticalSection bufferLock;

        std::atomic<bool> gateOpen { false };

        // Audio-thread-only state (writeBlock is only ever called from
        // there, same as LoopRecorder's own writeBlock) -- no atomics
        // needed for this.
        int hangoverRemainingSamples = 0;

        // The fixed bucket resolution peaks()'s incremental cache is kept
        // at -- see peaks()'s own doc comment on why this needs to be a
        // fixed, known-in-advance constant rather than derived from
        // whatever numBuckets a given peaks() call happens to pass: writeBlock
        // (audio thread) needs to know which bucket index a just-written
        // sample range falls into WITHOUT waiting for a peaks() call to
        // tell it. Matches IpcServer.cpp's own peaks(128) call.
        static constexpr int kPeaksBucketCount = 128;

        // cachedPeaks/dirtyBuckets are guarded by bufferLock, same as
        // buffer itself -- writeBlock (audio thread) marks buckets dirty
        // while already holding the lock for the sample write; peaks()
        // (message thread) reads/recomputes/clears them while holding the
        // lock for its own bounded per-bucket work. Both empty until the
        // first peaks(kPeaksBucketCount) call establishes them (at
        // kPeaksBucketCount size, every bucket initially dirty -- a
        // correct, if unavoidable, one-time full compute) -- see peaks()'s
        // own implementation.
        mutable std::vector<float> cachedPeaks;
        mutable std::vector<bool> dirtyBuckets;

        // Peak amplitude of ONE bucket (bucketIndex of numBuckets total),
        // scanning across every channel -- the actual per-bucket scan work
        // both peaks()'s cached path and its uncached-fallback path share.
        float computeBucketPeak(int bucketIndex, int numBuckets) const;

        // Marks whichever of kPeaksBucketCount buckets the sample range
        // [startPos, startPos + numSamples) (mod bufferLengthSamples)
        // falls into as dirty, so the next peaks() call knows to recompute
        // them instead of trusting a now-stale cached value. Called from
        // writeBlock, already holding bufferLock. A no-op before
        // dirtyBuckets exists yet (peaks() hasn't been called for the
        // first time) -- nothing to keep in sync with until there's a
        // cache to keep in sync.
        void markBucketsDirty(int startPos, int numSamples);
    };
}

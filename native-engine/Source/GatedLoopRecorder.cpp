// native-engine/Source/GatedLoopRecorder.cpp
#include "GatedLoopRecorder.h"
#include <algorithm>
#include <cmath>

namespace sssketch
{
    namespace
    {
        // Non-configurable per explicit product decision -- roughly -40dBFS
        // RMS, a common noise-gate default sensitive enough to catch quiet
        // playing while ignoring typical room/device noise floor.
        constexpr float kGateThresholdLinear = 0.01f; // 10^(-40/20)

        // Deliberately several seconds, not a short/snappy release -- per
        // explicit product decision, so a brief pause mid-phrase doesn't
        // prematurely end capture and clip the tail of a take.
        constexpr double kReleaseHangoverSeconds = 6.0;

        // Number of channels this recorder's own buffer/WAV output always
        // has, regardless of how many the input device actually provides --
        // see writeBlock's own doc comment on how fewer (mono) or more
        // input channels get mapped onto this. Matches LoopRecorder's own
        // kOutputChannels.
        constexpr int kOutputChannels = 2;

        // Declick blend applied at the loop point of the EXPORTED copy only
        // (see writeToWavFile below) -- same "blend the outgoing tail
        // toward the incoming head's own VALUE, not toward silence"
        // technique Transport.cpp's own renderLoopAware already uses for
        // the master output's loop wrap. Bumped from an initial 20ms to
        // 50ms per direct feedback asking for a longer crossover -- still
        // short enough to be inaudible as its own discrete event, long
        // enough to more thoroughly smooth a real discontinuity between
        // wherever this take's last-recorded audio ends and its own
        // beginning.
        constexpr double kSeamFadeSeconds = 0.05;

        // Blends buffer's last fadeSamples progressively toward buffer's
        // own first fadeSamples' values (in place), across every channel --
        // extracted as a free function since it operates on a plain
        // AudioBuffer, not on any GatedLoopRecorder member state.
        //
        // Uses an EQUAL-POWER (sin/cos) crossfade, not a plain linear one --
        // per direct feedback that the original linear version still left
        // "a small silence gap" at the seam even after blending. The two
        // sides of this crossfade are two DIFFERENT loop passes' own
        // audio, not the same waveform shifted in time, so they're
        // effectively decorrelated -- summing two decorrelated signals at
        // linearly-ramped gains dips in perceived loudness right around
        // the crossfade's midpoint (their amplitudes ramp linearly, but
        // their combined power doesn't, since they don't reinforce each
        // other the way two correlated/identical signals would). An
        // equal-power curve (gainOut=cos, gainIn=sin, satisfying
        // gainOut^2 + gainIn^2 == 1 throughout) keeps combined power
        // roughly constant across the whole transition instead, which is
        // the standard fix for exactly this "hollow-sounding crossfade"
        // artifact. Both curves still reach exactly 0/1 at the endpoints
        // (t=0 and t=1), so the seam itself still matches the head's own
        // value exactly, same as the linear version did.
        void blendLoopSeam(juce::AudioBuffer<float>& buf, int fadeSamples)
        {
            const int n = buf.getNumSamples();
            fadeSamples = std::min(fadeSamples, n / 2);
            if (fadeSamples <= 0) return;
            for (int ch = 0; ch < buf.getNumChannels(); ++ch)
            {
                auto* data = buf.getWritePointer(ch);
                for (int i = 0; i < fadeSamples; ++i)
                {
                    // t sweeps 0 -> 1 across the fade region, reaching 1
                    // (fully the head's own value) right at the very last
                    // sample -- the tail eases into matching the head
                    // instead of jumping to it.
                    const float t = (float) (i + 1) / (float) fadeSamples;
                    const float gainIn = std::sin(t * juce::MathConstants<float>::halfPi);
                    const float gainOut = std::cos(t * juce::MathConstants<float>::halfPi);
                    const int tailIndex = n - fadeSamples + i;
                    data[tailIndex] = data[tailIndex] * gainOut + data[i] * gainIn;
                }
            }
        }
    }

    GatedLoopRecorder::GatedLoopRecorder(double sr, double loopBars, double secPerBar)
        : sampleRate(sr), loopLengthBars(loopBars)
    {
        const double loopSeconds = loopLengthBars * secPerBar;
        bufferLengthSamples = std::max(1, (int) std::lround(loopSeconds * sampleRate));
        buffer.setSize(kOutputChannels, bufferLengthSamples);
        buffer.clear();
    }

    void GatedLoopRecorder::writeBlock(const float* const* inputChannelData, int numInputChannels,
                                        int startSample, int numSamples, double loopRelativeStartBar)
    {
        if (numSamples <= 0) return;

        // RMS over this block's mono downmix decides whether ANY of it
        // gets written -- computed outside the lock, cheap and read-only.
        // Still a downmix here even though the CAPTURED audio is now
        // stereo (see below) -- the gate is a single open/closed decision
        // for the whole block, not per-channel, so a plain average is all
        // this needs.
        double sumSquares = 0.0;
        if (numInputChannels > 0 && inputChannelData != nullptr)
        {
            for (int i = 0; i < numSamples; ++i)
            {
                float sample = 0.0f;
                for (int ch = 0; ch < numInputChannels; ++ch)
                    sample += inputChannelData[ch][startSample + i];
                sample /= (float) numInputChannels;
                sumSquares += (double) sample * (double) sample;
            }
        }
        const double rms = std::sqrt(sumSquares / (double) numSamples);
        const bool aboveThreshold = rms >= (double) kGateThresholdLinear;

        if (aboveThreshold)
            hangoverRemainingSamples = (int) std::lround(kReleaseHangoverSeconds * sampleRate);

        const bool shouldWrite = aboveThreshold || hangoverRemainingSamples > 0;
        gateOpen.store(shouldWrite, std::memory_order_relaxed);
        if (!shouldWrite) return;
        if (!aboveThreshold) hangoverRemainingSamples = std::max(0, hangoverRemainingSamples - numSamples);

        // Guards the write loop below against an out-of-bounds
        // inputChannelData[srcCh] access -- shouldWrite can still be true
        // here purely from release hangover even on a block that itself
        // has no real channel data (numInputChannels <= 0), unlike the RMS
        // calc above which already tolerates that via its own numSamples
        // loop bound.
        if (numInputChannels <= 0 || inputChannelData == nullptr) return;

        const int startPos =
            (int) std::lround(loopRelativeStartBar / loopLengthBars * (double) bufferLengthSamples);
        const juce::ScopedLock sl(bufferLock);
        for (int destCh = 0; destCh < kOutputChannels; ++destCh)
        {
            // A mono (single-channel) device has its one channel duplicated
            // onto both output channels; a device with 2+ channels maps its
            // first two straight across -- matches LoopRecorder's own
            // writeBlock convention.
            const int srcCh = std::min(destCh, numInputChannels - 1);
            auto* dest = buffer.getWritePointer(destCh);
            const auto* src = inputChannelData[srcCh];
            for (int i = 0; i < numSamples; ++i)
            {
                const int destIndex = (startPos + i) % bufferLengthSamples;
                dest[destIndex] = src[startSample + i];
            }
        }
        markBucketsDirty(startPos, numSamples);
    }

    bool GatedLoopRecorder::writeToWavFile(const juce::String& outputPath) const
    {
        // Snapshot under the lock (bounded, fast -- a plain copy, no I/O),
        // then release before touching disk -- keeps the lock's hold time
        // short and independent of file-write latency.
        juce::AudioBuffer<float> snapshot;
        {
            const juce::ScopedLock sl(bufferLock);
            snapshot.makeCopyOf(buffer);
        }

        blendLoopSeam(snapshot, (int) std::lround(kSeamFadeSeconds * sampleRate));

        juce::File outFile(outputPath);
        outFile.getParentDirectory().createDirectory();
        outFile.deleteFile();
        std::unique_ptr<juce::FileOutputStream> out(outFile.createOutputStream());
        if (out == nullptr) return false;

        juce::WavAudioFormat wavFormat;
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wavFormat.createWriterFor(out.get(), sampleRate, snapshot.getNumChannels(), 16, {}, 0));
        if (writer == nullptr) return false;
        out.release(); // writer now owns the stream, matching LoopRecorder/RenderExport's own ownership handoff

        writer->writeFromAudioSampleBuffer(snapshot, 0, snapshot.getNumSamples());
        return true;
    }

    float GatedLoopRecorder::computeBucketPeak(int bucketIndex, int numBuckets) const
    {
        const int bucketStart = (int) ((double) bucketIndex / numBuckets * bufferLengthSamples);
        const int bucketEnd = (int) ((double) (bucketIndex + 1) / numBuckets * bufferLengthSamples);
        float peak = 0.0f;
        // Peak across both channels -- this is just a coarse live overview
        // bar, not a true stereo waveform, matching LoopRecorder's own
        // peaksSoFar/peaksFixedWindow reasoning.
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            const auto* data = buffer.getReadPointer(ch);
            for (int i = bucketStart; i < bucketEnd; ++i)
                peak = std::max(peak, std::abs(data[i]));
        }
        return peak;
    }

    void GatedLoopRecorder::markBucketsDirty(int startPos, int numSamples)
    {
        if (dirtyBuckets.empty()) return; // no cache established yet -- nothing to keep in sync with
        if (numSamples <= 0) return;

        const int bucketSize = std::max(1, bufferLengthSamples / kPeaksBucketCount);
        // Walks in bucket-sized strides (not per-sample) -- a real write is
        // typically well under one bucket's own width, so this loop body
        // usually runs exactly once; it only iterates further for an
        // unusually large numSamples relative to the loop length.
        for (int offset = 0; offset < numSamples; offset += bucketSize)
        {
            const int pos = (startPos + offset) % bufferLengthSamples;
            const int bucket = std::min(kPeaksBucketCount - 1, pos / bucketSize);
            dirtyBuckets[(size_t) bucket] = true;
        }
        // The stride above can overstep the LAST sample actually written
        // (numSamples isn't necessarily an exact multiple of bucketSize) --
        // explicitly mark its own bucket too so the tail end of a write is
        // never silently left stale.
        const int lastPos = (startPos + numSamples - 1) % bufferLengthSamples;
        dirtyBuckets[(size_t) std::min(kPeaksBucketCount - 1, lastPos / bucketSize)] = true;
    }

    std::vector<float> GatedLoopRecorder::peaks(int numBuckets) const
    {
        if (numBuckets <= 0) return {};

        const juce::ScopedLock sl(bufferLock);

        // Only kPeaksBucketCount is incrementally cached/dirty-tracked (see
        // markBucketsDirty and this method's own doc comment on why) -- a
        // request for any other resolution falls back to a plain, uncached
        // full scan at THAT resolution instead, matching this method's
        // original (pre-caching) behavior exactly. Doesn't happen in
        // practice (IpcServer.cpp always asks for kPeaksBucketCount).
        if (numBuckets != kPeaksBucketCount)
        {
            std::vector<float> result((size_t) numBuckets, 0.0f);
            for (int b = 0; b < numBuckets; ++b)
                result[(size_t) b] = computeBucketPeak(b, numBuckets);
            return result;
        }

        if ((int) cachedPeaks.size() != kPeaksBucketCount)
        {
            // First call (or a resolution change) -- nothing cached yet, so
            // every bucket needs a real scan this one time. Later calls
            // only redo whichever buckets markBucketsDirty actually flagged
            // since the last poll.
            cachedPeaks.assign((size_t) kPeaksBucketCount, 0.0f);
            dirtyBuckets.assign((size_t) kPeaksBucketCount, true);
        }

        for (int b = 0; b < kPeaksBucketCount; ++b)
        {
            if (!dirtyBuckets[(size_t) b]) continue;
            cachedPeaks[(size_t) b] = computeBucketPeak(b, kPeaksBucketCount);
            dirtyBuckets[(size_t) b] = false;
        }

        return cachedPeaks;
    }
}

// native-engine/Source/LoopRecorder.cpp
#include "LoopRecorder.h"
#include <algorithm>
#include <cmath>

namespace sssketch
{
    LoopRecorder::LoopRecorder(double sr, double loopLengthSeconds)
        : sampleRate(sr)
    {
        const int numSamples = std::max(1, (int) std::lround(loopLengthSeconds * sampleRate));
        buffer.setSize(1, numSamples);
        buffer.clear();
        // Pre-sized identically to buffer, right here in the constructor
        // (never touched again except by onPassBoundary()'s same-size
        // copy assignment) -- see this member's own doc comment in
        // LoopRecorder.h for why the audio thread must never be the one
        // to first-allocate it.
        lastCompletedBuffer.setSize(1, numSamples);
        lastCompletedBuffer.clear();
    }

    void LoopRecorder::writeBlock(const float* const* inputChannelData, int numInputChannels,
                                   int startSample, int numSamples)
    {
        if (numInputChannels <= 0 || inputChannelData == nullptr) return;
        auto* dest = buffer.getWritePointer(0);
        const int bufferSamples = buffer.getNumSamples();
        const int startPos = writePos.load(std::memory_order_relaxed);
        for (int i = 0; i < numSamples; ++i)
        {
            const int destIndex = startPos + i;
            if (destIndex >= bufferSamples) break; // shouldn't happen if Transport's own wrap math is correct; defensive, not a silent overwrite past the buffer's own bounds
            // Mono downmix -- average every input channel JUCE gave us.
            // Loopback devices are commonly stereo (2ch), a mic commonly
            // mono (1ch); averaging handles both without a separate path.
            float sample = 0.0f;
            for (int ch = 0; ch < numInputChannels; ++ch)
                sample += inputChannelData[ch][startSample + i];
            sample /= (float) numInputChannels;
            dest[destIndex] = sample;
        }
        // Release store: publishes both the samples just written above AND
        // this new index in one handoff, so peaksSoFar's acquire load on
        // the message thread (below) can never observe the advanced index
        // without also observing the sample data that goes with it.
        writePos.store(std::min(startPos + numSamples, bufferSamples), std::memory_order_release);
    }

    void LoopRecorder::onPassBoundary()
    {
        // Snapshot BEFORE clear() wipes buffer -- this is the fix for a
        // real bug found during manual testing: hasCompletedPass() used to
        // just be a flag, set true here and never reset, while
        // writeToWavFile() read directly from `buffer` -- which, by the
        // time a LATER pass had started overwriting it, no longer held the
        // completed pass's audio at all. Disarming mid-way through a
        // second pass would silently commit that second, still-in-progress
        // pass's partial/mostly-silent content while completedPass still
        // (correctly, per its own true meaning) said "yes there's a
        // completed pass" -- just not the one actually in `buffer`
        // anymore. lastCompletedBuffer now holds the ACTUAL completed
        // pass's audio, decoupled from whatever's currently being
        // (re-)recorded into `buffer`, matching the design's own stated
        // "commits whichever pass most recently completed" contract for
        // real. Same-size copy assignment (both buffers are pre-sized
        // identically in the constructor), so this never (re)allocates
        // here on the audio thread.
        //
        // Narrows, doesn't worsen, the pre-existing disarm-teardown race
        // documented at this file's own call site and in IpcServer.cpp's
        // disarm-recording handler: writeToWavFile() (message thread) now
        // reads lastCompletedBuffer instead of buffer, so a stale audio-
        // thread callback that only calls writeBlock() during that brief
        // post-detach window (the common case) no longer races the
        // message-thread read at all -- writeBlock() never touches
        // lastCompletedBuffer. The race only reappears in the rarer case
        // where a pass boundary happens to land in that exact stale
        // callback (this assignment running concurrently with a
        // writeToWavFile() read) -- a strict subset of the old exposure,
        // not a new one.
        if (writePos.load(std::memory_order_relaxed) >= buffer.getNumSamples())
        {
            lastCompletedBuffer = buffer;
            completedPass = true;
        }
        // Publish the reset BEFORE clearing the buffer, not after -- a
        // concurrent peaksSoFar() call that lands during clear() must see
        // writePos already at 0 so its own bucketStart(0) >=
        // currentWritePos(0) check makes it skip all buffer reads entirely,
        // rather than reading the still-full old writePos and scanning the
        // whole buffer while clear()'s plain (non-atomic) stores are
        // actively zeroing it underneath. This removes the deterministic,
        // every-single-pass version of that race; it isn't airtight against
        // the most adversarial reordering the C++ abstract machine allows
        // (a fully rigorous fix would need a generation counter or
        // double-buffering, overkill for a cosmetic live meter whose worst
        // failure mode is a garbled frame in a bar graph) -- accepted the
        // same way this codebase already accepts other small, bounded,
        // real-time-favoring risks elsewhere in this class (see
        // IpcServer.cpp's detachArmedRecorderOnTeardown() doc comment for
        // the same reasoning applied to a different tradeoff).
        writePos.store(0, std::memory_order_release);
        buffer.clear();
    }

    std::vector<float> LoopRecorder::peaksSoFar(int numBuckets) const
    {
        std::vector<float> result(numBuckets, 0.0f);
        const int totalSamples = buffer.getNumSamples();
        const auto* data = buffer.getReadPointer(0);
        // Acquire load, paired with writeBlock/onPassBoundary's release
        // stores above -- snapshotting once up front (rather than
        // re-reading the atomic on every loop iteration) guarantees every
        // bucket below is judged against the same write position, so the
        // buffer indices this function reads are always <= what the audio
        // thread had actually finished writing at the moment of this load.
        const int currentWritePos = writePos.load(std::memory_order_acquire);
        for (int b = 0; b < numBuckets; ++b)
        {
            const int bucketStart = (int) ((double) b / numBuckets * totalSamples);
            const int bucketEnd = (int) ((double) (b + 1) / numBuckets * totalSamples);
            if (bucketStart >= currentWritePos) break; // this bucket and every later one is still unwritten this pass
            float peak = 0.0f;
            for (int i = bucketStart; i < std::min(bucketEnd, currentWritePos); ++i)
                peak = std::max(peak, std::abs(data[i]));
            result[b] = peak;
        }
        return result;
    }

    bool LoopRecorder::writeToWavFile(const juce::String& outputPath) const
    {
        juce::File outFile(outputPath);
        outFile.getParentDirectory().createDirectory();
        outFile.deleteFile();
        std::unique_ptr<juce::FileOutputStream> out(outFile.createOutputStream());
        if (out == nullptr) return false;

        juce::WavAudioFormat wavFormat;
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wavFormat.createWriterFor(out.get(), sampleRate, 1, 16, {}, 0));
        if (writer == nullptr) return false;
        out.release(); // writer now owns the stream, matching RenderExport.cpp's own ownership handoff

        writer->writeFromAudioSampleBuffer(lastCompletedBuffer, 0, lastCompletedBuffer.getNumSamples());
        return true;
    }
}

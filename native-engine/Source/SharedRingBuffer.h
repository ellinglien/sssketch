// native-engine/Source/SharedRingBuffer.h
#pragma once
#include <atomic>
#include <cstdint>

namespace sssketch
{
    /** Lock-free single-producer/single-consumer ring buffer over a raw
     * float array the caller owns (backed by shared memory in production
     * -- see SharedAudioChannel -- a plain heap array in tests). Stores
     * interleaved stereo frames (2 floats per frame). Safe for exactly one
     * writer thread and one reader thread concurrently; never safe for
     * more than one of either. */
    class SharedRingBuffer
    {
    public:
        /** `buffer` must point to at least `capacityFrames * 2` floats and
         * outlive this object. `writeIndex`/`readIndex` must each point to
         * a single already-zero-initialized std::atomic<uint32_t> (also
         * caller-owned, so both can live in the same shared-memory block as
         * `buffer` for the cross-process case). */
        SharedRingBuffer(float* buffer, std::atomic<uint32_t>* writeIndex,
            std::atomic<uint32_t>* readIndex, uint32_t capacityFrames);

        /** Producer only. Returns the number of frames actually written --
         * less than numFrames if the buffer doesn't have room. Never
         * blocks. */
        uint32_t write(const float* interleavedStereo, uint32_t numFrames);

        /** Consumer only. Returns the number of frames actually read --
         * less than numFrames if fewer are available. Never blocks. */
        uint32_t read(float* outInterleavedStereo, uint32_t numFrames);

        /** Either thread: how many frames are currently available to read. */
        uint32_t availableToRead() const;

    private:
        float* buffer;
        std::atomic<uint32_t>* writeIndex;
        std::atomic<uint32_t>* readIndex;
        uint32_t capacityFrames;
    };
}

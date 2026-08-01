// native-engine/Source/SharedRingBuffer.cpp
#include "SharedRingBuffer.h"
#include <algorithm>

namespace sssketch
{
    SharedRingBuffer::SharedRingBuffer(float* buf, std::atomic<uint32_t>* w, std::atomic<uint32_t>* r, uint32_t cap)
        : buffer(buf), writeIndex(w), readIndex(r), capacityFrames(cap)
    {
    }

    uint32_t SharedRingBuffer::availableToRead() const
    {
        const uint32_t w = writeIndex->load(std::memory_order_acquire);
        const uint32_t r = readIndex->load(std::memory_order_relaxed);
        // Unsigned subtraction wraps correctly even once w/r themselves
        // wrap past UINT32_MAX, as long as the producer never gets more
        // than ~4 billion frames ahead of the consumer -- true for any
        // real session, this is not a windowing/versioning scheme, just
        // plain modular arithmetic.
        return w - r;
    }

    uint32_t SharedRingBuffer::write(const float* src, uint32_t numFrames)
    {
        const uint32_t r = readIndex->load(std::memory_order_acquire);
        const uint32_t w = writeIndex->load(std::memory_order_relaxed);
        const uint32_t free = capacityFrames - (w - r);
        const uint32_t toWrite = std::min(numFrames, free);

        for (uint32_t i = 0; i < toWrite; ++i)
        {
            const uint32_t slot = (w + i) % capacityFrames;
            buffer[(size_t) slot * 2] = src[(size_t) i * 2];
            buffer[(size_t) slot * 2 + 1] = src[(size_t) i * 2 + 1];
        }

        writeIndex->store(w + toWrite, std::memory_order_release);
        return toWrite;
    }

    uint32_t SharedRingBuffer::read(float* dst, uint32_t numFrames)
    {
        const uint32_t w = writeIndex->load(std::memory_order_acquire);
        const uint32_t r = readIndex->load(std::memory_order_relaxed);
        const uint32_t available = w - r;
        const uint32_t toRead = std::min(numFrames, available);

        for (uint32_t i = 0; i < toRead; ++i)
        {
            const uint32_t slot = (r + i) % capacityFrames;
            dst[(size_t) i * 2] = buffer[(size_t) slot * 2];
            dst[(size_t) i * 2 + 1] = buffer[(size_t) slot * 2 + 1];
        }

        readIndex->store(r + toRead, std::memory_order_release);
        return toRead;
    }
}

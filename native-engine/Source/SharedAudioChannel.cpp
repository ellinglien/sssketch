// native-engine/Source/SharedAudioChannel.cpp
#include "SharedAudioChannel.h"
#include <sys/mman.h>
#include <fcntl.h>
#include <unistd.h>

namespace sssketch
{
    namespace
    {
        // At the start of the mapped region: the four atomic ring-buffer
        // indices (two rings, one write index and one read index each).
        // Immediately following, in order: the input ring's float data
        // (capacityFrames * 2 floats), then the output ring's float data
        // (capacityFrames * 2 floats).
        struct SharedLayout
        {
            std::atomic<uint32_t> inputWriteIndex;
            std::atomic<uint32_t> inputReadIndex;
            std::atomic<uint32_t> outputWriteIndex;
            std::atomic<uint32_t> outputReadIndex;
        };

        size_t totalMappedSize(uint32_t capacityFrames)
        {
            return sizeof(SharedLayout) + 2 * (size_t) capacityFrames * 2 * sizeof(float);
        }

        juce::String shmPathFor(const juce::String& name) { return "/" + name + "-shm"; }
        juce::String inputSemNameFor(const juce::String& name) { return "/" + name + "-in"; }
        juce::String outputSemNameFor(const juce::String& name) { return "/" + name + "-out"; }
    }

    juce::String SharedAudioChannel::makeUniqueName()
    {
        static std::atomic<int> counter { 0 };
        return "sssketch-bridge-" + juce::String((int) getpid()) + "-" + juce::String(counter.fetch_add(1));
    }

    std::unique_ptr<SharedAudioChannel> openChannel(const juce::String& name, int blockSize, bool owner)
    {
        const uint32_t capacityFrames = (uint32_t) blockSize * (uint32_t) SharedAudioChannel::kBlocksOfHeadroom;
        const size_t mapSize = totalMappedSize(capacityFrames);
        const auto shmPath = shmPathFor(name);

        // O_EXCL on create is a real safety net, not just belt-and-braces:
        // it makes this call FAIL loudly if `name` somehow already exists,
        // rather than silently reusing (and corrupting the state of) an
        // unrelated segment -- see makeUniqueName()'s own doc comment on
        // why a collision should never happen in practice, but "never in
        // practice" isn't the same as "impossible."
        const int fd = owner
            ? shm_open(shmPath.toRawUTF8(), O_CREAT | O_EXCL | O_RDWR, 0600)
            : shm_open(shmPath.toRawUTF8(), O_RDWR, 0600);
        if (fd < 0)
            return nullptr;

        if (owner && ftruncate(fd, (off_t) mapSize) != 0)
        {
            close(fd);
            shm_unlink(shmPath.toRawUTF8());
            return nullptr;
        }

        void* mem = mmap(nullptr, mapSize, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
        if (mem == MAP_FAILED)
        {
            close(fd);
            if (owner) shm_unlink(shmPath.toRawUTF8());
            return nullptr;
        }

        const auto inSemName = inputSemNameFor(name);
        const auto outSemName = outputSemNameFor(name);
        sem_t* inSem = owner
            ? sem_open(inSemName.toRawUTF8(), O_CREAT | O_EXCL, 0600, 0)
            : sem_open(inSemName.toRawUTF8(), 0);
        sem_t* outSem = owner
            ? sem_open(outSemName.toRawUTF8(), O_CREAT | O_EXCL, 0600, 0)
            : sem_open(outSemName.toRawUTF8(), 0);
        if (inSem == SEM_FAILED || outSem == SEM_FAILED)
        {
            munmap(mem, mapSize);
            close(fd);
            if (owner)
            {
                shm_unlink(shmPath.toRawUTF8());
                if (inSem != SEM_FAILED) { sem_close(inSem); sem_unlink(inSemName.toRawUTF8()); }
                if (outSem != SEM_FAILED) { sem_close(outSem); sem_unlink(outSemName.toRawUTF8()); }
            }
            return nullptr;
        }

        auto* layout = static_cast<SharedLayout*>(mem);
        if (owner)
        {
            layout->inputWriteIndex.store(0);
            layout->inputReadIndex.store(0);
            layout->outputWriteIndex.store(0);
            layout->outputReadIndex.store(0);
        }

        auto* inputFloats = reinterpret_cast<float*>(reinterpret_cast<char*>(mem) + sizeof(SharedLayout));
        auto* outputFloats = inputFloats + (size_t) capacityFrames * 2;

        std::unique_ptr<SharedAudioChannel> channel(new SharedAudioChannel());
        channel->name = name;
        channel->shmFd = fd;
        channel->mappedMemory = mem;
        channel->mappedSize = mapSize;
        channel->isOwner = owner;
        channel->inputReadySem = inSem;
        channel->outputReadySem = outSem;
        channel->inputRing = std::make_unique<SharedRingBuffer>(
            inputFloats, &layout->inputWriteIndex, &layout->inputReadIndex, capacityFrames);
        channel->outputRing = std::make_unique<SharedRingBuffer>(
            outputFloats, &layout->outputWriteIndex, &layout->outputReadIndex, capacityFrames);
        return channel;
    }

    std::unique_ptr<SharedAudioChannel> SharedAudioChannel::create(const juce::String& name, int blockSize)
    {
        return openChannel(name, blockSize, true);
    }

    std::unique_ptr<SharedAudioChannel> SharedAudioChannel::attach(const juce::String& name, int blockSize)
    {
        return openChannel(name, blockSize, false);
    }

    SharedAudioChannel::~SharedAudioChannel()
    {
        if (mappedMemory != nullptr) munmap(mappedMemory, mappedSize);
        if (shmFd >= 0) close(shmFd);
        if (inputReadySem != nullptr) sem_close(inputReadySem);
        if (outputReadySem != nullptr) sem_close(outputReadySem);
        if (isOwner)
        {
            shm_unlink(shmPathFor(name).toRawUTF8());
            sem_unlink(inputSemNameFor(name).toRawUTF8());
            sem_unlink(outputSemNameFor(name).toRawUTF8());
        }
    }

    void SharedAudioChannel::writeInputAndSignal(const float* src, uint32_t numFrames)
    {
        inputRing->write(src, numFrames);
        sem_post(inputReadySem);
    }

    namespace
    {
        uint32_t waitAndRead(sem_t* sem, SharedRingBuffer& ring, float* dst, uint32_t numFrames, int timeoutMs)
        {
            // macOS's libc does not implement sem_timedwait -- a real,
            // well-known Darwin gap (POSIX named semaphores only support
            // sem_wait/sem_trywait there, unlike Linux). Poll sem_trywait
            // with a short sleep between attempts instead, bounded by the
            // requested timeout -- coarser granularity than a true timed
            // wait, but more than adequate for this use case's ~5-50ms
            // timeouts.
            const double deadline = juce::Time::getMillisecondCounterHiRes() + (double) timeoutMs;
            const useconds_t pollIntervalUs = 200; // 0.2ms -- fine relative to a 5ms budget
            do
            {
                if (sem_trywait(sem) == 0)
                    return ring.read(dst, numFrames);
                usleep(pollIntervalUs);
            } while (juce::Time::getMillisecondCounterHiRes() < deadline);
            return 0; // timed out -- caller substitutes silence, see design spec's Error Handling
        }
    }

    uint32_t SharedAudioChannel::waitAndReadOutput(float* dst, uint32_t numFrames, int timeoutMs)
    {
        return waitAndRead(outputReadySem, *outputRing, dst, numFrames, timeoutMs);
    }

    uint32_t SharedAudioChannel::waitAndReadInput(float* dst, uint32_t numFrames, int timeoutMs)
    {
        return waitAndRead(inputReadySem, *inputRing, dst, numFrames, timeoutMs);
    }

    void SharedAudioChannel::writeOutputAndSignal(const float* src, uint32_t numFrames)
    {
        outputRing->write(src, numFrames);
        sem_post(outputReadySem);
    }
}

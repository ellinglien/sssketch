// native-engine/Source/SharedAudioChannel.h
#pragma once
#include "SharedRingBuffer.h"
#include <juce_core/juce_core.h>
#include <semaphore.h>
#include <memory>

namespace sssketch
{
    /** One shared-memory audio connection between the main engine and the
     * x86_64 bridge process for a single bridged plugin slot -- two ring
     * buffers (engine-to-bridge input, bridge-to-engine output) plus a
     * pair of named POSIX semaphores for signaling. The engine process
     * CREATEs one of these per bridged slot (allocating and owning the
     * shared memory); the bridge process ATTACHes to the same name once
     * told about it over the control socket. See
     * docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md's
     * "Audio transport" section. */
    class SharedAudioChannel
    {
    public:
        // Blocks' worth of headroom the ring buffers are sized for -- a
        // starting value from the design spec, not derived from
        // profiling. Tune up (here, and correspondingly in
        // PluginChain::process's read/write calls if that ever needs to
        // request more than one block at a time) if manual testing under
        // real load shows underruns.
        static constexpr int kBlocksOfHeadroom = 8;

        /** A process-and-counter-unique name safe to use in a POSIX
         * shared-memory/semaphore identifier. Combines the current process
         * id with a monotonically increasing in-process counter, so two
         * channels created in the same engine session never collide, and a
         * leftover segment from a previous crashed session's PID can never
         * collide with a currently-running one either. */
        static juce::String makeUniqueName();

        /** Owner side (main engine): allocates and zero-initializes new
         * shared memory and semaphores under `name`. Returns nullptr if
         * shm_open/mmap/sem_open fails for any reason -- treat as a load
         * failure for that slot, never a crash (see design spec's Error
         * Handling section, "bridge fails to spawn"). */
        static std::unique_ptr<SharedAudioChannel> create(const juce::String& name, int blockSize);

        /** Non-owner side (bridge): opens EXISTING shared memory and
         * semaphores under `name`, created by a prior create() call in the
         * other process. Returns nullptr if `name` doesn't exist yet or
         * any underlying open call fails. */
        static std::unique_ptr<SharedAudioChannel> attach(const juce::String& name, int blockSize);

        /** Unmaps this process's view and, for the owner, unlinks the
         * shared memory and semaphores from the filesystem namespace.
         * Other processes with an existing attach()'d mapping keep a valid
         * mapping until they unmap it themselves -- standard POSIX shm
         * unlink-while-mapped semantics. */
        ~SharedAudioChannel();

        SharedAudioChannel(const SharedAudioChannel&) = delete;
        SharedAudioChannel& operator=(const SharedAudioChannel&) = delete;

        /** Engine side: write this block's input, then wake the bridge. */
        void writeInputAndSignal(const float* interleavedStereo, uint32_t numFrames);

        /** Engine side: wait up to timeoutMs for the bridge to signal new
         * output is ready, then read up to numFrames of it. Returns frames
         * actually read -- 0 on timeout OR if the bridge produced less
         * than requested; both are legitimate silence-substitution
         * outcomes the caller (PluginChain::process) must treat
         * identically, not distinguished here. */
        uint32_t waitAndReadOutput(float* outInterleavedStereo, uint32_t numFrames, int timeoutMs);

        /** Bridge side: wait up to timeoutMs for the engine to signal new
         * input is ready, then read up to numFrames of it. Returns frames
         * actually read (0 on timeout). */
        uint32_t waitAndReadInput(float* outInterleavedStereo, uint32_t numFrames, int timeoutMs);

        /** Bridge side: write this block's processed output, then wake the
         * engine. */
        void writeOutputAndSignal(const float* interleavedStereo, uint32_t numFrames);

    private:
        SharedAudioChannel() = default;

        juce::String name;
        int shmFd = -1;
        void* mappedMemory = nullptr;
        size_t mappedSize = 0;
        bool isOwner = false;

        sem_t* inputReadySem = nullptr;
        sem_t* outputReadySem = nullptr;

        std::unique_ptr<SharedRingBuffer> inputRing;
        std::unique_ptr<SharedRingBuffer> outputRing;

        friend std::unique_ptr<SharedAudioChannel> openChannel(const juce::String&, int, bool);
    };
}

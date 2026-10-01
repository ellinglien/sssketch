// native-engine/Source/GracePeriod.h
#pragma once
#include <atomic>
#include <chrono>
#include <thread>

namespace sssketch
{
    /** Real-time-safe reclamation for the "build a whole new map, publish it
     * with one atomic pointer exchange" pattern ChannelChainRegistry and
     * BridgeClient both use. Publishing is the easy half; the hard half is
     * knowing when the OLD object can be freed, because a reader (the audio
     * thread) may have loaded the old pointer just before the exchange and
     * still be using it. Handing it straight to a detached deleter thread --
     * what both classes used to do -- is a real heap-use-after-free,
     * reproduced under AddressSanitizer by each class's "stress:" tests.
     *
     * Readers wrap every load-and-use in a ReadScope. Writers, after the
     * exchange, call waitForReaders() before freeing what they swapped out:
     * once it returns, no reader can still hold the old pointer.
     *
     * Reader side: one atomic load plus one atomic increment to enter, one
     * atomic decrement to leave. Never blocks, allocates or frees -- safe on
     * the audio thread. Scopes nest.
     *
     * Writer side: waits (yielding) for at most the longest reader scope
     * already in progress -- for the audio thread that is a whole
     * renderBlock or PluginChain::process call, hosted plugins' own
     * process() and bridged slots' waits on the bridge included. Never call it from the audio thread, and never
     * while the calling thread itself holds a ReadScope on the same
     * GracePeriod -- it would wait for itself forever. Writers must be
     * serialized against each other by the caller (both users publish only
     * from the message thread).
     *
     * The wait has a deadline (2s by default). A reader that never leaves its
     * scope -- a hosted plugin hung inside process() -- must not take the
     * message thread and all IPC down with it. Past the deadline
     * waitForReaders() gives up and returns false, and the caller must then
     * LEAK whatever it swapped out rather than free it under a reader that
     * may still be using it. Both callers park it on a "stuck" list instead,
     * and free that list only after a LATER waitForReaders() succeeds: a
     * completed grace period proves every reader that entered before it --
     * the stuck one included -- has left, so whatever it retired earlier is
     * then unreachable. If the reader never comes back, the parked maps
     * stay leaked for good. A leak is a bounded cost; a use-after-free on
     * the audio thread is not. Every later writer
     * waits (and, while the reader stays stuck, times out) independently,
     * so each call is bounded by the deadline, never stuck forever.
     *
     * Two-phase, as in userspace RCU: flip the phase new readers enter on,
     * wait for the old phase's count to drain, then do the same for the
     * other phase. Flipping first means new readers pile onto the other
     * counter, so the one being waited on only ever goes down and a busy
     * reader can't starve the writer; checking both counters covers a reader
     * that read the phase just before a flip but incremented just after it.
     *
     * Every operation is seq_cst, and that is load-bearing: a reader's
     * increment must be ordered before its own later load of the published
     * pointer, and the writer's exchange before its loads of the counters.
     * Then any reader whose increment the writer didn't see is guaranteed to
     * load the NEW pointer, never the one being retired. */
    class GracePeriod
    {
    public:
        class ReadScope
        {
        public:
            explicit ReadScope(const GracePeriod& grace) noexcept : counter(grace.enter()) {}
            ~ReadScope() { counter.fetch_sub(1); }

            ReadScope(const ReadScope&) = delete;
            ReadScope& operator=(const ReadScope&) = delete;

        private:
            std::atomic<int>& counter;
        };

        static constexpr std::chrono::milliseconds kDefaultTimeout { 2000 };

        explicit GracePeriod(std::chrono::milliseconds waitTimeout = kDefaultTimeout) noexcept
            : timeout(waitTimeout)
        {
        }

        /** True once every reader that entered before this call has left.
         * False if the deadline passed first: the caller must not free what
         * it retired -- leak it. Spins briefly (an audio block that is
         * already finishing is the common case), then backs off to short
         * sleeps so a long wait doesn't burn a core. */
        [[nodiscard]] bool waitForReaders() noexcept
        {
            const auto deadline = std::chrono::steady_clock::now() + timeout;
            for (int pass = 0; pass < 2; ++pass)
            {
                const unsigned drained = phase.fetch_xor(1u) & 1u;
                for (int spins = 0; readers[drained].load() != 0; ++spins)
                {
                    if (spins < kSpinsBeforeSleeping)
                    {
                        std::this_thread::yield();
                        continue;
                    }
                    if (std::chrono::steady_clock::now() >= deadline)
                        return false;
                    std::this_thread::sleep_for(std::chrono::microseconds(200));
                }
            }
            return true;
        }

    private:
        static constexpr int kSpinsBeforeSleeping = 64;

        std::atomic<int>& enter() const noexcept
        {
            auto& counter = readers[phase.load() & 1u];
            counter.fetch_add(1);
            return counter;
        }

        // mutable: entering a scope is logically a read, and const methods
        // (e.g. ChannelChainRegistry::knownChannelIds) take scopes too.
        mutable std::atomic<unsigned> phase { 0 };
        mutable std::atomic<int> readers[2] {};
        const std::chrono::milliseconds timeout;
    };
}

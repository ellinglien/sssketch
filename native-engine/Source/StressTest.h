// native-engine/Source/StressTest.h -- test-only helpers for the concurrency stress tests.
#pragma once
#include <algorithm>
#include <thread>

namespace sssketch::stress
{
    /** Reader threads for a stress test: up to 4, leaving one core for the
     * writer, and never fewer than 1 -- so the tests stay meaningful on a
     * small CI runner instead of oversubscribing it (or assuming 12 cores).
     * hardware_concurrency() may report 0 ("unknown"); that gets 1. */
    inline int readerThreads()
    {
        const unsigned hw = std::thread::hardware_concurrency();
        return (int) std::clamp(hw > 1 ? hw - 1 : 1u, 1u, 4u);
    }

    /** Writer iterations per stress test. Enough to catch the original
     * use-after-free reliably under AddressSanitizer (checked against a
     * reverted fix), small enough to keep the suite quick. */
    constexpr int kWriterIterations = 500;
}

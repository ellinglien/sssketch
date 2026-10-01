// native-engine/Source/GracePeriodTests.cpp
#include "GracePeriod.h"
#include <juce_core/juce_core.h>
#include <atomic>
#include <chrono>
#include <thread>

namespace sssketch
{
    namespace
    {
        using Clock = std::chrono::steady_clock;

        double msSince(Clock::time_point t)
        {
            return std::chrono::duration<double, std::milli>(Clock::now() - t).count();
        }

        class GracePeriodTests : public juce::UnitTest
        {
        public:
            GracePeriodTests() : juce::UnitTest("GracePeriod", "GracePeriod") {}

            void runTest() override
            {
                beginTest("waitForReaders returns true at once with no reader inside a scope");
                {
                    GracePeriod grace;
                    const auto start = Clock::now();
                    expect(grace.waitForReaders());
                    expectLessThan(msSince(start), 100.0);
                }

                beginTest("waitForReaders waits for a reader to leave, then returns true");
                {
                    GracePeriod grace(std::chrono::milliseconds(2000));
                    std::atomic<bool> entered { false };
                    std::thread reader([&]()
                    {
                        GracePeriod::ReadScope scope(grace);
                        entered.store(true);
                        std::this_thread::sleep_for(std::chrono::milliseconds(50));
                    });
                    while (!entered.load())
                        std::this_thread::yield();

                    const auto start = Clock::now();
                    expect(grace.waitForReaders());
                    expectGreaterOrEqual(msSince(start), 30.0);
                    reader.join();
                }

                // A hosted plugin hung inside process() is a reader that never leaves.
                // The writer must give up at the deadline (the caller then leaks what it
                // retired) instead of hanging the message thread forever.
                beginTest("waitForReaders gives up and returns false at the deadline when a reader never leaves");
                {
                    GracePeriod grace(std::chrono::milliseconds(100));
                    std::atomic<bool> entered { false };
                    std::atomic<bool> release { false };
                    std::thread stuck([&]()
                    {
                        GracePeriod::ReadScope scope(grace);
                        entered.store(true);
                        while (!release.load())
                            std::this_thread::sleep_for(std::chrono::milliseconds(1));
                    });
                    while (!entered.load())
                        std::this_thread::yield();

                    const auto start = Clock::now();
                    expect(!grace.waitForReaders());
                    const double waited = msSince(start);
                    expectGreaterOrEqual(waited, 95.0);
                    expectLessThan(waited, 1000.0);

                    // Once the reader does leave, the next grace period completes.
                    release.store(true);
                    stuck.join();
                    expect(grace.waitForReaders());
                }

                beginTest("the unit tests run on the message thread (the writer-side asserts rely on it)");
                {
                    expect(juce::MessageManager::existsAndIsCurrentThread());
                }

#if JUCE_DEBUG
                beginTest("debug: only scopes opened on the message thread are counted as the message thread's");
                {
                    GracePeriod grace(std::chrono::milliseconds(50));
                    expectEquals(grace.messageThreadScopeCount(), 0);
                    {
                        GracePeriod::ReadScope outer(grace);
                        GracePeriod::ReadScope inner(grace);
                        expectEquals(grace.messageThreadScopeCount(), 2);

                        int seenFromWorker = -1;
                        std::thread worker([&]()
                        {
                            GracePeriod::ReadScope scope(grace);
                            seenFromWorker = grace.messageThreadScopeCount();
                        });
                        worker.join();
                        expectEquals(seenFromWorker, 2); // the worker's own scope isn't counted
                    }
                    expectEquals(grace.messageThreadScopeCount(), 0);
                    expect(grace.waitForReaders()); // and with none held, no assert, no wait
                }
#endif

                beginTest("scopes nest");
                {
                    GracePeriod grace(std::chrono::milliseconds(50));
                    {
                        GracePeriod::ReadScope outer(grace);
                        {
                            GracePeriod::ReadScope inner(grace);
                        }
                    }
                    expect(grace.waitForReaders());
                }
            }
        };

        static GracePeriodTests gracePeriodTests;
    }
}

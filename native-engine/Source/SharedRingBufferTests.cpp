// native-engine/Source/SharedRingBufferTests.cpp
#include "SharedRingBuffer.h"
#include <juce_core/juce_core.h>
#include <vector>

namespace sssketch
{
    namespace
    {
        class SharedRingBufferTests : public juce::UnitTest
        {
        public:
            SharedRingBufferTests() : juce::UnitTest("SharedRingBuffer", "SharedRingBuffer") {}

            void runTest() override
            {
                beginTest("write then read returns exactly what was written");
                {
                    std::vector<float> mem(16 * 2, 0.0f);
                    std::atomic<uint32_t> w { 0 }, r { 0 };
                    SharedRingBuffer ring(mem.data(), &w, &r, 16);

                    float in[6] = { 1, 2, 3, 4, 5, 6 }; // 3 frames
                    expectEquals((int) ring.write(in, 3), 3);

                    float out[6] = {};
                    expectEquals((int) ring.read(out, 3), 3);
                    for (int i = 0; i < 6; ++i)
                        expectWithinAbsoluteError(out[i], in[i], 0.0001f);
                }

                beginTest("write beyond capacity truncates, does not overflow or crash");
                {
                    std::vector<float> mem(4 * 2, 0.0f); // capacity 4 frames
                    std::atomic<uint32_t> w { 0 }, r { 0 };
                    SharedRingBuffer ring(mem.data(), &w, &r, 4);

                    std::vector<float> in(10 * 2, 1.0f); // 10 frames, way over capacity
                    const uint32_t written = ring.write(in.data(), 10);
                    expect(written <= 4);
                }

                beginTest("read beyond what's available truncates, returns actual count");
                {
                    std::vector<float> mem(16 * 2, 0.0f);
                    std::atomic<uint32_t> w { 0 }, r { 0 };
                    SharedRingBuffer ring(mem.data(), &w, &r, 16);

                    float in[4] = { 1, 2, 3, 4 }; // 2 frames
                    ring.write(in, 2);

                    float out[20] = {};
                    expectEquals((int) ring.read(out, 10), 2);
                }

                beginTest("availableToRead reflects unread frames correctly");
                {
                    std::vector<float> mem(16 * 2, 0.0f);
                    std::atomic<uint32_t> w { 0 }, r { 0 };
                    SharedRingBuffer ring(mem.data(), &w, &r, 16);

                    expectEquals((int) ring.availableToRead(), 0);
                    float in[10] = { 0,0,0,0,0,0,0,0,0,0 }; // 5 frames
                    ring.write(in, 5);
                    expectEquals((int) ring.availableToRead(), 5);
                    float out[10] = {};
                    ring.read(out, 2);
                    expectEquals((int) ring.availableToRead(), 3);
                }

                beginTest("data integrity survives wrapping past the capacity boundary many times");
                {
                    std::vector<float> mem(4 * 2, 0.0f); // small capacity to force wraparound quickly
                    std::atomic<uint32_t> w { 0 }, r { 0 };
                    SharedRingBuffer ring(mem.data(), &w, &r, 4);

                    for (int round = 0; round < 100; ++round)
                    {
                        const float l = (float) round;
                        const float rr = (float) round + 0.5f;
                        float in[2] = { l, rr };
                        expectEquals((int) ring.write(in, 1), 1);
                        float out[2] = {};
                        expectEquals((int) ring.read(out, 1), 1);
                        expectWithinAbsoluteError(out[0], l, 0.0001f);
                        expectWithinAbsoluteError(out[1], rr, 0.0001f);
                    }
                }
            }
        };

        static SharedRingBufferTests sharedRingBufferTests;
    }
}

// native-engine/Source/SharedAudioChannelTests.cpp
#include "SharedAudioChannel.h"
#include <juce_core/juce_core.h>

namespace sssketch
{
    namespace
    {
        class SharedAudioChannelTests : public juce::UnitTest
        {
        public:
            SharedAudioChannelTests() : juce::UnitTest("SharedAudioChannel", "SharedAudioChannel") {}

            void runTest() override
            {
                beginTest("create then attach both succeed for the same name");
                {
                    const auto name = SharedAudioChannel::makeUniqueName();
                    auto owner = SharedAudioChannel::create(name, 4);
                    expect(owner != nullptr);
                    auto attacher = SharedAudioChannel::attach(name, 4);
                    expect(attacher != nullptr);
                }

                beginTest("attach fails for a name nothing created");
                {
                    const auto name = SharedAudioChannel::makeUniqueName();
                    auto attacher = SharedAudioChannel::attach(name, 4);
                    expect(attacher == nullptr);
                }

                beginTest("input written by the owner is read back correctly on the attacher side");
                {
                    const auto name = SharedAudioChannel::makeUniqueName();
                    auto owner = SharedAudioChannel::create(name, 4);
                    auto attacher = SharedAudioChannel::attach(name, 4);
                    expect(owner != nullptr && attacher != nullptr);

                    float in[8] = { 1, 2, 3, 4, 5, 6, 7, 8 }; // 4 frames, interleaved stereo
                    owner->writeInputAndSignal(in, 4);

                    float out[8] = {};
                    const uint32_t got = attacher->waitAndReadInput(out, 4, 1000);
                    expectEquals((int) got, 4);
                    for (int i = 0; i < 8; ++i)
                        expectWithinAbsoluteError(out[i], in[i], 0.0001f);
                }

                beginTest("output written by the attacher is read back correctly on the owner side");
                {
                    const auto name = SharedAudioChannel::makeUniqueName();
                    auto owner = SharedAudioChannel::create(name, 4);
                    auto attacher = SharedAudioChannel::attach(name, 4);
                    expect(owner != nullptr && attacher != nullptr);

                    float in[8] = { 9, 8, 7, 6, 5, 4, 3, 2 };
                    attacher->writeOutputAndSignal(in, 4);

                    float out[8] = {};
                    const uint32_t got = owner->waitAndReadOutput(out, 4, 1000);
                    expectEquals((int) got, 4);
                    for (int i = 0; i < 8; ++i)
                        expectWithinAbsoluteError(out[i], in[i], 0.0001f);
                }

                beginTest("waitAndReadOutput actually waits and times out, returning 0, when nothing is signaled");
                {
                    const auto name = SharedAudioChannel::makeUniqueName();
                    auto owner = SharedAudioChannel::create(name, 4);
                    expect(owner != nullptr);

                    float out[8] = {};
                    const auto start = juce::Time::getMillisecondCounter();
                    const uint32_t got = owner->waitAndReadOutput(out, 4, 50);
                    const auto elapsed = juce::Time::getMillisecondCounter() - start;
                    expectEquals((int) got, 0);
                    expect(elapsed >= 45); // actually waited close to the requested timeout, didn't return instantly
                }

                beginTest("two channels created with different names never collide");
                {
                    const auto nameA = SharedAudioChannel::makeUniqueName();
                    const auto nameB = SharedAudioChannel::makeUniqueName();
                    expect(nameA != nameB);
                    auto a = SharedAudioChannel::create(nameA, 4);
                    auto b = SharedAudioChannel::create(nameB, 4);
                    expect(a != nullptr && b != nullptr);

                    float inA[8] = { 1,1,1,1,1,1,1,1 };
                    float inB[8] = { 2,2,2,2,2,2,2,2 };
                    a->writeInputAndSignal(inA, 4);
                    b->writeInputAndSignal(inB, 4);

                    auto attacherA = SharedAudioChannel::attach(nameA, 4);
                    float outA[8] = {};
                    expectEquals((int) attacherA->waitAndReadInput(outA, 4, 1000), 4);
                    expectWithinAbsoluteError(outA[0], 1.0f, 0.0001f);
                }
            }
        };

        static SharedAudioChannelTests sharedAudioChannelTests;
    }
}

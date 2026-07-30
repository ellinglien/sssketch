// native-engine/Source/SendBusTests.cpp
#include "SendBus.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    class SendBusTests : public juce::UnitTest
    {
    public:
        SendBusTests() : juce::UnitTest("SendBus") {}

        void runTest() override
        {
            beginTest("a bus with no plugin loaded contributes nothing");
            {
                SendBus bus;
                std::vector<float> l(8, 0.0f), r(8, 0.0f);
                bus.applyPendingSwaps();
                bus.beginBlock(8);
                for (int i = 0; i < 8; ++i)
                    bus.addSample(0, i, 1.0f, 1.0f, 1.0f); // hasPlugin() is false -> no-op
                bus.mixBackInto(8, l.data(), r.data());
                for (float s : l) expectEquals(s, 0.0f);
                for (float s : r) expectEquals(s, 0.0f);
            }

            beginTest("hasPlugin is false for every bus when nothing is loaded");
            {
                SendBus bus;
                for (int i = 0; i < kNumSendBuses; ++i)
                    expect(!bus.hasPlugin(i));
            }
        }
    };

    static SendBusTests sendBusTests;
}

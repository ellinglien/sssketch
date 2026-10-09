// native-engine/Source/HaltAckTests.cpp
#include "HaltAck.h"
#include "ChannelChainRegistry.h"
#include "PlaybackEngine.h"
#include "PluginChain.h"
#include "StemBufferCache.h"
#include "Transport.h"
#include <juce_core/juce_core.h>
#include <vector>

namespace sssketch
{
    namespace
    {
        class HaltAckTests : public juce::UnitTest
        {
        public:
            HaltAckTests() : juce::UnitTest("HaltAck", "HaltAck") {}

            void runTest() override
            {
                beginTest("a stop is acknowledged once its own generation completes");
                {
                    HaltAckWait wait { 1, 5, 10, 1000 };
                    expect(! haltAckDue(wait, 4, true, 11, 1002, 250));
                    expect(haltAckDue(wait, 5, true, 12, 1004, 250));
                }

                beginTest("with no device running the stop is acknowledged at once");
                {
                    HaltAckWait wait { 1, 5, 10, 1000 };
                    expect(haltAckDue(wait, 0, false, 10, 1000, 250));
                }

                beginTest("callbacks that stop arriving count as silence after the stall window");
                {
                    HaltAckWait wait { 1, 5, 10, 1000 };
                    expect(! haltAckDue(wait, 0, true, 10, 1100, 250));
                    expect(! haltAckDue(wait, 0, true, 10, 1249, 250));
                    expect(haltAckDue(wait, 0, true, 10, 1250, 250));
                }

                beginTest("a callback that arrives restarts the stall window");
                {
                    // One callback after the request, then the device dies mid-fade: the
                    // window runs from that last callback, not from the request.
                    HaltAckWait wait { 1, 5, 10, 1000 };
                    expect(! haltAckDue(wait, 0, true, 11, 1200, 250));
                    expect(! haltAckDue(wait, 0, true, 11, 1400, 250));
                    expect(haltAckDue(wait, 0, true, 11, 1450, 250));
                }

                beginTest("the stall window survives the millisecond counter wrapping");
                {
                    HaltAckWait wait { 1, 5, 10, 0xffffff80u }; // 144 ms, then 384 ms, across the wrap
                    expect(! haltAckDue(wait, 0, true, 10, 0x00000010u, 250));
                    expect(haltAckDue(wait, 0, true, 10, 0x00000100u, 250));
                }

                beginTest("a play takes every waiting stop, in request order, to answer superseded");
                {
                    std::vector<HaltAckWait> pending { { 3, 5, 10, 1000 }, { 7, 6, 10, 1000 } };
                    const auto tokens = takeSupersededHaltAcks(pending);
                    expect(tokens == std::vector<int> { 3, 7 });
                    expect(pending.empty());
                    expect(takeSupersededHaltAcks(pending).empty());
                }

                beginTest("the stall window is three blocks, never under 250 ms");
                {
                    expectEquals((int) haltAckStallMs(512, 44100.0), 250);
                    expectEquals((int) haltAckStallMs(8192, 44100.0), 558);
                    expectEquals((int) haltAckStallMs(0, 0.0), 250);
                }

                beginTest("a Transport with no device open reports no device running, and counts "
                          "only callbacks that reach its transport commands");
                {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    PluginChain masterChain(kNumMasterChainSlots);
                    ChannelChainRegistry channelChains;
                    Transport transport(engine, masterChain, channelChains);
                    expect(! transport.audioDeviceRunning());
                    expect(transport.renderedCallbacks() == 0);

                    constexpr int numSamples = 64;
                    std::vector<float> l((size_t) numSamples), r((size_t) numSamples);
                    float* stereo[2] = { l.data(), r.data() };
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, stereo, 2, numSamples, {});
                    expect(transport.renderedCallbacks() == 1);

                    // A mono output returns before any transport command applies: a stop
                    // waiting on it must see the count stand still.
                    float* mono[1] = { l.data() };
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, mono, 1, numSamples, {});
                    expect(transport.renderedCallbacks() == 1);
                }
            }
        };

        static HaltAckTests haltAckTests;
    }
}

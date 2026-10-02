// native-engine/Source/TransportTempoTests.cpp
//
// A tempo change never moves the playhead. Transport's position is a sample clock from an
// anchor (Transport.h, anchorBars), converted at the anchor's tempo; setBpm writes the tempo
// from the message thread at any moment. The clock must convert a block's samples at ONE tempo
// (the one the callback read), and a new tempo must take effect at the next block's re-anchor:
// converting every sample since the anchor at a tempo that arrived mid-block would jump the
// playhead -- by ~2.7 bars at bar 64 for 120 -> 125 bpm -- and the next block would re-anchor
// where it landed, so the jump would stick.
#include "Transport.h"
#include "PlaybackEngine.h"
#include "PluginChain.h"
#include "ChannelChainRegistry.h"
#include "StemBufferCache.h"
#include <juce_core/juce_core.h>
#include <algorithm>
#include <atomic>
#include <functional>
#include <cmath>
#include <thread>
#include <vector>

namespace sssketch
{
    class TransportTempoTests : public juce::UnitTest
    {
    public:
        TransportTempoTests() : juce::UnitTest("TransportTempo", "Engine") {}

        static constexpr double kRate = 44100.0;
        static constexpr int kBlock = 512;

        static double barsPerSample(double bpm) { return (1.0 / kRate) / ((60.0 / bpm) * 4.0); }

        struct Rig
        {
            StemBufferCache cache;
            PlaybackEngine engine { cache };
            PluginChain masterChain { kNumMasterChainSlots };
            ChannelChainRegistry channelChains;
            Transport transport { engine, masterChain, channelChains };
            std::vector<float> l = std::vector<float>((size_t) kBlock), r = std::vector<float>((size_t) kBlock);

            void block()
            {
                float* channels[2] = { l.data(), r.data() };
                transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, kBlock, {});
            }
        };

        /** Runs `blocks` callbacks, calling `between(b)` before each, and returns the worst
         * departure of a block's advance from the range a block can advance at the slowest and
         * fastest tempo in play (a wrap adds the loop back; its rounding is half a sample). */
        double worstJump(Rig& rig, double loopBars, int blocks, double bpmLo, double bpmHi,
                         const std::function<void(int)>& between)
        {
            const double lo = kBlock * barsPerSample(bpmLo), hi = kBlock * barsPerSample(bpmHi);
            const double slack = barsPerSample(bpmHi); // a sample: the wrap rounds to one
            double worst = 0.0;
            double last = rig.transport.currentPositionBars();
            for (int b = 0; b < blocks; ++b)
            {
                between(b);
                rig.block();
                const double now = rig.transport.currentPositionBars();
                double advance = now - last;
                if (loopBars > 0.0 && advance < 0.0)
                    advance += loopBars;
                worst = std::max(worst, std::max(lo - advance, advance - hi) - slack);
                last = now;
            }
            return worst;
        }

        void runTest() override
        {
            beginTest("a tempo change between callbacks, mid-loop (8 bars, from bar 6) and in a long arrangement "
                      "(from bar 64): the playhead goes on from where it was");
            {
                for (const double loop : { 8.0, 0.0 })
                {
                    Rig rig;
                    rig.transport.setBpm(120.0);
                    rig.transport.setLoopLengthBars(loop);
                    rig.transport.play(loop > 0.0 ? 6.0 : 64.0);
                    const double hiBpm = loop > 0.0 ? 121.0 : 125.0;
                    const double worst = worstJump(rig, loop, 600, 120.0, hiBpm, [&](int b) {
                        if (b % 50 == 25)
                            rig.transport.setBpm((b / 50) % 2 == 0 ? hiBpm : 120.0);
                    });
                    expect(worst <= 0.0, (loop > 0.0 ? juce::String("loop") : juce::String("arrangement"))
                                             + ": a jump of " + juce::String(worst, 6) + " bar past a block's advance");
                    expect(rig.transport.currentPositionBars() > (loop > 0.0 ? 0.0 : 64.0));
                }
            }

            beginTest("setBpm from another thread while the callbacks run (it lands mid-block, between the "
                      "render and the clock's advance, over and over): the playhead never jumps");
            {
                for (const double loop : { 8.0, 0.0 })
                {
                    Rig rig;
                    rig.transport.setBpm(120.0);
                    rig.transport.setLoopLengthBars(loop);
                    rig.transport.play(loop > 0.0 ? 6.0 : 64.0);
                    std::atomic<bool> stop { false };
                    std::thread hammer([&] {
                        while (! stop.load())
                        {
                            rig.transport.setBpm(120.0);
                            rig.transport.setBpm(125.0);
                        }
                    });
                    const double worst = worstJump(rig, loop, 3000, 120.0, 125.0, [](int) {});
                    stop.store(true);
                    hammer.join();
                    expect(worst <= 0.0, (loop > 0.0 ? juce::String("loop") : juce::String("arrangement"))
                                             + ": a jump of " + juce::String(worst, 6) + " bar past a block's advance");
                }
            }
        }
    };

    static TransportTempoTests transportTempoTests;
}

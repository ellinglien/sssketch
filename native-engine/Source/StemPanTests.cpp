// native-engine/Source/StemPanTests.cpp
//
// The StereoPannerNode law (StemPan.h; native radio sound plan, Task 4). The engine-level half
// -- where a pan sits in a stem's chain, the send being post-pan, block splits -- is in
// PlaybackEngineTests; the wire field in EngineProjectTests.
#include "StemPan.h"
#include <juce_core/juce_core.h>
#include <cmath>
#include <cstring>
#include <vector>

namespace sssketch
{
    class StemPanTests : public juce::UnitTest
    {
    public:
        StemPanTests() : juce::UnitTest("StemPan") {}

        void runTest() override
        {
            constexpr double halfPi = 1.57079632679489661923;
            constexpr int n = 257;

            // A stereo programme whose two sides differ everywhere, so the cross terms show.
            std::vector<float> srcL(n), srcR(n);
            for (int i = 0; i < n; ++i)
            {
                srcL[(size_t) i] = 0.7f * (float) std::sin(0.031 * i);
                srcR[(size_t) i] = 0.4f * (float) std::cos(0.017 * i) - 0.1f;
            }

            beginTest("pan 0 leaves the samples untouched, to the bit");
            {
                auto l = srcL;
                auto r = srcR;
                applyStemPan(0.0, n, l.data(), r.data());
                expect(std::memcmp(l.data(), srcL.data(), sizeof(float) * n) == 0);
                expect(std::memcmp(r.data(), srcR.data(), sizeof(float) * n) == 0);
                // -0.0 is 0 too.
                applyStemPan(-0.0, n, l.data(), r.data());
                expect(std::memcmp(l.data(), srcL.data(), sizeof(float) * n) == 0);
                // And a NaN (the parser never sends one) writes nothing rather than NaNs.
                applyStemPan(std::nan(""), n, l.data(), r.data());
                expect(std::memcmp(r.data(), srcR.data(), sizeof(float) * n) == 0);
            }

            beginTest("+0.25 on a stereo stem is the StereoPannerNode formula, sample for sample");
            {
                auto l = srcL;
                auto r = srcR;
                applyStemPan(0.25, n, l.data(), r.data());
                const double gL = std::cos(0.25 * halfPi);
                const double gR = std::sin(0.25 * halfPi);
                for (int i = 0; i < n; ++i)
                {
                    const double inL = srcL[(size_t) i];
                    const double inR = srcR[(size_t) i];
                    expectEquals(l[(size_t) i], (float) (inL * gL));
                    expectEquals(r[(size_t) i], (float) (inR + inL * gR));
                }
            }

            beginTest("-0.25 on a stereo stem takes the left-hand branch (x = p + 1)");
            {
                auto l = srcL;
                auto r = srcR;
                applyStemPan(-0.25, n, l.data(), r.data());
                const double gL = std::cos(0.75 * halfPi);
                const double gR = std::sin(0.75 * halfPi);
                for (int i = 0; i < n; ++i)
                {
                    const double inL = srcL[(size_t) i];
                    const double inR = srcR[(size_t) i];
                    expectEquals(l[(size_t) i], (float) (inL + inR * gL));
                    expectEquals(r[(size_t) i], (float) (inR * gR));
                }
            }

            beginTest("a mono stem (L = R) at +0.25 gives L = cos(pi/8) x, R = (1 + sin(pi/8)) x");
            {
                std::vector<float> l(n), r(n);
                for (int i = 0; i < n; ++i)
                    l[(size_t) i] = r[(size_t) i] = srcL[(size_t) i];
                applyStemPan(0.25, n, l.data(), r.data());
                const double c = std::cos(juce::MathConstants<double>::pi / 8.0);
                const double s = std::sin(juce::MathConstants<double>::pi / 8.0);
                for (int i = 0; i < n; ++i)
                {
                    const double x = srcL[(size_t) i];
                    expectWithinAbsoluteError((double) l[(size_t) i], c * x, 1.0e-7);
                    expectWithinAbsoluteError((double) r[(size_t) i], (1.0 + s) * x, 1.0e-7);
                }
                // The near side is louder than the source -- the web's fold, not an
                // equal-power pan (StemPan.h).
                expect(std::abs(r[10]) > std::abs(srcL[10]));
            }

            beginTest("the ends: +1 folds everything right, -1 everything left");
            {
                auto l = srcL;
                auto r = srcR;
                applyStemPan(1.0, n, l.data(), r.data());
                for (int i = 0; i < n; ++i)
                {
                    expectWithinAbsoluteError(l[(size_t) i], 0.0f, 1.0e-7f);
                    expectWithinAbsoluteError(r[(size_t) i], srcL[(size_t) i] + srcR[(size_t) i], 1.0e-6f);
                }
                l = srcL;
                r = srcR;
                applyStemPan(-1.0, n, l.data(), r.data());
                for (int i = 0; i < n; ++i)
                {
                    expectWithinAbsoluteError(l[(size_t) i], srcL[(size_t) i] + srcR[(size_t) i], 1.0e-6f);
                    expectEquals(r[(size_t) i], 0.0f);
                }
            }

            beginTest("out of range clamps to the ends");
            {
                auto a = srcL, b = srcR, c = srcL, d = srcR;
                applyStemPan(3.0, n, a.data(), b.data());
                applyStemPan(1.0, n, c.data(), d.data());
                expect(std::memcmp(a.data(), c.data(), sizeof(float) * n) == 0);
                expect(std::memcmp(b.data(), d.data(), sizeof(float) * n) == 0);
            }

            beginTest("block-split invariant, to the bit (no state)");
            {
                auto wholeL = srcL, wholeR = srcR;
                applyStemPan(0.37, n, wholeL.data(), wholeR.data());
                auto splitL = srcL, splitR = srcR;
                juce::Random random(4);
                for (int start = 0; start < n;)
                {
                    const int len = juce::jmin(n - start, 1 + random.nextInt(40));
                    applyStemPan(0.37, len, splitL.data() + start, splitR.data() + start);
                    start += len;
                }
                expect(std::memcmp(wholeL.data(), splitL.data(), sizeof(float) * n) == 0);
                expect(std::memcmp(wholeR.data(), splitR.data(), sizeof(float) * n) == 0);
            }
        }
    };

    static StemPanTests stemPanTests;
}

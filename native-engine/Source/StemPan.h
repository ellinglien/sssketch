// native-engine/Source/StemPan.h
#pragma once
#include <algorithm>
#include <cmath>

namespace sssketch
{
    /** Per-row panning (native radio sound plan, Task 4): Web Audio's StereoPannerNode law on a
     * stereo input, which is what ell.ing/radio's rows run through. A mono stem is already
     * L = R by the time it gets here (renderBlock copies its one channel to both sides), so it
     * takes the same stereo law, exactly as a mono source upmixed into a StereoPannerNode does.
     *
     * For p <= 0, x = p + 1:  L' = L + R cos(x pi/2),  R' = R sin(x pi/2)
     * for p >  0, x = p:      L' = L cos(x pi/2),      R' = R + L sin(x pi/2)
     *
     * Not an equal-power pan of a mono signal: a stereo input's far side is FOLDED into the
     * near side, so the near side gets louder (+0.25 on a mono stem: L = cos(pi/8) x,
     * R = (1 + sin(pi/8)) x). That is the web's quirk, matched on purpose because it is what
     * Elling listened to; a DAW's pan knob is a different law (see exportAbleton/exportReaper).
     *
     * The arithmetic follows Chromium's stereo_panner.cc: gains in double, each output sample
     * computed in double and rounded to float once.
     *
     * Pan 0 is not "nearly nothing" but nothing: the samples are not touched at all, so a
     * centred row is bit-identical to a project from before panning existed. The caller also
     * keeps a pan-0 stem without a toolkit off its own buffer entirely (PlaybackEngine). The
     * pan is static per stem (it is decided per row and changes only with the project), so
     * there is no state and nothing here can depend on where a block was split. */
    inline void applyStemPan(double pan, int numSamples, float* left, float* right)
    {
        // 0 (and -0) is centred: nothing to do. A NaN, which the parser never lets through,
        // also leaves the samples alone rather than writing NaNs.
        if (pan == 0.0 || std::isnan(pan) || numSamples <= 0 || left == nullptr || right == nullptr)
            return;
        constexpr double halfPi = 1.57079632679489661923;
        const double p = std::clamp(pan, -1.0, 1.0);
        const double x = (p <= 0.0 ? p + 1.0 : p) * halfPi;
        const double gainL = std::cos(x);
        const double gainR = std::sin(x);
        if (p <= 0.0)
        {
            for (int i = 0; i < numSamples; ++i)
            {
                const double l = left[i];
                const double r = right[i];
                left[i] = (float) (l + r * gainL);
                right[i] = (float) (r * gainR);
            }
        }
        else
        {
            for (int i = 0; i < numSamples; ++i)
            {
                const double l = left[i];
                const double r = right[i];
                left[i] = (float) (l * gainL);
                right[i] = (float) (r + l * gainR);
            }
        }
    }
}

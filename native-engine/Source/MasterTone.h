// native-engine/Source/MasterTone.h
#pragma once

namespace sssketch
{
    /** Web Audio's BiquadFilterNode, as Chromium computes and runs it (the browser the web radio's
     * master chain was tuned in, and the one scripts/golden-master-chain.mjs renders it in):
     * the Web Audio spec's RBJ ("Audio EQ Cookbook") coefficients, worked out in double from the
     * float AudioParam values, normalised by a0; Direct Form I in double, the state kept in
     * double and each output rounded to float on its way out (Chromium's Biquad::Process;
     * measured against Chrome 154's own BiquadFilterNode output: within 1 float ulp, where a
     * float-rounded feedback was 1e-4 off at 25 Hz).
     *
     *   highpass   Q in DECIBELS (Web Audio's lowpass/highpass Q): alpha = sin(w0) / (2·10^(Q/20)).
     *              The web's biquadQ(0), -3.0103 dB, is linear 0.7071: Butterworth.
     *   shelves    no Q (Web Audio's shelves ignore it): slope S = 1, A = 10^(G/40),
     *              alpha = sin(w0)/2 · sqrt((A + 1/A)(1/S - 1) + 2).
     *
     * Plain state, no allocation; block-size invariant (one sample at a time). MasterTone.cpp is
     * compiled with -ffp-contract=off, so no FMA changes a bit between machines. */
    struct WebBiquad
    {
        double b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0;
        double x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0;

        void setHighpass(double sampleRate, float frequencyHz, float qDb);
        void setLowShelf(double sampleRate, float frequencyHz, float gainDb);
        void setHighShelf(double sampleRate, float frequencyHz, float gainDb);
        void reset();
        float process(float x);
        void process(int numSamples, float* samples);

        /** The shelves' gain-dependent coefficients from a precomputed sin/cos of w0 (the
         * per-sample path of a tone ramp: no trig per sample). */
        void setShelf(bool high, double sinW0, double cosW0, float gainDb);
    };

    /** The wet/dry mix every MasterStage stage fade uses, in place in (l, r): x + (y - x)·w,
     * exactly y where w >= 1 and exactly x where w <= 0; `w` null means all y. In
     * MasterTone.cpp (-ffp-contract=off) so every fade rounds the same. */
    void mixWet(int numSamples, float* l, float* r, const float* wetL, const float* wetR, const float* w);

    /** The web radio's tone stages (masterChain.ts; the numbers are MASTERING in
     * src/shared/radioSound.ts): the 25 Hz high-pass that opens the chain, and, after the glue,
     * the width (mid/side, the side through a +2 dB high shelf at 250 Hz) and the two shelves
     * (+1 dB at 100 Hz and at 10 kHz by default; the project's tone amount tilts them, the wire
     * carries the resolved dB). MasterStage runs them; native radio sound plan, Task 7.
     *
     * highpass() and widthAndShelves() take an optional per-sample wet weight `w` (null: fully
     * wet): the section's output is mixed with its own input as mixWet does, x + (y - x)·w,
     * exactly x at 0 and y at 1. MasterStage's tone switch fades this way, the same weights at
     * both places. The static width() is the bare width, always fully wet (for its tests). */
    class MasterTone
    {
    public:
        static constexpr float kHighpassHz = 25.0f;
        /** biquadQ(0): 20·log10(sqrt(1/2)) dB, as the float AudioParam holds it. */
        static constexpr float kHighpassQDb = -3.0103f;
        static constexpr float kSideShelfHz = 250.0f;
        static constexpr float kSideShelfDb = 2.0f;
        static constexpr float kLowShelfHz = 100.0f;
        static constexpr float kHighShelfHz = 10000.0f;

        /** Sets the rate and the fixed filters; the shelves at 0 dB until setShelves. */
        void prepare(double sampleRate);
        void reset();

        /** The shelves' gains. With `rampSamples` > 0 each glides there linearly (in dB) over
         * that many samples, sample by sample, rather than stepping; 0 sets them at once. */
        void setShelves(float lowDb, float highDb, int rampSamples);

        void highpass(int numSamples, float* l, float* r, const float* w);
        /** Width, then the low shelf, then the high shelf. */
        void widthAndShelves(int numSamples, float* l, float* r, const float* w);

        /** The width alone, on its own side filter: L = M + S', R = M - S' with M = L/2 + R/2,
         * S = L/2 - R/2, S' = S through the +2 dB shelf. L + R = 2M is untouched by the shelf. */
        static void width(WebBiquad& sideShelf, int numSamples, float* l, float* r);

    private:
        void stepShelves();

        double rate = 44100.0;
        WebBiquad hpL, hpR, side, lowL, lowR, highL, highR;
        double lowSin = 0.0, lowCos = 1.0, highSin = 0.0, highCos = 1.0;
        float lowDb = 0.0f, highDb = 0.0f;             // where the shelves are set now
        float lowTarget = 0.0f, highTarget = 0.0f;
        float lowStep = 0.0f, highStep = 0.0f;
        int rampLeft = 0;
    };
}

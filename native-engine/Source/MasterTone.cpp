// native-engine/Source/MasterTone.cpp -- compiled with -ffp-contract=off (CMakeLists.txt).
#include "MasterTone.h"
#include <algorithm>
#include <cfloat>
#include <cmath>

namespace sssketch
{
    namespace
    {
        constexpr double kPi = 3.14159265358979323846;

        /** Chromium's frequency normalisation: the AudioParam's float value over Nyquist, clamped
         * to [0, 1]; w0 = pi · that. */
        double normalised(double sampleRate, float frequencyHz)
        {
            return std::clamp((double) frequencyHz / (sampleRate / 2.0), 0.0, 1.0);
        }

        /** The coefficients only: each channel keeps its own state. */
        void copyCoefficients(const WebBiquad& from, WebBiquad& to)
        {
            to.b0 = from.b0;
            to.b1 = from.b1;
            to.b2 = from.b2;
            to.a1 = from.a1;
            to.a2 = from.a2;
        }

        inline float mix(float x, float y, const float* w, int i)
        {
            if (w == nullptr) return y;
            const float g = w[i];
            if (g >= 1.0f) return y;
            if (g <= 0.0f) return x;
            return x + (y - x) * g;
        }
    }

    void mixWet(int numSamples, float* l, float* r, const float* wetL, const float* wetR, const float* w)
    {
        for (int i = 0; i < numSamples; ++i)
        {
            l[i] = mix(l[i], wetL[i], w, i);
            r[i] = mix(r[i], wetR[i], w, i);
        }
    }

    void WebBiquad::reset() { x1 = x2 = y1 = y2 = 0.0; }

    static void setNormalised(WebBiquad& f, double b0, double b1, double b2, double a0, double a1, double a2)
    {
        const double inv = 1.0 / a0;
        f.b0 = b0 * inv;
        f.b1 = b1 * inv;
        f.b2 = b2 * inv;
        f.a1 = a1 * inv;
        f.a2 = a2 * inv;
    }

    void WebBiquad::setHighpass(double sampleRate, float frequencyHz, float qDb)
    {
        const double cutoff = normalised(sampleRate, frequencyHz);
        if (cutoff >= 1.0)
        {
            setNormalised(*this, 0, 0, 0, 1, 0, 0); // everything removed
            return;
        }
        if (cutoff <= 0.0)
        {
            setNormalised(*this, 1, 0, 0, 1, 0, 0); // nothing removed
            return;
        }
        const double theta = kPi * cutoff;
        const double alpha = std::sin(theta) / (2.0 * std::pow(10.0, (double) qDb / 20.0));
        const double cosw = std::cos(theta);
        const double beta = (1.0 + cosw) / 2.0;
        setNormalised(*this, beta, -2.0 * beta, beta, 1.0 + alpha, -2.0 * cosw, 1.0 - alpha);
    }

    void WebBiquad::setLowpass(double sampleRate, float frequencyHz, float qDb)
    {
        const double cutoff = normalised(sampleRate, frequencyHz);
        if (cutoff >= 1.0)
        {
            setNormalised(*this, 1, 0, 0, 1, 0, 0); // nothing removed
            return;
        }
        if (cutoff <= 0.0)
        {
            setNormalised(*this, 0, 0, 0, 1, 0, 0); // everything removed
            return;
        }
        const double theta = kPi * cutoff;
        const double alpha = std::sin(theta) / (2.0 * std::pow(10.0, (double) qDb / 20.0));
        const double cosw = std::cos(theta);
        const double beta = (1.0 - cosw) / 2.0;
        setNormalised(*this, beta, 2.0 * beta, beta, 1.0 + alpha, -2.0 * cosw, 1.0 - alpha);
    }

    void WebBiquad::setShelf(bool high, double sinW0, double cosW0, float gainDb)
    {
        const double a = std::pow(10.0, (double) gainDb / 40.0);
        const double s = 1.0; // the shelf slope; Web Audio's shelves have no Q
        const double alpha = 0.5 * sinW0 * std::sqrt((a + 1.0 / a) * (1.0 / s - 1.0) + 2.0);
        const double k = cosW0;
        const double k2 = 2.0 * std::sqrt(a) * alpha;
        const double ap = a + 1.0;
        const double am = a - 1.0;
        if (high)
            setNormalised(*this, a * (ap + am * k + k2), -2.0 * a * (am + ap * k), a * (ap + am * k - k2),
                          ap - am * k + k2, 2.0 * (am - ap * k), ap - am * k - k2);
        else
            setNormalised(*this, a * (ap - am * k + k2), 2.0 * a * (am - ap * k), a * (ap - am * k - k2),
                          ap + am * k + k2, -2.0 * (am + ap * k), ap + am * k - k2);
    }

    void WebBiquad::setLowShelf(double sampleRate, float frequencyHz, float gainDb)
    {
        const double f = normalised(sampleRate, frequencyHz);
        const double a = std::pow(10.0, (double) gainDb / 40.0);
        if (f >= 1.0) setNormalised(*this, a * a, 0, 0, 1, 0, 0);
        else if (f <= 0.0) setNormalised(*this, 1, 0, 0, 1, 0, 0);
        else setShelf(false, std::sin(kPi * f), std::cos(kPi * f), gainDb);
    }

    void WebBiquad::setHighShelf(double sampleRate, float frequencyHz, float gainDb)
    {
        const double f = normalised(sampleRate, frequencyHz);
        const double a = std::pow(10.0, (double) gainDb / 40.0);
        if (f >= 1.0) setNormalised(*this, 1, 0, 0, 1, 0, 0);
        else if (f <= 0.0) setNormalised(*this, a * a, 0, 0, 1, 0, 0);
        else setShelf(true, std::sin(kPi * f), std::cos(kPi * f), gainDb);
    }

    float WebBiquad::process(float x)
    {
        const double y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        // Chromium's guard against a stream of subnormals once the input has gone silent (it
        // checks at the end of each render quantum; here every sample, so the block size
        // cannot matter). It only ever zeroes a tail already under FLT_MIN.
        if (x1 == 0.0 && x2 == 0.0 && (y1 != 0.0 || y2 != 0.0) && std::abs(y1) < FLT_MIN && std::abs(y2) < FLT_MIN)
            y1 = y2 = 0.0;
        return (float) y;
    }

    void WebBiquad::process(int numSamples, float* samples)
    {
        for (int i = 0; i < numSamples; ++i)
            samples[i] = process(samples[i]);
    }

    void MasterTone::prepare(double sampleRate)
    {
        rate = sampleRate;
        hpL.setHighpass(rate, kHighpassHz, kHighpassQDb);
        copyCoefficients(hpL, hpR);
        side.setHighShelf(rate, kSideShelfHz, kSideShelfDb);
        const double wl = kPi * normalised(rate, kLowShelfHz);
        const double wh = kPi * normalised(rate, kHighShelfHz);
        lowSin = std::sin(wl);
        lowCos = std::cos(wl);
        highSin = std::sin(wh);
        highCos = std::cos(wh);
        setShelves(0.0f, 0.0f, 0);
        reset();
    }

    void MasterTone::reset()
    {
        for (auto* f : { &hpL, &hpR, &side, &lowL, &lowR, &highL, &highR })
            f->reset();
    }

    void MasterTone::setShelves(float low, float high, int rampSamples)
    {
        if (rampSamples <= 0)
        {
            lowDb = lowTarget = low;
            highDb = highTarget = high;
            rampLeft = 0;
            lowL.setShelf(false, lowSin, lowCos, lowDb);
            copyCoefficients(lowL, lowR);
            highL.setShelf(true, highSin, highCos, highDb);
            copyCoefficients(highL, highR);
            return;
        }
        if (low == lowTarget && high == highTarget) return;
        lowTarget = low;
        highTarget = high;
        rampLeft = rampSamples;
        lowStep = (lowTarget - lowDb) / (float) rampSamples;
        highStep = (highTarget - highDb) / (float) rampSamples;
    }

    void MasterTone::stepShelves()
    {
        if (--rampLeft == 0)
        {
            lowDb = lowTarget;
            highDb = highTarget;
        }
        else
        {
            lowDb += lowStep;
            highDb += highStep;
        }
        lowL.setShelf(false, lowSin, lowCos, lowDb);
        copyCoefficients(lowL, lowR);
        highL.setShelf(true, highSin, highCos, highDb);
        copyCoefficients(highL, highR);
    }

    void MasterTone::highpass(int numSamples, float* l, float* r, const float* w)
    {
        for (int i = 0; i < numSamples; ++i)
        {
            l[i] = mix(l[i], hpL.process(l[i]), w, i);
            r[i] = mix(r[i], hpR.process(r[i]), w, i);
        }
    }

    void MasterTone::width(WebBiquad& sideShelf, int numSamples, float* l, float* r)
    {
        for (int i = 0; i < numSamples; ++i)
        {
            // as the web's GainNodes and summing junctions do it, in float
            const float m = 0.5f * l[i] + 0.5f * r[i];
            const float s = sideShelf.process(0.5f * l[i] + -0.5f * r[i]);
            l[i] = m + s;
            r[i] = m + -s;
        }
    }

    void MasterTone::widthAndShelves(int numSamples, float* l, float* r, const float* w)
    {
        for (int i = 0; i < numSamples; ++i)
        {
            if (rampLeft > 0) stepShelves();
            float yl = l[i], yr = r[i];
            width(side, 1, &yl, &yr);
            yl = highL.process(lowL.process(yl));
            yr = highR.process(lowR.process(yr));
            l[i] = mix(l[i], yl, w, i);
            r[i] = mix(r[i], yr, w, i);
        }
    }
}

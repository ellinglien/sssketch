// native-engine/Source/CavernReverb.cpp
#include "CavernReverb.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <map>
#include <mutex>

namespace sssketch
{
    namespace
    {
        constexpr int kFrame = 1024;      // noise.ts FRAME
        constexpr int kHop = kFrame / 4;  // noise.ts HOP
        constexpr std::uint32_t kSeed = 0x5eed;
        constexpr std::uint32_t kWideSeed = 0x5eed ^ 0x9e3779b9u;
        constexpr double kPi = 3.141592653589793; // Math.PI

        // The Web Audio spec's ConvolverNode normalisation constants.
        constexpr double kGainCalibration = 0.00125;
        constexpr double kGainCalibrationSampleRate = 44100.0;
        constexpr double kMinPower = 0.000125;

        /** JS Math.round: halves round up (towards +infinity). */
        int jsRound(double v) { return (int) std::floor(v + 0.5); }

        /** noise.ts seededRandom (mulberry32), to the bit: JS's int32 wrap-around is uint32
         * arithmetic, and the final division is exact in double. */
        struct Mulberry32
        {
            std::uint32_t a;
            double next()
            {
                a += 0x6d2b79f5u;
                std::uint32_t t = a;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + (t ^ (t >> 7)) * (t | 61u);
                return (double) (t ^ (t >> 14)) / 4294967296.0;
            }
        };

        /** fft.ts: in-place radix-2 complex FFT, unscaled inverse -- the same bit reversal, the
         * same butterfly order and the same twiddles (cos/sin of ang x k), so the impulse is the
         * web's to rounding. The twiddles are tabulated once per stage with the same
         * expression the TS evaluates inline. */
        class WebFft
        {
        public:
            explicit WebFft(int n) : n(n)
            {
                for (int len = 2; len <= n; len <<= 1)
                {
                    for (int sign : { -1, 1 })
                    {
                        const double ang = ((double) sign * 2.0 * kPi) / (double) len;
                        auto& c = sign < 0 ? fwdCos : invCos;
                        auto& s = sign < 0 ? fwdSin : invSin;
                        for (int k = 0; k < len / 2; ++k)
                        {
                            c.push_back(std::cos(ang * (double) k));
                            s.push_back(std::sin(ang * (double) k));
                        }
                    }
                }
            }

            void run(double* re, double* im, bool inverse) const
            {
                for (int i = 1, j = 0; i < n; ++i)
                {
                    int bit = n >> 1;
                    for (; j & bit; bit >>= 1)
                        j ^= bit;
                    j ^= bit;
                    if (i < j)
                    {
                        std::swap(re[i], re[j]);
                        std::swap(im[i], im[j]);
                    }
                }
                const auto& cosT = inverse ? invCos : fwdCos;
                const auto& sinT = inverse ? invSin : fwdSin;
                size_t base = 0;
                for (int len = 2; len <= n; len <<= 1)
                {
                    const int half = len >> 1;
                    for (int k = 0; k < half; ++k)
                    {
                        const double wr = cosT[base + (size_t) k];
                        const double wi = sinT[base + (size_t) k];
                        for (int i = k; i < n; i += len)
                        {
                            const int j = i + half;
                            const double tr = re[j] * wr - im[j] * wi;
                            const double ti = re[j] * wi + im[j] * wr;
                            re[j] = re[i] - tr;
                            im[j] = im[i] - ti;
                            re[i] += tr;
                            im[i] += ti;
                        }
                    }
                    base += (size_t) half;
                }
            }

        private:
            int n;
            std::vector<double> fwdCos, fwdSin, invCos, invSin;
        };
    }

    double cavernT60At(double hz)
    {
        const auto& pts = kCavernT60;
        if (hz <= pts[0][0])
            return pts[0][1];
        for (size_t i = 1; i < pts.size(); ++i)
        {
            if (hz <= pts[i][0])
            {
                const double f0 = pts[i - 1][0], t0 = pts[i - 1][1];
                const double f1 = pts[i][0], t1 = pts[i][1];
                return t0 + ((t1 - t0) * std::log(hz / f0)) / std::log(f1 / f0);
            }
        }
        return pts.back()[1];
    }

    int cavernPreDelaySamples(double sampleRate) { return jsRound(kCavernPreDelaySec * sampleRate); }

    int cavernTailSamples(double sampleRate)
    {
        double longest = 0.0;
        for (const auto& p : kCavernT60)
            longest = std::max(longest, p[1]);
        return jsRound(longest * sampleRate);
    }

    std::array<std::vector<float>, 2> cavernImpulse(double sampleRate)
    {
        const int pre = cavernPreDelaySamples(sampleRate);
        const int tail = cavernTailSamples(sampleRate);
        const int len = pre + tail;

        std::vector<double> hann((size_t) kFrame);
        for (int i = 0; i < kFrame; ++i)
            hann[(size_t) i] = 0.5 - 0.5 * std::cos((2.0 * kPi * (double) i) / (double) kFrame);
        // per-bin decay rate, per second
        std::vector<double> k((size_t) (kFrame / 2 + 1));
        for (int b = 0; b <= kFrame / 2; ++b)
            k[(size_t) b] = std::log(1000.0) / cavernT60At(std::max(1.0, ((double) b * sampleRate) / (double) kFrame));
        // analysis x synthesis Hann windows at hop N/4 overlap-add to 1.5
        const double norm = 1.0 / 1.5;

        const WebFft fft(kFrame);
        std::array<std::vector<float>, 2> out;
        const std::uint32_t seeds[2] = { kSeed, kWideSeed };
        for (int c = 0; c < 2; ++c)
        {
            // noise.ts whiteNoise: a Float32Array, so each value is rounded to float
            std::vector<float> noise((size_t) (tail + kFrame));
            Mulberry32 rnd { seeds[c] };
            for (auto& v : noise)
                v = (float) (rnd.next() * 2.0 - 1.0);

            std::vector<double> acc((size_t) (tail + kFrame), 0.0);
            std::vector<double> re((size_t) kFrame), im((size_t) kFrame);
            for (int start = -kFrame + kHop; start < tail; start += kHop)
            {
                // the frame's centre, from the onset
                const double t = std::max(0.0, (double) (start + kFrame / 2) / sampleRate);
                for (int i = 0; i < kFrame; ++i)
                {
                    const int j = start + i;
                    re[(size_t) i] = j >= 0 && j < tail ? (double) noise[(size_t) j] * hann[(size_t) i] : 0.0;
                    im[(size_t) i] = 0.0;
                }
                fft.run(re.data(), im.data(), false);
                for (int b = 0; b <= kFrame / 2; ++b)
                {
                    const double g = std::exp(-k[(size_t) b] * t);
                    re[(size_t) b] *= g;
                    im[(size_t) b] *= g;
                    if (b > 0 && b < kFrame / 2)
                    {
                        re[(size_t) (kFrame - b)] *= g;
                        im[(size_t) (kFrame - b)] *= g;
                    }
                }
                fft.run(re.data(), im.data(), true);
                for (int i = 0; i < kFrame; ++i)
                {
                    const int j = start + i;
                    if (j >= 0 && j < tail)
                        acc[(size_t) j] += (re[(size_t) i] / (double) kFrame) * hann[(size_t) i] * norm;
                }
            }
            out[(size_t) c].assign((size_t) len, 0.0f);
            for (int j = 0; j < tail; ++j)
                out[(size_t) c][(size_t) (pre + j)] = (float) acc[(size_t) j];
        }
        return out;
    }

    double webAudioConvolverScale(const std::array<std::vector<float>, 2>& impulse, double sampleRate)
    {
        double sum = 0.0;
        size_t count = 0;
        for (const auto& ch : impulse)
        {
            for (float v : ch)
                sum += (double) v * (double) v;
            count += ch.size();
        }
        double power = count > 0 ? std::sqrt(sum / (double) count) : 0.0;
        if (! std::isfinite(power) || power < kMinPower)
            power = kMinPower;
        double scale = kGainCalibration / power;
        if (sampleRate > 0.0)
            scale *= kGainCalibrationSampleRate / sampleRate;
        return scale;
    }

    std::shared_ptr<const CavernIr> buildCavernIr(double sampleRate)
    {
        if (! (sampleRate > 0.0) || ! std::isfinite(sampleRate))
            return nullptr;
        constexpr int B = CavernIr::kBlock;
        constexpr int bins = CavernIr::kBins;

        auto ir = std::make_shared<CavernIr>();
        const auto impulse = cavernImpulse(sampleRate);
        const int pre = cavernPreDelaySamples(sampleRate);
        ir->sampleRate = sampleRate;
        ir->length = (int) impulse[0].size();
        ir->trimmed = std::min(pre, B);
        ir->extraLatency = B - ir->trimmed;
        ir->numPartitions = (ir->length - ir->trimmed + B - 1) / B;
        ir->normalisation = webAudioConvolverScale(impulse, sampleRate);
        ir->gain = (float) (ir->normalisation * std::pow(10.0, kCavernReturnDb / 20.0));

        juce::dsp::FFT fft(CavernIr::kFftOrder);
        std::vector<float> buffer((size_t) (2 * CavernIr::kFftSize));
        for (int c = 0; c < 2; ++c)
        {
            auto& re = ir->re[(size_t) c];
            auto& im = ir->im[(size_t) c];
            re.assign((size_t) ir->numPartitions * bins, 0.0f);
            im.assign((size_t) ir->numPartitions * bins, 0.0f);
            const auto& src = impulse[(size_t) c];
            for (int p = 0; p < ir->numPartitions; ++p)
            {
                std::fill(buffer.begin(), buffer.end(), 0.0f);
                for (int i = 0; i < B; ++i)
                {
                    const size_t at = (size_t) (ir->trimmed + p * B + i);
                    buffer[(size_t) i] = at < src.size() ? src[at] * ir->gain : 0.0f;
                }
                fft.performRealOnlyForwardTransform(buffer.data(), true);
                for (int b = 0; b < bins; ++b)
                {
                    re[(size_t) (p * bins + b)] = buffer[(size_t) (2 * b)];
                    im[(size_t) (p * bins + b)] = buffer[(size_t) (2 * b + 1)];
                }
            }
        }
        return ir;
    }

    std::shared_ptr<const CavernIr> cavernIrFor(double sampleRate)
    {
        if (! (sampleRate > 0.0) || ! std::isfinite(sampleRate))
            return nullptr;
        static std::mutex mutex;
        static std::map<double, std::shared_ptr<const CavernIr>> cache;
        const std::lock_guard<std::mutex> lock(mutex);
        auto& slot = cache[sampleRate];
        if (slot == nullptr)
            slot = buildCavernIr(sampleRate);
        return slot;
    }

    CavernConvolver::CavernConvolver(std::shared_ptr<const CavernIr> impulse)
        : ir(std::move(impulse)), fft(std::make_unique<juce::dsp::FFT>(CavernIr::kFftOrder))
    {
        jassert(ir != nullptr);
        const auto fdl = (size_t) ir->numPartitions * CavernIr::kBins;
        for (auto& s : sides)
        {
            s.inFifo.assign(CavernIr::kBlock, 0.0f);
            s.outFifo.assign(CavernIr::kBlock, 0.0f);
            s.previous.assign(CavernIr::kBlock, 0.0f);
            s.fdlRe.assign(fdl, 0.0f);
            s.fdlIm.assign(fdl, 0.0f);
            s.slotSilent.assign((size_t) ir->numPartitions, 1);
        }
        fftBuffer.assign((size_t) (2 * CavernIr::kFftSize), 0.0f);
        accRe.assign(CavernIr::kBins, 0.0f);
        accIm.assign(CavernIr::kBins, 0.0f);
        clear();
    }

    CavernConvolver::~CavernConvolver() = default;

    void CavernConvolver::clear()
    {
        for (auto& s : sides)
        {
            std::fill(s.inFifo.begin(), s.inFifo.end(), 0.0f);
            std::fill(s.outFifo.begin(), s.outFifo.end(), 0.0f);
            std::fill(s.previous.begin(), s.previous.end(), 0.0f);
            s.previousSilent = true;
            // The spectra themselves are left as they are: a slot flagged silent is never read,
            // and is overwritten whole before it is unflagged.
            std::fill(s.slotSilent.begin(), s.slotSilent.end(), (uint8_t) 1);
        }
        head = 0;
        fifoPos = 0;
    }

    void CavernConvolver::process(int numSamples, const float* inL, const float* inR, float* outL, float* outR, float gain)
    {
        const float* ins[2] = { inL, inR };
        float* outs[2] = { outL, outR };
        for (int done = 0; done < numSamples;)
        {
            const int m = std::min(numSamples - done, CavernIr::kBlock - fifoPos);
            for (size_t c = 0; c < 2; ++c)
            {
                auto& s = sides[c];
                std::memcpy(s.inFifo.data() + fifoPos, ins[c] + done, (size_t) m * sizeof(float));
                const float* wet = s.outFifo.data() + fifoPos;
                float* out = outs[c] + done;
                for (int i = 0; i < m; ++i)
                    out[i] += wet[i] * gain;
            }
            fifoPos += m;
            done += m;
            if (fifoPos == CavernIr::kBlock)
            {
                processFrame();
                fifoPos = 0;
            }
        }
    }

    void CavernConvolver::processFrame()
    {
        constexpr int B = CavernIr::kBlock;
        constexpr int bins = CavernIr::kBins;
        const int P = ir->numPartitions;
        for (size_t c = 0; c < 2; ++c)
        {
            auto& s = sides[c];
            const bool currentSilent =
                std::all_of(s.inFifo.begin(), s.inFifo.end(), [](float v) { return v == 0.0f; });

            // This frame's spectrum: the previous block then this one (overlap-save), unless both
            // are silent, in which case the slot is only flagged.
            if (currentSilent && s.previousSilent)
            {
                s.slotSilent[(size_t) head] = 1;
            }
            else
            {
                std::memcpy(fftBuffer.data(), s.previous.data(), B * sizeof(float));
                std::memcpy(fftBuffer.data() + B, s.inFifo.data(), B * sizeof(float));
                std::fill(fftBuffer.begin() + 2 * B, fftBuffer.end(), 0.0f);
                fft->performRealOnlyForwardTransform(fftBuffer.data(), true);
                float* xr = s.fdlRe.data() + (size_t) head * bins;
                float* xi = s.fdlIm.data() + (size_t) head * bins;
                for (int b = 0; b < bins; ++b)
                {
                    xr[b] = fftBuffer[(size_t) (2 * b)];
                    xi[b] = fftBuffer[(size_t) (2 * b + 1)];
                }
                s.slotSilent[(size_t) head] = 0;
            }
            std::memcpy(s.previous.data(), s.inFifo.data(), B * sizeof(float));
            s.previousSilent = currentSilent;

            // Y = sum over partitions p of X[frame - p] x H[p]
            std::fill(accRe.begin(), accRe.end(), 0.0f);
            std::fill(accIm.begin(), accIm.end(), 0.0f);
            bool any = false;
            const float* hRe = ir->re[c].data();
            const float* hIm = ir->im[c].data();
            for (int p = 0; p < P; ++p)
            {
                const int slot = head - p < 0 ? head - p + P : head - p;
                if (s.slotSilent[(size_t) slot] != 0)
                    continue;
                any = true;
                const float* xr = s.fdlRe.data() + (size_t) slot * bins;
                const float* xi = s.fdlIm.data() + (size_t) slot * bins;
                const float* hr = hRe + (size_t) p * bins;
                const float* hi = hIm + (size_t) p * bins;
                juce::FloatVectorOperations::addWithMultiply(accRe.data(), xr, hr, bins);
                juce::FloatVectorOperations::subtractWithMultiply(accRe.data(), xi, hi, bins);
                juce::FloatVectorOperations::addWithMultiply(accIm.data(), xr, hi, bins);
                juce::FloatVectorOperations::addWithMultiply(accIm.data(), xi, hr, bins);
            }

            if (! any)
            {
                std::fill(s.outFifo.begin(), s.outFifo.end(), 0.0f);
                continue;
            }
            for (int b = 0; b < bins; ++b)
            {
                fftBuffer[(size_t) (2 * b)] = accRe[(size_t) b];
                fftBuffer[(size_t) (2 * b + 1)] = accIm[(size_t) b];
            }
            std::fill(fftBuffer.begin() + 2 * bins, fftBuffer.end(), 0.0f);
            fft->performRealOnlyInverseTransform(fftBuffer.data());
            // overlap-save: the second half is the linear convolution's
            std::memcpy(s.outFifo.data(), fftBuffer.data() + B, B * sizeof(float));
        }
        head = head + 1 == P ? 0 : head + 1;
    }
}

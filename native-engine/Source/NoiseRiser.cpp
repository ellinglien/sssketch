// native-engine/Source/NoiseRiser.cpp
#include "NoiseRiser.h"
#include <algorithm>
#include <cmath>
#include <complex>

namespace sssketch
{
    namespace
    {
        /** A 32-bit integer avalanche (the "lowbias32" mix). Not a random
         * number GENERATOR -- there is no state to advance -- but a bijection
         * whose output bits each depend on every input bit, which is exactly
         * what turns a plain counter into white noise. */
        inline std::uint32_t mix32(std::uint32_t x)
        {
            x ^= x >> 16;
            x *= 0x7feb352dU;
            x ^= x >> 15;
            x *= 0x846ca68bU;
            x ^= x >> 16;
            return x;
        }

        double clamp01(double v)
        {
            if (!std::isfinite(v)) return 0.0;
            return std::clamp(v, 0.0, 1.0);
        }
    }

    std::uint32_t riserSeedFor(const juce::String& id)
    {
        // FNV-1a over the id's UTF-8 bytes. Chosen over anything fancier
        // because it is short, has no dependencies, and is trivially the same
        // on every platform -- which is the only property that actually
        // matters here (a riser must sound the same everywhere, not be
        // cryptographically unpredictable). The final mix32 spreads FNV's
        // weak low-bit avalanche so two ids differing in one character don't
        // produce audibly related noise.
        std::uint32_t hash = 2166136261U;
        for (const char* p = id.toRawUTF8(); *p != '\0'; ++p)
        {
            hash ^= (std::uint32_t) (unsigned char) *p;
            hash *= 16777619U;
        }
        return mix32(hash);
    }

    float riserNoiseAt(std::uint32_t seed, std::int64_t sampleIndex)
    {
        const auto unsignedIndex = (std::uint64_t) sampleIndex;
        const auto low = (std::uint32_t) (unsignedIndex & 0xffffffffU);
        const auto high = (std::uint32_t) (unsignedIndex >> 32);
        const std::uint32_t hashed = mix32(seed ^ mix32(low ^ mix32(high)));
        // [0, 2^32) -> [-1, 1). Done in double and narrowed once, so the
        // result is exactly reproducible rather than depending on the order a
        // compiler happens to fold single-precision arithmetic in.
        return (float) ((double) hashed * (2.0 / 4294967296.0) - 1.0);
    }

    double riserEnvelopeAt(double progress01)
    {
        const double p = clamp01(progress01);
        return p * p;
    }

    double riserTailGainAt(double tailProgress01)
    {
        if (!std::isfinite(tailProgress01) || tailProgress01 >= 1.0) return 0.0;
        if (tailProgress01 <= 0.0) return 1.0;
        // The shift-and-renormalise that makes an exponential land on zero --
        // see riserTailGainAt's declaration in NoiseRiser.h. The floor is a
        // compile-time constant in everything but name; left as an expression
        // so it cannot drift away from kRiserTailDecay if that is ever
        // retuned.
        const double floorGain = std::exp(-kRiserTailDecay);
        return (std::exp(-kRiserTailDecay * tailProgress01) - floorGain) / (1.0 - floorGain);
    }

    double riserCutoffAt(const EngineRiser& riser, double clipBar)
    {
        if (!riser.curve.empty())
            return evaluateAutomation(riser.curve, clipBar, riser.startCutoffValue);
        if (!std::isfinite(clipBar) || !(riser.lengthBars > 0.0))
            return riser.startCutoffValue;
        const double progress = clamp01(clipBar / riser.lengthBars);
        return riser.startCutoffValue + (riser.endCutoffValue - riser.startCutoffValue) * progress;
    }

    double riserGainNormalisation(double q)
    {
        if (!std::isfinite(q))
            q = kRiserBandwidthQ;
        q = std::clamp(q, kRiserMinQ, kRiserMaxQ);
        // Written as the product of the two factors the doc comment names, in
        // this order, so Q 2 gives exactly 0.5 * 1.
        return (1.0 / q) * std::sqrt(q / 2.0);
    }

    double riserPinkMatchGain(double sampleRate)
    {
        if (!(sampleRate > 0.0))
            return 1.0;
        // H(z) = sum g / (1 - p z^-1) + direct, at z = e^jw.
        const double w = 2.0 * juce::MathConstants<double>::pi * kRiserPinkMatchHz / sampleRate;
        const std::complex<double> zInv = std::polar(1.0, -w);
        std::complex<double> h = kKelletDirect;
        h += kKelletGain0 / (1.0 - kKelletPole0 * zInv);
        h += kKelletGain1 / (1.0 - kKelletPole1 * zInv);
        h += kKelletGain2 / (1.0 - kKelletPole2 * zInv);
        const double magnitude = std::abs(h);
        return magnitude > 0.0 ? 1.0 / magnitude : 1.0;
    }

    void RiserPinkFilter::warmTo(std::uint32_t seed, std::int64_t index)
    {
        reset();
        for (std::int64_t i = index - kRiserPinkWarmupSamples; i < index; ++i)
            process((double) riserNoiseAt(seed, i));
    }

    void RiserVoice::prepare(double sampleRate, int maxBlockSize)
    {
        if (sampleRate <= 0.0 || maxBlockSize <= 0)
            return;
        // Only a new RATE re-prepares. JUCE's StateVariableTPTFilter::prepare
        // never reads the block size (it sets the rate, sizes two state
        // vectors by channel count, and resets) -- and the reset is the
        // problem: until 2026-10-02 a block bigger than any before it
        // re-prepared here too, wiping the bandpass mid-riser (a possible
        // click), so a riser was not split-invariant when the host's block
        // grew (Transport's loop-top splits followed by a full block, or a
        // device buffer change). For a pink riser it would also have cost a
        // warm-up at a plain block boundary. Fixed with the riser variety
        // (native radio sound plan, Task 6); fixed-size renders (every export)
        // are unchanged to the bit.
        if (sampleRate == preparedSampleRate)
            return;

        juce::dsp::ProcessSpec spec {};
        spec.sampleRate = sampleRate;
        spec.maximumBlockSize = (juce::uint32) maxBlockSize;
        spec.numChannels = 2;
        filter.prepare(spec);
        filter.setType(juce::dsp::StateVariableTPTFilterType::bandpass);
        filter.setResonance((float) kRiserBandwidthQ);
        filterQ = kRiserBandwidthQ;
        pinkMatch = riserPinkMatchGain(sampleRate);
        preparedSampleRate = sampleRate;
        // prepare() wipes filter state, so whatever continuity this voice had
        // is gone -- say so, rather than letting the next block believe it is
        // continuing from a state that no longer exists.
        nextSampleIndex = -1;
        lastCoefficientIndex = -1;
        pinkReady = false;
    }

    bool RiserVoice::render(
        const EngineRiser& riser,
        double blockStartSec,
        double sampleRate,
        double secPerBar,
        int numSamples,
        float* outL,
        float* outR)
    {
        if (numSamples <= 0 || outL == nullptr || outR == nullptr)
            return false;
        if (sampleRate <= 0.0 || secPerBar <= 0.0)
            return false;
        if (!std::isfinite(riser.startBar) || !(riser.lengthBars > 0.0))
            return false;

        const double startSec = riser.startBar * secPerBar;
        const double lengthSec = riser.lengthBars * secPerBar;
        const double tailSec = kRiserTailBars * secPerBar;
        // What the riser SOUNDS over, which is longer than what it occupies
        // on the timeline: the swell peaks at startSec + lengthSec and the
        // tail decays away after that (kRiserTailBars).
        const double soundingEndSec = startSec + lengthSec + tailSec;
        const double blockEndSec = blockStartSec + (double) numSamples / sampleRate;
        // The cheap rejection every non-sounding riser takes: one pair of
        // comparisons per block, no state touched, no filter prepared.
        if (blockEndSec <= startSec || blockStartSec >= soundingEndSec)
            return false;

        prepare(sampleRate, numSamples);
        if (preparedSampleRate <= 0.0)
            return false;

        if (!seeded)
        {
            seedL = riserSeedFor(riser.id);
            // The right channel is the SAME riser's noise under a different
            // seed rather than a copy of the left. Two independent noise
            // streams through one bandpass give the riser real stereo width
            // (a mono riser collapses to a point in the middle of the mix,
            // which is the one place a build has the least room to grow);
            // derived from seedL so it is still fully determined by the
            // riser's id. The constant is the golden-ratio odd word every
            // hash mixer in this family uses -- chosen only because it has no
            // small factors in common with the FNV multiplier.
            seedR = seedL ^ 0x9e3779b9U;
            seeded = true;
        }

        // The riser's character (EngineRiser; all of it today's riser when
        // the wire left it out). Mono is one noise in both sides: seedR =
        // seedL, the same stream through the same (per-channel) filter, so
        // L == R exactly.
        const bool mono = riser.mono;
        const std::uint32_t streamR = mono ? seedL : seedR;
        const bool pink = riser.pink;
        if (!pink || mono != pinkReadyMono)
            pinkReady = false;

        const double q = std::isfinite(riser.q) ? std::clamp(riser.q, kRiserMinQ, kRiserMaxQ) : kRiserBandwidthQ;
        if (q != filterQ)
        {
            filter.setResonance((float) q);
            filterQ = q;
        }
        // See riserGainNormalisation: exactly kRiserBandpassNormalisation at Q 2.
        const double normalisation = riserGainNormalisation(q);
        bool sounded = false;

        const double nyquistLimit = preparedSampleRate * 0.49;
        const double level = clamp01(riser.level);

        for (int i = 0; i < numSamples; ++i)
        {
            const double sampleTimeSec = blockStartSec + (double) i / sampleRate;
            if (sampleTimeSec < startSec || sampleTimeSec >= soundingEndSec)
                continue;

            // Rounded to nearest, not truncated -- the same sub-ULP trap
            // PlaybackEngine::renderBlock's own srcSample comment documents at
            // length. Here it matters even more: a source index that lands
            // one below the intended whole number doesn't repeat a sample of
            // a waveform (barely audible), it hands back a COMPLETELY
            // different noise value, because the source is a hash rather than
            // a signal. Nearest-rounding is what makes a block split at an
            // arbitrary sample produce the identical stream.
            const auto index = (std::int64_t) std::llround((sampleTimeSec - startSec) * sampleRate);

            if (index != nextSampleIndex)
            {
                // A seek, a transport restart, or simply the first block this
                // riser sounds in. The bandpass's state describes a stretch
                // of the sweep we are no longer in, so it goes.
                filter.reset();
                lastCoefficientIndex = -1;
                pinkReady = false;
            }
            nextSampleIndex = index + 1;
            sounded = true;

            if (pink && !pinkReady)
            {
                // The one place a pink riser pays for its memory: at most
                // once per discontinuity (so once per render call at most,
                // since the indices inside one call are consecutive), never
                // at a block boundary in continuous playback.
                pinkL.warmTo(seedL, index);
                if (!mono)
                    pinkR.warmTo(streamR, index);
                pinkReady = true;
                pinkReadyMono = mono;
                ++pinkWarmUps;
            }

            const double localSec = (double) index / sampleRate;

            if (lastCoefficientIndex < 0
                || index - lastCoefficientIndex >= kRiserCoefficientUpdateSamples)
            {
                const double clipBar = localSec / secPerBar;
                const double hz = std::min(filterCutoffHz(riserCutoffAt(riser, clipBar)), nyquistLimit);
                filter.setCutoffFrequency((float) std::max(hz, kFilterCutoffMinHz));
                lastCoefficientIndex = index;
            }

            // riserEnvelopeAt clamps at 1, so through the tail the swell
            // simply HOLDS at full and the tail gain is the only thing
            // moving -- which is what makes the peak land on the end bar and
            // stay there, rather than being pulled earlier by its own
            // release.
            const double gain = level
                * riserEnvelopeAt(localSec / lengthSec)
                * riserTailGainAt((localSec - lengthSec) / tailSec)
                // See kRiserBandpassNormalisation and riserGainNormalisation:
                // without this the filter's own passband gain of Q rides on top
                // of the user's level.
                * normalisation;

            float sourceL, sourceR;
            if (pink)
            {
                sourceL = (float) (pinkL.process((double) riserNoiseAt(seedL, index)) * pinkMatch);
                sourceR = mono ? sourceL : (float) (pinkR.process((double) riserNoiseAt(streamR, index)) * pinkMatch);
            }
            else
            {
                sourceL = riserNoiseAt(seedL, index);
                sourceR = riserNoiseAt(streamR, index);
            }

            const float l = filter.processSample(0, sourceL);
            const float r = filter.processSample(1, sourceR);
            outL[i] += (float) (l * gain);
            outR[i] += (float) (r * gain);
        }

        // Same "silence is expensive" denormal flush ChannelFilter::process
        // ends with -- a resonant bandpass fed nothing leaves denormal
        // residue circulating in its state variables, which on some CPUs
        // costs orders of magnitude more per sample than real arithmetic.
        filter.snapToZero();
        return sounded;
    }
}

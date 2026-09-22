// native-engine/Source/ReverbBus.cpp
#include "ReverbBus.h"

// The ONLY place the vendored zita-rev1 header is included -- see
// Source/dsp/zita-rev1/VENDORED.md. Fons Adriaensen's reverb, GPL-3-or-later,
// copied unmodified; its classes live in the global namespace (`Reverb`,
// `Pareq`, `Delay`, ...), which is exactly why this include is confined to
// one .cpp behind ReverbBus::Impl rather than reaching the rest of the
// engine, where `Reverb` would sit uncomfortably next to juce::Reverb.
#include "dsp/zita-rev1/reverb.h"

#include <algorithm>
#include <cmath>

namespace sssketch
{
    namespace
    {
        double clamp01(double v)
        {
            if (!std::isfinite(v)) return 0.0;
            return std::clamp(v, 0.0, 1.0);
        }

        // zita's own decay controls are in seconds of RT60-ish decay. 0.5s is
        // a small live room, 8s a long hall -- and 8 is also the top of the
        // range zita's own UI exposes, beyond which Filt1's gain solve starts
        // producing an unhelpfully long, washed-out smear.
        constexpr double kMinDecaySec = 0.5;
        constexpr double kMaxDecaySec = 8.0;

        // Damping is a corner frequency, so it maps logarithmically for the
        // same reason the filter cutoff does. 20kHz (out of the way) down to
        // 1.5kHz (distinctly dark).
        constexpr double kMinDampingHz = 1500.0;
        constexpr double kMaxDampingHz = 20000.0;

        // zita's prepare() computes its input-delay tap as
        // (_ipdel - 0.020) * fsamp against a 0.1*fsamp line, so _ipdel below
        // 20ms would index negatively and above ~120ms would wrap.
        constexpr double kMinPreDelaySec = 0.020;
        constexpr double kMaxPreDelaySec = 0.115;
    }

    double reverbDecaySecondsFor(double roomSize01)
    {
        return kMinDecaySec * std::pow(kMaxDecaySec / kMinDecaySec, clamp01(roomSize01));
    }

    double reverbDampingHzFor(double damping01)
    {
        // Inverted: MORE damping means a LOWER corner.
        return kMaxDampingHz * std::pow(kMinDampingHz / kMaxDampingHz, clamp01(damping01));
    }

    double reverbPreDelaySecondsFor(double preDelayMs)
    {
        if (!std::isfinite(preDelayMs))
            return kMinPreDelaySec;
        return std::clamp(kMinPreDelaySec + preDelayMs / 1000.0, kMinPreDelaySec, kMaxPreDelaySec);
    }

    struct ReverbBus::Impl
    {
        Reverb reverb;
        bool initialised = false;
        double initialisedRate = 0.0;
    };

    ReverbBus::ReverbBus() = default;
    ReverbBus::~ReverbBus() = default;

    void ReverbBus::prepare(double newSampleRate, int newMaxBlockSize)
    {
        if (newSampleRate <= 0.0 || newMaxBlockSize <= 0)
            return;
        const bool rateChanged = newSampleRate != sampleRate;
        sampleRate = newSampleRate;
        maxBlockSize = std::max(maxBlockSize, newMaxBlockSize);
        if (rateChanged)
        {
            // Only meaningful if a reverb exists; if not, the new rate is
            // simply what the lazy build below will use.
            if (impl != nullptr)
            {
                impl->reverb.init((float) sampleRate, false);
                impl->initialisedRate = sampleRate;
                settingsDirty = true;
                tailSamplesRemaining = 0;
            }
        }
    }

    void ReverbBus::setSettings(const ReverbSettings& s)
    {
        // Compared rather than blindly assigned: the render path pushes the
        // project's settings every single block, and each of zita's setters
        // bumps a change counter that makes its next prepare() re-solve all
        // eight Filt1 gain sets. Doing that once per block instead of once
        // per actual change would be real, pointless work on the audio
        // thread.
        if (s.roomSize == settings.roomSize
            && s.damping == settings.damping
            && s.preDelayMs == settings.preDelayMs)
            return;
        settings = s;
        settingsDirty = true;
    }

    void ReverbBus::ensureBuilt()
    {
        if (impl == nullptr)
        {
            // The one allocation this class ever makes, deferred to the first
            // block that actually feeds the bus: zita's delay lines are
            // ~100ms per line plus eight feedback delays. Deferring it is
            // what keeps a project that never touches reverb genuinely free.
            // It does mean this runs on the audio thread the first time a
            // send goes non-zero -- an acceptable one-off (a tenth of a
            // second of float buffers), and the same kind of first-use lazy
            // sizing PlaybackEngine's own scratch buffers already do.
            impl = std::make_unique<Impl>();
        }
        if (!impl->initialised || impl->initialisedRate != sampleRate)
        {
            impl->reverb.init((float) sampleRate, false);
            impl->initialised = true;
            impl->initialisedRate = sampleRate;
            settingsDirty = true;
        }
        if (settingsDirty)
        {
            impl->reverb.set_rtmid((float) reverbDecaySecondsFor(settings.roomSize));
            // Low frequencies ring longer than mids in a real space; 1.5x is
            // zita's own default relationship (rtlow 3.0 against rtmid 2.0),
            // clamped so a maxed-out room size can't push rtlow past the
            // range Filt1's gain solve behaves in.
            impl->reverb.set_rtlow((float) std::min(
                reverbDecaySecondsFor(settings.roomSize) * 1.5, kMaxDecaySec));
            impl->reverb.set_fdamp((float) reverbDampingHzFor(settings.damping));
            impl->reverb.set_delay((float) reverbPreDelaySecondsFor(settings.preDelayMs));
            // Fully wet. This is a SEND bus -- the dry signal stays on the
            // channel path, so letting zita mix any of its own input back in
            // would double the dry signal in the master mix. opmix 1 makes
            // zita's own dry gain (t0 = (1-opmix)*(1+opmix)) exactly zero.
            impl->reverb.set_opmix(1.0f);
            settingsDirty = false;
        }
    }

    void ReverbBus::beginBlock(int numSamples)
    {
        fedThisBlock = false;
        if (numSamples <= 0)
            return;
        const auto n = (size_t) numSamples;
        if (sendL.size() < n)
        {
            sendL.resize(n);
            sendR.resize(n);
            wetL.resize(n);
            wetR.resize(n);
            spareC.resize(n);
            spareD.resize(n);
        }
        // Only the live prefix is cleared -- the vectors can be longer than
        // this block from a previous, larger one.
        std::fill(sendL.begin(), sendL.begin() + (long) n, 0.0f);
        std::fill(sendR.begin(), sendR.begin() + (long) n, 0.0f);
    }

    void ReverbBus::addSend(int numSamples, const float* left, const float* right, ParamSmoother& gain)
    {
        if (numSamples <= 0 || left == nullptr || right == nullptr)
            return;
        // Nothing to send and nothing on the way: skip without marking the
        // bus fed, so an all-sends-zero project stays on the free path.
        if (gain.current() <= 0.0f && gain.isSettled())
        {
            gain.advance(numSamples);
            return;
        }
        if (sendL.size() < (size_t) numSamples)
            return; // beginBlock wasn't called for this size -- refuse rather than overrun
        for (int i = 0; i < numSamples; ++i)
        {
            const float g = gain.next();
            sendL[(size_t) i] += left[i] * g;
            sendR[(size_t) i] += right[i] * g;
        }
        fedThisBlock = true;
    }

    void ReverbBus::endBlock(int numSamples, float* outL, float* outR)
    {
        if (numSamples <= 0 || outL == nullptr || outR == nullptr)
            return;
        // The whole point of the neutral path: nothing was sent and nothing
        // is still ringing, so the output is left exactly as the caller had
        // it -- bit-identical, no reverb built, no samples touched.
        if (!fedThisBlock && tailSamplesRemaining <= 0)
            return;
        if (sampleRate <= 0.0)
            return;

        ensureBuilt();

        if (fedThisBlock)
        {
            // Keep running for a full decay's worth of blocks after the last
            // thing was sent, so a send automation ramping to zero (or a clip
            // ending) leaves a real tail instead of a hard cut. 1.5x the
            // decay time is comfortably past audibility for an RT60-style
            // decay, and capped so a pathological rate can't produce a
            // multi-minute "still ringing" state.
            const double tailSec = std::min(reverbDecaySecondsFor(settings.roomSize) * 1.5, kMaxDecaySec * 1.5);
            tailSamplesRemaining = (int) std::ceil(tailSec * sampleRate);
        }
        else
        {
            tailSamplesRemaining = std::max(0, tailSamplesRemaining - numSamples);
        }

        float* inp[2] = { sendL.data(), sendR.data() };
        float* out[4] = { wetL.data(), wetR.data(), spareC.data(), spareD.data() };
        impl->reverb.prepare(numSamples);
        impl->reverb.process(numSamples, inp, out);

        for (int i = 0; i < numSamples; ++i)
        {
            outL[i] += wetL[(size_t) i];
            outR[i] += wetR[(size_t) i];
        }
    }

    void ReverbBus::reset()
    {
        tailSamplesRemaining = 0;
        fedThisBlock = false;
        if (impl != nullptr && impl->initialised && sampleRate > 0.0)
        {
            // zita has no state-only clear, so re-init is how a tail is
            // dropped. Only reachable once a reverb has actually been built.
            impl->reverb.init((float) sampleRate, false);
            impl->initialisedRate = sampleRate;
            settingsDirty = true;
        }
    }
}

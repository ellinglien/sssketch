// native-engine/Source/MasterStage.cpp
#include "MasterStage.h"
#include <juce_core/juce_core.h>
#include <cmath>
#include <cstring>

namespace sssketch
{
    std::optional<MasterStage::Settings> MasterStage::settingsFor(const SoundSettings& sound)
    {
        if (! sound.mastering) return std::nullopt;
        return Settings { *sound.mastering, sound.glue, sound.tone };
    }

    // ---------------------------------------------------------------------------------------
    // StageFade

    bool MasterStage::StageFade::update(bool want, bool fade, int fadeSamples)
    {
        if (want)
        {
            if (! engaged)
            {
                engaged = true;
                fadingIn = true;
                fadeLeft = fade ? fadeSamples : 0;
                return true;
            }
            if (! fadingIn)
            {
                // switched back on during a fade-out: back in from where it had got to
                fadingIn = true;
                fadeLeft = fadeSamples - fadeLeft;
            }
            return false;
        }
        if (engaged && fadingIn)
        {
            // switched off: fade out, the whole fade from steady, or back from a fade-in
            fadingIn = false;
            fadeLeft = fadeSamples - fadeLeft;
            if (fadeLeft == 0) engaged = false; // had not started fading in: nothing of it is out
        }
        return false;
    }

    bool MasterStage::StageFade::weights(int n, int fadeSamples, float* w)
    {
        if (fadeLeft == 0 && fadingIn) return false;
        for (int i = 0; i < n; ++i)
        {
            if (fadeLeft == 0)
            {
                w[i] = fadingIn ? 1.0f : 0.0f;
                continue;
            }
            --fadeLeft;
            const float done = (float) (fadeSamples - fadeLeft) / (float) fadeSamples;
            w[i] = fadingIn ? done : 1.0f - done;
        }
        return true;
    }

    void MasterStage::StageFade::settle()
    {
        if (! fadingIn && fadeLeft == 0) engaged = false;
    }

    // ---------------------------------------------------------------------------------------
    // Instance

    MasterStage::Instance::Instance(double rate)
        : sampleRate(rate), fadeSamples(juce::jmax(1, (int) std::lround(kFadeSec * rate)))
    {
        limiter.prepare(rate, kChunk);
        jassert(limiter.numInputs() == 2 && limiter.numOutputs() == 2);
        jassert(limiter.latencySamples() == kLatencySamples);
        glue.prepare(rate, kChunk);
        jassert(glue.numInputs() == 2 && glue.numOutputs() == 2 && glue.latencySamples() == 0);
        tone.prepare(rate);
        for (auto& s : scratch)
            s.assign((size_t) kChunk, 0.0f);
    }

    void MasterStage::Instance::reset()
    {
        limiter.reset();
        engaged = false;
        fadeLeft = 0;
        gainRampLeft = 0;
        glueFade = {};
        toneFade = {};
    }

    void MasterStage::Instance::clearDynamics()
    {
        limiter.reset();
        glue.reset();
        tone.reset();
    }

    void MasterStage::Instance::updateStages(const Settings& s, bool fade)
    {
        if (glueFade.update(s.glue.has_value(), fade, fadeSamples))
            glue.reset();
        if (s.glue)
        {
            const auto& g = *s.glue;
            if (! glueParamsSet || g.thresholdDb != glueSet.thresholdDb || g.ratio != glueSet.ratio || g.kneeDb != glueSet.kneeDb)
            {
                glue.setParam("/glue/threshold", (float) g.thresholdDb);
                glue.setParam("/glue/ratio", (float) g.ratio);
                glue.setParam("/glue/knee", (float) g.kneeDb);
                glueSet = g;
                glueParamsSet = true;
            }
        }

        const bool toneFresh = toneFade.update(s.tone.has_value(), fade, fadeSamples);
        if (toneFresh)
            tone.reset();
        if (s.tone)
            // the AudioParam's float, as the web's BiquadFilterNode holds the gain; a change
            // while the tone is already running glides there
            tone.setShelves((float) s.tone->lowShelfDb, (float) s.tone->highShelfDb, toneFresh ? 0 : fadeSamples);
    }

    void MasterStage::Instance::process(const Settings* settings, bool fadeOnEngage, int numSamples, float* l, float* r)
    {
        if (settings != nullptr)
        {
            const float target = (float) std::pow(10.0, settings->mastering.headroomDb / 20.0);
            bool engagingNow = false;
            if (! engaged)
            {
                engaged = true;
                engagingNow = true;
                fadingIn = true;
                gain = gainTarget = target;
                gainRampLeft = 0;
                // glue and tone start with the stage, inside its own fade (or at once)
                glueFade = {};
                toneFade = {};
                if (fadeOnEngage)
                {
                    // Switched on while sounding: start the limiter clean (its line holds
                    // whatever it last saw, possibly long ago) and fade it in.
                    limiter.reset();
                    fadeLeft = fadeSamples;
                }
                else
                {
                    fadeLeft = 0; // a fresh stage, or after reset(): immediate, as an export starts
                }
            }
            else if (! fadingIn && fadeLeft > 0)
            {
                // Switched back on during a fade-out: fade back in from where it had got to.
                fadingIn = true;
                fadeLeft = fadeSamples - fadeLeft;
            }
            if (target != gainTarget)
            {
                gainTarget = target;
                gainRampLeft = fadeSamples;
                gainStep = (gainTarget - gain) / (float) fadeSamples;
            }
            held = *settings;
            updateStages(held, ! engagingNow);
        }
        else
        {
            if (! engaged) return; // off is today: not a sample touched
            if (fadingIn)
            {
                // Switched off: keep running on the last settings (glue and tone included)
                // while fading to the dry signal -- the whole fade from steady, or back from
                // where a fade-in had got to.
                fadeLeft = fadeSamples - fadeLeft;
                fadingIn = false;
                if (fadeLeft == 0)
                {
                    engaged = false;
                    return;
                }
            }
        }

        for (int done = 0; done < numSamples && engaged;)
        {
            const int n = juce::jmin(kChunk, numSamples - done);
            processChunk(held, n, l + done, r + done);
            done += n;
        }
    }

    void MasterStage::Instance::processChunk(const Settings& s, int n, float* l, float* r)
    {
        const auto ceiling = (float) s.mastering.ceilingDb;
        if (! ceilingSet || ceiling != lastCeilingDb)
        {
            limiter.setParam("/truepeak/ceiling", ceiling);
            lastCeilingDb = ceiling;
            ceilingSet = true;
        }

        float* inL = scratch[0].data();
        float* inR = scratch[1].data();
        float* outL = scratch[2].data();
        float* outR = scratch[3].data();

        // 1. the headroom trim, ramping (sample by sample, so block-size invariant) to a new value
        for (int i = 0; i < n; ++i)
        {
            if (gainRampLeft > 0)
            {
                gain = --gainRampLeft == 0 ? gainTarget : gain + gainStep;
            }
            inL[i] = l[i] * gain;
            inR[i] = r[i] * gain;
        }

        // The tone's weights serve both of its places (2 and 5), so they are taken once.
        const float* toneW = nullptr;
        if (toneFade.engaged && toneFade.weights(n, fadeSamples, scratch[5].data()))
            toneW = scratch[5].data();

        // 2. the 25 Hz high-pass (tone)
        if (toneFade.engaged)
            tone.highpass(n, inL, inR, toneW);

        // 3. the saturation (Task 8) slots in here: after the HP, before the glue, as the web's.

        // 4. the glue (glue.dsp): no latency, no makeup
        if (glueFade.engaged)
        {
            const float* ins[2] = { inL, inR };
            float* outs[2] = { outL, outR };
            glue.process(ins, 2, outs, n);
            float* w = scratch[4].data();
            const bool fading = glueFade.weights(n, fadeSamples, w);
            // the same mix the tone's fades use (MasterTone.cpp, one rounding everywhere)
            mixWet(n, inL, inR, outL, outR, fading ? w : nullptr);
            glueFade.settle();
        }

        // 5-6. the width and the two shelves (tone)
        if (toneFade.engaged)
        {
            tone.widthAndShelves(n, inL, inR, toneW);
            toneFade.settle();
        }

        // 7. the true-peak limiter
        const float* ins[2] = { inL, inR };
        float* outs[2] = { outL, outR };
        limiter.process(ins, 2, outs, n);

        if (fadeLeft == 0)
        {
            std::memcpy(l, outL, (size_t) n * sizeof(float));
            std::memcpy(r, outR, (size_t) n * sizeof(float));
            return;
        }

        // Crossfading between the dry block (still in l/r) and the limited one. The weight of
        // the limited signal steps by 1/fadeSamples a sample and lands exactly on 1 (in) or 0
        // (out) on the fade's last sample.
        for (int i = 0; i < n; ++i)
        {
            if (fadeLeft == 0)
            {
                if (fadingIn)
                {
                    l[i] = outL[i];
                    r[i] = outR[i];
                }
                // faded out: the dry sample stays as it is
                continue;
            }
            --fadeLeft;
            const float done = (float) (fadeSamples - fadeLeft) / (float) fadeSamples;
            const float wet = fadingIn ? done : 1.0f - done;
            l[i] = l[i] + (outL[i] - l[i]) * wet;
            r[i] = r[i] + (outR[i] - r[i]) * wet;
        }
        if (fadeLeft == 0 && ! fadingIn)
            engaged = false; // fully dry: the next off block returns at once
    }

    MasterStage::MasterStage() = default;

    MasterStage::~MasterStage()
    {
        delete pending.exchange(nullptr);
        delete retired.exchange(nullptr);
        delete current.exchange(nullptr);
    }

    void MasterStage::prepare(double sampleRate)
    {
        if (sampleRate <= 0.0 || sampleRate == builtRate) return;
        builtRate = sampleRate;
        // Replaces anything still pending: the audio thread only ever takes `pending` by an
        // exchange, so whatever this gets back was never seen by it.
        delete pending.exchange(new Instance(sampleRate), std::memory_order_acq_rel);
    }

    void MasterStage::drainRetired()
    {
        auto* old = retired.load(std::memory_order_acquire);
        if (old == nullptr) return;
        delete old;
        // Only after the delete: the audio thread treats an occupied cell as "defer", so it
        // never parks a second instance here while this one is being destroyed.
        retired.store(nullptr, std::memory_order_release);
    }

    void MasterStage::reset()
    {
        sounded = false;
        if (auto* inst = current.load(std::memory_order_acquire))
            inst->reset();
    }

    void MasterStage::clearDynamics()
    {
        if (auto* inst = current.load(std::memory_order_acquire))
            inst->clearDynamics();
    }

    int MasterStage::currentLatencySamples() const
    {
        const auto* inst = current.load(std::memory_order_acquire);
        return inst != nullptr && inst->engaged ? kLatencySamples : 0;
    }

    void MasterStage::process(const SoundSettings::Mastering* mastering, double sampleRate, int numSamples, float* l, float* r)
    {
        if (mastering == nullptr)
        {
            process(static_cast<const Settings*>(nullptr), sampleRate, numSamples, l, r);
            return;
        }
        const Settings settings { *mastering, std::nullopt, std::nullopt };
        process(&settings, sampleRate, numSamples, l, r);
    }

    void MasterStage::process(const Settings* settings, double sampleRate, int numSamples, float* l, float* r)
    {
        // Promote a newly prepared instance (a rate change), unless the last one swapped out has
        // not been collected yet -- then it waits, and this block runs on what is here.
        if (retired.load(std::memory_order_acquire) == nullptr)
        {
            if (auto* next = pending.exchange(nullptr, std::memory_order_acq_rel))
            {
                if (auto* previous = current.exchange(next, std::memory_order_acq_rel))
                    retired.store(previous, std::memory_order_release);
            }
        }

        // Whether anything has gone through since construction or reset(), this block not
        // counted: an engage then crossfades in rather than cutting. Set on every call, off ones
        // included -- a flag, not a sample.
        const bool hadSounded = sounded;
        sounded = true;

        auto* inst = current.load(std::memory_order_acquire);
        if (settings == nullptr && (inst == nullptr || ! inst->engaged))
            return;
        if (inst == nullptr || inst->sampleRate != sampleRate)
        {
            // No instance at this rate yet (the message thread prepares one on a device start
            // and before an export). Passing through beats both silence and allocating here.
            rateMismatches.fetch_add(1, std::memory_order_relaxed);
            return;
        }
        inst->process(settings, hadSounded, numSamples, l, r);
    }
}

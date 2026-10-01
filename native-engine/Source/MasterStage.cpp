// native-engine/Source/MasterStage.cpp
#include "MasterStage.h"
#include <juce_core/juce_core.h>
#include <cmath>
#include <cstring>

namespace sssketch
{
    MasterStage::Instance::Instance(double rate)
        : sampleRate(rate), fadeSamples(juce::jmax(1, (int) std::lround(kFadeSec * rate)))
    {
        limiter.prepare(rate, kChunk);
        jassert(limiter.numInputs() == 2 && limiter.numOutputs() == 2);
        jassert(limiter.latencySamples() == kLatencySamples);
        for (auto& s : scratch)
            s.assign((size_t) kChunk, 0.0f);
    }

    void MasterStage::Instance::reset()
    {
        limiter.reset();
        engaged = false;
        seeded = false;
        fadeLeft = 0;
        gainRampLeft = 0;
    }

    void MasterStage::Instance::process(const SoundSettings::Mastering* settings, int numSamples, float* l, float* r)
    {
        if (settings != nullptr)
        {
            const float target = (float) std::pow(10.0, settings->headroomDb / 20.0);
            if (! engaged)
            {
                engaged = true;
                fadingIn = true;
                gain = gainTarget = target;
                gainRampLeft = 0;
                if (seeded)
                {
                    // Switched on while sounding: start the limiter clean (its line holds
                    // whatever it last saw, possibly long ago) and fade it in.
                    limiter.reset();
                    fadingIn = true;
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
        }
        else
        {
            if (! engaged) return; // off is today: not a sample touched
            if (fadingIn)
            {
                // Switched off: keep limiting on the last settings while fading to the dry
                // signal -- the whole fade from steady, or back from where a fade-in had got to.
                fadeLeft = fadeSamples - fadeLeft;
                fadingIn = false;
                if (fadeLeft == 0)
                {
                    engaged = false;
                    return;
                }
            }
        }
        seeded = true;

        for (int done = 0; done < numSamples && engaged;)
        {
            const int n = juce::jmin(kChunk, numSamples - done);
            processChunk(held, n, l + done, r + done);
            done += n;
        }
    }

    void MasterStage::Instance::processChunk(const SoundSettings::Mastering& m, int n, float* l, float* r)
    {
        const auto ceiling = (float) m.ceilingDb;
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

        // the headroom trim, ramping (sample by sample, so block-size invariant) to a new value
        for (int i = 0; i < n; ++i)
        {
            if (gainRampLeft > 0)
            {
                gain = --gainRampLeft == 0 ? gainTarget : gain + gainStep;
            }
            inL[i] = l[i] * gain;
            inR[i] = r[i] * gain;
        }

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
        if (auto* inst = current.load(std::memory_order_acquire))
            inst->reset();
    }

    void MasterStage::process(const SoundSettings::Mastering* settings, double sampleRate, int numSamples, float* l, float* r)
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
        inst->process(settings, numSamples, l, r);
    }
}

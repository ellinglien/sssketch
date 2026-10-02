// native-engine/Source/DrumPump.cpp
//
// Compiled -ffp-contract=off (CMakeLists.txt): `out += in * g` must round the product to float
// before the add, as pump.dsp's generated code (input * fTemp10, then the caller's sum) does.
// An FMA here would move the pumped signal off the .dsp's by an ulp on some machines.
#include "DrumPump.h"
#include <algorithm>

namespace sssketch
{
    DrumPump::Instance::Instance(double rate) : sampleRate(rate)
    {
        pump.prepare(rate, kChunk);
        pump.setParam("/pump/release", kReleaseSec);
        ones.fill(1.0f);
    }

    DrumPump::DrumPump() = default;

    DrumPump::~DrumPump()
    {
        delete pending.exchange(nullptr);
        delete retired.exchange(nullptr);
        delete current.exchange(nullptr);
    }

    void DrumPump::prepare(double sampleRate)
    {
        if (sampleRate <= 0.0 || sampleRate == builtRate) return;
        builtRate = sampleRate;
        // Replaces anything still pending: the audio thread only takes `pending` by an exchange,
        // so whatever comes back here was never seen by it.
        delete pending.exchange(new Instance(sampleRate), std::memory_order_acq_rel);
    }

    void DrumPump::drainRetired()
    {
        auto* old = retired.load(std::memory_order_acquire);
        if (old == nullptr) return;
        delete old;
        // Only after the delete: an occupied cell makes the audio thread defer, so it never
        // parks a second instance here while this one is being destroyed.
        retired.store(nullptr, std::memory_order_release);
    }

    void DrumPump::promotePending()
    {
        if (retired.load(std::memory_order_acquire) != nullptr) return;
        if (auto* next = pending.exchange(nullptr, std::memory_order_acq_rel))
        {
            if (auto* previous = current.exchange(next, std::memory_order_acq_rel))
                retired.store(previous, std::memory_order_release);
            // A new instance is a fresh pump; engaging on it clears nothing it needs.
        }
    }

    void DrumPump::clear()
    {
        if (auto* inst = current.load(std::memory_order_acquire))
            inst->pump.reset();
    }

    float DrumPump::currentDuckDb() const
    {
        const auto* inst = current.load(std::memory_order_acquire);
        return inst != nullptr ? inst->pump.meter("/pump/duck").value_or(0.0f) : 0.0f;
    }

    void DrumPump::process(double sampleRate, double depthDb, int numSamples, const float* keyL, const float* keyR,
                           const Target* targets, size_t numTargets)
    {
        promotePending();
        auto* inst = current.load(std::memory_order_acquire);
        if (inst == nullptr || inst->sampleRate != sampleRate)
        {
            // No instance at this rate yet (prepareMaster builds one before a device start or an
            // export). Unducked beats both silence and allocating here.
            rateMismatches.fetch_add(1, std::memory_order_relaxed);
            engaged = false;
            for (size_t t = 0; t < numTargets; ++t)
            {
                const auto& target = targets[t];
                for (int i = 0; i < numSamples; ++i)
                {
                    target.outL[i] += target.inL[i];
                    target.outR[i] += target.inR[i];
                }
            }
            return;
        }

        if (! engaged)
        {
            // Engaging after a block without the pump (switched on, or the first block of a
            // play): start from a cleared envelope, as a fresh pump would.
            inst->pump.reset();
            engaged = true;
        }
        const auto depth = (float) depthDb;
        if (depth != inst->depthSet)
        {
            // Set at the block's start. The depth scales the duck BEFORE its 3 ms / 200 ms
            // follower (pump.dsp's duckDb), so a change glides rather than steps.
            inst->pump.setParam("/pump/depth", depth);
            inst->depthSet = depth;
        }

        for (int done = 0; done < numSamples;)
        {
            const int n = std::min(kChunk, numSamples - done);
            const float* in[4] = { inst->ones.data(), inst->ones.data(), keyL + done, keyR + done };
            float* out[2] = { inst->gainL.data(), inst->gainR.data() };
            inst->pump.process(in, 4, out, n);
            const float* gL = inst->gainL.data();
            const float* gR = inst->gainR.data();
            for (size_t t = 0; t < numTargets; ++t)
            {
                const auto& target = targets[t];
                const float* inL = target.inL + done;
                const float* inR = target.inR + done;
                float* outL = target.outL + done;
                float* outR = target.outR + done;
                for (int i = 0; i < n; ++i)
                {
                    outL[i] += inL[i] * gL[i];
                    outR[i] += inR[i] * gR[i];
                }
            }
            done += n;
        }
    }
}

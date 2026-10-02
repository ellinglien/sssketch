// native-engine/Source/DubDelay.cpp -- compiled with -ffp-contract=off (CMakeLists.txt), like
// MasterTone.cpp: the line's interpolation and the feedback are the web's float arithmetic, and
// no FMA may change a bit between machines.
#include "DubDelay.h"
#include <algorithm>
#include <cmath>
#include <optional>

namespace sssketch
{
    double dubClampDelaySec(double delaySec, double sampleRate)
    {
        const double d = std::isfinite(delaySec) ? delaySec : 0.5;
        const double minimum = sampleRate > 0.0 ? 1.0 / sampleRate : 0.0;
        return std::min(kDubMaxDelaySec, std::max(minimum, d));
    }

    double dubDelaySecFor(double delayBeats, double bpm, double sampleRate)
    {
        const double d = (std::isfinite(delayBeats) && delayBeats > 0.0 && std::isfinite(bpm) && bpm > 0.0)
            ? delayBeats * (60.0 / bpm) // throwDelaySec's order of operations
            : 0.5;
        return dubClampDelaySec(d, sampleRate);
    }

    float dubFeedbackFor(double feedback)
    {
        if (! std::isfinite(feedback)) return 0.0f;
        const double web = std::min(kDubMaxFeedback, std::max(0.0, feedback));
        return (float) std::min(kDubStableFeedback, web);
    }

    DubDelayCore::DubDelayCore(double sampleRate) : rate(sampleRate > 0.0 ? sampleRate : 44100.0)
    {
        // Chromium's DelayNode buffer for a maxDelayTime of 2 s: one frame, 2 s rounded up and a
        // render quantum (AudioDelayDSPKernel::BufferLengthForDelay). Its length matters, not
        // just its room: the read position is worked out in float from the write index into it
        // (processSample).
        lineLength = 1 + (int) std::ceil(kDubMaxDelaySec * rate) + kDubWebQuantum;
        lineL.assign((size_t) lineLength, 0.0f);
        lineR.assign((size_t) lineLength, 0.0f);
        for (auto* f : { &hpL, &hpR })
            f->setHighpass(rate, kDubHighpassHz, kDubFilterQDb);
        for (auto* f : { &lpL, &lpR })
            f->setLowpass(rate, kDubLowpassHz, kDubFilterQDb);
        set(0.375, 0.0); // dubDelay.ts builds its delays at 0.375 s, its feedback gains at 0
    }

    void DubDelayCore::set(double delaySec, double feedback)
    {
        // The AudioParam holds a float; the delay in frames is that times the rate, as a float
        // (the product of two floats, rounded once). At least two frames, so a read never
        // reaches the sample being written (the web's clamp is one frame; a throw's echo is a
        // tenth of a second at the very least).
        delayParam = (float) dubClampDelaySec(delaySec, rate);
        fbGain = dubFeedbackFor(feedback);
        delayFrames = std::max(2.0f, (float) ((double) delayParam * rate));
        ring = computeRingSamples();
    }

    void DubDelayCore::clear()
    {
        std::fill(lineL.begin(), lineL.end(), 0.0f);
        std::fill(lineR.begin(), lineR.end(), 0.0f);
        heldL.fill(0.0f);
        heldIndex = 0;
        writeIndex = 0;
        for (auto* f : { &hpL, &lpL, &hpR, &lpR })
            f->reset();
    }

    void DubDelayCore::processSample(float inL, float inR, float& outL, float& outR)
    {
        // Chromium's DelayNode read, as Chrome runs it (measured against its output: the
        // golden): the read position is the write index plus the buffer's length, less the
        // delay in frames, IN FLOAT -- so its fractional part is quantised to the float spacing
        // at that magnitude (1/128 to 1/64 of a frame at 44.1-48 kHz), and it moves with the
        // write index. Then linear interpolation, out = s1 + f (s2 - s1), in float.
        // Read before write: the delay is at least two frames (set()).
        float position = (float) (writeIndex + lineLength) - delayFrames;
        if (position >= (float) lineLength)
            position -= (float) lineLength;
        const int i1 = (int) position;
        const float frac = position - (float) i1;
        const int i2 = i1 + 1 == lineLength ? 0 : i1 + 1;
        const float l1 = lineL[(size_t) i1], l2 = lineL[(size_t) i2];
        const float r1 = lineR[(size_t) i1], r2 = lineR[(size_t) i2];
        const float dL = l1 + frac * (l2 - l1);
        const float dR = r1 + frac * (r2 - r1);
        outL = dL;
        outR = dR;
        // The left output enters its feedback path one render quantum late (kDubWebQuantum).
        const float stale = heldL[(size_t) heldIndex];
        heldL[(size_t) heldIndex] = dL;
        heldIndex = (heldIndex + 1) & (kDubWebQuantum - 1);
        const float fbL = lpL.process(hpL.process(stale)) * fbGain;
        const float fbR = lpR.process(hpR.process(dR)) * fbGain;
        lineL[(size_t) writeIndex] = inL + fbR;
        lineR[(size_t) writeIndex] = inR + fbL;
        if (++writeIndex == lineLength) writeIndex = 0;
    }

    void DubDelayCore::process(int numSamples, const float* inL, const float* inR, float* outL, float* outR)
    {
        for (int i = 0; i < numSamples; ++i)
            processSample(inL[i], inR[i], outL[i], outR[i]);
    }

    int DubDelayCore::computeRingSamples() const
    {
        const double frames = std::ceil((double) delayFrames);
        const double loopGain = (double) fbGain * kDubLoopPeakGain;
        double passes = 0.0;
        if (loopGain > 0.0)
            passes = std::ceil(std::log(kDubSilence) / std::log(std::min(loopGain, 0.999)));
        const double samples = (passes + 1.0) * frames + (std::floor(passes / 2.0) + 1.0) * kDubWebQuantum
            + 0.05 * rate;
        return (int) std::min(samples, 2.0e9);
    }

    // ---- the bus ----

    namespace
    {
        /** A curve read at rising bars, sample after sample: the same values as
         * evaluateAutomation (hold before the first point and after the last, linear between,
         * a duplicate bar steps to the later point), without its scan from the start each
         * sample. */
        struct CurveCursor
        {
            const std::vector<AutomationPoint>& points;
            size_t i = 1;

            float at(double bar)
            {
                if (! std::isfinite(bar)) return 0.0f;
                if (bar <= points.front().bar) return (float) points.front().value;
                if (bar >= points.back().bar) return (float) points.back().value;
                while (i < points.size() && bar >= points[i].bar)
                    ++i;
                const auto& a = points[i - 1];
                const auto& b = points[i];
                const double span = b.bar - a.bar;
                if (span <= 0.0) return (float) b.value;
                const double t = (bar - a.bar) / span;
                return (float) (a.value + (b.value - a.value) * t);
            }
        };

        /** Whether a curve is exactly 0 everywhere in [a, b]. */
        bool silentOver(const std::vector<AutomationPoint>& points, double a, double b)
        {
            if (evaluateAutomation(points, a, 0.0) != 0.0 || evaluateAutomation(points, b, 0.0) != 0.0)
                return false;
            for (const auto& p : points)
                if (p.bar > a && p.bar < b && p.value != 0.0)
                    return false;
            return true;
        }
    }

    DubDelayBus::~DubDelayBus()
    {
        delete pending.exchange(nullptr);
        delete retired.exchange(nullptr);
        delete current.exchange(nullptr);
    }

    void DubDelayBus::prepare(double sampleRate)
    {
        if (! (sampleRate > 0.0) || sampleRate == builtRate)
            return;
        builtRate = sampleRate;
        // Replaces anything still pending: the audio thread only takes `pending` by an exchange.
        delete pending.exchange(new DubDelayCore(sampleRate), std::memory_order_acq_rel);
    }

    void DubDelayBus::drainRetired()
    {
        auto* old = retired.load(std::memory_order_acquire);
        if (old == nullptr)
            return;
        delete old;
        retired.store(nullptr, std::memory_order_release); // after the delete: "occupied" defers
    }

    double DubDelayBus::liveRate() const
    {
        const auto* core = current.load(std::memory_order_acquire);
        return core != nullptr ? core->sampleRate() : 0.0;
    }

    float DubDelayBus::currentDelaySec() const
    {
        const auto* core = current.load(std::memory_order_acquire);
        return core != nullptr ? core->delaySec() : 0.0f;
    }

    float DubDelayBus::currentFeedback() const
    {
        const auto* core = current.load(std::memory_order_acquire);
        return core != nullptr ? core->feedback() : 0.0f;
    }

    void DubDelayBus::promotePending()
    {
        if (retired.load(std::memory_order_acquire) != nullptr)
            return; // the last one swapped out has not been collected: run on what is here
        if (auto* next = pending.exchange(nullptr, std::memory_order_acq_rel))
        {
            if (auto* previous = current.exchange(next, std::memory_order_acq_rel))
                retired.store(previous, std::memory_order_release);
            ringRemaining = 0; // the new one starts silent
            dropRequested = false;
        }
    }

    namespace
    {
        /** The block's first sample, as a whole sample count; nullopt if out of range. */
        std::optional<long long> firstSample(double positionBars, double secPerBar, double sampleRate)
        {
            if (! (sampleRate > 0.0) || ! (secPerBar > 0.0) || ! std::isfinite(positionBars))
                return std::nullopt;
            const double startSample = std::round(positionBars * secPerBar * sampleRate);
            if (! (std::abs(startSample) < 9.0e15))
                return std::nullopt;
            return (long long) startSample;
        }

        /** A stem's send gain over a block, sample by sample: its curve (0 where it is empty),
         * or, while `slewing`, a linear slew from `gain` toward it at `step` a sample, which ends
         * -- exactly on the curve -- once the curve is within a step. `sink(i, g)` gets each
         * sample's gain; a curve that is 0 over the whole block with no slew calls nothing.
         * Updates `gain` and `slewing` to the block's end. The ONE place the gains are worked
         * out: markOpen and addSendCurve both run it, from the same starting state. */
        template <typename Sink>
        void sendGains(const std::vector<AutomationPoint>& curve, double originBar, long long k0, int numSamples,
                       double sampleRate, double secPerBar, float step, float& gain, bool& slewing, Sink&& sink)
        {
            const auto barOf = [&](int i) { return (((double) (k0 + i) / sampleRate) / secPerBar) - originBar; };
            if (! slewing && (curve.empty() || silentOver(curve, barOf(0), barOf(numSamples - 1))))
            {
                gain = 0.0f;
                return;
            }
            if (! slewing)
            {
                CurveCursor cursor { curve };
                for (int i = 0; i < numSamples; ++i)
                    sink(i, gain = cursor.at(barOf(i)));
                return;
            }
            std::optional<CurveCursor> cursor;
            if (! curve.empty())
                cursor.emplace(CurveCursor { curve });
            for (int i = 0; i < numSamples; ++i)
            {
                const float target = cursor ? cursor->at(barOf(i)) : 0.0f;
                if (slewing)
                {
                    const float d = target - gain;
                    if (std::abs(d) <= step)
                    {
                        gain = target;
                        slewing = false;
                    }
                    else
                        gain += d > 0.0f ? step : -step;
                }
                else
                    gain = target;
                sink(i, gain);
            }
        }
    }

    void DubDelayBus::forgetSends()
    {
        for (auto& slot : sendSlots)
            slot = SendSlot {};
        fresh = true;
        holdsGain = false;
        gainsSettled.store(true, std::memory_order_relaxed);
    }

    void DubDelayBus::beginBlock(int numSamples, double positionBars, double secPerBar, double sampleRate,
                                 unsigned long long generation)
    {
        fed = false;
        if (numSamples <= 0)
            return;
        const auto n = (size_t) numSamples;
        if (inL.size() < n)
        {
            inL.resize(n);
            inR.resize(n);
            wetL.resize(n);
            wetR.resize(n);
            open.resize(n);
        }
        std::fill(inL.begin(), inL.begin() + (long) n, 0.0f);
        std::fill(inR.begin(), inR.begin() + (long) n, 0.0f);
        std::fill(open.begin(), open.begin() + (long) n, (unsigned char) 0);

        const auto k0 = firstSample(positionBars, secPerBar, sampleRate);
        blockBreaks = ! fresh && (generation != lastGeneration || ! k0 || *k0 != nextK0);
        fresh = false;
        lastGeneration = generation;
        nextK0 = k0 ? *k0 + numSamples : 0;
        slewStep = sampleRate > 0.0 ? (float) (1.0 / (kSendSlewSec * sampleRate)) : 1.0f;
        for (auto& slot : sendSlots)
            slot.seen = false;
    }

    int DubDelayBus::markOpen(unsigned long long id, int numSamples, const std::vector<AutomationPoint>& curve,
                              double originBar, double positionBars, double secPerBar, double sampleRate)
    {
        if (numSamples <= 0 || open.size() < (size_t) numSamples)
            return -1;
        const auto k0 = firstSample(positionBars, secPerBar, sampleRate);
        if (! k0)
            return -1;
        const auto barOf = [&](int i) { return (((double) (*k0 + i) / sampleRate) / secPerBar) - originBar; };
        const auto targetAt = [&](int i) { return curve.empty() ? 0.0f : (float) evaluateAutomation(curve, barOf(i), 0.0); };

        int index = -1;
        for (int k = 0; k < kMaxSendSlots && index < 0; ++k)
            if (sendSlots[(size_t) k].used && sendSlots[(size_t) k].id == id)
                index = k;
        if (index < 0)
        {
            for (int k = 0; k < kMaxSendSlots && index < 0; ++k)
                if (! sendSlots[(size_t) k].used)
                    index = k;
            if (index >= 0)
            {
                // A stem new to the bus: after a break it was not sending before it (0); otherwise
                // (a fresh play, an export) it starts on its curve.
                auto& added = sendSlots[(size_t) index];
                added = SendSlot {};
                added.used = true;
                added.id = id;
                added.gain = blockBreaks ? 0.0f : targetAt(0);
            }
        }

        const auto mark = [&](int i, float g) {
            if (g > 0.0f)
                open[(size_t) i] = 1;
        };
        if (index < 0)
        {
            // Every slot in use: no slew for this stem, its curve as is.
            float gain = 0.0f;
            bool slewing = false;
            sendGains(curve, originBar, *k0, numSamples, sampleRate, secPerBar, slewStep, gain, slewing, mark);
            return -1;
        }

        auto& slot = sendSlots[(size_t) index];
        slot.seen = true;
        // A break: slew if the gain would otherwise step by more than a 5 ms ramp's worth (a
        // little over a step, so a curve's own ramp across the break never engages it).
        if (blockBreaks && ! slot.slewing && std::abs(targetAt(0) - slot.gain) > slewStep * 1.05f)
            slot.slewing = true;
        slot.startGain = slot.gain;
        slot.startSlewing = slot.slewing;
        sendGains(curve, originBar, *k0, numSamples, sampleRate, secPerBar, slewStep, slot.gain, slot.slewing, mark);
        return index;
    }

    void DubDelayBus::addSendCurve(int slotIndex, int numSamples, const float* left, const float* right,
                                   const std::vector<AutomationPoint>& curve, double originBar,
                                   double positionBars, double secPerBar, double sampleRate)
    {
        if (numSamples <= 0 || left == nullptr || right == nullptr || inL.size() < (size_t) numSamples)
            return;
        const auto k0 = firstSample(positionBars, secPerBar, sampleRate);
        if (! k0)
            return;
        float gain = 0.0f;
        bool slewing = false;
        if (slotIndex >= 0 && slotIndex < kMaxSendSlots)
        {
            gain = sendSlots[(size_t) slotIndex].startGain;
            slewing = sendSlots[(size_t) slotIndex].startSlewing;
        }
        sendGains(curve, originBar, *k0, numSamples, sampleRate, secPerBar, slewStep, gain, slewing, [&](int i, float g) {
            if (g <= 0.0f)
                return; // adds +0.0f: nothing (a send of 0 is no send)
            inL[(size_t) i] += left[i] * g;
            inR[(size_t) i] += right[i] * g;
            fed = true;
        });
    }

    void DubDelayBus::process(double sampleRate, const std::optional<SoundSettings::Dub>& wanted, double bpm,
                              int numSamples)
    {
        if (numSamples <= 0 || wetL.size() < (size_t) numSamples)
            return;
        std::fill(wetL.begin(), wetL.begin() + numSamples, 0.0f);
        std::fill(wetR.begin(), wetR.begin() + numSamples, 0.0f);

        // Stems no longer in the project are forgotten (their audio has gone with them); what
        // is left either holds a gain or has settled at 0.
        holdsGain = false;
        for (auto& slot : sendSlots)
        {
            if (slot.used && ! slot.seen)
                slot = SendSlot {};
            holdsGain = holdsGain || (slot.used && (slot.gain != 0.0f || slot.slewing));
        }
        gainsSettled.store(! holdsGain, std::memory_order_relaxed);

        promotePending();
        auto* core = current.load(std::memory_order_acquire);
        if (core == nullptr || core->sampleRate() != sampleRate)
        {
            // No core at this rate: no echo this block (silence beats allocating here); the
            // message thread is asked for one. The tail, if any, is lost with the block.
            rateMismatches.fetch_add(1, std::memory_order_relaxed);
            wantedRate.store(sampleRate);
            ringRemaining = 0;
            dropRequested = true;
            wasOpen = numSamples > 0 && open[(size_t) numSamples - 1] != 0;
            return;
        }
        if (dropRequested)
        {
            core->clear();
            ringRemaining = 0;
            dropRequested = false;
        }

        // The settings the project wants, as the web's AudioParams would hold them.
        bool haveWanted = false;
        double wantDelay = 0.0, wantFeedback = 0.0;
        if (wanted)
        {
            haveWanted = true;
            wantDelay = dubDelaySecFor(wanted->delayBeats, bpm, sampleRate);
            wantFeedback = wanted->feedback;
        }
        const auto take = [&]() {
            if (haveWanted
                && ((float) wantDelay != core->delaySec() || dubFeedbackFor(wantFeedback) != core->feedback()))
            {
                core->set(wantDelay, wantFeedback);
                // Taken under a ringing tail (a throw's start): the tail now runs at the new
                // settings, so it may need longer to fall silent.
                if (ringRemaining > 0)
                    ringRemaining = std::max(ringRemaining, core->ringSamples());
            }
        };

        // Silent: a change is taken at once (nothing rings, so when cannot matter).
        if (ringRemaining <= 0)
        {
            take();
            if (! fed)
            {
                // Idle, and nothing comes in: exactly what running it would give (zeros).
                wasOpen = open[(size_t) numSamples - 1] != 0;
                return;
            }
        }

        for (int i = 0; i < numSamples; ++i)
        {
            const bool isOpen = open[(size_t) i] != 0;
            // Silent (the last tail may have run out mid-block): a change is taken at once, at
            // this sample -- not at the next block's top, which would hang it on the host's split.
            // Ringing: only as a throw starts, the web's set() at the throw's start.
            if (ringRemaining <= 0 || (isOpen && ! wasOpen))
                take();
            wasOpen = isOpen;
            const float xl = inL[(size_t) i], xr = inR[(size_t) i];
            const bool sounding = xl != 0.0f || xr != 0.0f;
            // Silent and fed nothing: the output is 0 (wetL/wetR were cleared) and the core is
            // not stepped, so it starts at its first non-zero input sample from a cleared state
            // -- its write index, which the read's float rounding depends on (processSample),
            // at 0 -- wherever the host's blocks begin.
            if (ringRemaining <= 0 && ! sounding)
                continue;
            core->processSample(xl, xr, wetL[(size_t) i], wetR[(size_t) i]);
            if (sounding)
                ringRemaining = core->ringSamples();
            else if (--ringRemaining == 0)
                core->clear(); // everything left is below -140 dB: silence, exactly
        }
    }
}

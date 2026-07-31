// native-engine/Source/Transport.cpp
#include "Transport.h"
#include "LoopBoundaryFade.h"
#include <algorithm>
#include <cmath>

namespace ssstitch
{
    namespace
    {
        // Matches FadeGain.cpp's own kMicroFadeSec: short enough to be
        // inaudible as an intentional fade, just enough to remove the
        // discontinuity a hard position jump would otherwise produce.
        constexpr double kLoopSeamFadeSec = 0.003;

        // Longer than the loop-seam declick above on purpose — this is a
        // deliberate, audible pause/stop rather than an invisible
        // discontinuity fix, so it can afford to be a little more generous
        // while still reading as instant. Linear, matching FadeGain.cpp's
        // own fade-out shape (a single fade-to-silence, not a two-signal
        // blend, has none of the equal-power "avoid a loudness dip" concern
        // LoopSewing.cpp and the loop-seam blend below both have).
        constexpr double kHaltFadeSec = 0.015;
    }

    Transport::Transport(PlaybackEngine& e) : engine(e) {}
    Transport::~Transport() { closeDevice(); }

    bool Transport::openDefaultDevice()
    {
        auto error = deviceManager.initialiseWithDefaultDevices(0, 2);
        if (error.isNotEmpty())
        {
            juce::Logger::writeToLog("Transport: failed to open audio device: " + error);
            return false;
        }
        deviceManager.addAudioCallback(this);
        return true;
    }

    void Transport::closeDevice()
    {
        deviceManager.removeAudioCallback(this);
        deviceManager.closeAudioDevice();
    }

    void Transport::play(double fromPositionBars)
    {
        positionBars.store(fromPositionBars);
        playing.store(true);
    }

    void Transport::pause() { pendingHalt.store(HaltKind::Pause); }

    void Transport::stop() { pendingHalt.store(HaltKind::Stop); }

    void Transport::setPosition(double bars) { positionBars.store(bars); }

    void Transport::audioDeviceIOCallbackWithContext(
        const float* const* /*inputChannelData*/, int /*numInputChannels*/,
        float* const* outputChannelData, int numOutputChannels,
        int numSamples, const juce::AudioIODeviceCallbackContext&)
    {
        if (numOutputChannels < 2 || outputChannelData[0] == nullptr || outputChannelData[1] == nullptr)
            return;

        auto* outL = outputChannelData[0];
        auto* outR = outputChannelData[1];
        juce::FloatVectorOperations::clear(outL, numSamples);
        juce::FloatVectorOperations::clear(outR, numSamples);

        if (playing.load())
        {
            // An explicit Play always wins over any pause/stop fade still
            // winding down from a rapid halt-then-play — abrupt, but this is
            // a rare edge case, and resuming instantly matters more here
            // than finishing a fade nobody asked to hear the tail of.
            fadingOut = false;
        }
        else
        {
            const HaltKind requested = pendingHalt.exchange(HaltKind::None);
            if (requested != HaltKind::None && !fadingOut)
            {
                fadingOut = true;
                activeHaltKind = requested;
                haltFadeElapsedSec = 0.0;
            }
        }

        if (!playing.load() && !fadingOut)
            return; // fully halted, no fade in progress -- true silence

        if (secPerBar <= 0.0)
            return;

        const double pos = positionBars.load();
        const double loopBars = loopLengthBars.load();
        const double barsPerSample = (1.0 / deviceSampleRate) / secPerBar;
        const double blockDurationBars = numSamples * barsPerSample;

        if (loopBars <= 0.0)
        {
            engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR);
        }
        else
        {
            // pos is always kept within [0, loopBars) by this function's own
            // wrap below, so distToEnd is always positive here.
            const double distToEnd = loopBars - pos;
            if (distToEnd >= blockDurationBars)
            {
                // No wrap within this block.
                engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR);
            }
            else
            {
                // The wrap falls partway through this block -- render each
                // side from its own correct (and, for the incoming side,
                // correctly wrapped-to-0) position rather than letting a
                // single render run unclamped past the loop's own end, which
                // would just find nothing placed there and render silence
                // for what should be the start of the next lap.
                const int splitIndex =
                    std::clamp((int) std::lround(distToEnd / barsPerSample), 0, numSamples);
                if (splitIndex > 0)
                    engine.renderBlock(pos, deviceSampleRate, splitIndex, outL, outR);
                if (splitIndex < numSamples)
                    engine.renderBlock(0.0, deviceSampleRate, numSamples - splitIndex,
                                        outL + splitIndex, outR + splitIndex);
            }

            // Declicks the seam by pulling the outgoing lap's last `fadeBars`
            // toward the incoming lap's own first sample VALUE (not toward
            // silence — see LoopBoundaryFade.h for why) — a fixed anchor,
            // same scheme LoopSewing.cpp already uses for a single stem
            // buffer's own tail-toward-head blend, just applied here to the
            // whole mixed master output instead.
            const double fadeBars = std::min(kLoopSeamFadeSec / secPerBar, loopBars / 2.0);
            if (distToEnd < fadeBars + blockDurationBars)
            {
                float anchorL = 0.0f, anchorR = 0.0f;
                engine.renderBlock(0.0, deviceSampleRate, 1, &anchorL, &anchorR);
                for (int i = 0; i < numSamples; ++i)
                {
                    const double samplePos = pos + (double) i * barsPerSample;
                    if (samplePos >= loopBars)
                        break; // only the outgoing tail gets pulled toward the anchor
                    const double distFromEnd = loopBars - samplePos;
                    const float coeff = loopSeamBlendCoeff(distFromEnd, fadeBars);
                    if (coeff <= 0.0f)
                        continue;
                    outL[i] = outL[i] + (anchorL - outL[i]) * coeff;
                    outR[i] = outR[i] + (anchorR - outR[i]) * coeff;
                }
            }
        }

        if (fadingOut)
        {
            for (int i = 0; i < numSamples; ++i)
            {
                const double elapsed = haltFadeElapsedSec + (double) i / deviceSampleRate;
                const float gain = (float) std::clamp(1.0 - elapsed / kHaltFadeSec, 0.0, 1.0);
                outL[i] *= gain;
                outR[i] *= gain;
            }
            haltFadeElapsedSec += (double) numSamples / deviceSampleRate;
        }

        double newPos = pos + blockDurationBars;
        if (loopBars > 0.0)
            newPos = std::fmod(newPos, loopBars);

        if (fadingOut && haltFadeElapsedSec >= kHaltFadeSec)
        {
            fadingOut = false;
            playing.store(false);
            // Pause preserves wherever playback had reached by the time the
            // fade finished; Stop resets to the top, matching each one's
            // existing pre-fade behavior.
            positionBars.store(activeHaltKind == HaltKind::Stop ? 0.0 : newPos);
            return;
        }

        positionBars.store(newPos);
    }

    void Transport::audioDeviceAboutToStart(juce::AudioIODevice* device)
    {
        deviceSampleRate = device->getCurrentSampleRate();
    }

    void Transport::audioDeviceStopped() {}
}

// native-engine/Source/Transport.cpp
#include "Transport.h"
#include "LoopBoundaryFade.h"
#include <algorithm>
#include <cmath>

namespace sssketch
{
    namespace
    {
        // Matches FadeGain.cpp's own kMicroFadeSec: short enough to be
        // inaudible as an intentional fade, just enough to remove the
        // discontinuity a hard position jump would otherwise produce.
        constexpr double kLoopSeamFadeSec = 0.003;

        // Longer than the loop-seam declick above on purpose — these are
        // deliberate, audible transitions rather than invisible
        // discontinuity fixes, so they can afford to be a little more
        // generous while still reading as instant. Linear, matching
        // FadeGain.cpp's own fade shape (a single fade, not a two-signal
        // blend, has none of the equal-power "avoid a loudness dip" concern
        // LoopSewing.cpp and the loop-seam blend below both have).
        constexpr double kHaltFadeSec = 0.015;
        constexpr double kRepositionFadeSec = 0.012;
    }

    Transport::Transport(PlaybackEngine& e, PluginChain& mc, ChannelChainRegistry& cc)
        : engine(e), masterChain(mc), channelChains(cc) {}
    Transport::~Transport() { closeDevice(); }

    bool Transport::openDefaultDevice()
    {
        // Requests 1 input channel now (was 0) -- harmless when nothing is
        // ever armed (the extra channel just goes unread, same cost as
        // before this feature existed), and means an input device is
        // already open and ready the moment arm-recording actually needs
        // one, rather than requiring a device reopen mid-session (which
        // would glitch/interrupt playback on the output side too, since
        // JUCE reopens the whole device, not just the input half, when
        // input channel count changes on an already-open device).
        auto error = deviceManager.initialiseWithDefaultDevices(1, 2);
        if (error.isNotEmpty())
        {
            juce::Logger::writeToLog("Transport: failed to open audio device: " + error);
            return false;
        }
        deviceManager.addAudioCallback(this);
        return true;
    }

    juce::StringArray Transport::availableInputDeviceNames() const
    {
        auto* type = deviceManager.getCurrentDeviceTypeObject();
        if (type == nullptr) return {};
        // getDeviceNames() alone reads from JUCE's internal cache, populated
        // once by scanForDevices() at device-manager init -- a loopback
        // driver installed/started after the engine launched wouldn't show
        // up without this. Message-thread-only call (list-input-devices),
        // and cheap enough (a fraction of a millisecond, OS device
        // enumeration) to redo on every request rather than trying to cache
        // + invalidate it ourselves.
        type->scanForDevices();
        return type->getDeviceNames(true); // true = input names
    }

    juce::String Transport::setRecordingInputDevice(const juce::String& deviceName)
    {
        auto setup = deviceManager.getAudioDeviceSetup();
        setup.inputDeviceName = deviceName;
        setup.useDefaultInputChannels = false;
        setup.inputChannels = juce::BigInteger();
        setup.inputChannels.setBit(0); // request just channel 0 -- LoopRecorder downmixes whatever it's given, but there's no reason to request more than one channel already
        // Deliberately clearing sampleRate to 0 (not carrying over whatever
        // rate the PREVIOUS setup happened to have, e.g. 44100 from
        // initialiseWithDefaultDevices' own default at startup) -- found
        // during manual testing: recording via a loopback device fed by a
        // 48kHz source produced crackly/glitchy audio, because
        // AudioDeviceManager::chooseBestSampleRate() honors an explicitly
        // requested rate as long as it's SOMETHING the new device's driver
        // technically supports, even when it doesn't match what's actually
        // being fed into it -- forcing the OS/driver into real-time sample-
        // rate conversion on a virtual loopback device, exactly the kind of
        // thing that sounds like this. 0 tells JUCE to auto-choose based on
        // the newly-opened device's own actual native rate instead (see
        // chooseBestSampleRate's fallback to currentAudioDevice->
        // getCurrentSampleRate() when no rate > 0 is requested).
        setup.sampleRate = 0;
        return deviceManager.setAudioDeviceSetup(setup, true);
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
        playRequested.store(true);
    }

    void Transport::pause() { pendingHalt.store(HaltKind::Pause); }

    void Transport::stop() { pendingHalt.store(HaltKind::Stop); }

    void Transport::setPosition(double bars)
    {
        repositionTarget.store(bars);
        repositionRequested.store(true);
    }

    double Transport::renderLoopAware(double pos, int numSamples, float* outL, float* outR) const
    {
        // A recording loop, when active, is a second independent instance
        // of this exact same wrap mechanism (see
        // docs/superpowers/specs/2026-08-03-loop-recording-design.md's
        // "recording loop region" section) -- its own [start, end) bounds
        // take over the wrap window entirely rather than combining with
        // loopLengthBars, since it's always the tighter, nested loop the
        // user is actively jamming/recording within (a short recording
        // loop inside a much longer overall arrangement is the normal
        // case). Pass-boundary detection for LoopRecorder itself stays
        // wired to LoopRecorder::isFull() (accumulated write count, NOT
        // this position wrap -- see the pause-safety comment at this
        // method's own call site above), so this only affects what's
        // audible/visible, never what gets captured.
        const double recStart = recordingLoopStartBar.load();
        const double recEnd = recordingLoopEndBar.load();
        const bool recordingLoopActive = recEnd > recStart;
        const double loopStart = recordingLoopActive ? recStart : 0.0;
        const double loopEnd = recordingLoopActive ? recEnd : loopLengthBars.load();
        const double loopBars = loopEnd - loopStart;
        const double barsPerSample = (1.0 / deviceSampleRate) / secPerBar;
        const double blockDurationBars = numSamples * barsPerSample;

        if (loopBars <= 0.0)
        {
            engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR, channelChains);
            return pos + blockDurationBars;
        }

        // pos is normally kept within [loopStart, loopEnd) by this
        // function's own wrap below -- except right after a loop first
        // becomes active, its bounds change (e.g. the user drags the
        // region while playing), or a manual seek lands outside them.
        // Snap straight to loopStart in that case rather than either
        // playing straight through unwrapped until pos happens to reach
        // loopEnd from below (pos < loopStart), or racing arbitrarily far
        // past loopEnd before the split-index clamp below catches it
        // (pos >= loopEnd) -- both were confusing in practice ("I moved
        // the loop but playback just... didn't," reported during manual
        // testing): a loop that's active should always mean "play from
        // here," immediately, not "eventually get wrapped into once
        // reached."
        if (pos < loopStart || pos >= loopEnd)
            pos = loopStart;

        const double distToEnd = loopEnd - pos;
        if (distToEnd >= blockDurationBars)
        {
            // No wrap within this block.
            engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR, channelChains);
        }
        else
        {
            // The wrap falls partway through this block -- render each side
            // from its own correct (and, for the incoming side, correctly
            // wrapped-to-loopStart) position rather than letting a single
            // render run unclamped past the loop's own end, which would
            // just find nothing placed there and render silence for what
            // should be the start of the next lap.
            const int splitIndex =
                std::clamp((int) std::lround(distToEnd / barsPerSample), 0, numSamples);
            if (splitIndex > 0)
                engine.renderBlock(pos, deviceSampleRate, splitIndex, outL, outR, channelChains);
            if (splitIndex < numSamples)
                engine.renderBlock(loopStart, deviceSampleRate, numSamples - splitIndex,
                                    outL + splitIndex, outR + splitIndex, channelChains);
        }

        // Declicks the seam by pulling the outgoing lap's last `fadeBars`
        // toward the incoming lap's own first sample VALUE (not toward
        // silence — see LoopBoundaryFade.h for why) — a fixed anchor, same
        // scheme LoopSewing.cpp already uses for a single stem buffer's own
        // tail-toward-head blend, just applied here to the whole mixed
        // master output instead.
        const double fadeBars = std::min(kLoopSeamFadeSec / secPerBar, loopBars / 2.0);
        if (distToEnd < fadeBars + blockDurationBars)
        {
            float anchorL = 0.0f, anchorR = 0.0f;
            engine.renderBlock(loopStart, deviceSampleRate, 1, &anchorL, &anchorR, channelChains);
            for (int i = 0; i < numSamples; ++i)
            {
                const double samplePos = pos + (double) i * barsPerSample;
                if (samplePos >= loopEnd)
                    break; // only the outgoing tail gets pulled toward the anchor
                const double distFromEnd = loopEnd - samplePos;
                const float coeff = loopSeamBlendCoeff(distFromEnd, fadeBars);
                if (coeff <= 0.0f)
                    continue;
                outL[i] = outL[i] + (anchorL - outL[i]) * coeff;
                outR[i] = outR[i] + (anchorR - outR[i]) * coeff;
            }
        }

        return loopStart + std::fmod(pos - loopStart + blockDurationBars, loopBars);
    }

    void Transport::audioDeviceIOCallbackWithContext(
        const float* const* inputChannelData, int numInputChannels,
        float* const* outputChannelData, int numOutputChannels,
        int numSamples, const juce::AudioIODeviceCallbackContext&)
    {
        // Cheap, non-blocking pointer check -- must run every callback
        // regardless of playback state so a plugin load requested while
        // paused/stopped is still promoted promptly once ready, not stuck
        // waiting for the next block that actually renders real audio.
        masterChain.applyPendingSwaps();
        channelChains.applyPendingSwaps();

        if (numOutputChannels < 2 || outputChannelData[0] == nullptr || outputChannelData[1] == nullptr)
            return;

        auto* outL = outputChannelData[0];
        auto* outR = outputChannelData[1];
        juce::FloatVectorOperations::clear(outL, numSamples);
        juce::FloatVectorOperations::clear(outR, numSamples);

        // Recording capture: independent of play/pause/halt-fade state
        // below entirely -- you can arm and record while transport
        // playback itself is paused/stopped just as validly as while
        // playing (Frame's own ARM_RECORDING_CHANNEL handler in the
        // renderer starts playback automatically when arming, but nothing
        // here should assume that always holds true, e.g. if the user
        // manually pauses mid-take). recordingLoopEndBar > start is the
        // "is a recording loop active" check throughout.
        //
        // Pass-boundary detection is driven by LoopRecorder's own
        // isFull() (a plain accumulated-sample-count check), NOT by
        // comparing positionBars against the loop's bar range the way
        // renderLoopAware does for loopLengthBars below -- positionBars
        // is the TRANSPORT's clock, which deliberately stays frozen while
        // paused/stopped (recording capture keeps running regardless, per
        // the comment above). Deriving the boundary from position instead
        // of accumulated write count would re-fire onPassBoundary() on
        // EVERY callback for as long as a pause happened to land inside
        // the trigger window, repeatedly wiping the buffer instead of
        // ever completing a pass -- isFull() only ever crosses its
        // threshold once per bufferful, since onPassBoundary() itself
        // resets the write position straight back to 0.
        if (auto* recorder = loopRecorder.load())
        {
            const double recStart = recordingLoopStartBar.load();
            const double recEnd = recordingLoopEndBar.load();
            if (recEnd > recStart)
            {
                recorder->writeBlock(inputChannelData, numInputChannels, 0, numSamples);
                if (recorder->isFull())
                    recorder->onPassBoundary();
            }
        }

        if (playRequested.exchange(false))
        {
            // An explicit Play always wins over any pause/stop fade still
            // winding down from a rapid halt-then-play — abrupt, but this is
            // a rare edge case, and resuming instantly matters more here
            // than finishing a fade nobody asked to hear the tail of.
            //
            // Deliberately NOT `if (playing.load())` — playing stays true
            // for the entire halt fade below (only finalization sets it
            // false once the fade actually completes), so checking it here
            // could never detect a pending halt in the first place: every
            // callback between stop() and the fade's own completion would
            // see playing still true, reset fadingOut before it's even
            // examined pendingHalt, and the halt would never process at all.
            fadingOut = false;
        }

        const HaltKind requested = pendingHalt.exchange(HaltKind::None);
        if (requested != HaltKind::None && !fadingOut)
        {
            fadingOut = true;
            activeHaltKind = requested;
            haltFadeElapsedSec = 0.0;
        }

        if (!playing.load() && !fadingOut)
        {
            // Fully halted, no fade in progress -- true silence. Nothing
            // audible is happening, so any pending reposition needs no fade
            // treatment either; drop it so a stale request can't linger and
            // fire a pointless mute/fade-in once playback resumes elsewhere.
            repositionRequested.store(false);
            repositioning = false;
            return;
        }

        if (secPerBar <= 0.0)
            return;

        if (playing.load() && repositionRequested.exchange(false))
        {
            // (Re)start or extend the fade-out/hold-at-silence phase — a
            // fresh request always means "not settled yet," whether we were
            // idle, already fading out, or partway through fading back in
            // at a now-superseded target. Repeated requests in quick
            // succession (an active scrub drag) never restart the elapsed
            // clock once already fading out, so a fast drag mutes smoothly
            // instead of clicking through every intermediate position.
            if (!repositioning)
            {
                repositioning = true;
                repositionElapsedSec = 0.0;
            }
            repositionFadingIn = false;
        }

        const double blockDurationSec = numSamples / deviceSampleRate;

        if (repositioning)
        {
            const double pos = positionBars.load();
            const double newPos = renderLoopAware(pos, numSamples, outL, outR);
            masterChain.process(numSamples, outL, outR);
            for (int i = 0; i < numSamples; ++i)
            {
                const double elapsed = repositionElapsedSec + (double) i / deviceSampleRate;
                const double frac = std::clamp(elapsed / kRepositionFadeSec, 0.0, 1.0);
                const float gain = (float) (repositionFadingIn ? frac : 1.0 - frac);
                outL[i] *= gain;
                outR[i] *= gain;
            }
            repositionElapsedSec += blockDurationSec;

            if (!repositionFadingIn)
            {
                positionBars.store(newPos); // still advancing normally while winding down to silence
                if (repositionElapsedSec >= kRepositionFadeSec)
                {
                    positionBars.store(repositionTarget.load());
                    repositionFadingIn = true;
                    repositionElapsedSec = 0.0;
                }
            }
            else
            {
                positionBars.store(newPos);
                if (repositionElapsedSec >= kRepositionFadeSec)
                    repositioning = false;
            }
            return;
        }

        const double pos = positionBars.load();
        const double newPos = renderLoopAware(pos, numSamples, outL, outR);
        masterChain.process(numSamples, outL, outR);

        if (fadingOut)
        {
            for (int i = 0; i < numSamples; ++i)
            {
                const double elapsed = haltFadeElapsedSec + (double) i / deviceSampleRate;
                const float gain = (float) std::clamp(1.0 - elapsed / kHaltFadeSec, 0.0, 1.0);
                outL[i] *= gain;
                outR[i] *= gain;
            }
            haltFadeElapsedSec += blockDurationSec;
        }

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
        deviceBlockSize = device->getCurrentBufferSizeSamples();
    }

    void Transport::audioDeviceStopped() {}
}

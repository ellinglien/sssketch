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

        // A standard doubling from the typical ~512-sample OS/driver default --
        // found during manual testing: the driver default produced audible
        // crackling under load (see docs/superpowers/specs/
        // 2026-08-04-ruler-clear-loop-and-buffer-bump-design.md). Just the
        // STARTING value now -- Transport::setBufferSize lets the settings
        // menu change it live.
        constexpr int kPreferredBufferSize = 1024;
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

        // Request a larger buffer than whatever the OS/driver's own default
        // is -- chooseBestBufferSize() (see the identical reasoning already
        // documented in setRecordingInputDevice() below) picks the nearest
        // size the driver actually supports if 1024 itself isn't exactly
        // available, so this is safe across different hardware. Non-fatal
        // if the driver rejects the setup outright -- keep using whatever
        // buffer size the device already opened with above rather than
        // tearing down transport setup entirely over it.
        auto setup = deviceManager.getAudioDeviceSetup();
        setup.bufferSize = kPreferredBufferSize;
        auto bufferSizeError = deviceManager.setAudioDeviceSetup(setup, true);
        if (bufferSizeError.isNotEmpty())
        {
            juce::Logger::writeToLog(
                "Transport: failed to apply preferred buffer size, using device default: "
                + bufferSizeError);
        }

        deviceManager.addAudioCallback(this);

        return true;
    }

    juce::StringArray Transport::availableInputDeviceNames()
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
        auto names = type->getDeviceNames(true); // true = input names
        // Real device-list-change detection for issue #187 (stale
        // setRecordingInputDevice()/setOutputDevice() short-circuit cache
        // surviving a physical unplug+replug of the same-named device) --
        // replaces an EARLIER attempt at this that registered a
        // juce::AudioIODeviceType::Listener at device-open time and cleared
        // the caches from its audioDeviceListChanged() callback. That
        // caused a real regression (recording captured silence, reported
        // and root-caused 2026-08-13): registering that listener broke live
        // input capture, most likely because scanForDevices() right above
        // -- called on every list-input-devices/list-output-devices IPC
        // request the renderer makes -- turns out to fire
        // AudioIODeviceType::Listener callbacks even without a genuine
        // hotplug, not only on one as the removed comment claimed. Diffing
        // the scan result we already have here sidesteps that listener
        // mechanism entirely while still catching the same real case: a
        // hotplug changes what scanForDevices()/getDeviceNames() report,
        // which this codepath already runs on every device-list request.
        // Clears BOTH cached names (not just this list's own) since a
        // hotplug on either side can show up in either input or output
        // enumeration, and the recording/output short-circuits need to
        // agree on "something changed" regardless of which list caught it.
        if (names != lastKnownInputDeviceNames)
        {
            lastKnownInputDeviceNames = names;
            lastConfiguredRecordingInputDevice.clear();
            lastConfiguredOutputDevice.clear();
        }
        return names;
    }

    juce::StringArray Transport::availableOutputDeviceNames()
    {
        auto* type = deviceManager.getCurrentDeviceTypeObject();
        if (type == nullptr) return {};
        // Same fresh-scan reasoning as availableInputDeviceNames() above.
        type->scanForDevices();
        auto names = type->getDeviceNames(false); // false = output names
        // Mirrors availableInputDeviceNames()'s own change-detection above
        // -- see its doc comment for the full reasoning and the #187/
        // silent-recording-regression history.
        if (names != lastKnownOutputDeviceNames)
        {
            lastKnownOutputDeviceNames = names;
            lastConfiguredRecordingInputDevice.clear();
            lastConfiguredOutputDevice.clear();
        }
        return names;
    }

    int Transport::roundTripLatencySamples() const
    {
        if (auto* device = deviceManager.getCurrentAudioDevice())
        {
            const int total = device->getInputLatencyInSamples() + device->getOutputLatencyInSamples();
            if (total > 0)
                return total;
        }
        return deviceBlockSize * 2;
    }

    double Transport::latencySamplesToBars(int latencySamples, double sampleRate, double bpmValue)
    {
        if (sampleRate <= 0.0 || bpmValue <= 0.0)
            return 0.0;
        const double seconds = (double) latencySamples / sampleRate;
        const double secPerBarLocal = (60.0 / bpmValue) * 4.0;
        return seconds / secPerBarLocal;
    }

    juce::String Transport::setRecordingInputDevice(const juce::String& deviceName)
    {
        // Short-circuit: skip the expensive teardown/reopen below entirely
        // when this exact device is already fully configured for recording.
        // deviceManager.setAudioDeviceSetup(setup, true) always calls
        // stopDevice() + currentAudioDevice->open(...) +
        // currentAudioDevice->start(...) even when JUCE's own internal
        // needsNewDevice check decides nothing about the device OBJECT needs
        // recreating -- and CoreAudio's own open() backend always calls
        // close() first, tearing down and recreating the IOProc + property
        // listeners regardless. Called repeatedly for an unchanged device
        // (e.g. from stacked/re-entrant callers) this is exactly what caused
        // a real observed coreaudiod CPU spike/thrashing incident.
        //
        // The condition is deliberately THREE-part, not just "deviceName
        // equals the live setup's inputDeviceName":
        //  1. deviceName == lastConfiguredRecordingInputDevice -- the name
        //     this function itself last successfully configured, NOT just
        //     whatever the device manager's live setup happens to report.
        //     This is the safety-critical distinction: right after
        //     openDefaultDevice(), the live setup's inputDeviceName can
        //     already equal some real device name (initialiseWithDefaultDevices
        //     picked an OS default), but that default-device open never
        //     applied THIS function's own explicit inputChannels bits 0+1,
        //     useDefaultInputChannels=false, or forced sampleRate/bufferSize
        //     = 0/0 -- so treating "the live setup's name happens to match"
        //     as equivalent to "already configured for recording" would
        //     wrongly skip real, necessary configuration on the very first
        //     call. lastConfiguredRecordingInputDevice starts empty and is
        //     only ever set below, after a successful apply, so this can't
        //     happen.
        //  2. deviceManager.getAudioDeviceSetup().inputDeviceName still
        //     equals deviceName -- guards against the device having changed
        //     out from under us since the last successful call (e.g. the
        //     device disconnected and JUCE's manager silently fell back to
        //     something else) without going through this function.
        //  3. deviceManager.getCurrentAudioDevice() != nullptr -- guards
        //     against skipping when no device is actually open right now
        //     (e.g. it was closed, or never successfully opened despite
        //     lastConfiguredRecordingInputDevice being stale from an earlier
        //     session state) -- skipping here would leave recording silently
        //     non-functional instead of reopening.
        if (deviceName.isNotEmpty()
            && deviceName == lastConfiguredRecordingInputDevice
            && deviceManager.getAudioDeviceSetup().inputDeviceName == deviceName
            && deviceManager.getCurrentAudioDevice() != nullptr)
        {
            return {};
        }

        auto setup = deviceManager.getAudioDeviceSetup();
        setup.inputDeviceName = deviceName;
        setup.useDefaultInputChannels = false;
        setup.inputChannels = juce::BigInteger();
        // Request channels 0 AND 1 -- both LoopRecorder and GatedLoopRecorder
        // now capture real stereo (see their own doc comments), so the
        // device itself needs channel 1 actually opened, not just channel 0.
        // A mono-only device (e.g. a single-channel mic) simply won't have a
        // bit 1 to give back; the recorders themselves handle however many
        // channels they're actually handed.
        setup.inputChannels.setBit(0);
        setup.inputChannels.setBit(1);
        // Deliberately clearing sampleRate AND bufferSize to 0/0 (not
        // carrying over whatever the PREVIOUS setup happened to have, e.g.
        // 44100/some-default from initialiseWithDefaultDevices' own
        // default at startup) -- found during manual testing: recording
        // via a loopback device produced crackly/glitchy audio.
        // AudioDeviceManager::chooseBestSampleRate()/chooseBestBufferSize()
        // both honor an explicitly requested value as long as it's
        // SOMETHING the new device's driver technically lists as
        // supported, even when it doesn't match what the source is
        // actually feeding it -- forcing the OS/driver into real-time
        // conversion/resync on a virtual loopback device, exactly the kind
        // of thing that sounds like this. 0 tells JUCE to auto-choose
        // based on the newly-opened device's own actual native rate/
        // default buffer size instead (chooseBestSampleRate falls back to
        // currentAudioDevice->getCurrentSampleRate(), chooseBestBufferSize
        // to currentAudioDevice->getDefaultBufferSize(), both only when no
        // explicit value > 0 was requested).
        setup.sampleRate = 0;
        setup.bufferSize = 0;
        auto error = deviceManager.setAudioDeviceSetup(setup, true);
        if (error.isEmpty())
            lastConfiguredRecordingInputDevice = deviceName;
        return error;
    }

    juce::String Transport::setOutputDevice(const juce::String& deviceName)
    {
        // Mirrors setRecordingInputDevice's own three-part short-circuit --
        // see that function's doc comment for the full "why THIS specific
        // condition, not just comparing against the live setup" rationale.
        if (deviceName.isNotEmpty()
            && deviceName == lastConfiguredOutputDevice
            && deviceManager.getAudioDeviceSetup().outputDeviceName == deviceName
            && deviceManager.getCurrentAudioDevice() != nullptr)
        {
            return {};
        }

        auto setup = deviceManager.getAudioDeviceSetup();
        setup.outputDeviceName = deviceName;
        // useDefaultOutputChannels/outputChannels deliberately left as-is --
        // unlike setRecordingInputDevice, there's no fixed channel-count
        // requirement to force here; JUCE's own default behaviour (however
        // many channels the device offers, up to stereo) is exactly what's
        // wanted, and openDefaultDevice()'s initial initialiseWithDefaultDevices
        // call already established it.
        //
        // Same 0/0 clearing as setRecordingInputDevice, same reasoning: forces
        // JUCE to auto-choose sample rate/buffer size based on the newly
        // paired device combination's own actual capabilities, rather than
        // carrying over whatever the PREVIOUS pairing happened to have.
        setup.sampleRate = 0;
        setup.bufferSize = 0;
        auto error = deviceManager.setAudioDeviceSetup(setup, true);
        if (error.isEmpty())
            lastConfiguredOutputDevice = deviceName;
        return error;
    }

    juce::String Transport::setBufferSize(int bufferSizeSamples)
    {
        // Short-circuit: same teardown/reopen cost reasoning as
        // setRecordingInputDevice's own short-circuit (see its doc
        // comment) -- comparing directly against the live,
        // callback-refreshed deviceBlockSize rather than a separate
        // lastConfigured member, since a numeric match here can't have
        // that function's "matches by coincidence before ever being
        // configured" hazard.
        if (deviceManager.getCurrentAudioDevice() != nullptr && deviceBlockSize == bufferSizeSamples)
            return {};

        auto setup = deviceManager.getAudioDeviceSetup();
        setup.bufferSize = bufferSizeSamples;
        // inputDeviceName/outputDeviceName/sampleRate deliberately left
        // exactly as they are -- unlike setRecordingInputDevice/
        // setOutputDevice, this never switches to a different device, so
        // there's no reason to force JUCE to re-choose a sample rate.
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
        // case). Purely a playback/audible concern -- LoopRecorder itself
        // has no pass-boundary concept at all anymore (capture just runs
        // continuously from arm to disarm, independent of this wrap; see
        // LoopRecorder's own doc comment), so nothing here affects what
        // gets captured.
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
        // becomes active, its bounds change, or a manual seek lands
        // outside them. Two different cases, two different treatments, per
        // direct feedback:
        //   - pos is AHEAD of the loop (pos < loopStart, the loop is still
        //     somewhere in front of the playhead): play straight through
        //     UNWRAPPED, exactly like the loopBars<=0 case above, letting
        //     playback arrive at the loop naturally instead of teleporting
        //     the playhead there the instant the region is set -- setting
        //     a loop region (e.g. double-clicking a clip, or pressing the
        //     rec dot) should never yank playback away from wherever it
        //     currently sits. Once pos organically advances into
        //     [loopStart, loopEnd) on some later block, the branch below
        //     takes over from there and it starts looping for real.
        //   - pos is BEHIND the loop (pos >= loopEnd, already past it):
        //     there's no "keep playing forward and arrive" story for a
        //     region that's already in the past relative to a forward-only
        //     playhead, so this case still snaps straight to loopStart --
        //     the only case this file's own history note above still
        //     applies to ("a loop that's active should always mean 'play
        //     from here'" -- true when there's nowhere else to arrive
        //     FROM).
        if (pos < loopStart)
        {
            engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR, channelChains);
            return pos + blockDurationBars;
        }
        if (pos >= loopEnd)
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
        // Unconditional writeBlock() for as long as a recorder is armed --
        // no pass-boundary/completion concept anymore (see LoopRecorder's
        // own doc comment): a take's length is simply arm-to-disarm,
        // whatever that turns out to be, not tied to the loop region's own
        // length. The loop region here still only gates whether capture
        // happens at all (armed with no valid region set shouldn't be
        // reachable via the renderer, but this stays a defensive check),
        // not how long it can run for.
        if (auto* recorder = loopRecorder.load())
        {
            const double recStart = recordingLoopStartBar.load();
            const double recEnd = recordingLoopEndBar.load();
            if (recEnd > recStart)
                recorder->writeBlock(inputChannelData, numInputChannels, 0, numSamples);
        }

        // Gated (threshold-triggered) recording capture -- same
        // "independent of play/pause/halt-fade state" reasoning as the
        // unconditional block just above: "always listening" means
        // always, not just while transport output happens to be actively
        // playing. Computes its own loop-relative wrap position rather
        // than calling renderLoopAware (that function is about OUTPUT
        // rendering with its own fade/split-render concerns this capture
        // path has no reason to share) -- both read the SAME positionBars
        // value before anything below mutates it, so they stay in sync:
        // whatever moment is being captured here is the same moment
        // renderLoopAware renders further down.
        if (auto* gated = gatedRecorder.load())
        {
            const double recStart = recordingLoopStartBar.load();
            const double recEnd = recordingLoopEndBar.load();
            if (recEnd > recStart)
            {
                const double loopPos = positionBars.load();
                // Only capture once playback has ACTUALLY reached the loop
                // region -- matches renderLoopAware's own "don't jump the
                // playhead, let it arrive naturally" behavior below (see
                // its own comment) rather than the snap-to-recStart this
                // used to unconditionally do. Before pos genuinely reaches
                // recStart, loopPos < recStart doesn't correspond to any
                // real position within the take's own bounds -- writing
                // here would incorrectly stamp whatever's playing
                // beforehand onto the START of the loop, the exact
                // "recorded a thing... didn't seem to record anything [in
                // the right place]" class of bug this class's own gate was
                // built to avoid in the first place.
                if (loopPos >= recStart && loopPos < recEnd)
                    gated->writeBlock(inputChannelData, numInputChannels, 0, numSamples,
                                       loopPos - recStart);
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
            masterChain.setPosition(pos);
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
        masterChain.setPosition(pos);
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

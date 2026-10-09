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

    bool Transport::openDefaultDevice(bool openInput)
    {
        // Requests 1 input channel now (was 0) -- harmless when nothing is
        // ever armed (the extra channel just goes unread, same cost as
        // before this feature existed), and means an input device is
        // already open and ready the moment arm-recording actually needs
        // one, rather than requiring a device reopen mid-session (which
        // would glitch/interrupt playback on the output side too, since
        // JUCE reopens the whole device, not just the input half, when
        // input channel count changes on an already-open device).
        //
        // openInput=false (--no-audio-input, the app's recording feature off) asks for 0 input
        // channels instead: no input is opened, so macOS never asks for the microphone. The
        // price, only if recording is then turned on mid-session: the first arm reopens the
        // device (the glitch described above), once.
        auto error = deviceManager.initialiseWithDefaultDevices(openInput ? 1 : 0, 2);
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

    unsigned long long Transport::publishTransportCommand(TransportCommandKind kind)
    {
        const auto generation = nextTransportCommandGeneration.fetch_add(1) + 1;
        const auto command = (generation << 2) | static_cast<unsigned long long>(kind);
        desiredTransportCommand.store(command, std::memory_order_release);
        return generation;
    }

    void Transport::play(double fromPositionBars)
    {
        requestedPlayPosition.store(fromPositionBars);
        publishTransportCommand(TransportCommandKind::Play);
        // `playing` and positionBars are actual audio-thread state, not
        // desired UI state. Publishing them here would let a Stop arriving
        // before the next callback mistake an as-yet-unheard Play for live
        // audio and render an unnecessary halt fade.
    }

    void Transport::pause()
    {
        publishTransportCommand(TransportCommandKind::Pause);
    }

    unsigned long long Transport::stop()
    {
        const auto generation = publishTransportCommand(TransportCommandKind::Stop);
        if (!playing.load()) positionBars.store(0.0);
        return generation;
    }

    void Transport::setPosition(double bars)
    {
        repositionTarget.store(bars);
        repositionRequested.store(true);
    }

    double Transport::barsUntilNextWrap() const
    {
        // Deliberately the same window selection renderLoopAware makes
        // below, and for the same reason: a recording loop, when active,
        // IS the loop the audio thread wraps at.
        const double recStart = recordingLoopStartBar.load();
        const double recEnd = recordingLoopEndBar.load();
        const bool recordingLoopActive = recEnd > recStart;
        const double loopStart = recordingLoopActive ? recStart : 0.0;
        const double loopEnd = recordingLoopActive ? recEnd : loopLengthBars.load();
        if (loopEnd - loopStart <= 0.0)
            return -1.0;

        const double pos = positionBars.load();
        // Past the loop's end: the next block snaps straight back to
        // loopStart, so the wrap is effectively immediate. Ahead of it
        // (pos < loopStart) playback runs straight through unwrapped until
        // it arrives, so the wait is the whole travel to loopEnd -- which
        // is what the shared expression below already says.
        if (pos >= loopEnd)
            return 0.0;
        return loopEnd - pos;
    }

    double Transport::barsUntilBar(double targetBar) const
    {
        // Same window selection as barsUntilNextWrap and renderLoopAware,
        // and for the same reason: a recording loop, when active, IS the
        // loop the audio thread wraps at, so it is also the lap a
        // mid-lap boundary has to live inside.
        const double recStart = recordingLoopStartBar.load();
        const double recEnd = recordingLoopEndBar.load();
        const bool recordingLoopActive = recEnd > recStart;
        const double loopStart = recordingLoopActive ? recStart : 0.0;
        const double loopEnd = recordingLoopActive ? recEnd : loopLengthBars.load();
        if (loopEnd - loopStart <= 0.0)
            return -1.0;
        // A target AT the top is the wrap, which barsUntilNextWrap
        // already answers and renderLoopAware already lands exactly.
        if (!(targetBar > loopStart) || !(targetBar < loopEnd))
            return -1.0;

        const double pos = positionBars.load();
        if (pos < loopStart || pos >= loopEnd)
            return -1.0;
        // Already behind the playhead. Deliberately NOT read as "the same
        // bar, next lap": that would land a whole loop early, which is a
        // far worse fault than the lateness this whole mechanism exists
        // to remove. The caller does it now instead.
        if (targetBar <= pos)
            return -1.0;
        return targetBar - pos;
    }

    void Transport::applyStagedProjectAtWrap(double atBars, bool atRequestedBar)
    {
        const auto result = engine.applyStagedProject();
        if (result == PlaybackEngine::StagedApply::Deferred)
        {
            stagedApplyRetryDue = true;
            return;
        }
        stagedApplyRetryDue = false;
        if (result != PlaybackEngine::StagedApply::Applied)
            return;

        // Consumed with the project it belonged to. Left set, the next
        // block would split at the same bar again for a swap that has
        // already happened -- harmless, but it would also outlive its
        // own project and could be read by a LATER stage that meant the
        // loop top. Cleared here rather than only on the message thread
        // because this is the thread that knows the swap actually
        // happened.
        stagedApplyAtBars.store(-1.0);
        stagedApplyAtRequestedBar.store(atRequestedBar);

        // Adopted in the same breath as the project it belongs to: a loop
        // length changed any earlier would have moved the very wrap this
        // swap was waiting for. Reading it back into loopLengthBars here,
        // mid-renderLoopAware, is deliberate and harmless -- that function
        // has already taken its own local copy of the window for this
        // block, so the new length starts applying from the next one.
        const double nextLoopBars = stagedLoopLengthBars.exchange(-1.0);
        if (nextLoopBars >= 0.0)
            loopLengthBars.store(nextLoopBars);
        stagedApplyPositionBars.store(atBars);
    }

    double Transport::renderLoopAware(double pos, int numSamples, float* outL, float* outR, double spb)
    {
        // The one case where a swap happens away from a lap boundary: a
        // previous attempt found the retirement slot occupied. Retrying at
        // the top of a block is the same "no renderBlock in flight"
        // position the real wrap points are, so it is safe by the same
        // argument -- it is just less musically exact, which is the right
        // trade against waiting another whole lap.
        if (stagedApplyRetryDue)
            applyStagedProjectAtWrap(pos);

        // The sample clock (see anchorBars in Transport.h). `pos` is what this function returned
        // last time unless something set it since (play, a seek landing, a stop), or the tempo
        // or the device rate changed under it: then the clock restarts from `pos`.
        if (! anchorValid || pos != lastReturnedPositionBars || spb != anchorSecPerBar
            || deviceSampleRate != anchorSampleRate)
        {
            // Only a MOVE starts a new lap clock (a play, a seek, a stop's landing): a tempo or
            // device-rate change re-anchors the sample clock but the laps played stay played.
            if (! anchorValid || pos != lastReturnedPositionBars)
            {
                lapBaseBars = 0.0;
                ++lapEpoch;
            }
            reanchor(pos, 0, spb);
        }

        // Radio fold mode's cycles (CycleTable.h): a `now` stage, or a loop top's apply that
        // could not take the lock, lands here -- the top of a block, no renderBlock in flight.
        engine.applyStagedCycles(false);

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
        const double barsPerSample = (1.0 / deviceSampleRate) / spb;
        const double blockDurationBars = numSamples * barsPerSample;

        if (loopBars <= 0.0)
        {
            engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR, channelChains, lapClock());
            return advanceClock(numSamples);
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
            engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR, channelChains, lapClock());
            return advanceClock(numSamples);
        }
        if (pos >= loopEnd)
        {
            pos = loopStart;
            reanchor(loopStart, 0, spb);
            // A snap is a jump, not a lap played through: a new lap clock, and the cycles
            // staged for "the next top" take this one.
            lapBaseBars = 0.0;
            ++lapEpoch;
            engine.applyStagedCycles(true);
            // A snap back to the top is a lap boundary too, as far as a
            // scheduled swap is concerned: the same "the loop starts over
            // here" moment, arrived at from a bounds change rather than
            // from playing through the end. Nothing has been rendered in
            // this call yet, so this is as clean a swap point as the
            // split below.
            applyStagedProjectAtWrap(loopStart);
        }

        // A swap the message thread aimed at a BAR rather than at the lap
        // top -- radio's bare cuts, the one population the loop-top-only
        // swap could never reach (see setStagedApplyAtBars). Only ever a
        // bar strictly inside the wrap window; barsUntilBar refuses
        // anything else on the message thread, and this re-reads the
        // window it was checked against rather than trusting it, because
        // the window can move (a recording loop being armed) between the
        // two.
        const double stagedBar = stagedApplyAtBars.load();
        const bool stagedBarInLap = stagedBar > loopStart && stagedBar < loopEnd;
        if (stagedBarInLap && stagedBar <= pos)
        {
            // The bar went by in a block that was already in flight when
            // the message thread named it, or a seek carried the playhead
            // over it. The top of a block is the same "no renderBlock in
            // flight" position the real split is, so it is safe by the
            // same argument -- exactly the trade stagedApplyRetryDue
            // already makes, and for the same reason: late by a block
            // beats late by a lap, and both beat never.
            applyStagedProjectAtWrap(pos, true);
        }

        const double distToEnd = loopEnd - pos;
        bool wrappedThisBlock = false;
        if (distToEnd >= blockDurationBars)
        {
            // No wrap within this block -- but possibly the requested bar.
            //
            // SAMPLE-ACCURATE BY BORROWING THE WRAP'S OWN TRICK. The lap
            // top is exact because this function already had to split the
            // block there for rendering reasons; an arbitrary bar has no
            // such split, so it gets one of its own, for no reason other
            // than the swap. At kPreferredBufferSize (1024) a
            // block-granular swap would be up to ~23ms out, which is a
            // visible fraction of a 16th note and audibly not "on the
            // boundary." This costs one extra renderBlock call on the one
            // block per change that contains the bar.
            //
            // The second half continues from pos + splitIndex samples,
            // NOT from stagedBar: every layer the change did NOT touch
            // has to stay sample-continuous across the seam, and rounding
            // the position to the requested bar would step them by up to
            // half a sample. The wrap split can use loopStart because
            // there everything genuinely restarts.
            const double barsIntoBlock = stagedBar - pos;
            if (stagedBarInLap && barsIntoBlock > 0.0 && barsIntoBlock < blockDurationBars)
            {
                const int splitIndex =
                    std::clamp((int) std::lround(barsIntoBlock / barsPerSample), 0, numSamples);
                if (splitIndex > 0)
                    engine.renderBlock(pos, deviceSampleRate, splitIndex, outL, outR, channelChains, lapClock());
                // The same gap, for the same reason, as the wrap split
                // below: the first render has returned and released its
                // reference to the outgoing snapshot, and the second has
                // not taken one yet. Nothing about the reclamation
                // argument changes for a boundary that is not the top.
                applyStagedProjectAtWrap(stagedBar, true);
                if (splitIndex < numSamples)
                    engine.renderBlock(barsAtSample(splitIndex), deviceSampleRate,
                                       numSamples - splitIndex, outL + splitIndex,
                                       outR + splitIndex, channelChains, lapClock());
            }
            else
            {
                engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR, channelChains, lapClock());
            }
        }
        else
        {
            // The wrap wins a block it shares with a requested bar, and
            // deliberately: the two are then less than one block apart,
            // so the difference is under ~23ms either way, and nesting a
            // second split inside this one would buy that back at the
            // cost of the clearest code in this file. applyStagedProject
            // at the wrap takes the staged project, and the requested bar
            // is cleared with it.
            // The wrap falls partway through this block -- render each side
            // from its own correct (and, for the incoming side, correctly
            // wrapped-to-loopStart) position rather than letting a single
            // render run unclamped past the loop's own end, which would
            // just find nothing placed there and render silence for what
            // should be the start of the next lap.
            const int splitIndex =
                std::clamp((int) std::lround(distToEnd / barsPerSample), 0, numSamples);
            if (splitIndex > 0)
                engine.renderBlock(pos, deviceSampleRate, splitIndex, outL, outR, channelChains, lapClock());
            // Exactly here, between the outgoing lap's last sample and the
            // incoming lap's first, is what "apply at the next loop top"
            // means -- sample-accurate, not block-accurate. The first
            // renderBlock above has returned, so its reference to the
            // outgoing snapshot is gone and the second has not taken one
            // yet; that gap is the precondition
            // PlaybackEngine::applyStagedProject() requires. The seam
            // anchor rendered further down then comes from the NEW
            // project, which is also right: the outgoing tail should be
            // pulled toward whatever actually follows it.
            applyStagedProjectAtWrap(loopStart);
            // The lap just played joins the lap clock, and the cycles staged for this top go
            // live, in the same gap as the project: the incoming lap's first sample is the first
            // one rendered with them.
            lapBaseBars += loopBars;
            wrappedThisBlock = true;
            engine.applyStagedCycles(true, loopBars);
            // The clock restarts at the top, on the sample the lap turns over at.
            reanchor(loopStart, -(int64_t) splitIndex, spb);
            if (splitIndex < numSamples)
                engine.renderBlock(loopStart, deviceSampleRate, numSamples - splitIndex,
                                    outL + splitIndex, outR + splitIndex, channelChains, lapClock());
        }

        // Declicks the seam by pulling the outgoing lap's last `fadeBars`
        // toward the incoming lap's own first sample VALUE (not toward
        // silence — see LoopBoundaryFade.h for why) — a fixed anchor, same
        // scheme LoopSewing.cpp already uses for a single stem buffer's own
        // tail-toward-head blend, just applied here to the whole mixed
        // master output instead.
        const double fadeBars = std::min(kLoopSeamFadeSec / spb, loopBars / 2.0);
        if (distToEnd < fadeBars + blockDurationBars)
        {
            float anchorL = 0.0f, anchorR = 0.0f;
            // The anchor is the NEXT lap's first sample, on the next lap's clock.
            const LapClock anchorClock { wrappedThisBlock ? lapBaseBars : lapBaseBars + loopBars, lapEpoch };
            engine.renderBlock(loopStart, deviceSampleRate, 1, &anchorL, &anchorR, channelChains, anchorClock);
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

        return advanceClock(numSamples);
    }

    void Transport::reanchor(double atBars, int64_t samplesIntoBlock, double spb)
    {
        anchorBars = atBars;
        anchorSamples = samplesIntoBlock;
        anchorSecPerBar = spb;
        anchorSampleRate = deviceSampleRate;
        anchorValid = true;
    }

    double Transport::advanceClock(int numSamples)
    {
        anchorSamples += numSamples;
        lastReturnedPositionBars = barsAtSample(0);
        return lastReturnedPositionBars;
    }

    void Transport::audioDeviceIOCallbackWithContext(
        const float* const* inputChannelData, int numInputChannels,
        float* const* outputChannelData, int numOutputChannels,
        int numSamples, const juce::AudioIODeviceCallbackContext&)
    {
        callbackBlockSize.store(numSamples, std::memory_order_relaxed);
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

        const auto applyLatestTransportCommand = [this]()
        {
            const auto command = desiredTransportCommand.load(std::memory_order_acquire);
            if (command == appliedTransportCommand)
                return;

            appliedTransportCommand = command;
            const auto generation = command >> 2;
            const auto kind = static_cast<TransportCommandKind>(command & 0x3ULL);
            if (kind == TransportCommandKind::Play)
            {
                positionBars.store(requestedPlayPosition.load());
                playing.store(true);
                fadingOut = false;
                activeHaltKind = HaltKind::None;
                return;
            }

            const auto haltKind = kind == TransportCommandKind::Stop
                ? HaltKind::Stop
                : HaltKind::Pause;
            activeHaltKind = haltKind;
            activeHaltCommandGeneration = generation;
            if (!playing.load())
            {
                // Already silent: apply Stop's position semantics without
                // entering a fade that would render idle project audio.
                fadingOut = false;
                if (haltKind == HaltKind::Stop)
                    positionBars.store(0.0);
                completedHaltCommandGeneration.store(generation, std::memory_order_release);
                return;
            }
            if (!fadingOut)
            {
                fadingOut = true;
                haltFadeElapsedSec = 0.0;
            }
        };

        // Apply the ordered Play/Pause/Stop command before either recorder
        // reads positionBars. The capture and backing audio in this callback
        // must describe the same position, especially on Play-from-bar-N.
        applyLatestTransportCommand();

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

        // The tempo this whole callback runs at: read once (see renderLoopAware).
        const double spb = secPerBar.load(std::memory_order_relaxed);
        if (spb <= 0.0)
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
            else if (repositionFadingIn)
            {
                // Fading back in at a target the drag has already left: fade out again from
                // the gain the fade-in has reached, not from where the elapsed clock happens to
                // stand. That clock counts from the fade-in's start, hold included, so reading
                // it as fade-out time would jump the gain (from the hold's 0 to nearly 1, or
                // from 0.1 to 0.9) -- a click on every scrub event that lands inside the
                // ~13.6 ms hold + fade-in window, i.e. most of them. Gain g = clamp((e - hold)
                // / F) fades out from e' = F - clamp(e - hold, 0, F), where 1 - e'/F = g; in the
                // hold that is F, so the jump to the new target comes at once, under silence.
                const double inSec = std::clamp(repositionElapsedSec - repositionHoldSec, 0.0, kRepositionFadeSec);
                repositionElapsedSec = kRepositionFadeSec - inSec;
            }
            repositionFadingIn = false;
            repositionHoldSec = 0.0;
        }

        const double blockDurationSec = numSamples / deviceSampleRate;

        if (repositioning)
        {
            const double pos = positionBars.load();
            const double newPos = renderLoopAware(pos, numSamples, outL, outR, spb);
            masterChain.setPosition(pos);
            masterChain.process(numSamples, outL, outR);
            // The radio sound's master stage: last before the device, after the user's
            // plugins (a plugin after the limiter would undo its ceiling), and before this
            // fade -- the same call RenderExport makes. See PlaybackEngine::processMaster.
            engine.processMaster(deviceSampleRate, numSamples, outL, outR);
            for (int i = 0; i < numSamples; ++i)
            {
                // The fade-in starts repositionHoldSec late (0 unless the master stage is on;
                // see where it is set below), so the jump lands under silence.
                const double elapsed = repositionElapsedSec + (double) i / deviceSampleRate
                    - (repositionFadingIn ? repositionHoldSec : 0.0);
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
                    // The master stage's state belongs to the old position: the glue's slow
                    // release (1.5 s) would start a quiet passage reduced and swell it up, and
                    // the limiter's envelope likewise. Clear it here, under the silence, so the
                    // new position starts as a fresh stage would (the switches and their fades
                    // are kept). Off, or with nothing engaged, this touches no sample.
                    engine.clearMasterDynamics();
                    // The drum-keyed pump's duck likewise (DrumPump.h): a seek lands as a fresh
                    // play from the new bar, not 200 ms of the old kick's release.
                    engine.clearPump();
                    repositionFadingIn = true;
                    repositionElapsedSec = 0.0;
                    // The jump happens at the master stage's INPUT, but this fade is applied at
                    // its output: with the limiter in, the new audio comes out of it 75 samples
                    // late (its line, just cleared above, plays zeros meanwhile). Hold at
                    // silence that much longer before fading in, so the new audio arrives at the
                    // start of the fade, as it does with the stage off. Off: 0, today's timing.
                    repositionHoldSec = engine.masterLatencySamples() / deviceSampleRate;
                }
            }
            else
            {
                positionBars.store(newPos);
                if (repositionElapsedSec >= kRepositionFadeSec + repositionHoldSec)
                    repositioning = false;
            }
            return;
        }

        const double pos = positionBars.load();
        const double newPos = renderLoopAware(pos, numSamples, outL, outR, spb);
        masterChain.setPosition(pos);
        masterChain.process(numSamples, outL, outR);
        // As above: the master stage, then the halt fade.
        engine.processMaster(deviceSampleRate, numSamples, outL, outR);

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
            if (haltFinalizationHookForTest != nullptr)
            {
                const auto hook = haltFinalizationHookForTest;
                haltFinalizationHookForTest = nullptr;
                hook(haltFinalizationHookContextForTest);
            }
            // Re-read the one ordered command word at the last possible
            // safe point. A newer Play cancels this old halt; a newer
            // Pause/Stop becomes the halt finalized below. Commands arriving
            // after this point remain pending for the next callback, and an
            // acknowledgement waits on their own generation.
            applyLatestTransportCommand();
            if (!fadingOut)
                return;
            fadingOut = false;
            playing.store(false);
            // The limiter's 75-sample lookahead still holds the last unfaded audio (the fade
            // runs after it): clear it, so the next play starts as an export does.
            engine.resetMaster();
            // Likewise the cavern's tail: nothing renders while halted, so it would otherwise
            // freeze and play on under the start of the next play (zita's cannot be dropped
            // without allocating; see ReverbBus::dropCavernTail). A seek keeps it.
            engine.dropReverbTail();
            // And the pump's duck, so the next play starts as an export does.
            engine.clearPump();
            // Pause preserves wherever playback had reached by the time the
            // fade finished; Stop resets to the top, matching each one's
            // existing pre-fade behavior.
            positionBars.store(activeHaltKind == HaltKind::Stop ? 0.0 : newPos);
            completedHaltCommandGeneration.store(
                activeHaltCommandGeneration, std::memory_order_release);
            return;
        }

        positionBars.store(newPos);
    }

    void Transport::audioDeviceAboutToStart(juce::AudioIODevice* device)
    {
        deviceSampleRate = device->getCurrentSampleRate();
        deviceBlockSize = device->getCurrentBufferSizeSamples();
        juce::Logger::writeToLog(
            "Transport: audio device \"" + device->getName()
            + "\", " + juce::String(deviceSampleRate, 0) + " Hz, "
            + juce::String(deviceBlockSize) + " samples");
        juce::StringArray availableRates;
        for (const auto rate : device->getAvailableSampleRates())
            availableRates.add(juce::String(rate, 0));
        juce::Logger::writeToLog(
            "Transport: available sample rates " + availableRates.joinIntoString(", "));

        if (deviceSampleRate < 44100.0)
            juce::Logger::writeToLog(
                "Transport: warning: low-rate audio route; Bluetooth output may be in "
                "headset mode. Select a different system input, then reconnect the output.");
        // A restart (at the same rate too, where prepareMaster below rebuilds nothing) must not
        // replay the last 75 samples left in the limiter's line, or fade in from them. No
        // callback is running here -- JUCE's AudioDeviceManager calls this before the device
        // starts, under its audioCallbackLock (which every callback also takes), or before this
        // callback is (re)added to its list -- so this is the "no process() in flight" reset()
        // needs.
        engine.resetMaster();
        engine.dropReverbTail(); // the same "no callback in flight" moment
        engine.clearPump();
        // Called by JUCE on the thread that starts the device (the message thread, from
        // openDevice/setAudioDeviceSetup or a restart), before any callback at the new rate:
        // the master stage's limiter is rebuilt at it there, never on the audio thread. A
        // block size needs nothing -- the stage works in its own fixed chunks.
        // The device's block size too: every snapshot's scratch is reserved to it on the
        // message thread, so a re-sync allocates nothing on the audio thread.
        engine.prepareMaster(deviceSampleRate, deviceBlockSize);
    }

    void Transport::audioDeviceStopped() {}
}

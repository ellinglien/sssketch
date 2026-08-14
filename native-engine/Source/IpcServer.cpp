#include "IpcServer.h"
#include <algorithm>

namespace sssketch
{
    namespace
    {
        // MultiTimer IDs for IpcConnection's two independent polling
        // cadences -- see the class's own doc comment (.h) for why a
        // single juce::Timer no longer suffices.
        constexpr int kPositionTimerId = 0; // position-update/capture-level pushes -- ~30Hz, only while playing
        constexpr int kLinkPollTimerId = 1; // LinkSession::checkForExternalTempoChange -- always running

        // ~500ms-1s, per this feature's own design doc -- frequent enough that a
        // peer's tempo nudge reaches Maschine/Ableton/etc. via sssketch within
        // roughly a second, infrequent enough that a captureAppSessionState()
        // call every tick would be wasteful (Link's own docs note it's
        // real-time-unsafe but message-thread-cheap; still no reason to do it
        // 30x/sec when nothing needs sub-second freshness here, unlike the
        // playhead).
        constexpr int kLinkPollIntervalMs = 750;
    }

    // File-local helper for building the render-export-result reply — mirrors
    // how position-update's payload is built inline in timerCallback() above,
    // just factored out since it's needed both on the success and failure path.
    static juce::var makeRenderExportResult(bool success, const juce::String& error)
    {
        juce::DynamicObject::Ptr payload = new juce::DynamicObject();
        payload->setProperty("success", success);
        if (error.isNotEmpty())
            payload->setProperty("error", error);
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "render-export-result");
        obj->setProperty("payload", juce::var(payload.get()));
        return juce::var(obj.get());
    }

    // Mirrors makeRenderExportResult above exactly, for bake-stem's own
    // request/response pair (see BakeStem.h) — main-process bakeOffset.ts
    // routes a LORE-sourced (Ogg) stem's downbeat bake through this instead
    // of its own raw-WAV-byte rotation, since it can't decode Ogg itself.
    // durationSec is only meaningful (and only included) on success — see
    // BakeStem.h's own doc comment on why the caller MUST use this instead
    // of whatever duration metadata it already had for the pre-bake source.
    static juce::var makeBakeStemResult(bool success, double durationSec, const juce::String& error)
    {
        juce::DynamicObject::Ptr payload = new juce::DynamicObject();
        payload->setProperty("success", success);
        if (success)
            payload->setProperty("durationSec", durationSec);
        if (error.isNotEmpty())
            payload->setProperty("error", error);
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "bake-stem-result");
        obj->setProperty("payload", juce::var(payload.get()));
        return juce::var(obj.get());
    }

    IpcConnection::IpcConnection(PlaybackEngine& e, Transport& t, PluginChain& mc, ChannelChainRegistry& cc)
        : engine(e), transport(t), masterChain(mc), channelChains(cc), linkSession(t.currentBpm())
    {
        // Started once here, never stopped until teardown (destructor/
        // connectionLost below) -- deliberately NOT gated by play/pause/stop
        // like kPositionTimerId is. See LinkSession.h's own doc comment and
        // this class's own doc comment (.h) for why external tempo detection
        // needs to keep running independent of play state.
        startTimer(kLinkPollTimerId, kLinkPollIntervalMs);
    }

    IpcConnection::~IpcConnection()
    {
        stopTimer(kPositionTimerId);
        stopTimer(kLinkPollTimerId);
        detachArmedRecorderOnTeardown();
        // InterprocessConnection's destructor requires derived classes to have
        // already called disconnect() — without this, pending messages can still
        // be delivered to this object's (now partially destroyed) vtable, and the
        // base destructor's jassert(!safeAction->isSafe()) fires. Not in the
        // plan's sample code; added because the base class header and .cpp both
        // document this as a hard requirement, not an optional cleanup step.
        disconnect();
    }

    // Detaches an armed recorder from Transport at connection teardown
    // (destructor or connectionLost -- either can run while a recording is
    // still armed, e.g. the client quits or crashes mid-take). Unlike a
    // normal arm-recording/disarm-recording cycle, there is no "next
    // cycle" here to safely defer the real free to (see
    // previousRecorder's own doc comment for that mechanism) -- this
    // object is going away right now. Detaching the raw pointer first
    // still matters (stops the audio thread from being handed this
    // pointer on its NEXT callback), but deliberately leaks the
    // LoopRecorder itself (release(), not reset()) rather than freeing it
    // synchronously -- a small, rare, bounded leak (one loop pass's worth
    // of a mono float buffer, only when a recording happens to be armed
    // at the exact moment a connection is lost) is a far better trade
    // than risking a real audio-thread use-after-free crash in this
    // codebase's single highest-blast-radius file (see this repo's own
    // CLAUDE.md on the native engine).
    void IpcConnection::detachArmedRecorderOnTeardown()
    {
        if (!armedRecorder && !gatedRecorder) return;
        if (armedRecorder)
        {
            transport.setLoopRecorder(nullptr);
            armedRecorder.release();
        }
        // Same reasoning as above, for the gated recorder -- see this
        // method's own doc comment (.h).
        if (gatedRecorder)
        {
            transport.setGatedRecorder(nullptr);
            gatedRecorder.release();
        }
        transport.setRecordingLoop(0.0, 0.0);
    }

    void IpcConnection::connectionMade()
    {
        juce::Logger::writeToLog("IpcConnection: client connected");
    }

    void IpcConnection::connectionLost()
    {
        juce::Logger::writeToLog("IpcConnection: client disconnected");
        stopTimer(kPositionTimerId);
        stopTimer(kLinkPollTimerId);
        transport.stop();
        detachArmedRecorderOnTeardown();
    }

    void IpcConnection::sendJson(const juce::var& payload)
    {
        const auto text = juce::JSON::toString(payload, true);
        juce::MemoryBlock block(text.toRawUTF8(), text.getNumBytesAsUTF8());
        sendMessage(block);
    }

    void IpcConnection::timerCallback(int timerID)
    {
        if (timerID == kLinkPollTimerId)
        {
            // Unsolicited push, same "engine spontaneously tells the
            // renderer something changed" pattern as position-update/
            // capture-level-update/gated-recording-update below -- relayed
            // by src/main/index.ts's subscribeToLinkTempoChanged onto
            // 'engine-link-tempo-changed', exposed to the renderer via
            // preload's onLinkTempoChanged, and adopted into state.bpm by
            // StoreContext.tsx's inbound listener (kept next to that
            // effect's own outbound state.bpm sync -- see its doc comment
            // there for the feedback-loop analysis).
            if (const auto changedBpm = linkSession.checkForExternalTempoChange())
            {
                juce::DynamicObject::Ptr payload = new juce::DynamicObject();
                payload->setProperty("bpm", *changedBpm);
                juce::DynamicObject::Ptr obj = new juce::DynamicObject();
                obj->setProperty("type", "link-tempo-changed");
                obj->setProperty("payload", juce::var(payload.get()));
                sendJson(juce::var(obj.get()));
            }
            return;
        }

        // timerID == kPositionTimerId from here on -- unchanged from before
        // this class became a MultiTimer, see this method's own doc comment
        // (.h) for why the split was needed.
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "position-update");
        juce::DynamicObject::Ptr payload = new juce::DynamicObject();
        payload->setProperty("pos", transport.currentPositionBars());
        obj->setProperty("payload", juce::var(payload.get()));
        sendJson(juce::var(obj.get()));

        // Piggybacks on the same 30Hz timer rather than a second one -- see
        // this method's own doc comment on why one shared cadence is enough
        // for both pushes. Only fires while a recording is actually armed
        // (armedRecorder is only non-null between arm-recording and the next
        // disarm-recording/re-arm/teardown -- see its own doc comment in
        // IpcServer.h), so an idle/non-recording client never receives this
        // message type at all.
        if (armedRecorder)
        {
            juce::DynamicObject::Ptr capPayload = new juce::DynamicObject();
            capPayload->setProperty("channelId", armedChannelId);
            juce::Array<juce::var> peaksVar;
            // Fixed-width buckets (see peaksFixedWindow's own doc comment)
            // rather than peaksSoFar's rescale-to-N-buckets -- a bucket's
            // value never changes once returned, so the renderer's overlay
            // can draw each one once and leave it alone instead of visibly
            // reshaping already-drawn portions on every poll. 0.05s (50ms)
            // per bucket: fine enough to feel responsive at the ~33ms poll
            // rate below, coarse enough not to flood the IPC payload during
            // a multi-minute take. ChannelRow.tsx's LIVE_CAPTURE_BUCKET_SECONDS
            // must match this exactly -- it derives the overlay's pixel
            // width from bucket count, not from elapsedSeconds below.
            for (float peak : armedRecorder->peaksFixedWindow(0.05))
                peaksVar.add(peak);
            capPayload->setProperty("peaksSoFar", peaksVar);
            // Lets the renderer size the live overlay to match how long
            // the take has actually grown to, rather than the recording
            // loop region's own fixed bounds -- capture length is no
            // longer tied to the loop region at all (see LoopRecorder's
            // own doc comment), so a fixed-width overlay would otherwise
            // have to squish an ever-growing recording into the same
            // fixed pixel span, visually "shrinking" everything already
            // drawn every time more gets captured.
            capPayload->setProperty("elapsedSeconds", armedRecorder->elapsedSeconds());
            juce::DynamicObject::Ptr capObj = new juce::DynamicObject();
            capObj->setProperty("type", "capture-level-update");
            capObj->setProperty("payload", juce::var(capPayload.get()));
            sendJson(juce::var(capObj.get()));
        }

        // Same piggyback-on-the-existing-30Hz-timer reasoning as the
        // armedRecorder push above, for the gated (threshold-triggered)
        // recording feature -- see GatedLoopRecorder::peaks' own doc
        // comment for why this always spans the WHOLE fixed buffer rather
        // than "how much captured so far." 128 buckets matches this app's
        // own standard waveform resolution elsewhere (see
        // @shared/visuals.ts's peaksFromChannel default and the 0-128
        // viewBox every Waveform-style SVG already uses), so the
        // renderer's live overlay can reuse the exact same rendering path
        // as a finished clip's own waveform.
        if (gatedRecorder)
        {
            juce::DynamicObject::Ptr gatedPayload = new juce::DynamicObject();
            juce::Array<juce::var> peaksVar;
            for (float peak : gatedRecorder->peaks(128))
                peaksVar.add(peak);
            gatedPayload->setProperty("peaks", peaksVar);
            juce::DynamicObject::Ptr gatedObj = new juce::DynamicObject();
            gatedObj->setProperty("type", "gated-recording-update");
            gatedObj->setProperty("payload", juce::var(gatedPayload.get()));
            sendJson(juce::var(gatedObj.get()));
        }
    }

    void IpcConnection::messageReceived(const juce::MemoryBlock& message)
    {
        auto text = juce::String::fromUTF8((const char*) message.getData(), (int) message.getSize());
        auto parsed = juce::JSON::parse(text);
        if (!parsed.isObject())
            return;
        auto type = parsed.getProperty("type", "").toString();
        auto payload = parsed.getProperty("payload", juce::var());

        if (type == "load-project")
        {
            EngineProject project;
            juce::String error;
            const auto payloadJson = juce::JSON::toString(payload, true);
            if (parseEngineProject(payloadJson, project, error))
            {
                transport.setBpm(project.bpm);
                // Pushes sssketch's own current project tempo out to the
                // Link session (see LinkSession's own doc comment for the
                // one-way sync direction and why) -- hooked onto this
                // existing per-project-change handler rather than a new
                // periodic timer, deliberately: the position-update timer
                // (see timerCallback below) only runs while playing
                // (started/stopped by the play/pause/stop handlers
                // further down), so piggybacking tempo sync onto it would
                // silently stop syncing the instant playback pauses --
                // exactly the opposite of what a "stay in sync" feature
                // should do. load-project fires on every real project
                // state change regardless of play state, which is what
                // "sssketch's own tempo changed" actually means here.
                linkSession.syncTempo(project.bpm);
                transport.setLoopLengthBars(project.loopLengthBars);
                engine.setProject(project);
                // The ENTIRE mechanism by which a live override (set via
                // set-live-param, above) eventually gets cleared -- no
                // explicit "clear" message is ever sent by the renderer's
                // own drag handlers, deliberately: the override holds the
                // exact final dragged value until precisely this point, so
                // by the time it's cleared here the fresh snapshot just
                // published one line up already agrees with it, making the
                // handoff inaudible. See LiveParamOverrides.h's own doc
                // comment for the fuller reasoning. Not a joint atomic
                // transaction with setProject() above -- there's a
                // theoretical nanosecond-to-microsecond window where
                // renderBlock() could observe the new snapshot with a still-
                // stale override, practically negligible at that timescale
                // and correct for the intended drag-commit handoff either
                // way.
                engine.liveOverrides().clearAll();

                std::vector<juce::String> channelIds;
                for (const auto& rifff : project.rifffs)
                {
                    if (std::find(channelIds.begin(), channelIds.end(), rifff.channelId) == channelIds.end())
                        channelIds.push_back(rifff.channelId);
                }
                channelChains.updateChannelSet(channelIds);
                channelChains.setBpm(project.bpm);
            }
            else
            {
                juce::Logger::writeToLog("IpcConnection: load-project failed: " + error);
            }
        }
        else if (type == "play")
        {
            const double fromPos = payload.isObject() ? (double) payload.getProperty("fromPos", 0.0) : 0.0;
            transport.play(fromPos);
            // ~33ms (~30Hz) position-update push rate — matches the renderer's
            // existing ~60fps rAF poll closely enough for a smooth playhead
            // without flooding the socket. kLinkPollTimerId is untouched here
            // -- it runs independent of play state, started once in the
            // constructor.
            startTimer(kPositionTimerId, 33);
        }
        else if (type == "pause")
        {
            transport.pause();
            stopTimer(kPositionTimerId);
        }
        else if (type == "stop")
        {
            transport.stop();
            stopTimer(kPositionTimerId);
        }
        else if (type == "set-position")
        {
            const double pos = payload.isObject() ? (double) payload.getProperty("pos", 0.0) : 0.0;
            transport.setPosition(pos);
        }
        else if (type == "set-loop-region")
        {
            // Drives Transport's playback wrap directly from the
            // renderer's own loopRegion, independent of arm/disarm --
            // per feedback during manual testing, the loop should apply
            // "at all times" once a region is drawn, not only while a
            // channel happens to be armed. arm-recording/disarm-recording
            // still touch these same bounds too (arm-recording to pick up
            // whatever's current at that exact moment even if this
            // message's own round-trip hasn't landed yet; disarm-recording
            // deliberately no longer clears them -- see its own comment),
            // but this is the live path that fires on every drag tick.
            // endBar <= startBar (0/0 when loopRegion is null) disables
            // wrapping, same convention as setRecordingLoop everywhere
            // else.
            const double startBar = payload.isObject() ? (double) payload.getProperty("startBar", 0.0) : 0.0;
            const double endBar = payload.isObject() ? (double) payload.getProperty("endBar", 0.0) : 0.0;
            transport.setRecordingLoop(startBar, endBar);
        }
        else if (type == "set-live-param")
        {
            // Bypasses EngineProject/setProject() entirely -- see
            // LiveParamOverrides.h's own doc comment for why. A negative
            // `value` clears this key, matching this wire format's
            // existing sentinel convention for "unset" numeric fields (e.g.
            // EngineStem::startBarOverride/trimEndSec both use -1 the same
            // way). Also treats an EXPLICIT JSON null the same as clearing
            // -- juce::var::getProperty's own default only applies when the
            // key is absent, not when it's present but null (a present
            // null is itself a "void" var, not the -1.0 default), so
            // without this check a caller sending `value: null` (the wire
            // contract documented in this feature's own design doc) would
            // silently produce an override of 0.0 instead of clearing.
            if (payload.isObject())
            {
                const auto field = payload.getProperty("field", "").toString();
                const auto key = payload.getProperty("key", "").toString();
                const auto rawValueVar = payload.getProperty("value", -1.0);
                const std::optional<float> value =
                    (rawValueVar.isVoid() || rawValueVar.isUndefined() || (double) rawValueVar < 0.0)
                        ? std::nullopt
                        : std::optional<float>((float) rawValueVar);
                if (field == "volume")
                    engine.liveOverrides().setVolumeOverride(key, value);
                else if (field == "fadeIn")
                    engine.liveOverrides().setFadeInOverride(key, value);
                else if (field == "fadeOut")
                    engine.liveOverrides().setFadeOutOverride(key, value);
            }
        }
        else if (type == "list-input-devices")
        {
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            juce::Array<juce::var> namesVar;
            for (const auto& name : transport.availableInputDeviceNames())
                namesVar.add(name);
            payloadObj->setProperty("devices", namesVar);
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "input-devices-list");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "list-output-devices")
        {
            // Mirrors list-input-devices above exactly, for the settings
            // menu's output-device dropdown.
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            juce::Array<juce::var> namesVar;
            for (const auto& name : transport.availableOutputDeviceNames())
                namesVar.add(name);
            payloadObj->setProperty("devices", namesVar);
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "output-devices-list");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "set-output-device")
        {
            // Direct, standalone switch -- unlike setRecordingInputDevice
            // (only ever called as part of arm-recording, bundled with
            // starting a take), there's no "arm" concept on the output
            // side, so this just applies immediately and reports success/
            // error, same convention as bake-stem-result elsewhere in this
            // file.
            const auto deviceName =
                payload.isObject() ? payload.getProperty("deviceName", "").toString() : juce::String();
            const auto error = transport.setOutputDevice(deviceName);
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            payloadObj->setProperty("success", error.isEmpty());
            if (error.isNotEmpty()) payloadObj->setProperty("error", error);
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "set-output-device-result");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "get-buffer-size")
        {
            // Request/response, fetched on-demand -- same convention as
            // get-link-status above, used to populate the settings menu's
            // buffer-size dropdown with the engine's actual current value
            // on open rather than a hardcoded guess.
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            payloadObj->setProperty("bufferSize", transport.currentBlockSize());
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "buffer-size");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "set-buffer-size")
        {
            // Direct, standalone switch, same immediate-apply convention
            // as set-output-device above -- there's no "arm" concept for
            // buffer size either.
            const int bufferSize =
                payload.isObject() ? (int) payload.getProperty("bufferSize", 0) : 0;
            const auto error = transport.setBufferSize(bufferSize);
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            payloadObj->setProperty("success", error.isEmpty());
            if (error.isNotEmpty()) payloadObj->setProperty("error", error);
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "set-buffer-size-result");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "set-link-enabled")
        {
            const bool enabled = payload.isObject() && (bool) payload.getProperty("enabled", false);
            linkSession.setEnabled(enabled);
            // Asserts sssketch's own current tempo into the session right
            // away on enable, rather than waiting for the next incidental
            // load-project to happen to carry a tempo CHANGE (syncTempo's
            // own steady-state comparison can't tell "I just joined a
            // session that already had a different tempo" apart from "a
            // peer nudged it" -- see LinkSession::pushTempoNow's own doc
            // comment for the full reasoning). Without this, enabling
            // Link while joining an existing session (e.g. hardware
            // already running at its own tempo) silently did nothing
            // audible -- a real reported bug.
            if (enabled) linkSession.pushTempoNow(transport.currentBpm());
        }
        else if (type == "get-link-status")
        {
            // Request/response, not a periodic push -- same "fetched
            // on-demand, not continuously streamed" convention as
            // list-input-devices above. The renderer polls this on its
            // own slow timer (no need for anything faster than a human
            // glancing at a peer count), matching this project's own
            // established pattern for anything that isn't the
            // playhead/capture-level pushes actually needing sub-second
            // freshness.
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            payloadObj->setProperty("enabled", linkSession.isEnabled());
            payloadObj->setProperty("numPeers", (int) linkSession.numPeers());
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "link-status");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "arm-recording")
        {
            if (!payload.isObject())
                return;
            const auto channelId = payload.getProperty("channelId", "").toString();
            const auto deviceName = payload.getProperty("deviceName", "").toString();
            const double startBar = (double) payload.getProperty("startBar", 0.0);
            const double endBar = (double) payload.getProperty("endBar", 0.0);

            const auto error = transport.setRecordingInputDevice(deviceName);
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            if (error.isNotEmpty() || endBar <= startBar || transport.currentBpm() <= 0.0)
            {
                payloadObj->setProperty("success", false);
                payloadObj->setProperty(
                    "error", error.isNotEmpty() ? error : juce::String("invalid loop region"));
            }
            else
            {
                // Detach whatever's currently referenced by Transport FIRST,
                // and move any previously-armed recorder into
                // previousRecorder rather than letting armedRecorder's
                // reassignment below destroy it in place -- a re-arm
                // without an intervening disarm would otherwise free the
                // old LoopRecorder while the audio thread could still be
                // mid-callback with Transport's (not-yet-updated) raw
                // pointer to it, a real use-after-free window. Deferring
                // the actual free to the NEXT disarm/re-arm (see
                // previousRecorder's own doc comment) gives the audio
                // thread ample time -- several callbacks, each a few
                // milliseconds -- to have already observed the
                // just-stored nullptr before anything is actually freed.
                transport.setLoopRecorder(nullptr);
                previousRecorder = std::move(armedRecorder);
                armedChannelId = channelId;
                // No longer sized to the loop region's own length -- see
                // LoopRecorder's own doc comment: a take's length is
                // whatever arm-to-disarm turns out to be, not tied to
                // completing a loop pass.
                armedRecorder = std::make_unique<LoopRecorder>(transport.currentSampleRate());
                transport.setRecordingLoop(startBar, endBar);
                // Jump playback to the loop start HERE, synchronously with
                // arming, rather than relying on a separate later IPC
                // message from the renderer (the old approach). writeBlock()
                // captures raw input unconditionally from the very next
                // audio callback regardless of transport position, so any
                // gap between "recording started" and "playback actually
                // reached startBar" is a real, audible mismatch: whatever
                // the performer heard/played during that gap gets captured
                // but is still placed on the timeline as if it began exactly
                // at startBar. transport.play() jumps position instantly (no
                // crossfade) and unconditionally starts playing -- unlike
                // transport.setPosition(), which is designed for smooth
                // mid-listen scrubbing and fades over several blocks, wrong
                // for "the take starts now." Calling this every arm (even if
                // already playing) is intentional: it guarantees capture and
                // the audible backing track are aligned to the same instant.
                transport.play(startBar);
                transport.setLoopRecorder(armedRecorder.get());
                payloadObj->setProperty("success", true);
            }
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "arm-recording-result");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "disarm-recording")
        {
            // Detaches the CAPTURE buffer only -- deliberately does NOT
            // call transport.setRecordingLoop(0.0, 0.0) anymore. Playback
            // looping is no longer tied to arm state (see set-loop-region
            // above): disarming should stop RECORDING, not stop the loop
            // itself, which the renderer's own loopRegion continues to
            // drive independently for as long as one is set.
            transport.setLoopRecorder(nullptr);

            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            if (armedRecorder && armedRecorder->hasAnyAudio())
            {
                const auto outputPath = juce::File::getSpecialLocation(juce::File::tempDirectory)
                    .getChildFile("sssketch-recording-" + juce::Uuid().toString() + ".wav")
                    .getFullPathName();
                if (armedRecorder->writeToWavFile(outputPath))
                {
                    payloadObj->setProperty("committed", true);
                    payloadObj->setProperty("path", outputPath);
                    // See Transport::roundTripLatencySamples' own doc comment --
                    // the captured take is delayed by roughly this much relative
                    // to when it was actually played. The renderer subtracts
                    // this from the take's placed startBar to compensate.
                    payloadObj->setProperty(
                        "latencyCompensationBars",
                        Transport::latencySamplesToBars(
                            transport.roundTripLatencySamples(),
                            transport.currentSampleRate(),
                            transport.currentBpm()));
                }
                else
                {
                    payloadObj->setProperty("committed", false);
                    payloadObj->setProperty("error", "failed to write recording to disk");
                }
            }
            else
            {
                payloadObj->setProperty("committed", false);
            }
            // Deferred free, not an immediate reset() -- see
            // previousRecorder's own doc comment and arm-recording's
            // identical handling above for why: the audio thread may
            // still be mid-callback with Transport's raw pointer to this
            // object for a brief window right after setLoopRecorder(nullptr)
            // above, so freeing it here in place would race that.
            previousRecorder = std::move(armedRecorder);
            armedChannelId = {};

            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "disarm-recording-result");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "set-gated-recording-enabled")
        {
            // Endlesss-style threshold-gated recording (see
            // GatedLoopRecorder's own doc comment) -- "recording mode"
            // on/off, independent of the manual arm-recording/
            // disarm-recording flow above. enabled:true (re-)arms a fresh
            // GatedLoopRecorder sized to [startBar, endBar); enabled:false
            // detaches it. Reuses transport's own recordingLoopStartBar/
            // EndBar fields (via setRecordingLoop) as "the currently
            // selected loop region" -- same fields the manual flow also
            // uses, since conceptually there's one active recording-loop
            // region regardless of which mechanism is using it.
            if (!payload.isObject())
                return;
            const bool enabled = (bool) payload.getProperty("enabled", false);
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();

            if (!enabled)
            {
                transport.setGatedRecorder(nullptr);
                // Same deferred-free reasoning as arm-recording/
                // disarm-recording's own previousRecorder handling above --
                // the audio thread may still be mid-callback with
                // Transport's raw pointer to this object for a brief
                // window right after setGatedRecorder(nullptr).
                previousGatedRecorder = std::move(gatedRecorder);
                payloadObj->setProperty("success", true);
            }
            else
            {
                const double startBar = (double) payload.getProperty("startBar", 0.0);
                const double endBar = (double) payload.getProperty("endBar", 0.0);
                const double loopBars = endBar - startBar;
                const auto deviceName = payload.getProperty("deviceName", "").toString();

                // Selects the user's chosen input device BEFORE arming --
                // mirrors arm-recording's identical handling above. Without
                // this call, gated recording silently captured from
                // whatever device the AudioDeviceManager already happened
                // to have open (the OS/JUCE startup default, typically the
                // built-in mic) instead of whatever the renderer's own
                // device dropdown showed as selected -- a real reported
                // bug. See useGatedRecordingControls.ts's enableGatedRecording
                // for how deviceName is sourced from state.selectedInputDevice
                // on the renderer side.
                const auto error = transport.setRecordingInputDevice(deviceName);

                // Defensive, mirrors the renderer's own UI gating (the
                // control is disabled unless a loop region is selected and
                // is <=16 bars) -- kept here too so a stale or malformed
                // request can't silently arm an oversized/invalid buffer.
                // Combined with the device-switch error exactly like
                // arm-recording above: a bad/missing device fails the WHOLE
                // operation rather than proceeding to arm against
                // whatever device happened to already be open.
                if (error.isNotEmpty() || loopBars <= 0.0 || loopBars > 16.0 || transport.currentBpm() <= 0.0)
                {
                    payloadObj->setProperty("success", false);
                    payloadObj->setProperty(
                        "error", error.isNotEmpty() ? error : juce::String("invalid loop region for gated recording"));
                }
                else
                {
                    const double secPerBar = (60.0 / transport.currentBpm()) * 4.0;
                    transport.setGatedRecorder(nullptr);
                    previousGatedRecorder = std::move(gatedRecorder);
                    gatedRecorder = std::make_unique<GatedLoopRecorder>(
                        transport.currentSampleRate(), loopBars, secPerBar);
                    transport.setRecordingLoop(startBar, endBar);
                    transport.setGatedRecorder(gatedRecorder.get());
                    payloadObj->setProperty("success", true);
                }
            }

            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "set-gated-recording-enabled-result");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "capture-gated-take")
        {
            // Commits whatever's currently in the gated buffer (silence
            // where nothing's been captured this lap) as a take, WITHOUT
            // touching gatedRecorder/Transport's attachment at all --
            // "locking in" a take must not stop or reset ongoing capture
            // (see GatedLoopRecorder's own doc comment): it keeps
            // listening for the next lap immediately afterward, and
            // playback is untouched throughout.
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            if (gatedRecorder)
            {
                const auto outputPath = juce::File::getSpecialLocation(juce::File::tempDirectory)
                    .getChildFile("sssketch-gated-take-" + juce::Uuid().toString() + ".wav")
                    .getFullPathName();
                if (gatedRecorder->writeToWavFile(outputPath))
                {
                    payloadObj->setProperty("committed", true);
                    payloadObj->setProperty("path", outputPath);
                    // Same round-trip latency compensation as
                    // disarm-recording's own handling above -- see
                    // Transport::roundTripLatencySamples' own doc comment.
                    payloadObj->setProperty(
                        "latencyCompensationBars",
                        Transport::latencySamplesToBars(
                            transport.roundTripLatencySamples(),
                            transport.currentSampleRate(),
                            transport.currentBpm()));
                }
                else
                {
                    payloadObj->setProperty("committed", false);
                    payloadObj->setProperty("error", "failed to write gated take to disk");
                }
            }
            else
            {
                payloadObj->setProperty("committed", false);
                payloadObj->setProperty("error", "gated recording is not enabled");
            }

            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "capture-gated-take-result");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "set-metronome")
        {
            const bool enabled = payload.isObject() && (bool) payload.getProperty("enabled", false);
            engine.setMetronomeEnabled(enabled);
        }
        else if (type == "load-master-plugin")
        {
            if (!payload.isObject())
                return;
            const int slot = (int) payload.getProperty("slot", -1);
            const auto pluginId = payload.getProperty("pluginId", "").toString();
            const auto path = payload.getProperty("path", "").toString();
            const auto stateBase64 = payload.getProperty("stateBase64", "").toString();
            if (slot < 0 || slot >= kNumMasterChainSlots)
                return;

            // Use the real device's own sample rate / block size, not a
            // hardcoded guess -- prepareToPlay()'ing a plugin for the wrong
            // block size means processBlock() can later be called with a
            // buffer larger than it allocated internal storage for
            // (undefined behaviour, often a crash that takes the whole
            // engine process down, silencing the dry mix too).
            //
            // requestLoad's onLoaded callback fires on the message thread
            // (see PluginChain::requestLoad's own doc comment -- plugin
            // instantiation can't safely happen on an arbitrary background
            // thread, since some plugins' init code touches macOS UI-toolkit
            // APIs that assert they're on the main thread), which is also
            // where IpcConnection itself always runs, so sendJson can be
            // called directly here with no further thread-hop needed.
            //
            // pluginId is only carried through to the reply below (the
            // renderer needs it to know which catalog entry succeeded) --
            // requestLoad itself only needs a real path to load.
            masterChain.requestLoad(slot, path, transport.currentSampleRate(), transport.currentBlockSize(),
                [this, slot, pluginId](bool success, const juce::String& error)
                {
                    juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
                    payloadObj->setProperty("slot", slot);
                    payloadObj->setProperty("pluginId", pluginId);
                    payloadObj->setProperty("success", success);
                    if (!success)
                        payloadObj->setProperty("error", error);
                    juce::DynamicObject::Ptr obj = new juce::DynamicObject();
                    obj->setProperty("type", "master-plugin-loaded");
                    obj->setProperty("payload", juce::var(payloadObj.get()));
                    sendJson(juce::var(obj.get()));
                },
                stateBase64);
        }
        else if (type == "open-master-plugin-editor")
        {
            if (!payload.isObject())
                return;
            const int slot = (int) payload.getProperty("slot", -1);
            masterChain.openEditorWindow(slot);
        }
        else if (type == "close-master-plugin-editor")
        {
            if (!payload.isObject())
                return;
            const int slot = (int) payload.getProperty("slot", -1);
            masterChain.closeEditorWindow(slot);
        }
        else if (type == "load-channel-plugin")
        {
            if (!payload.isObject())
                return;
            const auto channelId = payload.getProperty("channelId", "").toString();
            const int slot = (int) payload.getProperty("slot", -1);
            const auto pluginId = payload.getProperty("pluginId", "").toString();
            const auto path = payload.getProperty("path", "").toString();
            const auto stateBase64 = payload.getProperty("stateBase64", "").toString();
            if (slot < 0 || slot >= kNumChannelChainSlots)
                return;

            channelChains.requestLoad(channelId, slot, path, transport.currentSampleRate(), transport.currentBlockSize(),
                [this, channelId, slot, pluginId](bool success, const juce::String& error)
                {
                    juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
                    payloadObj->setProperty("channelId", channelId);
                    payloadObj->setProperty("slot", slot);
                    payloadObj->setProperty("pluginId", pluginId);
                    payloadObj->setProperty("success", success);
                    if (!success)
                        payloadObj->setProperty("error", error);
                    juce::DynamicObject::Ptr obj = new juce::DynamicObject();
                    obj->setProperty("type", "channel-plugin-loaded");
                    obj->setProperty("payload", juce::var(payloadObj.get()));
                    sendJson(juce::var(obj.get()));
                },
                stateBase64);
        }
        else if (type == "open-channel-plugin-editor")
        {
            if (!payload.isObject())
                return;
            const auto channelId = payload.getProperty("channelId", "").toString();
            const int slot = (int) payload.getProperty("slot", -1);
            channelChains.openEditorWindow(channelId, slot);
        }
        else if (type == "close-channel-plugin-editor")
        {
            if (!payload.isObject())
                return;
            const auto channelId = payload.getProperty("channelId", "").toString();
            const int slot = (int) payload.getProperty("slot", -1);
            channelChains.closeEditorWindow(channelId, slot);
        }
        else if (type == "get-plugin-states")
        {
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();

            juce::Array<juce::var> masterStatesVar;
            for (int slot = 0; slot < kNumMasterChainSlots; ++slot)
                masterStatesVar.add(masterChain.captureStateBase64(slot));
            payloadObj->setProperty("masterChain", masterStatesVar);

            juce::Array<juce::var> channelChainsVar;
            for (const auto& channelId : channelChains.knownChannelIds())
            {
                auto* chain = channelChains.chainFor(channelId);
                if (chain == nullptr)
                    continue; // raced with a concurrent updateChannelSet -- skip, matches this feature's own "best-effort capture" scope
                juce::DynamicObject::Ptr entryObj = new juce::DynamicObject();
                entryObj->setProperty("channelId", channelId);
                juce::Array<juce::var> slotsVar;
                for (int slot = 0; slot < kNumChannelChainSlots; ++slot)
                    slotsVar.add(chain->captureStateBase64(slot));
                entryObj->setProperty("slots", slotsVar);
                channelChainsVar.add(juce::var(entryObj.get()));
            }
            payloadObj->setProperty("channelChains", channelChainsVar);

            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "plugin-states");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "render-export")
        {
            if (!payload.isObject())
            {
                sendJson(makeRenderExportResult(false, "render-export payload must be an object"));
                return;
            }
            const auto outputPath = payload.getProperty("outputPath", "").toString();
            const auto durationBars = (double) payload.getProperty("durationBars", 0.0);

            // Reuses whatever project was most recently set via load-project — the same
            // "load-project, then act on it" sequencing IPC clients already use for
            // play/pause/set-position, kept consistent rather than inventing a second
            // way to pass project data just for this one message type.
            juce::String error;
            const bool ok = renderProjectToWavFile(engine.currentProjectForExport(), outputPath, durationBars, error);
            sendJson(makeRenderExportResult(ok, ok ? juce::String() : error));
        }
        else if (type == "bake-stem")
        {
            if (!payload.isObject())
            {
                sendJson(makeBakeStemResult(false, 0.0, "bake-stem payload must be an object"));
                return;
            }
            const auto sourcePath = payload.getProperty("path", "").toString();
            const auto outputPath = payload.getProperty("outputPath", "").toString();
            const double rotationSec = (double) payload.getProperty("rotationSec", 0.0);

            juce::String error;
            double durationSec = 0.0;
            const bool ok = bakeStemToWav(sourcePath, rotationSec, outputPath, durationSec, error);
            sendJson(makeBakeStemResult(ok, durationSec, ok ? juce::String() : error));
        }
        else if (type == "quit")
        {
            juce::JUCEApplicationBase::quit();
        }
    }

    IpcServer::IpcServer(PlaybackEngine& e, Transport& t, PluginChain& mc, ChannelChainRegistry& cc)
        : engine(e), transport(t), masterChain(mc), channelChains(cc)
    {
    }

    juce::InterprocessConnection* IpcServer::createConnectionObject()
    {
        return new IpcConnection(engine, transport, masterChain, channelChains);
    }
}

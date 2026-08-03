#include "IpcServer.h"
#include <algorithm>

namespace sssketch
{
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
        : engine(e), transport(t), masterChain(mc), channelChains(cc)
    {
    }

    IpcConnection::~IpcConnection()
    {
        stopTimer();
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
        if (!armedRecorder) return;
        transport.setLoopRecorder(nullptr);
        transport.setRecordingLoop(0.0, 0.0);
        armedRecorder.release();
    }

    void IpcConnection::connectionMade()
    {
        juce::Logger::writeToLog("IpcConnection: client connected");
    }

    void IpcConnection::connectionLost()
    {
        juce::Logger::writeToLog("IpcConnection: client disconnected");
        stopTimer();
        transport.stop();
        detachArmedRecorderOnTeardown();
    }

    void IpcConnection::sendJson(const juce::var& payload)
    {
        const auto text = juce::JSON::toString(payload, true);
        juce::MemoryBlock block(text.toRawUTF8(), text.getNumBytesAsUTF8());
        sendMessage(block);
    }

    void IpcConnection::timerCallback()
    {
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
            // 64, not the original 32 -- bumped per feedback during manual
            // testing asking for finer resolution, closer to (but less
            // detailed than) the real waveform views elsewhere, which use
            // peaksFromChannel's own 128-bucket default (see
            // @shared/visuals.ts). Kept below that rather than matching it
            // exactly -- this is a coarse "building up" indicator sampled
            // live every ~33ms, not a one-shot full-file decode.
            for (float peak : armedRecorder->peaksSoFar(64))
                peaksVar.add(peak);
            capPayload->setProperty("peaksSoFar", peaksVar);
            juce::DynamicObject::Ptr capObj = new juce::DynamicObject();
            capObj->setProperty("type", "capture-level-update");
            capObj->setProperty("payload", juce::var(capPayload.get()));
            sendJson(juce::var(capObj.get()));
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
                transport.setLoopLengthBars(project.loopLengthBars);
                engine.setProject(project);

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
            startTimerHz(30); // position-update push rate — matches the renderer's
                               // existing ~60fps rAF poll closely enough for a smooth
                               // playhead without flooding the socket
        }
        else if (type == "pause")
        {
            transport.pause();
            stopTimer();
        }
        else if (type == "stop")
        {
            transport.stop();
            stopTimer();
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
                const double secPerBarNow = (60.0 / transport.currentBpm()) * 4.0;
                const double loopLengthSeconds = (endBar - startBar) * secPerBarNow;
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
                armedRecorder = std::make_unique<LoopRecorder>(transport.currentSampleRate(), loopLengthSeconds);
                transport.setRecordingLoop(startBar, endBar);
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
            if (armedRecorder && armedRecorder->hasCompletedPass())
            {
                const auto outputPath = juce::File::getSpecialLocation(juce::File::tempDirectory)
                    .getChildFile("sssketch-recording-" + juce::Uuid().toString() + ".wav")
                    .getFullPathName();
                if (armedRecorder->writeToWavFile(outputPath))
                {
                    payloadObj->setProperty("committed", true);
                    payloadObj->setProperty("path", outputPath);
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
                });
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
                });
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

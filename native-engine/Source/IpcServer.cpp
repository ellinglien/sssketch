#include "IpcServer.h"
#include <algorithm>
#include <cmath>

namespace sssketch
{
    namespace
    {
        // MultiTimer IDs for IpcConnection's two independent polling
        // cadences -- see the class's own doc comment (.h) for why a
        // single juce::Timer no longer suffices.
        constexpr int kPositionTimerId = 0; // position-update/capture-level pushes -- ~30Hz, only while playing
        constexpr int kLinkPollTimerId = 1; // LinkSession::checkForExternalTempoChange -- always running
        constexpr int kHaltAckTimerId = 2; // short-lived poll until the audio thread's halt fade is silent

        // ~500ms-1s, per this feature's own design doc -- frequent enough that a
        // peer's tempo nudge reaches Maschine/Ableton/etc. via sssketch within
        // roughly a second, infrequent enough that a captureAppSessionState()
        // call every tick would be wasteful (Link's own docs note it's
        // real-time-unsafe but message-thread-cheap; still no reason to do it
        // 30x/sec when nothing needs sub-second freshness here, unlike the
        // playhead).
        constexpr int kLinkPollIntervalMs = 750;
        constexpr int kHaltAckPollIntervalMs = 2;
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

    IpcConnection::IpcConnection(PlaybackEngine& e, Transport& t, PluginChain& mc, ChannelChainRegistry& cc,
        bool linkEnabled)
        : engine(e), transport(t), masterChain(mc), channelChains(cc), linkSession(t.currentBpm(), linkEnabled)
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
        stopTimer(kHaltAckTimerId);
        // Same reasoning as connectionLost below -- this object is going
        // away, and a staged swap it will never be able to ack must not
        // outlive it.
        engine.cancelStagedProject();
        engine.drainRetiredProject();
        transport.setStagedLoopLengthBars(-1.0);
        transport.setStagedApplyAtBars(-1.0);
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
        stopTimer(kHaltAckTimerId);
        transport.stop();
        // Nothing left to ack it to, and a swap firing on behalf of a
        // client that has gone away is nobody's intent. The engine's
        // retirement slot is collected here too, so the last swap's
        // outgoing project doesn't sit allocated until the next client.
        engine.cancelStagedProject();
        engine.drainRetiredProject();
        stagedToken = -1;
        stagedProject = {};
        transport.setStagedLoopLengthBars(-1.0);
        transport.setStagedApplyAtBars(-1.0);
        detachArmedRecorderOnTeardown();
    }

    void IpcConnection::applyProjectTransportSettings(const EngineProject& project)
    {
        transport.setBpm(project.bpm);
        // Pushes sssketch's own current project tempo out to the Link
        // session (see LinkSession's own doc comment for the one-way sync
        // direction and why) -- hooked onto the per-project-change path
        // rather than a new periodic timer, deliberately: the
        // position-update timer (see timerCallback) only runs while
        // playing (started/stopped by the play/pause/stop handlers), so
        // piggybacking tempo sync onto it would silently stop syncing the
        // instant playback pauses -- exactly the opposite of what a "stay
        // in sync" feature should do. A project change fires regardless of
        // play state, which is what "sssketch's own tempo changed"
        // actually means here.
        linkSession.syncTempo(project.bpm);
        transport.setLoopLengthBars(project.loopLengthBars);
    }

    void IpcConnection::applyProjectPostPublish(const EngineProject& project)
    {
        // The ENTIRE mechanism by which a live override (set via
        // set-live-param) eventually gets cleared -- no explicit "clear"
        // message is ever sent by the renderer's own drag handlers,
        // deliberately: the override holds the exact final dragged value
        // until precisely this point, so by the time it's cleared here the
        // fresh snapshot already agrees with it, making the handoff
        // inaudible. See LiveParamOverrides.h's own doc comment for the
        // fuller reasoning. Not a joint atomic transaction with the
        // publish -- there's a theoretical nanosecond-to-microsecond
        // window where renderBlock() could observe the new snapshot with a
        // still-stale override, practically negligible at that timescale
        // and correct for the intended drag-commit handoff either way.
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

    void IpcConnection::sendStageResult(int token, const juce::String& status, const juce::String& reason)
    {
        juce::DynamicObject::Ptr payload = new juce::DynamicObject();
        payload->setProperty("token", token);
        payload->setProperty("status", status);
        if (reason.isNotEmpty())
            payload->setProperty("reason", reason);
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "project-stage-result");
        obj->setProperty("payload", juce::var(payload.get()));
        sendJson(juce::var(obj.get()));
    }

    juce::String IpcConnection::audioThreadApplyVia() const
    {
        return transport.lastStagedApplyWasAtRequestedBar() ? "bar" : "wrap";
    }

    void IpcConnection::finishStagedApply(const juce::String& via, double atBars)
    {
        // Deliberately AFTER the swap, not before it. updateChannelSet is
        // message-thread-only -- it waits out a grace period for in-flight
        // audio-thread readers before retiring the old map (see
        // ChannelChainRegistry's class doc comment) -- and must never become
        // reachable from the audio callback; running it early would also
        // tear down a channel's plugin chain a whole lap before the
        // project that stopped using it actually went live. A channel that
        // only the new project has is a passthrough for the few
        // milliseconds until this runs, which is exactly what a channel
        // with no chain published already means everywhere else.
        applyProjectTransportSettings(stagedProject);
        applyProjectPostPublish(stagedProject);

        juce::DynamicObject::Ptr payload = new juce::DynamicObject();
        payload->setProperty("token", stagedToken);
        payload->setProperty("via", via);
        payload->setProperty("atBars", atBars);
        payload->setProperty("deferrals", (int) engine.stagedDeferralCount());
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "project-applied");
        obj->setProperty("payload", juce::var(payload.get()));
        sendJson(juce::var(obj.get()));

        juce::Logger::writeToLog(
            "[radio-stage] applied token " + juce::String(stagedToken) + " via " + via
            + " at " + juce::String(atBars, 4) + "bar"); // TEMP (2026-09-29), see stemDecodeCount()

        stagedToken = -1;
        stagedProject = {};
        transport.setStagedLoopLengthBars(-1.0);
        transport.setStagedApplyAtBars(-1.0);
    }

    void IpcConnection::resolveStagedBefore(const juce::String& reason)
    {
        // The cancel and the answer are the same operation on purpose: the
        // audio thread may be taking the staged project at this exact
        // moment, and only the operation that tried to stop it can say
        // whether it did.
        if (engine.cancelStagedProject())
        {
            sendStageResult(stagedToken, "cancelled", reason);
            stagedToken = -1;
            stagedProject = {};
            transport.setStagedLoopLengthBars(-1.0);
            transport.setStagedApplyAtBars(-1.0);
            return;
        }

        // Too late -- it already went live. The client gets the same pair
        // of acks it would have got if nothing had superseded it, so
        // whatever is waiting on project-applied is not left hanging, and
        // the side effects that swap still needs get run.
        sendStageResult(stagedToken, "applied", reason);
        lastSeenStagedApplies = engine.stagedApplyCount();
        finishStagedApply(audioThreadApplyVia(), transport.lastStagedApplyPositionBars());
    }

    void IpcConnection::pumpStagedProject()
    {
        // Unconditional and first: this is the message thread taking back
        // whatever the audio thread retired at the last swap, and it is
        // what keeps the NEXT swap from having to defer. Costs one relaxed
        // bool load when there is nothing to collect.
        engine.drainRetiredProject();
        // Same deal for plugins: every chain slot whose plugin the audio
        // thread swapped out parks the outgoing one for exactly this, so
        // plugins are destroyed here on the message thread, and that slot's
        // next swap stops deferring. One atomic load per slot when idle.
        masterChain.drainRetired();
        channelChains.drainRetired();

        if (stagedToken < 0)
            return;

        const auto applies = engine.stagedApplyCount();
        if (applies != lastSeenStagedApplies)
        {
            lastSeenStagedApplies = applies;
            finishStagedApply(audioThreadApplyVia(), transport.lastStagedApplyPositionBars());
            return;
        }

        // Nothing is going to wrap while the transport isn't running, so
        // waiting would mean waiting forever. A missing change is worse
        // than a late one.
        if (!transport.isPlaying())
        {
            if (engine.promoteStagedProjectNow())
                finishStagedApply("transport-stopped", transport.currentPositionBars());
            else
            {
                // The audio thread won the race between the isPlaying()
                // check and the promote -- it already swapped.
                lastSeenStagedApplies = engine.stagedApplyCount();
                finishStagedApply(audioThreadApplyVia(), transport.lastStagedApplyPositionBars());
            }
            return;
        }

        if (juce::Time::getMillisecondCounterHiRes() >= stageDeadlineMs)
        {
            if (engine.promoteStagedProjectNow())
                finishStagedApply("deadline", transport.currentPositionBars());
            else
            {
                lastSeenStagedApplies = engine.stagedApplyCount();
                finishStagedApply(audioThreadApplyVia(), transport.lastStagedApplyPositionBars());
            }
        }
    }

    void IpcConnection::sendJson(const juce::var& payload)
    {
        const auto text = juce::JSON::toString(payload, true);
        juce::MemoryBlock block(text.toRawUTF8(), text.getNumBytesAsUTF8());
        sendMessage(block);
    }

    void IpcConnection::sendTransportStopped(int token, bool stopped)
    {
        juce::DynamicObject::Ptr payload = new juce::DynamicObject();
        payload->setProperty("token", token);
        payload->setProperty("stopped", stopped);
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "transport-stopped");
        obj->setProperty("payload", juce::var(payload.get()));
        sendJson(juce::var(obj.get()));
    }

    void IpcConnection::timerCallback(int timerID)
    {
        // Both cadences, on purpose. The 30Hz one is the cadence a staged
        // swap actually lands on (it only runs while playing, which is the
        // only time a loop top happens); the 750ms one is what still
        // collects retirements and still enforces the deadline after
        // playback has stopped, when the 30Hz timer isn't running at all.
        pumpStagedProject();

        if (timerID == kHaltAckTimerId)
        {
            // A boolean playing=false is not a sufficient barrier: an older
            // halt callback can briefly publish it while a newer ordered
            // command is still pending. Each waiter is paired to the exact
            // Stop generation the audio thread reports complete.
            const auto completed = transport.completedHaltGeneration();
            for (auto it = pendingHaltAcks.begin(); it != pendingHaltAcks.end();)
            {
                if (it->commandGeneration <= completed)
                {
                    sendTransportStopped(it->token, true);
                    it = pendingHaltAcks.erase(it);
                }
                else
                {
                    ++it;
                }
            }
            if (pendingHaltAcks.empty())
                stopTimer(kHaltAckTimerId);
            return;
        }

        if (timerID == kLinkPollTimerId)
        {
            // CoreAudio exposes a native missed-callback counter through JUCE. Log only the
            // initial reading and changes, so a report of choppy playback immediately tells us
            // whether the device actually missed deadlines without adding any work to the
            // real-time callback or spamming a healthy session's log.
            const int xRuns = transport.currentXRunCount();
            if (xRuns != lastLoggedXRunCount)
            {
                juce::Logger::writeToLog(
                    "Transport: audio health xruns=" + juce::String(xRuns)
                    + ", callback-load="
                    + juce::String(transport.currentCpuUsage() * 100.0, 1) + "%"
                    + ", callback-block=" + juce::String(transport.currentCallbackBlockSize()));
                lastLoggedXRunCount = xRuns;
            }

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
            // A knob turned in an open plugin editor window since the last
            // tick: the project has unsaved plugin settings (the renderer's
            // pluginsTouched.ts, via main's subscribeToPluginEdited). Both
            // consumed, so not ||.
            const bool masterEdited = masterChain.takeEdited();
            const bool channelEdited = channelChains.takeEdited();
            if (masterEdited || channelEdited)
            {
                juce::DynamicObject::Ptr obj = new juce::DynamicObject();
                obj->setProperty("type", "plugin-edited");
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
            // Live per-channel level, not a growing bucket history -- see
            // LoopRecorder::currentPeakL/currentPeakR's own doc comment.
            juce::DynamicObject::Ptr capPayload = new juce::DynamicObject();
            capPayload->setProperty("channelId", armedChannelId);
            capPayload->setProperty("peakL", armedRecorder->currentPeakL());
            capPayload->setProperty("peakR", armedRecorder->currentPeakR());
            juce::DynamicObject::Ptr capObj = new juce::DynamicObject();
            capObj->setProperty("type", "capture-level-update");
            capObj->setProperty("payload", juce::var(capPayload.get()));
            sendJson(juce::var(capObj.get()));
        }

        if (gatedRecorder)
        {
            // Same live-level-not-history shape as capture-level-update
            // above -- see GatedLoopRecorder::currentPeakL/currentPeakR's
            // own doc comment.
            juce::DynamicObject::Ptr gatedPayload = new juce::DynamicObject();
            gatedPayload->setProperty("peakL", gatedRecorder->currentPeakL());
            gatedPayload->setProperty("peakR", gatedRecorder->currentPeakR());
            juce::DynamicObject::Ptr gatedObj = new juce::DynamicObject();
            gatedObj->setProperty("type", "gated-recording-update");
            gatedObj->setProperty("payload", juce::var(gatedPayload.get()));
            sendJson(juce::var(gatedObj.get()));
        }
    }

    void IpcConnection::messageReceived(const juce::MemoryBlock& message)
    {
        // TEMPORARY INSTRUMENTATION (2026-09-28) -- radio stem-change
        // latency. Remove this, the four other tTrace* reads below, the
        // `[radio-engine]` log line, and StemBufferCache's stemDecodeCount()
        // together.
        const auto tTraceEnter = juce::Time::getMillisecondCounterHiRes();
        auto text = juce::String::fromUTF8((const char*) message.getData(), (int) message.getSize());
        auto parsed = juce::JSON::parse(text);
        if (!parsed.isObject())
            return;
        const auto tTraceVarParsed = juce::Time::getMillisecondCounterHiRes();
        auto type = parsed.getProperty("type", "").toString();
        auto payload = parsed.getProperty("payload", juce::var());

        // A third place the message thread gets a chance to collect a
        // retirement and notice a landed swap -- so a client that talks to
        // the engine at all never has to wait for a timer tick, and so the
        // retirement slot is essentially always empty by the time the next
        // loop top arrives.
        pumpStagedProject();

        if (type == "load-project")
        {
            // TEMP -- how far past its own loop top the transport already
            // is when this message lands. The whole point of the
            // measurement: the renderer's own trace stops at the socket
            // write, and this is the other end of it, on the one clock
            // that matters (the transport's).
            static int tTracePushSeq = 0;
            ++tTracePushSeq;
            const auto tTracePos = transport.currentPositionBars();
            const auto tTraceDecodesBefore = stemDecodeCount();

            EngineProject project;
            juce::String error;
            const auto payloadJson = juce::JSON::toString(payload, true);
            const auto tTraceReserialized = juce::Time::getMillisecondCounterHiRes();
            if (parseEngineProject(payloadJson, project, error))
            {
                const auto tTraceProjectParsed = juce::Time::getMillisecondCounterHiRes();
                // An explicit, immediate load supersedes anything waiting
                // for a loop top. engine.setProject() drops the staged
                // snapshot itself (see its own comment); this is only the
                // bookkeeping that lets the client hear about it, and it
                // has to happen BEFORE the publish so the "was it still
                // staged?" answer is the pre-load one.
                // cancelStagedProject(), not hasStagedProject() then a
                // cancel: only the operation that tries to stop it can
                // truthfully say whether it did, and the audio thread may
                // be taking it at this exact moment.
                if (stagedToken >= 0)
                    resolveStagedBefore("load-project");
                // Same order as before this feature existed: transport
                // settings, publish, then the post-publish pair.
                applyProjectTransportSettings(project);
                engine.setProject(project);
                const auto tTraceSetProject = juce::Time::getMillisecondCounterHiRes();
                int tTraceStems = 0;
                for (const auto& r : project.rifffs)
                    tTraceStems += (int) r.stems.size();
                juce::Logger::writeToLog(
                    "[radio-engine #" + juce::String(tTracePushSeq) + "] t "
                    + juce::String(tTraceEnter, 0) + " · pos "
                    + juce::String(tTracePos, 3) + "bar · varParse "
                    + juce::String(tTraceVarParsed - tTraceEnter, 1) + " · reserialize "
                    + juce::String(tTraceReserialized - tTraceVarParsed, 1) + " · projectParse "
                    + juce::String(tTraceProjectParsed - tTraceReserialized, 1) + " · setProject "
                    + juce::String(tTraceSetProject - tTraceProjectParsed, 1) + " (decodes "
                    + juce::String(stemDecodeCount() - tTraceDecodesBefore) + " of "
                    + juce::String(tTraceStems) + " stems) · handler "
                    + juce::String(tTraceSetProject - tTraceEnter, 1) + "ms"); // TEMP (2026-09-28)
                applyProjectPostPublish(project);
            }
            else
            {
                juce::Logger::writeToLog("IpcConnection: load-project failed: " + error);
            }
        }
        else if (type == "stage-project")
        {
            // "Here is the next project. Make it real at the next loop
            // top." The first scheduled message in this protocol -- every
            // other one of the ~29 types is immediate.
            //
            // The payload is { token, project } rather than the project
            // itself, unlike load-project: EngineClient matches replies by
            // message type, not by request id (see engineClient.ts), so
            // without a token a renderer with two changes in flight
            // couldn't tell which ack was which. The nested `project` is
            // byte-for-byte whatever buildEngineProject.ts produced --
            // that wire shape is the hand-synced twin of EngineProject and
            // is deliberately untouched here.
            if (!payload.isObject())
                return;
            const int token = (int) payload.getProperty("token", -1);
            const auto projectVar = payload.getProperty("project", juce::var());

            // Read BEFORE parsing and decoding, because the deadline has
            // to be anchored to when the renderer's change actually
            // arrived, not to whenever staging happened to finish. That is
            // exactly what makes the "the loop top went by while we were
            // still decoding" case resolve as an immediate apply rather
            // than a wait of one more whole lap: the deadline is already
            // in the past by the time we get to check it.
            const auto arrivedAtMs = juce::Time::getMillisecondCounterHiRes();
            const double barsToWrap = transport.barsUntilNextWrap();
            // WHICH boundary this one is aimed at. Absent (or negative)
            // is the loop top, which is every change this feature has
            // handled since b876204. A bar is radio's other landing site:
            // radioGridBars lets a layer of DEFAULT_RADIO_LOOP_END_BARS
            // or fewer turn over on its own 2- or 4-bar boundary, and a
            // bare `cut` carries no curve that would need the loop top,
            // so those land mid-lap. About one change in twenty, and
            // until now the only ones still paying load-project's 20-65ms
            // of lateness.
            //
            // Read here, beside barsToWrap, because the deadline has to
            // be built from whichever of the two this swap is actually
            // waiting for -- a deadline measured to the wrap would let a
            // bar-aimed swap sit for most of a lap after its own bar went
            // by unserved.
            const double requestedBar = payload.hasProperty("atBars")
                ? (double) payload.getProperty("atBars", -1.0)
                : -1.0;
            const double barsToBar =
                requestedBar >= 0.0 ? transport.barsUntilBar(requestedBar) : -1.0;
            const bool aimedAtBar = barsToBar >= 0.0;
            const double barsToApply = aimedAtBar ? barsToBar : barsToWrap;
            const double liveBpm = transport.currentBpm();
            const double liveSecPerBar = liveBpm > 0.0 ? (60.0 / liveBpm) * 4.0 : 0.0;

            EngineProject project;
            juce::String error;
            if (!parseEngineProject(juce::JSON::toString(projectVar, true), project, error))
            {
                juce::Logger::writeToLog("IpcConnection: stage-project failed: " + error);
                sendStageResult(token, "error", error);
                return;
            }

            // A newer pick supersedes an older staged one. The client is
            // told, rather than left holding a token that will never be
            // answered -- a dropped change the renderer doesn't know about
            // is the worst outcome available here.
            if (stagedToken >= 0)
                resolveStagedBefore("superseded");

            // Four reasons waiting for the boundary is the wrong answer,
            // and all four resolve the same way: do it now, exactly as
            // load-project would have. (1) Nothing is playing, so no wrap
            // will ever come. (2) Nothing wraps at all -- no loop length
            // set. (3) The tempo changes, which is deliberately out of
            // scope for a scheduled swap: adopting a new tempo at the wrap
            // would mean writing Transport::secPerBar and pushing Link
            // from the audio thread, and neither is real-time-safe. Radio
            // swaps layers inside one tempo-matched loop, so (3) never
            // fires for the case this exists for.
            //
            // (4), added with the arbitrary-bar swap: a bar was asked for
            // and it is not ahead of the playhead in this lap -- it went
            // by while the renderer was building, or a seek carried the
            // transport over it. barsUntilBar deliberately refuses to
            // read that as "the same bar, one lap later," which would
            // land the change a whole loop early. Doing it now is what
            // load-project does today, so this case is never worse than
            // the status quo it replaces.
            const bool tempoChanges = std::abs(project.bpm - liveBpm) > 1.0e-9;
            const bool barAlreadyPassed = requestedBar >= 0.0 && !aimedAtBar && barsToWrap >= 0.0;
            const char* immediateReason =
                !transport.isPlaying() ? "not-playing"
                : barsToWrap < 0.0     ? "no-loop"
                : tempoChanges         ? "tempo-change"
                : barAlreadyPassed     ? "bar-passed"
                                       : nullptr;
            if (immediateReason != nullptr)
            {
                engine.setProject(project);
                lastSeenStagedApplies = engine.stagedApplyCount();
                sendStageResult(token, "applied", immediateReason);
                // Both acks, in the same order a scheduled swap sends
                // them, so the renderer has exactly one code path: wait
                // for project-applied. finishStagedApply runs the side
                // effects.
                stagedToken = token;
                stagedProject = project;
                finishStagedApply("immediate", transport.currentPositionBars());
                return;
            }

            // Read BEFORE the stage, not after: the audio thread can hit a
            // loop top between those two lines, and a baseline taken after
            // it would swallow the very edge the ack rides on.
            lastSeenStagedApplies = engine.stagedApplyCount();
            // The target BEFORE the project, not after: the audio thread
            // checks both every block, and the only ordering that can go
            // wrong is the one where a staged project becomes visible
            // while the target it belongs to is still the previous
            // swap's (or absent), which would take it at the wrong
            // boundary. This way round the worst case is the opposite --
            // a target briefly set with nothing staged -- which costs one
            // block's extra renderBlock split and applies nothing.
            transport.setStagedApplyAtBars(aimedAtBar ? requestedBar : -1.0);
            engine.stageProject(project);
            transport.setStagedLoopLengthBars(project.loopLengthBars);
            stagedToken = token;
            stagedProject = project;
            // A margin over the arrival-anchored wait, so the deadline
            // can't beat a loop top that is genuinely about to happen: the
            // audio thread swaps at the wrap itself, but the message
            // thread only NOTICES on its next 30Hz tick, and the transport
            // clock and this wall clock are different clocks.
            constexpr double kStageDeadlineMarginMs = 250.0;
            stageDeadlineMs = arrivedAtMs + barsToApply * liveSecPerBar * 1000.0 + kStageDeadlineMarginMs;
            sendStageResult(token, "staged", {});

            // Staging may itself have run past the loop top it was aiming
            // at (a cold decode is ~90ms, and the renderer may have had
            // very little of the lap left). Apply late rather than wait
            // out another whole lap -- same rule as the deadline, just
            // checked immediately because the answer is already known.
            pumpStagedProject();
        }
        else if (type == "cancel-staged-project")
        {
            // Radio re-checks a pick's eligibility late and can drop it. A
            // stale staged swap must never fire.
            if (!payload.isObject())
                return;
            const int token = (int) payload.getProperty("token", -1);
            // A token that isn't the staged one is a cancel that lost a
            // race with a supersede -- already answered, nothing to do.
            if (stagedToken < 0 || (token >= 0 && token != stagedToken))
                return;

            resolveStagedBefore("requested");
        }
        else if (type == "play")
        {
            // Play explicitly wins over an in-flight stop fade. Resolve any
            // silence waiters as cancelled now, rather than leaving them to
            // time out while the transport keeps playing.
            stopTimer(kHaltAckTimerId);
            for (const auto& pending : pendingHaltAcks)
                sendTransportStopped(pending.token, false);
            pendingHaltAcks.clear();
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
            const auto commandGeneration = transport.stop();
            stopTimer(kPositionTimerId);
            const int token = payload.isObject() ? (int) payload.getProperty("token", -1) : -1;
            if (token >= 0)
            {
                const auto duplicate = std::find_if(
                    pendingHaltAcks.begin(), pendingHaltAcks.end(),
                    [token](const PendingHaltAck& pending) { return pending.token == token; });
                if (duplicate == pendingHaltAcks.end())
                    pendingHaltAcks.push_back({ token, commandGeneration });
                // Even an already-idle transport uses the timer path so the
                // reply is consistently asynchronous and the waiter is
                // installed before it can arrive.
                startTimer(kHaltAckTimerId, kHaltAckPollIntervalMs);
            }
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
                // The master filter's two continuous controls (spec 4A.3).
                // There is exactly one master filter, so `key` is ignored --
                // the renderer sends "" -- and the negative sentinel above
                // clears back to the committed project value just as it does
                // for a stem's volume.
                else if (field == "masterFilterCutoff")
                    engine.liveOverrides().setMasterFilterCutoffOverride(value);
                else if (field == "masterFilterResonance")
                    engine.liveOverrides().setMasterFilterResonanceOverride(value);
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
        else if (type == "get-sound-meters")
        {
            // Request/response, the get-buffer-size convention: the radio sound's master
            // meters, for the sound panel's dev-only readouts (native radio sound plan, Task
            // 13). Each is the value at the end of the last rendered block, dB (<= 0), 0 while
            // its stage is not running. Polled a few times a second while the panel is open in
            // a dev build; nothing else asks.
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            payloadObj->setProperty("glueGrDb", (double) engine.masterGlueGainReductionDb());
            payloadObj->setProperty("pumpDuckDb", (double) engine.pumpDuckDb());
            payloadObj->setProperty("limiterGrDb", (double) engine.masterLimiterGainReductionDb());
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "sound-meters");
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
        else if (type == "preload-stem")
        {
            // Fire-and-forget, no reply at all -- the same shape as
            // set-metronome just below, and deliberately so: the caller
            // (Discover radio's armRadioPick, a whole change-interval before
            // the stem is actually needed) has nothing useful to do with a
            // success or a failure. A failure here costs exactly what today
            // costs, since load-project still loads every stem itself.
            if (!payload.isObject())
                return;
            const auto path = payload.getProperty("path", "").toString();
            // -1 is this wire format's existing "no usable value" sentinel
            // for an optional number (see set-live-param above, and
            // EngineStem::startBarOverride/trimEndSec) -- and is also
            // exactly what StemBufferCache::load already treats as "fall
            // back to the decoded buffer's own length" for the loop-sewing
            // blend point. Passing a duration that does NOT match the one
            // load-project will later pass for the same file would warm an
            // entry blended at a different point, which the later
            // setProject would then happily reuse, so the renderer is
            // responsible for sending the resolved (post-stretch) stem's
            // own duration here -- see PlaybackEngine::preloadStem.
            const double durationSec = (double) payload.getProperty("durationSec", -1.0);
            engine.preloadStem(path, durationSec);
        }
        else if (type == "stage-cycles")
        {
            // Radio fold mode (CycleTable.h): the per-row cycles for the next loop top, or for the
            // next block with `now`. Fire-and-forget, like preload-stem: the renderer stages the
            // next lap's table every lap, and a lost one is corrected by the next. An empty
            // `rows` unfolds everything.
            if (!payload.isObject())
                return;
            std::vector<CycleRow> rows;
            if (const auto* list = payload.getProperty("rows", juce::var()).getArray())
            {
                for (const auto& item : *list)
                {
                    CycleRow row;
                    row.rowKey = cycleKeyOf(item.getProperty("row", "").toString());
                    row.idKey = cycleKeyOf(item.getProperty("id", "").toString());
                    row.bars = (double) item.getProperty("bars", 0.0);
                    row.phaseBars = (double) item.getProperty("phaseBars", 0.0);
                    rows.push_back(row);
                }
            }
            engine.stageCycles(rows, (bool) payload.getProperty("now", false));
        }
        else if (type == "set-metronome")
        {
            const bool enabled = payload.isObject() && (bool) payload.getProperty("enabled", false);
            const float volume = payload.isObject()
                ? (float) payload.getProperty("volume", 1.5)
                : 1.5f;
            engine.setMetronomeEnabled(enabled);
            engine.setMetronomeVolume(volume);
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
            //
            // previousState: the settings of what the slot held before (see
            // PluginChain::LoadCallback) -- the renderer keeps them for an undo.
            masterChain.requestLoad(slot, path, transport.currentSampleRate(), transport.currentBlockSize(),
                [this, slot, pluginId](bool success, const juce::String& error, const juce::String& previousState)
                {
                    juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
                    payloadObj->setProperty("slot", slot);
                    payloadObj->setProperty("pluginId", pluginId);
                    payloadObj->setProperty("success", success);
                    if (!success)
                        payloadObj->setProperty("error", error);
                    if (previousState.isNotEmpty())
                        payloadObj->setProperty("previousState", previousState);
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
                [this, channelId, slot, pluginId](bool success, const juce::String& error, const juce::String& previousState)
                {
                    juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
                    payloadObj->setProperty("channelId", channelId);
                    payloadObj->setProperty("slot", slot);
                    payloadObj->setProperty("pluginId", pluginId);
                    payloadObj->setProperty("success", success);
                    if (!success)
                        payloadObj->setProperty("error", error);
                    if (previousState.isNotEmpty())
                        payloadObj->setProperty("previousState", previousState);
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
        else if (type == "check-plugin-edits")
        {
            // Main asks before a quit and at an autosave: an open editor's
            // plugin whose state changed with no parameter reporting it (an
            // IR loaded) is an edit too (PluginChain::checkWatchedStates).
            // Answers with every edit not pushed yet ('plugin-edited'),
            // consumed here, so main can mark the project unsaved before it
            // decides whether to ask.
            masterChain.checkWatchedStates();
            channelChains.checkWatchedStates();
            const bool masterEdited = masterChain.takeEdited();
            const bool channelEdited = channelChains.takeEdited();
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            payloadObj->setProperty("edited", masterEdited || channelEdited);
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "plugin-edits-checked");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "get-plugin-states")
        {
            // A save, autosave or export capture: first, a change no parameter
            // reported in an open editor's plugin counts as an edit (pushed as
            // 'plugin-edited' on the next tick), and what is captured now is
            // what later checks compare with.
            masterChain.checkWatchedStates();
            channelChains.checkWatchedStates();
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
            // Optional: "float32" for a per-stem render (RenderExport.h's WavSampleFormat);
            // anything else, or absent, is today's 16-bit.
            const auto sampleFormat = payload.getProperty("sampleFormat", "").toString() == "float32"
                ? WavSampleFormat::float32
                : WavSampleFormat::pcm16;

            // Reuses whatever project was most recently set via load-project — the same
            // "load-project, then act on it" sequencing IPC clients already use for
            // play/pause/set-position, kept consistent rather than inventing a second
            // way to pass project data just for this one message type.
            juce::String error;
            const bool ok = renderProjectToWavFile(
                engine.currentProjectForExport(), outputPath, durationBars, error, sampleFormat);
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

    IpcServer::IpcServer(PlaybackEngine& e, Transport& t, PluginChain& mc, ChannelChainRegistry& cc,
        bool linkOn)
        : engine(e), transport(t), masterChain(mc), channelChains(cc), linkEnabled(linkOn)
    {
    }

    juce::InterprocessConnection* IpcServer::createConnectionObject()
    {
        return new IpcConnection(engine, transport, masterChain, channelChains, linkEnabled);
    }
}

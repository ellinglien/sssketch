// native-engine/Source/IpcServer.h
#pragma once
#include "PlaybackEngine.h"
#include "Transport.h"
#include "EngineProject.h"
#include "RenderExport.h"
#include "BakeStem.h"
#include "PluginChain.h"
#include "ChannelChainRegistry.h"
#include "LoopRecorder.h"
#include "GatedLoopRecorder.h"
#include "LinkSession.h"
#include "HaltAck.h"
#include <juce_events/juce_events.h>
#include <memory>
#include <vector>

namespace sssketch
{
    /** One accepted client connection. Handles the Electron -> JUCE messages
     * documented in docs/superpowers/specs/2026-07-28-juce-audio-engine-design.md's
     * IPC protocol section (the Phase 1 subset: load-project, play, pause,
     * stop, set-position), and pushes position-update while playing.
     *
     * private juce::MultiTimer, not plain juce::Timer -- this connection
     * needs independent polling cadences that DON'T share a lifecycle:
     * the existing position-update/capture-level push (kPositionTimerId in
     * IpcServer.cpp, started/stopped around play/pause/stop, ~30Hz) and
     * LinkSession's own external-tempo-change poll (kLinkPollTimerId,
     * started once in the constructor and never stopped until teardown --
     * see LinkSession.h's own doc comment for why tempo detection must
     * keep running independent of play state, same reasoning already
     * established for syncTempo's own OUTBOUND push on load-project).
     * A third, short-lived cadence confirms when Transport's stop fade has
     * actually reached silence for the renderer's preview handoff.
     * MultiTimer still runs all of them on the same message thread via JUCE's
     * existing timer machinery -- no new thread, matching this codebase's
     * real-time-thread discipline (see this repo's own CLAUDE.md); it's
     * the same category of thing as BridgeClient's own separate 500ms
     * juce::Timer elsewhere in this codebase, just using JUCE's built-in
     * multi-cadence facility instead of a second class, since both
     * cadences now live on the same object. */
    class IpcConnection : public juce::InterprocessConnection, private juce::MultiTimer
    {
    public:
        /** `linkEnabled`: whether this connection's LinkSession joins Ableton Link at once
         * (Main.cpp's --link; see LinkSession's constructor for why it is off unless asked). */
        IpcConnection(PlaybackEngine& engine, Transport& transport, PluginChain& masterChain,
            ChannelChainRegistry& channelChains, bool linkEnabled = false);
        ~IpcConnection() override;

        void connectionMade() override;
        void connectionLost() override;
        void messageReceived(const juce::MemoryBlock& message) override;

    private:
        void sendJson(const juce::var& payload);
        void sendTransportStopped(int token, bool stopped);
        // timerID is one of kPositionTimerId/kLinkPollTimerId/
        // kHaltAckTimerId (IpcServer.cpp) --
        // see this class's own doc comment above for why this is a MultiTimer
        // now instead of a single juce::Timer.
        void timerCallback(int timerID) override;
        // Shared by the destructor and connectionLost() -- either can run
        // while a recording is still armed. See its own doc comment (.cpp)
        // for why this deliberately leaks rather than frees synchronously.
        // Detaches both the manual-arm LoopRecorder AND the gated one
        // (below), same reasoning for each.
        void detachArmedRecorderOnTeardown();

        /** Everything a project change does BESIDES publishing the
         * snapshot itself, split at the publish because two of the five
         * things genuinely have to happen after it (see each one's own
         * comment in the .cpp). Shared verbatim by load-project and by a
         * staged swap -- one list, in one order, so the two paths can't
         * drift apart.
         *
         * A staged swap calls both AFTER the audio thread has already done
         * the publish, which is what makes the tempo, the Link push, the
         * override clear and the channel-chain set land up to one timer
         * tick (~33ms) behind the audio. Deliberate: every one of them is
         * message-thread work that is not real-time-safe -- clearAll()
         * allocates, updateChannelSet() rebuilds a map and hands the old
         * one to a background deleter (after waiting out a grace period
         * for in-flight readers, which is exactly why it must never become
         * reachable from the audio callback), and Link's own docs call its session capture
         * real-time-unsafe. Tempo is kept out of a staged swap entirely by
         * the stage-project handler for exactly this reason; the rest are
         * inaudible at that lag (a channel with no chain published is a
         * passthrough, which is what a brand-new channel is anyway). */
        void applyProjectTransportSettings(const EngineProject& project);
        void applyProjectPostPublish(const EngineProject& project);

        /** Called wherever this connection gets a chance to think: both
         * timer cadences and the top of every inbound message. Collects
         * whatever the audio thread retired, notices a staged swap that has
         * landed, and enforces the deadline that stops a staged swap from
         * waiting forever for a loop top that isn't coming. See the
         * stage-project handler for the whole contract. */
        void pumpStagedProject();

        /** Finishes a staged swap that has actually taken effect: runs the
         * message-thread side effects and sends the project-applied ack.
         * `via` is that ack's own field -- "wrap", "bar", "deadline",
         * "transport-stopped" or "immediate". */
        void finishStagedApply(const juce::String& via, double atBars);

        /** Which of the audio thread's own two landing sites the last swap
         * used -- "bar" when the message thread had asked for one with
         * stage-project's `atBars` and the audio thread genuinely landed
         * there, "wrap" otherwise. Asked of the transport rather than
         * remembered here, because a requested bar can still end up
         * landing at a wrap (they shared a block) and the ack has to say
         * what happened, not what was asked for. */
        juce::String audioThreadApplyVia() const;

        void sendStageResult(int token, const juce::String& status, const juce::String& reason);

        /** Settles whatever is currently staged, for every reason one gets
         * settled other than landing on its own: a newer stage superseding
         * it, an explicit load-project overtaking it, or the renderer
         * cancelling it. Either it was stopped in time (one
         * project-stage-result, status cancelled) or it had already gone
         * live (project-stage-result status applied, then the
         * project-applied its client is waiting on) -- never neither, and
         * never a token left unanswered. */
        void resolveStagedBefore(const juce::String& reason);

        PlaybackEngine& engine;
        Transport& transport;
        PluginChain& masterChain;
        ChannelChainRegistry& channelChains;
        // Owns whichever LoopRecorder is currently armed (nullptr = none) --
        // IpcConnection creates/destroys the instance itself in response to
        // arm-recording/disarm-recording, and hands Transport a raw
        // observing pointer via setLoopRecorder (see arm/disarm handling in
        // messageReceived). One at a time, matching this feature's own
        // "at most one armed channel" scope.
        std::unique_ptr<LoopRecorder> armedRecorder;
        juce::String armedChannelId;
        // Holds whatever armedRecorder pointed at just before the most
        // recent disarm/re-arm, kept alive one extra cycle rather than
        // freed immediately -- see messageReceived's disarm-recording/
        // arm-recording handling for why. Overwritten (freeing the
        // PREVIOUS previousRecorder, always safely by then) on each
        // subsequent disarm/re-arm; never read, purely a deferred-deletion
        // holding spot.
        std::unique_ptr<LoopRecorder> previousRecorder;
        // Same ownership/lifetime pattern as armedRecorder/previousRecorder
        // above, for the Endlesss-style threshold-gated recording feature
        // (see GatedLoopRecorder's own doc comment) -- set/cleared by
        // set-gated-recording-enabled, read directly (not via Transport) by
        // capture-gated-take to write out the current take without
        // detaching anything.
        std::unique_ptr<GatedLoopRecorder> gatedRecorder;
        std::unique_ptr<GatedLoopRecorder> previousGatedRecorder;
        // Owned directly (not a raw-pointer handoff to Transport like the
        // recorders above) -- LinkSession never touches the audio thread
        // at all, see its own doc comment, so there's no cross-thread
        // lifetime hazard to guard against here.
        LinkSession linkSession;

        // The token of the project currently staged in PlaybackEngine, or
        // -1 for none. The renderer picks the value; the engine only ever
        // echoes it back, because EngineClient (src/main/engineClient.ts)
        // matches replies by message TYPE, not by request id -- without a
        // token in the payload a client with two changes in flight could
        // not tell which one an ack belongs to.
        int stagedToken = -1;
        // The project staged under stagedToken, kept so the message-thread
        // side effects (tempo, Link, overrides, channel chains) can be run
        // after the audio thread has done the swap -- the engine has no
        // other way back to it, since the snapshot itself is private to
        // PlaybackEngine. Metadata only; stem audio lives in
        // StemBufferCache, not in here.
        EngineProject stagedProject;
        // juce::Time::getMillisecondCounterHiRes() value past which a
        // staged swap stops waiting for a loop top and just happens. See
        // the stage-project handler for how it's derived and why it is
        // anchored at the message's ARRIVAL rather than at the end of
        // staging.
        double stageDeadlineMs = 0.0;
        // Last value of PlaybackEngine::stagedApplyCount() this connection
        // has seen. The audio thread has no way to call back into here and
        // shouldn't have one; an edge on this counter is how the swap
        // reports itself.
        unsigned long long lastSeenStagedApplies = 0;
        // Renderer-chosen tokens for stop requests waiting for the audio
        // thread's fade to reach true silence. Normally one; an immediate
        // transport re-render may issue the same logical stop twice, and
        // every waiter receives its own correlated acknowledgement.
        // A waiter is also answered when the device isn't rendering at all;
        // see HaltAck.h.
        std::vector<HaltAckWait> pendingHaltAcks;
    };

    class IpcServer : public juce::InterprocessConnectionServer
    {
    public:
        /** `linkEnabled` is handed to every connection's LinkSession (Main.cpp's --link). */
        IpcServer(PlaybackEngine& engine, Transport& transport, PluginChain& masterChain,
            ChannelChainRegistry& channelChains, bool linkEnabled = false);

        juce::InterprocessConnection* createConnectionObject() override;

    private:
        PlaybackEngine& engine;
        Transport& transport;
        PluginChain& masterChain;
        ChannelChainRegistry& channelChains;
        bool linkEnabled;
    };
}

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
#include <juce_events/juce_events.h>
#include <memory>

namespace sssketch
{
    /** One accepted client connection. Handles the Electron -> JUCE messages
     * documented in docs/superpowers/specs/2026-07-28-juce-audio-engine-design.md's
     * IPC protocol section (the Phase 1 subset: load-project, play, pause,
     * stop, set-position), and pushes position-update while playing.
     *
     * private juce::MultiTimer, not plain juce::Timer -- this connection
     * needs two independent polling cadences that DON'T share a lifecycle:
     * the existing position-update/capture-level push (kPositionTimerId in
     * IpcServer.cpp, started/stopped around play/pause/stop, ~30Hz) and
     * LinkSession's own external-tempo-change poll (kLinkPollTimerId,
     * started once in the constructor and never stopped until teardown --
     * see LinkSession.h's own doc comment for why tempo detection must
     * keep running independent of play state, same reasoning already
     * established for syncTempo's own OUTBOUND push on load-project).
     * MultiTimer still runs both on the same message thread via JUCE's
     * existing timer machinery -- no new thread, matching this codebase's
     * real-time-thread discipline (see this repo's own CLAUDE.md); it's
     * the same category of thing as BridgeClient's own separate 500ms
     * juce::Timer elsewhere in this codebase, just using JUCE's built-in
     * multi-cadence facility instead of a second class, since both
     * cadences now live on the same object. */
    class IpcConnection : public juce::InterprocessConnection, private juce::MultiTimer
    {
    public:
        IpcConnection(PlaybackEngine& engine, Transport& transport, PluginChain& masterChain,
            ChannelChainRegistry& channelChains);
        ~IpcConnection() override;

        void connectionMade() override;
        void connectionLost() override;
        void messageReceived(const juce::MemoryBlock& message) override;

    private:
        void sendJson(const juce::var& payload);
        // timerID is one of kPositionTimerId/kLinkPollTimerId (IpcServer.cpp) --
        // see this class's own doc comment above for why this is a MultiTimer
        // now instead of a single juce::Timer.
        void timerCallback(int timerID) override;
        // Shared by the destructor and connectionLost() -- either can run
        // while a recording is still armed. See its own doc comment (.cpp)
        // for why this deliberately leaks rather than frees synchronously.
        // Detaches both the manual-arm LoopRecorder AND the gated one
        // (below), same reasoning for each.
        void detachArmedRecorderOnTeardown();

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
    };

    class IpcServer : public juce::InterprocessConnectionServer
    {
    public:
        IpcServer(PlaybackEngine& engine, Transport& transport, PluginChain& masterChain,
            ChannelChainRegistry& channelChains);

        juce::InterprocessConnection* createConnectionObject() override;

    private:
        PlaybackEngine& engine;
        Transport& transport;
        PluginChain& masterChain;
        ChannelChainRegistry& channelChains;
    };
}

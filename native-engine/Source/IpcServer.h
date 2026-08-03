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
#include <juce_events/juce_events.h>
#include <memory>

namespace sssketch
{
    /** One accepted client connection. Handles the Electron -> JUCE messages
     * documented in docs/superpowers/specs/2026-07-28-juce-audio-engine-design.md's
     * IPC protocol section (the Phase 1 subset: load-project, play, pause,
     * stop, set-position), and pushes position-update while playing. */
    class IpcConnection : public juce::InterprocessConnection, private juce::Timer
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
        void timerCallback() override; // pushes position-update while playing
        // Shared by the destructor and connectionLost() -- either can run
        // while a recording is still armed. See its own doc comment (.cpp)
        // for why this deliberately leaks rather than frees synchronously.
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

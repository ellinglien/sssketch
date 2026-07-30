// native-engine/Source/IpcServer.h
#pragma once
#include "PlaybackEngine.h"
#include "Transport.h"
#include "EngineProject.h"
#include "RenderExport.h"
#include "BakeStem.h"
#include <juce_events/juce_events.h>
#include <memory>

namespace ssstitch
{
    /** One accepted client connection. Handles the Electron -> JUCE messages
     * documented in docs/superpowers/specs/2026-07-28-juce-audio-engine-design.md's
     * IPC protocol section (the Phase 1 subset: load-project, play, pause,
     * stop, set-position), and pushes position-update while playing. */
    class IpcConnection : public juce::InterprocessConnection, private juce::Timer
    {
    public:
        IpcConnection(PlaybackEngine& engine, Transport& transport, StemBufferCache& bufferCache);
        ~IpcConnection() override;

        void connectionMade() override;
        void connectionLost() override;
        void messageReceived(const juce::MemoryBlock& message) override;

    private:
        void sendJson(const juce::var& payload);
        void timerCallback() override; // pushes position-update while playing

        PlaybackEngine& engine;
        Transport& transport;
        StemBufferCache& bufferCache;
    };

    class IpcServer : public juce::InterprocessConnectionServer
    {
    public:
        IpcServer(PlaybackEngine& engine, Transport& transport, StemBufferCache& bufferCache);

        juce::InterprocessConnection* createConnectionObject() override;

    private:
        PlaybackEngine& engine;
        Transport& transport;
        StemBufferCache& bufferCache;
    };
}

// native-engine-bridge/Source/BridgeIpcServer.h
#pragma once
#include "PluginEditorWindow.h"
#include "SharedAudioChannel.h"
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_events/juce_events.h>
#include <unordered_map>
#include <memory>

namespace sssketch
{
    /** One loaded plugin instance on the bridge side: the plugin itself,
     * its SharedAudioChannel (attached, not owned -- the main engine
     * created it), its editor window (if opened), and the background
     * thread that pumps audio through it for as long as this object
     * lives. */
    class BridgeSlot : private juce::Thread
    {
    public:
        BridgeSlot(std::unique_ptr<juce::AudioProcessor> plugin,
            std::unique_ptr<SharedAudioChannel> channel, int blockSize);
        ~BridgeSlot() override;

        bool openEditor();
        void closeEditor();

    private:
        void run() override;

        std::unique_ptr<juce::AudioProcessor> plugin;
        std::unique_ptr<SharedAudioChannel> channel;
        int blockSize;
        std::unique_ptr<PluginEditorWindow> editorWindow;
    };

    /** One control-socket connection from the main engine -- in practice
     * there's only ever one (the main engine is the only client this
     * server ever expects), but nothing here assumes that beyond
     * simplicity. Handles load/unload/open-editor/close-editor/shutdown
     * messages -- see docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md's
     * "Control-plane messages" note. Every loaded plugin is identified by
     * an opaque `slotId` string the main engine assigns and reuses; the
     * bridge itself has no concept of master/channel/slot-index. */
    class BridgeIpcConnection : public juce::InterprocessConnection
    {
    public:
        BridgeIpcConnection();
        ~BridgeIpcConnection() override;

        void connectionMade() override;
        void connectionLost() override;
        void messageReceived(const juce::MemoryBlock& message) override;

    private:
        void sendJson(const juce::var& payload);

        std::unordered_map<juce::String, std::unique_ptr<BridgeSlot>> slots;
    };

    class BridgeIpcServer : public juce::InterprocessConnectionServer
    {
    public:
        juce::InterprocessConnection* createConnectionObject() override;
    };
}

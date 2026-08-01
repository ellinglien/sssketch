// native-engine-bridge/Source/BridgeIpcServer.cpp
#include "BridgeIpcServer.h"

namespace sssketch
{
    BridgeSlot::BridgeSlot(std::unique_ptr<juce::AudioProcessor> p,
        std::unique_ptr<SharedAudioChannel> c, int bs)
        : juce::Thread("BridgeSlot"), plugin(std::move(p)), channel(std::move(c)), blockSize(bs)
    {
        startThread();
    }

    BridgeSlot::~BridgeSlot()
    {
        stopThread(2000);
    }

    void BridgeSlot::run()
    {
        // Fixed stereo (2-channel) buffer -- see the plan's header, scope
        // decision 3, for why the bridge doesn't reshape to a plugin's own
        // wider channel count the way the in-process path does.
        std::vector<float> inFrames((size_t) blockSize * 2);
        juce::AudioBuffer<float> scratch(2, blockSize);
        juce::MidiBuffer midi;

        while (!threadShouldExit())
        {
            // A short wait slice (not the caller's 5ms real-time budget --
            // this loop runs continuously, independent of the engine's own
            // per-block timing, so it can afford to wait longer per
            // attempt and just loop back around if nothing showed up yet).
            const uint32_t got = channel->waitAndReadInput(inFrames.data(), (uint32_t) blockSize, 50);
            if (threadShouldExit())
                break;
            if (got == 0)
                continue;

            scratch.clear();
            for (uint32_t i = 0; i < got; ++i)
            {
                scratch.setSample(0, (int) i, inFrames[(size_t) i * 2]);
                scratch.setSample(1, (int) i, inFrames[(size_t) i * 2 + 1]);
            }

            plugin->processBlock(scratch, midi);
            midi.clear();

            std::vector<float> outFrames((size_t) got * 2);
            for (uint32_t i = 0; i < got; ++i)
            {
                outFrames[(size_t) i * 2] = scratch.getSample(0, (int) i);
                outFrames[(size_t) i * 2 + 1] = scratch.getSample(1, (int) i);
            }
            channel->writeOutputAndSignal(outFrames.data(), got);
        }
    }

    bool BridgeSlot::openEditor()
    {
        if (editorWindow != nullptr)
        {
            editorWindow->toFront(true);
            return true;
        }
        if (!plugin->hasEditor())
            return true;
        auto* editor = plugin->createEditorIfNeeded();
        if (editor == nullptr)
            return true;
        editorWindow = std::make_unique<PluginEditorWindow>(plugin->getName(), editor, [this]() { closeEditor(); });
        return true;
    }

    void BridgeSlot::closeEditor()
    {
        editorWindow.reset();
    }

    BridgeIpcConnection::BridgeIpcConnection() = default;

    BridgeIpcConnection::~BridgeIpcConnection()
    {
        disconnect(); // required before InterprocessConnection's own destructor runs -- same as IpcConnection.cpp's own dtor
    }

    void BridgeIpcConnection::connectionMade()
    {
        juce::Logger::writeToLog("BridgeIpcConnection: engine connected");
    }

    void BridgeIpcConnection::connectionLost()
    {
        juce::Logger::writeToLog("BridgeIpcConnection: engine disconnected");
        slots.clear(); // tears down every BridgeSlot -- stops each one's audio thread and closes any open editor windows
    }

    void BridgeIpcConnection::sendJson(const juce::var& payload)
    {
        const auto text = juce::JSON::toString(payload, true);
        juce::MemoryBlock block(text.toRawUTF8(), text.getNumBytesAsUTF8());
        sendMessage(block);
    }

    void BridgeIpcConnection::messageReceived(const juce::MemoryBlock& message)
    {
        auto text = juce::String::fromUTF8((const char*) message.getData(), (int) message.getSize());
        auto parsed = juce::JSON::parse(text);
        if (!parsed.isObject())
            return;
        auto type = parsed.getProperty("type", "").toString();
        auto payload = parsed.getProperty("payload", juce::var());
        if (!payload.isObject())
            return;

        if (type == "load-bridge-plugin")
        {
            const auto slotId = payload.getProperty("slotId", "").toString();
            const auto path = payload.getProperty("path", "").toString();
            const auto channelName = payload.getProperty("channelName", "").toString();
            const double sampleRate = (double) payload.getProperty("sampleRate", 44100.0);
            const int blockSize = (int) payload.getProperty("blockSize", 512);

            juce::AudioPluginFormatManager formatManager;
            formatManager.addDefaultFormats();
            juce::Array<juce::PluginDescription> found;
            for (auto* format : formatManager.getFormats())
            {
                if (!format->fileMightContainThisPluginType(path))
                    continue;
                juce::KnownPluginList knownPlugins;
                juce::OwnedArray<juce::PluginDescription> typesFound;
                knownPlugins.scanAndAddFile(path, false, typesFound, *format);
                for (auto* desc : typesFound)
                    found.add(*desc);
            }

            juce::String error;
            std::unique_ptr<juce::AudioProcessor> instance;
            if (found.isEmpty())
            {
                error = "plugin not found at expected path: " + path;
            }
            else
            {
                instance = formatManager.createPluginInstance(found.getReference(0), sampleRate, blockSize, error);
                if (instance != nullptr)
                    instance->prepareToPlay(sampleRate, blockSize);
            }

            bool success = instance != nullptr;
            if (success)
            {
                auto channel = SharedAudioChannel::attach(channelName, blockSize);
                if (channel == nullptr)
                {
                    success = false;
                    error = "failed to attach to shared audio channel: " + channelName;
                }
                else
                {
                    slots[slotId] = std::make_unique<BridgeSlot>(std::move(instance), std::move(channel), blockSize);
                }
            }

            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            payloadObj->setProperty("slotId", slotId);
            payloadObj->setProperty("success", success);
            if (!success)
                payloadObj->setProperty("error", error);
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "bridge-plugin-loaded");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "open-bridge-plugin-editor")
        {
            const auto slotId = payload.getProperty("slotId", "").toString();
            auto it = slots.find(slotId);
            if (it != slots.end())
                it->second->openEditor();
        }
        else if (type == "close-bridge-plugin-editor")
        {
            const auto slotId = payload.getProperty("slotId", "").toString();
            auto it = slots.find(slotId);
            if (it != slots.end())
                it->second->closeEditor();
        }
        else if (type == "unload-bridge-plugin")
        {
            const auto slotId = payload.getProperty("slotId", "").toString();
            slots.erase(slotId);
        }
        else if (type == "shutdown")
        {
            juce::JUCEApplicationBase::quit();
        }
    }

    juce::InterprocessConnection* BridgeIpcServer::createConnectionObject()
    {
        return new BridgeIpcConnection();
    }
}

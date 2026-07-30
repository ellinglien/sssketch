#include "IpcServer.h"

namespace ssstitch
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

    IpcConnection::IpcConnection(PlaybackEngine& e, Transport& t, StemBufferCache& c, SendBus& sb)
        : engine(e), transport(t), bufferCache(c), sendBus(sb)
    {
    }

    IpcConnection::~IpcConnection()
    {
        stopTimer();
        // InterprocessConnection's destructor requires derived classes to have
        // already called disconnect() — without this, pending messages can still
        // be delivered to this object's (now partially destroyed) vtable, and the
        // base destructor's jassert(!safeAction->isSafe()) fires. Not in the
        // plan's sample code; added because the base class header and .cpp both
        // document this as a hard requirement, not an optional cleanup step.
        disconnect();
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
                engine.setProject(project);
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
        else if (type == "load-send-plugin")
        {
            if (!payload.isObject())
                return;
            const int bus = (int) payload.getProperty("bus", -1);
            const auto pluginId = payload.getProperty("pluginId", "").toString();
            if (bus < 0 || bus >= kNumSendBuses)
                return;

            // Use the real device's own sample rate / block size, not a
            // hardcoded guess — prepareToPlay()'ing a plugin for the wrong
            // block size means processBlock() can later be called with a
            // buffer larger than the plugin allocated internal storage for
            // (undefined behaviour, often a crash that takes the whole
            // engine process down with it, silencing the dry mix too).
            //
            // IpcConnection itself is only ever touched from the message
            // thread (InterprocessConnection's own contract), but
            // requestLoad's onLoaded callback fires on SendBus's background
            // loader thread — sendJson (and `this` in general) must not be
            // touched from there directly. Post back to the message thread.
            sendBus.requestLoad(bus, pluginId, transport.currentSampleRate(), transport.currentBlockSize(),
                [this, bus, pluginId](bool success, const juce::String& error)
                {
                    juce::MessageManager::callAsync([this, bus, pluginId, success, error]()
                    {
                        juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
                        payloadObj->setProperty("bus", bus);
                        payloadObj->setProperty("pluginId", pluginId);
                        payloadObj->setProperty("success", success);
                        if (!success)
                            payloadObj->setProperty("error", error);
                        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
                        obj->setProperty("type", "send-plugin-loaded");
                        obj->setProperty("payload", juce::var(payloadObj.get()));
                        sendJson(juce::var(obj.get()));
                    });
                });
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
        else if (type == "quit")
        {
            juce::JUCEApplicationBase::quit();
        }
    }

    IpcServer::IpcServer(PlaybackEngine& e, Transport& t, StemBufferCache& c, SendBus& sb)
        : engine(e), transport(t), bufferCache(c), sendBus(sb)
    {
    }

    juce::InterprocessConnection* IpcServer::createConnectionObject()
    {
        return new IpcConnection(engine, transport, bufferCache, sendBus);
    }
}

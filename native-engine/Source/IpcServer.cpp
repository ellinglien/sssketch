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

    IpcConnection::IpcConnection(PlaybackEngine& e, Transport& t, StemBufferCache& c)
        : engine(e), transport(t), bufferCache(c)
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
                transport.setLoopLengthBars(project.loopLengthBars);
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
        else if (type == "set-metronome")
        {
            const bool enabled = payload.isObject() && (bool) payload.getProperty("enabled", false);
            engine.setMetronomeEnabled(enabled);
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

    IpcServer::IpcServer(PlaybackEngine& e, Transport& t, StemBufferCache& c)
        : engine(e), transport(t), bufferCache(c)
    {
    }

    juce::InterprocessConnection* IpcServer::createConnectionObject()
    {
        return new IpcConnection(engine, transport, bufferCache);
    }
}

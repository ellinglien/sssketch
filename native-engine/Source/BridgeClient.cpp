// native-engine/Source/BridgeClient.cpp
#include "BridgeClient.h"
#include <thread>

namespace sssketch
{
    // Fixed control port -- unlike the main engine (which Electron spawns
    // once per session and picks a random port for, since multiple engine
    // instances could theoretically coexist), there is only ever one
    // bridge for the whole app session, so a fixed port is simpler and has
    // nothing to collide with in practice.
    static constexpr int kBridgeControlPort = 45890;

    // How long loadPlugin() waits for the bridge's own "bridge-plugin-loaded"
    // reply before giving up. Real gap this fixes: the bridge handles
    // load-bridge-plugin synchronously on its one message-handling thread
    // (BridgeIpcConnection::messageReceived -> formatManager.createPluginInstance)
    // -- a plugin whose own instantiation blocks (a real, observed risk for
    // exactly the legacy/iLok-gated plugins this bridge exists to host) previously
    // left the slot's onLoaded callback never called at all: permanently
    // "loading" in the UI, Edit never enabling, with no error and no recovery.
    // 15s is generous relative to any normal plugin's real instantiation time
    // (including ensureRunning()'s own up-to-5s spawn+connect retry) while still
    // being short enough that a genuinely stuck plugin resolves to a clear error
    // instead of an indefinite hang.
    static constexpr double kBridgePluginLoadTimeoutMs = 15000.0;

    BridgeClient::BridgeClient(juce::String path)
        : bridgeBinaryPath(std::move(path)), publishedChannels(new ChannelMap())
    {
        startTimer(500);
    }

    BridgeClient::~BridgeClient()
    {
        stopTimer();
        if (connected.load())
        {
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "shutdown");
            obj->setProperty("payload", juce::var(new juce::DynamicObject()));
            sendJson(juce::var(obj.get()));
        }
        disconnect();
        if (bridgeProcess != nullptr && !bridgeProcess->waitForProcessToFinish(1000))
            bridgeProcess->kill();
        delete publishedChannels.load();
    }

    void BridgeClient::connectionMade()
    {
        connected.store(true);
    }

    void BridgeClient::connectionLost()
    {
        connected.store(false);
        // Every currently-published channel is now orphaned -- publish an
        // empty map so channelFor() stops handing out channels nothing
        // will ever service again. See design spec's "bridge process dies
        // mid-session": PluginChain checks isHealthy()/channelFor()
        // together and renders silence for any slot this leaves without a
        // channel.
        auto* old = publishedChannels.exchange(new ChannelMap());
        std::thread([old]() { delete old; }).detach();
    }

    bool BridgeClient::ensureRunning()
    {
        if (bridgeBinaryPath.isEmpty())
            return false;
        if (connected.load())
            return true;

        if (bridgeProcess == nullptr || !bridgeProcess->isRunning())
        {
            bridgeProcess = std::make_unique<juce::ChildProcess>();
            if (!bridgeProcess->start(
                    bridgeBinaryPath + " --serve-bridge " + juce::String(kBridgeControlPort)))
            {
                bridgeProcess.reset();
                return false;
            }
        }

        // Retry-connect: the bridge needs a moment to start listening
        // after spawning, especially the first time under Rosetta's
        // translation cold-start. 50 attempts * 100ms = 5 seconds total,
        // matching the main engine's own 5-second readiness timeout (see
        // engineProcess.ts's spawnEngine).
        for (int attempt = 0; attempt < 50; ++attempt)
        {
            if (connectToSocket("127.0.0.1", kBridgeControlPort, 200))
                return true;
            juce::Thread::sleep(100);
        }
        return false;
    }

    void BridgeClient::sendJson(const juce::var& payload)
    {
        const auto text = juce::JSON::toString(payload, true);
        juce::MemoryBlock block(text.toRawUTF8(), text.getNumBytesAsUTF8());
        sendMessage(block);
    }

    void BridgeClient::publishChannels(std::function<void(ChannelMap&)> mutator)
    {
        const auto* current = publishedChannels.load();
        auto* next = new ChannelMap();
        for (auto& [id, ch] : *current)
            (*next)[id] = std::move(const_cast<ChannelMap*>(current)->at(id));
        mutator(*next);
        auto* old = publishedChannels.exchange(next);
        std::thread([old]() { delete old; }).detach();
    }

    void BridgeClient::loadPlugin(
        const juce::String& slotId,
        const juce::String& path,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded)
    {
        if (!ensureRunning())
        {
            if (onLoaded)
                onLoaded(false, "failed to start or connect to the x86_64 bridge process");
            return;
        }

        auto channelName = SharedAudioChannel::makeUniqueName();
        auto channel = SharedAudioChannel::create(channelName, blockSize);
        if (channel == nullptr)
        {
            if (onLoaded)
                onLoaded(false, "failed to create shared audio channel for bridged plugin");
            return;
        }

        // Published BEFORE the bridge confirms the load: channelFor() is
        // an audio-thread convenience for "is there a channel to try
        // sending to," not a promise the bridge has actually finished
        // loading -- PluginChain treats a channel with nothing coming back
        // yet exactly like a timeout (silence), so there's no unsafe
        // window here, just an ordinary startup ramp before the bridge's
        // own audio thread (BridgeSlot::run) starts producing output.
        publishChannels([&](ChannelMap& map) { map[slotId] = std::move(channel); });
        pendingLoads[slotId] = { std::move(onLoaded), juce::Time::getMillisecondCounterHiRes() };

        juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
        payloadObj->setProperty("slotId", slotId);
        payloadObj->setProperty("path", path);
        payloadObj->setProperty("channelName", channelName);
        payloadObj->setProperty("sampleRate", sampleRate);
        payloadObj->setProperty("blockSize", blockSize);
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "load-bridge-plugin");
        obj->setProperty("payload", juce::var(payloadObj.get()));
        sendJson(juce::var(obj.get()));
    }

    void BridgeClient::unloadPlugin(const juce::String& slotId)
    {
        const auto* current = publishedChannels.load();
        if (current->find(slotId) == current->end())
            return;
        publishChannels([&](ChannelMap& map) { map.erase(slotId); });

        if (connected.load())
        {
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            payloadObj->setProperty("slotId", slotId);
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "unload-bridge-plugin");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
    }

    void BridgeClient::openEditor(const juce::String& slotId)
    {
        if (!connected.load()) return;
        juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
        payloadObj->setProperty("slotId", slotId);
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "open-bridge-plugin-editor");
        obj->setProperty("payload", juce::var(payloadObj.get()));
        sendJson(juce::var(obj.get()));
    }

    void BridgeClient::closeEditor(const juce::String& slotId)
    {
        if (!connected.load()) return;
        juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
        payloadObj->setProperty("slotId", slotId);
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "close-bridge-plugin-editor");
        obj->setProperty("payload", juce::var(payloadObj.get()));
        sendJson(juce::var(obj.get()));
    }

    SharedAudioChannel* BridgeClient::channelFor(const juce::String& slotId)
    {
        const auto* map = publishedChannels.load();
        auto it = map->find(slotId);
        return it == map->end() ? nullptr : it->second.get();
    }

    void BridgeClient::messageReceived(const juce::MemoryBlock& message)
    {
        auto text = juce::String::fromUTF8((const char*) message.getData(), (int) message.getSize());
        auto parsed = juce::JSON::parse(text);
        if (!parsed.isObject())
            return;
        auto type = parsed.getProperty("type", "").toString();
        auto payload = parsed.getProperty("payload", juce::var());

        if (type == "bridge-plugin-loaded" && payload.isObject())
        {
            const auto slotId = payload.getProperty("slotId", "").toString();
            const bool success = payload.getProperty("success", false);
            const auto error = payload.getProperty("error", "").toString();
            auto it = pendingLoads.find(slotId);
            if (it != pendingLoads.end())
            {
                auto callback = std::move(it->second.callback);
                pendingLoads.erase(it);
                if (!success)
                    unloadPlugin(slotId); // clean up the channel published speculatively in loadPlugin
                if (callback)
                    callback(success, error);
            }
        }
    }

    void BridgeClient::timerCallback()
    {
        if (pendingLoads.empty())
            return;

        const double now = juce::Time::getMillisecondCounterHiRes();
        std::vector<juce::String> timedOut;
        for (const auto& [slotId, pending] : pendingLoads)
            if (now - pending.startTimeMs >= kBridgePluginLoadTimeoutMs)
                timedOut.push_back(slotId);

        if (timedOut.empty())
            return;

        // A hung load means the bridge's own message-handling thread is
        // very likely wedged for good on whatever plugin caused it (it
        // handles load-bridge-plugin synchronously) -- every OTHER pending
        // or future load on this same bridge process would time out
        // identically otherwise. Killing it here lets the next
        // ensureRunning() spawn a fresh one, so a single bad plugin
        // degrades to "that one load failed," not "bridging is now broken
        // for the rest of the session."
        if (bridgeProcess != nullptr)
            bridgeProcess->kill();
        disconnect();

        for (const auto& slotId : timedOut)
        {
            auto it = pendingLoads.find(slotId);
            if (it == pendingLoads.end())
                continue;
            auto callback = std::move(it->second.callback);
            pendingLoads.erase(it);
            unloadPlugin(slotId); // clean up the channel published speculatively in loadPlugin
            if (callback)
                callback(false, "bridge plugin load timed out");
        }
    }
}

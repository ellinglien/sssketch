#include <cmath>
#include <iostream>
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include "IpcServer.h"
#include "Transport.h"
#include "PlaybackEngine.h"
#include "StemBufferCache.h"
#include "EngineProject.h"
#include "RenderExport.h"

// PlaybackEngine, Transport, IpcServer, StemBufferCache, EngineProject, and
// parseEngineProject all live in namespace ssstitch (see their headers) — the
// plan's sample code below calls them unqualified, so this using-directive is
// required for it to compile at all.
using namespace ssstitch;

static int runUnitTests()
{
    juce::UnitTestRunner runner;
    runner.runAllTests();

    for (int i = 0; i < runner.getNumResults(); ++i)
    {
        auto* result = runner.getResult(i);
        if (result->failures > 0)
        {
            juce::Logger::writeToLog("FAIL: " + result->unitTestName);
            return 1;
        }
    }
    juce::Logger::writeToLog("All unit tests passed.");
    return 0;
}

static void scanOneFileInto(
    juce::AudioPluginFormatManager& formatManager,
    const juce::String& path,
    juce::Array<juce::PluginDescription>& found)
{
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
}

// Shells out to the system `file` command against a VST3 bundle's inner
// Mach-O binary, since JUCE has no built-in architecture-detection API.
// Confirmed manually against real installed plugins during this feature's
// own design: some VST3s on this machine are x86_64-only (fail to load
// natively on this arm64 host — expected, not a bug) while others are
// arm64-native or universal.
static juce::String detectArchitecture(const juce::String& bundlePath)
{
    juce::File bundle(bundlePath);
    auto macOSDir = bundle.getChildFile("Contents").getChildFile("MacOS");
    auto binaries = macOSDir.findChildFiles(juce::File::findFiles, false);
    if (binaries.isEmpty())
        return "unknown";

    // Uses the StringArray overload, not the single-String one -- the
    // latter does its own naive whitespace tokenization (not real shell
    // parsing), so a path containing spaces (e.g. "Solid Bus Comp.vst3")
    // wrapped in literal quote characters doesn't work as intended; the
    // StringArray overload passes each argument through directly, with no
    // quoting needed. Found via manual smoke-testing during this task.
    juce::ChildProcess fileProc;
    if (!fileProc.start(juce::StringArray { "file", binaries[0].getFullPathName() }))
        return "unknown";
    const auto output = fileProc.readAllProcessOutput();
    fileProc.waitForProcessToFinish(5000);

    const bool hasArm64 = output.containsIgnoreCase("arm64");
    const bool hasX86 = output.containsIgnoreCase("x86_64");
    if (hasArm64 && hasX86) return "universal";
    if (hasArm64) return "arm64";
    if (hasX86) return "x86_64";
    return "unknown";
}

// A curated allowlist, not a directory sweep. See PHASE0_FINDINGS.md: scanning
// entire /Library/Audio/Plug-Ins/{VST3,Components} directories via
// KnownPluginList::scanAndAddFile hits at least one real bug (an infinite
// assertion loop in JUCE's AU scanner against Apple's own multi-type system
// component bundles, e.g. AudioCodecs.component) plus multiple installed
// plugins with no arm64 slice, which fail cleanly but add noise. A real
// plugin-hosting product needs per-plugin timeout/sandboxing (as commercial
// DAWs do); out of scope for a toolchain spike, which only needs to confirm
// VST3 + AU loading works at all against known-good real-world plugins.
static const juce::StringArray knownGoodPaths {
    "/Library/Audio/Plug-Ins/VST3/Neutron 4.vst3",
    "/Library/Audio/Plug-Ins/VST3/RX 10 De-click.vst3",
    "/Library/Audio/Plug-Ins/Components/Vital.component",
    "/Library/Audio/Plug-Ins/Components/Youlean Loudness Meter 2.component"
};

static int runScanReport()
{
    juce::AudioPluginFormatManager formatManager;
    formatManager.addDefaultFormats(); // registers VST3 + AU given the build flags set

    juce::Array<juce::PluginDescription> found;
    for (const auto& path : knownGoodPaths)
        scanOneFileInto(formatManager, path, found);

    juce::Logger::writeToLog("Found " + juce::String(found.size()) + " plugin(s):");
    for (const auto& desc : found)
        juce::Logger::writeToLog("  [" + desc.pluginFormatName + "] " + desc.name
            + " (" + desc.manufacturerName + ")");

    return found.isEmpty() ? 1 : 0;
}

// Diagnostic-only: probe a single plugin file/bundle by exact path, for bisecting
// which specific installed plugin hangs a full-catalog scan (some plugins block on
// a first-run license/authorization dialog, or on JUCE scanner bugs against
// non-effect AU bundles — see PHASE0_FINDINGS.md).
static int runScanOne(const juce::String& path)
{
    juce::AudioPluginFormatManager formatManager;
    formatManager.addDefaultFormats();

    juce::File target(path);
    juce::Logger::writeToLog("Probing: " + target.getFullPathName());

    juce::Array<juce::PluginDescription> found;
    scanOneFileInto(formatManager, path, found);
    for (const auto& desc : found)
        juce::Logger::writeToLog("  [" + desc.pluginFormatName + "] " + desc.name
            + " (" + desc.manufacturerName + ")");

    juce::Logger::writeToLog("Probe complete.");
    return 0;
}

// Same probe as runScanOne, but machine-readable: a single JSON line on
// stdout, used by the plugin-scan feature's per-candidate subprocess (see
// docs/superpowers/specs/2026-07-31-plugin-scan-favourites-design.md).
// Deliberately a SEPARATE function from runScanOne (not a --json flag on
// it) so the existing diagnostic-only human-readable mode is untouched.
static int runScanOneJson(const juce::String& path)
{
    juce::AudioPluginFormatManager formatManager;
    formatManager.addDefaultFormats();

    juce::Array<juce::PluginDescription> found;
    scanOneFileInto(formatManager, path, found);

    juce::var result;
    if (found.isEmpty())
    {
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("success", false);
        obj->setProperty("error", "no plugin type found at this path");
        result = juce::var(obj.get());
    }
    else
    {
        const auto arch = detectArchitecture(path);
        juce::Array<juce::var> plugins;
        for (const auto& desc : found)
        {
            juce::DynamicObject::Ptr p = new juce::DynamicObject();
            p->setProperty("name", desc.name);
            p->setProperty("manufacturer", desc.manufacturerName);
            p->setProperty("identifierString", desc.createIdentifierString());
            p->setProperty("arch", arch);
            plugins.add(juce::var(p.get()));
        }
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("success", true);
        obj->setProperty("plugins", plugins);
        result = juce::var(obj.get());
    }

    // Plain stdout, not juce::Logger (which JUCE routes to stderr on macOS,
    // confirmed during Phase 1 of this project) -- the parent process reads
    // this from the child's stdout specifically, keeping it separate from
    // any stderr diagnostic noise the plugin's own loading code might emit.
    std::cout << juce::JSON::toString(result, true) << std::endl;
    return 0;
}

static bool loadAndProcessOne(
    juce::AudioPluginFormatManager& formatManager,
    const juce::PluginDescription& desc)
{
    juce::String errorMessage;
    auto instance = formatManager.createPluginInstance(desc, 44100.0, 512, errorMessage);

    if (instance == nullptr)
    {
        juce::Logger::writeToLog("  FAILED to load \"" + desc.name + "\": " + errorMessage);
        return false;
    }

    instance->prepareToPlay(44100.0, 512);

    juce::AudioBuffer<float> buffer(
        juce::jmax(1, instance->getTotalNumInputChannels()), 512);
    buffer.clear();
    // A quiet test tone rather than silence, so a plugin that only reacts to
    // non-zero input still has something to actually process.
    for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        for (int i = 0; i < buffer.getNumSamples(); ++i)
            buffer.setSample(ch, i, 0.1f * std::sin(i * 0.1f));

    juce::MidiBuffer midi;
    instance->processBlock(buffer, midi);

    instance->releaseResources();

    juce::Logger::writeToLog("  OK: \"" + desc.name + "\" processed "
        + juce::String(buffer.getNumSamples()) + " samples, "
        + juce::String(instance->getTotalNumOutputChannels()) + " output channel(s).");
    return true;
}

static int runSpike()
{
    juce::AudioPluginFormatManager formatManager;
    formatManager.addDefaultFormats();

    juce::Array<juce::PluginDescription> found;
    for (const auto& path : knownGoodPaths)
        scanOneFileInto(formatManager, path, found);

    const juce::PluginDescription* firstVst3 = nullptr;
    const juce::PluginDescription* firstAu = nullptr;
    for (const auto& desc : found)
    {
        if (firstVst3 == nullptr && desc.pluginFormatName == "VST3")
            firstVst3 = &desc;
        if (firstAu == nullptr && desc.pluginFormatName == "AudioUnit")
            firstAu = &desc;
    }

    bool vst3Ok = false, auOk = false;

    if (firstVst3 != nullptr)
    {
        juce::Logger::writeToLog("Loading VST3: " + firstVst3->name);
        vst3Ok = loadAndProcessOne(formatManager, *firstVst3);
    }
    else
    {
        juce::Logger::writeToLog("No VST3 plugin found to test.");
    }

    if (firstAu != nullptr)
    {
        juce::Logger::writeToLog("Loading AU: " + firstAu->name);
        auOk = loadAndProcessOne(formatManager, *firstAu);
    }
    else
    {
        juce::Logger::writeToLog("No AU plugin found to test.");
    }

    juce::Logger::writeToLog(juce::String("Phase 0 spike result: VST3=")
        + (vst3Ok ? "PASS" : "FAIL") + ", AU=" + (auOk ? "PASS" : "FAIL"));

    return (vst3Ok && auOk) ? 0 : 1;
}

static int runServe(int port)
{
    StemBufferCache bufferCache;
    PlaybackEngine engine(bufferCache);
    PluginChain masterChain(kNumMasterChainSlots);
    ChannelChainRegistry channelChains;
    Transport transport(engine, masterChain, channelChains);
    transport.openDefaultDevice(); // best-effort — if it fails (no device, e.g. CI),
                                    // the engine still serves IPC and PlaybackEngine
                                    // still renders correctly, just nothing plays out loud

    IpcServer server(engine, transport, bufferCache, masterChain, channelChains);
    if (!server.beginWaitingForSocket(port, "127.0.0.1"))
    {
        juce::Logger::writeToLog("runServe: failed to bind to port " + juce::String(port));
        return 1;
    }
    juce::Logger::writeToLog("ssstitch-engine serving on 127.0.0.1:" + juce::String(port));

    // Deliberately not the more obvious `runDispatchLoop()`: on macOS that
    // blocks on [NSApp run], which needs a full Aqua/WindowServer session and
    // was observed returning immediately in a headless console process here —
    // this process would exit right after the log line above instead of
    // serving. Polling with runDispatchLoopUntil() doesn't depend on that
    // integration. See the JUCE_MODAL_LOOPS_PERMITTED comment in
    // CMakeLists.txt for the full explanation (that flag is required for
    // runDispatchLoopUntil() to even be compiled in).
    while (!juce::MessageManager::getInstance()->hasStopMessageBeenSent())
        juce::MessageManager::getInstance()->runDispatchLoopUntil(50);
    return 0;
}

static int runRenderTest(const juce::String& projectJsonPath, const juce::String& outputWavPath, double durationBars)
{
    auto jsonFile = juce::File(projectJsonPath);
    auto json = jsonFile.loadFileAsString();

    EngineProject project;
    juce::String error;
    if (!parseEngineProject(json, project, error))
    {
        juce::Logger::writeToLog("runRenderTest: failed to parse project: " + error);
        return 1;
    }

    if (!renderProjectToWavFile(project, outputWavPath, durationBars, error))
    {
        juce::Logger::writeToLog("runRenderTest: " + error);
        return 1;
    }

    juce::Logger::writeToLog("runRenderTest: wrote " + outputWavPath);
    return 0;
}

namespace ssstitch
{
    // Minimal IPC client used only by the Task 11 round-trip test. Uses JUCE's
    // own InterprocessConnection on the client side too, so the wire framing
    // is guaranteed compatible without hand-rolling or reverse-engineering
    // InterprocessConnection's internal message-length-prefix format.
    class TestClient : public juce::InterprocessConnection
    {
    public:
        // `callbacksOnMessageThread = false`: InterprocessConnection defaults to
        // true, which delivers connectionMade()/messageReceived()/connectionLost()
        // by posting a juce::Message and requires something to keep calling
        // MessageManager::runDispatchLoopUntil() to pump it (that's exactly what
        // runServe's polling loop, above, does on the server side). runTestClient
        // below never pumps a dispatch loop — it just calls juce::Thread::sleep()
        // between sending messages — so with the default, every callback below
        // silently never fires; the process still exits 0 (sendMessage() writes
        // straight to the socket, unaffected), but none of "connected", "received
        // ...", or "disconnected" is ever logged. Passing false here makes JUCE
        // invoke these callbacks directly on InterprocessConnection's own
        // background reader thread instead, matching this class's actual usage
        // (a short-lived console process with no GUI message loop of its own).
        // Confirmed via direct comparison during Task 11: sleep()-only + default
        // true produces zero client-side log lines despite the server-side
        // logging a successful connection; switching to false (or, equivalently,
        // pumping the dispatch loop instead of sleeping) produces the expected
        // "connected" / "received position-update" / "disconnected" lines.
        TestClient() : juce::InterprocessConnection(false) {}

        // Same requirement as IpcConnection's destructor (see IpcServer.cpp):
        // InterprocessConnection's own destructor asserts that a derived class
        // has already called disconnect() before it runs.
        ~TestClient() override { disconnect(); }

        void connectionMade() override
        {
            juce::Logger::writeToLog("test-client: connected");
        }

        void connectionLost() override
        {
            juce::Logger::writeToLog("test-client: disconnected");
        }

        void messageReceived(const juce::MemoryBlock& message) override
        {
            auto text = juce::String::fromUTF8((const char*) message.getData(), (int) message.getSize());
            // Printed with a stable, greppable prefix — the Task 11 test harness
            // matches on this line rather than parsing full JSON in the shell.
            juce::Logger::writeToLog("test-client: received " + text);
        }

        void sendJson(const juce::var& payload)
        {
            const auto text = juce::JSON::toString(payload, true);
            juce::MemoryBlock block(text.toRawUTF8(), text.getNumBytesAsUTF8());
            sendMessage(block);
        }
    };
}

static int runTestClient(int port, const juce::String& projectJsonPath)
{
    ssstitch::TestClient client;
    if (!client.connectToSocket("127.0.0.1", port, 2000))
    {
        juce::Logger::writeToLog("test-client: failed to connect on port " + juce::String(port));
        return 1;
    }

    auto sendRaw = [&](const juce::var& obj) { client.sendJson(obj); };

    juce::DynamicObject::Ptr loadMsg = new juce::DynamicObject();
    loadMsg->setProperty("type", "load-project");
    loadMsg->setProperty("payload", juce::JSON::parse(juce::File(projectJsonPath).loadFileAsString()));
    sendRaw(juce::var(loadMsg.get()));

    juce::DynamicObject::Ptr playPayload = new juce::DynamicObject();
    playPayload->setProperty("fromPos", 0.0);
    juce::DynamicObject::Ptr playMsg = new juce::DynamicObject();
    playMsg->setProperty("type", "play");
    playMsg->setProperty("payload", juce::var(playPayload.get()));
    sendRaw(juce::var(playMsg.get()));

    // Give the server's 30Hz position-update timer time to fire a few times —
    // messageReceived logs each one; the Task 11 harness reads this process's
    // captured stdout/log rather than needing a reply-and-block protocol here.
    juce::Thread::sleep(300);

    juce::DynamicObject::Ptr stopMsg = new juce::DynamicObject();
    stopMsg->setProperty("type", "stop");
    sendRaw(juce::var(stopMsg.get()));

    juce::DynamicObject::Ptr quitMsg = new juce::DynamicObject();
    quitMsg->setProperty("type", "quit");
    sendRaw(juce::var(quitMsg.get()));

    juce::Thread::sleep(100); // let the quit message actually reach the server before we exit
    return 0;
}

int main(int argc, char* argv[])
{
    // AudioUnit hosting (and some VST3s) rely on a running CFRunLoop / message
    // thread even for headless scanning and processing — without this, AU
    // component instantiation hangs indefinitely instead of failing.
    const juce::ScopedJuceInitialiser_GUI juceInit;

    if (argc > 1 && juce::String(argv[1]) == "--test")
        return runUnitTests();

    if (argc > 1 && juce::String(argv[1]) == "--scan")
        return runScanReport();

    if (argc > 2 && juce::String(argv[1]) == "--scan-one")
        return runScanOne(juce::String(argv[2]));

    if (argc > 2 && juce::String(argv[1]) == "--scan-one-json")
        return runScanOneJson(juce::String(argv[2]));

    if (argc > 1 && juce::String(argv[1]) == "--spike")
        return runSpike();

    if (argc > 2 && juce::String(argv[1]) == "--serve")
        return runServe(juce::String(argv[2]).getIntValue());

    if (argc > 4 && juce::String(argv[1]) == "--render-test")
        return runRenderTest(juce::String(argv[2]), juce::String(argv[3]), juce::String(argv[4]).getDoubleValue());

    if (argc > 3 && juce::String(argv[1]) == "--test-client")
        return runTestClient(juce::String(argv[2]).getIntValue(), juce::String(argv[3]));

    juce::Logger::writeToLog("ssstitch-engine Phase 0 spike: JUCE core linked OK.");
    return 0;
}

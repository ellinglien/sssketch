#include <cmath>
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include "PluginScanner.h"
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

// Proof-of-concept for offline (non-real-time) plugin hosting: load a real
// VST3/AU effect by exact file path and run a real WAV file through it,
// writing the processed result back out — so the effect can actually be
// listened to and compared against the dry input, rather than just
// asserting "processBlock() didn't crash" the way runSpike's synthetic-tone
// version does. Deliberately offline-only for now (not wired into
// Transport.cpp's real-time callback, or the arranger's own project
// format/UI) — see the conversation this was built from for why: proving
// correct end-to-end processing on the easier, non-real-time-constrained
// path first.
static int runPluginProcess(
    const juce::String& pluginPath,
    const juce::String& inputWavPath,
    const juce::String& outputWavPath)
{
    juce::AudioPluginFormatManager formatManager;
    formatManager.addDefaultFormats();

    juce::Array<juce::PluginDescription> found;
    scanOneFileInto(formatManager, pluginPath, found);
    if (found.isEmpty())
    {
        juce::Logger::writeToLog("runPluginProcess: no plugin found at " + pluginPath
            + " (wrong path, or an architecture this host can't load — see PHASE0_FINDINGS.md #3)");
        return 1;
    }
    const auto& desc = found.getReference(0);
    juce::Logger::writeToLog("Loading [" + desc.pluginFormatName + "] " + desc.name
        + " (" + desc.manufacturerName + ")");

    // A separate AudioFormatManager from the plugin one above — same class,
    // different job (decoding WAV files, not scanning plugin binaries).
    juce::AudioFormatManager audioFormatManager;
    audioFormatManager.registerBasicFormats();
    juce::File inFile(inputWavPath);
    std::unique_ptr<juce::AudioFormatReader> reader(audioFormatManager.createReaderFor(inFile));
    if (reader == nullptr)
    {
        juce::Logger::writeToLog("runPluginProcess: failed to open input WAV: " + inputWavPath);
        return 1;
    }
    // Processing at the file's own rate, not a hardcoded 44100 — running a
    // plugin at the wrong sample rate silently mistunes any time-based
    // behavior (a compressor's release time, a delay/reverb's tail length).
    const double sampleRate = reader->sampleRate;
    const int numSamples = (int) reader->lengthInSamples;

    juce::AudioBuffer<float> buffer((int) reader->numChannels, numSamples);
    if (!reader->read(&buffer, 0, numSamples, 0, true, true))
    {
        juce::Logger::writeToLog("runPluginProcess: failed to read input WAV samples");
        return 1;
    }

    juce::String errorMessage;
    constexpr int blockSize = 512; // matches this engine's block size elsewhere (Transport.cpp, RenderExport.cpp)
    auto instance = formatManager.createPluginInstance(desc, sampleRate, blockSize, errorMessage);
    if (instance == nullptr)
    {
        juce::Logger::writeToLog("runPluginProcess: FAILED to load \"" + desc.name + "\": " + errorMessage);
        return 1;
    }
    instance->prepareToPlay(sampleRate, blockSize);

    // getTotalNumInputChannels()/getTotalNumOutputChannels() are the SUM
    // across every bus the plugin exposes — many mix-bus effects (this one
    // included) have a second stereo bus beyond the main in/out pair, for a
    // sidechain input. processBlock needs the buffer sized to that full
    // total or it'll silently misinterpret which samples belong to which
    // bus; the final file only wants the *main* bus's own channels (bus
    // index 0) — genuinely processed audio, not an unprocessed sidechain
    // pass-through sharing the buffer.
    const int totalInputChannels = juce::jmax(1, instance->getTotalNumInputChannels());
    const int totalOutputChannels = juce::jmax(1, instance->getTotalNumOutputChannels());
    auto* mainOutputBus = instance->getBus(false, 0);
    const int mainOutputChannels =
        mainOutputBus != nullptr ? mainOutputBus->getNumberOfChannels() : totalOutputChannels;
    juce::Logger::writeToLog("  bus layout: " + juce::String(totalInputChannels) + " total in, "
        + juce::String(totalOutputChannels) + " total out, " + juce::String(mainOutputChannels)
        + " on the main output bus");

    // Reshape to the plugin's full input channel count (most compressors/
    // effects are stereo-in/stereo-out on the main bus, possibly plus a
    // sidechain bus beyond that) rather than failing on a mismatch —
    // duplicates a mono/stereo source's channels across whatever the plugin
    // wants, tiling if there are more plugin channels than source channels.
    const int processChannels = juce::jmax(totalInputChannels, totalOutputChannels);
    if (processChannels != buffer.getNumChannels())
    {
        juce::AudioBuffer<float> reshaped(processChannels, numSamples);
        for (int ch = 0; ch < processChannels; ++ch)
            reshaped.copyFrom(ch, 0, buffer, juce::jmin(ch, buffer.getNumChannels() - 1), 0, numSamples);
        buffer = std::move(reshaped);
    }

    juce::MidiBuffer midi;
    for (int start = 0; start < numSamples; start += blockSize)
    {
        const int thisBlock = juce::jmin(blockSize, numSamples - start);
        // A view into buffer's own data at this offset, not a copy — the
        // plugin processes (and this writes back) in place, block by block.
        juce::AudioBuffer<float> blockView(
            buffer.getArrayOfWritePointers(), buffer.getNumChannels(), start, thisBlock);
        instance->processBlock(blockView, midi);
        midi.clear(); // no MIDI input for this proof of concept — an audio effect, not an instrument
    }
    instance->releaseResources();

    // Only the main output bus's channels go to the file — see the bus-layout
    // comment above for why the processed buffer can have more than this.
    juce::AudioBuffer<float> mainOutput(mainOutputChannels, numSamples);
    for (int ch = 0; ch < mainOutputChannels; ++ch)
        mainOutput.copyFrom(ch, 0, buffer, juce::jmin(ch, buffer.getNumChannels() - 1), 0, numSamples);

    juce::WavAudioFormat wavFormat;
    auto outFile = juce::File(outputWavPath);
    outFile.deleteFile();
    std::unique_ptr<juce::FileOutputStream> out(outFile.createOutputStream());
    if (out == nullptr)
    {
        juce::Logger::writeToLog("runPluginProcess: failed to open output path for writing: " + outputWavPath);
        return 1;
    }
    std::unique_ptr<juce::AudioFormatWriter> writer(wavFormat.createWriterFor(
        out.get(), sampleRate, (unsigned int) mainOutputChannels, 16, {}, 0));
    if (writer == nullptr)
    {
        juce::Logger::writeToLog("runPluginProcess: failed to create WAV writer for: " + outputWavPath);
        return 1;
    }
    out.release();
    writer->writeFromAudioSampleBuffer(mainOutput, 0, numSamples);
    writer.reset();

    juce::Logger::writeToLog("runPluginProcess: wrote " + outputWavPath + " ("
        + juce::String(numSamples) + " samples, " + juce::String(mainOutputChannels) + " ch, "
        + juce::String(sampleRate) + "Hz)");
    return 0;
}

static int runServe(int port)
{
    StemBufferCache bufferCache;
    PlaybackEngine engine(bufferCache);
    Transport transport(engine);
    transport.openDefaultDevice(); // best-effort — if it fails (no device, e.g. CI),
                                    // the engine still serves IPC and PlaybackEngine
                                    // still renders correctly, just nothing plays out loud

    IpcServer server(engine, transport, bufferCache);
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

    if (argc > 1 && juce::String(argv[1]) == "--spike")
        return runSpike();

    if (argc > 2 && juce::String(argv[1]) == "--serve")
        return runServe(juce::String(argv[2]).getIntValue());

    if (argc > 4 && juce::String(argv[1]) == "--render-test")
        return runRenderTest(juce::String(argv[2]), juce::String(argv[3]), juce::String(argv[4]).getDoubleValue());

    if (argc > 3 && juce::String(argv[1]) == "--test-client")
        return runTestClient(juce::String(argv[2]).getIntValue(), juce::String(argv[3]));

    if (argc > 4 && juce::String(argv[1]) == "--plugin-process")
        return runPluginProcess(juce::String(argv[2]), juce::String(argv[3]), juce::String(argv[4]));

    juce::Logger::writeToLog("ssstitch-engine Phase 0 spike: JUCE core linked OK.");
    return 0;
}

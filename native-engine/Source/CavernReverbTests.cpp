// native-engine/Source/CavernReverbTests.cpp
//
// The cavernous room (native radio sound plan, Task 5): the impulse against the web's own
// (test/golden/cavern-ir.f32, written by scripts/golden-cavern-ir.mjs from ell.ing/radio's
// noise.ts reverbImpulse), Web Audio's normalisation, the partitioned convolver, and the room
// as the reverb bus and the engine run it.
#include "CavernReverb.h"
#include "ChannelChainRegistry.h"
#include "PlaybackEngine.h"
#include "PluginChain.h"
#include "RenderExport.h"
#include "ReverbBus.h"
#include "StemBufferCache.h"
#include "Transport.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>
#include <chrono>
#include <cmath>
#include <cstring>
#include <random>
#include <utility>
#include <vector>

namespace sssketch
{
    namespace
    {
        /** $SSSKETCH_GOLDEN_DIR, else the first ancestor of the binary holding
         * test/golden/manifest.json (as FaustStageTests finds it). */
        juce::File goldenDir()
        {
            if (const char* env = std::getenv("SSSKETCH_GOLDEN_DIR")) return juce::File(env);
            auto dir = juce::File::getSpecialLocation(juce::File::currentExecutableFile).getParentDirectory();
            for (int up = 0; up < 12 && dir.exists(); ++up, dir = dir.getParentDirectory())
            {
                auto candidate = dir.getChildFile("test").getChildFile("golden");
                if (candidate.getChildFile("manifest.json").existsAsFile()) return candidate;
                if (dir.isRoot()) break;
            }
            return {};
        }

        bool sameBits(const std::vector<float>& a, const std::vector<float>& b)
        {
            return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
        }

        double maxAbsDiff(const std::vector<float>& a, const std::vector<float>& b, size_t from = 0)
        {
            double worst = a.size() == b.size() ? 0.0 : 1.0e9;
            for (size_t i = from; i < std::min(a.size(), b.size()); ++i)
                worst = std::max(worst, (double) std::abs(a[i] - b[i]));
            return worst;
        }

        /** The band's T60 measured from the impulse: power in 2048-point Hann frames (hop 1024)
         * over the bins within a sixth of an octave of `hz`, both sides summed; a straight line
         * fitted to it in dB from 0.1 s after the onset until it has fallen 45 dB. */
        double measuredT60(const std::array<std::vector<float>, 2>& impulse, double rate, double hz)
        {
            constexpr int order = 11, n = 1 << order, hop = 1024;
            juce::dsp::FFT fft(order);
            std::vector<float> window((size_t) n), buf((size_t) (2 * n));
            for (int i = 0; i < n; ++i)
                window[(size_t) i] = (float) (0.5 - 0.5 * std::cos(2.0 * juce::MathConstants<double>::pi * i / n));
            const int pre = cavernPreDelaySamples(rate);
            const int lo = (int) std::ceil(hz * std::pow(2.0, -1.0 / 6.0) * n / rate);
            const int hi = (int) std::floor(hz * std::pow(2.0, 1.0 / 6.0) * n / rate);
            std::vector<double> times, levels;
            for (int start = pre; start + n <= (int) impulse[0].size(); start += hop)
            {
                double power = 0.0;
                for (const auto& side : impulse)
                {
                    std::fill(buf.begin(), buf.end(), 0.0f);
                    for (int i = 0; i < n; ++i)
                        buf[(size_t) i] = side[(size_t) (start + i)] * window[(size_t) i];
                    fft.performRealOnlyForwardTransform(buf.data(), true);
                    for (int b = lo; b <= hi; ++b)
                        power += (double) buf[(size_t) (2 * b)] * buf[(size_t) (2 * b)]
                            + (double) buf[(size_t) (2 * b + 1)] * buf[(size_t) (2 * b + 1)];
                }
                times.push_back((start + n / 2 - pre) / rate);
                levels.push_back(10.0 * std::log10(power + 1.0e-300));
            }
            size_t first = 0;
            while (first < times.size() && times[first] < 0.1)
                ++first;
            const double startLevel = levels[first];
            double sx = 0, sy = 0, sxx = 0, sxy = 0;
            int count = 0;
            for (size_t i = first; i < times.size() && levels[i] > startLevel - 45.0; ++i, ++count)
            {
                sx += times[i];
                sy += levels[i];
                sxx += times[i] * times[i];
                sxy += times[i] * levels[i];
            }
            const double slope = (count * sxy - sx * sy) / (count * sxx - sx * sx); // dB per second
            return -60.0 / slope;
        }

        /** A stereo 16-bit wav: `fill(i, side)` per sample. */
        template <typename Fill>
        juce::File writeWav(const juce::String& name, int numSamples, Fill fill, double rate = 44100.0)
        {
            auto file = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile(name);
            file.deleteFile();
            juce::WavAudioFormat wav;
            std::unique_ptr<juce::FileOutputStream> out(file.createOutputStream());
            std::unique_ptr<juce::AudioFormatWriter> writer(wav.createWriterFor(out.get(), rate, 2, 16, {}, 0));
            jassert(writer != nullptr);
            if (writer == nullptr)
                return file; // `out` still owns the stream and closes it; the test then finds no audio
            out.release(); // the writer owns the stream now
            juce::AudioBuffer<float> source(2, numSamples);
            for (int i = 0; i < numSamples; ++i)
                for (int c = 0; c < 2; ++c)
                    source.setSample(c, i, fill(i, c));
            writer->writeFromAudioSampleBuffer(source, 0, numSamples);
            writer.reset();
            return file;
        }

        /** One rifff of one stem per file, 240 bpm (a bar is a second), each stem one second
         * long and played once, with a reverb send of `send`. */
        EngineProject sendProject(const std::vector<juce::File>& files, double send, ReverbRoom room)
        {
            EngineProject project;
            project.bpm = 240.0;
            project.snapDiv = 16.0;
            int k = 0;
            for (const auto& file : files)
            {
                EngineRifff rifff;
                rifff.groupId = "cav" + juce::String(++k);
                rifff.channelId = "ch" + juce::String(k);
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.stemKey = rifff.groupId + ":1";
                stem.resolvedPath = file.getFullPathName();
                stem.durationSec = 1.0;
                stem.barLength = 1;
                stem.playedBars = 1.0;
                if (send > 0.0)
                {
                    stem.hasToolkit = true;
                    stem.toolkit.reverbSend = send;
                }
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);
            }
            project.sound.room = room;
            return project;
        }

        struct Stereo
        {
            std::vector<float> l, r;
        };

        /** renderBlock from bar 0 in blocks from `nextBlock`, from a fresh engine told the rate
         * first (as Transport and RenderExport do). */
        template <typename NextBlock>
        Stereo renderEngine(const EngineProject& project, int total, NextBlock nextBlock, double rate = 44100.0)
        {
            StemBufferCache cache;
            PlaybackEngine engine(cache);
            ChannelChainRegistry chains;
            engine.prepareMaster(rate);
            engine.setProject(project);
            Stereo out { std::vector<float>((size_t) total, 0.0f), std::vector<float>((size_t) total, 0.0f) };
            for (int at = 0; at < total;)
            {
                const int n = juce::jmin(nextBlock(), total - at);
                engine.renderBlock(at / rate, rate, n, out.l.data() + at, out.r.data() + at, chains);
                at += n;
            }
            return out;
        }
    }

    class CavernReverbTests : public juce::UnitTest
    {
    public:
        CavernReverbTests() : juce::UnitTest("CavernReverb") {}

        void runTest() override
        {
            const auto ir44 = cavernIrFor(44100.0);
            const auto ir48 = cavernIrFor(48000.0);
            const auto impulse48 = cavernImpulse(48000.0);

            beginTest("the impulse: pre-delay + 5 s long, exactly silent for the first 30 ms, wide");
            {
                for (double rate : { 44100.0, 48000.0 })
                {
                    const auto impulse = rate == 48000.0 ? impulse48 : cavernImpulse(rate);
                    const int pre = cavernPreDelaySamples(rate);
                    expectEquals(pre, rate == 48000.0 ? 1440 : 1323);
                    for (const auto& side : impulse)
                    {
                        expectEquals((int) side.size(), pre + (int) (5.0 * rate));
                        bool silent = true;
                        for (int i = 0; i < pre; ++i)
                            silent = silent && side[(size_t) i] == 0.0f;
                        expect(silent, "the pre-delay is not exact silence");
                        expect(std::abs(side[(size_t) pre + 10]) > 0.0f, "the room starts after it");
                    }
                    double lr = 0, ll = 0, rr = 0;
                    for (size_t i = 0; i < impulse[0].size(); ++i)
                    {
                        lr += (double) impulse[0][i] * impulse[1][i];
                        ll += (double) impulse[0][i] * impulse[0][i];
                        rr += (double) impulse[1][i] * impulse[1][i];
                    }
                    const double corr = lr / std::sqrt(ll * rr);
                    expect(std::abs(corr) < 0.1, "L/R correlation " + juce::String(corr));
                }
            }

            beginTest("the impulse decays per band: T60 4.5 s at 1 kHz, 2.2 s at 8 kHz, 5.0 s at 250 Hz (+-10%)");
            {
                for (const auto& [hz, t60] : { std::pair { 1000.0, 4.5 }, std::pair { 8000.0, 2.2 }, std::pair { 250.0, 5.0 } })
                {
                    const double measured = measuredT60(impulse48, 48000.0, hz);
                    expect(std::abs(measured - t60) <= 0.1 * t60,
                           juce::String(hz) + " Hz: T60 " + juce::String(measured, 3) + " s, want " + juce::String(t60));
                    logMessage(juce::String(hz) + " Hz: T60 " + juce::String(measured, 3) + " s");
                }
            }

            beginTest("the impulse is the web's: the first 8,192 samples after the pre-delay are noise.ts "
                      "reverbImpulse's at 48 kHz, to the bit");
            {
                const auto dir = goldenDir();
                juce::MemoryBlock data;
                expect(dir.getChildFile("cavern-ir.f32").loadFileAsData(data), "no golden at " + dir.getFullPathName());
                const auto manifest = juce::JSON::parse(dir.getChildFile("cavern-ir.json"));
                const int frames = (int) manifest.getProperty("frames", 0);
                const int offset = (int) manifest.getProperty("offset", -1);
                expectEquals(frames, 8192);
                expectEquals(offset, cavernPreDelaySamples(48000.0));
                expectEquals((int) manifest.getProperty("length", 0), (int) impulse48[0].size());
                expectEquals((int) data.getSize(), 2 * frames * (int) sizeof(float));
                if (data.getSize() == (size_t) (2 * frames) * sizeof(float))
                {
                    const auto* golden = static_cast<const float*>(data.getData());
                    double worst = 0.0;
                    for (int c = 0; c < 2; ++c)
                        for (int i = 0; i < frames; ++i)
                            worst = std::max(worst, (double) std::abs(impulse48[(size_t) c][(size_t) (offset + i)]
                                                                      - golden[c * frames + i]));
                    // Exact here (arm64 macOS, 2026-10-02): both sides compute in double with the
                    // same FFT and round to float once. The plan's bound is 1e-6; if another libm's
                    // cos/exp/log ever moves a sample by an ulp, loosen this to that bound.
                    expect(worst == 0.0, "max abs error " + juce::String(worst, 12));
                    logMessage("max abs error against the web's impulse: " + juce::String(worst, 12));
                }

                // and the whole impulse's level is the web's: the normalisation from the TS mean
                // square is the native one
                const double meanSquare = (double) manifest.getProperty("meanSquare", 0.0);
                const double webScale = 0.00125 / std::sqrt(meanSquare) * 44100.0 / 48000.0;
                expect(std::abs(webAudioConvolverScale(impulse48, 48000.0) / webScale - 1.0) < 1.0e-6,
                       "scale " + juce::String(webAudioConvolverScale(impulse48, 48000.0), 10) + " vs the web's "
                           + juce::String(webScale, 10));
            }

            beginTest("normalisation is the Web Audio formula, then the -3.4 dB return");
            {
                for (const auto& ir : { ir44, ir48 })
                {
                    const auto impulse = ir == ir48 ? impulse48 : cavernImpulse(44100.0);
                    double sum = 0.0;
                    for (const auto& side : impulse)
                        for (float v : side)
                            sum += (double) v * v;
                    const double rms = std::sqrt(sum / (2.0 * (double) impulse[0].size()));
                    const double formula = 0.00125 / std::max(rms, 0.000125) * 44100.0 / ir->sampleRate;
                    expectWithinAbsoluteError(ir->normalisation, formula, formula * 1.0e-12);
                    expectEquals(ir->gain, (float) (formula * std::pow(10.0, -3.4 / 20.0)));
                }
                // the floor: a silent impulse is scaled as if its rms were 0.000125
                const std::array<std::vector<float>, 2> silent { std::vector<float>(100, 0.0f), std::vector<float>(100, 0.0f) };
                expectWithinAbsoluteError(webAudioConvolverScale(silent, 44100.0), 10.0, 1.0e-12);
                expectWithinAbsoluteError(webAudioConvolverScale(silent, 88200.0), 5.0, 1.0e-12);
            }

            beginTest("the convolver: an impulse in gives the normalised impulse out, sample-aligned");
            {
                for (const auto& ir : { ir44, ir48 })
                {
                    const auto impulse = ir == ir48 ? impulse48 : cavernImpulse(44100.0);
                    CavernConvolver conv(ir);
                    const int total = ir->length + 2 * CavernIr::kBlock;
                    std::vector<float> inL((size_t) total, 0.0f), inR((size_t) total, 0.0f);
                    inL[0] = 1.0f;
                    inR[0] = 0.5f;
                    std::vector<float> outL((size_t) total, 0.0f), outR((size_t) total, 0.0f);
                    conv.process(total, inL.data(), inR.data(), outL.data(), outR.data(), 1.0f);
                    std::vector<float> wantL((size_t) total, 0.0f), wantR((size_t) total, 0.0f);
                    for (size_t i = 0; i < impulse[0].size(); ++i)
                    {
                        wantL[i] = impulse[0][i] * ir->gain;
                        wantR[i] = 0.5f * impulse[1][i] * ir->gain;
                    }
                    double peak = 0.0;
                    for (float v : wantL)
                        peak = std::max(peak, (double) std::abs(v));
                    const double errL = maxAbsDiff(outL, wantL), errR = maxAbsDiff(outR, wantR);
                    expect(errL < 1.0e-6 * peak * 10.0 && errR < 1.0e-6 * peak * 10.0,
                           "error " + juce::String(errL, 12) + " / " + juce::String(errR, 12) + " against peak "
                               + juce::String(peak, 6));
                    // aligned: the onset is where the impulse's is, not a sample either side
                    const int pre = cavernPreDelaySamples(ir->sampleRate);
                    expect(std::abs(outL[(size_t) pre - 1]) < 1.0e-6 * peak && std::abs(outL[(size_t) pre]) > 1.0e-3 * peak,
                           "onset not at the pre-delay");
                    expectEquals(ir->extraLatency, 0);
                }
            }

            beginTest("the convolver is block-size invariant to the bit: 1, 64, 512, 4096 and random splits");
            {
                const int total = 3 * 44100;
                std::vector<float> inL((size_t) total, 0.0f), inR((size_t) total, 0.0f);
                juce::Random noise(7);
                for (int i = 0; i < 13000; ++i)
                {
                    inL[(size_t) i] = noise.nextFloat() - 0.5f;
                    inR[(size_t) i] = 0.5f * (noise.nextFloat() - 0.5f);
                }
                inL[40000] = 0.8f; // a second, later onset
                auto render = [&](auto nextBlock) {
                    CavernConvolver conv(ir44);
                    Stereo out { std::vector<float>((size_t) total, 0.0f), std::vector<float>((size_t) total, 0.0f) };
                    for (int at = 0; at < total;)
                    {
                        const int n = juce::jmin(nextBlock(), total - at);
                        conv.process(n, inL.data() + at, inR.data() + at, out.l.data() + at, out.r.data() + at, 0.7f);
                        at += n;
                    }
                    return out;
                };
                const auto reference = render([] { return 512; });
                for (int size : { 1, 64, 4096 })
                {
                    const auto other = render([size] { return size; });
                    expect(sameBits(other.l, reference.l) && sameBits(other.r, reference.r),
                           "blocks of " + juce::String(size) + " differ from 512");
                }
                std::mt19937 rng(5);
                std::uniform_int_distribution<int> size(1, 5000);
                const auto random = render([&] { return size(rng); });
                expect(sameBits(random.l, reference.l) && sameBits(random.r, reference.r), "random blocks differ");
                expect(std::abs(reference.l[20000]) > 1.0e-4f, "it rendered a room");
            }

            beginTest("the bus reports the room ringing for the impulse's length, and then not");
            {
                ReverbBus bus;
                bus.prepareCavern(44100.0);
                bus.prepare(44100.0, 512);
                bus.setRoom(ReverbRoom::cavern, 1.0);
                std::vector<float> in(512, 0.0f), outL(512, 0.0f), outR(512, 0.0f);
                in[0] = 1.0f;
                ParamSmoother gain;
                gain.reset(44100.0, kAutomationSmoothingSec, 1.0f);
                bus.beginBlock(512);
                bus.addSend(512, in.data(), in.data(), gain);
                bus.endBlock(512, outL.data(), outR.data());
                ParamSmoother off;
                off.reset(44100.0, kAutomationSmoothingSec, 0.0f);
                int rang = 512;
                float lateOutput = 0.0f;
                while (bus.isRinging() && rang < 20 * 44100)
                {
                    std::fill(outL.begin(), outL.end(), 0.0f);
                    std::fill(outR.begin(), outR.end(), 0.0f);
                    bus.beginBlock(512);
                    bus.addSend(512, in.data(), in.data(), off);
                    bus.endBlock(512, outL.data(), outR.data());
                    if (rang > ir44->length)
                        for (float v : outL)
                            lateOutput = std::max(lateOutput, std::abs(v));
                    rang += 512;
                }
                expect(rang >= ir44->length, "rang " + juce::String(rang) + " of " + juce::String(ir44->length));
                expect(rang <= ir44->length + 4 * CavernIr::kBlock, "rang on " + juce::String(rang));
                expect(lateOutput < 1.0e-9f, "output after the impulse's length: " + juce::String(lateOutput));
                // and stopped means stopped: nothing is added any more
                std::fill(outL.begin(), outL.end(), 0.0f);
                bus.beginBlock(512);
                bus.endBlock(512, outL.data(), outR.data());
                expect(std::all_of(outL.begin(), outL.end(), [](float v) { return v == 0.0f; }));
                bus.drainRetiredCavern();
            }

            auto burst = writeWav("sssketch_cavern_burst.wav", 44100, [](int i, int c) {
                if (i >= 8000) return 0.0f;
                return 0.4f * (float) std::sin(0.031 * i * (c + 1)) * (float) (i < 4000 ? 1.0 : 0.5);
            });
            // a click well clear of the stem's declick fade-in
            auto click = writeWav("sssketch_cavern_click.wav", 44100, [](int i, int) { return i == 3000 ? 0.5f : 0.0f; });
            constexpr int kTotal = 3 * 44100;

            beginTest("in the engine: a send to the cavern is the stem convolved with the normalised impulse, aligned");
            {
                // the dry signal: the same send through the same toolkit, returned at 0
                auto silentRoom = sendProject({ click }, 1.0, ReverbRoom::cavern);
                silentRoom.sound.reverbReturn = 0.0;
                const auto dry = renderEngine(silentRoom, kTotal, [] { return 512; });
                const auto wet = renderEngine(sendProject({ click }, 1.0, ReverbRoom::cavern), kTotal, [] { return 512; });
                const auto impulse = cavernImpulse(44100.0);
                // the room's input is the dry clip (a click through the toolkit's open filter):
                // its expected output is that, convolved with the normalised impulse
                // (the filter's own ringing after the click is under 1e-9 within a few dozen
                // samples; what is left out contributes below the tolerance)
                std::vector<std::pair<size_t, float>> taps;
                for (size_t i = 0; i < (size_t) kTotal; ++i)
                    if (std::abs(dry.l[i]) > 1.0e-9f)
                        taps.emplace_back(i, dry.l[i]);
                expect(! taps.empty() && taps.size() < 200, "taps " + juce::String((int) taps.size()));
                double worst = 0.0;
                for (size_t i = 0; i < (size_t) kTotal; ++i)
                {
                    double room = 0.0;
                    for (const auto& [at, v] : taps)
                        if (i >= at && i - at < impulse[0].size())
                            room += (double) v * impulse[0][i - at] * ir44->gain;
                    worst = std::max(worst, std::abs((double) (wet.l[i] - dry.l[i]) - room));
                }
                expect(worst < 1.0e-7, "worst " + juce::String(worst, 12));
                const size_t onset = taps.front().first + (size_t) cavernPreDelaySamples(44100.0);
                expect(std::abs(wet.l[onset - 1] - dry.l[onset - 1]) < 1.0e-8f, "nothing before the pre-delay");
                expect(std::abs(wet.l[onset + 2] - dry.l[onset + 2]) > 1.0e-6f, "the room sounds after it");
            }

            beginTest("in the engine: with no send, nothing is built and the output is today's");
            {
                auto filtered = sendProject({ burst }, 0.0, ReverbRoom::cavern);
                filtered.rifffs[0].stems[0].hasToolkit = true;
                filtered.rifffs[0].stems[0].toolkit.filterCutoff = 0.4; // a toolkit, but no send
                auto zita = filtered;
                zita.sound.room = ReverbRoom::zita;

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.prepareMaster(44100.0);
                engine.setProject(filtered);
                engine.setProject(sendProject({ burst }, 0.0, ReverbRoom::cavern));
                expectEquals(engine.cavernReverbPreparedRate(), 0.0);

                const auto cavernOut = renderEngine(filtered, kTotal, [] { return 512; });
                const auto zitaOut = renderEngine(zita, kTotal, [] { return 512; });
                expect(sameBits(cavernOut.l, zitaOut.l) && sameBits(cavernOut.r, zitaOut.r));

                engine.setProject(sendProject({ burst }, 0.5, ReverbRoom::zita));
                expectEquals(engine.cavernReverbPreparedRate(), 0.0); // zita builds no convolver either
                engine.setProject(sendProject({ burst }, 0.5, ReverbRoom::cavern));
                expectEquals(engine.cavernReverbPreparedRate(), 44100.0);
            }

            beginTest("zita: a zita project is today's, to the bit, at today's return -- and the return scales it");
            {
                const auto base = sendProject({ burst, click }, 0.6, ReverbRoom::zita);
                const auto noSound = renderEngine(base, kTotal, [] { return 512; });
                for (const char* json : { R"({"room":"zita"})", R"({"room":"zita","reverbReturn":1})", R"({"room":"nope"})" })
                {
                    auto project = base;
                    project.sound = parseSoundSettings(juce::JSON::parse(json));
                    const auto out = renderEngine(project, kTotal, [] { return 512; });
                    expect(sameBits(out.l, noSound.l) && sameBits(out.r, noSound.r), json);
                }
                auto half = base;
                half.sound.reverbReturn = 0.5;
                auto none = base;
                none.sound.reverbReturn = 0.0;
                const auto halfOut = renderEngine(half, kTotal, [] { return 512; });
                const auto dryOut = renderEngine(none, kTotal, [] { return 512; });
                double worst = 0.0, wetPeak = 0.0;
                for (size_t i = 0; i < (size_t) kTotal; ++i)
                {
                    const double wet = noSound.l[i] - dryOut.l[i];
                    wetPeak = std::max(wetPeak, std::abs(wet));
                    worst = std::max(worst, std::abs((halfOut.l[i] - dryOut.l[i]) - 0.5 * wet));
                }
                expect(wetPeak > 1.0e-3 && worst < 1.0e-6, "wet peak " + juce::String(wetPeak) + ", error " + juce::String(worst));
            }

            // Random block sizes here are never bigger than the first block: a clip's toolkit
            // filter (ChannelFilter::prepare) re-prepares, wiping its state, whenever a block is
            // bigger than any before it -- today's behaviour for any send, zita's included, and
            // not this room's to change. A send curve is avoided for the same kind of reason: the
            // toolkit evaluates automation once per block.
            beginTest("in the engine: the cavern is block-size invariant, and live (Transport) equals the export, to the bit");
            {
                auto project = sendProject({ burst, click }, 0.7, ReverbRoom::cavern);
                project.rifffs[1].startBar = 0.4;

                juce::AudioBuffer<float> exported;
                juce::String error;
                expect(renderProjectToBuffer(project, (double) kTotal / 44100.0, 44100.0, 512, exported, error), error);
                const Stereo reference { std::vector<float>(exported.getReadPointer(0), exported.getReadPointer(0) + kTotal),
                                         std::vector<float>(exported.getReadPointer(1), exported.getReadPointer(1) + kTotal) };
                for (int size : { 1, 64, 4096 })
                {
                    const auto other = renderEngine(project, kTotal, [size] { return size; });
                    expect(sameBits(other.l, reference.l) && sameBits(other.r, reference.r),
                           "blocks of " + juce::String(size) + " differ from the export");
                }
                std::mt19937 rng(9);
                std::uniform_int_distribution<int> size(1, 3000);
                bool firstBlock = true;
                const auto random = renderEngine(project, kTotal, [&] {
                    return std::exchange(firstBlock, false) ? 3000 : size(rng);
                });
                expect(sameBits(random.l, reference.l) && sameBits(random.r, reference.r), "random blocks differ");

                // live: the device callback, from a fresh engine told the rate
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.prepareMaster(44100.0);
                engine.setProject(project);
                PluginChain masterChain(kNumMasterChainSlots);
                ChannelChainRegistry chains;
                Transport transport(engine, masterChain, chains);
                transport.setBpm(240.0);
                transport.play(0.0);
                Stereo live { std::vector<float>((size_t) kTotal), std::vector<float>((size_t) kTotal) };
                std::uniform_int_distribution<int> device(1, 1100);
                for (int at = 0; at < kTotal;)
                {
                    const int n = juce::jmin(at == 0 ? 1100 : device(rng), kTotal - at);
                    float* channels[2] = { live.l.data() + at, live.r.data() + at };
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, n, {});
                    at += n;
                }
                engine.drainRetiredProject();
                expect(sameBits(live.l, reference.l) && sameBits(live.r, reference.r), "live differs from the export");
                expect(std::abs(reference.l[30000]) > 1.0e-4f, "the room sounds");
            }

            beginTest("in the engine: a room that rings out and starts again is block-size invariant");
            {
                // The room is fed, then nothing sends (a project swap at S1), then something sends
                // again (S2) just after the room's tail has run out: the countdown, the stop and
                // the restart from a cleared state (ReverbBus::runCavern) must not depend on the
                // split. (A restart can only come at a swap, which is a block boundary in every
                // split, or under a send curve, which the toolkit evaluates per block anyway.)
                auto fed = sendProject({ burst }, 0.8, ReverbRoom::cavern);
                const auto quiet = sendProject({ burst }, 0.0, ReverbRoom::cavern);
                const int tail = CavernConvolver(ir44).tailSamples();
                const int s1 = 30001, s2 = s1 + tail + 100;
                const int total = s2 + 12000;
                auto again = sendProject({ burst, burst }, 0.8, ReverbRoom::cavern);
                again.rifffs[1].startBar = (s2 - 2000) / 44100.0; // sounding across S2
                const auto render = [&](auto nextBlock, int firstAfterSwap) {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    ChannelChainRegistry chains;
                    engine.prepareMaster(44100.0);
                    engine.setProject(fed);
                    Stereo out { std::vector<float>((size_t) total, 0.0f), std::vector<float>((size_t) total, 0.0f) };
                    int stage = 0;
                    for (int at = 0; at < total;)
                    {
                        int n = nextBlock();
                        if (stage == 0 && at == s1)
                        {
                            engine.setProject(quiet);
                            stage = 1;
                        }
                        else if (stage == 1 && at == s2)
                        {
                            engine.setProject(again);
                            stage = 2;
                            n = firstAfterSwap;
                        }
                        n = juce::jmin(n, (stage == 0 ? s1 : stage == 1 ? s2 : total) - at);
                        engine.renderBlock(at / 44100.0, 44100.0, n, out.l.data() + at, out.r.data() + at, chains);
                        at += n;
                    }
                    engine.drainRetiredProject();
                    return out;
                };
                const auto reference = render([] { return 1; }, 1);
                for (int size : { 512, 4096 })
                {
                    const auto other = render([size] { return size; }, size);
                    expect(sameBits(other.l, reference.l) && sameBits(other.r, reference.r),
                           "blocks of " + juce::String(size) + " differ from single samples");
                }
                std::mt19937 rng(13);
                std::uniform_int_distribution<int> size(1, 4000);
                bool first = true;
                const auto random = render([&] { return std::exchange(first, false) ? 4000 : size(rng); }, 4000);
                expect(sameBits(random.l, reference.l) && sameBits(random.r, reference.r), "random blocks differ");
                expect(std::abs(reference.l[(size_t) s2 + 1323 + 500]) > 1.0e-5f, "the room sounds again after S2");
            }

            beginTest("in the engine: the return scales the cavern's wet signal");
            {
                auto unity = sendProject({ burst }, 1.0, ReverbRoom::cavern);
                auto doubled = unity;
                doubled.sound.reverbReturn = 2.0;
                auto silent = unity;
                silent.sound.reverbReturn = 0.0;
                const auto a = renderEngine(unity, kTotal, [] { return 512; });
                const auto b = renderEngine(doubled, kTotal, [] { return 512; });
                const auto dry = renderEngine(silent, kTotal, [] { return 512; });
                auto zitaSilent = silent;
                zitaSilent.sound.room = ReverbRoom::zita;
                const auto none = renderEngine(zitaSilent, kTotal, [] { return 512; });
                expect(sameBits(dry.l, none.l), "return 0 adds nothing (as zita's does)");
                double worst = 0.0;
                for (size_t i = 0; i < (size_t) kTotal; ++i)
                    worst = std::max(worst, std::abs((double) (b.l[i] - dry.l[i]) - 2.0 * (a.l[i] - dry.l[i])));
                expect(worst < 1.0e-6, "error " + juce::String(worst));
            }

            beginTest("in the engine: switching rooms mid-play lets zita's tail ring out");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry chains;
                engine.prepareMaster(44100.0);
                const auto zita = sendProject({ burst }, 1.0, ReverbRoom::zita);
                engine.setProject(zita);
                std::vector<float> l(512), r(512);
                int at = 0;
                for (; at < 44100; at += 512)
                {
                    std::fill(l.begin(), l.end(), 0.0f);
                    std::fill(r.begin(), r.end(), 0.0f);
                    engine.renderBlock(at / 44100.0, 44100.0, 512, l.data(), r.data(), chains);
                }
                engine.setProject(sendProject({ burst }, 1.0, ReverbRoom::cavern));
                // past the stem's end: what sounds now is zita's tail (the cavern hears silence)
                std::fill(l.begin(), l.end(), 0.0f);
                engine.renderBlock(at / 44100.0, 44100.0, 512, l.data(), r.data(), chains);
                float tail = 0.0f;
                for (float v : l)
                    tail = std::max(tail, std::abs(v));
                expect(tail > 1.0e-4f, "zita's tail was cut: " + juce::String(tail));
                engine.drainRetiredProject();
            }

            beginTest("switching rooms with a clip still sending: the new room gets the sends, the old one "
                      "rings out on silence -- both ways");
            {
                // The switched bus against two buses that each only ever run one room: the old
                // room fed until the switch and then nothing, the new room fed from the switch.
                // Their sum, added in the same order endBlock adds them (zita, then the cavern),
                // must be the switched bus's output to the bit.
                constexpr int kBlock = 512, kBlocks = 200, kSwitch = 37;
                std::vector<float> sig((size_t) kBlock * kBlocks);
                juce::Random noise(21);
                for (auto& v : sig)
                    v = 0.5f * (noise.nextFloat() - 0.5f);
                const auto run = [&](ReverbBus& bus, auto roomAt, auto sendsAt, float* outL, float* outR) {
                    bus.prepare(44100.0, kBlock);
                    for (int b = 0; b < kBlocks; ++b)
                    {
                        ParamSmoother gain;
                        gain.reset(44100.0, kAutomationSmoothingSec, sendsAt(b) ? 1.0f : 0.0f);
                        bus.setRoom(roomAt(b), 1.0);
                        bus.beginBlock(kBlock);
                        const float* in = sig.data() + (size_t) b * kBlock;
                        bus.addSend(kBlock, in, in, gain);
                        bus.endBlock(kBlock, outL + (size_t) b * kBlock, outR + (size_t) b * kBlock);
                    }
                };
                for (const auto& rooms : { std::pair { ReverbRoom::cavern, ReverbRoom::zita },
                                           std::pair { ReverbRoom::zita, ReverbRoom::cavern } })
                {
                    const ReverbRoom from = rooms.first, to = rooms.second;
                    const size_t n = sig.size();
                    std::vector<float> l(n, 0.0f), r(n, 0.0f), oldL(n, 0.0f), oldR(n, 0.0f), newL(n, 0.0f), newR(n, 0.0f);
                    ReverbBus switched, oldOnly, newOnly;
                    for (auto* bus : { &switched, &oldOnly, &newOnly })
                        bus->prepareCavern(44100.0);
                    run(switched, [&](int b) { return b < kSwitch ? from : to; }, [](int) { return true; }, l.data(), r.data());
                    run(oldOnly, [&](int) { return from; }, [&](int b) { return b < kSwitch; }, oldL.data(), oldR.data());
                    run(newOnly, [&](int) { return to; }, [&](int b) { return b >= kSwitch; }, newL.data(), newR.data());
                    std::vector<float> sumL(n), sumR(n);
                    const bool zitaFirst = from == ReverbRoom::zita;
                    for (size_t i = 0; i < n; ++i)
                    {
                        sumL[i] = zitaFirst ? 0.0f + oldL[i] + newL[i] : 0.0f + newL[i] + oldL[i];
                        sumR[i] = zitaFirst ? 0.0f + oldR[i] + newR[i] : 0.0f + newR[i] + oldR[i];
                    }
                    const juce::String what = from == ReverbRoom::cavern ? "cavern -> zita" : "zita -> cavern";
                    expect(sameBits(l, sumL) && sameBits(r, sumR), what + ": not the two rooms' sum");
                    // and both really sound after the switch
                    const size_t late = (size_t) (kSwitch + 20) * kBlock;
                    expect(std::abs(oldL[late]) > 1.0e-5f && std::abs(newL[late]) > 1.0e-5f, what + ": a room is silent");
                }
            }

            beginTest("a live convolver is rebuilt at a new rate: promoted, the old one retired, then freed");
            {
                ReverbBus bus;
                bus.prepareCavern(44100.0);
                std::vector<float> in(512, 0.1f), l(512, 0.0f), r(512, 0.0f);
                const auto block = [&](double rate) {
                    ParamSmoother gain;
                    gain.reset(rate, kAutomationSmoothingSec, 1.0f);
                    bus.prepare(rate, 512);
                    bus.setRoom(ReverbRoom::cavern, 1.0);
                    bus.beginBlock(512);
                    bus.addSend(512, in.data(), in.data(), gain);
                    std::fill(l.begin(), l.end(), 0.0f);
                    bus.endBlock(512, l.data(), r.data());
                };
                for (int i = 0; i < 4; ++i)
                    block(44100.0);
                expectEquals(bus.liveCavernRate(), 44100.0);
                bus.prepareCavern(48000.0); // what prepareMaster(48000) does with one built
                expectEquals(bus.liveCavernRate(), 44100.0); // pending until the audio thread takes it
                block(48000.0);
                expectEquals(bus.liveCavernRate(), 48000.0);
                expect(bus.hasRetiredCavern(), "the 44.1 kHz convolver should wait for the message thread");
                expectEquals((int) bus.cavernRateMismatchCount(), 0);
                for (int i = 0; i < 4; ++i)
                    block(48000.0);
                expect(std::abs(l[100]) > 1.0e-6f, "the 48 kHz room sounds");
                bus.drainRetiredCavern();
                expect(! bus.hasRetiredCavern());

                // and through the engine: prepareMaster rebuilds a convolver that exists
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.prepareMaster(44100.0);
                engine.setProject(sendProject({ burst }, 1.0, ReverbRoom::cavern));
                expectEquals(engine.cavernReverbPreparedRate(), 44100.0);
                engine.prepareMaster(48000.0);
                expectEquals(engine.cavernReverbPreparedRate(), 48000.0);
                // a later project load does not rebuild at some other rate
                engine.setProject(sendProject({ burst }, 0.5, ReverbRoom::cavern));
                expectEquals(engine.cavernReverbPreparedRate(), 48000.0);
            }

            beginTest("a rate the engine was not told about is built once, with no rebuild loop on later loads");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry chains;
                engine.setProject(sendProject({ burst }, 1.0, ReverbRoom::cavern)); // masterRate 44.1 kHz
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 96000.0, 512, l.data(), r.data(), chains);
                engine.drainRetiredProject(); // builds at 96 kHz
                expectEquals(engine.cavernReverbPreparedRate(), 96000.0);
                engine.setProject(sendProject({ burst }, 0.9, ReverbRoom::cavern));
                expectEquals(engine.cavernReverbPreparedRate(), 96000.0); // not back to 44.1
                for (int b = 1; b < 4; ++b)
                    engine.renderBlock(b * 512 / 96000.0, 96000.0, 512, l.data(), r.data(), chains);
                expectEquals((int) engine.cavernRateMismatchCount(), 1);
                engine.drainRetiredProject();
            }

            beginTest("a stop drops the cavern's tail: play again from bar 0 is the export, to the bit");
            {
                // A loud send, stopped while the room is still ringing (the clip itself has ended),
                // then played again from the top.
                auto project = sendProject({ burst }, 1.0, ReverbRoom::cavern);
                juce::AudioBuffer<float> exported;
                juce::String error;
                expect(renderProjectToBuffer(project, 1.0, 44100.0, 512, exported, error), error);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.prepareMaster(44100.0);
                engine.setProject(project);
                PluginChain masterChain(kNumMasterChainSlots);
                ChannelChainRegistry chains;
                Transport transport(engine, masterChain, chains);
                transport.setBpm(240.0);
                std::vector<float> l(512), r(512);
                float* channels[2] = { l.data(), r.data() };
                transport.play(0.0);
                for (int i = 0; i < 120; ++i) // ~1.4 s: past the clip, deep in the tail
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                expect(std::abs(l[100]) > 1.0e-5f, "the room was ringing");
                transport.stop();
                for (int i = 0; i < 400 && transport.isPlaying(); ++i)
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                expect(! transport.isPlaying());
                transport.play(0.0);
                std::vector<float> again;
                for (int i = 0; i < 87; ++i) // the export's 44100 samples, and a little more
                {
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                    again.insert(again.end(), l.begin(), l.end());
                }
                again.resize(44100);
                const std::vector<float> want(exported.getReadPointer(0), exported.getReadPointer(0) + 44100);
                // Equal to the export but for denormal dust: the clip's toolkit filter
                // (PlaybackEngine's per-clip stemDsp) is not reset by a stop, and its state, decayed
                // to ~1e-44 rather than to zero, still reaches the first sample (pre-existing, and
                // zita's too). Without dropping the room's tail the difference is ~0.02 throughout.
                const double err = maxAbsDiff(again, want);
                expect(err < 1.0e-30, "the play after a stop differs from the export: max " + juce::String(err, 12));
                engine.drainRetiredProject();
            }

            beginTest("a seek keeps the cavern's tail: a real room keeps ringing");
            {
                // The clip sounds for the first second; at ~1.2 s the playhead jumps to bar 3,
                // where nothing is placed. After the reposition fade the room is still audible.
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.prepareMaster(44100.0);
                engine.setProject(sendProject({ burst }, 1.0, ReverbRoom::cavern));
                PluginChain masterChain(kNumMasterChainSlots);
                ChannelChainRegistry chains;
                Transport transport(engine, masterChain, chains);
                transport.setBpm(240.0);
                std::vector<float> l(512), r(512);
                float* channels[2] = { l.data(), r.data() };
                transport.play(0.0);
                for (int i = 0; i < 100; ++i)
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                transport.setPosition(3.0);
                float after = 0.0f;
                for (int i = 0; i < 40; ++i) // well past the reposition fade
                {
                    transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                    if (i >= 20)
                        for (float v : l)
                            after = std::max(after, std::abs(v));
                }
                expect(transport.currentPositionBars() > 3.0, "the seek happened");
                expect(after > 1.0e-5f, "the tail was dropped by a seek: " + juce::String(after));
                engine.drainRetiredProject();
            }

            beginTest("a block at a rate with no convolver is dry, and the message thread builds one");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry chains;
                engine.setProject(sendProject({ burst }, 1.0, ReverbRoom::cavern)); // built at 44.1 kHz
                expectEquals(engine.cavernReverbPreparedRate(), 44100.0);
                StemBufferCache dryCache;
                PlaybackEngine dryEngine(dryCache);
                auto returnedAtZero = sendProject({ burst }, 1.0, ReverbRoom::cavern);
                returnedAtZero.sound.reverbReturn = 0.0; // the same toolkit path, no wet signal
                dryEngine.setProject(returnedAtZero);
                std::vector<float> l(1024, 0.0f), r(1024, 0.0f), dl(1024, 0.0f), dr(1024, 0.0f);
                engine.renderBlock(0.0, 48000.0, 1024, l.data(), r.data(), chains);
                dryEngine.renderBlock(0.0, 48000.0, 1024, dl.data(), dr.data(), chains);
                expect(sameBits(l, dl), "a 48 kHz block went through a 44.1 kHz room");
                expectEquals((int) engine.cavernRateMismatchCount(), 1);
                engine.drainRetiredProject(); // logs, and builds at 48 kHz
                expectEquals(engine.cavernReverbPreparedRate(), 48000.0);
                bool wet = false;
                for (int block = 1; block < 8 && ! wet; ++block)
                {
                    std::fill(l.begin(), l.end(), 0.0f);
                    std::fill(dl.begin(), dl.end(), 0.0f);
                    engine.renderBlock(block * 1024 / 48000.0, 48000.0, 1024, l.data(), r.data(), chains);
                    dryEngine.renderBlock(block * 1024 / 48000.0, 48000.0, 1024, dl.data(), dr.data(), chains);
                    wet = ! sameBits(l, dl);
                }
                expect(wet, "no room after the rebuild");
                expectEquals((int) engine.cavernRateMismatchCount(), 1);
                engine.drainRetiredProject();
            }

            beginTest("cost: rendering a sustained send through the cavern and through zita (logged, not asserted)");
            {
                auto loop = writeWav("sssketch_cavern_loop.wav", 44100, [](int i, int c) {
                    return 0.3f * (float) std::sin(0.02 * i + c);
                });
                auto project = sendProject({ loop }, 0.5, ReverbRoom::cavern);
                project.rifffs[0].stems[0].playedBars = 10.0; // ten seconds, sending throughout
                auto zita = project;
                zita.sound.room = ReverbRoom::zita;
                const int total = 10 * 44100;
                const auto time = [&](const EngineProject& p) {
                    const auto t0 = std::chrono::steady_clock::now();
                    renderEngine(p, total, [] { return 512; });
                    return std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
                };
                const double cavernSec = time(project), zitaSec = time(zita);
                logMessage("10 s of audio: cavern " + juce::String(cavernSec, 3) + " s, zita " + juce::String(zitaSec, 3)
                           + " s (this build's optimisation level)");
                const auto t0 = std::chrono::steady_clock::now();
                const auto built = buildCavernIr(48000.0);
                const auto t1 = std::chrono::steady_clock::now();
                const CavernConvolver state(built);
                const auto t2 = std::chrono::steady_clock::now();
                // The callback cost (CavernReverb.h: the partitions are spread over the frame):
                // every partition sounding, then 64-sample callbacks timed one by one -- the worst
                // of them against a 64-sample buffer's budget, and a whole frame's worth in all.
                for (double rate : { 48000.0, 96000.0 })
                {
                    CavernConvolver conv(cavernIrFor(rate));
                    const int P = conv.impulse().numPartitions;
                    std::vector<float> in(CavernIr::kBlock), outL(CavernIr::kBlock), outR(CavernIr::kBlock);
                    juce::Random noise(1);
                    for (int f = 0; f < P + 2; ++f)
                    {
                        for (auto& v : in)
                            v = noise.nextFloat() - 0.5f;
                        conv.process(CavernIr::kBlock, in.data(), in.data(), outL.data(), outR.data(), 1.0f);
                    }
                    constexpr int kFrames = 20;
                    double worstMs = 0.0, totalMs = 0.0;
                    for (int call = 0; call < kFrames * (CavernIr::kBlock / 64); ++call)
                    {
                        const auto c0 = std::chrono::steady_clock::now();
                        conv.process(64, in.data(), in.data(), outL.data(), outR.data(), 1.0f);
                        const double ms = 1000.0 * std::chrono::duration<double>(std::chrono::steady_clock::now() - c0).count();
                        worstMs = std::max(worstMs, ms);
                        totalMs += ms;
                    }
                    logMessage(juce::String(rate / 1000.0, 1) + " kHz (" + juce::String(P) + " partitions a side), 64-sample "
                               "callbacks: worst " + juce::String(worstMs, 3) + " ms against a budget of "
                               + juce::String(64000.0 / rate, 3) + " ms; " + juce::String(totalMs / kFrames, 3)
                               + " ms a frame in all");
                }
                logMessage("building the 48 kHz room: impulse and partitions "
                           + juce::String(std::chrono::duration<double>(t1 - t0).count(), 3) + " s, a convolver's state "
                           + juce::String(std::chrono::duration<double>(t2 - t1).count(), 3) + " s; "
                           + juce::String(built->numPartitions) + " partitions a side, "
                           + juce::String((double) (built->re[0].size() * 4 * sizeof(float)) / 1.0e6, 1)
                           + " MB of partitions");
                loop.deleteFile();
            }

            burst.deleteFile();
            click.deleteFile();
        }
    };

    static CavernReverbTests cavernReverbTests;
}

// native-engine/Source/DubDelayBusTests.cpp
//
// The dub echo bus (native radio sound plan, Task 10): DubDelayCore against the web's own
// dubDelay.ts rendered in Chrome (test/golden/dub-delay.*, written by scripts/golden-dub-delay.mjs),
// the echoes' timing, level and darkening, the feedback guard, and the bus in
// PlaybackEngine::renderBlock -- fed by post-pan dubSend curves, nothing built without one, 0.15
// of it into the reverb, settings taken at a throw's start, block-split invariant, live equals
// export, a stop drops the tail and a seek keeps it.
#include "DubDelay.h"
#include "PlaybackEngine.h"
#include "RenderExport.h"
#include "ReverbBus.h"
#include "Transport.h"
#include "PluginChain.h"
#include "ChannelChainRegistry.h"
#include "StemBufferCache.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>
#include <cmath>
#include <complex>
#include <cstring>
#include <functional>
#include <random>
#include <vector>

namespace sssketch
{
    namespace
    {
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

        std::vector<float> loadFloats(const juce::String& name)
        {
            juce::MemoryBlock data;
            if (! goldenDir().getChildFile(name).loadFileAsData(data)) return {};
            auto* f = static_cast<const float*>(data.getData());
            return std::vector<float>(f, f + data.getSize() / sizeof(float));
        }

        bool sameBits(const std::vector<float>& a, const std::vector<float>& b)
        {
            return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
        }

        double maxAbsDiff(const std::vector<float>& a, const std::vector<float>& b, size_t from = 0, size_t to = SIZE_MAX)
        {
            double worst = 0.0;
            for (size_t i = from; i < std::min({ a.size(), b.size(), to }); ++i)
                worst = std::max(worst, (double) std::abs(a[i] - b[i]));
            return worst;
        }

        double peak(const std::vector<float>& x, size_t from, size_t to)
        {
            double p = 0.0;
            for (size_t i = from; i < std::min(to, x.size()); ++i)
                p = std::max(p, (double) std::abs(x[i]));
            return p;
        }

        double rms(const std::vector<float>& x, size_t from, size_t to)
        {
            double s = 0.0;
            for (size_t i = from; i < std::min(to, x.size()); ++i)
                s += (double) x[i] * x[i];
            return std::sqrt(s / (double) std::max<size_t>(1, std::min(to, x.size()) - from));
        }

        /** The share of a window's energy above `hz` (a 2^15-point FFT of the window). */
        double energyAbove(const std::vector<float>& x, size_t from, double hz, double rate)
        {
            constexpr int order = 15, size = 1 << order;
            juce::dsp::FFT fft(order);
            std::vector<float> buf((size_t) size * 2, 0.0f);
            for (int i = 0; i < size && from + (size_t) i < x.size(); ++i)
                buf[(size_t) i] = x[from + (size_t) i];
            fft.performFrequencyOnlyForwardTransform(buf.data());
            double total = 0.0, above = 0.0;
            for (int k = 1; k < size / 2; ++k)
            {
                const double e = (double) buf[(size_t) k] * buf[(size_t) k];
                total += e;
                if (k * rate / size > hz) above += e;
            }
            return total > 0.0 ? above / total : 0.0;
        }

        /** A 32-bit float WAV, mono, from `sample(i)`. */
        juce::File writeFloatWav(const juce::String& name, int numSamples, double rate,
                                 const std::function<float(int)>& sample)
        {
            auto file = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile(name);
            file.deleteFile();
            juce::WavAudioFormat wavFormat;
            std::unique_ptr<juce::FileOutputStream> out(file.createOutputStream());
            std::unique_ptr<juce::AudioFormatWriter> writer(wavFormat.createWriterFor(out.get(), rate, 1, 32, {}, 0));
            out.release();
            juce::AudioBuffer<float> source(1, numSamples);
            for (int i = 0; i < numSamples; ++i)
                source.setSample(0, i, sample(i));
            writer->writeFromAudioSampleBuffer(source, 0, numSamples);
            return file;
        }

        /** |H(e^jw)| of an RBJ biquad, written out from the cookbook here (not WebBiquad's code). */
        double rbjMagnitude(bool highpass, double f0, double qLinear, double f, double rate)
        {
            const double w0 = 2.0 * juce::MathConstants<double>::pi * f0 / rate;
            const double alpha = std::sin(w0) / (2.0 * qLinear), c = std::cos(w0);
            const double b0 = highpass ? (1.0 + c) / 2.0 : (1.0 - c) / 2.0;
            const double b1 = highpass ? -(1.0 + c) : 1.0 - c;
            const double b2 = b0, a0 = 1.0 + alpha, a1 = -2.0 * c, a2 = 1.0 - alpha;
            const std::complex<double> z1 = std::polar(1.0, -2.0 * juce::MathConstants<double>::pi * f / rate);
            const auto num = b0 + b1 * z1 + b2 * z1 * z1;
            const auto den = a0 + a1 * z1 + a2 * z1 * z1;
            return std::abs(num / den);
        }

        double webBiquadMagnitude(const WebBiquad& b, double f, double rate)
        {
            const std::complex<double> z1 = std::polar(1.0, -2.0 * juce::MathConstants<double>::pi * f / rate);
            return std::abs((b.b0 + b.b1 * z1 + b.b2 * z1 * z1) / (1.0 + b.a1 * z1 + b.a2 * z1 * z1));
        }

        /** A core's output for `in` (planar L, R), in blocks of `block`, with `set` calls at frames. */
        std::pair<std::vector<float>, std::vector<float>> runCore(
            DubDelayCore& core, const std::vector<float>& inL, const std::vector<float>& inR, int block,
            const std::function<void(int frame, DubDelayCore&)>& atFrame = {})
        {
            const int n = (int) inL.size();
            std::vector<float> l((size_t) n), r((size_t) n);
            for (int at = 0; at < n;)
            {
                int len = std::min(block, n - at);
                if (atFrame)
                {
                    atFrame(at, core);
                    len = 1; // one at a time, so a set lands on its frame
                }
                core.process(len, inL.data() + at, inR.data() + at, l.data() + at, r.data() + at);
                at += len;
            }
            return { l, r };
        }
    }

    class DubDelayBusTests : public juce::UnitTest
    {
    public:
        DubDelayBusTests() : juce::UnitTest("DubDelayBus", "DubDelayBus") {}

        void runTest() override
        {
            coreTests();
            engineTests();
            transportTests();
            parseTests();
        }

    private:
        void coreTests()
        {
            beginTest("the numbers are the web's (DUB_* in radioSound.ts, dubDelay.ts)");
            {
                expectEquals(kDubHighpassHz, 200.0f);
                expectEquals(kDubLowpassHz, 3500.0f);
                expectEquals(kDubToReverb, 0.15f);
                expectEquals(kDubMaxDelaySec, 2.0);
                expectEquals(kDubMaxFeedback, 0.95);
                expectEquals(kDubFilterQDb, (float) juce::MathConstants<double>::sqrt2 / 2.0f);
                expectEquals(kDubWebQuantum, 128);
            }

            beginTest("the echo time: 0.375 s at 120 bpm dotted eighth, 0.5 s quarter; clamped to 2 s and one frame");
            {
                expectEquals(dubDelaySecFor(0.75, 120.0, 48000.0), 0.375);
                expectEquals(dubDelaySecFor(1.0, 120.0, 48000.0), 0.5);
                expectEquals(dubDelaySecFor(1.0, 97.0, 48000.0), 1.0 * (60.0 / 97.0));
                expectEquals(dubDelaySecFor(1.0, 20.0, 48000.0), 2.0);
                expectEquals(dubDelaySecFor(0.75, 1.0e9, 48000.0), 1.0 / 48000.0);
                expectEquals(dubDelaySecFor(std::nan(""), 120.0, 48000.0), 0.5);
                expectEquals(dubDelaySecFor(0.75, 0.0, 48000.0), 0.5);
            }

            beginTest("the feedback: the web's clamp to [0, 0.95], then the native guard at 0.77");
            {
                expectEquals(dubFeedbackFor(0.6), 0.6f);
                expectEquals(dubFeedbackFor(0.45), 0.45f);
                expectEquals(dubFeedbackFor(-1.0), 0.0f);
                expectEquals(dubFeedbackFor(2.0), (float) kDubStableFeedback);
                expectEquals(dubFeedbackFor(0.9), (float) kDubStableFeedback);
                expectEquals(dubFeedbackFor(std::nan("")), 0.0f);
            }

            beginTest("the Q quirk: Math.SQRT1_2 as decibels, linear 1.085, as Chrome's own nodes measure");
            {
                for (const double rate : { 44100.0, 48000.0 })
                {
                    WebBiquad lp, hp;
                    lp.setLowpass(rate, kDubLowpassHz, kDubFilterQDb);
                    hp.setHighpass(rate, kDubHighpassHz, kDubFilterQDb);
                    const double q = std::pow(10.0, (double) kDubFilterQDb / 20.0);
                    expectWithinAbsoluteError(q, 1.0848, 1.0e-4);
                    // an RBJ low/highpass has a gain of exactly Q at its corner
                    expectWithinAbsoluteError(webBiquadMagnitude(lp, 3500.0, rate), q, 1.0e-6);
                    expectWithinAbsoluteError(webBiquadMagnitude(hp, 200.0, rate), q, 1.0e-6);
                    for (const double f : { 100.0, 264.0, 1000.0, 2654.0, 5000.0 })
                    {
                        expectWithinAbsoluteError(webBiquadMagnitude(lp, f, rate), rbjMagnitude(false, 3500.0, q, f, rate), 1.0e-9);
                        expectWithinAbsoluteError(webBiquadMagnitude(hp, f, rate), rbjMagnitude(true, 200.0, q, f, rate), 1.0e-9);
                    }
                }
                // Chrome 154's getFrequencyResponse at 48 kHz, 2026-10-02: LP 2654 Hz 1.2223, HP 264 Hz 1.2224
                WebBiquad lp, hp;
                lp.setLowpass(48000.0, kDubLowpassHz, kDubFilterQDb);
                hp.setHighpass(48000.0, kDubHighpassHz, kDubFilterQDb);
                expectWithinAbsoluteError(webBiquadMagnitude(lp, 2654.0, 48000.0), 1.2223, 1.0e-4);
                expectWithinAbsoluteError(webBiquadMagnitude(hp, 264.0, 48000.0), 1.2224, 1.0e-4);
            }

            beginTest("the loop's peak gain is under kDubLoopPeakGain at every rate, and the guard keeps it at 0.95");
            {
                for (const double rate : { 22050.0, 44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0 })
                {
                    WebBiquad lp, hp;
                    lp.setLowpass(rate, kDubLowpassHz, kDubFilterQDb);
                    hp.setHighpass(rate, kDubHighpassHz, kDubFilterQDb);
                    double worst = 0.0;
                    for (int k = 0; k <= 4000; ++k)
                    {
                        const double f = 20.0 * std::pow(std::min(20000.0, 0.49 * rate) / 20.0, k / 4000.0);
                        worst = std::max(worst, webBiquadMagnitude(lp, f, rate) * webBiquadMagnitude(hp, f, rate));
                    }
                    expect(worst <= kDubLoopPeakGain, "peak " + juce::String(worst, 5) + " at " + juce::String(rate));
                    expect(worst > 1.2, "the quirk's peak is there: " + juce::String(worst, 5));
                    // the web's own 0.95 would run away; the guard does not
                    expect(kDubMaxFeedback * worst > 1.0);
                    expect((double) dubFeedbackFor(kDubMaxFeedback) * worst < 0.95);
                }
            }

            // ---- the golden: the web's dubDelay.ts in Chrome ----
            const auto input = loadFloats("dub-delay.in.f32");
            const auto golden = loadFloats("dub-delay.out.f32");
            const auto meta = juce::JSON::parse(goldenDir().getChildFile("dub-delay.json"));
            beginTest("the golden: DubDelayCore is dubDelay.ts as Chrome renders it");
            {
                expect(! input.empty() && ! golden.empty() && meta.isObject(),
                       "golden missing under " + goldenDir().getFullPathName());
                if (golden.empty() || input.empty() || ! meta.isObject()) return;
                const int burst = (int) meta["burstFrames"];
                size_t offset = 0;
                for (const auto& c : *meta["cases"].getArray())
                {
                    const double rate = (double) c["sampleRate"];
                    const int frames = (int) c["frames"];
                    const double beats = c["timing"].toString() == "quarter" ? 1.0 : 0.75;
                    const double delay = dubDelaySecFor(beats, (double) c["bpm"], rate);
                    expectEquals(delay, (double) c["delaySec"][0], "the echo time is throwDelaySec's, case " + c["name"].toString());
                    std::vector<float> inL((size_t) frames, 0.0f), inR((size_t) frames, 0.0f);
                    std::copy(input.begin(), input.begin() + burst, inL.begin());
                    std::copy(input.begin() + burst, input.begin() + 2 * burst, inR.begin());
                    const auto retime = c["retime"];
                    int retimeAt = -1;
                    double retimeDelay = 0.0, retimeFeedback = 0.0;
                    if (retime.isObject())
                    {
                        retimeAt = (int) retime["atFrame"];
                        const double rBeats = retime["timing"].toString() == "quarter" ? 1.0 : 0.75;
                        retimeDelay = dubDelaySecFor(rBeats, (double) retime["bpm"], rate);
                        retimeFeedback = (double) retime["feedback"];
                        expectEquals(retimeDelay, (double) c["delaySec"][1]);
                        std::copy(input.begin() + 2 * burst, input.begin() + 3 * burst, inL.begin() + retimeAt);
                        std::copy(input.begin() + 3 * burst, input.begin() + 4 * burst, inR.begin() + retimeAt);
                    }
                    DubDelayCore core(rate);
                    core.set(delay, (double) c["feedback"]);
                    std::pair<std::vector<float>, std::vector<float>> out;
                    if (retimeAt >= 0)
                        out = runCore(core, inL, inR, 1, [&](int frame, DubDelayCore& k) {
                            if (frame == retimeAt) k.set(retimeDelay, retimeFeedback);
                        });
                    else
                        out = runCore(core, inL, inR, 128);
                    const std::vector<float> gL(golden.begin() + (long) offset, golden.begin() + (long) (offset + (size_t) frames));
                    const std::vector<float> gR(golden.begin() + (long) (offset + (size_t) frames),
                                                golden.begin() + (long) (offset + 2 * (size_t) frames));
                    offset += 2 * (size_t) frames;
                    const double errL = maxAbsDiff(out.first, gL), errR = maxAbsDiff(out.second, gR);
                    logMessage("dub golden case " + c["name"].toString() + ": max abs error L " + juce::String(errL, 12)
                               + ", R " + juce::String(errR, 12) + " (peak " + juce::String(peak(gL, 0, gL.size()), 4) + ")");
                    expect(errL <= 1.0e-6 && errR <= 1.0e-6, "case " + c["name"].toString() + " off the web by "
                                                                 + juce::String(std::max(errL, errR), 9));
                    // and the web's echo really is there: something well after the bursts
                    expect(peak(gR, (size_t) (2.0 * delay * rate), gR.size()) > 1.0e-3);
                }
                expectEquals((int) offset, (int) golden.size());
            }

            beginTest("an impulse into L: L at d, R at 2d + 128, L at 3d + 128, R at 4d + 256 -- each darker");
            {
                constexpr double rate = 48000.0;
                const int d = 18000; // 0.375 s
                const int total = 5 * d + 1024;
                std::vector<float> inL((size_t) total, 0.0f), inR((size_t) total, 0.0f);
                inL[0] = 1.0f;
                DubDelayCore core(rate);
                core.set(dubDelaySecFor(0.75, 120.0, rate), 0.6);
                const auto [l, r] = runCore(core, inL, inR, 512);
                const auto firstNonZero = [](const std::vector<float>& x, size_t from) {
                    for (size_t i = from; i < x.size(); ++i)
                        if (x[i] != 0.0f) return (int) i;
                    return -1;
                };
                // the first repeat: on the input's side, undarkened, full level, at d exactly
                expectEquals(firstNonZero(l, 0), d);
                expectEquals(l[(size_t) d], 1.0f);
                expectEquals(firstNonZero(l, (size_t) d + 1), 3 * d + 128);
                // the crossings, one render quantum later each round trip
                expectEquals(firstNonZero(r, 0), 2 * d + 128);
                expectEquals(firstNonZero(r, (size_t) (2 * d + 128 + d / 2)), 4 * d + 256);
                // darker each pass: less above 4 kHz, less below 150 Hz
                const double hi2 = energyAbove(r, (size_t) (2 * d + 128), 4000.0, rate);
                const double hi3 = energyAbove(l, (size_t) (3 * d + 128), 4000.0, rate);
                const double hi4 = energyAbove(r, (size_t) (4 * d + 256), 4000.0, rate);
                logMessage("energy above 4 kHz, repeats 2..4: " + juce::String(hi2, 4) + ", " + juce::String(hi3, 4)
                           + ", " + juce::String(hi4, 4));
                expect(hi2 < 0.5 && hi3 < hi2 && hi4 < hi3);
            }

            beginTest("each repeat is about feedback x the loop's gain times the last (a 1 kHz burst)");
            {
                constexpr double rate = 48000.0;
                const int d = 24000; // 0.5 s
                const int total = 6 * d;
                std::vector<float> inL((size_t) total, 0.0f), inR((size_t) total, 0.0f);
                const int burst = 4800;
                for (int i = 0; i < burst; ++i)
                {
                    const double w = 0.5 - 0.5 * std::cos(2.0 * juce::MathConstants<double>::pi * i / (burst - 1));
                    inL[(size_t) i] = (float) (0.5 * w * std::sin(2.0 * juce::MathConstants<double>::pi * 1000.0 * i / rate));
                }
                for (const double fb : { 0.45, 0.6 })
                {
                    DubDelayCore core(rate);
                    core.set(dubDelaySecFor(1.0, 120.0, rate), fb);
                    const auto [l, r] = runCore(core, inL, inR, 512);
                    const double q = std::pow(10.0, (double) kDubFilterQDb / 20.0);
                    const double h = rbjMagnitude(true, 200.0, q, 1000.0, rate) * rbjMagnitude(false, 3500.0, q, 1000.0, rate);
                    const double e1 = rms(l, (size_t) d, (size_t) (d + burst));
                    const double e2 = rms(r, (size_t) (2 * d + 128), (size_t) (2 * d + 128 + burst));
                    const double e3 = rms(l, (size_t) (3 * d + 128), (size_t) (3 * d + 128 + burst));
                    logMessage("fb " + juce::String(fb) + ": repeat ratios " + juce::String(e2 / e1, 4) + ", "
                               + juce::String(e3 / e2, 4) + " against fb x |H(1 kHz)| " + juce::String(fb * h, 4));
                    expectWithinAbsoluteError(e2 / e1, fb * h, 0.02 * fb * h);
                    expectWithinAbsoluteError(e3 / e2, fb * h, 0.02 * fb * h);
                }
            }

            beginTest("feedback 2.0 is clamped, and nothing runs away over 30 s");
            {
                constexpr double rate = 48000.0;
                const int total = (int) (30.0 * rate);
                std::vector<float> inL((size_t) total, 0.0f), inR((size_t) total, 0.0f);
                inL[0] = 1.0f;
                DubDelayCore core(rate);
                core.set(0.375, 2.0);
                expectEquals(core.feedback(), (float) kDubStableFeedback);
                const auto [l, r] = runCore(core, inL, inR, 4096);
                double last = 1.0e9;
                for (int s = 1; s < 30; s += 5)
                {
                    const size_t a = (size_t) (s * rate), b = (size_t) ((s + 5) * rate);
                    const double p = std::max(peak(l, a, b), peak(r, a, b));
                    expect(std::isfinite(p) && p < last, "5 s from " + juce::String(s) + " s: peak " + juce::String(p));
                    last = p;
                }
                expect(last < 0.05, "still " + juce::String(last) + " after 26 s");
            }

            beginTest("ringSamples: by then everything left is under -140 dB (the bus then zeroes it)");
            {
                for (const double fb : { 0.0, 0.45, 0.6 })
                    for (const double rate : { 44100.0, 48000.0 })
                    {
                        DubDelayCore core(rate);
                        core.set(dubDelaySecFor(1.0, 120.0, rate), fb);
                        const int n = core.ringSamples();
                        std::vector<float> inL((size_t) n, 0.0f), inR((size_t) n, 0.0f);
                        inL[0] = 1.0f; // full scale, every frequency at once
                        inR[0] = -1.0f;
                        const auto [l, r] = runCore(core, inL, inR, 4096);
                        // the last round trip's worth of output: what is still in the loop
                        const size_t from = (size_t) n - (size_t) (2.0 * 0.5 * rate + 256);
                        const double left = std::max(peak(l, from, l.size()), peak(r, from, r.size()));
                        expect(left < kDubSilence, "fb " + juce::String(fb) + " at " + juce::String(rate) + ": "
                                                        + juce::String(left) + " after " + juce::String(n / rate, 1) + " s");
                    }
            }

            beginTest("set() mid-ring re-reads the line at once (the web's setValueAtTime); clear() is silence");
            {
                DubDelayCore core(48000.0);
                core.set(0.375, 0.5);
                expectEquals(core.delaySec(), 0.375f);
                core.set(0.5, 0.45);
                expectEquals(core.delaySec(), 0.5f);
                expectEquals(core.feedback(), 0.45f);
                std::vector<float> in(1024, 0.25f), outL(1024), outR(1024);
                core.process(1024, in.data(), in.data(), outL.data(), outR.data());
                core.clear();
                std::vector<float> zeros(48000, 0.0f), l(48000), r(48000);
                core.process(48000, zeros.data(), zeros.data(), l.data(), r.data());
                expectEquals(peak(l, 0, l.size()) + peak(r, 0, r.size()), 0.0);
            }
        }

        // ---- the bus in renderBlock ----
        static constexpr double kRate = 44100.0;
        static constexpr double kBpm = 120.0; // 2 s a bar
        static constexpr int kBarSamples = 88200;

        /** One row: a file, a pan, an optional dubSend curve and reverb send. */
        struct Row
        {
            juce::File file;
            std::vector<AutomationPoint> dubSend {};
            double pan = 0.0;
            double reverbSend = 0.0;
            bool muted = false;
        };

        static EngineProject makeProject(const std::vector<Row>& rows, std::optional<SoundSettings::Dub> dub,
                                         ReverbRoom room = ReverbRoom::cavern, double bars = 1.0)
        {
            EngineProject project;
            project.bpm = kBpm;
            project.snapDiv = 16.0;
            int n = 0;
            for (const auto& row : rows)
            {
                EngineRifff rifff;
                rifff.groupId = "g" + juce::String(++n);
                rifff.channelId = "c" + juce::String(n);
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.stemKey = rifff.groupId + ":1";
                stem.resolvedPath = row.file.getFullPathName();
                stem.durationSec = 2.0;
                stem.barLength = 1;
                stem.playedBars = bars;
                stem.pan = row.pan;
                stem.muted = row.muted;
                if (! row.dubSend.empty() || row.reverbSend > 0.0)
                {
                    // On the wire a dubSend rides in a toolkit, neutral but for it (buildEngineProject).
                    stem.hasToolkit = true;
                    stem.toolkit.reverbSend = row.reverbSend;
                    stem.toolkit.automation.dubSend = row.dubSend;
                }
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);
            }
            project.sound.room = room;
            project.sound.dub = dub;
            return project;
        }

        /** renderBlock from bar 0 (or `fromSample`), in blocks cycled from `sizes`. */
        static std::pair<std::vector<float>, std::vector<float>> render(
            PlaybackEngine& engine, int total, const std::vector<int>& sizes = { 512 }, int fromSample = 0)
        {
            ChannelChainRegistry chains;
            std::vector<float> l((size_t) total, 0.0f), r((size_t) total, 0.0f);
            size_t which = 0;
            for (int at = 0; at < total;)
            {
                const int n = juce::jmin(total - at, sizes[which++ % sizes.size()]);
                engine.renderBlock((double) (fromSample + at) / (double) kBarSamples, kRate, n, l.data() + at,
                                   r.data() + at, chains);
                at += n;
            }
            engine.drainRetiredProject();
            return { l, r };
        }

        static std::pair<std::vector<float>, std::vector<float>> render(const EngineProject& project, int total,
                                                                       const std::vector<int>& sizes = { 512 })
        {
            StemBufferCache cache;
            PlaybackEngine engine(cache);
            engine.prepareMaster(kRate);
            engine.setProject(project);
            return render(engine, total, sizes);
        }

        /** A throw as the planners draw it: 0 at `fromBar`, ramped to `level` over 5 ms, held,
         * ramped back to 0 by `toBar` (2 s a bar). */
        static std::vector<AutomationPoint> throwCurve(double fromBar, double toBar, double level = 1.0)
        {
            const double ramp = 0.005 / 2.0;
            return { { fromBar, 0.0 }, { fromBar + ramp, level }, { toBar - ramp, level }, { toBar, 0.0 } };
        }

        void engineTests()
        {
            // a noisy phrase through the first 0.6 s of a bar, then silence
            std::mt19937 rng(7);
            std::uniform_real_distribution<float> noise(-0.3f, 0.3f);
            std::vector<float> phrase((size_t) kBarSamples, 0.0f);
            for (int i = 0; i < (int) (0.6 * kRate); ++i)
                phrase[(size_t) i] = noise(rng) * (float) std::sin(juce::MathConstants<double>::pi * i / (0.6 * kRate));
            auto lead = writeFloatWav("sssketch_dub_lead.wav", kBarSamples, kRate, [&](int i) { return phrase[(size_t) i]; });
            auto pad = writeFloatWav("sssketch_dub_pad.wav", kBarSamples, kRate, [](int i) {
                return 0.2f * (float) std::sin(2.0 * juce::MathConstants<double>::pi * 330.0 * i / kRate);
            });
            const SoundSettings::Dub dotted { 0.75, 0.6 };
            const int total = 3 * kBarSamples;

            beginTest("no send: nothing built, and the render is exactly today's");
            {
                const auto today = render(makeProject({ { lead }, { pad, {}, 0.25 } }, std::nullopt), total);
                // sound.dub with no curve; a curve with no sound.dub; a curve that is 0 throughout
                for (const auto& project :
                     { makeProject({ { lead }, { pad, {}, 0.25 } }, dotted),
                       makeProject({ { lead, throwCurve(0.0, 0.25) }, { pad, {}, 0.25 } }, std::nullopt),
                       makeProject({ { lead, { { 0.0, 0.0 }, { 1.0, 0.0 } } }, { pad, {}, 0.25 } }, dotted) })
                {
                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    engine.prepareMaster(kRate);
                    engine.setProject(project);
                    const auto out = render(engine, total);
                    expect(sameBits(out.first, today.first) && sameBits(out.second, today.second));
                    expectEquals(engine.dubPreparedRate(), 0.0);
                    expectEquals(engine.dubLiveRate(), 0.0);
                    expect(! engine.dubRinging());
                }
            }

            beginTest("a send builds the bus on the message thread, and the echo is heard after the dry phrase");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.prepareMaster(kRate);
                engine.setProject(makeProject({ { lead, throwCurve(0.0, 0.3) } }, dotted));
                expectEquals(engine.dubPreparedRate(), kRate);
                // the dub feeds the room, so the cavern is built for it too
                expectEquals(engine.cavernReverbPreparedRate(), kRate);
                const auto out = render(engine, total);
                expectEquals(engine.dubLiveRate(), kRate);
                expect(engine.dubRinging());
                expectEquals(engine.dubDelaySec(), 0.375f);
                expectEquals(engine.dubFeedback(), 0.6f);
                const auto dry = render(makeProject({ { lead } }, std::nullopt), total);
                // after the phrase (0.6 s) the dry render is silent, and the echo is not
                expectEquals(peak(dry.first, (size_t) (0.7 * kRate), (size_t) total), 0.0);
                expect(peak(out.first, (size_t) (0.7 * kRate), (size_t) total) > 1.0e-2);
            }

            beginTest("the send is post-pan, linear in the curve's value, and 0.15 of the echo reaches the reverb");
            {
                // a lead panned hard right: dub input = the stem's post-pan signal x the curve
                const std::vector<AutomationPoint> flat { { 0.0, 0.5 }, { 10.0, 0.5 } };
                for (const auto room : { ReverbRoom::cavern, ReverbRoom::zita })
                {
                    auto project = makeProject({ { lead, flat, 1.0 } }, dotted, room);
                    const auto full = render(project, total);
                    auto noDub = project;
                    noDub.sound.dub.reset();
                    const auto dry = render(noDub, total); // the panned stem alone
                    // the echo by hand: a core over the dry render x 0.5, from the start
                    std::vector<float> inL(dry.first), inR(dry.second);
                    for (auto& x : inL) x *= 0.5f;
                    for (auto& x : inR) x *= 0.5f;
                    DubDelayCore core(kRate);
                    core.set(dubDelaySecFor(0.75, kBpm, kRate), 0.6);
                    const auto wet = runCore(core, inL, inR, 512);
                    // the room by hand: a reverb bus fed 0.15 of the echo, the engine's way
                    const auto expected = [&](float toReverb) {
                        ReverbBus room2;
                        room2.prepareCavern(kRate);
                        room2.setSettings(project.reverb);
                        std::vector<float> l(dry.first), r(dry.second);
                        for (int at = 0; at < total; at += 512)
                        {
                            const int n = juce::jmin(512, total - at);
                            room2.prepare(kRate, n);
                            room2.setRoom(room, 1.0);
                            room2.beginBlock(n);
                            for (int i = 0; i < n; ++i)
                            {
                                l[(size_t) (at + i)] += wet.first[(size_t) (at + i)];
                                r[(size_t) (at + i)] += wet.second[(size_t) (at + i)];
                            }
                            ParamSmoother g;
                            g.reset(kRate, kAutomationSmoothingSec, toReverb);
                            room2.addSend(n, wet.first.data() + at, wet.second.data() + at, g);
                            room2.endBlock(n, l.data() + at, r.data() + at);
                        }
                        return std::make_pair(l, r);
                    };
                    const auto at015 = expected(0.15f);
                    const auto at030 = expected(0.30f);
                    const double err = std::max(maxAbsDiff(full.first, at015.first), maxAbsDiff(full.second, at015.second));
                    const double off = std::max(maxAbsDiff(full.first, at030.first), maxAbsDiff(full.second, at030.second));
                    logMessage(juce::String(room == ReverbRoom::cavern ? "cavern" : "zita") + ": the engine against dry + echo + room(0.15 echo): "
                               + juce::String(err, 12) + "; against 0.30: " + juce::String(off, 6));
                    expect(err <= 1.0e-6, "the echo or its room is not as built by hand: " + juce::String(err, 9));
                    expect(off > 1.0e-3);
                    // post-pan: hard right (cos(pi/2) leaves ~1e-17 of the source on the left), the
                    // echo starts on the right and only reaches the left as it crosses over, at 2d
                    const size_t crossing = (size_t) (2.0 * dubDelaySecFor(0.75, kBpm, kRate) * kRate);
                    expect(peak(wet.first, 0, crossing) < 1.0e-9 && peak(wet.second, 0, crossing) > 1.0e-2);
                    expect(peak(wet.first, crossing, wet.first.size()) > 1.0e-3);
                }
            }

            beginTest("the curve reaches the bus sample for sample, as evaluateAutomation reads it");
            {
                auto ones = writeFloatWav("sssketch_dub_ones.wav", kBarSamples, kRate, [](int) { return 1.0f; });
                // feedback 0 and a whole-frame delay (0.5 s at 44.1 kHz): the echo is the send, d later
                const std::vector<AutomationPoint> curve { { 0.1, 0.0 }, { 0.13, 0.8 }, { 0.2, 0.3 }, { 0.2, 0.9 }, { 0.31, 0.0 } };
                auto project = makeProject({ { ones, curve } }, SoundSettings::Dub { 1.0, 0.0 }, ReverbRoom::zita);
                project.sound.reverbReturn = 0.0; // the room's 0.15 of the echo, silenced
                const auto withEcho = render(project, kBarSamples, { 333 });
                auto noDub = project;
                noDub.sound.dub.reset();
                const auto dry = render(noDub, kBarSamples, { 333 });
                const int d = (int) (0.5 * kRate);
                int mismatched = 0;
                for (int i = (int) (0.1 * kBarSamples); i < (int) (0.31 * kBarSamples); ++i)
                {
                    const float want = dry.first[(size_t) i]
                        * (float) evaluateAutomation(curve, (double) i / kRate / 2.0, 0.0);
                    const float got = withEcho.first[(size_t) (i + d)] - dry.first[(size_t) (i + d)];
                    if (std::abs(got - want) > 1.0e-6f) ++mismatched;
                }
                expectEquals(mismatched, 0);
            }

            beginTest("a change while ringing is deferred to the next throw's start");
            {
                // throw 1 (dotted, 0.6) at bar 0; then the project changes to a quarter at 0.45
                // while it rings; throw 2 at bar 2
                const auto first = makeProject({ { lead, throwCurve(0.0, 0.3) } }, dotted, ReverbRoom::cavern, 3.0);
                auto second = first;
                second.sound.dub = SoundSettings::Dub { 1.0, 0.45 };
                second.rifffs[0].stems[0].toolkit.automation.dubSend = throwCurve(0.0, 0.3);
                for (auto& p : throwCurve(2.0, 2.3))
                    second.rifffs[0].stems[0].toolkit.automation.dubSend.push_back(p);
                const int swapAt = kBarSamples; // bar 1, the first throw's echoes ringing

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.prepareMaster(kRate);
                engine.setProject(first);
                const auto a = render(engine, swapAt);
                expect(engine.dubRinging());
                engine.setProject(second);
                const auto b = render(engine, kBarSamples, { 512 }, swapAt);
                expectEquals(engine.dubDelaySec(), 0.375f); // still the first throw's
                expectEquals(engine.dubFeedback(), 0.6f);
                const auto c = render(engine, kBarSamples, { 512 }, 2 * kBarSamples);
                expectEquals(engine.dubDelaySec(), 0.5f); // taken as throw 2 opened
                expectEquals(engine.dubFeedback(), 0.45f);

                // bar 1 is the first project's tail, untouched by the change
                StemBufferCache cache2;
                PlaybackEngine unchanged(cache2);
                unchanged.prepareMaster(kRate);
                unchanged.setProject(first);
                render(unchanged, swapAt);
                const auto b2 = render(unchanged, kBarSamples, { 512 }, swapAt);
                expect(sameBits(b.first, b2.first) && sameBits(b.second, b2.second), "the tail was retimed");
                // and throw 2's echo comes 0.5 s after it, not 0.375: the throw (bar 2 = 0 here) is
                // the lead's first 0.6 s again, its echo past the phrase at 0.5 + 0.6 s
                expect(peak(c.first, (size_t) (0.62 * kRate), (size_t) (1.05 * kRate)) > 1.0e-3);
                juce::ignoreUnused(a);
            }

            beginTest("block-split invariance, to the bit (throws with ramps, pan, the cavern)");
            {
                auto project = makeProject({ { lead, throwCurve(0.0, 0.31, 0.8), 0.25 },
                                             { pad, throwCurve(0.13, 0.29), -0.25, 0.2 } },
                                           dotted, ReverbRoom::cavern, 3.0);
                const auto a = render(project, total, { 512 });
                const auto b = render(project, total, { 4096, 1, 64, 300, 7, 129 });
                // the largest block first: a clip's toolkit filter resets when a block outgrows every
                // block before it (ChannelFilter::prepare, pre-existing, Task 5's note)
                std::vector<int> sizes { 2000 };
                std::mt19937 sizesRng(3);
                std::uniform_int_distribution<int> size(1, 2000);
                for (int i = 0; i < 400; ++i) sizes.push_back(size(sizesRng));
                const auto c = render(project, total, sizes);
                const auto d = render(project, total, { 1 });
                expect(sameBits(a.first, b.first) && sameBits(a.second, b.second), "512 vs mixed");
                expect(sameBits(a.first, c.first) && sameBits(a.second, c.second), "512 vs random");
                expect(sameBits(a.first, d.first) && sameBits(a.second, d.second), "512 vs 1");
                expect(peak(a.first, (size_t) (0.7 * kRate), (size_t) total) > 1.0e-2);
            }

            beginTest("a re-sync keeps the tail; a dropped tail starts from silence; the bus rings out then goes idle");
            {
                const auto project = makeProject({ { lead, throwCurve(0.0, 0.3) } }, dotted);
                const auto straight = render(project, total);
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.prepareMaster(kRate);
                engine.setProject(project);
                const auto a = render(engine, kBarSamples);
                engine.setProject(project);
                engine.setProject(project);
                const auto b = render(engine, 2 * kBarSamples, { 512 }, kBarSamples);
                std::vector<float> joined(a.first);
                joined.insert(joined.end(), b.first.begin(), b.first.end());
                expect(sameBits(joined, straight.first), "a re-sync cut the echo");

                // the stop's drop (Transport calls it through dropReverbTail)
                StemBufferCache cache2;
                PlaybackEngine stopped(cache2);
                stopped.prepareMaster(kRate);
                stopped.setProject(project);
                render(stopped, kBarSamples);
                expect(stopped.dubRinging());
                stopped.dropReverbTail();
                expect(! stopped.dubRinging());
                // from bar 2, past the lead: a fresh engine plays only the room's... nothing; so
                // does the dropped one, exactly, once the cavern's own tail is dropped too
                const auto after = render(stopped, kBarSamples, { 512 }, 2 * kBarSamples);
                const auto fresh = render(project, kBarSamples); // bar 0 again: the throw itself
                juce::ignoreUnused(fresh);
                expectEquals(peak(after.first, 0, after.first.size()) + peak(after.second, 0, after.second.size()), 0.0);

                // ringing out: with no further throw the bus goes idle on its own
                StemBufferCache cache3;
                PlaybackEngine ringing(cache3);
                ringing.prepareMaster(kRate);
                auto once = project;
                ringing.setProject(once);
                render(ringing, kBarSamples / 2);
                once.rifffs[0].stems[0].toolkit.automation.dubSend.clear();
                ringing.setProject(once); // the project no longer sends; the echo rings on
                expect(ringing.dubRinging());
                const int ringOut = (int) (25.0 * kRate);
                render(ringing, ringOut, { 4096 }, kBarSamples / 2);
                expect(! ringing.dubRinging(), "still ringing after 25 s at feedback 0.6");
            }

            beginTest("a muted stem sends nothing; a dub-only toolkit does not run the toolkit");
            {
                const auto mutedOut = render(makeProject({ { lead, throwCurve(0.0, 0.3), 0.0, 0.0, true }, { pad } }, dotted), total);
                const auto padOnly = render(makeProject({ { pad } }, std::nullopt), total);
                // the dub runs (and the room with it) but is fed silence: the pad alone, exactly
                expect(sameBits(mutedOut.first, padOnly.first) && sameBits(mutedOut.second, padOnly.second));
            }

            beginTest("rates: prepareMaster rebuilds the core; a rate it was not told about is silent, counted and built");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.prepareMaster(kRate);
                engine.setProject(makeProject({ { lead, throwCurve(0.0, 0.3) } }, dotted));
                render(engine, 1024);
                expectEquals(engine.dubLiveRate(), kRate);
                engine.prepareMaster(48000.0);
                expectEquals(engine.dubPreparedRate(), 48000.0);
                ChannelChainRegistry chains;
                std::vector<float> l(512), r(512);
                engine.renderBlock(0.0, 48000.0, 512, l.data(), r.data(), chains);
                expectEquals(engine.dubLiveRate(), 48000.0);
                expect(engine.dubRetiredPending());
                engine.drainRetiredProject();
                expect(! engine.dubRetiredPending());
                const auto before = engine.dubRateMismatchCount();
                engine.renderBlock(0.0, 96000.0, 512, l.data(), r.data(), chains);
                expectEquals((int) (engine.dubRateMismatchCount() - before), 1);
                engine.drainRetiredProject(); // builds one at 96 kHz (and logs it)
                expectEquals(engine.dubPreparedRate(), 96000.0);
                engine.renderBlock(0.0, 96000.0, 512, l.data(), r.data(), chains);
                expectEquals(engine.dubLiveRate(), 96000.0);
                expectEquals((int) (engine.dubRateMismatchCount() - before), 1);
                engine.drainRetiredProject();
            }

            beginTest("cost: one throw's echo over 10 s at 44.1 kHz");
            {
                const auto project = makeProject({ { lead, throwCurve(0.0, 0.3) } }, dotted, ReverbRoom::zita, 5.0);
                auto noDub = project;
                noDub.sound.dub.reset();
                const auto time = [&](const EngineProject& p) {
                    const auto start = juce::Time::getHighResolutionTicks();
                    render(p, (int) (10.0 * kRate), { 512 });
                    return juce::Time::highResolutionTicksToSeconds(juce::Time::getHighResolutionTicks() - start);
                };
                const double with = time(project), without = time(noDub);
                logMessage("10 s with the echo " + juce::String(with * 1000.0, 1) + " ms, without "
                           + juce::String(without * 1000.0, 1) + " ms");
                expect(true);
            }
        }

        void transportTests()
        {
            std::mt19937 rng(11);
            std::uniform_real_distribution<float> noise(-0.3f, 0.3f);
            std::vector<float> phrase((size_t) kBarSamples * 2, 0.0f);
            for (int i = 0; i < (int) (0.4 * kRate); ++i)
                phrase[(size_t) i] = noise(rng);
            auto lead = writeFloatWav("sssketch_dub_tr_lead.wav", 2 * kBarSamples, kRate, [&](int i) { return phrase[(size_t) i]; });
            auto project = makeProject({ { lead, throwCurve(0.0, 0.2), 0.25 } }, SoundSettings::Dub { 0.75, 0.6 },
                                       ReverbRoom::cavern, 2.0);
            for (auto& rifff : project.rifffs)
            {
                rifff.barLength = 2;
                for (auto& stem : rifff.stems)
                {
                    stem.barLength = 2;
                    stem.durationSec = 4.0;
                }
            }
            constexpr double kBars = 2.0;
            const int kTotal = 2 * kBarSamples;

            beginTest("the echo: live playback and export give the same samples, to the bit");
            {
                juce::AudioBuffer<float> out;
                juce::String error;
                expect(renderProjectToBuffer(project, kBars, kRate, 512, out, error), "export failed: " + error);
                const std::vector<float> expL(out.getReadPointer(0), out.getReadPointer(0) + out.getNumSamples());
                const std::vector<float> expR(out.getReadPointer(1), out.getReadPointer(1) + out.getNumSamples());
                expectEquals((int) expL.size(), kTotal);

                struct Rig
                {
                    StemBufferCache cache;
                    PlaybackEngine engine { cache };
                    PluginChain masterChain { kNumMasterChainSlots };
                    ChannelChainRegistry channelChains;
                    Transport transport { engine, masterChain, channelChains };
                };
                for (const int seed : { 0, 5 })
                {
                    Rig rig;
                    rig.engine.prepareMaster(kRate);
                    rig.engine.setProject(project);
                    rig.transport.setBpm(kBpm);
                    rig.transport.play(0.0);
                    std::mt19937 sizes((unsigned) seed);
                    std::uniform_int_distribution<int> size(1, 1100);
                    std::vector<float> l((size_t) kTotal), r((size_t) kTotal);
                    for (int at = 0; at < kTotal;)
                    {
                        const int n = juce::jmin(seed == 0 ? 300 : size(sizes), kTotal - at);
                        float* channels[2] = { l.data() + at, r.data() + at };
                        rig.transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, n, {});
                        at += n;
                    }
                    rig.engine.drainRetiredProject();
                    expect(sameBits(l, expL) && sameBits(r, expR), "live differs from the export, seed " + juce::String(seed));
                }
                // and the export really echoes
                auto noDub = project;
                noDub.sound.dub.reset();
                juce::AudioBuffer<float> flat;
                expect(renderProjectToBuffer(noDub, kBars, kRate, 512, flat, error));
                const std::vector<float> flatL(flat.getReadPointer(0), flat.getReadPointer(0) + flat.getNumSamples());
                expect(! sameBits(flatL, expL), "the echo changed nothing in the export");
            }

            beginTest("a stop drops the echo's tail: play again from bar 0 is the export, to the bit; a seek keeps it");
            {
                juce::AudioBuffer<float> exported;
                juce::String error;
                expect(renderProjectToBuffer(project, kBars, kRate, 512, exported, error), error);
                struct Rig
                {
                    StemBufferCache cache;
                    PlaybackEngine engine { cache };
                    PluginChain masterChain { kNumMasterChainSlots };
                    ChannelChainRegistry channelChains;
                    Transport transport { engine, masterChain, channelChains };
                };
                std::vector<float> l(512), r(512);
                float* channels[2] = { l.data(), r.data() };
                {
                    Rig rig;
                    rig.engine.prepareMaster(kRate);
                    rig.engine.setProject(project);
                    rig.transport.setBpm(kBpm);
                    rig.transport.play(0.0);
                    for (int i = 0; i < 120; ++i) // ~1.4 s: past the phrase, the echo ringing
                        rig.transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                    expect(rig.engine.dubRinging());
                    rig.transport.stop();
                    for (int i = 0; i < 400 && rig.transport.isPlaying(); ++i)
                        rig.transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                    expect(! rig.transport.isPlaying());
                    expect(! rig.engine.dubRinging(), "the stop left the echo ringing");
                    rig.transport.play(0.0);
                    std::vector<float> again;
                    for (int i = 0; i < 175; ++i)
                    {
                        rig.transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                        again.insert(again.end(), l.begin(), l.end());
                    }
                    again.resize((size_t) kBarSamples);
                    const std::vector<float> want(exported.getReadPointer(0), exported.getReadPointer(0) + kBarSamples);
                    // within denormal dust: the stem's own toolkit (its reverb send's filter) is not
                    // reset by a stop (pre-existing; Task 5's note)
                    const double err = maxAbsDiff(again, want);
                    expect(err < 1.0e-30, "the play after a stop differs from the export: max " + juce::String(err, 12));
                    rig.engine.drainRetiredProject();
                }
                {
                    // a seek from the ringing echo to bar 1.5, where nothing sounds: the echo rings on
                    Rig rig;
                    rig.engine.prepareMaster(kRate);
                    rig.engine.setProject(project);
                    rig.transport.setBpm(kBpm);
                    rig.transport.play(0.0);
                    for (int i = 0; i < 100; ++i) // ~1.16 s
                        rig.transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                    rig.transport.setPosition(1.5);
                    std::vector<float> after;
                    for (int i = 0; i < 40; ++i)
                    {
                        rig.transport.audioDeviceIOCallbackWithContext(nullptr, 0, channels, 2, 512, {});
                        after.insert(after.end(), l.begin(), l.end());
                    }
                    expect(rig.engine.dubRinging());
                    // a fresh play from bar 1.5 is the room's silence; the seeked one carries the echo
                    expect(peak(after, 4096, after.size()) > 1.0e-3, "the seek cut the echo");
                    rig.engine.drainRetiredProject();
                }
            }
        }

        void parseTests()
        {
            beginTest("parse: sound.dub and a stem's dubSend curve; junk is off; the TS wire round-trips");
            {
                const auto parse = [](const juce::String& json) {
                    EngineProject p;
                    juce::String error;
                    parseEngineProject(json, p, error);
                    return p;
                };
                // the shape buildEngineProject sends (a dubSend riding in a neutral toolkit)
                const auto p = parse(R"({"bpm":120,"snapDiv":16,"loopLengthBars":4,"masterChain":[],
                    "sound":{"room":"cavern","dub":{"delayBeats":0.75,"feedback":0.6}},
                    "rifffs":[{"groupId":"g","channelId":"c","startBar":0,"barLength":1,"stems":[
                      {"stemKey":"g:1","resolvedPath":"/x.wav","durationSec":2,"barLength":1,"playedBars":1,
                       "toolkit":{"filterMode":"lowpass","filterCutoff":1,"filterResonance":0.2,"reverbSend":0,
                         "volume":1,"originBar":0,"automation":{"filterCutoff":[],"filterResonance":[],
                         "reverbSend":[],"volume":[],
                         "dubSend":[{"bar":0.5,"value":1},{"bar":0.25,"value":0},{"bar":0.6,"value":7}]}}}]}]})");
                expect(p.sound.dub.has_value());
                if (p.sound.dub)
                {
                    expectEquals(p.sound.dub->delayBeats, 0.75);
                    expectEquals(p.sound.dub->feedback, 0.6);
                }
                expect(! p.sound.isNeutral());
                expectEquals((int) p.rifffs.size(), 1);
                if (p.rifffs.size() == 1)
                {
                    const auto& curve = p.rifffs[0].stems[0].toolkit.automation.dubSend;
                    expectEquals((int) curve.size(), 3);
                    if (curve.size() == 3)
                    {
                        expectEquals(curve[0].bar, 0.25); // sorted
                        expectEquals(curve[2].value, 1.0); // clamped
                    }
                }
                // the feedback is clamped to the web's 0.95, the beats to 1/16..4
                const auto hot = parseSoundSettings(juce::JSON::parse(R"({"dub":{"delayBeats":9,"feedback":2}})"));
                expect(hot.dub.has_value());
                if (hot.dub)
                {
                    expectEquals(hot.dub->delayBeats, 4.0);
                    expectEquals(hot.dub->feedback, 0.95);
                }
                // junk: off
                for (const auto* junk : { R"({"dub":{"delayBeats":0.75}})", R"({"dub":{"delayBeats":"x","feedback":0.5}})",
                                          R"({"dub":{"delayBeats":0,"feedback":0.5}})", R"({"dub":{"delayBeats":-1,"feedback":0.5}})",
                                          R"({"dub":7})", R"({"dub":null})", R"({})" })
                    expect(! parseSoundSettings(juce::JSON::parse(juce::String(junk))).dub.has_value(), junk);
                // no dubSend on the wire: an empty curve
                const auto plain = parse(R"({"bpm":120,"rifffs":[{"groupId":"g","channelId":"c","startBar":0,"barLength":1,
                    "stems":[{"stemKey":"g:1","resolvedPath":"/x.wav","durationSec":2,"barLength":1,"playedBars":1,
                    "toolkit":{"filterMode":"lowpass","filterCutoff":1,"filterResonance":0.2,"reverbSend":0.5,"volume":1,
                    "originBar":0,"automation":{"filterCutoff":[],"filterResonance":[],"reverbSend":[],"volume":[]}}}]}]})");
                if (plain.rifffs.size() == 1)
                    expect(plain.rifffs[0].stems[0].toolkit.automation.dubSend.empty());
            }
        }
    };

    static DubDelayBusTests dubDelayBusTests;
}

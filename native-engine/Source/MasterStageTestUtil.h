// native-engine/Source/MasterStageTestUtil.h -- signals and helpers shared by the master stage's
// test files (MasterGlueToneTests, MasterSaturationTests). Tests only.
#pragma once
#include "FaustStage.h"
#include "MasterStage.h"
#include "MasterTone.h"
#include <juce_core/juce_core.h>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <random>
#include <vector>

namespace sssketch::mastertest
{
    constexpr double kPi = 3.14159265358979323846;

    struct Stereo
    {
        std::vector<float> l, r;
        explicit Stereo(size_t n = 0) : l(n, 0.0f), r(n, 0.0f) {}
        size_t size() const { return l.size(); }
        bool operator==(const Stereo& o) const
        {
            return l.size() == o.l.size() && std::memcmp(l.data(), o.l.data(), l.size() * sizeof(float)) == 0
                && std::memcmp(r.data(), o.r.data(), r.size() * sizeof(float)) == 0;
        }
    };

    inline Stereo sine(double rate, int frames, double freq, double amp)
    {
        Stereo s((size_t) frames);
        for (int i = 0; i < frames; ++i)
            s.l[(size_t) i] = s.r[(size_t) i] = (float) (amp * std::sin(2.0 * kPi * freq * i / rate));
        return s;
    }

    /** A dense, wide, busy mix around -10 dBFS RMS with peaks near 0 dBFS: a bass, two
     * detuned pads, seeded noise, different on each side. */
    inline Stereo denseMix(double rate, int frames, unsigned seed = 1234)
    {
        Stereo s((size_t) frames);
        std::mt19937 rng(seed);
        std::uniform_real_distribution<float> noise(-0.15f, 0.15f);
        for (int i = 0; i < frames; ++i)
        {
            const double t = i / rate;
            const double beat = std::exp(-std::fmod(t, 0.5) * 8.0); // a kick-ish swell every 0.5 s
            s.l[(size_t) i] = (float) (0.45 * beat * std::sin(2.0 * kPi * 55.0 * t) + 0.2 * std::sin(2.0 * kPi * 440.0 * t)
                                       + 0.12 * std::sin(2.0 * kPi * 3150.0 * t)) + noise(rng);
            s.r[(size_t) i] = (float) (0.45 * beat * std::sin(2.0 * kPi * 55.0 * t) + 0.2 * std::sin(2.0 * kPi * 443.0 * t + 1.0)
                                       + 0.1 * std::sin(2.0 * kPi * 7000.0 * t)) + noise(rng);
        }
        return s;
    }

    template <typename NextBlock>
    Stereo run(MasterStage& stage, const MasterStage::Settings* settings, double rate, Stereo in, NextBlock nextBlock)
    {
        for (int at = 0; at < (int) in.size();)
        {
            const int n = juce::jmin(juce::jmax(1, nextBlock()), (int) in.size() - at);
            stage.process(settings, rate, n, in.l.data() + at, in.r.data() + at);
            at += n;
        }
        return in;
    }

    inline Stereo runFresh(const MasterStage::Settings* settings, double rate, const Stereo& in, int block)
    {
        MasterStage stage;
        stage.prepare(rate);
        return run(stage, settings, rate, in, [block] { return block; });
    }

    /** The stage by hand, from its parts, run over the whole buffer at once: the trim, then
     * whichever of the tone, the saturation and the glue are asked for, then the limiter. */
    inline Stereo byHand(const MasterStage::Settings& s, double rate, Stereo x)
    {
        const int n = (int) x.size();
        const float g = (float) std::pow(10.0, s.mastering.headroomDb / 20.0);
        for (int i = 0; i < n; ++i)
        {
            x.l[(size_t) i] *= g;
            x.r[(size_t) i] *= g;
        }
        MasterTone tone;
        tone.prepare(rate);
        if (s.tone)
        {
            tone.setShelves((float) s.tone->lowShelfDb, (float) s.tone->highShelfDb, 0);
            tone.highpass(n, x.l.data(), x.r.data(), nullptr);
        }
        if (s.saturation)
        {
            FaustStage saturate(FaustDspKind::saturate);
            saturate.prepare(rate, 512);
            saturate.setParam("/saturate/drive", (float) s.saturation->drive);
            Stereo y((size_t) n);
            const float* ins[2] = { x.l.data(), x.r.data() };
            float* outs[2] = { y.l.data(), y.r.data() };
            saturate.process(ins, 2, outs, n);
            x = y;
        }
        if (s.glue)
        {
            FaustStage glue(FaustDspKind::glue);
            glue.prepare(rate, 512);
            glue.setParam("/glue/threshold", (float) s.glue->thresholdDb);
            glue.setParam("/glue/ratio", (float) s.glue->ratio);
            glue.setParam("/glue/knee", (float) s.glue->kneeDb);
            Stereo y((size_t) n);
            const float* ins[2] = { x.l.data(), x.r.data() };
            float* outs[2] = { y.l.data(), y.r.data() };
            glue.process(ins, 2, outs, n);
            x = y;
        }
        if (s.tone)
            tone.widthAndShelves(n, x.l.data(), x.r.data(), nullptr);
        FaustStage limiter(FaustDspKind::truepeak);
        limiter.prepare(rate, 512);
        limiter.setParam("/truepeak/ceiling", (float) s.mastering.ceilingDb);
        Stereo y((size_t) n);
        const float* ins[2] = { x.l.data(), x.r.data() };
        float* outs[2] = { y.l.data(), y.r.data() };
        limiter.process(ins, 2, outs, n);
        return y;
    }

    inline juce::File goldenDir()
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

    inline bool loadGolden(const juce::String& name, int frames, Stereo& out)
    {
        juce::MemoryBlock data;
        if (! goldenDir().getChildFile(name).loadFileAsData(data)) return false;
        if (data.getSize() != 2 * (size_t) frames * sizeof(float)) return false;
        auto* f = static_cast<const float*>(data.getData());
        out.l.assign(f, f + frames);
        out.r.assign(f + frames, f + 2 * frames);
        return true;
    }

    inline float maxAbsDiff(const Stereo& a, const Stereo& b, size_t from = 0)
    {
        float worst = 0.0f;
        for (size_t i = from; i < a.size(); ++i)
            worst = std::max({ worst, std::abs(a.l[i] - b.l[i]), std::abs(a.r[i] - b.r[i]) });
        return worst;
    }
}

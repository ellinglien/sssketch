// native-engine/Source/FaustStage.cpp
#include "FaustStage.h"
#include <juce_core/juce_core.h>
#include <cstdlib>

namespace sssketch
{
    namespace
    {
        /** Collects each zone under its Faust address: "/" + the box labels + the label, spaces
         * as underscores (how Faust's JSON names them, and so how the web addresses them). */
        struct ZoneCollector : faust::UI
        {
            struct Found
            {
                std::string address;
                FAUSTFLOAT* zone;
                bool isMeter;
            };
            std::vector<std::string> boxes;
            std::vector<Found> found;

            static std::string clean(const char* label)
            {
                std::string s(label);
                for (auto& c : s)
                    if (c == ' ') c = '_';
                return s;
            }
            std::string path(const char* label) const
            {
                std::string p;
                for (auto& b : boxes) p += "/" + b;
                return p + "/" + clean(label);
            }
            void add(const char* label, FAUSTFLOAT* zone, bool isMeter) { found.push_back({ path(label), zone, isMeter }); }

            void openTabBox(const char* l) override { boxes.push_back(clean(l)); }
            void openHorizontalBox(const char* l) override { boxes.push_back(clean(l)); }
            void openVerticalBox(const char* l) override { boxes.push_back(clean(l)); }
            void closeBox() override
            {
                if (! boxes.empty()) boxes.pop_back();
            }
            void addButton(const char* l, FAUSTFLOAT* z) override { add(l, z, false); }
            void addCheckButton(const char* l, FAUSTFLOAT* z) override { add(l, z, false); }
            void addVerticalSlider(const char* l, FAUSTFLOAT* z, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT) override { add(l, z, false); }
            void addHorizontalSlider(const char* l, FAUSTFLOAT* z, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT) override { add(l, z, false); }
            void addNumEntry(const char* l, FAUSTFLOAT* z, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT) override { add(l, z, false); }
            void addHorizontalBargraph(const char* l, FAUSTFLOAT* z, FAUSTFLOAT, FAUSTFLOAT) override { add(l, z, true); }
            void addVerticalBargraph(const char* l, FAUSTFLOAT* z, FAUSTFLOAT, FAUSTFLOAT) override { add(l, z, true); }
        };

        struct LatencyMeta : faust::Meta
        {
            int latency = 0;
            void declare(const char* key, const char* value) override
            {
                if (std::string_view(key) == "latency_samples") latency = std::atoi(value);
            }
        };
    }

    void FaustStage::prepare(double sampleRate, int maxBlockSize)
    {
        dsp = makeFaustDsp(kind);
        // Faust's DSPs take an int rate, as the web's init(0, sampleRate) truncates it
        dsp->init((int) sampleRate);
        nIn = dsp->getNumInputs();
        nOut = dsp->getNumOutputs();
        jassert(nIn <= kMaxChannels && nOut <= kMaxChannels);

        LatencyMeta meta;
        dsp->metadata(&meta);
        latency = meta.latency;

        ZoneCollector ui;
        dsp->buildUserInterface(&ui);
        zones.clear();
        for (auto& f : ui.found) zones.push_back({ f.address, f.zone, f.isMeter });

        maxBlock = juce::jmax(1, maxBlockSize);
        silence.assign((size_t) maxBlock, 0.0f);
    }

    void FaustStage::reset()
    {
        if (dsp != nullptr) dsp->instanceClear();
    }

    const FaustStage::Zone* FaustStage::find(std::string_view address) const
    {
        for (auto& z : zones)
            if (z.address == address) return &z;
        return nullptr;
    }

    bool FaustStage::setParam(std::string_view address, float value)
    {
        auto* z = find(address);
        if (z == nullptr || z->isMeter) return false;
        *z->zone = value;
        return true;
    }

    std::optional<float> FaustStage::getParam(std::string_view address) const
    {
        auto* z = find(address);
        if (z == nullptr) return std::nullopt;
        return *z->zone;
    }

    std::optional<float> FaustStage::meter(std::string_view address) const
    {
        auto* z = find(address);
        if (z == nullptr || ! z->isMeter) return std::nullopt;
        return *z->zone;
    }

    std::vector<std::string> FaustStage::addresses() const
    {
        std::vector<std::string> out;
        for (auto& z : zones) out.push_back(z.address);
        return out;
    }

    void FaustStage::process(const float* const* inputs, int numInputChannels, float* const* outputs, int numSamples)
    {
        jassert(dsp != nullptr);
        if (dsp == nullptr) return;
        std::array<float*, kMaxChannels> in {};
        std::array<float*, kMaxChannels> out {};
        for (int done = 0; done < numSamples;)
        {
            const int n = juce::jmin(maxBlock, numSamples - done);
            // Faust takes non-const input pointers but only reads them
            for (int c = 0; c < nIn; ++c)
                in[(size_t) c] = c < numInputChannels ? const_cast<float*>(inputs[c]) + done : silence.data();
            for (int c = 0; c < nOut; ++c)
                out[(size_t) c] = outputs[c] + done;
            dsp->compute(n, in.data(), out.data());
            done += n;
        }
    }
}

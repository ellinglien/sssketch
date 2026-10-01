// native-engine/Source/FaustStage.h
#pragma once
#include "dsp/faust/FaustArch.h"
#include <array>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace sssketch
{
    /** The Faust DSPs compiled to C++ (dsp/faust/generated/, from the .dsp files the web radio
     * compiles to wasm; scripts/build-faust-cpp.mjs). truepeak is wired (MasterStage, Task 3 of
     * the native radio sound plan); each other master/pump stage takes one in its own task. */
    enum class FaustDspKind
    {
        saturate,
        glue,
        pump,
        truepeak,
        reverb
    };

    /** A new, un-initialised DSP of that kind (FaustDsps.cpp, the one TU that includes the
     * generated code). Allocates -- the reverb's state alone is ~4 MB -- so call it off the
     * audio thread. */
    std::unique_ptr<faust::dsp> makeFaustDsp(FaustDspKind kind);
    const char* faustDspName(FaustDspKind kind);

    /** One Faust DSP, wrapped the way the web's faustProcessor.js runs it: init at the running
     * rate, parameters set by their Faust address ("/truepeak/ceiling"), meters (bargraphs)
     * read the same way.
     *
     *   prepare()  message thread: builds the DSP, collects its zones, sizes a silent buffer
     *   process()  audio thread: never allocates; block-size invariant to the bit (Faust reads
     *              its parameters once per compute() call, and they only change via setParam)
     *
     * Inputs the caller does not supply are fed silence, as Web Audio's upmix feeds a worklet
     * input with more channels than are connected (pump.dsp: program L R, key L R; a caller with
     * no key passes 2 and the pump never ducks). */
    class FaustStage
    {
    public:
        explicit FaustStage(FaustDspKind kind) : kind(kind) {}

        /** Message thread. Re-preparing builds a fresh DSP at its defaults. */
        void prepare(double sampleRate, int maxBlockSize);
        bool isPrepared() const { return dsp != nullptr; }

        /** Back to the state just after prepare() (delay lines and envelopes cleared); the
         * parameters keep their values. */
        void reset();

        int numInputs() const { return nIn; }
        int numOutputs() const { return nOut; }
        /** The DSP's `declare latency_samples` (truepeak: 75), or 0. */
        int latencySamples() const { return latency; }

        /** Sets a slider by its Faust address. False (and nothing set) for an unknown address
         * or a meter. Not clamped: Faust's own sliders are clamped by the UI, not the DSP. */
        bool setParam(std::string_view address, float value);
        /** A slider's or meter's current value, or nothing for an unknown address. */
        std::optional<float> getParam(std::string_view address) const;
        /** A bargraph's last value ("/glue/gr", "/pump/duck", "/truepeak/gr"), or nothing. */
        std::optional<float> meter(std::string_view address) const;

        /** Every address, sliders and meters, in the DSP's own order. */
        std::vector<std::string> addresses() const;

        /** Runs numSamples through the DSP. `inputs` holds numInputChannels channel pointers
         * (fewer than numInputs() is fine: the rest are silence); `outputs` holds numOutputs().
         * Inputs and outputs must not alias. Any numSamples; longer than the prepared block
         * size is split internally. */
        void process(const float* const* inputs, int numInputChannels, float* const* outputs, int numSamples);

    private:
        struct Zone
        {
            std::string address;
            FAUSTFLOAT* zone = nullptr;
            bool isMeter = false;
        };
        const Zone* find(std::string_view address) const;

        static constexpr int kMaxChannels = 16;

        FaustDspKind kind;
        std::unique_ptr<faust::dsp> dsp;
        std::vector<Zone> zones;
        std::vector<float> silence;
        int maxBlock = 0;
        int nIn = 0, nOut = 0, latency = 0;
    };
}

// native-engine/Source/CavernReverb.h
#pragma once
#include <array>
#include <cstdint>
#include <memory>
#include <vector>

namespace juce::dsp { class FFT; }

namespace sssketch
{
    /** The cavernous room (docs/superpowers/plans/2026-10-01-native-radio-sound.md, Task 5): the
     * web radio's default reverb, a convolver over a generated impulse. Three parts:
     *
     * 1. THE IMPULSE, a C++ twin of ell.ing/radio src/audio/noise.ts reverbImpulse: mulberry32
     *    white noise (seeds 0x5eed and 0x5eed ^ 0x9e3779b9, one per side, so the tail is wide),
     *    shaped by short-time Fourier synthesis -- Hann-windowed 1024-sample frames at hop 256,
     *    every bin scaled by exp(-ln(1000) / T60(f) * t) at the frame's centre time t, windowed
     *    again, overlap-added and divided by 1.5 -- after 30 ms of exact silence. The T60 curve
     *    is REVERB_IR (src/shared/radioSound.ts), twinned below as kCavernT60: 5 s at 125-250 Hz
     *    down to 1.5 s at 16 kHz, so the tail darkens as it decays. Computed in double with the
     *    web's own radix-2 FFT, so it matches the TS to ~1e-15 before the final float rounding
     *    (CavernReverbTests checks it against a golden file the web's code wrote).
     *
     * 2. WEB AUDIO'S NORMALISATION. A ConvolverNode with `normalize` on (the default, and what
     *    the web uses) scales its impulse by 0.00125 / max(rms, 0.000125) x 44100 / rate, the rms
     *    over every sample of every channel (the Web Audio spec's GainCalibration, MinPower and
     *    GainCalibrationSampleRate). Then the web's return GainNode, REVERB_RETURN_DB (-3.4 dB).
     *    Both are folded into the partitions, so an impulse in gives that out.
     *
     * 3. THE CONVOLVER: uniformly partitioned overlap-save, 1024-sample partitions, 2048-point
     *    juce::dsp::FFT, an input FIFO. It always transforms whole 1024-sample frames however the
     *    host splits its blocks, so its output is block-size invariant to the bit. Its 1024
     *    samples of latency are cancelled by trimming 1024 of the impulse's leading zeros: the
     *    pre-delay is round(0.03 x rate), 1323 samples at 44.1 kHz and 1440 at 48 kHz, so the
     *    output lands exactly where a zero-latency convolution would put it. (Below ~34.1 kHz the
     *    pre-delay is shorter than a partition; then all of it is trimmed and the room arrives
     *    1024 - pre samples late -- extraLatency.)
     *
     * Not juce::dsp::Convolution: that loads impulses on a background thread, so a fresh export
     * would start dry.
     *
     * Building an impulse is message-thread work (~240 partitions a side at 48 kHz, ~4 MB):
     * cavernIrFor() caches one per sample rate for the process. The convolver's own state (the
     * spectra of the last ~240 input frames, another ~4 MB) is allocated by its constructor, so
     * that is message-thread work too; process() never allocates. ReverbBus owns the instance
     * and hands it to the audio thread (see ReverbBus.h). */

    /** REVERB_IR's pre-delay, seconds. */
    inline constexpr double kCavernPreDelaySec = 0.03;
    /** REVERB_IR's T60 curve: [Hz, seconds], rising in Hz; log-frequency interpolation between,
     * held flat beyond the ends. */
    inline constexpr std::array<std::array<double, 2>, 8> kCavernT60 { {
        { 125.0, 5.0 },
        { 250.0, 5.0 },
        { 500.0, 4.8 },
        { 1000.0, 4.5 },
        { 2000.0, 3.8 },
        { 4000.0, 3.0 },
        { 8000.0, 2.2 },
        { 16000.0, 1.5 },
    } };
    /** REVERB_RETURN_DB: the convolver's return trim. */
    inline constexpr double kCavernReturnDb = -3.4;

    /** noise.ts t60At. */
    double cavernT60At(double hz);
    /** round(kCavernPreDelaySec x rate), rounding as JS Math.round does. */
    int cavernPreDelaySamples(double sampleRate);
    /** round(longest T60 x rate): the impulse after its pre-delay. */
    int cavernTailSamples(double sampleRate);

    /** noise.ts reverbImpulse at this rate: two channels of cavernPreDelaySamples +
     * cavernTailSamples, NOT normalised. */
    std::array<std::vector<float>, 2> cavernImpulse(double sampleRate);

    /** The Web Audio ConvolverNode's normalisation scale for an impulse at `sampleRate`:
     * 0.00125 / max(sqrt(mean square over every channel and sample), 0.000125) x 44100 / rate.
     * Computed in double. */
    double webAudioConvolverScale(const std::array<std::vector<float>, 2>& impulse, double sampleRate);

    /** One sample rate's room, ready to convolve with: the impulse normalised (Web Audio's
     * scale, then the -3.4 dB return), with its first `trimmed` samples (zeros) dropped, cut into
     * partitions and transformed. Immutable once built, so one instance serves every convolver
     * at its rate. */
    struct CavernIr
    {
        static constexpr int kBlock = 1024;              // partition and frame length
        static constexpr int kFftOrder = 11;             // 2048-point FFT
        static constexpr int kFftSize = 1 << kFftOrder;
        static constexpr int kBins = kFftSize / 2 + 1;   // DC..Nyquist

        double sampleRate = 0.0;
        /** The whole impulse, pre-delay included. */
        int length = 0;
        /** Leading zeros dropped to cancel the convolver's kBlock latency: min(pre-delay, kBlock). */
        int trimmed = 0;
        /** kBlock - trimmed: how late the room arrives beyond its own pre-delay (0 at 44.1 kHz
         * and above). */
        int extraLatency = 0;
        int numPartitions = 0;
        /** webAudioConvolverScale of the impulse. */
        double normalisation = 0.0;
        /** What every impulse sample was multiplied by before partitioning: normalisation x
         * the return trim, as float. */
        float gain = 0.0f;
        /** Per side: numPartitions x kBins, split complex. */
        std::array<std::vector<float>, 2> re, im;
    };

    /** Builds a sample rate's room. Message thread (or any non-real-time thread); allocates. */
    std::shared_ptr<const CavernIr> buildCavernIr(double sampleRate);

    /** buildCavernIr, cached per sample rate for the life of the process. Thread-safe (a
     * mutex); never call it from the audio thread. Null for a non-positive or non-finite rate. */
    std::shared_ptr<const CavernIr> cavernIrFor(double sampleRate);

    /** The convolver: a CavernIr plus one stream's state. Stereo in, stereo out: left through
     * the left impulse, right through the right, as a ConvolverNode does with a stereo input and
     * a stereo impulse.
     *
     * Constructed (and destroyed) off the audio thread; process()/clear() never
     * allocate. Single rendering thread, like ReverbBus. */
    class CavernConvolver
    {
    public:
        explicit CavernConvolver(std::shared_ptr<const CavernIr> ir);
        ~CavernConvolver();
        CavernConvolver(const CavernConvolver&) = delete;
        CavernConvolver& operator=(const CavernConvolver&) = delete;

        double sampleRate() const { return ir->sampleRate; }
        const CavernIr& impulse() const { return *ir; }

        /** Feeds `numSamples` of input and ADDS the room's output x `gain` into outL/outR. Any
         * numSamples. Input frames that are exact silence cost no transform, and a frame whose
         * every remembered spectrum is silent costs no multiply-add. */
        void process(int numSamples, const float* inL, const float* inR, float* outL, float* outR, float gain);

        /** How long the room can still sound after its last non-silent input sample, at most:
         * every remembered frame has left and the output FIFO is empty. After this many samples
         * of silent input the state is exactly zero. */
        int tailSamples() const { return (ir->numPartitions + 2) * CavernIr::kBlock; }

        /** Drops all state, cheaply: the FIFOs are zeroed and the remembered spectra flagged
         * silent rather than cleared. For a room starting from silence. */
        void clear();

    private:
        void processFrame();

        std::shared_ptr<const CavernIr> ir;
        std::unique_ptr<juce::dsp::FFT> fft;
        int fifoPos = 0;
        int head = 0; // the FDL slot the next frame's spectrum goes into
        struct Side
        {
            std::vector<float> inFifo, outFifo, previous; // kBlock each
            bool previousSilent = true;
            std::vector<float> fdlRe, fdlIm;              // numPartitions x kBins: past input spectra
            std::vector<uint8_t> slotSilent;              // numPartitions
        };
        std::array<Side, 2> sides;
        std::vector<float> fftBuffer;   // 2 x kFftSize, juce::dsp::FFT's real-only layout
        std::vector<float> accRe, accIm; // kBins
    };
}

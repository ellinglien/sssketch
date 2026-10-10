#include "ShapeRender.h"
#include "StemBufferCache.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <algorithm>
#include <cstdint>
#include <cmath>
#include <limits>

namespace sssketch
{
    static constexpr double kEdgeFadeSec = 0.003;
    static constexpr double kEps = 1.0e-9;

    static bool finitePositive(double value)
    {
        return std::isfinite(value) && value > 0.0;
    }

    static void healShapeSeam(
        juce::AudioBuffer<float>& buffer,
        int boundaryFrame,
        int targetFrame,
        int availableTailFrames,
        int preferredWindowSize = 128)
    {
        if (availableTailFrames <= preferredWindowSize * 2)
            return;
        const int windowSize = preferredWindowSize;
        if (boundaryFrame < windowSize || targetFrame < 0
            || targetFrame >= buffer.getNumSamples() || boundaryFrame > buffer.getNumSamples())
            return;
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            auto* data = buffer.getWritePointer(ch);
            const float target = data[targetFrame];
            for (int i = 0; i < windowSize; ++i)
            {
                const int tailIndex = boundaryFrame - 1 - i;
                const double t = -1.0 + ((double) i / (double) windowSize) * 2.0;
                const float coefficient = (float) std::sqrt(0.5 * (1.0 - t));
                data[tailIndex] += (target - data[tailIndex]) * coefficient;
            }
        }
    }

    bool renderShapeRawSourceToWav(
        const juce::String& sourcePath,
        double rate,
        const juce::String& outputPath,
        ShapeRenderInfo& infoOut,
        juce::String& errorOut)
    {
        if (!finitePositive(rate) || rate < 0.03125 || rate > 32.0)
        {
            errorOut = "invalid Shape Raw resampling rate";
            return false;
        }
        juce::AudioBuffer<float> source;
        double sampleRate = 0.0;
        if (!decodeRawAudioFile(sourcePath, source, sampleRate)
            || !finitePositive(sampleRate)
            || source.getNumSamples() <= 0
            || source.getNumChannels() <= 0)
        {
            errorOut = "failed to decode Shape Raw source: " + sourcePath;
            return false;
        }
        const double exactFrames = (double) source.getNumSamples() / rate;
        if (!std::isfinite(exactFrames) || exactFrames <= 0.0
            || exactFrames > (double) std::numeric_limits<int>::max())
        {
            errorOut = "invalid Shape Raw output length";
            return false;
        }
        const int frames = std::max(1, (int) std::ceil(exactFrames));
        juce::AudioBuffer<float> output(source.getNumChannels(), frames);
        for (int ch = 0; ch < output.getNumChannels(); ++ch)
        {
            const auto* input = source.getReadPointer(ch);
            auto* result = output.getWritePointer(ch);
            for (int frame = 0; frame < frames; ++frame)
            {
                const int sourceFrame = std::min(
                    source.getNumSamples() - 1,
                    (int) std::floor((double) frame * rate));
                result[frame] = input[sourceFrame];
            }
        }

        auto file = juce::File(outputPath);
        if (!file.getParentDirectory().createDirectory() && !file.getParentDirectory().isDirectory())
        {
            errorOut = "failed to create Shape Raw output directory";
            return false;
        }
        file.deleteFile();
        juce::WavAudioFormat wav;
        std::unique_ptr<juce::FileOutputStream> stream(file.createOutputStream());
        if (stream == nullptr)
        {
            errorOut = "failed to open Shape Raw output: " + outputPath;
            return false;
        }
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wav.createWriterFor(stream.get(), sampleRate, (unsigned int) output.getNumChannels(), 32, {}, 0));
        if (writer == nullptr)
        {
            errorOut = "failed to create Shape Raw float WAV writer";
            return false;
        }
        stream.release();
        if (!writer->writeFromAudioSampleBuffer(output, 0, frames))
        {
            writer.reset();
            file.deleteFile();
            errorOut = "failed while writing Shape Raw output";
            return false;
        }
        writer.reset();
        infoOut.durationSec = (double) frames / sampleRate;
        infoOut.sampleRate = sampleRate;
        infoOut.frames = frames;
        infoOut.channels = output.getNumChannels();
        return true;
    }

    bool renderShapeProcessSourceToWav(
        const juce::String& sourcePath,
        const juce::String& processType,
        double primary,
        double secondary,
        double tertiary,
        double quaternary,
        double quinary,
        double mix,
        const juce::String& outputPath,
        ShapeRenderInfo& infoOut,
        juce::String& errorOut)
    {
        const bool known = processType == "wavefold" || processType == "saturation"
            || processType == "hard-clip" || processType == "rectify"
            || processType == "bit-crush" || processType == "rate-crush"
            || processType == "ring-mod" || processType == "comb"
            || processType == "smear" || processType == "compand"
            || processType == "codec-damage" || processType == "short-room"
            || processType == "frequency-shift" || processType == "chorus"
            || processType == "dj-eq" || processType == "tone";
        bool valid = known && std::isfinite(primary) && std::isfinite(secondary)
            && std::isfinite(tertiary) && std::isfinite(quaternary)
            && std::isfinite(quinary)
            && std::isfinite(mix) && mix >= 0.0 && mix <= 1.0;
        if (processType == "wavefold")
            valid = valid && primary >= 1.0 && primary <= 16.0
                && secondary >= -1.0 && secondary <= 1.0;
        else if (processType == "saturation")
            valid = valid && primary >= 1.0 && primary <= 16.0
                && secondary >= -1.0 && secondary <= 1.0
                && tertiary >= -24.0 && tertiary <= 24.0;
        else if (processType == "hard-clip")
            valid = valid && primary >= 0.05 && primary <= 1.0
                && secondary >= -1.0 && secondary <= 1.0;
        else if (processType == "rectify")
            valid = valid && (primary == 0.0 || primary == 1.0)
                && secondary >= 1.0 && secondary <= 8.0;
        else if (processType == "bit-crush")
            valid = valid && primary >= 2.0 && primary <= 16.0
                && secondary >= 0.0 && secondary <= 1.0;
        else if (processType == "rate-crush")
            valid = valid && primary >= 1.0 && primary <= 64.0
                && secondary >= 0.0 && secondary <= 1.0;
        else if (processType == "ring-mod")
            valid = valid && primary >= 1.0 && primary <= 2000.0
                && secondary >= 0.0 && secondary <= 1.0;
        else if (processType == "comb")
            valid = valid && primary >= 1.0 && primary <= 50.0
                && secondary >= -0.95 && secondary <= 0.95
                && tertiary >= 0.0 && tertiary <= 1.0;
        else if (processType == "smear")
            valid = valid && primary >= 5.0 && primary <= 250.0
                && secondary >= 0.0 && secondary <= 1.0;
        else if (processType == "compand")
            valid = valid && primary >= 1.0 && primary <= 64.0
                && secondary >= 0.0 && secondary <= 1.0
                && tertiary >= -1.0 && tertiary <= 1.0
                && quaternary >= -36.0 && quaternary <= 24.0;
        else if (processType == "codec-damage")
            valid = valid && primary >= 1.0 && primary <= 100.0
                && secondary >= 0.0 && secondary <= 1.0
                && tertiary >= 1.0 && tertiary <= 250.0
                && quaternary >= 200.0 && quaternary <= 24000.0;
        else if (processType == "short-room")
            valid = valid && primary >= 1.0 && primary <= 250.0
                && secondary >= -0.98 && secondary <= 0.98
                && tertiary >= 0.0 && tertiary <= 1.0
                && quaternary >= 0.0 && quaternary <= 2.0;
        else if (processType == "frequency-shift")
            valid = valid && primary >= -12000.0 && primary <= 12000.0
                && secondary >= -0.95 && secondary <= 0.95
                && tertiary >= 0.0 && tertiary <= 2.0;
        else if (processType == "chorus")
            valid = valid && primary >= 0.05 && primary <= 20.0
                && secondary >= 0.0 && secondary <= 50.0
                && tertiary >= 0.1 && tertiary <= 50.0
                && quaternary >= -0.95 && quaternary <= 0.95
                && quinary >= 0.0 && quinary <= 2.0;
        else if (processType == "dj-eq")
            valid = valid && primary >= -72.0 && primary <= 24.0
                && secondary >= -72.0 && secondary <= 24.0
                && tertiary >= -72.0 && tertiary <= 24.0;
        else if (processType == "tone")
            valid = valid && primary >= 20.0 && primary <= 20000.0
                && secondary >= 0.0 && secondary <= 0.99
                && tertiary >= 1.0 && tertiary <= 32.0;
        if (!valid)
        {
            errorOut = "invalid Shape Process parameters for " + processType;
            return false;
        }
        juce::AudioBuffer<float> audio;
        double sampleRate = 0.0;
        if (!decodeRawAudioFile(sourcePath, audio, sampleRate)
            || !finitePositive(sampleRate)
            || audio.getNumSamples() <= 0
            || audio.getNumChannels() <= 0)
        {
            errorOut = "failed to decode Shape Process source: " + sourcePath;
            return false;
        }
        const auto fold = [](double value) {
            double wrapped = std::fmod(value + 1.0, 4.0);
            if (wrapped < 0.0)
                wrapped += 4.0;
            return wrapped <= 2.0 ? wrapped - 1.0 : 3.0 - wrapped;
        };
        const double processOutputGain = processType == "saturation"
            ? std::pow(10.0, tertiary / 20.0)
            : processType == "compand"
                ? std::pow(10.0, quaternary / 20.0)
                : 1.0;
        for (int ch = 0; ch < audio.getNumChannels(); ++ch)
        {
            auto* samples = audio.getWritePointer(ch);
            const int holdFrames = std::max(1, (int) std::round(primary));
            const int combFrames = std::max(1, (int) std::round(primary * sampleRate / 1000.0));
            const int smearMaxDelay = std::max(1, (int) std::round(primary * sampleRate / 1000.0));
            const int smearTaps = 4 + (int) std::round(secondary * 12.0);
            std::vector<float> combHistory(
                processType == "comb" ? (size_t) audio.getNumSamples() : 0);
            std::vector<float> dryCopy(samples, samples + audio.getNumSamples());
            std::vector<float> roomHistory(
                processType == "short-room" ? (size_t) audio.getNumSamples() : 0);
            std::vector<float> frequencyHistory(
                processType == "frequency-shift" ? (size_t) audio.getNumSamples() : 0);
            std::vector<float> chorusHistory(
                processType == "chorus" ? (size_t) audio.getNumSamples() : 0);
            float held = samples[0];
            int nextHoldFrame = 0;
            float dampedComb = 0.0f;
            double codecLowpass = 0.0;
            double roomDamped = 0.0;
            double frequencyFeedback = 0.0;
            double chorusDark = 0.0;
            double djLow = 0.0;
            double djBelowHigh = 0.0;
            double toneIc1 = 0.0;
            double toneIc2 = 0.0;
            for (int frame = 0; frame < audio.getNumSamples(); ++frame)
            {
                const double dry = dryCopy[(size_t) frame];
                double wet = dry;
                if (processType == "wavefold")
                    wet = fold(dry * primary + secondary);
                else if (processType == "saturation")
                {
                    const double center = std::tanh(secondary * primary);
                    wet = (std::tanh((dry + secondary) * primary) - center) / std::tanh(primary);
                }
                else if (processType == "hard-clip")
                {
                    const double positiveThreshold = primary * (1.0 - secondary * 0.75);
                    const double negativeThreshold = primary * (1.0 + secondary * 0.75);
                    wet = dry >= 0.0
                        ? std::clamp(dry / positiveThreshold, 0.0, 1.0)
                        : std::clamp(dry / negativeThreshold, -1.0, 0.0);
                }
                else if (processType == "rectify")
                {
                    const double driven = std::clamp(dry * secondary, -1.0, 1.0);
                    wet = primary == 0.0 ? std::max(0.0, driven) : std::abs(driven);
                }
                else if (processType == "bit-crush")
                {
                    const double levels = std::pow(2.0, std::round(primary) - 1.0);
                    uint32_t noiseState = (uint32_t) (frame + 1) * 747796405u
                        ^ (uint32_t) (ch + 1) * 2891336453u;
                    noiseState ^= noiseState >> 16;
                    noiseState *= 2246822519u;
                    noiseState ^= noiseState >> 13;
                    const double noise = ((double) noiseState
                        / (double) std::numeric_limits<uint32_t>::max()) - 0.5;
                    wet = std::round((dry + noise * secondary / levels) * levels) / levels;
                }
                else if (processType == "rate-crush")
                {
                    if (frame >= nextHoldFrame)
                    {
                        held = (float) dry;
                        uint32_t jitterState = (uint32_t) (frame + 1) * 277803737u
                            ^ (uint32_t) (ch + 1) * 1597334677u;
                        jitterState ^= jitterState >> 15;
                        const double noise = ((double) jitterState
                            / (double) std::numeric_limits<uint32_t>::max()) * 2.0 - 1.0;
                        const int variedHold = std::max(
                            1, (int) std::round((double) holdFrames * (1.0 + noise * secondary * 0.75)));
                        nextHoldFrame = frame + variedHold;
                    }
                    wet = held;
                }
                else if (processType == "ring-mod")
                {
                    const double sine = std::sin(
                        juce::MathConstants<double>::twoPi * primary * (double) frame / sampleRate);
                    const double square = sine >= 0.0 ? 1.0 : -1.0;
                    wet = dry * (sine + (square - sine) * secondary);
                }
                else if (processType == "comb")
                {
                    const double delayed = frame >= combFrames
                        ? combHistory[(size_t) (frame - combFrames)]
                        : 0.0;
                    const double dampingCoefficient = 1.0 - tertiary * 0.95;
                    dampedComb += (float) ((delayed - dampedComb) * dampingCoefficient);
                    wet = dry + secondary * dampedComb;
                    combHistory[(size_t) frame] = (float) wet;
                }
                else if (processType == "smear")
                {
                    double sum = dry * 0.25;
                    double weightSum = 0.25;
                    for (int tap = 1; tap <= smearTaps; ++tap)
                    {
                        const double position = (double) tap / (double) smearTaps;
                        const double curve = std::pow(position, 0.6 + secondary * 1.8);
                        const int delay = std::max(1, (int) std::round(curve * smearMaxDelay));
                        const double weight = 1.0 - position * 0.45;
                        if (frame >= delay)
                            sum += dryCopy[(size_t) (frame - delay)] * weight;
                        weightSum += weight;
                    }
                    wet = sum / weightSum;
                }
                else if (processType == "compand")
                {
                    const double shifted = dry + tertiary * 0.3;
                    const double driven = shifted * primary;
                    const double mu = std::pow(1000.0, secondary) - 1.0;
                    const auto encode = [mu](double value) {
                        if (mu < 1.0e-6)
                            return value;
                        return std::copysign(
                            std::log1p(mu * std::abs(value)) / std::log1p(mu),
                            value);
                    };
                    const double center = encode(tertiary * 0.3 * primary);
                    wet = std::tanh((encode(driven) - center) * (1.0 + secondary * 8.0));
                }
                else if (processType == "codec-damage")
                {
                    const int packetFrames = std::max(
                        1, (int) std::round(tertiary * sampleRate / 1000.0));
                    const int packetIndex = frame / packetFrames;
                    uint32_t packetState = (uint32_t) (packetIndex + 1) * 2246822519u
                        ^ (uint32_t) (ch + 1) * 3266489917u;
                    packetState ^= packetState >> 13;
                    packetState *= 668265263u;
                    const double packetChance = (double) packetState
                        / (double) std::numeric_limits<uint32_t>::max();
                    const bool lost = packetChance < secondary;
                    const int repeatedFrame = frame - packetFrames;
                    const double damagedInput = lost
                        ? (repeatedFrame >= 0 ? dryCopy[(size_t) repeatedFrame] : 0.0)
                        : dry;
                    const double cutoff = std::min(quaternary, sampleRate * 0.45);
                    const double lowpassCoefficient = 1.0 - std::exp(
                        -juce::MathConstants<double>::twoPi * cutoff / sampleRate);
                    codecLowpass += lowpassCoefficient * (damagedInput - codecLowpass);
                    const int bits = 2 + (int) std::round((primary / 100.0) * 14.0);
                    const double levels = std::pow(2.0, bits - 1);
                    wet = std::round(codecLowpass * levels) / levels;
                }
                else if (processType == "short-room")
                {
                    const int roomFrames = std::max(
                        1, (int) std::round(primary * sampleRate / 1000.0));
                    const double channelSkew = audio.getNumChannels() > 1 && (ch & 1)
                        ? 1.0 + 0.13 * quaternary
                        : 1.0 - 0.07 * quaternary;
                    const double tapRatios[] { 0.31, 0.47, 0.71, 1.0 };
                    double reflections = 0.0;
                    double weight = 0.0;
                    for (int tap = 0; tap < 4; ++tap)
                    {
                        const int delay = std::max(
                            1, (int) std::round(roomFrames * tapRatios[tap] * channelSkew));
                        if (frame >= delay)
                        {
                            const double tapWeight = 1.0 - 0.16 * tap;
                            reflections += roomHistory[(size_t) (frame - delay)] * tapWeight;
                            weight += tapWeight;
                        }
                    }
                    reflections = weight > 0.0 ? reflections / weight : 0.0;
                    const double dampingCoefficient = 1.0 - tertiary * 0.97;
                    roomDamped += (reflections - roomDamped) * dampingCoefficient;
                    wet = roomDamped;
                    roomHistory[(size_t) frame] = (float) std::clamp(
                        dry + secondary * roomDamped,
                        -4.0,
                        4.0);
                }
                else if (processType == "frequency-shift")
                {
                    const double input = std::clamp(dry + secondary * frequencyFeedback, -2.0, 2.0);
                    frequencyHistory[(size_t) frame] = (float) input;
                    constexpr int center = 15;
                    double real = frame >= center
                        ? frequencyHistory[(size_t) (frame - center)]
                        : input;
                    double quadrature = 0.0;
                    for (int k = -center; k <= center; ++k)
                    {
                        if (k == 0 || (std::abs(k) & 1) == 0)
                            continue;
                        const int sourceFrame = frame - center - k;
                        if (sourceFrame < 0 || sourceFrame >= audio.getNumSamples())
                            continue;
                        const double window = 0.54
                            + 0.46 * std::cos(juce::MathConstants<double>::pi * k / center);
                        quadrature += frequencyHistory[(size_t) sourceFrame]
                            * (2.0 / (juce::MathConstants<double>::pi * k)) * window;
                    }
                    const double stereoScale = audio.getNumChannels() > 1
                        ? ((ch & 1) ? 1.0 + tertiary * 0.5 : 1.0 - tertiary * 0.5)
                        : 1.0;
                    const double phase = juce::MathConstants<double>::twoPi
                        * primary * stereoScale * (double) frame / sampleRate;
                    wet = real * std::cos(phase) - quadrature * std::sin(phase);
                    frequencyFeedback = wet;
                }
                else if (processType == "chorus")
                {
                    const double phaseOffset = audio.getNumChannels() > 1 && (ch & 1)
                        ? juce::MathConstants<double>::halfPi * quinary
                        : 0.0;
                    const double lfo = std::sin(
                        juce::MathConstants<double>::twoPi * primary * (double) frame / sampleRate
                        + phaseOffset);
                    const double delayMs = std::max(0.1, tertiary + secondary * (0.5 + 0.5 * lfo));
                    const double readPosition = (double) frame - delayMs * sampleRate / 1000.0;
                    double delayed = 0.0;
                    if (readPosition >= 0.0)
                    {
                        const int lower = (int) std::floor(readPosition);
                        const int upper = std::min(lower + 1, frame);
                        const double fraction = readPosition - lower;
                        delayed = chorusHistory[(size_t) lower]
                            + (chorusHistory[(size_t) upper] - chorusHistory[(size_t) lower]) * fraction;
                    }
                    chorusDark += 0.38 * (delayed - chorusDark);
                    wet = chorusDark;
                    chorusHistory[(size_t) frame] = (float) std::clamp(
                        dry + quaternary * wet,
                        -3.0,
                        3.0);
                }
                else if (processType == "dj-eq")
                {
                    const double lowCoefficient = 1.0 - std::exp(
                        -juce::MathConstants<double>::twoPi * 250.0 / sampleRate);
                    const double highCoefficient = 1.0 - std::exp(
                        -juce::MathConstants<double>::twoPi * 2500.0 / sampleRate);
                    djLow += lowCoefficient * (dry - djLow);
                    djBelowHigh += highCoefficient * (dry - djBelowHigh);
                    const double lowBand = djLow;
                    const double highBand = dry - djBelowHigh;
                    const double midBand = djBelowHigh - djLow;
                    wet = lowBand * std::pow(10.0, primary / 20.0)
                        + midBand * std::pow(10.0, secondary / 20.0)
                        + highBand * std::pow(10.0, tertiary / 20.0);
                }
                else if (processType == "tone")
                {
                    const double cutoff = std::min(primary, sampleRate * 0.45);
                    const double g = std::tan(juce::MathConstants<double>::pi * cutoff / sampleRate);
                    const double k = 2.0 - secondary * 1.95;
                    const double driven = std::tanh(dry * tertiary) / std::tanh(tertiary);
                    const double v3 = driven - toneIc2;
                    const double v1 = (toneIc1 + g * v3) / (1.0 + g * (g + k));
                    const double v2 = toneIc2 + g * v1;
                    toneIc1 = 2.0 * v1 - toneIc1;
                    toneIc2 = 2.0 * v2 - toneIc2;
                    wet = v2;
                }
                samples[frame] = (float) std::clamp(
                    (dry + (wet - dry) * mix) * processOutputGain,
                    -1.0,
                    1.0);
            }
        }

        auto file = juce::File(outputPath);
        if (!file.getParentDirectory().createDirectory() && !file.getParentDirectory().isDirectory())
        {
            errorOut = "failed to create Shape Process output directory";
            return false;
        }
        file.deleteFile();
        juce::WavAudioFormat wav;
        std::unique_ptr<juce::FileOutputStream> stream(file.createOutputStream());
        if (stream == nullptr)
        {
            errorOut = "failed to open Shape Process output: " + outputPath;
            return false;
        }
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wav.createWriterFor(stream.get(), sampleRate, (unsigned int) audio.getNumChannels(), 32, {}, 0));
        if (writer == nullptr)
        {
            errorOut = "failed to create Shape Process float WAV writer";
            return false;
        }
        stream.release();
        if (!writer->writeFromAudioSampleBuffer(audio, 0, audio.getNumSamples()))
        {
            writer.reset();
            file.deleteFile();
            errorOut = "failed while writing Shape Process output";
            return false;
        }
        writer.reset();
        infoOut.durationSec = (double) audio.getNumSamples() / sampleRate;
        infoOut.sampleRate = sampleRate;
        infoOut.frames = audio.getNumSamples();
        infoOut.channels = audio.getNumChannels();
        return true;
    }

    bool renderShapeStemToWav(
        const std::vector<ShapeRenderSource>& sources,
        double sourceBarLength,
        double targetBpm,
        double loopBars,
        const std::vector<ShapeRenderSegment>& segments,
        const juce::String& outputPath,
        ShapeRenderInfo& infoOut,
        juce::String& errorOut)
    {
        if (sources.empty() || !finitePositive(sourceBarLength)
            || !finitePositive(targetBpm) || !finitePositive(loopBars))
        {
            errorOut = "invalid Shape timing metadata";
            return false;
        }

        struct DecodedSource
        {
            juce::AudioBuffer<float> audio;
            double durationSec = 0.0;
            double barLength = 0.0;
            int musicalFrames = 0;
            bool alreadySewn = false;
        };
        std::vector<DecodedSource> decoded;
        decoded.reserve(sources.size());
        double sampleRate = 0.0;
        int channels = 0;
        for (const auto& sourceSpec : sources)
        {
            const double itemBarLength = finitePositive(sourceSpec.barLength)
                ? sourceSpec.barLength
                : sourceBarLength;
            if (!finitePositive(sourceSpec.durationSec) || !finitePositive(itemBarLength))
            {
                errorOut = "invalid Shape source duration";
                return false;
            }
            DecodedSource item;
            double itemRate = 0.0;
            if (!decodeRawAudioFile(sourceSpec.path, item.audio, itemRate))
            {
                errorOut = "failed to decode Shape source: " + sourceSpec.path;
                return false;
            }
            if (!finitePositive(itemRate) || item.audio.getNumSamples() <= 0
                || item.audio.getNumChannels() <= 0)
            {
                errorOut = "Shape source decoded to an empty buffer: " + sourceSpec.path;
                return false;
            }
            if (decoded.empty())
            {
                sampleRate = itemRate;
                channels = item.audio.getNumChannels();
            }
            else if (std::abs(itemRate - sampleRate) > 1.0e-6
                || item.audio.getNumChannels() != channels)
            {
                errorOut = "Shape transformed sources do not share an audio format";
                return false;
            }
            const double decodedDurationSec = (double) item.audio.getNumSamples() / itemRate;
            const double durationToleranceSec = std::max(0.05, sourceSpec.durationSec * 0.02);
            if (std::abs(decodedDurationSec - sourceSpec.durationSec) > durationToleranceSec)
            {
                errorOut = "Shape source duration does not match decoded audio";
                return false;
            }
            item.durationSec = sourceSpec.durationSec;
            item.barLength = itemBarLength;
            item.musicalFrames = (int) std::llround(sourceSpec.durationSec * itemRate);
            if (item.musicalFrames <= 0 || item.musicalFrames > item.audio.getNumSamples())
            {
                errorOut = "Shape musical source length exceeds decoded audio";
                return false;
            }
            item.alreadySewn = sourceSpec.path.endsWithIgnoreCase(".shape.wav")
                || sourceSpec.path.endsWithIgnoreCase(".shape-preview.wav");
            decoded.push_back(std::move(item));
        }

        const double secPerBar = 240.0 / targetBpm;
        const double exactFrames = loopBars * secPerBar * sampleRate;
        if (!std::isfinite(exactFrames) || exactFrames <= 0.0
            || exactFrames > (double) std::numeric_limits<int>::max())
        {
            errorOut = "invalid Shape output length";
            return false;
        }
        const int frames = (int) std::ceil(exactFrames);
        juce::AudioBuffer<float> output(channels, frames);
        output.clear();
        std::vector<std::pair<int, int>> tiledSourceSeams;
        int outputTailStartFrame = 0;
        const bool hasAudioAtLoopStart =
            !segments.empty() && std::abs(segments.front().destStartBars) <= kEps;
        const bool hasAudioAtLoopEnd = !segments.empty()
            && std::abs(
                segments.back().destStartBars
                + segments.back().sourceEndBars
                - segments.back().sourceStartBars
                - loopBars) <= kEps;

        double previousEnd = -1.0;
        for (const auto& segment : segments)
        {
            if (!std::isfinite(segment.sourceStartBars)
                || !std::isfinite(segment.sourceEndBars)
                || !std::isfinite(segment.destStartBars)
                || segment.sourceStartBars < 0.0
                || segment.sourceEndBars <= segment.sourceStartBars + kEps
                || segment.destStartBars < 0.0
                || segment.sourceIndex < 0
                || segment.sourceIndex >= (int) decoded.size())
            {
                errorOut = "invalid Shape fragment coordinates";
                return false;
            }
            const double lengthBars = segment.sourceEndBars - segment.sourceStartBars;
            const double destEndBars = segment.destStartBars + lengthBars;
            if (destEndBars > loopBars + kEps || segment.destStartBars < previousEnd - kEps)
            {
                errorOut = "overlapping or out-of-range Shape fragments";
                return false;
            }
            previousEnd = destEndBars;
            const auto& source = decoded[(size_t) segment.sourceIndex];
            const double segmentSourceBarLength = source.barLength;

            const int destStart = std::max(0, (int) std::llround(segment.destStartBars * secPerBar * sampleRate));
            const bool reachesOutputEnd = std::abs(destEndBars - loopBars) <= kEps;
            // The buffer is ceil-sized so fractional musical durations have
            // room for their final sample. A fragment that reaches the
            // musical loop edge owns that final frame even when round(exact)
            // is one smaller than ceil(exact).
            const int destEnd = reachesOutputEnd
                ? frames
                : std::min(frames, (int) std::llround(destEndBars * secPerBar * sampleRate));
            const int segmentFrames = destEnd - destStart;
            if (segmentFrames <= 0)
            {
                errorOut = "Shape fragment is shorter than one output sample";
                return false;
            }
            const int fadeFrames = std::min(
                segmentFrames / 2,
                std::max(1, (int) std::llround(kEdgeFadeSec * sampleRate)));
            // Preserve an untouched lane sample-for-sample. The playback
            // engine already sews the outer loop boundary; Shape only adds
            // a declick fade at a newly-created INTERNAL discontinuity.
            const bool fadeIn = segment.destStartBars > kEps || !hasAudioAtLoopEnd;
            const bool fadeOut = destEndBars < loopBars - kEps || !hasAudioAtLoopStart;

            // Ordinary playback loop-sews every source tile once. Record
            // the same internal wrap points here so a short source repeated
            // inside a longer Shape lane cannot acquire new clicks.
            int sourceTileStartFrame = destStart;
            double sourceWrap = segment.reversed
                ? std::floor((segment.sourceEndBars - kEps) / segmentSourceBarLength) * segmentSourceBarLength
                : (std::floor(segment.sourceStartBars / segmentSourceBarLength) + 1.0) * segmentSourceBarLength;
            const auto hasAnotherWrap = [&]() {
                return segment.reversed
                    ? sourceWrap > segment.sourceStartBars + kEps
                    : sourceWrap < segment.sourceEndBars - kEps;
            };
            while (hasAnotherWrap())
            {
                const double wrapDestBars = segment.reversed
                    ? segment.destStartBars + segment.sourceEndBars - sourceWrap
                    : segment.destStartBars + sourceWrap - segment.sourceStartBars;
                const int wrapFrame =
                    (int) std::llround(wrapDestBars * secPerBar * sampleRate);
                if (wrapFrame > destStart && wrapFrame < destEnd)
                {
                    if (!source.alreadySewn)
                        tiledSourceSeams.push_back({ wrapFrame, wrapFrame - sourceTileStartFrame });
                    sourceTileStartFrame = wrapFrame;
                }
                sourceWrap += segment.reversed ? -segmentSourceBarLength : segmentSourceBarLength;
            }
            if (reachesOutputEnd)
                outputTailStartFrame = sourceTileStartFrame;

            for (int i = 0; i < segmentFrames; ++i)
            {
                const double localBars = (double) i / (sampleRate * secPerBar);
                const double sampleBars = 1.0 / (sampleRate * secPerBar);
                const double sourcePosition = segment.reversed
                    ? segment.sourceEndBars - sampleBars - localBars
                    : segment.sourceStartBars + localBars;
                double sourceBar = std::fmod(sourcePosition, segmentSourceBarLength);
                if (sourceBar < 0.0)
                    sourceBar += segmentSourceBarLength;
                // Match PlaybackEngine's nearest-sample policy exactly.
                // sourceDurationSec is the app's true musical tile length;
                // decoded files may contain a small codec-padding tail that
                // ordinary playback intentionally never schedules.
                const double sourceTimeSec = sourceBar * (source.durationSec / segmentSourceBarLength);
                int sourceSample = (int) std::llround(sourceTimeSec * sampleRate);
                if (sourceSample == source.musicalFrames)
                    sourceSample = 0;
                if (sourceSample < 0 || sourceSample >= source.musicalFrames)
                {
                    errorOut = "Shape fragment reads outside decoded source audio";
                    return false;
                }

                float gain = 1.0f;
                if (fadeIn && i < fadeFrames)
                    gain *= (float) i / (float) fadeFrames;
                const int fromEnd = segmentFrames - 1 - i;
                if (fadeOut && fromEnd < fadeFrames)
                    gain *= (float) fromEnd / (float) fadeFrames;
                for (int ch = 0; ch < channels; ++ch)
                    output.setSample(ch, destStart + i, source.audio.getSample(ch, sourceSample) * gain);
            }
        }

        for (const auto& seam : tiledSourceSeams)
            healShapeSeam(output, seam.first, seam.first, seam.second);
        // The materialized file is marked as already sewn (StemBufferCache
        // recognizes Shape's private suffixes), so heal its outer loop once
        // here as well. This keeps preview and committed playback identical.
        bool outerBoundaryAlreadySewn = false;
        if (hasAudioAtLoopStart && hasAudioAtLoopEnd
            && segments.front().sourceIndex == segments.back().sourceIndex
            && decoded[(size_t) segments.front().sourceIndex].alreadySewn)
        {
            const auto& first = segments.front();
            const auto& last = segments.back();
            const double boundaryBarLength = decoded[(size_t) first.sourceIndex].barLength;
            const double firstBoundary = first.reversed ? first.sourceEndBars : first.sourceStartBars;
            const double lastBoundary = last.reversed ? last.sourceStartBars : last.sourceEndBars;
            double phaseDifference = std::fmod(lastBoundary - firstBoundary, boundaryBarLength);
            if (phaseDifference < 0.0)
                phaseDifference += boundaryBarLength;
            outerBoundaryAlreadySewn = phaseDifference <= kEps
                || std::abs(phaseDifference - boundaryBarLength) <= kEps;
        }
        if (hasAudioAtLoopStart && hasAudioAtLoopEnd && !outerBoundaryAlreadySewn)
        {
            healShapeSeam(output, frames, 0, frames - outputTailStartFrame);
        }

        auto file = juce::File(outputPath);
        if (!file.getParentDirectory().createDirectory() && !file.getParentDirectory().isDirectory())
        {
            errorOut = "failed to create Shape output directory";
            return false;
        }
        file.deleteFile();
        juce::WavAudioFormat wav;
        std::unique_ptr<juce::FileOutputStream> stream(file.createOutputStream());
        if (stream == nullptr)
        {
            errorOut = "failed to open Shape output: " + outputPath;
            return false;
        }
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wav.createWriterFor(stream.get(), sampleRate, (unsigned int) channels, 32, {}, 0));
        if (writer == nullptr)
        {
            errorOut = "failed to create Shape float WAV writer";
            return false;
        }
        stream.release();
        if (!writer->writeFromAudioSampleBuffer(output, 0, frames))
        {
            writer.reset();
            file.deleteFile();
            errorOut = "failed while writing Shape output";
            return false;
        }
        writer.reset();

        infoOut.durationSec = (double) frames / sampleRate;
        infoOut.sampleRate = sampleRate;
        infoOut.frames = frames;
        infoOut.channels = channels;
        return true;
    }
}

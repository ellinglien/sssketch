// native-engine/Source/StemBufferCache.h
#pragma once
#include <juce_audio_formats/juce_audio_formats.h>
#include <unordered_map>
#include <memory>

namespace ssstitch
{
    /** Decodes the file at `path` into `bufferOut`/`sampleRateOut` with NO
     * further processing — deliberately separate from StemBufferCache::load,
     * which additionally applies the loop-sewing declick blend. BakeStem.cpp
     * uses this instead of the cache for exactly that reason: baking needs
     * the source's raw, unmodified samples to rotate, since the rotated
     * (baked) output gets its OWN loop-sewing blend anyway the next time
     * StemBufferCache::load reads it back in for real playback — going
     * through the blending load() here first, before baking, was double-
     * applying the blend under two different (and generally unrelated)
     * window/target choices, which could visibly reshape real content
     * rather than just resolving a discontinuity. Returns false (leaving
     * the outputs unspecified) if the file can't be read or decoded. */
    bool decodeRawAudioFile(
        const juce::String& path, juce::AudioBuffer<float>& bufferOut, double& sampleRateOut);

    /** buffer is nullptr (sampleRate the unused default) if the path was never
     * successfully loaded. */
    struct StemBufferEntry
    {
        const juce::AudioBuffer<float>* buffer = nullptr;
        double sampleRate = 44100.0;
    };

    /** Decodes whole audio files into memory and caches them by absolute path,
     * so the real-time mixer never blocks on file I/O. Not thread-safe for
     * concurrent load() calls from multiple threads — load-project happens on
     * the message thread before playback starts, matching how AudioEngine.ts's
     * loadBuffer calls happen before scheduling, not from the audio thread. */
    class StemBufferCache
    {
    public:
        /** Loads and decodes the file at `path` if not already cached. Returns
         * false (and leaves the cache untouched) if the file can't be read or
         * decoded — mirrors AudioEngine.ts's per-stem try/catch failure
         * isolation, so one bad stem doesn't block loading the rest.
         *
         * `trueDurationSec`, when positive, is the stem's own known real
         * duration (EngineStem::durationSec) — used as the loop-sewing
         * blend's actual loop-end point instead of the raw decoded buffer's
         * full length, since those two can differ (a LORE-sourced stem's
         * durationSec is metadata-derived — bars × tempo — not measured
         * from the real Ogg Vorbis audio; see LoopSewing.h's own doc
         * comment on why blending at the wrong point leaves the real,
         * played seam completely untouched). Ignored (falls back to the
         * buffer's own full length) if <= 0, or if converting it to a
         * sample count would exceed the buffer's actual length. */
        bool load(const juce::String& path, double trueDurationSec = -1.0);

        /** Returns the cached buffer for `path`, or nullptr if never
         * successfully loaded. */
        const juce::AudioBuffer<float>* get(const juce::String& path) const;

        double sampleRateFor(const juce::String& path) const;

        /** Combined form of get() + sampleRateFor() for callers (renderBlock's
         * hot path) that need both — a single hash lookup and a single
         * juce::String::toStdString() allocation instead of two of each for
         * the same path. */
        StemBufferEntry getEntry(const juce::String& path) const;

    private:
        struct Entry
        {
            juce::AudioBuffer<float> buffer;
            double sampleRate = 44100.0;
        };
        std::unordered_map<std::string, Entry> cache;
    };
}

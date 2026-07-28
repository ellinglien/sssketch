// native-engine/Source/StemBufferCache.h
#pragma once
#include <juce_audio_formats/juce_audio_formats.h>
#include <unordered_map>
#include <memory>

namespace ssstitch
{
    /** Decodes whole audio files into memory and caches them by absolute path,
     * so the real-time mixer never blocks on file I/O. Not thread-safe for
     * concurrent load() calls from multiple threads — load-project happens on
     * the message thread before playback starts, matching how AudioEngine.ts's
     * loadBuffer calls happen before scheduling, not from the audio thread. */
    class StemBufferCache
    {
    public:
        StemBufferCache();

        /** Loads and decodes the file at `path` if not already cached. Returns
         * false (and leaves the cache untouched) if the file can't be read or
         * decoded — mirrors AudioEngine.ts's per-stem try/catch failure
         * isolation, so one bad stem doesn't block loading the rest. */
        bool load(const juce::String& path);

        /** Returns the cached buffer for `path`, or nullptr if never
         * successfully loaded. */
        const juce::AudioBuffer<float>* get(const juce::String& path) const;

        double sampleRateFor(const juce::String& path) const;

    private:
        juce::AudioFormatManager formatManager;
        struct Entry
        {
            juce::AudioBuffer<float> buffer;
            double sampleRate = 44100.0;
        };
        std::unordered_map<std::string, Entry> cache;
    };
}

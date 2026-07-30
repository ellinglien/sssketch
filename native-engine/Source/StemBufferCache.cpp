// native-engine/Source/StemBufferCache.cpp
#include "StemBufferCache.h"

namespace ssstitch
{
    StemBufferCache::StemBufferCache()
    {
        // WAV, AIFF, Ogg Vorbis (default JUCE_USE_OGGVORBIS=1), etc. Endlesss's own
        // native export is WAV; LORE-cached stems (see the LORE library browser
        // feature) are Ogg Vorbis — both load through this same reader, no
        // format-specific code needed anywhere downstream.
        formatManager.registerBasicFormats();
    }

    bool StemBufferCache::load(const juce::String& path)
    {
        const auto key = path.toStdString();
        if (cache.find(key) != cache.end())
            return true;

        juce::File file(path);
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr)
            return false;

        Entry entry;
        entry.sampleRate = reader->sampleRate;
        entry.buffer.setSize((int) reader->numChannels, (int) reader->lengthInSamples);
        if (!reader->read(&entry.buffer, 0, (int) reader->lengthInSamples, 0, true, true))
            return false;

        cache.emplace(key, std::move(entry));
        return true;
    }

    const juce::AudioBuffer<float>* StemBufferCache::get(const juce::String& path) const
    {
        auto it = cache.find(path.toStdString());
        return it == cache.end() ? nullptr : &it->second.buffer;
    }

    double StemBufferCache::sampleRateFor(const juce::String& path) const
    {
        auto it = cache.find(path.toStdString());
        return it == cache.end() ? 44100.0 : it->second.sampleRate;
    }

    StemBufferEntry StemBufferCache::getEntry(const juce::String& path) const
    {
        auto it = cache.find(path.toStdString());
        if (it == cache.end())
            return {};
        return { &it->second.buffer, it->second.sampleRate };
    }
}

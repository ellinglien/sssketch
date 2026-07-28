// native-engine/Source/StemBufferCache.cpp
#include "StemBufferCache.h"

namespace ssstitch
{
    StemBufferCache::StemBufferCache()
    {
        formatManager.registerBasicFormats(); // WAV, AIFF, etc. — Endlesss stems are WAV
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
        reader->read(&entry.buffer, 0, (int) reader->lengthInSamples, 0, true, true);

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
}

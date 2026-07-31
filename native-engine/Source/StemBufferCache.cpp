// native-engine/Source/StemBufferCache.cpp
#include "StemBufferCache.h"
#include "LoopSewing.h"

namespace ssstitch
{
    bool decodeRawAudioFile(
        const juce::String& path, juce::AudioBuffer<float>& bufferOut, double& sampleRateOut)
    {
        juce::File file(path);
        if (!file.existsAsFile())
            return false;

        // Deliberately NOT the File-based createReaderFor(file) overload: that
        // one first checks the file's extension against each registered
        // format's known extensions (AudioFormat::canHandleFile) and only
        // attempts to decode if one matches. LORE-cached stems (see the LORE
        // library browser feature) have no file extension at all — the path
        // is just the raw StemCID — so extension-based lookup always failed
        // for them even though the content is perfectly valid, readable Ogg
        // Vorbis. This stream-based overload skips the extension check
        // entirely and tries every registered format's own content-sniffing
        // reader directly against the actual bytes, which works regardless
        // of the file's name. A nonexistent/unreadable file still yields no
        // reader here (every format's own header parse fails on empty/absent
        // content), so the existing "returns false for a missing file"
        // contract is unchanged.
        juce::AudioFormatManager manager;
        manager.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> reader(
            manager.createReaderFor(std::make_unique<juce::FileInputStream>(file)));
        if (reader == nullptr)
            return false;

        sampleRateOut = reader->sampleRate;
        bufferOut.setSize((int) reader->numChannels, (int) reader->lengthInSamples);
        return reader->read(&bufferOut, 0, (int) reader->lengthInSamples, 0, true, true);
    }

    bool StemBufferCache::load(const juce::String& path)
    {
        const auto key = path.toStdString();
        if (cache.find(key) != cache.end())
            return true;

        Entry entry;
        if (!decodeRawAudioFile(path, entry.buffer, entry.sampleRate))
            return false;

        // Every stem this app plays is loop-eligible content by nature (see
        // LoopSewing.h's own doc comment) — blending the buffer's own tail
        // toward its head ONCE here, rather than per-block in renderBlock,
        // means every tiled repeat downstream is automatically click-free
        // with zero changes needed to the real-time render path itself.
        // The window itself adapts to how bassy the seam sounds (see
        // adaptiveLoopSewingWindow's own doc comment) rather than using one
        // fixed size for every stem.
        const int window = adaptiveLoopSewingWindow(entry.buffer, 512, 2048, entry.sampleRate);
        applyLoopSewingBlend(entry.buffer, window);

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

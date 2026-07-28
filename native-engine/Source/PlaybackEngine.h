// native-engine/Source/PlaybackEngine.h
#pragma once
#include "EngineProject.h"
#include "StemBufferCache.h"
#include <juce_audio_basics/juce_audio_basics.h>

namespace ssstitch
{
    class PlaybackEngine
    {
    public:
        explicit PlaybackEngine(StemBufferCache& bufferCache);

        /** Replaces the current project. Loads every stem's audio into
         * bufferCache up front (mirrors AudioEngine.ts loading buffers before
         * scheduling) — a stem whose file fails to load is silently skipped
         * during rendering, not fatal to the whole project, matching
         * AudioEngine.ts's per-stem try/catch. */
        void setProject(const EngineProject& project);

        /** Renders numSamples of stereo output starting at absolute transport
         * position positionBars, into outL/outR (each numSamples long, must be
         * pre-zeroed by the caller — this function adds into them). Pure/
         * deterministic: the same project + position + sampleRate + numSamples
         * always produces the same output, with no hidden state carried between
         * calls — safe to call repeatedly out of order (as the parity test
         * does) or from a real-time callback (as a later task does). */
        void renderBlock(
            double positionBars,
            double sampleRate,
            int numSamples,
            float* outL,
            float* outR) const;

        double secPerBar() const { return currentProject.bpm > 0.0 ? (60.0 / currentProject.bpm) * 4.0 : 0.0; }

    private:
        StemBufferCache& bufferCache;
        EngineProject currentProject;
    };
}

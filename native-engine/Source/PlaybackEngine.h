// native-engine/Source/PlaybackEngine.h
#pragma once
#include "EngineProject.h"
#include "StemBufferCache.h"
#include "ChannelChainRegistry.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <map>

namespace sssketch
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
         * pre-zeroed by the caller — this function adds into them).
         * channelChains provides each channel's own 2-slot plugin chain (see
         * docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md)
         * -- a channel with no chain currently published (chainFor returns
         * nullptr) is a pure passthrough, identical to the pre-this-feature
         * direct-sum behaviour. Otherwise pure/deterministic given the same
         * channelChains state: no hidden state carried between calls on
         * PlaybackEngine's own side — safe to call repeatedly out of order
         * (as the parity test does) or from a real-time callback. */
        void renderBlock(
            double positionBars,
            double sampleRate,
            int numSamples,
            float* outL,
            float* outR,
            ChannelChainRegistry& channelChains) const;

        double secPerBar() const { return currentProject.bpm > 0.0 ? (60.0 / currentProject.bpm) * 4.0 : 0.0; }

        /** Read-only access to the project most recently passed to setProject(),
         * for the render-export IPC handler to render "whatever was last
         * loaded" without inventing a second way to pass project data. */
        const EngineProject& currentProjectForExport() const { return currentProject; }

        /** Toggled by the 'set-metronome' IPC message — off by default, so a
         * freshly-constructed engine (including RenderExport's own, offline)
         * never includes the click unless explicitly turned on. Live
         * playback and offline export share this same renderBlock, but
         * export always uses its own fresh PlaybackEngine instance (see
         * RenderExport.cpp), so this defaulting to false there is automatic
         * — the metronome is a practice aid, not part of the actual mix. */
        void setMetronomeEnabled(bool enabled) { metronomeEnabled = enabled; }
        bool isMetronomeEnabled() const { return metronomeEnabled; }

    private:
        StemBufferCache& bufferCache;
        EngineProject currentProject;
        bool metronomeEnabled = false;
        // Precomputed once per setProject() call (not per block) -- groups
        // currentProject.rifffs by channelId. Pointers into currentProject's
        // OWN vector<EngineRifff>, valid until the next setProject() call
        // rebuilds both together.
        std::map<juce::String, std::vector<const EngineRifff*>> channelGroups;
    };
}

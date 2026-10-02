// native-engine/Source/RenderExport.h
#pragma once
#include "EngineProject.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>

namespace sssketch
{
    /** The render itself, to floats: `project` from bar 0 for `durationBars`, at `sampleRate`
     * in blocks of `blockSize`, through renderBlock, the master plugin chain and
     * PlaybackEngine::processMaster (the radio sound's master stage) -- the same calls, in the
     * same order, as Transport's device callback. `out` is resized to 2 channels of
     * ceil(durationBars * secPerBar * sampleRate) samples. False (errorOut set) for an invalid
     * bpm or a plugin that fails to load. renderProjectToWavFile renders through this at 44.1
     * kHz / 512; tests compare it with the live path sample for sample. */
    bool renderProjectToBuffer(
        const EngineProject& project,
        double durationBars,
        double sampleRate,
        int blockSize,
        juce::AudioBuffer<float>& out,
        juce::String& errorOut);

    /** The file a render writes. 16-bit PCM is the mixdown's (it has been through the master
     * stage, limiter included, so it cannot exceed full scale). 32-bit float is for the PER-STEM
     * renders -- toolkit bakes, stem/bus/track exports (native radio sound plan, Task 4 review):
     * those drop the master stages, and a panned row's near side is LOUDER than its source
     * (StemPan.h: +2.8 dB for a mono stem at the default 0.25), which 16 bits would hard-clip.
     * Float keeps the overs for the DAW's own gain staging. */
    enum class WavSampleFormat
    {
        pcm16,
        float32
    };

    /** Renders `project` offline to a stereo WAV (16-bit unless `format` says float) at `outputPath`, covering
     * `durationBars` bars from position 0, including the project's own master
     * plugin chain (see EngineProject::masterChain) processed in series over
     * each rendered block — matches live playback exactly. Returns false (with
     * errorOut set) on any failure — invalid bpm, can't open the output path,
     * can't create the WAV writer, or a master-chain plugin failing to load
     * (see PluginChain::loadPluginSync). Shared by --render-test (Main.cpp) and
     * the render-export IPC message (IpcServer.cpp) — exactly one
     * implementation of "render this project to this file." */
    bool renderProjectToWavFile(
        const EngineProject& project,
        const juce::String& outputPath,
        double durationBars,
        juce::String& errorOut,
        WavSampleFormat format = WavSampleFormat::pcm16);
}

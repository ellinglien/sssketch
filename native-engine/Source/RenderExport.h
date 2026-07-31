// native-engine/Source/RenderExport.h
#pragma once
#include "EngineProject.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    /** Renders `project` offline to a 16-bit stereo WAV at `outputPath`, covering
     * `durationBars` bars from position 0, including the project's own master
     * plugin chain (see EngineProject::masterChain) processed in series over
     * each rendered block — matches live playback exactly. Returns false (with
     * errorOut set) on any failure — invalid bpm, can't open the output path,
     * can't create the WAV writer, or a master-chain plugin failing to load
     * (see MasterChain::loadPluginSync). Shared by --render-test (Main.cpp) and
     * the render-export IPC message (IpcServer.cpp) — exactly one
     * implementation of "render this project to this file." */
    bool renderProjectToWavFile(
        const EngineProject& project,
        const juce::String& outputPath,
        double durationBars,
        juce::String& errorOut);
}

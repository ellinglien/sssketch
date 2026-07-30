// native-engine/Source/BakeStem.h
#pragma once
#include <juce_core/juce_core.h>

namespace ssstitch
{
    /** Decodes `sourcePath` (any format StemBufferCache can read — WAV, Ogg
     * Vorbis, etc.), circularly rotates it so the sample at `rotationSec`
     * becomes sample 0 (wrapping around, same semantics as the renderer's own
     * JS-side rotateBuffer used for BeatPicker's preview), and writes the
     * result as a 16-bit WAV to `outputPath` (parent directories created if
     * needed). Used for LORE-sourced (Ogg) stems specifically — those are
     * never rewritten in place (see bakeOffset.ts's own doc comment on why),
     * so "baking" one means decoding+rotating+writing a fresh WAV copy
     * elsewhere rather than the Node-side raw WAV-byte rotation
     * (rotateWav.ts) a regular WAV import already uses. Returns false (with
     * `errorOut` set) on any failure — bad source path, undecodable content,
     * or an unwritable output path — never throws. */
    bool bakeStemToWav(
        const juce::String& sourcePath,
        double rotationSec,
        const juce::String& outputPath,
        juce::String& errorOut);
}

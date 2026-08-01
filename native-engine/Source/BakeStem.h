// native-engine/Source/BakeStem.h
#pragma once
#include <juce_core/juce_core.h>

namespace sssketch
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
    /** `durationSecOut` receives the baked file's own real, measured
     * duration (numSamples / sampleRate of the DECODED source, which the
     * rotation preserves exactly) — the caller must report this back to the
     * renderer rather than trusting whatever duration metadata it already
     * had for the pre-bake source. That metadata is derived from the LORE
     * database (BPM/Length16s), not measured from the actual audio, and can
     * disagree with Ogg Vorbis's real decoded sample count by enough to
     * misalign the native engine's own tile-boundary scheduling once this
     * baked WAV is playing — heard as clicking/stuttering at tile
     * boundaries, the exact class of bug buildEngineProject.ts's own
     * "resolved duration, not stem.durationSec" fix already exists for on
     * the tempo-stretch path. */
    bool bakeStemToWav(
        const juce::String& sourcePath,
        double rotationSec,
        const juce::String& outputPath,
        double& durationSecOut,
        juce::String& errorOut);
}

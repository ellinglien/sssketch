// src/shared/glyphBands.ts
//
// A stem's glyph rings and pitch line, at the resolution they are drawn at, so
// they can be persisted per stem (main/stemGlyphCacheStore.ts) and a project
// open stops decoding every stem again just to draw them (background scan
// audit 8(b), plan 2026-10-05-merge-background-scans decision 12).
import { downsample } from './visuals'
import type { BandEnergy } from './bandEnergy'
import type { PitchContour } from './pitchContour'

/** PolarGlyph draws each band ring with polarGlyph(..., 16), which reads
 * downsample(band, 16). downsample of a 16-element array to 16 is the
 * identity (each output bucket is exactly one input element, divided by 1),
 * so 16 points per band draw exactly the glyph the full per-frame arrays do
 * -- proven over random lengths in glyphBands.test.ts. */
export const GLYPH_BAND_POINTS = 16

export interface GlyphBands {
  bass: number[]
  mid: number[]
  treble: number[]
}

/** The glyph-resolution read of a band-energy pass. Plain numbers, so it
 * survives JSON and structured clone unchanged. */
export function glyphBandsFrom(be: BandEnergy): GlyphBands {
  return {
    bass: downsample(Array.from(be.bass), GLYPH_BAND_POINTS),
    mid: downsample(Array.from(be.mid), GLYPH_BAND_POINTS),
    treble: downsample(Array.from(be.treble), GLYPH_BAND_POINTS)
  }
}

/** A pitch contour as persisted: every frame (polarPitchLine and
 * linearPitchLine both draw every frame), Float32, ~2.8 KB for a 16 s stem. */
export interface PersistedPitch {
  numFrames: number
  bytes: Uint8Array
}

/** What the persisted glyph cache holds for one stem: either half may be
 * missing (each is written when it is first computed). */
export interface StemGlyphCacheEntry {
  bands: GlyphBands | null
  pitch: PersistedPitch | null
}

/** A write: only the halves given are replaced. */
export interface StemGlyphCacheWrite {
  bands?: GlyphBands
  pitch?: PersistedPitch
}

/** The contour's frames as bytes -- a copy, never a view of `freqHz`. */
export function pitchContourToBytes(freqHz: Float32Array): Uint8Array {
  return new Uint8Array(freqHz.slice().buffer)
}

/** Back to a contour. `bytes` may be a Node Buffer at any offset (copied
 * into an aligned Float32Array, never viewed in place). Null when the byte
 * count doesn't match `numFrames`. */
export function pitchContourFromBytes(bytes: Uint8Array, numFrames: number): PitchContour | null {
  if (!Number.isInteger(numFrames) || numFrames < 0 || bytes.byteLength !== numFrames * 4) {
    return null
  }
  const copy = new Uint8Array(numFrames * 4)
  copy.set(bytes)
  return { numFrames, freqHz: new Float32Array(copy.buffer) }
}

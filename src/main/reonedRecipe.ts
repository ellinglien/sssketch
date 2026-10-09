// The name of a re-oned stem copy (`<library>/.bakes/<name>`): a hash of exactly what the baker
// needs to reproduce its bytes. See docs/superpowers/specs/2026-10-09-reoned-copies-cleanup-design.md.
// No better-sqlite3 and no electron here: imported by bakeOffset.ts, reonedRebuild.ts and tests.
import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { sampleRateFromHeader } from '@shared/audioHeaderSampleRate'

/** Bump whenever the baker's output for the same inputs changes: rotateWav.ts's rotation or
 * seam blend, LOOP_SEW_WINDOW_FRAMES, BakeStem.cpp's decode or bit depth, bakeOffset.ts's
 * blend-once rule. Old copies are then never reused; cleanup clears them once unused.
 * bakeOffset.test.ts pins one WAV bake's and one native bake's bytes per version (GOLDEN_BAKES):
 * when it fails with "baker output changed", bump this and record the new hashes. */
export const BAKER_VERSION = 1

const HEADER_BYTES = 64 * 1024

export interface SourceIdentity {
  path: string
  size: number
  mtimeMs: number
}

export type RotationKey = { samples: number } | { seconds: number }

export function rotationKeyFor(rotationSec: number, sampleRate: number | null): RotationKey {
  return sampleRate
    ? { samples: Math.round(rotationSec * sampleRate) }
    : { seconds: Number(rotationSec.toFixed(6)) }
}

export function recipeName(
  source: SourceIdentity,
  rotation: RotationKey,
  bakerVersion: number = BAKER_VERSION
): string {
  const recipe = JSON.stringify([
    'sssketch-reone',
    bakerVersion,
    source.path,
    source.size,
    Math.trunc(source.mtimeMs),
    'samples' in rotation ? `s${rotation.samples}` : `t${rotation.seconds}`
  ])
  return `${createHash('sha256').update(recipe).digest('hex').slice(0, 32)}.baked.wav`
}

export interface ResolvedRecipe {
  sourcePath: string
  name: string
  /** What the baker is handed: quantised to whole frames when the rate is known, so two
   * rotations that name the same file also render the same bytes. */
  rotationSec: number
  rotationFrames: number | null
}

/** Reads the source's identity and header. Rejects when the source can't be read: the caller
 * decides whether that means "fall back" (a re-one) or "missing" (a rebuild). */
export async function resolveRecipe(
  sourcePath: string,
  rotationSec: number
): Promise<ResolvedRecipe> {
  const info = await stat(sourcePath)
  const handle = await open(sourcePath, 'r')
  let header: Uint8Array
  try {
    const buf = Buffer.alloc(Math.min(HEADER_BYTES, info.size))
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    header = new Uint8Array(buf.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
  const sampleRate = sampleRateFromHeader(header)
  const key = rotationKeyFor(rotationSec, sampleRate)
  return {
    sourcePath,
    name: recipeName({ path: sourcePath, size: info.size, mtimeMs: info.mtimeMs }, key),
    // Keyed in seconds (an unrecognised header), the baker gets those same rounded seconds, so
    // two rotations that share a name can't render a frame apart.
    rotationSec: 'samples' in key ? key.samples / sampleRate! : key.seconds,
    rotationFrames: 'samples' in key ? key.samples : null
  }
}

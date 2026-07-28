import { readFileSync, writeFileSync } from 'fs'
import { rotateWavFrames } from '@shared/rotateWav'
import { findWavChunks } from '@shared/wavChunks'

export interface BakeJob {
  path: string
  /** Where the true downbeat sits within this file's own audio, in seconds. */
  rotationSec: number
}

export interface BakeResult {
  /** The job's original path, so the renderer can map results back to stems. */
  path: string
  bakedPath: string
}

// Re-baking (picking a different beat after already baking once) rotates whatever
// is currently at `path`, which may itself already be a `.baked.wav` — write back
// to that same file rather than growing the filename further, so pristine.wav is
// always left untouched as an implicit original/backup no matter how many times
// baking is repeated.
function bakedPathFor(path: string): string {
  if (path.toLowerCase().endsWith('.baked.wav')) return path
  return path.replace(/\.wav$/i, '.baked.wav')
}

export function bakeOffset(jobs: BakeJob[]): BakeResult[] {
  const results: BakeResult[] = []
  for (const job of jobs) {
    try {
      const bytes = new Uint8Array(readFileSync(job.path))
      const { sampleRate } = findWavChunks(bytes)
      if (!sampleRate) {
        console.error(`bakeOffset: "${job.path}" has no usable fmt chunk, skipping`)
        continue
      }
      const rotationFrames = Math.round(job.rotationSec * sampleRate)
      const rotated = rotateWavFrames(bytes, rotationFrames)
      const bakedPath = bakedPathFor(job.path)
      writeFileSync(bakedPath, rotated)
      results.push({ path: job.path, bakedPath })
    } catch (err) {
      console.error(`bakeOffset: failed to bake "${job.path}":`, err)
    }
  }
  return results
}

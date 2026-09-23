import { describe, expect, it, vi } from 'vitest'
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppState } from '../renderer/src/state/store'
import { initialState } from '../renderer/src/state/store'
import type { Rifff } from '../shared/types'

// Same narrow electron stand-in nativeExport.test.ts uses, and for the same
// reasons -- see that file's own long comment on app.getAppPath/getPath. The
// REAL compiled engine is spawned here on purpose: what's under test is the
// audio a DAW-project export can't produce by copying a file.
vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd(), getPath: () => tmpdir() },
  shell: { openPath: vi.fn().mockResolvedValue('') }
}))

import { renderToolkitAudio } from './exportToolkitAudio'

/** A 16-bit mono WAV of a constant sample value -- same helper
 * nativeExport.test.ts uses (its own copy notes why a constant, not a tone). */
function writeConstantWav(
  path: string,
  value: number,
  numSamples: number,
  sampleRate = 44100
): void {
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  const sample16 = Math.round(value * 32767)
  for (let i = 0; i < numSamples; i++) buf.writeInt16LE(sample16, 44 + i * 2)
  writeFileSync(path, buf)
}

// Walks the RIFF chunk list rather than assuming a 44-byte header: JUCE's own
// WAV writer inserts a JUNK chunk before "fmt " (same note as
// nativeExport.test.ts).
function findDataChunkOffset(buf: Buffer): number {
  let offset = 12
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkId === 'data') return offset + 8
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  throw new Error(`no "data" chunk found in WAV (${buf.length} bytes)`)
}

/** Peak absolute sample in a rendered (16-bit stereo) WAV, and how many
 * frames long it is. */
function renderStats(path: string): { peak: number; frames: number } {
  const buf = readFileSync(path)
  const start = findDataChunkOffset(buf)
  let peak = 0
  for (let i = start; i + 1 < buf.length; i += 2) {
    peak = Math.max(peak, Math.abs(buf.readInt16LE(i)) / 32767)
  }
  return { peak, frames: (buf.length - start) / 4 }
}

function oneBarState(stemPath: string, overrides: Partial<AppState> = {}): AppState {
  const rifff: Rifff = {
    groupId: 'r1',
    name: 'my rifff',
    bpm: 60,
    barLength: 1,
    folderPath: '/x',
    startBar: 0,
    stems: [
      {
        slot: 1,
        author: 'e',
        name: 'kick',
        type: 'fx',
        path: stemPath,
        durationSec: 4,
        barLength: 1
      }
    ]
  }
  // bpm 60 in 4/4 means one bar is exactly 4 seconds, which is what makes
  // every frame count below readable by hand.
  return { ...initialState, bpm: 60, rifffs: { r1: rifff }, ...overrides }
}

const riser = {
  id: 'ri1',
  channelId: 'r1',
  startBar: 0,
  lengthBars: 1,
  startCutoffValue: 0.3,
  endCutoffValue: 0.95,
  curve: [],
  level: 0.6,
  name: 'riser 1',
  muted: false
}

describe('renderToolkitAudio', () => {
  it('renders nothing for a project that uses none of the toolkit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-audio-'))
    try {
      const audio = await renderToolkitAudio(oneBarState('/nope.wav'), dir, 'bake')
      expect(audio.bakedClips.size).toBe(0)
      expect(audio.riserFileName).toBeUndefined()
      // Not even a Samples folder: nothing was rendered, and no engine was
      // spawned to render it with -- which is what keeps such a project's
      // export exactly as fast as it was before the toolkit existed.
      expect(existsSync(join(dir, 'Samples', 'Imported'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('bakes a clip through its own volume curve', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-src-'))
    const outDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-out-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.5, 44100 * 4)
      const state = oneBarState(stemPath)
      state.stemAutomation = {
        'r1:1': {
          volume: [
            { bar: 0, value: 0 },
            { bar: 1, value: 0 }
          ]
        }
      }

      const audio = await renderToolkitAudio(state, outDir, 'bake')

      const baked = audio.bakedClips.get('r1:1')
      expect(baked).toBeDefined()
      expect(baked!.fileName).toBe('my rifff-kick-toolkit.wav')
      // No send on this clip, so no reverb tail to leave room for, so the
      // render is exactly the clip's own one bar (4s at bpm 60).
      expect(baked!.tailBars).toBe(0)
      const stats = renderStats(join(outDir, 'Samples', 'Imported', baked!.fileName))
      expect(stats.frames).toBe(44100 * 4)
      // A curve pinned at zero really silences the clip -- i.e. the bake is
      // going through the same engine path playback does, not copying the
      // source file.
      expect(stats.peak).toBeLessThan(0.001)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 60000)

  it('leaves room past a sent clip for its reverb tail, and renders it', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-src-'))
    const outDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-out-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.5, 44100 * 4)
      const state = oneBarState(stemPath)
      state.stemSends = { 'r1:1': 1 }

      const audio = await renderToolkitAudio(state, outDir, 'bake')

      const baked = audio.bakedClips.get('r1:1')!
      // roomSize 0.5 -> a 2s decay, x1.5 runout + 20ms pre-delay = ~3s, which
      // is one more 4s bar. The exporters extend the placed clip by exactly
      // this many bars, or the tail would be trimmed off again at the edge.
      expect(baked.tailBars).toBe(1)
      const stats = renderStats(join(outDir, 'Samples', 'Imported', baked.fileName))
      expect(stats.frames).toBe(44100 * 8)
      expect(stats.peak).toBeGreaterThan(0)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 60000)

  it('renders the risers in BOTH modes, and bakes clips in neither but bake', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-src-'))
    const bakeDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-bake-'))
    const autoDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-auto-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.5, 44100 * 4)
      const state = oneBarState(stemPath, { risers: { ri1: riser } })
      state.stemSends = { 'r1:1': 0.5 }

      const baked = await renderToolkitAudio(state, bakeDir, 'bake')
      expect(baked.bakedClips.size).toBe(1)
      expect(baked.riserFileName).toBe('risers.wav')
      const bakedRiser = renderStats(join(bakeDir, 'Samples', 'Imported', 'risers.wav'))
      // A riser is generated noise -- it has to be audible on its own, with
      // every stem muted.
      expect(bakedRiser.peak).toBeGreaterThan(0.05)

      const automation = await renderToolkitAudio(state, autoDir, 'automation')
      // Dry audio is the whole point of the other mode: no clip is baked...
      expect(automation.bakedClips.size).toBe(0)
      // ...but a riser is generated, so it is rendered either way (Elling's
      // decision, spec section 4).
      expect(automation.riserFileName).toBe('risers.wav')
      expect(existsSync(join(autoDir, 'Samples', 'Imported', 'risers.wav'))).toBe(true)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(bakeDir, { recursive: true, force: true })
      rmSync(autoDir, { recursive: true, force: true })
    }
  }, 60000)
})

import { describe, expect, it, vi } from 'vitest'
import { writeFileSync, mkdtempSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineProject } from '../shared/buildEngineProject'

// The same narrow electron stand-in exportToolkitAudio.test.ts uses, and for
// the same reasons: app.getAppPath() is what defaultBinaryPath() builds the
// dev engine path from, and app.getPath('temp') is where the render writes.
// The REAL compiled engine is spawned here on purpose -- what is under test
// is a wav a phone has to be able to decode.
vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd(), getPath: () => tmpdir() },
  shell: { openPath: vi.fn().mockResolvedValue('') }
}))

import { createRemoteLoopRenderer } from './remoteLoopRenderer'

/** A 16-bit mono WAV of a constant sample value -- the same helper
 * exportToolkitAudio.test.ts and nativeExport.test.ts both carry. */
function writeConstantWav(path: string, value: number, numSamples: number): void {
  const sampleRate = 44100
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

function oneStemProject(stemPath: string): EngineProject {
  const slot = { pluginId: '', path: '', stateBase64: '' }
  return {
    bpm: 120,
    snapDiv: 4,
    loopLengthBars: 1,
    rifffs: [
      {
        groupId: 'g',
        channelId: 'c',
        startBar: 0,
        barLength: 1,
        stems: [
          {
            stemKey: 'g::1',
            resolvedPath: stemPath,
            durationSec: 2,
            barLength: 1,
            playedBars: 1,
            leftCropBars: 0,
            offsetSteps: 0,
            startBarOverride: -1,
            volume: 1,
            muted: false,
            muteRegions: [],
            oneShot: false,
            trimStartSec: 0,
            trimEndSec: -1
          }
        ]
      }
    ],
    risers: [],
    masterChain: [{ ...slot }, { ...slot }, { ...slot }, { ...slot }],
    channelChains: [],
    reverb: { roomSize: 0.5, damping: 0.5, preDelayMs: 20 }
  }
}

describe('createRemoteLoopRenderer', () => {
  it('renders the held loop to a 44100/stereo/16-bit wav and deletes the file behind it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-phone-loop-src-'))
    const stemPath = join(dir, 'stem.wav')
    writeConstantWav(stemPath, 0.5, 88200)

    const renderer = createRemoteLoopRenderer()
    try {
      renderer.setLoop(oneStemProject(stemPath))
      const startedAt = Date.now()
      const got = await renderer.wav()
      console.log(`[phone-loop] first render (cold engine) took ${Date.now() - startedAt}ms`)
      expect(got).not.toBeNull()
      const bytes = got!.bytes
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
      expect(bytes.toString('ascii', 8, 12)).toBe('WAVE')
      // 1 bar at 120bpm is 2 seconds; 44100 * 2ch * 2 bytes * 2s = 352800
      // bytes of audio, plus however many bytes of header chunks JUCE writes.
      expect(bytes.length).toBeGreaterThan(352800)
      expect(bytes.length).toBeLessThan(352800 + 4096)
      expect(got!.id).toMatch(/^[0-9a-f]{16}$/)

      // Nothing is left on disk -- the cache holds bytes, not a path.
      const loopDir = join(tmpdir(), 'sssketch-phone-loop')
      if (existsSync(loopDir)) expect(readdirSync(loopDir)).toEqual([])
    } finally {
      renderer.stop()
    }
  }, 120_000)

  it('serves the same loop from cache rather than rendering it twice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-phone-loop-src-'))
    const stemPath = join(dir, 'stem.wav')
    writeConstantWav(stemPath, 0.5, 88200)

    const renderer = createRemoteLoopRenderer()
    try {
      renderer.setLoop(oneStemProject(stemPath))
      const first = await renderer.wav()
      // Setting the SAME loop again must not invalidate anything -- Discover
      // rebuilds its project constantly with a fresh groupId each time.
      renderer.setLoop(oneStemProject(stemPath))
      const second = await renderer.wav()
      // Buffer IDENTITY, not equality: only the cache can return this.
      expect(second!.bytes).toBe(first!.bytes)
      expect(second!.id).toBe(first!.id)

      // A genuinely different loop -- one stem at half gain -- must miss the
      // cache and render again, on the engine this renderer is still
      // holding. That second render is the number the whole warm-engine
      // premise rests on, so it is timed and logged: everything after the
      // first roll costs THIS, not a spawn.
      const quieter = oneStemProject(stemPath)
      quieter.rifffs[0].stems[0].volume = 0.5
      renderer.setLoop(quieter)
      const startedAt = Date.now()
      const third = await renderer.wav()
      console.log(`[phone-loop] second render (warm engine) took ${Date.now() - startedAt}ms`)
      expect(third!.id).not.toBe(first!.id)
      expect(third!.bytes).not.toBe(first!.bytes)
    } finally {
      renderer.stop()
    }
  }, 120_000)

  it('answers null when no loop is held', async () => {
    const renderer = createRemoteLoopRenderer()
    try {
      expect(await renderer.wav()).toBeNull()
      renderer.setLoop(null)
      expect(await renderer.wav()).toBeNull()
    } finally {
      renderer.stop()
    }
  }, 120_000)
})

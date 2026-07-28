import { describe, expect, it, vi } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppState } from '../renderer/src/state/store'
import { initialState } from '../renderer/src/state/store'
import type { Rifff } from '../shared/types'

// nativeExport's internal spawnEngine() call (see engineProcess.ts's
// defaultBinaryPath) resolves the compiled engine binary's path via
// app.getAppPath() — real Electron machinery that isn't running under plain
// Vitest. This is the same constraint Task 4 hit for engineProcess.test.ts,
// but nativeExport itself exposes no binaryPathOverride to route around it,
// so the fix here is a mock instead: in real dev-mode Electron,
// app.getAppPath() returns exactly the directory containing package.json
// (the worktree root), which is also where Vitest's own process.cwd()
// already points when tests run from the repo root — so this mock is a
// faithful stand-in for that one piece of Electron machinery, not a
// workaround that changes what's under test. vi.mock calls are hoisted
// above all imports in this file by Vitest, so nativeExport.ts's own
// dependency chain (via engineProcess.ts's `import { app } from 'electron'`)
// sees this mock. loopLengthBarsFor below has no electron dependency at all,
// so the mock has no effect on those existing tests.
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

import { loopLengthBarsFor, nativeExport } from './nativeExport'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'test',
  bpm: 150,
  barLength: 8,
  folderPath: '/x',
  startBar: 4,
  stems: [
    {
      slot: 1,
      author: 'e',
      name: 'a',
      type: 'fx',
      path: '/a.wav',
      durationSec: 12.8,
      barLength: 8
    },
    { slot: 2, author: 'e', name: 'b', type: 'fx', path: '/b.wav', durationSec: 12.8, barLength: 8 }
  ]
}

function stateWith(overrides: Partial<AppState>): AppState {
  return { ...initialState, rifffs: { r1: rifff }, ...overrides }
}

describe('loopLengthBarsFor', () => {
  it('falls back to the default when nothing is placed', () => {
    expect(loopLengthBarsFor(stateWith({ rifffs: {} }))).toBe(32)
  })

  it('uses the rifff-level end (startBar + barLength) when linked', () => {
    // startBar 4 + barLength 8 = 12
    expect(loopLengthBarsFor(stateWith({}))).toBe(12)
  })

  it('accounts for an unlinked stem dragged out past its group span', () => {
    // Group's own span would end at 4 + 8 = 12, but slot 2 has been dragged out
    // to stemStart 20, so its own end is 20 + 8 = 28 — that must win.
    const state = stateWith({
      unlinked: { r1: true },
      stemStart: { 'r1:2': 20 }
    })
    expect(loopLengthBarsFor(state)).toBe(28)
  })

  it('still uses the group startBar fallback for unlinked stems that were never dragged', () => {
    // Unlinked but no stemStart override recorded for either slot -> both fall
    // back to rifff.startBar (4), so the end is still 4 + 8 = 12.
    const state = stateWith({ unlinked: { r1: true } })
    expect(loopLengthBarsFor(state)).toBe(12)
  })
})

/** A 16-bit mono WAV of a constant sample value, repeated for numSamples. Not
 * an actual tone (no frequency) — deliberately simple so the reference math
 * below is just "the constant, scaled by volume" with nothing else to model. */
function writeConstantWav(path: string, value: number, numSamples: number, sampleRate = 44100): void {
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  const sample16 = Math.round(value * 32767)
  for (let i = 0; i < numSamples; i++) {
    buf.writeInt16LE(sample16, 44 + i * 2)
  }
  writeFileSync(path, buf)
}

// Walks the RIFF chunk list to find "data" rather than assuming a fixed
// offset — JUCE's WavAudioFormat writer (the native engine's own output)
// inserts a JUNK padding chunk before "fmt ", pushing real audio data well
// past byte 44. This exact bug (assuming a fixed 44-byte header) was hit and
// fixed in Phase 1's render-parity.test.ts; reusing the same approach here.
function findDataChunkOffset(buf: Buffer): number {
  let offset = 12 // past "RIFF" + size(4) + "WAVE"
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkId === 'data') return offset + 8
    offset += 8 + chunkSize + (chunkSize % 2) // chunks are word-aligned
  }
  throw new Error(`no "data" chunk found in WAV (${buf.length} bytes)`)
}

describe('nativeExport — multi-stem/multi-rifff parity against reference math', () => {
  it('produces near-identical output for a two-stem, two-rifff project', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssstitch-export-parity-'))
    const stemAPath = join(dir, 'a.wav')
    const stemBPath = join(dir, 'b.wav')
    const sampleRate = 44100
    const numSamples = 4 * sampleRate // 4 seconds — exactly 1 bar at 60bpm
    const volA = 0.3
    const volB = 0.2
    writeConstantWav(stemAPath, volA, numSamples, sampleRate)
    writeConstantWav(stemBPath, volB, numSamples, sampleRate)

    // Two separate rifffs, each with a single stem, both starting at bar 0
    // and both exactly 1 bar long — so their outputs fully overlap in time,
    // giving multi-rifff *and* multi-stem summation in one render.
    const rifffA: Rifff = {
      groupId: 'r1',
      name: 'a',
      bpm: 60,
      barLength: 1,
      folderPath: '/x',
      startBar: 0,
      stems: [{ slot: 1, author: 'e', name: 'a', type: 'fx', path: stemAPath, durationSec: 4, barLength: 1 }]
    }
    const rifffB: Rifff = {
      groupId: 'r2',
      name: 'b',
      bpm: 60,
      barLength: 1,
      folderPath: '/x',
      startBar: 0,
      stems: [{ slot: 1, author: 'e', name: 'b', type: 'fx', path: stemBPath, durationSec: 4, barLength: 1 }]
    }
    const state: AppState = {
      ...initialState,
      bpm: 60, // matches both rifffs' own bpm, so ratio === 1 and no stretch resolution kicks in
      rifffs: { r1: rifffA, r2: rifffB }
    }

    const nativeBytes = await nativeExport(state)

    // Reference: both stems are unstretched (project bpm === rifff bpm),
    // unmuted, unfaded (state.fadeIn/fadeOut have no entries -> default 0),
    // at volume 1 (state.vol has no entries -> default 1, per
    // buildEngineProject.ts), both starting at bar 0 and both exactly 1 bar
    // long matching their rifff's own length. So the expected output is
    // simply the sample-wise sum of the two constant-value fixtures, clamped
    // to int16 range — exactly what exportMix.ts's real Web Audio graph
    // would produce for this fixture (two gain nodes summed into one
    // destination), computed directly instead of through an
    // OfflineAudioContext (see this file's constraint note above for why).
    const a16 = Math.round(volA * 32767)
    const b16 = Math.round(volB * 32767)
    const expected16 = Math.max(-32768, Math.min(32767, a16 + b16))

    const nativeBuf = Buffer.from(nativeBytes.buffer, nativeBytes.byteOffset, nativeBytes.byteLength)
    const nativeDataStart = findDataChunkOffset(nativeBuf)
    // Native output is stereo (interleaved L/R, 4 bytes per frame); compare
    // the left channel only against the mono reference.
    const numFrames = (nativeBuf.length - nativeDataStart) / 4
    expect(numFrames).toBeGreaterThanOrEqual(numSamples)

    let maxDiff = 0
    for (let i = 0; i < numSamples; i++) {
      const left = nativeBuf.readInt16LE(nativeDataStart + i * 4)
      maxDiff = Math.max(maxDiff, Math.abs(left - expected16))
    }

    console.log('nativeExport parity: two-stem/two-rifff maxDiff =', maxDiff)
    expect(maxDiff).toBeLessThanOrEqual(2) // 16-bit rounding tolerance, matching Phase 1's parity test

    rmSync(dir, { recursive: true, force: true })
  }, 30000)
})

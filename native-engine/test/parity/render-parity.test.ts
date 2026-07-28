import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineProject } from '../../../src/shared/buildEngineProject'

// Assumes native-engine has already been built (Tasks 1-8) — same precondition
// as every other manual verification step in this plan. Path matches the
// Debug artefact location confirmed throughout Phase 0/1.
const ENGINE_BINARY = join(__dirname, '../../build/ssstitch_engine_artefacts/Debug/ssstitch_engine')

function writeToneWav(path: string, durationSec: number, sampleRate = 44100): void {
  // A simple 16-bit mono WAV containing a fixed low-frequency sine, generated
  // directly (no dependency on any Endlesss export) — deterministic and small.
  const numSamples = Math.floor(durationSec * sampleRate)
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
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.5
    buf.writeInt16LE(Math.round(sample * 32767), 44 + i * 2)
  }
  writeFileSync(path, buf)
}

// The sample code this test started from assumed a fixed 44-byte header for
// every WAV read here. That holds for `tone.wav` (written by writeToneWav
// above, which emits exactly RIFF/fmt /data with no extras), but NOT for the
// native engine's own output: JUCE's WavAudioFormat writer inserts a 52-byte
// "JUNK" padding chunk between the RIFF header and "fmt " (confirmed by
// dumping native-out.wav's chunk list: JUNK size=52 @12, fmt  size=16 @72,
// data @96 -> sample data actually starts at byte 104, not 44). Assuming a
// fixed 44 there silently read 60 bytes into the fmt/JUNK region as if it
// were sample data, producing a huge, meaningless maxDiff. Walking the actual
// chunk structure to find "data" works correctly for both WAV shapes.
function findDataChunkOffset(buf: Buffer): number {
  let offset = 12 // past "RIFF" + size(4) + "WAVE"
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkId === 'data') return offset + 8
    // RIFF chunks are word-aligned: an odd-sized chunk is padded with 1 byte.
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  throw new Error(`no "data" chunk found in WAV (${buf.length} bytes)`)
}

function readWavSamples(path: string): Int16Array {
  const buf = readFileSync(path)
  const dataStart = findDataChunkOffset(buf)
  const dataBytes = buf.length - dataStart
  const samples = new Int16Array(dataBytes / 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buf.readInt16LE(dataStart + i * 2)
  }
  return samples
}

describe('native engine vs Web Audio export — render parity', () => {
  let dir: string
  let tonePath: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ssstitch-parity-'))
    tonePath = join(dir, 'tone.wav')
    writeToneWav(tonePath, 4.0) // 4 seconds — exactly 1 bar at 60bpm
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('produces near-identical output to the native engine for a simple one-stem project', async () => {
    // --- Native side: EngineProject JSON -> --render-test -> WAV ---
    const project: EngineProject = {
      bpm: 60,
      snapDiv: 16,
      rifffs: [
        {
          groupId: 'r1',
          startBar: 0,
          barLength: 1,
          fadeInBars: 0,
          fadeOutBars: 0,
          stems: [
            {
              stemKey: 'r1:1',
              resolvedPath: tonePath,
              durationSec: 4.0,
              barLength: 1,
              offsetSteps: 0,
              startBarOverride: -1,
              volume: 0.8,
              muted: false
            }
          ]
        }
      ]
    }
    const projectPath = join(dir, 'project.json')
    writeFileSync(projectPath, JSON.stringify(project))
    const nativeOutPath = join(dir, 'native-out.wav')
    execFileSync(ENGINE_BINARY, ['--render-test', projectPath, nativeOutPath, '1'])
    const nativeSamples = readWavSamples(nativeOutPath)

    // --- Reference side: the exact same math, computed directly in JS to avoid
    // needing a full jsdom + Web Audio + Electron renderer environment just for
    // this test. This mirrors exactly what exportMix.ts does for one unstretched,
    // unmuted, unfaded stem: sample[i] = sourceSample[i] * volume. ---
    const toneBuf = readFileSync(tonePath)
    const expectedSamples = new Int16Array(Math.floor(4.0 * 44100))
    for (let i = 0; i < expectedSamples.length; i++) {
      const src = toneBuf.readInt16LE(44 + i * 2)
      expectedSamples[i] = Math.round(src * 0.8)
    }

    expect(nativeSamples.length).toBeGreaterThanOrEqual(expectedSamples.length)
    // Left channel only (native output is stereo, reference is mono-sourced) —
    // compare the interleaved-stereo native output's left channel (even indices)
    // against the mono reference, allowing a small tolerance for 16-bit rounding.
    let maxDiff = 0
    for (let i = 0; i < expectedSamples.length; i++) {
      const diff = Math.abs(nativeSamples[i * 2] - expectedSamples[i])
      maxDiff = Math.max(maxDiff, diff)
    }

    console.log('render-parity: volume-only test maxDiff =', maxDiff)
    expect(maxDiff).toBeLessThanOrEqual(2) // 16-bit rounding tolerance
  })

  it('matches a fade-in envelope applied to the same tone', async () => {
    const project: EngineProject = {
      bpm: 60,
      snapDiv: 16,
      rifffs: [
        {
          groupId: 'r1',
          startBar: 0,
          barLength: 1,
          fadeInBars: 0.5, // 2 seconds of fade-in at 60bpm (secPerBar=4)
          fadeOutBars: 0,
          stems: [
            {
              stemKey: 'r1:1',
              resolvedPath: tonePath,
              durationSec: 4.0,
              barLength: 1,
              offsetSteps: 0,
              startBarOverride: -1,
              volume: 1.0,
              muted: false
            }
          ]
        }
      ]
    }
    const projectPath = join(dir, 'project-fade.json')
    writeFileSync(projectPath, JSON.stringify(project))
    const nativeOutPath = join(dir, 'native-out-fade.wav')
    execFileSync(ENGINE_BINARY, ['--render-test', projectPath, nativeOutPath, '1'])
    const nativeSamples = readWavSamples(nativeOutPath)

    const toneBuf = readFileSync(tonePath)
    const sampleRate = 44100
    const fadeInSec = 2.0
    const expectedSamples = new Int16Array(Math.floor(4.0 * sampleRate))
    for (let i = 0; i < expectedSamples.length; i++) {
      const src = toneBuf.readInt16LE(44 + i * 2)
      const t = i / sampleRate
      const gain = t < fadeInSec ? t / fadeInSec : 1.0
      expectedSamples[i] = Math.round(src * gain)
    }

    let maxDiff = 0
    for (let i = 0; i < expectedSamples.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(nativeSamples[i * 2] - expectedSamples[i]))
    }

    console.log('render-parity: fade-in test maxDiff =', maxDiff)
    expect(maxDiff).toBeLessThanOrEqual(2) // 16-bit rounding tolerance
  })

  it('fails cleanly (nonzero exit, no crash) for a project with an invalid bpm', async () => {
    // Covers the `secPerBar <= 0.0` guard added to renderProjectToWavFile
    // (native-engine/Source/RenderExport.cpp) beyond Phase 1's original
    // runRenderTest, which had no such check and would have produced
    // NaN/Inf math or a degenerate buffer instead of a clear failure.
    const project: EngineProject = {
      bpm: 0,
      snapDiv: 16,
      rifffs: []
    }
    const projectPath = join(dir, 'project-invalid-bpm.json')
    writeFileSync(projectPath, JSON.stringify(project))
    const nativeOutPath = join(dir, 'native-out-invalid-bpm.wav')

    expect(() =>
      execFileSync(ENGINE_BINARY, ['--render-test', projectPath, nativeOutPath, '1'], {
        stdio: 'pipe'
      })
    ).toThrow()
  })
})

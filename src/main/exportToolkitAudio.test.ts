import { describe, expect, it, vi } from 'vitest'
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppState } from '../renderer/src/state/store'
import { initialState } from '../renderer/src/state/store'
import type { Rifff } from '../shared/types'
import { normalizeSoundSettings } from '../shared/radioSound'

// Same narrow electron stand-in nativeExport.test.ts uses, and for the same
// reasons -- see that file's own long comment on app.getAppPath/getPath. The
// REAL compiled engine is spawned here on purpose: what's under test is the
// audio a DAW-project export can't produce by copying a file.
vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd(), getPath: () => tmpdir() },
  shell: { openPath: vi.fn().mockResolvedValue('') }
}))

import {
  clipsToBake,
  dubTailSeconds,
  renderToolkitAudio,
  reverbTailSeconds
} from './exportToolkitAudio'
import { throwTailSec } from '../shared/radioThrows'
import { timelineThrowPlan } from '../shared/timelineThrows'

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

/** A rendered stereo WAV as interleaved floats, whichever way it was written: per-clip bakes are
 * 32-bit float (RenderExport.h's WavSampleFormat -- no master stage, so a panned row may pass
 * full scale), risers.wav is 16-bit PCM. */
function readStereo(path: string): { samples: number[]; frames: number; float: boolean } {
  const buf = readFileSync(path)
  let offset = 12
  let float = false
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkId === 'fmt ') float = buf.readUInt16LE(offset + 8) === 3
    if (chunkId === 'data') break
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  const start = findDataChunkOffset(buf)
  const bytes = float ? 4 : 2
  const samples: number[] = []
  for (let i = start; i + bytes <= buf.length; i += bytes) {
    samples.push(float ? buf.readFloatLE(i) : buf.readInt16LE(i) / 32767)
  }
  return { samples, frames: samples.length / 2, float }
}

/** Peak absolute sample in a rendered stereo WAV, and how many frames long it is. */
function renderStats(path: string): { peak: number; frames: number } {
  const { samples, frames } = readStereo(path)
  let peak = 0
  for (const v of samples) peak = Math.max(peak, Math.abs(v))
  return { peak, frames }
}

/** Peak absolute sample inside one half-open frame window of a rendered
 * stereo WAV -- what "is there actually audio HERE" needs, as
 * opposed to renderStats's whole-file peak. */
function peakBetweenFrames(path: string, fromFrame: number, toFrame: number): number {
  const { samples } = readStereo(path)
  let peak = 0
  for (let i = Math.max(0, fromFrame * 2); i < Math.min(samples.length, toFrame * 2); i++) {
    peak = Math.max(peak, Math.abs(samples[i]))
  }
  return peak
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

/** One frame's [left, right] of a rendered stereo WAV. */
function frameAt(path: string, frame: number): [number, number] {
  const { samples } = readStereo(path)
  return [samples[frame * 2], samples[frame * 2 + 1]]
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

  it("bakes a panned clip (the radio sound's per-row pan) with the engine's pan law, and only in bake mode", async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-src-'))
    const outDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-out-'))
    const autoDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-out-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.5, 44100 * 4)
      // No toolkit at all: the pan alone makes it a bake. An `fx` stem in slot 1 is the first
      // placed row, so +0.25.
      const sound = normalizeSoundSettings(undefined)
      const state = oneBarState(stemPath, { sound })

      const audio = await renderToolkitAudio(state, outDir, 'bake')
      const baked = audio.bakedClips.get('r1:1')
      expect(baked).toBeDefined()
      expect(baked!.tailBars).toBe(0)
      const [left, right] = frameAt(join(outDir, 'Samples', 'Imported', baked!.fileName), 44100)
      // A mono stem at +0.25: L = cos(pi/8) x, R = (1 + sin(pi/8)) x -- and no mastering (a bake
      // drops the master stages), so exactly that, in float.
      expect(readStereo(join(outDir, 'Samples', 'Imported', baked!.fileName)).float).toBe(true)
      const x = Math.round(0.5 * 32767) / 32768
      expect(left).toBeCloseTo(Math.cos(Math.PI / 8) * x, 6)
      expect(right).toBeCloseTo((1 + Math.sin(Math.PI / 8)) * x, 6)

      // The automation mode keeps the audio dry (the pan goes on the stem's own track instead).
      expect((await renderToolkitAudio(state, autoDir, 'automation')).bakedClips.size).toBe(0)
      // And with panning off there is nothing to bake.
      const off = normalizeSoundSettings(undefined)
      off.panning.on = false
      expect(
        (await renderToolkitAudio(oneBarState(stemPath, { sound: off }), autoDir, 'bake'))
          .bakedClips.size
      ).toBe(0)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(outDir, { recursive: true, force: true })
      rmSync(autoDir, { recursive: true, force: true })
    }
  }, 60000)

  it("keeps a panned row's near side past full scale: bakes are float, not clipped 16-bit", async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-src-'))
    const outDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-out-'))
    try {
      const stemPath = join(srcDir, 'loud.wav')
      writeConstantWav(stemPath, 0.9, 44100 * 4)
      const sound = normalizeSoundSettings(undefined)
      sound.panning.width = 0.5
      const audio = await renderToolkitAudio(oneBarState(stemPath, { sound }), outDir, 'bake')
      const baked = audio.bakedClips.get('r1:1')!
      const [, right] = frameAt(join(outDir, 'Samples', 'Imported', baked.fileName), 44100)
      // 0.9 x (1 + sin(pi/4)) = 1.54: over 0 dBFS, which 16 bits would have clipped at 1.
      expect(right).toBeCloseTo((1 + Math.sin(Math.PI / 4)) * (Math.round(0.9 * 32767) / 32768), 5)
      expect(right).toBeGreaterThan(1)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 60000)

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

  it('sizes a cavern tail as the pre-delay plus 5 s, and bakes it', async () => {
    // the room's impulse: REVERB_IR's 30 ms, then its longest T60
    expect(reverbTailSeconds(0.5, 20, 'cavern')).toBeCloseTo(5.03, 10)
    // zita's own size and pre-delay do not touch it
    expect(reverbTailSeconds(1, 115, 'cavern')).toBe(reverbTailSeconds(0, 0, 'cavern'))
    expect(reverbTailSeconds(0.5, 20)).toBe(reverbTailSeconds(0.5, 20, 'zita'))

    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-src-'))
    const outDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-out-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.5, 44100 * 4)
      const sound = normalizeSoundSettings({})
      sound.reverb.room = 'cavern'
      sound.panning.on = false
      const state = oneBarState(stemPath, { sound })
      state.stemSends = { 'r1:1': 1 }

      const audio = await renderToolkitAudio(state, outDir, 'bake')

      const baked = audio.bakedClips.get('r1:1')!
      // 5.03 s of tail at 4 s a bar: two bars, where zita's ~3 s took one
      expect(baked.tailBars).toBe(2)
      const file = join(outDir, 'Samples', 'Imported', baked.fileName)
      const { samples, frames } = readStereo(file)
      expect(frames).toBe(44100 * 12)
      // the room still sounds four seconds after the clip (zita's tail would be gone by now) ...
      let late = 0
      for (let f = 44100 * 8; f < 44100 * 8 + 4410; f++)
        late = Math.max(late, Math.abs(samples[2 * f]))
      expect(late).toBeGreaterThan(1e-5)
      // ... and is silent once its impulse has ended (4 s + 5.03 s, plus a margin)
      let after = 0
      for (let f = Math.ceil(44100 * 9.1); f < frames; f++)
        after = Math.max(after, Math.abs(samples[2 * f]))
      expect(after).toBeLessThan(1e-6)
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

  // The bug Elling hit in real Ableton: "in the export, i dont hear the
  // riser", then "oh wait, there was a small one. out of two" -- two riser
  // clips in the arrangement, the later one drawn with no waveform under it
  // at all. Every riser lands in ONE risers.wav laid out on the
  // arrangement's own timeline, so this is the one test that can tell
  // "the render is missing it" apart from "the clip crops the wrong place".
  it('puts every riser in risers.wav at its own place on the timeline', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-src-'))
    const outDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-out-'))
    try {
      const stemPath = join(srcDir, 'a.wav')
      writeConstantWav(stemPath, 0.5, 44100 * 4)
      // Two risers, on their own rows (one row per riser, as of 2026-09-23),
      // far apart: bar 0 and bar 6. At bpm 60 a bar is exactly 4s.
      const state = oneBarState(stemPath, {
        risers: {
          ri1: { ...riser, id: 'ri1', channelId: 'c1', startBar: 0 },
          ri2: { ...riser, id: 'ri2', channelId: 'c2', startBar: 6, name: 'riser 2' }
        }
      })

      const audio = await renderToolkitAudio(state, outDir, 'bake')

      const path = join(outDir, 'Samples', 'Imported', audio.riserFileName!)
      // Long enough to hold the second riser's own bar (bars 6..7 = 24s..28s)
      // AND its tail (RISER_TAIL_BARS past that = 28.5s), because that is
      // where the .als/.rpp clips cropped out of this file stop.
      expect(renderStats(path).frames).toBeGreaterThanOrEqual(44100 * 28.5)
      expect(peakBetweenFrames(path, 0, 44100 * 4)).toBeGreaterThan(0.05)
      expect(peakBetweenFrames(path, 44100 * 24, 44100 * 28)).toBeGreaterThan(0.05)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 120000)

  describe("the timeline's throws in a bake (native radio sound plan, Task 12)", () => {
    /** A 16-bit mono WAV of a sine, so the echo's 200 Hz-3.5 kHz loop has something to pass. */
    function writeSineWav(path: string, hz: number, amplitude: number, numSamples: number): void {
      writeConstantWav(path, 0, numSamples)
      const buf = readFileSync(path)
      for (let i = 0; i < numSamples; i++) {
        const v = amplitude * Math.sin((2 * Math.PI * hz * i) / 44100)
        buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
      }
      writeFileSync(path, buf)
    }
    /** One throwing row (notes), `bars` long at 1 s a bar, panning off so only the throws bake. */
    function throwingState(
      stemPath: string,
      bars: number,
      seed: string,
      throwsOn = true
    ): AppState {
      const sound = normalizeSoundSettings(undefined)
      sound.panning.on = false
      sound.throws.on = throwsOn
      const rifff: Rifff = {
        groupId: 'r1',
        name: 'long',
        bpm: 240,
        barLength: 1,
        folderPath: '/x',
        startBar: 0,
        stems: [
          {
            slot: 1,
            author: 'e',
            name: 'n',
            type: 'notes',
            path: stemPath,
            durationSec: 1,
            barLength: 1
          }
        ]
      }
      return {
        ...initialState,
        bpm: 240,
        rifffs: { r1: rifff },
        playedBars: { r1: bars },
        sound,
        projectSeed: seed
      }
    }

    it('sizes the echo at the loop peak gain, not the nominal feedback', () => {
      const nominal = throwTailSec(0.375, 0.6)
      const peak = dubTailSeconds(0.375, 0.6)
      // ~22.7 passes at 0.6 x 1.23 against ~13.5 at 0.6; plus the first repeat and the drift
      const passes = Math.log(1000) / -Math.log(0.6 * 1.23)
      expect(peak).toBeCloseTo(0.375 * (1 + passes) + Math.ceil(passes / 2) * (128 / 44100), 10)
      expect(peak).toBeGreaterThan(nominal * 1.6)
      // the native guard: anything above 0.77 rings as 0.77 does, and never forever
      expect(dubTailSeconds(0.5, 2)).toBe(dubTailSeconds(0.5, 0.77))
      expect(Number.isFinite(dubTailSeconds(2, 0.95))).toBe(true)
      expect(dubTailSeconds(0.5, 0)).toBe(0.5)
    })

    it('a throwing clip is baked, with its last throw; not with throws off', () => {
      const state = throwingState('/no/a.wav', 64, 'bake-1')
      const plan = timelineThrowPlan(state)!
      expect(plan.throws.length).toBeGreaterThan(0)
      const last = plan.throws[plan.throws.length - 1]
      expect(clipsToBake(state, plan)).toEqual([
        {
          key: 'r1:1',
          rifffName: 'long',
          stemName: 'n',
          endBar: 64,
          hasSend: false,
          lastThrowEndBar: last.atBar + last.beats / 4
        }
      ])
      const off = throwingState('/no/a.wav', 64, 'bake-1', false)
      expect(timelineThrowPlan(off)).toBeNull()
      expect(clipsToBake(off, timelineThrowPlan(off))).toEqual([])
      // null is "no throws", never "plan them": the throwing project with no plan bakes nothing
      expect(clipsToBake(state, null)).toEqual([])
    })

    it('bakes the echo and leaves room for it and the room it feeds; automation has none', async () => {
      const srcDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-src-'))
      const bakeDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-bake-'))
      const autoDir = mkdtempSync(join(tmpdir(), 'sssketch-toolkit-auto-'))
      try {
        const stemPath = join(srcDir, 'n.wav')
        writeSineWav(stemPath, 1000, 0.3, 44100)
        // End the clip on the bar after its first throw closes, so the echo rings past it. The
        // throw stays where it was: a shorter clip it still fits in changes nothing before it.
        const first = timelineThrowPlan(throwingState(stemPath, 64, 'bake-2'))!.throws[0]
        const throwEnd = first.atBar + first.beats / 4
        const bars = Math.ceil(throwEnd + 1e-9)
        const state = throwingState(stemPath, bars, 'bake-2')
        const plan = timelineThrowPlan(state)!
        expect(plan.throws[plan.throws.length - 1]).toEqual(first)

        const audio = await renderToolkitAudio(state, bakeDir, 'bake')
        const baked = audio.bakedClips.get('r1:1')!
        const delaySec = (plan.echo.timing === 'quarter' ? 1 : 0.75) * 0.25
        const ringSec =
          dubTailSeconds(delaySec, plan.echo.feedback) + reverbTailSeconds(0.5, 20, 'cavern')
        expect(baked.tailBars).toBe(Math.ceil(throwEnd - bars + ringSec))
        const file = join(bakeDir, 'Samples', 'Imported', baked.fileName)
        const { frames } = readStereo(file)
        expect(frames).toBe(44100 * (bars + baked.tailBars))
        // past the clip's end the dry row is gone; the echo is still there
        expect(peakBetweenFrames(file, 44100 * bars + 2205, 44100 * (bars + 1))).toBeGreaterThan(
          1e-3
        )

        const dry = await renderToolkitAudio(state, autoDir, 'automation')
        expect(dry.bakedClips.size).toBe(0)
      } finally {
        rmSync(srcDir, { recursive: true, force: true })
        rmSync(bakeDir, { recursive: true, force: true })
        rmSync(autoDir, { recursive: true, force: true })
      }
    }, 120000)
  })
})

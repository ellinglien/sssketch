import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShapeMaterializeRequest } from '@shared/shape'

let renderCount = 0
let failAt = -1
let corruptAt = -1
let sentPayloads: unknown[] = []
let pitchRequests: Array<{ path: string; ratio: number; pitch: number }> = []
let formantRequests: Array<{ path: string; formant: number }> = []
let waitForFormantAbort = false
let waitForNativeAbort = false
let nativeDisconnects = 0
let engineStops = 0

function writeFloatWav(path: string, frames = 4000): void {
  const bytes = Buffer.alloc(44 + frames * 4)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVE', 8)
  bytes.write('fmt ', 12)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(3, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(1000, 24)
  bytes.writeUInt32LE(4000, 28)
  bytes.writeUInt16LE(4, 32)
  bytes.writeUInt16LE(32, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(frames * 4, 40)
  writeFileSync(path, bytes)
}

vi.mock('./engineProcess', () => ({
  spawnEngine: vi.fn(async () => ({
    port: 1234,
    process: {},
    stop: vi.fn(() => {
      engineStops += 1
    })
  }))
}))

vi.mock('./engineClient', () => ({
  EngineClient: class {
    private pendingReject: ((error: Error) => void) | null = null

    async connect(): Promise<void> {
      return undefined
    }
    disconnect(): void {
      nativeDisconnects += 1
      this.pendingReject?.(new Error('cancelled native render'))
      this.pendingReject = null
    }
    async sendAndAwaitType(type: string, payload: unknown): Promise<unknown> {
      renderCount += 1
      sentPayloads.push(payload)
      if (waitForNativeAbort) {
        return new Promise<never>((_resolve, reject) => {
          this.pendingReject = reject
        })
      }
      if (renderCount === failAt) return { success: false, error: 'deliberate failure' }
      const outputPath = (payload as { outputPath: string }).outputPath
      if (renderCount === corruptAt) writeFileSync(outputPath, Buffer.alloc(64, 1))
      else if (type === 'render-shape-raw-source') {
        const rate = (payload as { rate: number }).rate
        const frames = Math.ceil(4000 / rate)
        writeFloatWav(outputPath, frames)
        return {
          success: true,
          durationSec: frames / 1000,
          sampleRate: 1000,
          frames,
          channels: 1
        }
      } else writeFloatWav(outputPath)
      return { success: true, durationSec: 4, sampleRate: 1000, frames: 4000, channels: 1 }
    }
  }
}))

vi.mock('./rubberband', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rubberband')>()
  return {
    ...actual,
    renderShapePitch: vi.fn(async (path: string, ratio: number, pitch: number) => {
      pitchRequests.push({ path, ratio, pitch })
      return { path: `${path}.pitch-${pitch}`, durationSec: 4 }
    }),
    renderShapeFormant: vi.fn(async (path: string, formant: number, signal?: AbortSignal) => {
      formantRequests.push({ path, formant })
      if (waitForFormantAbort) {
        await new Promise<never>((_resolve, reject) => {
          if (signal?.aborted) reject(new Error('aborted formant'))
          else
            signal?.addEventListener('abort', () => reject(new Error('aborted formant')), {
              once: true
            })
        })
      }
      return { path: `${path}.formant-${formant}`, durationSec: 4 }
    })
  }
})

import {
  bakeShapeProcess,
  cancelShapeMaterialization,
  cleanupShapePreview,
  cleanupUncommittedShapeAssets,
  materializeShape,
  nativeShapeProcessPayload,
  shapeProcessSourceCacheKey,
  shapeRawSourceCacheKey
} from './shapeMaterialize'

function request(mode: 'preview' | 'commit', lanes = 1): ShapeMaterializeRequest {
  return {
    jobId: `job-${mode}`,
    mode,
    targetBpm: 120,
    loopBars: 2,
    lanes: Array.from({ length: lanes }, (_, index) => ({
      source: {
        author: 'test',
        name: `lane ${index}`,
        type: 'fx',
        path: `/source/${index}.wav`,
        durationSec: 4,
        barLength: 2
      },
      segments: [{ sourceStartBars: 0, sourceEndBars: 2, destStartBars: 0 }]
    }))
  }
}

describe('materializeShape', () => {
  let durableRoot: string

  beforeEach(() => {
    renderCount = 0
    failAt = -1
    corruptAt = -1
    sentPayloads = []
    pitchRequests = []
    formantRequests = []
    waitForFormantAbort = false
    waitForNativeAbort = false
    nativeDisconnects = 0
    engineStops = 0
    durableRoot = mkdtempSync(join(tmpdir(), 'sssketch-shape-test-'))
  })

  afterEach(() => cleanupShapePreview([]))

  it('publishes a complete commit batch under immutable final names', async () => {
    const result = await materializeShape(request('commit', 2), durableRoot)
    expect(result.stems).toHaveLength(2)
    expect(result.stems.every((stem) => stem.path.endsWith('.shape.wav'))).toBe(true)
    expect(readdirSync(durableRoot).filter((name) => name.endsWith('.shape.wav'))).toHaveLength(2)
    cleanupUncommittedShapeAssets(
      result.stems.map((stem) => stem.path),
      durableRoot
    )
    expect(readdirSync(durableRoot).filter((name) => name.endsWith('.shape.wav'))).toEqual([])
  })

  it('publishes no final lane when any render in the batch fails', async () => {
    failAt = 2
    await expect(materializeShape(request('commit', 2), durableRoot)).rejects.toThrow(
      /deliberate failure/
    )
    expect(readdirSync(durableRoot).filter((name) => name.endsWith('.shape.wav'))).toEqual([])
  })

  it('rejects a success reply whose file is not a complete float WAV', async () => {
    corruptAt = 1
    await expect(materializeShape(request('commit'), durableRoot)).rejects.toThrow()
    expect(readdirSync(durableRoot).filter((name) => name.endsWith('.shape.wav'))).toEqual([])
  })

  it('keeps completed preview lanes in the bounded shared cache', async () => {
    const result = await materializeShape(request('preview'), durableRoot)
    expect(result.stems[0].path).toContain('.preview-cache')
    expect(existsSync(result.stems[0].path)).toBe(true)
    cleanupShapePreview(result.stems.map((stem) => stem.path))
    expect(existsSync(result.stems[0].path)).toBe(true)
  })

  it('reuses unchanged lane renders and renders only the edited lane', async () => {
    const initial = request('preview', 2)
    await materializeShape(initial, durableRoot)
    expect(renderCount).toBe(2)

    const edited = request('preview', 2)
    edited.lanes[0].segments[0].pitchSemitones = 7
    await materializeShape(edited, durableRoot)
    expect(renderCount).toBe(3)

    await materializeShape(edited, durableRoot)
    expect(renderCount).toBe(3)
  })

  it('prepares each distinct pitch once and routes clips to the matching source', async () => {
    const value = request('preview')
    value.lanes[0].segments = [
      { sourceStartBars: 0, sourceEndBars: 1, destStartBars: 0 },
      { sourceStartBars: 1, sourceEndBars: 2, destStartBars: 1, pitchSemitones: 7 }
    ]

    await materializeShape(value, durableRoot)

    expect(pitchRequests.map((item) => item.pitch)).toEqual([7])
    expect(sentPayloads[0]).toMatchObject({
      sources: [
        { path: '/source/0.wav', durationSec: 4 },
        { path: '/source/0.wav.pitch-7', durationSec: 4 }
      ],
      segments: [{ sourceIndex: 0 }, { sourceIndex: 1 }]
    })
  })

  it('prepares Smooth rate as linked tempo and pitch and remaps source coordinates', async () => {
    const value = request('preview')
    value.lanes[0].segments = [
      {
        sourceStartBars: 0.5,
        sourceEndBars: 2,
        destStartBars: 0.25,
        pitchSemitones: -3,
        rate: 2
      }
    ]

    await materializeShape(value, durableRoot)

    expect(pitchRequests).toEqual([{ path: '/source/0.wav', ratio: 2, pitch: 9 }])
    expect(sentPayloads[0]).toMatchObject({
      sources: [
        {
          path: '/source/0.wav.pitch-9',
          durationSec: 4,
          barLength: 1
        }
      ],
      segments: [
        {
          sourceStartBars: 0.25,
          sourceEndBars: 1,
          destStartBars: 0.25,
          sourceIndex: 0
        }
      ]
    })
  })

  it('prepares Raw rate with native nearest-neighbour resampling and no duration correction', async () => {
    const value = request('preview')
    value.lanes[0].segments[0].rate = 2
    value.lanes[0].segments[0].character = 'raw'

    await materializeShape(value, durableRoot)

    expect(pitchRequests).toEqual([])
    expect(sentPayloads[0]).toMatchObject({
      sourcePath: '/source/0.wav',
      rate: 2,
      outputPath: expect.stringContaining('.raw-rendering.wav')
    })
    expect(sentPayloads[1]).toMatchObject({
      sources: [
        {
          path: expect.stringContaining('.shape-raw.wav'),
          durationSec: 2,
          barLength: 1
        }
      ],
      segments: [{ sourceStartBars: 0, sourceEndBars: 1, sourceIndex: 0 }]
    })
  })

  it('duration-corrects Raw pitch after aliasing is baked into the source', async () => {
    const value = request('preview')
    value.lanes[0].segments[0].pitchSemitones = -12
    value.lanes[0].segments[0].character = 'raw'

    await materializeShape(value, durableRoot)

    expect(sentPayloads[0]).toMatchObject({ rate: 0.5 })
    expect(pitchRequests).toEqual([
      {
        path: expect.stringContaining('.shape-raw.wav'),
        ratio: 2,
        pitch: 0
      }
    ])
    expect(sentPayloads[1]).toMatchObject({
      sources: [{ path: expect.stringContaining('.pitch-0'), durationSec: 4, barLength: 2 }]
    })
  })

  it('routes extreme Raw transpose through the safe staged pitch renderer', async () => {
    const value = request('preview')
    value.lanes[0].segments[0].pitchSemitones = 512
    value.lanes[0].segments[0].character = 'raw'

    await materializeShape(value, durableRoot)

    expect(pitchRequests).toEqual([{ path: '/source/0.wav', ratio: 1, pitch: 512 }])
    expect(sentPayloads).toHaveLength(1)
    expect(sentPayloads[0]).toMatchObject({
      sources: [{ path: '/source/0.wav.pitch-512', durationSec: 4, barLength: 2 }]
    })
  })

  it('renders Wavefold once before core transforms and assembles from the processed cache', async () => {
    const value = request('preview')
    value.lanes[0].segments[0].process = { type: 'wavefold', drive: 3, bias: 0, mix: 0.75 }

    await materializeShape(value, durableRoot)

    expect(pitchRequests).toEqual([])
    expect(sentPayloads[0]).toMatchObject({
      sourcePath: '/source/0.wav',
      processType: 'wavefold',
      primary: 3,
      secondary: 0,
      mix: 0.75,
      outputPath: expect.stringContaining('.process-rendering.wav')
    })
    expect(sentPayloads[1]).toMatchObject({
      sources: [
        {
          path: expect.stringContaining('.shape-process.wav'),
          durationSec: 4,
          barLength: 2
        }
      ],
      segments: [{ sourceIndex: 0 }]
    })
  })

  it('maps multi-parameter treatments to the generic native renderer', async () => {
    const value = request('preview')
    value.lanes[0].segments[0].process = {
      type: 'comb',
      delayMs: 17,
      feedback: -0.4,
      damping: 0.6,
      mix: 0.7
    }

    await materializeShape(value, durableRoot)

    expect(sentPayloads[0]).toMatchObject({
      sourcePath: '/source/0.wav',
      processType: 'comb',
      primary: 17,
      secondary: -0.4,
      tertiary: 0.6,
      mix: 0.7
    })
  })

  it('renders from a durable baked base instead of the untouched lane source', async () => {
    const value = request('preview')
    value.lanes[0].segments[0].bakedBase = {
      path: '/shape/already-baked.shape-base.wav',
      durationSec: 4,
      barLength: 2
    }

    await materializeShape(value, durableRoot)

    expect(sentPayloads[0]).toMatchObject({
      sources: [{ path: '/shape/already-baked.shape-base.wav', durationSec: 4, barLength: 2 }],
      segments: [{ sourceIndex: 0 }]
    })
  })

  it('applies the editable treatment to the base before core pitch transforms', async () => {
    const value = request('preview')
    value.lanes[0].segments[0].pitchSemitones = 7
    value.lanes[0].segments[0].process = { type: 'wavefold', drive: 4, bias: 0, mix: 1 }

    await materializeShape(value, durableRoot)

    expect(sentPayloads[0]).toMatchObject({
      sourcePath: '/source/0.wav',
      processType: 'wavefold',
      primary: 4,
      mix: 1
    })
    expect(pitchRequests).toEqual([
      {
        path: expect.stringContaining('.shape-process.wav'),
        ratio: 1,
        pitch: 7
      }
    ])
    expect(sentPayloads[1]).toMatchObject({
      sources: [{ path: expect.stringContaining('.pitch-7') }]
    })
  })

  it('shifts formants before pitch while preserving the prepared source duration', async () => {
    const value = request('preview')
    value.lanes[0].segments[0].formantSemitones = -7
    value.lanes[0].segments[0].pitchSemitones = 3

    await materializeShape(value, durableRoot)

    expect(formantRequests).toEqual([{ path: '/source/0.wav', formant: -7 }])
    expect(pitchRequests).toEqual([{ path: '/source/0.wav.formant--7', ratio: 1, pitch: 3 }])
    expect(sentPayloads[0]).toMatchObject({
      sources: [{ path: '/source/0.wav.formant--7.pitch-3', durationSec: 4, barLength: 2 }]
    })
  })

  it('aborts an obsolete in-flight formant render instead of finishing stale work', async () => {
    const value = request('preview')
    value.jobId = 'obsolete-formant-preview'
    value.lanes[0].segments[0].formantSemitones = -7
    waitForFormantAbort = true

    const rendering = materializeShape(value, durableRoot)
    await vi.waitFor(() => expect(formantRequests).toHaveLength(1))
    cancelShapeMaterialization(value.jobId)

    await expect(rendering).rejects.toThrow('aborted formant')
    expect(readdirSync(durableRoot).filter((name) => name.endsWith('.shape.wav'))).toEqual([])
  })

  it('disconnects and stops an obsolete in-flight native Shape render', async () => {
    const value = request('preview')
    value.jobId = 'obsolete-native-preview'
    value.lanes[0].segments[0].process = { type: 'smear', timeMs: 80, scatter: 0.5, mix: 1 }
    waitForNativeAbort = true

    const rendering = materializeShape(value, durableRoot)
    await vi.waitFor(() => expect(renderCount).toBe(1))
    cancelShapeMaterialization(value.jobId)

    await expect(rendering).rejects.toThrow('cancelled native render')
    expect(nativeDisconnects).toBeGreaterThanOrEqual(1)
    expect(engineStops).toBeGreaterThanOrEqual(1)
    expect(readdirSync(durableRoot).filter((name) => name.endsWith('.shape.wav'))).toEqual([])
  })

  it('atomically publishes Wavefold Bake results as durable clip bases', async () => {
    const result = await bakeShapeProcess(
      {
        jobId: 'bake-wavefold',
        items: [
          {
            fragmentId: 'clip-a',
            source: { path: '/source/0.wav', durationSec: 4, barLength: 2 },
            process: { type: 'wavefold', drive: 4, bias: 0, mix: 0.5 }
          }
        ]
      },
      durableRoot
    )

    expect(sentPayloads[0]).toMatchObject({
      sourcePath: '/source/0.wav',
      processType: 'wavefold',
      primary: 4,
      mix: 0.5,
      outputPath: expect.stringContaining('.baking.wav')
    })
    expect(result.bases[0]).toMatchObject({
      fragmentId: 'clip-a',
      source: {
        path: expect.stringContaining('.shape-base.wav'),
        durationSec: 4,
        barLength: 2
      }
    })
    expect(existsSync(result.bases[0].source.path)).toBe(true)
    cleanupUncommittedShapeAssets([result.bases[0].source.path], durableRoot)
    expect(existsSync(result.bases[0].source.path)).toBe(false)
  })

  it('publishes no baked base when any Wavefold item fails', async () => {
    failAt = 2
    await expect(
      bakeShapeProcess(
        {
          jobId: 'failed-bake',
          items: [
            {
              fragmentId: 'clip-a',
              source: { path: '/source/a.wav', durationSec: 4, barLength: 2 },
              process: { type: 'wavefold', drive: 2, bias: 0, mix: 1 }
            },
            {
              fragmentId: 'clip-b',
              source: { path: '/source/b.wav', durationSec: 4, barLength: 2 },
              process: { type: 'saturation', drive: 4, bias: 0, outputDb: 0, mix: 0.5 }
            }
          ]
        },
        durableRoot
      )
    ).rejects.toThrow(/deliberate failure/)
    expect(readdirSync(durableRoot).filter((name) => name.endsWith('.shape-base.wav'))).toEqual([])
  })

  it('keys Raw source renders by input and nearest-neighbour rate', () => {
    expect(shapeRawSourceCacheKey('/a.wav', 2)).toBe(shapeRawSourceCacheKey('/a.wav', 2))
    expect(shapeRawSourceCacheKey('/a.wav', 2)).not.toBe(shapeRawSourceCacheKey('/a.wav', 0.5))
  })

  it('keys Process source renders by input, treatment type, and parameters', () => {
    expect(
      shapeProcessSourceCacheKey('/a.wav', { type: 'wavefold', drive: 4, bias: 0, mix: 0.5 })
    ).toBe(shapeProcessSourceCacheKey('/a.wav', { type: 'wavefold', drive: 4, bias: 0, mix: 0.5 }))
    expect(
      shapeProcessSourceCacheKey('/a.wav', { type: 'wavefold', drive: 4, bias: 0, mix: 0.5 })
    ).not.toBe(
      shapeProcessSourceCacheKey('/a.wav', { type: 'wavefold', drive: 8, bias: 0, mix: 0.5 })
    )
    expect(
      shapeProcessSourceCacheKey('/a.wav', { type: 'wavefold', drive: 4, bias: 0, mix: 0.5 })
    ).not.toBe(
      shapeProcessSourceCacheKey('/a.wav', {
        type: 'saturation',
        drive: 4,
        bias: 0,
        outputDb: 0,
        mix: 0.5
      })
    )
    expect(
      shapeProcessSourceCacheKey('/a.wav', { type: 'wavefold', drive: 4, bias: 0, mix: 0.5 })
    ).not.toBe(
      shapeProcessSourceCacheKey('/a.wav', { type: 'wavefold', drive: 4, bias: 0, mix: 1 })
    )
    expect(
      shapeProcessSourceCacheKey('/a.wav', {
        type: 'saturation',
        drive: 9,
        bias: 0,
        outputDb: 0,
        mix: 1
      })
    ).not.toBe(
      shapeProcessSourceCacheKey('/a.wav', {
        type: 'saturation',
        drive: 9,
        bias: 0,
        outputDb: -6,
        mix: 1
      })
    )
  })

  it('maps every treatment and its extra control to the native parameter slots', () => {
    expect([
      nativeShapeProcessPayload({ type: 'wavefold', drive: 3, bias: -0.2, mix: 0.8 }),
      nativeShapeProcessPayload({
        type: 'saturation',
        drive: 5,
        bias: 0.3,
        outputDb: -6,
        mix: 0.7
      }),
      nativeShapeProcessPayload({
        type: 'hard-clip',
        threshold: 0.4,
        symmetry: -0.5,
        mix: 1
      }),
      nativeShapeProcessPayload({ type: 'rectify', mode: 'half', drive: 3, mix: 0.6 }),
      nativeShapeProcessPayload({ type: 'bit-crush', bits: 7, dither: 0.4, mix: 1 }),
      nativeShapeProcessPayload({ type: 'rate-crush', factor: 9, jitter: 0.5, mix: 0.9 }),
      nativeShapeProcessPayload({ type: 'ring-mod', frequencyHz: 173, shape: 0.6, mix: 0.5 }),
      nativeShapeProcessPayload({
        type: 'comb',
        delayMs: 17,
        feedback: -0.4,
        damping: 0.7,
        mix: 0.8
      }),
      nativeShapeProcessPayload({ type: 'smear', timeMs: 90, scatter: 0.65, mix: 0.75 })
    ]).toEqual([
      { processType: 'wavefold', primary: 3, secondary: -0.2, tertiary: 0, mix: 0.8 },
      { processType: 'saturation', primary: 5, secondary: 0.3, tertiary: -6, mix: 0.7 },
      { processType: 'hard-clip', primary: 0.4, secondary: -0.5, tertiary: 0, mix: 1 },
      { processType: 'rectify', primary: 0, secondary: 3, tertiary: 0, mix: 0.6 },
      { processType: 'bit-crush', primary: 7, secondary: 0.4, tertiary: 0, mix: 1 },
      { processType: 'rate-crush', primary: 9, secondary: 0.5, tertiary: 0, mix: 0.9 },
      { processType: 'ring-mod', primary: 173, secondary: 0.6, tertiary: 0, mix: 0.5 },
      { processType: 'comb', primary: 17, secondary: -0.4, tertiary: 0.7, mix: 0.8 },
      { processType: 'smear', primary: 90, secondary: 0.65, tertiary: 0, mix: 0.75 }
    ])
  })
})

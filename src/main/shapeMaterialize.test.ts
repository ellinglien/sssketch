import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShapeMaterializeRequest } from '@shared/shape'

let renderCount = 0
let failAt = -1
let corruptAt = -1

function writeFloatWav(path: string): void {
  const frames = 4000
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
  spawnEngine: vi.fn(async () => ({ port: 1234, process: {}, stop: vi.fn() }))
}))

vi.mock('./engineClient', () => ({
  EngineClient: class {
    async connect(): Promise<void> {
      return undefined
    }
    disconnect(): void {
      return undefined
    }
    async sendAndAwaitType(_type: string, payload: unknown): Promise<unknown> {
      renderCount += 1
      if (renderCount === failAt) return { success: false, error: 'deliberate failure' }
      const outputPath = (payload as { outputPath: string }).outputPath
      if (renderCount === corruptAt) writeFileSync(outputPath, Buffer.alloc(64, 1))
      else writeFloatWav(outputPath)
      return { success: true, durationSec: 4, sampleRate: 1000, frames: 4000, channels: 1 }
    }
  }
}))

vi.mock('./rubberband', () => ({
  renderStretched: vi.fn(async (path: string) => ({ path, durationSec: 4 }))
}))

import {
  cleanupShapePreview,
  cleanupUncommittedShapeAssets,
  materializeShape
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

  it('keeps preview audio readable until explicit cleanup', async () => {
    const result = await materializeShape(request('preview'), durableRoot)
    expect(result.stems[0].path).toContain('sssketch-shape-preview')
    cleanupShapePreview(result.stems.map((stem) => stem.path))
  })
})

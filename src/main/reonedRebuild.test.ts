import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

// bakeOffset's native path resolves the engine binary through app.getAppPath() (see
// bakeOffset.test.ts); these tests only bake WAVs, so it is never reached.
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), getPath: () => tmpdir() } }))

import { bakeOffset } from './bakeOffset'
import {
  ensureReonedCopiesForState,
  rebuildReonedCopies,
  setStemMetadataDurationLookup
} from './reonedRebuild'
import { applyReonedRepair, planReonedRepair } from '@shared/reonedRepair'
import { rotationSecForBars } from '@shared/reonedRotation'
import type { Rifff } from '@shared/types'
import type { AppState } from '../renderer/src/state/store'

/** Same ramp fixture as bakeOffset.test.ts (each test file owns its own helpers). */
function writeRampWav(path: string, numSamples: number, sampleRate = 1000): void {
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
    buf.writeInt16LE(Math.round((i / numSamples) * 32000), 44 + i * 2)
  }
  writeFileSync(path, buf)
}

function riffOn(copy: string, source: string, phaseBars: number, durationSec = 4): Rifff {
  return {
    groupId: 'g',
    name: 'g',
    bpm: 240, // 1 s per bar: the metadata candidate equals the measured one here
    barLength: 4,
    folderPath: '',
    stems: [
      {
        slot: 1,
        author: '',
        name: 'd',
        type: 'drums',
        path: copy,
        durationSec,
        barLength: 4,
        phaseSourcePath: source,
        phaseBars
      }
    ]
  }
}

describe('rebuildReonedCopies', () => {
  it('rebuilds a missing copy to the same name; applying it leaves the project untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const root = join(dir, 'lib')
      mkdirSync(root)
      const bakes = join(root, '.bakes')
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const [copy] = await bakeOffset(
        [{ path: source, rotationSec: rotationSecForBars(1.5, { barLength: 4, durationSec: 4 }) }],
        bakes
      )
      rmSync(copy.bakedPath)
      const rifffs = { g: riffOn(copy.bakedPath, source, 1.5) }
      const outcomes = await rebuildReonedCopies(planReonedRepair(rifffs), {
        outputDir: bakes,
        libraryRoot: root
      })
      expect(outcomes).toEqual([
        [
          {
            path: copy.bakedPath,
            status: 'rebuilt',
            bakedPath: copy.bakedPath,
            durationSec: expect.closeTo(4, 5)
          }
        ]
      ])
      expect(existsSync(copy.bakedPath)).toBe(true)
      expect(applyReonedRepair(rifffs, outcomes).rifffs).toBe(rifffs)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a present copy is left alone and nothing is baked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const copy = join(dir, 'x.baked.wav')
      writeFileSync(copy, 'anything')
      const outcomes = await rebuildReonedCopies(
        planReonedRepair({ g: riffOn(copy, '/nowhere.wav', 1) }),
        { outputDir: join(dir, '.bakes'), libraryRoot: dir }
      )
      expect(outcomes).toEqual([[{ path: copy, status: 'present' }]])
      expect(existsSync(join(dir, '.bakes'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an unreachable original: every missing stem of that riff is missing, nothing is written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const rifff = riffOn(join(dir, '.bakes', 'a.baked.wav'), source, 1)
      rifff.stems.push({
        ...rifff.stems[0],
        slot: 2,
        path: join(dir, '.bakes', 'b.baked.wav'),
        phaseSourcePath: join(dir, 'gone.wav')
      })
      const outcomes = await rebuildReonedCopies(planReonedRepair({ g: rifff }), {
        outputDir: join(dir, '.bakes'),
        libraryRoot: dir
      })
      expect(outcomes[0]).toEqual([
        { path: rifff.stems[0].path, status: 'missing', reason: 'unreachable' },
        { path: rifff.stems[1].path, status: 'missing', reason: 'unreachable' }
      ])
      const bakes = join(dir, '.bakes')
      expect(existsSync(bakes) ? readdirSync(bakes) : []).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the library drive away: missing, and its folder is not recreated', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const root = join(dir, 'unplugged')
      const outcomes = await rebuildReonedCopies(
        planReonedRepair({ g: riffOn(join(root, '.bakes', 'a.baked.wav'), source, 1) }),
        { outputDir: join(root, '.bakes'), libraryRoot: root }
      )
      expect(outcomes[0][0]).toMatchObject({ status: 'missing', reason: 'unreachable' })
      expect(existsSync(root)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an original that is there but will not render: missing as "render-failed", which a retry skips', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const source = join(dir, 'source.wav')
      writeFileSync(source, 'not a wav at all')
      const copy = join(dir, '.bakes', 'a.baked.wav')
      const outcomes = await rebuildReonedCopies(planReonedRepair({ g: riffOn(copy, source, 1) }), {
        outputDir: join(dir, '.bakes'),
        libraryRoot: dir
      })
      expect(outcomes[0]).toEqual([{ path: copy, status: 'missing', reason: 'render-failed' }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the default library root is made when it is not there, as the bake handler does', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const root = join(dir, 'Music', 'sssketch', 'projects')
      const [copy] = await bakeOffset(
        [{ path: source, rotationSec: 1 }],
        join(dir, 'made', '.bakes'),
        {
          mayCreateRoot: true
        }
      )
      const missing = join(root, '.bakes', basename(copy.bakedPath))
      const outcomes = await rebuildReonedCopies(
        planReonedRepair({ g: riffOn(missing, source, 1) }),
        { outputDir: join(root, '.bakes'), libraryRoot: root, mayCreateRoot: true }
      )
      expect(outcomes[0][0]).toMatchObject({ status: 'rebuilt', bakedPath: missing })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a copy two riffs share is rebuilt once and found by the second', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const root = join(dir, 'lib')
      mkdirSync(root)
      const bakes = join(root, '.bakes')
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const [copy] = await bakeOffset([{ path: source, rotationSec: 1 }], bakes)
      rmSync(copy.bakedPath)
      const rifffs = {
        a: { ...riffOn(copy.bakedPath, source, 1), groupId: 'a' },
        b: { ...riffOn(copy.bakedPath, source, 1), groupId: 'b' }
      }
      const outcomes = await rebuildReonedCopies(planReonedRepair(rifffs), {
        outputDir: bakes,
        libraryRoot: root
      })
      expect(outcomes.map((batch) => batch[0].status)).toEqual(['rebuilt', 'present'])
      expect(readdirSync(bakes)).toEqual([copy.bakedPath.split('/').pop()])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('D5: a LORE copy first baked with metadata seconds-per-bar lands on its own name after durationSec was re-measured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const root = join(dir, 'lib')
      mkdirSync(root)
      const bakes = join(root, '.bakes')
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4010, 1000) // decodes 10 ms longer than its 4 metadata bars
      // The first re-one used metadata durationSec 4 (bpm 240, 4 bars).
      const [copy] = await bakeOffset(
        [{ path: source, rotationSec: rotationSecForBars(1, { barLength: 4, durationSec: 4 }) }],
        bakes
      )
      rmSync(copy.bakedPath)
      // APPLY_BAKE then stored the measured 4.01, so the first candidate rotates 1003 frames,
      // not 1000; only the metadata candidate names the missing file.
      const rifffs = { g: riffOn(copy.bakedPath, source, 1, 4.01) }
      const outcomes = await rebuildReonedCopies(planReonedRepair(rifffs), {
        outputDir: bakes,
        libraryRoot: root
      })
      expect(outcomes[0][0]).toMatchObject({ status: 'rebuilt', bakedPath: copy.bakedPath })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("D5: a stem whose own LORE bpm differs from its riff's (a Discover collage) is matched by the stem's own metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const root = join(dir, 'lib')
      mkdirSync(root)
      const bakes = join(root, '.bakes')
      const source = join(dir, 'source.wav')
      writeRampWav(source, 8010, 1000) // 4 bars at its own 120 bpm: 8 s metadata, 8.01 s decoded
      const [copy] = await bakeOffset(
        [{ path: source, rotationSec: rotationSecForBars(1, { barLength: 4, durationSec: 8 }) }],
        bakes
      )
      rmSync(copy.bakedPath)
      // The riff says 240 bpm (another stem's), and APPLY_BAKE stored the measured 8.01.
      const rifffs = { g: riffOn(copy.bakedPath, source, 1, 8.01) }
      const plan = planReonedRepair(rifffs)
      const dirs = { outputDir: bakes, libraryRoot: root }
      setStemMetadataDurationLookup((path) => (path === source ? 8 : null))
      try {
        const outcomes = await rebuildReonedCopies(plan, dirs)
        expect(outcomes[0][0]).toMatchObject({ status: 'rebuilt', bakedPath: copy.bakedPath })
      } finally {
        setStemMetadataDurationLookup(null)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a rebuild bakes from the original only: a copy back in place by then is not re-copied under a new name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const root = join(dir, 'lib')
      mkdirSync(root)
      const bakes = join(root, '.bakes')
      const copy = join(bakes, 'x.baked.wav')
      mkdirSync(bakes)
      writeRampWav(copy, 4000, 1000) // the copy is there, its original is not
      expect(
        await bakeOffset(
          [
            {
              path: copy,
              rotationSec: 0,
              recipe: { sourcePath: join(dir, 'gone.wav'), rotationSec: 1 },
              recipeOnly: true
            }
          ],
          bakes
        )
      ).toEqual([])
      expect(readdirSync(bakes)).toEqual(['x.baked.wav'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('ensureReonedCopiesForState', () => {
  it('returns the very same state when every copy is present, so the export sees the project as saved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rebuild-'))
    try {
      const copy = join(dir, 'x.baked.wav')
      writeFileSync(copy, 'anything')
      const state = { rifffs: { g: riffOn(copy, '/nowhere.wav', 1) } } as unknown as AppState
      expect(await ensureReonedCopiesForState(state)).toBe(state)
      const none = { rifffs: {} } as unknown as AppState
      expect(await ensureReonedCopiesForState(none)).toBe(none)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

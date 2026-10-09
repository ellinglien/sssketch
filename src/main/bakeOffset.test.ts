import { describe, expect, it, vi } from 'vitest'
import {
  writeFileSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

// Same mock as nativeExport.test.ts (see its own doc comment for why this is
// a faithful stand-in, not a workaround) — bakeOffset's native-routed path
// spawns a real engine process via engineProcess.ts's spawnEngine(), whose
// defaultBinaryPath() resolves through app.getAppPath().
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

import { bakeOffset } from './bakeOffset'
import { BAKER_VERSION, recipeName } from './reonedRecipe'
import { rotationSecForBars } from '@shared/reonedRotation'

/** A 16-bit mono WAV ramping linearly from 0 to just under full scale, so a
 * rotation can be verified by checking which sample value now sits at
 * offset 0 — mirrors native-engine/Source/BakeStemTests.cpp's identical
 * fixture, kept as its own local copy per this codebase's existing
 * convention (each test file owns its own fixture helpers). */
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
    const sample16 = Math.round((i / numSamples) * 32000)
    buf.writeInt16LE(sample16, 44 + i * 2)
  }
  writeFileSync(path, buf)
}

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

describe('bakeOffset', () => {
  it('bakes a .wav job via the existing JS rotation, unaffected by the native routing added alongside it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const path = join(dir, 'source.wav')
      writeRampWav(path, 1000, 1000)
      const results = await bakeOffset([{ path, rotationSec: 0.25 }])
      expect(results).toHaveLength(1)
      expect(results[0].bakedPath).toMatch(/\.sssketch-bakes\/.+\.baked\.wav$/)
      expect(results[0].bakedPath).not.toBe(path)
      // A rotation preserves the exact sample count, so this must still be
      // 1000 samples / 1000Hz = 1 real second, measured from the actual
      // rotated bytes rather than assumed.
      expect(results[0].durationSec).toBeCloseTo(1.0, 5)
      const bytes = readFileSync(results[0].bakedPath)
      const dataOffset = findDataChunkOffset(bytes)
      expect(bytes.readInt16LE(dataOffset)).toBeCloseTo(0.25 * 32000, -2)

      // The rotation moved the ramp's own end→start junction to frame 750
      // (1000 - 250), where full scale meets zero as a hard splice. The bake
      // must have blended it: frame 749 is pulled all the way onto frame 750.
      expect(bytes.readInt16LE(dataOffset + 750 * 2)).toBe(0)
      expect(bytes.readInt16LE(dataOffset + 749 * 2)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not blend a second time when re-baking an already-baked file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const path = join(dir, 'source.wav')
      writeRampWav(path, 1000, 1000)
      const first = await bakeOffset([{ path, rotationSec: 0.25 }])
      const afterFirst = readFileSync(first[0].bakedPath)

      // Re-picking a beat feeds the .baked.wav straight back in (APPLY_BAKE
      // repointed the stem at it). That file's own end→start junction is a
      // pair of frames that were adjacent in the source, so blending it again
      // would smear real audio — and would do so once per re-bake, forever.
      const second = await bakeOffset([{ path: first[0].bakedPath, rotationSec: 0.1 }])
      expect(second[0].bakedPath).not.toBe(first[0].bakedPath)
      // Immutable means the first version's bytes stay exactly as they were
      // while the second version is published at a fresh path.
      expect(readFileSync(first[0].bakedPath)).toEqual(afterFirst)
      const afterSecond = readFileSync(second[0].bakedPath)
      const dataOffset = findDataChunkOffset(afterSecond)
      const firstData = afterFirst.subarray(findDataChunkOffset(afterFirst))
      const secondData = afterSecond.subarray(dataOffset)

      // A pure rotation by 100 frames and nothing else: every frame of the
      // re-baked file is a frame of the previous bake, unmodified.
      for (let frame = 0; frame < 1000; frame++) {
        expect(secondData.readInt16LE(frame * 2)).toBe(
          firstData.readInt16LE(((frame + 100) % 1000) * 2)
        )
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('bakes an extensionless (LORE-style) job through the native engine into an immutable managed asset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      // No extension at all — matches loreWarehouse.ts's resolveStemPath
      // exactly (the path is just the raw StemCID).
      const path = join(dir, 'abcdef0123456789')
      writeRampWav(path, 1000, 1000)

      const results = await bakeOffset([{ path, rotationSec: 0.25 }])
      expect(results).toHaveLength(1)
      expect(results[0].path).toBe(path)
      expect(results[0].bakedPath).toMatch(/\.sssketch-bakes\/.+\.baked\.wav$/)
      expect(existsSync(results[0].bakedPath)).toBe(true)
      // Real bug this covers: this must be MEASURED from the actual decoded
      // Ogg/WAV content (1000 samples / 1000Hz = 1s here), not whatever
      // metadata-derived durationSec the caller already had for the
      // pre-bake source — see BakeResult's own doc comment for why a
      // mismatch there causes audible clicking/stuttering at tile
      // boundaries once this baked file is actually played.
      expect(results[0].durationSec).toBeCloseTo(1.0, 5)

      // Rotating a ramp by 0.25s (sample 250 of 1000) should put that sample's
      // value at the very start of the baked output.
      const bytes = readFileSync(results[0].bakedPath)
      const dataOffset = findDataChunkOffset(bytes)
      expect(bytes.readInt16LE(dataOffset)).toBeCloseTo(0.25 * 32000, -2)

      // BakeStem.cpp rotates without any blend of its own, so the seam it
      // leaves at frame 750 (full scale meeting zero) is blended here in JS
      // afterwards — same fix as the WAV path, no engine change.
      expect(Math.abs(bytes.readInt16LE(dataOffset + 750 * 2))).toBeLessThan(100)
      expect(Math.abs(bytes.readInt16LE(dataOffset + 749 * 2))).toBeLessThan(100)

      // The original source file must be untouched — never overwritten.
      const originalBytes = readFileSync(path)
      expect(originalBytes.readInt16LE(44)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    // 45s, not the previous 20s: this is the only test in the file that
    // spawns the real native engine, so it pays a possible cold-spawn cost
    // (10s+ on the release workflow's x64 leg, where the binary runs
    // translated -- see READINESS_TIMEOUT_MS in engineProcess.ts) AND then
    // waits on engineClient.ts's own 30000ms sendAndAwaitType default for
    // the bake response. 20000 was below that inner response timeout
    // alone, so the outer budget could expire before the thing it was
    // waiting on ever got the chance to.
  }, 45000)

  it('skips (and logs, does not throw) a WAV job with no usable fmt chunk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const path = join(dir, 'bad.wav')
      writeFileSync(path, Buffer.from('not a real wav file'))
      const results = await bakeOffset([{ path, rotationSec: 0.1 }])
      expect(results).toEqual([])
      expect(readdirSync(join(dir, '.sssketch-bakes'))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves to no result, rather than throwing, when the bake folder cannot be made', async () => {
    // As when the library drive is unplugged: the folder's parent is gone or not a folder.
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const path = join(dir, 'source.wav')
      writeRampWav(path, 1000, 1000)
      const notAFolder = join(dir, 'not-a-folder')
      writeFileSync(notAFolder, 'a file')
      await expect(
        bakeOffset([{ path, rotationSec: 0.25 }], join(notAFolder, 'bakes'))
      ).resolves.toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('publishes no stem when any job in the riff fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const good = join(dir, 'good.wav')
      const bad = join(dir, 'bad.wav')
      writeRampWav(good, 1000, 1000)
      writeFileSync(bad, Buffer.from('not a wav'))

      expect(
        await bakeOffset([
          { path: good, rotationSec: 0.25 },
          { path: bad, rotationSec: 0.25 }
        ])
      ).toEqual([])
      expect(readdirSync(join(dir, '.sssketch-bakes'))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('bakeOffset recipes', () => {
  // 4 bars of 1 s at 1000 Hz: bar-aligned rotations are whole frames, and every seam lands far
  // from the edges, where blendSeamInt16 skips its 128-frame blend (a seam frame within 256 of
  // the start). The plan's scratch check found the chain and a direct bake differ only when an
  // earlier re-one put its seam there, so the chain never blended it.
  const stemShape = { barLength: 4, durationSec: 4 }

  it('names a copy by its recipe, and re-oning twice to the same spot writes one file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const out = join(dir, 'bakes')
      const first = await bakeOffset([{ path: source, rotationSec: 1 }], out)
      const info = statSync(source)
      expect(first[0].bakedPath).toBe(
        join(
          out,
          recipeName({ path: source, size: info.size, mtimeMs: info.mtimeMs }, { samples: 1000 })
        )
      )
      const before = statSync(first[0].bakedPath).mtimeMs
      const second = await bakeOffset([{ path: source, rotationSec: 1.0000001 }], out)
      expect(second).toEqual(first)
      expect(readdirSync(out)).toEqual([basename(first[0].bakedPath)])
      expect(statSync(first[0].bakedPath).mtimeMs).toBe(before) // reused, not rewritten
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('PIN: two chained re-ones and a bake from the original at the total phaseBars give the same bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const legacy = join(dir, 'legacy') // today's behaviour: chain, no recipe
      const a = await bakeOffset(
        [{ path: source, rotationSec: rotationSecForBars(1, stemShape) }],
        legacy
      )
      const chained = await bakeOffset(
        [{ path: a[0].bakedPath, rotationSec: rotationSecForBars(0.5, stemShape) }],
        legacy
      )
      // phaseBars after the two re-ones: 0 + 1 + 0.5 (nextPhaseBars). A rebuild bakes the
      // original by rotationSecForBars(phaseBars).
      const out = join(dir, 'bakes')
      const rebuilt = await bakeOffset(
        [
          {
            path: '/missing/copy.baked.wav',
            rotationSec: 0,
            recipe: { sourcePath: source, rotationSec: rotationSecForBars(1.5, stemShape) }
          }
        ],
        out
      )
      expect(readFileSync(rebuilt[0].bakedPath)).toEqual(readFileSync(chained[0].bakedPath))
      expect(rebuilt[0].path).toBe('/missing/copy.baked.wav')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a re-one of an already re-oned stem bakes from the original when it is there, and chains when it is not', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const out = join(dir, 'bakes')
      const [copy] = await bakeOffset([{ path: source, rotationSec: 1 }], out)
      const job = {
        path: copy.bakedPath,
        rotationSec: 0.5,
        recipe: { sourcePath: source, rotationSec: 1.5 }
      }
      const [fromOriginal] = await bakeOffset([job], out)
      expect(fromOriginal.path).toBe(copy.bakedPath) // results stay keyed by the job's path
      const [direct] = await bakeOffset([{ path: source, rotationSec: 1.5 }], out)
      expect(fromOriginal.bakedPath).toBe(direct.bakedPath) // reuse: same recipe, one file
      rmSync(source)
      const [chained] = await bakeOffset([job], out)
      expect(chained.bakedPath).not.toBe(fromOriginal.bakedPath) // named from the copy it came from
      expect(readFileSync(chained.bakedPath)).toEqual(readFileSync(fromOriginal.bakedPath))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns one result per job in job order, sharing one render for two jobs on one recipe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const out = join(dir, 'bakes')
      const results = await bakeOffset(
        [
          { path: source, rotationSec: 2 },
          { path: source, rotationSec: 1 },
          { path: source, rotationSec: 2 }
        ],
        out
      )
      expect(results.map((r) => r.path)).toEqual([source, source, source])
      expect(results[0].bakedPath).toBe(results[2].bakedPath)
      expect(results[1].bakedPath).not.toBe(results[0].bakedPath)
      expect(readdirSync(out).sort()).toEqual(
        [basename(results[0].bakedPath), basename(results[1].bakedPath)].sort()
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a failed batch deletes nothing it did not create, even a copy it was about to reuse', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const bad = join(dir, 'bad.wav')
      writeFileSync(bad, Buffer.from('not a wav'))
      const out = join(dir, 'bakes')
      const [shared] = await bakeOffset([{ path: source, rotationSec: 1 }], out)
      for (const failing of [join(dir, 'gone.wav'), bad]) {
        const results = await bakeOffset(
          [
            { path: source, rotationSec: 1 }, // reuses `shared`
            { path: source, rotationSec: 2 }, // would be new
            { path: failing, rotationSec: 1 } // fails the batch: unreadable, or won't render
          ],
          out
        )
        expect(results).toEqual([])
        expect(readdirSync(out)).toEqual([basename(shared.bakedPath)])
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reuses a native (LORE-style) copy too: the second bake of the same recipe spawns nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const path = join(dir, 'abcdef0123456789')
      writeRampWav(path, 1000, 1000)
      const out = join(dir, 'bakes')
      const first = await bakeOffset([{ path, rotationSec: 0.25 }], out)
      expect(first).toHaveLength(1)
      const before = statSync(first[0].bakedPath).mtimeMs
      const second = await bakeOffset([{ path, rotationSec: 0.25 }], out)
      expect(second).toEqual(first)
      expect(readdirSync(out)).toEqual([basename(first[0].bakedPath)])
      expect(statSync(first[0].bakedPath).mtimeMs).toBe(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 45000)

  it('refuses to recreate a library root that is not there (an unplugged drive, a moved folder)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const out = join(dir, 'unplugged-root', '.bakes')
      expect(await bakeOffset([{ path: source, rotationSec: 1 }], out)).toEqual([])
      expect(existsSync(join(dir, 'unplugged-root'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates the default library root when asked (a fresh install that has never saved)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const out = join(dir, 'Music', 'sssketch', 'projects', '.bakes')
      const results = await bakeOffset([{ path: source, rotationSec: 1 }], out, {
        mayCreateRoot: true
      })
      expect(results).toHaveLength(1)
      expect(existsSync(results[0].bakedPath)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a copy cut short is not reused: it is rendered again, whole', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const out = join(dir, 'bakes')
      const [first] = await bakeOffset([{ path: source, rotationSec: 1 }], out)
      const whole = readFileSync(first.bakedPath)
      writeFileSync(first.bakedPath, whole.subarray(0, 2000))
      const [second] = await bakeOffset([{ path: source, rotationSec: 1 }], out)
      expect(second.bakedPath).toBe(first.bakedPath)
      expect(second.durationSec).toBeCloseTo(4, 5)
      expect(readFileSync(second.bakedPath)).toEqual(whole)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a failed batch never deletes a file that was at a final name before it, even one it rendered over', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-test-'))
    try {
      const source = join(dir, 'source.wav')
      writeRampWav(source, 4000, 1000)
      const out = join(dir, 'bakes')
      mkdirSync(out)
      const info = statSync(source)
      const identity = { path: source, size: info.size, mtimeMs: info.mtimeMs }
      // A's final is there but unreadable (rendered over); B's final name is taken by a folder,
      // so publishing B fails after A was already renamed into place.
      const finalA = join(out, recipeName(identity, { samples: 1000 }))
      const finalB = join(out, recipeName(identity, { samples: 2000 }))
      writeFileSync(finalA, 'garbage')
      mkdirSync(finalB)
      const results = await bakeOffset(
        [
          { path: source, rotationSec: 1 },
          { path: source, rotationSec: 2 }
        ],
        out
      )
      expect(results).toEqual([])
      expect(existsSync(finalA)).toBe(true)
      expect(readdirSync(out).sort()).toEqual([basename(finalA), basename(finalB)].sort())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// What guards BAKER_VERSION. A copy is reused by its recipe name, which names the baker's version,
// not its bytes: if the baker's output changes and the version doesn't, every existing copy is
// still reused and a rebuilt one no longer matches it. So the bytes of one WAV bake and one native
// (LORE-style, Ogg) bake are pinned per version. A failure here means: bump BAKER_VERSION in
// reonedRecipe.ts, then record the new hashes under the new version.
const GOLDEN_BAKES: Record<number, { wav: string; native: string }> = {
  1: {
    wav: '6930acd04f1977f9cac54439f325eb7ca9d9fb12353ffb284df18059553c757e',
    native: 'a8bce419a6f113ee6e867b890e02f4f1cca41d846257de13ce1c4dc106c8bfb5'
  }
}
const BAKER_CHANGED = 'baker output changed: bump BAKER_VERSION'

/** Stereo 16-bit 44.1 kHz, half a second, from integer arithmetic only (no Math.sin), so the
 * source bytes are the same on every machine. */
function writeGoldenSourceWav(path: string): void {
  const frames = 22050
  const dataSize = frames * 4
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(44100, 24)
  buf.writeUInt32LE(44100 * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  let seed = 12345
  for (let i = 0; i < frames; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    const saw = ((i * 200) % 32768) - 16384
    buf.writeInt16LE(saw, 44 + i * 4)
    buf.writeInt16LE((seed % 20000) - 10000, 44 + i * 4 + 2)
  }
  writeFileSync(path, buf)
}

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex')

describe('bakeOffset golden output (BAKER_VERSION)', () => {
  it('this baker version has recorded hashes', () => {
    expect(
      GOLDEN_BAKES[BAKER_VERSION],
      'record GOLDEN_BAKES for the new BAKER_VERSION'
    ).toBeDefined()
  })

  it('a WAV bake is byte-for-byte what this baker version made', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-golden-'))
    try {
      const source = join(dir, 'source.wav')
      writeGoldenSourceWav(source)
      const [baked] = await bakeOffset([{ path: source, rotationSec: 0.3 }], join(dir, 'bakes'))
      expect(sha256(baked.bakedPath), BAKER_CHANGED).toBe(GOLDEN_BAKES[BAKER_VERSION]?.wav)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a native (LORE-style Ogg) bake is byte-for-byte what this baker version made', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-golden-'))
    try {
      // Extensionless, as a LORE StemCID is: routed through the engine's decode.
      const source = join(dir, '0123456789abcdef01234567')
      writeFileSync(source, readFileSync(join(process.cwd(), 'fixtures/reone-golden/tone.ogg')))
      const [baked] = await bakeOffset([{ path: source, rotationSec: 0.2 }], join(dir, 'bakes'))
      expect(sha256(baked.bakedPath), BAKER_CHANGED).toBe(GOLDEN_BAKES[BAKER_VERSION]?.native)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 45000)
})

// src/main/projectLibrary.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string
let musicDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'music' ? musicDir : userDataDir)
  }
}))

describe('projectLibrary', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-userdata-test-'))
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-music-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(musicDir, { recursive: true, force: true })
  })

  describe('libraryRootPath / setLibraryRootPath', () => {
    it('defaults to <music>/sssketch when no preference has been set', async () => {
      const { libraryRootPath } = await import('./projectLibrary')
      expect(libraryRootPath()).toBe(join(musicDir, 'sssketch'))
    })

    it('returns a previously-set custom root', async () => {
      const { libraryRootPath, setLibraryRootPath } = await import('./projectLibrary')
      const customRoot = join(musicDir, 'elsewhere')
      setLibraryRootPath(customRoot)
      expect(libraryRootPath()).toBe(customRoot)
    })
  })

  describe('sketch path helpers', () => {
    it('derives every per-sketch path from the library root and sketch name', async () => {
      const { sketchDir, sketchProjectPath, sketchMetaPath, sketchAbletonDir, samplesCacheDir } =
        await import('./projectLibrary')
      const root = join(musicDir, 'sssketch')
      expect(sketchDir('my-sketch')).toBe(join(root, 'my-sketch'))
      expect(sketchProjectPath('my-sketch')).toBe(join(root, 'my-sketch', 'my-sketch.sssketchproj'))
      expect(sketchMetaPath('my-sketch')).toBe(join(root, 'my-sketch', '.sssketch-meta.json'))
      expect(sketchAbletonDir('my-sketch')).toBe(join(root, 'my-sketch', 'Ableton'))
      expect(samplesCacheDir()).toBe(join(root, '.samples-cache'))
    })
  })

  describe('isWavPath', () => {
    it('is true only for a .wav extension, case-insensitively', async () => {
      const { isWavPath } = await import('./projectLibrary')
      expect(isWavPath('/a/b/stem.wav')).toBe(true)
      expect(isWavPath('/a/b/stem.WAV')).toBe(true)
      expect(isWavPath('/a/b/9f8a7b2c1d')).toBe(false)
      expect(isWavPath('/a/b/stem.flac')).toBe(false)
    })
  })

  describe('stemCacheKey', () => {
    it('uses the basename directly for a non-WAV (LORE-cached) path', async () => {
      const { stemCacheKey } = await import('./projectLibrary')
      expect(stemCacheKey('/warehouse/cache/common/stem_v2/abc/d/9f8a7b2c1d')).toBe('9f8a7b2c1d')
    })

    it('derives a stable hash from path+size+mtime for a .wav path', async () => {
      const { stemCacheKey } = await import('./projectLibrary')
      const wavPath = join(userDataDir, 'a.wav')
      writeFileSync(wavPath, 'fake wav bytes')
      const key1 = stemCacheKey(wavPath)
      const key2 = stemCacheKey(wavPath)
      expect(key1).toBe(key2)
      expect(key1).toMatch(/^[a-f0-9]+$/)
    })

    it('produces a different key when the wav file content/size changes', async () => {
      const { stemCacheKey } = await import('./projectLibrary')
      const wavPath = join(userDataDir, 'b.wav')
      writeFileSync(wavPath, 'short')
      const keyBefore = stemCacheKey(wavPath)
      writeFileSync(wavPath, 'a much longer set of fake wav bytes than before')
      const keyAfter = stemCacheKey(wavPath)
      expect(keyBefore).not.toBe(keyAfter)
    })
  })

  describe('cachedStemPath', () => {
    it('joins the cache dir with the derived key and a .wav extension', async () => {
      const { cachedStemPath, samplesCacheDir } = await import('./projectLibrary')
      const path = cachedStemPath('/warehouse/cache/common/stem_v2/abc/d/9f8a7b2c1d')
      expect(path).toBe(join(samplesCacheDir(), '9f8a7b2c1d.wav'))
    })
  })

  describe('cloneOrCopy', () => {
    it('produces an independent file with the same content as the source', async () => {
      const { cloneOrCopy } = await import('./projectLibrary')
      const src = join(userDataDir, 'src.wav')
      const dest = join(userDataDir, 'dest.wav')
      writeFileSync(src, 'clone me')
      cloneOrCopy(src, dest)
      expect(readFileSync(dest, 'utf-8')).toBe('clone me')
    })
  })

  describe('listLibrarySketches', () => {
    it('returns an empty array when the library root does not exist yet', async () => {
      const { listLibrarySketches } = await import('./projectLibrary')
      expect(listLibrarySketches()).toEqual([])
    })

    it('lists only subfolders containing a matching .sssketchproj, excluding .samples-cache', async () => {
      const { listLibrarySketches, libraryRootPath } = await import('./projectLibrary')
      const root = libraryRootPath()
      mkdirSync(join(root, 'sketch-a'), { recursive: true })
      writeFileSync(join(root, 'sketch-a', 'sketch-a.sssketchproj'), '{}')
      mkdirSync(join(root, 'sketch-b'), { recursive: true })
      writeFileSync(join(root, 'sketch-b', 'sketch-b.sssketchproj'), '{}')
      mkdirSync(join(root, '.samples-cache'), { recursive: true })
      mkdirSync(join(root, 'empty-folder'), { recursive: true })

      const sketches = listLibrarySketches()
      expect(sketches.map((s) => s.name).sort()).toEqual(['sketch-a', 'sketch-b'])
    })
  })

  describe('nextVersionName', () => {
    it('appends -2 to a base name with no existing numbered siblings', async () => {
      const { nextVersionName } = await import('./projectLibrary')
      expect(nextVersionName('outdoor-jam', [])).toBe('outdoor-jam-2')
    })

    it('finds the next unused number when some already exist', async () => {
      const { nextVersionName } = await import('./projectLibrary')
      expect(nextVersionName('outdoor-jam', ['outdoor-jam', 'outdoor-jam-2'])).toBe('outdoor-jam-3')
    })

    it('strips an existing trailing -N from the base before computing, so duplicating a duplicate does not stack suffixes', async () => {
      const { nextVersionName } = await import('./projectLibrary')
      expect(nextVersionName('outdoor-jam-2', ['outdoor-jam', 'outdoor-jam-2'])).toBe(
        'outdoor-jam-3'
      )
    })
  })

  describe('sketch meta / overwrite safety', () => {
    it('readSketchMeta returns an empty object when no meta file exists', async () => {
      const { readSketchMeta } = await import('./projectLibrary')
      expect(readSketchMeta('nonexistent-sketch')).toEqual({})
    })

    it('writeSketchMeta then readSketchMeta round-trips', async () => {
      const { writeSketchMeta, readSketchMeta } = await import('./projectLibrary')
      writeSketchMeta('a-sketch', { lastExportAlsMtimeMs: 12345 })
      expect(readSketchMeta('a-sketch')).toEqual({ lastExportAlsMtimeMs: 12345 })
    })

    it('shouldWarnBeforeOverwrite is false when no .als has ever been exported', async () => {
      const { shouldWarnBeforeOverwrite } = await import('./projectLibrary')
      expect(shouldWarnBeforeOverwrite('never-exported')).toBe(false)
    })

    it('shouldWarnBeforeOverwrite is false when the .als mtime matches the last recorded export', async () => {
      const { shouldWarnBeforeOverwrite, sketchAbletonDir, writeSketchMeta } =
        await import('./projectLibrary')
      const { statSync } = await import('node:fs')
      const dir = sketchAbletonDir('matching-sketch')
      mkdirSync(dir, { recursive: true })
      const alsPath = join(dir, 'matching-sketch.als')
      writeFileSync(alsPath, 'fake als bytes')
      const mtimeMs = statSync(alsPath).mtimeMs
      writeSketchMeta('matching-sketch', { lastExportAlsMtimeMs: mtimeMs })
      expect(shouldWarnBeforeOverwrite('matching-sketch')).toBe(false)
    })

    it('shouldWarnBeforeOverwrite is true when the .als has been modified since the last recorded export', async () => {
      const { shouldWarnBeforeOverwrite, sketchAbletonDir, writeSketchMeta } =
        await import('./projectLibrary')
      const dir = sketchAbletonDir('touched-sketch')
      mkdirSync(dir, { recursive: true })
      const alsPath = join(dir, 'touched-sketch.als')
      writeFileSync(alsPath, 'fake als bytes')
      writeSketchMeta('touched-sketch', { lastExportAlsMtimeMs: 1 }) // deliberately stale
      expect(shouldWarnBeforeOverwrite('touched-sketch')).toBe(true)
    })
  })
})

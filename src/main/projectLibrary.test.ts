// src/main/projectLibrary.test.ts
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string
let musicDir: string
let trashItemMock: Mock

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'music' ? musicDir : userDataDir)
  },
  shell: {
    trashItem: (path: string) => trashItemMock(path)
  }
}))

describe('projectLibrary', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-userdata-test-'))
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-music-test-'))
    trashItemMock = vi.fn(async () => {})
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(musicDir, { recursive: true, force: true })
  })

  describe('libraryRootPath / setLibraryRootPath', () => {
    it('defaults to <music>/sssketch/projects when no preference has been set', async () => {
      const { libraryRootPath } = await import('./projectLibrary')
      expect(libraryRootPath()).toBe(join(musicDir, 'sssketch', 'projects'))
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
      const {
        sketchDir,
        sketchProjectPath,
        sketchMetaPath,
        sketchAbletonDir,
        sketchReaperDir,
        sketchStemsDir,
        samplesCacheDir
      } = await import('./projectLibrary')
      const root = join(musicDir, 'sssketch', 'projects')
      expect(sketchDir('my-sketch')).toBe(join(root, 'my-sketch'))
      expect(sketchProjectPath('my-sketch')).toBe(join(root, 'my-sketch', 'my-sketch.sssketchproj'))
      expect(sketchMetaPath('my-sketch')).toBe(join(root, 'my-sketch', '.sssketch-meta.json'))
      expect(sketchAbletonDir('my-sketch')).toBe(join(root, 'my-sketch', 'Ableton'))
      expect(sketchReaperDir('my-sketch')).toBe(join(root, 'my-sketch', 'Reaper'))
      expect(sketchStemsDir('my-sketch')).toBe(join(root, 'my-sketch', 'Stems'))
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

    it('marks every sketch favourite: false by default', async () => {
      const { listLibrarySketches, libraryRootPath } = await import('./projectLibrary')
      const root = libraryRootPath()
      mkdirSync(join(root, 'sketch-a'), { recursive: true })
      writeFileSync(join(root, 'sketch-a', 'sketch-a.sssketchproj'), '{}')

      const sketches = listLibrarySketches()
      expect(sketches).toEqual([expect.objectContaining({ name: 'sketch-a', favourite: false })])
    })

    it('sorts favourited sketches before non-favourited ones, each group newest-first', async () => {
      const { listLibrarySketches, libraryRootPath, toggleSketchFavourite } =
        await import('./projectLibrary')
      const root = libraryRootPath()
      // Creation order also becomes mtime order here, oldest first: a, b, c, d.
      for (const name of ['sketch-a', 'sketch-b', 'sketch-c', 'sketch-d']) {
        mkdirSync(join(root, name), { recursive: true })
        writeFileSync(join(root, name, `${name}.sssketchproj`), '{}')
      }
      // Favourite the two OLDER sketches (a, b) -- if favourite status were
      // ignored, they'd sort last, not first.
      toggleSketchFavourite('sketch-a')
      toggleSketchFavourite('sketch-b')

      const sketches = listLibrarySketches()
      expect(sketches.map((s) => s.name)).toEqual(['sketch-b', 'sketch-a', 'sketch-d', 'sketch-c'])
      expect(sketches.map((s) => s.favourite)).toEqual([true, true, false, false])
    })
  })

  describe('toggleSketchFavourite', () => {
    it('flips a sketch from not-favourited to favourited and back', async () => {
      const { toggleSketchFavourite, readSketchMeta } = await import('./projectLibrary')
      expect(readSketchMeta('a-sketch').favourite).toBeUndefined()
      expect(toggleSketchFavourite('a-sketch')).toBe(true)
      expect(readSketchMeta('a-sketch').favourite).toBe(true)
      expect(toggleSketchFavourite('a-sketch')).toBe(false)
      expect(readSketchMeta('a-sketch').favourite).toBe(false)
    })

    it('preserves other meta fields already recorded for the sketch', async () => {
      const { toggleSketchFavourite, writeSketchMeta, readSketchMeta } =
        await import('./projectLibrary')
      writeSketchMeta('a-sketch', { lastExportAlsMtimeMs: 999 })
      toggleSketchFavourite('a-sketch')
      expect(readSketchMeta('a-sketch')).toEqual({ lastExportAlsMtimeMs: 999, favourite: true })
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

    it('throws a clear error instead of looping unboundedly when every candidate up to the cap is taken', async () => {
      const { nextVersionName } = await import('./projectLibrary')
      const existingNames = ['outdoor-jam']
      for (let n = 2; n <= 1000; n++) existingNames.push(`outdoor-jam-${n}`)
      expect(() => nextVersionName('outdoor-jam', existingNames)).toThrow(
        "nextVersionName: could not find an unused name for 'outdoor-jam' after 1000 attempts"
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

  describe('renameSketch', () => {
    it('renames the sketch directory and its inner .sssketchproj file', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { renameSketch, sketchDir, sketchProjectPath } = await import('./projectLibrary')
      saveProjectToLibrary('old-name', '{"rifffs":{}}')
      const result = renameSketch('old-name', 'new-name')
      expect(result).toEqual({ ok: true, name: 'new-name' })
      expect(existsSync(sketchDir('old-name'))).toBe(false)
      expect(existsSync(sketchProjectPath('new-name'))).toBe(true)
      expect(readFileSync(sketchProjectPath('new-name'), 'utf-8')).toBe('{"rifffs":{}}')
    })

    it('renames an existing Ableton/<name>.als alongside it', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { renameSketch, sketchAbletonDir } = await import('./projectLibrary')
      saveProjectToLibrary('old-name', '{"rifffs":{}}')
      mkdirSync(sketchAbletonDir('old-name'), { recursive: true })
      writeFileSync(join(sketchAbletonDir('old-name'), 'old-name.als'), 'fake als bytes')
      renameSketch('old-name', 'new-name')
      expect(existsSync(join(sketchAbletonDir('new-name'), 'new-name.als'))).toBe(true)
      expect(existsSync(join(sketchAbletonDir('new-name'), 'old-name.als'))).toBe(false)
    })

    it('leaves a sketch with no .als yet untouched on that front', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { renameSketch, sketchAbletonDir } = await import('./projectLibrary')
      saveProjectToLibrary('old-name', '{"rifffs":{}}')
      const result = renameSketch('old-name', 'new-name')
      expect(result).toEqual({ ok: true, name: 'new-name' })
      expect(existsSync(sketchAbletonDir('new-name'))).toBe(false)
    })

    it('rejects when the target name already exists, leaving the original untouched', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { renameSketch, sketchDir } = await import('./projectLibrary')
      saveProjectToLibrary('old-name', '{"rifffs":{}}')
      saveProjectToLibrary('taken-name', '{"rifffs":{}}')
      const result = renameSketch('old-name', 'taken-name')
      expect(result.ok).toBe(false)
      expect(existsSync(sketchDir('old-name'))).toBe(true)
    })
  })

  describe('deleteSketch', () => {
    it('returns ok:false when the sketch does not exist', async () => {
      const { deleteSketch } = await import('./projectLibrary')
      const result = await deleteSketch('does-not-exist')
      expect(result).toEqual({ ok: false, reason: 'no sketch named "does-not-exist"' })
      expect(trashItemMock).not.toHaveBeenCalled()
    })

    it('moves the sketch directory to the trash and returns ok:true', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { deleteSketch, sketchDir } = await import('./projectLibrary')
      saveProjectToLibrary('to-delete', '{"rifffs":{}}')
      const result = await deleteSketch('to-delete')
      expect(result).toEqual({ ok: true })
      expect(trashItemMock).toHaveBeenCalledWith(sketchDir('to-delete'))
    })

    it('returns ok:false with the error reason when trashItem fails', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { deleteSketch } = await import('./projectLibrary')
      saveProjectToLibrary('to-delete-2', '{"rifffs":{}}')
      trashItemMock.mockRejectedValueOnce(new Error('permission denied'))
      const result = await deleteSketch('to-delete-2')
      expect(result).toEqual({ ok: false, reason: 'permission denied' })
    })
  })

  // Small real delay between saves -- guarantees each rotated backup gets a
  // distinct mtime to sort by, same as two real autosaves would naturally
  // have seconds apart. Synchronous back-to-back saves could otherwise land
  // in the same filesystem-mtime tick, making "newest first" ordering
  // untestable (not a real-world concern: the debounced autosave this
  // guards is 4s apart, an explicit Save is human-paced).
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

  describe('rotateBackupBeforeOverwrite / listSketchBackups', () => {
    it('does nothing when the sketch has no project file yet', async () => {
      const { rotateBackupBeforeOverwrite, listSketchBackups } = await import('./projectLibrary')
      rotateBackupBeforeOverwrite('brand-new')
      expect(listSketchBackups('brand-new')).toEqual([])
    })

    it('backs up the current file before a save overwrites it', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { listSketchBackups } = await import('./projectLibrary')
      saveProjectToLibrary('my-sketch', '{"rifffs":{"first":true}}')
      saveProjectToLibrary('my-sketch', '{"rifffs":{"second":true}}')
      const backups = listSketchBackups('my-sketch')
      expect(backups).toHaveLength(1)
      expect(readFileSync(backups[0].path, 'utf-8')).toBe('{"rifffs":{"first":true}}')
    })

    it('keeps only the most recent MAX_BACKUPS (15), newest first', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { listSketchBackups } = await import('./projectLibrary')
      for (let i = 0; i < 17; i++) {
        saveProjectToLibrary('many-saves', `{"rifffs":{"n":${i}}}`)
        await tick()
      }
      const backups = listSketchBackups('many-saves')
      expect(backups).toHaveLength(15)
      // Saves 0..16 each back up the PREVIOUS content just before
      // overwriting -- so the 17 saves produce backups of versions 0..15
      // (save 16's own content is still live, never backed up). Newest 15
      // kept: versions 15 down to 1 (version 0 pruned).
      const contents = backups.map((b) => JSON.parse(readFileSync(b.path, 'utf-8')).rifffs.n)
      expect(contents).toEqual(Array.from({ length: 15 }, (_, idx) => 15 - idx))
    })

    it('returns an empty list for a sketch that was only ever saved once', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { listSketchBackups } = await import('./projectLibrary')
      saveProjectToLibrary('once-only', '{"rifffs":{}}')
      expect(listSketchBackups('once-only')).toEqual([])
    })
  })

  describe('restoreSketchBackup', () => {
    it('restores an older version as the live project file', async () => {
      const { saveProjectToLibrary, openLibrarySketch } = await import('./projectFile')
      const { listSketchBackups, restoreSketchBackup } = await import('./projectLibrary')
      saveProjectToLibrary('restore-me', '{"rifffs":{"n":0}}')
      await tick()
      saveProjectToLibrary('restore-me', '{"rifffs":{"n":1}}')
      const [backup] = listSketchBackups('restore-me')
      const result = restoreSketchBackup('restore-me', backup.path)
      expect(result).toEqual({ ok: true })
      expect(openLibrarySketch('restore-me')?.json).toBe('{"rifffs":{"n":0}}')
    })

    it('backs up the version it replaces, so restoring is itself undoable', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { listSketchBackups, restoreSketchBackup } = await import('./projectLibrary')
      saveProjectToLibrary('undo-restore', '{"rifffs":{"n":0}}')
      await tick()
      saveProjectToLibrary('undo-restore', '{"rifffs":{"n":1}}')
      const [backupOfN0] = listSketchBackups('undo-restore')
      restoreSketchBackup('undo-restore', backupOfN0.path)
      const backupsAfterRestore = listSketchBackups('undo-restore')
      const contents = backupsAfterRestore.map(
        (b) => JSON.parse(readFileSync(b.path, 'utf-8')).rifffs.n
      )
      expect(contents).toContain(1)
    })

    it("rejects a backup path outside this sketch's own backups folder", async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { restoreSketchBackup, sketchProjectPath } = await import('./projectLibrary')
      saveProjectToLibrary('sketch-a', '{"rifffs":{"n":0}}')
      await tick()
      saveProjectToLibrary('sketch-a', '{"rifffs":{"n":1}}')
      saveProjectToLibrary('sketch-b', '{"rifffs":{"other":true}}')
      const result = restoreSketchBackup('sketch-b', sketchProjectPath('sketch-a'))
      expect(result.ok).toBe(false)
    })

    it('returns ok:false when the backup no longer exists', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { restoreSketchBackup, sketchBackupsDir } = await import('./projectLibrary')
      saveProjectToLibrary('gone', '{"rifffs":{}}')
      const result = restoreSketchBackup(
        'gone',
        join(sketchBackupsDir('gone'), 'nope.sssketchproj')
      )
      expect(result).toEqual({ ok: false, reason: 'that backup no longer exists' })
    })
  })
})

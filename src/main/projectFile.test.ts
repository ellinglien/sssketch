import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateDefaultProjectName, randomAdjectiveNoun } from './projectFile'

// vi.mock calls are hoisted to the top of the file by vitest's own
// transform, but ONLY when they're a top-level statement (not nested
// inside a describe/beforeEach callback) -- must sit here, matching
// pluginCatalog.test.ts's own exact placement, not nested further down.
// generateDefaultProjectName itself never calls app.getPath, so this mock
// being globally active for the whole file doesn't affect its own tests
// below -- it's simply unused for those.
let userDataDir: string
let musicDir: string

const dialogPick = vi.hoisted(() => ({ path: '' }))
// A write to a path matching `pattern` puts half its data there, then fails (a crash or a full
// disk midway). Every other write passes through.
const tornWrite = vi.hoisted(() => ({ pattern: null as RegExp | null }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const writeFileSync: typeof actual.writeFileSync = (file, data, options) => {
    if (tornWrite.pattern && typeof file === 'string' && tornWrite.pattern.test(file)) {
      actual.writeFileSync(file, String(data).slice(0, Math.floor(String(data).length / 2)))
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    }
    actual.writeFileSync(file, data, options)
  }
  return { ...actual, default: { ...actual, writeFileSync }, writeFileSync }
})
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'music' ? musicDir : userDataDir)
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [dialogPick.path] }),
    showSaveDialog: async () => ({ canceled: false, filePath: dialogPick.path })
  }
}))

describe('generateDefaultProjectName', () => {
  it('formats as YYYY-MM-DD-adjective-noun + emoji for a given date', () => {
    const name = generateDefaultProjectName(new Date(2026, 7, 1)) // August 1, 2026
    expect(name).toMatch(/^2026-08-01-[a-z]+-[a-z]+-\p{Extended_Pictographic}$/u)
  })

  it('zero-pads single-digit month and day', () => {
    const name = generateDefaultProjectName(new Date(2026, 0, 5)) // January 5, 2026
    expect(name).toMatch(/^2026-01-05-[a-z]+-[a-z]+-\p{Extended_Pictographic}$/u)
  })

  it('varies the adjective-noun pair across calls (not a fixed pair)', () => {
    const date = new Date(2026, 7, 1)
    const names = new Set(Array.from({ length: 20 }, () => generateDefaultProjectName(date)))
    expect(names.size).toBeGreaterThan(1)
  })

  it('varies the emoji across calls (not a fixed one)', () => {
    const date = new Date(2026, 7, 1)
    const emojis = new Set(
      Array.from({ length: 30 }, () => generateDefaultProjectName(date).split('-').pop())
    )
    expect(emojis.size).toBeGreaterThan(1)
  })
})

describe('randomAdjectiveNoun', () => {
  it('formats as "adjective noun", space-joined not hyphenated', () => {
    expect(randomAdjectiveNoun()).toMatch(/^[a-z]+ [a-z]+$/)
  })

  it('varies across calls (not a fixed pair)', () => {
    const names = new Set(Array.from({ length: 20 }, () => randomAdjectiveNoun()))
    expect(names.size).toBeGreaterThan(1)
  })
})

describe('library-aware project functions', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-userdata-test-'))
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-music-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(musicDir, { recursive: true, force: true })
  })

  describe('saveProjectToLibrary', () => {
    it('creates the sketch folder and writes the project file, no dialog involved', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { sketchProjectPath } = await import('./projectLibrary')
      const result = saveProjectToLibrary('my-sketch', '{"bpm":120}')
      expect(result.path).toBe(sketchProjectPath('my-sketch'))
      expect(existsSync(result.path)).toBe(true)
      expect(readFileSync(result.path, 'utf-8')).toBe('{"bpm":120}')
    })

    it('overwrites in place on a second call with the same name', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      saveProjectToLibrary('my-sketch', '{"bpm":120}')
      const result = saveProjectToLibrary('my-sketch', '{"bpm":140}')
      expect(readFileSync(result.path, 'utf-8')).toBe('{"bpm":140}')
    })
  })

  describe('saveProjectInPlace', () => {
    it('writes json directly to the given path with no dialog', async () => {
      const { saveProjectInPlace } = await import('./projectFile')
      const path = join(userDataDir, 'external.sssketchproj')
      saveProjectInPlace(path, '{"bpm":100}')
      expect(readFileSync(path, 'utf-8')).toBe('{"bpm":100}')
    })
  })

  describe('openLibrarySketch', () => {
    it('reads back a previously-saved library sketch', async () => {
      const { saveProjectToLibrary, openLibrarySketch } = await import('./projectFile')
      saveProjectToLibrary('readback-sketch', '{"bpm":90}')
      const result = openLibrarySketch('readback-sketch')
      expect(result).not.toBeNull()
      expect(result!.json).toBe('{"bpm":90}')
    })

    it('returns null for a sketch that does not exist', async () => {
      const { openLibrarySketch } = await import('./projectFile')
      expect(openLibrarySketch('nonexistent')).toBeNull()
    })
  })

  describe('duplicateSketchAsNewVersion', () => {
    it('writes the given json (the live project) into a new -2 named sketch', async () => {
      const { saveProjectToLibrary, duplicateSketchAsNewVersion, openLibrarySketch } =
        await import('./projectFile')
      saveProjectToLibrary('outdoor-jam', '{"bpm":128}')
      const result = duplicateSketchAsNewVersion('outdoor-jam', '{"bpm":140}')
      expect(result).not.toBeNull()
      expect(result!.name).toBe('outdoor-jam-2')
      const reopened = openLibrarySketch('outdoor-jam-2')
      expect(reopened!.json).toBe('{"bpm":140}')
    })

    it('leaves the original sketch byte-identical, its folder included', async () => {
      const { saveProjectToLibrary, duplicateSketchAsNewVersion } = await import('./projectFile')
      const { sketchDir } = await import('./projectLibrary')
      saveProjectToLibrary('outdoor-jam', '{"bpm":128,"pluginStates":{"master:0":"A"}}')
      saveProjectToLibrary('outdoor-jam', '{"bpm":129,"pluginStates":{"master:0":"B"}}') // a backup too
      const snapshot = (): Record<string, string> => {
        const out: Record<string, string> = {}
        const walk = (dir: string): void => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name)
            if (entry.isDirectory()) walk(path)
            else out[path] = readFileSync(path).toString('base64')
          }
        }
        walk(sketchDir('outdoor-jam'))
        return out
      }
      const before = snapshot()
      duplicateSketchAsNewVersion('outdoor-jam', '{"bpm":140,"pluginStates":{"master:0":"LIVE"}}')
      expect(snapshot()).toEqual(before)
    })

    it('returns null when the source sketch does not exist', async () => {
      const { duplicateSketchAsNewVersion } = await import('./projectFile')
      expect(duplicateSketchAsNewVersion('does-not-exist', '{}')).toBeNull()
    })
  })
})

describe('renameExternalSketchFile', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sssketch-external-rename-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('renames the file in place, keeping its directory and extension', async () => {
    const { renameExternalSketchFile } = await import('./projectFile')
    const oldPath = join(dir, 'old-name.sssketchproj')
    writeFileSync(oldPath, '{"rifffs":{}}')
    const result = renameExternalSketchFile(oldPath, 'new-name')
    expect(result).toEqual({ ok: true, path: join(dir, 'new-name.sssketchproj') })
    expect(existsSync(oldPath)).toBe(false)
    expect(readFileSync(join(dir, 'new-name.sssketchproj'), 'utf-8')).toBe('{"rifffs":{}}')
  })

  it('rejects when the target filename already exists', async () => {
    const { renameExternalSketchFile } = await import('./projectFile')
    const oldPath = join(dir, 'old-name.sssketchproj')
    writeFileSync(oldPath, '{"rifffs":{}}')
    writeFileSync(join(dir, 'taken-name.sssketchproj'), '{}')
    const result = renameExternalSketchFile(oldPath, 'taken-name')
    expect(result.ok).toBe(false)
    expect(existsSync(oldPath)).toBe(true)
  })
})

// The crash-recovery snapshot (writeAutosave/loadAutosave/clearAutosave). A previous session's
// snapshot that has been offered (loadAutosave) and not yet recovered or discarded is never
// overwritten or deleted by this session: it is moved aside to one kept previous snapshot,
// offered again at the next launch.
describe('crash-recovery snapshot', () => {
  beforeEach(() => {
    // Fresh module state: whether an offered snapshot is still undecided lives in the module.
    vi.resetModules()
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-userdata-test-'))
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-music-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(musicDir, { recursive: true, force: true })
  })

  /** A snapshot a previous session left behind, with its sketch-info sidecar. */
  function leaveSnapshotFromLastSession(json: string, sketchJson: string): void {
    writeFileSync(join(userDataDir, 'autosave.sssketchproj'), json)
    writeFileSync(join(userDataDir, 'autosaveSketch.json'), sketchJson)
  }

  it('the first autosave after the offer moves the old snapshot aside instead of overwriting it', async () => {
    const pf = await import('./projectFile')
    leaveSnapshotFromLastSession('{"old":1}', '{"kind":"library","name":"old"}')
    expect(pf.loadAutosave()).toBe('{"old":1}')
    pf.writeAutosave('{"new":1}')
    pf.writeAutosaveSketchInfo('{"kind":"library","name":"new"}')
    expect(pf.loadAutosave()).toBe('{"new":1}')
    expect(pf.loadAutosaveSketchInfo()).toBe('{"kind":"library","name":"new"}')
    expect(pf.loadPreviousAutosave()).toEqual({
      json: '{"old":1}',
      sketchJson: '{"kind":"library","name":"old"}'
    })
  })

  it('a save moves an undecided snapshot aside instead of deleting it', async () => {
    const pf = await import('./projectFile')
    leaveSnapshotFromLastSession('{"old":1}', '{"kind":"library","name":"old"}')
    pf.loadAutosave()
    pf.saveProjectInPlace(join(userDataDir, 'mine.sssketchproj'), '{"mine":1}')
    expect(pf.loadAutosave()).toBeNull()
    expect(pf.loadPreviousAutosave()?.json).toBe('{"old":1}')
  })

  it("once moved aside, this session's own autosaves and saves leave it alone", async () => {
    const pf = await import('./projectFile')
    leaveSnapshotFromLastSession('{"old":1}', '{}')
    pf.loadAutosave()
    pf.writeAutosave('{"new":1}')
    pf.writeAutosave('{"new":2}')
    pf.clearAutosave()
    pf.writeAutosave('{"new":3}')
    pf.saveProjectInPlace(join(userDataDir, 'mine.sssketchproj'), '{"mine":1}')
    expect(pf.loadAutosave()).toBeNull()
    expect(pf.loadPreviousAutosave()?.json).toBe('{"old":1}')
  })

  it('recovering or discarding the offer deletes it: nothing is moved aside afterwards', async () => {
    const pf = await import('./projectFile')
    leaveSnapshotFromLastSession('{"old":1}', '{}')
    pf.loadAutosave()
    pf.discardAutosave()
    expect(pf.loadAutosave()).toBeNull()
    pf.writeAutosave('{"new":1}')
    pf.clearAutosave()
    expect(pf.loadPreviousAutosave()).toBeNull()
  })

  it('keeps one previous snapshot: a second move aside replaces the first', async () => {
    const pf = await import('./projectFile')
    leaveSnapshotFromLastSession('{"first":1}', '{"s":1}')
    pf.loadAutosave()
    pf.writeAutosave('{"second":1}')
    // The next launch offers the second session's file and it is left undecided again.
    vi.resetModules()
    const next = await import('./projectFile')
    expect(next.loadAutosave()).toBe('{"second":1}')
    next.writeAutosave('{"third":1}')
    expect(next.loadPreviousAutosave()).toEqual({ json: '{"second":1}', sketchJson: null })
    expect(
      readdirSync(userDataDir)
        .filter((f) => f.startsWith('autosave'))
        .sort()
    ).toEqual(['autosave.previous.sssketchproj', 'autosave.sssketchproj'])
  })

  it('discardPreviousAutosave deletes the kept snapshot and its sidecar, not the current one', async () => {
    const pf = await import('./projectFile')
    leaveSnapshotFromLastSession('{"old":1}', '{"s":1}')
    pf.loadAutosave()
    pf.writeAutosave('{"new":1}')
    pf.discardPreviousAutosave()
    expect(pf.loadPreviousAutosave()).toBeNull()
    expect(existsSync(join(userDataDir, 'autosaveSketch.previous.json'))).toBe(false)
    expect(pf.loadAutosave()).toBe('{"new":1}')
  })

  it('an autosave that fails midway leaves the last one whole, for a recover or a scan to read', async () => {
    const pf = await import('./projectFile')
    pf.writeAutosave('{"whole":1}')
    tornWrite.pattern = /autosave\.sssketchproj/
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      pf.writeAutosave(`{"next":"${'x'.repeat(100)}"}`)
    } finally {
      tornWrite.pattern = null
      log.mockRestore()
    }
    expect(readFileSync(join(userDataDir, 'autosave.sssketchproj'), 'utf-8')).toBe('{"whole":1}')
    expect(readdirSync(userDataDir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('a snapshot this session wrote itself, never offered, is replaced and deleted as before', async () => {
    const pf = await import('./projectFile')
    pf.writeAutosave('{"a":1}')
    pf.writeAutosave('{"a":2}')
    expect(pf.loadPreviousAutosave()).toBeNull()
    pf.clearAutosave()
    expect(pf.loadAutosave()).toBeNull()
    expect(pf.loadPreviousAutosave()).toBeNull()
  })
})

// The re-oned copies cleanup keeps the copies a project outside the library names, even once
// that project's drive is unplugged (reonedCopiesStore.ts). Library projects are scanned anyway.
describe('remembering projects outside the library', () => {
  const paths = (read: { ok: boolean; projects?: { path: string }[] }): string[] =>
    read.ok ? (read.projects ?? []).map((p) => p.path) : []
  const COPY = '0123456789abcdef0123456789abcdef.baked.wav'
  const json = `{"rifffs":{"g":{"stems":[{"path":"/lib/.bakes/${COPY}"}]}}}`
  let outside: string

  beforeEach(() => {
    vi.resetModules()
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-userdata-test-'))
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-music-test-'))
    outside = mkdtempSync(join(tmpdir(), 'sssketch-outside-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(musicDir, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  it('a save in place outside the library, then a rename, are remembered with their copies', async () => {
    const pf = await import('./projectFile')
    const { knownProjects } = await import('./reonedCopiesStore')
    const path = join(outside, 'mine.sssketchproj')
    pf.saveProjectInPlace(path, json)
    expect(knownProjects()).toEqual({
      ok: true,
      projects: [{ path, names: [COPY], at: expect.any(Number) }]
    })
    const renamed = pf.renameExternalSketchFile(path, 'yours')
    expect(renamed.ok).toBe(true)
    expect(paths(knownProjects())).toEqual([join(outside, 'yours.sssketchproj')])
  })

  it('save as and open through the dialog are remembered', async () => {
    const pf = await import('./projectFile')
    const { knownProjects } = await import('./reonedCopiesStore')
    dialogPick.path = join(outside, 'saved-as.sssketchproj')
    await pf.saveProjectAs({} as never, json)
    const opened = join(outside, 'opened.sssketchproj')
    writeFileSync(opened, json)
    dialogPick.path = opened
    await pf.openProject({} as never)
    expect(paths(knownProjects())).toEqual([opened, join(outside, 'saved-as.sssketchproj')])
  })

  it('a library save is not remembered', async () => {
    const pf = await import('./projectFile')
    const { knownProjects } = await import('./reonedCopiesStore')
    pf.saveProjectToLibrary('my-sketch', json)
    expect(knownProjects()).toEqual({ ok: true, projects: [] })
  })
})

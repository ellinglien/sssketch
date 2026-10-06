import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyCategoryCentroidStore, recordConfirmedCategory } from '@shared/categoryCentroids'

let userDataDir: string

// The store module's own 'fs' calls (the same builtin as 'node:fs'), in order,
// for the durability test below. Each one still runs for real.
const fsCalls: string[] = []
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const traced =
    <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      fsCalls.push(name)
      return fn(...args)
    }
  return {
    ...actual,
    openSync: traced('openSync', actual.openSync),
    writeSync: traced('writeSync', actual.writeSync),
    writeFileSync: traced('writeFileSync', actual.writeFileSync),
    fsyncSync: traced('fsyncSync', actual.fsyncSync),
    closeSync: traced('closeSync', actual.closeSync),
    renameSync: traced('renameSync', actual.renameSync)
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

describe('categoryCentroidStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-category-centroid-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('loadCategoryCentroidStore returns an empty store when no file exists yet', async () => {
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    expect(loadCategoryCentroidStore()).toEqual(emptyCategoryCentroidStore())
  })

  it('saveCategoryCentroidStore then loadCategoryCentroidStore round-trips', async () => {
    const { loadCategoryCentroidStore, saveCategoryCentroidStore } =
      await import('./categoryCentroidStore')
    let store = emptyCategoryCentroidStore()
    store = recordConfirmedCategory(store, 'bus', 'drums', new Array(19).fill(1))
    store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', new Array(19).fill(2))
    store = recordConfirmedCategory(store, 'drumSubRole', 'kick', new Array(19).fill(3))
    saveCategoryCentroidStore(store, [{ stemCID: 'cid-1', busId: 'drums' }])
    // The trained pairs are the file's, not the store's: readers never see them.
    expect(loadCategoryCentroidStore()).toEqual(store)
  })

  it('loadCategoryCentroidStore returns an empty store rather than throwing on a corrupt file', async () => {
    writeFileSync(join(userDataDir, 'busCentroids.json'), 'not valid json{{{')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    expect(loadCategoryCentroidStore()).toEqual(emptyCategoryCentroidStore())
  })

  it('loads a pre-existing bus-only file (from before arrangeRoles/drumSubRoles existed) with those two axes defaulted to empty', async () => {
    const legacyShape = {
      buses: { drums: { mean: new Array(19).fill(1), count: 3 } },
      global: { mean: new Array(19).fill(1), m2: new Array(19).fill(0), count: 3 }
    }
    writeFileSync(join(userDataDir, 'busCentroids.json'), JSON.stringify(legacyShape))
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    const loaded = loadCategoryCentroidStore()
    expect(loaded.buses).toEqual(legacyShape.buses)
    expect(loaded.arrangeRoles).toEqual({})
    expect(loaded.drumSubRoles).toEqual({})
    expect(loaded.global).toEqual(legacyShape.global)
  })

  // Review of plan b21ea5a2 Task 13: the store was written in place, so a
  // crash or a full disk mid-write left a truncated file, which loads as an
  // empty store (every bus trained so far lost). Now: a temp file, renamed.
  it('a save that fails part-way leaves the previous file intact', async () => {
    const { loadCategoryCentroidStore, saveCategoryCentroidStore } =
      await import('./categoryCentroidStore')
    const before = recordConfirmedCategory(
      emptyCategoryCentroidStore(),
      'bus',
      'drums',
      new Array(19).fill(1)
    )
    saveCategoryCentroidStore(before, [])
    expect(readdirSync(userDataDir)).toEqual(['busCentroids.json'])

    // The temp file cannot be written: a directory stands in its place.
    mkdirSync(join(userDataDir, 'busCentroids.json.tmp'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    saveCategoryCentroidStore(
      recordConfirmedCategory(before, 'bus', 'bass', new Array(19).fill(2)),
      [{ stemCID: 'cid-2', busId: 'bass' }]
    )
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
    expect(loadCategoryCentroidStore()).toEqual(before)
  })

  // Review of b4d9924a, minor 6: without an fsync, a power loss after the
  // rename can leave the renamed file empty on some filesystems (the rename
  // reaches the disk before the data does).
  it('the temp file is flushed to disk before it is renamed over the store', async () => {
    const { saveCategoryCentroidStore } = await import('./categoryCentroidStore')
    fsCalls.length = 0
    expect(saveCategoryCentroidStore(emptyCategoryCentroidStore(), [])).toBe(true)
    const fsync = fsCalls.indexOf('fsyncSync')
    expect(fsync).toBeGreaterThanOrEqual(0)
    expect(fsync).toBeLessThan(fsCalls.indexOf('renameSync'))
  })

  // Review of b4d9924a, important 1: training must tell a file that won't
  // load from no file at all (loadCategoryCentroidStore reads both as empty).
  it('readCategoryCentroidStoreFile tells no file, a file that will not load, and a store apart', async () => {
    const { readCategoryCentroidStoreFile, saveCategoryCentroidStore } =
      await import('./categoryCentroidStore')
    const path = join(userDataDir, 'busCentroids.json')
    expect(readCategoryCentroidStoreFile()).toEqual({ kind: 'missing' })
    for (const contents of ['', 'not json', 'null', '[]', '3']) {
      writeFileSync(path, contents)
      expect(readCategoryCentroidStoreFile().kind).toBe('unreadable')
    }
    const store = recordConfirmedCategory(
      emptyCategoryCentroidStore(),
      'bus',
      'drums',
      new Array(19).fill(1)
    )
    const trainedPairs = [{ stemCID: 'cid-1', busId: 'drums' }]
    saveCategoryCentroidStore(store, trainedPairs)
    expect(readCategoryCentroidStoreFile()).toEqual({ kind: 'ok', store, trainedPairs })
    // A file saved before trainedPairs existed reads with trainedPairs null.
    writeFileSync(path, JSON.stringify(store))
    expect(readCategoryCentroidStoreFile()).toEqual({ kind: 'ok', store, trainedPairs: null })
    // A trainedPairs that is not a list of pairs: what the file holds is
    // unknown, so it is a file that won't load, never one to train into.
    for (const bad of [{}, [['cid-1', 'drums']], [{ stemCID: 'cid-1' }], 'cid-1']) {
      writeFileSync(path, JSON.stringify({ ...store, trainedPairs: bad }))
      expect(readCategoryCentroidStoreFile().kind).toBe('unreadable')
    }
  })

  // The samples and the pairs trained into them are one file, one rename:
  // there is no second write for a crash to fall between.
  it('the samples and the trained pairs are saved in one rename', async () => {
    const { saveCategoryCentroidStore } = await import('./categoryCentroidStore')
    const store = recordConfirmedCategory(
      emptyCategoryCentroidStore(),
      'bus',
      'drums',
      new Array(19).fill(1)
    )
    fsCalls.length = 0
    saveCategoryCentroidStore(store, [{ stemCID: 'cid-1', busId: 'drums' }])
    expect(fsCalls.filter((call) => call === 'renameSync')).toHaveLength(1)
    const onDisk = JSON.parse(readFileSync(join(userDataDir, 'busCentroids.json'), 'utf-8'))
    expect(onDisk).toEqual({ ...store, trainedPairs: [{ stemCID: 'cid-1', busId: 'drums' }] })
  })

  // Review of 6fd465fe, minor 6: trainedPairs grows with every confirmed
  // stem, and nobody reads the file by hand: no indentation.
  it('the file is written as compact JSON', async () => {
    const { saveCategoryCentroidStore } = await import('./categoryCentroidStore')
    const store = recordConfirmedCategory(
      emptyCategoryCentroidStore(),
      'bus',
      'drums',
      new Array(19).fill(1)
    )
    const trainedPairs = [{ stemCID: 'cid-1', busId: 'drums' }]
    saveCategoryCentroidStore(store, trainedPairs)
    const onDisk = readFileSync(join(userDataDir, 'busCentroids.json'), 'utf-8')
    expect(onDisk).toBe(JSON.stringify({ ...store, trainedPairs }))
  })
})

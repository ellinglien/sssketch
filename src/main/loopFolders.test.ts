import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LOOP_FOLDERS_DDL,
  linkLoopFolder,
  listLoopFolders,
  loopIdForPath,
  setLoopTempoOverride,
  unlinkLoopFolder
} from './loopFolders'

let dir: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sssketch-loop-folders-test-'))
  db = new Database(join(dir, 'loops.db3'))
  db.exec(LOOP_FOLDERS_DDL)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeFolder(...segments: string[]): string {
  const path = join(dir, ...segments)
  mkdirSync(path, { recursive: true })
  return path
}

interface LoopFields {
  name?: string
  groupPath?: string[]
  durationSec?: number | null
  bpm?: number | null
  bars?: number | null
  source?: string | null
  irregular?: boolean
  overrideBpm?: number | null
  present?: boolean
}

/** Seeds one LoopFiles row directly, standing in for a scan (Task 5). */
function insertLoop(root: string, path: string, fields: LoopFields = {}): string {
  const loopId = loopIdForPath(path)
  db.prepare(
    `INSERT INTO LoopFiles (Path, LoopId, RootPath, GroupPath, Name, SizeBytes, MtimeMs,
       DurationSec, Bpm, Bars, TempoSource, Irregular, OverrideBpm, Present)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    path,
    loopId,
    root,
    JSON.stringify(fields.groupPath ?? []),
    fields.name ?? 'loop',
    fields.durationSec ?? null,
    fields.bpm ?? null,
    fields.bars ?? null,
    fields.source ?? null,
    fields.irregular ? 1 : 0,
    fields.overrideBpm ?? null,
    fields.present === false ? 0 : 1
  )
  return loopId
}

describe('loopIdForPath', () => {
  it('is prefixed, stable, and the same for two spellings of one path', () => {
    const id = loopIdForPath('/a/b/x.wav')
    expect(id).toMatch(/^loop-[0-9a-f]{40}$/)
    expect(loopIdForPath('/a/b/../b/x.wav')).toBe(id)
    // NFD (e + combining acute) and NFC (é) are one file to macOS.
    expect(loopIdForPath('/a/Cafe\u0301.wav')).toBe(loopIdForPath('/a/Caf\u00e9.wav'))
    expect(loopIdForPath('/a/b/y.wav')).not.toBe(id)
  })
})

describe('linkLoopFolder', () => {
  it('links a folder, titled with its own name', () => {
    const root = makeFolder('Amen Breaks Compilation')
    expect(linkLoopFolder(db, root, 1000)).toEqual({
      ok: true,
      folder: {
        rootPath: root,
        name: 'Amen Breaks Compilation',
        available: true,
        lastScannedAt: null,
        loops: []
      }
    })
    expect(listLoopFolders(db).map((f) => f.rootPath)).toEqual([root])
  })

  it('refuses what it cannot or should not link', () => {
    const root = makeFolder('Amen Breaks Compilation')
    const file = join(dir, 'not-a-folder.wav')
    writeFileSync(file, 'x')
    expect(linkLoopFolder(db, file)).toEqual({ ok: false, reason: 'not a folder' })
    expect(linkLoopFolder(db, join(dir, 'missing'))).toEqual({ ok: false, reason: 'not a folder' })

    linkLoopFolder(db, root)
    expect(linkLoopFolder(db, root)).toEqual({ ok: false, reason: 'already linked' })
    expect(linkLoopFolder(db, `${root}/`)).toEqual({ ok: false, reason: 'already linked' })
    const inner = makeFolder('Amen Breaks Compilation', 'Amen Breaks Volume 1')
    expect(linkLoopFolder(db, inner)).toEqual({ ok: false, reason: 'inside a linked folder' })
    expect(linkLoopFolder(db, dir)).toEqual({ ok: false, reason: 'contains a linked folder' })
  })
})

describe('listLoopFolders', () => {
  it('lists each folder with its present loops, groups parsed, guesses as stored', () => {
    const root = makeFolder('Amen Breaks Compilation')
    linkLoopFolder(db, root)
    const creek = join(root, 'Amen Breaks Volume 3', 'WAV', 'Creek Break 160.wav')
    const creekId = insertLoop(root, creek, {
      name: 'Creek Break 160',
      groupPath: ['Amen Breaks Volume 3'],
      durationSec: 3,
      bpm: 160,
      bars: 2,
      source: 'filename'
    })
    insertLoop(root, join(root, 'gone.wav'), { name: 'gone', present: false })

    const [folder] = listLoopFolders(db)
    expect(folder.loops).toEqual([
      {
        loopId: creekId,
        rootPath: root,
        path: creek,
        name: 'Creek Break 160',
        groupPath: ['Amen Breaks Volume 3'],
        durationSec: 3,
        bpm: 160,
        bars: 2,
        source: 'filename',
        irregular: false
      }
    ])
  })

  it('shows a corrected tempo as the user’s, with bars worked out from it', () => {
    const root = makeFolder('Breaks')
    linkLoopFolder(db, root)
    insertLoop(root, join(root, 'Creek Break 160.wav'), {
      durationSec: 3,
      bpm: 160,
      bars: 2,
      source: 'filename',
      overrideBpm: 80
    })
    expect(listLoopFolders(db)[0].loops[0]).toMatchObject({
      bpm: 80,
      bars: 1,
      source: 'user',
      irregular: false
    })
  })

  it('orders folders by name, ignoring case', () => {
    linkLoopFolder(db, makeFolder('beta loops'))
    linkLoopFolder(db, makeFolder('Alpha Loops'))
    expect(listLoopFolders(db).map((f) => f.name)).toEqual(['Alpha Loops', 'beta loops'])
  })
})

describe('setLoopTempoOverride', () => {
  it('sets a corrected tempo, and clearing it brings the guess back', () => {
    const root = makeFolder('Breaks')
    linkLoopFolder(db, root)
    const id = insertLoop(root, join(root, 'Creek Break 160.wav'), {
      durationSec: 3,
      bpm: 160,
      bars: 2,
      source: 'filename'
    })
    expect(setLoopTempoOverride(db, id, 80)).toMatchObject({ bpm: 80, bars: 1, source: 'user' })
    expect(setLoopTempoOverride(db, id, null)).toMatchObject({
      bpm: 160,
      bars: 2,
      source: 'filename'
    })
  })

  it('refuses a tempo out of range, and an id it does not know', () => {
    const root = makeFolder('Breaks')
    linkLoopFolder(db, root)
    const id = insertLoop(root, join(root, 'a.wav'), {
      durationSec: 3,
      bpm: 160,
      bars: 2,
      source: 'filename'
    })
    expect(setLoopTempoOverride(db, id, 10)).toBeNull()
    expect(setLoopTempoOverride(db, id, Number.NaN)).toBeNull()
    expect(listLoopFolders(db)[0].loops[0].source).toBe('filename')
    expect(setLoopTempoOverride(db, 'loop-nope', 120)).toBeNull()
  })
})

describe('unlinkLoopFolder', () => {
  it('forgets the folder and its loops, but keeps a corrected tempo for a relink', () => {
    const root = makeFolder('Breaks')
    linkLoopFolder(db, root)
    insertLoop(root, join(root, 'plain.wav'), { name: 'plain' })
    insertLoop(root, join(root, 'fixed.wav'), { name: 'fixed', overrideBpm: 80 })

    unlinkLoopFolder(db, root)

    expect(listLoopFolders(db)).toEqual([])
    expect(db.prepare('SELECT Name, Present, OverrideBpm FROM LoopFiles').all()).toEqual([
      { Name: 'fixed', Present: 0, OverrideBpm: 80 }
    ])
  })
})

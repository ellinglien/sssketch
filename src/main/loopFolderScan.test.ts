import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { encodeWavPCM16 } from '@shared/encodeWav'
import type { LoopEntry } from '@shared/loopFolderTypes'
import {
  LOOP_FOLDERS_DDL,
  linkLoopFolder,
  listLoopFolders,
  loopIdForPath,
  setLoopTempoOverride,
  unlinkLoopFolder
} from './loopFolders'
import {
  DEFAULT_LOOP_SCAN_DEPS,
  measureWavDurationSec,
  recordLoopDuration,
  rescanLoopFolder,
  type LoopScanDeps
} from './loopFolderScan'

const RATE = 8000
const secs = (bars: number, bpm: number): number => (bars * 240) / bpm

function writeWav(path: string, seconds: number): void {
  mkdirSync(dirname(path), { recursive: true })
  const channel = new Float32Array(Math.round(seconds * RATE)).fill(0.25)
  writeFileSync(path, encodeWavPCM16([channel], RATE))
}

function writeJunk(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'not audio')
}

let dir: string
let db: Database.Database
let root: string
let cwPath: string
let creekPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sssketch-loop-scan-test-'))
  db = new Database(join(dir, 'loops.db3'))
  db.exec(LOOP_FOLDERS_DDL)
  // A miniature of ~/Downloads/Amen Breaks Compilation, real names.
  root = join(dir, 'Amen Breaks Compilation')
  cwPath = join(root, 'Amen Breaks Volume 1', 'WAV', 'cw_amen01_175.wav')
  creekPath = join(root, 'Amen Breaks Volume 3', 'WAV', 'Creek Break 160.wav')
  writeWav(cwPath, secs(2, 175))
  writeWav(creekPath, secs(2, 160))
  writeWav(join(root, 'Amen Breaks Volume 3', 'WAV', 'Crot Break 165.wav'), secs(2, 165))
  writeWav(join(root, 'Amen Breaks Volume 3', 'WAV', 'Hype Break 165.wav'), secs(2, 165))
  writeWav(join(root, 'Amen Breaks Volume 3', 'WAV', 'Halftime Dnb Drums 1.wav'), secs(4, 165))
  writeWav(join(root, 'Amen Breaks Volume 2', 'WAV', 'cw_amen_classic.wav'), 4.5)
  // Everything below must stay hidden.
  writeJunk(join(root, 'Amen Breaks Volume 1', 'REX2', 'cw_amen01_175.rx2'))
  writeJunk(join(root, 'Amen Breaks Volume 3', 'info.txt'))
  writeJunk(join(root, '.DS_Store'))
  writeJunk(join(root, 'Amen Breaks Volume 1', 'WAV', '._cw_amen01_175.wav'))
  writeWav(join(root, '.hidden', 'secret 120.wav'), 1)
  linkLoopFolder(db, root)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function loopsByName(): Map<string, LoopEntry> {
  return new Map(listLoopFolders(db)[0].loops.map((l) => [l.name, l]))
}

describe('rescanLoopFolder', () => {
  it('lists only playable files, with the format folders flattened away', async () => {
    await rescanLoopFolder(db, root, 120)
    const loops = loopsByName()
    expect([...loops.keys()].sort()).toEqual([
      'Creek Break 160',
      'Crot Break 165',
      'Halftime Dnb Drums 1',
      'Hype Break 165',
      'cw_amen01_175',
      'cw_amen_classic'
    ])
    expect(loops.get('cw_amen01_175')!.groupPath).toEqual(['Amen Breaks Volume 1'])
    expect(loops.get('Creek Break 160')!.groupPath).toEqual(['Amen Breaks Volume 3'])
    expect(listLoopFolders(db)[0].lastScannedAt).not.toBeNull()
  })

  it('works out each loop’s length, tempo and bars', async () => {
    await rescanLoopFolder(db, root, 120)
    const loops = loopsByName()
    expect(loops.get('Creek Break 160')).toMatchObject({
      bpm: 160,
      bars: 2,
      source: 'filename',
      irregular: false
    })
    expect(loops.get('Creek Break 160')!.durationSec).toBeCloseTo(3, 3)
    expect(loops.get('cw_amen01_175')).toMatchObject({ bpm: 175, bars: 2, source: 'filename' })
    // No tempo in its name or folder: its siblings say 165.
    const halftime = loops.get('Halftime Dnb Drums 1')!
    expect(halftime).toMatchObject({ bars: 4, source: 'siblings', irregular: false })
    expect(halftime.bpm).toBeCloseTo(165, 0)
    // Nothing named anywhere in Volume 2: the length decides, near 120.
    const classic = loops.get('cw_amen_classic')!
    expect(classic).toMatchObject({ bars: 2, source: 'length', irregular: false })
    expect(classic.bpm).toBeCloseTo(106.67, 1)
  })

  it('measures nothing on a second rescan, and only the changed file after an edit', async () => {
    let measured = 0
    const counting: LoopScanDeps = {
      ...DEFAULT_LOOP_SCAN_DEPS,
      measureDurationSec: (path) => {
        measured += 1
        return measureWavDurationSec(path)
      }
    }
    expect((await rescanLoopFolder(db, root, 120, counting)).measured).toBe(6)
    expect((await rescanLoopFolder(db, root, 120, counting)).measured).toBe(0)
    writeWav(cwPath, secs(1, 175))
    expect((await rescanLoopFolder(db, root, 120, counting)).measured).toBe(1)
    expect(measured).toBe(7)
    expect(loopsByName().get('cw_amen01_175')!.bars).toBe(1)
  })

  it('drops a removed file, and keeps a corrected tempo for when it comes back', async () => {
    await rescanLoopFolder(db, root, 120)
    const id = loopsByName().get('cw_amen01_175')!.loopId
    setLoopTempoOverride(db, id, 87.5)

    rmSync(cwPath)
    expect((await rescanLoopFolder(db, root, 120)).removed).toBe(1)
    expect(loopsByName().has('cw_amen01_175')).toBe(false)

    rmSync(creekPath)
    await rescanLoopFolder(db, root, 120)
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM LoopFiles WHERE Name = ?`).get('Creek Break 160')
    ).toEqual({
      n: 0
    })

    writeWav(cwPath, secs(2, 175))
    await rescanLoopFolder(db, root, 120)
    expect(loopsByName().get('cw_amen01_175')).toMatchObject({
      loopId: id,
      bpm: 87.5,
      bars: 1,
      source: 'user'
    })
  })

  it('moves a hidden correction under a newly linked parent folder', async () => {
    const volume1 = join(root, 'Amen Breaks Volume 1')
    unlinkLoopFolder(db, root) // linked in beforeEach; start from its child
    linkLoopFolder(db, volume1)
    await rescanLoopFolder(db, volume1, 120)
    const id = loopIdForPath(cwPath)
    setLoopTempoOverride(db, id, 87.5)
    unlinkLoopFolder(db, volume1)

    linkLoopFolder(db, root)
    await rescanLoopFolder(db, root, 120)
    expect(loopsByName().get('cw_amen01_175')).toMatchObject({
      loopId: id,
      rootPath: root,
      groupPath: ['Amen Breaks Volume 1'],
      bpm: 87.5,
      source: 'user'
    })
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM LoopFiles WHERE RootPath = ?`).get(volume1)
    ).toEqual({ n: 0 })
  })

  it('marks a folder that is not there as unavailable, keeping its loops until it is back', async () => {
    await rescanLoopFolder(db, root, 120)
    const away = `${root} (unplugged)`
    renameSync(root, away)

    const missing = await rescanLoopFolder(db, root, 120)
    expect(missing.available).toBe(false)
    const [folder] = listLoopFolders(db)
    expect(folder.available).toBe(false)
    expect(folder.loops).toHaveLength(6)

    renameSync(away, root)
    expect((await rescanLoopFolder(db, root, 120)).available).toBe(true)
    expect(listLoopFolders(db)[0].available).toBe(true)
  })

  it('marks a folder it can stat but not read as unavailable, not empty', async () => {
    await rescanLoopFolder(db, root, 120)
    chmodSync(root, 0o000)
    try {
      const unreadable = await rescanLoopFolder(db, root, 120)
      expect(unreadable.available).toBe(false)
    } finally {
      chmodSync(root, 0o755)
    }
    const [folder] = listLoopFolders(db)
    expect(folder.available).toBe(false)
    expect(folder.loops).toHaveLength(6)
  })

  it('writes nothing when the drive goes away partway through a scan', async () => {
    await rescanLoopFolder(db, root, 120)
    const before = loopsByName()
    const away = `${root} (unplugged)`
    writeWav(cwPath, secs(1, 175)) // changed, so its header is read again
    const pulled = await rescanLoopFolder(db, root, 120, {
      ...DEFAULT_LOOP_SCAN_DEPS,
      measureDurationSec: (path) => {
        renameSync(root, away) // pulled after the walk and stats, before the write
        return measureWavDurationSec(path)
      }
    })
    renameSync(away, root)
    expect(pulled.available).toBe(false)
    const [folder] = listLoopFolders(db)
    expect(folder.available).toBe(false)
    expect(loopsByName()).toEqual(before)
  })

  it('keeps a length reported while a scan was running', async () => {
    writeJunk(join(root, 'Pads', 'Pad 120.flac'))
    await rescanLoopFolder(db, root, 120)
    const padId = loopsByName().get('Pad 120')!.loopId
    let clock = 0
    let reported = false
    await rescanLoopFolder(db, root, 120, {
      ...DEFAULT_LOOP_SCAN_DEPS,
      now: () => (clock += 10),
      yieldToEventLoop: async () => {
        if (reported) return
        reported = true
        recordLoopDuration(db, padId, 8, 120)
      }
    })
    expect(reported).toBe(true)
    expect(loopsByName().get('Pad 120')).toMatchObject({ durationSec: 8, bpm: 120, bars: 4 })
  })

  it('yields on an elapsed-time budget, not a file count', async () => {
    const hits = join(dir, 'Hits')
    for (let i = 0; i < 20; i++) writeWav(join(hits, `hit ${String(i).padStart(2, '0')}.wav`), 0.05)
    linkLoopFolder(db, hits)

    const run = async (msPerMeasure: number): Promise<number> => {
      db.prepare(`DELETE FROM LoopFiles WHERE RootPath = ?`).run(hits)
      let clock = 0
      let yields = 0
      await rescanLoopFolder(db, hits, 120, {
        measureDurationSec: (path) => {
          clock += msPerMeasure
          return measureWavDurationSec(path)
        },
        now: () => clock,
        yieldToEventLoop: async () => {
          yields += 1
        }
      })
      return yields
    }

    // 3ms a header -- a slow volume -- spends the 8ms budget every third file.
    expect(await run(3)).toBe(6)
    // Fast reads never spend it, however many files there are.
    expect(await run(0)).toBe(0)
  })

  // Scan plan Task 13 M3 (audit minor): the files were stat'ed one after
  // another, each a round trip to his USB volume.
  it('stats at most 8 files at once, and the result follows the walk, not the stats', async () => {
    const hits = join(dir, 'Hits')
    for (let i = 0; i < 20; i++)
      writeWav(join(hits, `hit ${String(i).padStart(2, '0')} 120.wav`), 0.5)
    linkLoopFolder(db, hits)
    const serial = await rescanLoopFolder(db, hits, 120)
    const serialLoops = listLoopFolders(db).find((f) => f.rootPath === hits)!.loops
    db.prepare(`DELETE FROM LoopFiles WHERE RootPath = ?`).run(hits)

    let inFlight = 0
    let maxInFlight = 0
    let calls = 0
    const { stat } = await import('node:fs/promises')
    const concurrent = await rescanLoopFolder(db, hits, 120, {
      ...DEFAULT_LOOP_SCAN_DEPS,
      statFile: async (path) => {
        const order = calls++
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        // later calls finish first: completion order is not walk order
        for (let i = 0; i < 40 - order; i++) await new Promise((r) => setImmediate(r))
        inFlight -= 1
        return stat(path)
      }
    })
    expect(calls).toBe(20)
    expect(maxInFlight).toBe(8)
    expect(concurrent).toEqual(serial)
    expect(listLoopFolders(db).find((f) => f.rootPath === hits)!.loops).toEqual(serialLoops)
  })

  it('shares one scan between two callers asking at once', async () => {
    const first = rescanLoopFolder(db, root, 120)
    const second = rescanLoopFolder(db, root, 120)
    expect(second).toBe(first)
    await first
  })
})

describe('recordLoopDuration', () => {
  it('fills in a length the header reader could not measure, once', async () => {
    writeJunk(join(root, 'Pads', 'Pad 120.flac'))
    await rescanLoopFolder(db, root, 120)
    const pad = loopsByName().get('Pad 120')!
    expect(pad).toMatchObject({ durationSec: null, bpm: 120, bars: null, source: 'filename' })

    expect(recordLoopDuration(db, pad.loopId, 8, 120)).toMatchObject({
      durationSec: 8,
      bpm: 120,
      bars: 4,
      source: 'filename',
      irregular: false
    })
    // A second report does not overwrite the first.
    expect(recordLoopDuration(db, pad.loopId, 2, 120)).toMatchObject({ durationSec: 8, bars: 4 })
    expect(recordLoopDuration(db, pad.loopId, 0, 120)).toBeNull()
    expect(recordLoopDuration(db, 'loop-nope', 8, 120)).toBeNull()

    // The file has not changed, so a rescan keeps the reported length.
    await rescanLoopFolder(db, root, 120)
    expect(loopsByName().get('Pad 120')!.durationSec).toBe(8)
  })
})

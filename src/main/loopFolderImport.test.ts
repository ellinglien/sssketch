import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { encodeWavPCM16 } from '@shared/encodeWav'
import type { Rifff } from '@shared/types'
import {
  LOOP_FOLDERS_DDL,
  linkLoopFolder,
  listLoopFolders,
  setLoopTempoOverride
} from './loopFolders'
import { rescanLoopFolder } from './loopFolderScan'
import { importLinkedLoops, type RunWithDecoder } from './loopFolderImport'
import type { DecodeToWav } from './importOneShot'

const RATE = 8000
const secs = (bars: number, bpm: number): number => (bars * 240) / bpm

function writeWav(path: string, seconds: number): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    encodeWavPCM16([new Float32Array(Math.round(seconds * RATE)).fill(0.25)], RATE)
  )
}

function writeJunk(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'not audio')
}

let dir: string
let db: Database.Database
let root: string
let creekPath: string
let imported: Rifff[]

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sssketch-loop-import-test-'))
  db = new Database(join(dir, 'loops.db3'))
  db.exec(LOOP_FOLDERS_DDL)
  root = join(dir, 'Amen Breaks Compilation')
  creekPath = join(root, 'Amen Breaks Volume 3', 'WAV', 'Creek Break 160.wav')
  writeWav(creekPath, secs(2, 160))
  writeWav(join(root, 'Amen Breaks Volume 1', 'WAV', 'cw_amen01_175.wav'), secs(2, 175))
  writeJunk(join(root, 'Pads', 'Pad 120.flac'))
  writeJunk(join(root, 'Pads', 'Pad 2 120.ogg'))
  writeJunk(join(root, 'Pads', 'Odd Header 120.wav'))
  linkLoopFolder(db, root)
  await rescanLoopFolder(db, root, 120)
  imported = []
})

afterEach(() => {
  // Imports land in the real library root, as importOneShot.test.ts's do.
  for (const rifff of imported)
    rmSync(dirname(rifff.stems[0].path), { recursive: true, force: true })
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function idOf(name: string): string {
  return listLoopFolders(db)[0].loops.find((l) => l.name === name)!.loopId
}

/** Fails the test if a decoder is ever asked for. */
const noDecoder: RunWithDecoder = async () => {
  throw new Error('a decoder was spawned for an all-WAV import')
}

/** Writes a real WAV of `seconds` for every decode (null: every decode
 * fails), and counts decoder sessions. */
function fakeDecoder(seconds: number | null): { run: RunWithDecoder; sessions: () => number } {
  let sessions = 0
  const decode: DecodeToWav = async (_sourcePath, outputPath) => {
    if (seconds === null) return null
    writeFileSync(outputPath, encodeWavPCM16([new Float32Array(Math.round(seconds * RATE))], RATE))
    return seconds
  }
  return {
    run: async (fn) => {
      sessions += 1
      return fn(decode)
    },
    sessions: () => sessions
  }
}

describe('importLinkedLoops', () => {
  it('imports a WAV loop as a one-stem rifff that tiles at its bar count, copied into the library', async () => {
    const rifffs = await importLinkedLoops(db, [idOf('Creek Break 160')], 120, noDecoder)
    imported.push(...rifffs)
    expect(rifffs).toHaveLength(1)
    const [rifff] = rifffs
    expect(rifff.name).toBe('Creek Break 160')
    expect(rifff.barLength).toBe(2)
    expect(rifff.bpm).toBeCloseTo(160, 3)
    expect(rifff.folderPath).toBe(creekPath)
    expect(rifff.stems[0]).toMatchObject({
      slot: 1,
      type: 'fx',
      barLength: 2,
      name: 'Creek Break 160'
    })
    expect(rifff.stems[0].oneShot).toBeUndefined()
    expect(rifff.stems[0].path).not.toBe(creekPath)
    expect(existsSync(rifff.stems[0].path)).toBe(true)
    expect(rifff.stems[0].durationSec).toBeCloseTo(3, 3)
  })

  it('imports at a corrected tempo', async () => {
    const id = idOf('cw_amen01_175')
    setLoopTempoOverride(db, id, 87.5)
    const [rifff] = await importLinkedLoops(db, [id], 120, noDecoder)
    imported.push(rifff)
    expect(rifff.barLength).toBe(1)
    expect(rifff.bpm).toBeCloseTo(87.5, 1)
  })

  it('keeps the selection order and skips an id it does not know', async () => {
    const rifffs = await importLinkedLoops(
      db,
      [idOf('cw_amen01_175'), 'loop-nope', idOf('Creek Break 160')],
      120,
      noDecoder
    )
    imported.push(...rifffs)
    expect(rifffs.map((r) => r.name)).toEqual(['cw_amen01_175', 'Creek Break 160'])
  })

  it('decodes non-WAV loops, all in one decoder session', async () => {
    const decoder = fakeDecoder(8)
    const rifffs = await importLinkedLoops(
      db,
      [idOf('Pad 120'), idOf('Pad 2 120')],
      120,
      decoder.run
    )
    imported.push(...rifffs)
    expect(decoder.sessions()).toBe(1)
    expect(rifffs.map((r) => r.name)).toEqual(['Pad 120', 'Pad 2 120'])
    for (const rifff of rifffs) {
      expect(rifff.barLength).toBe(4)
      expect(rifff.bpm).toBeCloseTo(120, 6)
      expect(rifff.stems[0].path.endsWith('.wav')).toBe(true)
      expect(existsSync(rifff.stems[0].path)).toBe(true)
    }
  })

  it('imports nothing for a loop whose decode fails', async () => {
    const rifffs = await importLinkedLoops(db, [idOf('Pad 120')], 120, fakeDecoder(null).run)
    expect(rifffs).toEqual([])
  })

  it('sends a wav whose header cannot be read through the engine decoder', async () => {
    const decoder = fakeDecoder(8)
    const rifffs = await importLinkedLoops(db, [idOf('Odd Header 120')], 120, decoder.run)
    imported.push(...rifffs)
    expect(decoder.sessions()).toBe(1)
    expect(rifffs.map((r) => r.name)).toEqual(['Odd Header 120'])
    expect(rifffs[0].barLength).toBe(4)
  })
  it('still imports a bad-header wav whose duration the renderer already reported', async () => {
    const id = idOf('Odd Header 120')
    db.prepare(`UPDATE LoopFiles SET DurationSec = 8, Bars = 4 WHERE LoopId = ?`).run(id)
    const decoder = fakeDecoder(8)
    const rifffs = await importLinkedLoops(db, [id], 120, decoder.run)
    imported.push(...rifffs)
    expect(decoder.sessions()).toBe(1)
    expect(rifffs.map((r) => r.name)).toEqual(['Odd Header 120'])
    expect(rifffs[0].barLength).toBe(4)
  })

  it('keeps the bars the row showed when the decoded length matches its duration', async () => {
    const id = idOf('Pad 120')
    // The row showed 2 bars for an 8 s file; at the 120 bpm project tempo the
    // length-only guess would be 4.
    db.prepare(`UPDATE LoopFiles SET DurationSec = 8, Bars = 2 WHERE LoopId = ?`).run(id)
    const rifffs = await importLinkedLoops(db, [id], 120, fakeDecoder(8).run)
    imported.push(...rifffs)
    expect(rifffs[0].barLength).toBe(2)
  })

  it('recomputes the bars when the decoded length differs from the row duration', async () => {
    const id = idOf('Pad 120')
    db.prepare(`UPDATE LoopFiles SET DurationSec = 5, Bars = 2 WHERE LoopId = ?`).run(id)
    const rifffs = await importLinkedLoops(db, [id], 120, fakeDecoder(8).run)
    imported.push(...rifffs)
    expect(rifffs[0].barLength).toBe(4)
  })
})

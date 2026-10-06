// src/main/startupBackfillGate.test.ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { fileStamp, recordSeen, seenStamp, seenStamps } from './startupBackfillGate'

describe('startupBackfillGate (audit minor, plan Task 13 M1)', () => {
  it('records, replaces and reads back stamps; nothing recorded reads undefined', () => {
    const db = new Database(':memory:')
    expect(seenStamp(db, '/a.sssketchproj')).toBeUndefined()
    expect(seenStamps(db)).toEqual(new Map())
    recordSeen(db, '/a.sssketchproj', fileStamp({ size: 10, mtimeMs: 1.5 }))
    recordSeen(db, '/b.sssketchproj', '1:2')
    recordSeen(db, '/a.sssketchproj', fileStamp({ size: 11, mtimeMs: 2 }))
    expect(seenStamp(db, '/a.sssketchproj')).toBe('11:2')
    expect(seenStamps(db)).toEqual(
      new Map([
        ['/a.sssketchproj', '11:2'],
        ['/b.sssketchproj', '1:2']
      ])
    )
    db.close()
  })

  it('a stamp moves with size or mtime', () => {
    const base = fileStamp({ size: 10, mtimeMs: 100 })
    expect(fileStamp({ size: 10, mtimeMs: 100 })).toBe(base)
    expect(fileStamp({ size: 11, mtimeMs: 100 })).not.toBe(base)
    expect(fileStamp({ size: 10, mtimeMs: 100.25 })).not.toBe(base)
  })
})

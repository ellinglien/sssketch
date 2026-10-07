// src/main/discoverArtistScanQueue.test.ts
import { describe, expect, it, vi, type Mock } from 'vitest'
import Database from 'better-sqlite3'
import {
  artistScanQueueSize,
  peekArtistScanQueue,
  queueArtistStems,
  removeFromArtistScanQueue,
  takeArtistScanBatch,
  type StemDownloadStatus
} from './discoverArtistScanQueue'

function own(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE StemFeatureCache (StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL,
      ExtractedAt INTEGER NOT NULL);
    CREATE TABLE StemUnavailable (StemCID TEXT PRIMARY KEY, Reason TEXT NOT NULL,
      CheckedAt INTEGER NOT NULL);`)
  return db
}

describe('artist scan queue', () => {
  it('queues only unanalysed, fetchable stems, once, in order', () => {
    const db = own()
    db.prepare(`INSERT INTO StemFeatureCache VALUES ('s2', '{}', 1)`).run()
    db.prepare(`INSERT INTO StemUnavailable VALUES ('s3', 'http 403', 1)`).run()
    const rows = ['s1', 's2', 's3', 's4'].map((stemCID) => ({ stemCID, jamCID: 'j1' }))
    expect(queueArtistStems(db, rows, 'tqk', 1000)).toBe(2)
    expect(queueArtistStems(db, rows, 'tqk', 2000)).toBe(0) // idempotent
    expect(artistScanQueueSize(db)).toBe(2)
    expect(peekArtistScanQueue(db, 1)).toEqual([{ stemCID: 's1', jamCID: 'j1', artist: 'tqk' }])
    removeFromArtistScanQueue(db, ['s1'])
    expect(peekArtistScanQueue(db, 5)).toEqual([{ stemCID: 's4', jamCID: 'j1', artist: 'tqk' }])
  })

  it('serves earlier queues first', () => {
    const db = own()
    queueArtistStems(db, [{ stemCID: 'b1', jamCID: 'j' }], 'b', 2000)
    queueArtistStems(db, [{ stemCID: 'a1', jamCID: 'j' }], 'a', 1000)
    expect(peekArtistScanQueue(db, 2).map((r) => r.stemCID)).toEqual(['a1', 'b1'])
  })
})

// Final review (2026-10-01): only a stem that downloaded, or is known
// unfetchable, ever leaves the queue. A temporary failure stays queued, and
// a missing archive drive pauses the whole queue -- it never drains.
describe('takeArtistScanBatch', () => {
  type Result = { status: StemDownloadStatus; path: string | null }
  function deps(
    byStem: Record<string, Result>,
    archiveReachable = true
  ): {
    archiveReachable: () => boolean
    download: Mock<(jamCID: string, stemCID: string) => Promise<Result>>
    now: () => number
  } {
    return {
      archiveReachable: () => archiveReachable,
      download: vi.fn(async (_jam: string, stemCID: string) => byStem[stemCID]),
      now: () => 5000
    }
  }

  it('pauses, downloads nothing and keeps every row while the archive is not mounted', async () => {
    const db = own()
    queueArtistStems(db, [{ stemCID: 's1', jamCID: 'j' }], 'tqk', 1000)
    const d = deps({}, false)
    expect(await takeArtistScanBatch(db, 3, d)).toEqual({ status: 'paused', remaining: 1 })
    expect(d.download).not.toHaveBeenCalled()
    expect(artistScanQueueSize(db)).toBe(1)
  })

  it('returns downloaded stems and keeps them queued until finished', async () => {
    const db = own()
    queueArtistStems(db, [{ stemCID: 's1', jamCID: 'j' }], 'tqk', 1000)
    const batch = await takeArtistScanBatch(db, 3, deps({ s1: { status: 'ok', path: '/a/s1' } }))
    expect(batch).toEqual({
      status: 'ok',
      targets: [{ key: 's1', path: '/a/s1' }],
      remaining: 1,
      transient: 0
    })
  })

  it('drops a stem known unfetchable', async () => {
    const db = own()
    queueArtistStems(db, [{ stemCID: 's1', jamCID: 'j' }], 'tqk', 1000)
    const batch = await takeArtistScanBatch(
      db,
      3,
      deps({ s1: { status: 'unavailable', path: null } })
    )
    expect(batch).toEqual({ status: 'ok', targets: [], remaining: 0, transient: 0 })
  })

  it('keeps a temporarily failed stem, moved behind the rest of the queue', async () => {
    const db = own()
    queueArtistStems(db, [{ stemCID: 's1', jamCID: 'j' }], 'tqk', 1000)
    queueArtistStems(db, [{ stemCID: 's2', jamCID: 'j' }], 'tqk', 2000)
    const batch = await takeArtistScanBatch(
      db,
      1,
      deps({ s1: { status: 'transient', path: null } })
    )
    expect(batch).toEqual({ status: 'ok', targets: [], remaining: 2, transient: 1 })
    expect(peekArtistScanQueue(db, 2).map((r) => r.stemCID)).toEqual(['s2', 's1'])
  })

  it('an artist across the own db and the archive: the drive pulled mid-batch loses nothing', async () => {
    const db = own()
    queueArtistStems(
      db,
      [
        { stemCID: 'own1', jamCID: 'shared:feed' },
        { stemCID: 'arc1', jamCID: 'archive-jam' }
      ],
      'tqk',
      1000
    )
    // The own-db stem lands on the SSD; the archive one fails to write (EACCES).
    const batch = await takeArtistScanBatch(
      db,
      3,
      deps({
        own1: { status: 'ok', path: '/own/own1' },
        arc1: { status: 'transient', path: null }
      })
    )
    expect(batch).toEqual({
      status: 'ok',
      targets: [{ key: 'own1', path: '/own/own1' }],
      remaining: 2,
      transient: 1
    })
    removeFromArtistScanQueue(db, ['own1'])
    expect(peekArtistScanQueue(db, 5).map((r) => r.stemCID)).toEqual(['arc1'])
  })
})

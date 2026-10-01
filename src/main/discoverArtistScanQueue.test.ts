// src/main/discoverArtistScanQueue.test.ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  artistScanQueueSize,
  peekArtistScanQueue,
  queueArtistStems,
  removeFromArtistScanQueue
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
    expect(queueArtistStems(db, rows, 'tpj', 1000)).toBe(2)
    expect(queueArtistStems(db, rows, 'tpj', 2000)).toBe(0) // idempotent
    expect(artistScanQueueSize(db)).toBe(2)
    expect(peekArtistScanQueue(db, 1)).toEqual([{ stemCID: 's1', jamCID: 'j1', artist: 'tpj' }])
    removeFromArtistScanQueue(db, ['s1'])
    expect(peekArtistScanQueue(db, 5)).toEqual([{ stemCID: 's4', jamCID: 'j1', artist: 'tpj' }])
  })

  it('serves earlier queues first', () => {
    const db = own()
    queueArtistStems(db, [{ stemCID: 'b1', jamCID: 'j' }], 'b', 2000)
    queueArtistStems(db, [{ stemCID: 'a1', jamCID: 'j' }], 'a', 1000)
    expect(peekArtistScanQueue(db, 2).map((r) => r.stemCID)).toEqual(['a1', 'b1'])
  })
})

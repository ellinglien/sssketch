import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

// userDataDir is read fresh on every app.getPath('userData') call (electron
// mocked below), so declaring it as a reassignable module-level `let` and
// pointing beforeEach/afterEach at it -- rather than a fixed literal path --
// gives every test its own isolated, cleaned-up directory. Needed for real
// this time: Task 5's syncJam test below calls the real loginWithCredentials
// (via endlesssApi.ts), whose persistSession writes a real file under
// app.getPath('userData'), and safeStorage must be mocked too or that call
// throws outright (electron's real safeStorage isn't available under
// Vitest). Matches the exact pattern already established in
// endlesssSync.test.ts/loreWarehouse.test.ts/riffFavourites.test.ts.
let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir,
    getVersion: () => '0.0.0-test'
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-lore-warehouse-sync-test-'))
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Jams (JamCID TEXT PRIMARY KEY, PublicName TEXT NOT NULL, SyncComplete INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      Root INTEGER, Scale INTEGER, BPMrnd REAL, BarLength INTEGER, UserName TEXT,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT,
      GainsJSON TEXT, AppVersion INTEGER
    );
    CREATE TABLE Stems (
      StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      FileEndpoint TEXT, FileBucket TEXT, FileKey TEXT, BPMrnd REAL, Instrument INTEGER,
      Length16s REAL, PresetName TEXT, CreatorUserName TEXT
    );
    CREATE TABLE Tags (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, Favour INTEGER NOT NULL DEFAULT 0, Note TEXT);
    CREATE TABLE StemLedger (StemCID TEXT PRIMARY KEY, Type TEXT NOT NULL, Note TEXT);
  `)
  return db
}

function sharedFeedPage(riffCIDs: string[], hasMore: boolean): Record<string, unknown> {
  return {
    data: riffCIDs.map((riffCID, i) => ({
      _id: `shared_${riffCID}`,
      doc_id: riffCID,
      action_timestamp: 1700000000000 + i,
      rifff: {
        _id: riffCID,
        state: {
          bps: 2.0,
          barLength: 4,
          playback: [
            { slot: { current: { on: true, currentLoop: `stem_${riffCID}`, gain: 1 } } },
            ...Array.from({ length: 7 }, () => ({ slot: {} }))
          ]
        },
        userName: 'elling',
        created: 1700000000000 + i,
        root: 0,
        scale: 0
      },
      loops: [
        {
          _id: `stem_${riffCID}`,
          cdn_attachments: {
            oggAudio: { endpoint: 'cdn.example.com', key: `k_${riffCID}`, url: 'unused', length: 1 }
          },
          bps: 2.0,
          length16ths: 64,
          presetName: 'preset',
          creatorUserName: 'elling'
        },
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ]
    })),
    hasMore
  }
}

describe('syncSharedFeed', () => {
  it('walks every page, skeleton-inserts and resolves every riff, and marks the jam complete', async () => {
    const { syncSharedFeed } = await import('./loreWarehouseSync')
    const db = freshDb()
    // listSharedFeed's own hasMore is computed as `summaries.length ===
    // count` (see endlesssApi.ts) -- there's no separate "more available"
    // flag in the real API response, so a page must come back exactly
    // SYNC_SHARED_FEED_PAGE_SIZE (100) items long to read as "there's
    // more". Page 1 is padded to exactly 100 riffs for that reason -- same
    // convention already established in endlesssSync.test.ts's own "syncs
    // riffs from EVERY walked page" test ("this test walks exactly two
    // pages (100 then 2, matching SYNC_SHARED_FEED_PAGE_SIZE=100)"). Page 2
    // is short (1 riff), which is what correctly signals "no more" and
    // stops the walk.
    const page1Cids = Array.from({ length: 100 }, (_, i) => `p1_${i}`)
    const fakeFetch = vi.fn(async (url: string) => {
      const isFirstPage = url.includes('from=0')
      const body = isFirstPage ? sharedFeedPage(page1Cids, true) : sharedFeedPage(['r3'], false)
      return new Response(JSON.stringify({ data: body.data }), { status: 200 })
    })
    // downloadMissingStemsFor issues its own fetch for stem audio bytes --
    // any 200 with a body is fine, this test only asserts on warehouse rows.
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://cdn.example.com')) {
        return new Response(new ArrayBuffer(8), { status: 200 })
      }
      return fakeFetch(url)
    })
    const progressUpdates: { done: number; total: number }[] = []

    await syncSharedFeed('elling', (p) => progressUpdates.push(p), fetchImpl as typeof fetch, db)

    const riffCount = db.prepare('SELECT COUNT(*) as n FROM Riffs').get() as { n: number }
    expect(riffCount.n).toBe(101)
    const resolvedCount = db
      .prepare('SELECT COUNT(*) as n FROM Riffs WHERE AppVersion IS NOT NULL')
      .get() as {
      n: number
    }
    expect(resolvedCount.n).toBe(101)
    const jam = db
      .prepare('SELECT SyncComplete FROM Jams WHERE JamCID = ?')
      .get('shared:elling') as {
      SyncComplete: number
    }
    expect(jam.SyncComplete).toBe(1)
    expect(progressUpdates.length).toBeGreaterThan(0)
  })

  it('a repeat sync with nothing new stops after the first page instead of walking to the end', async () => {
    const { syncSharedFeed } = await import('./loreWarehouseSync')
    const db = freshDb()
    let pageCalls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://cdn.example.com'))
        return new Response(new ArrayBuffer(8), { status: 200 })
      pageCalls++
      // Every call (there should only be one) returns the exact same
      // already-fully-synced riff, with hasMore: true -- if the walk fails
      // to stop early, this fixture would loop forever.
      return new Response(JSON.stringify(sharedFeedPage(['r1'], true)), { status: 200 })
    })

    await syncSharedFeed('elling', () => {}, fetchImpl as typeof fetch, db)
    pageCalls = 0
    await syncSharedFeed('elling', () => {}, fetchImpl as typeof fetch, db)

    expect(pageCalls).toBe(1)
  })
})

function rawRiffListRow(riffCID: string, key: number): Record<string, unknown> {
  return { id: riffCID, key, value: [`stem_${riffCID}`] }
}

function rawJamRiffDoc(riffCID: string): Record<string, unknown> {
  return {
    _id: riffCID,
    state: {
      bps: 2.0,
      barLength: 4,
      playback: [
        { slot: { current: { on: true, currentLoop: `stem_${riffCID}`, gain: 1 } } },
        ...Array.from({ length: 7 }, () => ({ slot: {} }))
      ]
    },
    userName: 'elling',
    created: 1700000000000,
    root: 0,
    scale: 0
  }
}

function rawJamStemDoc(riffCID: string): Record<string, unknown> {
  return {
    _id: `stem_${riffCID}`,
    cdn_attachments: {
      oggAudio: { endpoint: 'cdn.example.com', key: `k_${riffCID}`, url: 'unused', length: 1 }
    },
    bps: 2.0,
    length16ths: 64,
    presetName: 'preset',
    creatorUserName: 'elling'
  }
}

describe('syncJam', () => {
  it('walks the jam, resolves every riff via _all_docs, and marks it complete', async () => {
    vi.resetModules()
    // A logged-in session is required for the private-jam endpoints
    // (listRiffsInJam/resolveJamRiff both call activeSession() internally)
    // -- loginWithCredentials persists it into the same in-memory module
    // state syncJam's own endlesssApi.ts import will read.
    const { loginWithCredentials } = await import('./endlesssApi')
    const { syncJam } = await import('./loreWarehouseSync')
    const db = freshDb()

    const loginFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: 't',
            password: 'p',
            user_id: 'u1',
            expires: Date.now() + 100000
          }),
          {
            status: 200
          }
        )
    )
    await loginWithCredentials('elling', 'hunter2', loginFetch as unknown as typeof fetch)

    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://cdn.example.com'))
        return new Response(new ArrayBuffer(8), { status: 200 })
      if (url.includes('rifffLoopsByCreateTime')) {
        return new Response(
          JSON.stringify({ total_rows: 1, rows: [rawRiffListRow('r1', 1700000000000)] }),
          {
            status: 200
          }
        )
      }
      if (url.includes('_all_docs') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as { keys: string[] }
        const isStemBatch = body.keys[0]?.startsWith('stem_')
        const rows = body.keys.map((id) => ({
          id,
          doc: isStemBatch ? rawJamStemDoc('r1') : rawJamRiffDoc('r1')
        }))
        return new Response(JSON.stringify({ total_rows: rows.length, rows }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    await syncJam('jam_1', 'Test Jam', () => {}, fetchImpl as unknown as typeof fetch, db)

    const riff = db
      .prepare('SELECT AppVersion, StemCID_1 FROM Riffs WHERE RiffCID = ?')
      .get('r1') as {
      AppVersion: number
      StemCID_1: string
    }
    expect(riff.AppVersion).toBe(1)
    expect(riff.StemCID_1).toBe('stem_r1')
    const jam = db
      .prepare('SELECT SyncComplete, PublicName FROM Jams WHERE JamCID = ?')
      .get('jam_1') as {
      SyncComplete: number
      PublicName: string
    }
    expect(jam.SyncComplete).toBe(1)
    expect(jam.PublicName).toBe('Test Jam')
  })
})

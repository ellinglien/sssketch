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
    const { syncSharedFeed } = await import('./riffLibrarySync')
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

  it('refuses a name that is not an Endlesss username (an email login): no request, no jam row', async () => {
    const { syncSharedFeed } = await import('./riffLibrarySync')
    const db = freshDb()
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    await syncSharedFeed('someone@example.org', () => {}, fetchImpl as typeof fetch, db)
    await syncSharedFeed('', () => {}, fetchImpl as typeof fetch, db)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM Jams`).get()).toEqual({ n: 0 })
  })

  it('folds a feed synced under a capitalised login into the lowercase one, every page of it (2026-10-07)', async () => {
    const { syncSharedFeed } = await import('./riffLibrarySync')
    const db = freshDb()
    // The old capitalised sync: 150 riffs, far more than one page of the
    // feed. The new sync below only sees one (short) page.
    db.prepare(
      `INSERT INTO Jams (JamCID, PublicName, SyncComplete) VALUES ('shared:Elling', 'Shared Feed', 1)`
    ).run()
    const insert = db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, AppVersion) VALUES (?, 'shared:Elling', 1)`
    )
    for (let i = 0; i < 150; i++) insert.run(`old_${i}`)
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://cdn.example.com')) {
        return new Response(new ArrayBuffer(8), { status: 200 })
      }
      return new Response(JSON.stringify({ data: sharedFeedPage(['old_0'], false).data }), {
        status: 200
      })
    })

    // typed with a capital, too: still the one lowercase feed
    await syncSharedFeed('Elling', () => {}, fetchImpl as typeof fetch, db)

    expect(db.prepare(`SELECT JamCID FROM Jams`).all()).toEqual([{ JamCID: 'shared:elling' }])
    expect(
      db.prepare(`SELECT OwnerJamCID, COUNT(*) AS n FROM Riffs GROUP BY OwnerJamCID`).all()
    ).toEqual([{ OwnerJamCID: 'shared:elling', n: 150 }])
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain('Elling')
  })

  // Review of 0e27db79: Discover's in-memory indexes name each stem's jam, and
  // the rename moves no count or rowid -- they are dropped, as forget does.
  it("a fold drops Discover's in-memory indexes for the db; a sync with nothing to fold does not", async () => {
    const discover = await import('./discoverCandidates')
    const drop = vi.spyOn(discover, 'dropInMemoryJamIndexes')
    const { syncSharedFeed } = await import('./riffLibrarySync')
    const db = freshDb()
    db.prepare(
      `INSERT INTO Jams (JamCID, PublicName, SyncComplete) VALUES ('shared:Elling', 'Shared Feed', 1)`
    ).run()
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(sharedFeedPage([], false)), { status: 200 })
    )
    try {
      await syncSharedFeed('elling', () => {}, fetchImpl as typeof fetch, db)
      expect(drop).toHaveBeenCalledTimes(1)
      expect(drop).toHaveBeenCalledWith(db)
      await syncSharedFeed('elling', () => {}, fetchImpl as typeof fetch, db)
      expect(drop).toHaveBeenCalledTimes(1)
    } finally {
      drop.mockRestore()
    }
  })

  // Review of 0e27db79: the fold ran inside the sync's try, so a fold that
  // threw ended every later sync of the feed too.
  it('a fold that throws is logged and skipped: the sync goes on, and the next sync folds', async () => {
    const { syncSharedFeed } = await import('./riffLibrarySync')
    const db = freshDb()
    db.exec(`
      INSERT INTO Jams (JamCID, PublicName, SyncComplete) VALUES ('shared:Elling', 'Shared Feed', 1);
      INSERT INTO Riffs (RiffCID, OwnerJamCID, AppVersion) VALUES ('old_0', 'shared:Elling', 1);
      CREATE TRIGGER fail_on_riff_move BEFORE UPDATE OF OwnerJamCID ON Riffs
        WHEN OLD.OwnerJamCID = 'shared:Elling'
        BEGIN SELECT RAISE(ABORT, 'disk full'); END;
    `)
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://cdn.example.com')) {
        return new Response(new ArrayBuffer(8), { status: 200 })
      }
      return new Response(JSON.stringify(sharedFeedPage(['new_0'], false)), { status: 200 })
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await syncSharedFeed('elling', () => {}, fetchImpl as typeof fetch, db)
      expect(errors).toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
    // synced all the same
    expect(
      db.prepare(`SELECT RiffCID FROM Riffs WHERE OwnerJamCID = 'shared:elling'`).all()
    ).toEqual([{ RiffCID: 'new_0' }])

    db.exec(`DROP TRIGGER fail_on_riff_move`)
    await syncSharedFeed('elling', () => {}, fetchImpl as typeof fetch, db)
    expect(db.prepare(`SELECT JamCID FROM Jams`).all()).toEqual([{ JamCID: 'shared:elling' }])
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM Riffs WHERE OwnerJamCID = 'shared:elling'`).get()
    ).toEqual({ n: 2 })
  })

  it('a repeat sync with nothing new stops after the first page instead of walking to the end', async () => {
    const { syncSharedFeed } = await import('./riffLibrarySync')
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
    const { syncJam } = await import('./riffLibrarySync')
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

// A page that never arrived says nothing about where the feed ends: a cancel
// mid-fetch, a network error, a 5xx or a timeout must leave the jam
// resumable, and the next sync must pick up the riffs past that point.
describe('a failed or cancelled page fetch is not the end of the feed', () => {
  const abortError = (): Error => new DOMException('This operation was aborted', 'AbortError')

  /** How the page fetch fails, for each way it can. */
  const failures: [string, () => Promise<Response>][] = [
    ['a 503', async () => new Response('busy', { status: 503 })],
    ['a 500', async () => new Response('oops', { status: 500 })],
    ['a network error', async () => Promise.reject(new TypeError('fetch failed'))],
    [
      'a timeout',
      async () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))
    ],
    ['a malformed body', async () => new Response('<html>', { status: 200 })]
  ]

  function quietErrors(): () => void {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    return () => spy.mockRestore()
  }

  function count(db: Database.Database, where: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM Riffs WHERE ${where}`).get() as { n: number }).n
  }

  function syncComplete(db: Database.Database, jamCID: string): number {
    return (
      db.prepare(`SELECT SyncComplete FROM Jams WHERE JamCID = ?`).get(jamCID) as {
        SyncComplete: number
      }
    ).SyncComplete
  }

  /** A shared feed of `cids`, newest first, paged as the real endpoint is;
   * `failPage(offset)` returns a failure for a page, or null to serve it. */
  function feedFetch(
    cids: () => string[],
    failPage: (offset: number, init?: RequestInit) => Promise<Response> | null
  ): typeof fetch {
    return vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://cdn.example.com'))
        return new Response(new ArrayBuffer(8), { status: 200 })
      const params = new URL(url).searchParams
      const offset = Number(params.get('from'))
      const size = Number(params.get('size'))
      const failure = failPage(offset, init)
      if (failure) return failure
      const page = cids().slice(offset, offset + size)
      return new Response(JSON.stringify(sharedFeedPage(page, false)), { status: 200 })
    }) as unknown as typeof fetch
  }

  const firstSyncCids = [
    ...Array.from({ length: 100 }, (_, i) => `a_${i}`),
    ...Array.from({ length: 30 }, (_, i) => `b_${i}`)
  ]

  it('a shared-feed sync cancelled during a page fetch stays resumable, and the next sync fetches the rest', async () => {
    const { syncSharedFeed, abortSync } = await import('./riffLibrarySync')
    const db = freshDb()
    let cancelNext = true
    const fetchImpl = feedFetch(
      () => firstSyncCids,
      (offset) => {
        if (offset !== 100 || !cancelNext) return null
        cancelNext = false
        // The cancel lands while the second page is in flight; fetch then
        // rejects, as a real one does when its signal aborts.
        expect(abortSync('shared:elling')).toBe(true)
        return Promise.reject(abortError())
      }
    )
    const restore = quietErrors()
    try {
      await syncSharedFeed('elling', () => {}, fetchImpl, db)
    } finally {
      restore()
    }
    expect(count(db, '1')).toBe(100)
    expect(syncComplete(db, 'shared:elling')).toBe(0)

    await syncSharedFeed('elling', () => {}, fetchImpl, db)
    expect(count(db, 'AppVersion IS NOT NULL')).toBe(130)
    expect(syncComplete(db, 'shared:elling')).toBe(1)
  })

  it.each(failures)(
    'a shared-feed page fetch that fails with %s leaves the jam unfinished, and the next sync goes on past it',
    async (_name, fail) => {
      const { syncSharedFeed } = await import('./riffLibrarySync')
      const db = freshDb()
      let failNext = true
      const fetchImpl = feedFetch(
        () => firstSyncCids,
        (offset) => {
          if (offset !== 100 || !failNext) return null
          failNext = false
          return fail()
        }
      )
      const restore = quietErrors()
      try {
        await syncSharedFeed('elling', () => {}, fetchImpl, db)
      } finally {
        restore()
      }
      expect(count(db, '1')).toBe(100)
      expect(syncComplete(db, 'shared:elling')).toBe(0)

      await syncSharedFeed('elling', () => {}, fetchImpl, db)
      expect(count(db, 'AppVersion IS NOT NULL')).toBe(130)
      expect(syncComplete(db, 'shared:elling')).toBe(1)
    }
  )

  it('a synced feed whose catch-up fails past its first page is no longer complete, so the next sync reaches the old riffs', async () => {
    const { syncSharedFeed } = await import('./riffLibrarySync')
    const db = freshDb()
    // Synced to the end once: ten old riffs.
    const old = Array.from({ length: 10 }, (_, i) => `old_${i}`)
    let cids = old
    let failNext = false
    const fetchImpl = feedFetch(
      () => cids,
      (offset) => {
        if (offset !== 100 || !failNext) return null
        failNext = false
        return Promise.resolve(new Response('busy', { status: 503 }))
      }
    )
    await syncSharedFeed('elling', () => {}, fetchImpl, db)
    expect(syncComplete(db, 'shared:elling')).toBe(1)

    // 150 new ones since, more than a page: the catch-up resolves the first
    // page, then the second page's fetch fails.
    const fresh = Array.from({ length: 150 }, (_, i) => `new_${i}`)
    cids = [...fresh, ...old]
    failNext = true
    const restore = quietErrors()
    try {
      await syncSharedFeed('elling', () => {}, fetchImpl, db)
    } finally {
      restore()
    }
    expect(syncComplete(db, 'shared:elling')).toBe(0)

    // The first page is all done now, but the walk must not stop there.
    await syncSharedFeed('elling', () => {}, fetchImpl, db)
    expect(count(db, 'AppVersion IS NOT NULL')).toBe(160)
    expect(syncComplete(db, 'shared:elling')).toBe(1)
  })

  it('a riff whose stem download a cancel cut short is not saved as resolved', async () => {
    const { syncSharedFeed, abortSync } = await import('./riffLibrarySync')
    const db = freshDb()
    let cdnStarted = (): void => {}
    const cdnRequested = new Promise<void>((r) => (cdnStarted = r))
    let holdCdn = true
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://cdn.example.com')) {
        if (!holdCdn) return new Response(new ArrayBuffer(8), { status: 200 })
        cdnStarted()
        // Held until the sync is cancelled, then rejects as fetch does.
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(abortError()))
        })
      }
      return new Response(JSON.stringify(sharedFeedPage(['r1'], false)), { status: 200 })
    }) as unknown as typeof fetch

    const restore = quietErrors()
    try {
      const running = syncSharedFeed('elling', () => {}, fetchImpl, db)
      await cdnRequested
      abortSync('shared:elling')
      await running
    } finally {
      restore()
    }
    expect(count(db, 'AppVersion IS NOT NULL')).toBe(0)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM StemLedger`).get()).toEqual({ n: 0 })
    expect(syncComplete(db, 'shared:elling')).toBe(0)

    holdCdn = false
    await syncSharedFeed('elling', () => {}, fetchImpl, db)
    expect(count(db, 'AppVersion IS NOT NULL')).toBe(1)
    expect(syncComplete(db, 'shared:elling')).toBe(1)
  })

  describe('a private jam', () => {
    async function loggedIn(): Promise<typeof import('./riffLibrarySync')> {
      vi.resetModules()
      const { loginWithCredentials } = await import('./endlesssApi')
      const loginFetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ token: 't', password: 'p', user_id: 'u1', expires: Date.now() + 1e5 }),
            { status: 200 }
          )
      )
      await loginWithCredentials('elling', 'hunter2', loginFetch as unknown as typeof fetch)
      return import('./riffLibrarySync')
    }

    // 200 is the jam page size: two pages, the second short.
    const jamCids = Array.from({ length: 230 }, (_, i) => `j_${i}`)

    function jamFetch(failPage: (offset: number) => Promise<Response> | null): typeof fetch {
      return vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith('https://cdn.example.com'))
          return new Response(new ArrayBuffer(8), { status: 200 })
        if (url.includes('rifffLoopsByCreateTime')) {
          const params = new URL(url).searchParams
          const offset = Number(params.get('skip'))
          const limit = Number(params.get('limit'))
          const failure = failPage(offset)
          if (failure) return failure
          const rows = jamCids
            .slice(offset, offset + limit)
            .map((cid, i) => rawRiffListRow(cid, 1700000000000 - offset - i))
          return new Response(JSON.stringify({ total_rows: jamCids.length, rows }), {
            status: 200
          })
        }
        if (url.includes('_all_docs') && init?.method === 'POST') {
          const { keys } = JSON.parse(init.body as string) as { keys: string[] }
          const rows = keys.map((id) => ({
            id,
            doc: id.startsWith('stem_')
              ? rawJamStemDoc(id.slice('stem_'.length))
              : rawJamRiffDoc(id)
          }))
          return new Response(JSON.stringify({ total_rows: rows.length, rows }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }) as unknown as typeof fetch
    }

    it.each(failures)(
      'a jam page fetch that fails with %s leaves the jam unfinished, and the next sync goes on past it',
      async (_name, fail) => {
        const { syncJam } = await loggedIn()
        const db = freshDb()
        let failNext = true
        const fetchImpl = jamFetch((offset) => {
          if (offset !== 200 || !failNext) return null
          failNext = false
          return fail()
        })
        const restore = quietErrors()
        try {
          await syncJam('jam_1', 'Test Jam', () => {}, fetchImpl, db)
        } finally {
          restore()
        }
        expect(count(db, '1')).toBe(200)
        expect(syncComplete(db, 'jam_1')).toBe(0)

        await syncJam('jam_1', 'Test Jam', () => {}, fetchImpl, db)
        expect(count(db, 'AppVersion IS NOT NULL')).toBe(230)
        expect(syncComplete(db, 'jam_1')).toBe(1)
      }
    )

    it('a jam sync cancelled during a page fetch stays resumable', async () => {
      const { syncJam, abortSync } = await loggedIn()
      const db = freshDb()
      let cancelNext = true
      const fetchImpl = jamFetch((offset) => {
        if (offset !== 200 || !cancelNext) return null
        cancelNext = false
        expect(abortSync('jam_1')).toBe(true)
        return Promise.reject(abortError())
      })
      const restore = quietErrors()
      try {
        await syncJam('jam_1', 'Test Jam', () => {}, fetchImpl, db)
      } finally {
        restore()
      }
      expect(syncComplete(db, 'jam_1')).toBe(0)

      await syncJam('jam_1', 'Test Jam', () => {}, fetchImpl, db)
      expect(count(db, 'AppVersion IS NOT NULL')).toBe(230)
      expect(syncComplete(db, 'jam_1')).toBe(1)
    })

    it('a jam sync with no session is not complete, and says to log in', async () => {
      vi.resetModules()
      const { syncJam } = await import('./riffLibrarySync')
      const db = freshDb()
      const restore = quietErrors()
      let outcome
      try {
        outcome = await syncJam(
          'jam_1',
          'Test Jam',
          () => {},
          jamFetch(() => null),
          db
        )
      } finally {
        restore()
      }
      expect(syncComplete(db, 'jam_1')).toBe(0)
      expect(outcome).toEqual({ stopped: 'logged-out' })
    })
  })
})

// Review of b18e27fb. A private jam served the way the real endpoints are --
// the listing paged by skip, riff and stem docs from _all_docs -- with every
// request logged by kind, so a test can say what a sync cost.
describe('a private jam: riffs that fail, and jams marked complete too early (review of b18e27fb)', () => {
  const abortError = (): Error => new DOMException('This operation was aborted', 'AbortError')

  async function loggedIn(): Promise<typeof import('./riffLibrarySync')> {
    vi.resetModules()
    const { loginWithCredentials } = await import('./endlesssApi')
    const loginFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ token: 't', password: 'p', user_id: 'u1', expires: Date.now() + 1e6 }),
          { status: 200 }
        )
    )
    await loginWithCredentials('elling', 'hunter2', loginFetch as unknown as typeof fetch)
    return import('./riffLibrarySync')
  }

  function quietErrors(): () => void {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    return () => {
      error.mockRestore()
      warn.mockRestore()
    }
  }

  function count(db: Database.Database, where: string): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM Riffs WHERE ${where}`).get() as { n: number }).n
  }

  function syncComplete(db: Database.Database, jamCID: string): number {
    return (
      db.prepare(`SELECT SyncComplete FROM Jams WHERE JamCID = ?`).get(jamCID) as {
        SyncComplete: number
      }
    ).SyncComplete
  }

  /** A riff saved stemless: what the old stem lookup left behind. */
  const STEMLESS = 'AppVersion IS NOT NULL AND StemCID_1 IS NULL'

  type Kind = 'list' | 'riffdoc' | 'stemdocs' | 'cdn'

  interface JamServer {
    fetchImpl: typeof fetch
    requests: (kind: Kind) => number
    reset: () => void
  }

  /** `cids` newest first. Each `fail*` returns a failure for that request,
   * or null to serve it. `emptyRiffs` have no active slot. */
  function jamServer(opts: {
    cids: () => string[]
    failList?: (offset: number) => Promise<Response> | null
    failRiffDoc?: (riffCID: string) => Promise<Response> | null
    failStemDocs?: (riffCID: string) => Promise<Response> | null
    emptyRiffs?: Set<string>
  }): JamServer {
    const log: Kind[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://cdn.example.com')) {
        log.push('cdn')
        return new Response(new ArrayBuffer(8), { status: 200 })
      }
      if (url.includes('rifffLoopsByCreateTime')) {
        log.push('list')
        const params = new URL(url).searchParams
        const offset = Number(params.get('skip'))
        const limit = Number(params.get('limit'))
        const failure = opts.failList?.(offset)
        if (failure) return failure
        const all = opts.cids()
        const rows = all
          .slice(offset, offset + limit)
          .map((cid, i) => rawRiffListRow(cid, 1700000000000 - offset - i))
        return new Response(JSON.stringify({ total_rows: all.length, rows }), { status: 200 })
      }
      if (url.includes('_all_docs') && init?.method === 'POST') {
        const { keys } = JSON.parse(init.body as string) as { keys: string[] }
        const stemBatch = keys[0].startsWith('stem_')
        log.push(stemBatch ? 'stemdocs' : 'riffdoc')
        const riffCID = stemBatch ? keys[0].slice('stem_'.length) : keys[0]
        const failure = stemBatch ? opts.failStemDocs?.(riffCID) : opts.failRiffDoc?.(riffCID)
        if (failure) return failure
        const rows = keys.map((id) => {
          if (id.startsWith('stem_')) return { id, doc: rawJamStemDoc(id.slice('stem_'.length)) }
          const doc = rawJamRiffDoc(id)
          if (opts.emptyRiffs?.has(id)) {
            ;(doc.state as { playback: unknown[] }).playback = Array.from({ length: 8 }, () => ({
              slot: {}
            }))
          }
          return { id, doc }
        })
        return new Response(JSON.stringify({ rows }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch
    return {
      fetchImpl,
      requests: (kind) => log.filter((k) => k === kind).length,
      reset: () => {
        log.length = 0
      }
    }
  }

  /** Riffs already held: `resolved` with a stem, `stemless` with none. */
  function seed(
    db: Database.Database,
    jamCID: string,
    complete: 0 | 1,
    riffs: { resolved?: string[]; unresolved?: string[]; stemless?: string[] }
  ): void {
    db.prepare(`INSERT INTO Jams (JamCID, PublicName, SyncComplete) VALUES (?, 'J', ?)`).run(
      jamCID,
      complete
    )
    const insert = db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime, AppVersion, StemCID_1, GainsJSON)
       VALUES (?, ?, 0, ?, ?, ?)`
    )
    db.transaction(() => {
      for (const cid of riffs.resolved ?? []) insert.run(cid, jamCID, 1, `stem_${cid}`, '{"1":1}')
      for (const cid of riffs.unresolved ?? []) insert.run(cid, jamCID, null, null, null)
      for (const cid of riffs.stemless ?? []) insert.run(cid, jamCID, 1, null, '{}')
    })()
  }

  const cidsOf = (prefix: string, n: number): string[] =>
    Array.from({ length: n }, (_, i) => `${prefix}_${i}`)

  // CRITICAL: a stem lookup that failed came back as no stems, and the riff
  // was saved resolved with none, for good.
  it.each([
    ['a 503', async () => new Response('busy', { status: 503 })],
    ['a network error', async () => Promise.reject(new TypeError('fetch failed'))],
    [
      'a timeout',
      async () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))
    ]
  ])(
    'a stem lookup that fails with %s leaves the riff unresolved and the jam unfinished; the next sync fetches it whole',
    async (_name, fail) => {
      const { syncJam } = await loggedIn()
      const db = freshDb()
      let failNext = true
      const server = jamServer({
        cids: () => cidsOf('r', 3),
        failStemDocs: (cid) => {
          if (cid !== 'r_1' || !failNext) return null
          failNext = false
          return fail()
        }
      })
      const restore = quietErrors()
      try {
        await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
      } finally {
        restore()
      }
      expect(count(db, STEMLESS)).toBe(0)
      expect(count(db, `RiffCID = 'r_1' AND AppVersion IS NULL`)).toBe(1)
      expect(count(db, 'AppVersion IS NOT NULL')).toBe(2)
      // A riff in this run failed: not complete, though the walk reached the end.
      expect(syncComplete(db, 'jam_1')).toBe(0)

      server.reset()
      await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
      expect(count(db, `StemCID_1 = 'stem_r_1' AND AppVersion = 1`)).toBe(1)
      expect(server.requests('riffdoc')).toBe(1)
      expect(syncComplete(db, 'jam_1')).toBe(1)
    }
  )

  it('a cancel during the stem lookup leaves the riff unresolved, not saved with no stems', async () => {
    const { syncJam, abortSync } = await loggedIn()
    const db = freshDb()
    let cancelNext = true
    const server = jamServer({
      cids: () => cidsOf('r', 1),
      failStemDocs: () => {
        if (!cancelNext) return null
        cancelNext = false
        expect(abortSync('jam_1')).toBe(true)
        return Promise.reject(abortError())
      }
    })
    const restore = quietErrors()
    try {
      await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
    } finally {
      restore()
    }
    expect(count(db, STEMLESS)).toBe(0)
    expect(count(db, 'AppVersion IS NULL')).toBe(1)
    expect(syncComplete(db, 'jam_1')).toBe(0)

    await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
    expect(count(db, `StemCID_1 = 'stem_r_0' AND AppVersion = 1`)).toBe(1)
    expect(syncComplete(db, 'jam_1')).toBe(1)
  })

  it('a riff with no active slots is a real empty riff: resolved, and the jam complete', async () => {
    const { syncJam } = await loggedIn()
    const db = freshDb()
    const server = jamServer({ cids: () => cidsOf('r', 2), emptyRiffs: new Set(['r_1']) })
    await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
    expect(count(db, `RiffCID = 'r_1' AND ${STEMLESS}`)).toBe(1)
    expect(syncComplete(db, 'jam_1')).toBe(1)
  })

  // A 429 used to go through every remaining riff, each one failing too.
  describe('a 429', () => {
    afterEach(() => {
      vi.useRealTimers()
      // The backoff is module state: no later test inherits it.
      vi.resetModules()
    })

    it('during the stem lookup stops the run; the next sync waits out the backoff without a request', async () => {
      const { syncJam } = await loggedIn()
      vi.useFakeTimers({ toFake: ['Date'] })
      const db = freshDb()
      let limit = true
      const server = jamServer({
        cids: () => cidsOf('r', 30),
        failStemDocs: () =>
          limit
            ? Promise.resolve(
                new Response('slow down', { status: 429, headers: { 'Retry-After': '30' } })
              )
            : null
      })
      const restore = quietErrors()
      let first, second
      try {
        first = await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
        // No riff past the ones already in flight (three lanes) is asked for.
        expect(server.requests('riffdoc')).toBeLessThanOrEqual(3)
        server.reset()
        second = await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
      } finally {
        restore()
      }
      expect(first).toEqual({ stopped: 'rate-limited', retryAt: Date.now() + 30_000 })
      expect(second).toEqual(first)
      expect(server.requests('list') + server.requests('riffdoc')).toBe(0)
      expect(count(db, STEMLESS)).toBe(0)
      expect(syncComplete(db, 'jam_1')).toBe(0)

      limit = false
      vi.setSystemTime(Date.now() + 31_000)
      const third = await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
      expect(third).toEqual({ stopped: null })
      expect(count(db, 'AppVersion = 1 AND StemCID_1 IS NOT NULL')).toBe(30)
      expect(syncComplete(db, 'jam_1')).toBe(1)
    })

    it('on a listing page stops the run, a minute by default', async () => {
      const { syncJam } = await loggedIn()
      vi.useFakeTimers({ toFake: ['Date'] })
      const db = freshDb()
      const server = jamServer({
        cids: () => cidsOf('r', 230),
        failList: (offset) =>
          offset === 200 ? Promise.resolve(new Response('', { status: 429 })) : null
      })
      const restore = quietErrors()
      let outcome
      try {
        outcome = await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
      } finally {
        restore()
      }
      expect(outcome).toEqual({ stopped: 'rate-limited', retryAt: Date.now() + 60_000 })
      expect(syncComplete(db, 'jam_1')).toBe(0)
    })
  })

  // IMPORTANT: a riff that failed for any reason but a cancel was left
  // behind -- the jam was marked complete once the walk reached its end.
  it('a riff whose doc fetch fails is not left behind: the jam stays unfinished until it is fetched', async () => {
    const { syncJam } = await loggedIn()
    const db = freshDb()
    let failNext = true
    const server = jamServer({
      cids: () => cidsOf('r', 230),
      failRiffDoc: (cid) => {
        if (cid !== 'r_5' || !failNext) return null
        failNext = false
        return Promise.resolve(new Response('oops', { status: 500 }))
      }
    })
    const restore = quietErrors()
    try {
      await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
    } finally {
      restore()
    }
    expect(count(db, 'AppVersion IS NULL')).toBe(1)
    expect(syncComplete(db, 'jam_1')).toBe(0)

    server.reset()
    await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
    expect(count(db, 'AppVersion IS NULL')).toBe(0)
    expect(syncComplete(db, 'jam_1')).toBe(1)
    // Both pages listed, only the one riff fetched.
    expect(server.requests('list')).toBe(2)
    expect(server.requests('riffdoc')).toBe(1)
  })

  // IMPORTANT: jams marked complete under the old rule were never walked
  // again -- Night Owl, Techno! (27 unfetched riffs on its last page).
  it('a jam marked complete with unfetched riffs is walked to them, fetching only those', async () => {
    const { syncJam } = await loggedIn()
    const db = freshDb()
    const cids = cidsOf('r', 230)
    seed(db, 'jam_1', 1, { resolved: cids.slice(0, 203), unresolved: cids.slice(203) })
    const server = jamServer({ cids: () => cids })
    await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
    expect(server.requests('list')).toBe(2)
    expect(server.requests('riffdoc')).toBe(27)
    expect(count(db, 'AppVersion IS NULL')).toBe(0)
    expect(syncComplete(db, 'jam_1')).toBe(1)
  })

  // Aethereal Forest held exactly 6000; ellingelling none at all. Page 0's
  // total comes free with it.
  it.each([
    ['fewer riffs than the jam has', 400, 450, 3, 50],
    ['no riffs at all', 0, 5, 1, 5]
  ])(
    'a jam marked complete holding %s is walked to the end',
    async (_name, held, total, lists, fetched) => {
      const { syncJam } = await loggedIn()
      const db = freshDb()
      const cids = cidsOf('r', total)
      seed(db, 'jam_1', 1, { resolved: cids.slice(0, held) })
      const server = jamServer({ cids: () => cids })
      await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
      expect(server.requests('list')).toBe(lists)
      expect(server.requests('riffdoc')).toBe(fetched)
      expect(count(db, 'AppVersion = 1')).toBe(total)
      expect(syncComplete(db, 'jam_1')).toBe(1)
    }
  )

  it('a complete jam with nothing new costs one listing request and no riff fetches', async () => {
    const { syncJam } = await loggedIn()
    const db = freshDb()
    const cids = cidsOf('r', 230)
    seed(db, 'jam_1', 1, { resolved: cids })
    const server = jamServer({ cids: () => cids })
    await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
    expect(server.requests('list')).toBe(1)
    expect(server.requests('riffdoc') + server.requests('stemdocs')).toBe(0)
    expect(syncComplete(db, 'jam_1')).toBe(1)
  })

  it('a walk resumed past done pages fetches no riff on them', async () => {
    const { syncJam } = await loggedIn()
    const db = freshDb()
    const cids = cidsOf('r', 900)
    // A first sync cut off after 500: pages 0-1 done, page 2 half done.
    seed(db, 'jam_1', 0, { resolved: cids.slice(0, 500), unresolved: cids.slice(500, 600) })
    const server = jamServer({ cids: () => cids })
    await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
    expect(server.requests('list')).toBe(5)
    expect(server.requests('riffdoc')).toBe(400)
    expect(server.requests('stemdocs')).toBe(400)
    expect(syncComplete(db, 'jam_1')).toBe(1)
  })

  it('a synced jam whose catch-up fails past its first page is no longer complete, so the next sync reaches the old riffs', async () => {
    const { syncJam } = await loggedIn()
    const db = freshDb()
    const old = cidsOf('old', 10)
    let cids = old
    let failNext = false
    const server = jamServer({
      cids: () => cids,
      failList: (offset) => {
        if (offset !== 200 || !failNext) return null
        failNext = false
        return Promise.resolve(new Response('busy', { status: 503 }))
      }
    })
    await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
    expect(syncComplete(db, 'jam_1')).toBe(1)

    // 250 new since, more than a page: the catch-up resolves the first page,
    // then the second page's listing fails.
    cids = [...cidsOf('new', 250), ...old]
    failNext = true
    const restore = quietErrors()
    try {
      await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
    } finally {
      restore()
    }
    expect(syncComplete(db, 'jam_1')).toBe(0)

    await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
    expect(count(db, 'AppVersion = 1')).toBe(260)
    expect(syncComplete(db, 'jam_1')).toBe(1)
  })

  // The heal, end to end: what the old stem lookup left in Elling's library
  // is fetched again by the next sync, once.
  it('a riff saved stemless before is fetched again whole; one with no active slots only once', async () => {
    const { syncJam } = await loggedIn()
    const db = freshDb()
    const cids = cidsOf('r', 4)
    seed(db, 'jam_1', 1, { resolved: cids.slice(0, 2), stemless: cids.slice(2) })
    seed(db, 'shared:elling', 1, { stemless: ['shared_r'] })
    // r_3 really has no active slot.
    const server = jamServer({ cids: () => cids, emptyRiffs: new Set(['r_3']) })

    await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
    expect(server.requests('riffdoc')).toBe(2)
    expect(count(db, `RiffCID = 'r_2' AND StemCID_1 = 'stem_r_2' AND AppVersion = 1`)).toBe(1)
    expect(count(db, `RiffCID = 'r_3' AND ${STEMLESS}`)).toBe(1)
    expect(count(db, `RiffCID = 'shared_r' AND ${STEMLESS}`)).toBe(1)
    expect(syncComplete(db, 'jam_1')).toBe(1)

    server.reset()
    await syncJam('jam_1', 'J', () => {}, server.fetchImpl, db)
    expect(server.requests('list')).toBe(1)
    expect(server.requests('riffdoc')).toBe(0)
  })
})

describe('syncs in flight', () => {
  /** A feed whose first page waits until `release`. */
  function heldFeed(): {
    fetchImpl: typeof fetch
    release: () => void
    signals: (AbortSignal | undefined)[]
  } {
    let release = (): void => {}
    const held = new Promise<void>((r) => (release = r))
    const signals: (AbortSignal | undefined)[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://cdn.example.com')) {
        return new Response(new ArrayBuffer(8), { status: 200 })
      }
      signals.push(init?.signal ?? undefined)
      await held
      return new Response(JSON.stringify(sharedFeedPage([], false)), { status: 200 })
    }) as unknown as typeof fetch
    return { fetchImpl, release, signals }
  }

  // Review of 0e27db79: the sync runs under the lowercase key, so a cancel
  // or a remove naming the feed as it was spelled must find it.
  it('abortSync stops the running shared:elling sync when asked for shared:Elling', async () => {
    const { syncSharedFeed, abortSync, activeSyncCount } = await import('./riffLibrarySync')
    const db = freshDb()
    const feed = heldFeed()
    const running = syncSharedFeed('Elling', () => {}, feed.fetchImpl, db)
    await vi.waitFor(() => expect(feed.signals).toHaveLength(1))
    expect(abortSync('shared:Elling')).toBe(true)
    expect(feed.signals[0]?.aborted).toBe(true)
    feed.release()
    await running
    expect(activeSyncCount()).toBe(0)
  })

  it('removeJamSync refuses shared:Elling while shared:elling is syncing', async () => {
    const { syncSharedFeed, removeJamSync } = await import('./riffLibrarySync')
    const db = freshDb()
    const feed = heldFeed()
    const running = syncSharedFeed('elling', () => {}, feed.fetchImpl, db)
    expect(() => removeJamSync('shared:Elling', false, db)).toThrow(/sync is currently running/)
    feed.release()
    await running
  })

  // Read by BackgroundWorkIndicator.tsx (via index.ts's
  // riff-library-sync-active push), so "syncing library" shows while any
  // sync runs -- including one started while the Library Browser is closed.
  it('reports how many syncs are running as each one starts and finishes', async () => {
    const { syncSharedFeed, activeSyncCount, setSyncsInFlightListener } =
      await import('./riffLibrarySync')
    const db = freshDb()
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: sharedFeedPage([], false).data }), { status: 200 })
    )
    const counts: number[] = []
    setSyncsInFlightListener((count) => counts.push(count))
    try {
      const running = syncSharedFeed('elling', () => {}, fetchImpl as typeof fetch, db)
      expect(activeSyncCount()).toBe(1)
      await running
      expect(activeSyncCount()).toBe(0)
      expect(counts).toEqual([1, 0])
    } finally {
      setSyncsInFlightListener(null)
    }
  })
})

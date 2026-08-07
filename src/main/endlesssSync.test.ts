import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('runWithConcurrency', () => {
  it('calls the worker exactly once for every item', async () => {
    const { runWithConcurrency } = await import('./endlesssSync')
    const seen: number[] = []
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item)
    })
    expect(seen.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('never runs more than `limit` workers concurrently', async () => {
    const { runWithConcurrency } = await import('./endlesssSync')
    let inFlight = 0
    let maxInFlight = 0
    await runWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight--
      }
    )
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  it('handles an empty item list without error', async () => {
    const { runWithConcurrency } = await import('./endlesssSync')
    const worker = vi.fn()
    await runWithConcurrency([], 3, worker)
    expect(worker).not.toHaveBeenCalled()
  })
})

vi.mock('electron', () => ({
  app: {
    getPath: () => (globalThis as unknown as { __testUserDataDir: string }).__testUserDataDir,
    getVersion: () => '0.0.0-test'
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

function sharedFeedEntry(riffCID: string, stemCID: string): Record<string, unknown> {
  return {
    _id: `shared_${riffCID}`,
    doc_id: riffCID,
    action_timestamp: 1700000000000,
    rifff: {
      _id: riffCID,
      state: {
        bps: 2.0,
        barLength: 4,
        playback: [
          { slot: { current: { on: true, currentLoop: stemCID, gain: 1 } } },
          ...Array.from({ length: 7 }, () => ({ slot: {} }))
        ]
      },
      userName: 'elling',
      created: 1700000000000,
      root: 0,
      scale: 5
    },
    loops: [
      {
        _id: stemCID,
        cdn_attachments: {
          oggAudio: {
            endpoint: 'ndls-att0.fra1.digitaloceanspaces.com',
            key: `attachments/oggAudio/1/${stemCID}`,
            url: `https://ndls-att0.fra1.digitaloceanspaces.com/attachments/oggAudio/1/${stemCID}`,
            length: 100
          }
        },
        bps: 2.0,
        length16ths: 64,
        presetName: 'Kick',
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
  }
}

describe('syncSharedFeed', () => {
  let userDataDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-sync-test-'))
    ;(globalThis as unknown as { __testUserDataDir: string }).__testUserDataDir = userDataDir
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('syncs every new riff on a first-ever run and marks the index complete', async () => {
    const audioBytes = new TextEncoder().encode('fake ogg bytes')
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('shared_by')) {
        return new Response(
          JSON.stringify({
            data: [sharedFeedEntry('riff_1', 'stem_1'), sharedFeedEntry('riff_2', 'stem_2')]
          }),
          { status: 200 }
        )
      }
      return new Response(audioBytes, { status: 200 })
    })
    const { syncSharedFeed } = await import('./endlesssSync')
    const progressCalls: { done: number; total: number }[] = []
    await syncSharedFeed(
      'elling',
      (p) => progressCalls.push({ ...p }),
      fakeFetch as unknown as typeof fetch
    )

    const { loadSyncIndex } = await import('./endlesssSyncIndex')
    const index = loadSyncIndex('shared', 'elling')
    expect(index).not.toBeNull()
    expect(index!.order).toEqual(['riff_1', 'riff_2'])
    expect(index!.complete).toBe(true)
    expect(index!.riffs.riff_1.resolved.stems[0].path).not.toBeNull()
    expect(progressCalls[progressCalls.length - 1]).toEqual({ done: 2, total: 2 })
  })

  it('a second sync run only processes riffs newer than what is already indexed', async () => {
    const audioBytes = new TextEncoder().encode('fake ogg bytes')
    let feedCallCount = 0
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('shared_by')) {
        feedCallCount++
        return new Response(JSON.stringify({ data: [sharedFeedEntry('riff_1', 'stem_1')] }), {
          status: 200
        })
      }
      return new Response(audioBytes, { status: 200 })
    })
    const { syncSharedFeed } = await import('./endlesssSync')
    await syncSharedFeed('elling', () => {}, fakeFetch as unknown as typeof fetch)
    const firstFeedCallCount = feedCallCount

    const progressCalls: { done: number; total: number }[] = []
    await syncSharedFeed(
      'elling',
      (p) => progressCalls.push({ ...p }),
      fakeFetch as unknown as typeof fetch
    )
    expect(progressCalls).toEqual([{ done: 0, total: 0 }])
    // Zero additional listing calls: listSharedFeed's own sync-index fast
    // path (see endlesssApi.ts) already serves this page from the local
    // index since it's complete, so the "nothing new since last time"
    // discovery costs no network call at all.
    expect(feedCallCount).toBe(firstFeedCallCount)
  })

  it('does not start a second sync for the same userName while one is already running', async () => {
    let releaseGate: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    let feedCallCount = 0
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('shared_by')) {
        feedCallCount++
        await gate
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }
      return new Response(new Uint8Array(), { status: 200 })
    })
    const { syncSharedFeed } = await import('./endlesssSync')
    const first = syncSharedFeed('elling', () => {}, fakeFetch as unknown as typeof fetch)
    const second = syncSharedFeed('elling', () => {}, fakeFetch as unknown as typeof fetch)
    await second
    expect(feedCallCount).toBe(1)
    releaseGate!()
    await first
  })
})

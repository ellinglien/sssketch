// src/renderer/src/audio/libraryScanSource.test.ts
import { describe, expect, it } from 'vitest'
import type { StemAnalysisNeeds } from '@shared/stemAnalysisNeeds'
import { createLibraryScanSource, type LibraryScanSource } from './libraryScanSource'
import type { AnalysisWorkItem } from './backgroundAnalysisQueue'

const NEEDY: StemAnalysisNeeds = { peaks: true, features: true, embedding: true, zeroShot: false }

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function targets(keys: string[]): { key: string; path: string }[] {
  return keys.map((key) => ({ key, path: `/x/${key}` }))
}

/** Ranks by key prefix: own- 0, fav- 1, anything else 2. */
function rankByPrefix(keys: string[]): number[] {
  return keys.map((k) => (k.startsWith('own-') ? 0 : k.startsWith('fav-') ? 1 : 2))
}

async function drain(
  next: (n: number) => Promise<AnalysisWorkItem[] | 'idle' | 'done'>
): Promise<string[]> {
  const out: string[] = []
  for (;;) {
    const got = await next(100)
    if (got === 'done' || got === 'idle') return out
    out.push(...got.map((item) => item.key))
  }
}

interface Harness {
  source: LibraryScanSource
  /** Needs pages asked for once manualPages() was called, in order. */
  pages: Deferred<StemAnalysisNeeds[]>[]
  manualPages: () => void
}

function harness(keys: string[], pageSize: number): Harness {
  const pages: Deferred<StemAnalysisNeeds[]>[] = []
  let manual = false
  const source = createLibraryScanSource({
    targets: targets(keys),
    pageSize,
    fetchNeeds: (paths) => {
      if (!manual) return Promise.resolve(paths.map(() => NEEDY))
      const page = deferred<StemAnalysisNeeds[]>()
      pages.push(page)
      return page.promise
    },
    isCancelled: () => false,
    onAlreadyDone: () => {},
    onDone: () => {},
    onNeedsFailed: () => {}
  })
  return {
    source,
    pages,
    manualPages: () => {
      manual = true
    }
  }
}

describe('createLibraryScanSource', () => {
  it('hands the targets out a page at a time, in order', async () => {
    const { source } = harness(['a', 'b', 'c', 'd', 'e'], 2)
    expect(await drain((n) => source.next(n))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('a re-rank reorders the buffered page and the targets not yet paged, each group in order', async () => {
    const { source } = harness(['r1', 'own-1', 'r2', 'fav-1', 'r3', 'own-2'], 3)
    expect((await source.next(1)) as AnalysisWorkItem[]).toHaveLength(1) // r1
    expect(await source.rerank(async (keys) => rankByPrefix(keys))).toBe('applied')
    expect(await drain((n) => source.next(n))).toEqual(['own-1', 'r2', 'own-2', 'fav-1', 'r3'])
  })

  // Review of 06eecbdc: a page whose needs were still loading when the
  // re-rank collected its keys landed unranked -- behind every own stem the
  // re-rank had moved up, though it held own stems itself.
  it('ranks a page that was loading when the re-rank started, once it lands', async () => {
    const h = harness(['r1', 'own-1', 'r2', 'own-2', 'r3', 'own-3'], 3)
    h.manualPages()
    const first = h.source.next(10) // page 1 (r1, own-1, r2) loading
    const ranks = deferred<number[]>()
    let asked: string[] = []
    const rerank = h.source.rerank((keys) => {
      asked = keys
      return ranks.promise
    })
    expect(asked).toEqual(['r1', 'own-1', 'r2', 'own-2', 'r3', 'own-3'])
    ranks.resolve(rankByPrefix(asked))
    expect(await rerank).toBe('applied')
    h.pages[0].resolve([NEEDY, NEEDY, NEEDY])
    expect(((await first) as AnalysisWorkItem[]).map((i) => i.key)).toEqual(['own-1', 'r1', 'r2'])
  })

  it('ranks a page that lands while the re-rank is still being answered', async () => {
    const h = harness(['r1', 'r2', 'own-1', 'own-2', 'r3', 'own-3'], 3)
    h.manualPages()
    const first = h.source.next(1) // page 1 (r1, r2, own-1) loading
    const ranks = deferred<number[]>()
    let asked: string[] = []
    const rerank = h.source.rerank((keys) => {
      asked = keys
      return ranks.promise
    })
    h.pages[0].resolve([NEEDY, NEEDY, NEEDY])
    expect(((await first) as AnalysisWorkItem[]).map((i) => i.key)).toEqual(['r1'])
    ranks.resolve(rankByPrefix(asked))
    expect(await rerank).toBe('applied')
    // what is left of page 1, own stem first
    expect(((await h.source.next(10)) as AnalysisWorkItem[]).map((i) => i.key)).toEqual([
      'own-1',
      'r2'
    ])
    const page2 = h.source.next(10)
    h.pages[1].resolve([NEEDY, NEEDY, NEEDY])
    expect(((await page2) as AnalysisWorkItem[]).map((i) => i.key)).toEqual([
      'own-2',
      'own-3',
      'r3'
    ])
  })

  it('drops the answer of a re-rank that a newer one overtook', async () => {
    const { source } = harness(['r1', 'own-1', 'fav-1', 'r2'], 10)
    const older = deferred<number[]>()
    const newer = deferred<number[]>()
    let olderKeys: string[] = []
    const first = source.rerank((keys) => {
      olderKeys = keys
      return older.promise
    })
    const second = source.rerank((keys) => newer.promise.then(() => rankByPrefix(keys)))
    newer.resolve([])
    expect(await second).toBe('applied')
    // the older answer ranks everything the other way round, and arrives last
    older.resolve(olderKeys.map((k) => (k.startsWith('r') ? 0 : 2)))
    expect(await first).toBe('superseded')
    expect(await drain((n) => source.next(n))).toEqual(['own-1', 'fav-1', 'r1', 'r2'])
  })

  // Review of 99b33f45: a newer re-rank that failed still dropped the older
  // one's answer, so neither was applied.
  it('applies an older answer when the newer re-rank fails', async () => {
    const { source } = harness(['r1', 'own-1', 'fav-1', 'r2'], 10)
    const older = deferred<number[]>()
    let olderKeys: string[] = []
    const first = source.rerank((keys) => {
      olderKeys = keys
      return older.promise
    })
    const second = source.rerank(() => Promise.reject(new Error('ipc failed')))
    await expect(second).rejects.toThrow('ipc failed')
    older.resolve(rankByPrefix(olderKeys))
    expect(await first).toBe('applied')
    expect(await drain((n) => source.next(n))).toEqual(['own-1', 'fav-1', 'r1', 'r2'])
  })

  it('an older answer arriving before the newer one is applied, then the newer one wins', async () => {
    const { source } = harness(['r1', 'own-1', 'fav-1', 'r2'], 10)
    const older = deferred<number[]>()
    const newer = deferred<number[]>()
    let olderKeys: string[] = []
    let newerKeys: string[] = []
    const first = source.rerank((keys) => {
      olderKeys = keys
      return older.promise
    })
    const second = source.rerank((keys) => {
      newerKeys = keys
      return newer.promise
    })
    // the older answer ranks the r- stems first
    older.resolve(olderKeys.map((k) => (k.startsWith('r') ? 0 : 2)))
    expect(await first).toBe('applied')
    newer.resolve(rankByPrefix(newerKeys))
    expect(await second).toBe('applied')
    expect(await drain((n) => source.next(n))).toEqual(['own-1', 'fav-1', 'r1', 'r2'])
  })
})

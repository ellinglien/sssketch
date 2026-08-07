import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LoreResolvedRiff, LoreRiffSummary } from '@shared/loreLibrary'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-sync-index-test-'))
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

function fakeSummary(riffCID: string): LoreRiffSummary {
  return {
    riffCID,
    creationTime: 1700000000,
    bpm: 120,
    barLength: 4,
    userName: 'elling',
    stemCount: 1,
    cachedStemCount: 1,
    ownerFraction: 1
  }
}

function fakeResolved(riffCID: string): LoreResolvedRiff {
  return { riffCID, bpm: 120, barLength: 4, stems: [] }
}

describe('endlesssSyncIndex', () => {
  it('loadSyncIndex returns null when no file exists yet', async () => {
    const { loadSyncIndex } = await import('./endlesssSyncIndex')
    expect(loadSyncIndex('shared', 'elling')).toBeNull()
  })

  it('loadSyncIndex returns null (never throws) on corrupt JSON', async () => {
    const { loadSyncIndex, saveSyncIndex } = await import('./endlesssSyncIndex')
    saveSyncIndex('shared', 'elling', { updatedAt: 1, complete: false, order: [], riffs: {} })
    const path = join(userDataDir, 'endlesss-cache', 'sync-index', 'shared-elling.json')
    writeFileSync(path, 'not json{{{')
    expect(loadSyncIndex('shared', 'elling')).toBeNull()
  })

  it('saveSyncIndex then loadSyncIndex round-trips exactly', async () => {
    const { loadSyncIndex, saveSyncIndex } = await import('./endlesssSyncIndex')
    const index = {
      updatedAt: 123,
      complete: true,
      order: ['riff_1', 'riff_2'],
      riffs: {
        riff_1: { summary: fakeSummary('riff_1'), resolved: fakeResolved('riff_1') },
        riff_2: { summary: fakeSummary('riff_2'), resolved: fakeResolved('riff_2') }
      }
    }
    saveSyncIndex('shared', 'elling', index)
    expect(loadSyncIndex('shared', 'elling')).toEqual(index)
  })

  it('sanitizes the key so an unsafe username still produces a valid, working path', async () => {
    const { saveSyncIndex, loadSyncIndex } = await import('./endlesssSyncIndex')
    saveSyncIndex('shared', 'weird/../name', {
      updatedAt: 1,
      complete: false,
      order: [],
      riffs: {}
    })
    expect(loadSyncIndex('shared', 'weird/../name')).not.toBeNull()
  })

  it('loadOrCreateSyncIndex returns a fresh empty index when nothing is saved yet', async () => {
    const { loadOrCreateSyncIndex } = await import('./endlesssSyncIndex')
    expect(loadOrCreateSyncIndex('jam', 'jam_abc')).toEqual({
      updatedAt: 0,
      complete: false,
      order: [],
      riffs: {}
    })
  })

  it('getSyncStatus returns null when nothing has been synced', async () => {
    const { getSyncStatus } = await import('./endlesssSyncIndex')
    expect(getSyncStatus('jam', 'jam_abc')).toBeNull()
  })

  it('getSyncStatus reports riffCount/updatedAt/complete from a saved index', async () => {
    const { saveSyncIndex, getSyncStatus } = await import('./endlesssSyncIndex')
    saveSyncIndex('jam', 'jam_abc', {
      updatedAt: 555,
      complete: true,
      order: ['riff_1'],
      riffs: { riff_1: { summary: fakeSummary('riff_1'), resolved: fakeResolved('riff_1') } }
    })
    expect(getSyncStatus('jam', 'jam_abc')).toEqual({
      riffCount: 1,
      updatedAt: 555,
      complete: true
    })
  })

  it('sliceSyncedPage returns a page when the requested range is fully covered', async () => {
    const { sliceSyncedPage } = await import('./endlesssSyncIndex')
    const index = {
      updatedAt: 1,
      complete: false,
      order: ['riff_1', 'riff_2', 'riff_3'],
      riffs: {
        riff_1: { summary: fakeSummary('riff_1'), resolved: fakeResolved('riff_1') },
        riff_2: { summary: fakeSummary('riff_2'), resolved: fakeResolved('riff_2') },
        riff_3: { summary: fakeSummary('riff_3'), resolved: fakeResolved('riff_3') }
      }
    }
    const page = sliceSyncedPage(index, 0, 2)
    expect(page).not.toBeNull()
    expect(page!.riffs.map((r) => r.riffCID)).toEqual(['riff_1', 'riff_2'])
    expect(page!.hasMore).toBe(true)
    expect(page!.nextOffset).toBe(2)
  })

  it('sliceSyncedPage returns null when the requested range exceeds what is synced', async () => {
    const { sliceSyncedPage } = await import('./endlesssSyncIndex')
    const index = {
      updatedAt: 1,
      complete: false,
      order: ['riff_1'],
      riffs: { riff_1: { summary: fakeSummary('riff_1'), resolved: fakeResolved('riff_1') } }
    }
    expect(sliceSyncedPage(index, 0, 5)).toBeNull()
  })

  it('sliceSyncedPage still serves a (shorter) page when complete is true, even if count overflows what is synced', async () => {
    const { sliceSyncedPage } = await import('./endlesssSyncIndex')
    const index = {
      updatedAt: 1,
      complete: true,
      order: ['riff_1'],
      riffs: { riff_1: { summary: fakeSummary('riff_1'), resolved: fakeResolved('riff_1') } }
    }
    const page = sliceSyncedPage(index, 0, 30)
    expect(page).not.toBeNull()
    expect(page!.riffs.map((r) => r.riffCID)).toEqual(['riff_1'])
    expect(page!.hasMore).toBe(false)
    expect(page!.nextOffset).toBe(1)
  })

  it('sliceSyncedPage at the exact synced boundary reports hasMore based on `complete`', async () => {
    const { sliceSyncedPage } = await import('./endlesssSyncIndex')
    const index = {
      updatedAt: 1,
      complete: false,
      order: ['riff_1'],
      riffs: { riff_1: { summary: fakeSummary('riff_1'), resolved: fakeResolved('riff_1') } }
    }
    expect(sliceSyncedPage(index, 0, 1)!.hasMore).toBe(true)
    index.complete = true
    expect(sliceSyncedPage(index, 0, 1)!.hasMore).toBe(false)
  })

  it('sliceSyncedRiff returns resolved detail for a synced riff, null for an unsynced one', async () => {
    const { sliceSyncedRiff } = await import('./endlesssSyncIndex')
    const index = {
      updatedAt: 1,
      complete: false,
      order: ['riff_1'],
      riffs: { riff_1: { summary: fakeSummary('riff_1'), resolved: fakeResolved('riff_1') } }
    }
    expect(sliceSyncedRiff(index, 'riff_1')).toEqual(fakeResolved('riff_1'))
    expect(sliceSyncedRiff(index, 'riff_never_synced')).toBeNull()
  })
})

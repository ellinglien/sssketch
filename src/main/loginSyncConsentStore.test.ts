import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))

describe('loginSyncConsentStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'login-sync-consent-test-'))
    const { app } = await import('electron')
    vi.mocked(app.getPath).mockReturnValue(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('asks with no file and no earlier sync; an earlier sync is a yes, and is written down', async () => {
    const { loadLoginSyncConsent } = await import('./loginSyncConsentStore')
    expect(loadLoginSyncConsent(() => false)).toBe('ask')
    expect(loadLoginSyncConsent(() => true)).toBe('yes')
    expect(JSON.parse(readFileSync(join(dir, 'loginSync.json'), 'utf-8'))).toEqual({
      consent: 'yes'
    })
    expect(loadLoginSyncConsent(() => false)).toBe('yes')
  })

  it('keeps an answer, and a no is not overruled by an earlier sync', async () => {
    const { loadLoginSyncConsent, saveLoginSyncConsent } = await import('./loginSyncConsentStore')
    saveLoginSyncConsent('no')
    expect(loadLoginSyncConsent(() => true)).toBe('no')
    saveLoginSyncConsent('yes')
    expect(loadLoginSyncConsent(() => false)).toBe('yes')
  })

  it('a corrupted file reads as no answer', async () => {
    writeFileSync(join(dir, 'loginSync.json'), 'not json{{', 'utf-8')
    const { loadLoginSyncConsent } = await import('./loginSyncConsentStore')
    expect(loadLoginSyncConsent(() => false)).toBe('ask')
  })

  it('an earlier sync is any synced riff in the own db, the discovered room aside', async () => {
    const { ownDbHasEarlierSync } = await import('./loginSyncConsentStore')
    const db = new Database(':memory:')
    db.exec('CREATE TABLE Riffs (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL)')
    expect(ownDbHasEarlierSync(db)).toBe(false)
    db.prepare('INSERT INTO Riffs VALUES (?, ?)').run('k1', 'discovered')
    expect(ownDbHasEarlierSync(db)).toBe(false)
    db.prepare('INSERT INTO Riffs VALUES (?, ?)').run('r1', 'shared:someone')
    expect(ownDbHasEarlierSync(db)).toBe(true)
    db.close()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))

describe('ownUsernameStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'own-username-test-'))
    const { app } = await import('electron')
    vi.mocked(app.getPath).mockReturnValue(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('is null before anything was saved, then the saved name, trimmed', async () => {
    const { loadOwnUsername, saveOwnUsername } = await import('./ownUsernameStore')
    expect(loadOwnUsername()).toBeNull()
    saveOwnUsername('  elling ')
    expect(loadOwnUsername()).toBe('elling')
  })

  it('saving none (or a blank) forgets it', async () => {
    const { loadOwnUsername, saveOwnUsername } = await import('./ownUsernameStore')
    saveOwnUsername('elling')
    saveOwnUsername(null)
    expect(loadOwnUsername()).toBeNull()
    saveOwnUsername('elling')
    saveOwnUsername('   ')
    expect(loadOwnUsername()).toBeNull()
  })

  it('a broken file reads as none, never a throw', async () => {
    writeFileSync(join(dir, 'ownUsername.json'), '{not json')
    const { loadOwnUsername } = await import('./ownUsernameStore')
    expect(loadOwnUsername()).toBeNull()
    writeFileSync(join(dir, 'ownUsername.json'), JSON.stringify({ username: 42 }))
    expect(loadOwnUsername()).toBeNull()
  })
})

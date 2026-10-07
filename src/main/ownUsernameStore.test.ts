import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
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

  it('saves through a temp file renamed over the old one: nothing left behind', async () => {
    const { loadOwnUsername, saveOwnUsername } = await import('./ownUsernameStore')
    saveOwnUsername('elling')
    saveOwnUsername('other')
    expect(loadOwnUsername()).toBe('other')
    expect(readdirSync(dir)).toEqual(['ownUsername.json'])
  })

  it('a save that fails leaves the saved name as it was, never a throw', async () => {
    const { loadOwnUsername, saveOwnUsername } = await import('./ownUsernameStore')
    saveOwnUsername('elling')
    // The temp file can't be opened for writing: a direct writeFileSync would
    // have truncated the real file before failing; this never touches it.
    mkdirSync(join(dir, 'ownUsername.json.tmp'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => saveOwnUsername('other')).not.toThrow()
    expect(error).toHaveBeenCalled()
    expect(loadOwnUsername()).toBe('elling')
    expect(existsSync(join(dir, 'ownUsername.json.tmp'))).toBe(true)
    error.mockRestore()
  })

  it('a name saved before usernames were normalised reads as the username, or none (2026-10-07)', async () => {
    const { loadOwnUsername } = await import('./ownUsernameStore')
    writeFileSync(join(dir, 'ownUsername.json'), JSON.stringify({ username: ' Elling ' }))
    expect(loadOwnUsername()).toBe('elling')
    // an email login was once saved as "me": it is nobody, never the email
    writeFileSync(
      join(dir, 'ownUsername.json'),
      JSON.stringify({ username: 'someone@example.org' })
    )
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

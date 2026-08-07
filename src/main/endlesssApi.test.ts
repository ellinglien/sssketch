import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: {
    getPath: () => globalThis.__testUserDataDir,
    getVersion: () => '0.0.0-test'
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s), // no real encryption needed for tests
    decryptString: (b: Buffer) => b.toString()
  }
}))

// File-level default so every test has a valid userData dir for
// safeStorage/persistSession to write into, even tests that don't care
// about persistence themselves (the login describe below).
let defaultUserDataDir: string

beforeEach(() => {
  defaultUserDataDir = mkdtempSync(join(tmpdir(), 'sssketch-endlesss-test-'))
  ;(globalThis as unknown as { __testUserDataDir: string }).__testUserDataDir = defaultUserDataDir
})

afterEach(() => {
  rmSync(defaultUserDataDir, { recursive: true, force: true })
})

describe('endlesssApi login', () => {
  beforeEach(() => {
    // Same rationale as the persistence describe below: the module caches
    // currentSession/sessionLoadAttempted at module scope, shared across
    // every test in this file by default. None of these tests currently
    // assert on session state, but resetting keeps that true rather than
    // relying on it by accident for whoever adds the next test here.
    vi.resetModules()
  })

  it('loginWithCredentials returns a session on a valid response', async () => {
    const { loginWithCredentials } = await import('./endlesssApi')
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.endlesss.fm/auth/login')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(init!.body as string)).toEqual({
        username: 'elling',
        password: 'hunter2'
      })
      return new Response(
        JSON.stringify({
          token: 'tok_abc',
          password: 'sess_pw_xyz',
          user_id: 'user_123',
          expires: 1999999999000
        }),
        { status: 200 }
      )
    })
    const result = await loginWithCredentials('elling', 'hunter2', fakeFetch as typeof fetch)
    expect(result).toEqual({
      ok: true,
      session: {
        token: 'tok_abc',
        password: 'sess_pw_xyz',
        userId: 'user_123',
        username: 'elling',
        expires: 1999999999000
      }
    })
  })

  it('loginWithCredentials surfaces the backend error message on bad credentials', async () => {
    const { loginWithCredentials } = await import('./endlesssApi')
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'invalid username or password' }), { status: 401 })
    )
    const result = await loginWithCredentials('elling', 'wrong', fakeFetch as typeof fetch)
    expect(result).toEqual({ ok: false, error: 'invalid username or password' })
  })

  it('loginWithCredentials falls back to a generic message when the backend gives none', async () => {
    const { loginWithCredentials } = await import('./endlesssApi')
    const fakeFetch = vi.fn(async () => new Response('not json', { status: 401 }))
    const result = await loginWithCredentials('elling', 'wrong', fakeFetch as typeof fetch)
    expect(result).toEqual({
      ok: false,
      error: "couldn't log in — check your username and password"
    })
  })

  it('loginWithCredentials reports a network failure distinctly', async () => {
    const { loginWithCredentials } = await import('./endlesssApi')
    const fakeFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const result = await loginWithCredentials('elling', 'hunter2', fakeFetch as typeof fetch)
    expect(result).toEqual({ ok: false, error: "couldn't reach Endlesss — check your connection" })
  })
})

describe('endlesssApi session persistence', () => {
  let userDataDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-endlesss-test-'))
    ;(globalThis as unknown as { __testUserDataDir: string }).__testUserDataDir = userDataDir
    // The module caches currentSession/sessionLoadAttempted at module scope,
    // and vitest's default module cache is shared across every test in this
    // file (including the login describe above) -- without this, a session
    // from an earlier test leaks into later tests via that cache.
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('getAuthStatus reports logged-out when no session has ever been saved', async () => {
    const { getAuthStatus } = await import('./endlesssApi')
    expect(getAuthStatus()).toEqual({ loggedIn: false })
  })

  it('a successful login persists a session that getAuthStatus picks up', async () => {
    const { loginWithCredentials, getAuthStatus } = await import('./endlesssApi')
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: 't',
            password: 'p',
            user_id: 'u1',
            expires: Date.now() + 1000 * 60 * 60 * 24
          }),
          { status: 200 }
        )
    )
    await loginWithCredentials('elling', 'hunter2', fakeFetch as typeof fetch)
    const status = getAuthStatus()
    expect(status.loggedIn).toBe(true)
    if (status.loggedIn) {
      expect(status.userId).toBe('u1')
    }
  })

  it('getAuthStatus reports logged-out once expires is in the past', async () => {
    const { loginWithCredentials, getAuthStatus } = await import('./endlesssApi')
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ token: 't', password: 'p', user_id: 'u1', expires: Date.now() - 1000 }),
          { status: 200 }
        )
    )
    await loginWithCredentials('elling', 'hunter2', fakeFetch as typeof fetch)
    expect(getAuthStatus()).toEqual({ loggedIn: false })
  })

  it('logout clears both the in-memory and persisted session', async () => {
    const { loginWithCredentials, getAuthStatus, logout } = await import('./endlesssApi')
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: 't',
            password: 'p',
            user_id: 'u1',
            expires: Date.now() + 1000 * 60 * 60 * 24
          }),
          { status: 200 }
        )
    )
    await loginWithCredentials('elling', 'hunter2', fakeFetch as typeof fetch)
    expect(getAuthStatus().loggedIn).toBe(true)
    logout()
    expect(getAuthStatus()).toEqual({ loggedIn: false })
  })

  it('session persists across a fresh module load (proves the file round-trip, not just in-memory state)', async () => {
    const { loginWithCredentials } = await import('./endlesssApi')
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: 't',
            password: 'p',
            user_id: 'u1',
            expires: Date.now() + 1000 * 60 * 60 * 24
          }),
          { status: 200 }
        )
    )
    await loginWithCredentials('elling', 'hunter2', fakeFetch as typeof fetch)

    vi.resetModules()
    ;(globalThis as unknown as { __testUserDataDir: string }).__testUserDataDir = userDataDir
    const { getAuthStatus } = await import('./endlesssApi')
    const status = getAuthStatus()
    expect(status.loggedIn).toBe(true)
    if (status.loggedIn) {
      expect(status.userId).toBe('u1')
    }
  })
})

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/sssketch-test-userdata',
    getVersion: () => '0.0.0-test'
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

describe('endlesssApi login', () => {
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

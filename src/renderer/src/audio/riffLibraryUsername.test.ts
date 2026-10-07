import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AuthStatus =
  | { loggedIn: false }
  | { loggedIn: true; userId: string; username: string; loginName?: string; expiresAt: number }

describe('following the Endlesss session after the first answer (2026-10-07 review)', () => {
  let pushUsernameChanged: (() => void) | null
  let endlesssAuthStatus: ReturnType<typeof vi.fn<() => Promise<AuthStatus>>>

  beforeEach(() => {
    vi.resetModules()
    pushUsernameChanged = null
    endlesssAuthStatus = vi.fn<() => Promise<AuthStatus>>()
    const win = Object.assign(new EventTarget(), {
      rifffApi: {
        endlesssAuthStatus,
        onEndlesssUsernameChanged: (callback: () => void): (() => void) => {
          pushUsernameChanged = callback
          return () => {
            pushUsernameChanged = null
          }
        }
      }
    })
    vi.stubGlobal('window', win)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  const loggedInAs = (username: string): AuthStatus => ({
    loggedIn: true,
    userId: 'u1',
    username,
    loginName: 'someone@example.org',
    expiresAt: 1
  })

  it("an email login resolved later reaches an open view: main's word re-asks auth status", async () => {
    const u = await import('./riffLibraryUsername')
    const seen: AuthStatus[] = []
    const stopRelay = u.relayEndlesssUsernameChanges()
    const stopFollowing = u.followEndlesssAuthStatus((s) => seen.push(s))

    endlesssAuthStatus.mockResolvedValue(loggedInAs('elling'))
    expect(pushUsernameChanged).not.toBeNull()
    pushUsernameChanged!()
    await flush()
    expect(endlesssAuthStatus).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([loggedInAs('elling')])

    stopFollowing()
    stopRelay()
    expect(pushUsernameChanged).toBeNull()
  })

  it('a logout reads as logged out at once, without asking', async () => {
    const u = await import('./riffLibraryUsername')
    const seen: AuthStatus[] = []
    const stop = u.followEndlesssAuthStatus((s) => seen.push(s))
    u.announceEndlesssLoggedOut()
    await flush()
    expect(seen).toEqual([{ loggedIn: false }])
    expect(endlesssAuthStatus).not.toHaveBeenCalled()
    stop()
  })

  it('an older answer arriving after a newer one is dropped', async () => {
    const u = await import('./riffLibraryUsername')
    const seen: AuthStatus[] = []
    const stop = u.followEndlesssAuthStatus((s) => seen.push(s))
    let answerFirst!: (s: AuthStatus) => void
    endlesssAuthStatus.mockReturnValueOnce(new Promise((r) => (answerFirst = r)))
    endlesssAuthStatus.mockResolvedValueOnce(loggedInAs('elling'))
    u.announceRiffLibraryUsernameChanged()
    u.announceRiffLibraryUsernameChanged()
    await flush()
    answerFirst(loggedInAs(''))
    await flush()
    expect(seen).toEqual([loggedInAs('elling')])
    stop()
  })

  it('stops listening once stopped', async () => {
    const u = await import('./riffLibraryUsername')
    const seen: AuthStatus[] = []
    u.followEndlesssAuthStatus((s) => seen.push(s))()
    u.announceEndlesssLoggedOut()
    await flush()
    expect(seen).toEqual([])
  })
})

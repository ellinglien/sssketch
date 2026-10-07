import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AuthStatus =
  | { loggedIn: false }
  | { loggedIn: true; userId: string; username: string; loginName?: string; expiresAt: number }

describe('following the Endlesss session after the first answer (2026-10-07 review)', () => {
  let pushUsernameChanged: (() => void) | null
  let pushSessionEnded: (() => void) | null
  let endlesssAuthStatus: ReturnType<typeof vi.fn<() => Promise<AuthStatus>>>

  beforeEach(() => {
    vi.resetModules()
    pushUsernameChanged = null
    pushSessionEnded = null
    endlesssAuthStatus = vi.fn<() => Promise<AuthStatus>>()
    const win = Object.assign(new EventTarget(), {
      rifffApi: {
        endlesssAuthStatus,
        onEndlesssUsernameChanged: (callback: () => void): (() => void) => {
          pushUsernameChanged = callback
          return () => {
            pushUsernameChanged = null
          }
        },
        onEndlesssSessionEnded: (callback: () => void): (() => void) => {
          pushSessionEnded = callback
          return () => {
            pushSessionEnded = null
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

  // Review of a00e7aab: a session Endlesss refused (a 401) or one past its
  // expiry left an open view logged in, "log in to sync" beside a sync button
  // and no login form. Main's word that it ended re-asks auth status -- as a
  // change, not a logout: the saved "me" is kept, since nobody chose this.
  it("a session main ended reaches an open view: auth status is asked again, and it isn't a logout", async () => {
    const u = await import('./riffLibraryUsername')
    const seen: AuthStatus[] = []
    const events: Event[] = []
    const record = (e: Event): number => events.push(e)
    window.addEventListener(u.RIFF_LIBRARY_USERNAME_CHANGED_EVENT, record)
    const stopRelay = u.relayEndlesssUsernameChanges()
    const stopFollowing = u.followEndlesssAuthStatus((s) => seen.push(s))

    endlesssAuthStatus.mockResolvedValue({ loggedIn: false })
    expect(pushSessionEnded).not.toBeNull()
    pushSessionEnded!()
    await flush()
    expect(endlesssAuthStatus).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([{ loggedIn: false }])
    expect(events.map((e) => u.isLoggedOutEvent(e))).toEqual([false])

    stopFollowing()
    stopRelay()
    window.removeEventListener(u.RIFF_LIBRARY_USERNAME_CHANGED_EVENT, record)
    expect(pushSessionEnded).toBeNull()
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

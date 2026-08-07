// src/renderer/src/components/EndlesssLoginPanel.tsx
import { useEffect, useMemo, useState } from 'react'

type AuthStatus =
  { loggedIn: false } | { loggedIn: true; userId: string; username: string; expiresAt: number }

function daysLeftFor(status: AuthStatus): number | null {
  if (!status.loggedIn) return null
  return Math.max(0, Math.round((status.expiresAt - Date.now()) / (1000 * 60 * 60 * 24)))
}

/** Covers both auth paths sssketch's direct-Endlesss integration needs: a
 * real username/password login (unlocks private jams and private shares),
 * and -- since the shared-feed target explicitly doesn't require a session
 * (see the design spec) -- reports session status so callers (the shared
 * feed and private jams tabs) can decide what to show. Session state itself
 * lives in the main process (endlesssApi.ts); this component just reflects
 * it and drives login/logout. */
export function EndlesssLoginPanel({
  onStatusChange
}: {
  /** Fires once on mount with the current status, then again after any
   * successful login/logout -- callers (EndlesssLibraryBrowser's tabs) use
   * this to decide whether to show a jam list / feed vs a login prompt. */
  onStatusChange: (status: AuthStatus) => void
}): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus>({ loggedIn: false })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const daysLeft = useMemo(() => daysLeftFor(status), [status])

  useEffect(() => {
    let cancelled = false
    window.rifffApi
      .endlesssAuthStatus()
      .then((s) => {
        if (cancelled) return
        setStatus(s)
        onStatusChange(s)
      })
      .catch((err) => {
        console.error('EndlesssLoginPanel: endlesssAuthStatus() failed:', err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onStatusChange intentionally excluded, only fires on mount and after explicit login/logout below, not on every parent re-render
  }, [])

  async function handleLogin(): Promise<void> {
    if (username.trim() === '' || password === '') return
    setLoggingIn(true)
    setError(null)
    try {
      const result = await window.rifffApi.endlesssLogin(username.trim(), password)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setPassword('')
      const s = await window.rifffApi.endlesssAuthStatus()
      setStatus(s)
      onStatusChange(s)
    } catch (err) {
      console.error('EndlesssLoginPanel: endlesssLogin() failed:', err)
      setError("couldn't reach Endlesss — check your connection")
    } finally {
      setLoggingIn(false)
    }
  }

  async function handleLogout(): Promise<void> {
    await window.rifffApi.endlesssLogout()
    const s: AuthStatus = { loggedIn: false }
    setStatus(s)
    onStatusChange(s)
  }

  if (status.loggedIn) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 10,
          color: 'var(--ra-text-2)'
        }}
      >
        <span>
          logged in as {status.loggedIn ? status.username : ''}
          {daysLeft !== null && (
            <>
              {' '}
              — session expires in {daysLeft} day{daysLeft === 1 ? '' : 's'}
            </>
          )}
        </span>
        <button
          onClick={() => void handleLogout()}
          style={{
            height: 20,
            borderRadius: 0,
            padding: '0 8px',
            fontSize: 10,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text-2)'
          }}
        >
          log out
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="endlesss username"
          style={{
            height: 22,
            fontSize: 10,
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)',
            border: '1px solid var(--ra-border)',
            borderRadius: 0,
            padding: '0 6px'
          }}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleLogin()
          }}
          style={{
            height: 22,
            fontSize: 10,
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)',
            border: '1px solid var(--ra-border)',
            borderRadius: 0,
            padding: '0 6px'
          }}
        />
        <button
          onClick={() => void handleLogin()}
          disabled={loggingIn}
          style={{
            height: 22,
            borderRadius: 0,
            padding: '0 10px',
            fontSize: 10,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: loggingIn ? 'var(--ra-text-4)' : 'var(--ra-text)'
          }}
        >
          {loggingIn ? 'logging in…' : 'log in'}
        </button>
      </div>
      {error && <span style={{ fontSize: 10, color: 'var(--ra-mute-on)' }}>{error}</span>}
    </div>
  )
}

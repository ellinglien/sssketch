// src/renderer/src/components/EndlesssLoginPanel.tsx
import { useEffect, useMemo, useState } from 'react'
import { announceEndlesssLoggedOut } from '../audio/riffLibraryUsername'

type AuthStatus =
  | { loggedIn: false }
  | { loggedIn: true; userId: string; username: string; loginName?: string; expiresAt: number }

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
  onStatusChange,
  syncQuestion = null,
  onSyncAnswer,
  offerSyncNow = false
}: {
  /** Fires once on mount with the current status, then again after any
   * successful login/logout -- callers (EndlesssLibraryBrowser's tabs) use
   * this to decide whether to show a jam list / feed vs a login prompt. */
  onStatusChange: (status: AuthStatus) => void
  /** "sync your jams now? ..." (@shared/loginSyncConsent), shown under the logged-in line until
   * answered. Null: not asked. */
  syncQuestion?: string | null
  onSyncAnswer?: (consent: 'yes' | 'no') => void
  /** Answered "not now": a quiet "sync my jams" beside log out, to change his mind. */
  offerSyncNow?: boolean
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
    // A deliberate logout: "me" is nobody now, unless a username is typed.
    announceEndlesssLoggedOut()
    const s: AuthStatus = { loggedIn: false }
    setStatus(s)
    onStatusChange(s)
  }

  const smallButton: React.CSSProperties = {
    height: 20,
    borderRadius: 0,
    padding: '0 8px',
    fontSize: 10,
    border: '1px solid var(--ra-border)',
    background: 'var(--ra-bg-row-active)',
    color: 'var(--ra-text-2)'
  }

  if (status.loggedIn) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
            logged in as {status.loggedIn ? status.username || status.loginName || '' : ''}
            {daysLeft !== null && (
              <>
                {' '}
                — session expires in {daysLeft} day{daysLeft === 1 ? '' : 's'}
              </>
            )}
          </span>
          {offerSyncNow && onSyncAnswer && (
            <button
              onClick={() => onSyncAnswer('yes')}
              data-tooltip="download your shared feed and your own jam"
              style={smallButton}
            >
              sync my jams
            </button>
          )}
          <button onClick={() => void handleLogout()} style={smallButton}>
            log out
          </button>
        </div>
        {syncQuestion !== null && onSyncAnswer && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '6px 8px',
              border: '1px solid var(--ra-border)',
              fontSize: 10,
              color: 'var(--ra-text-2)'
            }}
          >
            <span style={{ color: 'var(--ra-text)' }}>{syncQuestion}</span>
            <span style={{ color: 'var(--ra-text-3)' }}>
              every stem downloads to your music folder (sssketch/library). this can be large.
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => onSyncAnswer('yes')}
                style={{ ...smallButton, color: 'var(--ra-text)' }}
              >
                sync
              </button>
              <button onClick={() => onSyncAnswer('no')} style={smallButton}>
                not now
              </button>
            </div>
          </div>
        )}
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

import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API_HOST = 'https://api.endlesss.fm'
export const DATA_HOST = 'https://data.endlesss.fm'

/** Injectable fetch seam, matching this codebase's existing
 * binaryPathOverride-style convention (see pluginScan.ts/engineProcess.ts) --
 * tests supply a fake implementation instead of hitting the real network. */
export type FetchLike = typeof fetch

export interface EndlesssSession {
  token: string
  /** The session-scoped credential returned alongside token -- NOT the
   * literal account password the person typed (see the design spec's
   * grounding section). Paired with token for both Basic auth against
   * data.endlesss.fm and Bearer auth against api.endlesss.fm. */
  password: string
  userId: string
  /** The username/email actually typed at login -- persisted alongside the
   * session because some endpoints (jam membership) key off the username,
   * not the opaque user_id, and the login response doesn't echo it back. */
  username: string
  /** Unix milliseconds. */
  expires: number
}

interface EndlesssLoginResponse {
  token: string
  password: string
  user_id: string
  expires: number
}

const SESSION_FILENAME = 'endlesss-session.enc'

function sessionFilePath(): string {
  return join(app.getPath('userData'), SESSION_FILENAME)
}

let currentSession: EndlesssSession | null = null
let sessionLoadAttempted = false

/** Encrypts and writes the session to disk. If safeStorage encryption isn't
 * available on this platform/environment, the session simply isn't
 * persisted -- requiring login every launch is a safer failure mode than
 * ever writing these credentials in plaintext. */
function persistSession(session: EndlesssSession): void {
  if (!safeStorage.isEncryptionAvailable()) return
  const encrypted = safeStorage.encryptString(JSON.stringify(session))
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(sessionFilePath(), encrypted)
}

function loadPersistedSession(): EndlesssSession | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  const path = sessionFilePath()
  if (!existsSync(path)) return null
  try {
    const decrypted = safeStorage.decryptString(readFileSync(path))
    const parsed = JSON.parse(decrypted) as Partial<EndlesssSession>
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.password !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.username !== 'string' ||
      typeof parsed.expires !== 'number'
    ) {
      return null
    }
    return parsed as EndlesssSession
  } catch (err) {
    console.error('endlesssApi: failed to load persisted session:', err)
    return null
  }
}

/** Lazily loads whatever session was persisted from a previous launch, at
 * most once per process lifetime -- every other call just reads the
 * in-memory currentSession, which loginWithCredentials/logout also keep in
 * sync. */
function ensureSessionLoaded(): void {
  if (sessionLoadAttempted) return
  sessionLoadAttempted = true
  currentSession = loadPersistedSession()
}

/** The live session, or null if there isn't one / it's expired. Every
 * network function in this module that needs auth calls this rather than
 * reading currentSession directly, so expiry is checked in exactly one
 * place. */
function activeSession(): EndlesssSession | null {
  ensureSessionLoaded()
  if (!currentSession || currentSession.expires <= Date.now()) return null
  return currentSession
}

export function getAuthStatus():
  { loggedIn: false } | { loggedIn: true; userId: string; expiresAt: number } {
  const session = activeSession()
  if (!session) return { loggedIn: false }
  return { loggedIn: true, userId: session.userId, expiresAt: session.expires }
}

export function logout(): void {
  currentSession = null
  sessionLoadAttempted = true
  const path = sessionFilePath()
  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch (err) {
      console.error('endlesssApi: failed to remove persisted session on logout:', err)
    }
  }
}

function userAgent(): string {
  try {
    return `sssketch/${app.getVersion()}`
  } catch {
    return 'sssketch'
  }
}

// "Being a good citizen" per the design spec: OUROVEON's own rAPI config
// caps timeouts at 3-8s depending on connection quality. This module
// doesn't distinguish connection quality, so it uses the more conservative
// (unstable-connection) end of that range as a single fixed timeout, rather
// than letting a hung request wait forever. Deliberately no multi-attempt
// retry loop -- the UI's own error handling already surfaces a failure
// clearly, and the person can just retry the action by hand, which is a
// simpler and equally effective substitute for automatic retries in a
// feature that isn't hit at any real frequency.
const REQUEST_TIMEOUT_MS = 8000

/** Wraps `fetchImpl` with a hard timeout via AbortController -- every
 * network call in this module goes through this rather than calling
 * `fetchImpl` directly, so the "no hung request" guarantee applies
 * everywhere without each call site re-implementing it. */
async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** POSTs real login credentials to Endlesss's own login endpoint and returns
 * the resulting session, or a user-facing error string. The literal typed
 * password is used exactly once, right here -- never persisted, never sent
 * again (see saveSession/EndlesssSession's own doc comment). */
export async function loginWithCredentials(
  username: string,
  password: string,
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; session: EndlesssSession } | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetchWithTimeout(fetchImpl, `${API_HOST}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent() },
      body: JSON.stringify({ username, password })
    })
  } catch {
    return { ok: false, error: "couldn't reach Endlesss — check your connection" }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (!res.ok) {
    const message = (body as { message?: unknown } | null)?.message
    return {
      ok: false,
      error:
        typeof message === 'string' && message.trim() !== ''
          ? message
          : "couldn't log in — check your username and password"
    }
  }

  const parsed = body as Partial<EndlesssLoginResponse> | null
  if (
    !parsed ||
    typeof parsed.token !== 'string' ||
    typeof parsed.password !== 'string' ||
    typeof parsed.user_id !== 'string' ||
    typeof parsed.expires !== 'number'
  ) {
    return { ok: false, error: 'unexpected response from Endlesss — try again' }
  }

  const session: EndlesssSession = {
    token: parsed.token,
    password: parsed.password,
    userId: parsed.user_id,
    username,
    expires: parsed.expires
  }
  currentSession = session
  sessionLoadAttempted = true
  persistSession(session)
  return { ok: true, session }
}

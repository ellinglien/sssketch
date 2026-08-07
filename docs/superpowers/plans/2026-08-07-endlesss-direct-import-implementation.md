# Direct Endlesss Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone browse and import their own Endlesss riffs — their shared-riff feed and
their private jam(s) — directly from inside sssketch, with no LORE install required.

**Architecture:** A new main-process module (`src/main/endlesssApi.ts`) talks to Endlesss's real
backend (traced from OUROVEON's own source — see the design spec for the full grounding) over
plain `fetch()`, exposed through new `endlesss-*` IPC channels mirroring the existing `lore-*`
ones. A new renderer-side adapter layer (`riffSource.ts`) lets the existing riff-browsing UI
pattern be reused for both new tabs. Session credentials are never stored in plaintext —
Electron's `safeStorage` wraps them at rest.

**Tech Stack:** TypeScript, Electron (`safeStorage`, `ipcMain`/`ipcRenderer`), Node's built-in
`fetch`, Vitest.

**Design spec:** `docs/superpowers/specs/2026-08-07-endlesss-direct-import-design.md` — read it
first if anything below is unclear on *why*, not just *what*. Its "Addendum" section documents
the exact wire-JSON field names used throughout this plan, traced from OUROVEON's own C++
structs (`CEREAL_NVP` macros name the real JSON keys) rather than guessed.

---

### Task 1: Relocate shared riff-browsing types to `@shared/loreLibrary.ts`

Both the new Endlesss-direct code and the existing LORE code need `RiffFilters`, `RiffPage`,
and the root/scale name-resolution helpers. Today they're private to `src/main/loreWarehouse.ts`
(a Node-only module the renderer can't import from — see `LoreLibraryBrowser.tsx`'s own comment
on `RIFF_ID_JUMP_WINDOW_SIZE`). Moving them to `@shared/loreLibrary.ts` (already the shared,
backend-agnostic home for `LoreJam`/`LoreRiffSummary`/`LoreResolvedRiff`/`LoreResolvedStem`)
means one definition, importable from both `src/main/*` and `src/renderer/src/*`. Pure
relocation — no behavior change.

**Files:**
- Modify: `src/shared/loreLibrary.ts`
- Modify: `src/main/loreWarehouse.ts`

- [ ] **Step 1: Move `RiffFilters` and `RiffPage` into `@shared/loreLibrary.ts`**

Add to `src/shared/loreLibrary.ts` (after the existing `LoreRiffSummary` interface):

```typescript
export interface RiffFilters {
  dateFrom?: number
  dateTo?: number
  bpm?: number
  userName?: string
  onlyFullyCached?: boolean
  /** Whichever username the renderer's "your username" setting is currently
   * set to — drives both ownerFraction and onlyContainsUser. Not the same
   * field as `userName` above, which filters by the riff's own top-level
   * owner; this instead affects how a riff's per-STEM authorship is scored,
   * regardless of who owns it. */
  targetUser?: string
  /** Only riffs with at least one stem authored by targetUser (falls back to
   * LORE_USERNAME if targetUser is unset). */
  onlyContainsUser?: boolean
  /** How many riffs (most-recent-first) to skip before this page — 0/undefined
   * for the first page. */
  offset?: number
  /** How many riffs to fetch, defaulting to a per-backend default when unset. */
  limit?: number
}

export interface RiffPage {
  riffs: LoreRiffSummary[]
  /** True if there's likely at least one more riff beyond this page. */
  hasMore: boolean
  /** The `offset` to pass for the next page. */
  nextOffset: number
}
```

- [ ] **Step 2: Move `LORE_SCALE_NAMES` and `resolveKeyName` into `@shared/loreLibrary.ts`, export both**

Add to `src/shared/loreLibrary.ts` (after `LORE_ROOT_NAMES`, which already lives there):

```typescript
// Traced directly from OUROVEON's own source (endlesss/core.constants.h,
// cScaleNames), not guessed. 0-17 index covering the 7 diatonic modes plus
// pentatonic/blues/whole-tone/chromatic scales Endlesss also supports.
// "Major (Ionian)"/"Minor (Aeolian)" get their common pop name alongside the
// mode name; every other entry is OUROVEON's own exact string, used verbatim.
export const LORE_SCALE_NAMES = [
  'Major (Ionian)',
  'Dorian',
  'Phrygian',
  'Lydian',
  'Mixolydian',
  'Minor (Aeolian)',
  'Locrian',
  'Minor Pentatonic',
  'Major Pentatonic',
  'Suspended Pent.',
  'Blues Minor Pent.',
  'Blues Major Pent.',
  'Harmonic Minor',
  'Melodic Minor',
  'Double Harmonic',
  'Blues',
  'Whole Tone',
  'Chromatic'
] as const

/** Resolves a Root/Scale pair to a display string like "E Minor (Aeolian)" --
 * returns undefined for anything out of the known range (including null,
 * which means "no key metadata for this riff") rather than guessing or
 * showing a raw number. */
export function resolveKeyName(root: number | null, scale: number | null): string | undefined {
  if (root === null || scale === null) return undefined
  const rootName = LORE_ROOT_NAMES[root]
  const scaleName = LORE_SCALE_NAMES[scale]
  if (!rootName || !scaleName) return undefined
  return `${rootName} ${scaleName}`
}
```

- [ ] **Step 3: Update `loreWarehouse.ts` to import instead of define these**

In `src/main/loreWarehouse.ts`:
- Remove the local `export interface RiffFilters { ... }` and `export interface RiffPage { ... }` blocks (lines 88-126 in the current file).
- Remove the local `LORE_SCALE_NAMES` const and `resolveKeyName` function (lines 288-319 in the current file).
- Add to the existing `import type { LoreJam, LoreRiffSummary, LoreResolvedRiff, LoreResolvedStem } from '@shared/loreLibrary'` line, extending it:

```typescript
import type {
  LoreJam,
  LoreRiffSummary,
  LoreResolvedRiff,
  LoreResolvedStem,
  RiffFilters,
  RiffPage
} from '@shared/loreLibrary'
import { computeOwnerFraction, stemDownloadUrl, resolveKeyName } from '@shared/loreLibrary'
```

(The existing `import { computeOwnerFraction, stemDownloadUrl } from '@shared/loreLibrary'` line
gets `resolveKeyName` added to it — don't create a second import statement.)

- [ ] **Step 4: Verify nothing else referenced the now-removed local symbols**

Run: `grep -rn "LORE_SCALE_NAMES\|resolveKeyName" src/ --include="*.ts" --include="*.tsx"`
Expected: only hits inside `src/shared/loreLibrary.ts` (the new home) and `src/main/loreWarehouse.ts` (the import + call sites).

- [ ] **Step 5: Typecheck and test**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test -- loreWarehouse`
Expected: existing `loreWarehouse` tests (if any) still pass. If there is no dedicated test file, this is a no-op — confirm via `npm test` (full suite) instead.

- [ ] **Step 6: Commit**

```bash
git add src/shared/loreLibrary.ts src/main/loreWarehouse.ts
git commit -m "Relocate RiffFilters/RiffPage/resolveKeyName to shared layer for reuse by the new Endlesss-direct backend"
```

---

### Task 2: `endlesssApi.ts` — session type, login, User-Agent

**Files:**
- Create: `src/main/endlesssApi.ts`
- Test: `src/main/endlesssApi.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/endlesssApi.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: FAIL — `Cannot find module './endlesssApi'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/endlesssApi.ts
import { app, safeStorage } from 'electron'

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
      error: typeof message === 'string' && message.trim() !== ''
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
  return { ok: true, session }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: PASS (4 tests).

**Consistency note:** every metadata request added in Tasks 4-7 (`listSharedFeed`,
`fetchJamDisplayName`, `listJams`, `listRiffsInJam`, `fetchDocsByKeys`) already goes through
`fetchWithTimeout(fetchImpl, url, init)` in this plan's own code, not a bare `fetchImpl(...)`
call — this is how the timeout budget actually applies to every metadata request, not just
login. The one deliberate exception is Task 8's stem *audio* download
(`downloadOneEndlesssStem`), which stays a bare `fetchImpl(downloadUrl)` call, matching
`loreWarehouse.ts`'s own `downloadOneStem` precedent of not timing out large file transfers (see
that function's own doc comment in Task 8 for the reasoning). At the end of Task 8, run
`grep -n "fetchImpl(" src/main/endlesssApi.ts` to confirm: every match is either inside
`fetchWithTimeout`'s own definition, a `fetchWithTimeout(fetchImpl, ...)` call site, or the one
intentional exception in `downloadOneEndlesssStem`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`safeStorage` is imported but not yet used — this will be consumed in Task 3; if the linter flags an unused import, remove the `safeStorage` import from Step 3's code for now and re-add it in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add src/main/endlesssApi.ts src/main/endlesssApi.test.ts
git commit -m "Add endlesssApi.ts: login against Endlesss's real /auth/login endpoint"
```

---

### Task 3: `endlesssApi.ts` — session persistence, auth status, logout

**Files:**
- Modify: `src/main/endlesssApi.ts`
- Modify: `src/main/endlesssApi.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/main/endlesssApi.test.ts` (update the `vi.mock('electron', ...)` block first):

```typescript
vi.mock('electron', () => {
  const store = new Map<string, Buffer>()
  return {
    app: {
      getPath: () => '/tmp/sssketch-test-userdata-unused', // overridden per-test below
      getVersion: () => '0.0.0-test'
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(`enc:${s}`),
      decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
    },
    __mockFileStore: store
  }
})
```

This in-memory-Buffer mock doesn't actually touch disk, which means `endlesssApi.ts`'s file I/O
(`writeFileSync`/`readFileSync`) needs its own seam too, since mocking `electron` alone can't
intercept `node:fs` calls. Use a real temp directory instead — simpler than mocking `fs`, and
matches `pluginCatalog.test.ts`'s own real-temp-dir pattern:

```typescript
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

describe('endlesssApi session persistence', () => {
  let userDataDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-endlesss-test-'))
    ;(globalThis as unknown as { __testUserDataDir: string }).__testUserDataDir = userDataDir
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: FAIL — `getAuthStatus`/`logout` not exported yet.

- [ ] **Step 3: Implement session persistence**

Add to `src/main/endlesssApi.ts` (after the `EndlesssSession` interface, before `loginWithCredentials`):

```typescript
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
  | { loggedIn: false }
  | { loggedIn: true; userId: string; expiresAt: number } {
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
```

Then update `loginWithCredentials`'s success path (the `return { ok: true, session }` line) to
persist and cache the session first:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: PASS (all tests from Task 2 and Task 3).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/endlesssApi.ts src/main/endlesssApi.test.ts
git commit -m "Add safeStorage-backed session persistence, auth status, and logout to endlesssApi.ts"
```

---

### Task 4: `endlesssApi.ts` — shared-feed listing and resolution

This is the first of the two priority data paths. Per the design spec's addendum, the real
response shape is `{ data: [{ _id, doc_id, band?, action_timestamp, title, creators?, rifff:
<raw riff doc>, loops: (<raw stem doc> | null)[], image_url?, image, private? }] }` — each entry
already embeds full riff + stem detail, so listing and resolving a shared-feed riff don't need
two separate network round trips the way the private-jam path will (Task 6-8). This task builds
both `listSharedFeed` (for the grid) and `resolveSharedFeedRiff` (cache lookup + stem download,
no network round trip beyond the download itself) together since they share the raw-doc parsing
helpers.

**Files:**
- Modify: `src/main/endlesssApi.ts`
- Modify: `src/main/endlesssApi.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/main/endlesssApi.test.ts`:

```typescript
function rawStemDoc(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    _id: 'stem_1',
    cdn_attachments: {
      oggAudio: {
        endpoint: 'ndls-att0.fra1.digitaloceanspaces.com',
        key: 'attachments/oggAudio/1/abc',
        url: 'https://ndls-att0.fra1.digitaloceanspaces.com/attachments/oggAudio/1/abc',
        mime: 'audio/ogg',
        length: 12345
      }
    },
    bps: 2.0,
    length16ths: 64,
    originalPitch: 0,
    barLength: 4,
    presetName: '808 Kick',
    creatorUserName: 'elling',
    primaryColour: 'ff0000',
    sampleRate: 44100,
    created: 1700000000000,
    isDrum: true,
    isNote: false,
    isBass: false,
    isMic: false,
    ...overrides
  }
}

function rawRiffDoc(stemId: string, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    _id: 'riff_1',
    state: {
      bps: 2.0,
      barLength: 4,
      playback: [
        { slot: { current: { on: true, currentLoop: stemId, gain: 0.8 } } },
        ...Array.from({ length: 7 }, () => ({ slot: {} }))
      ]
    },
    userName: 'elling',
    created: 1700000000000,
    root: 0,
    scale: 5,
    ...overrides
  }
}

describe('endlesssApi shared feed', () => {
  it('listSharedFeed parses a real-shaped response into riff summaries', async () => {
    const { listSharedFeed } = await import('./endlesssApi')
    const fakeFetch = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.endlesss.fm/api/v3/feed/shared_by/elling?size=20&from=0')
      return new Response(
        JSON.stringify({
          data: [
            {
              _id: 'shared_1',
              doc_id: 'riff_1',
              action_timestamp: 1700000000000,
              title: 'a cool riff',
              rifff: rawRiffDoc('stem_1'),
              loops: [rawStemDoc(), null, null, null, null, null, null, null],
              image: false,
              private: false
            }
          ]
        }),
        { status: 200 }
      )
    })
    const page = await listSharedFeed('elling', 0, 20, fakeFetch as typeof fetch)
    expect(page.riffs).toHaveLength(1)
    expect(page.riffs[0]).toMatchObject({
      riffCID: 'riff_1',
      userName: 'elling',
      stemCount: 1,
      cachedStemCount: 0
    })
  })

  it('listSharedFeed tolerates null entries in a riff\'s own loops array', async () => {
    const { listSharedFeed } = await import('./endlesssApi')
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                _id: 'shared_1',
                doc_id: 'riff_1',
                action_timestamp: 1700000000000,
                title: 'x',
                rifff: rawRiffDoc('stem_1'),
                loops: [null, null, rawStemDoc(), null, null, null, null, null],
                image: false
              }
            ]
          }),
          { status: 200 }
        )
    )
    const page = await listSharedFeed('elling', 0, 20, fakeFetch as typeof fetch)
    expect(page.riffs[0].stemCount).toBe(1)
  })

  it('resolveSharedFeedRiff returns full stem detail with downloadUrl set from cdn_attachments', async () => {
    const { listSharedFeed, resolveSharedFeedRiff } = await import('./endlesssApi')
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                _id: 'shared_1',
                doc_id: 'riff_1',
                action_timestamp: 1700000000000,
                title: 'x',
                rifff: rawRiffDoc('stem_1'),
                loops: [rawStemDoc(), null, null, null, null, null, null, null],
                image: false
              }
            ]
          }),
          { status: 200 }
        )
    )
    await listSharedFeed('elling', 0, 20, fakeFetch as typeof fetch)
    const resolved = await resolveSharedFeedRiff('riff_1', fakeFetch as typeof fetch)
    expect(resolved).not.toBeNull()
    expect(resolved!.stems).toHaveLength(1)
    expect(resolved!.stems[0]).toMatchObject({
      stemCID: 'stem_1',
      slot: 1,
      gain: 0.8,
      creatorUserName: 'elling',
      presetName: '808 Kick',
      downloadUrl: 'https://ndls-att0.fra1.digitaloceanspaces.com/attachments/oggAudio/1/abc'
    })
  })

  it('resolveSharedFeedRiff returns null for a riff never returned by a prior listSharedFeed call', async () => {
    const { resolveSharedFeedRiff } = await import('./endlesssApi')
    const resolved = await resolveSharedFeedRiff('never_listed', vi.fn() as unknown as typeof fetch)
    expect(resolved).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: FAIL — `listSharedFeed`/`resolveSharedFeedRiff` not exported yet.

- [ ] **Step 3: Implement**

Add to `src/main/endlesssApi.ts`:

```typescript
import type {
  LoreResolvedRiff,
  LoreResolvedStem,
  LoreRiffSummary,
  RiffPage
} from '@shared/loreLibrary'
import { resolveKeyName } from '@shared/loreLibrary'

// ---- raw wire shapes, field names traced from OUROVEON's own CEREAL_NVP
// declarations (see the design spec's Addendum) -- not guessed. ----

interface RawStemDoc {
  _id: string
  cdn_attachments: {
    oggAudio?: { bucket?: string; endpoint: string; key?: string; url: string; length: number }
    flacAudio?: { endpoint: string; key: string; length: number; url: string }
  }
  bps: number
  length16ths: number
  presetName: string
  creatorUserName: string
  isDrum?: boolean
  isNote?: boolean
  isBass?: boolean
  isMic?: boolean
}

interface RawRiffSlot {
  slot: { current?: { on: boolean; currentLoop?: string; gain: number } }
}

interface RawRiffDoc {
  _id: string
  state: { bps: number; barLength: number; playback: RawRiffSlot[] }
  userName: string
  created: number
  root: number
  scale: number
}

interface RawSharedRiffEntry {
  _id: string
  doc_id: string
  action_timestamp: number
  rifff: RawRiffDoc
  loops: (RawStemDoc | null)[]
  private?: boolean
}

interface RawSharedFeedResponse {
  data: RawSharedRiffEntry[]
}

// Matches OUROVEON's own BPStoRoundedBPM: ceil (not round) to 2 decimal
// places -- kept identical so tempo values displayed here match what the
// official ecosystem would show for the same riff.
function bpsToRoundedBpm(bps: number): number {
  return Math.ceil(bps * 60 * 100) / 100
}

function stemFlagsToMask(stem: RawStemDoc): number {
  let mask = 0
  if (stem.isDrum) mask |= 1 << 1
  if (stem.isNote) mask |= 1 << 2
  if (stem.isBass) mask |= 1 << 3
  if (stem.isMic) mask |= 1 << 4
  return mask
}

// Deliberately OGG-only for v1: sssketch's existing decode pipeline (shared
// with the LORE path, whose synced stems are always ogg-content files) has
// no FLAC support today, and OUROVEON itself documents flacAudio as "very
// rare" for a stem to lack ogg entirely. A stem with only flacAudio (no
// oggAudio) is treated as undownloadable (downloadUrl: null) rather than
// attempting a decode path that doesn't exist yet elsewhere in this app.
function buildResolvedStem(stem: RawStemDoc, slot: number, gain: number): LoreResolvedStem {
  const bpm = bpsToRoundedBpm(stem.bps)
  const barLength = stem.length16ths / 16
  return {
    stemCID: stem._id,
    slot,
    path: null,
    gain,
    creatorUserName: stem.creatorUserName,
    presetName: stem.presetName,
    instrumentMask: stemFlagsToMask(stem),
    durationSec: barLength * (60 / bpm) * 4,
    barLength,
    downloadUrl: stem.cdn_attachments.oggAudio?.url ?? null
  }
}

function buildResolvedRiff(riffCID: string, riffDoc: RawRiffDoc, stemDocs: (RawStemDoc | null)[]): LoreResolvedRiff {
  const stems: LoreResolvedStem[] = []
  riffDoc.state.playback.forEach((slotWrapper, index) => {
    const current = slotWrapper.slot?.current
    if (!current || !current.on || !current.currentLoop) return
    const stemDoc = stemDocs.find((s) => s?._id === current.currentLoop)
    if (!stemDoc) return
    stems.push(buildResolvedStem(stemDoc, index + 1, current.gain))
  })
  return {
    riffCID,
    bpm: bpsToRoundedBpm(riffDoc.state.bps),
    barLength: riffDoc.state.barLength,
    key: resolveKeyName(riffDoc.root, riffDoc.scale),
    stems
  }
}

function summarizeResolvedRiff(riffCID: string, userName: string, creationTime: number, resolved: LoreResolvedRiff): LoreRiffSummary {
  return {
    riffCID,
    creationTime,
    bpm: resolved.bpm,
    barLength: resolved.barLength,
    userName,
    stemCount: resolved.stems.length,
    cachedStemCount: 0, // nothing downloaded yet -- listing never touches disk
    ownerFraction: 0 // deliberately flat for v1 -- see the implementation plan's Task 4 note
  }
}

// Populated by listSharedFeed, read by resolveSharedFeedRiff -- avoids a
// second network round trip for shared-feed riffs specifically, since the
// listing response already embeds full riff+stem detail (unlike the
// private-jam path, which genuinely needs list-then-resolve). Cleared and
// repopulated on every listSharedFeed call; a resolve for a riff outside the
// most recently listed page returns null rather than guessing stale data.
let sharedFeedCache = new Map<string, LoreResolvedRiff>()

export async function listSharedFeed(
  userName: string,
  offset: number,
  count: number,
  fetchImpl: FetchLike = fetch
): Promise<RiffPage> {
  const session = activeSession()
  const headers: Record<string, string> = { 'User-Agent': userAgent() }
  if (session) headers.Authorization = bearerAuthHeader(session)

  let res: Response
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      `${API_HOST}/api/v3/feed/shared_by/${encodeURIComponent(userName)}?size=${count}&from=${offset}`,
      { headers }
    )
  } catch (err) {
    console.error('endlesssApi: listSharedFeed network failure:', err)
    return { riffs: [], hasMore: false, nextOffset: offset }
  }
  if (!res.ok) {
    console.error(`endlesssApi: listSharedFeed HTTP ${res.status}`)
    return { riffs: [], hasMore: false, nextOffset: offset }
  }

  let body: RawSharedFeedResponse
  try {
    body = (await res.json()) as RawSharedFeedResponse
  } catch (err) {
    console.error('endlesssApi: listSharedFeed malformed JSON:', err)
    return { riffs: [], hasMore: false, nextOffset: offset }
  }

  const newCache = new Map<string, LoreResolvedRiff>()
  const summaries: LoreRiffSummary[] = []
  for (const entry of body.data ?? []) {
    // entry.loops can contain literal nulls for unused slots -- a documented
    // Endlesss backend quirk (see the design spec's grounding section), not
    // something to treat as malformed data.
    const stemDocs = (entry.loops ?? []).filter((s): s is RawStemDoc => s !== null)
    const resolved = buildResolvedRiff(entry.doc_id, entry.rifff, stemDocs)
    newCache.set(entry.doc_id, resolved)
    summaries.push(
      summarizeResolvedRiff(entry.doc_id, entry.rifff.userName, Math.floor(entry.action_timestamp / 1000), resolved)
    )
  }
  sharedFeedCache = newCache

  return {
    riffs: summaries,
    hasMore: summaries.length === count,
    nextOffset: offset + summaries.length
  }
}

/** Resolves a riff previously returned by listSharedFeed, downloading
 * whatever stems aren't already cached locally. Returns null if this
 * riffCID wasn't in the most recently listed page (the UI always lists
 * before resolving, so this is a "stale selection" guard, not a real gap). */
export async function resolveSharedFeedRiff(
  riffCID: string,
  fetchImpl: FetchLike = fetch
): Promise<LoreResolvedRiff | null> {
  const cached = sharedFeedCache.get(riffCID)
  if (!cached) return null
  return downloadMissingStemsFor('shared', riffCID, cached, fetchImpl)
}
```

Note: `bearerAuthHeader` and `downloadMissingStemsFor` are referenced here but implemented in
Task 5 and Task 8 respectively — this task's tests don't exercise the authenticated or
stem-download branches yet (Task 4's tests use no session and stems already resolve without a
download since `path: null` is fine for these assertions), so it's safe to write the calls now
and implement the functions in the next tasks. If your editor/linter flags them as undefined,
that's expected until Task 5/8 land — the tests above only import functions that already exist
after this task's own additions (`listSharedFeed`, `resolveSharedFeedRiff`), so `npx vitest run`
will still pass; only a full `npm run typecheck` would fail until Task 8. **Do not skip ahead —
add a temporary stub for `downloadMissingStemsFor` in this task so typecheck passes:**

```typescript
// Temporary stub -- replaced with a real implementation in Task 8.
async function downloadMissingStemsFor(
  _source: 'shared' | string,
  _riffCID: string,
  resolved: LoreResolvedRiff,
  _fetchImpl: FetchLike
): Promise<LoreResolvedRiff> {
  return resolved
}
```

And `bearerAuthHeader` needs a real (small) implementation now, not a stub, since Task 4's own
shared-feed auth behavior depends on it:

```typescript
/** Both Basic (data.endlesss.fm) and Bearer (api.endlesss.fm) auth are built
 * from the same token:password pair, base64-encoded -- per OUROVEON's own
 * comment ("Bearer ... formed out of token:password"), the Bearer variant
 * uses the identical encoding Basic auth would, just under a different
 * header scheme. */
function credentialsBase64(session: EndlesssSession): string {
  return Buffer.from(`${session.token}:${session.password}`).toString('base64')
}

function basicAuthHeader(session: EndlesssSession): string {
  return `Basic ${credentialsBase64(session)}`
}

function bearerAuthHeader(session: EndlesssSession): string {
  return `Bearer ${credentialsBase64(session)}`
}
```

(`basicAuthHeader` isn't used until Task 6 — that's fine, an unused-function lint warning is
expected until then; if the linter treats it as an error rather than a warning, add a one-line
`// eslint-disable-next-line @typescript-eslint/no-unused-vars` above it for now and remove that
comment in Task 6 once it's actually called.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: PASS (all tests from Tasks 2-4).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the temporary `downloadMissingStemsFor` stub satisfies the type checker;
its real implementation lands in Task 8).

- [ ] **Step 6: Commit**

```bash
git add src/main/endlesssApi.ts src/main/endlesssApi.test.ts
git commit -m "Add endlesssApi.ts shared-feed listing and resolution, parsing OUROVEON-grounded raw riff/stem doc shapes"
```

---

### Task 5: `endlesssApi.ts` — jam listing (membership + display names)

**Files:**
- Modify: `src/main/endlesssApi.ts`
- Modify: `src/main/endlesssApi.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/main/endlesssApi.test.ts`:

```typescript
describe('endlesssApi jam listing', () => {
  async function loggedInFetch(loginResponse: Record<string, unknown> = {}): Promise<typeof fetch> {
    const { loginWithCredentials } = await import('./endlesssApi')
    const fakeLoginFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: 't',
            password: 'p',
            user_id: 'u1',
            expires: Date.now() + 1000 * 60 * 60 * 24,
            ...loginResponse
          }),
          { status: 200 }
        )
    )
    await loginWithCredentials('elling', 'hunter2', fakeLoginFetch as typeof fetch)
    return fakeLoginFetch as typeof fetch
  }

  it('listJams returns an empty list when not logged in', async () => {
    const { listJams, logout } = await import('./endlesssApi')
    logout()
    const jams = await listJams(vi.fn() as unknown as typeof fetch)
    expect(jams).toEqual([])
  })

  it('listJams fetches membership then a display name per jam', async () => {
    await loggedInFetch()
    const { listJams } = await import('./endlesssApi')
    const calls: string[] = []
    const fakeFetch = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('_design/membership')) {
        return new Response(
          JSON.stringify({
            total_rows: 1,
            rows: [{ id: 'jam_abc', key: '2020-09-23T13:04:02.375Z' }]
          }),
          { status: 200 }
        )
      }
      if (url.endsWith('/Profile')) {
        return new Response(JSON.stringify({ displayName: 'My Cool Jam' }), { status: 200 })
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    const jams = await listJams(fakeFetch as typeof fetch)
    expect(jams).toEqual([{ jamCID: 'jam_abc', name: 'My Cool Jam', lastRiffTime: 0 }])
    expect(calls[0]).toBe(
      'https://data.endlesss.fm/user_appdata$elling/_design/membership/_view/getMembership'
    )
    expect(calls[1]).toBe('https://data.endlesss.fm/user_appdata$jam_abc/Profile')
  })

  it('listJams falls back to the raw jam ID as the name if the profile fetch fails', async () => {
    await loggedInFetch()
    const { listJams } = await import('./endlesssApi')
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('_design/membership')) {
        return new Response(
          JSON.stringify({ total_rows: 1, rows: [{ id: 'jam_abc', key: 'x' }] }),
          { status: 200 }
        )
      }
      return new Response('not found', { status: 404 })
    })
    const jams = await listJams(fakeFetch as typeof fetch)
    expect(jams).toEqual([{ jamCID: 'jam_abc', name: 'jam_abc', lastRiffTime: 0 }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: FAIL — `listJams` not exported yet.

- [ ] **Step 3: Implement**

Add to `src/main/endlesssApi.ts`:

```typescript
import type { LoreJam } from '@shared/loreLibrary'

interface RawMembershipRow {
  id: string
  key: string
}

interface RawMembershipResponse {
  total_rows: number
  rows: RawMembershipRow[]
}

// CouchDB path-segment escaping for usernames/jam IDs containing hyphens --
// traced from OUROVEON's own escaping (hyphens become "(2d)").
function escapeCouchIdSegment(id: string): string {
  return id.replace(/-/g, '(2d)')
}

async function fetchJamDisplayName(
  jamId: string,
  session: EndlesssSession,
  fetchImpl: FetchLike
): Promise<string> {
  try {
    const res = await fetchWithTimeout(
      fetchImpl,
      `${DATA_HOST}/user_appdata$${escapeCouchIdSegment(jamId)}/Profile`,
      { headers: { Authorization: basicAuthHeader(session), 'User-Agent': userAgent() } }
    )
    if (!res.ok) return jamId
    const body = (await res.json()) as { displayName?: unknown }
    return typeof body.displayName === 'string' && body.displayName.trim() !== ''
      ? body.displayName
      : jamId
  } catch (err) {
    console.error(`endlesssApi: failed to fetch display name for jam ${jamId}:`, err)
    return jamId
  }
}

/** Lists the account's subscribed jams -- private and public alike, since
 * this endpoint only ever returns jams the authenticated account actually
 * has access to (see the design spec's grounding section). Requires a
 * session; returns [] if not logged in rather than throwing, matching this
 * module's "never throws" convention elsewhere. `lastRiffTime` is left at 0
 * (unlike LORE's own listJams, which derives it from synced riff data this
 * module doesn't have) -- the UI can sort jams alphabetically or by join
 * order instead. */
export async function listJams(fetchImpl: FetchLike = fetch): Promise<LoreJam[]> {
  const session = activeSession()
  if (!session) return []

  let res: Response
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      `${DATA_HOST}/user_appdata$${escapeCouchIdSegment(session.username)}/_design/membership/_view/getMembership`,
      { headers: { Authorization: basicAuthHeader(session), 'User-Agent': userAgent() } }
    )
  } catch (err) {
    console.error('endlesssApi: listJams network failure:', err)
    return []
  }
  if (!res.ok) {
    console.error(`endlesssApi: listJams HTTP ${res.status}`)
    return []
  }

  let body: RawMembershipResponse
  try {
    body = (await res.json()) as RawMembershipResponse
  } catch (err) {
    console.error('endlesssApi: listJams malformed JSON:', err)
    return []
  }

  return Promise.all(
    (body.rows ?? []).map(async (row) => ({
      jamCID: row.id,
      name: await fetchJamDisplayName(row.id, session, fetchImpl),
      lastRiffTime: 0
    }))
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors — `basicAuthHeader` is now actually used, so remove the
`eslint-disable-next-line` comment added in Task 4 if you added one.

- [ ] **Step 6: Commit**

```bash
git add src/main/endlesssApi.ts src/main/endlesssApi.test.ts
git commit -m "Add endlesssApi.ts jam listing (membership + per-jam display name resolution)"
```

---

### Task 6: `endlesssApi.ts` — riff listing within a jam

**Files:**
- Modify: `src/main/endlesssApi.ts`
- Modify: `src/main/endlesssApi.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/main/endlesssApi.test.ts`:

```typescript
describe('endlesssApi riff listing in a jam', () => {
  it('listRiffsInJam returns [] when not logged in', async () => {
    const { listRiffsInJam, logout } = await import('./endlesssApi')
    logout()
    const page = await listRiffsInJam('jam_abc', {}, vi.fn() as unknown as typeof fetch)
    expect(page).toEqual({ riffs: [], hasMore: false, nextOffset: 0 })
  })

  it('listRiffsInJam parses the rifffLoopsByCreateTime view response', async () => {
    const { loginWithCredentials, listRiffsInJam } = await import('./endlesssApi')
    await loginWithCredentials(
      'elling',
      'hunter2',
      vi.fn(
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
      ) as unknown as typeof fetch
    )
    const fakeFetch = vi.fn(async (url: string) => {
      expect(url).toBe(
        'https://data.endlesss.fm/user_appdata$jam_abc/_design/types/_view/rifffLoopsByCreateTime?descending=true&limit=50&skip=0'
      )
      return new Response(
        JSON.stringify({
          total_rows: 1,
          rows: [{ id: 'riff_1', key: 1700000000000000000, value: ['stem_1', 'stem_2'] }]
        }),
        { status: 200 }
      )
    })
    const page = await listRiffsInJam('jam_abc', { limit: 50 }, fakeFetch as typeof fetch)
    expect(page.riffs).toEqual([
      {
        riffCID: 'riff_1',
        creationTime: 1700000000,
        bpm: 0,
        barLength: 0,
        userName: '',
        stemCount: 2,
        cachedStemCount: 0,
        ownerFraction: 0
      }
    ])
    expect(page.hasMore).toBe(false)
    expect(page.nextOffset).toBe(1)
  })
})
```

Note: the view row (`{id, key, value}`) doesn't include bpm/barLength/userName — only the
listing view's own IDs and stem count. `bpm`/`barLength`/`userName` are left at their zero
values here deliberately; they only become accurate once a specific riff is resolved (Task 7).
This mirrors the real tradeoff documented in the design spec: the list view is intentionally
lightweight (no per-riff detail fetch just to render a grid of riffs).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: FAIL — `listRiffsInJam` not exported yet.

- [ ] **Step 3: Implement**

Add to `src/main/endlesssApi.ts`:

```typescript
import type { RiffFilters } from '@shared/loreLibrary'

interface RawRiffListRow {
  id: string
  key: number
  value: string[]
}

interface RawRiffListResponse {
  total_rows: number
  rows: RawRiffListRow[]
}

const DEFAULT_RIFF_PAGE_SIZE = 200

/** Lists riffs in one jam via the same rifffLoopsByCreateTime CouchDB view
 * OUROVEON itself uses -- lightweight (id/creation-time/stem-IDs only, no
 * per-riff metadata), matching the two-step "list then resolve" shape this
 * whole path already uses. `key` is documented (ResultRiffAndStemIDs, see
 * the design spec's Addendum) as unix NANOSECONDS -- divided by 1e9 here to
 * match LoreRiffSummary's unix-SECONDS convention. Client-side filters
 * (date/bpm/userName) from RiffFilters are NOT applied here -- the raw view
 * doesn't expose that metadata without a per-riff resolve, unlike LORE's own
 * SQL-backed listRiffs. This is a deliberate v1 scope trim (see the
 * implementation plan) -- filtering can be layered on by resolving visible
 * riffs client-side in a later pass if it turns out to matter in practice. */
export async function listRiffsInJam(
  jamId: string,
  filters: RiffFilters,
  fetchImpl: FetchLike = fetch
): Promise<RiffPage> {
  const session = activeSession()
  const offset = filters.offset ?? 0
  if (!session) return { riffs: [], hasMore: false, nextOffset: offset }

  const limit = filters.limit ?? DEFAULT_RIFF_PAGE_SIZE
  let res: Response
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      `${DATA_HOST}/user_appdata$${escapeCouchIdSegment(jamId)}/_design/types/_view/rifffLoopsByCreateTime?descending=true&limit=${limit}&skip=${offset}`,
      { headers: { Authorization: basicAuthHeader(session), 'User-Agent': userAgent() } }
    )
  } catch (err) {
    console.error('endlesssApi: listRiffsInJam network failure:', err)
    return { riffs: [], hasMore: false, nextOffset: offset }
  }
  if (!res.ok) {
    console.error(`endlesssApi: listRiffsInJam HTTP ${res.status}`)
    return { riffs: [], hasMore: false, nextOffset: offset }
  }

  let body: RawRiffListResponse
  try {
    body = (await res.json()) as RawRiffListResponse
  } catch (err) {
    console.error('endlesssApi: listRiffsInJam malformed JSON:', err)
    return { riffs: [], hasMore: false, nextOffset: offset }
  }

  const rows = body.rows ?? []
  const riffs: LoreRiffSummary[] = rows.map((row) => ({
    riffCID: row.id,
    creationTime: Math.floor(row.key / 1e9),
    bpm: 0,
    barLength: 0,
    userName: '',
    stemCount: row.value.length,
    cachedStemCount: 0,
    ownerFraction: 0
  }))

  return { riffs, hasMore: rows.length === limit, nextOffset: offset + rows.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/endlesssApi.ts src/main/endlesssApi.test.ts
git commit -m "Add endlesssApi.ts riff listing within a jam via rifffLoopsByCreateTime"
```

---

### Task 7: `endlesssApi.ts` — resolving one riff within a jam

**Files:**
- Modify: `src/main/endlesssApi.ts`
- Modify: `src/main/endlesssApi.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/main/endlesssApi.test.ts`:

```typescript
describe('endlesssApi jam riff resolution', () => {
  async function loggedIn(): Promise<void> {
    const { loginWithCredentials } = await import('./endlesssApi')
    await loginWithCredentials(
      'elling',
      'hunter2',
      vi.fn(
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
      ) as unknown as typeof fetch
    )
  }

  it('resolveJamRiff returns null when not logged in', async () => {
    const { resolveJamRiff, logout } = await import('./endlesssApi')
    logout()
    const resolved = await resolveJamRiff('jam_abc', 'riff_1', vi.fn() as unknown as typeof fetch)
    expect(resolved).toBeNull()
  })

  it('resolveJamRiff batch-fetches the riff doc then its stem docs', async () => {
    await loggedIn()
    const { resolveJamRiff } = await import('./endlesssApi')
    const calls: { url: string; body?: string }[] = []
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined })
      if (url.includes('_all_docs') && JSON.parse(init!.body as string).keys[0] === 'riff_1') {
        return new Response(
          JSON.stringify({
            total_rows: 1,
            rows: [{ id: 'riff_1', doc: rawRiffDoc('stem_1') }]
          }),
          { status: 200 }
        )
      }
      if (url.includes('_all_docs')) {
        return new Response(
          JSON.stringify({ total_rows: 1, rows: [{ id: 'stem_1', doc: rawStemDoc() }] }),
          { status: 200 }
        )
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    const resolved = await resolveJamRiff('jam_abc', 'riff_1', fakeFetch as typeof fetch)
    expect(resolved).not.toBeNull()
    expect(resolved!.stems).toHaveLength(1)
    expect(resolved!.stems[0].stemCID).toBe('stem_1')
    expect(calls[0].url).toBe(
      'https://data.endlesss.fm/user_appdata$jam_abc/_all_docs?include_docs=true'
    )
    expect(JSON.parse(calls[0].body!)).toEqual({ keys: ['riff_1'] })
    expect(JSON.parse(calls[1].body!)).toEqual({ keys: ['stem_1'] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: FAIL — `resolveJamRiff` not exported yet.

- [ ] **Step 3: Implement**

Add to `src/main/endlesssApi.ts`:

```typescript
interface RawDocsRow<T> {
  id: string
  doc: T
}

interface RawDocsResponse<T> {
  total_rows: number
  rows: RawDocsRow<T>[]
}

async function fetchDocsByKeys<T>(
  jamId: string,
  keys: string[],
  session: EndlesssSession,
  fetchImpl: FetchLike
): Promise<Map<string, T>> {
  const result = new Map<string, T>()
  if (keys.length === 0) return result
  let res: Response
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      `${DATA_HOST}/user_appdata$${escapeCouchIdSegment(jamId)}/_all_docs?include_docs=true`,
      {
        method: 'POST',
        headers: {
          Authorization: basicAuthHeader(session),
          'Content-Type': 'application/json',
          'User-Agent': userAgent()
        },
        body: JSON.stringify({ keys })
      }
    )
  } catch (err) {
    console.error('endlesssApi: fetchDocsByKeys network failure:', err)
    return result
  }
  if (!res.ok) {
    console.error(`endlesssApi: fetchDocsByKeys HTTP ${res.status}`)
    return result
  }
  let body: RawDocsResponse<T>
  try {
    body = (await res.json()) as RawDocsResponse<T>
  } catch (err) {
    console.error('endlesssApi: fetchDocsByKeys malformed JSON:', err)
    return result
  }
  for (const row of body.rows ?? []) {
    if (row.doc) result.set(row.id, row.doc)
  }
  return result
}

/** Resolves one riff within a private jam: fetches the riff doc, extracts
 * its referenced stem IDs from state.playback, batch-fetches those stem
 * docs, then downloads whatever stems aren't already cached locally --
 * mirroring downloadMissingStems' existing LORE-path contract exactly. */
export async function resolveJamRiff(
  jamId: string,
  riffCID: string,
  fetchImpl: FetchLike = fetch
): Promise<LoreResolvedRiff | null> {
  const session = activeSession()
  if (!session) return null

  const riffDocs = await fetchDocsByKeys<RawRiffDoc>(jamId, [riffCID], session, fetchImpl)
  const riffDoc = riffDocs.get(riffCID)
  if (!riffDoc) return null

  const stemIds = riffDoc.state.playback
    .map((slot) => slot.slot?.current)
    .filter((current): current is { on: boolean; currentLoop?: string; gain: number } => !!current?.on)
    .map((current) => current.currentLoop)
    .filter((id): id is string => typeof id === 'string')

  const stemDocs = await fetchDocsByKeys<RawStemDoc>(jamId, stemIds, session, fetchImpl)
  const resolved = buildResolvedRiff(riffCID, riffDoc, [...stemDocs.values()])
  return downloadMissingStemsFor('jam', riffCID, resolved, fetchImpl)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (still using the Task 4 stub for `downloadMissingStemsFor`, replaced next).

- [ ] **Step 6: Commit**

```bash
git add src/main/endlesssApi.ts src/main/endlesssApi.test.ts
git commit -m "Add endlesssApi.ts jam riff resolution: batch riff+stem doc fetch"
```

---

### Task 8: `endlesssApi.ts` — real stem downloading, replacing the Task 4 stub

**Files:**
- Modify: `src/main/endlesssApi.ts`
- Modify: `src/main/endlesssApi.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/endlesssApi.test.ts`:

```typescript
import { mkdtempSync as mkdtempSyncForDownload } from 'node:fs' // (already imported above; reuse the existing import instead of re-importing if your editor flags a duplicate)

describe('endlesssApi stem downloading', () => {
  it('resolveJamRiff downloads a stem to the endlesss-cache dir and sets its path', async () => {
    const { loginWithCredentials, resolveJamRiff } = await import('./endlesssApi')
    await loginWithCredentials(
      'elling',
      'hunter2',
      vi.fn(
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
      ) as unknown as typeof fetch
    )
    const audioBytes = new TextEncoder().encode('fake ogg bytes')
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('_all_docs') && JSON.parse(init!.body as string).keys[0] === 'riff_1') {
        return new Response(
          JSON.stringify({ total_rows: 1, rows: [{ id: 'riff_1', doc: rawRiffDoc('stem_1') }] }),
          { status: 200 }
        )
      }
      if (url.includes('_all_docs')) {
        return new Response(
          JSON.stringify({ total_rows: 1, rows: [{ id: 'stem_1', doc: rawStemDoc() }] }),
          { status: 200 }
        )
      }
      if (url === 'https://ndls-att0.fra1.digitaloceanspaces.com/attachments/oggAudio/1/abc') {
        return new Response(audioBytes, { status: 200 })
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    const resolved = await resolveJamRiff('jam_abc', 'riff_1', fakeFetch as typeof fetch)
    expect(resolved!.stems[0].path).not.toBeNull()
    const { readFileSync: readFileSyncCheck } = await import('node:fs')
    expect(readFileSyncCheck(resolved!.stems[0].path!).toString()).toBe('fake ogg bytes')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: FAIL — the Task 4 stub returns stems with `path: null` unconditionally.

- [ ] **Step 3: Replace the stub with a real implementation**

In `src/main/endlesssApi.ts`, delete the temporary stub added in Task 4:

```typescript
// DELETE this block:
async function downloadMissingStemsFor(
  _source: 'shared' | string,
  _riffCID: string,
  resolved: LoreResolvedRiff,
  _fetchImpl: FetchLike
): Promise<LoreResolvedRiff> {
  return resolved
}
```

Replace it with:

```typescript
function endlesssStemCachePath(source: 'shared' | 'jam', riffCID: string, stemCID: string): string {
  return join(app.getPath('userData'), 'endlesss-cache', 'stems', source, riffCID, stemCID)
}

/** Downloads one stem's audio to its cache path, writing via a
 * `.downloading` sibling then renaming into place so a killed/failed
 * download never leaves a corrupt partial file -- same pattern as
 * loreWarehouse.ts's own downloadOneStem. Returns false (never throws) on
 * any failure. Deliberately does NOT go through fetchWithTimeout, unlike
 * every metadata call in this module -- audio files are legitimately larger
 * and slower than a JSON response, and loreWarehouse.ts's own
 * downloadOneStem sets no timeout on its equivalent fetch either; applying
 * the same fixed 8s budget here would make large/slow-connection stems fail
 * spuriously for no real safety benefit. */
async function downloadOneEndlesssStem(
  path: string,
  downloadUrl: string,
  fetchImpl: FetchLike
): Promise<boolean> {
  try {
    const res = await fetchImpl(downloadUrl)
    if (!res.ok) {
      console.error(`endlesssApi: stem download failed: HTTP ${res.status}`)
      return false
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    mkdirSync(dirname(path), { recursive: true })
    const tmpPath = `${path}.downloading`
    writeFileSync(tmpPath, bytes)
    renameSync(tmpPath, path)
    return true
  } catch (err) {
    console.error('endlesssApi: stem download failed:', err)
    return false
  }
}

/** Downloads every not-yet-cached stem in `resolved` (path === null but a
 * downloadUrl exists), returning a new LoreResolvedRiff with paths filled
 * in for whichever succeeded. Shared by both the shared-feed and
 * private-jam resolve paths -- `source` just partitions the cache
 * directory so a riffCID collision between the two spaces (unlikely, but
 * not impossible) can't overwrite the wrong file. */
async function downloadMissingStemsFor(
  source: 'shared' | 'jam',
  riffCID: string,
  resolved: LoreResolvedRiff,
  fetchImpl: FetchLike
): Promise<LoreResolvedRiff> {
  const stems = await Promise.all(
    resolved.stems.map(async (stem) => {
      if (stem.path !== null || !stem.downloadUrl) return stem
      const path = endlesssStemCachePath(source, riffCID, stem.stemCID)
      if (existsSync(path)) return { ...stem, path }
      const ok = await downloadOneEndlesssStem(path, stem.downloadUrl, fetchImpl)
      return ok ? { ...stem, path } : stem
    })
  )
  return { ...resolved, stems }
}
```

Add `dirname` to the existing `node:path` import (`import { dirname, join } from 'node:path'`)
and `renameSync` to the existing `node:fs` import.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: PASS — every test added across Tasks 2-8.

- [ ] **Step 5: Typecheck, lint, full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: no errors, no lint warnings, full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/main/endlesssApi.ts src/main/endlesssApi.test.ts
git commit -m "Add real stem downloading to endlesssApi.ts, completing the main-process Endlesss client"
```

---

### Task 9: IPC handlers + preload bridge

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the import in `src/main/index.ts`**

Add alongside the existing `loreWarehouse` import block:

```typescript
import {
  loginWithCredentials,
  logout as endlesssLogout,
  getAuthStatus as getEndlesssAuthStatus,
  listSharedFeed,
  resolveSharedFeedRiff,
  listJams as listEndlesssJams,
  listRiffsInJam,
  resolveJamRiff
} from './endlesssApi'
```

- [ ] **Step 2: Register the IPC handlers**

Add alongside the existing `lore-*` handlers block (near `ipcMain.handle('lore-warehouse-available', ...)`):

```typescript
  ipcMain.handle('endlesss-login', (_event, username: string, password: string) =>
    loginWithCredentials(username, password)
  )
  ipcMain.handle('endlesss-logout', () => endlesssLogout())
  ipcMain.handle('endlesss-auth-status', () => getEndlesssAuthStatus())
  ipcMain.handle(
    'endlesss-list-shared-feed',
    (_event, userName: string, offset: number, count: number) =>
      listSharedFeed(userName, offset, count)
  )
  ipcMain.handle('endlesss-resolve-shared-feed-riff', (_event, riffCID: string) =>
    resolveSharedFeedRiff(riffCID)
  )
  ipcMain.handle('endlesss-list-jams', () => listEndlesssJams())
  ipcMain.handle('endlesss-list-riffs', (_event, jamId: string, filters: RiffFilters) =>
    listRiffsInJam(jamId, filters)
  )
  ipcMain.handle('endlesss-resolve-riff', (_event, jamId: string, riffCID: string) =>
    resolveJamRiff(jamId, riffCID)
  )
```

`RiffFilters` needs importing in `src/main/index.ts` too — add it to whatever existing
`@shared/loreLibrary`-or-similar type import block already exists there, or add a new line:

```typescript
import type { RiffFilters } from '@shared/loreLibrary'
```

- [ ] **Step 3: Add the preload bridge methods**

In `src/preload/index.ts`, add after the existing `loreDownloadMissingStems` entry (inside the
`api` object, before its closing brace):

```typescript
  ,
  endlesssLogin: (
    username: string,
    password: string
  ): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('endlesss-login', username, password).then((r) =>
      r.ok ? { ok: true } : { ok: false, error: r.error }
    ),
  endlesssLogout: (): Promise<void> => ipcRenderer.invoke('endlesss-logout'),
  endlesssAuthStatus: (): Promise<
    { loggedIn: false } | { loggedIn: true; userId: string; expiresAt: number }
  > => ipcRenderer.invoke('endlesss-auth-status'),
  endlesssListSharedFeed: (
    userName: string,
    offset: number,
    count: number
  ): Promise<{ riffs: LoreRiffSummary[]; hasMore: boolean; nextOffset: number }> =>
    ipcRenderer.invoke('endlesss-list-shared-feed', userName, offset, count),
  endlesssResolveSharedFeedRiff: (riffCID: string): Promise<LoreResolvedRiff | null> =>
    ipcRenderer.invoke('endlesss-resolve-shared-feed-riff', riffCID),
  endlesssListJams: (): Promise<LoreJam[]> => ipcRenderer.invoke('endlesss-list-jams'),
  endlesssListRiffs: (
    jamId: string,
    filters: {
      dateFrom?: number
      dateTo?: number
      bpm?: number
      userName?: string
      onlyFullyCached?: boolean
      targetUser?: string
      onlyContainsUser?: boolean
      offset?: number
      limit?: number
    }
  ): Promise<{ riffs: LoreRiffSummary[]; hasMore: boolean; nextOffset: number }> =>
    ipcRenderer.invoke('endlesss-list-riffs', jamId, filters),
  endlesssResolveRiff: (jamId: string, riffCID: string): Promise<LoreResolvedRiff | null> =>
    ipcRenderer.invoke('endlesss-resolve-riff', jamId, riffCID)
```

(Adjust the leading `,` placement to fit whatever the actual last property in the `api` object is
by the time this task runs — the goal is these seven methods added as siblings of the existing
`lore*` ones, not a specific line-number match.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `LoreJam`/`LoreRiffSummary`/`LoreResolvedRiff` aren't already imported in
`src/preload/index.ts` (they are, for the existing `lore*` methods — reuse that same import
line), add them.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`
Expected: app launches with no console errors about unregistered IPC channels. (Full behavioral
testing happens once the UI exists — Tasks 10-13.)

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Wire endlesssApi.ts up to new endlesss-* IPC channels and the preload bridge"
```

---

### Task 10: `riffSource.ts` — renderer-side adapter interfaces

**Files:**
- Create: `src/renderer/src/data/riffSource.ts`

- [ ] **Step 1: Write the adapters**

```typescript
// src/renderer/src/data/riffSource.ts
import type { LoreJam, LoreResolvedRiff, LoreRiffSummary, RiffFilters, RiffPage } from '@shared/loreLibrary'

/** Satisfied by both the LORE warehouse and "my private jams" -- anything
 * that's browsed jam-first, riffs-second. */
export interface JamRiffSource {
  label: string
  available(): Promise<boolean>
  listJams(filterText: string): Promise<LoreJam[]>
  listRiffs(jamId: string, filters: RiffFilters): Promise<RiffPage>
  resolveRiff(jamId: string, riffCID: string): Promise<LoreResolvedRiff | null>
}

/** Satisfied by "my shared feed" -- a flat, already-paginated list with no
 * jam-selection step. Deliberately NOT the same shape as JamRiffSource
 * (see the design spec's Architecture section on why forcing a fake single
 * "jam" onto the feed would be worse than admitting there are two natural
 * shapes here). */
export interface FeedRiffSource {
  label: string
  available(): Promise<boolean>
  listRiffs(userName: string, offset: number, count: number): Promise<RiffPage>
  resolveRiff(riffCID: string): Promise<LoreResolvedRiff | null>
}

export const loreRiffSource: JamRiffSource = {
  label: 'lore library',
  available: () => window.rifffApi.loreWarehouseAvailable(),
  listJams: (filterText) => window.rifffApi.loreListJams(filterText),
  listRiffs: (jamId, filters) => window.rifffApi.loreListRiffs(jamId, filters),
  resolveRiff: (_jamId, riffCID) => window.rifffApi.loreResolveRiff(riffCID)
}

export const endlesssJamRiffSource: JamRiffSource = {
  label: 'my private jams',
  available: async () => (await window.rifffApi.endlesssAuthStatus()).loggedIn,
  listJams: () => window.rifffApi.endlesssListJams(),
  listRiffs: (jamId, filters) => window.rifffApi.endlesssListRiffs(jamId, filters),
  resolveRiff: (jamId, riffCID) => window.rifffApi.endlesssResolveRiff(jamId, riffCID)
}

export const endlesssFeedRiffSource: FeedRiffSource = {
  label: 'my shared feed',
  // Always "available" -- unlike private jams, the feed works logged out
  // too (see EndlesssLoginPanel's username-only quick path). The browser
  // component itself handles the "no username entered yet" empty state.
  available: async () => true,
  listRiffs: (userName, offset, count) =>
    window.rifffApi.endlesssListSharedFeed(userName, offset, count),
  resolveRiff: (riffCID) => window.rifffApi.endlesssResolveSharedFeedRiff(riffCID)
}
```

Note: `loreWarehouseAvailable`'s existing return type on `window.rifffApi` is `Promise<boolean>`
— confirm this against `src/preload/index.ts`'s actual declaration before assuming; if it
returns something richer, adapt `available()`'s implementation accordingly rather than the type
declared above (which is what this file needs regardless).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `window.rifffApi`'s type (`RifffApi`, exported from `src/preload/index.ts`)
isn't automatically picked up by the renderer, check how the existing `lore*` methods on
`window.rifffApi` are typed elsewhere in the renderer (likely a global `.d.ts` declaring
`interface Window { rifffApi: RifffApi }`) and confirm the new `endlesss*` methods from Task 9
are visible the same way — no new wiring should be needed since they're on the same `api` object.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/data/riffSource.ts
git commit -m "Add riffSource.ts: JamRiffSource/FeedRiffSource adapters over LORE and Endlesss-direct IPC"
```

---

### Task 11: Extract shared riff-import logic from `LoreLibraryBrowser.tsx`

`LoreLibraryBrowser.tsx`'s `importResolvedRiff` (merge-vs-recreate dedup logic, stem
classification, gain restoration) is exactly what the new Endlesss browser also needs — and per
this session's own memory of past bugs in this exact codepath (duplicate-tile bugs from
re-importing before all stems finished downloading), this logic is genuinely non-trivial and
worth sharing rather than re-deriving. This task extracts it with **zero behavior change** to
the existing LORE browser — verified by the existing manual LORE-browser walkthrough still
working identically afterward.

**Files:**
- Create: `src/renderer/src/audio/importResolvedRiff.ts`
- Modify: `src/renderer/src/components/LoreLibraryBrowser.tsx`
- Modify: `src/shared/friendlyRiffName.ts`

- [ ] **Step 1: Extend `friendlyRiffName` with an optional source suffix**

In `src/shared/friendlyRiffName.ts`, change:

```typescript
export function friendlyRiffName(riffCID: string): string {
  const adjective = ADJECTIVES[fnv1a(riffCID + '|adjective') % ADJECTIVES.length]
  const noun = NOUNS[fnv1a(riffCID + '|noun') % NOUNS.length]
  return `${adjective} ${noun} ${riffCID.slice(0, 8)} lore`
}
```

to:

```typescript
/** Deterministic "adjective noun <cid> <suffix>" display name for a riff
 * imported from an external source (LORE or the new direct-Endlesss path),
 * e.g. "green leopard 2f29c140 lore" -- same riffCID always produces the
 * same adjective/noun pair. The adjective and noun are hashed with
 * different salts so they don't covary (a riffCID that picks "green"
 * shouldn't be more or less likely to also pick "leopard"). `suffix`
 * defaults to 'lore' to keep every existing call site's output identical. */
export function friendlyRiffName(riffCID: string, suffix: string = 'lore'): string {
  const adjective = ADJECTIVES[fnv1a(riffCID + '|adjective') % ADJECTIVES.length]
  const noun = NOUNS[fnv1a(riffCID + '|noun') % NOUNS.length]
  return `${adjective} ${noun} ${riffCID.slice(0, 8)} ${suffix}`
}
```

- [ ] **Step 2: Create the extracted helper module**

```typescript
// src/renderer/src/audio/importResolvedRiff.ts
import type { LoreResolvedRiff } from '@shared/loreLibrary'
import { instrumentMaskToSoundType } from '@shared/loreLibrary'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { friendlyRiffName } from '@shared/friendlyRiffName'
import type { Rifff } from '@shared/types'

/** Builds (or merges into) a Rifff from a resolved riff -- the shared core
 * of what LoreLibraryBrowser.tsx's own importResolvedRiff has always done,
 * extracted so the new Endlesss-direct browser can reuse the exact same
 * merge-vs-recreate logic instead of re-deriving it. Callers own the
 * dispatch/setState side effects (ADD_TO_SHELF, SET_VOLUME, classifyStems,
 * tracking which groupId a riffCID was imported as) -- this function is
 * pure with respect to those.
 *
 * If `existing` is provided (this riffCID was already imported once under
 * that groupId), this MERGES: only stems not already present by slot get
 * added onto the SAME rifff, leaving its placement/name/every
 * already-present stem's mute/volume/type untouched. Real bug this fixes
 * (see LoreLibraryBrowser.tsx's own history): re-importing a riff selected
 * before all its stems finished downloading previously left the original
 * incomplete tile behind and created an unrelated duplicate.
 *
 * Returns null if there's nothing to import (no cached stems, and no prior
 * `existing` to merge into) -- and null if merging into `existing` would add
 * nothing new (already fully up to date, in which case `existing` itself is
 * returned as `rifff` so callers can still report success). `sourceLabel`
 * feeds friendlyRiffName's suffix and Rifff.folderPath's display text
 * (e.g. 'lore' / 'endlesss'). */
export function buildImportedRifff(
  riffCID: string,
  resolved: LoreResolvedRiff,
  existing: Rifff | undefined,
  sourceLabel: string,
  folderPathLabel: string
): { groupId: string; rifff: Rifff; newStemSlots: number[] } | null {
  const cachedStems = resolved.stems.filter((s) => s.path !== null)
  if (!existing && cachedStems.length === 0) return null

  const existingSlots = new Set(existing?.stems.map((s) => s.slot) ?? [])
  const newStems = cachedStems
    .filter((s) => !existingSlots.has(s.slot))
    .map((s) => ({
      slot: s.slot,
      author: s.creatorUserName,
      name: s.presetName,
      type:
        instrumentMaskToSoundType(s.instrumentMask) ??
        guessSoundTypeFromPresetName(s.presetName) ??
        ('fx' as const),
      path: s.path!,
      durationSec: s.durationSec,
      barLength: s.barLength
    }))

  if (existing && newStems.length === 0) {
    return { groupId: existing.groupId, rifff: existing, newStemSlots: [] }
  }

  const groupId = existing?.groupId ?? crypto.randomUUID()
  const rifff: Rifff = existing
    ? { ...existing, key: resolved.key ?? existing.key, stems: [...existing.stems, ...newStems] }
    : {
        groupId,
        name: friendlyRiffName(riffCID, sourceLabel),
        bpm: resolved.bpm,
        barLength: resolved.barLength,
        key: resolved.key,
        folderPath: folderPathLabel,
        stems: newStems
      }

  return { groupId, rifff, newStemSlots: newStems.map((s) => s.slot) }
}
```

- [ ] **Step 3: Update `LoreLibraryBrowser.tsx` to use it**

Replace `LoreLibraryBrowser.tsx`'s own `importResolvedRiff` function body (lines 252-321 in the
current file) with a thin wrapper over the extracted helper, preserving every existing side
effect (`ADD_TO_SHELF` dispatch, `SET_VOLUME` gain restoration, `importedRiffGroupIds` tracking,
`classifyStems` call) exactly as-is:

```typescript
  function importResolvedRiff(
    riffCID: string,
    resolved: LoreResolvedRiff
  ): { groupId: string; rifff: Rifff } | null {
    const existingGroupId = importedRiffGroupIds.get(riffCID)
    const existing = existingGroupId ? state.rifffs[existingGroupId] : undefined
    const result = buildImportedRifff(riffCID, resolved, existing, 'lore', 'lore library')
    if (!result) return null
    const { groupId, rifff, newStemSlots } = result
    if (newStemSlots.length === 0 && existing) return { groupId, rifff }

    dispatch({ type: 'ADD_TO_SHELF', rifff })
    for (const stem of resolved.stems.filter((s) => s.path !== null)) {
      if (Math.abs(stem.gain - 1.0) > 1e-6) {
        dispatch({ type: 'SET_VOLUME', stemKey: stemKey(groupId, stem.slot), volume: stem.gain })
      }
    }
    setImportedRiffGroupIds((prev) => new Map(prev).set(riffCID, groupId))

    const newStems = rifff.stems.filter((s) => newStemSlots.includes(s.slot))
    classifyStems({ ...rifff, stems: newStems }, dispatch).catch((err) => {
      console.error('LoreLibraryBrowser: failed to classify stem types:', err)
    })
    return { groupId, rifff }
  }
```

Add the import: `import { buildImportedRifff } from '../audio/importResolvedRiff'`.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual verification — LORE browser behavior is unchanged**

Run: `npm run dev`, open the LORE library browser, import a riff you haven't imported before,
then re-select it and click Import again (should report success with no new duplicate tile).
This can't be automated per this codebase's own testing convention (React components aren't
unit-tested) — confirm by hand and note in your final report whether it behaved identically to
before this extraction.

- [ ] **Step 6: Commit**

```bash
git add src/shared/friendlyRiffName.ts src/renderer/src/audio/importResolvedRiff.ts src/renderer/src/components/LoreLibraryBrowser.tsx
git commit -m "Extract buildImportedRifff from LoreLibraryBrowser.tsx for reuse by the new Endlesss browser"
```

---

### Task 12: `EndlesssLoginPanel.tsx`

**Files:**
- Create: `src/renderer/src/components/EndlesssLoginPanel.tsx`

- [ ] **Step 1: Write the component**

```typescript
// src/renderer/src/components/EndlesssLoginPanel.tsx
import { useEffect, useState } from 'react'

type AuthStatus =
  | { loggedIn: false }
  | { loggedIn: true; userId: string; expiresAt: number }

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
    const daysLeft = Math.max(0, Math.round((status.expiresAt - Date.now()) / (1000 * 60 * 60 * 24)))
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--ra-text-2)' }}>
        <span>logged in — session expires in {daysLeft} day{daysLeft === 1 ? '' : 's'}</span>
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
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/EndlesssLoginPanel.tsx
git commit -m "Add EndlesssLoginPanel.tsx: username/password login form + session status"
```

---

### Task 13: `EndlesssLibraryBrowser.tsx` — shared feed tab

Scoped deliberately simpler than `LoreLibraryBrowser.tsx`'s full richness (tempo subgrouping,
riff-ID jump, multi-select batch import, background prefetch walk) — those exist there to handle
LORE's 20,000-riff jams; browsing one's own shared feed or private jam(s) doesn't have the same
scale pressure. This task covers just the shared-feed tab; Task 14 adds the private-jams tab to
the same component.

**Files:**
- Create: `src/renderer/src/components/EndlesssLibraryBrowser.tsx`

- [ ] **Step 1: Write the component shell + shared-feed tab**

```typescript
// src/renderer/src/components/EndlesssLibraryBrowser.tsx
import { useEffect, useState } from 'react'
import type { LoreResolvedRiff, LoreRiffSummary } from '@shared/loreLibrary'
import { instrumentMaskToSoundType } from '@shared/loreLibrary'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { sqrtGain } from '@shared/mixGain'
import { getAudioContext } from '../audio/peakCache'
import { startPreviewLoop, stopPreviewSources, registerActivePreview, unregisterActivePreview } from '../audio/previewLoop'
import { buildImportedRifff } from '../audio/importResolvedRiff'
import { usePlaying, useDispatch, useAppState } from '../state/StoreContext'
import { useBusy } from '../state/BusyContext'
import { formatBpm } from '@shared/format'
import type { Rifff } from '@shared/types'
import { stemKey } from '@shared/types'
import { EndlesssLoginPanel } from './EndlesssLoginPanel'

const SHARED_FEED_STORAGE_KEY = 'sssketch:endlesssSharedFeedUsername'
const SHARED_FEED_PAGE_SIZE = 30

type EndlesssTab = 'shared-feed' | 'private-jams'
type AuthStatus = { loggedIn: false } | { loggedIn: true; userId: string; expiresAt: number }

export function EndlesssLibraryBrowser({
  onClose,
  onImported,
  onSwitchToLore
}: {
  onClose: () => void
  onImported: (groupIds: string[], rifffs?: Rifff[]) => void
  /** Called when the user clicks the "lore library" tab -- App.tsx owns
   * which browser component is actually mounted (see Task 15). */
  onSwitchToLore: () => void
}): React.JSX.Element {
  const [tab, setTab] = useState<EndlesssTab>('shared-feed')
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ loggedIn: false })

  const [feedUsername, setFeedUsername] = useState(
    () => localStorage.getItem(SHARED_FEED_STORAGE_KEY) ?? ''
  )
  useEffect(() => {
    try {
      localStorage.setItem(SHARED_FEED_STORAGE_KEY, feedUsername)
    } catch {
      // localStorage unavailable -- not worth surfacing as an error
    }
  }, [feedUsername])

  const [feedRiffs, setFeedRiffs] = useState<LoreRiffSummary[]>([])
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [feedNextOffset, setFeedNextOffset] = useState(0)
  const [feedLoading, setFeedLoading] = useState(false)

  const [selectedRiffCID, setSelectedRiffCID] = useState<string | null>(null)
  const [resolvedRiff, setResolvedRiff] = useState<LoreResolvedRiff | null>(null)
  const [importedRiffGroupIds, setImportedRiffGroupIds] = useState<Map<string, string>>(new Map())
  const [busyRiffCID, setBusyRiffCID] = useState<string | null>(null)

  const playing = usePlaying()
  const dispatch = useDispatch()
  const state = useAppState()
  const setBusy = useBusy()

  // Auto-effective username: whoever's logged in, once authenticated --
  // matches the design spec's "logging in swaps the plain username lookup
  // for the authenticated session automatically" UX.
  const effectiveUsername = feedUsername.trim()

  function loadFeed(offset: number, append: boolean): void {
    if (effectiveUsername === '') return
    setFeedLoading(true)
    window.rifffApi
      .endlesssListSharedFeed(effectiveUsername, offset, SHARED_FEED_PAGE_SIZE)
      .then((page) => {
        setFeedRiffs((prev) => (append ? [...prev, ...page.riffs] : page.riffs))
        setFeedHasMore(page.hasMore)
        setFeedNextOffset(page.nextOffset)
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssListSharedFeed() failed:', err)
      })
      .finally(() => setFeedLoading(false))
  }

  useEffect(() => {
    if (tab !== 'shared-feed') return
    setSelectedRiffCID(null)
    setResolvedRiff(null)
    loadFeed(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadFeed closes over effectiveUsername/tab, both listed; re-defining loadFeed itself every render isn't a stable dep and would loop
  }, [tab, effectiveUsername])

  useEffect(() => {
    if (!selectedRiffCID) return
    let cancelled = false
    window.rifffApi
      .endlesssResolveSharedFeedRiff(selectedRiffCID)
      .then(async (resolved) => {
        if (cancelled || !resolved) return
        setResolvedRiff(resolved)
        if (playing) dispatch({ type: 'PAUSE' })
        const cachedStems = resolved.stems.filter((s) => s.path !== null)
        const gain = sqrtGain(cachedStems.length)
        const sources = await startPreviewLoop(
          getAudioContext(),
          cachedStems.map((s) => ({ path: s.path!, gain: gain * s.gain, durationSec: s.durationSec })),
          () => cancelled
        )
        if (sources.length > 0) registerActivePreview(() => stopPreviewSources(sources))
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssResolveSharedFeedRiff() failed:', err)
      })
    return () => {
      cancelled = true
      stopPreviewSources([])
      unregisterActivePreview(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playing/dispatch intentionally excluded, matching LoreLibraryBrowser.tsx's own established pattern for this exact kind of effect
  }, [selectedRiffCID])

  function handleImport(riffCID: string, resolved: LoreResolvedRiff): void {
    setBusy('importing rifff…')
    setBusyRiffCID(riffCID)
    try {
      const existingGroupId = importedRiffGroupIds.get(riffCID)
      const existing = existingGroupId ? state.rifffs[existingGroupId] : undefined
      const result = buildImportedRifff(riffCID, resolved, existing, 'endlesss', 'endlesss shared feed')
      if (!result) return
      const { groupId, rifff, newStemSlots } = result
      if (newStemSlots.length > 0 || !existing) {
        dispatch({ type: 'ADD_TO_SHELF', rifff })
        for (const stem of resolved.stems.filter((s) => s.path !== null)) {
          if (Math.abs(stem.gain - 1.0) > 1e-6) {
            dispatch({ type: 'SET_VOLUME', stemKey: stemKey(groupId, stem.slot), volume: stem.gain })
          }
        }
        setImportedRiffGroupIds((prev) => new Map(prev).set(riffCID, groupId))
      }
      onImported([groupId], [rifff])
    } finally {
      setBusy(null)
      setBusyRiffCID(null)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 900,
          height: 600,
          maxWidth: '90vw',
          maxHeight: '85vh',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onSwitchToLore}
              style={{
                fontSize: 10,
                color: 'var(--ra-text-3)',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer'
              }}
            >
              lore library
            </button>
            <button
              onClick={() => setTab('shared-feed')}
              className={tab === 'shared-feed' ? 'ra-eyebrow' : undefined}
              style={{
                fontSize: tab === 'shared-feed' ? undefined : 10,
                color: tab === 'shared-feed' ? undefined : 'var(--ra-text-3)',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer'
              }}
            >
              my shared feed
            </button>
            <button
              onClick={() => setTab('private-jams')}
              className={tab === 'private-jams' ? 'ra-eyebrow' : undefined}
              style={{
                fontSize: tab === 'private-jams' ? undefined : 10,
                color: tab === 'private-jams' ? undefined : 'var(--ra-text-3)',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer'
              }}
            >
              my private jams
            </button>
          </div>
          <button
            onClick={onClose}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            close
          </button>
        </div>

        <div style={{ marginTop: 10 }}>
          <EndlesssLoginPanel onStatusChange={setAuthStatus} />
        </div>

        {tab === 'shared-feed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10, flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                value={feedUsername}
                onChange={(e) => setFeedUsername(e.target.value)}
                placeholder={authStatus.loggedIn ? 'your endlesss username (or leave blank)' : 'endlesss username — no login needed for public shares'}
                style={{
                  height: 24,
                  fontSize: 11,
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-text)',
                  border: '1px solid var(--ra-border)',
                  borderRadius: 0,
                  padding: '0 6px',
                  width: 260
                }}
              />
              <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
                {feedRiffs.length} riffs{feedHasMore ? '+' : ''}
              </span>
            </div>

            <div
              onScroll={(e) => {
                if (!feedHasMore || feedLoading) return
                const el = e.currentTarget
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) loadFeed(feedNextOffset, true)
              }}
              style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              {feedRiffs.map((riff) => (
                <button
                  key={riff.riffCID}
                  onClick={() => setSelectedRiffCID(riff.riffCID)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 8px',
                    fontSize: 11,
                    border: 'none',
                    borderRadius: 0,
                    background: selectedRiffCID === riff.riffCID ? 'var(--ra-bg-row-active)' : 'transparent',
                    color: 'var(--ra-text)',
                    cursor: 'pointer'
                  }}
                >
                  <span>{riff.userName || 'shared riff'}</span>
                  <span style={{ color: 'var(--ra-text-3)' }}>
                    {formatBpm(riff.bpm)} BPM · {riff.stemCount} stems
                    {importedRiffGroupIds.has(riff.riffCID) ? ' · imported' : ''}
                  </span>
                </button>
              ))}
              {feedRiffs.length === 0 && !feedLoading && (
                <div style={{ fontSize: 11, color: 'var(--ra-text-3)', marginTop: 6 }}>
                  {effectiveUsername === ''
                    ? 'enter a username above to browse its shared feed'
                    : 'no shared riffs found'}
                </div>
              )}
            </div>

            {resolvedRiff && selectedRiffCID && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--ra-text-2)', flex: 1 }}>
                  {formatBpm(resolvedRiff.bpm)} BPM · {resolvedRiff.stems.length} stems (
                  {resolvedRiff.stems.filter((s) => s.path !== null).length} cached)
                </div>
                <button
                  onClick={() => handleImport(selectedRiffCID, resolvedRiff)}
                  disabled={busyRiffCID !== null}
                  style={{
                    height: 24,
                    borderRadius: 0,
                    padding: '0 12px',
                    fontSize: 10,
                    border: '1px solid var(--ra-border-strong)',
                    background: importedRiffGroupIds.has(selectedRiffCID)
                      ? 'var(--ra-stretch-on-bg)'
                      : 'var(--ra-bg-row-active)',
                    color: importedRiffGroupIds.has(selectedRiffCID)
                      ? 'var(--ra-stretch-on)'
                      : 'var(--ra-text)'
                  }}
                >
                  {importedRiffGroupIds.has(selectedRiffCID) ? 'imported ✓ — import again' : 'import'}
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'private-jams' && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ra-text-3)' }}>
            private jams tab implemented in Task 14
          </div>
        )}
      </div>
    </div>
  )
}
```

`instrumentMaskToSoundType`/`guessSoundTypeFromPresetName` are imported but unused in this task
— they're needed by Task 14's jam-riff-classification path sharing this file; leave the imports
if your linter allows unused-but-soon-used imports across a multi-task file, otherwise remove
them now and re-add in Task 14 (whichever keeps `npm run lint` clean at the end of *this* task is
correct — don't leave a lint failure sitting until Task 14).

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors (remove any genuinely-unused imports per the note above).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/EndlesssLibraryBrowser.tsx
git commit -m "Add EndlesssLibraryBrowser.tsx: shared-feed tab (list, preview, import)"
```

---

### Task 14: `EndlesssLibraryBrowser.tsx` — private jams tab

**Files:**
- Modify: `src/renderer/src/components/EndlesssLibraryBrowser.tsx`

- [ ] **Step 1: Add jam-list and jam-riff state**

Add alongside the shared-feed state declared in Task 13:

```typescript
  const [jams, setJams] = useState<LoreJam[]>([])
  const [selectedJamCID, setSelectedJamCID] = useState<string | null>(null)
  const [jamRiffs, setJamRiffs] = useState<LoreRiffSummary[]>([])
  const [jamRiffsHasMore, setJamRiffsHasMore] = useState(false)
  const [jamRiffsNextOffset, setJamRiffsNextOffset] = useState(0)
  const [jamRiffsLoading, setJamRiffsLoading] = useState(false)
```

Add the `LoreJam` type to the existing `@shared/loreLibrary` import line at the top of the file.

- [ ] **Step 2: Load jams once authenticated, load riffs on jam selection**

```typescript
  useEffect(() => {
    if (tab !== 'private-jams' || !authStatus.loggedIn) return
    window.rifffApi
      .endlesssListJams()
      .then(setJams)
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssListJams() failed:', err)
      })
  }, [tab, authStatus.loggedIn])

  useEffect(() => {
    if (!selectedJamCID) return
    setJamRiffsLoading(true)
    window.rifffApi
      .endlesssListRiffs(selectedJamCID, {})
      .then((page) => {
        setJamRiffs(page.riffs)
        setJamRiffsHasMore(page.hasMore)
        setJamRiffsNextOffset(page.nextOffset)
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssListRiffs() failed:', err)
      })
      .finally(() => setJamRiffsLoading(false))
  }, [selectedJamCID])

  function loadMoreJamRiffs(): void {
    if (!selectedJamCID || jamRiffsLoading) return
    setJamRiffsLoading(true)
    window.rifffApi
      .endlesssListRiffs(selectedJamCID, { offset: jamRiffsNextOffset })
      .then((page) => {
        setJamRiffs((prev) => [...prev, ...page.riffs])
        setJamRiffsHasMore(page.hasMore)
        setJamRiffsNextOffset(page.nextOffset)
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssListRiffs() (load more) failed:', err)
      })
      .finally(() => setJamRiffsLoading(false))
  }
```

- [ ] **Step 3: Resolve a selected jam riff (extends the existing resolve effect)**

The shared-feed resolve effect from Task 13 only handles `tab === 'shared-feed'`. Add a sibling
effect for the jam path, reusing the same `resolvedRiff`/`selectedRiffCID` state (both tabs share
one "currently previewing" concept — switching tabs already resets `selectedRiffCID` per Task
13's tab-switch effect):

```typescript
  useEffect(() => {
    if (tab !== 'private-jams' || !selectedRiffCID || !selectedJamCID) return
    let cancelled = false
    window.rifffApi
      .endlesssResolveRiff(selectedJamCID, selectedRiffCID)
      .then(async (resolved) => {
        if (cancelled || !resolved) return
        setResolvedRiff(resolved)
        if (playing) dispatch({ type: 'PAUSE' })
        const cachedStems = resolved.stems.filter((s) => s.path !== null)
        const gain = sqrtGain(cachedStems.length)
        const sources = await startPreviewLoop(
          getAudioContext(),
          cachedStems.map((s) => ({ path: s.path!, gain: gain * s.gain, durationSec: s.durationSec })),
          () => cancelled
        )
        if (sources.length > 0) registerActivePreview(() => stopPreviewSources(sources))
      })
      .catch((err) => {
        console.error('EndlesssLibraryBrowser: endlesssResolveRiff() failed:', err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matches the shared-feed resolve effect's own established exclusions
  }, [tab, selectedJamCID, selectedRiffCID])
```

Note this duplicates most of Task 13's shared-feed resolve effect body — a reasonable amount of
duplication given the two effects trigger on different conditions and call different IPC methods
(`endlesssResolveRiff(jamId, riffCID)` vs `endlesssResolveSharedFeedRiff(riffCID)`); don't
over-abstract two four-line-different effects into a shared helper that just re-adds the
complexity this task is trying to keep low.

- [ ] **Step 4: Update `handleImport` to work for both tabs**

Task 13's `handleImport` hardcodes `'endlesss shared feed'` as the folder-path label. Generalize:

```typescript
  function handleImport(riffCID: string, resolved: LoreResolvedRiff): void {
    setBusy('importing rifff…')
    setBusyRiffCID(riffCID)
    try {
      const existingGroupId = importedRiffGroupIds.get(riffCID)
      const existing = existingGroupId ? state.rifffs[existingGroupId] : undefined
      const folderPathLabel = tab === 'shared-feed' ? 'endlesss shared feed' : 'endlesss private jam'
      const result = buildImportedRifff(riffCID, resolved, existing, 'endlesss', folderPathLabel)
      // ...(rest unchanged from Task 13)
```

- [ ] **Step 5: Replace the Task 13 placeholder with the real private-jams tab JSX**

Replace:

```typescript
        {tab === 'private-jams' && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ra-text-3)' }}>
            private jams tab implemented in Task 14
          </div>
        )}
```

with:

```typescript
        {tab === 'private-jams' && !authStatus.loggedIn && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ra-text-3)' }}>
            log in above to see your private jams
          </div>
        )}

        {tab === 'private-jams' && authStatus.loggedIn && (
          <div style={{ display: 'flex', gap: 12, marginTop: 10, flex: 1, minHeight: 0 }}>
            <div style={{ width: 200, flexShrink: 0, overflowY: 'auto' }}>
              {jams.map((jam) => (
                <button
                  key={jam.jamCID}
                  onClick={() => {
                    setSelectedJamCID(jam.jamCID)
                    setSelectedRiffCID(null)
                    setResolvedRiff(null)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '5px 6px',
                    fontSize: 11,
                    border: 'none',
                    borderRadius: 0,
                    background: selectedJamCID === jam.jamCID ? 'var(--ra-bg-row-active)' : 'transparent',
                    color: 'var(--ra-text)'
                  }}
                >
                  {jam.name}
                </button>
              ))}
              {jams.length === 0 && (
                <div style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>no jams found</div>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {!selectedJamCID && (
                <div style={{ fontSize: 11, color: 'var(--ra-text-3)' }}>select a jam to browse its riffs</div>
              )}
              {selectedJamCID && (
                <>
                  <div
                    onScroll={(e) => {
                      if (!jamRiffsHasMore || jamRiffsLoading) return
                      const el = e.currentTarget
                      if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) loadMoreJamRiffs()
                    }}
                    style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}
                  >
                    {jamRiffs.map((riff) => (
                      <button
                        key={riff.riffCID}
                        onClick={() => setSelectedRiffCID(riff.riffCID)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          width: '100%',
                          textAlign: 'left',
                          padding: '6px 8px',
                          fontSize: 11,
                          border: 'none',
                          borderRadius: 0,
                          background: selectedRiffCID === riff.riffCID ? 'var(--ra-bg-row-active)' : 'transparent',
                          color: 'var(--ra-text)',
                          cursor: 'pointer'
                        }}
                      >
                        <span>{new Date(riff.creationTime * 1000).toLocaleDateString()}</span>
                        <span style={{ color: 'var(--ra-text-3)' }}>
                          {riff.stemCount} stems
                          {importedRiffGroupIds.has(riff.riffCID) ? ' · imported' : ''}
                        </span>
                      </button>
                    ))}
                  </div>

                  {resolvedRiff && selectedRiffCID && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--ra-text-2)', flex: 1 }}>
                        {formatBpm(resolvedRiff.bpm)} BPM · {resolvedRiff.stems.length} stems (
                        {resolvedRiff.stems.filter((s) => s.path !== null).length} cached)
                      </div>
                      <button
                        onClick={() => handleImport(selectedRiffCID, resolvedRiff)}
                        disabled={busyRiffCID !== null}
                        style={{
                          height: 24,
                          borderRadius: 0,
                          padding: '0 12px',
                          fontSize: 10,
                          border: '1px solid var(--ra-border-strong)',
                          background: importedRiffGroupIds.has(selectedRiffCID)
                            ? 'var(--ra-stretch-on-bg)'
                            : 'var(--ra-bg-row-active)',
                          color: importedRiffGroupIds.has(selectedRiffCID)
                            ? 'var(--ra-stretch-on)'
                            : 'var(--ra-text)'
                        }}
                      >
                        {importedRiffGroupIds.has(selectedRiffCID) ? 'imported ✓ — import again' : 'import'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
```

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. Now that jam-riff classification isn't actually needed here (classification
happens inside `buildImportedRifff`, already imported), double check `instrumentMaskToSoundType`/
`guessSoundTypeFromPresetName` from Task 13's import line are genuinely unused in this file and
remove them if so.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/EndlesssLibraryBrowser.tsx
git commit -m "Add private-jams tab to EndlesssLibraryBrowser.tsx: jam list, riff list, resolve, import"
```

---

### Task 15: Wire into `App.tsx`

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add the source-switch state and import**

Find the existing `loreLibraryOpen`/`setLoreLibraryOpen` state declaration and the
`<LoreLibraryBrowser>` mount (around line 1502 in the current file). Add a sibling state instead
of replacing the existing boolean (keeps this change small and reversible):

```typescript
  const [endlesssLibraryOpen, setEndlesssLibraryOpen] = useState(false)
```

Add the import: `import { EndlesssLibraryBrowser } from './components/EndlesssLibraryBrowser'`.

- [ ] **Step 2: Add a tab switcher to `LoreLibraryBrowser.tsx`'s own header**

In `src/renderer/src/components/LoreLibraryBrowser.tsx`, extend its props:

```typescript
export function LoreLibraryBrowser({
  onClose,
  onImported,
  onSwitchToEndlesss
}: {
  onClose: () => void
  onImported: (groupIds: string[], rifffs?: Rifff[]) => void
  onSwitchToEndlesss: () => void
}): React.JSX.Element {
```

And in its header JSX (the `<div style={{ display: 'flex', justifyContent: 'space-between', ...`
block near the top of the returned JSX), add the tab buttons next to the existing
`<span className="ra-eyebrow">lore library</span>`:

```typescript
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <span className="ra-eyebrow">lore library</span>
            <button
              onClick={onSwitchToEndlesss}
              style={{
                fontSize: 10,
                color: 'var(--ra-text-3)',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer'
              }}
            >
              my shared feed
            </button>
            <button
              onClick={onSwitchToEndlesss}
              style={{
                fontSize: 10,
                color: 'var(--ra-text-3)',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer'
              }}
            >
              my private jams
            </button>
          </div>
          <button onClick={onClose} /* ...unchanged... */>
```

(Both new buttons call the same `onSwitchToEndlesss` — App.tsx's `EndlesssLibraryBrowser` itself
has its own internal shared-feed/private-jams tab state from Tasks 13-14, so it doesn't matter
which one was clicked here; App.tsx just needs to know "show the Endlesss browser instead.")

- [ ] **Step 3: Update `App.tsx`'s mount to swap between the two browsers**

Replace the existing:

```typescript
        {loreLibraryOpen && (
          <LoreLibraryBrowser
            onClose={() => setLoreLibraryOpen(false)}
            onImported={handleLoreImported}
          />
        )}
```

with:

```typescript
        {loreLibraryOpen && (
          <LoreLibraryBrowser
            onClose={() => setLoreLibraryOpen(false)}
            onImported={handleLoreImported}
            onSwitchToEndlesss={() => {
              setLoreLibraryOpen(false)
              setEndlesssLibraryOpen(true)
            }}
          />
        )}
        {endlesssLibraryOpen && (
          <EndlesssLibraryBrowser
            onClose={() => setEndlesssLibraryOpen(false)}
            onImported={handleLoreImported}
            onSwitchToLore={() => {
              setEndlesssLibraryOpen(false)
              setLoreLibraryOpen(true)
            }}
          />
        )}
```

`handleLoreImported` is reused as-is for both — check its current signature matches
`(groupIds: string[], rifffs?: Rifff[]) => void` (it should, since `LoreLibraryBrowser`'s own
`onImported` prop already has this exact shape); if its name reads oddly now that it's shared
across two sources, that's a cosmetic follow-up, not a blocker for this task.

- [ ] **Step 4: Typecheck, lint, full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: no errors, full suite green.

- [ ] **Step 5: Manual walkthrough**

Run: `npm run dev`. Open the library browser (existing entry point), confirm:
- The LORE browser's header now shows "my shared feed" / "my private jams" tab buttons alongside
  "lore library", and clicking either swaps to the new `EndlesssLibraryBrowser`.
- `EndlesssLibraryBrowser`'s own "lore library" link swaps back.
- Entering a real Endlesss username (no login) in "my shared feed" shows that account's public
  shared riffs, previews on click, imports on click.
- Logging in with real credentials in either tab shows a session-status line, unlocks "my private
  jams" (jam list appears), and (if you have any) shows privately-shared riffs in "my shared
  feed" that weren't visible logged out.
- Logging out clears the session and both Endlesss tabs revert to their logged-out states.

This is the point where the plan's two remaining genuinely-open items from the design spec
(what the login response's `password` field actually is, and whether Endlesss enforces any rate
limit) get resolved for real, since it needs Elling's own real account credentials — note
whatever you observe (in particular: did login succeed at all with the Basic/Bearer auth
encoding this plan assumed? did any request get rate-limited or rejected?) in your final report.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/LoreLibraryBrowser.tsx
git commit -m "Wire EndlesssLibraryBrowser into App.tsx alongside the LORE browser, with a shared tab switcher"
```

---

### Task 16: Final code review

Dispatch a final code-quality reviewer subagent over the entire diff (`git diff master` or
equivalent range covering every commit from Task 1 through Task 15) against this plan and the
design spec, per `superpowers:subagent-driven-development`'s own closing step. Specifically
check:
- No plaintext credential storage anywhere (grep for `localStorage` near anything password-shaped
  — the only password ever touched should be the one-time login POST body).
- Every new `fetch` call sets a `User-Agent` identifying sssketch, and every metadata call goes
  through `fetchWithTimeout` (the one deliberate exception being the stem audio download — see
  Task 2's consistency note and Task 8's `downloadOneEndlesssStem` doc comment for why). Every
  call is read-only (GET or POST to `_all_docs`/`/auth/login`/the shared-feed endpoint — never a
  write-shaped endpoint).
- `LoreLibraryBrowser.tsx`'s behavior is genuinely unchanged after Task 11's extraction (diff the
  function bodies, not just "it still compiles").
- No `border-radius` anywhere in the new components (design system convention); lowercase UI
  copy, no emoji/exclamation marks.

No new task is needed here beyond dispatching that review and fixing whatever it finds — this
entry exists so the plan's own task list doesn't silently end at "feature wired up" without the
same closing review every other feature this session went through.

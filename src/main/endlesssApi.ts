import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  LoreJam,
  LoreResolvedRiff,
  LoreResolvedStem,
  LoreRiffSummary,
  RiffFilters,
  RiffPage
} from '@shared/loreLibrary'
import { resolveKeyName } from '@shared/loreLibrary'

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

/** Both Basic (data.endlesss.fm) and Bearer (api.endlesss.fm) auth are built
 * from the same token:password pair, base64-encoded -- per OUROVEON's own
 * comment ("Bearer ... formed out of token:password"), the Bearer variant
 * uses the identical encoding Basic auth would, just under a different
 * header scheme. */
function credentialsBase64(session: EndlesssSession): string {
  return Buffer.from(`${session.token}:${session.password}`).toString('base64')
}

function bearerAuthHeader(session: EndlesssSession): string {
  return `Bearer ${credentialsBase64(session)}`
}

function basicAuthHeader(session: EndlesssSession): string {
  return `Basic ${credentialsBase64(session)}`
}

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

function buildResolvedRiff(
  riffCID: string,
  riffDoc: RawRiffDoc,
  stemDocs: (RawStemDoc | null)[]
): LoreResolvedRiff {
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

function summarizeResolvedRiff(
  riffCID: string,
  userName: string,
  creationTime: number,
  resolved: LoreResolvedRiff
): LoreRiffSummary {
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

// Temporary stub -- replaced with a real implementation in a later task.
async function downloadMissingStemsFor(
  _source: 'shared' | string,
  _riffCID: string,
  resolved: LoreResolvedRiff,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- unused until the real impl lands in a later task
  _fetchImpl: FetchLike
): Promise<LoreResolvedRiff> {
  return resolved
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
      summarizeResolvedRiff(
        entry.doc_id,
        entry.rifff.userName,
        Math.floor(entry.action_timestamp / 1000),
        resolved
      )
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
    .filter(
      (current): current is { on: boolean; currentLoop?: string; gain: number } => !!current?.on
    )
    .map((current) => current.currentLoop)
    .filter((id): id is string => typeof id === 'string')

  const stemDocs = await fetchDocsByKeys<RawStemDoc>(jamId, stemIds, session, fetchImpl)
  const resolved = buildResolvedRiff(riffCID, riffDoc, [...stemDocs.values()])
  return downloadMissingStemsFor('jam', riffCID, resolved, fetchImpl)
}
